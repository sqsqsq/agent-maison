import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featurePhaseReportsDir, resolveFeatureArtifact } from '../../config';
import { readVerifierSemanticIssues, phaseIssuesForVerifierSubject, verifiedPhaseRepairIssues, verifiedPhaseDesignFindings, readVerifiedPhaseDesignFindings, projectDesignFindingsIntoSummary, findUnreadableDiagnosisChecks } from '../../scripts/utils/repair-candidates';
import { buildVerifierMaterialView, writeVerifierMaterial, collectCurrentAcceptanceEvidence, verifierMaterialFileMatchesCurrent } from '../../scripts/utils/verifier-material';
import { verifierReportMdFilename } from '../../scripts/utils/verifier-subject';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { evidenceEntryMatchesCurrentFile, IDENTITY_NEUTRAL_EVIDENCE } from '../../scripts/utils/phase-evidence-manifest';
import type { HarnessRunSummary } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { prepareFeatureScopeCandidate, featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { freezeFeatureExecutionScope, registerFeatureScopeTransfer } from '../../scripts/utils/feature-execution-scope';
import { executionScopeFingerprint } from '../../scripts/utils/execution-scope';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { collectContextFiles } from '../../harness-runner';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { readCurrentDispositionInput } from '../../scripts/utils/verify-feature-completion';
import { evaluateAcceptanceFlowStructure } from '../../scripts/utils/p0-semantic-gates';
import { canProduceVerifierRequest } from '../../scripts/utils/verifier-plan';

const frameworkRoot = path.resolve(__dirname, '../../..');
const source = path.join(__dirname, '../fixtures/host-recovery-history/20261023/20261023T044016Z-fe4512/project');
const feature = 'cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93';
const featureDir = 'doc/features/bc-openCard-2/bank-card-opening-flow';
const blueprint = 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml';
const subject = '7'.repeat(64);

export function currentFinding(root: string, mutate?: (finding: Record<string, unknown>) => void) {
  const reports = featurePhaseReportsDir(root, feature, 'plan', frameworkRoot);
  const originalReports = featurePhaseReportsDir(source, feature, 'plan', frameworkRoot);
  const original = fs.readFileSync(path.join(originalReports, fs.readdirSync(originalReports).find(file => file.startsWith('verifier.report.') && file.endsWith('.md'))!), 'utf8');
  const parsed = YAML.parse(/```yaml\s*\n([\s\S]*?)```/.exec(original)![1]);
  const finding = parsed.verification_result.checks[0];
  assert.equal(finding.id, 'reference_crosscheck');
  assert.equal(parsed.verification_result.summary.verdict, 'PASS', '原件是总PASS内的真实MAJOR FAIL');
  // The independent verifier rechecks the original finding and supplies exact current objects.
  finding.acceptance_ids = ['AC-3'];
  finding.affected_files = [blueprint, featureDir + '/change-unit.yaml'];
  const acceptanceRef = fs.existsSync(path.join(root, featureDir, 'acceptance.yaml')) ? featureDir + '/acceptance.yaml:54'
    : blueprint + ':' + (fs.readFileSync(path.join(root, blueprint), 'utf8').split('\n').findIndex(line => /id:\s*AC-3\b/.test(line)) + 1);
  const navigationLine = fs.readFileSync(path.join(root, featureDir, 'contracts.yaml'), 'utf8').split('\n').findIndex(line => line.includes('class: OpeningNavigationService')) + 1;
  finding.details = `\`${acceptanceRef}\`；\`${featureDir}/contracts.yaml:${navigationLine}-${navigationLine + 6}\`；\`${featureDir}/plan/plan.md:231\`：${finding.details}`;
  mutate?.(finding);
  return { reports, original, report: '```yaml\n' + YAML.stringify(parsed) + '```\n' };
}

export function confirm(root: string, report: string, verdict = 'confirmed') {
  const proposal = readVerifierSemanticIssues(root, feature, 'plan', report, '(current verifier)', frameworkRoot);
  assert(proposal?.rows.length);
  const text = report + '\n```issue-verification\n- issue: reference_crosscheck\n  verdict: ' + verdict
    + '\n  repair_owner: external\n  evidence: component-blueprint.yaml | ' + proposal.rows[0].summary + '\n```\n'
    + `<!-- maison-verifier-result:v1 -->\nverifier_subject_id: ${subject}\nverdict: PASS\nblocker_count: 0\n<!-- /maison-verifier-result:v1 -->\n`;
  return { proposal, text };
}

const cases: Array<{ name: string; run(root: string): void }> = [
  { name: 'current run identity reaches transferred derived acceptance in the producer and persistent disposition reader', run(root) {
    const previousRun = process.env.MAISON_GOAL_RUN_ID;
    delete process.env.MAISON_GOAL_RUN_ID;
    try {
      const acLine = fs.readFileSync(path.join(root, blueprint), 'utf8').split('\n').findIndex(line => /id:\s*AC-3\b/.test(line)) + 1;
      assert(acLine > 0);
      const data = currentFinding(root, finding => { finding.details = `\`${blueprint}:${acLine}\`：原独立发现仍须核对当前 AC-3 设计。`; });
      assert.equal(readVerifierSemanticIssues(root, feature, 'plan', data.report, '(physical artifact)', frameworkRoot)?.rows.length, 1,
        'existing physical acceptance remains a compatible source');
      for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml', 'feature.yaml', 'execution-scope.json', 'goal-runs']) {
        fs.rmSync(path.join(root, featureDir, name), { recursive: true, force: true });
      }
      const requirement = fs.readFileSync(path.join(source, 'doc/features/原始需求/1-2-银行卡/原始需求.md'), 'utf8');
      const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'request',
        requestedResults: ['plan'], requestedPhases: ['plan'], requirement, overwrite: true });
      assert.deepEqual(prepared.scope.phase_chain, ['plan']);
      freezeFeatureExecutionScope({ projectRoot: root, feature, scope: prepared.scope, candidateFingerprint: featureScopeCandidateFingerprint(root, feature) });
      const manifest = buildGoalManifestFromInput({ feature, run_id: 'semantic-reader-identity', requirement, execution_scope: prepared.scope,
        chain_override: prepared.scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root });
      createGoalRun({ projectRoot: root, manifest, chain: prepared.scope.phase_chain });
      registerFeatureScopeTransfer({ projectRoot: root, feature, runId: manifest.run_id, transferredScopeFingerprint: executionScopeFingerprint(prepared.scope) });
      assert(!resolveFeatureArtifact(root, feature, 'acceptance.yaml').exists, 'the positive case must use derived acceptance, not a materialized escape hatch');
      const reports = featurePhaseReportsDir(root, feature, 'plan', frameworkRoot);
      const currentSubject = '8'.repeat(64);
      publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: reports, feature, phase: 'plan', subjectId: currentSubject,
        reportText: data.report, skipSummaryPatch: true });
      const summaryFile = path.join(reports, 'summary.json');
      const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
      summary.verifier_subject_id = currentSubject;
      summary.verifier_report = path.relative(root, path.join(reports, verifierReportMdFilename(currentSubject))).replace(/\\/g, '/');
      fs.writeFileSync(summaryFile, JSON.stringify(summary));
      const options = { projectRoot: root, frameworkRoot, feature, phase: 'plan', runId: manifest.run_id, subjectId: currentSubject };
      assert.doesNotThrow(() => collectCurrentAcceptanceEvidence(options), 'explicit caller run identity must survive the semantic/P1 reader chain');
      assert.throws(() => collectCurrentAcceptanceEvidence({ ...options, runId: undefined }), /本次调用没有 run 身份/,
        'a truly runless call cannot borrow the transferred run from a latest/transfer guess');
      const entry = resolveCapabilityResolutionEntryInput({ purpose: 'design-authority-probe', ...options, featuresDir: 'doc/features', goalRunId: manifest.run_id });
      const resolvedInputs = resolveCapabilityInputs({ purpose: 'design-authority-probe', ...options, phase: 'plan', track: 'full', goalRunId: manifest.run_id, ...entry }).inputs!;
      const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
      const contextFiles = collectContextFiles(loader, { projectRoot: root, frameworkRoot, frameworkRel: 'framework', kind: 'consumer' }, 'plan', feature,
        loader.loadFeatureSpec(feature, resolvedInputs), { resolvedInputs, factsContext: entry.factsContext });
      assert(contextFiles.some(file => file.label === '(upstream issues to verify)' && file.content.includes('reference_crosscheck')));
      const materialInput = { projectRoot: root, frameworkRoot, feature, phase: 'plan', resolvedInputs, factsContext: entry.factsContext,
        gateFingerprint: null, phaseRuleText: '', templateText: '', checks: [], contextFiles };
      const produced = buildVerifierMaterialView(materialInput);
      assert.equal(buildVerifierMaterialView({ ...materialInput, runId: manifest.run_id }).material_sha256, produced.material_sha256,
        'producer bound context and explicit persistent caller must select the same material');
      writeVerifierMaterial(reports, currentSubject, produced);
      const current = readCurrentDispositionInput({ ...options, chain: ['plan'] });
      assert(current.phases[0].openFindings?.some(finding => finding.id === 'reference_crosscheck'), 'the transferred current finding must remain visible outside gate environment');
      assert.throws(() => readCurrentDispositionInput({ ...options, runId: undefined, chain: ['plan'] }), /本次调用没有 run 身份/);
      assert.equal(process.env.MAISON_GOAL_RUN_ID, undefined, 'the reader cannot depend on or manufacture ambient gate identity');
    } finally {
      if (previousRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = previousRun;
    }
  } },
  { name: '7d9c2e41 reports without substantive findings do not read artifact context', run(root) {
    for (const checks of [[], [{ id: 'style', status: 'PASS', severity: 'MAJOR' }], [{ id: 'style', status: 'FAIL', severity: 'MAJOR', acceptance_ids: [] }]]) {
      const report = '```yaml\n' + YAML.stringify({ verification_result: { phase: 'plan', feature, checks } }) + '```\n';
      assert.equal(readVerifierSemanticIssues(path.join(root, 'absent-project'), feature, 'plan', report, '(current)', frameworkRoot), null,
        '无实质发现时不应进入不存在工程的配置/派生验收解析');
    }
  } },
  { name: '7d9c2e41 fe4512 PASS semantic finding reaches the current subject and original design owner', run(root) {
    const data = currentFinding(root);
    const legacy = readVerifierSemanticIssues(root, feature, 'plan', data.original, '(historical)', frameworkRoot);
    assert.equal(legacy?.rows.length, 0, '历史原件不被无核实升级为派活事实');
    assert(legacy?.diagnostics?.length && findUnreadableDiagnosisChecks('plan', data.original).length,
      '历史真实发现不能静默丢弃，须回原独立verifier补核');
    const { proposal, text } = confirm(root, data.report);
    const entry = resolveCapabilityResolutionEntryInput({ purpose: 'design-authority-probe', projectRoot: root, frameworkRoot, feature, phase: 'plan', featuresDir: 'doc/features' });
    const resolvedInputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'plan', track: 'full', ...entry,
      inputContext: entry.inputContext ?? { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs;
    const material = buildVerifierMaterialView({ projectRoot: root, frameworkRoot, feature, phase: 'plan', gateFingerprint: null,
      phaseRuleText: '', templateText: '', checks: [], contextFiles: proposal.evidenceFiles, resolvedInputs });
    assert(!material.files.some(file => file.path.includes('verifier.report.')), '报告不能成为自身材料');
    writeVerifierMaterial(data.reports, subject, material);
    fs.writeFileSync(path.join(data.reports, verifierReportMdFilename(subject)), text);
    const issues = phaseIssuesForVerifierSubject(root, feature, 'plan', subject, frameworkRoot);
    assert.equal(issues?.rows.length, 1, JSON.stringify({ issues, mismatches: proposal.evidenceFiles.filter(file => material.files.find(entry => entry.path === file.label)?.sha256 !== require('crypto').createHash('sha256').update(file.content).digest('hex')).map(file => file.label) }));
    const findings = verifiedPhaseDesignFindings({ phaseIssues: issues, verifierReportText: text });
    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0].artifacts.sort(), [blueprint, featureDir + '/change-unit.yaml'].sort());
    const summary = { blockers: [], blocker_count: 0, verdict: 'PASS' } as unknown as HarnessRunSummary;
    projectDesignFindingsIntoSummary(summary, findings);
    assert.equal(summary.verdict, 'FAIL'); assert.equal(summary.completion_status, 'INCOMPLETE');
    assert.equal(summary.blockers[0].repair_owner, 'external');
    const materialEvidence = require('../../scripts/utils/verifier-material') as typeof import('../../scripts/utils/verifier-material');
    const originalConsumer = materialEvidence.verifierMaterialFileMatchesCurrent;
    try {
      materialEvidence.verifierMaterialFileMatchesCurrent = () => false;
      assert.equal(phaseIssuesForVerifierSubject(root, feature, 'plan', subject, frameworkRoot), null,
        '生产变异：关掉同版本材料摘要消费后，相同真实material必须抓住回归');
    } finally { materialEvidence.verifierMaterialFileMatchesCurrent = originalConsumer; }
    fs.appendFileSync(path.join(root, featureDir, 'acceptance.yaml'), '\n# formatting only\n');
    assert.equal(phaseIssuesForVerifierSubject(root, feature, 'plan', subject, frameworkRoot)?.rows.length, 1,
      '按既有摘要语义读取，纯注释不变成真实验收变化');
    const changed = YAML.parse(fs.readFileSync(path.join(root, featureDir, 'acceptance.yaml'), 'utf8'));
    changed.criteria[0].expected_result = 'changed actual acceptance result';
    fs.writeFileSync(path.join(root, featureDir, 'acceptance.yaml'), YAML.stringify(changed));
    assert.equal(phaseIssuesForVerifierSubject(root, feature, 'plan', subject, frameworkRoot), null,
      '材料变了，旧确认不能继续派修');
  } },
  { name: '7d9c2e41 optional MAJOR and unknown acceptance do not become mandatory repairs', run(root) {
    for (const acceptance of [[], ['AC-NOT-PRESENT']]) {
      const data = currentFinding(root, finding => { finding.acceptance_ids = acceptance; });
      const issues = readVerifierSemanticIssues(root, feature, 'plan', data.report, '(current)', frameworkRoot);
      assert.equal(issues?.rows.length ?? 0, 0);
      assert.equal(issues?.diagnostics?.length ?? 0, acceptance.length ? 1 : 0);
    }
  } },
  { name: '3bc1f4ed spec reports an unobservable acceptance result through the existing verified design-authority route', run(root) {
    const acceptance = featureDir + '/acceptance.yaml';
    const file = path.join(root, acceptance);
    const authored = YAML.parse(fs.readFileSync(file, 'utf8'));
    authored.source = 'derive.blueprint-acceptance@1';
    delete authored.criteria.find((criterion: { id: string }) => criterion.id === 'AC-4').checkpoint;
    fs.writeFileSync(file, YAML.stringify(authored));
    const [structure] = evaluateAcceptanceFlowStructure(root, feature);
    assert.equal(structure.status, 'FAIL');
    assert.match(structure.details ?? '', /AC-4/);
    const eligibility = canProduceVerifierRequest({ planMode: 'enabled', phase: 'spec', scriptVerdict: 'FAIL', checks: [structure],
      reportValidity: 'PASS', hasBlockedCapability: false });
    assert.equal(eligibility.kind, 'repair_diagnosis');
    const original = fs.readFileSync(path.join(root, blueprint), 'utf8');
    const line = original.split('\n').findIndex(row => /id:\s*AC-4\b/.test(row)) + 1;
    assert(line > 0);
    const report = '```yaml\n' + YAML.stringify({ verification_result: { phase: 'spec', feature, checks: [{
      id: 'acceptance_testable', status: 'FAIL', severity: 'BLOCKER', acceptance_ids: ['AC-4'],
      affected_files: [blueprint, acceptance],
      details: '`' + blueprint + ':' + line + '`：结果页的可见断言能证明到达与展示，读不到原验收要求的实际持久化值。',
      suggestion: '设计 owner 保留原结果，交能查询实际记录的应用内测试；界面结果保留设备断言。',
    }] } }) + '```\n';
    const proposal = readVerifierSemanticIssues(root, feature, 'spec', report, '(spec verifier)', frameworkRoot);
    assert.equal(proposal?.rows.length, 1);
    const body = (owner: string) => report + '\n```issue-verification\n' + YAML.stringify([{
      issue: 'acceptance_testable', verdict: 'confirmed', repair_owner: owner,
      evidence: 'component-blueprint.yaml acceptance.yaml | ' + proposal!.rows[0].summary,
    }]) + '```\n';
    const reports = featurePhaseReportsDir(root, feature, 'spec', frameworkRoot);
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify({ report_validity: 'PASS' }));
    const material = buildVerifierMaterialView({ projectRoot: root, frameworkRoot, feature, phase: 'spec', gateFingerprint: null,
      phaseRuleText: '', templateText: '', checks: [], contextFiles: proposal!.evidenceFiles });
    writeVerifierMaterial(reports, subject, material);
    const publish = (owner: string) => publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: reports, feature,
      phase: 'spec', subjectId: subject, verdict: 'FAIL', reportText: body(owner) });
    publish('spec');
    assert.deepEqual(readVerifiedPhaseDesignFindings(root, frameworkRoot, feature, 'spec'), []);
    publish('external');
    const findings = readVerifiedPhaseDesignFindings(root, frameworkRoot, feature, 'spec');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].check, 'spec:acceptance_testable');
    assert.deepEqual(findings[0].artifacts, [blueprint]);
    const summary = { blockers: [], blocker_count: 0, verdict: 'PASS' } as unknown as HarnessRunSummary;
    projectDesignFindingsIntoSummary(summary, findings);
    assert.equal(summary.blockers[0].repair_owner, 'external');
  } },
  { name: '7d9c2e41 existing material digest accepts original and identity-only CU but rejects real design change', run(root) {
    const resolvedInputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'plan', track: 'full',
      inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs;
    const material = buildVerifierMaterialView({ projectRoot: root, frameworkRoot, feature, phase: 'plan', gateFingerprint: null,
      phaseRuleText: '', templateText: '', checks: [], contextFiles: [], resolvedInputs });
    const file = featureDir + '/change-unit.yaml', absolute = path.join(root, file), original = fs.readFileSync(absolute);
    const recorded = material.files.find(entry => entry.path === file)!;
    const rawOriginal = require('crypto').createHash('sha256').update(original).digest('hex');
    const legacyRaw = { ...material, schema: 'maison-verifier-material@1', files: material.files.map(entry => entry.path === file ? { ...entry, sha256: rawOriginal } : entry) };
    assert(verifierMaterialFileMatchesCurrent({ projectRoot: root, feature, material: legacyRaw, file }), 'the @1 raw diagnosis recipe retains exact historical bytes');
    assert(!verifierMaterialFileMatchesCurrent({ projectRoot: root, feature, material: { ...legacyRaw, schema: material.schema }, file }), '@2 cannot reinterpret a CU raw digest as its declared neutral projection');
    const rows: Array<{ change: string; raw: boolean; materialSemantic: boolean }> = [];
    const observe = (change: string): void => {
      const entry = { ...recorded, role: 'input' as const, exists: true };
      rows.push({ change, raw: evidenceEntryMatchesCurrentFile(root, entry, feature),
        materialSemantic: evidenceEntryMatchesCurrentFile(root, { ...entry, identity_neutral: IDENTITY_NEUTRAL_EVIDENCE }, feature) });
    };
    try {
      observe('original');
      const identityOnly = YAML.parse(original.toString('utf8')); identityOnly.revision++;
      fs.writeFileSync(absolute, YAML.stringify(identityOnly)); observe('identity_only');
      identityOnly.target_predicates[0].description = '倒计时重发门禁改为120秒';
      fs.writeFileSync(absolute, YAML.stringify(identityOnly)); observe('real_design');
      assert.deepEqual(rows.map(row => row.materialSemantic), [true, true, false]);
      console.log('[material-digest-comparison]', JSON.stringify(rows));
    } finally { fs.writeFileSync(absolute, original); }
  } },
  { name: '7d9c2e41 confirmed/refuted/unclear remain one independent issue-verification contract', run(root) {
    const data = currentFinding(root);
    for (const verdict of ['confirmed', 'refuted', 'unclear']) {
      const { proposal, text } = confirm(root, data.report, verdict);
      assert.equal(verifiedPhaseRepairIssues({ phaseIssues: proposal, verifierReportText: text }).length, verdict === 'confirmed' ? 1 : 0);
      assert.equal(verifiedPhaseDesignFindings({ phaseIssues: proposal, verifierReportText: text.replace('repair_owner: external', 'repair_owner: coding') }).length, 0,
        '修复对象是蓝图/CU，不能交当前实现者自批');
    }
  } },
  { name: '7d9c2e41 a mandatory finding with an unreadable target returns to verification instead of disappearing', run(root) {
    const data = currentFinding(root, finding => { finding.affected_files = ['doc/missing-design.yaml']; });
    const issues = readVerifierSemanticIssues(root, feature, 'plan', data.report, '(current)', frameworkRoot);
    assert.equal(issues?.rows.length, 0);
    assert(issues?.diagnostics?.some(message => message.includes('目标不可读取')));
    assert(findUnreadableDiagnosisChecks('plan', data.report, { reportText: data.report, rows: issues!.rows, diagnostics: issues!.diagnostics }).length,
      '已声明必需义务但目标不明，须补核而非让总PASS吞掉该发现');
  } },
  { name: '7d9c2e41 a carried subject cannot override a recorded refusal without current review', run(root) {
    const data = currentFinding(root);
    const { proposal, text } = confirm(root, data.report);
    const issue = { ...proposal.rows[0], source_phase: 'plan' };
    assert.equal(verifiedPhaseRepairIssues({ phaseIssues: proposal, verifierReportText: text,
      declinedIssues: [issue], verifierSubjectCurrent: false }).length, 0, '旧subject未核实当前拒修依据');
    assert.equal(verifiedPhaseRepairIssues({ phaseIssues: proposal, verifierReportText: text,
      declinedIssues: [issue], verifierSubjectCurrent: true }).length, 1);
  } },
];

export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [];
  for (const test of cases.filter(item => selector === undefined || item.name.includes(selector))) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-semantic-'));
    try { fs.cpSync(source, root, { recursive: true }); test.run(root); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
    finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  }
  return { results, matchedCaseCount: results.length, executionTimings: [] };
}
export const runAll = async () => (await runSelectedCases()).results;
