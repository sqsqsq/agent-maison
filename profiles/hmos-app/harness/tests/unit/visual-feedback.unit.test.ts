// ============================================================================
// visual-feedback.unit.test.ts — blind-visual-hardening d6 / P1-E
// ============================================================================
// 锁定：①两类信号分立（声明文案缺失=hard；多余文本/色差/行距=advisory；
//   色差 8→9 类连续变化不产 hard——由阈值判定锁定）；②子串容错（OCR 拼行噪声不误报）；
// ③收敛分类（first_round/converged/converging/stalled/regressing）；④行距节奏带；
// ⑤身份字段（package digest 与 commit 至少其一非空；gate_fingerprint 结构）；
// ⑥deterministic_feedback 机器派生（盲档∧UI 需求；非盲/非 UI 不派生）。
// ============================================================================

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  COLOR_DELTA_E_REPORT_THRESHOLD,
  classifyConvergence,
  diffLineRhythm,
  diffTextLines,
  isDeterministicFeedbackRequired,
  renderVisualFeedbackMd,
  resolveFeedbackIdentity,
  type VisualFeedbackDoc,
} from '../../visual-feedback';
import type { OcrLine } from '../../ocr-toolkit';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function line(text: string, y: number, h = 0.03): OcrLine {
  return { text, box: [0.1, y, 0.5, h], words: [] };
}

// ---------------- ① 两类信号分立 ----------------

test('文本差异：声明文案缺失=hard；未声明缺失/设备多出=advisory', () => {
  const declared = new Set(['下一步']);
  const findings = diffTextLines(
    's1',
    [line('下一步', 0.8), line('随便什么水印', 0.5)],
    [line('设备侧多出的字', 0.3)],
    declared,
  );
  const hard = findings.filter(f => f.kind === 'hard');
  const advisory = findings.filter(f => f.kind === 'advisory');
  assert.strictEqual(hard.length, 1, JSON.stringify(findings));
  assert.ok(hard[0].detail.includes('下一步'));
  assert.strictEqual(advisory.length, 2, '未声明缺失 + 设备多出');
});

test('子串容错：设备行「55 秒后重试」含参考行「秒后重试」→ 不误报缺失', () => {
  const findings = diffTextLines('s1', [line('秒后重试', 0.4)], [line('55 秒后重试', 0.4)], new Set());
  assert.strictEqual(findings.length, 0, JSON.stringify(findings));
});

test('连续指标不产 hard：行距/色差类 finding kind 恒 advisory（色差 8→9 不升轴的结构性保证）', () => {
  const rhythm = diffLineRhythm(
    's1',
    [line('a', 0.1), line('b', 0.15), line('c', 0.2)],
    [line('a', 0.1), line('b', 0.3), line('c', 0.5)],
  );
  assert.ok(rhythm, '2 倍行距应产 finding');
  assert.strictEqual(rhythm!.kind, 'advisory', '连续指标恒 advisory');
  assert.ok(COLOR_DELTA_E_REPORT_THRESHOLD > 9, '阈值冻结面：ΔE 9 级别的连续变化不足以上报');
});

test('行距节奏：合理带内不产 finding', () => {
  const r = diffLineRhythm(
    's1',
    [line('a', 0.1), line('b', 0.2), line('c', 0.3)],
    [line('a', 0.1), line('b', 0.21), line('c', 0.32)],
  );
  assert.strictEqual(r, null);
});

// ---------------- ③ 收敛 ----------------

test('收敛分类：first_round / converging / stalled / regressing / converged 五态', () => {
  assert.strictEqual(classifyConvergence(null, ['a', 'b']).state, 'first_round');
  assert.strictEqual(classifyConvergence(null, []).state, 'converged');
  assert.strictEqual(classifyConvergence(['a', 'b'], ['a']).state, 'converging');
  assert.strictEqual(classifyConvergence(['a'], ['a']).state, 'stalled');
  assert.strictEqual(classifyConvergence(['a'], ['a', 'c']).state, 'regressing');
  const conv = classifyConvergence(['a', 'b'], ['b']);
  assert.deepStrictEqual(conv.resolved_since_prev, ['a']);
});

// ---------------- ⑤ 身份 ----------------

test('身份：gate_fingerprint 结构 + digest/commit 至少其一非空（源仓=commit；发布包=digest）', () => {
  const frameworkRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const id = resolveFeedbackIdentity(process.cwd(), frameworkRoot, 'testing');
  assert.ok(id.gate_fingerprint && /:[0-9a-f]{12}$/.test(id.gate_fingerprint), `gate=${id.gate_fingerprint}`);
  assert.ok(id.framework_version, 'version 从 fingerprint 前缀取');
  assert.ok(id.framework_package_digest !== null || id.framework_commit_sha !== null, '身份至少其一');
});

// ---------------- ⑥ deterministic_feedback 派生 ----------------

test('deterministic_feedback：非盲 → false；盲+无 spec → false（数据驱动，非配置开关）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-'));
  try {
    const base = { projectRoot: tmp, feature: 'demo' } as unknown as CheckContext;
    assert.strictEqual(
      isDeterministicFeedbackRequired({ ...base, adapterImageInput: 'tool_read' } as CheckContext),
      false, '非盲',
    );
    assert.strictEqual(
      isDeterministicFeedbackRequired({ ...base, adapterImageInput: 'none' } as CheckContext),
      false, '盲但无 spec/ui_change',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------- md 投影 ----------------

test('md 投影：hard/advisory 分节 + 收敛行 + 反相似度红线句', () => {
  const doc: VisualFeedbackDoc = {
    schema_version: '1.0',
    feature: 'demo',
    identity: { framework_version: '3.0.0', framework_package_digest: 'x', gate_fingerprint: '3.0.0:abcdefabcdef', framework_commit_sha: null },
    screens: [{
      screen_id: 's1', reference_sha256: 'r', actual_sha256: 'a',
      findings: [
        { id: '1', screen_id: 's1', kind: 'hard', metric: 'text_missing', detail: '缺「下一步」', fingerprint: 'f1' },
        { id: '2', screen_id: 's1', kind: 'advisory', metric: 'region_color', detail: '主色偏差', fingerprint: 'f2' },
      ],
    }],
    convergence: { state: 'first_round', current_fingerprints: ['f1', 'f2'], resolved_since_prev: [], new_since_prev: [] },
  };
  const md = renderVisualFeedbackMd(doc);
  assert.ok(md.includes('硬不变量（1）'));
  assert.ok(md.includes('advisory（1）'));
  assert.ok(md.includes('禁止用单一全局相似度'));
  assert.ok(md.includes('first_round'));
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
