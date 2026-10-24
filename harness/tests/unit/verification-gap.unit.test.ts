import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { executeCheck } from '../../scripts/utils/check-execution';
import { isRequiredCheckGap, withDispositionTableForTest } from '../../scripts/utils/check-disposition';
import { generateScriptReport, resolveVerdictFromChecks } from '../../scripts/utils/report-generator';
import { buildNextLine, writeRunSummaryBase } from '../../harness-runner';
import { canProduceVerifierRequest } from '../../scripts/utils/verifier-plan';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { collectPhaseCompletionIssues } from '../../scripts/utils/verify-feature-completion';
import { readUpstreamPhaseView, resolveUpstreamPhaseChain, upstreamPhaseDependencies } from '../../scripts/utils/upstream-verdict-gate';
import { phaseInvocationCommands } from '../../scripts/goal-phase-runtime';
import { checkPlanToReportConsistency, __testing_buildTestingRunStatusResult } from '../../scripts/check-testing';
import { classifyFailureKind } from '../../scripts/utils/goal-failure-classifier';
import { loadDagFiles, checkDagFilesParseable } from '../../scripts/check-ut';
import { classifyPhaseVerdict } from '../../scripts/utils/phase-transition-policy';
import codingChecker from '../../scripts/check-coding';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { provisionFrameworkUnder } from '../utils/real-chain-host';
import { profileCodingHost } from '../../../profiles/hmos-app/harness/coding-host-rules';
import { scanNamedBusinessHandler } from '../../scripts/utils/named-handler';
import { observeFeatureState } from '../../scripts/utils/assess';
import { featurePhaseReportsDir, clearFrameworkConfigCache } from '../../config';
import { runGoalRuntimeChain, setupGoalRuntimeHost, writeFile } from './goal-runner-testing-integrity.unit.test';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { CheckContext, CheckResult, Phase, PhaseRuleSpec } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import catalogChecker from '../../scripts/check-catalog';
import glossaryChecker from '../../scripts/check-glossary';
import * as catalogParser from '../../scripts/utils/catalog-parser';
import * as glossaryParser from '../../scripts/utils/glossary-parser';

