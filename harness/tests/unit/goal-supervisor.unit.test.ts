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
import { evaluateDeviceReadinessProbe } from '../../scripts/utils/device-readiness-gate';

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
        'testing_write_violation', 'unauthorized_source_mutation',
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

cases.push(
  {
    name: 'T3 probe 只唤醒同源 external WAITING；缺 probe 或 probe 不匹配保持等待',
    run: () => {
      const events = [
        { type: 'run_start' },
        {
          type: 'phase_halt',
          phase: 'testing',
          run_disposition: 'WAITING',
          run_wait_kind: 'external',
          probe: 'device_readiness',
        },
      ];
      const notReady = decideSupervision({
        events,
        restartsSoFar: 0,
        beaconStale: true,
        condition: { probe: 'device_readiness', ready: false },
      });
      assert(notReady.action === 'no_op', 'probe 未转绿不得自动 resume');
      const wrongProbe = decideSupervision({
        events,
        restartsSoFar: 0,
        beaconStale: true,
        condition: { probe: 'credential_state_ready', ready: true },
      });
      assert(wrongProbe.action === 'no_op', '不同来源的 probe 不得唤醒');
      const ready = decideSupervision({
        events,
        restartsSoFar: 0,
        beaconStale: true,
        condition: { probe: 'device_readiness', ready: true },
      });
      assert(ready.action === 'resume', '同源 probe 转绿必须自动重新入队');
    },
  },
  {
    name: 'T3 截断链用现有 resume 决策标记 successor，不引入新状态',
    run: () => {
      const decision = decideSupervision({
        events: [
          { type: 'run_start' },
          {
            type: 'phase_halt',
            phase: 'coding',
            successor_required: true,
            run_disposition: 'RECOVERY_PENDING',
          },
        ],
        restartsSoFar: 0,
        beaconStale: true,
      });
      assert(decision.action === 'resume', '截断链仍沿用既有 resume 动作');
      assert(
        decision.action === 'resume' &&
          decision.successor_required === true &&
          decision.successor_start_phase === 'coding',
        '必须携带责任阶段 successor 元数据',
      );
    },
  },
  {
    name: 'T3 probe/successor 必须绑定当前 run_start 之后的投影事件，不得消费旧 run 元数据',
    run: () => {
      const events = [
        { type: 'run_start' },
        {
          type: 'phase_halt', phase: 'ut', run_disposition: 'WAITING', run_wait_kind: 'external',
          probe: 'device_readiness', successor_required: true,
        },
        { type: 'run_end', status: 'PARTIAL' },
        { type: 'run_start', resume: 'same-run' },
        { type: 'phase_halt', phase: 'coding', run_disposition: 'WAITING', run_wait_kind: 'human' },
      ];
      const staleProbe = decideSupervision({
        events, restartsSoFar: 0, beaconStale: true,
        condition: { probe: 'device_readiness', ready: true },
      });
      assert(staleProbe.action === 'no_op', '新一轮 WAITING(human) 不得被旧 probe 唤醒');
      assert(
        staleProbe.action !== 'resume' || staleProbe.successor_required !== true,
        '新一轮不得继承旧 phase_halt 的 successor_required',
      );

      const current = [
        { type: 'run_start' },
        { type: 'phase_halt', phase: 'ut', run_disposition: 'WAITING', run_wait_kind: 'external', probe: 'device_readiness' },
      ];
      const ready = decideSupervision({
        events: current, restartsSoFar: 0, beaconStale: true,
        condition: { probe: 'device_readiness', ready: true },
      });
      assert(ready.action === 'resume', '当前投影事件的 probe 转绿仍须唤醒');
    },
  },
  {
    name: 'T3 设备 probe 只返回隐私安全的 settle/layout/credential 结构化事实',
    run: () => {
      const base = {
        targets: ['device-1'],
        credentialReady: true,
      };
      const unsettled = evaluateDeviceReadinessProbe({
        ...base,
        snapshot: {
          locked: true,
          keypad: [],
          keypadDiag: { reason: 'digits_incomplete', found: 4, containerFound: true, hiddenSkipped: false },
          cooldown: { state: 'not_cooldown', ruleId: 'auth_no_cooldown_signal' },
        },
      });
      assert(unsettled.ready === false && unsettled.category === 'ui_not_settled', '未完整键盘必须归 settle');
      assert(unsettled.diagnostics.digit_count === 4 && unsettled.diagnostics.container_found === true, '必须保留数字数/容器事实');
      const unsupported = evaluateDeviceReadinessProbe({
        ...base,
        snapshot: {
          locked: true,
          keypad: [],
          keypadDiag: { reason: 'geometry_insane', found: 10, containerFound: true, hiddenSkipped: false },
          cooldown: { state: 'not_cooldown', ruleId: 'auth_no_cooldown_signal' },
        },
      });
      assert(unsupported.category === 'layout_unsupported' && unsupported.diagnostics.geometry_failure === true, '几何异常必须归 layout');
      const ready = evaluateDeviceReadinessProbe({
        ...base,
        snapshot: {
          locked: true,
          keypad: [],
          keypadDiag: { reason: 'ok', found: 10, containerFound: true, hiddenSkipped: false },
          cooldown: { state: 'not_cooldown', ruleId: 'auth_no_cooldown_signal' },
        },
      });
      assert(ready.ready === true, '键盘稳定且 credential ready 时 probe 必须转绿');
      assert(!('raw' in ready.diagnostics), '诊断不得携带 raw UI dump');
    },
  },
);

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
