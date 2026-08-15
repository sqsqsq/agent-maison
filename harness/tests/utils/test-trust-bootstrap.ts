// ============================================================================
// test-trust-bootstrap.ts — 测试进程的场外 trust 状态隔离（b7e4d2a9 Todo 1）
// ============================================================================
// 背景（2026-07-27 审计实锤）：runner 级单测跑真实 runGoal，mkdtemp 临时宿主路径唯一 →
// project hash 唯一 → pass snapshot 直写真实 ~/.maison/goal-checkpoints，
// 三天堆出 899 个死目录。
//
// 契约：
//   1. **无条件覆写** MAISON_GOAL_CHECKPOINT_DIR 到本进程独立临时根——外部已设值也不
//      沿用（测试绝不写任何外部指定的真实目录；这正是 sentinel 黑盒回归所验证的行为）；
//   2. import 次序钉死：transpile-only-env → 本文件 → 其余一切 imports（run-tests 的
//      fixture-runner 等静态加载须在本文件之后才安全）；
//   3. cleanup 双语义：主流程 finally 走 cleanupStrict（失败=测试 runner 非零退出并打印
//      遗留路径，不许悄悄留 %TEMP%）；process.once('exit') 走 best-effort 静默后备
//      （exit handler 不适合抛错），兜模块加载异常与遗留 process.exit 点。
//      覆盖"正常及 JS 可观察退出路径"；hard-kill 的关键不变量=不污染真实 ~/.maison。
//   4. **无 cleaned 状态**（review round9 P1 实锤竞态：strict 成功后子进程/后续代码重建
//      trust root，带标志的 best-effort 会直接短路、残留不删）——rmSync force+recursive
//      本身幂等，每次清理都按当前文件系统状态执行。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface TrustIsolation {
  root: string;
  /** best-effort 静默清理（exit 后备；按当前 fs 状态幂等执行，无短路状态） */
  cleanupBestEffort(): void;
  /** 严格清理（主流程 finally）：失败返回遗留路径，调用方须非零退出并打印 */
  cleanupStrict(): { ok: boolean; leftoverPath?: string };
}

/** 工厂（可单测——单例见下方模块级实例） */
export function createTrustIsolation(prefix = 'maison-test-trust-'): TrustIsolation {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    root,
    cleanupBestEffort(): void {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* exit handler 内不抛 */
      }
    },
    cleanupStrict(): { ok: boolean; leftoverPath?: string } {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* 结果以存在性为准 */
      }
      return fs.existsSync(root) ? { ok: false, leftoverPath: root } : { ok: true };
    },
  };
}

const iso = createTrustIsolation();
process.env.MAISON_GOAL_CHECKPOINT_DIR = iso.root;

export function cleanupBestEffort(): void {
  iso.cleanupBestEffort();
}

export function cleanupStrict(): { ok: boolean; leftoverPath?: string } {
  return iso.cleanupStrict();
}

/** 当前进程的隔离 trust 根（单测断言用） */
export function testTrustRoot(): string {
  return iso.root;
}

process.once('exit', cleanupBestEffort);
