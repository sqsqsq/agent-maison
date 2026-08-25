// ============================================================================
// asset-placeholder.unit.test.ts — 素材占位能力（角色占位生成 / 占位 CLI / $r 引用扫描）
// ----------------------------------------------------------------------------
// 出身：本套用例原属 `ui-kit.unit.test.ts`。plan e6b3f8d2 t3 撤销强制 Maison UI kit 后，
// **素材占位能力与 kit 解耦保留**（npm script 亦改名为 `asset:placeholders`），
// 故这些与 kit 无关的用例整体迁出，原文件随 kit 一并删除。
//
// 锁定：占位 provenance marker、planPlaceholderGeneration 三态、no-clobber（真素材字节
// 不得被覆盖）、占位 CLI 的路径/非法 key 边界、按 `$r()` 真实引用模块限定的占位债务、
// ui-spec schema 的资源名边界。
// ============================================================================

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, featureFilePath } from '../../../../../harness/config';
import { ensureConsumerFrameworkTree } from '../../../../../harness/tests/utils/layout-test-helper';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function withTmp<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-placeholder-'));
  ensureConsumerFrameworkTree(dir);
  clearFrameworkConfigCache();
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    clearFrameworkConfigCache();
  }
}

function writePlaceholderCliFixture(root: string, opts: { pkgPathYaml: string; assetKey: string }): void {
  const cPath = featureFilePath(root, 'demo', 'contracts.yaml');
  fs.mkdirSync(path.dirname(cPath), { recursive: true });
  fs.writeFileSync(cPath, [
    'modules:',
    '  - name: M',
    `    package_path: '${opts.pkgPathYaml}'`,
    '',
  ].join('\n'), 'utf-8');
  const uPath = featureFilePath(root, 'demo', path.join('spec', 'ui-spec.yaml'));
  fs.mkdirSync(path.dirname(uPath), { recursive: true });
  fs.writeFileSync(uPath, [
    'schema_version: "1.0"',
    'screens:',
    '  - id: s',
    '    priority: P0',
    '    root: { type: navigation_frame, order: 0, children: [] }',
    'tokens: {}',
    'assets:',
    `  - key: '${opts.assetKey}'`,
    '    acquisition: placeholder',
    '    placeholder: true',
    '',
  ].join('\n'), 'utf-8');
}

