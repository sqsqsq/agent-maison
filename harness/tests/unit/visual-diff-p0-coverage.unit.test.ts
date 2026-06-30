/**
 * visual-diff-p0-coverage — T3：P0 屏即使 lightweight 也不得逃过设备 visual_diff。
 *   病灶：home_no_card（P0+lightweight）曾被 collectP0*Targets 的 `!s.lightweight` 排除
 *   → 采集排除 / verdict=skipped / 无人评估（用户抱怨最重的黑块屏）。
 *   修复：P0 屏一律是 visual target（isP0VisualTargetScreen）；lightweight 仅对 P2/P3 生效。
 */
import * as assert from 'assert';
import {
  isP0VisualTargetScreen,
  collectP0ScreenIds,
  collectP0VisualTargetIds,
  collectP0OverlayTargetIds,
} from '../../../profiles/hmos-app/harness/visual-diff-targets';
import { collectP0CaptureTargets } from '../../../profiles/hmos-app/harness/visual-diff-capture';
import type { UiSpecDoc } from '../../scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void | Promise<void> }> = [];
function test(name: string, run: () => void | Promise<void>): void {
  CASES.push({ name, run });
}

/** 复刻 homepage 病灶：home_no_card P0+lightweight、card_pack P0、settings P2+lightweight、
 *  以及一个 P0+lightweight 屏内含 overlay_panel（验证 overlay 也不被 lightweight 豁免）。 */
function doc(): UiSpecDoc {
  return {
    screens: [
      {
        id: 'home_no_card',
        priority: 'P0',
        lightweight: true,
        ref_id: 'home_no_card',
        root: { id: 'home_root', type: 'navigation_frame', order: 0, children: [] },
      },
      {
        id: 'card_pack',
        priority: 'P0',
        ref_id: 'card_pack',
        root: { id: 'card_pack_root', type: 'navigation_frame', order: 0, children: [] },
      },
      {
        id: 'settings',
        priority: 'P2',
        lightweight: true,
        ref_id: 'settings',
        root: { id: 'settings_root', type: 'navigation_frame', order: 0, children: [] },
      },
      {
        id: 'home_lw_with_sheet',
        priority: 'P0',
        lightweight: true,
        ref_id: 'home_lw_with_sheet',
        root: {
          id: 'lw_root',
          type: 'navigation_frame',
          order: 0,
          children: [{ id: 'lw_sheet', type: 'overlay_panel', order: 0, children: [] }],
        },
      },
    ],
    tokens: {},
    assets: [],
  } as unknown as UiSpecDoc;
}

test('T3: isP0VisualTargetScreen——P0+lightweight 仍是 target，P2+lightweight 不是', () => {
  assert.strictEqual(isP0VisualTargetScreen({ priority: 'P0' }), true);
  assert.strictEqual(isP0VisualTargetScreen({ priority: 'P0', lightweight: true } as never), true);
  assert.strictEqual(isP0VisualTargetScreen({ priority: 'P2', lightweight: true } as never), false);
  assert.strictEqual(isP0VisualTargetScreen({ priority: 'P1' }), false);
});

test('T3: collectP0ScreenIds 含 P0+lightweight、不含 P2', () => {
  const ids = collectP0ScreenIds(doc());
  assert.ok(ids.includes('home_no_card'), 'P0+lightweight 的 home_no_card 必须入 P0 屏集');
  assert.ok(ids.includes('card_pack'));
  assert.ok(ids.includes('home_lw_with_sheet'));
  assert.ok(!ids.includes('settings'), 'P2 屏不计入');
});

test('T3: collectP0CaptureTargets 含 P0+lightweight', () => {
  const targets = collectP0CaptureTargets(doc()).map(s => s.id);
  assert.ok(targets.includes('home_no_card'), 'P0+lightweight 屏必须进采集目标（否则永远 skipped）');
  assert.ok(!targets.includes('settings'));
});

test('T3: P0+lightweight 屏内 overlay 也不被豁免', () => {
  const overlays = collectP0OverlayTargetIds(doc()).map(o => o.id);
  assert.ok(
    overlays.some(id => id.startsWith('home_lw_with_sheet__overlay__')),
    `lightweight P0 屏的 overlay 应被采集：${JSON.stringify(overlays)}`,
  );
});

test('T3: collectP0VisualTargetIds 汇总含 P0+lightweight 屏与其 overlay', () => {
  const all = collectP0VisualTargetIds(doc());
  assert.ok(all.includes('home_no_card'));
  assert.ok(all.some(id => id.startsWith('home_lw_with_sheet__overlay__')));
  assert.ok(!all.includes('settings'));
});

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (e) {
      out.push({ name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }
  return out;
}
