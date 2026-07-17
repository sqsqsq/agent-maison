// ============================================================================
// goal-capability-gate.unit.test.ts — t3-min invoke 前能力 gate 集成回归
// （plan e6a3c9f4 v5 / openspec capability-gap-preflight；codex 第四轮 P1）
// ----------------------------------------------------------------------------
// 覆盖 goal-runner invoke-gate 边界的**真实链路**（非纯函数推断）：
// runInvokeCapabilityGate → runCapabilityPreflight（真实 hmos-app profile 前置解析
// → ensurePersonalSetup 门 → toolchain-probe 深检真实读 framework.local.json）
// + 事件序列断言（缺口=仅 phase_halt、无 agent_invoke_start；HARNESS_PREFLIGHT 持久化）。
// 场景链：齐备放行 → capability_failed halt → 模拟 resume（环境未修）再 halt →
// 人工 reprobe 放行 → wrapper verified 放行。run_end halt_reason 语义由
// resolveLastHaltReason 单测承载。进程级 goal-runner e2e（真进程退出码/resume 状态
// 加载）仍留 OpenSpec tasks 未勾——本套件覆盖到 invoke-gate 边界为止，诚实标注。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInvokeCapabilityGate, resolveLastHaltReason } from '../../scripts/goal-runner';
import { harnessPreflightPath } from '../../scripts/utils/capability-preflight';
import { loadFrameworkConfig, clearFrameworkConfigCache } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import type { GoalPhaseOutcome } from '../../scripts/utils/goal-report-generator';
import {
  recordHvigorBuildOutcome,
  resetCapabilityFailedByHumanReprobe,
} from '../../../profiles/hmos-app/harness/toolchain-probe';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** hmos-app 消费态最小工程：adapter 就绪 + deveco 就绪（假 hvigorBin）→ ensure 门可过 */
function mkHmosProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-capgate-'));
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'capgate',
        project_profile: { name: 'hmos-app', sub_variant: 'app' },
        materialized_adapters: ['claude'],
        architecture: {
          outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['shared'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: { features_dir: 'doc/features' },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
  const hvigorBin = path.join(root, 'fake-deveco', 'tools', 'hvigor', 'bin', 'hvigorw.bat');
  fs.mkdirSync(path.dirname(hvigorBin), { recursive: true });
  fs.writeFileSync(hvigorBin, '');
  fs.writeFileSync(
    path.join(root, 'framework.local.json'),
    JSON.stringify(
      {
        schema_version: '1.0',
        agent_adapter: 'claude',
        toolchain: { devEcoStudio: { hvigorBin } },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ "app": {} }', 'utf-8');
  return root;
}

const FP = 'test-fingerprint';

function runGate(root: string, events: Array<Record<string, unknown>>): ReturnType<typeof runInvokeCapabilityGate> {
  clearFrameworkConfigCache();
  const cfg = loadFrameworkConfig(root);
  const resolved = loadResolvedProfile(root, cfg);
  return runInvokeCapabilityGate({
    projectRoot: root,
    phase: 'coding',
    retries: 0,
    resolvedProfile: resolved,
    emitEvent: ev => events.push(ev),
  });
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '全链场景：齐备放行→capability_failed halt（仅 phase_halt 无 invoke 事件）→resume 仍 halt→人工 reprobe 放行→verified 放行',
    run: () => {
      const root = mkHmosProject();
      const events: Array<Record<string, unknown>> = [];
      const count = (): number => events.length;
      try {
        // ① 能力齐备默认路径（probe 无记录=unknown）：放行、零事件、无 preflight 持久化
        assert(runGate(root, events) === null, '齐备须放行');
        assert(count() === 0, '放行不得产生任何事件');
        assert(!fs.existsSync(harnessPreflightPath(root)), '放行不得写 HARNESS_PREFLIGHT 持久化');

        // ② wrapper 真实记录环境能力失败 → gate 必须 halt，事件序列=仅 phase_halt
        recordHvigorBuildOutcome(root, {
          kind: 'capability_failed',
          fingerprint: FP,
          failure_code: 'sdk_component_missing',
          evidence: ['sdk_manifest_format=sdk-pkg.json'],
        });
        const halt1 = runGate(root, events);
        assert(halt1 !== null, '缺口须 halt');
        assert(halt1!.outcome.halted === true && halt1!.outcome.verdict === 'FAIL', 'outcome 须 halted FAIL');
        assert(halt1!.outcome.halt_reason === 'await_human_capability_gap', 'halt_reason 须正确');
        assert(
          (halt1!.outcome.halt_guidance ?? '').includes('deveco_toolchain_capability_failed'),
          'halt_guidance 须携带缺口码',
        );
        assert(count() === 1, `缺口只产生一个事件，got ${count()}`);
        assert(events[0].type === 'phase_halt', '事件须是 phase_halt');
        assert(events[0].halt_reason === 'await_human_capability_gap', 'phase_halt 须带 halt_reason');
        assert(
          events.every(e => e.type !== 'agent_invoke_start'),
          '缺口不得产生 agent_invoke_start（不烧 agent 轮次）',
        );
        const persisted = JSON.parse(fs.readFileSync(harnessPreflightPath(root), 'utf-8'));
        assert(persisted.code === 'deveco_toolchain_capability_failed', 'HARNESS_PREFLIGHT 持久化须带缺口码');
        assert(persisted.phase === 'coding', '持久化须带 phase');

        // ③ 模拟 resume：环境未修，重检必须再次 halt（v4 恒拦截——无授予窗口）
        const halt2 = runGate(root, events);
        assert(halt2 !== null, '环境未修 resume 须再次 halt');
        assert(count() === 2 && events[1].type === 'phase_halt', 'resume 重检须再落 phase_halt');

        // ④ 人工 reprobe（--ensure 且 cli 可启动）→ 降级重置 → gate 放行（授予一次真实编译）
        assert(resetCapabilityFailedByHumanReprobe(root, true) === true, '人工 reprobe 须重置');
        assert(runGate(root, events) === null, 'reprobe 后须放行');
        assert(count() === 2, '放行不追加事件');

        // ⑤ wrapper 真实编译成功 → verified → 持续放行
        recordHvigorBuildOutcome(root, { kind: 'verified', fingerprint: FP });
        assert(runGate(root, events) === null, 'verified 后须放行');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'resolveLastHaltReason：run_end 终态取最后一个 halted outcome 的原因；无 halted → undefined',
    run: () => {
      const outcomes: GoalPhaseOutcome[] = [
        { phase: 'spec', verdict: 'PASS', halted: false, retries: 0 },
        {
          phase: 'plan',
          verdict: 'FAIL',
          halted: true,
          retries: 0,
          halt_reason: 'cumulative_halt',
        } as GoalPhaseOutcome,
        {
          phase: 'coding',
          verdict: 'FAIL',
          halted: true,
          retries: 1,
          halt_reason: 'await_human_capability_gap',
        } as GoalPhaseOutcome,
      ];
      assert(
        resolveLastHaltReason(outcomes) === 'await_human_capability_gap',
        '须取最后一个 halted 的 reason',
      );
      assert(
        resolveLastHaltReason([{ phase: 'spec', verdict: 'PASS', halted: false, retries: 0 } as GoalPhaseOutcome]) ===
          undefined,
        '无 halted 须 undefined',
      );
      assert(resolveLastHaltReason([]) === undefined, '空列表须 undefined');
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