test('四轮 P0-1：占位 provenance marker——生成物可被 detectPlaceholderMarker 识别；真素材 SVG 无 marker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-'));
  try {
    const { generateRolePlaceholder, detectPlaceholderMarker } = require('../../asset-integrity') as typeof import('../../asset-integrity');
    const dest = path.join(dir, 'bank_logo_x.svg');
    generateRolePlaceholder({ role: 'brand_logo', key: 'bank_logo_x', label: '招商', destAbs: dest });
    const m = detectPlaceholderMarker(dest);
    assert.ok(m && m.kind === 'text_avatar' && m.key === 'bank_logo_x', JSON.stringify(m));
    const real = path.join(dir, 'real.svg');
    fs.writeFileSync(real, '<svg xmlns="x"><rect fill="#123456"/></svg>', 'utf-8');
    assert.strictEqual(detectPlaceholderMarker(real), null, '真素材无 marker');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('四轮 P0-1：planPlaceholderGeneration——placeholder:true 缺失→generate；真实素材缺失→blocked（不代生成）；已物化→skipped', () => {
  const { planPlaceholderGeneration } = require('../../asset-integrity') as typeof import('../../asset-integrity');
  const doc = {
    screens: [{ id: 's', priority: 'P0', root: { type: 'navigation_frame', order: 0, children: [] } }],
    tokens: {},
    assets: [
      { key: 'bank_logo_declared_ph', acquisition: 'placeholder', placeholder: true },
      { key: 'bank_logo_real_missing', acquisition: 'crop' },
      { key: 'bank_logo_done', acquisition: 'crop' },
      { key: 'sym_icon', acquisition: 'placeholder', placeholder: true },
    ],
  } as never;
  const plan = planPlaceholderGeneration(doc, key => (key === 'bank_logo_done' ? '/media/done.png' : null));
  assert.deepStrictEqual(plan.generate.map(g => g.key).sort(), ['bank_logo_declared_ph', 'sym_icon'], JSON.stringify(plan.generate));
  assert.ok(plan.generate.find(g => g.key === 'bank_logo_declared_ph')!.criticality === 'brand_critical', 'brand 占位仍 brand-critical');
  assert.ok(plan.blocked.some(b => b.key === 'bank_logo_real_missing'), '真实素材缺失须 blocked');
  assert.ok(plan.skipped.some(s => s.key === 'bank_logo_done'), '已物化 skipped');
});

test('六轮 P0：generateRolePlaceholder no-clobber——异内容存在→conflict 字节不变；同字节→幂等 written:false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noclobber-'));
  try {
    const { generateRolePlaceholder } = require('../../asset-integrity') as typeof import('../../asset-integrity');
    const dest = path.join(dir, 'bank_logo_k.svg');
    const real = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#123456"/></svg>';
    fs.writeFileSync(dest, real, 'utf-8');
    const r1 = generateRolePlaceholder({ role: 'brand_logo', key: 'bank_logo_k', label: 'K', destAbs: dest });
    assert.strictEqual(r1.conflict, true, '异内容须 conflict');
    assert.strictEqual(r1.written, false, 'conflict 不落盘');
    assert.strictEqual(fs.readFileSync(dest, 'utf-8'), real, '真素材字节不得被覆盖');
    const dest2 = path.join(dir, 'bank_logo_k2.svg');
    const g1 = generateRolePlaceholder({ role: 'brand_logo', key: 'bank_logo_k2', label: 'K', destAbs: dest2 });
    assert.strictEqual(g1.written, true, '空位首生成落盘');
    const g2 = generateRolePlaceholder({ role: 'brand_logo', key: 'bank_logo_k2', label: 'K', destAbs: dest2 });
    assert.ok(!g2.conflict, '同字节幂等无 conflict');
    assert.strictEqual(g2.written, false, '同字节不重写');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('六轮 P0：占位 CLI——Windows 反斜杠 package_path + 已存在真实 SVG → skip 不覆盖（字节不变，exit 0）', () => {
  withTmp(root => {
    const { placeholderCliMain } = require('../../asset-placeholder-cli') as typeof import('../../asset-placeholder-cli');
    // contracts 用反斜杠 package_path（宿主实际形态）——修复前 restrict 匹配失败 → lookup 空 →
    // 真实 SVG 被占位覆盖；修复后 canonical 双侧匹配 → 已物化 skip
    writePlaceholderCliFixture(root, { pkgPathYaml: 'app\\feature', assetKey: 'bank_logo_x' });
    const mediaDir = path.join(root, 'app', 'feature', 'src', 'main', 'resources', 'base', 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    const realAbs = path.join(mediaDir, 'bank_logo_x.svg');
    const realBytes = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#654321"/></svg>';
    fs.writeFileSync(realAbs, realBytes, 'utf-8');
    const r = placeholderCliMain(['--project-root', root, '--feature', 'demo', '--apply'], root);
    assert.strictEqual(r.exitCode, 0, '已物化→skip，exit 0');
    assert.strictEqual(r.generated, 0, '不得生成');
    assert.strictEqual(fs.readFileSync(realAbs, 'utf-8'), realBytes, '真实 SVG 字节不得变化');
  });
});

test('六轮 P1-1：非法 asset key（../../x）→ 任何探测/落盘前 blocked，exit 1 且零产物', () => {
  withTmp(root => {
    const { placeholderCliMain } = require('../../asset-placeholder-cli') as typeof import('../../asset-placeholder-cli');
    writePlaceholderCliFixture(root, { pkgPathYaml: 'app/feature', assetKey: '../../x' });
    const r = placeholderCliMain(['--project-root', root, '--feature', 'demo', '--apply'], root);
    assert.strictEqual(r.exitCode, 1, '非法 key 须 blocked 非零退出');
    assert.deepStrictEqual(r.blocked, ['../../x']);
    assert.strictEqual(r.generated, 0, '零产物');
    // 越界目标位与模块 media 均不得出现落盘
    assert.ok(!fs.existsSync(path.join(root, 'app', 'feature', 'src', 'main', 'resources', 'x.svg')), '不得越 media 落盘');
    assert.ok(!fs.existsSync(path.join(root, 'app', 'feature', 'src', 'main', 'resources', 'base', 'media')), 'media 目录不得被创建');
  });
});

test('六轮 P1-3：findAllModuleMediaFiles restrict——限定引用模块后未引用模块同名文件不入结果', () => {
  withTmp(root => {
    const { findAllModuleMediaFiles } = require('../../coding-visual-parity-check') as typeof import('../../coding-visual-parity-check');
    for (const mod of ['appA', 'appB']) {
      const media = path.join(root, mod, 'src', 'main', 'resources', 'base', 'media');
      fs.mkdirSync(media, { recursive: true });
      fs.writeFileSync(path.join(media, 'bank_logo_x.svg'), `<svg xmlns="x"><!-- ${mod} --></svg>`, 'utf-8');
    }
    const contracts = { files: [], modules: [{ name: 'A', package_path: 'appA' }, { name: 'B', package_path: 'appB' }] } as never;
    const all = findAllModuleMediaFiles(root, contracts, 'bank_logo_x');
    assert.strictEqual(all.length, 2, '无 restrict 全模块');
    // restrict 用反斜杠形态传入（canonical 双侧）
    const onlyA = findAllModuleMediaFiles(root, contracts, 'bank_logo_x', new Set(['appA']));
    assert.strictEqual(onlyA.length, 1);
    assert.ok(onlyA[0].includes('appA'), onlyA[0]);
  });
});

test('六轮 P1-3：占位检查按 $r 实际引用模块限定——未引用模块残留占位不入债务；引用后命中', () => {
  withTmp(root => {
    const { checkVisualParity } = require('../../coding-visual-parity-check') as typeof import('../../coding-visual-parity-check');
    const { generateRolePlaceholder } = require('../../asset-integrity') as typeof import('../../asset-integrity');
    // spec.md（ui_change 前置）+ ui-spec（verified，声明 repo_ref 真素材）
    const specMd = featureFilePath(root, 'demo', path.join('spec', 'spec.md'));
    fs.mkdirSync(path.dirname(specMd), { recursive: true });
    fs.writeFileSync(specMd, '# spec\n\n```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
    const uPath = featureFilePath(root, 'demo', path.join('spec', 'ui-spec.yaml'));
    fs.writeFileSync(uPath, [
      'schema_version: "1.0"',
      'verified: human_confirmed',
      'verified_method: human_gate',
      'screens:',
      '  - id: s',
      '    priority: P0',
      '    root: { type: navigation_frame, order: 0, children: [ { type: nav_bar, id: top_nav, order: 0 } ] }',
      'tokens: {}',
      'assets:',
      '  - key: bank_logo_x',
      '    acquisition: repo_ref',
      '',
    ].join('\n'), 'utf-8');
    // 模块 A：真素材 + $r 引用；模块 B：maison 占位残留（marker SVG），初始无引用
    const mediaA = path.join(root, 'appA', 'src', 'main', 'resources', 'base', 'media');
    fs.mkdirSync(mediaA, { recursive: true });
    fs.writeFileSync(path.join(mediaA, 'bank_logo_x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#123456"/></svg>', 'utf-8');
    const etsA = path.join(root, 'appA', 'src', 'main', 'ets', 'presentation', 'pages');
    fs.mkdirSync(etsA, { recursive: true });
    fs.writeFileSync(path.join(etsA, 'A.ets'), "Image($r('app.media.bank_logo_x'))\n", 'utf-8');
    const mediaB = path.join(root, 'appB', 'src', 'main', 'resources', 'base', 'media');
    fs.mkdirSync(mediaB, { recursive: true });
    generateRolePlaceholder({ role: 'brand_logo', key: 'bank_logo_x', label: 'X', destAbs: path.join(mediaB, 'bank_logo_x.svg') });
    const ctx = {
      phase: 'coding', feature: 'demo', projectRoot: root, fidelityTarget: 'semantic_layout',
      phaseRule: { structure_checks: {} },
      featureSpec: {
        feature: 'demo',
        contracts: { files: [], modules: [{ name: 'A', package_path: 'appA' }, { name: 'B', package_path: 'appB' }] },
      },
    } as unknown as CheckContext;
    // 组1：B 无任何源文件 → B 的残留占位不得入债务（cursor 深度 review 后 clean 扫描
    // 落 PASS 结果供债务闭账——"不计入"的断言从"无结果"改为"零命中 PASS"）
    const r1 = checkVisualParity(ctx).find(r => r.id === 'asset_placeholder_present');
    assert.strictEqual(r1?.status, 'PASS', `未引用模块残留占位不得计入：${r1?.details}`);
    // 组2（七轮 P1-1 生产链）：B 只有**注释引用 + 普通字符串引用** → 仍不得计入
    const etsB = path.join(root, 'appB', 'src', 'main', 'ets', 'presentation', 'pages');
    fs.mkdirSync(etsB, { recursive: true });
    const etsBFile = path.join(etsB, 'B.ets');
    fs.writeFileSync(etsBFile, [
      "// Image($r('app.media.bank_logo_x'))",
      "/* Image($r('app.media.bank_logo_x')) */",
      'Text("$r(\'app.media.bank_logo_x\') 字符串里假装引用")',
    ].join('\n'), 'utf-8');
    const r2 = checkVisualParity(ctx).find(r => r.id === 'asset_placeholder_present');
    assert.strictEqual(r2?.status, 'PASS', `注释/字符串伪引用不得计入：${r2?.details}`);
    // 组3：B 真实 $r() 调用 → 占位命中入债务
    fs.writeFileSync(etsBFile, "Image($r('app.media.bank_logo_x'))\n", 'utf-8');
    const r3 = checkVisualParity(ctx).find(r => r.id === 'asset_placeholder_present');
    assert.ok(r3, '引用模块的占位须命中');
    assert.strictEqual(r3!.status, 'WARN');
    assert.ok(r3!.details.includes('bank_logo_x'), r3!.details);
  });
});

test('七轮 P1-1：scanResourceRefModules——注释/字符串 $r 不算引用模块，真实调用才算', () => {
  withTmp(root => {
    const { scanResourceRefModules } = require('../../source-ref-scan') as typeof import('../../source-ref-scan');
    const mk = (mod: string, content: string): void => {
      const dir = path.join(root, mod, 'src', 'main', 'ets');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'X.ets'), content, 'utf-8');
    };
    mk('appA', "Image($r('app.media.bank_logo_x'))\n");
    mk('appB', "// Image($r('app.media.bank_logo_x'))\nText(\"$r('app.media.bank_logo_x')\")\n");
    const contracts = { files: [], modules: [{ name: 'A', package_path: 'appA' }, { name: 'B', package_path: 'appB' }] } as never;
    const map = scanResourceRefModules(root, contracts);
    const refs = map.get('app.media.bank_logo_x');
    assert.ok(refs, '真实引用须命中');
    assert.deepStrictEqual([...refs!].sort(), ['appA'], '注释/字符串伪引用不得把 appB 计入引用模块');
  });
});

test('七轮 P2：占位 CLI——缺失/空白 key 不再静默过滤（blocked + exit 1）', () => {
  withTmp(root => {
    const { placeholderCliMain } = require('../../asset-placeholder-cli') as typeof import('../../asset-placeholder-cli');
    const cPath = featureFilePath(root, 'demo', 'contracts.yaml');
    fs.mkdirSync(path.dirname(cPath), { recursive: true });
    fs.writeFileSync(cPath, ['modules:', '  - name: M', "    package_path: 'app/feature'", ''].join('\n'), 'utf-8');
    const uPath = featureFilePath(root, 'demo', path.join('spec', 'ui-spec.yaml'));
    fs.mkdirSync(path.dirname(uPath), { recursive: true });
    fs.writeFileSync(uPath, [
      'schema_version: "1.0"',
      'screens:',
      '  - id: s',
      '    priority: P0',
      '    root: { type: navigation_frame, order: 0, children: [] }',
      'tokens: {}',
      'assets:',
      '  - acquisition: placeholder',
      "  - key: ''",
      '    acquisition: placeholder',
      '',
    ].join('\n'), 'utf-8');
    const r = placeholderCliMain(['--project-root', root, '--feature', 'demo', '--apply'], root);
    assert.strictEqual(r.exitCode, 1, '缺 key 条目须 blocked 非零退出（不得"计划干净"exit 0）');
    assert.strictEqual(r.blocked.length, 2, `两条坏条目全 blocked：${JSON.stringify(r.blocked)}`);
    assert.strictEqual(r.generated, 0);
  });
});

test('六轮统一口径：ui-spec schema 校验器拒非法 asset key（与 ASSET_KEY_RE 同源）', () => {
  const { validateUiSpecSchema } = require('../../ui-spec-schema-validate') as typeof import('../../ui-spec-schema-validate');
  const mk = (key: string): unknown => ({
    schema_version: '1.0', verified: 'unverified', verified_method: 'none',
    screens: [{ id: 's', priority: 'P0', root: { type: 'navigation_frame', order: 0, children: [] } }],
    tokens: {},
    assets: [{ key, acquisition: 'placeholder', placeholder: true }],
  });
  assert.deepStrictEqual(validateUiSpecSchema(mk('bank_logo_x') as never), [], '合法 key 放行');
  const errs = validateUiSpecSchema(mk('../../x') as never);
  assert.ok(errs.some(e => e.includes('非法资源名')), `路径穿越 key 须在 spec 期拒：${JSON.stringify(errs)}`);
});

test('canonical 契约集成：语义 type + acquisition:placeholder 过 validateUiSpecSchema 后 downstream 同源消费', () => {
  // plan e6b3f8d2 t3：原用例还断言 `node.block` 显式声明会被 kit 三段闭环消费——
  // kit 撤销后 `block` 字段已从 ui-spec 契约删除，故这里只保留「语义 type 与素材
  // 占位声明在 schema 与 downstream 同源」这一条（治单测假绿的原意不变）。
  const { validateUiSpecSchema } = require('../../ui-spec-schema-validate') as typeof import('../../ui-spec-schema-validate');
  const { planPlaceholderGeneration } = require('../../asset-integrity') as typeof import('../../asset-integrity');
  const doc = {
    schema_version: '1.0',
    verified: 'unverified',
    verified_method: 'none',
    screens: [{
      id: 'bank-list',
      priority: 'P0',
      root: {
        type: 'navigation_frame',
        order: 0,
        children: [
          { type: 'nav_bar', id: 'top_nav', order: 0 },
          { type: 'list_selection', id: 'lst', order: 1 },
        ],
      },
    }],
    tokens: { 'text.body': { kind: 'font_size', value: '14fp' } },
    assets: [{ key: 'bank_logo_icbc', acquisition: 'placeholder', placeholder: true }],
  } as never;
  const schemaErrors = validateUiSpecSchema(doc);
  assert.deepStrictEqual(schemaErrors, [], `canonical validator 须接受语义 type/placeholder：${JSON.stringify(schemaErrors)}`);
  const plan = planPlaceholderGeneration(doc, () => null);
  assert.deepStrictEqual(plan.generate.map(g => g.key), ['bank_logo_icbc']);
  assert.strictEqual(plan.blocked.length, 0);
});

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
