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

  run('ui_spec_screen_extension_field_allowed', () => {
    const root = mkProject();
    try {
      fs.writeFileSync(path.join(root, 'doc', 'features', 'bank-card', 'spec', 'ui-spec.yaml'), [
        'schema_version: "1.0"',
        'verified: human_confirmed',
        'verified_method: human_gate',
        'screens:',
        '  - id: home',
        '    priority: P0',
        '    custom_note: "profile extension"',
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
      if (fail && /非法字段/.test(fail.details ?? '')) {
        throw new Error(`extension fields should be allowed: ${JSON.stringify(fail)}`);
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

  return results;
}
