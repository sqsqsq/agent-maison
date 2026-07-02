// ============================================================================
// goal-timeout.unit.test.ts — P1-A：per-phase 超时 + wall 派生回归
// ============================================================================
// 验证：
//   - 各 phase 解析出差异化默认（非一刀切 3600）
//   - phase_timeout_seconds 显式覆盖 > 默认表 > 扁平 timeout_seconds
//   - runner 与 progress 共用同一 resolver（同值，杜绝脑裂）
//   - 预算自洽不变量：Σ(链路 per-phase) ≤ 派生 wall（修掉默认表 495m > 旧 wall 480m）
//   - wall 只增不减，绝不缩小用户配置
// ============================================================================

import {
  resolvePhaseTimeoutSeconds,
  resolvePhaseTimeoutMs,
  resolveWallClockMinutes,
  resolveChainPhasesForBudget,
  collectPhaseTimeoutWarnings,
  DEFAULT_PHASE_TIMEOUT_SECONDS,
  MIN_PHASE_TIMEOUT_SECONDS,
  WALL_CLOCK_BUFFER_MINUTES,
  type PhaseTimeoutManifestView,
} from '../../scripts/utils/goal-timeout';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyLegacyTimeoutMigration, loadGoalManifestFile } from '../../scripts/utils/goal-manifest';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import { FEATURE_PHASE_ORDER } from '../../scripts/utils/phase-transition-policy';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

