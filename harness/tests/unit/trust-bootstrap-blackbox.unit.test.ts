// ============================================================================
// trust-bootstrap-blackbox.unit.test.ts — sentinel 黑盒回归（b7e4d2a9 Todo 1）
// ----------------------------------------------------------------------------
// 受控 sentinel 目录作外部 MAISON_GOAL_CHECKPOINT_DIR 起**子进程**真实 run-unit
// --filter trust-isolation-probe：
//   ① sentinel 目录内容 hash 完全不变（bootstrap 无条件覆写外部 env——probe 主动写
//      marker，若覆写缺位 sentinel 必被污染，不存在"suite 恰好没写"的空跑假绿）；
//   ② 子进程输出只出现 probe suite（suite id 无子串重叠的防递归断言）；
//   ③ 子进程的临时 trust 根在退出后已被严格清理（cleanup 双语义的黑盒面）。
// 不读取真实 ~/.maison、不扫全局 %TEMP%。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { UnitCaseResult } from '../run-unit';

const HARNESS = path.resolve(__dirname, '..', '..');
const TSNODE = path.join(HARNESS, 'node_modules', 'ts-node', 'dist', 'bin.js');

function hashDir(dir: string): string {
  const h = crypto.createHash('sha256');
  const walk = (p: string): void => {
    for (const name of fs.readdirSync(p).sort()) {
      const abs = path.join(p, name);
      const st = fs.statSync(abs);
      h.update(path.relative(dir, abs).replace(/\\/g, '/'));
      if (st.isDirectory()) walk(abs);
      else h.update(fs.readFileSync(abs));
    }
  };
  walk(dir);
  return h.digest('hex');
}

export function runAll(): UnitCaseResult[] {
  const name = 'sentinel 黑盒：外部 env 被无条件覆写（sentinel 不变）+ 子进程只跑 probe + 临时根退出即清';
  try {
    const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-sentinel-'));
    fs.writeFileSync(path.join(sentinelDir, 'sentinel.txt'), 'DO-NOT-TOUCH', 'utf-8');
    const before = hashDir(sentinelDir);
    try {
      const r = spawnSync(
        process.execPath,
        [TSNODE, '--transpile-only', 'tests/run-unit.ts', '--filter', 'trust-isolation-probe'],
        {
          cwd: HARNESS,
          encoding: 'utf-8',
          shell: false,
          timeout: 300_000,
          env: { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: sentinelDir },
        },
      );
      const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
      if (r.status !== 0) throw new Error(`子进程非零退出（${r.status}）：\n${out.slice(-1200)}`);

      // ① sentinel 完全不变
      const after = hashDir(sentinelDir);
      if (before !== after) {
        throw new Error(`sentinel 目录被污染——bootstrap 未无条件覆写外部 env：\n${fs.readdirSync(sentinelDir).join(',')}`);
      }
      // ② 只出现 probe suite（防子串重叠递归）
      const suites = [...out.matchAll(/Suite \[([^\]]+)\]/g)].map(m => m[1]);
      if (suites.length !== 1 || suites[0] !== 'trust-isolation-probe') {
        throw new Error(`子进程 suite 集须恰为 probe：[${suites.join(', ')}]`);
      }
      // ③ 子进程临时根退出即清（严格 cleanup 的黑盒面）
      const m = out.match(/TRUST_PROBE_ROOT=(.+)/);
      if (!m) throw new Error('未捕获 TRUST_PROBE_ROOT 行——probe 未真执行（空跑假绿防线）');
      const probeRoot = m[1].trim();
      if (path.resolve(probeRoot) === path.resolve(sentinelDir)) {
        throw new Error('probe 竟写进 sentinel——覆写缺位');
      }
      if (fs.existsSync(probeRoot)) {
        throw new Error(`子进程临时 trust 根未被清理：${probeRoot}`);
      }
      return [{ name, ok: true }];
    } finally {
      fs.rmSync(sentinelDir, { recursive: true, force: true });
    }
  } catch (err) {
    return [{ name, ok: false, error: (err as Error).stack ?? (err as Error).message }];
  }
}
