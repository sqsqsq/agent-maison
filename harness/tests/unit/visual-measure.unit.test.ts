// visual-measure.unit.test.ts — plan 07a41ec6 T10：--measure 只测量不裁决（bounds/差值/重叠/间距/三轴/defect note 填充）

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parseHypiumDump } from '../../../profiles/hmos-app/harness/layout-oracle-check';
import {
  fillVisualDiffDefectNotes,
  measureNoteFor,
  measureScreen,
  renderMeasurementTable,
} from '../../../profiles/hmos-app/harness/visual-measure';
import type { UiSpecDoc, UiSpecScreen } from '../../scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../run-unit';

function node(attrs: Record<string, string>, children: unknown[] = []): unknown {
  return { attributes: attrs, children };
}

/** app 窗口 1080×2340；title 在 (40,100)-(400,160)，card (40,200)-(1040,600)，badge 与 card 重叠 */
const DUMP = parseHypiumDump({
  schema_version: 'hylyre-hypium-ui-dump-v1',
  tree: node({ type: 'root', bounds: '[0,0][1080,2340]' }, [
    node({ type: 'root', bounds: '[0,0][1080,2340]' }, [
      node({ id: 'title', type: 'Text', text: '标题', bounds: '[40,100][400,160]' }),
      node({ id: 'card', type: 'Column', bounds: '[40,200][1040,600]' }, [
        node({ id: 'card_text', type: 'Text', text: '卡片文字', bounds: '[60,220][500,260]' }),
      ]),
      node({ id: 'badge', type: 'Text', text: '角标', bounds: '[1000,580][1060,640]' }),
    ]),
  ]),
})!;

