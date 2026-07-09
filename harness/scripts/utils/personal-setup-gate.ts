// ============================================================================
// personal-setup-gate.ts — feature phase 前 personal setup 完整门控
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  clearFrameworkConfigCache,
  deriveHvigorBinFromInstallPath,
  getFrameworkPersonalSetupStatus,
  loadDevEcoConfig,
  loadFrameworkConfig,
  loadFrameworkConfigWithSources,
  type FrameworkPersonalSetupStatus,
} from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { __testing as checkInitTesting } from '../check-init';
import { detectScan, type DetectScanReport } from '../detect-deveco';
import {
  evaluateConfigPlacementGate,
  formatConfigPlacementGateStderr,
} from './config-placement-gate';
import {
  LOCAL_SCHEMA_VERSION,
  loadLocalConfig,
  writeLocalConfig,
  type FrameworkLocalConfig,
} from './framework-local-config';
import type { PersonalPrerequisiteId } from './phase-personal-prerequisites';
import { resolvePhasePersonalPrerequisites } from './phase-personal-prerequisites';

const { loadAdapter } = checkInitTesting;

const MAX_ENSURE_REPAIR_STEPS = 4;

type DetectScanFn = () => DetectScanReport;
let detectScanForEnsure: DetectScanFn = detectScan;

/** 单测注入 detect-deveco 结果，避免依赖本机 DevEco 安装 */
export function __testing_setDetectScanForEnsure(fn: DetectScanFn | null): void {
  detectScanForEnsure = fn ?? detectScan;
}

/**
 * 与 init-task-executor mergeLocal 一致：保留既有 toolchain 等字段。
 * vision 无感保留（I1 修复 plan b7e42d19）：原实现只 spread agent_adapter/toolchain，
 * --ensure 一跑就把 goal/交互式金丝雀写入的 vision.canary 整段抹掉——探测缓存本应无感
 * 持久，此处按 patch 优先、否则保留 base 的既有 vision。
 */
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
    ...(base.vision ? { vision: { ...base.vision } } : {}),
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
  if (patch.vision) {
    next.vision = { ...(next.vision ?? {}), ...patch.vision };
  }
  return next;
}

/**
 * 确定性把运行身份写入 framework.local.json（与 fallback 修复 / record-adapter 同一机制）。
 * goal-mode `--override-adapter` 的唯一合法写盘路径走此处。
 */
export function recordAdapterToLocal(projectRoot: string, adapter: string): void {
  writeLocalConfig(projectRoot, mergeLocalPatch(projectRoot, { agent_adapter: adapter }));
  clearFrameworkConfigCache();
}

export type PersonalSetupGateFailureCode =
  | 'fallback'
  | 'not_in_materialized'
  | 'entry_not_materialized'
  | 'needs_adapter_choice'
  | 'no_materialized_adapter'
  | 'misconfigured_personal_fields'
  | 'deveco_toolchain_missing';

export type PersonalSetupEnsureCode =
  | 'ok'
  | 'adapter_conflict'
  | PersonalSetupGateFailureCode;

export interface PersonalSetupGateOptions {
  /** init / migrate-config / personal orchestrate 豁免错位检测 */
  placementExempt?: boolean;
  /** phase / goal chain 要求的 personal prerequisite 并集 */
  requiredPrerequisites?: Set<PersonalPrerequisiteId>;
  /** goal-mode / CLI --select-adapter：多 adapter 时确定性写入 active adapter */
  selectAdapter?: string;
}

/** `--ensure` 用：有 --phase 时按 phase capability 并集；无 phase 时仅 agent_adapter（init 兼容） */
export function resolveEnsurePrerequisites(
  projectRoot: string,
  phase?: string,
): Set<PersonalPrerequisiteId> {
  if (!phase?.trim()) {
    return new Set<PersonalPrerequisiteId>(['agent_adapter']);
  }
  const cfg = loadFrameworkConfig(projectRoot);
  const resolved = loadResolvedProfile(projectRoot, cfg);
  return resolvePhasePersonalPrerequisites(phase.trim(), resolved);
}

function isDevecoToolchainReady(projectRoot: string): boolean {
  const cfg = loadDevEcoConfig(projectRoot);
  if (!cfg) return false;
  if (cfg.hvigorBin) {
    return fs.existsSync(cfg.hvigorBin);
  }
  if (cfg.installPath) {
    const derived = deriveHvigorBinFromInstallPath(cfg.installPath);
    return Boolean(derived && fs.existsSync(derived));
  }
  return false;
}

