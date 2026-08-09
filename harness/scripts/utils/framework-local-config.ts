// ============================================================================
// framework-local-config.ts — personal gitignored settings (framework.local.json)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  LOCAL_CANONICAL_TOP_KEYS,
  LOCAL_LEGACY_TOP_KEY,
  LOCAL_VISION_KEYS,
  LOCAL_VISION_CANARY_KEYS,
  LOCAL_DEVICE_KEYS,
  LOCAL_DEVICE_UNLOCK_KEYS,
} from './config-field-ownership';
import type { ToolchainConfig } from '../../config';

export const LOCAL_CONFIG_FILENAME = 'framework.local.json';
export const LOCAL_SCHEMA_VERSION = '1.0';

/** E1：image_input_override 合法值——与 multimodal-probe.ts 的 ImageInputMode 同型
 * （framework-local-config.ts 是纯 config 层，不反向 import multimodal-probe，避免循环）。 */
const LOCAL_IMAGE_INPUT_VALUES = new Set(['none', 'tool_read', 'native_attach']);
const LOCAL_CANARY_VERDICT_VALUES = new Set(['tool_read', 'ocr_capable', 'none']);
/** I1（交互式金丝雀 plan b7e42d19）：探测来源——goal preflight 写 'goal'，交互式判卷写 'interactive'。 */
const LOCAL_CANARY_PROBED_VIA_VALUES = new Set(['goal', 'interactive']);

export interface FrameworkLocalConfigVisionCanary {
  adapter: string;
  verdict: 'tool_read' | 'ocr_capable' | 'none';
  probed_at: string;
  reason?: string;
  /** I1：探测来源；缺省视作 'goal'（向后兼容 E1 已写的无该字段缓存）。 */
  probed_via?: 'goal' | 'interactive';
  /**
   * 探测协议版本（plan c7d2e9a4）：isVisionCanaryFresh 只采信
   * VISION_CANARY_PROBE_VERSION 当前值；缺失=v1 旧缓存自动 stale（含 2026-07-12
   * 假 none 毒缓存），下一次 UI goal 自动重探——用户升级零操作。
   */
  probe_version?: number;
  // ------ visual-capability-truth S3（P0-A）：canary receipt 增维 ------
  // 20260718 事故：cursor auto 路由下"探针时模型 ≠ 各 phase 干活模型"——receipt 记录
  // 实际探测上下文，resolveEffectiveVisionContext 据此判 capability_scope：
  // model unknown 恒不超过 run_probed，且 run_probed 不跨 run（run_id 比对）。
  /** 探测时的 provider（adapter 能证则记；证不了缺省） */
  provider?: string;
  /** 探测时的模型标识；无法证明时写 'unknown'（scope 封顶 run_probed + 不跨 run 复用） */
  model?: string;
  /** 原生图片输入（native_attach 通道）是否在场 */
  native_image_input?: boolean;
  /** 图片读取工具（Read 类）是否在场 */
  image_tool_available?: boolean;
  /** 探测语境（goal_preflight / interactive / inline_phase 等自由文本） */
  probe_context?: string;
  /** 探测所属 goal run（run_probed 判级依据；interactive 探测无此字段） */
  run_id?: string;
}

export interface FrameworkLocalConfigVision {
  image_input_override?: 'none' | 'tool_read' | 'native_attach';
  canary?: FrameworkLocalConfigVisionCanary;
}

/** t6 toolchain-probe-truth（plan e6a3c9f4）：机器探测快照（写入权限固定，见 schema 注释） */
export interface FrameworkLocalToolchainProbe {
  binary?: { hvigor_bin?: string; observed_at?: string };
  cli_starts?: { ok?: boolean; hvigor_version?: string; observed_at?: string };
  project_compile?: {
    status: 'unknown' | 'verified' | 'capability_failed';
    failure_code?: string | null;
    evidence?: string[];
    invocation_fingerprint?: string;
    config_digest?: string;
    observed_at?: string;
    expires_at?: string;
    /** @deprecated v4 授予模型移除——仅为兼容旧 local 文件保留，任何逻辑不再读写 */
    recovery_probe_pending?: boolean;
    integrity?: string;
  };
  last_attempt?: { summary?: string; observed_at?: string };
  known_quirks?: string[];
}

