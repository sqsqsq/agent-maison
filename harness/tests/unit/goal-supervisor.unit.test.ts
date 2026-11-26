import { beginUnitCase, discoveryResult } from '../utils/unit-cases';
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
  schedulerSupport,
  superviseRun,
} from '../../scripts/utils/goal-supervisor';
import { reduceRunState } from '../../scripts/utils/run-state-reducer';
import { waitForConditionRecovery } from '../../scripts/utils/condition-wait';
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
  { name: '当前恢复资格仅据真实条件：历史次数无上限、原启动未交回与重复实际异常等待', run: () => {
    const ready = eventsWith('RESUME_READY');
    for (const n of [0, 300]) {
      const d = decideSupervision({ events: ready, restartsSoFar: n, beaconStale: true });
      assert(d.action === 'resume' && d.restart_seq === n + 1 && d.backoff_ms === 0, JSON.stringify(d));
    }
    const pending = [...ready, { type: 'supervisor_restart' }];
    assert(decideSupervision({ events: pending, restartsSoFar: 1, beaconStale: true }).action === 'no_op', '原启动未实际交回不重发');
    const repeated = [...ready, { type: 'run_end', reason: 'uncaught_exception', error: 'actual broken launcher' },
      { type: 'supervisor_restart' }, { type: 'run_start' },
      { type: 'run_end', reason: 'uncaught_exception', error: 'actual broken launcher', run_disposition: 'RESUME_READY' }];
    assert(decideSupervision({ events: repeated, restartsSoFar: 1, beaconStale: true }).action === 'no_op', '同一实际异常等待执行能力恢复');
    assert(decideSupervision({ events: repeated, restartsSoFar: 1, beaconStale: true,
      condition: { probe: 'original_execution', ready: true } }).action === 'resume', '真实恢复条件不因历史异常卡死');
  } },
  { name: '86c4d5be supervisor uses completed returns after restart instead of exception wording or duplicate receipts', run: () => {
    const oldCall = [{ type: 'agent_invoke_start', invoke_id: 'old' }, { type: 'agent_invoke_end', invoke_id: 'old', exit_code: 0 }];
    const base = [...eventsWith('RESUME_READY'), ...oldCall, { type: 'supervisor_restart' }, { type: 'run_start' }];
    const crash = { type: 'run_end', reason: 'uncaught_exception', error: 'check-i2/report.json: actual failure', run_disposition: 'RESUME_READY' };
    const decide = (middle: object[]) => decideSupervision({ events: [...base, ...middle, crash], restartsSoFar: 1, beaconStale: true }).action;
    for (const middle of [[], [{ type: 'agent_invoke_end', invoke_id: 'old', exit_code: 0 }],
      [{ type: 'agent_invoke_start', invoke_id: 'new' }],
      ...[{ timed_out: true }, { status: 'waiting' }, { skipped: true }, { interrupted: true }].map(facts => [
        { type: 'agent_invoke_start', invoke_id: 'new' }, { type: 'agent_invoke_end', invoke_id: 'new', exit_code: 0, ...facts }]),
      [{ type: 'harness_start', invoke_id: 'check' }, { type: 'harness_end', invoke_id: 'check', exit_code: 1, timed_out: true }],
      [{ type: 'agent_invoke_end', invoke_id: 'unknown-end', exit_code: 0 }]]) {
      assert(decide(middle) === 'no_op', JSON.stringify(middle));
    }
    assert(decide([{ type: 'agent_invoke_start', invoke_id: 'new' }, { type: 'agent_invoke_end', invoke_id: 'new', exit_code: 0 }]) === 'resume', 'a real author return advances execution without claiming improvement');
    assert(decide([{ type: 'harness_start', invoke_id: 'check' }, { type: 'harness_end', invoke_id: 'check', exit_code: 1 }]) === 'resume', 'a completed negative check is still a real return');
    for (const error of ['check-i1/report.json: actual failure', 'check-i2/report.json: actual failure']) {
      assert(decideSupervision({ events: [...base, { ...crash, error }], restartsSoFar: 1, beaconStale: true }).action === 'no_op', error);
    }
  } },
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
      const importBlock = src.slice(0, src.indexOf('export type SupervisorDecision'));
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
        restartsSoFar: 300,
        beaconStale: true,
      });
      assert(exhausted.action === 'resume', '历史重启统计不构成配额；当前实际条件决定恢复');
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
        events: withProbe, restartsSoFar: 300, beaconStale: true,
        condition: { probe: 'capability_preflight_ready', ready: true },
      }).action === 'resume', '真实条件已就绪不受历史次数限制');
      assert(decideSupervision({
        events: [...withProbe, { type: 'supervisor_restart', action: 'resume' }], restartsSoFar: 1, beaconStale: true,
        condition: { probe: 'capability_preflight_ready', ready: true },
      }).action === 'no_op', '探针仍ready不构成第二次启动；原启动未交回必须保留原请求');
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

