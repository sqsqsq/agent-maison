// ============================================================================
// trust-isolation-probe.unit.test.ts — 测试隔离的微型 probe（b7e4d2a9 Todo 1）
// ----------------------------------------------------------------------------
// 职责单一：主动向 MAISON_GOAL_CHECKPOINT_DIR 写一个 marker，并把实际 trust 根打到
// stdout（TRUST_PROBE_ROOT=...）。父黑盒套件（trust-bootstrap-blackbox）以受控 sentinel
// 目录作外部 env 起子进程跑本 suite——sentinel 不变即证明 bootstrap 已无条件覆写。
// 注意：本 suite id 与父 suite id 必须无子串包含关系（selectSuites 用 id.includes(filter)，
// 子串重叠会让子进程把父 suite 一起拉起并递归）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  try {
    const dir = process.env.MAISON_GOAL_CHECKPOINT_DIR ?? '';
    if (!dir) throw new Error('MAISON_GOAL_CHECKPOINT_DIR 未设置——bootstrap 未生效');
    if (!path.basename(dir).startsWith('maison-test-trust-')) {
      throw new Error(`trust 根不是 bootstrap 临时目录（外部 env 未被覆写？）：${dir}`);
    }
    if (path.resolve(dir) === path.resolve(os.homedir(), '.maison', 'goal-checkpoints')) {
      throw new Error('trust 根指向真实用户主目录——隔离失效');
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `probe-marker-${process.pid}.txt`), 'trust-write-probe', 'utf-8');
    // 父黑盒解析此行：断言 ≠ sentinel 目录、且子进程退出后该目录已被严格清理
    console.log(`TRUST_PROBE_ROOT=${dir}`);
    results.push({ name: 'probe：env 已被 bootstrap 覆写到临时根，marker 写入成功', ok: true });
  } catch (err) {
    results.push({
      name: 'probe：env 已被 bootstrap 覆写到临时根，marker 写入成功',
      ok: false,
      error: (err as Error).message,
    });
  }
  return results;
}
