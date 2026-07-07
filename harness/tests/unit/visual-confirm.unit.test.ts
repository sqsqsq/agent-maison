/**
 * visual-confirm CLI 单测（P0-10c，plan b6d3e9a2）——覆盖纯函数（交互 TTY 部分人工验收）：
 *   - 待确认屏筛选与 checkVisualDiff await 收窄判定**同源**（不宽筛 stale/带 must_fix/绑定不全）；
 *   - 已签屏跳过；署名校验（拒 user_requirement/自动化）；
 *   - 认可/打回转写正确；安全写盘无 BOM、绑定三字段不动。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectPendingConfirmScreens,
  applyConfirm,
  applyReject,
  isAcceptableSigner,
  safeWriteVisualDiffJson,
  isReportAwaitConfirmState,
} from '../../scripts/visual-confirm';
import { featurePhaseReportsDir } from '../../config';
import { hashScreenshotFile, type VisualDiffReport, type VisualDiffScreenEntry } from '../../../profiles/hmos-app/harness/visual-diff-check';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

const FP = 'abcabcabcabc';

function mkProjectWithShots(entries: Array<Partial<VisualDiffScreenEntry> & { screen_id: string }>): {
  root: string;
  report: VisualDiffReport;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vconf-'));
  const dir = path.join(root, 'doc', 'features', 'homepage', 'device-testing', 'device-screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const screens: VisualDiffScreenEntry[] = entries.map(e => {
    const rel = `doc/features/homepage/device-testing/device-screenshots/shot-${e.screen_id}.png`;
    const abs = path.join(root, rel);
    fs.writeFileSync(abs, Buffer.from(`png-${e.screen_id}`));
    const hash = hashScreenshotFile(abs)!;
    return {
      verdict: 'pass',
      screenshot_path: rel,
      ref_id: e.screen_id,
      screenshot_hash: hash,
      evaluated_screenshot_hash: hash,
      evaluated_build_fingerprint: FP,
      must_fix: [],
      ...e,
    };
  });
  return { root, report: { schema_version: '1.0', screens } };
}

test('pending_filter_is_await_eligibility_sourced', () => {
  const { root, report } = mkProjectWithShots([
    { screen_id: 'ok' }, // 合格未签 → 入列
    { screen_id: 'signed', confirmed_by: 'alice' }, // 已真人签 → 跳过
    { screen_id: 'has_mf', must_fix: ['x'] }, // 带 must_fix → 不合格
    { screen_id: 'warn_v', verdict: 'warn' }, // 非 pass → 不合格
    { screen_id: 'wrong_fp', evaluated_build_fingerprint: 'ffffffffffff' }, // 指纹不符 → 不合格
  ]);
  try {
    const pending = collectPendingConfirmScreens(report, root, FP);
    assert.deepStrictEqual(pending.map(p => p.screen.screen_id), ['ok'], JSON.stringify(pending.map(p => p.screen.screen_id)));
    // 当前指纹不可算 → 全不合格（不诱导签名）
    assert.strictEqual(collectPendingConfirmScreens(report, root, null).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pending_filter_excludes_stale_bound_file_changed', () => {
  const { root, report } = mkProjectWithShots([{ screen_id: 'ok' }]);
  try {
    // 盘上截图文件被替换 → evaluated_screenshot_hash 不再匹配 → stale → 不合格
    const abs = path.join(root, report.screens[0].screenshot_path!);
    fs.writeFileSync(abs, Buffer.from('DOCTORED'));
    assert.strictEqual(collectPendingConfirmScreens(report, root, FP).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('signer_validation_matches_gate', () => {
  assert.strictEqual(isAcceptableSigner('alice'), true);
  assert.strictEqual(isAcceptableSigner('张三'), true);
  assert.strictEqual(isAcceptableSigner('user_requirement'), false);
  assert.strictEqual(isAcceptableSigner('goal-mode-auto'), false);
  assert.strictEqual(isAcceptableSigner(''), false);
});

test('apply_confirm_and_reject_transforms', () => {
  const confirmScreen: VisualDiffScreenEntry = { screen_id: 'a', verdict: 'pass', must_fix: [] };
  applyConfirm(confirmScreen, 'bob');
  assert.strictEqual(confirmScreen.confirmed_by, 'bob');

  const rejectScreen: VisualDiffScreenEntry = { screen_id: 'b', verdict: 'pass', confirmed_by: 'stale', must_fix: [] };
  applyReject(rejectScreen, ['tab 缺胶囊图标', '', '  ', 'Huawei Card 截断']);
  assert.strictEqual(rejectScreen.verdict, 'fail');
  assert.deepStrictEqual(rejectScreen.must_fix, ['tab 缺胶囊图标', 'Huawei Card 截断']); // 空行剔除
  assert.strictEqual(rejectScreen.confirmed_by, undefined); // 打回清签名
});

test('safe_write_no_bom_preserves_bind_fields', () => {
  const { root, report } = mkProjectWithShots([{ screen_id: 'ok' }]);
  try {
    const jsonPath = path.join(root, 'doc', 'features', 'homepage', 'device-testing', 'device-screenshots', 'visual-diff.json');
    applyConfirm(report.screens[0], 'carol');
    safeWriteVisualDiffJson(jsonPath, report);
    const buf = fs.readFileSync(jsonPath);
    // 无 BOM（前三字节非 EF BB BF）
    assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), '不得有 UTF-8 BOM');
    assert.ok(buf.toString('utf-8').endsWith('}\n'), '尾换行');
    const reread = JSON.parse(buf.toString('utf-8')) as VisualDiffReport;
    const s = reread.screens[0];
    assert.strictEqual(s.confirmed_by, 'carol');
    // 绑定三字段原样
    assert.strictEqual(s.evaluated_build_fingerprint, FP);
    assert.ok(typeof s.evaluated_screenshot_hash === 'string' && s.evaluated_screenshot_hash.length > 0);
    assert.strictEqual(s.screenshot_hash, s.evaluated_screenshot_hash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('report_await_gate_requires_gate_conclusion', () => {
  // codex P1a：报告级 await gate——summary.json 的门禁结论须为 await_human_confirm 才放行列屏
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vconf-gate-'));
  try {
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: 'x', project_type: 'app' }));
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true }); // framework 树标记（layout 解析）
    const reportsDir = featurePhaseReportsDir(root, 'homepage', 'testing');
    fs.mkdirSync(reportsDir, { recursive: true });
    const writeSummary = (blockers: Array<{ id: string; classification?: string }>) =>
      fs.writeFileSync(path.join(reportsDir, 'summary.json'), JSON.stringify({ blockers }));
    // await 结论 → true
    writeSummary([{ id: 'visual_diff', classification: 'await_human_confirm' }]);
    assert.strictEqual(isReportAwaitConfirmState(root, 'homepage', 'testing'), true);
    // await + 派生聚合 testing_run_status（visual_diff FAIL 时永远同时存在）→ 仍 true
    writeSummary([
      { id: 'visual_diff', classification: 'await_human_confirm' },
      { id: 'testing_run_status' },
    ]);
    assert.strictEqual(isReportAwaitConfirmState(root, 'homepage', 'testing'), true);
    // codex P2：await + **独立** deterministic blocker（如 device_test_run）→ false（混合失败不该签）
    writeSummary([
      { id: 'visual_diff', classification: 'await_human_confirm' },
      { id: 'device_test_run' },
    ]);
    assert.strictEqual(isReportAwaitConfirmState(root, 'homepage', 'testing'), false);
    // await 分类挂在非 visual_diff id 上 → false（id 约束）
    writeSummary([{ id: 'testing_run_status', classification: 'await_human_confirm' }]);
    assert.strictEqual(isReportAwaitConfirmState(root, 'homepage', 'testing'), false);
    // 还有其它确定性 FAIL（no_progress/visual_gap 态，visual_diff 未分类 await）→ false
    writeSummary([{ id: 'visual_diff' }, { id: 'testing_run_status' }]);
    assert.strictEqual(isReportAwaitConfirmState(root, 'homepage', 'testing'), false);
    // 缺 summary → false
    fs.rmSync(path.join(reportsDir, 'summary.json'));
    assert.strictEqual(isReportAwaitConfirmState(root, 'homepage', 'testing'), false);
  } finally {
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