function ensureDevecoToolchain(projectRoot: string): { ok: boolean; message: string; ensured?: 'auto_detect_deveco' } {
  if (isDevecoToolchainReady(projectRoot)) {
    return { ok: true, message: 'deveco toolchain 已就绪' };
  }
  const report = detectScanForEnsure();
  if (report.recommended?.status === 'ok' && report.recommended.installPath) {
    writeLocalConfig(
      projectRoot,
      mergeLocalPatch(projectRoot, {
        toolchain: { devEcoStudio: { installPath: report.recommended.installPath } },
      }),
    );
    clearFrameworkConfigCache();
    if (isDevecoToolchainReady(projectRoot)) {
      return {
        ok: true,
        message: `已自动探测并写入 framework.local.json installPath=${report.recommended.installPath}`,
        ensured: 'auto_detect_deveco',
      };
    }
  }
  return {
    ok: false,
    message:
      'DevEco 工具链未就绪（framework.local.json > toolchain.devEcoStudio）。' +
      '请执行 check-personal-setup --ensure 或 personal setup detect-deveco / record-deveco-path。',
  };
}

function misconfiguredPlacementResult(
  status: FrameworkPersonalSetupStatus,
  activeAdapter: string,
  materializedAdapters: string[],
): Extract<PersonalSetupGateResult, { ok: false }> {
  return {
    ok: false,
    code: 'misconfigured_personal_fields',
    status,
    activeAdapter,
    materializedAdapters,
    message:
      'framework.config.json 含 personal 字段（agent_adapter 或 toolchain.devEcoStudio）。' +
      '修复须两步串行：① init UPDATE / migrate-config 清场并外迁；② check-personal-setup --ensure 写 local。',
  };
}

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
  ensured: PersonalSetupEnsuredAction | null;
  candidates: string[];
  message: string;
}

export type PersonalSetupEnsuredAction =
  | 'auto_single_adapter'
  | 'auto_selected_adapter'
  | 'auto_detect_deveco'
  | 'auto_single_adapter_and_deveco'
  | 'auto_selected_adapter_and_deveco';

type EnsureRepairStep =
  | 'auto_single_adapter'
  | 'auto_selected_adapter'
  | 'auto_detect_deveco';

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

function combineEnsuredActions(steps: EnsureRepairStep[]): PersonalSetupEnsuredAction | null {
  const hasSelected = steps.includes('auto_selected_adapter');
  const hasSingle = steps.includes('auto_single_adapter');
  const hasDeveco = steps.includes('auto_detect_deveco');
  if (hasSelected && hasDeveco) return 'auto_selected_adapter_and_deveco';
  if (hasSingle && hasDeveco) return 'auto_single_adapter_and_deveco';
  if (hasSelected) return 'auto_selected_adapter';
  if (hasSingle) return 'auto_single_adapter';
  if (hasDeveco) return 'auto_detect_deveco';
  return null;
}

function formatEnsuredOkMessage(
  ensured: PersonalSetupEnsuredAction | null,
  activeAdapter: string,
): string {
  if (ensured === 'auto_single_adapter') {
    return `已自动写入 framework.local.json agent_adapter=${activeAdapter}`;
  }
  if (ensured === 'auto_selected_adapter') {
    return `已按 --select-adapter 写入 framework.local.json agent_adapter=${activeAdapter}`;
  }
  if (ensured === 'auto_detect_deveco') {
    return '已自动探测并写入 framework.local.json toolchain.devEcoStudio.installPath';
  }
  if (ensured === 'auto_single_adapter_and_deveco') {
    return (
      `已自动写入 framework.local.json agent_adapter=${activeAdapter}，` +
      '并探测写入 toolchain.devEcoStudio.installPath'
    );
  }
  if (ensured === 'auto_selected_adapter_and_deveco') {
    return (
      `已按 --select-adapter 写入 framework.local.json agent_adapter=${activeAdapter}，` +
      '并探测写入 toolchain.devEcoStudio.installPath'
    );
  }
  return 'personal setup 已就绪';
}