/**
 * 设备策略（openspec device-readiness-and-completion t3/t6）——**个人级、gitignored**。
 *
 * 为何不是单个布尔：`auto_unlock=false` 区分不了「人工解锁」与「允许模拟器降级」这两个
 * 独立意图，用户拒绝自动解锁不等于拒绝模拟器。
 *
 * `credential_ref` 是 **opaque 引用**，口令本体由 OS 凭据库托管——本文件在项目根、属
 * agent 可写区，**绝不放明文口令**。
 */
export interface FrameworkLocalConfigDevice {
  unlock?: {
    mode?: 'manual' | 'credential';
    /** OS 凭据库条目的不可变引用；轮换生成新引用，不原地覆盖 */
    credential_ref?: string;
  };
  emulator_fallback?: 'disabled' | 'existing' | 'managed';
  /** 多设备时必须显式指定，否则就绪门判 AMBIGUOUS 停止求人（不赌"第一个"） */
  target_serial?: string;
  /** managed 档启动用的 AVD 名（如 "Pura 90"）；未配置则 managed 档不可用 */
  emulator_profile?: string;
}

export interface FrameworkLocalConfig {
  schema_version: string;
  agent_adapter?: string;
  toolchain?: {
    devEcoStudio?: {
      installPath?: string;
      hvigorBin?: string;
    };
    probe?: FrameworkLocalToolchainProbe;
  };
  vision?: FrameworkLocalConfigVision;
  device?: FrameworkLocalConfigDevice;
}

export type AgentAdapterSource = 'local' | 'project_legacy' | 'fallback';

export interface FrameworkPersonalSetupStatus {
  agent_adapter: string;
  source: AgentAdapterSource;
  local_exists: boolean;
  project_has_legacy_agent_adapter: boolean;
}

