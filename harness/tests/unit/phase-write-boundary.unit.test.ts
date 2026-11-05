import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import {
  capturePhaseInvocationSnapshot,
  classifyPhaseInvocationChanges,
  diffPhaseInvocationSnapshots,
  resolvePhasePathOwnership,
  resolvePhaseWriteBoundary,
  renderPhaseWriteBoundaryGuidance,
  workUnitProtectedRecordPaths,
  replayUtOwnedWrites,
  type PhaseWriteBoundaryResolution,
} from '../../scripts/utils/phase-write-boundary';
import type { UnitCaseResult } from '../run-unit';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';
import type { ExecutionScope } from '../../scripts/utils/execution-scope';
import { fixture as blueprintFixture } from './blueprint-skill-projection.unit.test';
import { emitHarnessPreflightGap, harnessPreflightPath } from '../../scripts/utils/capability-preflight';
import { readRepairResponsibilityContracts, workUnitMayWritePath } from '../../scripts/utils/repair-responsibility';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const FEATURE = 'owner-fixture';
const CHAIN = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: (error as Error).stack ?? String(error) });
  }
}

function write(root: string, rel: string, content: string): void {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function makeHost(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-write-boundary-'));
  write(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'phase-owner-fixture',
    project_profile: { name: 'hmos-app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false },
  }, null, 2));
  write(root, '02-Feature/Card/src/main/ets/Card.ets', 'export class Card {}\n');
  write(root, '02-Feature/Card/src/ohosTest/ets/test/Card.test.ets', 'export default function test() {}\n');
  write(root, `doc/features/${FEATURE}/plan/plan.md`, [
    '# Plan',
    '## Scope 声明与继承',
    '```yaml',
    'in_scope_modules:',
    '  - Card',
    'out_of_scope_modules: []',
    'rationale: fixture',
    '```',
  ].join('\n'));
  write(root, `doc/features/${FEATURE}/contracts.yaml`, [
    'modules:',
    '  - name: Card',
    '    package_path: 02-Feature/Card',
  ].join('\n'));
  write(root, `doc/features/${FEATURE}/acceptance.yaml`, 'feature: owner-fixture\ncriteria: []\n');
  clearFrameworkConfigCache();
  return root;
}

function constructionScope(): ExecutionScope {
  return { schema_version: '1.0', completion_target: 'feature', requested_results: ['implement and verify'],
    phase_chain: ['coding', 'ut'], reused_phases: [], unresolved: [], policy_fingerprint: 'a'.repeat(64), obligations: [
      { id: 'implementation', kind: 'implementation', owner_phase: 'coding', applicability: 'required', reason: 'approved implementation', basis: [] },
      { id: 'unit', kind: 'unit-evidence', owner_phase: 'ut', applicability: 'required', reason: 'approved test construction', basis: [] },
    ] };
}

