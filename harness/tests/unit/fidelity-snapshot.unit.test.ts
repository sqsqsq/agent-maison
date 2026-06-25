// ============================================================================
// fidelity-snapshot.unit.test.ts — 在线高保真快照 lock / 离线校验 / 结构化分母
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import {
  FIDELITY_LOCK_SCHEMA_VERSION,
  hasFidelitySnapshotPromise,
  loadFidelityLock,
  mergeLockScreensIntoById,
  resolveLockScreenPngAbs,
  validateFidelityLockDoc,
  writeFidelityLock,
  type FidelityLockDoc,
} from '../../scripts/utils/fidelity-lock-shared';
import {
  buildAuthoritativeRefImageIndex,
  checkAuthoritativeRefLockConflicts,
  resolveRefSourceImage,
} from '../../../profiles/hmos-app/harness/authoritative-ref-images';
import { checkFidelitySnapshotPromise } from '../../../profiles/hmos-app/harness/fidelity-snapshot-check';
import { checkCaptureCompleteness } from '../../../profiles/hmos-app/harness/capture-completeness-check';
import {
  checkStructuredRefElements,
  deriveStructuredRefElements,
  normalizeStructuredElementId,
} from '../../../profiles/hmos-app/harness/structured-ref-elements';
import type { CheckContext, PhaseRuleSpec } from '../../scripts/utils/types';
import { DEFAULT_LAYOUT } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function stubPhaseRule(): PhaseRuleSpec {
  return {
    phase: 'spec',
    structure_checks: {
      fidelity_snapshot_promise: { description: 'fidelity snapshot promise' },
      structured_ref_elements: { description: 'structured ref elements' },
    },
  } as unknown as PhaseRuleSpec;
}

function mkProject(feature = 'bank-card'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-snap-'));
  fs.mkdirSync(path.join(root, 'doc', 'features', feature, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0',
    project_name: 'demo',
    project_type: 'app',
    project_profile: { name: 'hmos-app' },
    agent_adapter: 'cursor',
    architecture: {
      outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false },
  }), 'utf-8');
  return root;
}

function baseCtx(root: string, feature = 'bank-card', o: Partial<CheckContext> = {}): CheckContext {
  clearFrameworkConfigCache();
  const fw = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'));
  const resolvedProfile = loadResolvedProfile(root, fw);
  return {
    phase: 'spec',
    feature,
    projectRoot: root,
    frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
    frameworkRel: DEFAULT_LAYOUT.frameworkRel,
    harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
    layoutKind: DEFAULT_LAYOUT.kind,
    phaseRule: stubPhaseRule(),
    featureSpec: { feature },
    resolvedProfile,
    ...o,
  };
}

function cacheDir(root: string, feature: string): string {
  return path.join(root, 'doc', 'features', feature, 'ux-reference', '_fidelity-cache');
}

function writeLockAndPng(
  root: string,
  feature: string,
  screens: Array<{ id: string; png: string }>,
  extra: Partial<FidelityLockDoc> = {},
): string {
  const dir = cacheDir(root, feature);
  fs.mkdirSync(dir, { recursive: true });
  for (const s of screens) {
    fs.writeFileSync(path.join(dir, s.png), MINIMAL_PNG);
  }
  const doc: FidelityLockDoc = {
    schema_version: FIDELITY_LOCK_SCHEMA_VERSION,
    source_link: extra.source_link ?? 'https://stub.example/design',
    fetched_at: '2026-06-25T00:00:00.000Z',
    version_id: 'stub-v1',
    viewport: { w: 393, h: 852, dpr: 3 },
    screens: screens.map(s => ({ id: s.id, png: s.png })),
    ...extra,
  };
  writeFidelityLock(path.join(dir, 'fidelity.lock.yaml'), doc);
  return dir;
}

function fidelitySpecMd(sourceLink = 'https://stub.example/design'): string {
  return [
    '```yaml',
    'ui_change: new_or_changed',
    'fidelity_target: pixel_1to1',
    'visual_handoff:',
    '  kind: fidelity_snapshot',
    `  source_link: ${sourceLink}`,
    '  snapshot: doc/features/bank-card/ux-reference/_fidelity-cache/',
    '```',
  ].join('\n');
}