function validateLocalSchema(parsed: unknown): FrameworkLocalConfig {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('[framework-local-config] framework.local.json 顶层必须是对象');
  }
  const raw = { ...(parsed as Record<string, unknown>) };

  // known-legacy：setup.adapter → agent_adapter，随后删除 setup
  const legacySetup = raw[LOCAL_LEGACY_TOP_KEY];
  if (legacySetup && typeof legacySetup === 'object' && !Array.isArray(legacySetup)) {
    const adapter = (legacySetup as Record<string, unknown>).adapter;
    if (
      typeof adapter === 'string' &&
      adapter.trim() &&
      (typeof raw.agent_adapter !== 'string' || !String(raw.agent_adapter).trim())
    ) {
      raw.agent_adapter = adapter.trim();
    }
    delete raw[LOCAL_LEGACY_TOP_KEY];
  }

  const unknownTopKeys = Object.keys(raw).filter(k => !LOCAL_CANONICAL_TOP_KEYS.has(k));
  if (unknownTopKeys.length > 0) {
    throw new Error(
      `[framework-local-config] framework.local.json 含非法顶层键：${unknownTopKeys.join(', ')}`,
    );
  }

  const sv = raw.schema_version;
  if (typeof sv !== 'string' || sv.trim() !== LOCAL_SCHEMA_VERSION) {
    throw new Error(
      `[framework-local-config] schema_version 必须是 "${LOCAL_SCHEMA_VERSION}"，收到 ${String(sv)}`,
    );
  }
  const out: FrameworkLocalConfig = { schema_version: LOCAL_SCHEMA_VERSION };
  if (typeof raw.agent_adapter === 'string' && raw.agent_adapter.trim()) {
    out.agent_adapter = raw.agent_adapter.trim();
  }
  const tc = raw.toolchain;
  if (tc !== undefined) {
    if (!tc || typeof tc !== 'object' || Array.isArray(tc)) {
      throw new Error('[framework-local-config] toolchain 必须是对象');
    }
    const tcObj = tc as Record<string, unknown>;
    rejectUnknownObjectKeys(tcObj, LOCAL_TOOLCHAIN_KEYS, 'toolchain');
    const toolchainOut: NonNullable<FrameworkLocalConfig['toolchain']> = {};
    const deveco = tcObj.devEcoStudio;
    if (deveco !== undefined) {
      if (!deveco || typeof deveco !== 'object' || Array.isArray(deveco)) {
        throw new Error('[framework-local-config] toolchain.devEcoStudio 必须是对象');
      }
      const row = deveco as Record<string, unknown>;
      rejectUnknownObjectKeys(row, LOCAL_DEVECO_LEAF_KEYS, 'toolchain.devEcoStudio');
      const installPath = typeof row.installPath === 'string' ? row.installPath.trim() : '';
      const hvigorBin = typeof row.hvigorBin === 'string' ? row.hvigorBin.trim() : '';
      if (installPath || hvigorBin) {
        toolchainOut.devEcoStudio = {
          ...(installPath ? { installPath } : {}),
          ...(hvigorBin ? { hvigorBin } : {}),
        };
      }
    }
    // t6 toolchain-probe-truth：probe 机器快照——键白名单 + compile status 枚举校验后透传
    // （字段本身由 wrapper/--ensure 机器写入；这里防的是手编坏形状，不做逐叶重建）。
    const probe = tcObj.probe;
    if (probe !== undefined) {
      if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
        throw new Error('[framework-local-config] toolchain.probe 必须是对象');
      }
      const probeObj = probe as Record<string, unknown>;
      rejectUnknownObjectKeys(probeObj, LOCAL_PROBE_KEYS, 'toolchain.probe');
      const pc = probeObj.project_compile as Record<string, unknown> | undefined;
      if (pc !== undefined) {
        if (!pc || typeof pc !== 'object' || Array.isArray(pc)) {
          throw new Error('[framework-local-config] toolchain.probe.project_compile 必须是对象');
        }
        if (typeof pc.status !== 'string' || !LOCAL_PROBE_COMPILE_STATUS.has(pc.status)) {
          throw new Error(
            `[framework-local-config] toolchain.probe.project_compile.status 必须是 unknown|verified|capability_failed，收到 ${String(pc.status)}`,
          );
        }
      }
      toolchainOut.probe = probeObj as FrameworkLocalToolchainProbe;
    }
    if (Object.keys(toolchainOut).length > 0) {
      out.toolchain = toolchainOut;
    }
  }

  // E1（多模态降级阶梯 plan d4a8f3c6）：vision.image_input_override / vision.canary。
  const vision = raw.vision;
  if (vision !== undefined) {
    if (!vision || typeof vision !== 'object' || Array.isArray(vision)) {
      throw new Error('[framework-local-config] vision 必须是对象');
    }
    const visionObj = vision as Record<string, unknown>;
    rejectUnknownObjectKeys(visionObj, LOCAL_VISION_KEYS, 'vision');
    const outVision: FrameworkLocalConfigVision = {};

    const override = visionObj.image_input_override;
    if (override !== undefined) {
      if (typeof override !== 'string' || !LOCAL_IMAGE_INPUT_VALUES.has(override)) {
        throw new Error(
          `[framework-local-config] vision.image_input_override 必须是 none|tool_read|native_attach，收到 ${String(override)}`,
        );
      }
      outVision.image_input_override = override as FrameworkLocalConfigVision['image_input_override'];
    }

    const canary = visionObj.canary;
    if (canary !== undefined) {
      if (!canary || typeof canary !== 'object' || Array.isArray(canary)) {
        throw new Error('[framework-local-config] vision.canary 必须是对象');
      }
      const canaryObj = canary as Record<string, unknown>;
      rejectUnknownObjectKeys(canaryObj, LOCAL_VISION_CANARY_KEYS, 'vision.canary');
      const adapter = canaryObj.adapter;
      const verdict = canaryObj.verdict;
      const probedAt = canaryObj.probed_at;
      if (typeof adapter !== 'string' || !adapter.trim()) {
        throw new Error('[framework-local-config] vision.canary.adapter 必须是非空字符串');
      }
      if (typeof verdict !== 'string' || !LOCAL_CANARY_VERDICT_VALUES.has(verdict)) {
        throw new Error(
          `[framework-local-config] vision.canary.verdict 必须是 tool_read|ocr_capable|none，收到 ${String(verdict)}`,
        );
      }
      if (typeof probedAt !== 'string' || !probedAt.trim()) {
        throw new Error('[framework-local-config] vision.canary.probed_at 必须是非空字符串（ISO 时间戳）');
      }
      const probedVia = canaryObj.probed_via;
      if (
        probedVia !== undefined &&
        (typeof probedVia !== 'string' || !LOCAL_CANARY_PROBED_VIA_VALUES.has(probedVia))
      ) {
        throw new Error(
          `[framework-local-config] vision.canary.probed_via 必须是 goal|interactive，收到 ${String(probedVia)}`,
        );
      }
      // plan c7d2e9a4：探测协议版本——可选（缺失=v1 旧缓存，fresh 判据自会拒），
      // 但存在时必须是正整数（0/负/小数/字符串一律拒，防手写坏值）。
      const probeVersion = canaryObj.probe_version;
      if (
        probeVersion !== undefined &&
        (typeof probeVersion !== 'number' || !Number.isInteger(probeVersion) || probeVersion <= 0)
      ) {
        throw new Error(
          `[framework-local-config] vision.canary.probe_version 必须是正整数，收到 ${String(probeVersion)}`,
        );
      }
      // S3 增维字段（全可选）：string 类空串剔除、boolean 类严格布尔
      for (const k of ['provider', 'model', 'probe_context', 'run_id'] as const) {
        const v = canaryObj[k];
        if (v !== undefined && typeof v !== 'string') {
          throw new Error(`[framework-local-config] vision.canary.${k} 必须是字符串，收到 ${String(v)}`);
        }
      }
      for (const k of ['native_image_input', 'image_tool_available'] as const) {
        const v = canaryObj[k];
        if (v !== undefined && typeof v !== 'boolean') {
          throw new Error(`[framework-local-config] vision.canary.${k} 必须是布尔，收到 ${String(v)}`);
        }
      }
      outVision.canary = {
        adapter: adapter.trim(),
        verdict: verdict as FrameworkLocalConfigVisionCanary['verdict'],
        probed_at: probedAt.trim(),
        ...(typeof canaryObj.reason === 'string' && canaryObj.reason.trim()
          ? { reason: canaryObj.reason.trim() }
          : {}),
        ...(typeof probedVia === 'string' && LOCAL_CANARY_PROBED_VIA_VALUES.has(probedVia)
          ? { probed_via: probedVia as FrameworkLocalConfigVisionCanary['probed_via'] }
          : {}),
        ...(typeof probeVersion === 'number' ? { probe_version: probeVersion } : {}),
        ...(typeof canaryObj.provider === 'string' && canaryObj.provider.trim()
          ? { provider: canaryObj.provider.trim() }
          : {}),
        ...(typeof canaryObj.model === 'string' && canaryObj.model.trim()
          ? { model: canaryObj.model.trim() }
          : {}),
        ...(typeof canaryObj.native_image_input === 'boolean'
          ? { native_image_input: canaryObj.native_image_input }
          : {}),
        ...(typeof canaryObj.image_tool_available === 'boolean'
          ? { image_tool_available: canaryObj.image_tool_available }
          : {}),
        ...(typeof canaryObj.probe_context === 'string' && canaryObj.probe_context.trim()
          ? { probe_context: canaryObj.probe_context.trim() }
          : {}),
        ...(typeof canaryObj.run_id === 'string' && canaryObj.run_id.trim()
          ? { run_id: canaryObj.run_id.trim() }
          : {}),
      };
    }

    if (outVision.image_input_override || outVision.canary) {
      out.vision = outVision;
    }
  }

  // openspec device-readiness-and-completion：device 策略（个人级）。
  // 旧配置无 device 键 → out.device 保持 undefined，消费方按 manual/disabled 语义处理，
  // 行为与本改动前完全一致（round-trip 不丢字段、不臆造默认值写盘）。
  const device = raw.device;
  if (device !== undefined) {
    if (!device || typeof device !== 'object' || Array.isArray(device)) {
      throw new Error('[framework-local-config] device 必须是对象');
    }
    const deviceObj = device as Record<string, unknown>;
    rejectUnknownObjectKeys(deviceObj, LOCAL_DEVICE_KEYS, 'device');
    const outDevice: FrameworkLocalConfigDevice = {};

    const unlock = deviceObj.unlock;
    if (unlock !== undefined) {
      if (!unlock || typeof unlock !== 'object' || Array.isArray(unlock)) {
        throw new Error('[framework-local-config] device.unlock 必须是对象');
      }
      const unlockObj = unlock as Record<string, unknown>;
      // 白名单是**安全边界**：拒绝任何未知键，防手写 `pin`/`password` 之类明文口令进项目根
      rejectUnknownObjectKeys(unlockObj, LOCAL_DEVICE_UNLOCK_KEYS, 'device.unlock');
      const mode = unlockObj.mode;
      if (mode !== undefined && mode !== 'manual' && mode !== 'credential') {
        throw new Error(
          `[framework-local-config] device.unlock.mode 必须是 manual|credential，收到 ${String(mode)}`,
        );
      }
      const ref = unlockObj.credential_ref;
      if (ref !== undefined && (typeof ref !== 'string' || !ref.trim())) {
        throw new Error('[framework-local-config] device.unlock.credential_ref 必须是非空字符串');
      }
      const unlockOut: NonNullable<FrameworkLocalConfigDevice['unlock']> = {};
      if (mode === 'manual' || mode === 'credential') unlockOut.mode = mode;
      if (typeof ref === 'string' && ref.trim()) unlockOut.credential_ref = ref.trim();
      if (unlockOut.mode || unlockOut.credential_ref) outDevice.unlock = unlockOut;
    }

    const fallback = deviceObj.emulator_fallback;
    if (fallback !== undefined) {
      if (fallback !== 'disabled' && fallback !== 'existing' && fallback !== 'managed') {
        throw new Error(
          `[framework-local-config] device.emulator_fallback 必须是 disabled|existing|managed，收到 ${String(fallback)}`,
        );
      }
      outDevice.emulator_fallback = fallback;
    }

    for (const k of ['target_serial', 'emulator_profile'] as const) {
      const v = deviceObj[k];
      if (v !== undefined) {
        if (typeof v !== 'string' || !v.trim()) {
          throw new Error(`[framework-local-config] device.${k} 必须是非空字符串`);
        }
        outDevice[k] = v.trim();
      }
    }

    if (Object.keys(outDevice).length > 0) out.device = outDevice;
  }

  return out;
}

