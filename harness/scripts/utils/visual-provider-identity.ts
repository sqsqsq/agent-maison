// ============================================================================
// visual-provider-identity.ts — 只读视觉 provider 的身份解析（plan ab072691 t1③）
// ============================================================================
// 三形态入口的**共享判定层**：普通交互态 / attended goal / 无人值守 三条路径读的是
// 同一份状态与同一份支持列表，绝不各算一遍。
//
// 分工红线：
//  · **支持资格**唯一来自 `agents/<adapter>/adapter.yaml.visual_provider` 完整声明
//    （adapter-catalog 派生）。本模块不维护任何 adapter 名单。
//  · **形状合法性**由 framework-local-config 在读盘时把关（adapter/model 非空）。
//  · 本模块只回答「这份配置现在能不能用」以及「按输入形态该怎么处置」。
//
// 处置矩阵：
//   普通交互态 / attended goal ：local 缺失或 unsupported → 可提示配置 provider；
//   无人值守                   ：不询问；旧 local 命中 unsupported → WARN + 忽略。
//   显式 CLI                   ：unsupported → fail-fast，并列出 catalog 派生的支持项。
// 三条路径都**不自动改选**其它 adapter、**不在多个 provider 间 fallback**。
// 能力不足是否阻断由 requirement strictness + capability preflight 决定，不存在盲跑授权。
// ============================================================================

import {
  formatVisualProviderSupportList,
  isVisualProviderSupported,
  listVisualProviderAdapterNames,
} from './adapter-catalog';
import { loadLocalConfig, type FrameworkLocalConfig } from './framework-local-config';
import { readGoalVisualProviderEnv } from './phase-state';
import type { ProviderRef, VisionMode } from './types';

export type VisualProviderLocalState =
  /** framework.local.json 没有 vision.visual_provider */
  | { kind: 'absent' }
  /** 有配置，且其 adapter 在 catalog 派生支持列表内 */
  | { kind: 'ok'; ref: ProviderRef }
  /** 有配置，但其 adapter 无完整 visual_provider 声明（含声明残缺/字段非法） */
  | { kind: 'unsupported'; ref: ProviderRef; reason: string };

/**
 * 读个人级配置里的 provider 身份并判资格。
 *
 * 入参是**已加载**的 local config（不是 projectRoot）——本模块不碰文件 IO，调用方本就
 * 都已经持有 local config，重复读盘只会制造「读到两份不同快照」的缝。
 */
export function resolveVisualProviderFromLocal(
  local: FrameworkLocalConfig | null | undefined,
  frameworkRoot: string,
): VisualProviderLocalState {
  const raw = local?.vision?.visual_provider;
  if (!raw) return { kind: 'absent' };
  const ref: ProviderRef = { adapter: raw.adapter, model: raw.model };
  if (isVisualProviderSupported(frameworkRoot, ref.adapter)) return { kind: 'ok', ref };
  return {
    kind: 'unsupported',
    ref,
    reason: `adapter ${ref.adapter} 无完整 visual_provider 声明`,
  };
}

/** 交互两态（普通交互 / attended goal）是否该提示一次：local 缺失**或**现有 adapter 失去资格。 */
export function shouldPromptForVisualProvider(state: VisualProviderLocalState): boolean {
  return state.kind !== 'ok';
}

/**
 * 交互提示文案（普通交互态与 attended goal **共用同一句**）。
 * 支持项一律现算自 catalog——任何硬编码名单都会在第四个 adapter 接入时变成谎言。
 */
export function formatVisualProviderPrompt(
  state: VisualProviderLocalState,
  frameworkRoot: string,
): string | null {
  if (state.kind === 'ok') return null;
  const supported = formatVisualProviderSupportList(frameworkRoot);
  if (state.kind === 'absent') {
    return (
      '本轮主模型无视觉能力。可指定一个**只读**视觉 provider（第二 endpoint，只看图产评审，' +
      `绝不写工程）。当前支持：${supported}。请选择 adapter 与该 endpoint 的模型标识，` +
      '也可保持未配置；严格视觉需求会由 capability 门禁诚实 defer。'
    );
  }
  return (
    `adapter ${state.ref.adapter} 暂未接入视觉 provider。当前支持：${supported}。` +
    '请重新选择或保持未配置；严格视觉需求会由 capability 门禁诚实 defer。'
  );
}

/**
 * 无人值守 provider 身份解析：**不询问**。
 * 旧 local 命中 unsupported → 返回 warning 供调用方 WARN 一次并忽略该配置。是否允许
 * 随后是否可继续由 requirement strictness + capability preflight 统一裁决。
 */
