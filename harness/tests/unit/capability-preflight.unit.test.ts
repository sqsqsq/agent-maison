// ============================================================================
// capability-preflight.unit.test.ts — t3-min（plan e6a3c9f4 / openspec capability-gap-preflight）
// ----------------------------------------------------------------------------
// 覆盖：HARNESS_PREFLIGHT 机读持久化（goal/交互态分类依据）。gap 判定全链
// （profile+ensure+probe）由 toolchain-probe 恒拦截/人工 reprobe 用例（v4）+
// goal/harness 接线的全量回归承载；goal e2e 夹具（无 invoke 事件/resume 重检）留
// OpenSpec tasks 未勾。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emitHarnessPreflightGap,
  harnessPreflightPath,
  type CapabilityPreflightGap,
} from '../../scripts/utils/capability-preflight';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'emitHarnessPreflightGap：持久化机读缺口（schema/code/双出口指引齐备）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
      try {
        const gap: CapabilityPreflightGap = {
          ok: false,
          code: 'deveco_toolchain_capability_failed',
          prerequisites: ['agent_adapter', 'deveco_toolchain'],
          message: 'msg',
          guidance_install: 'install',
          guidance_stop: 'stop',
          evidence: ['e1'],
        };
        emitHarnessPreflightGap(root, 'coding', gap);
        const p = harnessPreflightPath(root);
        assert(fs.existsSync(p), '持久化文件应存在');
        const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
        assert(parsed.schema === 1 && parsed.phase === 'coding', 'schema/phase');
        assert(parsed.code === 'deveco_toolchain_capability_failed', 'code 保真');
        assert(parsed.guidance_install === 'install' && parsed.guidance_stop === 'stop', '双出口指引保真');
        assert(typeof parsed.at === 'string', '时间戳');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

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
