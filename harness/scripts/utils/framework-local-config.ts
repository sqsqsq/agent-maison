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
}

export interface FrameworkLocalConfigVision {
  image_input_override?: 'none' | 'tool_read' | 'native_attach';
  canary?: FrameworkLocalConfigVisionCanary;
}

export interface FrameworkLocalConfig {
  schema_version: string;
  agent_adapter?: string;
  toolchain?: {
    devEcoStudio?: {
      installPath?: string;
      hvigorBin?: string;
    };
  };
  vision?: FrameworkLocalConfigVision;
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
        out.toolchain = {
          devEcoStudio: {
            ...(installPath ? { installPath } : {}),
            ...(hvigorBin ? { hvigorBin } : {}),
          },
        };
      }
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
      };
    }

    if (outVision.image_input_override || outVision.canary) {
      out.vision = outVision;
    }
  }

  return out;
}

const LOCAL_TOOLCHAIN_KEYS = new Set(['devEcoStudio']);

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

export function writeLocalConfig(projectRoot: string, config: FrameworkLocalConfig): void {
  const validated = validateLocalSchema(config);
  const p = localConfigPath(projectRoot);
  fs.writeFileSync(p, `${JSON.stringify(validated, null, 2)}\n`, 'utf-8');
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
