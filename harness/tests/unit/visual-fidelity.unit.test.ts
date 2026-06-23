// ============================================================================
// visual-fidelity.unit.test.ts — 视觉保真 review 修复回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { clearFrameworkConfigCache } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { checkUiSpecFidelityGate } from '../../../profiles/hmos-app/harness/spec-ui-spec-check';
import { checkVisualDiff, validateVisualDiffJson } from '../../../profiles/hmos-app/harness/visual-diff-check';
import { cropAssetFromBbox, isJimpAvailable, sampleColorFromBbox } from '../../../profiles/hmos-app/harness/image-toolkit';
import { collectUiSpecGateConfirmedScreens } from '../../../profiles/hmos-app/harness/ui-spec-gate';
import {
  loadVisualParityMappings,
  computeStructureSequenceScore,
  mappedComponentSequenceForScreen,
  mappingCoverageForScreen,
} from '../../../profiles/hmos-app/harness/visual-structure-parity';
import {
  buildAuthoritativeRefImageIndex,
  resolveRefSourceImage,
} from '../../../profiles/hmos-app/harness/authoritative-ref-images';
import { checkAssetAcquisition } from '../../../profiles/hmos-app/harness/asset-acquisition';
import type { CheckContext, PhaseRuleSpec } from '../../scripts/utils/types';
import { DEFAULT_LAYOUT } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function stubPhaseRule(): PhaseRuleSpec {
  return {
    phase: 'spec',
    structure_checks: {
      ui_spec_fidelity_gate: { description: 'gate' },
      visual_diff: { description: 'visual diff' },
      asset_acquisition: { description: 'asset acquisition' },
    },
  } as unknown as PhaseRuleSpec;
}

function baseCtx(root: string, o: Partial<CheckContext> = {}): CheckContext {
  clearFrameworkConfigCache();
  const fw = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'));
  const resolvedProfile = loadResolvedProfile(root, fw);
  return {
    phase: 'testing',
    feature: 'bank-card',
    projectRoot: root,
    frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
    frameworkRel: DEFAULT_LAYOUT.frameworkRel,
    harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
    layoutKind: DEFAULT_LAYOUT.kind,
    phaseRule: stubPhaseRule(),
    featureSpec: { feature: 'bank-card' },
    resolvedProfile,
    ...o,
  };
}

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-unit-'));
  fs.mkdirSync(path.join(root, 'doc', 'features', 'bank-card', 'spec'), { recursive: true });
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
    paths: { features_dir: 'doc/features' },
  }), 'utf-8');
  return root;
}

function writeMinimalColorPng(outPath: string, w: number, h: number, rgba: number): void {
  if (!isJimpAvailable()) throw new Error('jimp required for png fixture');
  const harnessRoot = path.resolve(__dirname, '../..');
  const r = spawnSync(process.execPath, ['-e', `
    const Jimp=require('jimp');
    new Jimp(${w}, ${h}, ${rgba}).writeAsync(${JSON.stringify(outPath)}).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
  `], { encoding: 'utf-8', cwd: harnessRoot });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'png gen failed');
}

