// ============================================================================
// upstream-closure.unit.test.ts — 上游确定性关环（plan b3e8d4c7 t2）
// ----------------------------------------------------------------------------
// 立项事故 run 20260804T033834Z-99c0a1：assess 推荐 complete_closure:plan，driver
// 词汇表里没有该动作 → 无条件 halt → 重试 coding 永远修不好 plan 的闭环。
//
// 本套锁三件事：① 五态分派穷尽；② **freshness 必须在 validator 之后**（先验 fresh
// 再跑 validator 等于白验——validator 会经 soft_advisories 回写 summary）；
// ③ stale 时诚实停止，绝不靠 finalizer 的 evidence rebound 洗白。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AssessRecommendation } from '../../scripts/utils/assess';
import {
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from '../../scripts/utils/phase-evidence-manifest';
import { tryCloseUpstreamPhase } from '../../scripts/utils/upstream-closure';
import type { UnitCaseResult } from '../run-unit';

const tmpRoots: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const CHAIN = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];

function rec(action: AssessRecommendation['action'], phase: string | null): AssessRecommendation {
  return { action, phase, reason: 'test', requires_driver_authorization: true };
}

interface ValidatorCall {
  phase: string;
  attemptPhase?: string;
  attemptId?: string;
  runId?: string;
}

/** 记录 validator 收到的**真实参数**——stub 忽略参数会漏掉 attemptPhase 传错这类 P0。 */
function stubValidator(status: string, calls: ValidatorCall[]): never {
  return ((
    _harnessRoot: string,
    _projectRoot: string,
    phase: string,
    _feature: string,
    opts?: { goalIdentity?: { runId: string; attemptId: string; attemptPhase: string } },
  ) => {
    calls.push({
      phase,
      attemptPhase: opts?.goalIdentity?.attemptPhase,
      attemptId: opts?.goalIdentity?.attemptId,
      runId: opts?.goalIdentity?.runId,
    });
    return { status, receipt_path: 'r.md', message: `stub ${status}` };
  }) as never;
}

function base(overrides: Record<string, unknown> = {}): never {
  return {
    projectRoot: '/nonexistent-project',
    frameworkRoot: '/nonexistent-framework',
    harnessRoot: '/nonexistent-harness',
    feature: 'demo',
    currentPhase: 'coding',
    chain: CHAIN,
    recommendation: rec('complete_closure', 'plan'),
    goalRunId: 'r-1',
    attemptId: 'i5',
    remainingBudgetMs: 60_000,
    ...overrides,
  } as never;
}

/**
 * 用**生产同款 writer** 造一个证据 fresh 的上游阶段（与宿主 agent 那份
 * scratch/refresh-plan-freeze.ts 同一配方）——这样 freshness 重算走的是真实判据，
 * 不是被 mock 掉的。
 */
function freshUpstreamProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-closure-'));
  tmpRoots.push(root);
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.1',
      project_name: 'T',
      paths: {
        features_dir: 'doc/features',
        receipt_dir_pattern: 'doc/features/<feature>/<phase>',
        reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
      },
    }),
    'utf-8',
  );
  const planDir = path.join(root, 'doc', 'features', 'demo', 'plan');
  fs.mkdirSync(path.join(planDir, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(planDir, 'plan.md'), '# plan\n', 'utf-8');
  fs.writeFileSync(
    path.join(planDir, 'reports', 'summary.json'),
    JSON.stringify({ schema_version: '1.0', phase: 'plan', feature: 'demo', verdict: 'PASS' }),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(planDir, 'phase-completion-receipt.md'),
    ['---', 'receipt_schema: "2.0"', 'feature: "demo"', 'phase: "plan"', '---', ''].join('\n'),
    'utf-8',
  );
  // 生产 writer：先冻结 manifest，再把指针写回回执——顺序与 finalizer 同源
  const manifest = resolvePhaseEvidenceManifest({ projectRoot: root, feature: 'demo', phase: 'plan' });
  const written = writePhaseEvidenceManifest(root, manifest);
  writeReceiptManifestPointer(
    root, 'demo', 'plan',
    path.relative(root, written.absPath).split(path.sep).join('/'),
    written.sha256,
  );
  return root;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 't2 非 complete_closure / 非上游目标 → skipped（本模块不介入既有路径）',
    run: () => {
      const a = tryCloseUpstreamPhase(base({ recommendation: rec('rerun_phase', 'coding') }));
      assert(a.kind === 'skipped', `非 complete_closure 应 skipped，实得 ${a.kind}`);
      const b = tryCloseUpstreamPhase(base({ recommendation: rec('complete_closure', 'coding') }));
      assert(b.kind === 'skipped', `同阶段目标应 skipped，实得 ${b.kind}`);
      const c = tryCloseUpstreamPhase(base({ recommendation: rec('complete_closure', 'testing') }));
      assert(c.kind === 'skipped', `更晚阶段目标应 skipped，实得 ${c.kind}`);
    },
  },
  {
    // codex 复核 P0：初版把 attemptPhase 传成 target（plan），check-receipt 会当作
    // "同阶段验 plan"，照旧拿 coding 的 i5 比 plan 回执的 i3 —— 原事故原样复现。
    name: 't2 事故回归：validator 必须收到 phase=目标阶段、attemptPhase=attempt 真正所属阶段',
    run: () => {
      const calls: ValidatorCall[] = [];
      tryCloseUpstreamPhase(base({ validate: stubValidator('failed', calls) }));
      assert(calls.length === 1, `validator 应被调用一次，实得 ${calls.length}`);
      assert(calls[0].phase === 'plan', `校验目标应是 plan，实得 ${calls[0].phase}`);
      assert(
        calls[0].attemptPhase === 'coding',
        `attemptPhase 必须是 attemptId(i5) 真正所属的 coding，实得 ${calls[0].attemptPhase}` +
        '——传成目标阶段会让跨阶段复验退化成同阶段等值，死锁复现',
      );
      assert(calls[0].attemptId === 'i5' && calls[0].runId === 'r-1', 'run/attempt 身份须透传');
    },
  },
  {
    name: 't2 零预算在**调 validator 之前**拦截（不 spawn 子进程）',
    run: () => {
      const calls: ValidatorCall[] = [];
      const out = tryCloseUpstreamPhase(
        base({ remainingBudgetMs: 0, validate: stubValidator('passed', calls) }),
      );
      assert(out.kind === 'blocked', `零预算应 blocked，实得 ${out.kind}`);
      assert(
        out.kind === 'blocked' && out.incident === 'budget_wall_clock',
        `零预算应归 budget_wall_clock，实得 ${out.kind === 'blocked' ? out.incident : '-'}`,
      );
      assert(calls.length === 0, 'validator 不得被调用（零预算下不该开工）');
    },
  },
  {
    name: 't2 五态分派：failed|missing → owner backtrack；error|not_applicable → framework_bug',
    run: () => {
      for (const status of ['failed', 'missing']) {
        const out = tryCloseUpstreamPhase(base({ validate: stubValidator(status, []) }));
        assert(out.kind === 'backtrack', `${status} 应回 owner，实得 ${out.kind}`);
      }
      for (const status of ['error', 'not_applicable']) {
        const out = tryCloseUpstreamPhase(base({ validate: stubValidator(status, []) }));
        assert(out.kind === 'blocked', `${status} 应 blocked，实得 ${out.kind}`);
        assert(
          out.kind === 'blocked' && out.incident === 'framework_bug',
          `${status} 应归 framework_bug，实得 ${out.kind === 'blocked' ? out.incident : '-'}`,
        );
      }
    },
  },
  {
    name: 't2 passed 但证据 stale → 回 owner 重验（绝不靠 finalizer 的 evidence rebound 洗白）',
    run: () => {
      // projectRoot 不存在 → recomputePhaseEvidenceStaleness 判 missing（≠fresh）
      const out = tryCloseUpstreamPhase(base({ validate: stubValidator('passed', []) }));
      assert(out.kind === 'backtrack', `stale 应 backtrack，实得 ${out.kind}`);
      assert(
        out.kind === 'backtrack' && /证据/.test(out.detail),
        `detail 应点名证据新鲜度：${out.kind === 'backtrack' ? out.detail : ''}`,
      );
    },
  },
  {
    name: 't2 partial publication 在 generic freshness 前识别并交给 finalizer 幂等补完',
    run: () => {
      const root = freshUpstreamProject();
      const reports = path.join(root, 'doc', 'features', 'demo', 'plan', 'reports');
      fs.writeFileSync(path.join(reports, 'summary.json.staged-1-1'), '{}', 'utf8');
      let finalized = 0;
      const out = tryCloseUpstreamPhase(base({
        projectRoot: root,
        frameworkRoot: root,
        harnessRoot: root,
        validate: stubValidator('passed', []),
        finalize: (() => { finalized += 1; }) as never,
      }));
      assert(out.kind === 'closed', `partial 应补完，实得 ${out.kind}`);
      assert(finalized === 1, `partial finalizer calls=${finalized}`);
    },
  },
  {
    name: 't2 无法证明的 partial publication 由既有路径回退 owner',
    run: () => {
      const root = freshUpstreamProject();
      const reports = path.join(root, 'doc', 'features', 'demo', 'plan', 'reports');
      fs.writeFileSync(path.join(reports, 'summary.json.staged-1-1'), '{}', 'utf8');
      const out = tryCloseUpstreamPhase(base({
        projectRoot: root,
        frameworkRoot: root,
        harnessRoot: root,
        validate: stubValidator('passed', []),
        finalize: (() => { throw new Error('closure partial publication 无法证明仍等价'); }) as never,
      }));
      assert(out.kind === 'backtrack', `不可证明 partial 应回 owner，实得 ${out.kind}`);
      assert(
        out.kind === 'backtrack' && /partial closure 无法证明/.test(out.detail),
        `detail 应保留无法证明原因：${out.kind === 'backtrack' ? out.detail : ''}`,
      );
    },
  },
  {
    // codex 复核 P0：整套用例此前没有一个 kind==='closed'，等于成功自愈路径从未被验过。
    name: 't2 成功路径：证据 fresh + 回执 passed → closed（并给出 fence→validate→finalize 顺序）',
    run: () => {
      const root = freshUpstreamProject();
      const order: string[] = [];
      const calls: ValidatorCall[] = [];
      const out = tryCloseUpstreamPhase(base({
        projectRoot: root,
        frameworkRoot: root,
        harnessRoot: root,
        fence: () => { order.push('fence'); },
        validate: ((...args: unknown[]) => {
          order.push('validate');
          return (stubValidator('passed', calls) as unknown as (...a: unknown[]) => unknown)(...args);
        }) as never,
        finalize: (() => { order.push('finalize'); }) as never,
      }));
      assert(out.kind === 'closed', `应关环成功，实得 ${out.kind}：${JSON.stringify(out)}`);
      assert(out.kind === 'closed' && out.phase === 'plan', '关环目标应是 plan');
      // fence 必须**先于** validator（validator 会经 soft_advisories 回写 summary），
      // 且写盘前复验一次
      assert(
        order[0] === 'fence' && order[1] === 'validate' && order[order.length - 1] === 'finalize',
        `顺序须为 fence→validate→…→finalize，实得 ${order.join('→')}`,
      );
      assert(
        order.filter((x) => x === 'fence').length === 2,
        `fence 须在 validator 前与 finalizer 前各一次，实得 ${order.join('→')}`,
      );
    },
  },
  {
    name: 't2 顺序不变量：validator 先跑，freshness 在其后（先验 fresh 等于白验）',
    run: () => {
      // validator 返回 failed 时，freshness 分支不得被触达——若顺序反了，
      // stale 的 detail 会先出现。这里用 detail 内容反证顺序。
      const out = tryCloseUpstreamPhase(base({ validate: stubValidator('failed', []) }));
      assert(
        out.kind === 'backtrack' && /回执不可证明/.test(out.detail),
        `非 passed 必须直接按五态分派、不做 freshness 检查：${out.kind === 'backtrack' ? out.detail : ''}`,
      );
    },
  },
];

export function runAll(): UnitCaseResult[] {
  try {
    return cases.map((c) => {
      try {
        c.run();
        return { name: c.name, ok: true };
      } catch (err) {
        return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
      }
    });
  } finally {
    for (const r of tmpRoots) {
      try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
