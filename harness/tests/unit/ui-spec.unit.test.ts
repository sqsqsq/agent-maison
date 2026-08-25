// ============================================================================
// ui-spec.unit.test.ts — ui-spec 结构守门 + CIEDE2000 回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { checkUiSpecStructure } from '../../../profiles/hmos-app/harness/spec-ui-spec-check';
import { checkVisualParityCoverage } from '../../../profiles/hmos-app/harness/plan-visual-parity-check';
import { deltaE2000, hexToLab } from '../../../profiles/hmos-app/harness/image-toolkit';
import { loadUiSpecFileWithShapeIssues } from '../../scripts/utils/ui-spec-shared';
import { asArray, takeArray } from '../../scripts/utils/shape-guards';
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
      ui_spec_structure: { description: 'ui-spec structure' },
      ui_spec_fidelity_gate: { description: 'ui-spec fidelity gate' },
    },
  } as unknown as PhaseRuleSpec;
}

function baseCtx(root: string, o: Partial<CheckContext> = {}): CheckContext {
  clearFrameworkConfigCache();
  const fw = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'));
  const resolvedProfile = loadResolvedProfile(root, fw);
  return {
    phase: 'spec',
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

function prdNewOrChanged(): string {
  return [
    '```yaml',
    'ui_change: new_or_changed',
    'visual_handoff:',
    '  kind: screenshot_pack',
    '  authoritative_refs:',
    '    - id: home',
    '      path: doc/features/bank-card/spec/assets/ref.png',
    '```',
  ].join('\n');
}

function validUiSpec(): string {
  return [
    'schema_version: "1.0"',
    'verified: human_confirmed',
    'verified_method: human_gate',
    'screens:',
    '  - id: home',
    '    priority: P0',
    '    root:',
    '      type: navigation_frame',
    '      order: 0',
    '      children:',
    '        - id: hint_text',
    '          type: content_display',
    '          order: 0',
    '          text: "支持 100 家银行"',
    '          bbox: [0.1, 0.1, 0.8, 0.05]',
    'tokens:',
    '  brand.cmb:',
    '    kind: color',
    '    value: "#C7000B"',
    'assets:',
    '  - key: bank_logo',
    '    acquisition: crop',
    '    resolved_path: doc/features/bank-card/spec/assets/logo.png',
    '    placeholder: false',
  ].join('\n');
}

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-spec-unit-'));
  fs.mkdirSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'assets'), { recursive: true });
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
  fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'assets', 'logo.png'), 'x');
  return root;
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

  run('ui_spec_missing_warn_when_reachable', () => {
    const root = mkProject();
    try {
      const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'reachable' }), prdNewOrChanged());
      const hit = r.find(x => x.id === 'ui_spec_structure' && x.status === 'WARN');
      if (!hit) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('ui_spec_valid_pass', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), validUiSpec());
      const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'strict' }), prdNewOrChanged());
      const hit = r.find(x => x.id === 'ui_spec_structure' && x.status === 'PASS');
      if (!hit) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('ui_spec_illegal_component_type_fail', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'verified_method: human_gate',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: btn',
        '          type: super_button',   // 非法 type
        '          order: 0',
        'tokens:',
        '  brand.cmb: { kind: colour, value: "#fff" }',  // 非法 kind
        'assets: []',
      ].join('\n'));
      const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'strict' }), prdNewOrChanged());
      const hit = r.find(x => x.id === 'ui_spec_structure' && x.status === 'FAIL');
      if (!hit || !/schema:/.test(hit.details ?? '')) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('ui_spec_illegal_order_type_fail', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: "0"',   // order 须 integer
        'tokens:',
        '  t: { kind: color, value: "#fff" }',
        'assets: []',
      ].join('\n'));
      const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'strict' }), prdNewOrChanged());
      const hit = r.find(x => x.id === 'ui_spec_structure' && x.status === 'FAIL');
      if (!hit || !/order/.test(hit.details ?? '')) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('ui_spec_strict_warning_not_pass', () => {
    // P0 屏子节点缺 id → warning；修复后 strict 下不得 PASS（历史反向 bug）
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'verified_method: human_gate',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - type: content_display',   // 缺 id
        '          order: 0',
        '          text: "x"',
        '          bbox: [0, 0, 1, 0.1]',
        'tokens:',
        '  t: { kind: color, value: "#fff" }',
        'assets: []',
      ].join('\n'));
      const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'strict' }), prdNewOrChanged());
      const hit = r.find(x => x.id === 'ui_spec_structure');
      if (!hit || hit.status === 'PASS') throw new Error(`strict warning should not PASS: ${JSON.stringify(r)}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('ui_spec_illegal_string_field_types_fail', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    ref_id: 123',                 // 须字符串
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      layout: 123',               // 须字符串
        'tokens:',
        '  t: { kind: color, value: "#fff", source_ref: 123 }',  // 须字符串
        'assets:',
        '  - key: logo',
        '    acquisition: crop',
        '    rationale: 123',              // 须字符串
        '    human_crop_confirmed: "yes"', // 须布尔
        '    placeholder: true',
      ].join('\n'));
      const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'strict' }), prdNewOrChanged());
      const hit = r.find(x => x.id === 'ui_spec_structure' && x.status === 'FAIL');
      const d = hit?.details ?? '';
      for (const frag of ['ref_id', 'layout', 'source_ref', 'rationale', 'human_crop_confirmed']) {
        if (!d.includes(frag)) throw new Error(`missing ${frag} in ${JSON.stringify(r)}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('ui_spec_deep_nested_missing_id_warn', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'verified_method: human_gate',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: panel',
        '          type: overlay_panel',
        '          order: 0',
        '          text: "x"',
        '          bbox: [0, 0, 1, 0.1]',
        '          children:',
        '            - type: action_button',   // 深层缺 id
        '              order: 0',
        'tokens:',
        '  t: { kind: color, value: "#fff" }',
        'assets: []',
      ].join('\n'));
      const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'reachable' }), prdNewOrChanged());
      const hit = r.find(x => x.id === 'ui_spec_structure');
      if (!hit || hit.status === 'PASS') throw new Error(`deep missing id should warn: ${JSON.stringify(r)}`);
      if (!/缺 id/.test(hit.details ?? '')) throw new Error(`expected 缺 id note: ${JSON.stringify(hit)}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('ui_spec_duplicate_node_id_fail', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'verified_method: human_gate',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: dup',
        '          type: action_button',
        '          order: 0',
        '        - id: dup',
        '          type: action_button',
        '          order: 1',
        'tokens:',
        '  t: { kind: color, value: "#fff" }',
        'assets: []',
      ].join('\n'));
      const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'strict' }), prdNewOrChanged());
      const hit = r.find(x => x.id === 'ui_spec_structure' && x.status === 'FAIL');
      if (!hit || !/重复/.test(hit.details ?? '')) throw new Error(JSON.stringify(r));
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // P0-2（plan 7c4f2e9b）契约反转：原名 ui_spec_screen_extension_field_allowed——
  // 「扩展字段静默放行」正是事故根因机制（must_have 错键在 additionalProperties:true 下
  // 覆盖清单归零、五连败 HALT）。新契约：screen/componentNode 未知键硬拒 + did-you-mean；
  // 合法扩展须先登记进 ui-spec.schema.json（SSOT）。
  run('ui_spec_screen_unknown_field_rejected_with_hint', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'verified_method: human_gate',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    must_have: [x]',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      profile_hint: keep',
        'tokens:',
        '  t: { kind: color, value: "#fff" }',
        'assets: []',
      ].join('\n'));
      const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'strict' }), prdNewOrChanged());
      const fail = r.find(x => x.id === 'ui_spec_structure' && x.status === 'FAIL');
      if (!fail || !/非法字段/.test(fail.details ?? '')) {
        throw new Error(`unknown keys must be rejected now: ${JSON.stringify(r)}`);
      }
      if (!/must_have_elements/.test(fail.details ?? '')) {
        throw new Error(`事故键 must_have 须给 did-you-mean 正名：${fail.details}`);
      }
      if (!/profile_hint/.test(fail.details ?? '')) {
        throw new Error(`componentNode 未知键也须被拒：${fail.details}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('deltaE_same_color_near_zero', () => {
    const lab = hexToLab('#C7000B');
    const d = deltaE2000(lab, lab);
    if (d > 0.01) throw new Error(`expected ~0 got ${d}`);
  });

  run('deltaE_red_vs_blue_large', () => {
    const d = deltaE2000(hexToLab('#C7000B'), hexToLab('#0000FF'));
    if (d < 10) throw new Error(`expected large ΔE got ${d}`);
  });

  // ==========================================================================
  // P0-2（plan d9b4f7e2）形状防崩溃 fixture 矩阵：{} / "" / 嵌套 dict / parse-null
  // 断言三件事：零 throw、结构化 FAIL（shape: 前缀）、非法形状不得静默 PASS。
  // ==========================================================================

  const shapeFixture = (uiSpecBody: string): { r: ReturnType<typeof checkUiSpecStructure>; root: string } => {
    const root = mkProject();
    fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), uiSpecBody);
    const r = checkUiSpecStructure(baseCtx(root, { uiSpecEnforcement: 'strict' }), prdNewOrChanged());
    return { r, root };
  };

  run('P0-2 shape: assets 为 dict（{}）→ 结构化 FAIL 不 throw 不静默 PASS', () => {
    const { r, root } = shapeFixture([
      'schema_version: "1.0"',
      'screens: []',
      'tokens: { brand: { kind: color, value: "#fff" } }',
      'assets: {}',
    ].join('\n'));
    try {
      const hit = r.find(x => x.id === 'ui_spec_structure');
      if (!hit || hit.status !== 'FAIL') throw new Error(`expect FAIL got ${JSON.stringify(hit)}`);
      if (!/shape: assets/.test(hit.details ?? '')) throw new Error(`missing shape issue: ${hit.details}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-2 shape: assets 为字符串（""）→ 结构化 FAIL 不 throw', () => {
    const { r, root } = shapeFixture([
      'schema_version: "1.0"',
      'screens: []',
      'tokens: { brand: { kind: color, value: "#fff" } }',
      'assets: ""',
    ].join('\n'));
    try {
      const hit = r.find(x => x.id === 'ui_spec_structure');
      if (!hit || hit.status !== 'FAIL') throw new Error(`expect FAIL got ${JSON.stringify(hit)}`);
      if (!/shape: assets/.test(hit.details ?? '')) throw new Error(`missing shape issue: ${hit.details}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-2 shape: screens 为 dict + 嵌套 children 为 dict → 结构化 FAIL 不 throw', () => {
    const { r, root } = shapeFixture([
      'schema_version: "1.0"',
      'screens:',
      '  - id: home',
      '    priority: P0',
      '    root:',
      '      type: navigation_frame',
      '      order: 0',
      '      children: { oops: true }',
      'tokens: { brand: { kind: color, value: "#fff" } }',
      'assets: []',
    ].join('\n'));
    try {
      const hit = r.find(x => x.id === 'ui_spec_structure');
      if (!hit || hit.status !== 'FAIL') throw new Error(`expect FAIL got ${JSON.stringify(hit)}`);
      if (!/shape: screens\[home\]\.root\.children/.test(hit.details ?? '')) throw new Error(`missing children shape issue: ${hit.details}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-2 shape: loadUiSpecFileWithShapeIssues 归一化后 doc 全字段可安全迭代', () => {
    const root = mkProject();
    try {
      const abs = path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml');
      fs.writeFileSync(abs, ['screens: ""', 'tokens: []', 'assets: { a: 1 }', 'global_elements: "x"'].join('\n'));
      const loaded = loadUiSpecFileWithShapeIssues(abs);
      if (!loaded) throw new Error('expect doc');
      if (!Array.isArray(loaded.doc.assets) || !Array.isArray(loaded.doc.screens)) throw new Error('normalize failed');
      if (!Array.isArray(loaded.doc.global_elements)) throw new Error('global_elements normalize failed');
      if (loaded.shapeIssues.length < 4) throw new Error(`expect ≥4 shape issues got ${loaded.shapeIssues.length}: ${loaded.shapeIssues.join(' | ')}`);
      // 崩溃回归：归一化后 collectAllComponentNodes 等迭代面零 throw
      for (const a of loaded.doc.assets) void a;
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-2 shape: 根节点解析为 null/标量 → loadUiSpecFile 返回 null（既有契约不变）', () => {
    const root = mkProject();
    try {
      const abs = path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml');
      fs.writeFileSync(abs, '"just a string"');
      if (loadUiSpecFileWithShapeIssues(abs) !== null) throw new Error('scalar root must load as null');
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-2 shape: visual-parity mappings.components 为 dict → 结构化 FAIL 不 throw（07-13 :142 崩溃回归）', () => {
    const root = mkProject();
    try {
      const featureDir = path.join(root, 'doc', 'features', 'bank-card');
      fs.mkdirSync(path.join(featureDir, 'plan'), { recursive: true });
      fs.writeFileSync(path.join(featureDir, 'spec', 'spec.md'), prdNewOrChanged());
      fs.writeFileSync(path.join(featureDir, 'spec', 'ui-spec.yaml'), validUiSpec());
      fs.writeFileSync(
        path.join(featureDir, 'plan', 'visual-parity.yaml'),
        ['mappings:', '  assets: ""', '  tokens: {}', '  components: { oops: 1 }'].join('\n'),
      );
      const ctx = baseCtx(root, {
        phase: 'plan',
        phaseRule: {
          phase: 'plan',
          structure_checks: { visual_parity_coverage: { description: 'vp coverage' } },
        } as unknown as PhaseRuleSpec,
      });
      const r = checkVisualParityCoverage(ctx);
      const hit = r.find(x => x.id === 'visual_parity_coverage');
      if (!hit) throw new Error(`expect result got ${JSON.stringify(r)}`);
      if (hit.status === 'PASS') throw new Error('invalid shapes must not silently PASS');
      if (!/shape: mappings\.components/.test(hit.details ?? '')) throw new Error(`missing components shape issue: ${hit.details}`);
      if (!/shape: mappings\.assets/.test(hit.details ?? '')) throw new Error(`missing assets shape issue: ${hit.details}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-2 asArray/takeArray 契约：非数组真值归空 + 留痕；缺失不留痕', () => {
    if (asArray(undefined).length !== 0 || asArray('').length !== 0 || asArray({ a: 1 }).length !== 0) {
      throw new Error('asArray must coerce non-arrays to []');
    }
    if (asArray([1, 2]).length !== 2) throw new Error('asArray must pass arrays through');
    const missIssues: string[] = [];
    takeArray(undefined, 'f', missIssues);
    takeArray(null, 'f', missIssues);
    if (missIssues.length > 0) throw new Error('missing fields must not record shape issues');
    const shapeIssues: string[] = [];
    takeArray({}, 'contracts.modules', shapeIssues);
    if (shapeIssues.length !== 1 || !/contracts\.modules/.test(shapeIssues[0])) throw new Error(`takeArray must record: ${shapeIssues.join('|')}`);
  });


  // ==========================================================================
  // plan e6b3f8d2 t3⑤：产品组件所有权硬地板五态回归
  // --------------------------------------------------------------------------
  // 撤销强制 Maison UI kit 后，盲档结构地板改由既有产品组件链承接：
  //   ui-spec P0 节点 → visual-parity.contract_component → contracts.components
  //   → contracts.files。这三项**不受 visual_parity_enforcement 降级**；
  //   assets/tokens 等视觉质量项照旧遵守档位。
  // ==========================================================================
  const ownershipUiSpec = (): string => [
    'schema_version: "1.0"',
    'verified: human_confirmed',
    'verified_method: human_gate',
    'screens:',
    '  - id: home',
    '    priority: P0',
    '    root:',
    '      type: navigation_frame',
    '      order: 0',
    '      children:',
    '        - id: hint_text',
    '          type: content_display',
    '          order: 0',
    '          text: "支持 100 家银行"',
    '          bbox: [0.1, 0.1, 0.8, 0.05]',
    'tokens: {}',
    'assets: []',
  ].join('\n');

  /** 完整所有权链（P0 节点 → contract_component → contracts.components/files） */
  const ownershipCtx = (
    root: string,
    opts: {
      enforcement?: 'off' | 'warn' | 'reachable' | 'strict';
      vpYaml?: string | null;
      components?: Array<{ name: string; file: string }>;
      files?: string[];
    },
  ): CheckContext => {
    const featureDir = path.join(root, 'doc', 'features', 'bank-card');
    fs.mkdirSync(path.join(featureDir, 'plan'), { recursive: true });
    fs.writeFileSync(path.join(featureDir, 'spec', 'spec.md'), prdNewOrChanged());
    fs.writeFileSync(path.join(featureDir, 'spec', 'ui-spec.yaml'), ownershipUiSpec());
    if (opts.vpYaml !== null) {
      fs.writeFileSync(
        path.join(featureDir, 'plan', 'visual-parity.yaml'),
        // 注意：collectP0ComponentNodeIds 的既有语义把**屏 id 本身**也算 P0 节点，
        // 故完整映射须同时覆盖 home 与 hint_text（本轮只改严重度，不改覆盖集）。
        opts.vpYaml ?? [
          'mappings:',
          '  assets: []',
          '  tokens: []',
          '  components:',
          '    - ui_spec_node_id: home',
          '      contract_component: HomePage',
          '    - ui_spec_node_id: hint_text',
          '      contract_component: HintText',
        ].join('\n'),
      );
    }
    return baseCtx(root, {
      phase: 'plan',
      phaseRule: {
        phase: 'plan',
        structure_checks: { visual_parity_coverage: { description: 'vp coverage' } },
      } as unknown as PhaseRuleSpec,
      ...(opts.enforcement ? { visualParityEnforcement: opts.enforcement } : {}),
      featureSpec: {
        feature: 'bank-card',
        contracts: {
          components: opts.components ?? [
            { name: 'HomePage', file: 'app/feature/HomePage.ets' },
            { name: 'HintText', file: 'app/feature/HintText.ets' },
          ],
          files: opts.files ?? ['app/feature/HomePage.ets', 'app/feature/HintText.ets'],
        },
      } as unknown as CheckContext['featureSpec'],
    });
  };

  run('t3⑤ 所有权硬地板①：默认 warn 下 P0 缺 contract_component 仍 BLOCKER FAIL（不降级）', () => {
    const root = mkProject();
    try {
      const ctx = ownershipCtx(root, {
        enforcement: 'warn',
        vpYaml: ['mappings:', '  assets: []', '  tokens: []', '  components: []'].join('\n'),
      });
      const [r] = checkVisualParityCoverage(ctx);
      if (r.status !== 'FAIL' || r.severity !== 'BLOCKER') {
        throw new Error(`warn 下所有权缺口须 BLOCKER FAIL：${r.severity}/${r.status} — ${r.details}`);
      }
      if (!r.details.includes('hint_text')) throw new Error(`须点名缺映射的 P0 节点：${r.details}`);
      if (!r.suggestion) throw new Error('BLOCKER 须带可执行 suggestion');
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('t3⑤ 所有权硬地板②：显式 off 同样 BLOCKER（off 不得整体 SKIP 掉所有权链）', () => {
    const root = mkProject();
    try {
      const ctx = ownershipCtx(root, {
        enforcement: 'off',
        vpYaml: ['mappings:', '  assets: []', '  tokens: []', '  components: []'].join('\n'),
      });
      const [r] = checkVisualParityCoverage(ctx);
      if (r.status !== 'FAIL' || r.severity !== 'BLOCKER') {
        throw new Error(`off 下所有权缺口仍须 BLOCKER FAIL：${r.severity}/${r.status} — ${r.details}`);
      }
      if (!r.details.includes('off')) throw new Error(`详情须点明档位未降级：${r.details}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('t3⑤ 所有权硬地板③：contracts.components 为空数组也判失败（旧实现反而跳过存在性检查）', () => {
    const root = mkProject();
    try {
      const ctx = ownershipCtx(root, { enforcement: 'warn', components: [], files: [] });
      const [r] = checkVisualParityCoverage(ctx);
      if (r.status !== 'FAIL' || r.severity !== 'BLOCKER') {
        throw new Error(`空 components 须判失败：${r.severity}/${r.status} — ${r.details}`);
      }
      if (!r.details.includes('为空数组')) throw new Error(`须点明空数组不是豁免：${r.details}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('t3⑤ 所有权硬地板④：组件 file 未进 contracts.files 判失败', () => {
    const root = mkProject();
    try {
      const ctx = ownershipCtx(root, {
        enforcement: 'warn',
        components: [
          { name: 'HomePage', file: 'app/feature/HomePage.ets' },
          { name: 'HintText', file: 'app/feature/HintText.ets' },
        ],
        files: ['app/feature/HomePage.ets'],
      });
      const [r] = checkVisualParityCoverage(ctx);
      if (r.status !== 'FAIL' || r.severity !== 'BLOCKER') {
        throw new Error(`file 不在 contracts.files 须判失败：${r.severity}/${r.status} — ${r.details}`);
      }
      if (!r.details.includes('contracts.files')) throw new Error(`须点名 files 缺口：${r.details}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('t3⑤ 所有权硬地板⑤：完整映射 → PASS；off 档下视觉质量项 SKIP 但所有权仍已校验', () => {
    const root = mkProject();
    try {
      const pass = checkVisualParityCoverage(ownershipCtx(root, { enforcement: 'warn' }))[0];
      if (pass.status !== 'PASS') throw new Error(`完整映射须 PASS：${pass.status} — ${pass.details}`);
      if (!pass.details.includes('产品组件所有权链完整')) {
        throw new Error(`PASS 详情须点明所有权链：${pass.details}`);
      }
      const off = checkVisualParityCoverage(ownershipCtx(root, { enforcement: 'off' }))[0];
      if (off.status !== 'SKIP') throw new Error(`off 且所有权通过 → 视觉质量项 SKIP：${off.status}`);
      if (!off.details.includes('所有权硬地板已校验通过')) {
        throw new Error(`SKIP 详情须如实说明所有权已校验：${off.details}`);
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('t3⑤ 所有权硬地板⑥：visual-parity.yaml 缺失且有 P0 节点 → BLOCKER（档位无关）', () => {
    const root = mkProject();
    try {
      for (const enforcement of ['warn', 'off', 'reachable'] as const) {
        const ctx = ownershipCtx(root, { enforcement, vpYaml: null });
        const [r] = checkVisualParityCoverage(ctx);
        if (r.status !== 'FAIL' || r.severity !== 'BLOCKER') {
          throw new Error(`enforcement=${enforcement} 缺 visual-parity.yaml 须 BLOCKER：${r.severity}/${r.status}`);
        }
      }
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('t3③ ui-spec 契约：node.block 字段已删除（schema 判非法字段，不得静默接受）', () => {
    const { validateUiSpecSchema } = require('../../../profiles/hmos-app/harness/ui-spec-schema-validate') as
      typeof import('../../../profiles/hmos-app/harness/ui-spec-schema-validate');
    const doc = {
      schema_version: '1.0', verified: 'unverified', verified_method: 'none',
      screens: [{
        id: 's', priority: 'P0',
        root: {
          type: 'navigation_frame', order: 0,
          children: [{ id: 'n', type: 'nav_bar', order: 0, block: 'nav_bar' }],
        },
      }],
      tokens: {}, assets: [],
    } as never;
    const errs = validateUiSpecSchema(doc);
    if (!errs.some(e => e.includes('block'))) {
      throw new Error(`block 字段须被判非法：${JSON.stringify(errs)}`);
    }
    // 结构语义 type 词保留（④）——不绑定实现
    const ok = validateUiSpecSchema({
      schema_version: '1.0', verified: 'unverified', verified_method: 'none',
      screens: [{
        id: 's', priority: 'P0',
        root: { type: 'navigation_frame', order: 0, children: [{ id: 'n', type: 'nav_bar', order: 0 }] },
      }],
      tokens: {}, assets: [],
    } as never);
    if (ok.length !== 0) throw new Error(`语义 type 词须保留合法：${JSON.stringify(ok)}`);
  });

  return results;
}
