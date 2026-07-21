// ============================================================================
// ui-kit.unit.test.ts — blind-visual-hardening d3 / P0-C
// ============================================================================
// 锁定：①锚点算法（归一/CJK/超长截断+hash 唯一/合法性/解析/同屏去重）；
// ②gallery 结构基线（blocks.json ↔ 代码映射对账、模板 .id(anchorId) 注入、token 使用、
//   硬编码色 lint 白名单）——编译+设备基线截图属 P1-G 实机段，此处为结构段；
// ③scaffolder（幂等三态：written/skipped_identical/conflict；目标目录四级解析）；
// ④三段闭环（声明收集/源码段 PASS-FAIL/运行时段 PASS-FAIL，hypium dump 真形状）。
// ============================================================================

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ANCHOR_MAX_LENGTH,
  buildInstanceAnchor,
  findDuplicateAnchors,
  isValidAnchor,
  normalizeAnchorSegment,
  parseAnchor,
} from '../../ui-kit-anchors';
import {
  BLOCK_SEMANTIC_NODES,
  checkUiKitDeclarationRequired,
  checkUiKitRuntimeConformance,
  checkUiKitSourceConformance,
  collectDeclaredBlockInstances,
  stripArkTsComments,
} from '../../ui-kit-conformance-check';
import { resolveUiKitTargetDir, scaffoldUiKit, uiKitTemplatesDir } from '../../ui-kit-scaffolder';
import { clearFrameworkConfigCache, featureFilePath, featureDir } from '../../../../../harness/config';
import { ensureConsumerFrameworkTree } from '../../../../../harness/tests/utils/layout-test-helper';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import type { UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function withTmp<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-kit-'));
  ensureConsumerFrameworkTree(dir);
  clearFrameworkConfigCache();
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    clearFrameworkConfigCache();
  }
}

// ---------------- ① 锚点 ----------------

test('锚点：归一（大写/中文/空格→合法段）+ 五段结构 + 解析回读', () => {
  assert.strictEqual(normalizeAnchorSegment('Bank List'), 'bank-list');
  assert.strictEqual(normalizeAnchorSegment('招商银行'), 'x', 'CJK 全非法字符→兜底 x');
  const a = buildInstanceAnchor('bc-openCard', 'bank-list', 'bank_row', 'icbc');
  assert.strictEqual(a, 'maison:bc-opencard:bank-list:bank_row:icbc');
  assert.ok(isValidAnchor(a));
  const p = parseAnchor(a);
  assert.strictEqual(p?.screenId, 'bank-list');
});

test('锚点：超长仅截 instance_key + 4 位 hash 保唯一，总长 ≤96 且不同输入不碰撞', () => {
  const long1 = buildInstanceAnchor('f', 's', 'n', 'k'.repeat(200));
  const long2 = buildInstanceAnchor('f', 's', 'n', `${'k'.repeat(199)}x`);
  assert.ok(long1.length <= ANCHOR_MAX_LENGTH && long2.length <= ANCHOR_MAX_LENGTH);
  assert.ok(isValidAnchor(long1) && isValidAnchor(long2));
  assert.notStrictEqual(long1, long2, 'hash 后缀保唯一');
  assert.strictEqual(buildInstanceAnchor('f', 's', 'n', 'k'.repeat(200)), long1, '确定性');
});

test('锚点：同屏重复检出', () => {
  const a = buildInstanceAnchor('f', 's', 'row', 'icbc');
  assert.deepStrictEqual(findDuplicateAnchors([a, a, buildInstanceAnchor('f', 's', 'row', 'cmb')]), [a]);
});

// ---------------- ② gallery 结构基线 ----------------

test('gallery：blocks.json 与 BLOCK_SEMANTIC_NODES 双向对账（防两处漂移）', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(uiKitTemplatesDir(), 'blocks.json'), 'utf-8')) as {
    blocks: Record<string, { semantic_node: string; file: string }>;
  };
  const fromManifest = new Map(Object.entries(manifest.blocks).map(([name, b]) => [b.semantic_node, name]));
  assert.deepStrictEqual(
    Object.fromEntries([...fromManifest.entries()].sort()),
    Object.fromEntries(Object.entries(BLOCK_SEMANTIC_NODES).sort()),
    'blocks.json semantic_node↔组件名 须与代码侧映射一致',
  );
});