function writeMinimalRedPng(outPath: string, w = 40, h = 40): void {
  writeMinimalColorPng(outPath, w, h, 0xff0000ff);
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

  run('gate_collect_x_markers', () => {
    const s = collectUiSpecGateConfirmedScreens('- [x] home\n| bank-list | ok | [x] |');
    if (!s.has('home') || !s.has('bank-list')) throw new Error(String([...s]));
  });

  run('gate_human_confirmed_without_x_fail', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const specMd = ['```yaml', 'ui_change: new_or_changed', '```'].join('\n');
      const r = checkUiSpecFidelityGate(baseCtx(root), specMd);
      const hit = r.find((x: { id: string; status: string }) => x.id === 'ui_spec_fidelity_gate' && x.status === 'FAIL');
      if (!hit) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('visual_diff_invalid_json_fail', () => {
    const root = mkProject();
    try {
      const dir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'), '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      fs.writeFileSync(path.join(dir, 'visual-diff.json'), '{not json');
      const r = checkVisualDiff(baseCtx(root));
      const hit = r.find((x: { id: string; status: string }) => x.id === 'visual_diff' && x.status === 'FAIL');
      if (!hit) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('visual_diff_schema_rejects_empty_screens', () => {
    const v = validateVisualDiffJson({ schema_version: '1', screens: [] }, '/tmp');
    if (v.ok) throw new Error('expected fail');
  });

  run('visual_diff_fake_pass_rejected', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const shot = path.join(root, 'fake-shot.png');
      writeMinimalRedPng(shot, 10, 10);
      const absShot = shot.replace(/\\/g, '/');
      const v = validateVisualDiffJson({
        schema_version: '1.0',
        screens: [{
          screen_id: 'home',
          verdict: 'pass',
          screenshot_path: absShot,
          ref_id: 'ghost-ref',
        }],
      }, root);
      if (v.ok) throw new Error('missing fidelity_score should fail');
      const v2 = validateVisualDiffJson({
        schema_version: '1.0',
        screens: [{
          screen_id: 'home',
          verdict: 'pass',
          screenshot_path: absShot,
          ref_id: 'ghost-ref',
          fidelity_score: 0.99,
          geometric_iou: 0.95,
        }],
      }, root, { authoritativeRefIds: new Set(['real-ref']) });
      if (v2.ok) throw new Error('unknown ref_id should fail');
      const v3 = validateVisualDiffJson({
        schema_version: '1.0',
        screens: [{
          screen_id: 'home',
          verdict: 'pass',
          screenshot_path: absShot,
          ref_id: 'home',
          fidelity_score: 999,
          geometric_iou: -3,
        }],
      }, root, { authoritativeRefIds: new Set(['home']) });
      if (v3.ok) throw new Error('out of range scores should fail');
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('visual_parity_mappings_nested_components', () => {
    // 验证嵌套 mappings.components 能被正确加载并参与结构分计算（而非顶层 components 误读）
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-nest-'));
    try {
      const vpDir = path.join(root, 'doc', 'features', 'demo', 'plan');
      fs.mkdirSync(vpDir, { recursive: true });
      fs.writeFileSync(path.join(vpDir, 'visual-parity.yaml'), [
        'mappings:',
        '  components:',
        '    - ui_spec_node_id: home',
        '      contract_component: BankCardPage',
        '    - ui_spec_node_id: btn_add',
        '      contract_component: AddCardButton',
      ].join('\n'));
      const mappings = loadVisualParityMappings(root, 'demo');
      if (!mappings?.components?.length) throw new Error('nested mappings not loaded');
      // 全量映射（screen + 子节点）→ LCS=100% 覆盖=100% → ratio=1
      const score = computeStructureSequenceScore(
        {
          schema_version: '1.0',
          screens: [{
            id: 'home',
            priority: 'P0',
            root: {
              type: 'navigation_frame',
              order: 0,
              children: [{ id: 'btn_add', type: 'action_button', order: 0 }],
            },
          }],
          tokens: {},
          assets: [],
        },
        mappings,
        new Set(['BankCardPage', 'AddCardButton']),
      );
      if (!score || score.ratio < 1) throw new Error(JSON.stringify(score));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('struct_score_unmapped_child_not_full', () => {
    // 仅映射 screen 根节点、漏掉子节点（含无 id 子节点）→ 覆盖率不足，不得记满分
    const mappings = { components: [{ ui_spec_node_id: 'home', contract_component: 'BankCardPage' }] };
    const score = computeStructureSequenceScore(
      {
        schema_version: '1.0',
        screens: [{
          id: 'home',
          priority: 'P0',
          root: {
            type: 'navigation_frame',
            order: 0,
            children: [
              { id: 'btn_add', type: 'action_button', order: 0 },
              { type: 'content_display', order: 1 }, // 无 id：无法映射，仍计入分母
            ],
          },
        }],
        tokens: {},
        assets: [],
      },
      mappings,
      new Set(['BankCardPage', 'AddCardButton']),
    );
    if (!score) throw new Error('expected score object');
    if (score.ratio >= 1) throw new Error(`漏映射子节点不应满分，got ratio=${score.ratio}`);
  });

  run('visual_diff_low_score_pass_downgraded', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      const shot = path.join(ddir, 'shot-home.png');
      writeMinimalRedPng(shot, 10, 10);
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      fs.writeFileSync(path.join(ddir, 'visual-diff.json'), JSON.stringify({
        schema_version: '1.0',
        screens: [{
          screen_id: 'home',
          verdict: 'pass',
          screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
          ref_id: 'home',
          fidelity_score: 0,
          geometric_iou: 0,
        }],
      }));
      const r = checkVisualDiff(baseCtx(root));
      const hit = r.find((x: { id: string; status: string }) => x.id === 'visual_diff');
      if (!hit || hit.status === 'PASS') throw new Error(`low-score pass should not PASS: ${JSON.stringify(hit)}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('visual_diff_all_skipped_not_pass', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      const shot = path.join(ddir, 'shot-home.png');
      writeMinimalRedPng(shot, 10, 10);
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      fs.writeFileSync(path.join(ddir, 'visual-diff.json'), JSON.stringify({
        schema_version: '1.0',
        screens: [{
          screen_id: 'home',
          verdict: 'skipped',
          screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
          ref_id: 'home',
        }],
      }));
      const r = checkVisualDiff(baseCtx(root));
      const hit = r.find((x: { id: string; status: string }) => x.id === 'visual_diff');
      if (!hit || hit.status === 'PASS') throw new Error(`all skipped should not PASS: ${JSON.stringify(hit)}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('authoritative_ref_source_ref_routing', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const uxDir = path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ux');
      fs.mkdirSync(uxDir, { recursive: true });
      const homePng = path.join(uxDir, 'home.png');
      const page2Png = path.join(uxDir, 'page2.png');
      writeMinimalRedPng(homePng, 20, 20);
      writeMinimalColorPng(page2Png, 20, 20, 0x0000ffff);
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'visual_handoff:',
        '  kind: repo_assets',
        '  authoritative_refs:',
        '    - id: home',
        `      path: doc/features/bank-card/spec/ux/home.png`,
        '    - id: page2',
        `      path: doc/features/bank-card/spec/ux/page2.png`,
        '```',
      ].join('\n');
      const ctx = baseCtx(root);
      const index = buildAuthoritativeRefImageIndex(ctx, specMd);
      const pickHome = resolveRefSourceImage(index, 'home');
      const pickPage2 = resolveRefSourceImage(index, 'page2');
      if (path.resolve(pickHome.path!) !== path.resolve(homePng)) {
        throw new Error(`home pick ${pickHome.path} != ${homePng}`);
      }
      if (path.resolve(pickPage2.path!) !== path.resolve(page2Png)) {
        throw new Error(`page2 pick ${pickPage2.path} != ${page2Png}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('asset_acquisition_path_escape_skipped', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const uxDir = path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ux');
      fs.mkdirSync(uxDir, { recursive: true });
      const homePng = path.join(uxDir, 'home.png');
      writeMinimalRedPng(homePng, 30, 30);
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'), [
        '```yaml',
        'ui_change: new_or_changed',
        'visual_handoff:',
        '  kind: repo_assets',
        '  authoritative_refs:',
        '    - id: home',
        '      path: doc/features/bank-card/spec/ux/home.png',
        '```',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        'tokens: {}',
        'assets:',
        '  - key: evil',
        '    acquisition: crop',
        '    source_ref: home',
        '    source_bbox: [0.1, 0.1, 0.2, 0.2]',
        '    human_crop_confirmed: true',
        '    resolved_path: ../../../../../../etc/evil.png',  // 逃逸
      ].join('\n'));
      const r = checkAssetAcquisition(baseCtx(root, { feature: 'bank-card' }));
      const hit = r.find((x: { id: string; details?: string; status?: string }) => x.id === 'asset_acquisition');
      if (!hit || hit.status !== 'WARN' || !/逃逸/.test(hit.details ?? '')) {
        throw new Error(`expected path-escape WARN: ${JSON.stringify(r)}`);
      }
      // 确认没有写到 project-root 外
      if (fs.existsSync(path.resolve(root, '../../../../../../etc/evil.png'))) {
        throw new Error('escaped file was written!');
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('struct_score_duplicate_id_not_full', () => {
    // 两子节点共用 id → mapped 序不得重复计数同一映射
    const mappings = {
      components: [
        { ui_spec_node_id: 'home', contract_component: 'BankCardPage' },
        { ui_spec_node_id: 'dup', contract_component: 'AddCardButton' },
      ],
    };
    const mapped = mappedComponentSequenceForScreen(
      {
        id: 'home',
        priority: 'P0',
        root: {
          type: 'navigation_frame',
          order: 0,
          children: [
            { id: 'dup', type: 'action_button', order: 0 },
            { id: 'dup', type: 'action_button', order: 1 },
          ],
        },
      },
      mappings,
    );
    if (mapped.length !== 2 || mapped.filter(x => x === 'AddCardButton').length !== 1) {
      throw new Error(`duplicate id must not double-count mapping: ${JSON.stringify(mapped)}`);
    }
    const cov = mappingCoverageForScreen(
      {
        id: 'home',
        priority: 'P0',
        root: {
          type: 'navigation_frame',
          order: 0,
          children: [
            { id: 'dup', type: 'action_button', order: 0 },
            { id: 'dup', type: 'action_button', order: 1 },
          ],
        },
      },
      mappings,
    );
    if (cov.mapped !== 2 || cov.mappable !== 2) {
      throw new Error(`duplicate id coverage inflated: ${JSON.stringify(cov)}`);
    }
  });

  run('jimp_crop_and_sample_xywh', () => {
    if (!isJimpAvailable()) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jimp-'));
    try {
      const src = path.join(root, 'src.png');
      const out = path.join(root, 'crop.png');
      writeMinimalRedPng(src, 100, 100);
      const crop = cropAssetFromBbox(src, [0.2, 0.2, 0.4, 0.4], out);
      if (!crop.ok || !fs.existsSync(out)) throw new Error(`crop failed: ${crop.error}`);
      const sample = sampleColorFromBbox(src, [0.35, 0.35, 0.1, 0.1]);
      if (!sample.sampled || sample.hex !== '#FF0000') {
        throw new Error(`sample got ${JSON.stringify(sample)}`);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  return results;
}
