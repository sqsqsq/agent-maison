// ============================================================================
// personal-setup-gate.ts — feature phase 前 personal setup 完整门控
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  getFrameworkPersonalSetupStatus,
  loadFrameworkConfigWithSources,
  type FrameworkPersonalSetupStatus,
} from '../../config';
import { __testing as checkInitTesting } from '../check-init';

const { loadAdapter } = checkInitTesting;

export type PersonalSetupGateFailureCode =
  | 'fallback'
  | 'not_in_materialized'
  | 'entry_not_materialized';

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

function adapterEntryExists(projectRoot: string, adapterName: string): boolean {
  const adapter = loadAdapter(adapterName);
  if (!adapter.entryFile) return false;
  return fs.existsSync(path.join(projectRoot, adapter.entryFile.targetRel));
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
        '请先执行 /framework-setup（Skill 00b）写入 agent_adapter。',
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

export function formatPersonalSetupGateStderr(result: Extract<PersonalSetupGateResult, { ok: false }>): string {
  const lines = [
    `[check-personal-setup] ${result.message}`,
    '  项目级 adapter 物化请用 /framework-init；个人选用 /framework-setup，二者职责分离。',
  ];
  return `${lines.join('\n')}\n`;
}