// 开箱即用：不设 flat timeout_seconds → 走 per-phase 默认表。
const FULL_CHAIN: PhaseTimeoutManifestView = {
  start_phase: 'spec',
  end_phase: 'testing',
  budget: { wall_clock_minutes: 480 },
  unattended: {},
};

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'per-phase 默认差异化（P0-A 重定：spec 2700 / ut 5400，goal 闭环成本入账）',
    run: () => {
      assertEq(resolvePhaseTimeoutSeconds('spec', FULL_CHAIN), 2700, 'spec');
      assertEq(resolvePhaseTimeoutSeconds('plan', FULL_CHAIN), 5400, 'plan');
      assertEq(resolvePhaseTimeoutSeconds('coding', FULL_CHAIN), 5400, 'coding');
      assertEq(resolvePhaseTimeoutSeconds('review', FULL_CHAIN), 7200, 'review');
      assertEq(resolvePhaseTimeoutSeconds('ut', FULL_CHAIN), 5400, 'ut');
      assertEq(resolvePhaseTimeoutSeconds('testing', FULL_CHAIN), 7200, 'testing');
      // 至少存在两档不同值，证明非一刀切。
      const distinct = new Set(Object.values(DEFAULT_PHASE_TIMEOUT_SECONDS));
      assertTrue(distinct.size >= 2, '默认表应有多档差异');
    },
  },
  {
    name: 'P0-A 全阶段地板回归：默认表派生值均 ≥ MIN_PHASE_TIMEOUT_SECONDS(1800)',
    run: () => {
      for (const p of FEATURE_PHASE_ORDER) {
        const v = resolvePhaseTimeoutSeconds(p, FULL_CHAIN);
        assertTrue(v >= MIN_PHASE_TIMEOUT_SECONDS, `${p}=${v}s 应 ≥ 地板 ${MIN_PHASE_TIMEOUT_SECONDS}s`);
      }
    },
  },
  {
    name: 'P0-A §七.2 地板豁免显式 override（两条路径）：per-phase 600 与扁平 600 均保留原值',
    run: () => {
      const perPhase: PhaseTimeoutManifestView = {
        ...FULL_CHAIN,
        unattended: { phase_timeout_seconds: { spec: 600 } },
      };
      assertEq(resolvePhaseTimeoutSeconds('spec', perPhase), 600, '显式 per-phase 600 不被地板抬升');
      const flat: PhaseTimeoutManifestView = { ...FULL_CHAIN, unattended: { timeout_seconds: 600 } };
      assertEq(resolvePhaseTimeoutSeconds('spec', flat), 600, '显式扁平 600 不被地板抬升');
    },
  },
  {
    name: 'P0-A collectPhaseTimeoutWarnings：显式低于地板 → WARN 不抬升；不低/未显式 → 无 WARN',
    run: () => {
      const chain = resolveChainPhasesForBudget(FULL_CHAIN);
      assertEq(collectPhaseTimeoutWarnings(FULL_CHAIN, chain).length, 0, '默认表无 WARN');
      const perPhase: PhaseTimeoutManifestView = {
        ...FULL_CHAIN,
        unattended: { phase_timeout_seconds: { spec: 600 } },
      };
      const w1 = collectPhaseTimeoutWarnings(perPhase, chain);
      assertEq(w1.length, 1, 'per-phase 低于地板应 1 条 WARN');
      assertTrue(w1[0].includes('spec') && w1[0].includes('600'), 'WARN 应点名 phase 与值');
      const flat: PhaseTimeoutManifestView = { ...FULL_CHAIN, unattended: { timeout_seconds: 900 } };
      const w2 = collectPhaseTimeoutWarnings(flat, chain);
      assertEq(w2.length, 1, '扁平低于地板只报 1 条（不按 phase 重复）');
      const ok: PhaseTimeoutManifestView = {
        ...FULL_CHAIN,
        unattended: { phase_timeout_seconds: { spec: 3600 } },
      };
      assertEq(collectPhaseTimeoutWarnings(ok, chain).length, 0, '高于地板无 WARN');
    },
  },
  {
    name: 'phase_timeout_seconds 显式 per-phase > flat > 默认表',
    run: () => {
      const m: PhaseTimeoutManifestView = {
        ...FULL_CHAIN,
        unattended: { timeout_seconds: 1800, phase_timeout_seconds: { review: 9000 } },
      };
      assertEq(resolvePhaseTimeoutSeconds('review', m), 9000, 'review per-phase override');
      // spec 无 per-phase，但有显式 flat 1800 → flat 优先于默认表 900
      assertEq(resolvePhaseTimeoutSeconds('spec', m), 1800, 'spec 走 flat');
    },
  },
  {
    name: '显式 flat timeout_seconds 覆盖所有 phase（默认表仅在未显式时兜底）',
    run: () => {
      const m: PhaseTimeoutManifestView = { ...FULL_CHAIN, unattended: { timeout_seconds: 600 } };
      for (const p of FEATURE_PHASE_ORDER) {
        assertEq(resolvePhaseTimeoutSeconds(p, m), 600, `flat ${p}`);
      }
    },
  },
  {
    name: 'resolvePhaseTimeoutMs == seconds * 1000（runner/progress 同口径）',
    run: () => {
      for (const p of FEATURE_PHASE_ORDER) {
        assertEq(
          resolvePhaseTimeoutMs(p, FULL_CHAIN),
          resolvePhaseTimeoutSeconds(p, FULL_CHAIN) * 1000,
          `ms=${p}`,
        );
      }
    },
  },
  {
    name: '预算自洽：Σ(全链 per-phase) ≤ 派生 wall（默认表 495m，派生应 ≥ 495+缓冲）',
    run: () => {
      const chain = resolveChainPhasesForBudget(FULL_CHAIN);
      const sumMin = chain.reduce((a, p) => a + resolvePhaseTimeoutSeconds(p, FULL_CHAIN), 0) / 60;
      const wall = resolveWallClockMinutes(FULL_CHAIN);
      assertTrue(sumMin <= wall, `Σ=${sumMin}m 必须 ≤ wall=${wall}m`);
      assertEq(wall, Math.ceil(sumMin) + WALL_CLOCK_BUFFER_MINUTES, 'wall 应=Σ+缓冲（>旧480）');
      assertTrue(wall > 480, `派生 wall=${wall} 应 > 旧默认 480`);
    },
  },
  {
    name: 'wall 只增不减：用户配置大于派生底线时保留用户值',
    run: () => {
      const m: PhaseTimeoutManifestView = { ...FULL_CHAIN, budget: { wall_clock_minutes: 9000 } };
      assertEq(resolveWallClockMinutes(m), 9000, '保留用户大 wall');
    },
  },
  {
    name: 'chain_override 影响 wall 派生（短链 → 更小底线）',
    run: () => {
      const shortChain: PhaseTimeoutManifestView = {
        start_phase: 'spec',
        end_phase: 'testing',
        chain_override: ['spec', 'plan'],
        budget: { wall_clock_minutes: 1 },
        unattended: {},
      };
      const phases = resolveChainPhasesForBudget(shortChain);
      assertEq(phases.join(','), 'spec,plan', 'override 生效');
      const expected = Math.ceil((2700 + 5400) / 60) + WALL_CLOCK_BUFFER_MINUTES;
      assertEq(resolveWallClockMinutes(shortChain), expected, '短链 wall 底线');
    },
  },
  {
    name: 'start..end 闭区间推导链路（spec..review 不含 ut/testing）',
    run: () => {
      const m: PhaseTimeoutManifestView = { start_phase: 'spec', end_phase: 'review', unattended: {} };
      assertEq(resolveChainPhasesForBudget(m).join(','), 'spec,plan,coding,review', 'spec..review');
    },
  },
  {
    name: '历史 manifest 迁移：legacy 扁平 3600 + 无 phase map → 删除 → resume 走默认表',
    run: () => {
      const legacy = {
        unattended: { write_mode: 'workspace-write', approval_mode: 'never', timeout_seconds: 3600 },
      } as unknown as GoalManifest;
      applyLegacyTimeoutMigration(legacy);
      assertTrue(legacy.unattended.timeout_seconds === undefined, 'legacy 3600 应被删除');
      // 迁移后 review 走默认表 7200，而非历史 3600（修用户现场历史续跑）
      assertEq(resolvePhaseTimeoutSeconds('review', legacy as PhaseTimeoutManifestView), 7200, 'review 走默认表');
    },
  },
  {
    name: '迁移不动用户显式非 3600 值，也不动带 phase map 的',
    run: () => {
      const explicit = {
        unattended: { write_mode: 'workspace-write', approval_mode: 'never', timeout_seconds: 600 },
      } as unknown as GoalManifest;
      applyLegacyTimeoutMigration(explicit);
      assertEq(explicit.unattended.timeout_seconds, 600, '非 legacy 值保留');

      const withMap = {
        unattended: {
          write_mode: 'workspace-write',
          approval_mode: 'never',
          timeout_seconds: 3600,
          phase_timeout_seconds: { review: 9000 },
        },
      } as unknown as GoalManifest;
      applyLegacyTimeoutMigration(withMap);
      assertEq(withMap.unattended.timeout_seconds, 3600, '有 phase map 时不删 flat');
    },
  },
  {
    name: 'loadGoalManifestFile 保留用户显式 3600（迁移只针对 resume 旧 run，不动手写 --manifest）',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-manifest-'));
      try {
        const file = path.join(dir, 'manifest.yaml');
        fs.writeFileSync(
          file,
          [
            'feature: feat-x',
            'start_phase: spec',
            'end_phase: testing',
            'unattended:',
            '  write_mode: workspace-write',
            '  approval_mode: never',
            '  timeout_seconds: 3600',
          ].join('\n'),
          'utf-8',
        );
        const m = loadGoalManifestFile(file, dir);
        assertEq(m.unattended.timeout_seconds, 3600, '手写 --manifest 的显式 3600 须保留');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
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
