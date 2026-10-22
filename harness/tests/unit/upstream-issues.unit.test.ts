import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { clearFrameworkConfigCache, featurePhaseReportsDir, resolveFeatureArtifact } from '../../config';
import { resolvePhaseVerdict, writeRunSummaryBase } from '../../harness-runner';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { buildVerifierMaterialView, writeVerifierMaterial } from '../../scripts/utils/verifier-material';
import { canProduceVerifierRequest, resolveVerifierPlan, workflowVerifierPrompt } from '../../scripts/utils/verifier-plan';
import { resolveEvidencePolicy } from '../../scripts/utils/runtime-policy';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { loadWorkflowSpec } from '../../workflow-loader';
import { __testing_recomputeClosureRepairCandidates, finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { readPhaseRepairIssues, phaseIssuesForVerifierSubject, buildSummaryRepairCandidates,
  verifiedPhaseDesignFindings, itemFingerprintOf, resolveRepairDeclineState, readableIssueEvidence } from '../../scripts/utils/repair-candidates';
import { publishFixtureVerifierEvidence, fixtureSubjectId } from '../utils/verifier-evidence-fixture';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { sha256File } from '../../scripts/utils/phase-evidence-manifest';
import { makeVerifierProject, writeFile } from '../utils/verifier-project-fixture';
import type { CheckResult, HarnessRunSummary, Phase } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { designRepairSignature, designRepairAttempted } from '../../scripts/utils/design-repair-unattended';
import { probeDesignAuthorityRecovered } from '../../scripts/utils/condition-wait';

const FW = path.resolve(__dirname, '../../..');
const FEATURE = 'demo';
const target = 'doc/features/demo/plan/plan.md';
const fix = '修正当前契约的返回值定义';
const completeIssue = '`build.log:1` 与当前契约冲突；' + fix;
const issue = (files = target, refs = '`build.log:1`', id = 'UP-001') => [
  '# 本阶段上游问题', '## 问题清单',
  '| ID | 严重程度 | 分类 | 涉及文件 | 问题描述 | 修复建议 | 状态 |',
  '|---|---|---|---|---|---|---|',
  `| ${id} | MAJOR | 契约冲突 | ${files} | ${refs} 与当前契约冲突 | ${fix} | 未关闭 |`, '',
].join('\n');
const verification = (verdict = 'confirmed', id = 'UP-001') => [
  '```issue-verification', `- issue: ${id}`, `  verdict: ${verdict}`,
  `  evidence: plan.md component-blueprint.yaml change-unit.yaml framework.config.json | ${completeIssue}`, '```', '',
].join('\n');

function withProject(body: (root: string) => void): void {
  const { root } = makeVerifierProject();
  try {
    writeFile(path.join(root, target), '# 当前权威施工契约\n返回值需由规格确定。\n');
    writeFile(path.join(root, 'build.log'), 'Compiler: contract return type conflicts with implementation\n');
    body(root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}
function writeIssues(root: string, phase: string, body = issue()): void {
  writeFile(resolveFeatureArtifact(root, FEATURE, phase === 'coding' ? 'upstream-issues.md' : 'testability-audit.md').canonicalPath, body);
}
function writer(root: string, phase: Phase, checks: CheckResult[], disabled = false): HarnessRunSummary {
  const report = generateScriptReport(path.join(FW, 'harness'), phase, FEATURE, root, checks, FW);
  const phaseVerdict = resolvePhaseVerdict(root, report);
  const policy = resolveEvidencePolicy('full', { mode: 'goal', adapter: 'claude', phase, workflow: 'spec-driven', can_prompt_user: false, can_collect_usage: false }, {});
  const plan = resolveVerifierPlan({ phase, track: 'full', runtimeMode: 'goal', policy,
    workflowVerifierPrompt: workflowVerifierPrompt(loadWorkflowSpec(FW, 'spec-driven'), phase),
    phaseDisabledByProfile: disabled, adapterHasVerifierSubagent: true, adapterName: 'claude' });
  const dir = featurePhaseReportsDir(root, FEATURE, phase, FW);
  writeFile(path.join(dir, 'ai-prompt.md'), '# Current verifier materials\n');
  const proposals = readPhaseRepairIssues(root, FEATURE, phase);
  const material = buildVerifierMaterialView({ projectRoot: root, feature: FEATURE, phase, frameworkRoot: FW,
    gateFingerprint: computeGateFingerprint(FW, phase), phaseRuleText: `phase: ${phase}`, templateText: 'actual-stage-template', checks,
    contextFiles: proposals ? [{ label: proposals.reportPath, content: proposals.reportText }, ...proposals.evidenceFiles] : [] });
  return writeRunSummaryBase(root, report, FW, { verifierPlan: plan, verifierMaterial: material, phaseVerdict });
}
const compileFail: CheckResult = { id: 'coding_compile_gate', category: 'structure', description: 'Compile', status: 'FAIL', severity: 'BLOCKER', details: '真实编译失败，不能通过' };
const passed: CheckResult = { id: 'actual_stage_check', category: 'structure', description: 'Actual stage check', status: 'PASS', severity: 'BLOCKER', details: '本阶段机器检查通过' };

export function runAll(): UnitCaseResult[] {
  const cases: Array<[string, () => void]> = [
    ['optional coding absence preserves machine candidates and never requests failed-phase diagnosis', () => withProject(root => {
      assert.strictEqual(readPhaseRepairIssues(root, FEATURE, 'coding'), null);
      const summary = writer(root, 'coding', [compileFail, { ...compileFail, id: 'machine_scope', details: '机器发现真实范围缺口', repair_owner: 'plan' }]);
      assert(!summary.verifier_request);
      assert(summary.repair_candidates?.some(candidate => candidate.id === 'machine_scope'));
      assert.strictEqual(writer(root, 'coding', [passed], true).verdict, 'PASS');
    })],
    ['coding and UT concrete evidence qualify through blocked inputs and SKIP without changing real results', () => withProject(root => {
      for (const phase of ['coding', 'ut']) {
        writeIssues(root, phase);
        const upstreamDiagnosis = readPhaseRepairIssues(root, FEATURE, phase);
        assert(upstreamDiagnosis?.rows.length === 1);
        const base = { planMode: 'enabled' as const, phase, scriptVerdict: 'FAIL', checks: [compileFail, { ...passed, id: 'not_executed', status: 'SKIP' }], reportValidity: 'UNVERIFIED' as const, hasBlockedCapability: true, upstreamDiagnosis };
        assert.strictEqual(canProduceVerifierRequest(base).kind, 'repair_diagnosis');
        assert(!canProduceVerifierRequest({ ...base, upstreamDiagnosis: null }).allowed);
        assert(!canProduceVerifierRequest({ ...base, planMode: 'disabled' }).allowed);
        assert(!canProduceVerifierRequest({ ...base, reportValidity: 'FAIL' }).allowed);
        const summary = writer(root, phase as Phase, [compileFail, { ...passed, id: 'not_executed', status: 'SKIP' }]);
        assert.strictEqual(summary.verdict, 'FAIL'); assert.strictEqual(summary.closure_status, 'open');
        assert(summary.blocking_skips.some(check => check.id === 'not_executed'));
        assert.strictEqual(summary.next_action, 'run_verifier_for_repair');
        assert(!summary.repair_candidates?.length);
      }
    })],
    ['missing, escaping and out-of-range diagnosis evidence cannot qualify or dispatch', () => withProject(root => {
      for (const refs of ['上游有问题', '`missing.log:1`', '`build.log:999`', '`../outside.log:1`']) {
        writeIssues(root, 'coding', issue(target, refs));
        assert.strictEqual(readPhaseRepairIssues(root, FEATURE, 'coding')?.rows.length, 0, refs);
        assert(!writer(root, 'coding', [compileFail]).verifier_request, refs);
      }
      assert.strictEqual(readableIssueEvidence(root, '`build.log:1`').length, 1);
      writeIssues(root, 'coding', issue('src/main/resources/string.json'));
      assert.strictEqual(readPhaseRepairIssues(root, FEATURE, 'coding')?.rows.length, 0, 'missing implementation/resource remains coding work');
      assert(!writer(root, 'coding', [compileFail]).verifier_request);
      const configFile = path.join(root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.project_profile = { name: 'hmos-app' };
      fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
      for (const ownUt of ['02-Feature/F/src/ohosTest/ets/test/Example.test.ets', 'doc/features/demo/ut/testability-audit.md']) {
        writeIssues(root, 'ut', issue(ownUt));
        assert.strictEqual(readPhaseRepairIssues(root, FEATURE, 'ut')?.rows.length, 0, `${ownUt} stays UT-owned`);
      }
      // One verifier entry cannot adjudicate two rows that reuse the same issue ID.
      writeIssues(root, 'coding', issue().replace('\n\n', '\n') + `| UP-001 | MAJOR | 契约冲突 | ${target} | \`build.log:1\` | ${fix} | 未关闭 |\n`);
      assert.strictEqual(readPhaseRepairIssues(root, FEATURE, 'coding')?.rows.length, 0);
    })],
    ['a retired design check ID cannot hide a different current verified design finding', () => withProject(root => {
      const authority = 'doc/features/bp/blueprint/component-blueprint.yaml';
      writeFile(path.join(root, authority), 'current design authority with a remaining contract conflict\n');
      writeIssues(root, 'coding', issue(authority, '`build.log:1`', 'CURRENT-002'));
      const issued = writer(root, 'coding', [compileFail]);
      const dir = featurePhaseReportsDir(root, FEATURE, 'coding', FW);
      publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: dir, feature: FEATURE, phase: 'coding',
        subjectId: issued.verifier_subject_id, reportText: verification('confirmed', 'CURRENT-002'), skipSummaryPatch: true });
      const current = writer(root, 'coding', [compileFail]);
      assert(current.blockers.some(blocker => blocker.id === 'coding:CURRENT-002' && blocker.repair_owner === 'external'));
      const probe = probeDesignAuthorityRecovered(root, FEATURE, 'coding', ['coding:RETIRED-001']);
      assert.strictEqual(probe.ready, false, 'a different current design finding must still block recovery');
      assert(probe.reason?.includes('coding:CURRENT-002'), probe.reason);
    })],
    ['real writer and closure reader consume stage artifacts and the same current verified candidates', () => withProject(root => {
      for (const phase of ['coding', 'ut'] as const) {
        writeIssues(root, phase);
        const base = writer(root, phase, [compileFail]);
        assert(base.verifier_subject_id && !base.repair_candidates?.length);
        const dir = featurePhaseReportsDir(root, FEATURE, phase, FW);
        const publish = (verdict: string) => publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: dir, feature: FEATURE, phase,
          subjectId: base.verifier_subject_id, reportText: verification(verdict), skipSummaryPatch: true });
        publish('confirmed');
        const viaWriter = writer(root, phase, [compileFail]);
        const viaClosure = __testing_recomputeClosureRepairCandidates({ projectRoot: root, frameworkRoot: FW, feature: FEATURE, phase, persistPhaseState: () => undefined }, dir, viaWriter);
        assert.strictEqual(viaWriter.repair_candidates?.[0]?.source_phase, phase);
        assert.strictEqual(viaWriter.repair_candidates?.[0]?.category, 'plan');
        assert.deepStrictEqual(viaClosure, viaWriter.repair_candidates);
        for (const verdict of ['refuted', 'unclear']) { publish(verdict); assert.strictEqual(writer(root, phase, [compileFail]).repair_candidates?.length ?? 0, 0); }
      }
    })],
    ['current subject binds diagnosis bytes; stale evidence cannot become a candidate at closure', () => withProject(root => {
      writeIssues(root, 'coding');
      const base = writer(root, 'coding', [compileFail]);
      const dir = featurePhaseReportsDir(root, FEATURE, 'coding', FW);
      publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: dir, feature: FEATURE, phase: 'coding', subjectId: base.verifier_subject_id, reportText: verification(), skipSummaryPatch: true });
      assert(phaseIssuesForVerifierSubject(root, FEATURE, 'coding', base.verifier_subject_id!, FW));
      fs.writeFileSync(path.join(root, 'build.log'), 'Current compiler no longer reports that conflict\n');
      assert.strictEqual(phaseIssuesForVerifierSubject(root, FEATURE, 'coding', base.verifier_subject_id!, FW), null);
      assert.strictEqual(__testing_recomputeClosureRepairCandidates({ projectRoot: root, frameworkRoot: FW, feature: FEATURE, phase: 'coding', persistPhaseState: () => undefined }, dir, base)?.length, 0);
    })],
    ['diagnosis binds actual authority text over an existing CU-neutral slot; ordinary material keeps neutral reuse', () => withProject(root => {
      fs.cpSync(path.join(FW, 'harness/tests/fixtures/component-blueprint/valid'), root, { recursive: true });
      const feature = 'cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g';
      fs.rmSync(path.join(root, 'doc/features/ledger-app-blueprint/ledger-refresh/contracts.yaml'));
      const authority = 'doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml';
      const resolution = resolveCapabilityInputs({ projectRoot: root, frameworkRoot: FW, feature, phase: 'coding', track: 'full',
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } });
      const input = { projectRoot: root, frameworkRoot: FW, feature, phase: 'coding', gateFingerprint: 'test-gate',
        phaseRuleText: 'r', templateText: 't', checks: [], resolvedInputs: resolution.inputs,
        contextFiles: [{ label: authority, content: fs.readFileSync(path.join(root, authority), 'utf8') }] };
      const ordinary = buildVerifierMaterialView(input);
      assert.notStrictEqual(ordinary.files.find(file => file.path === authority)?.sha256, sha256File(path.join(root, authority)), 'precondition: existing slot must use real CU-neutral digest');
      const proposal = resolveFeatureArtifact(root, feature, 'upstream-issues.md').canonicalPath;
      writeFile(proposal, issue(authority));
      const diagnosis = buildVerifierMaterialView(input);
      assert.strictEqual(diagnosis.files.find(file => file.path === authority)?.sha256, sha256File(path.join(root, authority)));
      const subject = fixtureSubjectId('actual-diagnosis');
      writeVerifierMaterial(featurePhaseReportsDir(root, feature, 'coding', FW), subject, diagnosis);
      assert(phaseIssuesForVerifierSubject(root, feature, 'coding', subject, FW));
      const bytes = fs.readFileSync(path.join(root, authority));
      try {
        fs.appendFileSync(path.join(root, authority), '\n# changed diagnostic original text\n');
        assert.strictEqual(phaseIssuesForVerifierSubject(root, feature, 'coding', subject, FW), null);
      } finally { fs.writeFileSync(path.join(root, authority), bytes); }
      fs.unlinkSync(proposal);
      assert.strictEqual(buildVerifierMaterialView(input).material_sha256, ordinary.material_sha256);
    })],
    ['verified blueprint, CU and DSL proposals route to external design findings, never coding', () => withProject(root => {
      for (const authority of ['doc/features/bp/blueprint/component-blueprint.yaml', 'doc/features/bp/cu/change-unit.yaml', 'framework.config.json']) {
        if (authority !== 'framework.config.json') writeFile(path.join(root, authority), 'current authority\n');
        writeIssues(root, 'coding', issue(authority));
        const base = writer(root, 'coding', [compileFail]);
        const dir = featurePhaseReportsDir(root, FEATURE, 'coding', FW);
        publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: dir, feature: FEATURE, phase: 'coding', subjectId: base.verifier_subject_id, reportText: verification(), skipSummaryPatch: true });
        const summary = writer(root, 'coding', [compileFail]);
        assert(!summary.repair_candidates?.length);
        assert(summary.blockers.some(blocker => blocker.id === 'coding:UP-001' && blocker.repair_owner === 'external'));
        const findings = verifiedPhaseDesignFindings({ phaseIssues: readPhaseRepairIssues(root, FEATURE, 'coding'), verifierReportText: verification() });
        assert.deepStrictEqual(findings[0].artifacts, [authority]);
        writeIssues(root, 'coding', issue(authority, '`build.log:1`', 'RENAMED'));
        const renamed = verifiedPhaseDesignFindings({ phaseIssues: readPhaseRepairIssues(root, FEATURE, 'coding'), verifierReportText: verification('confirmed', 'RENAMED') });
        const signature = designRepairSignature(FEATURE, 'coding', findings, 'same-authority');
        const renamedSignature = designRepairSignature(FEATURE, 'coding', renamed, 'same-authority');
        assert.strictEqual(renamedSignature, signature);
        assert(designRepairAttempted([{ type: 'design_authority_repair', action: 'content_repair', stage: 'attempted', signature }], renamedSignature));
      }
    })],
    ['a late verified upstream proposal survives actual finalizer publication', () => withProject(root => {
      writeIssues(root, 'coding');
      const base = writer(root, 'coding', [passed]);
      const dir = featurePhaseReportsDir(root, FEATURE, 'coding', FW);
      publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: dir, feature: FEATURE, phase: 'coding', subjectId: base.verifier_subject_id, reportText: verification(), skipSummaryPatch: true });
      const closed = finalizePhaseClosure({ projectRoot: root, frameworkRoot: FW, feature: FEATURE, phase: 'coding',
        prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }), persistPhaseState: () => undefined, assessAfterCommit: () => undefined });
      assert.strictEqual(closed.summary.closure_status, 'closed');
      assert.strictEqual(closed.summary.repair_candidates?.[0]?.source_phase, 'coding');
    })],
    ['factual refusals require independent confirmation; old subject and renamed ID cannot re-dispatch', () => withProject(root => {
      writeIssues(root, 'coding');
      const fp = itemFingerprintOf('UP-001', [target], completeIssue);
      const inputs = { phase: 'coding', checks: [], reportValidity: 'PASS' as const, reviewReportText: null, phaseIssues: readPhaseRepairIssues(root, FEATURE, 'coding'), verifierReportText: verification() };
      assert.strictEqual(buildSummaryRepairCandidates({ ...inputs, declinedFingerprints: new Set([fp]), verifierSubjectCurrent: false }).length, 0);
      writeIssues(root, 'coding', issue(target, '`build.log:1`', 'NEW-ID'));
      const renamed = { ...inputs, phaseIssues: readPhaseRepairIssues(root, FEATURE, 'coding'), verifierReportText: verification('confirmed', 'NEW-ID'),
        declinedIssues: [{ id: 'UP-001', summary: completeIssue, files: [target], source_phase: 'coding', item_fingerprint: fp }] };
      assert.strictEqual(buildSummaryRepairCandidates({ ...renamed, verifierSubjectCurrent: false }).length, 0);
      assert.strictEqual(buildSummaryRepairCandidates({ ...renamed, verifierSubjectCurrent: true })[0]?.item_fingerprint, fp, 'fresh subject cannot refresh identity by renaming');
      assert.notStrictEqual(buildSummaryRepairCandidates({ ...renamed, declinedIssues: [{ ...renamed.declinedIssues[0], source_phase: 'ut' }], verifierSubjectCurrent: true })[0]?.item_fingerprint, fp, 'other source phase is not an identity alias');
      writeIssues(root, 'coding', issue(target, '`build.log:1`', 'NEW-ID').replace('与当前契约冲突', '显示另一个独立问题'));
      const distinct = buildSummaryRepairCandidates({ ...renamed, phaseIssues: readPhaseRepairIssues(root, FEATURE, 'coding'),
        verifierReportText: verification('confirmed', 'NEW-ID').replace('与当前契约冲突', '显示另一个独立问题'), verifierSubjectCurrent: true });
      assert.strictEqual(distinct.length, 1, 'a different confirmed complete issue must remain actionable');
      assert.notStrictEqual(distinct[0].item_fingerprint, fp, 'generic same fix cannot merge distinct complete issues');
      const candidate = { id: 'UP-001', category: 'plan', files: [target], summary: completeIssue, item_fingerprint: fp, source_phase: 'coding' };
      const input = { runs: [{ run_id: 'run', events: [{ type: 'phase_backtrack_requested', ts: '2026-10-21T00:00:00Z', to_phase: 'plan', candidates: [candidate] }] }],
        ledgers: { plan: [{ run_id: 'run', gate_id: `repair_candidate:${fp}`, ts: '2026-10-21T00:00:01Z', decision: 'declined: 当前 `build.log:1` 并不证明契约错误' }] }, requirementText: '完成当前任务' };
      assert.strictEqual(resolveRepairDeclineState(input).get(fp)?.declined_rounds, 0);
      assert.strictEqual(resolveRepairDeclineState({ ...input, verifyFactDecline: () => true }).get(fp)?.declined_rounds, 1);
    })],
  ];
  return cases.map(([name, body]) => { try { body(); return { name, ok: true }; } catch (error) { return { name, ok: false, error: (error as Error).stack }; } });
}