test('gallery：每个 block 模板存在、导出同名 struct、根容器 .id(this.anchorId) 注入、使用 sys token', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(uiKitTemplatesDir(), 'blocks.json'), 'utf-8')) as {
    blocks: Record<string, { file: string }>;
  };
  for (const [name, b] of Object.entries(manifest.blocks)) {
    const p = path.join(uiKitTemplatesDir(), b.file);
    assert.ok(fs.existsSync(p), `${b.file} 模板缺失`);
    const src = fs.readFileSync(p, 'utf-8');
    assert.ok(src.includes(`export struct ${name}`), `${name} struct 导出`);
    assert.ok(src.includes('.id(this.anchorId)'), `${name} 根锚点注入`);
    assert.ok(src.includes("$r('sys."), `${name} 应使用 sys token`);
  }
});

test('gallery：硬编码色 lint——白名单外不得出现 hex 字面量（token 纪律）', () => {
  const WHITELIST = new Set(['#FFFFFF', '#5B6B7A']); // 头像字色 + fallbackColor 缺省（中性调色板锚）
  for (const f of fs.readdirSync(uiKitTemplatesDir()).filter(x => x.endsWith('.ets'))) {
    const src = fs.readFileSync(path.join(uiKitTemplatesDir(), f), 'utf-8');
    for (const m of src.matchAll(/'(#[0-9A-Fa-f]{6})'/g)) {
      assert.ok(WHITELIST.has(m[1].toUpperCase()), `${f} 硬编码色 ${m[1]} 不在白名单`);
    }
  }
});

// ---------------- ③ scaffolder ----------------

