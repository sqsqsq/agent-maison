// ============================================================================
// personal-setup-gate.ts — feature phase 前 personal setup 完整门控
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  clearFrameworkConfigCache,
  getFrameworkPersonalSetupStatus,
  loadFrameworkConfigWithSources,
  type FrameworkPersonalSetupStatus,
} from '../../config';
import { __testing as checkInitTesting } from '../check-init';
import {
  LOCAL_SCHEMA_VERSION,
  loadLocalConfig,
  writeLocalConfig,
  type FrameworkLocalConfig,
} from './framework-local-config';

const { loadAdapter } = checkInitTesting;

/** 与 init-task-executor mergeLocal 一致：保留既有 toolchain 等字段 */
function mergeLocalPatch(
  projectRoot: string,
  patch: Partial<FrameworkLocalConfig>,
): FrameworkLocalConfig {
  const existing = loadLocalConfig(projectRoot);
  const base: FrameworkLocalConfig = existing ?? { schema_version: LOCAL_SCHEMA_VERSION };
  const next: FrameworkLocalConfig = {
    schema_version: LOCAL_SCHEMA_VERSION,
    ...(base.agent_adapter ? { agent_adapter: base.agent_adapter } : {}),
    ...(base.toolchain ? { toolchain: { ...base.toolchain } } : {}),
  };
  if (patch.agent_adapter) next.agent_adapter = patch.agent_adapter;
  if (patch.toolchain?.devEcoStudio) {
    next.toolchain = {
      ...(next.toolchain ?? {}),
      devEcoStudio: {
        ...(next.toolchain?.devEcoStudio ?? {}),
        ...patch.toolchain.devEcoStudio,
      },
    };
  }
  return next;
}

export type PersonalSetupGateFailureCode =
  | 'fallback'
  | 'not_in_materialized'
  | 'entry_not_materialized'
  | 'needs_adapter_choice'
  | 'no_materialized_adapter';

export type PersonalSetupEnsureCode =
  | 'ok'
  | PersonalSetupGateFailureCode;

export type PersonalSetupGateResult =
  | {
      ok: true;
      status: FrameworkPersonalSetupStatus;
      activeAdapter: string;
      materializedAdapters: string[];
    }
  | {
      ok: false;
      code: PersonalSetupGateFailureCode;
      message: string;
      status: FrameworkPersonalSetupStatus;
      activeAdapter: string;
      materializedAdapters: string[];
    };

/** `--json --ensure` 稳定输出契约 */
export interface PersonalSetupEnsureJson {
  ok: boolean;
  code: PersonalSetupEnsureCode;
  status: FrameworkPersonalSetupStatus;
  activeAdapter: string;
  materializedAdapters: string[];
  ensured: 'auto_single_adapter' | null;
  candidates: string[];
  message: string;
}

/** 项目级 materialized 列表（不含 local merge） */
export function resolveProjectMaterializedForGate(
  projectRoot: string,
): string[] {
  const sources = loadFrameworkConfigWithSources(projectRoot);
  const raw = sources.projectRaw;
  const fromProject = Array.isArray(raw?.materialized_adapters)
    ? raw!.materialized_adapters.filter(
        (a): a is string => typeof a === 'string' && a.trim().length > 0,
      )
    : [];
  if (fromProject.length > 0) return fromProject.map(a => a.trim());
  const legacy =
    typeof raw?.agent_adapter === 'string' ? raw.agent_adapter.trim() : '';
  return legacy ? [legacy] : [];
}

export function adapterEntryExists(projectRoot: string, adapterName: string): boolean {
  const adapter = loadAdapter(adapterName);
  if (!adapter.entryFile) return false;
  return fs.existsSync(path.join(projectRoot, adapter.entryFile.targetRel));
}

function gateResultToEnsureJson(
  result: PersonalSetupGateResult,
  ensured: PersonalSetupEnsureJson['ensured'] = null,
  candidates: string[] = [],
): PersonalSetupEnsureJson {
  if (result.ok) {
    return {
      ok: true,
      code: 'ok',
      status: result.status,
      activeAdapter: result.activeAdapter,
      materializedAdapters: result.materializedAdapters,
      ensured,
      candidates,
      message: ensured === 'auto_single_adapter'
        ? `已自动写入 framework.local.json agent_adapter=${result.activeAdapter}`
        : 'personal setup 已就绪',
    };
  }
  return {
    ok: false,
    code: result.code,
    status: result.status,
    activeAdapter: result.activeAdapter,
    materializedAdapters: result.materializedAdapters,
    ensured: null,
    candidates,
    message: result.message,
  };
}

