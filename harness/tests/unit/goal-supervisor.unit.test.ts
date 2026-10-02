// ============================================================================
// goal-supervisor.unit.test.ts — supervisor 决策核（plan a4f7e2b1 t2）
// ----------------------------------------------------------------------------
// 覆盖：beacon × run_disposition 全矩阵 / 重启预算与退避 / 平台边界 /
// **反重建断言**（等价性 + 依赖边界，替代粗暴的字符串扫描）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  countSupervisorRestarts,
  decideSupervision,
  MAX_RESTART_BACKOFF_MS,
  MAX_SUPERVISED_RESTARTS,
  RESTART_BACKOFF_BASE_MS,
  restartBackoffMs,
  schedulerSupport,
  superviseRun,
} from '../../scripts/utils/goal-supervisor';
import { reduceRunState } from '../../scripts/utils/run-state-reducer';
import { waitForConditionRecovery } from '../../scripts/utils/condition-wait';
import { livenessBeaconPath } from '../../scripts/utils/liveness-beacon';
import { FEATURE_LOCK_NAME, releaseLock, tryAcquireLock } from '../../scripts/utils/goal-run-lock';
import { FINALIZE_RESERVE_MS, resolveWallClockMs } from '../../scripts/utils/goal-timeout';
import * as supervise from '../../scripts/goal-supervise';
import { clearFrameworkConfigCache } from '../../config';
import {
  recordHvigorBuildOutcome,
  resetCapabilityFailedByHumanReprobe,
} from '../../../profiles/hmos-app/harness/toolchain-probe';
import {
  FEATURE,
  runGoalRuntimeChain,
  setupGoalRuntimeHost,
} from './goal-runner-testing-integrity.unit.test';
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
    name: 'runner-owned-machine-facts（codex 三轮）：WAITING(human) 上挂 successor 字段=死信——supervisor 仍 no_op，不得自动拉起',
    run: () => {
      // 生产曾出现的半接线组合：upstream_closure_gap → WAITING(human)，事件却带
      // successor_required/successor_start_phase。supervisor 对 WAITING 恒 no_op，
      // 这些字段永远不会被执行——生产 emit 点已删；本用例钉住语义防回潮。
      const events: unknown[] = [
        { type: 'run_start' },
        {
          type: 'phase_halt', phase: 'coding', halt_reason: 'upstream_closure_gap',
          run_disposition: 'WAITING', run_wait_kind: 'human',
          successor_required: true, successor_start_phase: 'plan',
        },
      ];
      const d = decideSupervision({ events, restartsSoFar: 0, beaconStale: true });
      assert(d.action === 'no_op', `WAITING(human) 不因 successor 字段被拉起，实际 ${d.action}`);
    },
  },
  {
    // plan 4e6fb3b6 §5.3：后继分支已删（生产无产出方）。旧版本发布件写过的 successor 字段只剩兼容读取意义：
    // RECOVERY_PENDING 照常恢复同一个 run，字段本身不再改变决策。
    name: 'P3 t3 兼容：旧事件带 successor_required/successor_start_phase → 仍按 RECOVERY_PENDING 恢复同一 run，字段不再被消费',
    run: () => {
      const events: unknown[] = [
        { type: 'run_start' },
        {
          type: 'phase_halt', phase: 'review', halt_reason: 'goal_review_closure_baseline_unavailable',
          run_disposition: 'RECOVERY_PENDING',
          successor_required: true, successor_start_phase: 'coding',
        },
      ];
      const d = decideSupervision({ events, restartsSoFar: 0, beaconStale: true });
      assert(d.action === 'resume', `RECOVERY_PENDING 应拉起，实际 ${d.action}`);
      assert(!('successor_required' in d) && !('successor_start_phase' in d), `决策不得再带后继字段：${JSON.stringify(d)}`);
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
      // P1-3 review 后形态：spawn 经注入缝 `spawnImpl ?? spawn`（行为面由
      // agent-containment 套件「受控 force 行为测试」真调用 main 断言 argv =
      // --resume/--force-resume——此处只锁执行链在场）。
      assert(/'--resume'/.test(src) && /spawnImpl\(process\.execPath/.test(src)
        && /__testing_setSpawnImpl/.test(src), 'CLI 未真正 spawn --resume（注入缝缺失）');
      assert(/schtasks/.test(src), '缺 Windows 计划任务安装/卸载入口');
      // 先记账再拉起：崩在 spawn 之前也已计数，避免「拉起失败没记账」导致无限重试
      const restartIdx = src.indexOf("type: 'supervisor_restart'");
      const spawnIdx = src.indexOf('spawnImpl(process.execPath');
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
    name: 'T3 probe 必须绑定当前 run_start 之后的投影事件，不得消费旧 run 元数据',
    run: () => {
      const events = [
        { type: 'run_start' },
        {
          type: 'phase_halt', phase: 'ut', run_disposition: 'WAITING', run_wait_kind: 'external',
          probe: 'device_readiness',
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
    name: 'P3 t3 run_end 作来源：带探针的 WAITING(external) run_end 与停机事件同判据；探针与责任阶段取自 run_end',
    run: () => {
      const halt = {
        type: 'phase_halt', phase: 'coding', halt_reason: 'await_human_capability_gap',
        run_disposition: 'WAITING', run_wait_kind: 'external', probe: 'capability_preflight_ready',
      };
      const withProbe = [
        { type: 'run_start' }, halt,
        { type: 'run_end', status: 'HALTED', run_disposition: 'WAITING', run_wait_kind: 'external',
          probe: 'capability_preflight_ready', probe_phase: 'coding' },
      ];
      assert(reduceRunState(withProbe).source_event_type === 'run_end', '前提：HALTED run_end 自带投影即为来源');
      const woke = decideSupervision({
        events: withProbe, restartsSoFar: 0, beaconStale: true,
        condition: { probe: 'capability_preflight_ready', ready: true },
      });
      assert(woke.action === 'resume', `带探针的 run_end 须可被唤醒：${JSON.stringify(woke)}`);
      const phases: Array<string | undefined> = [];
      superviseRun({
        projectRoot: os.tmpdir(), reportDir: 'no-such-run-dir', runId: 'r', events: withProbe,
        conditionProbe: (_p, phase) => { phases.push(phase); return { ready: false }; },
      });
      assert(phases.length === 1 && phases[0] === 'coding', `责任阶段须取 run_end.probe_phase：${JSON.stringify(phases)}`);
      const noProbe = [
        { type: 'run_start' }, halt,
        { type: 'run_end', status: 'HALTED', run_disposition: 'WAITING', run_wait_kind: 'external' },
      ];
      const kept = decideSupervision({
        events: noProbe, restartsSoFar: 0, beaconStale: true,
        condition: { probe: 'capability_preflight_ready', ready: true },
      });
      assert(kept.action === 'no_op', 'run_end 不带探针 = 无可核验条件，保持等待');
      const humanWait = [
        { type: 'run_start' },
        { type: 'run_end', status: 'HALTED', run_disposition: 'WAITING', run_wait_kind: 'human',
          probe: 'capability_preflight_ready', probe_phase: 'coding' },
      ];
      assert(decideSupervision({
        events: humanWait, restartsSoFar: 0, beaconStale: true,
        condition: { probe: 'capability_preflight_ready', ready: true },
      }).action === 'no_op', '等人（human）不因探针被拉起：等待类限制不变');
      assert(decideSupervision({
        events: withProbe, restartsSoFar: MAX_SUPERVISED_RESTARTS, beaconStale: true,
        condition: { probe: 'capability_preflight_ready', ready: true },
      }).action === 'restart_budget_exhausted', '重启次数上限不变');
      assert(decideSupervision({
        events: withProbe, restartsSoFar: 0, beaconStale: false,
        condition: { probe: 'capability_preflight_ready', ready: true },
      }).action === 'no_op', '进程活着不介入');
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

// ---------------------------------------------------------------------------
// plan 4e6fb3b6 §5（批二 t3）：进程内有界等待 + 探针贯通到 run_end + supervisor 接受 run_end 作来源
// ---------------------------------------------------------------------------

const asyncCases: Array<{ name: string; run: () => Promise<void> }> = [];

function goalRunsDir(root: string): string {
  return path.join(root, 'doc', 'features', FEATURE, 'goal-runs');
}

function readRunEvents(root: string, runId: string): Array<Record<string, unknown>> {
  const p = path.join(goalRunsDir(root), runId, 'events.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** 运行中找本 feature 唯一 run 的事件文件里有没有某类事件（等待期间由测试侧"修环境"用）。 */
function anyRunHasEvent(root: string, type: string): boolean {
  const dir = goalRunsDir(root);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).some((n) => {
    const p = path.join(dir, n, 'events.jsonl');
    return fs.existsSync(p) && fs.readFileSync(p, 'utf-8').includes(`"type":"${type}"`);
  });
}

/** 真实 hmos 宿主 + 真实 wrapper 记录的能力失败：coding 的 invoke 前能力门（生产 runInvokeCapabilityGate）会停。 */
function hostWithCapabilityGap(): string {
  const { root } = setupGoalRuntimeHost();
  recordHvigorBuildOutcome(root, {
    kind: 'capability_failed',
    fingerprint: 'p3-b2-fp',
    failure_code: 'sdk_component_missing',
    evidence: ['sdk_manifest_format=sdk-pkg.json'],
  });
  return root;
}

/** 以生产 supervisor CLI 真跑一轮；spawn 注入只记录参数。探针不注入时走共享的真实实现。 */
async function superviseOnce(
  root: string,
  runId: string,
  conditionProbe: ((probe: string, phase?: string) => { ready: boolean; reason?: string }) | null,
): Promise<{ code: number; spawned: string[][]; lockHeldAtSpawn: boolean[] }> {
  const spawned: string[][] = [];
  const lockHeldAtSpawn: boolean[] = [];
  const prevArgv = process.argv;
  const prevCwd = process.cwd();
  // run 在本进程内跑完，beacon 记的是本进程 pid（活着）；删掉 beacon = 进程已不在（与 goal-run-driver 同法）
  fs.rmSync(livenessBeaconPath(root, `doc/features/${FEATURE}/goal-runs/${runId}`), { force: true });
  try {
    supervise.__testing_setSpawnImpl((_file, args) => {
      spawned.push(args.slice(1));
      lockHeldAtSpawn.push(fs.existsSync(path.join(goalRunsDir(root), FEATURE_LOCK_NAME)));
      return { pid: 4242, unref: () => undefined } as never;
    });
    supervise.__testing_setConditionProbe(conditionProbe);
    process.argv = ['node', 'goal-supervise.ts', '--feature', FEATURE, '--run-id', runId, '--project-root', root];
    process.chdir(root);
    clearFrameworkConfigCache();
    const code = await supervise.__testing_main();
    return { code, spawned, lockHeldAtSpawn };
  } finally {
    supervise.__testing_setSpawnImpl(null);
    supervise.__testing_setConditionProbe(null);
    process.argv = prevArgv;
    try { process.chdir(prevCwd); } catch { /* ignore */ }
  }
}

/** 回拨最近一段已结束会话：活跃时长 = consumedMs，run_end 早于现在 10 分钟（过恢复冷却）。 */
function backdateLastSession(reportDir: string, consumedMs: number): void {
  const p = path.join(reportDir, 'events.jsonl');
  const events = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const lastEnd = events.map((e) => e.type).lastIndexOf('run_end');
  const lastStart = events.map((e) => e.type).lastIndexOf('run_start');
  assert(lastEnd > lastStart && lastStart >= 0, '夹具：须是一个已结束的会话');
  const endMs = Date.now() - 10 * 60_000;
  events[lastStart].ts = new Date(endMs - consumedMs).toISOString();
  if (typeof events[lastStart].session_started_at === 'string') events[lastStart].session_started_at = events[lastStart].ts;
  events[lastEnd].ts = new Date(endMs).toISOString();
  fs.writeFileSync(p, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}

asyncCases.push(
  {
    name: 'P3 R2 等待函数：到上限后不再探测、不再重查；重查拿到的是剩余额度',
    run: async () => {
      const probeAt: number[] = [];
      const recheckBudgets: number[] = [];
      const t0 = Date.now();
      const ok = await waitForConditionRecovery({
        phase: 'ut', probe: 'device_readiness', blockedBy: 'device_not_ready',
        availableMs: 150, maxWaitMs: 5_000, pollMs: 40,
        runProbe: () => { probeAt.push(Date.now() - t0); return { ready: true }; },
        recheck: async (remainingMs) => { recheckBudgets.push(remainingMs); return false; },
        emit: () => undefined,
      });
      assert(ok === false, '一直未恢复应超时');
      assert(probeAt.every((ms) => ms < 150), `到上限后不得再探测：${JSON.stringify(probeAt)}`);
      assert(recheckBudgets.length === probeAt.length && recheckBudgets.every((b) => b > 0 && b <= 150),
        `重查拿到的须是剩余额度：${JSON.stringify(recheckBudgets)}`);
    },
  },
  {
    name: 'P3 批二遗留 等待函数：同步探针自身耗尽余额后不再重查，按超时收尾',
    run: async () => {
      const recheckBudgets: number[] = [];
      const events: Array<Record<string, unknown>> = [];
      const ok = await waitForConditionRecovery({
        phase: 'ut', probe: 'device_readiness', blockedBy: 'device_not_ready',
        availableMs: 60, maxWaitMs: 5_000, pollMs: 20,
        // 同步探针（真实探针会 spawn hdc 等）：一次探测就把 60ms 余额耗尽，结论却是"就绪"
        runProbe: () => { const until = Date.now() + 90; while (Date.now() < until) { /* busy */ } return { ready: true }; },
        recheck: async (remainingMs) => { recheckBudgets.push(remainingMs); return true; },
        emit: (e) => events.push(e),
      });
      assert(ok === false, '余额已尽应按超时收尾');
      assert(recheckBudgets.length === 0, `余额已尽不得再重查（会把非正余额传给重查）：${JSON.stringify(recheckBudgets)}`);
      assert(events.map((e) => e.type).join(',') === 'condition_wait_started,condition_wait_timeout', JSON.stringify(events));
      assert(events[1].probe_ready_count === 1, `探针就绪次数照常计：${String(events[1].probe_ready_count)}`);
    },
  },
  {
    name: 'P3 R2 运行时链：等待用掉一部分预算后，正式调用只拿到余额（事件记录与实际调用同一最终值）',
    run: async () => {
      const root = hostWithCapabilityGap();
      try {
        const first = await runGoalRuntimeChain(root, { freshEndPhase: 'coding', conditionWait: { maxWaitMs: 100, pollMs: 50 } });
        const runId = path.basename(first.reportDir);
        assert(first.events.some((e) => e.type === 'phase_halt' && e.halt_reason === 'await_human_capability_gap'), '夹具：第一段须停在能力缺口');
        const manifest = JSON.parse(fs.readFileSync(path.join(first.reportDir, 'manifest.json'), 'utf-8')) as { phase_chain?: string[] };
        const wallMs = resolveWallClockMs(manifest as never, manifest.phase_chain);
        backdateLastSession(first.reportDir, wallMs - FINALIZE_RESERVE_MS - 25_000);
        let waitSeenAt = 0;
        const fixer = setInterval(() => {
          if (!waitSeenAt && anyRunHasEvent(root, 'condition_wait_started')) waitSeenAt = Date.now();
          if (waitSeenAt && Date.now() - waitSeenAt > 4_000) {
            clearInterval(fixer);
            resetCapabilityFailedByHumanReprobe(root, true);
          }
        }, 20);
        let resumed: Awaited<ReturnType<typeof runGoalRuntimeChain>>;
        try {
          resumed = await runGoalRuntimeChain(root, {
            resume: runId, forceResume: true, freshEndPhase: 'coding',
            conditionWait: { maxWaitMs: 60_000, pollMs: 100 },
          });
        } finally {
          clearInterval(fixer);
        }
        const thisSession = resumed.events.slice(resumed.events.map((e) => e.type).lastIndexOf('run_start'));
        const started = thisSession.find((e) => e.type === 'condition_wait_started');
        const ready = thisSession.find((e) => e.type === 'condition_wait_ready');
        assert(!!started && !!ready, `须先等待再恢复：${thisSession.map((e) => e.type).join(',')}`);
        const invoke = thisSession.find((e) => e.type === 'agent_invoke_start' && e.phase === 'coding');
        assert(!!invoke, '恢复后 coding 须真正调用');
        const limit = Number(started!.limit_ms);
        const waited = Number(ready!.waited_ms);
        const effective = Number(invoke!.effective_timeout_ms);
        assert(waited >= 3_000, `夹具：等待须用掉数秒，实得 ${waited}`);
        assert(effective <= limit - waited + 1_500,
          `调用时限须按等待后的余额重新钳制：limit=${limit} waited=${waited} effective=${effective}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 批二遗留 运行时链：等待后再钳制的时限同步进写给执行者的提示词（不是门禁前的值）',
    run: async () => {
      const { root } = setupGoalRuntimeHost();
      try {
        // 时限只写在"上一次调用被中断、从半成品续作"的提示词段里：第一段让 coding 调用中途崩溃（留下未闭合调用），
        // 恢复时它就是续作提示词。随后记下真实 wrapper 的能力失败，恢复会先在能力门前等待。
        const first = await runGoalRuntimeChain(root, {
          freshEndPhase: 'coding',
          onCoding: () => { throw new Error('injected crash inside coding invoke'); },
        });
        const runId = path.basename(first.reportDir);
        assert(first.events.some((e) => e.type === 'run_end' && e.status === 'INTERRUPTED'), `夹具：第一段须中断：${first.events.map((e) => e.type).join(',')}`);
        recordHvigorBuildOutcome(root, {
          kind: 'capability_failed', fingerprint: 'p3-b3-fp', failure_code: 'sdk_component_missing',
          evidence: ['sdk_manifest_format=sdk-pkg.json'],
        });
        const manifest = JSON.parse(fs.readFileSync(path.join(first.reportDir, 'manifest.json'), 'utf-8')) as { phase_chain?: string[] };
        const wallMs = resolveWallClockMs(manifest as never, manifest.phase_chain);
        // 余额约 95 秒：门禁前时限四舍五入为 2 分钟；等过约 9 秒后余额低于 90 秒，四舍五入为 1 分钟——两者可区分
        backdateLastSession(first.reportDir, wallMs - FINALIZE_RESERVE_MS - 95_000);
        let waitSeenAt = 0;
        const fixer = setInterval(() => {
          if (!waitSeenAt && anyRunHasEvent(root, 'condition_wait_started')) waitSeenAt = Date.now();
          if (waitSeenAt && Date.now() - waitSeenAt > 9_000) {
            clearInterval(fixer);
            resetCapabilityFailedByHumanReprobe(root, true);
          }
        }, 20);
        let resumed: Awaited<ReturnType<typeof runGoalRuntimeChain>>;
        try {
          resumed = await runGoalRuntimeChain(root, {
            resume: runId, forceResume: true, freshEndPhase: 'coding',
            conditionWait: { maxWaitMs: 120_000, pollMs: 100 },
          });
        } finally {
          clearInterval(fixer);
        }
        const thisSession = resumed.events.slice(resumed.events.map((e) => e.type).lastIndexOf('run_start'));
        const started = thisSession.find((e) => e.type === 'condition_wait_started');
        const invoke = thisSession.find((e) => e.type === 'agent_invoke_start' && e.phase === 'coding');
        assert(!!started && !!invoke, `须等待后真正调用 coding：${thisSession.map((e) => e.type).join(',')}`);
        const minutes = (ms: number): number => Math.max(1, Math.round(ms / 60_000));
        assert(minutes(Number(started!.limit_ms)) === 2, `夹具：门禁前时限须四舍五入为 2 分钟，limit=${String(started!.limit_ms)}`);
        const effective = Number(invoke!.effective_timeout_ms);
        assert(minutes(effective) === 1, `夹具：等待后时限须四舍五入为 1 分钟，effective=${effective}`);
        const prompt = resumed.codingPrompts[resumed.codingPrompts.length - 1] ?? '';
        const shown = /Time budget: ~(\d+) minutes/.exec(prompt)?.[1];
        assert(shown === String(minutes(effective)), `提示词时限须取最终钳制值：提示词=${shown} 分钟，实际=${effective}ms`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 R2 设备门重查：有耗时操作的重查拿到剩余额度（模拟器启动预算不超过等待余额）',
    run: async () => {
      const { root } = setupGoalRuntimeHost();
      const budgets: Array<number | undefined> = [];
      try {
        const probe = await runGoalRuntimeChain(root, {
          freshEndPhase: 'ut',
          deviceGate: (o: { phase: string; retries: number; input: { emulatorBootBudgetMs?: number }; emitEvent: (e: Record<string, unknown>) => void }) => {
            budgets.push(o.input.emulatorBootBudgetMs);
            if (budgets.length === 1) {
              o.emitEvent({ type: 'phase_halt', phase: o.phase, halt_reason: 'device_not_ready', verdict: 'FAIL', reason: '注入', probe: 'device_readiness', notes: [] });
              return {
                outcome: { phase: o.phase, verdict: 'FAIL', halted: false, retries: o.retries, halt_reason: 'device_not_ready',
                  halt_guidance: '注入', blocking_class: 'externalBlocked', failure_kind: 'device_blocked', probe: 'device_readiness' },
                notes: [],
              };
            }
            return { env: {}, target: { serial: 'fake-device', targetKind: 'physical' as const }, notes: [] };
          },
          conditionWait: { maxWaitMs: 3_000, pollMs: 50, runProbe: () => ({ ready: true }) },
        });
        const started = probe.events.find((e) => e.type === 'condition_wait_started');
        assert(!!started && probe.events.some((e) => e.type === 'condition_wait_ready'), '须等待后恢复');
        assert(budgets[0] === undefined, '首次门禁不改既有预算');
        assert(typeof budgets[1] === 'number' && budgets[1]! > 0 && budgets[1]! <= Number(started!.limit_ms),
          `重查的模拟器启动预算须取等待余额：${JSON.stringify(budgets)} limit=${String(started!.limit_ms)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 t3 等待函数：先探后等；就绪但原检查未过继续等；原检查通过即恢复；到上限停并只落一条收尾事件',
    run: async () => {
      const events: Array<Record<string, unknown>> = [];
      let probes = 0;
      let rechecks = 0;
      const recovered = await waitForConditionRecovery({
        phase: 'coding', probe: 'capability_preflight_ready', blockedBy: 'await_human_capability_gap',
        availableMs: 60_000, maxWaitMs: 2_000, pollMs: 10,
        runProbe: () => { probes += 1; return { ready: probes >= 2 }; },
        recheck: async () => { rechecks += 1; return rechecks >= 2; },
        emit: (e) => events.push(e),
      });
      assert(recovered === true, '原检查通过应返回已恢复');
      assert(rechecks === 2, `探针就绪才重查原检查：rechecks=${rechecks}`);
      assert(JSON.stringify(events.map((e) => e.type)) === JSON.stringify(['condition_wait_started', 'condition_wait_ready']),
        `事件=${JSON.stringify(events)}`);
      assert(events.every((e) => !('halt_reason' in e)), '等待事件不得带 halt_reason（写盘层会给它补处置投影）');

      const timeoutEvents: Array<Record<string, unknown>> = [];
      const t0 = Date.now();
      const timedOut = await waitForConditionRecovery({
        phase: 'ut', probe: 'device_readiness', blockedBy: 'device_not_ready',
        availableMs: 120, maxWaitMs: 5_000, pollMs: 30,
        runProbe: () => ({ ready: false, reason: 'no device' }),
        recheck: async () => true,
        emit: (e) => timeoutEvents.push(e),
      });
      assert(timedOut === false, '探针一直未就绪应超时');
      assert(Date.now() - t0 < 2_000, '上限取剩余墙钟预算的较小者（这里是 120ms）');
      assert(timeoutEvents.map((e) => e.type).join(',') === 'condition_wait_started,condition_wait_timeout',
        JSON.stringify(timeoutEvents));
      assert(timeoutEvents[0].limit_ms === 120, `上限=${String(timeoutEvents[0].limit_ms)}`);

      const none: Array<Record<string, unknown>> = [];
      const skipped = await waitForConditionRecovery({
        phase: 'ut', probe: 'device_readiness', blockedBy: 'device_not_ready', availableMs: 0,
        runProbe: () => ({ ready: true }), recheck: async () => true, emit: (e) => none.push(e),
      });
      assert(skipped === false && none.length === 0, '预算已尽不等、不落事件');
    },
  },
  {
    name: 'P3 A6 运行时链：真实能力门停在 coding，等待中环境修好→同一 attempt 继续，无停机、不耗内容重试',
    run: async () => {
      const root = hostWithCapabilityGap();
      const fixer = setInterval(() => {
        if (anyRunHasEvent(root, 'condition_wait_started')) {
          clearInterval(fixer);
          resetCapabilityFailedByHumanReprobe(root, true);
        }
      }, 20);
      try {
        const probe = await runGoalRuntimeChain(root, {
          freshEndPhase: 'coding',
          conditionWait: { maxWaitMs: 20_000, pollMs: 50 },
        });
        const types = probe.events.map((e) => String(e.type));
        const started = probe.events.find((e) => e.type === 'condition_wait_started');
        assert(!!started && started.phase === 'coding' && started.probe === 'capability_preflight_ready' &&
          started.blocked_by === 'await_human_capability_gap', `须在 coding 开始等待：${JSON.stringify(started)}`);
        assert(types.includes('condition_wait_ready') && !types.includes('condition_wait_timeout'), `须就绪恢复：${types.join(',')}`);
        assert(!probe.events.some((e) => e.type === 'phase_halt'), '恢复后不得留下停机事件');
        assert(probe.invokedPhases.includes('coding'), `coding 须真正执行：${probe.invokedPhases.join('→')}`);
        const codingVerdicts = probe.events.filter((e) => e.type === 'phase_verdict' && e.phase === 'coding');
        assert(codingVerdicts.every((e) => e.action !== 'retry'), '等待不消耗内容重试');
        const end = [...probe.events].reverse().find((e) => e.type === 'run_end');
        assert(end?.status === 'CHAIN_SLICE_COMPLETED', `run 须到终点：${JSON.stringify(end)}`);
      } finally {
        clearInterval(fixer);
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 A6+A7 能力探针：等待超时→停放 HALTED，run_end 带探针与责任阶段；修好后生产 supervisor 接受 run_end 作来源并发出恢复',
    run: async () => {
      const root = hostWithCapabilityGap();
      try {
        const probe = await runGoalRuntimeChain(root, {
          freshEndPhase: 'coding',
          conditionWait: { maxWaitMs: 300, pollMs: 50 },
        });
        const runId = path.basename(probe.reportDir);
        const types = probe.events.map((e) => String(e.type));
        assert(types.includes('condition_wait_started') && types.includes('condition_wait_timeout'), `须先等再停：${types.join(',')}`);
        const halt = probe.events.find((e) => e.type === 'phase_halt' && e.halt_reason === 'await_human_capability_gap');
        assert(!!halt && types.indexOf('condition_wait_timeout') < types.indexOf('phase_halt'), '超时之后按现状停放');
        const end = [...probe.events].reverse().find((e) => e.type === 'run_end');
        assert(end?.status === 'HALTED', `run_end=${JSON.stringify(end)}`);
        assert(end?.run_disposition === 'WAITING' && end?.run_wait_kind === 'external', `run_end 处置=${JSON.stringify(end)}`);
        assert(end?.probe === 'capability_preflight_ready' && end?.probe_phase === 'coding',
          `run_end 须带探针与责任阶段：${JSON.stringify(end)}`);
        const state = reduceRunState(probe.events);
        assert(state.source_event_type === 'run_end', `来源事件应为 run_end：${JSON.stringify(state)}`);

        // 环境未修：真实探针未就绪 → supervisor 不拉起
        const before = await superviseOnce(root, runId, null);
        assert(before.code === 0 && before.spawned.length === 0, `探针未就绪不得拉起：${JSON.stringify(before)}`);
        // 人工 reprobe 修好 → 同一份真实探针转绿 → supervisor 发出恢复（同一 run）
        assert(resetCapabilityFailedByHumanReprobe(root, true), '夹具：人工 reprobe 须重置');
        const after = await superviseOnce(root, runId, null);
        assert(after.code === 0 && after.spawned.length === 1, `须发出恢复：${JSON.stringify(after)}`);
        const args = after.spawned[0];
        assert(args.includes('--resume') && args.includes(runId) && !args.includes('--supersede'),
          `须恢复同一 run：${args.join(' ')}`);
        assert(readRunEvents(root, runId).some((e) => e.type === 'supervisor_restart'), '须先落 supervisor_restart');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 A7 设备探针：设备门停放的完整事件流（含 run_end）经生产 supervisor 决策发出恢复',
    run: async () => {
      const { root } = setupGoalRuntimeHost();
      try {
        const probe = await runGoalRuntimeChain(root, {
          freshEndPhase: 'ut',
          // 设备门桩按生产 runDeviceReadinessGate 的 BLOCKED 字面形状发事件、回 outcome（含 probe）
          deviceGate: (o: { phase: string; retries: number; emitEvent: (e: Record<string, unknown>) => void }) => {
            o.emitEvent({
              type: 'phase_halt', phase: o.phase, halt_reason: 'device_not_ready', verdict: 'FAIL',
              reason: '注入：设备锁屏', probe: 'device_readiness', notes: [],
            });
            return {
              outcome: {
                phase: o.phase, verdict: 'FAIL', halted: false, retries: o.retries,
                halt_reason: 'device_not_ready', halt_guidance: '注入：设备锁屏',
                blocking_class: 'externalBlocked', failure_kind: 'device_blocked', probe: 'device_readiness',
              },
              notes: [],
            };
          },
          conditionWait: { maxWaitMs: 200, pollMs: 50, runProbe: () => ({ ready: false, reason: '测试不接真机' }) },
        });
        const runId = path.basename(probe.reportDir);
        const types = probe.events.map((e) => String(e.type));
        assert(types.includes('condition_wait_timeout'), `设备停机前须先等：${types.join(',')}`);
        const end = [...probe.events].reverse().find((e) => e.type === 'run_end');
        assert(!!end && typeof end.status === 'string', `须有 run_end：${JSON.stringify(end)}`);
        const state = reduceRunState(probe.events);
        assert(state.run_disposition === 'WAITING' && state.run_wait_kind === 'external', `投影=${JSON.stringify(state)}`);
        const notReady = await superviseOnce(root, runId, () => ({ ready: false }));
        assert(notReady.spawned.length === 0, '探针未就绪不拉起');
        const ready = await superviseOnce(root, runId, (p) => ({ ready: p === 'device_readiness' }));
        assert(ready.spawned.length === 1 && ready.spawned[0].includes('--resume') && ready.spawned[0].includes(runId),
          `设备探针转绿须发出恢复：${JSON.stringify(ready)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'plan 9c3d7e1a t6（codex 第三轮）supervisor 写事件与拉起在 feature 锁内：锁被持有 → 本轮不写、不拉起；退避在锁外睡，睡完锁内重判，期间重启序号已变 → 让给下一轮',
    run: async () => {
      const { root } = setupGoalRuntimeHost();
      try {
        const probe = await runGoalRuntimeChain(root, {
          freshEndPhase: 'ut',
          deviceGate: (o: { phase: string; retries: number; emitEvent: (e: Record<string, unknown>) => void }) => {
            o.emitEvent({
              type: 'phase_halt', phase: o.phase, halt_reason: 'device_not_ready', verdict: 'FAIL',
              reason: '注入：设备锁屏', probe: 'device_readiness', notes: [],
            });
            return {
              outcome: {
                phase: o.phase, verdict: 'FAIL', halted: false, retries: o.retries,
                halt_reason: 'device_not_ready', halt_guidance: '注入：设备锁屏',
                blocking_class: 'externalBlocked', failure_kind: 'device_blocked', probe: 'device_readiness',
              },
              notes: [],
            };
          },
          conditionWait: { maxWaitMs: 200, pollMs: 50, runProbe: () => ({ ready: false, reason: '测试不接真机' }) },
        });
        const runId = path.basename(probe.reportDir);
        const eventsPath = path.join(goalRunsDir(root), runId, 'events.jsonl');
        const ready = (p: string): { ready: boolean } => ({ ready: p === 'device_readiness' });
        const restartSeqs = (): unknown[] => readRunEvents(root, runId).filter((e) => e.type === 'supervisor_restart').map((e) => e.restart_seq);

        // 锁被持有（run 在跑、或同蓝图的设计修复进行中）：探针已就绪也不写、不拉起
        const lockPath = path.join(goalRunsDir(root), FEATURE_LOCK_NAME);
        const held = tryAcquireLock(lockPath, {});
        assert(held, '夹具：feature 锁可取');
        const bytes = fs.readFileSync(eventsPath);
        let busy: Awaited<ReturnType<typeof superviseOnce>>;
        try {
          busy = await superviseOnce(root, runId, ready);
        } finally {
          releaseLock(lockPath, held!.ownerId);
        }
        assert(busy.code === 0 && busy.spawned.length === 0 && fs.readFileSync(eventsPath).equals(bytes),
          `锁被持有时不得写事件、不得拉起：${JSON.stringify(busy)}`);

        // 锁放了：第 1 次拉起（不退避）；拉起时锁已放（子进程自己取锁），之后也不留锁
        const first = await superviseOnce(root, runId, ready);
        assert(first.spawned.length === 1 && first.lockHeldAtSpawn.every((h) => !h) && !fs.existsSync(lockPath),
          `放锁后再拉起且不留锁：${JSON.stringify(first)}`);
        assert(JSON.stringify(restartSeqs()) === '[1]', `重启记账：${JSON.stringify(restartSeqs())}`);

        // 第 2 次要退避 30s（锁外睡）；睡的期间另一轮 supervisor 已记下第 2 次 → 锁内重判序号变了 → 本轮不拉起、不重复记账
        const other = setTimeout(() => {
          fs.appendFileSync(eventsPath, `${JSON.stringify({ ts: new Date().toISOString(), type: 'supervisor_restart', action: 'resume', run_id: runId, restart_seq: 2 })}\n`);
        }, 1_000);
        let second: Awaited<ReturnType<typeof superviseOnce>>;
        try {
          second = await superviseOnce(root, runId, ready);
        } finally {
          clearTimeout(other);
        }
        assert(second.code === 0 && second.spawned.length === 0, `退避期间序号已变不得再拉起：${JSON.stringify(second)}`);
        assert(JSON.stringify(restartSeqs()) === '[1,2]', `不得重复记账：${JSON.stringify(restartSeqs())}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
);

export async function runAll(): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
  const out = cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
  for (const testCase of asyncCases) {
    try {
      await testCase.run();
      out.push({ name: testCase.name, ok: true });
    } catch (error) {
      out.push({ name: testCase.name, ok: false, error: (error as Error).stack ?? (error as Error).message });
    }
  }
  return out;
}
