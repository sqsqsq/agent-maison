// ============================================================================
// goal-supervisor.unit.test.ts — supervisor 决策核（plan a4f7e2b1 t2）
// ----------------------------------------------------------------------------
// 覆盖：beacon × run_disposition 全矩阵 / 重启预算与退避 / 平台边界 /
// **反重建断言**（等价性 + 依赖边界，替代粗暴的字符串扫描）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  countSupervisorRestarts,
  decideSupervision,
  MAX_RESTART_BACKOFF_MS,
  MAX_SUPERVISED_RESTARTS,
  RESTART_BACKOFF_BASE_MS,
  restartBackoffMs,
  schedulerSupport,
} from '../../scripts/utils/goal-supervisor';
import {
  resolveSurvivalCapability,
  resolveSurvivalFacet,
} from '../../scripts/utils/goal-adapter-capability';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface TestCase { name: string; run: () => void }

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'scripts');

/** 造一条以指定 disposition 收尾的 events 流。 */
function eventsWith(disposition: string, waitKind?: string, haltReason = 'some_reason'): unknown[] {
  return [
    { type: 'run_start' },
    {
      type: 'phase_halt',
      phase: 'testing',
      halt_reason: haltReason,
      run_disposition: disposition,
      ...(waitKind ? { run_wait_kind: waitKind } : {}),
    },
  ];
}