function resolve(root: string, phaseOrder: readonly string[] = CHAIN, executionRole?: 'author' | 'verifier', executionScope?: ExecutionScope): PhaseWriteBoundaryResolution {
  return resolvePhaseWriteBoundary({
    projectRoot: root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: FEATURE,
    phaseOrder,
    track: 'full',
    profileDir: path.join(FRAMEWORK_ROOT, 'profiles', 'hmos-app'),
    productLayerDirs: ['02-Feature'],
    executionRole,
    executionScope,
    resolveUtSourceRoots: (projectRoot, modules) =>
      modules.map((module) => path.join(projectRoot, module.package_path, 'src', 'ohosTest')),
  });
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, 'RC11 current unit owns unpredicted implementation resources while review remains read-only', () => {
    const root = makeHost();
    try {
      const resources = ['element/color.json', 'element/string.json', 'profile/route_map.json']
        .map(file => `02-Feature/Card/src/main/resources/base/${file}`);
      const boundary = resolve(root, CHAIN, 'author', constructionScope());
      const before = capturePhaseInvocationSnapshot(boundary);
      for (const resource of resources) {
        assert(resolvePhasePathOwnership(boundary, resource).owner === 'coding' && workUnitMayWritePath(boundary, resource), resource);
        write(root, resource, JSON.stringify({ current: 'implementation resource' }));
      }
      const diff = diffPhaseInvocationSnapshots(before, capturePhaseInvocationSnapshot(boundary));
      assert(diff.kind === 'changed', 'actual resource creation must be observed');
      if (diff.kind !== 'changed') return;
      assert(resources.every(file => diff.changes.some(change => change.path === file)), 'all three real resource kinds must remain in the write observation');
      assert(classifyPhaseInvocationChanges(boundary, 'coding', diff.changes).violations.length === 0, 'unpredicted resources within the authorized module are legitimate implementation');
      const reviewer = resolve(root, CHAIN, 'verifier', constructionScope());
      assert(classifyPhaseInvocationChanges(reviewer, 'review', diff.changes).violations.length === resources.length, 'independent review cannot acquire resource write authority');
      assert(!workUnitMayWritePath(boundary, '02-Feature/Other/src/main/resources/base/element/string.json'), 'an unrelated module remains outside the unit');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  });

  run(results, 'absent watch root is an empty preimage; creation is observed and read failures remain unverifiable', () => {
    const root = makeHost();
    const boundary = { ...resolve(root, CHAIN, 'verifier'), protectedRoots: ['not-created'] };
    const nativeFs = require('fs') as typeof import('fs');
    const descriptor = Object.getOwnPropertyDescriptor(nativeFs, 'lstatSync')!;
    try {
      const before = capturePhaseInvocationSnapshot(boundary);
      assert(!before.failureReason && before.entries.length === 0, 'a source directory not yet created is not an unreadable input');
      write(root, 'not-created/source.txt', 'actual unauthorized write');
      const after = capturePhaseInvocationSnapshot(boundary);
      const diff = diffPhaseInvocationSnapshots(before, after);
      assert(diff.kind === 'changed' && diff.changes.some(change => change.path === 'not-created/source.txt'), 'later creation must be observed');
      if (diff.kind === 'changed') assert(classifyPhaseInvocationChanges(boundary, 'coding', diff.changes).violations.length === 1,
        'absence never grants a verifier write authority');
      Object.defineProperty(nativeFs, 'lstatSync', { ...descriptor, value: (file: fs.PathLike, ...args: unknown[]) => {
        if (path.resolve(String(file)) === path.join(root, 'not-created')) throw Object.assign(new Error('actual read denied'), { code: 'EACCES' });
        return Reflect.apply(descriptor.value, nativeFs, [file, ...args]);
      } });
      const denied = capturePhaseInvocationSnapshot(boundary);
      assert(!!denied.failureReason && diffPhaseInvocationSnapshots(before, denied).kind === 'unverifiable', 'permission failure must not become a clean empty snapshot');
    } finally { Object.defineProperty(nativeFs, 'lstatSync', descriptor); fs.rmSync(root, { recursive: true, force: true }); }
  });

  run(results, 'contract/artifact/scope/profile resolvers yield the canonical owners', () => {
    const root = makeHost();
    const boundary = resolve(root);
    assert(resolvePhasePathOwnership(boundary, `doc/features/${FEATURE}/acceptance.yaml`).owner === 'spec',
      'acceptance must be spec-owned');
    assert(resolvePhasePathOwnership(boundary, `doc/features/${FEATURE}/plan/plan.md`).owner === 'plan',
      'plan.md must be plan-owned');
    assert(resolvePhasePathOwnership(boundary, '02-Feature/Card/src/main/ets/NewCard.ets').owner === 'coding',
      'new source under the in-scope module must be coding-owned');
    assert(resolvePhasePathOwnership(boundary, '02-Feature/Card/src/ohosTest/ets/test/New.test.ets').owner === 'ut',
      'profile UT roots must override the broader coding module prefix');
    assert(resolvePhasePathOwnership(boundary, `doc/features/${FEATURE}/testing/screens/home.png`).owner === 'testing',
      'testing workspace must be testing-owned');
  });

  run(results, 'ownership never grants source writes without approved duties and completed duties retain their original domains', () => {
    const root = makeHost();
    const source = '02-Feature/Card/src/main/ets/Card.ets', test = '02-Feature/Card/src/ohosTest/ets/test/Card.test.ets';
    const options = { projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: FEATURE, phaseOrder: ['review'], track: 'full' as const,
      profileDir: path.join(FRAMEWORK_ROOT, 'profiles', 'hmos-app'), productLayerDirs: [], executionRole: 'author' as const,
      resolveUtSourceRoots: (projectRoot: string) => [path.join(projectRoot, '02-Feature/Card/src/ohosTest')] };
    try {
      const graph = readRepairResponsibilityContracts(options);
      assert(resolvePhasePathOwnership(graph, source).owner === 'coding' && resolvePhasePathOwnership(graph, test).owner === 'ut',
        'read-only work must retain complete producer knowledge without acquiring their write grants');
      const review: ExecutionScope = { ...constructionScope(), phase_chain: ['review'], obligations: [
        { id: 'review', kind: 'code-review', owner_phase: 'review', applicability: 'required', reason: 'review existing source', basis: [] },
      ] };
      const readonly = resolvePhaseWriteBoundary({ ...options, executionScope: review });
      const pre = capturePhaseInvocationSnapshot(readonly);
      write(root, source, 'export class Card { unauthorized = true; }\n');
      write(root, test, 'export const unauthorizedTest = true;\n');
      write(root, `doc/features/${FEATURE}/review/review-report.md`, '# Actual review\n');
      const diff = diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(readonly));
      assert(diff.kind === 'changed' && diff.changes.length === 3, 'ungranted sources stay watched even without product-layer roots');
      if (diff.kind !== 'changed') return;
      const changes = classifyPhaseInvocationChanges(readonly, 'work-unit-author', diff.changes);
      assert(changes.allowed.length === 1 && changes.violations.length === 2
        && [source, test].every(file => changes.violations.some(row => row.path === file && row.violation === 'outside_authority')),
      'review evidence remains writable but neither implementation nor tests may be changed');
      const unitOnly = constructionScope(); unitOnly.obligations = unitOnly.obligations.filter(item => item.kind === 'unit-evidence');
      const testsOnly = resolvePhaseWriteBoundary({ ...options, executionScope: unitOnly });
      assert(workUnitMayWritePath(testsOnly, test) && !workUnitMayWritePath(testsOnly, source), 'unit evidence grants its original test domain, not product source');
      const completed = constructionScope(); completed.phase_chain = [];
      completed.reused_phases = completed.obligations.map(item => {
        const proof = { phase: item.owner_phase, run_id: 'prior', evidence_manifest_aggregate: 'b'.repeat(64) };
        item.satisfied_by = [proof]; return { phase: item.owner_phase, obligation_ids: [item.id], evidence_refs: [proof] };
      });
      const reusable = resolvePhaseWriteBoundary({ ...options, executionScope: completed });
      assert(workUnitMayWritePath(reusable, source) && workUnitMayWritePath(reusable, test), 'done/reused code and test duties retain their original source grants');
      const unknown = constructionScope(); unknown.obligations.forEach(item => { item.applicability = 'unknown'; });
      assert(!workUnitMayWritePath(resolvePhaseWriteBoundary({ ...options, executionScope: unknown }), source)
        && !workUnitMayWritePath(resolvePhaseWriteBoundary(options), test), 'unknown or missing scope cannot gain source writes from a method or ownership graph');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  });

  run(results, 'unknown custom phase and unregistered new paths resolve to no owner without an owner manifest', () => {
    const root = makeHost();
    const boundary = resolve(root, [...CHAIN, 'custom-export']);
    assert(boundary.diagnostics.some((item) => item.includes('custom-export') && item.includes('read-only')),
      `custom phase diagnostic missing: ${boundary.diagnostics.join(' | ')}`);
    const ownership = resolvePhasePathOwnership(boundary, `doc/features/${FEATURE}/custom-export/new.bin`);
    assert(ownership.status === 'none' && ownership.owner === null, 'unregistered custom output must have no owner');
  });

  run(results, 'multiple owners are reported explicitly with both candidates retained', () => {
    const root = makeHost();
    const boundary = resolve(root);
    const acceptance = resolvePhasePathOwnership(boundary, `doc/features/${FEATURE}/acceptance.yaml`);
    const ambiguous: PhaseWriteBoundaryResolution = {
      ...boundary,
      domains: [...boundary.domains, {
        owner: 'plan',
        kind: 'artifact',
        match: 'exact',
        path: acceptance.path,
        source: 'test duplicate producer',
      }],
    };
    const ownership = resolvePhasePathOwnership(ambiguous, acceptance.path);
    assert(ownership.status === 'multiple', `expected multiple, got ${JSON.stringify(ownership)}`);
    assert(ownership.ownerCandidates.includes('spec') && ownership.ownerCandidates.includes('plan'),
      'both candidate owners must be retained');
  });

  run(results, 'pre-existing dirty bytes are not attributed and runner projections/reports are excluded', () => {
    const root = makeHost();
    const boundary = resolve(root);
    // acceptance is already dirty before the invocation; no byte change follows.
    const pre = capturePhaseInvocationSnapshot(boundary);
    write(root, `doc/features/${FEATURE}/plan/reports/summary.json`, '{"verdict":"PASS"}\n');
    write(root, `doc/features/${FEATURE}/next.json`, '{"action":"run_phase"}\n');
    const post = capturePhaseInvocationSnapshot(boundary);
    const diff = diffPhaseInvocationSnapshots(pre, post);
    assert(diff.kind === 'clean', `unchanged dirty input and runner projections must be clean: ${JSON.stringify(diff)}`);
  });

  run(results, 'plan changing acceptance records per-file hashes and routes to spec owner', () => {
    const root = makeHost();
    const boundary = resolve(root);
    const pre = capturePhaseInvocationSnapshot(boundary);
    write(root, `doc/features/${FEATURE}/acceptance.yaml`, 'feature: owner-fixture\ncriteria:\n  - changed-by-plan\n');
    const post = capturePhaseInvocationSnapshot(boundary);
    const diff = diffPhaseInvocationSnapshots(pre, post);
    assert(diff.kind === 'changed', `expected changed snapshot: ${JSON.stringify(diff)}`);
    if (diff.kind !== 'changed') return;
    const classified = classifyPhaseInvocationChanges(boundary, 'plan', diff.changes);
    const violation = classified.violations.find((item) => item.path.endsWith('/acceptance.yaml'));
    assert(violation?.owner === 'spec' && violation.violation === 'wrong_phase',
      `expected spec backtrack violation: ${JSON.stringify(classified)}`);
    assert(/^[0-9a-f]{64}$/.test(violation?.preSha256 ?? '') && /^[0-9a-f]{64}$/.test(violation?.postSha256 ?? ''),
      'diagnostic must retain safe pre/post hashes');
  });

  run(results, 'coding source is allowed and a cross-phase source write defers to its checker', () => {
    const root = makeHost();
    const boundary = resolve(root);
    const pre = capturePhaseInvocationSnapshot(boundary);
    write(root, '02-Feature/Card/src/main/ets/NewCard.ets', 'export class NewCard {}\n');
    write(root, '02-Feature/Card/src/ohosTest/ets/test/New.test.ets', 'export default function testNew() {}\n');
    const post = capturePhaseInvocationSnapshot(boundary);
    const diff = diffPhaseInvocationSnapshots(pre, post);
    assert(diff.kind === 'changed', 'two source additions must be visible');
    if (diff.kind !== 'changed') return;
    const classified = classifyPhaseInvocationChanges(boundary, 'coding', diff.changes);
    assert(classified.allowed.some((item) => item.path.endsWith('/NewCard.ets')), 'coding source addition should be allowed');
    // plan 1741b6f2 T1: a source-role cross-phase write still resolves its owner and stays
    // fully auditable, but it no longer pre-empts the graded checker disposition.
    const utWrite = classified.observed.find((item) => item.path.endsWith('/New.test.ets'));
    assert(utWrite?.owner === 'ut' && utWrite.disposition === 'deferred_to_checker',
      `UT source addition during coding must be observed and deferred: ${JSON.stringify(classified.observed)}`);
    assert(!classified.violations.some((item) => item.path.endsWith('/New.test.ets')),
      'a source-role cross-phase write must not raise a write violation');
  });

  // plan f3b8d261 W1：UT 承接事实只可能来自 UT 调用——UT 写自己的测试根被分类为 allowed 且带
  // source 角色（runtime 据此落 `owned`）；同一路径由 coding 写，仍是 observed/deferred（上一条不改）。
  run(results, 'W1 a UT invocation writing its test root is allowed with a source role; coding writing it stays observed', () => {
    const root = makeHost();
    const boundary = resolve(root);
    const rel = '02-Feature/Card/src/ohosTest/ets/test/New.test.ets';
    const pre = capturePhaseInvocationSnapshot(boundary);
    write(root, rel, 'export default function testNew() {}\n');
    const diff = diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(boundary));
    assert(diff.kind === 'changed', 'UT addition must be visible');
    if (diff.kind !== 'changed') return;
    const asUt = classifyPhaseInvocationChanges(boundary, 'ut', diff.changes);
    const owned = asUt.allowed.find((item) => item.path === rel);
    assert(owned?.owner === 'ut' && owned.roles.some((role) => role.kind === 'source'),
      `UT write must be allowed with a source role: ${JSON.stringify(asUt)}`);
    assert(/^[0-9a-f]{64}$/.test(owned?.postSha256 ?? ''), 'allowed UT write must keep its post hash');
    const asCoding = classifyPhaseInvocationChanges(boundary, 'coding', diff.changes);
    assert(!asCoding.allowed.some((item) => item.path === rel), 'coding must never be allowed the UT root');
    assert(asCoding.observed.find((item) => item.path === rel)?.disposition === 'deferred_to_checker',
      `coding writing the UT root must stay observed/deferred: ${JSON.stringify(asCoding)}`);
  });

  run(results, 'UT write replay consumes all owned rows and only a later real UT write can re-establish its fact', () => {
    const target = 'app/tests/target.test.ts';
    const original = { type: 'phase_write_observed', phase: 'ut', owned: [{ path: target, post_sha256: 'a'.repeat(64) }] };
    const overwrite = { type: 'phase_write_observed', phase: 'coding', observations: [], owned: [
      ...Array.from({ length: 55 }, (_, i) => ({ path: `app/tests/other-${i}.test.ts`, post_sha256: 'b'.repeat(64) })),
      { path: target, post_sha256: 'a'.repeat(64) },
    ] };
    const facts = replayUtOwnedWrites([original, overwrite]);
    assert(facts.get(target)?.voidedBy === 'coding', 'an owned coding rewrite past row 50 must void the earlier producer fact even at the same bytes');
    assert(!facts.has('app/tests/other-0.test.ts'), 'a non-UT owned write cannot create a UT fact');
    const restored = replayUtOwnedWrites([original, overwrite, { ...original, owned: [{ path: target, post_sha256: 'c'.repeat(64) }] }]);
    assert(restored.get(target)?.sha256 === 'c'.repeat(64) && !restored.get(target)?.voidedBy, 'a new valid UT producer may establish the current fact');
    const legacy = replayUtOwnedWrites([original, { type: 'phase_write_observed', phase: 'testing', observations: [{ path: target }] }]);
    assert(legacy.get(target)?.voidedBy === 'testing', 'legacy observation replay keeps its existing semantics');
  });

  run(results, 'harness-written feature-root records are observed as unattributed, never violations', () => {
    const root = makeHost();
    const boundary = resolve(root);
    const pre = capturePhaseInvocationSnapshot(boundary);
    // These are exactly the paths that terminated the 2026-09-04 host run: the harness
    // derives them itself, and the artifact inventory describes skill narratives only.
    write(root, `doc/features/${FEATURE}/visual-debt.json`, '{"schema_version":"1.0","entries":[]}\n');
    write(root, `doc/features/${FEATURE}/visual-debt.md`, '# debt\n');
    write(root, `doc/features/${FEATURE}/revalidation.json`, '{"records":[]}\n');
    write(root, `doc/features/${FEATURE}/spec/notes.md`, '# notes\n');
    const post = capturePhaseInvocationSnapshot(boundary);
    const diff = diffPhaseInvocationSnapshots(pre, post);
    assert(diff.kind === 'changed', 'unregistered feature-root writes must stay visible');
    if (diff.kind !== 'changed') return;
    const classified = classifyPhaseInvocationChanges(boundary, 'spec', diff.changes);
    assert(classified.violations.length === 0,
      `unregistered paths must not be violations: ${JSON.stringify(classified.violations)}`);
    assert(classified.allowed.some(entry => entry.path === `doc/features/${FEATURE}/spec/notes.md`), 'the existing phase notes convention is an authored workspace output');
    for (const rel of ['visual-debt.json', 'visual-debt.md', 'revalidation.json']) {
      const item = classified.observed.find((entry) => entry.path.endsWith(rel));
      assert(item?.disposition === 'unattributed', `${rel} must be observed as unattributed`);
      assert(/^[0-9a-f]{64}$/.test(item?.postSha256 ?? ''), `${rel} must keep an auditable post hash`);
    }
  });

  run(results, 'a multi-owner path is observed rather than fail-closed', () => {
    const root = makeHost();
    const boundary = resolve(root);
    // Two owners for one path is a registry ambiguity, not agent misbehaviour.
    const contested = boundary.domains[0]?.path ?? '';
    assert(contested.length > 0, 'fixture must resolve at least one domain');
    const forged: PhaseWriteBoundaryResolution = {
      ...boundary,
      domains: [
        { owner: 'spec', kind: 'artifact', match: 'exact', path: contested, source: 'test:a' },
        { owner: 'plan', kind: 'artifact', match: 'exact', path: contested, source: 'test:b' },
      ],
    };
    const classified = classifyPhaseInvocationChanges(forged, 'coding', [
      { path: contested, how: 'modified', preSha256: 'a'.repeat(64), postSha256: 'b'.repeat(64) },
    ]);
    assert(classified.violations.length === 0, 'multi-owner must not be a violation');
    assert(classified.observed[0]?.disposition === 'unattributed',
      `multi-owner must be observed as unattributed: ${JSON.stringify(classified.observed)}`);
  });

  run(results, 'unit author writes implementation and test sources across methods without signing test results', () => {
    const root = makeHost();
    const boundary = resolve(root, CHAIN, 'author', constructionScope());
    const pre = capturePhaseInvocationSnapshot(boundary);
    write(root, '02-Feature/Card/src/main/ets/NewCard.ets', 'export const card = 1;\n');
    write(root, '02-Feature/Card/src/ohosTest/ets/test/New.test.ets', 'expect(card).assertEqual(1);\n');
    const diff = diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(boundary));
    assert(diff.kind === 'changed', 'cross-method source changes must be captured');
    if (diff.kind !== 'changed') return;
    for (const method of ['coding', 'ut', 'testing']) {
      const result = classifyPhaseInvocationChanges(boundary, method, diff.changes);
      assert(result.allowed.length === 2 && result.violations.length === 0,
        `source writes cannot be restricted by method ${method}: ${JSON.stringify(result)}`);
      assert(result.allowed.some(row => row.owner === 'ut' && /^[0-9a-f]{64}$/.test(row.postSha256 ?? '')),
        'source producer and byte attribution must survive cross-method execution');
    }
    const guidance = renderPhaseWriteBoundaryGuidance(boundary, 'coding').join('\n');
    assert(guidance.includes('independent assessment') && !guidance.includes('New or changed test logic belongs to UT'),
      'author guidance must preserve independent assertion checks without phase-exclusive test authorship');
  });

  run(results, 'author Skill outputs remain writable while runner products are excluded and completion stays protected', () => {
    const root = makeHost();
    const boundary = resolve(root, CHAIN, 'author');
    const pre = capturePhaseInvocationSnapshot(boundary);
    const inputs = ['coding/notes.md', 'testing/scripts/smoke.ts', 'testing/inputs/cases.json', 'testing/test-plan.md', 'testing/test-report.md',
      'device-testing/device-screenshots/shot-home.png', 'device-testing/device-screenshots/visual-diff.json'];
    const runnerProducts = ['testing/reports/run-1/hylyre/trace.json', 'ut/reports/ac-coverage.json', 'testing/phase-state.json'];
    const protectedWrites = ['feature-completion.json'];
    for (const rel of [...inputs, ...runnerProducts, ...protectedWrites]) write(root, `doc/features/${FEATURE}/${rel}`, 'PASS\n');
    const diff = diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(boundary));
    assert(diff.kind === 'changed', 'testing changes must be captured');
    if (diff.kind !== 'changed') return;
    const result = classifyPhaseInvocationChanges(boundary, 'testing', diff.changes);
    for (const rel of inputs) assert(result.allowed.some(row => row.path === `doc/features/${FEATURE}/${rel}`), `${rel} is an input`);
    for (const rel of runnerProducts) assert(!diff.changes.some(row => row.path === `doc/features/${FEATURE}/${rel}`), `${rel} is handled by its existing writer/checker`);
    for (const rel of protectedWrites) assert(result.violations.some(row => row.path === `doc/features/${FEATURE}/${rel}`
      && row.violation === 'outside_authority'), `${rel} stays protected`);
    const coverage = classifyPhaseInvocationChanges(boundary, 'coding', [{ path: `doc/features/${FEATURE}/ut/reports/ac-coverage.json`,
      how: 'added', preSha256: null, postSha256: 'a'.repeat(64) }]);
    assert(coverage.allowed.length === 1 && coverage.violations.length === 0, 'UT coverage-evidence is a declared Skill output, not a filename-based violation');
  });

  run(results, 'local design candidates are editable but original inputs, shared design and framework stay protected', () => {
    const root = makeHost();
    write(root, 'doc/architecture.md', '# Shared architecture\n');
    write(root, 'framework/runtime.ts', 'export const runtime = 1;\n');
    const boundary = { ...resolve(root, CHAIN, 'author'),
      immutableInputPaths: [`doc/features/${FEATURE}/acceptance.yaml`] };
    const paths = [`doc/features/${FEATURE}/contracts.yaml`, `doc/features/${FEATURE}/plan/plan.md`,
      `doc/features/${FEATURE}/acceptance.yaml`, 'doc/architecture.md', 'framework/runtime.ts', '02-Feature/Other/src/X.ets'];
    const result = classifyPhaseInvocationChanges(boundary, 'ut', paths.map(file => ({ path: file,
      how: 'modified' as const, preSha256: 'a'.repeat(64), postSha256: 'b'.repeat(64) })));
    assert(result.allowed.length === 2 && result.allowed.some(row => row.path.endsWith('contracts.yaml')),
      'candidate designs are not protected merely because of their filename');
    for (const file of paths.slice(2)) assert(result.violations.some(row => row.path === file), `${file} must remain protected`);
  });

  run(results, 'author runner exclusions do not relax independent verifier snapshots', () => {
    const root = makeHost();
    const boundary = resolve(root, CHAIN, 'author');
    const verifier = { ...boundary, executionRole: 'verifier' as const };
    const pre = capturePhaseInvocationSnapshot(boundary);
    const verifierPre = capturePhaseInvocationSnapshot(verifier);
    for (const rel of ['plan/reports/summary.json', 'plan/phase-state.json', 'next.json', '.current-phase.json']) {
      write(root, `doc/features/${FEATURE}/${rel}`, '{"actualTool":"PASS"}\n');
    }
    assert(diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(boundary)).kind === 'clean',
      'actual self-check runner products must not become author writes');
    const verifierDiff = diffPhaseInvocationSnapshots(verifierPre, capturePhaseInvocationSnapshot(verifier));
    assert(verifierDiff.kind === 'changed' && classifyPhaseInvocationChanges(verifier, 'questioning', verifierDiff.changes).violations.length === 4,
      'independent read-only Q still cannot alter these files');
  });

  run(results, 'author preflight excludes only the existing machine writer location and explicit protected inputs still win', () => {
    const root = makeHost();
    const file = harnessPreflightPath(root);
    const adjacent = path.join(path.dirname(file), 'framework-source.ts');
    write(root, path.relative(root, adjacent), 'export const value = 1;\n');
    const boundary = resolve(root, CHAIN, 'author');
    const verifier = { ...boundary, executionRole: 'verifier' as const };
    const protectedInput = { ...boundary, immutableInputPaths: [...(boundary.immutableInputPaths ?? []), file] };
    const pre = capturePhaseInvocationSnapshot(boundary);
    const verifierPre = capturePhaseInvocationSnapshot(verifier);
    const inputPre = capturePhaseInvocationSnapshot(protectedInput);
    emitHarnessPreflightGap(root, 'coding', { ok: false, code: 'deveco_toolchain_capability_failed', prerequisites: ['deveco_toolchain'],
      message: 'actual preflight gap', guidance_install: 'repair the fixture toolchain', guidance_stop: 'wait for the real prerequisite', evidence: [] });
    assert(diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(boundary)).kind === 'clean', 'a genuine capability preflight writer is not an author mutation');
    assert(diffPhaseInvocationSnapshots(verifierPre, capturePhaseInvocationSnapshot(verifier)).kind === 'changed', 'read-only Q receives no preflight write grant');
    const originalDiff = diffPhaseInvocationSnapshots(inputPre, capturePhaseInvocationSnapshot(protectedInput));
    assert(originalDiff.kind === 'changed' && classifyPhaseInvocationChanges(protectedInput, 'coding', originalDiff.changes).violations.length === 1,
      'a bound original at the machine path must remain explicitly protected');
    fs.appendFileSync(adjacent, '// unauthorized framework write\n');
    const adjacentDiff = diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(boundary));
    assert(adjacentDiff.kind === 'changed' && adjacentDiff.changes.length === 1
      && classifyPhaseInvocationChanges(boundary, 'coding', adjacentDiff.changes).violations.length === 1,
      'machine preflight output cannot exempt adjacent framework sources');
  });

  run(results, 'independent verifier may return only its exact result original', () => {
    const root = makeHost();
    const own = `doc/features/${FEATURE}/review/reports/invoke-1/result.json`;
    const boundary = { ...resolve(root), executionRole: 'verifier' as const, verifierResultPath: own };
    const paths = [own, `doc/features/${FEATURE}/review/reports/invoke-2/result.json`,
      '02-Feature/Card/src/main/ets/Card.ets', `doc/features/${FEATURE}/contracts.yaml`,
      `doc/features/${FEATURE}/feature-completion.json`];
    const result = classifyPhaseInvocationChanges(boundary, 'review', paths.map(file => ({ path: file,
      how: 'added' as const, preSha256: null, postSha256: 'b'.repeat(64) })));
    assert(result.allowed.length === 1 && result.allowed[0].path === own && result.violations.length === 4,
      'Q result transport must grant no product/design/evidence signing rights');
  });

  run(results, 'selected original requirements stay immutable without freezing unsuccessful candidates or read-only research dependencies', () => {
    const root = makeHost();
    const original = `doc/features/${FEATURE}/context/original.md`;
    const candidate = `doc/features/${FEATURE}/contracts.yaml`;
    const researched = '02-Feature/Card/src/main/ets/Card.ets';
    write(root, original, '# Original user request\n');
    const scope: ExecutionScope = { schema_version: '1.0', completion_target: 'feature', requested_results: ['delivery'],
      phase_chain: ['coding'], reused_phases: [], unresolved: [], policy_fingerprint: 'a'.repeat(64), obligations: [{
        id: 'implementation', kind: 'implementation', owner_phase: 'coding', applicability: 'required', reason: 'bound unit',
        basis: [original, researched].map((file, i) => ({ input_id: i === 0 ? 'requirement' : 'contracts',
          source: { kind: 'derive', provider_id: i === 0 ? 'derive.requirement' : 'derive.blueprint-contracts' },
          source_refs: [file], dependencies: [file, candidate].map(dependency => ({ path: path.join(root, dependency), exists: true, sha256: 'a'.repeat(64), role: 'derive' })),
          content_fingerprint: 'a'.repeat(64) })),
      }] };
    freezeFeatureExecutionScope({ projectRoot: root, feature: FEATURE, scope, candidateFingerprint: 'a'.repeat(64) });
    const boundary = resolve(root, CHAIN, 'author');
    assert(boundary.immutableInputPaths?.includes(original) === true && !boundary.immutableInputPaths?.includes(candidate)
      && !boundary.immutableInputPaths?.includes(researched), 'dependency attempts and research are not write authorization');
    const pre = capturePhaseInvocationSnapshot(boundary);
    write(root, original, '# Weakened request\n');
    write(root, candidate, '# local design candidate\n');
    write(root, researched, 'export class Card { improved = true; }\n');
    const diff = diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(boundary));
    assert(diff.kind === 'changed' && diff.changes.length === 3,
      'bound input protection must not vanish because its directory is named context');
    if (diff.kind !== 'changed') return;
    const writes = classifyPhaseInvocationChanges(boundary, 'coding', diff.changes);
    assert(writes.violations.length === 1 && writes.violations[0].path === original && writes.allowed.length === 2,
      'only the actual original request is immutable; local candidate and implementation remain editable');
  });

  run(results, 'typed canonical CU and blueprint sources stay protected while their local projections remain editable', () => {
    const f = blueprintFixture();
    try {
      const source = 'src/ledger/UnitSource.ts';
      write(f.root, source, 'export const value = 1;\n');
      const shared = 'doc/shared-contract.yaml';
      write(f.root, shared, 'contract: original\n');
      const blueprint = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
      blueprint.provenance.source_ref = shared;
      blueprint.design_views.find((view: { nodes?: unknown[] }) => view.nodes?.length).nodes[0].provenance.source_ref = source;
      fs.writeFileSync(f.blueprintFile, YAML.stringify(blueprint)); f.bind();
      const boundary = resolvePhaseWriteBoundary({ projectRoot: f.root, frameworkRoot: FRAMEWORK_ROOT, feature: f.feature,
        phaseOrder: CHAIN, track: 'full', profileDir: path.join(FRAMEWORK_ROOT, 'profiles/generic'), productLayerDirs: ['src'],
        executionRole: 'author', executionScope: constructionScope(), constructionModules: [{ name: 'ledger', package_path: 'src/ledger' }] });
      const contracts = path.relative(f.root, path.join(path.dirname(f.cuFile), 'contracts.yaml')).replace(/\\/g, '/');
      assert(boundary.immutableInputPaths?.includes(path.relative(f.root, f.blueprintFile).replace(/\\/g, '/')) === true
        && boundary.immutableInputPaths?.includes(path.relative(f.root, f.cuFile).replace(/\\/g, '/')) === true,
        'canonical paths come from existing CU identity and typed blueprint refs');
      assert(!boundary.immutableInputPaths?.includes(contracts), 'a local derived contract is not the shared canonical source');
      assert(boundary.immutableInputPaths?.includes(shared) === true && !boundary.immutableInputPaths?.includes(source),
        'shared declared source fragments stay protected while ordinary implementation research remains editable');
      const pre = capturePhaseInvocationSnapshot(boundary);
      write(f.root, contracts, '# local projection refinement\n');
      write(f.root, source, 'export const value = 2;\n');
      fs.appendFileSync(f.blueprintFile, '\n# unauthorized shared write\n');
      fs.appendFileSync(f.cuFile, '\n# unauthorized canonical write\n');
      write(f.root, shared, 'contract: unauthorized\n');
      const diff = diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(boundary));
      assert(diff.kind === 'changed', JSON.stringify(diff));
      if (diff.kind !== 'changed') return;
      const classified = classifyPhaseInvocationChanges(boundary, 'plan', diff.changes);
      assert(classified.allowed.length === 2 && classified.violations.length === 3, JSON.stringify(classified));
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  });

  run(results, 'current run completion original is captured even when its parent run directory is runtime-excluded', () => {
    const root = makeHost();
    const runDir = `doc/features/${FEATURE}/goal-runs/current`;
    const completion = `${runDir}/feature-completion.json`;
    const boundary = { ...resolve(root, CHAIN, 'author'),
      immutableInputPaths: workUnitProtectedRecordPaths(root, FEATURE, runDir) };
    const options = { runtimeExcluded: [runDir] };
    const pre = capturePhaseInvocationSnapshot(boundary, options);
    write(root, `${runDir}/events.jsonl`, '{"type":"real_runtime_event"}\n');
    write(root, completion, '{"verdict":"PASS"}\n');
    const diff = diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(boundary, options));
    assert(diff.kind === 'changed' && diff.changes.length === 1 && diff.changes[0].path === completion,
      `formal completion cannot be hidden by its parent runtime exclusion: ${JSON.stringify(diff)}`);
    if (diff.kind !== 'changed') return;
    const result = classifyPhaseInvocationChanges(boundary, 'coding', diff.changes);
    assert(result.violations.length === 1 && result.violations[0].violation === 'outside_authority',
      'writing the actual completion original must be rejected');
  });

  return results;
}