test('scaffolder：幂等三态（首跑 written → 复跑 skipped_identical → 篡改 conflict 不覆盖）', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-target-'));
  try {
    const r1 = scaffoldUiKit(target);
    assert.ok(r1.entries.length >= 9 && r1.entries.every(e => e.action === 'written'), '首跑全 written');
    const r2 = scaffoldUiKit(target);
    assert.ok(r2.entries.every(e => e.action === 'skipped_identical'), '复跑全 skip');
    const victim = path.join(target, r1.entries[0].file);
    fs.appendFileSync(victim, '\n// host edit\n');
    const before = fs.readFileSync(victim, 'utf-8');
    const r3 = scaffoldUiKit(target);
    assert.ok(r3.conflicts.some(e => e.file === r1.entries[0].file), '篡改应 conflict');
    assert.strictEqual(fs.readFileSync(victim, 'utf-8'), before, 'conflict 不静默覆盖');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('scaffolder：目标目录解析——显式配置优先；无层级可推导 → halt 不写猜测路径', () => {
  withTmp(root => {
    // halt：默认 consumer 树无 outer_layers 模块
    const r0 = resolveUiKitTargetDir(root);
    assert.strictEqual(r0.status, 'halt', 'halt');
    // 显式配置优先（tmp 树无 framework.config.json——loadFrameworkConfig 缺省容忍，直接落新文件）
    const cfgPath = path.join(root, 'framework.config.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ paths: { ui_kit_target_dir: 'app/common/src/main/ets/maison_ui_kit' } }, null, 2),
      'utf-8',
    );
    clearFrameworkConfigCache();
    const r1 = resolveUiKitTargetDir(root);
    assert.strictEqual(r1.status, 'resolved');
    assert.strictEqual(r1.source, 'config');
    assert.ok(r1.targetAbs!.replace(/\\/g, '/').endsWith('app/common/src/main/ets/maison_ui_kit'));
  });
});

// ---------------- ④ 三段闭环 ----------------

function docWithBlocks(): UiSpecDoc {
  return {
    screens: [{
      id: 'bank-list',
      priority: 'P0',
      root: {
        type: 'navigation_frame',
        order: 0,
        children: [
          { type: 'nav_bar', id: 'top_nav', order: 0 },
          { type: 'list_selection', id: 'bank_list', order: 1, block: 'list_card_container' },
        ],
      },
    }],
    tokens: {},
    assets: [],
  } as unknown as UiSpecDoc;
}

test('声明收集：node.type 语义节点 + node.block 显式声明都命中；anchorPrefix 归一', () => {
  const decls = collectDeclaredBlockInstances(docWithBlocks(), 'bc-openCard');
  assert.strictEqual(decls.length, 2);
  const nav = decls.find(d => d.semanticNode === 'nav_bar')!;
  assert.strictEqual(nav.blockComponent, 'MaisonNavBar');
  assert.strictEqual(nav.anchorPrefix, 'maison:bc-opencard:bank-list:top_nav');
  const card = decls.find(d => d.semanticNode === 'list_card_container')!;
  assert.strictEqual(card.blockComponent, 'MaisonListCard');
});

function writeUiSpecWithBlocks(root: string): void {
  const p = featureFilePath(root, 'demo', path.join('spec', 'ui-spec.yaml'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, [
    'schema_version: "1.0"',
    'screens:',
    '  - id: bank-list',
    '    priority: P0',
    '    root:',
    '      type: navigation_frame',
    '      order: 0',
    '      children:',
    '        - type: nav_bar',
    '          id: top_nav',
    '          order: 0',
    'tokens: {}',
    'assets: []',
    '',
  ].join('\n'), 'utf-8');
}

function ctxWithContracts(root: string): CheckContext {
  return {
    phase: 'coding',
    feature: 'demo',
    projectRoot: root,
    featureSpec: {
      feature: 'demo',
      contracts: { files: [], modules: [{ name: 'M', package_path: 'app/feature' }] },
    },
  } as unknown as CheckContext;
}

function materializeKit(root: string): void {
  // 显式配置目标目录 + 真实 scaffold（源码段现在强制 kit 已物化——codex P1-4）
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({ paths: { ui_kit_target_dir: 'app/feature/src/main/ets/maison_ui_kit' } }, null, 2),
    'utf-8',
  );
  clearFrameworkConfigCache();
  scaffoldUiKit(path.join(root, 'app/feature/src/main/ets/maison_ui_kit'));
}

test('源码段：kit 已物化 + block 实例化+锚点前缀在 → PASS；缺任一 → BLOCKER FAIL（注释伪注不作数）', () => {
  withTmp(root => {
    writeUiSpecWithBlocks(root);
    materializeKit(root);
    const pageDir = path.join(root, 'app/feature/src/main/ets/presentation/pages');
    fs.mkdirSync(pageDir, { recursive: true });
    const pageAbs = path.join(pageDir, 'BankListPage.ets');
    fs.writeFileSync(pageAbs, [
      "import { MaisonNavBar } from '../../maison_ui_kit/MaisonNavBar';",
      "MaisonNavBar({ anchorId: 'maison:demo:bank-list:top_nav:main' })",
    ].join('\n'), 'utf-8');
    const [ok] = checkUiKitSourceConformance(ctxWithContracts(root));
    assert.strictEqual(ok.status, 'PASS', ok.details);

    fs.writeFileSync(pageAbs, 'Text("bare")', 'utf-8');
    const [bad] = checkUiKitSourceConformance(ctxWithContracts(root));
    assert.strictEqual(bad.status, 'FAIL');
    assert.strictEqual(bad.severity, 'BLOCKER');
    assert.ok(bad.details.includes('top_nav'), bad.details);

    // codex P1-4：注释里写 block 名+锚点 → 剥离后不作数，仍 FAIL
    fs.writeFileSync(pageAbs, [
      '// MaisonNavBar( 假装用了',
      "// anchor: maison:demo:bank-list:top_nav:main",
      '/* MaisonNavBar( maison:demo:bank-list:top_nav:main */',
      'Text("bare")',
    ].join('\n'), 'utf-8');
    const [cheat] = checkUiKitSourceConformance(ctxWithContracts(root));
    assert.strictEqual(cheat.status, 'FAIL', '注释伪注必须被剥离');

    // codex 三轮次要项：字符串字面量伪调用——Text("MaisonNavBar(") 不算组件实例化，
    // 但同文件真实锚点字符串仍被认（双基线：调用匹配去字符串、锚点匹配保字符串）
    fs.writeFileSync(pageAbs, [
      'Text("MaisonNavBar( 字符串里假装调用")',
      "Text('maison:demo:bank-list:top_nav:main')",
    ].join('\n'), 'utf-8');
    const [strCheat] = checkUiKitSourceConformance(ctxWithContracts(root));
    assert.strictEqual(strCheat.status, 'FAIL', '字符串伪调用不算 block 实例化');
    assert.ok(strCheat.details.includes('block 未实例化'), strCheat.details);
    assert.ok(!strCheat.details.includes('锚点前缀缺失'), '锚点在字符串里应被认（只缺实例化）');
  });
});

test('源码段：声明了 block 但 kit 未物化 → BLOCKER（ui_kit_not_materialized，附精确 scaffold 命令）', () => {
  withTmp(root => {
    writeUiSpecWithBlocks(root);
    fs.writeFileSync(
      path.join(root, 'framework.config.json'),
      JSON.stringify({ paths: { ui_kit_target_dir: 'app/feature/src/main/ets/maison_ui_kit' } }, null, 2),
      'utf-8',
    );
    clearFrameworkConfigCache();
    const [r] = checkUiKitSourceConformance(ctxWithContracts(root));
    assert.strictEqual(r.status, 'FAIL');
    assert.strictEqual(r.failure_kind, 'ui_kit_not_materialized');
    assert.ok(r.suggestion?.includes('--apply'), '须给精确命令');
  });
});

test('stripArkTsComments：剥行/块注释、保留字符串字面量（锚点在字符串里不受伤）', () => {
  const src = [
    "const a = 'maison:demo:s:n:k'; // maison:comment:should:go:away",
    '/* MaisonNavBar( */',
    '`template ${x} maison:demo:s:n:k2`',
  ].join('\n');
  const stripped = stripArkTsComments(src);
  assert.ok(stripped.includes('maison:demo:s:n:k'), '单引号字符串保留');
  assert.ok(stripped.includes('maison:demo:s:n:k2'), '模板串保留');
  assert.ok(!stripped.includes('should:go:away'), '行注释剥离');
  assert.ok(!stripped.includes('MaisonNavBar('), '块注释剥离');
});

test('声明强制门禁（cursor P1）：盲档 P0 屏零 block 声明 → BLOCKER；有声明 → PASS；非盲 → 零结果', () => {
  withTmp(root => {
    // 无声明的 ui-spec（事故形态：纯 content_display 树）
    const p = featureFilePath(root, 'demo', path.join('spec', 'ui-spec.yaml'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, [
      'schema_version: "1.0"',
      'screens:',
      '  - id: bank-list',
      '    priority: P0',
      '    root:',
      '      type: navigation_frame',
      '      order: 0',
      '      children:',
      '        - type: content_display',
      '          id: title',
      '          order: 0',
      'tokens: {}',
      'assets: []',
      '',
    ].join('\n'), 'utf-8');
    const blindCtx = { ...ctxWithContracts(root), adapterImageInput: 'none' } as CheckContext;
    const [bad] = checkUiKitDeclarationRequired(blindCtx);
    assert.strictEqual(bad.status, 'FAIL', bad.details);
    assert.strictEqual(bad.failure_kind, 'ui_kit_declaration_missing');

    writeUiSpecWithBlocks(root); // 带 nav_bar 声明
    const [ok] = checkUiKitDeclarationRequired(blindCtx);
    assert.strictEqual(ok.status, 'PASS', ok.details);

    const sighted = { ...ctxWithContracts(root), adapterImageInput: 'tool_read' } as CheckContext;
    assert.strictEqual(checkUiKitDeclarationRequired(sighted).length, 0, '非盲不产结果');
  });
});

function writeLayoutDump(root: string, screen: string, ids: string[]): void {
  const dir = path.join(featureDir(root, 'demo'), 'device-testing', 'device-screenshots');
  fs.mkdirSync(dir, { recursive: true });
  // 真实形状：hylyre-hypium-ui-dump-v1 包装（schema_version + tree）
  const dump = {
    schema_version: 'hylyre-hypium-ui-dump-v1',
    tree: {
      attributes: { bounds: '[0,0][1000,2000]' },
      children: [{
        attributes: { type: 'root', bounds: '[0,0][1000,2000]' },
        children: ids.map((id, i) => ({
          attributes: { type: 'Row', id, bounds: `[0,${i * 100}][1000,${i * 100 + 80}]` },
          children: [],
        })),
      }],
    },
  };
  fs.writeFileSync(path.join(dir, `layout-${screen}.json`), JSON.stringify(dump), 'utf-8');
}

test('运行时段：dump 含锚点前缀 id → PASS；dump 在而锚点不在 → BLOCKER FAIL；无 dump → WARN 证据缺失（四轮 P1-5：不真空通过）', () => {
  withTmp(root => {
    writeUiSpecWithBlocks(root);
    const ctx = ctxWithContracts(root);
    // codex 四轮 P1-5：声明了 block 而无任何运行时证据 → WARN(needs_human 债务源)，非零结果
    const [noEv] = checkUiKitRuntimeConformance(ctx);
    assert.strictEqual(noEv.status, 'WARN', '无 dump 不得真空通过');
    assert.strictEqual(noEv.failure_kind, 'ui_kit_runtime_unverified', noEv.details);
    writeLayoutDump(root, 'bank-list', ['maison:demo:bank-list:top_nav:main']);
    const [ok] = checkUiKitRuntimeConformance(ctx);
    assert.strictEqual(ok.status, 'PASS', ok.details);
    writeLayoutDump(root, 'bank-list', ['other-id']);
    const [bad] = checkUiKitRuntimeConformance(ctx);
    assert.strictEqual(bad.status, 'FAIL');
    assert.ok(bad.details.includes('top_nav'));
  });
});

test('四轮 P1-3：scaffolderCliMain --project-root——从 framework/harness 假 cwd 执行，落点在宿主而非 framework 内', () => {
  withTmp(root => {
    const fakeHarnessCwd = path.join(root, 'framework', 'harness');
    fs.mkdirSync(fakeHarnessCwd, { recursive: true });
    const { scaffolderCliMain } = require('../../ui-kit-scaffolder') as typeof import('../../ui-kit-scaffolder');
    const r = scaffolderCliMain(
      ['--project-root', root, '--target', 'app/feature/src/main/ets/maison_ui_kit', '--apply'],
      fakeHarnessCwd,
    );
    assert.strictEqual(r.exitCode, 0);
    const expected = path.join(root, 'app/feature/src/main/ets/maison_ui_kit');
    assert.strictEqual(path.resolve(r.targetAbs!), path.resolve(expected), '相对 target 须基于宿主根解析');
    assert.ok(fs.existsSync(path.join(expected, 'MaisonNavBar.ets')), '文件落宿主模块');
    assert.ok(!fs.existsSync(path.join(fakeHarnessCwd, 'app')), '绝不落 framework/harness 内');
  });
});

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

// ---------------- codex 五轮 P0/P1 回归 ----------------

test('五轮 P0：scaffolder 边界——--target 含 ..（越界）→ exit 2；绝对路径 → exit 2；不落任何文件', () => {
  withTmp(root => {
    const { scaffolderCliMain } = require('../../ui-kit-scaffolder') as typeof import('../../ui-kit-scaffolder');
    const escape = scaffolderCliMain(['--project-root', root, '--target', '../outside/kit', '--apply'], root);
    assert.strictEqual(escape.exitCode, 2, '.. 越界须拒');
    assert.ok(!fs.existsSync(path.join(path.dirname(root), 'outside')), '不得在根外落文件');
    const absTarget = path.join(os.tmpdir(), `abs-kit-${path.basename(root)}`);
    const abs = scaffolderCliMain(['--project-root', root, '--target', absTarget, '--apply'], root);
    assert.strictEqual(abs.exitCode, 2, '绝对路径须拒');
    assert.ok(!fs.existsSync(absTarget), '绝对目标不得落盘');
  });
});

test('五轮 P1-5：canonical 契约集成——type:nav_bar + acquisition:placeholder 过 validateUiSpecSchema 后 downstream 同源消费（治单测假绿）', () => {
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
          { type: 'list_selection', id: 'lst', order: 1, block: 'list_card_container' },
        ],
      },
    }],
    tokens: { 'text.body': { kind: 'font_size', value: '14fp' } },
    assets: [{ key: 'bank_logo_icbc', acquisition: 'placeholder', placeholder: true }],
  } as never;
  const schemaErrors = validateUiSpecSchema(doc);
  assert.deepStrictEqual(schemaErrors, [], `canonical validator 须接受语义 type/block/placeholder：${JSON.stringify(schemaErrors)}`);
  const decls = collectDeclaredBlockInstances(doc, 'demo');
  assert.strictEqual(decls.length, 2, 'downstream 同源消费');
  const plan = planPlaceholderGeneration(doc, () => null);
  assert.deepStrictEqual(plan.generate.map(g => g.key), ['bank_logo_icbc']);
  assert.strictEqual(plan.blocked.length, 0);
});