const cases: TestCase[] = [
  {
    name: 'beacon × run_disposition 全矩阵（fresh 恒不介入；stale 下四态各行其是）',
    run: () => {
      const four = [
        ['RESUME_READY', 'resume'],
        ['RECOVERY_PENDING', 'resume'],
        ['WAITING', 'no_op'],
        ['TERMINAL', 'never_restart'],
      ] as const;
      for (const [d, want] of four) {
        const fresh = decideSupervision({ events: eventsWith(d), restartsSoFar: 0, beaconStale: false });
        assert(fresh.action === 'no_op', `fresh+${d} 应不介入，实际 ${fresh.action}`);
        const stale = decideSupervision({ events: eventsWith(d), restartsSoFar: 0, beaconStale: true });
        assert(stale.action === want, `stale+${d} 期望 ${want}，实际 ${stale.action}`);
      }
    },
  },
  {
    name: '**关键格**：恢复途中进程死亡（stale + RECOVERY_PENDING）必须拉起，不得搁浅',
    run: () => {
      const d = decideSupervision({
        events: eventsWith('RECOVERY_PENDING'), restartsSoFar: 0, beaconStale: true,
      });
      assert(d.action === 'resume', `本 plan 立项场景被判 ${d.action}——回退已发起却没人续，run 永久搁浅`);
      assert(d.action === 'resume' && d.reason.includes('保守恢复'), '原因须点明续的是什么');
    },
  },
  {
    name: '空事件流也有确定判据（reducer 是 total function）——stale + 无事件 → resume',
    run: () => {
      const d = decideSupervision({ events: [], restartsSoFar: 0, beaconStale: true });
      assert(d.action === 'resume', `空事件流应按 RESUME_READY 处理，实际 ${d.action}`);
    },
  },
  {
    name: '重启预算：达到上限即停手求人（与 never_restart 分开，报告可区分两种停）',
    run: () => {
      for (let n = 0; n < MAX_SUPERVISED_RESTARTS; n += 1) {
        const d = decideSupervision({ events: eventsWith('RESUME_READY'), restartsSoFar: n, beaconStale: true });
        assert(d.action === 'resume', `第 ${n + 1} 次重启应放行，实际 ${d.action}`);
        assert(d.action === 'resume' && d.restart_seq === n + 1, 'restart_seq 应递增');
      }
      const over = decideSupervision({
        events: eventsWith('RESUME_READY'), restartsSoFar: MAX_SUPERVISED_RESTARTS, beaconStale: true,
      });
      assert(over.action === 'restart_budget_exhausted', `超限应停手，实际 ${over.action}`);
      assert(
        over.action === 'restart_budget_exhausted' && over.restarts === MAX_SUPERVISED_RESTARTS,
        '须带上已重启次数',
      );
    },
  },
  {
    name: '退避：首次不等，其后指数增长且有上界（防重启风暴）',
    run: () => {
      assert(restartBackoffMs(0) === 0, '首次重启不等待');
      assert(restartBackoffMs(1) === RESTART_BACKOFF_BASE_MS, '第二次 = base');
      assert(restartBackoffMs(2) === RESTART_BACKOFF_BASE_MS * 2, '指数增长');
      assert(restartBackoffMs(99) === MAX_RESTART_BACKOFF_MS, '须有上界，不得无限增长');
      // 单调不减
      let prev = -1;
      for (let n = 0; n <= 10; n += 1) {
        const v = restartBackoffMs(n);
        assert(v >= prev, `退避非单调：${n} → ${v} < ${prev}`);
        prev = v;
      }
    },
  },
  {
    name: '重启计数从 events 重建（跨进程持久，--resume 不丢）',
    run: () => {
      assert(countSupervisorRestarts([]) === 0, '空流为 0');
      assert(
        countSupervisorRestarts([
          { type: 'run_start' }, { type: 'supervisor_restart' },
          { type: 'heartbeat' }, { type: 'supervisor_restart' },
        ]) === 2,
        '应数到 2',
      );
    },
  },
  {
    name: '**反重建等价性**：固定 beacon+disposition+预算，任意替换 halt_reason，决策逐字不变',
    run: () => {
      const reasons = [
        'testing_write_violation', 'vision_ledger_tampered', 'unauthorized_source_mutation',
        'device_not_ready', 'framework_bug', 'brand_new_unregistered_reason',
      ];
      for (const d of ['RESUME_READY', 'RECOVERY_PENDING', 'WAITING', 'TERMINAL'] as const) {
        const outcomes = new Set(
          reasons.map((r) =>
            JSON.stringify(
              decideSupervision({ events: eventsWith(d, undefined, r), restartsSoFar: 0, beaconStale: true }),
            ),
          ),
        );
        assert(
          outcomes.size === 1,
          `disposition=${d} 下决策随 halt_reason 变了（${outcomes.size} 种）——` +
          'supervisor 在重建事故分类表：\n  ' + [...outcomes].join('\n  '),
        );
      }
    },
  },
  {
    name: '**依赖边界**：supervisor 不得 import decide / lookupIncident / INCIDENT_REGISTRY',
    run: () => {
      // 必须先剥注释：本模块头注**正是在说明**「不得依赖 lookupIncident /
      // INCIDENT_REGISTRY」，裸查子串会被自己的禁令文字触发假阳性（同一类子串误判
      // 在本仓已实锤多次）。按行剥，不用跨行正则（会被正则字面量里的 /* 吞掉真代码）。
      const raw = fs.readFileSync(path.join(SCRIPTS_DIR, 'utils', 'goal-supervisor.ts'), 'utf8');
      const src = raw
        .split('\n')
        .filter((line) => {
          const t = line.trimStart();
          return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
        })
        .join('\n');
      const importBlock = src.slice(0, src.indexOf('export const MAX_SUPERVISED_RESTARTS'));
      for (const forbidden of ['adjudication', 'lookupIncident', 'INCIDENT_REGISTRY']) {
        assert(
          !importBlock.includes(forbidden),
          `supervisor 直接依赖 ${forbidden}——那会迫使它重建 IncidentFacts/AuthorityFacts/` +
          'ExecutionContext，实为第二个裁决入口；只应消费 run-state reducer 的投影',
        );
      }
    },
  },
  {
    name: 't3 先探针后声明：只声明不实证的生存能力**一律降级**（虚标 = supervisor 撞死循环）',
    run: () => {
      // 只有 supported=true、没有 verified_by → 降级
      const bare = resolveSurvivalFacet('launch', { supported: true });
      assert(bare.supported === false, `无实证的声明被采信了：${JSON.stringify(bare)}`);
      assert(bare.supported === false && bare.reason.includes('verified_by'), '须点明缺什么');
      // 空白 verified_by 同样不算
      const blank = resolveSurvivalFacet('wakeup', { supported: true, verified_by: '   ' });
      assert(blank.supported === false, '空白实证不得采信');
      // 声明 + 实证齐备 → 采信
      const ok = resolveSurvivalFacet('liveness', {
        supported: true, verified_by: 'probe/2026-08-02/cursor-liveness.json', mechanism: 'detached pid',
      });
      assert(ok.supported === true, JSON.stringify(ok));
      assert(ok.supported === true && ok.mechanism === 'detached pid', '机制应透传');
      // 未声明 → 不支持（不是 unknown、不是默认开）
      assert(resolveSurvivalFacet('launch', undefined).supported === false, '缺省必须是不支持');
    },
  },
  {
    name: 't3 三段独立解析：全缺省时三段皆不支持（缺省不得等同于支持）',
    run: () => {
      const r = resolveSurvivalCapability(undefined);
      for (const f of ['launch', 'liveness', 'wakeup'] as const) {
        assert(r[f].supported === false, `${f} 缺省被判支持`);
        assert(r[f].facet === f, 'facet 标注须正确');
      }
    },
  },
  {
    name: 't3 仓库现状诚实性：**当前无任何 adapter 声明已实证的生存能力**（不得预填虚标）',
    run: () => {
      const agentsDir = path.resolve(SCRIPTS_DIR, '..', '..', 'agents');
      const claimed: string[] = [];
      for (const ent of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const yml = path.join(agentsDir, ent.name, 'adapter.yaml');
        if (!fs.existsSync(yml)) continue;
        const text = fs.readFileSync(yml, 'utf8');
        // 声明了 survival 却没有 verified_by = 虚标，正是本条要防的
        if (/\bsurvival:/.test(text) && !/verified_by:/.test(text)) claimed.push(ent.name);
      }
      assert(
        claimed.length === 0,
        `以下 adapter 声明了 survival 但无 verified_by 实证（虚标）：${claimed.join('、')}——` +
        '要么补实证样本，要么删声明；解析器会降级，但仓库里不该留虚标',
      );
    },
  },
  {
    name: '**生产执行链在场**：goal-supervise CLI 真的会 spawn --resume 并落 supervisor_restart',
    run: () => {
      // codex P0：此前只有决策核、全仓无调用方，countSupervisorRestarts 在生产环境
      // 永远只能数到 0——「进程死了谁拉起来」根本没解决。本断言锁死执行链在场。
      const cliPath = path.join(SCRIPTS_DIR, 'goal-supervise.ts');
      assert(fs.existsSync(cliPath), 'supervisor 执行器 CLI 不存在——决策核没有生产调用方');
      const src = fs.readFileSync(cliPath, 'utf8');
      assert(/superviseRun\s*\(/.test(src), 'CLI 未调用决策核');
      assert(/type: 'supervisor_restart'/.test(src), 'CLI 未落 supervisor_restart 事件');
      assert(/'--resume'/.test(src) && /spawn\(/.test(src), 'CLI 未真正 spawn --resume');
      assert(/schtasks/.test(src), '缺 Windows 计划任务安装/卸载入口');
      // 先记账再拉起：崩在 spawn 之前也已计数，避免「拉起失败没记账」导致无限重试
      const restartIdx = src.indexOf("type: 'supervisor_restart'");
      const spawnIdx = src.indexOf('spawn(process.execPath');
      assert(
        restartIdx > 0 && spawnIdx > restartIdx,
        '必须先落 supervisor_restart 再 spawn——顺序反了会出现「拉起失败但没记账」的无限重试',
      );
      // npm 入口可达
      const pkg = JSON.parse(fs.readFileSync(path.resolve(SCRIPTS_DIR, '..', 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      assert(
        typeof pkg.scripts?.['goal:supervise'] === 'string',
        'package.json 缺 goal:supervise 入口——宿主没有可执行的命令',
      );
    },
  },
  {
    name: '**闭环**：/F 强杀留下的陈旧 beacon + RECOVERY_PENDING → 决策核判 resume（自动恢复条件成立）',
    run: () => {
      // 模拟真实事故形态：进程被 taskkill /F 杀掉（beacon 原样留着、进程已不在），
      // 而 run 停在框架保守恢复途中。这正是 a4 立项要自动恢复的场景。
      const d = decideSupervision({
        events: [
          { type: 'run_start' },
          { type: 'phase_backtrack_requested', run_disposition: 'RECOVERY_PENDING' },
        ],
        restartsSoFar: 0,
        beaconStale: true, // = assessLivenessBeacon 对被强杀进程的判定（见 liveness-beacon 套件）
      });
      assert(d.action === 'resume', `强杀后自动恢复条件不成立：${JSON.stringify(d)}`);
      assert(d.action === 'resume' && d.backoff_ms === 0, '首次重启不应等待');
      // 连续三次拉起后停手，不无限重试
      const exhausted = decideSupervision({
        events: [{ type: 'run_start' }, { type: 'phase_halt', run_disposition: 'RESUME_READY' }],
        restartsSoFar: MAX_SUPERVISED_RESTARTS,
        beaconStale: true,
      });
      assert(exhausted.action === 'restart_budget_exhausted', '必须有终点，不得无限拉');
    },
  },
  {
    name: '平台边界：Windows 支持 schtasks，其余显式 unsupported（不做半可用实现）',
    run: () => {
      const win = schedulerSupport('win32');
      assert(win.supported === true && win.platform === 'win32', JSON.stringify(win));
      assert(win.supported === true && win.mechanism === 'schtasks', '须点明机制');
      for (const p of ['linux', 'darwin']) {
        const s = schedulerSupport(p);
        assert(s.supported === false, `${p} 应显式 unsupported`);
        assert(s.supported === false && s.reason.includes('--resume'), '须给出人工出路');
      }
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
