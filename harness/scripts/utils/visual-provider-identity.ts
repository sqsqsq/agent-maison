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
// 处置矩阵（plan ab072691 t1③ + t7 冻结，不得扩面）：
//   普通交互态 / attended goal ：local 缺失或 unsupported → 提示一次，可重选、可跳过；
//                                跳过=本操作明确盲跑授权，**不重复问**。
//   无人值守                   ：不询问；旧 local 命中 unsupported → WARN + 忽略；
//                                UI+primary blind 时须 provider 或 run 级明确授权。
//   显式 CLI                   ：unsupported → fail-fast，并列出 catalog 派生的支持项。
// 三条路径都**不自动改选**其它 adapter、**不在多个 provider 间 fallback**。
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
      '或明确选择“跳过并盲跑”（只授权当前操作，不写入个人配置）。'
    );
  }
  return (
    `adapter ${state.ref.adapter} 暂未接入视觉 provider。当前支持：${supported}。` +
    '请重新选择，或明确选择“跳过并盲跑”（只授权当前操作）。'
  );
}

/**
 * 无人值守 provider 身份解析：**不询问**。
 * 旧 local 命中 unsupported → 返回 warning 供调用方 WARN 一次并忽略该配置。是否允许
 * 随后以 blind 启动，统一交给 t7 的 launch decision（非 UI / run 级授权才放行）。
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
      '（无人值守不询问、不自动改选、不 fallback；UI 需求下请配置受支持的 provider，' +
      '或用 --allow-blind-visual 明确授权本 run 盲跑。）',
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

// ---------------------------------------------------------------------------
// plan ab072691 t7：UI blind 启动的一次性授权（纯决策，无 IO / spawn / 状态写入）
// ---------------------------------------------------------------------------

export interface BlindVisualLaunchInput extends VisionModeInput {
  /** 需求是否 UI 相关（唯一来源：resolveUiRelevanceForRun） */
  uiRelevant: boolean;
  /** manifest 冻结的 run 级明确盲跑授权 */
  allowBlindVisual: boolean;
}

export type BlindVisualLaunchDecision =
  | { kind: 'allow'; branch: 'non_ui' | 'native' | 'delegated' | 'blind_authorized' }
  | { kind: 'block'; branch: 'blind_unauthorized' };

/**
 * 冻结五分支启动矩阵。非 UI 分支最先返回，因而**不消费 provider 或授权**；其余分支
 * 复用 resolveVisionMode 的 primary/provider 路由真源，不从 canary probeResult 另建事实。
 */
export function resolveBlindVisualLaunchDecision(
  input: BlindVisualLaunchInput,
): BlindVisualLaunchDecision {
  if (!input.uiRelevant) return { kind: 'allow', branch: 'non_ui' };
  const mode = resolveVisionMode(input);
  if (mode === 'native') return { kind: 'allow', branch: 'native' };
  if (mode === 'delegated') return { kind: 'allow', branch: 'delegated' };
  if (input.allowBlindVisual) return { kind: 'allow', branch: 'blind_authorized' };
  return { kind: 'block', branch: 'blind_unauthorized' };
}

/** 便捷壳：provider 资格仍只从 adapter catalog 动态派生，不建立第二份支持名单。 */
export function resolveBlindVisualLaunchDecisionForRun(input: {
  frameworkRoot: string;
  uiRelevant: boolean;
  primaryHasVision: boolean;
  providerPin?: ProviderRef;
  allowBlindVisual: boolean;
}): BlindVisualLaunchDecision {
  return resolveBlindVisualLaunchDecision({
    uiRelevant: input.uiRelevant,
    primaryHasVision: input.primaryHasVision,
    providerPin: input.providerPin,
    providerEligible: Boolean(
      input.providerPin && isVisualProviderSupported(input.frameworkRoot, input.providerPin.adapter),
    ),
    allowBlindVisual: input.allowBlindVisual,
  });
}

export type BlindVisualLaunchBlockerContext = 'runner' | 'attended_prepare' | 'attended_attach';

/** BLOCKER / dry-run WARN 共用正文；支持项继续消费 catalog，禁止文案硬编码名单。 */
export function formatBlindVisualLaunchBlocker(
  frameworkRoot: string,
  context: BlindVisualLaunchBlockerContext = 'runner',
): string {
  const summary =
    'UI 相关需求的 primary 无视觉能力，且本 run 没有合法 visual provider 或明确盲跑授权。' +
    `当前可配置的 provider：${formatVisualProviderSupportList(frameworkRoot)}。`;
  if (context === 'attended_prepare') {
    return (
      summary +
      '本次 prepare 尚未创建 manifest/run-control。请先完成 interactive vision canary；若实测仍为 blind，' +
      '通过 record-visual-provider 配置受支持的 provider 后重新 prepare，或在 --prepare-run 命令中加 ' +
      '--allow-blind-visual 明确授权这个新 run。'
    );
  }
  if (context === 'attended_attach') {
    return (
      summary +
      '这是 attach 阶段的防御性断言；attach 不会修改已冻结 manifest。请完成 interactive vision canary，' +
      '并用合法 provider 或 --allow-blind-visual 在 --prepare-run 阶段创建一个满足启动契约的新 run。'
    );
  }
  return (
    summary +
    '恢复方式须区分 run 身份：新 run 可先通过 record-visual-provider 修改 framework.local.json 后重新启动，' +
    '或在新启动命令中加 --allow-blind-visual；继续当前 run 时，单独修改 framework.local.json 不会更新已冻结 manifest，' +
    '必须在 resume 命令中显式传 --visual-adapter <adapter> --visual-model <model>，或传 --allow-blind-visual，' +
    '并同时加 --override-manifest。'
  );
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
    '请改用受支持的 adapter；若 UI 需求确要无 provider 盲跑，请移除这对参数并显式加 ' +
    '--allow-blind-visual' +
    '——框架不会替你改选，也不会在多个 provider 之间 fallback。',
  );
}
