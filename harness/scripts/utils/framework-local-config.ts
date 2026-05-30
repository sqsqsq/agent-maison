// ============================================================================
// framework-local-config.ts — personal gitignored settings (framework.local.json)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

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
  const raw = parsed as Record<string, unknown>;
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
  if (tc && typeof tc === 'object' && !Array.isArray(tc)) {
    const deveco = (tc as Record<string, unknown>).devEcoStudio;
    if (deveco && typeof deveco === 'object' && !Array.isArray(deveco)) {
      const row = deveco as Record<string, unknown>;
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
  projectToolchain: { devEcoStudio?: { installPath?: string; hvigorBin?: string } } | undefined,
  local: FrameworkLocalConfig | null,
): { devEcoStudio?: { installPath?: string; hvigorBin?: string } } | undefined {
  const localDeveco = local?.toolchain?.devEcoStudio;
  if (!localDeveco && !projectToolchain) return undefined;
  const projectDeveco = projectToolchain?.devEcoStudio;
  const installPath = localDeveco?.installPath ?? projectDeveco?.installPath;
  const hvigorBin = localDeveco?.hvigorBin ?? projectDeveco?.hvigorBin;
  if (!installPath && !hvigorBin) {
    return projectToolchain ? { ...projectToolchain } : undefined;
  }
  return {
    ...(projectToolchain ?? {}),
    devEcoStudio: {
      ...(installPath ? { installPath } : {}),
      ...(hvigorBin ? { hvigorBin } : {}),
    },
  };
}
