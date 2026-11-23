import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featurePhaseReportsDir, resolveFeatureArtifact } from '../../config';
import { resolvePhaseVerdict, writeRunSummaryBase } from '../../harness-runner';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { buildVerifierMaterialView, writeVerifierMaterial, verifierMaterialFileHash } from '../../scripts/utils/verifier-material';
import { canProduceVerifierRequest, resolveVerifierPlan, workflowVerifierPrompt } from '../../scripts/utils/verifier-plan';
import { resolveEvidencePolicy } from '../../scripts/utils/runtime-policy';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { loadWorkflowSpec } from '../../workflow-loader';
import { __testing_recomputeClosureRepairCandidates, finalizePhaseClosure, preparePhaseRepairFeedback } from '../../scripts/utils/phase-closure-finalizer';
import { readPhaseRepairIssues, phaseIssuesForVerifierSubject, buildSummaryRepairCandidates,
  verifiedPhaseDesignFindings, verifiedPhaseRepairIssues, buildCurrentVerifierDiagnosisContext, findUnreadableDiagnosisChecks, itemFingerprintOf, resolveRepairDeclineState, readableIssueEvidence, verifiedRepairDeclineResponses } from '../../scripts/utils/repair-candidates';
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
    phaseDisabledByProfile: disabled });
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
    ...(['plan-repair', 'fact-decline'] as const).map(mode => [
      `RC12 ${mode}: actual TS2322 and current authority reach original verification without a phase receipt`,
      () => withProject(root => {
        const source = 'src/upstream-counterexample.ts';
        const compile = (): string => {
          const program = ts.createProgram([path.join(root, source)], { noEmit: true, strict: true, types: [], skipLibCheck: true, target: ts.ScriptTarget.ES2022 });
          const diagnostics = ts.getPreEmitDiagnostics(program);
          return diagnostics.length ? diagnostics.map(row => `TS${row.code}: ${ts.flattenDiagnosticMessageText(row.messageText, '\n')}`).join('\n') : 'current counterexample source typechecks';
        };
        writeFile(path.join(root, target), `# Current contract\nDERIVED_COUNTEREXAMPLE_TYPE=${mode === 'plan-repair' ? 'never' : 'string'}\n`);
        writeFile(path.join(root, source), 'const diagnosticValue: never = "current value";\n');
        const failed = compile(); assert.match(failed, /TS2322/);
        writeFile(path.join(root, 'build.log'), failed + '\n');
        writeIssues(root, 'coding', issue(target, '`build.log:1` 与 `src/upstream-counterexample.ts:1`'));
        const proposal = readPhaseRepairIssues(root, FEATURE, 'coding')!;
        const first = writer(root, 'coding', [{ ...compileFail, details: failed }]); assert(first.verifier_subject_id);
        const dir = featurePhaseReportsDir(root, FEATURE, 'coding', FW);
        const response = (verdict: string, evidence: string) => '```issue-verification\n' + YAML.stringify([{ issue: 'UP-001', verdict, evidence }]) + '```\n';
        publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: dir, feature: FEATURE, phase: 'coding', subjectId: first.verifier_subject_id,
          reportText: response('confirmed', [proposal.rows[0].summary, target, source, 'build.log', failed].join(' | ')), skipSummaryPatch: true });
        const confirmed = writer(root, 'coding', [{ ...compileFail, details: failed }]);
        const candidate = confirmed.repair_candidates?.find(row => row.id === 'UP-001');
        assert(candidate?.category === 'plan' && candidate.files.includes(target), JSON.stringify(confirmed.repair_candidates));
        const originalReport = path.join(dir, `verifier.report.${first.verifier_subject_id}.md`), originalBytes = fs.readFileSync(originalReport);
        if (mode === 'plan-repair') writeFile(path.join(root, target), '# Current contract\nDERIVED_COUNTEREXAMPLE_TYPE=string\n');
        else {
          const basis = `当前 ${target} 已明定 string；错误来自 ${source} 的 never 标注。\n\n原编译证据必须保留：${failed}`;
          const ledger = path.join(root, 'doc/features/demo/plan/headless-assumptions.jsonl');
          writeFile(ledger, JSON.stringify({ decision: basis }) + '\n');
          const delivered = JSON.parse(fs.readFileSync(ledger, 'utf8')).decision as string;
          const declines = new Map([[candidate.item_fingerprint, { id: candidate.id, summary: candidate.summary, declined_rounds: 1, rebuttal_used: false,
            basis: { text: delivered, run_id: 'current', round: { run_id: 'current', ts: new Date().toISOString() } }, first_declined_round: null }]]);
          const full = response('refuted', delivered);
          assert.equal(verifiedRepairDeclineResponses({ verifierReportText: full, verifierSubjectCurrent: false, declines }).length, 0);
          assert.equal(verifiedRepairDeclineResponses({ verifierReportText: full, verifierSubjectCurrent: true, declines })[0]?.evidence, delivered);
          assert.match(fs.readFileSync(path.join(root, source), 'utf8'), /never/, 'the owner refusal cannot wash away the actual implementation failure');
        }
        const authority = /DERIVED_COUNTEREXAMPLE_TYPE=(string|never)/.exec(fs.readFileSync(path.join(root, target), 'utf8'))![1];
        writeFile(path.join(root, source), `const diagnosticValue: ${authority} = "current value";\n`);
        const repaired = compile(); assert.equal(repaired, 'current counterexample source typechecks');
        writeFile(path.join(root, 'build.log'), repaired + '\n');
        const current = writer(root, 'coding', [passed]); assert(current.verifier_subject_id && current.verifier_subject_id !== first.verifier_subject_id);
        assert.equal(phaseIssuesForVerifierSubject(root, FEATURE, 'coding', first.verifier_subject_id, FW), null, 'the old diagnosis cannot decide the corrected current source');
        publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: dir, feature: FEATURE, phase: 'coding', subjectId: current.verifier_subject_id,
          reportText: response('refuted', [proposal.rows[0].summary, target, source, 'build.log', repaired].join(' | ')), skipSummaryPatch: true });
        const settled = writer(root, 'coding', [passed]);
        assert(!settled.repair_candidates?.some(row => row.id === 'UP-001'), JSON.stringify(settled.repair_candidates));
        assert.deepEqual(fs.readFileSync(originalReport), originalBytes, 'the current decision preserves the original independent failure evidence');
      }),
    ] as [string, () => void]),
    ['Feature-relative references reach the real subject with project POSIX labels and complete diagnosis context', () => withProject(root => {
      writeIssues(root, 'coding', issue(target, '`plan/plan.md:2`'));
      const proposed = readPhaseRepairIssues(root, FEATURE, 'coding')!;
      assert.equal(proposed.rows.length, 1);
      assert(proposed.evidenceFiles.some(file => file.label === target), JSON.stringify(proposed));
      const issued = writer(root, 'coding', [compileFail]);
      assert(phaseIssuesForVerifierSubject(root, FEATURE, 'coding', issued.verifier_subject_id!, FW), 'production material lookup must accept normalized references');
      const context = buildCurrentVerifierDiagnosisContext({ projectRoot: root, frameworkRoot: FW, feature: FEATURE, phase: 'coding', subjectId: issued.verifier_subject_id! });
      assert.deepEqual(context?.rows, proposed.rows);
      assert.deepEqual(context?.diagnostics, proposed.diagnostics);
      assert.equal(context?.sourcePhase, 'coding');
      assert.equal(context?.verifierSubjectCurrent, true);
    })],
    ['a bad or ambiguous reference keeps good evidence and diagnostics without confirming the proposal', () => withProject(root => {
      writeFile(path.join(root, 'doc/features/demo/build.log'), 'different Feature-local compiler output\n');
      const diagnostics: string[] = [];
      const evidence = readableIssueEvidence(root, '`plan/plan.md:2`、`missing.log:1`、`build.log:1`', { feature: FEATURE, diagnostics });
      assert.deepEqual(evidence.map(file => file.label), [target]);
      assert(diagnostics.some(message => message.includes('不存在')) && diagnostics.some(message => message.includes('歧义')), diagnostics.join('\n'));
      writeIssues(root, 'coding', issue(target, '`plan/plan.md:2`、`missing.log:1`'));
      const proposed = readPhaseRepairIssues(root, FEATURE, 'coding')!;
      assert.equal(proposed.rows.length, 1, 'readable evidence remains available to the original verifier');
      assert(proposed.diagnostics?.some(message => message.startsWith('UP-001：')));
      const verifier = ['```issue-verification', '- issue: UP-001', '  verdict: confirmed', `  evidence: plan.md | ${proposed.rows[0].summary}`, '```'].join('\n');
      assert.deepEqual(verifiedPhaseRepairIssues({ phaseIssues: proposed, verifierReportText: verifier }), [], 'locating one file does not validate all required references');
      const context = buildCurrentVerifierDiagnosisContext({ projectRoot: root, frameworkRoot: FW, feature: FEATURE, phase: 'coding', subjectId: null, phaseIssues: proposed, verifierSubjectCurrent: false });
      assert.deepEqual(context?.diagnostics, proposed.diagnostics);
      assert.equal(context?.verifierSubjectCurrent, false);
      assert(findUnreadableDiagnosisChecks('coding', verifier, context).some(message => message.includes('missing.log')), 'the production diagnosis predicate must receive the concrete missing reference');
    })],
    ['verified owner conflicts in coding and UT proposals give corrective feedback without dispatching a false owner', () => withProject(root => {
      for (const phase of ['coding', 'ut'] as const) {
        writeIssues(root, phase);
        const issued = writer(root, phase, [compileFail]);
        assert(issued.verifier_subject_id);
        publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: featurePhaseReportsDir(root, FEATURE, phase, FW), feature: FEATURE, phase,
          subjectId: issued.verifier_subject_id, reportText: verification().replace('verdict: confirmed', 'verdict: confirmed\n  repair_owner: spec'), skipSummaryPatch: true });
        const diagnosed = readPhaseRepairIssues(root, FEATURE, phase);
        assert(diagnosed?.diagnostics?.some(message => message.includes('UP-001') && message.includes('真实修复对象')), JSON.stringify(diagnosed));
        const summary = writer(root, phase, [compileFail]);
        assert(!summary.repair_candidates?.some(candidate => candidate.id === 'UP-001'), JSON.stringify(summary.repair_candidates));
        assert.equal(summary.verdict, 'FAIL', '核实角色冲突反馈不能洗绿真实编译失败');
      }
    })],
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
        assert.strictEqual(canProduceVerifierRequest({ ...base, reportValidity: 'FAIL' }).kind, 'repair_diagnosis',
          'an unrelated report failure does not erase this real reviewable diagnosis');
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
      writeFile(path.join(root, target), '# Plan\n## Scope\n```yaml\nin_scope_modules: [F]\nout_of_scope_modules: []\nrationale: owned source fixture\n```\n');
      writeFile(path.join(root, 'doc/features/demo/contracts.yaml'), 'modules:\n  - name: F\n    package_path: 02-Feature/F\nfiles: []\n');
      writeFile(path.join(root, '02-Feature/F/src/main/ets/A.ets'), 'export class A {}\n');
      writeIssues(root, 'coding', issue('02-Feature/F/src/main/resources/string.json'));
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
      // The minimal fixture has no skill contracts; let the probe use the complete framework checkout.
      fs.rmSync(path.join(root, 'framework', 'workflows'), { recursive: true });
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
      assert.strictEqual(diagnosis.files.find(file => file.path === authority)?.sha256,
        verifierMaterialFileHash({ projectRoot: root, feature, phase: 'coding', file: authority }));
      const subject = fixtureSubjectId('actual-diagnosis');
      writeVerifierMaterial(featurePhaseReportsDir(root, feature, 'coding', FW), subject, diagnosis);
      assert(phaseIssuesForVerifierSubject(root, feature, 'coding', subject, FW));
      const bytes = fs.readFileSync(path.join(root, authority));
      try {
        fs.writeFileSync(path.join(root, authority), bytes.toString('utf8').replace('Ledger data is persisted', 'Changed business claim: ledger data is persisted'));
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
      const feedback = preparePhaseRepairFeedback({ projectRoot: root, frameworkRoot: FW, feature: FEATURE, phase: 'coding' });
      assert.strictEqual(feedback?.repairCandidates?.[0]?.source_phase, 'coding');
      assert(feedback?.disposition.completionBlocking.some(problem => problem.id === 'open_finding:UP-001'));
      assert.throws(() => finalizePhaseClosure({ projectRoot: root, frameworkRoot: FW, feature: FEATURE, phase: 'coding',
        prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }), persistPhaseState: () => undefined, assessAfterCommit: () => undefined }), /open_finding:UP-001/);
      assert.notStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')).closure_status, 'closed');
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
