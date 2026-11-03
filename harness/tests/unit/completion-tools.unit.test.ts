import { unitCaseGroups } from '../utils/unit-case-selection';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Module } from 'module';
import * as ts from 'typescript';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { fixture, recordInvocation, UT_BASELINE_TEST } from './standalone-coding-review.unit.test';
import { checkCodingExistingTestPreserved } from '../../scripts/check-coding';
import { clearFrameworkConfigCache, featurePhaseReportsDir, featureFilePath, resolveFeatureArtifact } from '../../config';
import { loadWorkflowSpec } from '../../workflow-loader';
import { assembleAIPrompt, generateScriptReport, loadVerifierPromptTemplate } from '../../scripts/utils/report-generator';
import { buildVerifierMaterialView, collectTestStrengthContext, verifierMaterialFileMatchesCurrent } from '../../scripts/utils/verifier-material';
import { loadVerifierEvidence } from '../../scripts/utils/verifier-evidence';
import { canProduceVerifierRequest, resolveVerifierPlan, workflowVerifierPrompt } from '../../scripts/utils/verifier-plan';
import { writeRunSummaryBase } from '../../harness-runner';
import { loadPhaseEvidenceManifest, resolvePhaseEvidenceManifest, writePhaseEvidenceManifest, sha256File } from '../../scripts/utils/phase-evidence-manifest';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import { applicableCheckFamilies, currentCompletionEvaluation, completionProgressFromHistory, readCurrentDispositionInput, readReusableCheckResult, shouldGenerateFeatureCompletion } from '../../scripts/utils/verify-feature-completion';
import { resolveCurrentDisposition, phaseCompletionProblems } from '../../scripts/utils/check-disposition';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { finalizePhaseClosure, executedEvidenceInputs } from '../../scripts/utils/phase-closure-finalizer';
import { ensureRunControl, casAcquireRunOwner } from '../../scripts/utils/goal-run-control';
import { createWorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { issueSessionExecution, sessionEvents } from '../../scripts/utils/session-execution-handoff';
import { resolvePhaseWriteBoundary, capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots, classifyPhaseInvocationChanges } from '../../scripts/utils/phase-write-boundary';
import { provisionFrameworkUnder } from '../utils/real-chain-host';
import { validateAttendedGoalContext } from '../../scripts/utils/attended-goal-context';
import { loadFactsInvocationContext, resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { researchSnapshotFacts } from '../fixtures/host-snapshot-3.1.0/migrate';
import { setupGoalRuntimeHost, writeVisualDiff, runRealVisualGate, FEATURE as VISUAL_FEATURE, PRODUCT_FILE } from './goal-runner-testing-integrity.unit.test';
import { collectActionableDefects } from '../../scripts/goal-phase-runtime';
import { actionableDefectsToCandidates, mergeRepairCandidatesIntoSummary } from '../../scripts/utils/repair-candidates';
import { resolveRepairResponsibility } from '../../scripts/utils/repair-responsibility';
import { executionScopeFingerprint, type ExecutionScope } from '../../scripts/utils/execution-scope';
import { resolveCurrentScopeView } from '../../scripts/utils/feature-track';
import { SCOPE_REVISION_FIELDS } from '../../scripts/utils/goal-manifest';
import { computeDefectFingerprint } from '../../../profiles/hmos-app/harness/visual-diff-check';
import { resolveEffectiveScopeSource } from '../../scripts/utils/goal-run-creation';
import type { IssueVerificationVerdict } from '../../scripts/utils/repair-candidates';
import type { CheckResult } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');

async function withCurrentStrength(mode: 'strengthened' | 'weakened' | 'preserved', run: (current: ReturnType<typeof prepare>) => void | Promise<void>, publicCli = false) {
  const f = fixture(false, true, [], 'make value 42', publicCli ? 'generic' : undefined), previous = process.env.MAISON_GOAL_RUN_ID;
  process.env.MAISON_GOAL_RUN_ID = f.manifest.run_id;
  try {
    const original = fs.readFileSync(path.join(f.root, UT_BASELINE_TEST), 'utf8');
    recordInvocation(f, 'coding', () => {
      f.write('src/demo/value.ts', 'export const value: number = 42;\n');
      const module = path.relative(path.dirname(UT_BASELINE_TEST), 'src/demo/value').replace(/\\/g, '/');
      const test = mode === 'strengthened' ? `import { value } from '${module}';\n`
        + original.replace('expect(1).assertEqual(1);', 'expect(1).assertEqual(1); expect(value).assertEqual(42);')
        : mode === 'weakened' ? original.replace('expect(1).assertEqual(1);', '') : 'const actualFixtureInput = 42;\n' + original;
      f.write(UT_BASELINE_TEST, test);
    }, undefined, 'author');
    f.facts(); await run(prepare(f));
  } finally {
    if (previous === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = previous;
    clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true });
  }
}

/** Same real producer/assembler/writer fixture as the already-tested request path, now consumed by the public completion reader. */
function prepare(f: ReturnType<typeof fixture>) {
  const ctx = f.context('coding'), check = checkCodingExistingTestPreserved(ctx)[0];
  assert(check.affected_files?.includes(UT_BASELINE_TEST)); assert.equal(check.repair_owner, undefined);
  const plan = resolveVerifierPlan({ phase: 'coding', track: 'full', runtimeMode: 'goal', policy: { verifier: 'required' },
    workflowVerifierPrompt: workflowVerifierPrompt(loadWorkflowSpec(FRAMEWORK_ROOT, 'obligation-driven'), 'coding'), adapterHasVerifierSubagent: true });
  const codingFile = path.join(FRAMEWORK_ROOT, 'harness/scripts/check-coding.ts');
  const producer = new Module(codingFile, module);
  producer.filename = codingFile;
  (producer as unknown as { paths: string[] }).paths = (module as unknown as { paths: string[] }).paths;
  (producer as unknown as { _compile(code: string, file: string): void })._compile(ts.transpileModule(fs.readFileSync(codingFile, 'utf8')
    + '\nexports.__aggregate = buildCodingRunStatusResult;\n', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, codingFile);
  const aggregate = (producer.exports as { __aggregate(context: typeof ctx, checks: typeof check[]): typeof check }).__aggregate(ctx, [check]);
  const report = generateScriptReport(path.join(FRAMEWORK_ROOT, 'harness'), 'coding', 'demo', f.root, [check, aggregate], FRAMEWORK_ROOT);
  const eligibility = canProduceVerifierRequest({ planMode: plan.mode, phase: 'coding', scriptVerdict: report.summary.verdict,
    checks: report.checks, reportValidity: 'UNVERIFIED', hasBlockedCapability: false });
  assert(eligibility.allowed, JSON.stringify(eligibility));
  const contextFiles = collectTestStrengthContext({ projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase: 'coding',
    runId: f.manifest.run_id, resolvedInputs: ctx.resolvedInputs, factsContext: ctx.factsContext });
  const phaseRuleText = YAML.stringify(ctx.phaseRule);
  assembleAIPrompt(path.join(FRAMEWORK_ROOT, 'harness'), f.root, 'coding', 'demo', contextFiles, JSON.stringify(report), phaseRuleText,
    undefined, undefined, FRAMEWORK_ROOT, { verifierPromptRel: plan.verifier_prompt!, ...(eligibility.kind === 'repair_diagnosis'
      ? { repairDiagnosis: { failedCheckIds: eligibility.diagnosticCheckIds, reason: eligibility.reason } } : {}) });
  const materialInput = { projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase: 'coding',
    runId: f.manifest.run_id, resolvedInputs: ctx.resolvedInputs, factsContext: ctx.factsContext, gateFingerprint: null, checks: report.checks, contextFiles,
    phaseRuleText, templateText: loadVerifierPromptTemplate(path.join(FRAMEWORK_ROOT, 'harness'), 'coding', undefined, plan.verifier_prompt!) };
  const material = buildVerifierMaterialView(materialInput);
  const summary = writeRunSummaryBase(f.root, report, FRAMEWORK_ROOT, { verifierPlan: plan, verifierMaterial: material,
    resolvedInputs: ctx.resolvedInputs, factsContext: ctx.factsContext });
  assert(summary.verifier_request && summary.verifier_subject_id, 'the actual producer must issue a current request');
  const dir = featurePhaseReportsDir(f.root, 'demo', 'coding', FRAMEWORK_ROOT);
  writePhaseEvidenceManifest(f.root, resolvePhaseEvidenceManifest({ projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase: 'coding',
    resolvedInputs: ctx.resolvedInputs, factsContext: ctx.factsContext, requirementSha: computeRunRequirementSha(f.root, 'demo', f.manifest.run_id),
    extraOutputs: ['script-report.json', 'summary.json'].map(name => path.join(dir, name)).concat(path.join(f.root, UT_BASELINE_TEST)) }));
  const raw = fs.readFileSync(path.join(dir, 'script-report.json'), 'utf8');
  const options = { projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', chain: ['coding'], runId: f.manifest.run_id,
    endpoint: 'request' as const, resolvedInputs: ctx.resolvedInputs, authority: f.manifest.unattended };
  const read = () => resolveCurrentDisposition(readCurrentDispositionInput(options));
  const publish = (verdict: IssueVerificationVerdict) => {
    const reportText = '```issue-verification\n' + YAML.stringify([{ issue: check.id, verdict,
      evidence: `${check.details}\n${check.affected_files!.join('\n')}\n独立读取当前AC-1、实际value与测试源码；${verdict === 'refuted' ? '新增value=42真实业务断言是合理加强，当前授权期望没有被削弱。' : verdict === 'confirmed' ? '既有断言被删除，当前测试不能充分证明原验收，必须由当前作者修复。' : '尚缺可信失败路径原件，保持未知。'}` }]) + '```';
    publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: dir, feature: 'demo', phase: 'coding', subjectId: summary.verifier_subject_id, reportText, skipSummaryPatch: true });
    const loaded = loadVerifierEvidence(f.root, 'demo', 'coding', { frameworkRoot: FRAMEWORK_ROOT, resolvedInputs: ctx.resolvedInputs });
    assert(loaded.ok, JSON.stringify(loaded));
  };
  return { f, ctx, check, report, summary, dir, raw, read, publish, options, material, materialInput, plan };
}

