// goal-runner-hardening.unit.test.ts — P0/P1/P2 guards, locks, budget, resume

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkTerminalResumeGuard,
  countAgentInvokeStarts,
  resolvePhaseHarnessVerdict,
  resolveResumedBudget,
  collectSupersededAncestorEvents,
  extractSupersedeTargets,
  foldBudgetLineage,
  resolveWallClockStartMs,
} from '../../scripts/utils/goal-runner-phase';
import { isGoalHeadlessEnv, MAISON_GOAL_HEADLESS_ENV } from '../../scripts/utils/phase-state';
import {
  FEATURE_LOCK_NAME,
  formatLockBlocker,
  isLockStale,
  isPidAlive,
  readLockRecord,
  releaseLock,
  tryAcquireLock,
} from '../../scripts/utils/goal-run-lock';
import {
  applyManifestCliOverrides,
  validateManifestCliOverrides,
} from '../../scripts/utils/goal-manifest-cli';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import { killProcessTree } from '../../scripts/utils/agent-invoke';
import {
  isBudgetOnlyIdentityChange,
  resolveManifestDriftDecision,
  buildBacktrackTargetAbsentGuidance,
} from '../../scripts/goal-runner';
import type { UnitCaseResult } from '../run-unit';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'isGoalHeadlessEnv: only MAISON_GOAL_HEADLESS',
    run: () => {
      const prev = process.env[MAISON_GOAL_HEADLESS_ENV];
      const prevRunner = process.env.MAISON_GOAL_RUNNER;
      try {
        delete process.env[MAISON_GOAL_HEADLESS_ENV];
        process.env.MAISON_GOAL_RUNNER = '1';
        assert(!isGoalHeadlessEnv(), 'runner alone not headless');
        process.env[MAISON_GOAL_HEADLESS_ENV] = '1';
        assert(isGoalHeadlessEnv(), 'headless set');
      } finally {
        if (prev === undefined) delete process.env[MAISON_GOAL_HEADLESS_ENV];
        else process.env[MAISON_GOAL_HEADLESS_ENV] = prev;
        if (prevRunner === undefined) delete process.env.MAISON_GOAL_RUNNER;
        else process.env.MAISON_GOAL_RUNNER = prevRunner;
      }
    },
  },
  {
    name: 'resolvePhaseHarnessVerdict: fresh PASS + agent exit non-zero → PASS (gate on summary)',
    run: () => {
      const r = resolvePhaseHarnessVerdict({
        dryRun: false,
        agentExitCode: 1,
        harnessExitCode: 0,
        summaryBeforeMtime: 1000,
        summaryAfterMtime: 2000,
        summaryVerdict: 'PASS',
      });
      assert(r.verdict === 'PASS', r.verdict);
      assert(!r.stale_summary, 'fresh');
      assert(r.agent_failed, 'agent_failed observability');
    },
  },
  {
    name: 'resolvePhaseHarnessVerdict: stale PASS + agent exit → FAIL',
    run: () => {
      const r = resolvePhaseHarnessVerdict({
        dryRun: false,
        agentExitCode: 1,
        harnessExitCode: 0,
        summaryBeforeMtime: 2000,
        summaryAfterMtime: 2000,
        summaryVerdict: 'PASS',
      });
      assert(r.verdict === 'FAIL', r.verdict);
      assert(r.stale_summary, 'stale');
    },
  },
  {
    name: 'countAgentInvokeStarts: legacy agent_invoke + new start/end',
    run: () => {
      const n = countAgentInvokeStarts([
        { type: 'agent_invoke', phase: 'spec' },
        { type: 'agent_invoke_start', phase: 'plan' },
        { type: 'agent_invoke_end', phase: 'plan' },
        { type: 'agent_invoke_start', phase: 'coding' },
      ]);
      assert(n === 3, String(n));
    },
  },
  {
    name: 'resolveResumedBudget: wall clock from first run_start',
    run: () => {
      const events = [
        { type: 'run_start', ts: '2026-06-09T13:12:25.820Z' },
        { type: 'agent_invoke', phase: 'spec' },
        { type: 'run_start', ts: '2026-06-09T15:27:45.736Z' },
      ];
      const b = resolveResumedBudget(events);
      assert(b.totalTurns === 1, String(b.totalTurns));
      assert(
        b.wallClockStartMs === new Date('2026-06-09T13:12:25.820Z').getTime(),
        String(b.wallClockStartMs),
      );
    },
  },
  {
    name: 'T1④ 预算折叠：沿 supersede 链递归收祖先 events（turns/backtracks 求和、防环、缺失容忍、ts 升序）',
    run: () => {
      // 内存夹具注入 loadEvents——按 run 目录名路由（不真读盘）
      const store: Record<string, Array<Record<string, unknown>>> = {
        'run-A': [
          { type: 'run_start', ts: '2026-08-01T00:00:00.000Z' },
          { type: 'agent_invoke', phase: 'spec', ts: '2026-08-01T00:01:00.000Z' },
          { type: 'phase_backtrack_requested', ts: '2026-08-01T00:02:00.000Z' },
          // 链式：A supersede 更早的 Z；含环引用 B（防环须不炸）
          { type: 'supersede', target_run_id: 'run-Z', ts: '2026-08-01T00:03:00.000Z' },
          { type: 'supersede', target_run_id: 'run-B', ts: '2026-08-01T00:03:01.000Z' },
        ],
        'run-Z': [
          { type: 'run_start', ts: '2026-07-31T00:00:00.000Z' },
          { type: 'agent_invoke', phase: 'spec', ts: '2026-07-31T00:01:00.000Z' },
          { type: 'phase_backtrack_requested', ts: '2026-07-31T00:02:00.000Z' },
          { type: 'supersede', target_run_id: 'run-A', ts: '2026-07-31T00:03:00.000Z' }, // 环
        ],
        // run-B 无 events（被清理的历史 run）——缺失容忍：跳过不炸
      };
      const folded = collectSupersededAncestorEvents({
        projectRoot: '/x', featuresDir: 'doc/features', feature: 'f',
        seedTargets: ['run-A'],
        loadEvents: (abs) => {
          const m = abs.replace(/\\/g, '/').match(/goal-runs\/([^/]+)\/events\.jsonl$/);
          return (m && store[m[1]] ? store[m[1]] : []) as never;
        },
      });
      // 祖先 A+Z 全收（B 缺失跳过、环不重复）
      const bt = folded.filter(e => (e as { type?: string }).type === 'phase_backtrack_requested').length;
      assert(bt === 2, `祖先回退计数应折叠求和（A+Z=2），实得 ${bt}`);
      // ts 升序：最早的 run-Z 事件在前 → wall 起点=祖先最早 run_start
      const b = resolveResumedBudget(folded as never);
      assert(b.wallClockStartMs === new Date('2026-07-31T00:00:00.000Z').getTime(),
        `wall 起点应为祖先最早 run_start，实得 ${b.wallClockStartMs}`);
      assert(b.totalTurns === 2, `turns 应折叠求和（A+Z 各 1），实得 ${b.totalTurns}`);
      // 变异靶：extractSupersedeTargets 只认 audited supersede 事件
      const targets = extractSupersedeTargets(store['run-A'] as never);
      assert(targets.join(',') === 'run-Z,run-B', `直接目标提取：${targets.join(',')}`);
    },
  },
  {
    name: 'e9d4b7a3 t4: foldBudgetLineage 唯一共享入口——显式种子 ∪ events 派生种子；空种子=当前 run 事件恒等',
    run: () => {
      const store: Record<string, Array<Record<string, unknown>>> = {
        'anc-1': [
          { type: 'run_start', ts: '2026-08-01T00:00:00.000Z' },
          { type: 'agent_invoke', phase: 'spec', ts: '2026-08-01T00:01:00.000Z' },
          { type: 'agent_invoke', phase: 'plan', ts: '2026-08-01T00:02:00.000Z' },
        ],
        'anc-2': [
          { type: 'run_start', ts: '2026-08-02T00:00:00.000Z' },
          { type: 'agent_invoke', phase: 'coding', ts: '2026-08-02T00:01:00.000Z' },
          { type: 'agent_invoke', phase: 'review', ts: '2026-08-02T00:02:00.000Z' },
        ],
      };
      const current = [
        { type: 'run_start', ts: '2026-08-03T00:00:00.000Z' },
        { type: 'agent_invoke', phase: 'spec', ts: '2026-08-03T00:01:00.000Z' },
        { type: 'agent_invoke', phase: 'plan', ts: '2026-08-03T00:01:30.000Z' },
        { type: 'agent_invoke', phase: 'review', ts: '2026-08-03T00:02:00.000Z' },
      ];
      const loadEvents = (abs: string) => {
        const m = abs.replace(/\\/g, '/').match(/goal-runs\/([^/]+)\/events\.jsonl$/);
        return (m && store[m[1]] ? store[m[1]] : []) as never;
      };
      // ① 显式 CLI 种子（fresh --supersede 路径）∪ 事件派生（resume 路径）
      const explicit = foldBudgetLineage({
        projectRoot: '/x', featuresDir: 'doc/features', feature: 'f',
        seedTargets: ['anc-1'], currentEvents: current, loadEvents,
      });
      assert(explicit.foldSeeds.join(',') === 'anc-1', `foldSeeds=${explicit.foldSeeds.join(',')}`);
      assert(
        explicit.budgetFoldEvents.filter(e => (e as { type?: string }).type === 'agent_invoke').length === 5,
        '显式种子折叠：anc-1(2) + current(3) 共 5 个 invoke',
      );
      const acgResume = [
        ...current,
        { type: 'supersede', target_run_id: 'anc-2', ts: '2026-08-03T00:03:00.000Z' },
      ];
      const fromEvents = foldBudgetLineage({
        projectRoot: '/x', featuresDir: 'doc/features', feature: 'f',
        currentEvents: acgResume, loadEvents,
      });
      assert(fromEvents.foldSeeds.join(',') === 'anc-2', `事件派生种子：${fromEvents.foldSeeds.join(',')}`);
      assert(
        fromEvents.budgetFoldEvents.filter(e => (e as { type?: string }).type === 'agent_invoke').length === 5,
        '事件派生种子折叠：anc-2(2) + current(3) 共 5 个 invoke',
      );
      // ② 双源合并（CLI 种子 + 事件种子）
      const dual = foldBudgetLineage({
        projectRoot: '/x', featuresDir: 'doc/features', feature: 'f',
        seedTargets: ['anc-1'], currentEvents: acgResume, loadEvents,
      });
      assert(dual.foldSeeds.join(',') === 'anc-1,anc-2', `双源种子：${dual.foldSeeds.join(',')}`);
      assert(
        dual.budgetFoldEvents.filter(e => (e as { type?: string }).type === 'agent_invoke').length === 7,
        '双源折叠：anc-1(2)+anc-2(2)+current(3)=7',
      );
      // ③ 无种子（普通 progress/heartbeat 视图）→ 恒等于当前 run 事件
      const empty = foldBudgetLineage({
        projectRoot: '/x', featuresDir: 'doc/features', feature: 'f',
        currentEvents: current, loadEvents,
      });
      assert(empty.foldSeeds.length === 0 && empty.ancestorEvents.length === 0, '空种子无祖先');
      assert(empty.budgetFoldEvents.length === current.length, '空种子时 budgetFoldEvents 与当前 run 等长');
      assert(JSON.stringify(empty.budgetFoldEvents) === JSON.stringify(current), '空种子时 budgetFoldEvents 即当前 run 内容');
      const b = resolveResumedBudget(empty.budgetFoldEvents as never);
      assert(b.totalTurns === 3, `无折叠 turns=${b.totalTurns}`);
    },
  },
  {
    name: 'e9d4b7a3 t5: resolveManifestDriftDecision 全分支顶层 changedFields——budget-only 授权得 [budget]；无漂移恒空数组',
    run: () => {
      const birth = {
        requirement: 'req1', budget: 'budget-a', feature: 'f',
      };
      const withBudget = {
        ...birth, budget: 'budget-b',
      };
      const dr = {
        currentFields: withBudget,
        currentHash: 'h2',
        birthFields: birth,
        overrides: { 'override-manifest': true, 'override-start': false, 'override-end': false },
        fidelityTransitionFields: new Set<string>(),
      };
      const authorized = resolveManifestDriftDecision(dr);
      assert(authorized.rebaseApplied === true, 'override-manifest 授权须 rebase');
      assert(authorized.changedFields.join(',') === 'budget', `budget-only changedFields=${authorized.changedFields.join(',')}`);
      assert(isBudgetOnlyIdentityChange(authorized.changedFields), '预算独变须命中 budget-only 判据');

      // 无漂移：稳定空数组（不得 undefined/null）
      const noneDrift = resolveManifestDriftDecision({
        ...dr, currentFields: birth, currentHash: 'h1',
      });
      assert(noneDrift.rebaseApplied === false && noneDrift.halt === null, '无漂移不得 rebase/halt');
      assert(Array.isArray(noneDrift.changedFields) && noneDrift.changedFields.length === 0,
        `无漂移 changedFields 须为稳定空数组（实得 ${JSON.stringify(noneDrift.changedFields)}）`);
      assert(!isBudgetOnlyIdentityChange(noneDrift.changedFields), '空变更不算 budget-only');

      // 无基线：同样稳定空数组
      const noBaseline = resolveManifestDriftDecision({ ...dr, birthFields: null });
      assert(Array.isArray(noBaseline.changedFields) && noBaseline.changedFields.length === 0,
        '无基线分支 changedFields 须为空数组');

      // 未授权漂移：顶层 changedFields 与 halt.changedFields 一致
      const unauthorized = resolveManifestDriftDecision({
        ...dr,
        overrides: { 'override-manifest': false, 'override-start': false, 'override-end': false },
      });
      assert(unauthorized.halt !== null, '未授权须 halt');
      assert(
        unauthorized.changedFields.join(',') === unauthorized.halt!.changedFields.join(','),
        '顶层与 halt 内 changedFields 一致',
      );
      assert(unauthorized.changedFields.join(',') === 'budget', `未授权分支顶层 changedFields=${unauthorized.changedFields.join(',')}`);

      // 非 budget-only（字段混变）不得命中 budget-only 判据
      assert(!isBudgetOnlyIdentityChange(['budget', 'requirement']), '混合变更不算 budget-only');
      assert(!isBudgetOnlyIdentityChange([]), '空变更不算 budget-only');
    },
  },
  {
    name: 'resolveWallClockStartMs: falls back to now when no run_start',
    run: () => {
      const before = Date.now();
      const ms = resolveWallClockStartMs([]);
      assert(ms >= before && ms <= Date.now() + 5, String(ms));
    },
  },
  {
    name: 'checkTerminalResumeGuard: recent COMPLETED allows resume',
    run: () => {
      const recent = Date.now() - 60 * 1000;
      const r = checkTerminalResumeGuard({
        priorStatus: 'COMPLETED',
        lastRunEndTs: new Date(recent).toISOString(),
        cooldownMinutes: 5,
      });
      assert(r.allowed, 'non-terminal not debounced');
    },
  },
  {
    name: 'checkTerminalResumeGuard: DEFERRED refuses without force',
    run: () => {
      const old = Date.now() - 10 * 60 * 1000;
      const r = checkTerminalResumeGuard({
        priorStatus: 'DEFERRED',
        lastRunEndTs: new Date(old).toISOString(),
        forceResume: false,
        cooldownMinutes: 5,
      });
      assert(!r.allowed, 'blocked');
      assert(Boolean(r.reason?.includes('DEFERRED')), r.reason ?? 'no reason');
    },
  },
  {
    name: 'checkTerminalResumeGuard: --force-resume allows after cooldown',
    run: () => {
      const old = Date.now() - 10 * 60 * 1000;
      const r = checkTerminalResumeGuard({
        priorStatus: 'HALTED',
        lastRunEndTs: new Date(old).toISOString(),
        forceResume: true,
        cooldownMinutes: 5,
      });
      assert(r.allowed, 'allowed');
    },
  },
  {
    name: 'checkTerminalResumeGuard: --force-resume still blocked during cooldown',
    run: () => {
      const recent = Date.now() - 60 * 1000;
      const r = checkTerminalResumeGuard({
        priorStatus: 'HALTED',
        lastRunEndTs: new Date(recent).toISOString(),
        forceResume: true,
        cooldownMinutes: 5,
      });
      assert(!r.allowed, 'cooldown blocks force');
      assert(Boolean(r.reason?.includes('cooldown')), r.reason ?? 'no reason');
    },
  },
  {
    name: 'e9d4b7a3 t1（review1）：backtrack_target_absent 指引三处可见——builder 文案要素 + 事件/outcome 接线（b3f7d9a2 硬学习）',
    run: () => {
      const guidance = buildBacktrackTargetAbsentGuidance('coding');
      assert(guidance.includes('--supersede'), '须含 --supersede 交接路径');
      assert(guidance.includes('--requirement-file'), '须用 --requirement-file 携带增量');
      assert(guidance.includes('任务点名'), '增量须含任务点名');
      assert(guidance.includes('关键证据摘要'), '增量须含关键证据摘要');
      assert(guidance.includes('coding'), `须带 recommendation.phase：${guidance}`);
      // 三处可见接线（b3f7d9a2 硬学习：同一文案契约枚举全部承载处）——
      // ① phase_halt 事件 halt_guidance；② outcome halt_guidance；
      // ③ console banner。detach 停机后宿主只读 events/goal-report，console 早滚走。
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'goal-runner.ts'), 'utf-8');
      const snippet = '...(backtrackHaltGuidance ? { halt_guidance: backtrackHaltGuidance } : {})';
      const emitIdx = src.indexOf(snippet);
      const outcomeIdx = src.indexOf(snippet, emitIdx + 1);
      const consoleIdx = src.indexOf('===== ${haltReason} =====');
      assert(emitIdx >= 0, 'phase_halt 事件须带 halt_guidance（backtrack 家族分支）');
      assert(outcomeIdx >= 0 && outcomeIdx > emitIdx, '结局 outcome 须带 halt_guidance（与事件同源）');
      assert(consoleIdx >= 0, 'console banner 路径保留');
      assert(src.includes('buildBacktrackTargetAbsentGuidance'), '三处文案须出自同一 builder（单点生成）');
      assert(src.indexOf('buildBacktrackTargetAbsentGuidance') < src.indexOf(snippet),
        'builder 调用须早于事件 emit（同一文案单点生成后分发）');
    },
  },
  {
    name: 'feature lock: atomic acquire + owner release',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-lock-'));
      const lockPath = path.join(dir, FEATURE_LOCK_NAME);
      const a = tryAcquireLock(lockPath, { run_id: 'run-a' });
      assert(a !== null, 'acquire a');
      const b = tryAcquireLock(lockPath, { run_id: 'run-b' });
      assert(b === null, 'blocked b');
      releaseLock(lockPath, a!.ownerId);
      const c = tryAcquireLock(lockPath, { run_id: 'run-c' });
      assert(c !== null, 'acquire c after release');
      releaseLock(lockPath, c!.ownerId);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'isLockStale: same-host dead pid immediately stale',
    run: () => {
      const record = {
        ownerId: 'x',
        pid: 999999999,
        hostname: os.hostname(),
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      assert(isLockStale(record, 90 * 60 * 1000), 'dead pid stale');
    },
  },
  {
    // plan e7c2a4d8 T1e（v21 收口）：同机活 pid 永不判 stale——暂停/挂起中的活 runner
    // 不得因 heartbeat 超时被抢占（busy + 人工处置）；旧「TTL 兜底抢占」语义废止。
    name: 'isLockStale: same-host alive pid + old heartbeat → NOT stale（busy 人工处置）',
    run: () => {
      const record = {
        ownerId: 'x',
        pid: process.pid,
        hostname: os.hostname(),
        started_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      };
      assert(!isLockStale(record, 1000), 'alive pid must never be preempted on heartbeat timeout');
    },
  },
  {
    name: 'isLockStale: cross-host fresh lock not stale until TTL',
    run: () => {
      const record = {
        ownerId: 'x',
        pid: 999999999,
        hostname: 'remote-host-not-local',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      assert(!isLockStale(record, 90 * 60 * 1000), 'cross-host fresh');
    },
  },
  {
    name: 'isLockStale: dead pid + old heartbeat',
    run: () => {
      const record = {
        ownerId: 'x',
        pid: 999999999,
        hostname: 'test',
        started_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      };
      assert(isLockStale(record, 1000), 'stale');
      assert(!isPidAlive(999999999), 'pid dead');
    },
  },
  {
    name: 'tryAcquireLock: corrupt JSON lock is removed and re-acquired',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-lock-'));
      const lockPath = path.join(dir, FEATURE_LOCK_NAME);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(lockPath, '{not-json', 'utf-8');
      const rec = tryAcquireLock(lockPath, { run_id: 'after-corrupt' });
      assert(rec !== null, 'acquired after corrupt');
      releaseLock(lockPath, rec!.ownerId);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'formatLockBlocker: null holder message',
    run: () => {
      const msg = formatLockBlocker('/tmp/.feature.lock', null);
      assert(msg.includes('holder unknown'), msg);
    },
  },
  {
    name: 'readLockRecord: round-trip JSON',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-lock-'));
      const lockPath = path.join(dir, FEATURE_LOCK_NAME);
      const rec = tryAcquireLock(lockPath, { run_id: 'r1' });
      assert(rec !== null, 'acquired');
      const read = readLockRecord(lockPath);
      assert(read?.ownerId === rec!.ownerId, 'owner');
      releaseLock(lockPath, rec!.ownerId);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'killProcessTree: invalid pid no-op',
    run: async () => {
      const r = await killProcessTree(0);
      assert(!r.kill_attempted, 'no kill');
    },
  },
  {
    // plan e6b3f8d2 t1：silent watchdog 生产链已删除（从未启用的第二判死权威）——
    // 回归改为**源码锚定**：写侧不得再出现常量/选项/定时器/kill reason 任何一处。
    name: 'silent watchdog 生产链已删除（写侧零残留；读侧字段保留供历史事件兼容）',
    run: () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../scripts/utils/agent-invoke.ts'),
        'utf-8',
      );
      assert(!/DEFAULT_SILENT_WATCHDOG_MS/.test(src), 'watchdog 常量仍在');
      assert(!/silentWatchdogMs/.test(src), 'silentWatchdogMs 选项仍在');
      assert(!/silentKilled/.test(src), 'silentKilled 写侧变量仍在');
      assert(!/killTree\('silent'\)/.test(src), "killTree('silent') 仍在");
      assert(/silent_killed\?: boolean;/.test(src), '读侧兼容字段不得一并删除');
    },
  },
  {
    name: 'validateManifestCliOverrides: --start without --override-start BLOCKER',
    run: () => {
      const r = validateManifestCliOverrides({
        manifest: 'm.yaml',
        start: 'coding',
        'override-end': true,
        end: 'testing',
      });
      assert(!r.ok, 'must fail');
      assert(r.ok === false && r.message.includes('--override-start'), r.ok ? '' : r.message);
    },
  },
  {
    name: 'validateManifestCliOverrides: paired overrides ok',
    run: () => {
      const r = validateManifestCliOverrides({
        manifest: 'm.yaml',
        start: 'coding',
        'override-start': true,
        end: 'testing',
        'override-end': true,
      });
      assert(r.ok, !r.ok ? r.message : 'ok');
    },
  },
  {
    name: 'applyManifestCliOverrides: only applies when flag paired',
    run: () => {
      const manifest = {
        start_phase: 'spec',
        end_phase: 'testing',
      } as GoalManifest;
      applyManifestCliOverrides(manifest, {
        start: 'coding',
        'override-end': true,
        end: 'ut',
      });
      assert(manifest.start_phase === 'spec', 'start not overridden without flag');
      assert(manifest.end_phase === 'ut', 'end overridden with flag');
    },
  },
  {
    name: 'goal-runner: runHarnessPhase uses async spawn + activeHarnessKill',
    run: () => {
      const src = fs.readFileSync(path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8');
      assert(src.includes('activeHarnessKill'), 'activeHarnessKill variable');
      assert(src.includes('async function runHarnessPhase'), 'async runHarnessPhase');
      assert(src.includes('killProcessTree'), 'killProcessTree import');
      assert(src.includes('createChildSettleWaiter'), 'createChildSettleWaiter import');
      assert(src.includes('spawn('), 'spawn for harness child');
      assert(!/async function runHarnessPhase[\s\S]*?spawnSync/.test(src), 'no spawnSync in runHarnessPhase');
    },
  },
  {
    // P0-4 复审修复回归（codex P0/cursor 阻断1）：harness kill 必须与 agent 路径同构——
    // arm force-settle 先于 killProcessTree，且 POSIX 下 detached 进程组。行为级契约
    // （armForceSettleAfterKill 在无 exit/close 时按时 resolve）由 agent-invoke-settle
    // 套件覆盖；此处钉死 harness 段的接线不回退（源结构断言，集成断言见 tasks 7.3b）。
    name: 'goal-runner: runHarnessPhase 超时路径 arm force-settle + detached（不挂死接线）',
    run: () => {
      const src = fs.readFileSync(path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8');
      const fn = /async function runHarnessPhase[\s\S]*?\n}/.exec(src)?.[0] ?? '';
      assert(fn.includes('settleWaiter.armForceSettleAfterKill()'), 'harness 超时须 arm force-settle（否则杀不掉时 promise 永久悬挂）');
      assert(
        /armForceSettleAfterKill\(\);[\s\S]{0,400}?void killProcessTree\(child\.pid\)/.test(fn),
        'timer 回调内 arm 须先于 kill（与 agent-invoke killTree 同构）',
      );
      assert(fn.includes("detached: process.platform !== 'win32'"), 'POSIX 须 detached（process.kill(-pid) 进程组前提）');
      assert(fn.includes('timedOut'), 'timedOut 结构化结果');
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  void runAll().then((results) => {
    const failed = results.filter((r) => !r.ok);
    for (const r of results) {
      console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
    }
    process.exit(failed.length > 0 ? 1 : 0);
  });
}
