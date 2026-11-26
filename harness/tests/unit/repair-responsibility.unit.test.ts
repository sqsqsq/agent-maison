import assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { codingTestPreservation, compareExistingTestPreservation, resolveRepairResponsibility, repairResponsibilityContext, readRepairDependencyContext, independentArtifactRepairs } from '../../scripts/utils/repair-responsibility';
import { resolvePhaseEvidenceManifest, writePhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { clearFrameworkConfigCache } from '../../config';
import type { ExecutionScope } from '../../scripts/utils/execution-scope';
import { loadWorkflowSpec } from '../../workflow-loader';
import type { UnitCaseResult } from '../run-unit';

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  const check = (name: string, fn: () => void): void => { try { fn(); results.push({ name, ok: true }); } catch (error) { results.push({ name, ok: false, error: String(error) }); } };
  const root = path.resolve(__dirname, '../../..');
  const workflow = loadWorkflowSpec(root, 'obligation-driven');
  const tests = `describe('old', () => { it('kept', 0, () => { expect(1).assertEqual(1); }); });`;
  check('P2 C an invalid test reference cannot expose an out-of-project original', () => {
    const result = codingTestPreservation({ projectRoot: root, feature: 'f', file: '../outside/src/ohosTest/private.ets' });
    assert(!result.preserved && result.beforeText === undefined && result.reason.includes('当前工程'));
  });
  check('finite test compatibility preserves real cases and assertions byte-for-byte', () => {
    assert(compareExistingTestPreservation('const data = { a: 1 };\n' + tests, 'const data = { a: 1, b: [] };\n' + tests).preserved);
    for (const after of [tests.replace('assertEqual(1)', 'assertEqual(2)'), tests.replace('kept', 'renamed'), tests + `\nit('new', 0, () => {});`, tests.replace('it(', 'it.skip('), '']) {
      assert(!compareExistingTestPreservation(tests, after).preserved, after);
    }
    assert(!compareExistingTestPreservation(undefined, tests).preserved);
  });
  check('fixture without assertions may change data but cannot acquire cases, assertions or skips', () => {
    const before = 'class Spy { value = { a: 1 }; }';
    assert(compareExistingTestPreservation(before, 'class Spy { value = { a: 1, b: [] }; }').preserved);
    for (const suffix of [`\nit('new', 0, () => {});`, '\nexpect(true).assertTrue();', `\nit.skip('skip', () => {});`]) assert(!compareExistingTestPreservation(before, before + suffix).preserved);
  });
  check('unknown file and missing verifier roles remain unknown', () => {
    const result = resolveRepairResponsibility({ frameworkRoot: root, workflow, target: { files: ['not-a-known-source.txt'] } });
    assert.equal(result.owner, null); assert.equal(result.roles.introducedBy, null); assert.equal(result.roles.verifier, null);
    assert.equal(result.action, 'unavailable');
  });
  check('verification does not choose the first available verification node', () => {
    const result = resolveRepairResponsibility({ frameworkRoot: root, workflow, target: { category: 'verification' } });
    assert.equal(result.owner, null); assert.equal(result.action, 'unavailable');
  });
  check('real manifest source attribution remains research context for spec, and an actual input for review', () => {
    const host = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-dependency-'));
    try {
      fs.mkdirSync(path.join(host, 'app/src'), { recursive: true });
      fs.writeFileSync(path.join(host, 'app/src/A.ts'), 'export const A = 1;\n');
      const sha = (require('../../scripts/utils/phase-evidence-manifest') as typeof import('../../scripts/utils/phase-evidence-manifest')).sha256File(path.join(host, 'app/src/A.ts'));
      const scope: ExecutionScope = { schema_version: '1.0', completion_target: 'feature', requested_results: ['delivery'],
        phase_chain: ['spec', 'plan', 'coding', 'review'], reused_phases: [], unresolved: [], policy_fingerprint: 'a'.repeat(64), obligations: [{ id: 'review', kind: 'code-review', owner_phase: 'review', applicability: 'required', reason: 'review consumes this source', basis: [{ input_id: 'codebase', source: { kind: 'derive', provider_id: 'derive.codebase' }, source_refs: ['app/src/A.ts'], dependencies: [{ path: path.join(host, 'app/src/A.ts'), exists: true, sha256: sha, role: 'derive' }], content_fingerprint: 'a'.repeat(64) }] }] };
      for (const phase of ['spec', 'review']) {
        const binding = scope.obligations[0].basis[0];
        const manifest = resolvePhaseEvidenceManifest({ projectRoot: host, frameworkRoot: root, feature: 'f', phase,
          ...(phase === 'review' ? { resolvedInputs: { phase, context: { schema_version: '1.1' as const, subject: { feature: 'f' },
            obligations: {}, required_outputs: [] }, values: { codebase: { state: 'resolved' as const, binding, value: [] } }, artifacts: {} } } : {}),
          factsContext: { subject: { feature: 'f' }, first_phase: 'spec', source_paths: ['app/src/A.ts'], source_owners: { 'app/src/A.ts': 'coding' }, required_input_snippets: [] } });
        writePhaseEvidenceManifest(host, manifest);
      }
      const context = readRepairDependencyContext(host, 'f', workflow, scope, root);
      assert(!context.inputEdges.some(edge => edge.before === 'coding' && edge.after === 'spec'));
      assert(context.inputEdges.some(edge => edge.before === 'coding' && edge.after === 'review'));
      assert(!context.inputOwners.has('app/src/A.ts'), 'contextual write owner must not globally become a prerequisite of earlier research');
      fs.writeFileSync(path.join(host, 'app/src/T.ts'), 'export const existingTest = true;\n');
      const testBinding = { input_id: 'codebase', source: { kind: 'derive' as const, provider_id: 'derive.codebase' as const }, source_refs: ['app/src/T.ts'], dependencies: [{ path: path.join(host, 'app/src/T.ts'), exists: true, sha256: 'a'.repeat(64), role: 'derive' as const }], content_fingerprint: 'a'.repeat(64) };
      scope.obligations.push({ id: 'implementation', kind: 'implementation', owner_phase: 'coding', applicability: 'required', reason: 'existing codebase includes planned test research', basis: [testBinding] });
      writePhaseEvidenceManifest(host, resolvePhaseEvidenceManifest({ projectRoot: host, frameworkRoot: root, feature: 'f', phase: 'coding', factsContext: { subject: { feature: 'f' }, first_phase: 'spec', source_paths: ['app/src/T.ts'], source_owners: { 'app/src/T.ts': 'ut' }, required_input_snippets: [] } }));
      assert(!readRepairDependencyContext(host, 'f', workflow, scope, root).inputEdges.some(edge => edge.before === 'ut' && edge.after === 'coding'), 'planned downstream test research cannot reverse the actual coding→UT dependency');
    } finally { fs.rmSync(host, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  });
  check('source ownership survives a queue without its owner', () => {
    const contracts = { projectRoot: root, feature: 'f', phaseOrder: ['review'], domains: [{ owner: 'ut', kind: 'source' as const, match: 'prefix' as const, path: 'app/tests', source: 'profile' }], diagnostics: [], unresolvedSourcePhases: [], protectedRoots: [] };
    const result = resolveRepairResponsibility({ frameworkRoot: root, workflow, contracts, target: { files: ['app/tests/a.ts'] } });
    assert.equal(result.owner, 'ut'); assert.equal(result.category, 'verification'); assert.equal(result.roles.verifier, 'ut');
    const finite = resolveRepairResponsibility({ frameworkRoot: root, workflow, contracts, target: { files: ['app/tests/a.ts'], compatibilityPreserved: true } });
    assert.equal(finite.owner, 'coding'); assert.equal(finite.category, 'coding'); assert.equal(finite.roles.verifier, 'ut'); assert.equal(finite.roles.introducedBy, null);
    assert.equal(finite.action, 'unavailable', 'producer knowledge alone cannot grant implementation or test writes');
  });
  check('work-unit authors repair code and tests in place while preserving independent verification responsibility', () => {
    const scope: ExecutionScope = { schema_version: '1.0', completion_target: 'feature', requested_results: ['implement and verify'],
      phase_chain: ['review'], reused_phases: [], unresolved: [], policy_fingerprint: 'a'.repeat(64), obligations: [
        { id: 'implementation', kind: 'implementation', owner_phase: 'coding', applicability: 'required', reason: 'approved implementation', basis: [] },
        { id: 'unit', kind: 'unit-evidence', owner_phase: 'ut', applicability: 'required', reason: 'approved tests', basis: [] },
      ] };
    const contracts = { projectRoot: root, feature: 'f', phaseOrder: ['review'], executionRole: 'author' as const,
      domains: [{ owner: 'coding', kind: 'source' as const, match: 'prefix' as const, path: 'app/src', source: 'bound module' },
        { owner: 'ut', kind: 'source' as const, match: 'prefix' as const, path: 'app/tests', source: 'profile' }],
      diagnostics: [], unresolvedSourcePhases: [], protectedRoots: [] };
    for (const currentPhase of ['coding', 'ut', 'review']) {
      const result = resolveRepairResponsibility({ frameworkRoot: root, workflow, contracts, executionScope: scope, currentPhase,
        target: { files: ['app/tests/a.ts'] } });
      assert.equal(result.action, 'current');
      assert.equal(result.roles.verifier, 'ut');
      assert(result.reason.includes('独立核验'));
    }
    const denied = resolveRepairResponsibility({ frameworkRoot: root, workflow, contracts, executionScope: scope, currentPhase: 'ut',
      target: { files: ['framework/runtime.ts'] } });
    assert.equal(denied.action, 'unavailable');
    const shared = resolveRepairResponsibility({ frameworkRoot: root, workflow, contracts, executionScope: scope, currentPhase: 'ut',
      target: { files: ['app/src/A.ts'], designAuthority: true } });
    assert.equal(shared.action, 'design');
    const candidate = 'doc/features/f/acceptance.yaml';
    const withCandidate = { ...contracts, domains: [...contracts.domains,
      { owner: 'spec', kind: 'artifact' as const, match: 'exact' as const, path: candidate, source: 'declared local candidate' }] };
    const authority = resolveRepairResponsibility({ frameworkRoot: root, workflow, contracts: withCandidate, executionScope: scope,
      target: { files: [candidate], owner: 'external', designAuthority: true } });
    assert.equal(authority.action, 'design'); assert.equal(authority.owner, 'external');
    assert.equal(authority.roles.legalModifier, 'external', 'a candidate file cannot replace the real canonical authority cause');
    const local = resolveRepairResponsibility({ frameworkRoot: root, workflow, contracts: withCandidate, executionScope: scope,
      target: { files: [candidate] } });
    assert.equal(local.action, 'current'); assert.equal(local.owner, 'spec', 'ordinary local candidate repairs keep their existing producer');
    const verifier = resolveRepairResponsibility({ frameworkRoot: root, workflow, contracts, executionScope: scope,
      executionRole: 'verifier', currentPhase: 'review', target: { files: ['app/src/A.ts'] } });
    assert.equal(verifier.action, 'current');
    assert(verifier.reason.includes('当前工作单元作者'), 'diagnostic responsibility cannot give the observing verifier a product write grant');
  });
  check('the actual current repair view permits unit investigation without guessed paths; category, verify/wait, unrelated objects or missing authority do not', () => {
    const { setupGoalRuntimeHost, productAssertionCheck, FEATURE } = require('./goal-runner-testing-integrity.unit.test') as typeof import('./goal-runner-testing-integrity.unit.test');
    const { generateScriptReport } = require('../../scripts/utils/report-generator') as typeof import('../../scripts/utils/report-generator');
    const { writeRunSummaryBase } = require('../../harness-runner') as typeof import('../../harness-runner');
    const { readCurrentDispositionInput } = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
    const { resolveCurrentDisposition } = require('../../scripts/utils/check-disposition') as typeof import('../../scripts/utils/check-disposition');
    const { featureFilePath } = require('../../config') as typeof import('../../config');
    const { root: host } = setupGoalRuntimeHost('codex');
    try {
      const produced = productAssertionCheck(host);
      const report = generateScriptReport(path.join(root, 'harness'), 'testing', FEATURE, host, [produced], root);
      const summary = writeRunSummaryBase(host, report, root);
      const authority = repairResponsibilityContext({ projectRoot: host, frameworkRoot: root, feature: FEATURE, workflow });
      assert(authority.executionScope && authority.contracts);
      const view = resolveCurrentDisposition(readCurrentDispositionInput({ projectRoot: host, frameworkRoot: root, feature: FEATURE,
        chain: ['testing'], executionScope: authority.executionScope, workflow, currentResults: [{ phase: 'testing', summary, checks: report.checks }] }));
      const target = summary.repair_candidates?.find(candidate => candidate.id === produced.id);
      assert(target && target.evidence_refs?.length && !target.files.length);
      const context = { ...authority, currentDisposition: view };
      const problem = view.problems.find(problem => problem.id === `open_finding:${target.id}`);
      assert(problem?.action === 'repair');
      assert.equal(resolveRepairResponsibility({ ...context, target }).action, 'current');
      assert.equal(resolveRepairResponsibility({ ...context, target: { category: 'coding' } }).action, 'unavailable');
      assert.equal(resolveRepairResponsibility({ ...context, currentDisposition: undefined, target }).action, 'unavailable', 'even real native bytes are not a second authority when the dispatch view is missing');
      for (const changed of [{ ...target, id: 'not-the-current-object' }, { ...target, source_phase: 'another-source' }]) {
        assert.equal(resolveRepairResponsibility({ ...context, target: changed }).action, 'unavailable');
      }
      for (const action of ['verify', 'wait'] as const) {
        const pending = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [], additionalProblems: [{ ...problem, action }] });
        assert.equal(resolveRepairResponsibility({ ...context, currentDisposition: pending, target }).action, 'unavailable', 'current verify/wait cannot be overruled by the old native evidence');
      }
      assert.equal(resolveRepairResponsibility({ ...context, target: { ...target, files: ['framework/runtime.ts'] } }).action, 'unavailable', 'a valid business object cannot override explicit path protection');
      assert.equal(resolveRepairResponsibility({ ...context, contracts: { ...authority.contracts, domains: [] }, target }).action, 'unavailable', 'a current object cannot create unit write authority');
      const scopeFile = featureFilePath(host, FEATURE, 'execution-scope.json'), scopeBytes = fs.readFileSync(scopeFile);
      fs.unlinkSync(scopeFile);
      assert.equal(resolveRepairResponsibility({ ...context, executionScope: undefined, target }).action, 'current', 'an existing bound unit write domain does not require a newer scope carrier');
      fs.writeFileSync(scopeFile, scopeBytes);
      assert.equal(resolveRepairResponsibility({ ...context, projectRoot: undefined, feature: undefined, target }).action, 'unavailable', 'the view cannot invent actual unit identity or write authority');
      assert.equal(resolveRepairResponsibility({ ...context, contracts: { ...authority.contracts, feature: 'another-unit' }, target }).action, 'unavailable', 'another unit write domain cannot authorize the current object');
    } finally { clearFrameworkConfigCache(); fs.rmSync(host, { recursive: true, force: true }); }
  });
  check('4c8 review recheck uses artifact responsibility while retaining its real independent findings', () => {
    const fixture = require('./goal-runner-testing-integrity.unit.test') as typeof import('./goal-runner-testing-integrity.unit.test');
    const { featureFilePath } = require('../../config') as typeof import('../../config');
    const { resolveCurrentDisposition } = require('../../scripts/utils/check-disposition') as typeof import('../../scripts/utils/check-disposition');
    const host = fixture.setupGoalRuntimeHost('codex').root;
    try {
      const report = featureFilePath(host, fixture.FEATURE, 'review/review-report.md');
      fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, '# Current original independent report\n');
      const authority = repairResponsibilityContext({ projectRoot: host, frameworkRoot: root, feature: fixture.FEATURE, workflow });
      const base = { phase: 'review', source_phase: 'review', action: 'repair' as const, severity: 'BLOCKER' as const,
        affects: 'completion' as const, detail: 'actual original check feedback' };
      const recheck = (problem: typeof base & { id: string; files: string[] }) => independentArtifactRepairs({ ...authority,
        currentDisposition: resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [], additionalProblems: [problem] }), recheckFamilies: ['review'] });
      assert.equal(recheck({ ...base, id: 'component_asset_projection', files: [featureFilePath(host, fixture.FEATURE, 'contracts.yaml')] }).length, 0,
        'a raw contract mapping error found by review stays with its actual mapping writer');
      assert(recheck({ ...base, id: 'review_report_format', files: [report] }).some(task => task.owner === 'review'), 'the reviewer still repairs its own report');
      assert(recheck({ ...base, id: 'open_finding:CR-real', files: [fixture.PRODUCT_FILE] }).some(task => task.owner === 'review'),
        'a real independent product finding still receives reassessment after its inputs change');
    } finally { fs.rmSync(host, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  });
  return results;
}