const LOCAL_TOOLCHAIN_KEYS = new Set(['devEcoStudio', 'probe']);
/** t6 toolchain-probe-truth：probe 分层键与 compile 三态（写入权限见 profiles/hmos-app/harness/toolchain-probe.ts） */
const LOCAL_PROBE_KEYS = new Set(['binary', 'cli_starts', 'project_compile', 'last_attempt', 'known_quirks']);
const LOCAL_PROBE_COMPILE_STATUS = new Set(['unknown', 'verified', 'capability_failed']);

/** personal 叶子键 SSOT（与 config-field-ownership 对齐，避免循环 import 重复声明语义） */
const LOCAL_DEVECO_LEAF_KEYS = new Set(['installPath', 'hvigorBin']);

function rejectUnknownObjectKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  pathPrefix: string,
): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `[framework-local-config] ${pathPrefix} 含非法键：${unknown.join(', ')}`,
    );
  }
}

export function localConfigPath(projectRoot: string): string {
  return path.join(projectRoot, LOCAL_CONFIG_FILENAME);
}

export function loadLocalConfig(projectRoot: string): FrameworkLocalConfig | null {
  const p = localConfigPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  const txt = fs.readFileSync(p, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(txt);
  } catch (e) {
    throw new Error(
      `[framework-local-config] framework.local.json 不是合法 JSON：${(e as Error).message}`,
    );
  }
  return validateLocalSchema(parsed);
}

