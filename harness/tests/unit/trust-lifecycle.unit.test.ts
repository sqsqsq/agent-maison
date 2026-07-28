// ============================================================================
// trust-lifecycle.unit.test.ts — per-run 场外状态回收契约（b7e4d2a9 Todo 2）
// ----------------------------------------------------------------------------
// deleteRunTrustState 的路径安全契约：runId 严格 basename / resolve 域内 / 拒 symlink /
// 逻辑删除单元（flat checkpoint + run 目录）/ 不动 vision-heads。封卷与 supersede 的
// 集成面见 goal-runner-testing-integrity 套件。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  deleteRunTrustState,
  isValidRunIdBasename,
  projectIdentityHash,
} from '../../scripts/utils/pass-snapshot';
import { createTrustIsolation } from '../utils/test-trust-bootstrap';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'bc-openCard';

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** 本套件创建的临时根——runAll finally 统一删除（review round9 P2：测试不留 %TEMP% 垃圾） */
const tmpRoots: string[] = [];

/** 受控 trust 根 + 一个 run 的两类状态 + vision-heads 邻居 */
function setup(runId: string): { root: string; trust: string; featDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-gc-'));
  tmpRoots.push(root);
  const trust = path.join(root, 'trust');
  const hash = projectIdentityHash(root);
  const featDir = path.join(trust, hash, FEATURE);
  fs.mkdirSync(path.join(featDir, runId, 'pass-snapshots', 'plan', '1'), { recursive: true });
  fs.writeFileSync(path.join(featDir, runId, 'pass-snapshots', 'plan', '1', 'manifest.json'), '{}');
  fs.writeFileSync(path.join(featDir, runId, 'coding-base.json'), '{}');
  fs.writeFileSync(path.join(featDir, `${runId}.json`), '{}');
  fs.mkdirSync(path.join(trust, 'vision-heads', hash), { recursive: true });
  fs.writeFileSync(path.join(trust, 'vision-heads', hash, `${FEATURE}.json`), '{}');
  return { root, trust, featDir };
}

function withTrust<T>(trust: string, fn: () => T): T {
  const prev = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = trust;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
    else process.env.MAISON_GOAL_CHECKPOINT_DIR = prev;
  }
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  try {

  run(results, 'round9 P1 回归：严格清理成功后目录被重建 → 退出兜底仍能删除（无 cleaned 短路态）', () => {
    const iso = createTrustIsolation('trust-cleaned-race-');
    tmpRoots.push(iso.root);
    fs.writeFileSync(path.join(iso.root, 'x.txt'), '1');
    assert(iso.cleanupStrict().ok, '严格清理应成功');
    assert(!fs.existsSync(iso.root), '严格清理后应不存在');
    // 竞态复现：strict 之后目录被重建（未结束的子进程/后续代码）
    fs.mkdirSync(iso.root, { recursive: true });
    fs.writeFileSync(path.join(iso.root, 'recreated.txt'), '2');
    iso.cleanupBestEffort();
    assert(!fs.existsSync(iso.root), '退出兜底必须仍能删除重建的目录（不得被状态标志短路）');
  });

  run(results, 'runId 严格 basename 契约：分隔符 / .. / . / 空 / 前导符号 全拒', () => {
    for (const bad of ['', ' ', '.', '..', 'a/b', 'a\\b', '../x', '.hidden?no', '-lead', '_lead']) {
      assert(!isValidRunIdBasename(bad), `须拒：${JSON.stringify(bad)}`);
    }
    for (const good of ['20260727T111240Z-059736', 'run-A', 'r1.x_2']) {
      assert(isValidRunIdBasename(good), `须收：${good}`);
    }
  });

  run(results, '逻辑删除单元：flat checkpoint + run 目录一起删；vision-heads 邻居分毫不动', () => {
    const runId = 'run-gc-1';
    const { root, trust, featDir } = setup(runId);
    const r = withTrust(trust, () => deleteRunTrustState({ projectRoot: root, feature: FEATURE, runId }));
    assert(r.deleted.length === 2, `两单元都应删除：${JSON.stringify(r)}`);
    assert(!fs.existsSync(path.join(featDir, `${runId}.json`)), 'flat checkpoint 应删');
    assert(!fs.existsSync(path.join(featDir, runId)), 'run 目录应删');
    const hash = projectIdentityHash(root);
    assert(fs.existsSync(path.join(trust, 'vision-heads', hash, `${FEATURE}.json`)), 'vision-heads 不得动');
  });

  run(results, '非法 runId → 只诊断零删除；不存在的 run → 无事静默', () => {
    const runId = 'run-gc-2';
    const { root, trust, featDir } = setup(runId);
    const bad = withTrust(trust, () => deleteRunTrustState({ projectRoot: root, feature: FEATURE, runId: '../escape' }));
    assert(bad.deleted.length === 0 && bad.diagnostics.length === 1, JSON.stringify(bad));
    assert(fs.existsSync(path.join(featDir, `${runId}.json`)), '既有状态不受非法请求影响');
    const ghost = withTrust(trust, () => deleteRunTrustState({ projectRoot: root, feature: FEATURE, runId: 'no-such-run' }));
    assert(ghost.deleted.length === 0 && ghost.diagnostics.length === 0, JSON.stringify(ghost));
  });

  run(results, 'symlink run 目录 → 拒删并诊断（不跟随链接删域外）', () => {
    const runId = 'run-gc-3';
    const { root, trust, featDir } = setup(runId);
    const outside = path.join(root, 'outside-target');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'victim.txt'), 'do-not-delete');
    const linkAbs = path.join(featDir, 'run-linked');
    try {
      fs.symlinkSync(outside, linkAbs, 'junction');
    } catch {
      return; // Windows 无权限构造夹具——lstat 分支由实现保证，如实跳过
    }
    const r = withTrust(trust, () => deleteRunTrustState({ projectRoot: root, feature: FEATURE, runId: 'run-linked' }));
    assert(r.deleted.length === 0 && r.diagnostics.some(d => d.includes('符号链接')), JSON.stringify(r));
    assert(fs.existsSync(path.join(outside, 'victim.txt')), '链接目标必须无损');
  });

  return results;
  } finally {
    for (const r of tmpRoots) {
      try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
