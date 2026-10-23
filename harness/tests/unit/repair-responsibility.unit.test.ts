import assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { compareExistingTestPreservation, resolveRepairResponsibility, readRepairDependencyContext } from '../../scripts/utils/repair-responsibility';
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
      const scope: ExecutionScope = { schema_version: '1.0', completion_target: 'feature', requested_results: ['delivery'],
        phase_chain: ['spec', 'plan', 'coding', 'review'], reused_phases: [], unresolved: [], policy_fingerprint: 'a'.repeat(64), obligations: [{ id: 'review', kind: 'code-review', owner_phase: 'review', applicability: 'required', reason: 'review consumes this source', basis: [{ input_id: 'codebase', source: { kind: 'derive', provider_id: 'derive.codebase' }, source_refs: ['app/src/A.ts'], dependencies: [{ path: path.join(host, 'app/src/A.ts'), exists: true, sha256: 'a'.repeat(64), role: 'derive' }], content_fingerprint: 'a'.repeat(64) }] }] };
      for (const phase of ['spec', 'review']) {
        const manifest = resolvePhaseEvidenceManifest({ projectRoot: host, frameworkRoot: root, feature: 'f', phase,
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
    assert.equal(finite.owner, 'coding'); assert.equal(finite.roles.verifier, 'ut'); assert.equal(finite.roles.introducedBy, null);
  });
  return results;
}
