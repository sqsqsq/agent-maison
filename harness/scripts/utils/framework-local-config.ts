// ============================================================================
// framework-local-config.ts — personal gitignored settings (framework.local.json)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  LOCAL_CANONICAL_TOP_KEYS,
  LOCAL_LEGACY_TOP_KEY,
} from './config-field-ownership';
import type { ToolchainConfig } from '../../config';

export const LOCAL_CONFIG_FILENAME = 'framework.local.json';
export const LOCAL_SCHEMA_VERSION = '1.0';

export interface FrameworkLocalConfig {
  schema_version: string;
  agent_adapter?: string;
  toolchain?: {
    devEcoStudio?: {
      installPath?: string;
      hvigorBin?: string;
    };
  };
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