/**
 * 原子写（S12）。
 *
 * 此前是裸 `writeFileSync`：进程在写入中途被杀会留下**半截 JSON**，下次加载直接抛错，
 * 用户的 adapter/凭据引用/设备策略一起丢。凭据引用切换尤其敏感——半截状态意味着
 * "指向哪个 credential_version"不可知。改为 `写临时文件 → fsync → 原子 rename`：
 * 任何时刻读到的要么是旧内容、要么是新内容，不存在中间态。
 */
export function writeLocalConfig(projectRoot: string, config: FrameworkLocalConfig): void {
  const validated = validateLocalSchema(config);
  const p = localConfigPath(projectRoot);
  const body = `${JSON.stringify(validated, null, 2)}\n`;
  const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, body, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, p);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    throw err;
  }
}

/**
 * 无损写回（事故修复四件套 plan c9f4e7a2 t1）：**唯一**的局部更新入口。
 *
 * 此前个人级配置的写盘分散在多个手写白名单 merge（personal-setup-gate mergeLocalPatch、
 * init-task-executor mergeLocal），各自只保留 agent_adapter/toolchain/vision 的**子集**，
 * 已在两起事故中把 `device`（含 `device.unlock.credential_ref`）与 `vision` 整段抹掉——
 * 凭据仍在 OS 库，框架却丢了引用。这里改为：读取完整合法配置（文件不存在时以
 * `{schema_version: LOCAL_SCHEMA_VERSION}` 为基线）→ updater 只返回目标字段修改后的
 * **完整**配置 → 复用既有 validateLocalSchema + tmp/fsync/rename 原子写。不做通用深合并、
 * 不加字段白名单、不扩展并发锁机制。
 */