function writeUiSpec(root: string, feature: string, refIds: string[]): void {
  const lines = [
    'schema_version: "1.0"',
    'verified: human_confirmed',
    'screens:',
    ...refIds.map((id, i) => [
      `  - id: ${id}`,
      '    priority: P0',
      `    ref_id: ${id}`,
      '    root:',
      '      type: navigation_frame',
      `      order: ${i}`,
    ].join('\n')),
    'tokens: {}',
    'assets: []',
  ];
  fs.writeFileSync(
    path.join(root, 'doc', 'features', feature, 'spec', 'ui-spec.yaml'),
    lines.join('\n'),
    'utf-8',
  );
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  const run = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: (e as Error).message });
    }
  };

  run('validateFidelityLockDoc_rejects_empty_screens', () => {
    const { doc, errors } = validateFidelityLockDoc({ schema_version: '1.0', screens: [] });
    if (doc) throw new Error('expected null doc');
    if (!errors.some(e => e.includes('screens'))) throw new Error(String(errors));
  });

  run('hasFidelitySnapshotPromise_silent_without_source_link', () => {
    const md = '```yaml\nui_change: new_or_changed\nvisual_handoff:\n  kind: repo_assets\n```\n';
    if (hasFidelitySnapshotPromise(md)) throw new Error('should be silent');
  });

  run('hasFidelitySnapshotPromise_true_with_source_link', () => {
    if (!hasFidelitySnapshotPromise(fidelitySpecMd())) throw new Error('expected promise');
  });

  run('mergeLockScreensIntoById_lock_wins_conflict', () => {
    const byId = new Map<string, string>([['home', '/old/home.png']]);
    const lock: FidelityLockDoc = {
      schema_version: FIDELITY_LOCK_SCHEMA_VERSION,
      screens: [{ id: 'home', png: 'home.png' }],
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-merge-'));
    try {
      fs.writeFileSync(path.join(dir, 'home.png'), MINIMAL_PNG);
      const { conflicts, merged } = mergeLockScreensIntoById(byId, dir, lock);
      if (merged !== 1 || conflicts.length !== 1) throw new Error(JSON.stringify({ conflicts, merged }));
      if (!byId.get('home')?.endsWith('home.png')) throw new Error(byId.get('home') ?? 'missing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  run('buildAuthoritativeRefImageIndex_reads_lock_byId', () => {
    const root = mkProject();
    try {
      writeLockAndPng(root, 'bank-card', [{ id: 'home', png: 'home.png' }]);
      const specMd = fidelitySpecMd();
      const idx = buildAuthoritativeRefImageIndex(baseCtx(root), specMd);
      const resolved = resolveRefSourceImage(idx, 'home');
      if (!resolved.path || !fs.existsSync(resolved.path)) {
        throw new Error(`byId miss: ${JSON.stringify(resolved)} conflicts=${idx.lockIdConflicts.join(',')}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('checkFidelitySnapshotPromise_fail_missing_lock', () => {
    const root = mkProject();
    try {
      writeUiSpec(root, 'bank-card', ['home']);
      const r = checkFidelitySnapshotPromise(baseCtx(root, 'bank-card', { fidelityTarget: 'pixel_1to1' }), fidelitySpecMd());
      const hit = r.find(x => x.id === 'fidelity_snapshot_promise' && x.status === 'FAIL');
      if (!hit) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('checkFidelitySnapshotPromise_pass_complete_snapshot', () => {
    const root = mkProject();
    try {
      writeUiSpec(root, 'bank-card', ['home', 'page2']);
      writeLockAndPng(root, 'bank-card', [
        { id: 'home', png: 'home.png' },
        { id: 'page2', png: 'page2.png' },
      ]);
      const r = checkFidelitySnapshotPromise(baseCtx(root), fidelitySpecMd());
      const hit = r.find(x => x.id === 'fidelity_snapshot_promise' && x.status === 'PASS');
      if (!hit) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('checkFidelitySnapshotPromise_fail_partial_snapshot', () => {
    const root = mkProject();
    try {
      writeUiSpec(root, 'bank-card', ['home', 'page2']);
      writeLockAndPng(root, 'bank-card', [{ id: 'home', png: 'home.png' }]);
      const r = checkFidelitySnapshotPromise(baseCtx(root, 'bank-card', { fidelityTarget: 'pixel_1to1' }), fidelitySpecMd());
      const hit = r.find(x => x.id === 'fidelity_snapshot_promise' && x.status === 'FAIL');
      if (!hit || !hit.details?.includes('page2')) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('normalizeStructuredElementId_maps_figma_node', () => {
    const uiIds = new Set(['search_bar']);
    const mapped = normalizeStructuredElementId(
      { source_node_ref: 'Frame 1207', text: '搜索' },
      { 'Frame 1207': 'search_bar' },
      uiIds,
    );
    if (mapped.id !== 'search_bar' || mapped.unmapped) throw new Error(JSON.stringify(mapped));
  });

  run('deriveStructuredRefElements_skips_unmapped', () => {
    const uiIds = new Set(['search_bar']);
    const derived = deriveStructuredRefElements({
      elements: [
        { element_id: 'search_bar', text: '搜索', disposition: 'implement' },
        { source_node_ref: 'UnknownFrame', text: 'x', disposition: 'implement' },
      ],
    }, uiIds);
    if (derived.length !== 1 || derived[0].provenance !== 'structured') {
      throw new Error(JSON.stringify(derived));
    }
  });

  run('checkStructuredRefElements_injects_memory_manifest', () => {
    const root = mkProject();
    try {
      writeUiSpec(root, 'bank-card', ['home']);
      const dir = cacheDir(root, 'bank-card');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'structured-elements.yaml'), [
        'schema_version: "1.0"',
        'node_to_semantic_id:',
        '  "Frame 1207": search_bar',
        'elements:',
        '  - element_id: search_bar',
        '    text: 搜索',
        '    disposition: implement',
      ].join('\n'));
      writeLockAndPng(root, 'bank-card', [{ id: 'home', png: 'home.png' }], {
        structured_bundle: 'structured-elements.yaml',
      });
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: search_bar',
        '          type: content_display',
        '          order: 0',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const ctx = baseCtx(root);
      const r = checkStructuredRefElements(ctx, fidelitySpecMd());
      const hit = r.find(x => x.id === 'structured_ref_elements' && x.status === 'PASS');
      if (!hit) throw new Error(JSON.stringify(r));
      const refPath = path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ref-elements.yaml');
      if (fs.existsSync(refPath)) throw new Error('ref-elements.yaml must not be written by verify check');
      if (!ctx.refElementsManifest?.some(e => e.element_id === 'search_bar')) {
        throw new Error(`missing manifest: ${JSON.stringify(ctx.refElementsManifest)}`);
      }
      const cap = checkCaptureCompleteness(ctx, fidelitySpecMd());
      const capHit = cap.find(x => x.id === 'capture_completeness' && x.status === 'PASS');
      if (!capHit || !capHit.details?.includes('内存 manifest')) {
        throw new Error(JSON.stringify(cap));
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('buildAuthoritativeRefImageIndex_lock_wins_after_repo_assets_block', () => {
    const root = mkProject();
    try {
      writeLockAndPng(root, 'bank-card', [{ id: 'home', png: 'home.png' }]);
      const otherPng = path.join(root, 'other-home.png');
      fs.writeFileSync(otherPng, MINIMAL_PNG);
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'visual_handoff:',
        '  kind: fidelity_snapshot',
        '  source_link: https://stub.example/design',
        '```',
        '```yaml',
        'ui_change: new_or_changed',
        'visual_handoff:',
        '  kind: repo_assets',
        '  authoritative_refs:',
        '    - id: home',
        `      path: ${otherPng.replace(/\\/g, '/')}`,
        '```',
      ].join('\n');
      const idx = buildAuthoritativeRefImageIndex(
        baseCtx(root, 'bank-card', { specVisualSources: { allow_absolute_paths: true } }),
        specMd,
      );
      const resolved = resolveRefSourceImage(idx, 'home');
      if (!resolved.path?.endsWith('home.png') || resolved.path.includes('other-home')) {
        throw new Error(`lock should win: ${resolved.path}`);
      }
      if (!idx.lockIdConflicts.includes('home')) {
        throw new Error(`expected conflict recorded: ${idx.lockIdConflicts.join(',')}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('checkAuthoritativeRefLockConflicts_emits_warn', () => {
    const root = mkProject();
    try {
      writeLockAndPng(root, 'bank-card', [{ id: 'home', png: 'home.png' }]);
      const otherPng = path.join(root, 'other-home.png');
      fs.writeFileSync(otherPng, MINIMAL_PNG);
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'visual_handoff:',
        '  kind: repo_assets',
        '  authoritative_refs:',
        '    - id: home',
        `      path: ${otherPng.replace(/\\/g, '/')}`,
        '```',
        fidelitySpecMd(),
      ].join('\n');
      const r = checkAuthoritativeRefLockConflicts(
        baseCtx(root, 'bank-card', { specVisualSources: { allow_absolute_paths: true } }),
        specMd,
      );
      const hit = r.find(x => x.id === 'authoritative_ref_lock_conflict' && x.status === 'WARN');
      if (!hit || !hit.details?.includes('home')) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('resolveLockScreenPngAbs_rejects_outside_cache', () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-png-'));
    try {
      const outside = path.join(os.tmpdir(), 'outside-fid.png');
      const abs = resolveLockScreenPngAbs(cache, { id: 'x', png: outside });
      if (abs !== null) throw new Error(`expected null for outside path, got ${abs}`);
    } finally {
      fs.rmSync(cache, { recursive: true, force: true });
    }
  });

  run('loadFidelityLock_roundtrip', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-lock-'));
    try {
      const lockPath = path.join(dir, 'fidelity.lock.yaml');
      const doc: FidelityLockDoc = {
        schema_version: FIDELITY_LOCK_SCHEMA_VERSION,
        screens: [{ id: 'a', png: 'a.png' }],
        viewport: { w: 100, h: 200, dpr: 2 },
      };
      writeFidelityLock(lockPath, doc);
      const { doc: loaded, errors } = loadFidelityLock(lockPath);
      if (errors.length || !loaded?.viewport?.dpr) throw new Error(JSON.stringify({ loaded, errors }));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  return results;
}