/** feature phase / Skill bootstrap 用：fallback、membership、入口产物三重校验 */
export function evaluatePersonalSetupGate(projectRoot: string): PersonalSetupGateResult {
  const status = getFrameworkPersonalSetupStatus(projectRoot);
  const activeAdapter = status.agent_adapter;
  const materializedAdapters = resolveProjectMaterializedForGate(projectRoot);

  if (status.source === 'fallback') {
    return {
      ok: false,
      code: 'fallback',
      status,
      activeAdapter,
      materializedAdapters,
      message:
        '未检测到个人 Framework 设置（framework.local.json 或 legacy agent_adapter）。' +
        '请由阶段入口执行 check-personal-setup.ts --ensure 完成个人配置。',
    };
  }

  if (
    materializedAdapters.length > 0 &&
    !materializedAdapters.includes(activeAdapter)
  ) {
    return {
      ok: false,
      code: 'not_in_materialized',
      status,
      activeAdapter,
      materializedAdapters,
      message:
        `active adapter "${activeAdapter}" 不在项目 materialized_adapters` +
        ` [${materializedAdapters.join(', ')}]；请改选已物化项或先跑 /framework-init 物化。`,
    };
  }

  if (!adapterEntryExists(projectRoot, activeAdapter)) {
    const adapter = loadAdapter(activeAdapter);
    const entryRel = adapter.entryFile?.targetRel ?? '<unknown>';
    return {
      ok: false,
      code: 'entry_not_materialized',
      status,
      activeAdapter,
      materializedAdapters,
      message:
        `adapter ${activeAdapter} 入口产物未物化（缺 ${entryRel}）；` +
        '请先跑项目级 /framework-init。',
    };
  }

  return {
    ok: true,
    status,
    activeAdapter,
    materializedAdapters,
  };
}

/**
 * 确定性 ensure：单一物化 adapter 自动写 local；多 adapter 返回 needs_adapter_choice；
 * 零 adapter 返回 no_materialized_adapter。
 */
export function ensurePersonalSetup(projectRoot: string): PersonalSetupEnsureJson {
  const first = evaluatePersonalSetupGate(projectRoot);
  if (first.ok) {
    return gateResultToEnsureJson(first);
  }

  const { status, materializedAdapters } = first;

  if (first.code === 'fallback') {
    if (materializedAdapters.length === 0) {
      return gateResultToEnsureJson({
        ok: false,
        code: 'no_materialized_adapter',
        status,
        activeAdapter: first.activeAdapter,
        materializedAdapters,
        message:
          '项目尚未物化任何 adapter（materialized_adapters 为空）。' +
          '请先执行 /framework-init 物化至少一个 adapter。',
      });
    }

    if (materializedAdapters.length === 1) {
      const only = materializedAdapters[0]!;
      if (!adapterEntryExists(projectRoot, only)) {
        const adapter = loadAdapter(only);
        const entryRel = adapter.entryFile?.targetRel ?? '<unknown>';
        return gateResultToEnsureJson({
          ok: false,
          code: 'entry_not_materialized',
          status,
          activeAdapter: only,
          materializedAdapters,
          message:
            `adapter ${only} 入口产物未物化（缺 ${entryRel}）；请先跑 /framework-init。`,
        });
      }
      writeLocalConfig(
        projectRoot,
        mergeLocalPatch(projectRoot, { agent_adapter: only }),
      );
      clearFrameworkConfigCache();
      const after = evaluatePersonalSetupGate(projectRoot);
      if (!after.ok) {
        return gateResultToEnsureJson(after);
      }
      return gateResultToEnsureJson(after, 'auto_single_adapter');
    }

    const candidates = materializedAdapters.filter(a => adapterEntryExists(projectRoot, a));
    if (candidates.length === 0) {
      return gateResultToEnsureJson({
        ok: false,
        code: 'entry_not_materialized',
        status,
        activeAdapter: first.activeAdapter,
        materializedAdapters,
        message:
          `materialized_adapters [${materializedAdapters.join(', ')}] 均无入口产物；` +
          '请先跑 /framework-init 物化 adapter 入口文件。',
      });
    }
    return gateResultToEnsureJson(
      {
        ok: false,
        code: 'needs_adapter_choice',
        status,
        activeAdapter: first.activeAdapter,
        materializedAdapters,
        message:
          `检测到 ${candidates.length} 个可选 adapter，须选择 active adapter` +
          `（registry setup.adapter）；选择后由 init-orchestrate record-adapter 写盘。`,
      },
      null,
      candidates,
    );
  }

  return gateResultToEnsureJson(first);
}

export function formatPersonalSetupGateStderr(
  result: Extract<PersonalSetupGateResult, { ok: false }>,
): string {
  const lines = [
    `[check-personal-setup] ${result.message}`,
    '  项目级 adapter 物化请用 /framework-init；个人配置由阶段入口 --ensure 内联完成（见 personal-setup-gate.md）。',
  ];
  return `${lines.join('\n')}\n`;
}
