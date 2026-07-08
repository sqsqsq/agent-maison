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
import { checkVisualDiff, validateVisualDiffJson, hashScreenshotFile } from '../../../profiles/hmos-app/harness/visual-diff-check';
import { buildVisualDiffMdBody, captureVisualDiff, collectDuplicateHashGroups, mergeCapturedScreenEntry, mergeVisualDiffReports, resolveShotPaths, sanitizeVisualDiffScreenSlug } from '../../../profiles/hmos-app/harness/visual-diff-capture';
import { cropAssetFromBbox, computeHistogramSimilarity, isJimpAvailable, sampleColorFromBbox } from '../../../profiles/hmos-app/harness/image-toolkit';
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
import { checkFidelityGovernance } from '../../../profiles/hmos-app/harness/fidelity-governance-check';
import { checkCaptureCompleteness, checkCaptureStyleFields } from '../../../profiles/hmos-app/harness/capture-completeness-check';
import { checkAssetManifest } from '../../../profiles/hmos-app/harness/asset-manifest-check';
import { collectSemanticColorBindingIssues, collectVariantParityIssues, hasSolidButtonBackground } from '../../../profiles/hmos-app/harness/visual-parity-backstop';
import { extractStructBody, scanStructResourceRefs, collectResourceRefsInActiveCode } from '../../../profiles/hmos-app/harness/source-ref-scan';
import { loadUiSpecFile, uiSpecAbsPath } from '../../../harness/scripts/utils/ui-spec-shared';
import {
  detectPixel1to1Intent,
  isAutomationSigner,
  USER_REQUIREMENT_CONFIRMER,
  clampFidelityByCapability,
  resolveEffectiveFidelityContext,
  isPixel1to1,
  fidelityRatchetFailOrWarn,
  detectUiRelevantRequirement,
  discoverReferenceImagesForOcrPrescan,
  loadProfileOcrToolkit,
  probeProfileOcrAvailable,
  resolveOcrAvailableForRun,
} from '../../scripts/utils/fidelity-shared';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';
import { validateUiSpecSchema, BUTTON_VARIANT_ENUM, ALIGN_ENUM } from '../../../profiles/hmos-app/harness/ui-spec-schema-validate';
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

  // G1：headless + pixel_1to1 下 verified: human_confirmed 系自报人工（即便 spec 有 [x]）→ BLOCKER
  run('ui_spec_human_confirmed_headless_self_cert_blocker', () => {
    const root = mkProject();
    const prevHeadless = process.env.MAISON_GOAL_HEADLESS;
    try {
      process.env.MAISON_GOAL_HEADLESS = '1';
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'verified_method: human_gate',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      // spec.md 含逐屏 [x]（普通态会 PASS）；headless + pixel_1to1 下应判 BLOCKER
      const specMd = ['```yaml', 'ui_change: new_or_changed', 'fidelity_target: pixel_1to1', '```', '', '- [x] home'].join('\n');
      const r = checkUiSpecFidelityGate(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      const hit = r.find((x: { id: string; severity?: string; status: string }) =>
        x.id === 'ui_spec_fidelity_gate' && x.status === 'FAIL' && x.severity === 'BLOCKER');
      if (!hit) throw new Error('headless 自报 human_confirmed 未判 BLOCKER：' + JSON.stringify(r));
    } finally {
      if (prevHeadless === undefined) delete process.env.MAISON_GOAL_HEADLESS;
      else process.env.MAISON_GOAL_HEADLESS = prevHeadless;
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

  // G0 回归：复刻 homepage —— 一处 schema 错（overlay 缺图 + 非法 ref_id）不得早退出掩盖
  // 「P0 屏全 pending → BLOCKER」。修复前 testing 假 PASS，修复后须判 BLOCKER。
  run('visual_diff_schema_error_not_mask_p0_pending_blocker', () => {
    const root = mkProject();
    try {
      const dtDir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing');
      const shotDir = path.join(dtDir, 'device-screenshots');
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, 'shot-home.png'), 'x');
      fs.writeFileSync(path.join(shotDir, 'shot-page2.png'), 'x');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        '  - id: page2',
        '    priority: P0',
        '    ref_id: page2',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      fs.writeFileSync(
        path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n',
      );
      fs.writeFileSync(path.join(dtDir, 'visual-diff.md'), '# diff');
      const shotRel = 'doc/features/bank-card/device-testing/device-screenshots';
      fs.writeFileSync(path.join(shotDir, 'visual-diff.json'), JSON.stringify({
        schema_version: '1.0',
        screens: [
          { screen_id: 'home', verdict: 'pending', ref_id: 'home', screenshot_path: `${shotRel}/shot-home.png`, screenshot_hash: 'aaaaaaaaaaaaaaaa' },
          { screen_id: 'page2', verdict: 'pending', ref_id: 'page2', screenshot_path: `${shotRel}/shot-page2.png`, screenshot_hash: 'aaaaaaaaaaaaaaaa' },
          { screen_id: 'overlay', verdict: 'pending', ref_id: 'ghost-ref', screenshot_path: `${shotRel}/shot-missing.png` },
        ],
      }));
      const r = checkVisualDiff(baseCtx(root));
      const blocker = r.find((x: { severity?: string; status: string }) => x.severity === 'BLOCKER' && x.status === 'FAIL');
      if (!blocker) throw new Error('schema 错误掩盖了 P0-pending BLOCKER：' + JSON.stringify(r));
      if (!/结构问题|ghost-ref|不存在/.test(blocker.details ?? '')) {
        throw new Error('schema 问题未在 details 体现（应追加而非掩盖）：' + (blocker.details ?? ''));
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  run('visual_diff_pending_validates_without_scores', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      const shot = path.join(ddir, 'shot-home.png');
      writeMinimalRedPng(shot, 10, 10);
      const v = validateVisualDiffJson({
        schema_version: '1.0',
        screens: [{
          screen_id: 'home',
          verdict: 'pending',
          screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
          ref_id: 'home',
        }],
      }, root, { authoritativeRefIds: new Set(['home']) });
      if (!v.ok) throw new Error(JSON.stringify(v));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('visual_diff_all_pending_not_pass', () => {
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
          verdict: 'pending',
          screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
          ref_id: 'home',
        }],
      }));
      const r = checkVisualDiff(baseCtx(root));
      const hit = r.find((x: { id: string; status: string; details?: string }) => x.id === 'visual_diff');
      if (!hit || hit.status === 'PASS') throw new Error(`all pending should WARN: ${JSON.stringify(hit)}`);
      if (!/pending/.test(hit.details ?? '')) throw new Error(`expected pending hint: ${hit.details}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // P1-C（f2d8c4a6）行为变更：score_floor 降级 reference_only——不再产生 WARN 判定，
  // 仅 details 附参考注记（像素直方图度量历史多次实测证伪：UI 全错仍近满分/忠实屏反被压分）。
  run('visual_diff_score_floor_reference_only_note', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      const shot = path.join(ddir, 'shot-home.png');
      writeMinimalRedPng(shot, 10, 10);
      const evalHash = hashScreenshotFile(shot);
      if (!evalHash) throw new Error('hash required');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
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
          fidelity_score: 0.85,
          geometric_iou: 0.7,
          score_floor: 0.3,
          screenshot_hash: evalHash,
          evaluated_screenshot_hash: evalHash,
        }],
      }));
      const r = checkVisualDiff(baseCtx(root));
      const hit = r.find((x: { id: string; status: string; details?: string }) => x.id === 'visual_diff');
      if (!hit) throw new Error('should produce visual_diff result');
      if (!/reference_only/.test(hit.details ?? '')) {
        throw new Error(`score_floor 分差应降为 reference_only 注记：${JSON.stringify(hit)}`);
      }
      if (hit.status === 'WARN' && /score_floor 与 VL 分差/.test(hit.details ?? '')) {
        throw new Error('score_floor 不得再产生 WARN 判定（已降级 reference_only）');
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // C：warn 屏灾难地板（fidelity<0.45 或 iou<0.40）pixel_1to1 → FAIL；正常残差 warn(~0.7) 不误伤。
  const writeFloorCase = (
    root: string,
    fidelity: number,
    iou: number,
    scoreFloor: number,
    defects: Array<Record<string, unknown>> = [],
  ): void => {
    const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
    fs.mkdirSync(ddir, { recursive: true });
    const shot = path.join(ddir, 'shot-home.png');
    writeMinimalRedPng(shot, 10, 10);
    const evalHash = hashScreenshotFile(shot);
    if (!evalHash) throw new Error('hash required');
    fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
      '```yaml\nui_change: new_or_changed\n```\n');
    fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
      'schema_version: "1.0"',
      'verified: human_confirmed',
      'screens:',
      '  - id: home',
      '    priority: P0',
      '    ref_id: home',
      '    root: { type: navigation_frame, order: 0 }',
      'tokens: {}',
      'assets: []',
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
    fs.writeFileSync(path.join(ddir, 'visual-diff.json'), JSON.stringify({
      schema_version: '1.0',
      screens: [{
        screen_id: 'home',
        verdict: 'warn',
        screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
        ref_id: 'home',
        fidelity_score: fidelity,
        geometric_iou: iou,
        score_floor: scoreFloor,
        screenshot_hash: evalHash,
        evaluated_screenshot_hash: evalHash,
        reverse_missing: [],
        defects,
      }],
    }));
  };

  run('visual_diff_warn_low_fidelity_floor_pixel1to1_fail', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      writeFloorCase(root, 0.1, 0.12, 0);
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r.find((x: { id: string }) => x.id === 'visual_diff') as { status: string; details?: string } | undefined;
      if (!hit || hit.status !== 'FAIL' || !/灾难地板|低于地板/.test(hit.details ?? '')) {
        throw new Error(`warn 0.1 应经灾难地板 FAIL：${JSON.stringify(r.map((x: { id: string; status: string }) => ({ id: x.id, status: x.status })))}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('visual_diff_warn_0p7_no_disaster_floor_but_blocks_via_mustfix', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      // T4 收紧（review#1）：pixel_1to1 P0 warn 须带 must_fix（可执行指令），defects/reverse_missing 不替代。
      // 0.7 在灾难地板(0.45)之上 → 不应触发"灾难地板"；但 must_fix 空 → 应经 T4 零指令门禁 BLOCKER。
      // 验证两机制相互独立：地板未误报、回修指令缺失被正确钉死。
      writeFloorCase(root, 0.7, 0.62, 0.5);
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r.find((x: { id: string }) => x.id === 'visual_diff') as { status: string; details?: string } | undefined;
      if (!hit || hit.status !== 'FAIL') {
        throw new Error(`0.7 P0 warn 无 must_fix 应经 T4 零指令门禁 FAIL：${JSON.stringify(r.map((x: { id: string; status: string }) => ({ id: x.id, status: x.status })))}`);
      }
      if (/灾难地板|低于地板/.test(hit.details ?? '')) throw new Error('0.7>0.45 不应触发灾难地板');
      if (!/无可执行回修指令/.test(hit.details ?? '')) throw new Error('应经 T4 零指令门禁，而非其它路径');
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // T2（主背靠）：pixel_1to1 P0 pass 屏须真人确认（confirmed_by 非自动化）。
  run('visual_diff_t2_human_confirm_required', () => {
    if (!isJimpAvailable()) return;
    const writePassCase = (root: string, confirmedBy?: string): void => {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      const shot = path.join(ddir, 'shot-home.png');
      writeMinimalRedPng(shot, 10, 10);
      const evalHash = hashScreenshotFile(shot);
      if (!evalHash) throw new Error('hash required');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"', 'verified: human_confirmed',
        'screens:', '  - id: home', '    priority: P0', '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }', // 无 children → 不触发 T1 锚点缺失
        'tokens: {}', 'assets: []',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      fs.writeFileSync(path.join(ddir, 'visual-diff.json'), JSON.stringify({
        schema_version: '1.0',
        screens: [{
          screen_id: 'home', verdict: 'pass',
          screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
          ref_id: 'home', fidelity_score: 0.92, geometric_iou: 0.85,
          screenshot_hash: evalHash, evaluated_screenshot_hash: evalHash,
          reverse_missing: [], defects: [],
          ...(confirmedBy ? { confirmed_by: confirmedBy } : {}),
        }],
      }));
    };
    const t2Hit = (root: string) => {
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      return r.find((x: { id: string }) => x.id === 'visual_diff' || x.id === 'visual_diff_human_confirm_required') as { status: string; details?: string } | undefined;
    };
    // (a) 缺 confirmed_by → BLOCKER（须真人确认）
    let root = mkProject();
    try {
      writePassCase(root);
      const hit = t2Hit(root);
      if (!hit || hit.status !== 'FAIL' || !/真人确认|confirmed_by/.test(hit.details ?? '')) {
        throw new Error(`缺 confirmed_by 应经 T2 FAIL：${JSON.stringify(hit)}`);
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    // (b) goal-mode-auto 自签 → 仍 BLOCKER
    root = mkProject();
    try {
      writePassCase(root, 'goal-mode-auto');
      const hit = t2Hit(root);
      if (!hit || hit.status !== 'FAIL' || !/自动化|confirmed_by/.test(hit.details ?? '')) {
        throw new Error(`goal-mode-auto 自签应仍 FAIL：${JSON.stringify(hit)}`);
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    // (b2) P0-6 伪签复刻：confirmed_by=user_requirement（裁剪授权哨兵冒充过目）→ 仍 BLOCKER
    //（2026-07-05 宿主实锤：agent 以此值伪签 T2 并在自跑 harness 中拿到 blocker_count 0）
    root = mkProject();
    try {
      writePassCase(root, 'user_requirement');
      const hit = t2Hit(root);
      if (!hit || hit.status !== 'FAIL' || !/授权|user_requirement|confirmed_by/.test(hit.details ?? '')) {
        throw new Error(`user_requirement 伪签应经 T2 FAIL（授权≠过目）：${JSON.stringify(hit)}`);
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    // (c) 真人署名 → 无 T2 门禁（pass 放行）
    root = mkProject();
    try {
      writePassCase(root, 'alice');
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      if (r.some((x: { id: string; details?: string }) => /真人确认/.test(x.details ?? ''))) {
        throw new Error(`真人 confirmed_by 不应再触发 T2：${JSON.stringify(r.map(x => x.id))}`);
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    // (d) P0-7③ 接线：testing 目录出现改判脚本 → visual_diff_tamper_artifact BLOCKER（即使判定本身干净）
    root = mkProject();
    try {
      writePassCase(root, 'alice');
      const tdir = path.join(root, 'doc', 'features', 'bank-card', 'testing');
      fs.mkdirSync(tdir, { recursive: true });
      fs.writeFileSync(path.join(tdir, 'auto-fill.cjs'), [
        "const fs = require('node:fs');",
        "const p = 'doc/features/bank-card/device-testing/device-screenshots/visual-diff.json';",
        "const r = JSON.parse(fs.readFileSync(p, 'utf-8'));",
        "for (const s of r.screens) { s.verdict = 'pass'; s.confirmed_by = 'user_requirement'; s.must_fix = []; }",
        'fs.writeFileSync(p, JSON.stringify(r));',
      ].join('\n'), 'utf-8');
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r.find((x: { id: string }) => x.id === 'visual_diff' || x.id === 'visual_diff_tamper_artifact') as { status: string; details?: string } | undefined;
      if (!hit || hit.status !== 'FAIL' || !/改判脚本|证据篡改/.test(hit.details ?? '')) {
        throw new Error(`改判脚本物证应 BLOCKER FAIL：${JSON.stringify(hit)}`);
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  });

  // P0-9b（plan e7a91b3c，codex 收窄）：唯一阻塞=T2 真人确认 → failure_kind=await_human_confirm
  //（goal-runner 据此 halt 为 await_human_visual_confirm 而非 no_progress）；warn+must_fix 混杂≠待签。
  run('p0_9b_await_human_confirm_narrow_classification', () => {
    if (!isJimpAvailable()) return;
    const { featurePhaseReportsDir } = require('../../config');
    const { computeHapBuildFingerprint } = require('../../../profiles/hmos-app/harness/build-fingerprint');
    // codex P2：await 须当前指纹可算且全屏指纹一致——写 hap + install meta，返回指纹供屏条目盖戳
    const writeBuildFingerprintChain = (root: string): string => {
      const hap = path.join(root, 'app.hap');
      fs.writeFileSync(hap, Buffer.from('hap-v1'));
      fs.mkdirSync(path.join(root, 'skills'), { recursive: true }); // framework 树标记（供 frameworkRoot 解析）
      const reportsDir = featurePhaseReportsDir(root, 'bank-card', 'testing');
      fs.mkdirSync(reportsDir, { recursive: true });
      fs.writeFileSync(path.join(reportsDir, 'device-test-install.meta.json'), JSON.stringify({ hapPath: hap }));
      return computeHapBuildFingerprint(hap) as string;
    };
    const writeScreens = (root: string, screens: Array<Record<string, unknown>>): void => {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"', 'verified: human_confirmed',
        'screens:', '  - id: home', '    priority: P0', '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}', 'assets: []',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      const rows = screens.map(s => {
        const shot = path.join(ddir, `shot-${s.screen_id as string}.png`);
        writeMinimalRedPng(shot, 10, 10);
        const evalHash = hashScreenshotFile(shot);
        return {
          screenshot_path: `doc/features/bank-card/device-testing/device-screenshots/shot-${s.screen_id as string}.png`,
          ref_id: 'home', fidelity_score: 0.92, geometric_iou: 0.85,
          screenshot_hash: evalHash, evaluated_screenshot_hash: evalHash,
          reverse_missing: [], defects: [],
          ...s,
        };
      });
      fs.writeFileSync(path.join(ddir, 'visual-diff.json'), JSON.stringify({ schema_version: '1.0', screens: rows }));
    };
    // (a) 纯 pass 候选缺签 + 指纹链齐全 → FAIL 且 failure_kind=await_human_confirm + 操作指引
    let root = mkProject();
    try {
      const fp = writeBuildFingerprintChain(root);
      writeScreens(root, [{ screen_id: 'home', verdict: 'pass', must_fix: [], evaluated_build_fingerprint: fp }]);
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r[0] as { status: string; failure_kind?: string; details?: string };
      if (hit.status !== 'FAIL') throw new Error(`缺签仍须 FAIL：${JSON.stringify(hit)}`);
      if (hit.failure_kind !== 'await_human_confirm' || !/await_human_visual_confirm/.test(hit.details ?? '')) {
        throw new Error(`纯 pass 候选缺签应归 await_human_confirm 并给指引：${JSON.stringify(hit)}`);
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    // (b) warn+must_fix（本轮宿主实态）→ 仍 visual_gap 口径，不得标 await_human（防教用户签过未裁决内容）
    root = mkProject();
    try {
      const fp = writeBuildFingerprintChain(root);
      writeScreens(root, [{ screen_id: 'home', verdict: 'warn', must_fix: ['tab 缺胶囊图标'], evaluated_build_fingerprint: fp }]);
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r[0] as { status: string; failure_kind?: string };
      if (hit.failure_kind === 'await_human_confirm') {
        throw new Error('warn+must_fix 混杂不得归 await_human_confirm（codex 收窄）');
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    // (c) codex P2：当前指纹不可算（无 install meta）→ 不得 await_human（此刻签名会被下轮重采清掉）
    root = mkProject();
    try {
      writeScreens(root, [{ screen_id: 'home', verdict: 'pass', must_fix: [] }]);
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r[0] as { status: string; failure_kind?: string };
      if (hit.failure_kind === 'await_human_confirm') {
        throw new Error('指纹不可算时不得归 await_human_confirm（真人签无法持久）');
      }
      if (hit.status !== 'FAIL') throw new Error('缺签仍须 FAIL（T2 不放行）');
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  });

  // T1（窄）端到端：pixel_1to1 P0 pass 屏声明 3+ 文本锚点、但截图 OCR 找不到（整块缺失）→ visual_diff_text_missing。
  // 罩住 collectAllComponentNodes → screenAnchors → collectGrossMissingAnchorText → pushVisualDiffHit 全接线。
  run('visual_diff_t1_text_missing_required', () => {
    const { isOcrAvailable } = require('../../../profiles/hmos-app/harness/ocr-toolkit');
    if (!isJimpAvailable() || !isOcrAvailable()) return; // 用真 OCR，无则跳过
    const root = mkProject();
    try {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      const shot = path.join(ddir, 'shot-home.png');
      writeMinimalRedPng(shot, 12, 12); // 纯色小图：OCR 找不到任何声明文本 → 整块缺失
      const evalHash = hashScreenshotFile(shot);
      if (!evalHash) throw new Error('hash required');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"', 'verified: human_confirmed',
        'screens:', '  - id: home', '    priority: P0', '    ref_id: home',
        '    root:', '      type: navigation_frame', '      order: 0', '      children:',
        '        - { type: content_display, order: 0, text: "卡包集中管理" }',
        '        - { type: list_selection, order: 1, text: "添加管理卡片" }',
        '        - { type: content_display, order: 2, text: "更多服务广告" }',
        'tokens: {}', 'assets: []',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      fs.writeFileSync(path.join(ddir, 'visual-diff.json'), JSON.stringify({
        schema_version: '1.0',
        screens: [{
          screen_id: 'home', verdict: 'pass',
          screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
          ref_id: 'home', fidelity_score: 0.92, geometric_iou: 0.85,
          screenshot_hash: evalHash, evaluated_screenshot_hash: evalHash,
          reverse_missing: [], defects: [],
          confirmed_by: 'alice', // 隔离掉 T2，只留 T1
        }],
      }));
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r.find((x: { id: string }) => x.id === 'visual_diff' || x.id === 'visual_diff_text_missing') as { status: string; details?: string } | undefined;
      if (!hit || hit.status !== 'FAIL' || !/锚点文本整块缺失|missing-render/.test(hit.details ?? '')) {
        throw new Error(`声明 3 锚点全缺应经 T1 visual_diff_text_missing FAIL：${JSON.stringify(r.map((x: { id: string; status: string; details?: string }) => ({ id: x.id, status: x.status })))}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // ── 出口·可证伪回归（homepage 真实坏态 → BLOCKER；忠实+人确认 → PASS）──
  const OCR_FIX = path.resolve(__dirname, '../../../profiles/hmos-app/harness/tests/fixtures/ocr');

  // Exit-1（A1）：card_pack 真实坏态（pass+0.98+defects:[]+无 confirmed_by，真图底部泄漏 首页/我的）→ BLOCKER。
  // 复现 2026-06-29 那次"全 PASS"假象：加固后须判 BLOCKER（T2 无人确认 + T5 越界）。
  run('exit_homepage_bad_state_card_pack_blocker', () => {
    if (!isJimpAvailable()) return;
    const shotAbs = path.join(OCR_FIX, 'card_pack.png').replace(/\\/g, '/');
    const evalHash = hashScreenshotFile(shotAbs);
    if (!evalHash) throw new Error('fixture hash required');
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"', 'verified: human_confirmed',
        'screens:', '  - id: card_pack', '    priority: P0', '    ref_id: card_pack',
        '    root: { type: navigation_frame, order: 0 }',
        'global_elements:',
        '  - id: bottom_tab', "    texts: ['首页', '我的']", "    owner_screen_ids: ['home_no_card', 'mine']",
        'tokens: {}', 'assets: []',
      ].join('\n'));
      fs.mkdirSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots'), { recursive: true });
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots', 'visual-diff.json'),
        JSON.stringify({
          schema_version: '1.0',
          screens: [{
            screen_id: 'card_pack', verdict: 'pass', screenshot_path: shotAbs, ref_id: 'card_pack',
            fidelity_score: 0.98, geometric_iou: 0.94, score_floor: 0.999,
            screenshot_hash: evalHash, evaluated_screenshot_hash: evalHash,
            reverse_missing: [], defects: [], // 即"VL 假高分零缺陷"——加固后不再放行
          }],
        }));
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const blocked = r.some((x: { severity: string; status: string }) => x.severity === 'BLOCKER' && x.status === 'FAIL');
      if (!blocked) {
        throw new Error(`homepage 坏态(card_pack 假 pass)加固后须 BLOCKER（现状全 PASS 可证伪）：${JSON.stringify(r.map((x: { id: string; status: string }) => ({ id: x.id, status: x.status })))}`);
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  });

  // Exit-2（FP 校准·承重）：忠实 mine（属主屏底部 tab 合法）+ 真人 confirmed_by + 干净分数 → 不 BLOCKER。
  // "宁可漏报不可恒误报"：加固门禁绝不能把忠实渲染也判挂，否则等于噪声门禁。
  run('exit_faithful_mine_confirmed_passes', () => {
    if (!isJimpAvailable()) return;
    const shotAbs = path.join(OCR_FIX, 'mine.png').replace(/\\/g, '/');
    const evalHash = hashScreenshotFile(shotAbs);
    if (!evalHash) throw new Error('fixture hash required');
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"', 'verified: human_confirmed',
        'screens:', '  - id: mine', '    priority: P0', '    ref_id: mine',
        '    root: { type: navigation_frame, order: 0 }', // 无 children → 无 T1 锚点
        'global_elements:',
        '  - id: bottom_tab', "    texts: ['首页', '我的']", "    owner_screen_ids: ['mine']", // mine 是属主 → 不越界
        'tokens: {}', 'assets: []',
      ].join('\n'));
      fs.mkdirSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots'), { recursive: true });
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots', 'visual-diff.json'),
        JSON.stringify({
          schema_version: '1.0',
          screens: [{
            screen_id: 'mine', verdict: 'pass', screenshot_path: shotAbs, ref_id: 'mine',
            fidelity_score: 0.97, geometric_iou: 0.93, score_floor: 0.99,
            screenshot_hash: evalHash, evaluated_screenshot_hash: evalHash,
            reverse_missing: [], defects: [], confirmed_by: 'reviewer-alice',
          }],
        }));
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const blocked = r.filter((x: { severity: string; status: string }) => x.severity === 'BLOCKER' && x.status === 'FAIL');
      if (blocked.length > 0) {
        throw new Error(`忠实 mine+人确认 不应被任何门禁误判（FP 校准承重）：${JSON.stringify(blocked.map((x: { id: string; details?: string }) => ({ id: x.id, d: x.details })))}`);
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  });

  run('visual_diff_finalized_verdict_without_evaluated_hash_warns', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      const shot = path.join(ddir, 'shot-home.png');
      writeMinimalRedPng(shot, 10, 10);
      const shotHash = hashScreenshotFile(shot);
      if (!shotHash) throw new Error('hash required');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
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
          fidelity_score: 0.85,
          geometric_iou: 0.7,
          screenshot_hash: shotHash,
        }],
      }));
      const r = checkVisualDiff(baseCtx(root));
      const hit = r.find((x: { id: string; status: string; details?: string }) => x.id === 'visual_diff');
      if (!hit || hit.status !== 'WARN' || !/evaluated_screenshot_hash/.test(hit.details ?? '')) {
        throw new Error(`missing eval hash should WARN: ${JSON.stringify(hit)}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // F1：缺 defects 枚举在 pixel_1to1 下是 BLOCKER/FAIL（反绕过，与 reverse_missing 对称），补 [] 解除
  run('visual_diff_missing_defects_enum_pixel1to1_blocks', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      const shot = path.join(ddir, 'shot-home.png');
      writeMinimalRedPng(shot, 10, 10);
      const shotHash = hashScreenshotFile(shot);
      if (!shotHash) throw new Error('hash required');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"', 'verified: human_confirmed', 'screens:',
        '  - id: home', '    priority: P0', '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }', 'tokens: {}', 'assets: []',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      const baseScreen = {
        screen_id: 'home',
        verdict: 'pass',
        screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
        ref_id: 'home',
        fidelity_score: 0.9,
        geometric_iou: 0.9,
        screenshot_hash: shotHash,
        evaluated_screenshot_hash: shotHash,
        reverse_missing: [] as string[],
      };
      // defects 缺失 → BLOCKER/FAIL
      fs.writeFileSync(path.join(ddir, 'visual-diff.json'), JSON.stringify({ schema_version: '1.0', screens: [baseScreen] }));
      const r1 = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r1.find((x: { id: string; status: string; severity: string; details?: string }) =>
        x.id === 'visual_diff_defects_enum' || /逐屏填写 defects/.test(x.details ?? ''));
      if (!hit || hit.status !== 'FAIL' || hit.severity !== 'BLOCKER') {
        throw new Error(`missing defects should BLOCKER/FAIL; got ids=${JSON.stringify(r1.map(x => ({ id: x.id, s: x.status, sev: x.severity })))}`);
      }
      // 补 defects:[] → 解除
      fs.writeFileSync(path.join(ddir, 'visual-diff.json'), JSON.stringify({ schema_version: '1.0', screens: [{ ...baseScreen, defects: [] }] }));
      const r2 = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      if (r2.some((x: { id: string; details?: string }) => x.id === 'visual_diff_defects_enum' || /逐屏填写 defects/.test(x.details ?? ''))) {
        throw new Error('defects:[] should clear the enum requirement');
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('visual_diff_capture_merge_preserves_verdict', () => {
    const hash = 'abc123def4567890';
    const existing = {
      screen_id: 'home',
      verdict: 'pass' as const,
      screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
      ref_id: 'home',
      fidelity_score: 0.82,
      geometric_iou: 0.71,
      screenshot_hash: hash,
      evaluated_screenshot_hash: hash,
    };
    const captured = {
      screen_id: 'home',
      verdict: 'pending' as const,
      screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home-new.png',
      ref_id: 'home',
      score_floor: 0.4,
    };
    const merged = mergeCapturedScreenEntry(existing, captured, hash);
    if (merged.verdict !== 'pass') throw new Error('verdict must be preserved when hash unchanged');
    if (merged.fidelity_score !== 0.82 || merged.geometric_iou !== 0.71) {
      throw new Error('scores must be preserved');
    }
    if (merged.screenshot_path !== captured.screenshot_path) throw new Error('shot path should refresh');
    if (merged.score_floor !== 0.4) throw new Error('score_floor should refresh');
    const { preserved } = mergeVisualDiffReports(
      { schema_version: '1.0', screens: [existing] },
      [{ entry: captured, hash }],
    );
    if (preserved !== 1) throw new Error(`expected preserved=1 got ${preserved}`);
  });

  run('visual_diff_capture_merge_invalidates_on_hash_change', () => {
    const oldHash = 'abc123def4567890';
    const newHash = 'fedcba9876543210';
    const existing = {
      screen_id: 'home',
      verdict: 'pass' as const,
      screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
      ref_id: 'home',
      fidelity_score: 0.82,
      geometric_iou: 0.71,
      screenshot_hash: oldHash,
      evaluated_screenshot_hash: oldHash,
    };
    const captured = {
      screen_id: 'home',
      verdict: 'pending' as const,
      screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
      ref_id: 'home',
      score_floor: 0.4,
    };
    const merged = mergeCapturedScreenEntry(existing, captured, newHash);
    if (merged.verdict !== 'pending') throw new Error('verdict must reset to pending on hash change');
    if (merged.fidelity_score !== undefined || merged.geometric_iou !== undefined) {
      throw new Error('scores must be cleared on invalidation');
    }
    const { preserved, invalidated } = mergeVisualDiffReports(
      { schema_version: '1.0', screens: [existing] },
      [{ entry: captured, hash: newHash }],
    );
    if (preserved !== 0 || invalidated !== 1) {
      throw new Error(`expected preserved=0 invalidated=1 got ${preserved}/${invalidated}`);
    }
  });

  run('round5_P1C_md_projection_reports_duplicate_hashes', () => {
    const dupHash = 'a2feda2fa5caca02';
    const report = {
      schema_version: '1.0',
      screens: [
        { screen_id: 'home_no_card', verdict: 'pending' as const, ref_id: 'home_no_card', screenshot_hash: dupHash, score_floor: 0.86 },
        { screen_id: 'mine', verdict: 'pending' as const, ref_id: 'mine', screenshot_hash: dupHash, score_floor: 0.98 },
        { screen_id: 'manage_non_local__overlay__0', verdict: 'warn' as const, ref_id: 'manage_non_local', screenshot_hash: 'f9c7e5f37c0a03f6', must_fix: ['半模态空态插画居中'] },
      ],
    };
    const groups = collectDuplicateHashGroups(report);
    if (groups.length !== 1 || !groups[0].includes('home_no_card') || !groups[0].includes('mine')) {
      throw new Error(`dup groups wrong: ${JSON.stringify(groups)}`);
    }
    const md = buildVisualDiffMdBody(report, { p0CaptureFailures: ['card_pack'] });
    if (!md.includes('screenshot_hash 非唯一')) throw new Error('md must flag non-unique hash');
    if (md.includes('各屏 screenshot_hash 唯一')) throw new Error('md must NOT claim unique when duplicates exist');
    if (!md.includes('半模态空态插画居中')) throw new Error('md must project must_fix from JSON');
    if (!md.includes('P0 采集失败：card_pack')) throw new Error('md must list p0CaptureFailures');
    if (!md.includes('自动生成，请勿手改')) throw new Error('md must carry do-not-edit banner');
  });

  run('round5_P1C_md_projection_unique_hashes_ok', () => {
    const report = {
      schema_version: '1.0',
      screens: [
        { screen_id: 'home_no_card', verdict: 'pass' as const, ref_id: 'home_no_card', screenshot_hash: 'aaaa000000000001', score_floor: 0.9 },
        { screen_id: 'mine', verdict: 'pass' as const, ref_id: 'mine', screenshot_hash: 'bbbb000000000002', score_floor: 0.95 },
      ],
    };
    if (collectDuplicateHashGroups(report).length !== 0) throw new Error('no dups expected');
    const md = buildVisualDiffMdBody(report);
    if (!md.includes('各屏 screenshot_hash 唯一')) throw new Error('md must affirm uniqueness');
    if (md.includes('screenshot_hash 非唯一')) throw new Error('md must not flag when unique');
    if (!md.includes('P0 采集失败：无')) throw new Error('md must say none when no p0 failures');
  });

  run('visual_diff_screen_slug_safe_paths', () => {
    const root = mkProject();
    try {
      if (sanitizeVisualDiffScreenSlug('') !== null) throw new Error('empty should fail');
      if (sanitizeVisualDiffScreenSlug('home') !== 'home') throw new Error('home slug');
      const paths = resolveShotPaths(root, 'bank-card', 'home');
      if (!paths || !paths.abs.endsWith(`${path.sep}shot-home.png`)) {
        throw new Error(JSON.stringify(paths));
      }
      const shotsDir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      const outside = resolveShotPaths(root, 'bank-card', 'x'.repeat(300));
      if (!outside) throw new Error('long slug should still resolve in dir');
      if (!path.resolve(outside.abs).startsWith(path.resolve(shotsDir) + path.sep)) {
        throw new Error('path escape');
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('visual_diff_capture_mock_skeleton', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const cap = captureVisualDiff({
        projectRoot: root,
        feature: 'bank-card',
        screenshotFn: ({ destAbs }) => {
          writeMinimalRedPng(destAbs, 12, 12);
          return { ok: true };
        },
      });
      if (!cap.ok || cap.screensWritten !== 1) throw new Error(JSON.stringify(cap));
      const raw = JSON.parse(fs.readFileSync(cap.jsonPath, 'utf-8'));
      const v = validateVisualDiffJson(raw, root, { authoritativeRefIds: new Set(['home']) });
      if (!v.ok) throw new Error(JSON.stringify(v));
      if (v.report.screens[0]?.verdict !== 'pending') throw new Error('expected pending skeleton');
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  const twoScreenUiSpec = (root: string) => fs.writeFileSync(
    path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'),
    [
      'schema_version: "1.0"', 'verified: human_confirmed', 'screens:',
      '  - id: home', '    priority: P0', '    ref_id: home', '    root: { type: navigation_frame, order: 0 }',
      '  - id: card_pack', '    priority: P0', '    ref_id: card_pack', '    root: { type: page, order: 0 }',
      'tokens: {}', 'assets: []',
    ].join('\n'),
  );

  run('round5_P1A_navigated_capture_reaches_non_toplevel', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      twoScreenUiSpec(root);
      const events: string[] = [];
      const cap = captureVisualDiff({
        projectRoot: root,
        feature: 'bank-card',
        navConfig: { home: [], card_pack: [{ touch: { by_id: 'btn' } }, { wait_for: { by_text: '添加卡片' } }] },
        navExecutorFn: ({ screenId }) => { events.push(`nav:${screenId}`); return { ok: true }; },
        screenshotFn: ({ screenId, destAbs }) => { events.push(`shot:${screenId}`); writeMinimalRedPng(destAbs, 12, 12); return { ok: true }; },
      });
      if (!cap.ok) throw new Error(JSON.stringify(cap));
      const raw = JSON.parse(fs.readFileSync(cap.jsonPath, 'utf-8')) as { screens: Array<{ screen_id: string }> };
      const ids = raw.screens.map(s => s.screen_id);
      if (!ids.includes('home') || !ids.includes('card_pack')) throw new Error(`两屏都应采集（含非顶层 card_pack）：${ids}`);
      // 每屏 nav 在其 shot 之前
      if (events.indexOf('nav:card_pack') < 0 || events.indexOf('nav:card_pack') > events.indexOf('shot:card_pack')) {
        throw new Error(`nav 应在 shot 前：${events.join(',')}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('round5_P1A_nav_failure_records_capture_failure_no_shot', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      twoScreenUiSpec(root);
      const shotIds: string[] = [];
      const cap = captureVisualDiff({
        projectRoot: root,
        feature: 'bank-card',
        navConfig: { home: [], card_pack: [{ touch: { by_id: 'btn' } }] },
        navExecutorFn: ({ screenId }) => (screenId === 'card_pack' ? { ok: false, error: 'element not found' } : { ok: true }),
        screenshotFn: ({ screenId, destAbs }) => { shotIds.push(screenId); writeMinimalRedPng(destAbs, 12, 12); return { ok: true }; },
      });
      if (shotIds.includes('card_pack')) throw new Error('导航失败的屏不应截图（避免截错屏）');
      if (!(cap.p0CaptureFailures ?? []).includes('card_pack')) throw new Error('导航失败应记 p0CaptureFailures');
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('round5_P1A_navEnabled_missing_screen_no_bare_capture', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      twoScreenUiSpec(root);
      const shotIds: string[] = [];
      const cap = captureVisualDiff({
        projectRoot: root,
        feature: 'bank-card',
        navConfig: { home: [] }, // card_pack 缺条目
        navExecutorFn: () => ({ ok: true }),
        screenshotFn: ({ screenId, destAbs }) => { shotIds.push(screenId); writeMinimalRedPng(destAbs, 12, 12); return { ok: true }; },
      });
      if (shotIds.includes('card_pack')) throw new Error('缺 nav 条目的屏不应裸采（防多屏截同一帧）');
      if (!(cap.p0CaptureFailures ?? []).includes('card_pack')) throw new Error('缺 nav 条目应记 p0CaptureFailures');
      if (!shotIds.includes('home')) throw new Error('有条目（空步骤直达）的 home 应正常采集');
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('round5_P1A_overlay_navigated_capture_X1', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      fs.writeFileSync(
        path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'),
        [
          'schema_version: "1.0"', 'verified: human_confirmed', 'screens:',
          '  - id: home', '    priority: P0', '    ref_id: home', '    root: { type: navigation_frame, order: 0 }',
          '  - id: manage_non_local', '    priority: P0', '    ref_id: manage_non_local',
          '    root: { type: overlay_panel, order: 0 }',
          'tokens: {}', 'assets: []',
        ].join('\n'),
      );
      const events: string[] = [];
      const cap = captureVisualDiff({
        projectRoot: root,
        feature: 'bank-card',
        // X1：nav key 后缀(__manage_non_local_root)与采集 overlay id(__overlay__0)不同、同基 → 须归一化命中
        navConfig: { home: [], manage_non_local__overlay__manage_non_local_root: [{ touch: { by_text: '管理非本机卡片' } }] },
        navExecutorFn: ({ screenId }) => { events.push(`nav:${screenId}`); return { ok: true }; },
        screenshotFn: ({ screenId, destAbs }) => { events.push(`shot:${screenId}`); writeMinimalRedPng(destAbs, 12, 12); return { ok: true }; },
      });
      const raw = JSON.parse(fs.readFileSync(cap.jsonPath, 'utf-8')) as { screens: Array<{ screen_id: string; ref_id?: string }> };
      const overlayEntry = raw.screens.find(s => s.screen_id.startsWith('manage_non_local__overlay__'));
      if (!overlayEntry) throw new Error(`overlay 应被导航采集（X1 归一化）：${raw.screens.map(s => s.screen_id)}`);
      if (overlayEntry.ref_id !== 'manage_non_local') throw new Error(`overlay ref_id 应为基屏：${overlayEntry.ref_id}`);
      if (!events.some(e => e.startsWith('nav:manage_non_local__overlay__'))) throw new Error(`overlay 应被导航：${events.join(',')}`);
      if (!events.some(e => e.startsWith('shot:manage_non_local__overlay__'))) throw new Error(`overlay 应被截图：${events.join(',')}`);
      // review4 FP 根治：root=overlay 的 base 屏由 overlay 循环采集，主循环不得把它记为 p0 失败
      if ((cap.p0CaptureFailures ?? []).includes('manage_non_local')) throw new Error('base overlay 屏不应记 p0CaptureFailures');
      if (events.some(e => e === 'nav:manage_non_local' || e === 'shot:manage_non_local')) throw new Error('base overlay 屏不应在主循环重复导航/截图');
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('round5_P1A_no_nav_skips_non_toplevel_backcompat', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      twoScreenUiSpec(root);
      const cap = captureVisualDiff({
        projectRoot: root,
        feature: 'bank-card',
        screenshotFn: ({ destAbs }) => { writeMinimalRedPng(destAbs, 12, 12); return { ok: true }; },
      });
      const raw = JSON.parse(fs.readFileSync(cap.jsonPath, 'utf-8')) as { screens: Array<{ screen_id: string }> };
      const ids = raw.screens.map(s => s.screen_id);
      if (!ids.includes('home')) throw new Error('顶层 home 应采集');
      if (ids.includes('card_pack')) throw new Error('无 nav 时非顶层屏应跳过（向后兼容）');
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
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
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
      const hit = r.find((x: { id: string; status: string; severity?: string }) => x.id === 'visual_diff');
      if (!hit || hit.status !== 'FAIL' || hit.severity !== 'BLOCKER') {
        throw new Error(`P0 all skipped on new_or_changed must BLOCKER FAIL: ${JSON.stringify(hit)}`);
      }
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

  run('fidelity_deferrals_unsigned_blocker', () => {
    const root = mkProject();
    try {
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: pixel_1to1',
        'fidelity_deferrals:',
        '  - element_id: search_bar',
        '    reason: defer test',
        '```',
      ].join('\n');
      const r = checkFidelityGovernance(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      const hit = r.find(x => x.id === 'fidelity_deferrals_human_sign' && x.status === 'FAIL');
      if (!hit || hit.severity !== 'BLOCKER') throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G1：goal-mode-auto 自签伪造人类章 → 不算人签 → pixel_1to1 下 BLOCKER（复刻 homepage）
  run('fidelity_deferrals_goal_mode_auto_self_sign_blocker', () => {
    const root = mkProject();
    try {
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: pixel_1to1',
        'fidelity_deferrals:',
        '  - element_id: search_bar',
        '    reason: defer test',
        '    human_signed: true',
        '    signed_by: goal-mode-auto',
        '```',
      ].join('\n');
      const r = checkFidelityGovernance(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      const hit = r.find(x => x.id === 'fidelity_deferrals_human_sign' && x.status === 'FAIL');
      if (!hit || hit.severity !== 'BLOCKER') throw new Error('goal-mode-auto 自签被当成了人签：' + JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G1 防误拒：真人 signed_by 仍算人签 → 不 BLOCKER
  run('fidelity_deferrals_real_human_sign_pass', () => {
    const root = mkProject();
    try {
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: pixel_1to1',
        'fidelity_deferrals:',
        '  - element_id: search_bar',
        '    reason: defer test',
        '    human_signed: true',
        '    signed_by: alice',
        '```',
      ].join('\n');
      const r = checkFidelityGovernance(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      if (r.find(x => x.id === 'fidelity_deferrals_human_sign' && x.status === 'FAIL')) {
        throw new Error('真人签字被误拒：' + JSON.stringify(r));
      }
      if (!r.find(x => x.id === 'fidelity_deferrals_human_sign' && x.status === 'PASS')) {
        throw new Error('真人签字未通过：' + JSON.stringify(r));
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G2：1:1 意图识别 helper（正负样本）
  run('detect_pixel_1to1_intent', () => {
    const pos = ['页面布局完全参考 1.首页.jpg', '像素级还原', '严格按设计图', '1比1还原', 'pixel-perfect', '完全按照原图'];
    for (const t of pos) {
      if (!detectPixel1to1Intent(t)) throw new Error('应识别为 1:1 意图：' + t);
    }
    const neg = ['普通需求，结构对齐即可', '参考一下整体风格', ''];
    for (const t of neg) {
      if (detectPixel1to1Intent(t)) throw new Error('误判为 1:1 意图：' + t);
    }
  });

  // G2 弱兜底 nudge：semantic_layout 但 spec 文本含 1:1 措辞 → WARN
  run('fidelity_target_intent_nudge_warn', () => {
    const root = mkProject();
    try {
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: semantic_layout',
        '```',
        '',
        '本需求页面布局完全参考 1.首页-无卡.jpg。',
      ].join('\n');
      const r = checkFidelityGovernance(baseCtx(root), specMd);
      const hit = r.find(x => x.id === 'fidelity_target_intent_nudge' && x.status === 'WARN');
      if (!hit) throw new Error('未对 semantic_layout + 1:1 措辞发 nudge：' + JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // P2 真实 homepage 组合回归：headless + 原始需求含"完全参考" + spec 降 semantic_layout → BLOCKER
  run('homepage_combo_headless_1to1_requirement_semantic_layout_blocker', () => {
    const root = mkProject();
    const prevHeadless = process.env.MAISON_GOAL_HEADLESS;
    try {
      process.env.MAISON_GOAL_HEADLESS = '1';
      const reqDir = path.join(root, 'doc', 'features', '原始需求');
      fs.mkdirSync(reqDir, { recursive: true });
      fs.writeFileSync(path.join(reqDir, '原始需求.md'), '本需求页面布局完全参考 1.首页-无卡.jpg，数据全部 mock。');
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: semantic_layout',
        'visual_handoff:',
        '  kind: screenshot_pack',
        '  authoritative_refs:',
        '    - id: home',
        '      path: doc/features/原始需求/1.png',
        'fidelity_deferrals:',
        '  - element_id: search_bar',
        '    human_signed: true',
        '    signed_by: goal-mode-auto',
        '```',
      ].join('\n');
      const r = checkFidelityGovernance(baseCtx(root), specMd);
      const blocker = r.find(x => x.id === 'fidelity_target_intent_nudge' && x.severity === 'BLOCKER' && x.status === 'FAIL');
      if (!blocker) throw new Error('homepage 组合（原始需求 1:1 + spec 降档 + headless）未判 BLOCKER：' + JSON.stringify(r));
    } finally {
      if (prevHeadless === undefined) delete process.env.MAISON_GOAL_HEADLESS;
      else process.env.MAISON_GOAL_HEADLESS = prevHeadless;
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // E2（多模态降级阶梯 plan d4a8f3c6）：能力钳制 clampFidelityByCapability / effective context
  // ==========================================================================

  run('E2 clampFidelityByCapability: hasVision → 从不钳制（三档皆保留）', () => {
    for (const desired of ['pixel_1to1', 'semantic_layout', 'reference_only'] as const) {
      const r = clampFidelityByCapability(desired, { hasVision: true, ocrAvailable: false });
      if (r.effective !== desired || r.clamped) throw new Error(`hasVision 不应钳制 ${desired}：${JSON.stringify(r)}`);
    }
  });

  run('E2 clampFidelityByCapability: 无视觉+OCR可用 → pixel_1to1 钳至 semantic_layout，其余不钳', () => {
    const pixel = clampFidelityByCapability('pixel_1to1', { hasVision: false, ocrAvailable: true });
    if (pixel.effective !== 'semantic_layout' || !pixel.clamped || pixel.reason !== 'no_vision_ocr_available') {
      throw new Error('pixel_1to1 应钳至 semantic_layout：' + JSON.stringify(pixel));
    }
    const semantic = clampFidelityByCapability('semantic_layout', { hasVision: false, ocrAvailable: true });
    if (semantic.effective !== 'semantic_layout' || semantic.clamped) throw new Error('semantic_layout 不应被钳：' + JSON.stringify(semantic));
    const ref = clampFidelityByCapability('reference_only', { hasVision: false, ocrAvailable: true });
    if (ref.effective !== 'reference_only' || ref.clamped) throw new Error('reference_only 不应被钳：' + JSON.stringify(ref));
  });

  run('E2 clampFidelityByCapability: 无视觉+无OCR → 一律钳至 reference_only 地板', () => {
    const pixel = clampFidelityByCapability('pixel_1to1', { hasVision: false, ocrAvailable: false });
    const semantic = clampFidelityByCapability('semantic_layout', { hasVision: false, ocrAvailable: false });
    if (pixel.effective !== 'reference_only' || pixel.reason !== 'no_vision_no_ocr') throw new Error('pixel 应钳地板：' + JSON.stringify(pixel));
    if (semantic.effective !== 'reference_only' || semantic.reason !== 'no_vision_no_ocr') throw new Error('semantic 应钳地板：' + JSON.stringify(semantic));
    const ref = clampFidelityByCapability('reference_only', { hasVision: false, ocrAvailable: false });
    if (ref.clamped) throw new Error('已在地板不应再报 clamped：' + JSON.stringify(ref));
  });

  run('E2 resolveEffectiveFidelityContext: 合成 effective + 保留 declared（不改写意图）', () => {
    const raw = {
      fidelityTarget: 'pixel_1to1' as const,
      assetAcquisitionMode: 'user_dir' as const,
      effectiveAssetAcquisitionMode: 'user_dir' as const,
      fidelityDeferrals: [],
    };
    const out = resolveEffectiveFidelityContext(raw, { hasVision: false, ocrAvailable: true });
    if (out.fidelityTarget !== 'semantic_layout') throw new Error('effective 应钳：' + JSON.stringify(out));
    if (out.declaredFidelityTarget !== 'pixel_1to1') throw new Error('declared 须保留原始意图：' + JSON.stringify(out));
    if (!out.fidelityClamped || out.fidelityClampReason !== 'no_vision_ocr_available') throw new Error(JSON.stringify(out));
    // 素材模式字段透传不变
    if (out.assetAcquisitionMode !== 'user_dir' || out.effectiveAssetAcquisitionMode !== 'user_dir') throw new Error(JSON.stringify(out));
  });

  run('E2 reference_only 新枚举：isPixel1to1=false，fidelityRatchetFailOrWarn 走非 pixel 路径（同 semantic_layout）', () => {
    const ctx = baseCtx(mkProject(), { fidelityTarget: 'reference_only' });
    try {
      if (isPixel1to1(ctx)) throw new Error('reference_only 不应被判 pixel_1to1');
      const soft = fidelityRatchetFailOrWarn(ctx, true);
      if (soft.severity !== 'MAJOR' || soft.status !== 'WARN') throw new Error('reference_only 应走软路径：' + JSON.stringify(soft));
    } finally {
      fs.rmSync(ctx.projectRoot, { recursive: true, force: true });
    }
  });

  // 与 homepage_combo_headless_1to1_requirement_semantic_layout_blocker 同场景，唯一变量=能力钳制生效——
  // cursor 硬冲突修正：这不再是"agent 擅自降级"BLOCKER，是合法的能力降级，不得阻断 headless 继续跑。
  run('E2 fidelityGovernance: 能力钳制生效时 1:1 措辞 + 降档 → 不 BLOCKER，改报 capability_clamped PASS', () => {
    const root = mkProject();
    const prevHeadless = process.env.MAISON_GOAL_HEADLESS;
    try {
      process.env.MAISON_GOAL_HEADLESS = '1';
      const reqDir = path.join(root, 'doc', 'features', '原始需求');
      fs.mkdirSync(reqDir, { recursive: true });
      fs.writeFileSync(path.join(reqDir, '原始需求.md'), '本需求页面布局完全参考 1.首页-无卡.jpg，数据全部 mock。');
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: pixel_1to1',
        'visual_handoff:',
        '  kind: screenshot_pack',
        '  authoritative_refs:',
        '    - id: home',
        '      path: doc/features/原始需求/1.png',
        '```',
      ].join('\n');
      const ctx = baseCtx(root, {
        fidelityTarget: 'semantic_layout',
        declaredFidelityTarget: 'pixel_1to1',
        fidelityClamped: true,
        fidelityClampReason: 'no_vision_ocr_available',
      });
      const r = checkFidelityGovernance(ctx, specMd);
      const blocker = r.find(x => x.id === 'fidelity_target_intent_nudge' && x.severity === 'BLOCKER');
      if (blocker) throw new Error('能力钳制不应再走 intent_nudge BLOCKER：' + JSON.stringify(r));
      const clampedNote = r.find(x => x.id === 'fidelity_target_capability_clamped' && x.status === 'PASS');
      if (!clampedNote) throw new Error('应产出 capability_clamped PASS 说明：' + JSON.stringify(r));
      const declared = r.find(x => x.id === 'fidelity_target_declared');
      if (!declared || !String(declared.details).includes('能力钳制')) throw new Error('首屏声明须提示钳制事实：' + JSON.stringify(declared));
    } finally {
      if (prevHeadless === undefined) delete process.env.MAISON_GOAL_HEADLESS;
      else process.env.MAISON_GOAL_HEADLESS = prevHeadless;
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // P1 修正回归（codex review）：declared=semantic_layout（agent 自己没如实声明 1:1，与能力
  // 钳制无关的独立违规）——即便之后又被钳到 reference_only 地板，也不能被误判为"desired 已保留
  // pixel_1to1"的合法降级；这种情况仍须走 intent_nudge 追责。
  run('E2 P1 修正: declared≠pixel_1to1 时即便 capabilityClamped 也不得豁免 intent_nudge（不能谎称 desired 已保留）', () => {
    const root = mkProject();
    const prevHeadless = process.env.MAISON_GOAL_HEADLESS;
    try {
      process.env.MAISON_GOAL_HEADLESS = '1';
      const reqDir = path.join(root, 'doc', 'features', '原始需求');
      fs.mkdirSync(reqDir, { recursive: true });
      fs.writeFileSync(path.join(reqDir, '原始需求.md'), '本需求页面布局完全参考 1.首页-无卡.jpg，数据全部 mock。');
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: semantic_layout',
        'visual_handoff:',
        '  kind: screenshot_pack',
        '  authoritative_refs:',
        '    - id: home',
        '      path: doc/features/原始需求/1.png',
        '```',
      ].join('\n');
      // declared=semantic_layout（agent 自己没声明 1:1），能力又把它进一步钳到 reference_only 地板。
      const ctx = baseCtx(root, {
        fidelityTarget: 'reference_only',
        declaredFidelityTarget: 'semantic_layout',
        fidelityClamped: true,
        fidelityClampReason: 'no_vision_no_ocr',
      });
      const r = checkFidelityGovernance(ctx, specMd);
      const falseClampPass = r.find(x => x.id === 'fidelity_target_capability_clamped');
      if (falseClampPass) throw new Error('declared≠pixel_1to1 不得豁免为合法钳制：' + JSON.stringify(r));
      const blocker = r.find(x => x.id === 'fidelity_target_intent_nudge' && x.severity === 'BLOCKER' && x.status === 'FAIL');
      if (!blocker) throw new Error('declared 本身未如实声明 1:1，仍须 intent_nudge BLOCKER：' + JSON.stringify(r));
      if (!String(blocker.details).includes('reference_only')) throw new Error('details 应如实附注即便声明也会被钳到的档位：' + JSON.stringify(blocker));
    } finally {
      if (prevHeadless === undefined) delete process.env.MAISON_GOAL_HEADLESS;
      else process.env.MAISON_GOAL_HEADLESS = prevHeadless;
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // E0（多模态降级阶梯 plan d4a8f3c6）：能力感知 phase prompt 支撑函数
  // ==========================================================================

  run('E0 detectUiRelevantRequirement: 真实需求文本命中；纯后端逻辑需求不命中', () => {
    const uiText = '银行卡开卡需求，含7个页面：1)添加银行卡页面...参考图在doc/features/原始需求/1-银行卡/目录下，严格按参考图还原结构、颜色、布局。';
    if (!detectUiRelevantRequirement(uiText)) throw new Error('真实银行卡需求文本应命中 UI 相关');
    const backendText = '实现一个定时批量导出 CSV 到对象存储的后台任务，失败重试 3 次并记录审计日志。';
    if (detectUiRelevantRequirement(backendText)) throw new Error('纯后端需求不应误判 UI 相关：' + backendText);
    if (detectUiRelevantRequirement(undefined) || detectUiRelevantRequirement('')) throw new Error('空/undefined 应为 false');
  });

  run('E0 discoverReferenceImagesForOcrPrescan: 三级顺序——①需求文本目录引用优先', () => {
    const root = mkProject();
    try {
      const reqDir = path.join(root, 'doc', 'features', '原始需求', '1-银行卡');
      fs.mkdirSync(reqDir, { recursive: true });
      fs.writeFileSync(path.join(reqDir, '1.首页.png'), 'fake-png-bytes');
      fs.writeFileSync(path.join(reqDir, 'not-an-image.txt'), 'ignore me');
      // 同时准备一个 ux-reference/ 干扰项——应优先命中①而非③
      const uxRefDir = path.join(root, 'doc', 'features', 'bank-card', 'ux-reference');
      fs.mkdirSync(uxRefDir, { recursive: true });
      fs.writeFileSync(path.join(uxRefDir, 'decoy.png'), 'decoy');
      const requirement = '参考图在doc/features/原始需求/1-银行卡/目录下，严格按参考图还原。';
      const found = discoverReferenceImagesForOcrPrescan(root, 'bank-card', requirement);
      if (found.length !== 1) throw new Error('应只找到 1 张图（.txt 不算）：' + JSON.stringify(found));
      if (!found[0].includes('1.首页.png')) throw new Error('应命中需求文本引用的目录：' + JSON.stringify(found));
      if (found.some(f => f.includes('decoy'))) throw new Error('不应误采 ux-reference 干扰项（①优先于③）：' + JSON.stringify(found));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('E0 discoverReferenceImagesForOcrPrescan: 需求文本无路径引用 → 回退②ux-reference/', () => {
    const root = mkProject();
    try {
      const uxRefDir = path.join(root, 'doc', 'features', 'bank-card', 'ux-reference');
      fs.mkdirSync(uxRefDir, { recursive: true });
      fs.writeFileSync(path.join(uxRefDir, 'home.jpg'), 'fake');
      const found = discoverReferenceImagesForOcrPrescan(root, 'bank-card', '银行卡开卡需求，含7个页面，请参考截图设计。');
      if (found.length !== 1 || !found[0].includes('home.jpg')) throw new Error('应回退到 ux-reference/：' + JSON.stringify(found));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('E0 discoverReferenceImagesForOcrPrescan: ③扫不到图源 → 空数组（不造假分母）', () => {
    const root = mkProject();
    try {
      const found = discoverReferenceImagesForOcrPrescan(root, 'bank-card', '银行卡开卡需求，无参考图，纯文字描述。');
      if (found.length !== 0) throw new Error('无图源应返回空数组：' + JSON.stringify(found));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('E0 loadProfileOcrToolkit/probeProfileOcrAvailable: hmos-app 有工具链；generic 无（优雅降级非报错）', () => {
    const hmosDir = path.join(DEFAULT_LAYOUT.frameworkRoot, 'profiles', 'hmos-app');
    const genericDir = path.join(DEFAULT_LAYOUT.frameworkRoot, 'profiles', 'generic');
    const hmosToolkit = loadProfileOcrToolkit(hmosDir);
    if (!hmosToolkit) throw new Error('hmos-app 应有 ocr-toolkit');
    if (typeof hmosToolkit.isOcrAvailable !== 'function' || typeof hmosToolkit.ocrImageWords !== 'function') {
      throw new Error('hmos-app toolkit 缺方法：' + JSON.stringify(Object.keys(hmosToolkit)));
    }
    const genericToolkit = loadProfileOcrToolkit(genericDir);
    if (genericToolkit !== null) throw new Error('generic 无 OCR 资产，应返回 null（优雅降级）');
    if (probeProfileOcrAvailable(genericDir) !== false) throw new Error('generic 的 probeProfileOcrAvailable 应为 false');
  });

  // cursor review（E6 后复核）：resolveOcrAvailableForRun 此前只被 harness-runner.ts/goal-runner.ts
  // 间接覆盖，未有直连单测——补上，锁定"profile 环境 OR 金丝雀 ocr_capable 信号"的口径。
  run('cursor review: resolveOcrAvailableForRun 直连单测——profile 环境 OR 金丝雀 ocr_capable 信号', () => {
    const genericDir = path.join(DEFAULT_LAYOUT.frameworkRoot, 'profiles', 'generic');
    const root = mkProject();
    try {
      if (resolveOcrAvailableForRun(root, genericDir, 'chrys') !== false) {
        throw new Error('generic 无 OCR 工具链 + 无金丝雀缓存 → 应为 false');
      }
      writeLocalConfig(root, {
        schema_version: '1.0',
        vision: { canary: { adapter: 'chrys', verdict: 'ocr_capable', probed_at: '2026-07-08T00:00:00.000Z' } },
      });
      if (resolveOcrAvailableForRun(root, genericDir, 'chrys') !== true) {
        throw new Error('generic 无 OCR 工具链，但金丝雀 verdict=ocr_capable 且 adapter 匹配 → 应 OR 为 true');
      }
      if (resolveOcrAvailableForRun(root, genericDir, 'claude') !== false) {
        throw new Error('金丝雀缓存 adapter=chrys ≠ 查询 adapter=claude → 应视为不匹配，仍 false');
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // P1-G1：headless 下 human_signed:true 但缺 signed_by → 视为自签 → BLOCKER（不可绕过）
  run('fidelity_deferrals_headless_missing_signer_blocker', () => {
    const root = mkProject();
    const prevHeadless = process.env.MAISON_GOAL_HEADLESS;
    try {
      process.env.MAISON_GOAL_HEADLESS = '1';
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: pixel_1to1',
        'fidelity_deferrals:',
        '  - element_id: search_bar',
        '    human_signed: true',
        '```',
      ].join('\n');
      const r = checkFidelityGovernance(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      const hit = r.find(x => x.id === 'fidelity_deferrals_human_sign' && x.status === 'FAIL' && x.severity === 'BLOCKER');
      if (!hit) throw new Error('headless 缺 signed_by 被当人签：' + JSON.stringify(r));
    } finally {
      if (prevHeadless === undefined) delete process.env.MAISON_GOAL_HEADLESS;
      else process.env.MAISON_GOAL_HEADLESS = prevHeadless;
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G3 地基：ui-spec 捕获保真字段（variant/align/width_ratio/layout_group/bg_color）schema 校验
  run('ui_spec_schema_g3_capture_fields', () => {
    const okErrors = validateUiSpecSchema({
      schema_version: '1.0',
      verified: 'human_confirmed',
      screens: [{
        id: 'home', priority: 'P0', ref_id: 'home',
        root: {
          type: 'navigation_frame', order: 0, bg_color: 'wallet.page_bg', children: [
            { id: 'cta', type: 'action_button', order: 0, variant: 'ghost', align: 'end', width_ratio: 0.4, layout_group: 'card_pack_row' },
          ],
        },
      }],
      tokens: {}, assets: [],
    } as unknown as Parameters<typeof validateUiSpecSchema>[0]);
    if (okErrors.length) throw new Error('合法 G3 字段被误拒：' + JSON.stringify(okErrors));

    const badErrors = validateUiSpecSchema({
      schema_version: '1.0',
      screens: [{
        id: 'home', priority: 'P0',
        root: { type: 'action_button', order: 0, variant: 'solid', width_ratio: 2 },
      }],
      tokens: {}, assets: [],
    } as unknown as Parameters<typeof validateUiSpecSchema>[0]);
    if (!badErrors.some(e => /variant/.test(e)) || !badErrors.some(e => /width_ratio/.test(e))) {
      throw new Error('非法 variant/width_ratio 未被拒：' + JSON.stringify(badErrors));
    }
  });

  // T5：global_elements schema 校验（合法放行 + 坏配置拒，避免门禁误判/失效）
  run('ui_spec_schema_global_elements', () => {
    const base = (ge: unknown) => ({
      schema_version: '1.0',
      screens: [{ id: 'home', priority: 'P0', root: { type: 'navigation_frame', order: 0 } }],
      tokens: {}, assets: [], global_elements: ge,
    } as unknown as Parameters<typeof validateUiSpecSchema>[0]);

    const ok = validateUiSpecSchema(base([
      { id: 'bottom_tab', texts: ['首页', '我的'], owner_screen_ids: ['home', 'mine'], band: { start: 0.85 } },
    ]));
    if (ok.some(e => /global_elements/.test(e))) throw new Error('合法 global_elements 被误拒：' + JSON.stringify(ok));

    // owner_screen_ids 空数组 → 拒（否则全屏误判越界）
    const emptyOwner = validateUiSpecSchema(base([{ id: 'g', texts: ['x'], owner_screen_ids: [] }]));
    if (!emptyOwner.some(e => /owner_screen_ids/.test(e))) throw new Error('owner_screen_ids:[] 未被拒');

    // owner_screen_ids 含空串 → 拒
    const blankOwner = validateUiSpecSchema(base([{ id: 'g', texts: ['x'], owner_screen_ids: [''] }]));
    if (!blankOwner.some(e => /owner_screen_ids/.test(e))) throw new Error("owner_screen_ids:[''] 未被拒");

    // texts 空 → 拒
    const emptyTexts = validateUiSpecSchema(base([{ id: 'g', texts: [], owner_screen_ids: ['home'] }]));
    if (!emptyTexts.some(e => /texts/.test(e))) throw new Error('texts:[] 未被拒');

    // band.end < start → 拒（band 永不命中）
    const badBand = validateUiSpecSchema(base([{ id: 'g', texts: ['x'], owner_screen_ids: ['home'], band: { start: 0.85, end: 0.5 } }]));
    if (!badBand.some(e => /band\.end/.test(e))) throw new Error('band.end<start 未被拒：' + JSON.stringify(badBand));
  });

  // G3 drift 守卫：ui-spec.schema.json（SSOT）的 G3 字段须与 runtime validator 的 enum/约束一致
  run('ui_spec_schema_json_g3_fields_synced', () => {
    const schemaPath = path.resolve(__dirname, '../../schemas/ui-spec.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const props = schema?.definitions?.componentNode?.properties ?? {};
    const variantEnum = props.variant?.enum;
    if (!Array.isArray(variantEnum) || variantEnum.join(',') !== [...BUTTON_VARIANT_ENUM].join(',')) {
      throw new Error('schema variant enum 与 validator 漂移：' + JSON.stringify(variantEnum));
    }
    const alignEnum = props.align?.enum;
    if (!Array.isArray(alignEnum) || alignEnum.join(',') !== [...ALIGN_ENUM].join(',')) {
      throw new Error('schema align enum 与 validator 漂移：' + JSON.stringify(alignEnum));
    }
    if (props.width_ratio?.type !== 'number' || props.width_ratio?.minimum !== 0 || props.width_ratio?.maximum !== 1) {
      throw new Error('schema width_ratio 约束缺失/漂移：' + JSON.stringify(props.width_ratio));
    }
    for (const k of ['layout_group', 'bg_color']) {
      if (props[k]?.type !== 'string') throw new Error(`schema 缺 ${k}: string`);
    }
  });

  // G3 Slice 2：pixel_1to1 下 P0 action_button 缺 variant → BLOCKER（捕获强制）
  run('capture_style_fields_pixel1to1_missing_variant_blocker', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: cta',
        '          type: action_button',
        '          order: 0',
        '          text: 添加管理卡片',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const specMd = '```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\n```\n';
      const r = checkCaptureStyleFields(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      const hit = r.find(x => x.id === 'capture_style_fields' && x.status === 'FAIL' && x.severity === 'BLOCKER');
      if (!hit) throw new Error('缺 variant 未判 BLOCKER：' + JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G3 Slice 2 防误拒：声明 variant → PASS
  run('capture_style_fields_variant_declared_pass', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: cta',
        '          type: action_button',
        '          order: 0',
        '          variant: ghost',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const specMd = '```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\n```\n';
      const r = checkCaptureStyleFields(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      if (r.find(x => x.id === 'capture_style_fields' && x.status === 'FAIL')) {
        throw new Error('声明了 variant 仍 FAIL：' + JSON.stringify(r));
      }
      if (!r.find(x => x.id === 'capture_style_fields' && x.status === 'PASS')) {
        throw new Error('声明 variant 未 PASS：' + JSON.stringify(r));
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G3 Slice 2：semantic_layout 零噪声（不强制 variant）
  run('capture_style_fields_semantic_layout_skipped', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root: { type: action_button, order: 0 }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const specMd = '```yaml\nui_change: new_or_changed\nfidelity_target: semantic_layout\n```\n';
      const r = checkCaptureStyleFields(baseCtx(root), specMd);
      if (r.length !== 0) throw new Error('semantic_layout 不应产出（零噪声）：' + JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G3 Slice 3：按钮填充分类纯函数（实心/透明/无）
  run('has_solid_button_background', () => {
    if (!hasSolidButtonBackground("Button('x').backgroundColor($r('app.color.brand_primary'))")) {
      throw new Error('实心 backgroundColor 应判 true');
    }
    if (hasSolidButtonBackground("Button('x').backgroundColor(Color.Transparent)")) {
      throw new Error('Color.Transparent 不应判 true');
    }
    if (hasSolidButtonBackground("Button('x').fontSize(16)")) {
      throw new Error('无 backgroundColor 不应判 true');
    }
  });

  // G3 Slice 3：声明 variant=ghost 但单 Button struct 被实心填充 → WARN（静态早警）
  run('variant_parity_ghost_but_solid_fill_warn', () => {
    const root = mkProject();
    try {
      fs.mkdirSync(path.join(root, 'doc', 'features', 'bank-card', 'plan'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'doc', 'features', 'bank-card', 'plan', 'visual-parity.yaml'),
        ['components:', '  - ui_spec_node_id: cta', '    contract_component: CtaButton'].join('\n'),
      );
      const etsDir = path.join(root, 'features', 'wallet', 'src', 'main', 'ets');
      fs.mkdirSync(etsDir, { recursive: true });
      fs.writeFileSync(path.join(etsDir, 'Cta.ets'), [
        '@Component',
        'struct CtaButton {',
        '  build() {',
        "    Button('添加管理卡片').backgroundColor($r('app.color.brand_primary'))",
        '  }',
        '}',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: cta',
        '          type: action_button',
        '          order: 0',
        '          variant: ghost',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const doc = loadUiSpecFile(uiSpecAbsPath(root, 'bank-card'))!;
      const ctx = baseCtx(root, {
        featureSpec: { feature: 'bank-card', contracts: { modules: [{ package_path: 'features/wallet' }] } },
      } as unknown as Partial<CheckContext>);
      const issues = collectVariantParityIssues(ctx, doc, false);
      if (!issues.some(i => i.kind === 'variant' && i.id === 'cta')) {
        throw new Error('ghost 按钮实心填充未告警：' + JSON.stringify(issues));
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G4：brand_logo 既无真实素材也未显式占位（会被通用图标冒充）→ pixel_1to1 BLOCKER
  run('brand_asset_honesty_impersonation_blocker', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: huawei_card',
        '          type: content_display',
        '          order: 0',
        '          icon: { kind: brand_logo, ref: huawei_card_logo }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const r = checkAssetManifest(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r.find(x => x.id === 'brand_asset_honesty' && x.status === 'FAIL' && x.severity === 'BLOCKER');
      if (!hit) throw new Error('brand_logo 无素材无占位未判 BLOCKER：' + JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G4 防误判：brand_logo 显式标 placeholder → 走占位诚实路径，不判 impersonation
  run('brand_asset_honesty_placeholder_not_impersonation', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: huawei_card',
        '          type: content_display',
        '          order: 0',
        '          icon: { kind: brand_logo, ref: huawei_card_logo }',
        'tokens: {}',
        'assets:',
        '  - key: huawei_card_logo',
        '    acquisition: repo_ref',
        '    placeholder: true',
        '    rationale: 无真实素材',
      ].join('\n'));
      const r = checkAssetManifest(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      if (r.find(x => x.id === 'brand_asset_honesty')) {
        throw new Error('显式占位被误判为 impersonation：' + JSON.stringify(r));
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // x-capture-bug：两屏撞 screenshot_hash（Tab 未切换/截同一屏）→ pixel_1to1 BLOCKER
  run('visual_diff_hash_collision_pixel1to1_blocker', () => {
    const root = mkProject();
    try {
      const dtDir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing');
      const shotDir = path.join(dtDir, 'device-screenshots');
      fs.mkdirSync(shotDir, { recursive: true });
      // 两屏写入相同字节 → 相同真实 hash（复刻 home/mine 撞 d3bea384…）
      fs.writeFileSync(path.join(shotDir, 'shot-home.png'), 'identical-bytes');
      fs.writeFileSync(path.join(shotDir, 'shot-page2.png'), 'identical-bytes');
      const h = hashScreenshotFile(path.join(shotDir, 'shot-home.png'));
      if (!h) throw new Error('hash 计算失败');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        '  - id: page2',
        '    priority: P0',
        '    ref_id: page2',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\n```\n');
      fs.writeFileSync(path.join(dtDir, 'visual-diff.md'), '# diff');
      const shotRel = 'doc/features/bank-card/device-testing/device-screenshots';
      const mk = (id: string) => ({
        screen_id: id, verdict: 'pass', ref_id: id,
        screenshot_path: `${shotRel}/shot-${id}.png`,
        fidelity_score: 0.9, geometric_iou: 0.9,
        screenshot_hash: h, evaluated_screenshot_hash: h, reverse_missing: [],
      });
      fs.writeFileSync(path.join(shotDir, 'visual-diff.json'),
        JSON.stringify({ schema_version: '1.0', screens: [mk('home'), mk('page2')] }));
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const blocker = r.find((x: { severity?: string; status: string; details?: string }) =>
        x.severity === 'BLOCKER' && x.status === 'FAIL' && /screenshot_hash|未切换/.test(x.details ?? ''));
      if (!blocker) throw new Error('撞 hash 在 pixel_1to1 未升 BLOCKER：' + JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G4b：未确认的 crop 资产在 pixel_1to1 → asset_crop_confirm_required BLOCKER（goal 模式 halt-confirm 门禁）
  run('asset_crop_confirm_required_pixel1to1_blocker', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const refPng = path.join(root, 'doc', 'features', 'bank-card', 'ux-reference', 'home.png');
      fs.mkdirSync(path.dirname(refPng), { recursive: true });
      writeMinimalRedPng(refPng, 40, 40);
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'), [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: pixel_1to1',
        'visual_handoff:',
        '  kind: screenshot_pack',
        '  authoritative_refs:',
        '    - id: home',
        '      path: doc/features/bank-card/ux-reference/home.png',
        '```',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets:',
        '  - key: bank_logo',
        '    acquisition: crop',
        '    source_ref: home',
        '    source_bbox: [0, 0, 0.5, 0.5]',
      ].join('\n'));
      const r = checkAssetAcquisition(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r.find(x => x.id === 'asset_crop_confirm_required' && x.status === 'FAIL' && x.severity === 'BLOCKER');
      if (!hit) throw new Error('未确认 crop 在 pixel_1to1 未升 BLOCKER：' + JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G4b 残留闭合：headless 下 human_crop_confirmed=true 但无 crop_confirmed_by = 自报 → 仍挡 BLOCKER
  run('crop_confirm_headless_auto_forge_blocked', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    const prevHeadless = process.env.MAISON_GOAL_HEADLESS;
    try {
      process.env.MAISON_GOAL_HEADLESS = '1';
      const refPng = path.join(root, 'doc', 'features', 'bank-card', 'ux-reference', 'home.png');
      fs.mkdirSync(path.dirname(refPng), { recursive: true });
      writeMinimalRedPng(refPng, 40, 40);
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        ['```yaml', 'ui_change: new_or_changed', 'fidelity_target: pixel_1to1', 'visual_handoff:', '  kind: screenshot_pack', '  authoritative_refs:', '    - id: home', '      path: doc/features/bank-card/ux-reference/home.png', '```'].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets:',
        '  - key: bank_logo',
        '    acquisition: crop',
        '    source_ref: home',
        '    source_bbox: [0, 0, 0.5, 0.5]',
        '    human_crop_confirmed: true',
      ].join('\n'));
      const r = checkAssetAcquisition(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      if (!r.find(x => x.id === 'asset_crop_confirm_required' && x.severity === 'BLOCKER')) {
        throw new Error('headless 自报 human_crop_confirmed 未被门禁挡：' + JSON.stringify(r));
      }
    } finally {
      if (prevHeadless === undefined) delete process.env.MAISON_GOAL_HEADLESS;
      else process.env.MAISON_GOAL_HEADLESS = prevHeadless;
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G4b 防误挡：headless 下用户自然语言授权 crop_confirmed_by=user_requirement → 放行裁剪，不进确认门禁
  run('crop_confirm_headless_explicit_confirmer_ok', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    const prevHeadless = process.env.MAISON_GOAL_HEADLESS;
    try {
      process.env.MAISON_GOAL_HEADLESS = '1';
      const refPng = path.join(root, 'doc', 'features', 'bank-card', 'ux-reference', 'home.png');
      fs.mkdirSync(path.dirname(refPng), { recursive: true });
      writeMinimalRedPng(refPng, 40, 40);
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        ['```yaml', 'ui_change: new_or_changed', 'fidelity_target: pixel_1to1', 'visual_handoff:', '  kind: screenshot_pack', '  authoritative_refs:', '    - id: home', '      path: doc/features/bank-card/ux-reference/home.png', '```'].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets:',
        '  - key: bank_logo',
        '    acquisition: crop',
        '    source_ref: home',
        '    source_bbox: [0, 0, 0.5, 0.5]',
        '    human_crop_confirmed: true',
        '    crop_confirmed_by: user_requirement',
      ].join('\n'));
      const r = checkAssetAcquisition(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      if (r.find(x => x.id === 'asset_crop_confirm_required')) {
        throw new Error('用户需求授权 crop_confirmed_by=user_requirement 被误挡：' + JSON.stringify(r));
      }
    } finally {
      if (prevHeadless === undefined) delete process.env.MAISON_GOAL_HEADLESS;
      else process.env.MAISON_GOAL_HEADLESS = prevHeadless;
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // G4b 守卫：user_requirement 是合法前置授权 sentinel，绝不可入自动化名单（否则焊死截图裁素材工作流）
  run('user_requirement_confirmer_is_valid_sentinel', () => {
    if (USER_REQUIREMENT_CONFIRMER !== 'user_requirement') {
      throw new Error('USER_REQUIREMENT_CONFIRMER 值变更，需同步 ui-spec.md/SKILL 约定');
    }
    if (isAutomationSigner(USER_REQUIREMENT_CONFIRMER)) {
      throw new Error('user_requirement 误入自动化身份名单，会焊死 NL 授权裁素材路径');
    }
  });

  // P0-6 守卫：授权哨兵 ≠ 验真签名——isHumanVerified 拒 user_requirement（含大小写/空白变体）与自动化身份，
  // 收真人名；isHumanConfirmed 语义保持不变（授权路径依赖它收 user_requirement，见上一个用例）。
  run('p0_6_is_human_verified_rejects_authorization_sentinel', () => {
    const { isHumanConfirmed, isHumanVerified, isHumanSignedDeferral } = require('../../scripts/utils/fidelity-shared');
    if (!isHumanConfirmed('user_requirement')) throw new Error('isHumanConfirmed 语义不得变——授权路径依赖它收 user_requirement');
    for (const forged of ['user_requirement', ' User_Requirement ', 'goal-mode-auto', '', undefined]) {
      if (isHumanVerified(forged)) throw new Error(`isHumanVerified 应拒 ${JSON.stringify(forged)}`);
    }
    for (const human of ['alice', '张三', 'sheng qsq']) {
      if (!isHumanVerified(human)) throw new Error(`isHumanVerified 应收真人名 ${human}`);
    }
    // deferral 人签同穴：signed_by=user_requirement 不算真人签字（交互态/headless 两口径都拒）
    const d = { element_id: 'x', human_signed: true, signed_by: 'user_requirement' };
    if (isHumanSignedDeferral(d) || isHumanSignedDeferral(d, { requireExplicitSigner: true })) {
      throw new Error('deferral signed_by=user_requirement 不得算真人签字');
    }
    if (!isHumanSignedDeferral({ element_id: 'x', human_signed: true, signed_by: 'alice' })) {
      throw new Error('deferral 真人签不得误伤');
    }
  });

  // G4b 端到端：headless + crop_confirmed_by=user_requirement（用户 NL 授权）→ 闸门放行、进裁剪路径
  run('crop_user_requirement_headless_enters_crop', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    const prevHeadless = process.env.MAISON_GOAL_HEADLESS;
    try {
      process.env.MAISON_GOAL_HEADLESS = '1';
      const refPng = path.join(root, 'doc', 'features', 'bank-card', 'ux-reference', 'home.png');
      fs.mkdirSync(path.dirname(refPng), { recursive: true });
      writeMinimalRedPng(refPng, 60, 60);
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        ['```yaml', 'ui_change: new_or_changed', 'fidelity_target: pixel_1to1', 'visual_handoff:', '  kind: screenshot_pack', '  authoritative_refs:', '    - id: home', '      path: doc/features/bank-card/ux-reference/home.png', '```'].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets:',
        '  - key: bank_logo',
        '    acquisition: crop',
        '    source_ref: home',
        '    source_bbox: [0, 0, 0.5, 0.5]',
        '    human_crop_confirmed: true',
        '    crop_confirmed_by: user_requirement',
      ].join('\n'));
      const r = checkAssetAcquisition(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      if (r.find(x => x.id === 'asset_crop_confirm_required')) {
        throw new Error('user_requirement 前置授权被误挡进确认门禁：' + JSON.stringify(r));
      }
      const acq = r.find(x => x.id === 'asset_acquisition');
      if (!acq || !/裁图/.test(acq.details ?? '')) {
        throw new Error('user_requirement 授权下未进入裁剪路径：' + JSON.stringify(r));
      }
    } finally {
      if (prevHeadless === undefined) delete process.env.MAISON_GOAL_HEADLESS;
      else process.env.MAISON_GOAL_HEADLESS = prevHeadless;
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('capture_completeness_missing_ref_elements_blocker', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const specMd = '```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\n```\n';
      const r = checkCaptureCompleteness(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      const hit = r.find(x => x.id === 'capture_completeness' && x.status === 'FAIL');
      if (!hit) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('capture_completeness_covers_ref_elements', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ref-elements.yaml'), [
        'schema_version: "1.0"',
        'elements:',
        '  - element_id: search_bar',
        '    disposition: implement',
        '  - element_id: promo_badge',
        '    disposition: implement',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    must_have_elements: [search_bar, promo_badge]',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: search_bar',
        '          type: search_field',
        '          order: 0',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const specMd = '```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\n```\n';
      const r = checkCaptureCompleteness(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      const hit = r.find(x => x.id === 'capture_completeness' && x.status === 'PASS');
      if (!hit) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('asset_manifest_pixel1to1_placeholder_warn', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets:',
        '  - key: bank_logo',
        '    placeholder: true',
        '    rationale: pending',
      ].join('\n'));
      const r = checkAssetManifest(baseCtx(root, {
        fidelityTarget: 'pixel_1to1',
        effectiveAssetAcquisitionMode: 'user_dir',
      }));
      const hit = r.find(x => x.id === 'asset_placeholder_manifest');
      if (!hit || hit.status !== 'FAIL' || hit.severity !== 'BLOCKER') {
        throw new Error(JSON.stringify(r));
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('ref_elements_defer_unsigned_blocker', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ref-elements.yaml'), [
        'schema_version: "1.0"',
        'elements:',
        '  - element_id: search_bar',
        '    disposition: defer',
      ].join('\n'));
      const specMd = [
        '```yaml',
        'ui_change: new_or_changed',
        'fidelity_target: pixel_1to1',
        '```',
      ].join('\n');
      const r = checkFidelityGovernance(baseCtx(root, { fidelityTarget: 'pixel_1to1' }), specMd);
      const hit = r.find(x => x.id === 'ref_elements_defer_human_sign' && x.status === 'FAIL');
      if (!hit || hit.severity !== 'BLOCKER') throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('visual_diff_dedup_does_not_mask_fail', () => {
    if (!isJimpAvailable()) return;
    const root = mkProject();
    try {
      const ddir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'device-screenshots');
      fs.mkdirSync(ddir, { recursive: true });
      const shot = path.join(ddir, 'shot-home.png');
      writeMinimalRedPng(shot, 10, 10);
      const hash = hashScreenshotFile(shot);
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'spec.md'),
        '```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\n```\n');
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: home',
        '    root: { type: navigation_frame, order: 0 }',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'device-testing', 'visual-diff.md'), '# diff');
      fs.writeFileSync(path.join(ddir, 'visual-diff.json'), JSON.stringify({
        schema_version: '1.0',
        screens: [
          {
            screen_id: 'home',
            verdict: 'fail',
            screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
            ref_id: 'home',
            must_fix: ['missing search bar'],
            screenshot_hash: hash,
            evaluated_screenshot_hash: hash,
            reverse_missing: ['search_bar'],
          },
          {
            screen_id: 'dup',
            verdict: 'pass',
            screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
            ref_id: 'home',
            fidelity_score: 0.9,
            geometric_iou: 0.8,
            screenshot_hash: hash,
            evaluated_screenshot_hash: hash,
            reverse_missing: [],
          },
        ],
      }));
      const r = checkVisualDiff(baseCtx(root, { fidelityTarget: 'pixel_1to1' }));
      const hit = r.find(x => x.id === 'visual_diff');
      if (!hit || hit.status !== 'FAIL' || hit.severity !== 'BLOCKER') {
        throw new Error(`fail must win over dedup WARN: ${JSON.stringify(hit)}`);
      }
      if (!/must-fix|reverse diff|screenshot_hash/.test(hit.details ?? '')) {
        throw new Error(`expected aggregated details: ${hit.details}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('scan_struct_resource_refs_scoped_to_struct_body', () => {
    const root = mkProject();
    try {
      const modDir = path.join(root, 'entry', 'src', 'main', 'ets', 'pages');
      fs.mkdirSync(modDir, { recursive: true });
      fs.writeFileSync(path.join(modDir, 'BankPage.ets'), [
        '@Component',
        'struct OtherRow {',
        '  build() {',
        "    Text().fontColor($r('app.color.brand_cmb'))",
        '  }',
        '}',
        '',
        '@Component',
        'struct BankLogoRow {',
        '  build() {',
        "    Text('logo')",
        '  }',
        '}',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'contracts.yaml'), [
        'modules:',
        '  - module_id: entry',
        '    package_path: entry',
      ].join('\n'));
      const body = extractStructBody(fs.readFileSync(path.join(modDir, 'BankPage.ets'), 'utf-8'), 'BankLogoRow');
      if (!body || /brand_cmb/.test(body)) throw new Error(`BankLogoRow body leaked: ${body}`);
      const otherBody = extractStructBody(fs.readFileSync(path.join(modDir, 'BankPage.ets'), 'utf-8'), 'OtherRow');
      if (!otherBody || !/brand_cmb/.test(otherBody)) throw new Error('OtherRow should contain brand_cmb');

      const contracts = {
        modules: [{ name: 'entry', layer: 'presentation', format: 'HAP', change_type: 'modify', package_path: 'entry' }],
      } as NonNullable<CheckContext['featureSpec']['contracts']>;
      const logoRefs = scanStructResourceRefs(root, contracts, 'BankLogoRow');
      const otherRefs = scanStructResourceRefs(root, contracts, 'OtherRow');
      if (logoRefs.has('app.color.brand_cmb')) throw new Error(`BankLogoRow should not inherit OtherRow ref: ${[...logoRefs]}`);
      if (!otherRefs.has('app.color.brand_cmb')) throw new Error(`OtherRow missing ref: ${[...otherRefs]}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('extract_struct_body_ignores_braces_in_strings', () => {
    const src = [
      '@Component',
      'struct BankLogoRow {',
      "  private hint: string = 'brace in copy: { not a block }';",
      '  build() {',
      "    Text('logo').fontColor($r('app.color.brand_cmb'))",
      '  }',
      '}',
    ].join('\n');
    const body = extractStructBody(src, 'BankLogoRow');
    if (!body) throw new Error('body not extracted');
    if (!body.includes('app.color.brand_cmb')) throw new Error(`missing color ref in body: ${body}`);
    if (!body.includes('brace in copy')) throw new Error('string content lost');
    const other = extractStructBody(src + '\n@Component struct Tail { build() { Text("x") } }', 'Tail');
    if (!other || body.includes('struct Tail')) throw new Error('body swallowed tail struct');
  });

  run('collect_resource_refs_ignores_comment_and_string', () => {
    const src = [
      'struct BankLogoRow {',
      '  build() {',
      "    // TODO: Text().fontColor($r('app.color.brand_cmb'))",
      "    const note = \"fake $r('app.color.brand_dce')\";",
      "    Text('logo').fontColor($r('app.color.brand_cmb'))",
      '  }',
      '}',
    ].join('\n');
    const body = extractStructBody(src, 'BankLogoRow');
    if (!body) throw new Error('no body');
    const refs = collectResourceRefsInActiveCode(body);
    if (!refs.has('app.color.brand_cmb')) throw new Error(`missing real ref: ${[...refs]}`);
    if (refs.has('app.color.brand_dce')) throw new Error(`comment/string ref leaked: ${[...refs]}`);
    if (refs.size !== 1) throw new Error(`expected 1 ref got ${refs.size}: ${[...refs]}`);
  });

  run('extract_struct_body_ignores_commented_struct_declaration', () => {
    const src = [
      '/* legacy struct BankLogoRow {',
      "  build() { Text().fontColor($r('app.color.brand_cmb')) }",
      '} */',
      '@Component',
      'struct BankLogoRow {',
      '  build() {',
      "    Text('logo')",
      '  }',
      '}',
    ].join('\n');
    const body = extractStructBody(src, 'BankLogoRow');
    if (!body || /brand_cmb/.test(body)) {
      throw new Error(`commented struct leaked into body: ${body}`);
    }
    const contracts = {
      modules: [{ name: 'entry', layer: 'presentation', format: 'HAP', change_type: 'modify', package_path: 'entry' }],
    } as NonNullable<CheckContext['featureSpec']['contracts']>;
    const root = mkProject();
    try {
      const modDir = path.join(root, 'entry', 'src', 'main', 'ets');
      fs.mkdirSync(modDir, { recursive: true });
      fs.writeFileSync(path.join(modDir, 'Page.ets'), src);
      const refs = scanStructResourceRefs(root, contracts, 'BankLogoRow');
      if (refs.size > 0) throw new Error(`comment-only struct must not bind: ${[...refs]}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('extract_struct_body_only_commented_struct_returns_null', () => {
    const src = [
      '// struct BankLogoRow {',
      "//   build() { Text().fontColor($r('app.color.brand_cmb')) }",
      '// }',
    ].join('\n');
    if (extractStructBody(src, 'BankLogoRow') !== null) {
      throw new Error('commented-only struct should not extract');
    }
  });

  run('semantic_color_binding_fails_without_struct_level_ref', () => {
    const root = mkProject();
    try {
      const modDir = path.join(root, 'entry', 'src', 'main', 'ets', 'pages');
      const resDir = path.join(root, 'entry', 'src', 'main', 'resources', 'base', 'element');
      fs.mkdirSync(modDir, { recursive: true });
      fs.mkdirSync(resDir, { recursive: true });
      fs.writeFileSync(path.join(resDir, 'color.json'), JSON.stringify({ color: { brand_cmb: '#C7000B' } }));
      fs.writeFileSync(path.join(modDir, 'BankPage.ets'), [
        '@Component struct OtherRow { build() { Text().fontColor($r(\'app.color.brand_cmb\')) } }',
        '@Component struct BankLogoRow { build() { Text(\'logo\') } }',
      ].join('\n'));
      const vpDir = path.join(root, 'doc', 'features', 'bank-card', 'plan');
      fs.mkdirSync(vpDir, { recursive: true });
      fs.writeFileSync(path.join(vpDir, 'visual-parity.yaml'), [
        'mappings:',
        '  components:',
        '    - ui_spec_node_id: bank_logo',
        '      contract_component: BankLogoRow',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: bank_logo',
        '          type: content_display',
        '          order: 0',
        '          color_ref: brand.cmb',
        '          semantic_role: brand_primary',
        'tokens: {}',
        'assets: []',
      ].join('\n'));
      const ctx = baseCtx(root, {
        fidelityTarget: 'pixel_1to1',
        featureSpec: {
          feature: 'bank-card',
          contracts: {
            modules: [{ name: 'entry', layer: 'presentation', format: 'HAP', change_type: 'modify', package_path: 'entry' }],
          } as NonNullable<CheckContext['featureSpec']['contracts']>,
        },
      });
      const doc = loadUiSpecFile(uiSpecAbsPath(root, 'bank-card'));
      if (!doc) throw new Error('ui-spec load failed');
      const issues = collectSemanticColorBindingIssues(ctx, doc, false);
      const hit = issues.find(i => i.id === 'bank_logo' || i.detail.includes('BankLogoRow'));
      if (!hit) throw new Error(`expected struct-level binding fail: ${JSON.stringify(issues)}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
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
