/**
 * structure-ledger 单测（P1-4①，plan c9e2a7f4 子批B）：
 *   病灶＝round6 实锤：card_pack subtitle_position=trailing / add_card layout_group /
 *   tab 容器声明被 coding 静默无视，无任何产物表态，拖到真机才暴露。
 *   验收铁律（plan 验收出口）：
 *   - 坏态：spec 含 trailing/layout_group/bg_color 声明而台账缺条目 → BLOCKER 指认；
 *   - implemented_by 糊名（struct 不存在）→ BLOCKER；
 *   - 正样本：台账齐全且 implemented_by 真实 → PASS；
 *   - 无结构声明 → PASS 无需台账（零回归）。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectStructureDeclarations,
  auditStructureLedger,
  loadStructureLedger,
  checkStructureDeclarationLedger,
  structureLedgerAbsPath,
  type LedgerEntry,
} from '../../structure-ledger';
import { checkVisualParity } from '../../coding-visual-parity-check';
import type { UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import { clearFrameworkConfigCache } from '../../../../../harness/config';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

// round6 病灶复刻形态：trailing 副标题 + 分组 + 容器底色 + 全局 tab
const SPEC_DOC: UiSpecDoc = {
  screens: [
    {
      id: 'card_pack',
      priority: 'P0',
      root: {
        type: 'navigation_frame',
        order: 0,
        children: [
          { id: 'add_card_row', type: 'list_selection', order: 0, text: '添加卡片', subtitle: '银行卡/交通卡/门禁卡等', subtitle_position: 'trailing' },
          { type: 'container', order: 1, bg_color: 'bg_secondary' }, // 无 id → 合成键
        ],
      },
    },
    {
      id: 'add_card',
      priority: 'P0',
      root: {
        type: 'navigation_frame',
        order: 0,
        children: [
          { id: 'bank_card_row', type: 'list_selection', order: 0, text: '银行卡', layout_group: 'card_types' },
          { id: 'transit_card_row', type: 'list_selection', order: 1, text: '交通卡', layout_group: 'card_types' },
        ],
      },
    },
  ],
  global_elements: [
    { id: 'bottom_tab', texts: ['首页', '我的'], owner_screen_ids: ['card_pack'] },
  ],
  tokens: {},
  assets: [],
} as unknown as UiSpecDoc;

test('collect_declarations_covers_all_structure_fields', () => {
  const decls = collectStructureDeclarations(SPEC_DOC);
  const keys = decls.map(d => `${d.node_key}|${d.declaration}`).sort();
  assert.deepStrictEqual(keys, [
    'add_card_row|subtitle_position=trailing',
    'bank_card_row|layout_group=card_types',
    'bottom_tab|global_element',
    'screen:card_pack/container@1|bg_color=bg_secondary', // 无 id 节点合成键
    'transit_card_row|layout_group=card_types',
  ]);
  assert.strictEqual(collectStructureDeclarations(null).length, 0);
});

test('audit_flags_missing_phantom_and_how', () => {
  const decls = collectStructureDeclarations(SPEC_DOC);
  const ledger: LedgerEntry[] = [
    { node_id: 'add_card_row', declaration: 'subtitle_position=trailing', implemented_by: 'CardPackEntrySection', how: '主副标题同 Row 右置' },
    { node_id: 'bank_card_row', declaration: 'layout_group=card_types', implemented_by: 'GhostStruct', how: '同容器' }, // 糊名
    { node_id: 'transit_card_row', declaration: 'layout_group=card_types', implemented_by: 'AddCardListSection', how: '' }, // 缺 how
    { node_id: 'stale_node', declaration: 'bg_color=x', implemented_by: 'AddCardListSection', how: 'x' }, // spec 已无 → orphan
  ];
  const structs = new Set(['CardPackEntrySection', 'AddCardListSection']);
  const audit = auditStructureLedger(decls, ledger, structs);
  // 缺 2 条：合成键 bg_color + bottom_tab global_element
  assert.deepStrictEqual(
    audit.missing.map(d => `${d.node_key}|${d.declaration}`).sort(),
    ['bottom_tab|global_element', 'screen:card_pack/container@1|bg_color=bg_secondary'],
  );
  assert.strictEqual(audit.phantomStructs.length, 1);
  assert.ok(audit.phantomStructs[0].includes('GhostStruct'));
  assert.strictEqual(audit.missingHow.length, 1);
  assert.strictEqual(audit.orphanEntries.length, 1);
  assert.ok(audit.orphanEntries[0].includes('stale_node'));
});

test('audit_orphan_entries_hint_only_no_field_checks', () => {
  // cursor 意见：orphan（spec 已无此声明）只提示清理——即使字段不全也不得计入阻断类
  const decls = collectStructureDeclarations(SPEC_DOC);
  const fullLedger: LedgerEntry[] = [
    { node_id: 'add_card_row', declaration: 'subtitle_position=trailing', implemented_by: 'CardPackEntrySection', how: '同行右置' },
    { node_id: 'bank_card_row', declaration: 'layout_group=card_types', implemented_by: 'AddCardListSection', how: '同容器' },
    { node_id: 'transit_card_row', declaration: 'layout_group=card_types', implemented_by: 'AddCardListSection', how: '同容器' },
    { node_id: 'screen:card_pack/container@1', declaration: 'bg_color=bg_secondary', implemented_by: 'CardPackEntrySection', how: '容器灰底' },
    { node_id: 'bottom_tab', declaration: 'global_element', implemented_by: 'AddCardListSection', how: 'tab 胶囊' },
    { node_id: 'stale_node', declaration: 'bg_color=x' }, // orphan 且缺 impl/how——不得阻断
  ];
  const audit = auditStructureLedger(decls, fullLedger, new Set(['CardPackEntrySection', 'AddCardListSection']));
  assert.strictEqual(audit.missing.length, 0);
  assert.strictEqual(audit.unattributed.length, 0, 'orphan 缺 implemented_by 不得计入阻断');
  assert.strictEqual(audit.missingHow.length, 0, 'orphan 缺 how 不得计入阻断');
  assert.strictEqual(audit.phantomStructs.length, 0);
  assert.strictEqual(audit.orphanEntries.length, 1);
});

interface Fixture { root: string; ctx: CheckContext }

function mkFixture(opts: { specYaml: string; ledgerYaml?: string; structSource?: string }): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const featDir = path.join(root, 'doc', 'features', 'homepage');
  fs.mkdirSync(path.join(featDir, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(featDir, 'spec', 'ui-spec.yaml'), opts.specYaml, 'utf-8');
  if (opts.ledgerYaml !== undefined) {
    fs.mkdirSync(path.join(featDir, 'coding'), { recursive: true });
    fs.writeFileSync(path.join(featDir, 'coding', 'structure-conformance.yaml'), opts.ledgerYaml, 'utf-8');
  }
  const modDir = path.join(root, 'mod', 'src', 'main', 'ets', 'presentation', 'components');
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(
    path.join(modDir, 'Sections.ets'),
    opts.structSource ?? 'struct CardPackEntrySection { build() {} }\n',
    'utf-8',
  );
  const ctx = {
    phase: 'coding',
    feature: 'homepage',
    projectRoot: root,
    fidelityTarget: 'pixel_1to1',
    phaseRule: { structure_checks: {} },
    featureSpec: { feature: 'homepage', contracts: { modules: [{ package_path: 'mod' }] } },
  } as unknown as CheckContext;
  return { root, ctx };
}

const SPEC_YAML = [
  'schema_version: "1.0"',
  'screens:',
  '  - id: card_pack',
  '    priority: P0',
  '    root:',
  '      type: navigation_frame',
  '      order: 0',
  '      children:',
  '        - { id: add_card_row, type: list_selection, order: 0, text: "添加卡片", subtitle: "银行卡等", subtitle_position: trailing }',
  'tokens: {}',
  'assets: []',
].join('\n');

test('gate_missing_ledger_blocker_with_copyable_keys', () => {
  const { root, ctx } = mkFixture({ specYaml: SPEC_YAML });
  try {
    const [r] = checkStructureDeclarationLedger(ctx);
    assert.strictEqual(r.id, 'structure_declaration_ledger');
    assert.strictEqual(r.status, 'FAIL');
    assert.strictEqual(r.severity, 'BLOCKER'); // pixel_1to1 ratchet
    assert.ok(/add_card_row/.test(r.details) && /subtitle_position=trailing/.test(r.details), '报错须含照抄即用的键');
    assert.ok(/诚实边界/.test(r.details), '须写明自报不验真的诚实边界');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate_incomplete_and_phantom_blocker', () => {
  const badLedger = [
    'schema_version: "1.0"',
    'entries:',
    '  - node_id: add_card_row',
    '    declaration: subtitle_position=trailing',
    '    implemented_by: NoSuchStruct',
    '    how: 同行右置',
  ].join('\n');
  const { root, ctx } = mkFixture({ specYaml: SPEC_YAML, ledgerYaml: badLedger });
  try {
    const [r] = checkStructureDeclarationLedger(ctx);
    assert.strictEqual(r.status, 'FAIL');
    assert.ok(/糊名|不存在于源码/.test(r.details) && /NoSuchStruct/.test(r.details));
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate_complete_ledger_passes', () => {
  const goodLedger = [
    'schema_version: "1.0"',
    'entries:',
    '  - node_id: add_card_row',
    '    declaration: subtitle_position=trailing',
    '    implemented_by: CardPackEntrySection',
    '    how: 主标题与副标题同一 Row，副标题右对齐灰字',
  ].join('\n');
  const { root, ctx } = mkFixture({ specYaml: SPEC_YAML, ledgerYaml: goodLedger });
  try {
    const [r] = checkStructureDeclarationLedger(ctx);
    assert.strictEqual(r.status, 'PASS', JSON.stringify(r));
    // loadStructureLedger 与 abs path helper 顺带验证
    assert.ok(loadStructureLedger(structureLedgerAbsPath(ctx.projectRoot, 'homepage'))!.length === 1);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate_no_declarations_pass_without_ledger', () => {
  const bareSpec = [
    'schema_version: "1.0"',
    'screens:',
    '  - id: home',
    '    priority: P0',
    '    root: { type: navigation_frame, order: 0 }',
    'tokens: {}',
    'assets: []',
  ].join('\n');
  const { root, ctx } = mkFixture({ specYaml: bareSpec });
  try {
    const [r] = checkStructureDeclarationLedger(ctx);
    assert.strictEqual(r.status, 'PASS');
    assert.ok(/无结构声明/.test(r.details));
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate_respects_custom_features_dir', () => {
  // codex P1（子批B review）：自定义 paths.features_dir 下门禁须照常读到 ui-spec 与台账
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-cfg-'));
  try {
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
      schema_version: '1.0', project_name: 'x', project_type: 'app',
      paths: { features_dir: 'requirements/features' },
    }));
    clearFrameworkConfigCache();
    const featDir = path.join(root, 'requirements', 'features', 'homepage');
    fs.mkdirSync(path.join(featDir, 'spec'), { recursive: true });
    fs.writeFileSync(path.join(featDir, 'spec', 'ui-spec.yaml'), SPEC_YAML, 'utf-8');
    const modDir = path.join(root, 'mod', 'src', 'main', 'ets', 'presentation', 'components');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'Sections.ets'), 'struct CardPackEntrySection { build() {} }\n', 'utf-8');
    const ctx = {
      phase: 'coding', feature: 'homepage', projectRoot: root, fidelityTarget: 'pixel_1to1',
      phaseRule: { structure_checks: {} },
      featureSpec: { feature: 'homepage', contracts: { modules: [{ package_path: 'mod' }] } },
    } as unknown as CheckContext;
    // 无台账 → BLOCKER 且路径指向自定义目录（非 doc/features）
    const [miss] = checkStructureDeclarationLedger(ctx);
    assert.strictEqual(miss.status, 'FAIL', '自定义目录下须读到 ui-spec 声明（不得静默 PASS）');
    assert.ok(
      miss.affected_files!.every(f => f.startsWith('requirements/features/')),
      `affected_files 须走自定义目录：${JSON.stringify(miss.affected_files)}`,
    );
    // 台账放自定义目录 → PASS
    fs.mkdirSync(path.join(featDir, 'coding'), { recursive: true });
    fs.writeFileSync(path.join(featDir, 'coding', 'structure-conformance.yaml'), [
      'schema_version: "1.0"', 'entries:',
      '  - node_id: add_card_row', '    declaration: subtitle_position=trailing',
      '    implemented_by: CardPackEntrySection', '    how: 同行右置',
    ].join('\n'), 'utf-8');
    const [ok] = checkStructureDeclarationLedger(ctx);
    assert.strictEqual(ok.status, 'PASS', JSON.stringify(ok));
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production_entry_check_visual_parity_reaches_ledger_in_custom_features_dir', () => {
  // codex 三轮 P1：直接调门禁不够——生产入口 checkVisualParity 自身前置读取（spec.md/ui-spec）
  // 曾硬编码 doc/features，自定义目录下提前退出、台账门禁永不触发。本用例走完整生产入口。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-prod-'));
  try {
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
      schema_version: '1.0', project_name: 'x', project_type: 'app',
      paths: { features_dir: 'requirements/features' },
    }));
    clearFrameworkConfigCache();
    const featDir = path.join(root, 'requirements', 'features', 'homepage');
    fs.mkdirSync(path.join(featDir, 'spec'), { recursive: true });
    fs.writeFileSync(path.join(featDir, 'spec', 'spec.md'), '# spec\n\n```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
    fs.writeFileSync(path.join(featDir, 'spec', 'ui-spec.yaml'), SPEC_YAML.replace('schema_version: "1.0"', 'schema_version: "1.0"\nverified: human_confirmed'), 'utf-8');
    const modDir = path.join(root, 'mod', 'src', 'main', 'ets', 'presentation', 'components');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'Sections.ets'), 'struct CardPackEntrySection { build() {} }\n', 'utf-8');
    const ctx = {
      phase: 'coding', feature: 'homepage', projectRoot: root, fidelityTarget: 'pixel_1to1',
      phaseRule: { structure_checks: {} },
      featureSpec: { feature: 'homepage', contracts: { modules: [{ name: 'mod', package_path: 'mod' }] } },
    } as unknown as CheckContext;
    const results = checkVisualParity(ctx);
    const ledgerHit = results.find(r => r.id === 'structure_declaration_ledger');
    assert.ok(ledgerHit, `生产入口须触达台账门禁（自定义目录不得提前退出）：${JSON.stringify(results.map(r => r.id))}`);
    assert.strictEqual(ledgerHit!.status, 'FAIL', '无台账应 FAIL');
    assert.ok(/add_card_row/.test(ledgerHit!.details), '报错须含待登记键');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