test('五轮 P1-2：运行时段部分缺 dump → WARN（不整体 PASS）；全覆盖命中才 PASS', () => {
  withTmp(root => {
    // 两屏声明，只给一屏 dump
    const p = featureFilePath(root, 'demo', path.join('spec', 'ui-spec.yaml'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, [
      'schema_version: "1.0"',
      'screens:',
      '  - id: bank-list',
      '    priority: P0',
      '    root: { type: navigation_frame, order: 0, children: [ { type: nav_bar, id: top_nav, order: 0 } ] }',
      '  - id: card-detail',
      '    priority: P0',
      '    root: { type: navigation_frame, order: 0, children: [ { type: nav_bar, id: detail_nav, order: 0 } ] }',
      'tokens: {}',
      'assets: []',
      '',
    ].join('\n'), 'utf-8');
    const ctx = ctxWithContracts(root);
    writeLayoutDump(root, 'bank-list', ['maison:demo:bank-list:top_nav:main']);
    const [partial] = checkUiKitRuntimeConformance(ctx);
    assert.strictEqual(partial.status, 'WARN', `1/2 屏有证据不得整体 PASS：${partial.details}`);
    assert.strictEqual(partial.failure_kind, 'ui_kit_runtime_unverified', partial.details);
    assert.ok(partial.details.includes('card-detail'), '点名缺证据屏');
    writeLayoutDump(root, 'card-detail', ['maison:demo:card-detail:detail_nav:main']);
    const [full] = checkUiKitRuntimeConformance(ctx);
    assert.strictEqual(full.status, 'PASS', full.details);
  });
});

// ---------------- codex 六轮 P0/P1 回归 ----------------

test('六轮 P1-2：resolver 配置越界（../ 与绝对路径）→ halt；source-conformance 同源继承 BLOCKER', () => {
  withTmp(root => {
    const writeCfg = (v: string): void => {
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({ paths: { ui_kit_target_dir: v } }, null, 2),
        'utf-8',
      );
      clearFrameworkConfigCache();
    };
    writeCfg('../outside-kit');
    const r1 = resolveUiKitTargetDir(root);
    assert.strictEqual(r1.status, 'halt', '.. 越界配置须 halt');
    assert.ok(r1.haltReason!.includes('ui_kit_target_dir'), r1.haltReason);
    writeCfg(path.join(os.tmpdir(), 'evil-kit'));
    const r2 = resolveUiKitTargetDir(root);
    assert.strictEqual(r2.status, 'halt', '绝对路径配置须 halt');
    // 消费面同源拦截：conformance 走同一 resolver——非法配置不得读外部目录做 hash 对比假 PASS
    writeUiSpecWithBlocks(root);
    const [r] = checkUiKitSourceConformance(ctxWithContracts(root));
    assert.strictEqual(r.status, 'FAIL');
    assert.strictEqual(r.severity, 'BLOCKER');
    assert.strictEqual(r.failure_kind, 'ui_kit_target_unresolved', r.details);
  });
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