/** 8 字节签名 + IHDR：w=1080 h=2340（readImageDimensions 只读头） */
function fakePng(w: number, h: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

const SCREEN: UiSpecScreen = {
  id: 'home',
  priority: 'P0',
  root: {
    type: 'navigation_frame', order: 0,
    children: [
      // 期望 title 在 x=40/1080≈0.037, y=100/2340≈0.0427，w=360/1080，h=60/2340；tolerance 8px → PASS
      { id: 'title', type: 'text', order: 0, text: '标题', bbox: [0.037, 0.0427, 0.3333, 0.0256], color_ref: 'text_primary', ...({ tolerance_px: 8 } as object) },
      // 期望 card 高 300px（实际 400）→ dh=+100 超 tolerance 12 → FAIL
      { id: 'card', type: 'card', order: 1, bbox: [0.037, 0.0855, 0.9259, 0.1282], ...({ tolerance_px: 12 } as object) },
      { id: 'badge', type: 'text', order: 2, text: '角标' },
    ],
  },
  must_have_elements: ['missing_el'],
};
const DOC: UiSpecDoc = { screens: [SCREEN], tokens: { text_primary: { kind: 'color', value: '#111111' } }, assets: [] };

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '几何事实：bounds/size/归一化 bbox；Δ 按视口换算；元素级 tolerance 决定 PASS/FAIL，无 tolerance=ADVISORY；未定位=UNLOCATED',
    run: () => {
      const m = measureScreen({
        feature: 'f', screen: SCREEN, doc: DOC, dump: DUMP, dumpPath: 'layout-home.json', dumpStatus: 'canonical',
        screenshotAbs: null, referenceAbs: null, visualDiffScreen: null, now: () => new Date('2026-09-03T00:00:00Z'),
        sampleColor: () => ({ hex: '#000000', sampled: false }),
      });
      const byId = new Map(m.elements.map(e => [e.element_id, e]));
      const title = byId.get('title')!;
      assert.deepStrictEqual(title.bounds_px, { x1: 40, y1: 100, x2: 400, y2: 160 });
      assert.deepStrictEqual(title.size_px, { w: 360, h: 60 });
      assert.strictEqual(title.geometry, 'PASS', JSON.stringify(title.delta_px));
      assert.ok(Math.abs(title.delta_px!.dx) <= 1 && Math.abs(title.delta_px!.dy) <= 1, JSON.stringify(title.delta_px));
      const card = byId.get('card')!;
      assert.strictEqual(card.geometry, 'FAIL');
      assert.ok(card.delta_px!.dh > 90 && card.delta_px!.dh < 110, `dh 应≈+100px，实得 ${card.delta_px!.dh}`);
      assert.ok(card.delta_vp_estimate && Math.abs(card.delta_vp_estimate.dh - card.delta_px!.dh / 3) < 1, 'vp 估算=px/(1080/360)');
      assert.strictEqual(byId.get('badge')!.geometry, 'ADVISORY');
      assert.strictEqual(byId.get('missing_el')!.geometry, 'UNLOCATED');
      assert.ok(m.bbox_suggestions.some(s => s.element_id === 'badge'), '无声明 bbox 的元素给 bbox 建议（不写回 ui-spec）');
      assert.strictEqual(m.px_per_vp_estimate, 3);
      assert.strictEqual(m.axes.geometry, 'FAIL');
      assert.strictEqual(m.axes.content, 'UNKNOWN');
      assert.strictEqual(m.axes.style, 'UNKNOWN');
      assert.ok(m.overlaps.some(o => (o.a === 'card' && o.b === 'badge') || (o.a === 'badge' && o.b === 'card')), `card∩badge 应报重叠：${JSON.stringify(m.overlaps)}`);
      assert.ok(!m.overlaps.some(o => [o.a, o.b].includes('card_text')), '亲缘包含（card_text ∈ card）不算重叠');
      assert.ok(m.gaps.some(g => g.a === 'title' && g.b === 'card' && g.gap_px === 40), JSON.stringify(m.gaps));
      assert.ok(renderMeasurementTable(m).some(l => /\| card \|/.test(l) && /FAIL/.test(l)));
    },
  },
  {
    name: '三轴与取色：content 由 visual-diff 判定 + evaluated hash 决定；style 由取色决定；无 dump → geometry UNAVAILABLE',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-measure-'));
      try {
        const shot = path.join(dir, 'shot-home.png');
        fs.writeFileSync(shot, fakePng(1080, 2340));
        const m = measureScreen({
          feature: 'f', screen: SCREEN, doc: DOC, dump: DUMP, dumpPath: null, dumpStatus: 'canonical',
          screenshotAbs: shot, referenceAbs: null,
          visualDiffScreen: { verdict: 'warn', evaluated_screenshot_hash: 'abcd' },
          sampleColor: () => ({ hex: '#101010', sampled: true }),
        });
        assert.strictEqual(m.screenshot.w, 1080);
        assert.strictEqual(m.axes.content, 'CHECKED');
        assert.strictEqual(m.axes.style, 'CHECKED');
        const title = m.elements.find(e => e.element_id === 'title')!;
        assert.strictEqual(title.color?.device_hex, '#101010');
        assert.ok(typeof title.color?.delta_e_device_vs_expected === 'number' && title.color.delta_e_device_vs_expected < 5, JSON.stringify(title.color));
        const noDump = measureScreen({ feature: 'f', screen: SCREEN, doc: DOC, dump: null, dumpPath: null, dumpStatus: 'missing', screenshotAbs: shot, referenceAbs: null, visualDiffScreen: null });
        assert.strictEqual(noDump.axes.geometry, 'UNAVAILABLE');
        assert.strictEqual(noDump.elements.length, 0);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'defects[].note 只追加量测事实：verdict/其它字段不动；已含 [measure] 不重复；无匹配 defect 零写入',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-measure-'));
      try {
        const m = measureScreen({ feature: 'f', screen: SCREEN, doc: DOC, dump: DUMP, dumpPath: null, dumpStatus: 'canonical', screenshotAbs: null, referenceAbs: null, visualDiffScreen: null, sampleColor: () => ({ hex: '#000000', sampled: false }) });
        const jsonPath = path.join(dir, 'visual-diff.json');
        const before = {
          schema_version: '1.1',
          screens: [{ screen_id: 'home', verdict: 'fail', must_fix: ['card 太高'], defects: [
            { class: 'geometry', element: 'card', severity: 'major', note: '卡片高度超出' },
            { class: 'geometry', element: 'card', severity: 'major', note: '已量 [measure] x' },
            { class: 'content', element: 'unknown_el', severity: 'minor', note: '别的' },
          ] }],
        };
        fs.writeFileSync(jsonPath, JSON.stringify(before, null, 2));
        assert.strictEqual(fillVisualDiffDefectNotes(dir, [m]), 1);
        const after = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as typeof before;
        assert.strictEqual(after.screens[0].verdict, 'fail');
        assert.deepStrictEqual(after.screens[0].must_fix, ['card 太高']);
        assert.ok(after.screens[0].defects[0].note.startsWith('卡片高度超出 [measure] bounds=[40,200,1040,600]px'), after.screens[0].defects[0].note);
        assert.ok(/geometry=FAIL/.test(after.screens[0].defects[0].note));
        assert.strictEqual(after.screens[0].defects[1].note, '已量 [measure] x');
        assert.strictEqual(after.screens[0].defects[2].note, '别的');
        assert.strictEqual(fillVisualDiffDefectNotes(dir, [m]), 0, '第二次无新增');
        assert.ok(measureNoteFor(m.elements.find(e => e.element_id === 'title')!).includes('geometry=PASS'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}