asyncCases.push(
  {
    name: 'P3 R2 等待函数：到上限后不再探测、不再重查；重查拿到的是剩余额度',
    run: async () => {
      const probeAt: number[] = [];
      const recheckBudgets: number[] = [];
      const originalNow = Date.now, originalTimeout = global.setTimeout;
      let clock = 1_000, startedAt = clock;
      const advances = [55, 46, 48, 1];
      const events: Array<Record<string, unknown>> = [];
      try {
        Date.now = () => clock;
        // Model delayed wakeups without racing the caller's earlier timestamp against the function's deadline.
        global.setTimeout = ((callback: () => void, delay = 0) => {
          clock += advances.shift() ?? delay;
          queueMicrotask(callback);
        }) as unknown as typeof setTimeout;
        const ok = await waitForConditionRecovery({
          phase: 'ut', probe: 'device_readiness', blockedBy: 'device_not_ready',
          availableMs: 150, maxWaitMs: 5_000, pollMs: 40,
          runProbe: () => { probeAt.push(clock - startedAt); return { ready: true }; },
          recheck: async (remainingMs) => { recheckBudgets.push(remainingMs); return false; },
          emit: event => { events.push(event); if (event.type === 'condition_wait_started') startedAt = clock; },
        });
        assert(ok === false && clock - startedAt === 150, '一直未恢复应在真实截止收尾');
        assert(probeAt.length === 4 && probeAt.every(ms => ms < 150), `到上限后不得再探测：${JSON.stringify(probeAt)}`);
        assert(JSON.stringify(recheckBudgets) === '[150,95,49,1]', `重查拿到的须是正剩余额度：${JSON.stringify(recheckBudgets)}`);
        assert(events.map(event => event.type).join(',') === 'condition_wait_started,condition_wait_timeout', JSON.stringify(events));

        let lateProbes = 0, lateRechecks = 0;
        const expired = await waitForConditionRecovery({
          phase: 'ut', probe: 'device_readiness', blockedBy: 'device_not_ready',
          availableMs: 150, maxWaitMs: 5_000, pollMs: 40,
          runProbe: () => { lateProbes++; return { ready: true }; },
          recheck: async () => { lateRechecks++; return true; },
          emit: event => { if (event.type === 'condition_wait_started') clock += 150; },
        });
        assert(expired === false && lateProbes === 0 && lateRechecks === 0,
          '开始事件同步耗尽额度后，不得发起首探或重查');
      } finally { Date.now = originalNow; global.setTimeout = originalTimeout; }
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
    name: 'condition wait: abort during polling stops before another probe or recheck without a false timeout',
    run: async () => {
      const controller = new AbortController();
      const events: Array<Record<string, unknown>> = [];
      let probes = 0, rechecks = 0;
      let abortTimer: ReturnType<typeof setTimeout> | undefined;
      const started = Date.now();
      try {
        const recovered = await waitForConditionRecovery({ phase: 'ut', probe: 'device_readiness', blockedBy: 'device_not_ready',
          availableMs: 60_000, maxWaitMs: 60_000, pollMs: 30_000, signal: controller.signal,
          runProbe: () => { probes++; abortTimer = setTimeout(() => controller.abort(), 10); return { ready: false }; },
          recheck: async () => { rechecks++; return true; }, emit: event => events.push(event),
        });
        assert(!recovered && Date.now() - started < 5_000, 'abort must end the pending poll without waiting for its interval');
        assert(probes === 1 && rechecks === 0, 'abort must not launch another probe or original check');
        assert(events.map(event => event.type).join(',') === 'condition_wait_started', 'cancellation is neither readiness nor a timeout');
      } finally { if (abortTimer !== undefined) clearTimeout(abortTimer); }
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
);

export async function runAll(): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
  const out = cases.map((testCase) => {
    const endUnitCase = beginUnitCase(testCase.name);
    if (!endUnitCase) return discoveryResult(testCase.name);
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    } finally { endUnitCase(); }
  });
  for (const testCase of asyncCases) {
    const endUnitCase = beginUnitCase(testCase.name);
    if (!endUnitCase) continue;
    try {
      await testCase.run();
      out.push({ name: testCase.name, ok: true });
    } catch (error) {
      out.push({ name: testCase.name, ok: false, error: (error as Error).stack ?? (error as Error).message });
    } finally { endUnitCase(); }
  }
  return out;
}
