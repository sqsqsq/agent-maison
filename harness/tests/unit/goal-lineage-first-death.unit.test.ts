// ============================================================================
// goal-lineage-first-death.unit.test.ts — T4 用例 #8：在案"第一死"的行为钉
// ----------------------------------------------------------------------------
// 回放对象（宿主 ground truth，主仓 run1 / 6a969a）：
//   fresh 启动 11 秒即死——vision feature head 失配 + 未声明 vision_lineage=reset
//   → `vision_ledger_tamper` + TERMINAL → **裸 throw**，events 仅 3 行、报告没生成。
//
// **本用例当前钉的是"现状"，不是目标。** 目标行为（总纲 A【P0】#8）是：
//   fresh + 失配 + 未声明 → **自动记 discontinuity 并续跑**，不 TERMINAL、不裸崩。
// 那属 T2（`vision_feature_head_mismatch` 的三条 invocation 路径改行为），尚未实现。
//
// 为什么不写成"断言目标行为"然后长期红着：一条常红的用例三天后就没人看了
// （本仓已有"越优化越差"的实锤教训）。改成**棘轮**：
//   · 现在断言现状（失配即 throw、无 discontinuity、无 run_end）；
//   · T2 一旦落地，行为改变 → **本用例立刻转红**，强制实现者回来把断言翻成目标行为、
//     并把 T4 smoke 注册表 #8 改成 covered。
// 即：它不阻塞 CI，但**行为一变就必须有人处理**，不可能被静默跳过。
//
// 为什么经子进程 driver 而不在本进程跑：见 tests/helpers/goal-run-driver.ts 头注
// （异常终止的 goal run 会把信号处理器留在进程里，实测让整个 run-unit exit 130）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { RESULT_MARK, setupMinimalHost, type GoalRunOutcome } from '../helpers/goal-run-driver';
import type { UnitCaseResult } from '../run-unit';

const DRIVER = path.resolve(__dirname, '..', 'helpers', 'goal-run-driver.ts');
const TS_NODE = path.resolve(__dirname, '..', '..', 'node_modules', 'ts-node', 'dist', 'bin.js');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * **宿主由本进程创建并拥有**（codex 第九批 P1/P3）。
 *
 * driver 不再自建宿主——否则 smoke 传了 `clonedFrameworkRoot` 也只是
 * 「宿主 A 走完 install/commit/clone/integrity，宿主 B 另起炉灶跑 goal」，
 * 两个半链各自绿。整机 smoke 落地时直接传 `ctx.cloneRoot` 即可。
 *
 * 顺带解决目录归属：谁建谁删，`finally` **兜得住子进程超时/缺结果标记/JSON 解析
 * 失败**——上一版把 hostRoot 从子进程回传再顺序清理，那些异常路径下拿不到路径，
 * 记账写的"父进程 finally 清理"名不副实。
 */
function withHost<T>(feature: string, fn: (projectRoot: string) => T): T {
  const root = setupMinimalHost(feature);
  try {
    return fn(root);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 被占用即留待 OS */ }
  }
}

function runDriver(scenario: string, feature: string, projectRoot: string): GoalRunOutcome {
  const r = spawnSync(
    process.execPath,
    // `-` = framework 根用开发仓（单测形态）；smoke 传发布件根
    [TS_NODE, '--transpile-only', DRIVER, scenario, feature, '-', projectRoot],
    { encoding: 'utf-8', timeout: 300_000, cwd: path.resolve(__dirname, '..', '..') },
  );
  const at = (r.stdout ?? '').lastIndexOf(RESULT_MARK);
  if (at < 0) {
    throw new Error(
      `driver 未返回结果（exit ${r.status}）：\n${(r.stdout ?? '').slice(-800)}\n${(r.stderr ?? '').slice(-800)}`,
    );
  }
  return JSON.parse((r.stdout ?? '').slice(at + RESULT_MARK.length)) as GoalRunOutcome;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'T4#8 棘轮：fresh + head 失配 + 未声明 reset → **现状是裸崩**（T2 落地后本格必红）',
    run: () => {
      const out = withHost('first-death', root => runDriver('seed_head_mismatch', 'first-death', root));
      const detail = JSON.stringify(out);

      // ---- 棘轮主断言 ----
      assert(
        out.error !== null || (out.exitCode !== null && out.exitCode !== 0),
        '**本格是棘轮**：现状应当是"失配即死"。若它开始通过，说明 T2 已把 '
        + '`vision_feature_head_mismatch` 改成自动 discontinuity 续跑——请把本用例翻成'
        + '目标行为断言（discontinuity 在场 + 正常 run_end + 无 uncaught_exception），'
        + `并把 T4 smoke 注册表 #8 改成 covered。实测：${detail}`,
      );

      // ---- 命中目标分支的证据（不是"夹具没搭好也算死"）----
      // 本会话已四次栽在"断言没打到目标分支"上，这里逐条显式钉死。
      assert(
        out.eventTypes.includes('vision_ledger_tamper'),
        `须死在 vision head 裁决上（events 应含 vision_ledger_tamper）：${detail}`,
      );
      assert(
        out.error !== null
        && /feature head 失配/.test(out.error)
        && /未声明 vision_lineage=reset/.test(out.error),
        `须是"失配 + 未声明 reset"这条路径的**裸 throw**：${detail}`,
      );
      assert(
        !out.eventTypes.includes('run_end'),
        `"裸崩"的定义就是没有正常 run_end：${detail}`,
      );
      assert(
        !out.eventTypes.includes('lineage_discontinuity'),
        `现状不应有 discontinuity（那是 T2 的目标行为）：${detail}`,
      );
      assert(out.agentCalls === 0, `死在 phase 之前，不该调用 agent：${detail}`);
    },
  },
];

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