const cases = [
  { name: 'P2 two verified visual objects on one screen survive current-reader dedup; partial repair continues and unchanged author return stops', run() {
    const { root } = setupGoalRuntimeHost('codex');
    const feature = VISUAL_FEATURE, screen = 'add_card_home';
    const signals = [
      { class: 'shape_mismatch', element: 'hc_page_title', bbox: [0.1, 0.2, 0.3, 0.4], severity: 'major', note: '标题错位', must_fix_refs: [0] },
      { class: 'shape_mismatch', element: 'hc_bank_logo', bbox: [0.5, 0.6, 0.2, 0.2], severity: 'major', note: 'logo 错位', must_fix_refs: [0] },
    ];
    try {
      fs.writeFileSync(featureFilePath(root, feature, 'spec/spec.md'), '# spec\n```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(resolveFeatureArtifact(root, feature, 'ui-spec.yaml').canonicalPath, JSON.stringify({ schema_version: '1.0', verified: 'unverified', assets: [], tokens: {},
        screens: [{ id: screen, priority: 'P0', ref_id: screen, root: { id: 'home_root', type: 'navigation_frame', order: 0,
          children: signals.map((signal, order) => ({ id: signal.element, type: 'interactive', order })) } }] }));
      const produce = (remaining: typeof signals) => {
        writeVisualDiff(root, [{ id: screen, verdict: 'warn', mustFix: remaining.map(signal => signal.note),
          defects: remaining.map((signal, index) => ({ ...signal, must_fix_refs: [index] })) }]);
        const diffFile = featureFilePath(root, feature, 'device-testing/device-screenshots/visual-diff.json');
        const original = JSON.parse(fs.readFileSync(diffFile, 'utf8'));
        Object.assign(original, { schema_version: '1.1', feature });
        Object.assign(original.screens[0], { ref_id: screen, reverse_missing: [], region_attest: signals.map(signal => ({
          region: signal.element, verdict: remaining.some(item => item.element === signal.element) ? 'diff_logged' : 'no_diff', method: 'vl_screening' })) });
        fs.writeFileSync(diffFile, JSON.stringify(original, null, 2));
        fs.writeFileSync(featureFilePath(root, feature, 'testing/test-report.md'), '# 测试报告\n\n```defect-review\n'
          + YAML.stringify(remaining.map(signal => ({ signal: computeDefectFingerprint(screen, signal as Parameters<typeof computeDefectFingerprint>[1]),
            verdict: 'confirmed', rationale: '独立读取当前截图与对应元素，确认本例有限视觉缺陷。' }))) + '```\n');
        const gate = runRealVisualGate(root, feature, { fidelityTarget: 'pixel_1to1', acceptanceStrictness: 'hard' });
        const collected = collectActionableDefects(root, feature, 'visual-reader');
        assert.equal(collected.unverified.length, 0, JSON.stringify(collected));
        assert.equal(collected.defects.length, remaining.length, JSON.stringify(collected));
        const responsibility = { projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature, currentPhase: 'testing' };
        const candidates = actionableDefectsToCandidates(collected.defects, 'testing', responsibility);
        const bytes = fs.readFileSync(diffFile);
        const actualFileCheck: CheckResult = { id: 'file_completeness', category: 'structure', description: '当前有限视觉原件已读取', severity: 'BLOCKER',
          status: bytes.length ? 'PASS' : 'FAIL', details: `${bytes.length} actual visual evidence bytes`, affected_files: [path.relative(root, diffFile)] };
        const script = generateScriptReport(path.join(FRAMEWORK_ROOT, 'harness'), 'testing', feature, root, [actualFileCheck, gate], FRAMEWORK_ROOT);
        writeRunSummaryBase(root, script, FRAMEWORK_ROOT);
        const dir = featurePhaseReportsDir(root, feature, 'testing', FRAMEWORK_ROOT), summaryPath = path.join(dir, 'summary.json');
        mergeRepairCandidatesIntoSummary({ summaryPath, candidates });
        mergeRepairCandidatesIntoSummary({ summaryPath, candidates });
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature, phase: 'testing',
          extraInputs: [PRODUCT_FILE], extraOutputs: [path.join(dir, 'script-report.json'), summaryPath] }));
        const options = { projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature, chain: ['testing'],
          currentResults: [{ phase: 'testing', summary, checks: script.checks }] };
        const disposition = resolveCurrentDisposition(readCurrentDispositionInput(options));
        const findings = disposition.completionBlocking.filter(problem => problem.id === `open_finding:visual_diff:${screen}`);
        assert.equal(findings.length, remaining.length, JSON.stringify(disposition));
        assert.equal(new Set(findings.flatMap(finding => finding.evidence ?? [])).size, remaining.length,
          'the reader keeps distinct native visual references and reads the same object only once');
        for (const candidate of candidates) {
          const context = { ...responsibility, currentDisposition: disposition, target: candidate };
          assert.equal(resolveRepairResponsibility(context).action, 'current', 'each verified visual object retains its own current-unit investigation');
          assert.equal(resolveRepairResponsibility({ ...context, target: { ...candidate, item_fingerprint: '0'.repeat(64) } }).action, 'unavailable');
          assert.equal(resolveRepairResponsibility({ ...context, target: { ...candidate, item_fingerprint: undefined } }).action, 'unavailable',
            'a shared screen label cannot choose an object without its original fingerprint');
          const withoutRefs = { ...disposition, problems: disposition.problems.map(problem => ({ ...problem, evidence: [] })) };
          assert.equal(resolveRepairResponsibility({ ...context, currentDisposition: withoutRefs }).action, 'unavailable', 'a label cannot replace the actual native object reference');
          const verify = { ...disposition, problems: disposition.problems.map(problem => ({ ...problem, action: 'verify' as const })) };
          assert.equal(resolveRepairResponsibility({ ...context, currentDisposition: verify }).action, 'unavailable', 'object identity never turns verification into author write permission');
        }
        const evaluation = currentCompletionEvaluation(options, disposition);
        assert(evaluation.completed, JSON.stringify(evaluation));
        return evaluation;
      };
      assert(resolveEffectiveScopeSource(root, feature)?.scope, 'the actual fixture has its canonical frozen unit scope');
      const both = produce(signals);
      fs.appendFileSync(path.join(root, PRODUCT_FILE), '\n// actual controlled repair of logo Y\n');
      fs.appendFileSync(path.join(root, 'build/default/app.hap'), '\ncontrolled rebuilt logo Y\n');
      const partial = produce([signals[0]]);
      assert.equal(both.acceptanceKey, partial.acceptanceKey, 'repairing a candidate does not replace the accepted target');
      assert.equal(completionProgressFromHistory(partial, [both], true, true).halt, false, 'two actual objects becoming one is progress');
      const same = produce([signals[0]]);
      assert.equal(completionProgressFromHistory(same, [partial], true, false).reused, true, 'a repeated tool result does not manufacture an author opportunity');
      assert.equal(completionProgressFromHistory(same, [both, partial], true, true).halt, true,
        'a full unchanged author handback after actual feedback retains the shared I10 guard');
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  } },
  { name: 'P2 process gate observes the complete real result across large UTF8 chunks and final lines; a diagnostic tail cannot certify it',
    async run() { await withCurrentStrength('strengthened', async current => {
      current.publish('refuted');
      const bound = readReusableCheckResult({ ...current.options, phase: 'coding' });
      assert(bound);
      const original = { phase: 'coding', evaluation: currentCompletionEvaluation({ ...current.options, currentResults: [bound] }, current.read()) };
      assert(original.evaluation.completed, 'transport must carry an actual completed producer/reader result');
      const marker = 'current_check_result=' + JSON.stringify(original) + ' '.repeat(9_000);
      const bytes = Buffer.from(marker, 'utf8'), splitAt = bytes.findIndex(byte => byte >= 0xe0 && byte <= 0xef);
      assert(splitAt >= 0, 'the actual Chinese finding supplies a real multibyte boundary');
      const framework = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-marker-framework-'));
      const harness = path.join(framework, 'harness'); fs.mkdirSync(harness);
      fs.copyFileSync(path.join(FRAMEWORK_ROOT, 'harness/tsconfig.json'), path.join(harness, 'tsconfig.json'));
      const file = path.join(FRAMEWORK_ROOT, 'harness/scripts/goal-phase-runtime.ts');
      // Existing artifact-content test seam: expose only in this in-memory module, not the product API.
      const runtime = new Module(file, module);
      runtime.filename = file;
      (runtime as unknown as { paths: string[] }).paths = (Module as unknown as { _nodeModulePaths(dir: string): string[] })._nodeModulePaths(path.dirname(file));
      (runtime as unknown as { _compile(source: string, file: string): void })._compile(ts.transpileModule(
        fs.readFileSync(file, 'utf8') + '\nexports.__gateReceiverProbe = runHarnessPhase;\n',
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
      const runGate = (runtime.exports as { __gateReceiverProbe: (root: string, framework: string, phase: string, feature: string,
        dryRun: boolean, manifest: undefined, identity: undefined, timeout: number) => Promise<{ exitCode: number; timedOut: boolean; outputTail: string; currentCheckObserved: boolean }> }).__gateReceiverProbe;
      try {
        for (const mode of ['newline', 'final-line', 'tail-only'] as const) {
          fs.writeFileSync(path.join(harness, 'harness-runner.ts'), `const bytes=Buffer.from(${JSON.stringify(bytes.toString('base64'))},'base64');
const chunks=${mode === 'tail-only' ? "[bytes.subarray(-8000)]" : `[bytes.subarray(0,${splitAt + 1}),bytes.subarray(${splitAt + 1},${splitAt + 2}),bytes.subarray(${splitAt + 2})]`};
let i=0;const emit=()=>{if(i<chunks.length){process.stdout.write(chunks[i++]);setTimeout(emit,25);return;}
${mode === 'final-line' ? '' : "process.stdout.write('\\n');"}
process.stderr.write('diagnostic tail\\n'+'x'.repeat(9000));};emit();
`);
          const result = await runGate(current.f.root, framework, 'coding', 'demo', false, undefined, undefined, 10_000);
          assert.equal(result.exitCode, 0); assert.equal(result.timedOut, false);
          assert(!result.outputTail.includes('current_check_result='), 'the old diagnostic tail cannot retain this result');
          assert.equal(result.currentCheckObserved, mode !== 'tail-only', mode);
        }
      } finally { fs.rmSync(framework, { recursive: true, force: true }); }
    }); } },
  { name: 'P2 registered facts keep a verified coding subject current across review research while baseline and own facts require re-verification',
    async run() {
      await withCurrentStrength('strengthened', current => {
        current.publish('refuted');
        const f = current.f, relative = 'doc/features/demo/context/facts.md', facts = path.join(f.root, relative);
        const before = fs.readFileSync(facts, 'utf8');
        const originalReport = loadVerifierEvidence(f.root, 'demo', 'coding', { frameworkRoot: FRAMEWORK_ROOT, resolvedInputs: current.ctx.resolvedInputs });
        assert(originalReport.ok, JSON.stringify(originalReport)); if (!originalReport.ok) return;
        const independentBytes = fs.readFileSync(originalReport.evidence.md_path_abs);
        const manifest = loadPhaseEvidenceManifest(f.root, 'demo', 'coding'); assert(manifest?.integrityOk);
        const entry = [...manifest.manifest.inputs, ...manifest.manifest.outputs].find(entry => entry.path === relative);
        assert.equal(entry?.facts_phase, 'coding', 'the real manifest must register this as typed facts rather than a filename convention');
        assert.equal(current.material.files.find(file => file.path === relative)?.sha256, entry?.sha256, 'producer material and original manifest use the same facts recipe');
        const review = f.context('review'); assert(review.factsContext);
        const crossFamily = () => resolveCurrentDisposition(readCurrentDispositionInput({ ...current.options, chain: ['coding', 'review'], resolvedInputs: review.resolvedInputs }));
        const codingPending = () => crossFamily().completionBlocking.some(problem => problem.phase === 'coding' && problem.id === 'attestation_present');
        assert(!codingPending(), 'the actual published independent result must be usable before later investigation');
        researchSnapshotFacts(f.root, facts, 'review', review.factsContext);
        const investigated = fs.readFileSync(facts, 'utf8');
        assert.notEqual(investigated, before, 'the actual review research helper must append its own valid section');
        assert.equal(buildVerifierMaterialView(current.materialInput).material_sha256, current.material.material_sha256, 'another family section does not buy a new coding subject');
        assert(verifierMaterialFileMatchesCurrent({ projectRoot: f.root, feature: 'demo', material: current.material, file: relative }));
        assert(verifierMaterialFileMatchesCurrent({ projectRoot: f.root, feature: 'demo', material: { ...current.material, schema: 'maison-verifier-material@1' }, file: relative }), 'the original @1 manifest entry.sha contract keeps its typed facts capability');
        assert(!codingPending(), 'a cross-family actual reader cannot discard the already verified coding result for review-only research');
        assert.equal(JSON.parse(fs.readFileSync(path.join(current.dir, 'summary.json'), 'utf8')).verifier_subject_id, current.summary.verifier_subject_id);
        for (const changed of [investigated.replace('value is initialized', 'current source initializes value to 42'),
          investigated + '\n## phase_delta: coding\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| src/demo/value.ts | 当前源码导出 value: number = 42 | 独立核对原验收 |\n']) {
          fs.writeFileSync(facts, changed); assert.notEqual(changed, investigated);
          assert(codingPending(), 'baseline or this family actual facts must invalidate the old independent conclusion');
          const next = buildVerifierMaterialView(current.materialInput);
          assert.notEqual(next.material_sha256, current.material.material_sha256, 'affected facts require genuinely new material');
          const issued = writeRunSummaryBase(f.root, current.report, FRAMEWORK_ROOT, { verifierPlan: current.plan, verifierMaterial: next,
            resolvedInputs: current.ctx.resolvedInputs, factsContext: current.ctx.factsContext });
          assert.notEqual(issued.verifier_subject_id, current.summary.verifier_subject_id, 'the actual writer must issue the affected material for verification');
          fs.writeFileSync(facts, investigated);
          writeRunSummaryBase(f.root, current.report, FRAMEWORK_ROOT, { verifierPlan: current.plan, verifierMaterial: current.material,
            resolvedInputs: current.ctx.resolvedInputs, factsContext: current.ctx.factsContext });
        }
        assert(fs.readFileSync(originalReport.evidence.md_path_abs).equals(independentBytes), 're-verification never rewrites the accepted independent original');
        assert.equal(fs.readFileSync(path.join(current.dir, 'script-report.json'), 'utf8'), current.raw, 'the raw comparison FAIL remains the original executed fact');
      });
    } },
  { name: 'P2 review R1 public CLI cached exit follows current verified work and preserves raw FAIL or PASS originals',
    async run() {
      for (const scenario of ['refuted', 'missing', 'unclear', 'confirmed', 'unrestored'] as const) {
        await withCurrentStrength(scenario === 'refuted' ? 'strengthened' : scenario === 'confirmed' ? 'weakened' : 'preserved', current => {
          if (scenario !== 'missing') current.publish(scenario === 'unrestored' ? 'refuted' : scenario);
          const f = current.f, released = provisionFrameworkUnder(f.root), runDir = path.join(f.root, f.manifest.report_dir);
          ensureRunControl(runDir, f.manifest.run_id);
          const acquired = casAcquireRunOwner(runDir, f.manifest.run_id, 0, { kind: 'session', owner_id: 'cached-cli-author', lease_ms: 60_000 });
          assert(acquired.ok); if (!acquired.ok) throw new Error(JSON.stringify(acquired));
          const attemptId = 'cached-family-check', invokeId = `coding-${attemptId}`;
          const context = createWorkUnitExecutionContext({ runId: f.manifest.run_id, feature: 'demo', workflowId: 'obligation-driven', track: 'full',
            chain: f.manifest.phase_chain ?? ['coding'], phase: 'coding', attemptId, owner: { ...acquired.token, kind: 'session' },
            projectRoot: f.root, frameworkRoot: released.frameworkRoot, runDir, reportDir: f.manifest.report_dir, adapter: 'generic',
            authority: f.manifest.unattended, factsContext: current.ctx.factsContext, instruction: '读取当前已执行检查及独立核验原件，不改原始结论。',
            runtimeFacts: { receiptRequired: true, resume: false, successor: false },
            childEnv: { MAISON_GOAL_RUN_ID: f.manifest.run_id, MAISON_GOAL_ATTEMPT: attemptId, MAISON_GOAL_ATTEMPT_PHASE: 'coding' } });
          const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
          emit({ type: 'agent_invoke_start', phase: 'coding', invoke_id: invokeId, attempt_id: attemptId,
            owner_id: acquired.token.owner_id, owner_epoch: acquired.token.epoch, facts_context: current.ctx.factsContext });
          const boundary = resolvePhaseWriteBoundary({ projectRoot: f.root, frameworkRoot: released.frameworkRoot, feature: 'demo', runId: f.manifest.run_id,
            phaseOrder: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], track: 'full', executionRole: 'author', productLayerDirs: ['src'], profileDir: f.profileDir });
          const before = capturePhaseInvocationSnapshot(boundary);
          const issued = issueSessionExecution({ context, invokeId, emit, gateTimeoutMs: 30_000, cleanupReserveMs: 500,
            preSnapshot: before, writeBoundary: boundary });
          if (scenario === 'unrestored') {
            fs.writeFileSync(path.join(released.frameworkRoot, 'README.md'), 'actual unauthorized author write, still unrestored');
            const diff = diffPhaseInvocationSnapshots(before, capturePhaseInvocationSnapshot(boundary));
            assert.equal(diff.kind, 'changed'); if (diff.kind !== 'changed') throw new Error('missing real framework write');
            const writes = classifyPhaseInvocationChanges(boundary, 'coding', diff.changes);
            assert(writes.violations.some(row => row.path === 'framework/README.md'));
            emit({ type: 'phase_write_violation', phase: 'coding', invoke_id: invokeId,
              violations: writes.violations.map(row => ({ path: row.path, violation: row.violation, pre_sha256: row.preSha256, post_sha256: row.postSha256 })) });
          }
          const old = Object.fromEntries(Object.keys(issued.request.context.childEnv).map(key => [key, process.env[key]]));
          let bridge: ReturnType<typeof resolveCapabilityResolutionEntryInput>, resolved: ReturnType<typeof resolveCapabilityInputs>;
          try {
            Object.assign(process.env, issued.request.context.childEnv);
            bridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot: released.frameworkRoot, feature: 'demo', phase: 'coding',
              featuresDir: 'doc/features', goalRunId: f.manifest.run_id, goalAttemptId: attemptId });
            resolved = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot: released.frameworkRoot, feature: 'demo', phase: 'coding', track: 'full', ...bridge });
          } finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
          const bound = loadPhaseEvidenceManifest(f.root, 'demo', 'coding'); assert(bound); assert(bound.manifest);
          // The release layout changes input selection; bind the unchanged originals through the actual public resolver/writer.
          writePhaseEvidenceManifest(f.root, resolvePhaseEvidenceManifest({ projectRoot: f.root, frameworkRoot: released.frameworkRoot, feature: 'demo', phase: 'coding',
            resolvedInputs: resolved.inputs, factsContext: bridge.factsContext, requirementSha: computeRunRequirementSha(f.root, 'demo', f.manifest.run_id),
            extraInputs: bound.manifest.inputs.map(row => row.path), extraOutputs: bound.manifest.outputs.map(row => row.path) }));
          assert(readReusableCheckResult({ projectRoot: f.root, frameworkRoot: released.frameworkRoot, feature: 'demo', phase: 'coding', runId: f.manifest.run_id,
            resolvedInputs: resolved.inputs, factsContext: bridge.factsContext }), `${scenario}: the public call must exercise a real cache hit`);
          const originals = ['script-report.json', 'summary.json'].map(name => [path.join(current.dir, name), fs.readFileSync(path.join(current.dir, name), 'utf8')] as const);
          const cli = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(FRAMEWORK_ROOT, 'harness/harness-runner.ts'),
            '--project-root', f.root, '--framework-root', released.frameworkRoot, '--feature', 'demo', '--phase', 'coding',
            '--goal-run-id', context.runId, '--goal-attempt-id', attemptId, '--goal-owner-id', context.owner.owner_id, '--goal-owner-epoch', String(context.owner.epoch)],
          { cwd: f.root, windowsHide: true, timeout: 30_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, ...issued.request.context.childEnv, TS_NODE_PROJECT: path.join(FRAMEWORK_ROOT, 'harness/tsconfig.json') } });
          const diagnostic = JSON.stringify({ scenario, status: cli.status, error: cli.error?.message, stdout: cli.stdout, stderr: cli.stderr });
          assert(cli.stdout.includes('CHECK_RESULT reused='), diagnostic);
          const line = cli.stdout.split(/\r?\n/).find(row => row.startsWith('current_check_result=')); assert(line, diagnostic);
          const actual = JSON.parse(line.slice('current_check_result='.length)), pending = phaseCompletionProblems(actual.evaluation.disposition, ['coding']);
          assert.equal(current.summary.verdict, scenario === 'refuted' || scenario === 'confirmed' ? 'FAIL' : 'PASS', diagnostic);
          if (scenario === 'refuted') { assert.equal(pending.length, 0, diagnostic); assert.equal(cli.status, 0, diagnostic); }
          else { assert(pending.length > 0, diagnostic); assert.notEqual(cli.status, 0, diagnostic); }
          if (scenario === 'unrestored') assert(pending.some(row => row.id === 'phase_write_violation'), diagnostic);
          else if (scenario !== 'refuted') assert(pending.some(row => row.id === current.check.id && row.action === (scenario === 'confirmed' ? 'repair' : 'verify')), diagnostic);
          for (const [file, raw] of originals) assert.equal(fs.readFileSync(file, 'utf8'), raw, `${scenario}: a cache read cannot rewrite its raw original`);
        }, true);
      }
    } },
  { name: 'P2 public CLI selects a spec checking family from the same signed coding author without borrowing another actor identity',
    async run() {
      const f = fixture(false, false, [], 'make value 42', 'generic');
      try {
        const released = provisionFrameworkUnder(f.root); f.facts();
        const ctx = f.context('coding'), runDir = path.join(f.root, f.manifest.report_dir);
        ensureRunControl(runDir, f.manifest.run_id);
        const acquired = casAcquireRunOwner(runDir, f.manifest.run_id, 0, { kind: 'session', owner_id: 'current-author-cli-probe', lease_ms: 60_000 });
        assert(acquired.ok); if (!acquired.ok) throw new Error('the current author could not acquire its real fence');
        const attemptId = 'same-unit-family-check', invokeId = `coding-${attemptId}`;
        const context = createWorkUnitExecutionContext({ runId: f.manifest.run_id, feature: 'demo', workflowId: 'obligation-driven', track: 'full',
          chain: f.manifest.phase_chain ?? ['coding'], phase: 'coding', attemptId, owner: { ...acquired.token, kind: 'session' },
          projectRoot: f.root, frameworkRoot: released.frameworkRoot, runDir, reportDir: f.manifest.report_dir, adapter: f.manifest.adapter ?? 'generic',
          authority: f.manifest.unattended, factsContext: ctx.factsContext, instruction: '当前同一单元作者选择spec检查族读取适用验收，不改变真实作者身份。',
          runtimeFacts: { receiptRequired: true, resume: false, successor: false },
          childEnv: { MAISON_GOAL_RUN_ID: f.manifest.run_id, MAISON_GOAL_ATTEMPT: attemptId, MAISON_GOAL_ATTEMPT_PHASE: 'coding' } });
        const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
        emit({ type: 'agent_invoke_start', phase: 'coding', invoke_id: invokeId, attempt_id: attemptId,
          owner_id: acquired.token.owner_id, owner_epoch: acquired.token.epoch, facts_context: ctx.factsContext });
        const boundary = resolvePhaseWriteBoundary({ projectRoot: f.root, frameworkRoot: released.frameworkRoot, feature: 'demo', runId: f.manifest.run_id,
          phaseOrder: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], track: 'full', executionRole: 'author', productLayerDirs: ['src'], profileDir: f.profileDir });
        const issued = issueSessionExecution({ context, invokeId, emit, gateTimeoutMs: 30_000, cleanupReserveMs: 500,
          preSnapshot: capturePhaseInvocationSnapshot(boundary), writeBoundary: boundary });
        const priorEnv = new Map(Object.keys(issued.request.context.childEnv).map(key => [key, process.env[key]]));
        try {
          Object.assign(process.env, issued.request.context.childEnv);
          const admitted = loadFactsInvocationContext({ projectRoot: f.root, frameworkRoot: released.frameworkRoot, feature: 'demo',
            phase: 'spec', runId: context.runId, attemptId: context.attemptId });
          assert(admitted, 'cross-family facts must come from the actual signed actor invocation');
          assert.deepEqual(admitted.source_owners, ctx.factsContext?.source_owners, 'checking spec cannot acquire coding source ownership');
        } finally {
          for (const [key, value] of priorEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        }
        const identityInput = { projectRoot: f.root, feature: 'demo', runId: context.runId, phase: 'spec', attemptId: context.attemptId,
          ownerId: context.owner.owner_id, ownerEpoch: context.owner.epoch };
        assert.throws(() => validateAttendedGoalContext(identityInput), /phase\/attempt/, 'other identity consumers keep the original strict phase semantics');
        assert.equal(validateAttendedGoalContext({ ...identityInput, checkFamily: true }).identity.phase, 'coding', 'the family never replaces the signed actor');
        const factsFile = path.join(f.root, 'doc/features/demo/context/facts.md'), facts = fs.readFileSync(factsFile, 'utf8');
        const cli = (identity: { owner?: string; attempt?: string } = {}) => spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(FRAMEWORK_ROOT, 'harness/harness-runner.ts'),
          '--project-root', f.root, '--framework-root', released.frameworkRoot, '--feature', 'demo', '--phase', 'spec',
          '--goal-run-id', context.runId, '--goal-attempt-id', identity.attempt ?? context.attemptId, '--goal-owner-id', identity.owner ?? context.owner.owner_id, '--goal-owner-epoch', String(context.owner.epoch)],
        { cwd: f.root, windowsHide: true, timeout: 30_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, ...issued.request.context.childEnv, TS_NODE_PROJECT: path.join(FRAMEWORK_ROOT, 'harness/tsconfig.json') } });
        const result = cli();
        const diagnostic = JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
        const reportFile = path.join(featurePhaseReportsDir(f.root, 'demo', 'spec', released.frameworkRoot), 'script-report.json');
        assert(fs.existsSync(reportFile), `a checking family must not be mistaken for the signed author phase: ${diagnostic}`);
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.equal(report.phase, 'spec', diagnostic); assert(report.checks?.length > 0, diagnostic);
        assert(result.stdout.includes('current_check_result='), `the actual public checker must publish its current reader result: ${diagnostic}`);
        const originalReport = fs.readFileSync(reportFile, 'utf8');
        for (const wrong of [{ owner: 'another-owner' }, { attempt: 'another-attempt' }]) {
          const rejected = cli(wrong);
          assert.notEqual(rejected.status, 0, JSON.stringify({ wrong, stdout: rejected.stdout, stderr: rejected.stderr }));
          assert(!rejected.stdout.includes('current_check_result='), 'invalid identity must be rejected before checking');
          assert.equal(fs.readFileSync(reportFile, 'utf8'), originalReport, 'an invalid owner/attempt cannot overwrite the actual result');
        }
        assert.equal(fs.readFileSync(factsFile, 'utf8'), facts, 'selecting a family cannot reassign the original facts owner');
        assert(sessionEvents(runDir).filter(event => event.type === 'agent_invoke_start').every(event => event.phase === 'coding'), 'no fictitious spec author invocation may be injected');
      } finally { clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true }); }
    } },
  { name: 'P2 tools current independent refutation closes only the actual test-strength task and preserves the raw FAIL original',
    run: () => withCurrentStrength('strengthened', current => {
      assert.equal(current.check.status, 'FAIL'); assert.equal(current.check.severity, 'BLOCKER');
      assert.equal(current.summary.verdict, 'FAIL');
      const reusedFail = readReusableCheckResult({ ...current.options, phase: 'coding' });
      assert(reusedFail && reusedFail.summary && (reusedFail.summary as any).verdict === 'FAIL', 'a bound current FAIL is reusable while open');
      assert.equal(readReusableCheckResult({ ...current.options, phase: 'coding', deviceRequired: true }), null, 'native freshness belongs to the original profile checker, not a second cache algorithm');
      current.publish('refuted');
      const disposition = current.read();
      assert.equal(phaseCompletionProblems(disposition, ['coding']).length, 0, JSON.stringify(disposition));
      assert(disposition.disclosed.some(problem => problem.id === current.check.id && problem.affects === 'none'), 'current independent counterevidence must remain disclosed');
      assert(!disposition.releaseBlocking.some(problem => problem.phase === 'coding'), JSON.stringify(disposition));
      const input = readCurrentDispositionInput(current.options);
      for (const source of ['absent', 'pass'] as const) {
        const missingSource = { ...input, phases: input.phases.map(phase => ({ ...phase, checks: phase.checks?.flatMap(check =>
          check.id !== current.check.id ? [check] : source === 'absent' ? [] : [{ ...check, status: 'PASS' as const }]) })) };
        assert(resolveCurrentDisposition(missingSource).completionBlocking.some(problem => problem.id === 'coding_run_status'),
          `an aggregate without its actual failed source stays blocking (${source})`);
      }
      const full = resolveCurrentDisposition(readCurrentDispositionInput({ ...current.options, chain: ['coding', 'ut'] }));
      assert(full.completionBlocking.some(problem => problem.phase === 'ut'), 'the full view retains an explicitly selected but unexecuted family');
      assert.equal(phaseCompletionProblems(full, ['coding']).length, 0, 'another unexecuted milestone cannot permanently block this verified family');
      const closed = finalizePhaseClosure({ projectRoot: current.f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase: 'coding',
        goalRunId: current.f.manifest.run_id, resolvedInputs: current.ctx.resolvedInputs, factsContext: current.ctx.factsContext, persistPhaseState: () => undefined });
      assert.equal(closed.summary.closure_status, 'closed', 'the formal completion consumer must consume the same verified current disposition');
      assert.equal(fs.readFileSync(path.join(current.dir, 'script-report.json'), 'utf8'), current.raw, 'closing the verified task cannot rewrite raw FAIL');
      assert.deepEqual(applicableCheckFamilies(undefined), [], 'missing applicability is not a default full workflow');
      assert.deepEqual(applicableCheckFamilies(undefined, ['coding']), ['coding']);
      for (const file of ['src/demo/value.ts', UT_BASELINE_TEST]) {
        const source = path.join(current.f.root, file), original = fs.readFileSync(source);
        fs.appendFileSync(source, '\n// actual checked input changed\n');
        assert.equal(readReusableCheckResult({ ...current.options, phase: 'coding' }), null, `actual checked input bytes invalidate old tool reuse: ${file}`);
        fs.writeFileSync(source, original);
      }
      const configFile = path.join(current.f.root, 'framework.config.json'), config = fs.readFileSync(configFile);
      const changedConfig = JSON.parse(config.toString('utf8')); changedConfig.project_name = 'changed actual execution environment';
      fs.writeFileSync(configFile, JSON.stringify(changedConfig)); clearFrameworkConfigCache();
      assert.equal(readReusableCheckResult({ ...current.options, phase: 'coding' }), null, 'actual environment changes invalidate old tool reuse');
      fs.writeFileSync(configFile, config); clearFrameworkConfigCache();
    }) },
  { name: 'P2 tools confirmed weakening remains author repair; missing or unclear strength stays verify even when the raw machine check passes',
    async run() {
      for (const scenario of ['missing', 'unclear', 'confirmed', 'raw-pass-missing'] as const) {
        const mode = scenario === 'confirmed' ? 'weakened' : scenario === 'raw-pass-missing' ? 'preserved' : 'strengthened';
        await withCurrentStrength(mode, current => {
          if (scenario === 'unclear' || scenario === 'confirmed') current.publish(scenario);
          assert.equal(current.check.status, scenario === 'raw-pass-missing' ? 'PASS' : 'FAIL');
          const disposition = current.read(), task = phaseCompletionProblems(disposition, ['coding']).find(problem => problem.id === current.check.id);
          assert(task, JSON.stringify({ scenario, disposition }));
          assert.equal(task.action, scenario === 'confirmed' ? 'repair' : 'verify', JSON.stringify(task));
          assert.equal(task.owner, 'coding', 'the current unit author repairs a confirmed real defect; missing independent judgment stays with the checking family');
          assert.equal(fs.readFileSync(path.join(current.dir, 'script-report.json'), 'utf8'), current.raw, 'independent outcomes do not rewrite any raw fact');
          assert.throws(() => finalizePhaseClosure({ projectRoot: current.f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase: 'coding',
            goalRunId: current.f.manifest.run_id, resolvedInputs: current.ctx.resolvedInputs, factsContext: current.ctx.factsContext, persistPhaseState: () => undefined }),
          /coding_existing_test_preserved/, 'a real current repair/verification obligation cannot close');
        });
      }
    } },
  { name: 'N1 current proof: unresolved raw FAIL rejects; disclosed FAIL reuses until scope repair requires fresh evidence', async run() {
    await withCurrentStrength('strengthened', current => {
      const f = current.f, birth = f.manifest.execution_scope;
      assert(birth, 'the actual run must carry its immutable birth scope');
      const workflow = loadWorkflowSpec(FRAMEWORK_ROOT, 'obligation-driven');
      let scope = birth;
      const scopeView = () => {
        const predicates = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
        const resolve = predicates.resolveCompletionDisposition;
        const expected = predicates.applicableCheckFamilies(scope);
        const inputs: Array<{ chain: string[]; pendingOwnerPhase?: string }> = [];
        predicates.resolveCompletionDisposition = options => {
          if (options.executionScope === scope) inputs.push({ chain: [...options.chain], pendingOwnerPhase: options.pendingOwnerPhase });
          return resolve(options);
        };
        try {
          const view = resolveCurrentScopeView({ projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo',
            workflow, previous: scope, currentRunId: f.manifest.run_id });
          assert.equal(inputs.length, 1, 'one original scope must use one common completion observation for every local proof');
          assert.deepEqual(inputs[0].chain, expected, 'proof projection must keep the complete original endpoint, not issue a different per-family query');
          assert.equal(inputs[0].pendingOwnerPhase, undefined, 'an ended actor is not an implicit active write owner');
          return view;
        } finally { predicates.resolveCompletionDisposition = resolve; }
      };
      assert(scopeView().phase_chain.includes('coding'), 'an unrefuted actual FAIL cannot establish proof');
      current.publish('refuted');
      finalizePhaseClosure({ projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase: 'coding',
        goalRunId: f.manifest.run_id, resolvedInputs: current.ctx.resolvedInputs, factsContext: current.ctx.factsContext, persistPhaseState: () => undefined });
      assert(!scopeView().phase_chain.includes('coding'), 'a legitimately disclosed raw FAIL can establish current proof without a fake PASS');
      assert(readReusableCheckResult({ ...current.options, phase: 'coding' }), 'unchanged actual inputs keep the same reusable result');
      const completion = () => shouldGenerateFeatureCompletion(scope, { ...current.options, endpoint: 'feature-completion',
        workflow, chain: applicableCheckFamilies(scope) });
      assert(!completion().eligible, 'a real required execution family without its report still prevents publication');
      const old = loadPhaseEvidenceManifest(f.root, 'demo', 'coding');
      assert(old?.integrityOk);
      const eventsPath = path.join(f.root, f.manifest.report_dir, 'events.jsonl');
      fs.appendFileSync(eventsPath, JSON.stringify({ type: 'phase_halt', ts: new Date().toISOString(), phase: 'coding',
        halt_reason: 'executor_waiting', run_disposition: 'WAITING', run_wait_kind: 'external' }) + '\n');
      assert(!scopeView().phase_chain.includes('coding'), 'an ordinary unchanged wait does not require another actual coding result');
      assert.notEqual(readCurrentDispositionInput(current.options).phases.find(phase => phase.phase === 'coding')?.lineage, 'stale',
        'the public view must not turn its own waiting event into a fresh-check requirement');
      const implementation = birth.obligations.find(item => item.kind === 'implementation');
      assert(implementation);
      scope = structuredClone(birth);
      scope.obligations.push({ ...structuredClone(implementation), id: 'implementation:late-confirmed-repair', satisfied_by: undefined });
      const invalidatedAt = new Date().toISOString();
      fs.appendFileSync(eventsPath, JSON.stringify({ type: 'scope_revised', ts: invalidatedAt, revision_index: 1,
        previous_scope_fingerprint: executionScopeFingerprint(birth), execution_scope: scope,
        trigger: { phase: 'coding', check_id: current.check.id }, allowed_fields: [...SCOPE_REVISION_FIELDS] }) + '\n');
      for (const phase of ['review', 'ut']) {
        const entry = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase,
          featuresDir: 'doc/features', goalRunId: f.manifest.run_id });
        assert(entry.factsContext);
        researchSnapshotFacts(f.root, featureFilePath(f.root, 'demo', 'context/facts.md'), phase, entry.factsContext);
        const resolved = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase, track: 'full',
          goalRunId: f.manifest.run_id, ...entry });
        assert(resolved.inputs, JSON.stringify(resolved.report));
        const sources = ['src/demo/value.ts', UT_BASELINE_TEST];
        const report = generateScriptReport(path.join(FRAMEWORK_ROOT, 'harness'), phase, 'demo', f.root, [{ id: 'file_completeness',
          category: 'structure', description: 'controlled current checker reads actual implementation and test source', severity: 'BLOCKER',
          status: sources.every(file => fs.readFileSync(path.join(f.root, file)).length > 0) ? 'PASS' : 'FAIL', details: sources.join('\n'),
          structured: { source_attempt_dependencies: sources.map(file => ({ path: file, exists: true, sha256: sha256File(path.join(f.root, file)), role: 'artifact' })) } }], FRAMEWORK_ROOT);
        const dir = featurePhaseReportsDir(f.root, 'demo', phase, FRAMEWORK_ROOT);
        fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'script-report.json'), JSON.stringify(report, null, 2));
        writeRunSummaryBase(f.root, report, FRAMEWORK_ROOT);
        writePhaseEvidenceManifest(f.root, resolvePhaseEvidenceManifest({ projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase,
          resolvedInputs: resolved.inputs, factsContext: entry.factsContext, requirementSha: computeRunRequirementSha(f.root, 'demo', f.manifest.run_id),
          extraInputs: executedEvidenceInputs(f.root, 'demo', phase, FRAMEWORK_ROOT),
          extraOutputs: ['script-report.json', 'summary.json'].map(file => path.join(dir, file)) }));
      }
      const pending = resolveCurrentDisposition(readCurrentDispositionInput({ ...current.options, executionScope: scope }));
      assert(pending.completionBlocking.some(problem => problem.phase === 'coding' && problem.id === 'lineage_fresh' && problem.action === 'verify'),
        'the public view must expose this input-fresh result as older than the actual required repair');
      assert(pending.completionBlocking.every(problem => problem.phase === 'coding'),
        'the actually refreshed review/UT remain current; only coding requires verification: ' + JSON.stringify(pending.completionBlocking));
      assert(scopeView().phase_chain.includes('coding'), 'the formal proof consumer must reject the same old result');
      assert(!completion().eligible, 'actual post-repair review/UT results cannot make the older coding proof publishable');
      assert.equal(loadPhaseEvidenceManifest(f.root, 'demo', 'coding')?.manifest.aggregate_sha256, old.manifest.aggregate_sha256,
        'reading the gap never re-signs the old executed result');
      const checked = prepare(f);
      fs.appendFileSync(eventsPath, JSON.stringify({ type: 'phase_verdict', ts: new Date().toISOString(), phase: 'coding', verdict: 'FAIL' }) + '\n');
      const checkedFacts = readCurrentDispositionInput({ ...checked.options, executionScope: scope });
      assert.notEqual(checkedFacts.phases.find(phase => phase.phase === 'coding')?.lineage, 'stale',
        'a raw FAIL does not move the required-repair time past its own actual checker output');
      checked.publish('refuted');
      finalizePhaseClosure({ projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', phase: 'coding',
        goalRunId: f.manifest.run_id, resolvedInputs: checked.ctx.resolvedInputs, factsContext: checked.ctx.factsContext, persistPhaseState: () => undefined });
      fs.appendFileSync(eventsPath, JSON.stringify({ type: 'agent_invoke_start', ts: new Date().toISOString(), phase: 'ut-verifier-format-repair', invoke_id: 'ut-verifier-format-repair-i9' }) + '\n'
        + JSON.stringify({ type: 'agent_invoke_end', ts: new Date().toISOString(), phase: 'ut-verifier-format-repair', invoke_id: 'ut-verifier-format-repair-i9', status: 'passed', exit_code: 0 }) + '\n');
      assert(!scopeView().phase_chain.includes('coding'), 'fresh evidence after the repair and real independent disclosure establish the same current proof');
      const definitions = scope.obligations.filter(item => item.kind === 'acceptance-context' || item.kind === 'design-context');
      assert.equal(definitions.length, 2, 'the same real run supplies both canonical definition bindings');
      for (const definition of definitions) {
        assert(definition.satisfied_by?.length && definition.satisfied_by.every(ref => 'input_id' in ref));
        assert(!loadPhaseEvidenceManifest(f.root, 'demo', definition.owner_phase), 'canonical input satisfaction has no fabricated phase report');
      }
      const publishable = completion();
      assert(publishable.eligible, 'accepted input definitions without phase reports must not stale the actually verified output proofs: '
        + JSON.stringify(publishable.issues));
      const basisOnly = structuredClone(scope);
      for (const definition of basisOnly.obligations.filter(item => definitions.some(original => original.id === item.id))) delete definition.satisfied_by;
      assert(!shouldGenerateFeatureCompletion(basisOnly, { ...current.options, endpoint: 'feature-completion', workflow,
        chain: applicableCheckFamilies(basisOnly) }).eligible, 'definition provenance without accepted satisfaction is still a real unmet duty');
      assert.equal(fs.readFileSync(path.join(checked.dir, 'script-report.json'), 'utf8'), checked.raw, 'the actual raw FAIL remains byte-for-byte unchanged');
      assert(checked.report.checks.some(check => check.id === checked.check.id && check.status === 'FAIL'), 'the positive proof never fabricates raw PASS');
    });
  } },
  { name: 'P3 definition input: basis alone keeps plan executable; accepted input proof avoids an empty check', async run() {
    await withCurrentStrength('preserved', current => {
      const contracts = current.ctx.resolvedInputs?.values.contracts;
      assert(contracts?.state === 'resolved', 'the fixture must supply its actual parsed contracts binding');
      const originalScope = current.f.manifest.execution_scope;
      assert(originalScope, 'the real fixture must carry its frozen scope policy');
      const scope: ExecutionScope = {
        schema_version: '1.0', completion_target: 'request', requested_results: ['design'], phase_chain: ['plan'],
        reused_phases: [], unresolved: [], policy_fingerprint: originalScope.policy_fingerprint,
        obligations: [{ id: 'design-context:candidate', kind: 'design-context', owner_phase: 'plan', applicability: 'required',
          reason: 'current sourced design input', basis: [contracts.binding] }],
      };
      const read = () => readCurrentDispositionInput({ ...current.options, chain: ['plan'], executionScope: scope, scopeFindings: [] });
      assert(read().phases.some(fact => fact.phase === 'plan'), 'basis is provenance, not an accepted satisfaction proof');
      scope.obligations[0].satisfied_by = [contracts.binding];
      assert(!read().phases.some(fact => fact.phase === 'plan'), 'a real accepted definition input does not require an empty plan run');
      const plan = current.f.context('plan');
      const source = 'src/demo/value.ts', sourceAbs = path.join(current.f.root, source);
      const bytes = fs.readFileSync(sourceAbs);
      const report = generateScriptReport(path.join(FRAMEWORK_ROOT, 'harness'), 'plan', 'demo', current.f.root, [{
        id: 'file_completeness', category: 'structure', description: 'read the actual current definition source', severity: 'BLOCKER',
        status: bytes.length ? 'PASS' : 'FAIL', details: `read ${bytes.length} actual bytes`,
        structured: { source_attempt_dependencies: [{ path: source, exists: true, sha256: sha256File(sourceAbs), role: 'artifact' }] },
      }], FRAMEWORK_ROOT);
      const dir = featurePhaseReportsDir(current.f.root, 'demo', 'plan', FRAMEWORK_ROOT);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'script-report.json'), JSON.stringify(report, null, 2));
      writeRunSummaryBase(current.f.root, report, FRAMEWORK_ROOT);
      writePhaseEvidenceManifest(current.f.root, resolvePhaseEvidenceManifest({ projectRoot: current.f.root, frameworkRoot: FRAMEWORK_ROOT,
        feature: 'demo', phase: 'plan', resolvedInputs: plan.resolvedInputs, factsContext: plan.factsContext,
        requirementSha: computeRunRequirementSha(current.f.root, 'demo', current.f.manifest.run_id),
        extraInputs: executedEvidenceInputs(current.f.root, 'demo', 'plan', FRAMEWORK_ROOT),
        extraOutputs: ['script-report.json', 'summary.json'].map(file => path.join(dir, file)) }));
      assert(!read().phases.some(fact => fact.phase === 'plan'), 'the existing current result is still fresh and does not require an empty repeat');
      current.f.write(source, bytes.toString('utf8') + '\n// actual source input changed after this run checked it\n');
      assert(read().phases.some(fact => fact.phase === 'plan'), 'accepted definition inputs do not hide this run\'s actually stale producer result');
    });
  } },
];

export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases.filter(test => matchesUnitCase(test.name, selector))) {
    const stop = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { stop(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }

export const listCaseGroups = () => unitCaseGroups(cases.map(c => c.name));
