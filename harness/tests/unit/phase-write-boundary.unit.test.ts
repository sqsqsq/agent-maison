import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  capturePhaseInvocationSnapshot,
  classifyPhaseInvocationChanges,
  diffPhaseInvocationSnapshots,
  resolvePhasePathOwnership,
  resolvePhaseWriteBoundary,
  type PhaseWriteBoundaryResolution,
} from '../../scripts/utils/phase-write-boundary';
import type { UnitCaseResult } from '../run-unit';

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

function resolve(root: string, phaseOrder: readonly string[] = CHAIN): PhaseWriteBoundaryResolution {
  return resolvePhaseWriteBoundary({
    projectRoot: root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: FEATURE,
    phaseOrder,
    track: 'full',
    profileDir: path.join(FRAMEWORK_ROOT, 'profiles', 'hmos-app'),
    productLayerDirs: ['02-Feature'],
    resolveUtSourceRoots: (projectRoot, modules) =>
      modules.map((module) => path.join(projectRoot, module.package_path, 'src', 'ohosTest')),
  });
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

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
    for (const rel of ['visual-debt.json', 'visual-debt.md', 'revalidation.json', 'notes.md']) {
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

  return results;
}
