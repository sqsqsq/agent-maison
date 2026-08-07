// ============================================================================
// goal-lineage-first-death.unit.test.ts — T4 用例 #8：在案"第一死"的行为钉
// ----------------------------------------------------------------------------
// 回放对象（宿主 ground truth，主仓 run1 / 6a969a——2026-08-06 复核过真实 events）：
//   fresh 启动 11 秒即死——vision feature head 失配 + 未声明 vision_lineage=reset
//   → `vision_ledger_tamper` → **裸 throw**。真实事件序列恰为 3 行：
//   `[run_start, vision_ledger_tamper, run_end{status:INTERRUPTED, reason:uncaught_exception}]`
//   ——末尾那条 run_end 是 **CLI 外层 catch 补的**，不是优雅终止（报告也没生成）。
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
    name: 'T4#8 **目标行为**（T2 5a-1 落地）：fresh + head 失配 + 未声明 → 自动 discontinuity 续跑收官',
    run: () => {
      const out = withHost('first-death', root => runDriver('seed_head_mismatch', 'first-death', root));
      const detail = JSON.stringify(out);

      // ---- 目标断言（2026-08-07 由棘轮第二次翻转而来；宿主 run1"第一死"的解）----
      // 失配=跨存储域结构常态（head 场外、账本 repo 内），不是攻击信号：
      // 自动 quarantine 旧锚 → 显式记录断裂（declared_by=auto_mismatch_recovery、
      // continuity_claim=revoked）→ 新 generation 续跑 → spec 真 PASS 收官。
      assert(
        out.error === null && (out.exitCode === 0 || out.exitCode === 2),
        `失配不再死：自动重建后 spec 链正常收官（0=完成/2=PARTIAL——generic 最小宿主的
 spec closure 细节判 PARTIAL 可接受；本格核心=不 TERMINAL 不裸崩）：${detail}`,
      );
      assert(
        out.eventTypes.includes('lineage_discontinuity')
        && out.eventTypes.includes('lineage_reset_committed'),
        `自动 discontinuity + reset 事务完成必须在场：${detail}`,
      );
      assert(
        out.phaseStartsThisCall.includes('spec') && out.agentCalls >= 1,
        `**续跑真的发生**（run1 死时 agent 零调用、无 phase 可进）：${detail}`,
      );
      // ---- 死法根除的反向证据 ----
      assert(
        !out.eventTypes.includes('vision_ledger_tamper'),
        `启动期不得再产 vision_ledger_tamper（该判死分支已删）：${detail}`,
      );
      assert(
        out.runEndReason !== 'uncaught_exception' && out.runEndError === null,
        `run_end 应是正常终态而非异常收口：${detail}`,
      );
    },
  },
  {
    name: '收口刀（codex P1-2）：场外缓存根不可写（ENOTDIR）→ 只记 persist_failed 继续，run 正常收官',
    run: () => {
      const out = withHost('cache-unwritable', root => runDriver('trust_dir_unwritable', 'cache-unwritable', root));
      const detail = JSON.stringify(out);
      // codex 实测旧行为：exitCode=1、agentCalls=0、phaseStarts=[]、
      // runEndReason=uncaught_exception（ENOTDIR ... trust-cp/vision-heads/...）。
      // 目标行为：head/checkpoint 是观察锚/恢复缓存——写失败=本次未持久化，无执行否决权。
      assert(
        out.error === null && (out.exitCode === 0 || out.exitCode === 2),
        `缓存不可写不得中断 run（0/2 正常收官）：${detail}`,
      );
      assert(
        out.eventTypes.includes('vision_anchor_persist_failed'),
        `写失败必须如实留痕（vision_anchor_persist_failed）：${detail}`,
      );
      assert(
        out.phaseStartsThisCall.includes('spec') && out.agentCalls >= 1,
        `phase 照常执行（旧行为零 phase 零 agent）：${detail}`,
      );
      assert(
        out.runEndReason !== 'uncaught_exception' && out.runEndError === null,
        `run_end 应是正常终态而非异常收口：${detail}`,
      );
    },
  },
  {
    name: '收口刀二/三（codex P1）：head=目录 + 旧 .bak 残留（最危险组合）→ 全程无 EISDIR，spec 照常执行',
    run: () => {
      const out = withHost('head-is-dir', root => runDriver('head_is_directory', 'head-is-dir', root));
      const detail = JSON.stringify(out);
      // codex 两轮实测旧行为：①quarantine 无保护重读 head → EISDIR；②修掉①后，
      // rollback 对旧 .bak 的还原目标被目录顶住 → rmSync EISDIR——两个死点都在
      // phase 前零 phase 中断。目标行为：rollback 逐条 no-throw 跳过、quarantine
      // 不读异常实体，自动重建照走；新 head 写不上去由 persist_failed 降级承接。
      assert(
        out.error === null && (out.exitCode === 0 || out.exitCode === 2),
        `head 为目录不得中断 run（0/2 正常收官）：${detail}`,
      );
      assert(
        out.eventTypes.includes('lineage_discontinuity'),
        `invalid → 自动 discontinuity 重建必须发生：${detail}`,
      );
      assert(
        out.eventTypes.includes('vision_anchor_persist_failed'),
        `新 head 写失败（rename 撞目录）须走降级留痕而非抛出：${detail}`,
      );
      assert(
        out.phaseStartsThisCall.includes('spec') && out.agentCalls >= 1,
        `spec 照常执行（旧行为零 phase）：${detail}`,
      );
      assert(
        out.runEndReason !== 'uncaught_exception' && out.runEndError === null,
        `run_end 应是正常终态：${detail}`,
      );
    },
  },
  {
    name: '收口刀三（codex P1）：vision-heads/<projectHash> 是**文件** → 残留枚举 ENOTDIR 不否决执行，spec 照常',
    run: () => {
      const out = withHost('ns-is-file', root => runDriver('trust_namespace_is_file', 'ns-is-file', root));
      const detail = JSON.stringify(out);
      // codex 实测旧行为：listLineageResetBackups 的 readdirSync 撞文件 ENOTDIR →
      // uncaught_exception 零 phase。目标行为：枚举失败=无可识别残留（返回空），
      // head 判 absent 照常首建；写失败由 persist_failed 降级承接。
      assert(
        out.error === null && (out.exitCode === 0 || out.exitCode === 2),
        `namespace 被文件顶住不得中断 run：${detail}`,
      );
      assert(
        out.eventTypes.includes('vision_anchor_persist_failed'),
        `head 写失败（mkdir 撞文件）须走降级留痕：${detail}`,
      );
      assert(
        out.phaseStartsThisCall.includes('spec') && out.agentCalls >= 1,
        `spec 照常执行（旧行为零 phase）：${detail}`,
      );
      assert(
        out.runEndReason !== 'uncaught_exception' && out.runEndError === null,
        `run_end 应是正常终态：${detail}`,
      );
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