export function updateLocalConfig(
  projectRoot: string,
  updater: (current: FrameworkLocalConfig) => FrameworkLocalConfig,
): void {
  const current = loadLocalConfig(projectRoot) ?? { schema_version: LOCAL_SCHEMA_VERSION };
  const next = updater(current);
  writeLocalConfig(projectRoot, next);
  // 延迟 require 避免与 config.ts 的运行时循环依赖（config.ts 静态 import 本模块）。
  const { clearFrameworkConfigCache } = require('../../config') as typeof import('../../config');
  clearFrameworkConfigCache();
}

export function resolveAgentAdapterSource(
  projectRoot: string,
  projectRaw: Record<string, unknown> | null,
  local: FrameworkLocalConfig | null,
  fallbackAdapter: string,
): FrameworkPersonalSetupStatus {
  const projectLegacy =
    projectRaw !== null &&
    typeof projectRaw.agent_adapter === 'string' &&
    projectRaw.agent_adapter.trim().length > 0;

  if (local?.agent_adapter) {
    return {
      agent_adapter: local.agent_adapter,
      source: 'local',
      local_exists: true,
      project_has_legacy_agent_adapter: projectLegacy,
    };
  }
  if (projectLegacy) {
    return {
      agent_adapter: String(projectRaw!.agent_adapter).trim(),
      source: 'project_legacy',
      local_exists: local !== null,
      project_has_legacy_agent_adapter: true,
    };
  }
  return {
    agent_adapter: fallbackAdapter,
    source: 'fallback',
    local_exists: local !== null,
    project_has_legacy_agent_adapter: false,
  };
}

export function mergeLocalIntoToolchain(
  projectToolchain: ToolchainConfig | undefined,
  local: FrameworkLocalConfig | null,
): ToolchainConfig | undefined {
  const base: ToolchainConfig = projectToolchain ? { ...projectToolchain } : {};
  // fail-closed：runtime 绝不从 project config 回退读取 personal 路径
  delete base.devEcoStudio;

  const localDeveco = local?.toolchain?.devEcoStudio;
  if (localDeveco) {
    const installPath =
      typeof localDeveco.installPath === 'string' ? localDeveco.installPath.trim() : '';
    const hvigorBin =
      typeof localDeveco.hvigorBin === 'string' ? localDeveco.hvigorBin.trim() : '';
    if (installPath || hvigorBin) {
      base.devEcoStudio = {
        ...(installPath ? { installPath } : {}),
        ...(hvigorBin ? { hvigorBin } : {}),
      };
    }
  }

  return Object.keys(base).length > 0 ? base : undefined;
}