const ROOT = path.resolve(__dirname, '../../..');
const FEATURE = 'bc-openCard';
const pass: CheckResult = { id: 'product_checked', category: 'structure', description: '真实检查已有结论', severity: 'BLOCKER', status: 'PASS', details: '已检查' };
const context = (phase: string, severity: 'BLOCKER' | 'MAJOR' | 'MINOR' = 'BLOCKER') => ({ phaseRule: {
  structure_checks: { checker_execution: { severity } }, traceability_checks: {}, semantic_checks: {},
} } as unknown as CheckContext);
const gap = (phase: string, error: Error = new Error('checker unavailable')) => executeCheck(context(phase), () => { throw error; }, 'checker_execution');
function report(root: string, phase: Phase, checks: CheckResult[]) {
  const value = generateScriptReport(path.join(ROOT, 'harness'), phase, FEATURE, root, checks, ROOT);
  value.assurance = 'full';
  return value;
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [{
  name: '1804 catalog and glossary exceptions retain original severity while loader failures retain their original error',
  async run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'global-execution-gap-'));
    const originalCatalog = catalogParser.loadCatalog, originalGlossary = glossaryParser.loadGlossary;
    const replace = (object: object, key: string, value: unknown) => { (object as Record<string, unknown>)[key] = value; };
    const ctx = { ...context('catalog'), projectRoot: root, frameworkRoot: ROOT, harnessRoot: path.join(ROOT, 'harness'),
      resolvedProfile: { name: 'generic', profileDir: path.join(ROOT, 'profiles/generic') } } as unknown as CheckContext;
    try {
      const loading = await catalogChecker.check(ctx);
      assert(loading.some(check => check.id === 'catalog_file_exists' && check.status === 'FAIL' && !check.failure_kind));
      const module = { layer: 'feature', format: 'HAR', one_liner: 'plain responsibility', responsibilities: [], typical_business_terms: [],
        easily_confused_with: [], key_exports: [], entry_file: 'missing.ts', get name(): string { throw new TypeError('catalog name helper crashed'); },
        get NOT_responsible_for(): string[] { throw new Error('catalog nonblocking helper crashed'); } };
      replace(catalogParser, 'loadCatalog', () => ({ ok: true, catalog: { schema_version: '1.0', modules: [module] } }));
      const catalogChecks = await catalogChecker.check(ctx);
      const required = catalogChecks.find(check => check.id === 'name_unique')!;
      assert.equal(required.severity, 'BLOCKER'); assert.equal(required.status, 'SKIP'); assert.equal(required.failure_kind, 'framework_bug');
      assert.equal(resolveVerdictFromChecks([required]), 'INCOMPLETE');
      const major = catalogChecks.find(check => check.id === 'not_responsible_for_min_count')!;
      assert.equal(major.severity, 'MAJOR'); assert.equal(major.failure_kind, 'framework_bug');
      assert.equal(resolveVerdictFromChecks([major]), 'PASS', 'an optional MAJOR exception must not become a required blocker');
      replace(catalogParser, 'loadCatalog', () => ({ ok: true, catalog: { schema_version: '1.0', modules: [] } }));
      replace(glossaryParser, 'loadGlossary', () => ({ ok: true, glossary: { schema_version: '1.0', terms: [{ get term(): string { throw new TypeError('glossary term helper crashed'); }, aliases: [], easily_confused_with: [] }] } }));
      const glossaryChecks = await glossaryChecker.check({ ...ctx, phase: 'glossary' });
      const term = glossaryChecks.find(check => check.id === 'term_required_fields')!;
      assert.equal(term.severity, 'BLOCKER'); assert.equal(term.status, 'SKIP'); assert.equal(term.failure_kind, 'framework_bug');
      assert.equal(resolveVerdictFromChecks([term]), 'INCOMPLETE');
    } finally { replace(catalogParser, 'loadCatalog', originalCatalog); replace(glossaryParser, 'loadGlossary', originalGlossary); fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 compatibility: simple UT without DAG keeps legacy SKIP and PASS for verifier review',
  run: () => {
    const { root } = setupGoalRuntimeHost('codex');
    try {
      const ctx = { ...context('ut'), projectRoot: root, frameworkRoot: ROOT, feature: FEATURE, phase: 'ut',
        featureSpec: { feature: FEATURE, contracts: { modules: [] }, acceptance: { criteria: [{ id: 'AC-1', ut_layer: 'unit' }] } },
      } as unknown as CheckContext;
      const skipped = executeCheck(ctx, () => checkDagFilesParseable(ctx, loadDagFiles(ctx)), 'dag_files_parseable');
      assert.equal(skipped[0].status, 'SKIP');
      assert.equal(isRequiredCheckGap(skipped[0]), false, 'no DAG requirement is declared by this checker');
      const script = report(root, 'ut', [pass, ...skipped]);
      assert.equal(script.summary.verdict, 'PASS');
      const summary = writeRunSummaryBase(root, script, ROOT);
      assert.equal(summary.verdict, 'PASS');
      assert.deepEqual(summary.blocking_skips.map(check => check.id), ['dag_files_parseable']);
      assert.equal(summary.next_action, 'review_blocking_skips_then_verifier');
      assert(canProduceVerifierRequest({ planMode: 'enabled', phase: 'ut', scriptVerdict: summary.verdict,
        checks: script.checks, reportValidity: 'PASS', hasBlockedCapability: false }).allowed);
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 compatibility: old PASS with unclassified blocking_skips keeps upstream assess and completion conclusions',
  run: () => {
    const { root } = setupGoalRuntimeHost('codex');
    try {
      const script = report(root, 'review', [pass]);
      const summary = writeRunSummaryBase(root, script, ROOT);
      const file = path.join(featurePhaseReportsDir(root, FEATURE, 'review'), 'summary.json');
      fs.writeFileSync(file, JSON.stringify({ ...summary, blocking_skips: [{ id: 'legacy_not_run', details_excerpt: 'legacy verifier responsibility' }] }));
      const upstream = readUpstreamPhaseView(root, FEATURE, 'review');
      assert.equal(upstream.verdict, 'PASS');
      assert(!upstream.blockerIds.includes('legacy_not_run'));
      assert(!collectPhaseCompletionIssues({ projectRoot: root, feature: FEATURE, chain: ['review'] })
        .some(issue => issue.condition === 'required_check_conclusion'));
      const observed = observeFeatureState({ projectRoot: root, frameworkRoot: ROOT, feature: FEATURE });
      const phase = observed.phases.find(phase => phase.phase === 'review');
      assert.equal(phase?.verdict, 'PASS');
      assert.equal(phase?.verification_gaps, undefined);
      try { finalizePhaseClosure({ projectRoot: root, frameworkRoot: ROOT, feature: FEATURE, phase: 'review', persistPhaseState: () => {} }); }
      catch (error) { assert(!String(error).includes('summary 不满足 closure'), String(error)); }
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 six phases retain required severity for TypeError and ordinary Error through real report and summary',
  run: () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-execution-'));
    try {
      for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] as Phase[]) {
        const phaseRule = YAML.parse(fs.readFileSync(path.join(ROOT, 'specs/phase-rules', `${phase}-rules.yaml`), 'utf8')) as PhaseRuleSpec;
        const rule = Object.entries(phaseRule.structure_checks).find(([, value]) => value.severity === 'BLOCKER')!;
        for (const error of [new TypeError('array is not a scalar'), new Error('ordinary checker failure')]) {
          const checks = executeCheck({ phaseRule }, () => { throw error; }, rule[0]);
          assert.equal(checks[0].status, 'SKIP'); assert.equal(checks[0].severity, rule[1].severity);
          assert.equal(checks[0].failure_kind, 'framework_bug'); assert.equal(checks[0].actionability, 'framework_blocked');
          assert(checks[0].details.includes(error.message) && checks[0].details.includes(error.stack!));
          const script = report(root, phase, [pass, ...checks]);
          assert.equal(script.summary.verdict, 'INCOMPLETE');
          const summary = writeRunSummaryBase(root, script, ROOT, { verifierPlan: { mode: 'disabled', reason: 'policy_off', verifier_prompt: null, message: '' } });
          assert.equal(summary.verdict, 'INCOMPLETE'); assert.equal(summary.closure_status, 'open');
          assert.equal(summary.blocker_count, 0); assert(summary.blocking_skips.some(check => check.id === rule[0]));
          assert.equal(summary.release_readiness, 'BLOCKED'); assert.equal(summary.completion_status, 'INCOMPLETE');
          assert.equal(summary.next_action, 'resolve_blocking_skips_then_rerun');
          assert(buildNextLine(summary, phase, FEATURE).includes('维护者'));
        }
      }
      const sparse = executeCheck({ phaseRule: {} } as CheckContext, () => { throw new Error('sparse context'); }, 'dynamic', { severity: 'MAJOR' });
      assert.equal(sparse[0].status, 'SKIP'); assert.equal(sparse[0].severity, 'MAJOR');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 optional and confirmed not-applicable checks do not become required, mixed real FAIL survives',
  run: () => {
    const optional = executeCheck(context('testing', 'MINOR'), () => { throw new TypeError('optional advisory'); }, 'checker_execution');
    assert.equal(resolveVerdictFromChecks([pass, ...optional]), 'PASS');
    assert.equal(resolveVerdictFromChecks([pass, { ...gap('testing')[0], structured: { applicability: 'not_applicable' } }]), 'PASS');
    withDispositionTableForTest([{ match: { id: 'checker_execution' }, protects: 'ledger_shape', basis: 'test', consequence: 'disclosure' }], () => {
      assert.equal(resolveVerdictFromChecks([pass, ...gap('coding')]), 'PASS');
      assert(!isRequiredCheckGap(gap('coding')[0]));
    });
    const realFailure: CheckResult = { ...pass, id: 'real_product_failure', status: 'FAIL' };
    const checks = executeCheck(context('coding'), () => [realFailure], realFailure.id).concat(gap('coding'));
    assert.equal(checks[0].status, 'FAIL'); assert.equal(resolveVerdictFromChecks(checks), 'FAIL');
    assert.equal(canProduceVerifierRequest({ planMode: 'enabled', phase: 'coding', scriptVerdict: 'PASS', checks: gap('coding'), reportValidity: 'PASS', hasBlockedCapability: false }).allowed, false);
  },
}, {
  name: '7d9 completion, finalizer and upstream consume the same required gap even beside a stale PASS label',
  run: () => {
    const { root } = setupGoalRuntimeHost('codex');
    try {
      const script = report(root, 'review', [pass, ...gap('review')]);
      const summary = writeRunSummaryBase(root, script, ROOT);
      assert(collectPhaseCompletionIssues({ projectRoot: root, feature: FEATURE, chain: ['review'] }).length > 0);
      assert.throws(() => finalizePhaseClosure({ projectRoot: root, frameworkRoot: ROOT, feature: FEATURE, phase: 'review', persistPhaseState: () => {} }), /summary 不满足 closure/);
      // A compatibility reader cannot revive missing evidence from an old PASS label.
      fs.writeFileSync(path.join(featurePhaseReportsDir(root, FEATURE, 'review'), 'summary.json'), JSON.stringify({ ...summary, verdict: 'PASS' }));
      assert(readUpstreamPhaseView(root, FEATURE, 'review').blockerIds.includes('checker_execution'));
      assert(collectPhaseCompletionIssues({ projectRoot: root, feature: FEATURE, chain: ['review'] }).some(issue => issue.detail.includes('checker_execution')));
      assert.throws(() => finalizePhaseClosure({ projectRoot: root, frameworkRoot: ROOT, feature: FEATURE, phase: 'review', persistPhaseState: () => {} }), /summary 不满足 closure/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 runtime executes independent UT, never dependent testing, and resumes verification without rewriting valid work',
  run: async () => {
    const { root } = setupGoalRuntimeHost('codex');
    try {
      let broken = true;
      const options = { adapter: 'codex', frameworkRoot: ROOT,
        onHarnessSummary: ({ phase }: { phase: string }) => phase === 'review' ? { checks: broken ? [pass, ...gap(phase, new TypeError('required review checker unavailable'))] : [pass] } : null };
      const first = await runGoalRuntimeChain(root, options);
      assert(first.invokedPhases.includes('review') && first.invokedPhases.includes('ut'), JSON.stringify(first.invokedPhases));
      assert(!first.invokedPhases.includes('testing'), JSON.stringify(first.invokedPhases));
      assert.equal(first.invokedPhases.filter(phase => phase === 'review').length, 1, 'missing checker must not cause a content retry');
      const verdict = first.events.find(event => event.type === 'phase_verdict' && event.phase === 'review');
      assert.equal(verdict?.verdict, 'INCOMPLETE'); assert.equal(verdict?.action, 'defer_external_and_continue_if_allowed');
      assert(first.events.some(event => event.type === 'phase_halt' && event.run_disposition === 'WAITING' && event.run_wait_kind === 'external'));
      const summary = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, FEATURE, 'review'), 'summary.json'), 'utf8'));
      assert.equal(summary.verdict, 'INCOMPLETE'); assert(summary.blocking_skips.some((check: { id: string }) => check.id === 'checker_execution'));
      assert(collectPhaseCompletionIssues({ projectRoot: root, feature: FEATURE, chain: ['review', 'ut', 'testing'] }).length > 0);
      const utProofBeforeResume = collectPhaseCompletionIssues({ projectRoot: root, feature: FEATURE, chain: ['ut'], frameworkRoot: ROOT });
      const dependencyView = resolveUpstreamPhaseChain(root, FEATURE, path.basename(first.reportDir), undefined, ROOT);
      const utDependencies = upstreamPhaseDependencies(root, FEATURE, 'ut', dependencyView);
      broken = false;
      const resumed = await runGoalRuntimeChain(root, { ...options, resume: path.basename(first.reportDir) });
      assert(resumed.harnessPhases.includes('review'), JSON.stringify(resumed.harnessPhases));
      assert(resumed.invokedPhases.includes('testing'), JSON.stringify(resumed.invokedPhases));
      assert(!resumed.invokedPhases.some(phase => ['spec', 'plan', 'coding', 'ut'].includes(phase)), JSON.stringify({ phases: resumed.invokedPhases, utProofBeforeResume, utDependencies, dependencyView: {degraded: dependencyView.degraded, reason: dependencyView.degradedReason},
        reviewEvents: first.events.filter(event => event.phase === 'review').map(event => ({ type: event.type, invoke_id: event.invoke_id, verdict: event.verdict, failure_kind: event.failure_kind, action: event.action, run_disposition: event.run_disposition })) }));
      const repaired = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, FEATURE, 'review'), 'summary.json'), 'utf8'));
      assert.equal(repaired.verdict, 'PASS'); assert.equal(repaired.closure_status, 'closed');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 runtime with coding execution gap has no independent work and parks once instead of invoking downstream',
  run: async () => {
    const { root } = setupGoalRuntimeHost('codex');
    try {
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', frameworkRoot: ROOT,
        onHarnessSummary: ({ phase }) => phase === 'coding' ? { checks: [pass, ...gap(phase)] } : null });
      assert.deepEqual(probe.invokedPhases, ['spec', 'plan', 'coding']);
      const verdict = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'coding');
      assert.equal(verdict?.verdict, 'INCOMPLETE'); assert.equal(verdict?.action, 'defer_external_and_halt');
      assert(probe.events.some(event => event.type === 'phase_halt' && event.run_disposition === 'WAITING' && String(event.halt_guidance).includes('维护者')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 mixed execution gap keeps real product FAIL actionable, then defers only the remaining missing verification',
  run: async () => {
    const { root } = setupGoalRuntimeHost('codex');
    try {
      const artifact = `doc/features/${FEATURE}/review/review-report.md`;
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', frameworkRoot: ROOT,
        onReview: ({ attempt }) => writeFile(root, artifact, attempt === 1 ? '# review\nproduct defect is open\n' : '# review\nproduct defect repaired\n'),
        onHarnessSummary: ({ phase }) => phase === 'review' ? {
          checks: executeCheck(context(phase), () => [{ ...pass, id: 'actual_product_finding',
            status: fs.readFileSync(path.join(root, artifact), 'utf8').includes('is open') ? 'FAIL' : 'PASS',
            affected_files: [artifact], details: '真实产物中的待修结论' }], 'actual_product_finding').concat(gap(phase)),
        } : null,
      });
      const verdicts = probe.events.filter(event => event.type === 'phase_verdict' && event.phase === 'review');
      assert.equal(verdicts[0]?.verdict, 'FAIL'); assert.equal(verdicts[0]?.action, 'retry');
      assert.equal(verdicts[1]?.verdict, 'INCOMPLETE'); assert.equal(verdicts[1]?.action, 'defer_external_and_continue_if_allowed');
      assert.equal(probe.invokedPhases.filter(phase => phase === 'review').length, 2);
      assert(probe.invokedPhases.includes('ut') && !probe.invokedPhases.includes('testing'));
      assert(fs.readFileSync(path.join(root, artifact), 'utf8').includes('repaired'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 ordinary coding SKIP keeps legacy report and verifier review semantics',
  run: () => {
    const { root } = setupGoalRuntimeHost('codex');
    try {
      const packagePath = '02-Feature/FinancialCard/oh-package.json5';
      fs.unlinkSync(path.join(root, packagePath));
      const ctx = { ...context('coding'), projectRoot: root, frameworkRoot: ROOT, feature: FEATURE, phase: 'coding',
        featureSpec: { feature: FEATURE, contracts: { modules: [{ name: 'FinancialCard', layer: '02-Feature', package_path: '02-Feature/FinancialCard' }], module_dependencies: {} } },
        resolvedProfile: { name: 'hmos-app', profileDir: path.join(ROOT, 'profiles/hmos-app') },
      } as unknown as CheckContext;
      const checks = executeCheck(ctx, () => profileCodingHost.runStructureChecks(ctx, []).filter(check => check.id === 'oh_package_dependencies'), 'oh_package_dependencies');
      assert.equal(checks[0].status, 'SKIP'); assert(!isRequiredCheckGap(checks[0]));
      const summary = writeRunSummaryBase(root, report(root, 'coding', [pass, ...checks]), ROOT);
      assert.equal(summary.verdict, 'PASS');
      assert.deepEqual(summary.blocking_skips.map(check => check.id), ['oh_package_dependencies']);
      assert.equal(summary.next_action, 'review_blocking_skips_then_verifier');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 testing unparseable case IDs retry the real report; mixed framework gap remains after content repair',
  run: async () => {
    for (const mixed of [false, true]) {
      const { root } = setupGoalRuntimeHost('codex');
      try {
        const artifact = `doc/features/${FEATURE}/testing/test-report.md`;
        const plan = '## 测试用例\n\n| 用例编号 | 用例名称 |\n|---|---|\n| TC-01 | real case |';
        const probe = await runGoalRuntimeChain(root, { adapter: 'codex', frameworkRoot: ROOT,
          onTesting: ({ attempt }) => writeFile(root, artifact, attempt === 1 ? '# 报告存在但没有编号\n' : '## 测试执行结果\n\n| 用例编号 | 执行结果 |\n|---|---|\n| TC-01 | PASS |'),
          onHarnessSummary: ({ phase }) => {
            if (phase !== 'testing') return null;
            const text = fs.readFileSync(path.join(root, artifact), 'utf8');
            const checks = executeCheck({ phaseRule: {} } as CheckContext, () => checkPlanToReportConsistency(context(phase), plan, text), 'plan_to_report_consistency')
              .concat(mixed ? gap(phase) : []);
            return { checks: checks.concat(__testing_buildTestingRunStatusResult(plan, text, checks)) };
          },
        });
        const verdicts = probe.events.filter(event => event.type === 'phase_verdict' && event.phase === 'testing');
        assert.equal(verdicts[0]?.verdict, 'FAIL', JSON.stringify(verdicts)); assert.equal(verdicts[0]?.action, 'retry');
        assert.equal(verdicts[0]?.failure_kind_classified, 'deterministic_gate_or_artifact_missing');
        assert.equal(verdicts[1]?.verdict, mixed ? 'INCOMPLETE' : 'PASS', JSON.stringify(verdicts));
        assert.equal(verdicts[1]?.action, mixed ? 'defer_external_and_halt' : 'advance');
        assert.equal(probe.invokedPhases.filter(phase => phase === 'testing').length, 2);
        assert(!verdicts.some(event => event.failure_kind_classified === 'code_regression'));
      } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    }
  },
}, {
  name: '7d9 UT malformed DAG candidate remains a real FAIL and passes after source repair',
  run: () => {
    const { root } = setupGoalRuntimeHost('codex');
    try {
      const ctx = { ...context('ut'), projectRoot: root, frameworkRoot: ROOT, feature: FEATURE, phase: 'ut',
        featureSpec: { feature: FEATURE, contracts: { modules: [{ name: 'FinancialCard', package_path: '02-Feature/FinancialCard' }] },
          acceptance: { criteria: [{ id: 'AC-1', ut_layer: 'unit' }] } },
      } as unknown as CheckContext;
      const inspect = () => executeCheck(ctx, () => checkDagFilesParseable(ctx, loadDagFiles(ctx)), 'dag_files_parseable');
      writeFile(root, '02-Feature/FinancialCard/test/dag/transfer.dag.yaml', 'nodes: [unterminated');
      const missing = inspect();
      assert.equal(missing[0].status, 'FAIL'); assert.equal(missing[0].failure_kind, undefined);
      const summary = writeRunSummaryBase(root, report(root, 'ut', missing), ROOT);
      assert.equal(summary.verdict, 'FAIL'); assert.equal(summary.blocker_count, 1);
      assert(missing[0].affected_files?.some(file => file.endsWith('transfer.dag.yaml')));
      assert.equal(classifyPhaseVerdict({ phase: 'ut', verdict: summary.verdict, retries_used: 0 }), 'retry');
      writeFile(root, '02-Feature/FinancialCard/test/dag/transfer.dag.yaml',
        'schema_version: "1.0"\ndag_id: transfer\nlinked_acceptance: [AC-1]\nnodes:\n  - id: transfer\n    type: function\n    source: src/transfer.ts\nedges: []\n');
      const restored = inspect();
      assert.equal(restored[0].status, 'PASS');
      assert.equal(report(root, 'ut', restored).summary.verdict, 'PASS');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 full coding report preserves no-modules PASS and existing concrete registration FAIL',
  run: async () => {
    const { root } = setupGoalRuntimeHost('codex');
    try {
      provisionFrameworkUnder(root);
      fs.unlinkSync(path.join(root, 'build-profile.json5'));
      writeFile(root, `doc/features/${FEATURE}/context/facts.md`,
        `---\nschema_version: "1.0"\nfeature: ${FEATURE}\nestablished_by: spec\nready_to_produce: true\nhas_blocker_coverage_risk: false\n---\n\n## phase_delta: coding\n\n当前 AllBanksPage 的 build 渲染 Text(x)；本目标只核模块登记适用性，不变更业务。\n`);
      const profile = path.join(root, 'coding-probe-profile');
      writeFile(root, 'coding-probe-profile/harness/coding-host-rules.js',
        `const {profileCodingHost:host}=require(${JSON.stringify(path.join(ROOT, 'profiles/hmos-app/harness/coding-host-rules'))});\n` +
        'exports.profileCodingHost={...host,checkCodingCompile:()=>[{id:"coding_compile",category:"structure",description:"controlled external compiler",severity:"BLOCKER",status:"PASS",details:"native compiler transport substitute"}]};\n');
      const spec = new SpecLoader(root, undefined, undefined, ROOT).loadFeatureSpec(FEATURE);
      spec.contracts!.modules[0].change_type = 'modify';
      spec.contracts!.module_dependencies = {};
      spec.contracts!.files!.push('02-Feature/FinancialCard/src/main/ets/RetiredPrediction.ets');
      const ctx = { projectRoot: root, frameworkRoot: ROOT, feature: FEATURE, phase: 'coding', featureSpec: spec,
        phaseRule: YAML.parse(fs.readFileSync(path.join(ROOT, 'specs/phase-rules/coding-rules.yaml'), 'utf8')),
        resolvedProfile: { name: 'hmos-app', profileDir: profile, capabilities: { 'coding.visual_parity': { severity: 'SKIP' } } },
      } as unknown as CheckContext;
      const checks = await codingChecker.check(ctx);
      assert(!fs.existsSync(path.join(root, 'build-profile.json5')), 'no platform file is invented for modify modules');
      assert.equal((checks.find(check => check.id === 'module_config_registered')?.structured as { applicability?: string })?.applicability, 'not_applicable');
      assert.equal(checks.find(check => check.id === 'plan_file_to_code')?.status, 'WARN');
      const status = checks.find(check => check.id === 'coding_run_status')!;
      assert.equal(status.status, 'PASS', status.details);
      assert(status.details.includes('critical_skip_count: 0') && status.details.includes('can_claim_done: YES'), status.details);
      const script = report(root, 'coding', checks);
      const summary = writeRunSummaryBase(root, script, ROOT);
      assert.equal(script.summary.verdict, 'PASS'); assert.equal(summary.verdict, 'PASS');
      assert.equal(summary.blocking_skips.length, 0);
      assert(canProduceVerifierRequest({ planMode: 'enabled', phase: 'coding', scriptVerdict: summary.verdict, checks, reportValidity: 'PASS', hasBlockedCapability: false }).allowed);
      spec.contracts!.modules[0].change_type = 'new';
      const required = await codingChecker.check(ctx);
      assert.equal(required.find(check => check.id === 'module_config_registered')?.status, 'SKIP');
      assert(!isRequiredCheckGap(required.find(check => check.id === 'module_config_registered')!));
      assert.equal(report(root, 'coding', required).summary.verdict, 'PASS');
      writeFile(root, 'build-profile.json5', '{"modules":[]}');
      const registrationFailure = (await codingChecker.check(ctx)).find(check => check.id === 'module_config_registered')!;
      assert.equal(registrationFailure.status, 'FAIL', 'existing concrete registration mismatch stays a real product failure');
      assert.equal(resolveVerdictFromChecks([registrationFailure]), 'FAIL');
      spec.contracts!.modules = [];
      const noModules = await codingChecker.check(ctx);
      assert.equal(noModules.find(check => check.id === 'module_config_registered')?.status, 'SKIP');
      assert.equal(noModules.find(check => check.id === 'coding_run_status')?.status, 'PASS');
      const noModuleSummary = writeRunSummaryBase(root, report(root, 'coding', noModules), ROOT);
      assert.equal(noModuleSummary.verdict, 'PASS');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 only classified execution gaps become incomplete; unclassified SKIP preserves PASS and real FAIL',
  run: () => {
    const ordinary: CheckResult = { ...pass, status: 'SKIP', id: 'missing_artifact' };
    assert.equal(resolveVerdictFromChecks([ordinary]), 'PASS');
    assert.equal(resolveVerdictFromChecks([ordinary, ...gap('ut')]), 'INCOMPLETE');
    assert.equal(resolveVerdictFromChecks([{ ...ordinary, blocking_class: 'externalBlocked', failure_kind: 'device_blocked' }]), 'INCOMPLETE');
    assert.equal(resolveVerdictFromChecks([{ ...ordinary, blocking_class: 'externalBlocked', failure_kind: 'capability_missing' }]), 'INCOMPLETE');
    assert.equal(classifyFailureKind({ verdict: 'INCOMPLETE', blockers: [], blocking_skips: [{ id: ordinary.id }, { id: 'checker_execution', blocking_class: 'framework_internal' }] }), 'framework_bug');
    assert.equal(resolveVerdictFromChecks([ordinary, { ...pass, status: 'FAIL' }, ...gap('ut')]), 'FAIL');
  },
}, {
  name: '7d9 profile rule not declared is inapplicable, while an active HAR export obligation still fails on missing implementation',
  run: () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-applicability-'));
    try {
      const ctx = { projectRoot: root, frameworkRoot: ROOT, feature: 'lib', phase: 'coding',
        featureSpec: { feature: 'lib', contracts: { modules: [{ name: 'library', format: 'HAR', layer: 'src', package_path: 'src/library' }], files: [] } },
        phaseRule: { structure_checks: {}, traceability_checks: {}, semantic_checks: {} },
        resolvedProfile: { name: 'hmos-app', profileDir: path.join(ROOT, 'profiles/hmos-app') },
      } as unknown as CheckContext;
      const omitted = profileCodingHost.runStructureChecks(ctx, []).find(check => check.id === 'har_index_export')!;
      assert.equal(omitted.status, 'SKIP'); assert.equal(isRequiredCheckGap(omitted), false);
      ctx.phaseRule.structure_checks.har_index_export = { description: 'HAR has a real export entry', severity: 'BLOCKER' };
      const required = profileCodingHost.runStructureChecks(ctx, []).find(check => check.id === 'har_index_export')!;
      assert.equal(required.status, 'FAIL'); assert.equal((required.structured as { applicability?: string } | undefined)?.applicability, undefined);
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '7d9 omitted optional profile scanner is inapplicable, but a provided broken scanner remains a required execution gap',
  run: () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-applicability-'));
    try {
      const ctx = { ...context('coding'), featureSpec: { feature: 'demo', useCases: { schema_version: '1', feature: 'demo', use_cases: [] } },
        resolvedProfile: { profileDir: root } } as unknown as CheckContext;
      assert.equal(scanNamedBusinessHandler(ctx).structured?.applicability, 'not_applicable');
      fs.mkdirSync(path.join(root, 'harness'));
      fs.writeFileSync(path.join(root, 'harness/named-handler.js'), 'throw new Error("provided scanner is broken");\n');
      const checks = executeCheck(ctx, () => { scanNamedBusinessHandler(ctx); return [pass]; }, 'named_business_handler');
      assert.equal(checks[0].status, 'SKIP'); assert.equal(checks[0].failure_kind, 'framework_bug');
      assert.equal(isRequiredCheckGap(checks[0]), true); assert(checks[0].details.includes('provided scanner is broken'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '7d9 mode-specific commands include phase/project and only attended commands include the complete owner identity',
  run: () => {
    const detached = phaseInvocationCommands('D:/host', ROOT, 'bank', 'plan');
    assert(detached.every(command => command.includes('--phase') && command.includes('--project-root') && !command.includes('--goal-owner-id')));
    assert(detached[1].includes('--sync-closure'));
    const attended = phaseInvocationCommands('D:/host', ROOT, 'bank', 'spec', { runId: 'run', attemptId: 'i2', ownerId: 'session', ownerEpoch: 3 });
    assert(attended.every(command => ['--goal-run-id', '--goal-attempt-id', '--goal-owner-id', '--goal-owner-epoch'].every(flag => command.includes(flag))));
  },
}];

export function getCases() { return cases; }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const item of cases) {
    if (!matchesUnitCase(item.name, filter)) continue;
    const finish = startCaseTiming([item.name], timings);
    try { await item.run(); results.push({ name: item.name, ok: true }); }
    catch (error) { results.push({ name: item.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }
