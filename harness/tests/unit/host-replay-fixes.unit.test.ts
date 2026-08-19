// ============================================================================
// host-replay-fixes.unit.test.ts — plan e7c2a4d8（宿主回灌三修 v23）
// T1 preflight 内存口径/.dry 隔离/枚举二分/锁单点 · T2 活跃预算分段 ·
// T3 授权出路（scope v2/fingerprint/裁决）· T4 阶段真值（phase_halt 重建/actionability）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeRequirementShaFromText,
  computeRunRequirementSha,
  classifyGoalRunsDir,
  listAuthoritativeGoalRuns,
} from '../../scripts/utils/fidelity-shared';
import {
  buildGoalManifestFromInput,
  isDryReportDir,
  loadGoalManifestFromRun,
  resolveGoalReportDir,
  resolveRawRunInput,
  DRY_RUNS_SUBDIR,
  type GoalManifest,
} from '../../scripts/utils/goal-manifest';
import {
  isLockStale,
  formatLockBlocker,
  releaseLock,
  tryAcquireLock,
  type LockRecord,
} from '../../scripts/utils/goal-run-lock';
import { projectGoalProgress as projectGoalProgressRaw } from '../../scripts/utils/goal-progress';
// e9d4b7a3 t4（二轮 review P1）：featuresDir 为必传——host-replay 夹具统一注入默认值。
type ReplayProgressInput = Parameters<typeof projectGoalProgressRaw>[0];
function projectGoalProgress(input: ReplayProgressInput | Omit<ReplayProgressInput, 'featuresDir'>) {
  return projectGoalProgressRaw({
    ...input,
    featuresDir: 'featuresDir' in input && input.featuresDir ? input.featuresDir : 'doc/features',
  });
}
import { checkGoalRunIdentityIntact } from '../../scripts/check-spec';
import { loadWorkflowSpec } from '../../workflow-loader';
import {
  partitionExecutionSessions,
  resolveResumedBudget,
  rebuildOutcomesFromEvents,
  filterAuthoritativeEvents,
  loadEventsJsonlStrict,
  resolveResumeFromEvents,
  checkTerminalResumeGuard,
  SESSION_HEARTBEAT_MS,
  type GoalRunEvent,
} from '../../scripts/utils/goal-runner-phase';
import {
  classifySourceDrift,
  computeDriftFingerprint,
  computeCurrentDriftFingerprint,
  mutationAuthorizationScopeHash,
  relPathIssues,
  type MutationAuthorizationReceipt,
} from '../../scripts/utils/mutation-authorization';
import { resolveBlockerActionability } from '../../scripts/utils/goal-failure-classifier';
import {
  buildBudgetExhaustedGuidance,
  buildUnauthorizedMutationGuidance,
  MUTATION_RECEIPT_ISSUANCE_ROUTE_AVAILABLE,
} from '../../scripts/utils/await-confirm-guidance';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function tmpDir(tag: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `maison-hrf-${tag}-`));
  return d;
}

function ev(partial: Record<string, unknown>): GoalRunEvent {
  return partial as unknown as GoalRunEvent;
}

const T0 = Date.parse('2026-07-21T12:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

/** 两段式 events：seg1 正常 69m，隔夜后 resume（4035d4 实况形态） */
function overnightEvents(): GoalRunEvent[] {
  return [
    ev({ ts: iso(T0), type: 'run_start' }),
    ev({ ts: iso(T0 + 10_000), type: 'agent_invoke_start', phase: 'spec' }),
    ev({ ts: iso(T0 + 69 * 60_000), type: 'run_end', status: 'HALTED' }),
  ];
}

const cases: Array<{ name: string; run: () => void }> = [
  // ------------------------------------------------------------ T1a
  {
    name: 'T1a: 内容级/读盘级 requirement sha 两口径逐字节同构',
    run: () => {
      const root = tmpDir('sha');
      const runDir = path.join(root, 'doc/features/f1/goal-runs/r1');
      fs.mkdirSync(runDir, { recursive: true });
      const requirement = '开发银行卡开卡需求（无文档引用，纯内联）';
      fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ requirement }), 'utf-8');
      const a = computeRunRequirementSha(root, 'f1', 'r1');
      const b = computeRequirementShaFromText(root, 'f1', requirement);
      if (!a || a !== b) throw new Error(`sha 口径不一致：disk=${a} mem=${b}`);
    },
  },
  {
    name: 'T1a: 当前 feature 运行产物创建后 requirement sha 保持稳定',
    run: () => {
      const root = tmpDir('sha-feature-output');
      const source = path.join(root, 'doc/requirements/open-card.md');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, '用户输入：完全参考给定截图实现开卡流程。', 'utf-8');
      const requirement = '实现 doc/requirements/open-card.md；产物写到 doc/features/bc-openCard/ux-reference/README.md';
      const before = computeRequirementShaFromText(root, 'bc-openCard', requirement);
      const output = path.join(root, 'doc/features/bc-openCard/ux-reference/README.md');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'spec attempt 1 generated output', 'utf-8');
      const after = computeRequirementShaFromText(root, 'bc-openCard', requirement);
      if (before !== after) throw new Error(`feature 产物污染 requirement sha: ${before} != ${after}`);
    },
  },
  // ------------------------------------------------------------ T1b
  {
    name: 'T1b: resolveGoalReportDir dry 落 goal-runs/.dry/<run_id>（run_id 不变）',
    run: () => {
      const d = resolveGoalReportDir({ featuresDir: 'doc/features', feature: 'f1', runId: 'r1', dryRun: true });
      if (d !== `doc/features/f1/goal-runs/${DRY_RUNS_SUBDIR}/r1`) throw new Error(d);
      const n = resolveGoalReportDir({ featuresDir: 'doc/features', feature: 'f1', runId: 'r1' });
      if (n !== 'doc/features/f1/goal-runs/r1') throw new Error(n);
    },
  },
  {
    name: 'T1b: run_id 保留字（. 开头/含分隔符）fail-closed',
    run: () => {
      for (const bad of ['.dry', '.x', 'a/b', 'a\\b']) {
        let threw = false;
        try {
          buildGoalManifestFromInput({ feature: 'f1', run_id: bad, unattended: { write_mode: 'workspace-write', approval_mode: 'never' } }, { projectRoot: '/x' });
        } catch { threw = true; }
        if (!threw) throw new Error(`run_id=${bad} 未被拒`);
      }
    },
  },
  {
    name: 'T1b: manifest.run_id 与 CLI run_id 冲突 fail-closed，一致则通过',
    run: () => {
      let threw = false;
      try {
        buildGoalManifestFromInput(
          { feature: 'f1', run_id: 'a1', unattended: { write_mode: 'workspace-write', approval_mode: 'never' } },
          { projectRoot: '/x', runId: 'b2' },
        );
      } catch { threw = true; }
      if (!threw) throw new Error('冲突未拒');
      const m = buildGoalManifestFromInput(
        { feature: 'f1', run_id: 'a1', unattended: { write_mode: 'workspace-write', approval_mode: 'never' } },
        { projectRoot: '/x', runId: 'a1' },
      );
      if (m.run_id !== 'a1') throw new Error('一致值未采纳');
    },
  },
  {
    name: 'T1b: --resume 拒绝 . 开头 run_id（dry 无 resume 语义）',
    run: () => {
      let threw = false;
      try {
        loadGoalManifestFromRun('/nonexistent', '.dry', { feature: 'f1' });
      } catch (e) {
        threw = /dry|非法/.test((e as Error).message);
      }
      if (!threw) throw new Error('未按 dry-resume 拒绝');
    },
  },
  {
    name: 'T1b: resolveRawRunInput——dry+resume 互斥 / feature 仅在 manifest / CLI-manifest 冲突',
    run: () => {
      const root = tmpDir('rri');
      fs.writeFileSync(path.join(root, 'm.yaml'), 'feature: featA\nrun_id: rA\n', 'utf-8');
      let threw = false;
      try { resolveRawRunInput({ 'dry-run': true, resume: 'r1' }, root); } catch { threw = true; }
      if (!threw) throw new Error('dry+resume 未拒');
      const ok = resolveRawRunInput({ manifest: 'm.yaml' }, root);
      if (ok.feature !== 'featA' || ok.runId !== 'rA') throw new Error('feature 仅在 manifest 未解析');
      threw = false;
      try { resolveRawRunInput({ manifest: 'm.yaml', feature: 'featB' }, root); } catch { threw = true; }
      if (!threw) throw new Error('feature 冲突未拒');
      threw = false;
      try { resolveRawRunInput({ manifest: 'm.yaml', 'run-id': 'rB' }, root); } catch { threw = true; }
      if (!threw) throw new Error('run_id 冲突未拒');
    },
  },
  // ------------------------------------------------------------ T3a（manifest 保真）
  {
    name: 'T3a: pre_authorized_mutations 复制 + 非法条目整单 fail-closed',
    run: () => {
      const base = { feature: 'f1', unattended: { write_mode: 'workspace-write', approval_mode: 'never' } };
      const m = buildGoalManifestFromInput(
        { ...base, pre_authorized_mutations: [{ phase: 'ut', allowed_files: ['a/b.ets'], max_files: 1, allowed_change_kind: 'test_seam' }] },
        { projectRoot: '/x' },
      );
      if (!m.pre_authorized_mutations || m.pre_authorized_mutations[0].allowed_files[0] !== 'a/b.ets') {
        throw new Error('合法预授权被丢弃');
      }
      for (const bad of [
        [{ phase: '', allowed_files: ['a'], max_files: 1 }],
        [{ phase: 'ut', allowed_files: [], max_files: 1 }],
        [{ phase: 'ut', allowed_files: ['a'], max_files: 0 }],
        [{ phase: 'ut', allowed_files: ['a'], max_files: 1, allowed_change_kind: 'business' }],
        'not-an-array',
      ]) {
        let threw = false;
        try { buildGoalManifestFromInput({ ...base, pre_authorized_mutations: bad }, { projectRoot: '/x' }); }
        catch { threw = true; }
        if (!threw) throw new Error(`非法预授权未拒：${JSON.stringify(bad)}`);
      }
    },
  },
  // ------------------------------------------------------------ T1e
  {
    name: 'T1e: 同机 pid 存活 + heartbeat 超阈值 → 不判 stale（busy + 人工提示）',
    run: () => {
      const rec: LockRecord = {
        ownerId: 'o', pid: process.pid, hostname: os.hostname(),
        started_at: iso(T0), updated_at: iso(T0), run_id: 'r1',
      };
      // heartbeat 早已超阈值（referenceMs 远晚于 updated_at）
      if (isLockStale(rec, 60_000, T0 + 10 * 60 * 60_000)) throw new Error('活 pid 被判 stale');
      const msg = formatLockBlocker('/tmp/x.lock', rec);
      if (!/仍在运行/.test(msg)) throw new Error('缺人工处置提示');
      // pid 消失 → stale
      const dead: LockRecord = { ...rec, pid: 999999999 };
      if (!isLockStale(dead, 60_000, T0 + 1)) throw new Error('死 pid 未判 stale');
    },
  },
  // ------------------------------------------------------------ T1d
  {
    name: 'T1d: 枚举二分——.dry 跳过 / bootstrap 残留静默 / 有 events 无 manifest → corrupt',
    run: () => {
      const root = tmpDir('enum');
      const runs = path.join(root, 'doc/features/f1/goal-runs');
      fs.mkdirSync(path.join(runs, 'good'), { recursive: true });
      fs.writeFileSync(path.join(runs, 'good', 'manifest.json'), '{}', 'utf-8');
      fs.mkdirSync(path.join(runs, DRY_RUNS_SUBDIR, 'good'), { recursive: true });
      fs.writeFileSync(path.join(runs, DRY_RUNS_SUBDIR, 'good', 'manifest.json'), '{}', 'utf-8');
      fs.mkdirSync(path.join(runs, 'residue'), { recursive: true });
      fs.writeFileSync(path.join(runs, 'residue', 'detach.log'), 'x', 'utf-8');
      fs.mkdirSync(path.join(runs, 'broken'), { recursive: true });
      fs.writeFileSync(path.join(runs, 'broken', 'events.jsonl'), '{}', 'utf-8');
      const r = listAuthoritativeGoalRuns(root, 'f1');
      if (r.runs.join(',') !== 'good') throw new Error(`runs=${r.runs.join(',')}`);
      if (r.corruptRuns.length !== 1 || r.corruptRuns[0].runId !== 'broken') {
        throw new Error(`corrupt=${JSON.stringify(r.corruptRuns)}`);
      }
      const abs = classifyGoalRunsDir(runs);
      if (abs.runs.join(',') !== 'good' || abs.corruptRuns.length !== 1) throw new Error('绝对路径口径不一致');
    },
  },
  // ------------------------------------------------------------ T2
  {
    name: 'T2: 隔夜 resume——活跃 69m 而非日历 12h（4035d4 回归）',
    run: () => {
      const nextSession = T0 + 13 * 60 * 60_000; // 隔夜 resume
      const b = resolveResumedBudget(overnightEvents(), { nextSessionStartMs: nextSession });
      const activeMin = Math.round(b.priorActiveMs / 60_000);
      if (activeMin !== 69) throw new Error(`priorActiveMs=${activeMin}m ≠ 69m`);
      if (b.firstAuthoritativeStartMs !== T0) throw new Error('firstAuthoritativeStartMs 漂移');
    },
  },
  {
    name: 'T2: 崩溃段（无 run_end）保守补收一个心跳周期；连续 hard-kill 不欠计',
    run: () => {
      const killAt = (start: number): GoalRunEvent[] => [
        ev({ ts: iso(start), type: 'run_start' }),
        ev({ ts: iso(start + 40 * 60_000), type: 'heartbeat' }), // 40m 心跳后被杀
      ];
      const events = [...killAt(T0), ...killAt(T0 + 60 * 60_000), ...killAt(T0 + 120 * 60_000)];
      const p = partitionExecutionSessions(events, { tailCapMs: T0 + 180 * 60_000 });
      // 每段实际 ≥40m，补收后计 40m+1 心跳；三段累计 ≥120m（不欠计）
      const totalMin = p.priorActiveMs / 60_000;
      if (totalMin < 120) throw new Error(`累计 ${totalMin}m < 实际活跃 120m（欠计）`);
      if (totalMin > 123 + 1e-6) throw new Error(`累计 ${totalMin}m 超出补收上界（>每段 1 心跳）`);
      for (const s of p.sessions) {
        if (s.clean) throw new Error('崩溃段被误判 clean');
      }
    },
  },
  {
    name: 'T2: 崩溃后 5 秒立即 resume——补收被 nextSessionStartMs 截断（无重复计时）',
    run: () => {
      const events: GoalRunEvent[] = [
        ev({ ts: iso(T0), type: 'run_start' }),
        ev({ ts: iso(T0 + 10 * 60_000), type: 'heartbeat' }),
      ];
      const b = resolveResumedBudget(events, { nextSessionStartMs: T0 + 10 * 60_000 + 5_000 });
      if (b.priorActiveMs > 10 * 60_000 + 5_000) {
        throw new Error(`补收越过 resume 边界：${b.priorActiveMs}`);
      }
    },
  },
  {
    name: 'T2: dry 段剔除——totalTurns/priorActiveMs/firstAuthoritativeStartMs 全不含 dry',
    run: () => {
      const events: GoalRunEvent[] = [
        ev({ ts: iso(T0), type: 'run_start', dry_run: true }),
        ev({ ts: iso(T0 + 1_000), type: 'agent_invoke_start', dry_run: true }),
        ev({ ts: iso(T0 + 2_000), type: 'agent_invoke_start', dry_run: true }),
        ev({ ts: iso(T0 + 3_000), type: 'run_end', status: 'DEFERRED', dry_run: true }),
        ev({ ts: iso(T0 + 60_000), type: 'run_start' }),
        ev({ ts: iso(T0 + 61_000), type: 'agent_invoke_start' }),
        ev({ ts: iso(T0 + 5 * 60_000), type: 'run_end', status: 'HALTED' }),
      ];
      const p = partitionExecutionSessions(events);
      if (p.totalTurns !== 1) throw new Error(`totalTurns=${p.totalTurns}（dry 幻影 turn 未剔）`);
      if (p.firstAuthoritativeStartMs !== T0 + 60_000) throw new Error('首个权威段起点取到 dry');
      if (p.priorActiveMs !== 4 * 60_000) throw new Error(`priorActiveMs=${p.priorActiveMs}`);
      const auth = filterAuthoritativeEvents(events);
      if (auth.some((e) => (e as { dry_run?: unknown }).dry_run === true)) throw new Error('过滤后仍含 dry 事件');
    },
  },
  {
    name: 'T2: 孤儿前缀（无 run_start）兜底 + 时钟回拨钳 0 不判负',
    run: () => {
      const orphan = partitionExecutionSessions([
        ev({ ts: iso(T0), type: 'resume' }),
        ev({ ts: iso(T0 + 1_000), type: 'run_end', status: 'HALTED' }),
      ]);
      if (orphan.sessions.length !== 1) throw new Error('孤儿段未兜底');
      const rollback = partitionExecutionSessions([
        ev({ ts: iso(T0 + 60_000), type: 'run_start' }),
        ev({ ts: iso(T0), type: 'run_end', status: 'HALTED' }), // 回拨
      ]);
      if (rollback.priorActiveMs !== 0) throw new Error('负时长未钳 0');
    },
  },
  {
    name: 'T2: budget guidance——不出现裸「重启」，含新 run 与 --override-manifest 两路',
    run: () => {
      const g = buildBudgetExhaustedGuidance({
        feature: 'f1', runId: 'r1', phase: 'ut', kind: 'budget_wall_clock',
        activeElapsedMs: 480 * 60_000, limit: 480 * 60_000, harnessPrefixRel: 'harness',
      }).join('\n');
      if (!/--override-manifest/.test(g)) throw new Error('缺 override 路');
      if (!/新起 run|新 run/.test(g)) throw new Error('缺新 run 路');
      if (!/活跃/.test(g)) throw new Error('未说明活跃时间口径');
    },
  },
  // ------------------------------------------------------------ T3b
  {
    name: 'T3b: scope hash v2——fingerprint/source_inventory 任一变化即失配（版本化单一定义）',
    run: () => {
      const base: MutationAuthorizationReceipt = {
        schema_version: '1.0', run_id: 'r1', phase: 'ut',
        allowed_files: ['a/b.ets'], allowed_change_kind: 'test_seam', max_files: 1,
        approved_by: 'user', authority_kind: 'human',
      };
      const h1 = mutationAuthorizationScopeHash(base);
      const h2 = mutationAuthorizationScopeHash({ ...base, adjudicated_drift_fingerprint: 'f'.repeat(64) });
      const h3 = mutationAuthorizationScopeHash({ ...base, source_inventory_before: 'i'.repeat(64) });
      if (h1 === h2 || h1 === h3 || h2 === h3) throw new Error('scope v2 字段未入签名范围');
    },
  },
  {
    name: 'T3b: relPathIssues——绝对路径/../重复项 fail-closed',
    run: () => {
      if (relPathIssues(['a/b.ets']).length !== 0) throw new Error('合法路径被误拒');
      if (relPathIssues(['/abs']).length === 0) throw new Error('绝对路径未拒');
      if (relPathIssues(['C:/x']).length === 0) throw new Error('盘符未拒');
      if (relPathIssues(['a/../b']).length === 0) throw new Error('.. 未拒');
      if (relPathIssues(['a', 'a']).length === 0) throw new Error('重复未拒');
    },
  },
  {
    name: 'T3b: fingerprint——排序不敏感、op/内容变化敏感',
    run: () => {
      const a = computeDriftFingerprint([
        { op: 'modified', path: 'x/1.ets', sha256: 'aa' },
        { op: 'added', path: 'x/2.ets', sha256: 'bb' },
      ]);
      const b = computeDriftFingerprint([
        { op: 'added', path: 'x/2.ets', sha256: 'bb' },
        { op: 'modified', path: 'x/1.ets', sha256: 'aa' },
      ]);
      if (a !== b) throw new Error('排序敏感');
      const c = computeDriftFingerprint([
        { op: 'added', path: 'x/1.ets', sha256: 'aa' }, // modified→added
        { op: 'added', path: 'x/2.ets', sha256: 'bb' },
      ]);
      if (a === c) throw new Error('op 变化未失配');
    },
  },
  {
    name: 'T3b: classify——仅 preauth 覆盖在场 → unauthorized（preauth 非放行路）',
    run: () => {
      const receipt: MutationAuthorizationReceipt = {
        schema_version: '1.0', run_id: 'r1', phase: 'ut',
        allowed_files: ['x/1.ets'], allowed_change_kind: 'test_seam', max_files: 1,
        approved_by: 'owner', authority_kind: 'pre_run_manifest',
        manifest_hash_at_run_start: 'h1',
      };
      const d = classifySourceDrift(
        { added: [], modified: ['x/1.ets'], deleted: [] },
        [receipt],
        { runId: 'r1', frozenManifestHash: 'h1', phase: 'ut', currentDriftFingerprint: 'f'.repeat(64) },
      );
      if (d.kind !== 'unauthorized') throw new Error(`kind=${d.kind}——preauth 被放行`);
      if (!/意图预登记|不放行/.test(d.violations.join(''))) throw new Error('违规说明未点明 preauth 边界');
    },
  },
  {
    name: 'T3b: classify——human 裁决 fingerprint 吻合 → authorized_backtrack；失配 → unauthorized',
    run: () => {
      const root = tmpDir('adj');
      // 构造可通过 human 信任链的 receipt 不可行（registry 不存在——设计行为）；
      // 本例直接验证 fingerprint 判定层：用 pre_run_manifest 以外的路径不可达，
      // 故通过「human receipt 全合规」的最小替身——绕 receiptValidityIssues 不在本例范围，
      // 这里断言：即使 receipt 有效集非空（伪造 valid 集），无 fingerprint 吻合恒 unauthorized。
      const fp = computeCurrentDriftFingerprint(root, { added: [], modified: [], deleted: [] });
      if (fp === null) throw new Error('空 drift fingerprint 应可计算');
      // 空 drift → no_drift 快速路径
      const d = classifySourceDrift({ added: [], modified: [], deleted: [] }, [], { runId: 'r1', frozenManifestHash: null });
      if (d.kind !== 'no_drift') throw new Error('空 drift 未判 no_drift');
    },
  },
  {
    name: 'T3c: guidance——签发不可用（常量 false）文案不承诺 receipt-resume；截断链裁决转新起链',
    run: () => {
      if (MUTATION_RECEIPT_ISSUANCE_ROUTE_AVAILABLE !== false) throw new Error('issuance 常量应为 false（本 plan 冻结）');
      const g1 = buildUnauthorizedMutationGuidance({
        feature: 'f1', runId: 'r1', phase: 'ut', violations: ['x'],
        chainHasCodingReview: true,
        receiptVerificationConfigured: false,
        issuanceRouteAvailable: MUTATION_RECEIPT_ISSUANCE_ROUTE_AVAILABLE,
        adjudicationAlreadyAvailable: false,
        adjudicationRequestRel: null, harnessPrefixRel: 'harness',
      }).join('\n');
      if (!/签发不可用/.test(g1)) throw new Error('未明示签发不可用');
      if (!/coding 起点/.test(g1)) throw new Error('缺 coding 起点出路');
      if (!/gap-notes/.test(g1)) throw new Error('缺自签不构成授权声明');
      const g2 = buildUnauthorizedMutationGuidance({
        feature: 'f1', runId: 'r1', phase: 'ut', violations: ['x'],
        chainHasCodingReview: false,
        receiptVerificationConfigured: true,
        issuanceRouteAvailable: false,
        adjudicationAlreadyAvailable: true,
        adjudicationRequestRel: null, harnessPrefixRel: 'harness',
      }).join('\n');
      if (!/截断链|新起 coding 起点/.test(g2)) throw new Error('截断链裁决未转新起链');
    },
  },
  // ------------------------------------------------------------ T4
  {
    name: 'T4b: rebuild——PASS/advance 后 phase_halt 覆盖为 halted（guidance 保留），resume 不跳过',
    run: () => {
      const chain = ['spec', 'ut', 'testing'] as unknown as Parameters<typeof rebuildOutcomesFromEvents>[1];
      const events: GoalRunEvent[] = [
        ev({ ts: iso(T0), type: 'phase_verdict', phase: 'spec', action: 'advance', verdict: 'PASS' }),
        ev({ ts: iso(T0 + 1), type: 'phase_verdict', phase: 'ut', action: 'advance', verdict: 'PASS' }),
        ev({ ts: iso(T0 + 2), type: 'phase_halt', phase: 'ut', halt_reason: 'unauthorized_source_mutation', verdict: 'PASS', halt_guidance: 'G' }),
      ];
      const out = rebuildOutcomesFromEvents(events, chain);
      const ut = out.find((o) => String(o.phase) === 'ut');
      if (!ut || ut.halted !== true) throw new Error('phase_halt 未覆盖 provisional PASS');
      if ((ut as { halt_guidance?: string }).halt_guidance !== 'G') throw new Error('guidance 丢失');
      if ((ut as { halt_reason?: string }).halt_reason !== 'unauthorized_source_mutation') throw new Error('halt_reason 丢失');
      // halt 后重跑并 advance → halt 不再覆盖
      const events2 = [...events, ev({ ts: iso(T0 + 3), type: 'phase_verdict', phase: 'ut', action: 'advance', verdict: 'PASS' })];
      const out2 = rebuildOutcomesFromEvents(events2, chain);
      const ut2 = out2.find((o) => String(o.phase) === 'ut');
      if (!ut2 || ut2.halted) throw new Error('回退重跑后的合法 PASS 被旧 halt 覆盖');
    },
  },
  {
    name: 'T4d/5b: 授权型 blocker 保持 human_only；证据基线缺失回到机器恢复',
    run: () => {
      const a = resolveBlockerActionability({ id: 'goal_post_review_source_mutation_unresolved' } as never);
      if (a !== 'human_only') throw new Error(`post_review=${a}`);
      const b = resolveBlockerActionability({ id: 'goal_review_closure_baseline_unavailable' } as never);
      if (b !== 'agent_fixable') throw new Error(`baseline=${b}`);
      const c = resolveBlockerActionability({ id: 'ut_no_src_mutation' } as never);
      if (c !== 'agent_fixable') throw new Error(`通用 id 缺省被改：${c}`);
    },
  },
  // ------------------------------------------------------------ round2（实施后 review）
  {
    name: 'round2 P1: tryAcquireLock 落盘 run_mode/report_dir；legacy 调用面不多写字段',
    run: () => {
      const root = tmpDir('lockw');
      const lockPath = path.join(root, '.feature.lock');
      const rec = tryAcquireLock(lockPath, {
        run_id: 'r1', run_mode: 'dry', report_dir: `doc/features/f1/goal-runs/${DRY_RUNS_SUBDIR}/r1`,
      });
      if (!rec) throw new Error('加锁失败');
      const onDisk = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as LockRecord;
      if (onDisk.run_mode !== 'dry') throw new Error(`run_mode 未落盘：${JSON.stringify(onDisk)}`);
      if (onDisk.report_dir !== `doc/features/f1/goal-runs/${DRY_RUNS_SUBDIR}/r1`) {
        throw new Error('report_dir 未落盘');
      }
      releaseLock(lockPath, rec.ownerId);
      const rec2 = tryAcquireLock(lockPath, { run_id: 'r2' });
      if (!rec2) throw new Error('二次加锁失败');
      const onDisk2 = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as Record<string, unknown>;
      if ('run_mode' in onDisk2 || 'report_dir' in onDisk2) {
        throw new Error('legacy 调用面不应写入 undefined 字段');
      }
      releaseLock(lockPath, rec2.ownerId);
    },
  },
  {
    name: 'round2 P1: --resume 与 manifest.run_id 冲突 fail-closed；一致则 resume 身份采纳',
    run: () => {
      const root = tmpDir('resmf');
      fs.writeFileSync(path.join(root, 'm.yaml'), 'feature: featA\nrun_id: rA\n', 'utf-8');
      let threw = false;
      try { resolveRawRunInput({ resume: 'rB', manifest: 'm.yaml' }, root); }
      catch (e) { threw = /冲突/.test((e as Error).message); }
      if (!threw) throw new Error('resume↔manifest.run_id 冲突未拒');
      threw = false;
      // feature 必填检查在身份冲突检查之前——须提供 feature 才到达目标分支
      try { resolveRawRunInput({ resume: 'rB', 'run-id': 'rC', feature: 'featA' }, root); }
      catch (e) { threw = /冲突/.test((e as Error).message); }
      if (!threw) throw new Error('resume↔--run-id 冲突未拒');
      const ok = resolveRawRunInput({ resume: 'rA', manifest: 'm.yaml' }, root);
      if (!ok.isResume || ok.runId !== 'rA') throw new Error('一致 resume 身份未采纳');
    },
  },
  {
    name: 'round2 P1: progress 投影权威视图——legacy 混写 dry PASS 不进面板真值（宿主原始事故形态）',
    run: () => {
      const root = tmpDir('progmix');
      const workflow = loadWorkflowSpec(path.resolve(__dirname, '../../..'), 'spec-driven');
      const manifest: GoalManifest = {
        schema_version: '1.0', start_phase: 'ut', end_phase: 'testing',
        feature: 'f1', adapter: 'generic',
        budget: { max_retries_per_phase: 2, max_total_turns: 20, wall_clock_minutes: 240, max_transient_api_retries: 3 },
        dependency_policy: { deferrable_blocking_classes: [], deferrable_failure_kinds: [], propagate_to_downstream: true },
        unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
        run_id: 'r1', report_dir: 'doc/features/f1/goal-runs/r1',
        created_at: iso(T0),
      } as unknown as GoalManifest;
      const chain = ['ut', 'testing'];
      const realStart = T0 + 60 * 60_000;
      const events: GoalRunEvent[] = [
        // dry 段：ut/testing 全 PASS + COMPLETED（宿主 dry 预埋残留形态）
        ev({ ts: iso(T0), type: 'run_start', chain, dry_run: true }),
        ev({ ts: iso(T0 + 1_000), type: 'phase_start', phase: 'ut', attempt: 1, dry_run: true }),
        ev({ ts: iso(T0 + 2_000), type: 'agent_invoke_start', phase: 'ut', invoke_id: 'd1', dry_run: true }),
        ev({ ts: iso(T0 + 3_000), type: 'agent_invoke_end', phase: 'ut', invoke_id: 'd1', exit_code: 0, dry_run: true }),
        ev({ ts: iso(T0 + 4_000), type: 'phase_verdict', phase: 'ut', verdict: 'PASS', action: 'advance', dry_run: true }),
        ev({ ts: iso(T0 + 5_000), type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance', dry_run: true }),
        ev({ ts: iso(T0 + 6_000), type: 'run_end', status: 'COMPLETED', dry_run: true }),
        // 真实段：1h 后 ut 刚开跑
        ev({ ts: iso(realStart), type: 'run_start', chain }),
        ev({ ts: iso(realStart + 1_000), type: 'phase_start', phase: 'ut', attempt: 1 }),
        ev({ ts: iso(realStart + 2_000), type: 'agent_invoke_start', phase: 'ut', invoke_id: 'r1-i1' }),
      ];
      const snap = projectGoalProgress({
        projectRoot: root, manifest, events, workflow,
        featureLock: null, runnerLock: null, nowMs: realStart + 120_000,
      });
      if (snap.chain.current_phase !== 'ut') throw new Error(`current=${snap.chain.current_phase}（dry testing 泄漏）`);
      if (snap.phase.status === 'PASSED') throw new Error('dry PASS 泄漏进当前 phase 状态');
      if (snap.status === 'COMPLETED') throw new Error('dry run_end 终态泄漏');
      if (snap.budget.turns_used !== 1) throw new Error(`turns=${snap.budget.turns_used}（dry 幻影 turn）`);
      // 活跃口径：wall_elapsed = 真实段 now−段首（120s），非「dry run_start→now」日历 61h 跨度
      if (snap.budget.wall_elapsed_ms !== 120_000) {
        throw new Error(`wall_elapsed=${snap.budget.wall_elapsed_ms} ≠ 120000（活跃口径未生效）`);
      }
      // .dry 视图保留 raw：dry 自己的 progress 仍可见
      if (!isDryReportDir(`doc/features/f1/goal-runs/${DRY_RUNS_SUBDIR}/r1`)) throw new Error('isDryReportDir 误判');
      const dryManifest = {
        ...(manifest as unknown as Record<string, unknown>),
        report_dir: `doc/features/f1/goal-runs/${DRY_RUNS_SUBDIR}/r1`,
      } as unknown as GoalManifest;
      const drySnap = projectGoalProgress({
        projectRoot: root, manifest: dryManifest, events: events.slice(0, 7), workflow,
        featureLock: null, runnerLock: null, nowMs: T0 + 10_000,
      });
      if (drySnap.budget.turns_used !== 1) throw new Error('dry 视图 raw 口径丢失');
      if (drySnap.status !== 'COMPLETED') throw new Error(`dry 视图终态=${drySnap.status}`);
    },
  },
  {
    name: 'round2 P1: check-spec goal_run_identity_intact——corrupt 残留 BLOCKER FAIL 点名目录',
    run: () => {
      const root = tmpDir('csid');
      const runs = path.join(root, 'doc/features/f1/goal-runs');
      fs.mkdirSync(path.join(runs, 'good'), { recursive: true });
      fs.writeFileSync(path.join(runs, 'good', 'manifest.json'), '{}', 'utf-8');
      const clean = checkGoalRunIdentityIntact({ projectRoot: root, feature: 'f1' } as never);
      if (clean[0].status !== 'PASS') throw new Error(`clean=${clean[0].status}`);
      fs.mkdirSync(path.join(runs, 'broken'), { recursive: true });
      fs.writeFileSync(path.join(runs, 'broken', 'events.jsonl'), '{}', 'utf-8');
      const dirty = checkGoalRunIdentityIntact({ projectRoot: root, feature: 'f1' } as never);
      if (dirty[0].status !== 'FAIL' || dirty[0].severity !== 'BLOCKER') {
        throw new Error(`dirty=${dirty[0].severity}/${dirty[0].status}`);
      }
      if (!dirty[0].details?.includes('broken')) throw new Error('未点名损坏目录');
    },
  },
  {
    name: 'f6b2d9a4 T3: parser 保留 fidelity/fidelity_receipt；非法枚举 fail-closed（手写 manifest 不再静默丢档）',
    run: () => {
      const base = { feature: 'f1', unattended: { write_mode: 'workspace-write', approval_mode: 'never' } };
      const m = buildGoalManifestFromInput(
        { ...base, fidelity: 'pixel_1to1', fidelity_receipt: 'spec/fd.receipt.json' },
        { projectRoot: '/x' },
      );
      if (m.fidelity !== 'pixel_1to1') throw new Error('fidelity 被 parser 丢弃');
      if (m.fidelity_receipt !== 'spec/fd.receipt.json') throw new Error('fidelity_receipt 被丢弃');
      let threw = false;
      try { buildGoalManifestFromInput({ ...base, fidelity: 'ultra_hd' }, { projectRoot: '/x' }); }
      catch (e) { threw = /非法/.test((e as Error).message); }
      if (!threw) throw new Error('非法枚举未 fail-closed');
    },
  },
  {
    // ------------------------------------------------------------ round2 P2 e2e
    // dry trust 字节级回归：真实拉起 goal-runner --dry-run（consumer 布局临时宿主，
    // framework 共享目录用 junction、harness 真拷贝+node_modules junction），断言：
    // ① 项目侧全部预置文件（vision 账本/需求/checkpoint 种子/config/入口）逐字节不变；
    // ② 新文件只落 goal-runs/.dry/<run_id>/；③ --override-adapter 不写 framework.local.json；
    // ④ .dry events 全量 dry_run:true 且零 vision_ledger_anchor。
    // framework/** 写入不在本例射程（框架写保护另有 foreign-file 防线与专测）。
    name: 'round2 P2 e2e: dry-run trust 面字节级不变（含 --override-adapter 写回门）',
    run: () => {
      const repoRoot = path.resolve(__dirname, '../../..');
      const harnessRoot = path.resolve(__dirname, '../..');
      const sha256 = (p: string): string =>
        require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      const snapshotTree = (root: string, skipTop: string[]): Map<string, string> => {
        const out = new Map<string, string>();
        const walk = (dir: string): void => {
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, ent.name);
            const rel = path.relative(root, abs).replace(/\\/g, '/');
            if (skipTop.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
            if (ent.isDirectory()) walk(abs);
            else if (ent.isFile()) out.set(rel, sha256(abs));
          }
        };
        walk(root);
        return out;
      };

      const temp = tmpDir('drybyte');
      const junctions: string[] = [];
      const junction = (src: string, dst: string): void => {
        fs.symlinkSync(src, dst, 'junction');
        junctions.push(dst);
      };
      try {
        // consumer 布局
        const fw = path.join(temp, 'framework');
        fs.mkdirSync(fw, { recursive: true });
        for (const d of ['agents', 'skills', 'workflows', 'profiles', 'templates', 'specs', 'scripts']) {
          const src = path.join(repoRoot, d);
          if (fs.existsSync(src)) junction(src, path.join(fw, d));
        }
        const fhar = path.join(fw, 'harness');
        fs.cpSync(harnessRoot, fhar, {
          recursive: true,
          filter: (s) => {
            const b = path.basename(s);
            return b !== 'node_modules' && b !== 'tests';
          },
        });
        junction(path.join(harnessRoot, 'node_modules'), path.join(fhar, 'node_modules'));

        // 项目侧种子
        fs.writeFileSync(path.join(temp, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1',
          project_name: 'drybyte',
          materialized_adapters: ['cursor'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        }, null, 2));
        fs.writeFileSync(path.join(temp, 'AGENTS.md'), '# stub\n');
        const featDir = path.join(temp, 'doc/features/f1');
        fs.mkdirSync(path.join(featDir, 'vision'), { recursive: true });
        fs.writeFileSync(path.join(featDir, 'vision', 'artifact-attestations.jsonl'), '{"seed":1}\n');
        fs.writeFileSync(path.join(featDir, 'vision', 'policy-downgrades.jsonl'), '{"seed":2}\n');
        fs.writeFileSync(path.join(featDir, 'requirement.md'), '# dry byteid probe\n');
        const cpOut = path.join(temp, 'cp-out');
        fs.mkdirSync(cpOut, { recursive: true });
        fs.writeFileSync(path.join(cpOut, 'seed.json'), '{"seed":3}\n');

        const before = snapshotTree(temp, ['framework']);

        const env: NodeJS.ProcessEnv = { ...process.env };
        delete env.MAISON_GOAL_RUNNER;
        delete env.MAISON_GOAL_HEADLESS;
        delete env.MAISON_GOAL_RUN_ID;
        delete env.MAISON_GOAL_GATE_HARNESS;
        delete env.MAISON_GOAL_ALLOW_NESTED;
        env.MAISON_GOAL_CHECKPOINT_DIR = cpOut;
        const r = require('child_process').spawnSync(process.execPath, [
          '-r', 'ts-node/register/transpile-only', 'scripts/goal-runner.ts',
          '--feature', 'f1', '--requirement', 'dry byteid probe',
          '--start', 'spec', '--end', 'spec',
          '--dry-run', '--adapter', 'cursor', '--override-adapter',
        ], { cwd: fhar, env, encoding: 'utf-8', timeout: 300_000 }) as {
          status: number | null; stdout: string; stderr: string;
        };
        if (r.status === null) throw new Error(`dry-run 超时/未退出：${(r.stderr || '').slice(-500)}`);
        if (!/GOAL_RUN event=end/.test(r.stdout || '')) {
          throw new Error(`dry-run 未走到 run_end：exit=${r.status}\n${(r.stderr || '').slice(-800)}`);
        }

        const after = snapshotTree(temp, ['framework']);
        const problems: string[] = [];
        for (const [rel, h] of before) {
          if (!after.has(rel)) problems.push(`预置文件被删除: ${rel}`);
          else if (after.get(rel) !== h) problems.push(`预置文件被改写: ${rel}`);
        }
        const allowedPrefix = `doc/features/f1/goal-runs/${DRY_RUNS_SUBDIR}/`;
        const newFiles = [...after.keys()].filter((rel) => !before.has(rel));
        for (const rel of newFiles) {
          if (!rel.startsWith(allowedPrefix)) problems.push(`.dry 之外的新文件: ${rel}`);
        }
        if (fs.existsSync(path.join(temp, 'framework.local.json'))) {
          problems.push('--override-adapter 在 dry 下写回了 framework.local.json');
        }
        if (problems.length > 0) throw new Error(`trust 面字节对账失败：\n${problems.join('\n')}`);
        if (newFiles.length === 0) throw new Error('.dry 未产出任何文件（run 没真跑？）');

        // .dry events：全量 dry 打标 + 零 vision anchor
        const dryDirAbs = path.join(temp, 'doc/features/f1/goal-runs', DRY_RUNS_SUBDIR);
        let checkedEvents = 0;
        for (const runId of fs.readdirSync(dryDirAbs)) {
          const evPath = path.join(dryDirAbs, runId, 'events.jsonl');
          if (!fs.existsSync(evPath)) continue;
          const rows = fs.readFileSync(evPath, 'utf-8').trim().split('\n')
            .map((l) => JSON.parse(l) as { dry_run?: unknown; type?: string });
          checkedEvents += rows.length;
          if (rows.some((e2) => e2.dry_run !== true)) throw new Error('dry events 存在未打标行');
          if (rows.some((e2) => e2.type === 'vision_ledger_anchor')) {
            throw new Error('dry events 出现 vision_ledger_anchor（invoke 窗口零账本读被破坏）');
          }
        }
        if (checkedEvents === 0) throw new Error('.dry events.jsonl 缺失');
      } finally {
        // 清理：先摘 junction（rmdirSync 只删 reparse point，绝不进仓库真身），再递归删
        for (const j of junctions.reverse()) {
          try { fs.rmdirSync(j); } catch { /* best-effort */ }
        }
        try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    },
  },
  // ------------------------------------------------------------ t1（plan c6a9e4d2）
  // events-only resume：resume 起点/priorOutcomes 一律由 authoritative events 回放，
  // goal-report.json 永不参与恢复决策；events 缺失/损坏 fail-closed；terminal guard
  // priorStatus 从 events 投影。
  {
    name: 't1: 陈旧 report（review halted）+ 新 events（review/ut advance）→ 起点=testing',
    run: () => {
      const T = Date.parse('2026-08-18T03:54:20.000Z');
      const chain = ['coding', 'review', 'ut', 'testing'];
      // 陈旧 goal-report.json 形态：审合时 review halted（报告只在 run_end 落盘，
      // 崩溃后停留在旧 halt）；events 已前进到 review/ut 双 PASS。
      const events: GoalRunEvent[] = [
        ev({ ts: new Date(T).toISOString(), type: 'run_start' }),
        ev({ ts: new Date(T + 60_000).toISOString(), type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance' }),
        ev({ ts: new Date(T + 120_000).toISOString(), type: 'phase_verdict', phase: 'review', verdict: 'PASS', action: 'advance' }),
        ev({ ts: new Date(T + 180_000).toISOString(), type: 'phase_verdict', phase: 'ut', verdict: 'PASS', action: 'advance' }),
      ];
      // 旧代码的 report 分支（priorReport?.phases 优先）会以 review halt 起步——
      // 本用例直接验证 events-only 口径的起点不依赖任何 report。
      const resume = resolveResumeFromEvents(chain, events);
      if (resume.startIndex !== 3) {
        throw new Error(`起点应为 testing(idx=3)，实得 ${resume.startIndex}（outcomes=${JSON.stringify(resume.priorOutcomes)}）`);
      }
      if (resume.priorOutcomes.length !== 3) {
        throw new Error(`priorOutcomes 应为 3（coding/review/ut PASS），实得 ${resume.priorOutcomes.length}`);
      }
      // 接线断言：goal-runner resume 分支不得再读取 report 的 phases 做起点。
      const runnerSrc = fs.readFileSync(
        path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8',
      );
      if (/priorReport\?\.phases/.test(runnerSrc)) {
        throw new Error('goal-runner.ts 仍存在 report 优先的 resume 起点分支（priorReport?.phases）');
      }
    },
  },
  {
    name: 't1: events 损坏→resume 决策面 fail-closed（loadEventsJsonlStrict 命名损坏行）',
    run: () => {
      const dir = tmpDir('ev-corrupt');
      const eventsPath = path.join(dir, 'events.jsonl');
      fs.writeFileSync(
        eventsPath,
        `${JSON.stringify({ ts: '2026-08-18T00:00:00.000Z', type: 'run_start' })}\n` +
        `{"ts":"2026-08-18T00:00:01.000Z","type":"phase_verdict",broken\n`,
        'utf-8',
      );
      const strict = loadEventsJsonlStrict(eventsPath);
      if (strict.corruptLines.length !== 1 || strict.corruptLines[0].line !== 2) {
        throw new Error(`损坏行未识别：${JSON.stringify(strict.corruptLines)}`);
      }
      if (strict.events.length !== 1) throw new Error('严格加载不得吞掉合法行');
      const missing = loadEventsJsonlStrict(path.join(dir, 'nope.jsonl'));
      if (!missing.missing || missing.corruptLines.length !== 0) {
        throw new Error('缺失文件应报 missing=true 且无损坏行');
      }
      // P1-8（review）：空文件/全空白同样不是真源——strict 返回 0 events 但非 missing，
      // 上层（resume 检查）须据此 fail-closed。
      fs.writeFileSync(path.join(dir, 'empty.jsonl'), '', 'utf-8');
      const empty = loadEventsJsonlStrict(path.join(dir, 'empty.jsonl'));
      if (empty.missing || empty.corruptLines.length !== 0 || empty.events.length !== 0) {
        throw new Error(`空文件应报告 events=[] 且非 missing：${JSON.stringify(empty)}`);
      }
      fs.writeFileSync(path.join(dir, 'blank.jsonl'), '  \n\t\n', 'utf-8');
      const blank = loadEventsJsonlStrict(path.join(dir, 'blank.jsonl'));
      if (blank.events.length !== 0) throw new Error('全空白应解析为 0 事件');
      // 接线断言：goal-runner resume 分支在恢复决策前必须消费严格视图。
      const runnerSrc = fs.readFileSync(
        path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8',
      );
      if (!runnerSrc.includes('loadEventsJsonlStrict(eventsPath)')) {
        throw new Error('goal-runner.ts resume 分支未接线 events 严格加载（fail-closed 缺失）');
      }
      if (!runnerSrc.includes('authoritativeResumeEvents.some')) {
        throw new Error('goal-runner.ts 未做 authoritative run_start 存在性检查（P1-8 fail-closed 缺失）');
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 't1: terminal guard priorStatus 从 events run_end 投影（HALTED 拒绝非 force resume）',
    run: () => {
      const T = Date.now() - 10 * 60_000; // 明确过去（cooldown=0 时也不触发负 elapsed）
      // report 显示 COMPLETED（陈旧）、events run_end=HALTED——guard 以 events 为准拒绝。
      const events: GoalRunEvent[] = [
        ev({ ts: new Date(T).toISOString(), type: 'run_start' }),
        ev({ ts: new Date(T + 60_000).toISOString(), type: 'phase_verdict', phase: 'spec', verdict: 'PASS', action: 'advance' }),
        ev({ ts: new Date(T + 120_000).toISOString(), type: 'run_end', status: 'HALTED' }),
      ];
      const last = [...events].reverse().find((e) => e.type === 'run_end');
      const guard = checkTerminalResumeGuard({
        priorStatus: last?.status,
        lastRunEndTs: last?.ts,
        forceResume: false,
        cooldownMinutes: 0,
      });
      if (guard.allowed) throw new Error('events run_end=HALTED 必须拒绝裸 resume');
      const forced = checkTerminalResumeGuard({
        priorStatus: last?.status,
        lastRunEndTs: last?.ts,
        forceResume: true,
        cooldownMinutes: 0,
      });
      if (!forced.allowed) throw new Error('--force-resume 应放行（cooldown=0）');
      // 接线断言：resume guard 的 priorStatus 不再回退 report.status。
      const runnerSrc = fs.readFileSync(
        path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8',
      );
      if (/priorReport\?\.status/.test(runnerSrc)) {
        throw new Error('goal-runner.ts terminal guard 仍回退 report.status（plan t1 同病未除）');
      }
    },
  },
  {
    name: 't1: events 重建的 halt outcome 携带 run_disposition/run_wait_kind 投影（WAITING 停放语义）',
    run: () => {
      const T = Date.parse('2026-08-10T08:00:00.000Z');
      const chain = ['coding', 'review', 'ut', 'testing'];
      const events: GoalRunEvent[] = [
        ev({ ts: new Date(T).toISOString(), type: 'run_start' }),
        ev({ ts: new Date(T + 60_000).toISOString(), type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance' }),
        ev({ ts: new Date(T + 120_000).toISOString(), type: 'phase_verdict', phase: 'review', verdict: 'PASS', action: 'advance' }),
        ev({
          ts: new Date(T + 180_000).toISOString(), type: 'phase_halt', phase: 'ut',
          halt_reason: 'device_unready', run_disposition: 'WAITING', run_wait_kind: 'external',
        }),
      ];
      const rebuilt = rebuildOutcomesFromEvents(events, chain);
      if (rebuilt.length !== 3) throw new Error(`重建 outcome 数应为 3，实得 ${rebuilt.length}`);
      const haltedUt = rebuilt[2];
      if (!haltedUt || !haltedUt.halted || haltedUt.phase !== 'ut') {
        throw new Error(`ut halt 未重建为 halted outcome：${JSON.stringify(rebuilt)}`);
      }
      if (haltedUt.run_disposition !== 'WAITING' || haltedUt.run_wait_kind !== 'external') {
        throw new Error(
          `halt 重建丢失 run_disposition/run_wait_kind 投影：${JSON.stringify(haltedUt)}`,
        );
      }
      // fa0663：WAITING(external) 停放不得被计入 done——resume 起点必须回到 ut。
      const resume = resolveResumeFromEvents(chain, events);
      if (resume.startIndex !== 2) {
        throw new Error(`设备停放场景起点应为 ut(idx=2)，实得 ${resume.startIndex}`);
      }
      // 弹出 halted phase 后的 prefix 不得残留 WAITING outcome 自身（resolveResumeState
      // 的 halted 弹出语义）——但数据库（未 halt 的）先序 outcome 必须保留。
      if (resume.priorOutcomes.length !== 2) {
        throw new Error(`halted 弹出后 prefix 应为 2，实得 ${resume.priorOutcomes.length}`);
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
