import { beginUnitCase } from '../utils/unit-cases';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Module } from 'module';
import * as ts from 'typescript';
import * as YAML from 'yaml';
import { fixture, recordInvocation, UT_BASELINE_TEST } from './standalone-coding-review.unit.test';
import { checkCodingExistingTestPreserved } from '../../scripts/check-coding';
import { clearFrameworkConfigCache, featurePhaseReportsDir, featureFilePath, resolveFeatureArtifact } from '../../config';
import { loadWorkflowSpec } from '../../workflow-loader';
import { assembleAIPrompt, generateScriptReport, loadVerifierPromptTemplate } from '../../scripts/utils/report-generator';
import { buildVerifierMaterialView, collectTestStrengthContext } from '../../scripts/utils/verifier-material';
import { loadVerifierEvidence } from '../../scripts/utils/verifier-evidence';
import { canProduceVerifierRequest, resolveVerifierPlan, workflowVerifierPrompt } from '../../scripts/utils/verifier-plan';
import { writeRunSummaryBase } from '../../harness-runner';
import { resolvePhaseEvidenceManifest, writePhaseEvidenceManifest, sha256File } from '../../scripts/utils/phase-evidence-manifest';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import { applicableCheckFamilies, currentCompletionEvaluation, completionProgressFromHistory, readCurrentDispositionInput, readReusableCheckResult } from '../../scripts/utils/verify-feature-completion';
import { resolveCurrentDisposition, phaseCompletionProblems } from '../../scripts/utils/check-disposition';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { finalizePhaseClosure, executedEvidenceInputs } from '../../scripts/utils/phase-closure-finalizer';
import { setupGoalRuntimeHost, writeVisualDiff, runRealVisualGate, FEATURE as VISUAL_FEATURE, PRODUCT_FILE } from '../utils/existing-goal-delivery-fixture';
import { collectActionableDefects } from '../../scripts/goal-phase-runtime';
import { actionableDefectsToCandidates, mergeRepairCandidatesIntoSummary } from '../../scripts/utils/repair-candidates';
import { resolveRepairResponsibility } from '../../scripts/utils/repair-responsibility';
import { type ExecutionScope } from '../../scripts/utils/execution-scope';
import { computeDefectFingerprint } from '../../../profiles/hmos-app/harness/visual-diff-check';
import { resolveEffectiveScopeSource } from '../../scripts/utils/goal-run-creation';
import type { IssueVerificationVerdict } from '../../scripts/utils/repair-candidates';
import type { CheckResult } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

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
    workflowVerifierPrompt: workflowVerifierPrompt(loadWorkflowSpec(FRAMEWORK_ROOT, 'obligation-driven'), 'coding') });
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

export async function runAll() {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    const endUnitCase = beginUnitCase(test.name);
    if (!endUnitCase) continue;
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally {  endUnitCase(); }
  }
  return results;
}