export function resolveUnattendedVisualProviderPin(
  local: FrameworkLocalConfig | null | undefined,
  frameworkRoot: string,
): { pin?: ProviderRef; warning?: string } {
  const state = resolveVisualProviderFromLocal(local, frameworkRoot);
  if (state.kind === 'ok') return { pin: state.ref };
  if (state.kind === 'absent') return {};
  return {
    warning:
      `[visual-provider] WARN: framework.local.json 记录的视觉 provider adapter=${state.ref.adapter} ` +
      `暂未接入（${state.reason}）——已忽略该配置。` +
      `当前支持：${formatVisualProviderSupportList(frameworkRoot)}。` +
      '（无人值守不询问、不自动改选、不 fallback；严格视觉需求会由 capability 门禁诚实 defer。）',
  };
}

// ---------------------------------------------------------------------------
// plan ab072691 t2①：vision_mode 三态派生（**纯函数**——不读盘、不探测、不 spawn）
// ---------------------------------------------------------------------------

export interface VisionModeInput {
  /** primary 执行身份是否能看图（既有三层解析链的结论，语义与 hasVision 逐字一致） */
  primaryHasVision: boolean;
  /** 本 run 冻结的 provider 身份（manifest pin / 交互态 local）；缺省=没配 */
  providerPin?: ProviderRef;
  /**
   * provider **静态资格**：其 adapter 是否有完整 `visual_provider` 声明。
   * 由调用方查 adapter catalog 后传入——本函数保持纯度，也避免在热路径反复扫盘。
   * **不存在「provider 金丝雀」**：真实调用即探测，这里只做静态判定。
   */
  providerEligible: boolean;
}

export function resolveVisionMode(input: VisionModeInput): VisionMode {
  // native 优先：primary 自己能看图时根本不需要委托，现状链零变化。
  if (input.primaryHasVision) return 'native';
  if (input.providerPin && input.providerEligible) return 'delegated';
  return 'blind';
}

/** 便捷壳：从 frameworkRoot 现算静态资格后派生（调用方无需自己查 catalog）。 */
export function resolveVisionModeForRun(
  frameworkRoot: string,
  primaryHasVision: boolean,
  providerPin?: ProviderRef,
): VisionMode {
  return resolveVisionMode({
    primaryHasVision,
    providerPin,
    providerEligible: Boolean(providerPin && isVisualProviderSupported(frameworkRoot, providerPin.adapter)),
  });
}

/**
 * 钳制用的**评审轴**取值：native/delegated 都有「能看图的检查者」，blind 没有。
 * 唯一产生 `FidelityCapability.reviewVision` 的地方——不得在各消费点各判一遍。
 */
export function reviewVisionForMode(mode: VisionMode): boolean {
  return mode !== 'blind';
}

/**
 * plan ab072691 t5①：**gate 进程**里解析本轮生效的 provider 身份。
 *
 * 优先级：goal 态 env 冻结值（manifest 单点裁决后由 runner 注入）> 个人级 local。
 * 两条路都**不重新裁决、不询问、不 fallback**——gate 只消费已经定下来的身份。
 */
export function resolveActiveVisualProvider(
  projectRoot: string,
  frameworkRoot: string,
): { pin?: ProviderRef; warning?: string } {
  const fromEnv = readGoalVisualProviderEnv();
  if (fromEnv) return { pin: fromEnv };
  try {
    return resolveUnattendedVisualProviderPin(loadLocalConfig(projectRoot), frameworkRoot);
  } catch (e) {
    // local 损坏由既有 config 加载链负责报错——本函数在 gate 热路径上，**不得**因它抛异常
    // （那会把「没有 provider」升级成「门禁崩了」）。这里只诚实降级为「未配置」。
    return { warning: `[visual-provider] 读取个人级配置失败，本轮按未配置处理：${(e as Error).message}` };
  }
}

/**
 * 显式 CLI 输入的资格断言：**fail-fast**。
 * 静默忽略一个用户明确给出的输入是最坏的形态——宁可停在启动处，也不要让 run 悄悄跑成 blind。
 */
export function assertVisualProviderCliSupported(
  frameworkRoot: string,
  ref: ProviderRef,
): void {
  if (isVisualProviderSupported(frameworkRoot, ref.adapter)) return;
  const supported = listVisualProviderAdapterNames(frameworkRoot);
  throw new Error(
    `[goal-runner] BLOCKER: --visual-adapter ${ref.adapter} 暂未接入视觉 provider` +
    `（无完整 agents/${ref.adapter}/adapter.yaml visual_provider 声明）。` +
    `当前支持：${supported.length > 0 ? supported.join('、') : '（无）'}。` +
    '请改用受支持的 adapter 或移除这对参数；严格视觉需求会由 capability 门禁诚实 defer。' +
    '框架不会替你改选，也不会在多个 provider 之间 fallback。',
  );
}
