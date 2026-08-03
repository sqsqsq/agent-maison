// ============================================================================
// liveness-beacon.unit.test.ts — run 级存活信标（plan a4f7e2b1 t1）
// ----------------------------------------------------------------------------
// 重点保护三件事：
//   ① **PID 重用不得被误判为存活**——这是四元组存在的唯一理由，单 pid 判定必翻车；
//   ② **反 `/F` 强杀**——被强杀的进程没机会清理 beacon，「文件还在」永远不是存活证据；
//   ③ **拿不到可信证据时判 stale**——absent/invalid 宁可多做一次 resume 前置检查，
//      也不能宣称还活着（后者会让真死的 run 永远没人拉起，正是 a4 立项要解决的事）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assessLivenessBeacon,
  isBeaconStale,
  livenessBeaconPath,
  readLivenessBeacon,
  writeLivenessBeacon,
  type LivenessBeacon,
} from '../../scripts/utils/liveness-beacon';
import type { ProcessProbe } from '../../scripts/utils/device-session';
import { supervisorAction } from '../../scripts/utils/run-state-reducer';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface TestCase { name: string; run: () => void }

const RUN_ID = '20260802T000000Z-abcdef';

/** 可控探针：想让 pid 是谁就是谁；`null` 表示进程不存在。 */
function probeOf(
  identity: { pid: number; startedAtMs: number; executable: string } | null,
): ProcessProbe {
  return {
    identify: () => identity,
    killTree: () => true,
  };
}

function tmpProject(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'liveness-'));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const SELF = { pid: 4242, startedAtMs: 1_700_000_000_000, executable: 'C:/node/node.exe' };

function beaconOf(over: Partial<LivenessBeacon['proc']> = {}, runId = RUN_ID): LivenessBeacon {
  return {
    schema_version: '1.0',
    run_id: runId,
    proc: { ...SELF, profile: runId, ...over },
    refreshed_at: new Date().toISOString(),
  };
}

const cases: TestCase[] = [
  {
    name: '四元组全等 → alive',
    run: () => {
      const v = assessLivenessBeacon({ beacon: beaconOf(), runId: RUN_ID, probe: probeOf(SELF) });
      assert(v.state === 'alive', JSON.stringify(v));
      assert(isBeaconStale(v) === false, 'alive 不应判 stale');
    },
  },
  {
    name: '**PID 重用负例**：pid 在但创建时间不同 → stale（单 pid 判定会在此翻车）',
    run: () => {
      const v = assessLivenessBeacon({
        beacon: beaconOf(),
        runId: RUN_ID,
        probe: probeOf({ ...SELF, startedAtMs: SELF.startedAtMs + 1 }),
      });
      assert(v.state === 'stale', `PID 重用被误判为存活：${JSON.stringify(v)}`);
      assert(v.state === 'stale' && v.reason.includes('重用'), v.state === 'stale' ? v.reason : '');
    },
  },
  {
    name: 'PID 重用负例之二：创建时间相同但可执行文件不同 → stale',
    run: () => {
      const v = assessLivenessBeacon({
        beacon: beaconOf(),
        runId: RUN_ID,
        probe: probeOf({ ...SELF, executable: 'C:/other/python.exe' }),
      });
      assert(v.state === 'stale', `可执行文件不符仍被判活：${JSON.stringify(v)}`);
    },
  },
  {
    name: '进程已不存在 → stale（含被 taskkill /F 强杀：beacon 文件必然原样留着）',
    run: () => {
      // 强杀不给清理机会，所以 beacon 内容一切正常——只有对账才能识破
      const v = assessLivenessBeacon({ beacon: beaconOf(), runId: RUN_ID, probe: probeOf(null) });
      assert(v.state === 'stale', `beacon 文件在就宣称存活 = 反强杀失效：${JSON.stringify(v)}`);
      assert(isBeaconStale(v) === true, '应判 stale');
    },
  },
  {
    name: 'beacon 属于别的 run → stale（不得拿旧 run 的存活证据给新 run 背书）',
    run: () => {
      const v = assessLivenessBeacon({
        beacon: beaconOf({}, 'another-run'),
        runId: RUN_ID,
        probe: probeOf(SELF),
      });
      assert(v.state === 'stale', JSON.stringify(v));
    },
  },
  {
    name: 'absent / invalid 一律按 stale 处理（拿不到可信证据时不得宣称存活）',
    run: () => {
      const absent = assessLivenessBeacon({ beacon: null, runId: RUN_ID, probe: probeOf(SELF) });
      assert(absent.state === 'absent' && isBeaconStale(absent), '缺 beacon 须按 stale');
      const bad = assessLivenessBeacon({
        beacon: { schema_version: '9.9' } as unknown as LivenessBeacon,
        runId: RUN_ID,
        probe: probeOf(SELF),
      });
      assert(bad.state === 'invalid' && isBeaconStale(bad), '坏 beacon 须按 stale');
    },
  },
  {
    name: '探不到自身身份时**不写残缺 beacon**（缺创建时间的 beacon 防不住 PID 重用）',
    run: () => tmpProject((root) => {
      const written = writeLivenessBeacon({
        projectRoot: root, reportDir: 'r', runId: RUN_ID, probe: probeOf(null),
      });
      assert(written === null, '探不到身份仍写了 beacon');
      assert(!fs.existsSync(livenessBeaconPath(root, 'r')), '不得留下残缺 beacon 文件');
    }),
  },
  {
    name: '写入 → 读回 → 对账闭环（四元组逐字段落盘）',
    run: () => tmpProject((root) => {
      const w = writeLivenessBeacon({
        projectRoot: root, reportDir: 'r', runId: RUN_ID, probe: probeOf(SELF),
      });
      assert(w !== null, '应写入成功');
      const back = readLivenessBeacon(root, 'r');
      assert(back?.run_id === RUN_ID, '读回 run_id');
      assert(back?.proc.startedAtMs === SELF.startedAtMs, '创建时间须落盘——否则防不住 PID 重用');
      assert(back?.proc.executable === SELF.executable, '可执行文件须落盘');
      const v = assessLivenessBeacon({ beacon: back, runId: RUN_ID, probe: probeOf(SELF) });
      assert(v.state === 'alive', JSON.stringify(v));
    }),
  },
  {
    name: '与 supervisor 判据面接线：beacon 陈旧 × run_disposition 全矩阵',
    run: () => {
      const stale = isBeaconStale(
        assessLivenessBeacon({ beacon: beaconOf(), runId: RUN_ID, probe: probeOf(null) }),
      );
      const fresh = isBeaconStale(
        assessLivenessBeacon({ beacon: beaconOf(), runId: RUN_ID, probe: probeOf(SELF) }),
      );
      assert(stale === true && fresh === false, 'beacon 轴取值不对');
      // 进程还活着 → 任何 disposition 都不介入
      assert(
        supervisorAction({ beaconStale: fresh, state: { run_disposition: 'RECOVERY_PENDING' } }) === 'no_op',
        'beacon 新鲜时不得介入',
      );
      // 进程真死 + 框架本要继续恢复 → 必须拉起（a4 立项场景）
      assert(
        supervisorAction({ beaconStale: stale, state: { run_disposition: 'RECOVERY_PENDING' } }) === 'resume',
        '恢复途中进程死亡必须拉起',
      );
      assert(
        supervisorAction({ beaconStale: stale, state: { run_disposition: 'TERMINAL' } }) === 'never_restart',
        '终局永不重启',
      );
    },
  },
];

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