function gateResultToEnsureJson(
  result: PersonalSetupGateResult,
  ensured: PersonalSetupEnsuredAction | null = null,
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
      message: formatEnsuredOkMessage(ensured, result.activeAdapter),
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

/** feature phase / Skill bootstrap 用：fallback、membership、入口产物、prerequisite 校验 */
export function evaluatePersonalSetupGate(
  projectRoot: string,
  options: PersonalSetupGateOptions = {},
): PersonalSetupGateResult {
  const status = getFrameworkPersonalSetupStatus(projectRoot);
  const activeAdapter = status.agent_adapter;
  const materializedAdapters = resolveProjectMaterializedForGate(projectRoot);
  const required = options.requiredPrerequisites ?? new Set<PersonalPrerequisiteId>(['agent_adapter']);

  const placement = evaluateConfigPlacementGate(projectRoot, { exempt: options.placementExempt });
  if (!placement.ok) {
    return misconfiguredPlacementResult(status, activeAdapter, materializedAdapters);
  }

  if (required.has('agent_adapter')) {
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
  }

  if (required.has('deveco_toolchain') && !isDevecoToolchainReady(projectRoot)) {
    return {
      ok: false,
      code: 'deveco_toolchain_missing',
      status,
      activeAdapter,
      materializedAdapters,
      message:
        '当前 phase 需要 DevEco 工具链，但 framework.local.json 未配置有效 installPath/hvigorBin。' +
        '请执行 check-personal-setup --ensure --phase <当前 phase>（或 personal setup detect-deveco / record-deveco-path）。',
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
 * 零 adapter 返回 no_materialized_adapter。修复链可在一轮内串行 adapter → deveco。
 */
function attemptEnsureAdapterFromFallback(
  projectRoot: string,
  gate: Extract<PersonalSetupGateResult, { ok: false }>,
  selectAdapter?: string,
): RepairAttempt {
  const { status, materializedAdapters, activeAdapter } = gate;

  if (materializedAdapters.length === 0) {
    return {
      repaired: false,
      gate: {
        ok: false,
        code: 'no_materialized_adapter',
        status,
        activeAdapter,
        materializedAdapters,
        message:
          '项目尚未物化任何 adapter（materialized_adapters 为空）。' +
          '请先执行 /framework-init 物化至少一个 adapter。' +
          '若已 init，请确认 --project-root 指向含 framework.config.json 的工程根。',
      },
    };
  }

  if (materializedAdapters.length === 1) {
    const only = materializedAdapters[0]!;
    if (!adapterEntryExists(projectRoot, only)) {
      const adapter = loadAdapter(only);
      const entryRel = adapter.entryFile?.targetRel ?? '<unknown>';
      return {
        repaired: false,
        gate: {
          ok: false,
          code: 'entry_not_materialized',
          status,
          activeAdapter: only,
          materializedAdapters,
          message:
            `adapter ${only} 入口产物未物化（缺 ${entryRel}）；请先跑 /framework-init。`,
        },
      };
    }
    writeLocalConfig(
      projectRoot,
      mergeLocalPatch(projectRoot, { agent_adapter: only }),
    );
    clearFrameworkConfigCache();
    return { repaired: true, ensured: 'auto_single_adapter' };
  }

  const candidates = materializedAdapters.filter(a => adapterEntryExists(projectRoot, a));
  if (candidates.length === 0) {
    return {
      repaired: false,
      gate: {
        ok: false,
        code: 'entry_not_materialized',
        status,
        activeAdapter,
        materializedAdapters,
        message:
          `materialized_adapters [${materializedAdapters.join(', ')}] 均无入口产物；` +
          '请先跑 /framework-init 物化 adapter 入口文件。',
      },
    };
  }

  const selected = selectAdapter?.trim();
  if (selected) {
    if (candidates.includes(selected)) {
      writeLocalConfig(
        projectRoot,
        mergeLocalPatch(projectRoot, { agent_adapter: selected }),
      );
      clearFrameworkConfigCache();
      return { repaired: true, ensured: 'auto_selected_adapter' };
    }
    return {
      repaired: false,
      gate: {
        ok: false,
        code: 'needs_adapter_choice',
        status,
        activeAdapter,
        materializedAdapters,
        message:
          `目标 adapter "${selected}" 不在已物化候选 [${candidates.join(', ')}]；` +
          '请改选已物化项或先跑 /framework-init。',
      },
      candidates,
    };
  }

  return {
    repaired: false,
    gate: {
      ok: false,
      code: 'needs_adapter_choice',
      status,
      activeAdapter,
      materializedAdapters,
      message:
        `检测到 ${candidates.length} 个可选 adapter，须选择 active adapter` +
        '（registry setup.adapter）；选择后由 init-orchestrate record-adapter 写盘。',
    },
    candidates,
  };
}

type RepairAttempt =
  | { repaired: true; ensured: EnsureRepairStep }
  | {
      repaired: false;
      gate: Extract<PersonalSetupGateResult, { ok: false }>;
      candidates?: string[];
    };

function attemptPersonalSetupRepair(
  projectRoot: string,
  gate: Extract<PersonalSetupGateResult, { ok: false }>,
  options: PersonalSetupGateOptions = {},
): RepairAttempt {
  if (gate.code === 'deveco_toolchain_missing') {
    const deveco = ensureDevecoToolchain(projectRoot);
    if (!deveco.ok) {
      return {
        repaired: false,
        gate: {
          ok: false,
          code: 'deveco_toolchain_missing',
          status: gate.status,
          activeAdapter: gate.activeAdapter,
          materializedAdapters: gate.materializedAdapters,
          message: deveco.message,
        },
      };
    }
    return { repaired: true, ensured: 'auto_detect_deveco' };
  }
  if (gate.code === 'fallback') {
    return attemptEnsureAdapterFromFallback(projectRoot, gate, options.selectAdapter);
  }
  return { repaired: false, gate };
}

export function ensurePersonalSetup(
  projectRoot: string,
  options: PersonalSetupGateOptions = {},
): PersonalSetupEnsureJson {
  const placement = evaluateConfigPlacementGate(projectRoot, { exempt: options.placementExempt });
  if (!placement.ok) {
    const status = getFrameworkPersonalSetupStatus(projectRoot);
    return gateResultToEnsureJson(
      misconfiguredPlacementResult(
        status,
        status.agent_adapter,
        resolveProjectMaterializedForGate(projectRoot),
      ),
    );
  }

  const ensuredSteps: EnsureRepairStep[] = [];

  for (let step = 0; step < MAX_ENSURE_REPAIR_STEPS; step++) {
    const gate = evaluatePersonalSetupGate(projectRoot, options);
    if (gate.ok) {
      // G2：local 已有合法 agent_adapter，但本次 --select-adapter 与之不同 → 不静默吞，显式报冲突。
      // （静默 ok=既有 正是宿主"cursor 记录却跑成 claude"时 agent 收不到信号的洞。）
      const requested = options.selectAdapter?.trim();
      if (requested && requested !== gate.activeAdapter) {
        return {
          ok: false,
          code: 'adapter_conflict',
          status: gate.status,
          activeAdapter: gate.activeAdapter,
          materializedAdapters: gate.materializedAdapters,
          ensured: null,
          candidates: [],
          message:
            `framework.local.json 已记录运行身份 agent_adapter=${gate.activeAdapter}，本次却请求 ${requested}。` +
            'goal 流程不静默改写：永久换 → init record-adapter（registry setup.adapter）；本次即时换 → goal-runner --override-adapter。',
        };
      }
      return gateResultToEnsureJson(gate, combineEnsuredActions(ensuredSteps));
    }

    const attempt = attemptPersonalSetupRepair(projectRoot, gate, options);
    if (!attempt.repaired) {
      return gateResultToEnsureJson(attempt.gate, null, attempt.candidates ?? []);
    }
    ensuredSteps.push(attempt.ensured);
  }

  const final = evaluatePersonalSetupGate(projectRoot, options);
  return gateResultToEnsureJson(final, combineEnsuredActions(ensuredSteps));
}

export function formatPersonalSetupGateStderr(
  result: Extract<PersonalSetupGateResult, { ok: false }>,
): string {
  const lines = [
    result.code === 'misconfigured_personal_fields'
      ? formatConfigPlacementGateStderr({
          ok: false,
          code: 'misconfigured_personal_fields',
          message: result.message,
        }).trimEnd()
      : `[check-personal-setup] ${result.message}`,
    '  项目级 adapter 物化请用 /framework-init；个人配置由阶段入口 --ensure 内联完成（见 personal-setup-gate.md）。',
  ];
  if (result.code === 'misconfigured_personal_fields') {
    lines.splice(
      1,
      0,
      '  Step1: init UPDATE / migrate-config 清场 project personal 字段；',
      '  Step2: check-personal-setup --ensure 写 framework.local.json。',
    );
  }
  return `${lines.join('\n')}\n`;
}
