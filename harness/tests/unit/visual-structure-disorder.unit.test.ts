/**
 * visual-structure-disorder — R2 硬出口（b2）。
 * 验证结构序新算法（分母=mapped.length + 有序 structList）：
 *   - 区块乱序 / 丢块 → 整屏仍判不过（证明 R2 分母改动是修偏差、非放水）；
 *   - 正确序 → 整屏通过（证明未过度收紧）。
 */
import * as assert from 'assert';
import {
  computeStructureSequenceScore,
  type VisualParityMappings,
} from '../../../profiles/hmos-app/harness/visual-structure-parity';
import type { UiSpecDoc } from '../../scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

/** 单屏：root 容器 + 4 个有序叶子 n1..n4（映射到 CompA..CompD），coverage=4/5=0.8 达标，LCS 成判定项 */
function buildDoc(): UiSpecDoc {
  return {
    screens: [
      {
        id: 'screen_home',
        priority: 'P0',
        root: {
          id: 'root',
          type: 'navigation_frame',
          order: 0,
          children: [
            { id: 'n1', type: 'action_button', order: 1 },
            { id: 'n2', type: 'text', order: 2 },
            { id: 'n3', type: 'image', order: 3 },
            { id: 'n4', type: 'action_button', order: 4 },
          ],
        },
      },
    ],
    tokens: {},
    assets: [],
  };
}

const MAPPINGS: VisualParityMappings = {
  components: [
    { ui_spec_node_id: 'n1', contract_component: 'CompA' },
    { ui_spec_node_id: 'n2', contract_component: 'CompB' },
    { ui_spec_node_id: 'n3', contract_component: 'CompC' },
    { ui_spec_node_id: 'n4', contract_component: 'CompD' },
  ],
};

test('R2: 正确序 → 整屏通过 (ratio=1)', () => {
  const ordered = ['CompA', 'CompB', 'CompC', 'CompD', 'ExtraX'];
  const r = computeStructureSequenceScore(buildDoc(), MAPPINGS, new Set(), ordered);
  assert.ok(r, 'expected non-null score');
  assert.strictEqual(r!.ratio, 1);
});

test('R2 硬出口: 区块完全乱序 → 判不过 (LCS=1/4)', () => {
  const disordered = ['CompD', 'CompC', 'CompB', 'CompA']; // 逆序 → LCS=1 → 0.25 < 0.6
  const r = computeStructureSequenceScore(buildDoc(), MAPPINGS, new Set(), disordered);
  assert.ok(r, 'expected non-null score');
  assert.ok(r!.ratio < 1, `disorder must not pass, got ratio=${r!.ratio}`);
  assert.strictEqual(r!.ratio, 0);
});

test('R2 硬出口: 丢失区块（结构缺项）→ 判不过 (LCS=2/4)', () => {
  const missing = ['CompA', 'CompB']; // 丢 CompC/CompD → LCS=2 → 0.5 < 0.6
  const r = computeStructureSequenceScore(buildDoc(), MAPPINGS, new Set(), missing);
  assert.ok(r, 'expected non-null score');
  assert.strictEqual(r!.ratio, 0);
});

export function runAll(): UnitCaseResult[] {
  return CASES.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
    }
  });
}
