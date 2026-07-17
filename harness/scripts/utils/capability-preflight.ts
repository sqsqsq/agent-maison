// ============================================================================
// capability-preflight.ts — 工具链能力缺口的共享 preflight（t3-min，plan e6a3c9f4 /
// openspec capability-gap-preflight）
// ----------------------------------------------------------------------------
// goal-runner（agent_invoke_start 之前）与 harness-runner（personal-setup 门口）
// **同源消费**的结构化缺口判定：
//   1. 既有 personal_prerequisites 链（resolvePhasePersonalPrerequisites +
//      ensurePersonalSetup）——路径/安装缺失类（deveco_toolchain_missing 等）；
//   2. t6 probe 深化：工具链在位但 project_compile=capability_failed 且新鲜 →
//      新显式缺口码 deveco_toolchain_capability_failed（不复用路径缺失语义）。
// 机器行为恒=输出结构化缺口+非零退出：不读 stdin、不生成任何确认 receipt、不放行。
// 「用户确认后诚实停止」的答复采集由宿主交互层（agent 对话）负责——确认仅是停止的
// 知情记录，不构成任何授权。
// 边界（b4e7a2c9 双侧写死）：只认显式前置能力码；ohos_test_sign_gap /
// ohos_test_hap_missing / device_tool_missing / device_install_failed 四个运行后
// failure_kind 永不属于本通道。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { statefilePath } from '../../config';
import type { HarnessResolvedProfile } from './types';
import { resolvePhasePersonalPrerequisites } from './phase-personal-prerequisites';
import { ensurePersonalSetup } from './personal-setup-gate';

export interface CapabilityPreflightGap {
  ok: false;
  /** 显式前置能力缺口码（deveco_toolchain_missing / deveco_toolchain_capability_failed / 配置错位类） */
  code: string;
  prerequisites: string[];
  message: string;
  /** 双出口话术①：引导安装/修复（默认路径） */
  guidance_install: string;
  /** 双出口话术②：用户确认后诚实停止（不放行；resume 恢复） */
  guidance_stop: string;
  evidence?: string[];
}

export type CapabilityPreflightResult = { ok: true } | CapabilityPreflightGap;

const STOP_GUIDANCE =
  '出口②（诚实停止）：若当前环境暂不具备该能力且你确认不在本机修复——请回复确认后停止本任务；' +
  'framework 不放行、不绕过该 phase，环境修好后用原命令 resume 继续。' +
  '（你的确认只是停止的知情记录，不构成任何降门禁授权。）';

/**
 * 共享工具链能力 preflight。缺口=结构化返回（绝不 throw 业务缺口）；
 * unknown / 能力齐备 → ok（unknown 允许一次真实编译建立状态，防首编译死锁）。
 */
export function runCapabilityPreflight(
  projectRoot: string,
  phase: string,
  resolvedProfile: HarnessResolvedProfile,
): CapabilityPreflightResult {
  const prereqs = resolvePhasePersonalPrerequisites(phase, resolvedProfile);

  const gate = ensurePersonalSetup(projectRoot, { requiredPrerequisites: prereqs });
  if (!gate.ok) {
    return {
      ok: false,
      code: gate.code ?? 'personal_setup_gap',
      prerequisites: [...prereqs],
      message: gate.message,
      guidance_install:
        '出口①（默认，修复环境）：cd framework/harness && npx ts-node scripts/check-personal-setup.ts ' +
        `--json --ensure --phase ${phase} --project-root <repo-root>；详见 framework/skills/reference/personal-setup-gate.md。`,
      guidance_stop: STOP_GUIDANCE,
    };
  }

  // t6 深化（v4）：工具链在位但真实编译已被 wrapper 归为环境能力失败（config 摘要/完整性/TTL
  // 已在探针层校验；capability_failed 恒拦截——解除仅靠配置漂移自动失效 / --ensure 人工
  // reprobe / wrapper 真实编译改写，见 toolchain-probe.ts；判定纯读，双入口天然一致）。
  if (prereqs.has('deveco_toolchain')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const probeMod = require('../../../profiles/hmos-app/harness/toolchain-probe') as {
        evaluateCapabilityGapAtPreflight: (
          root: string,
        ) => { failure_code: string; evidence: string[]; observed_at?: string } | null;
      };
      const failed = probeMod.evaluateCapabilityGapAtPreflight(projectRoot);
      if (failed) {
        return {
          ok: false,
          code: 'deveco_toolchain_capability_failed',
          prerequisites: [...prereqs],
          evidence: failed.evidence,
          message:
            `hvigor 工具链在位但真实编译持续失败并被归为环境能力问题（failure_code=${failed.failure_code}` +
            `${failed.observed_at ? `，observed_at=${failed.observed_at}` : ''}）——` +
            '这不是"改产品代码可修"的失败，重试只会烧预算。',
          guidance_install:
            '出口①（默认，修复环境）：按 hvigor 构建日志头部的 [env-diagnosis]/[next] 指引处置' +
            '（装配套 SDK / 降级 hvigor / IDE 内构建三选一，或补齐取证后重判）。修好后二选一解除拦截：' +
            'a) 修复动了工程配置/SDK/DevEco 装配 → 记录自动失效，直接 resume；' +
            'b) 其余情况跑 `check-personal-setup --ensure --phase <phase>`（人工 reprobe，' +
            'cli 可启动即重置缺口记录）再 resume——由下一次真实编译定谳。环境没修就 resume 会再次拦截。',
          guidance_stop: STOP_GUIDANCE,
        };
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'MODULE_NOT_FOUND') {
        // 可见 fail-open（cursor MAJOR）：探针模块异常≠能力缺口，但必须留痕，不得静默。
        console.warn(`[capability-preflight] toolchain-probe 探针异常（按 unknown 放行）：${(err as Error).message}`);
      }
    }
  }
  return { ok: true };
}

/** 机读 preflight 结果的持久化位置（.current-phase.json 同目录） */
export function harnessPreflightPath(projectRoot: string): string {
  return path.join(path.dirname(statefilePath(projectRoot)), '.harness-preflight.json');
}

/**
 * 持久化 + stdout 标记行（HARNESS_PREFLIGHT {json}）——goal-runner 与交互态宿主
 * 无需解析裸 console.error 即可分类（07-16 事故 A：裸报错让 goal 侧无从归因）。
 */
export function emitHarnessPreflightGap(projectRoot: string, phase: string, gap: CapabilityPreflightGap): void {
  const payload = { schema: 1, phase, at: new Date().toISOString(), ...gap };
  try {
    const p = harnessPreflightPath(projectRoot);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  } catch {
    /* best-effort：持久化失败仍有 stdout 标记行 */
  }
  console.log(`HARNESS_PREFLIGHT ${JSON.stringify(payload)}`);
}
