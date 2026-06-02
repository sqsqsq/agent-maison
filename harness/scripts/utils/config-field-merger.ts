// ============================================================================
// config-field-merger — framework.config.json 字段级"只补缺、不覆盖"合并器
// ============================================================================
//
// 背景：Skill 00 UPDATE 模式历史上只有「整文件替换 / 跳过」两档（编排化前），
// 当 framework 引入新字段（如 paths.extension_dir / paths.state_file /
// state_machine.* / active_workflow / lifecycle_hooks_enabled 等）后，老工程
// 重新跑 /framework-init 无法机器化补齐，常见现象是「重新 init 后只新增了几个
// 显眼字段，其它新字段全漏」。
//
// 本 util 把 framework-init UPDATE 的三档 config 同步收敛到单一位置，供
// check-init.ts（识别缺失/待迁移/待确认字段）与 merge-framework-config.ts
// （实际执行合并 + 备份）共用：
//
//   Pass 1 — BACKFILL_FIELDS：只补缺失 key，静默安全默认值
//   Pass 2 — MIGRATION_RULES：modernize 已有 key（如 project_type → sub_variant）
//   Pass 3 — CONFIRM_FIELDS：行为级变更，须 S2 CONFIRM pass（`--confirm-*` flag）后才写入
//
// 严格约束（Pass 1）：
//   1. 只补"老 config 完全没有"的 key；已有 key（哪怕值不同于默认）一律保留。
//   2. 不动用户必填字段（project_name / architecture / agent_adapter）—— 走 Skill 交互。
//   3. 不动 opt-in 字段（prd / atomic_service）—— 维护者手工选档。
//   4. 不动 toolchain.devEcoStudio.installPath —— 由 Skill 5.6 detect-deveco 单独处理。
//
// 新增字段 checklist：
//   - 静默安全默认 → BACKFILL_FIELDS + config.ts DEFAULT_*
//   - 弃用/重命名 → MIGRATION_RULES
//   - 行为变更 → CONFIRM_FIELDS + S2 CONFIRM pass
// ============================================================================

import {
  DEFAULT_HYLYRE_TOOL_CONFIG,
  DEFAULT_PATHS,
  DEFAULT_REPORTS_DIR_PATTERN,
  DEFAULT_STATE_MACHINE,
} from '../../config';
import {
  LOCAL_SCHEMA_VERSION,
  type FrameworkLocalConfig,
} from './framework-local-config';

/** 单条补缺规则。`path` 为点分路径（如 `paths.extension_dir`、`state_machine.ttl_hours`）。 */
export interface BackfillField {
  /** 点分路径；不支持数组下标，仅支持对象嵌套。 */
  path: string;
  /** 缺失时回填的默认值（深拷贝后写入，避免共享引用）。 */
  defaultValue: unknown;
  /** 简短中文说明，进入 stdout / dry-run 报告。 */
  note: string;
}

/**
 * UPDATE 模式可被「字段级补缺合并」自动回填的字段白名单（SSOT）。
 *
 * 维护原则：
 *   - 这里**只**列允许在缺失时静默补默认值的字段；其它一律不能补。
 *   - 默认值取 framework/harness/config.ts 的 DEFAULT_PATHS / DEFAULT_STATE_MACHINE /
 *     DEFAULT_HYLYRE_TOOL_CONFIG 等常量；新增字段时先在 config.ts 里给真实默认值，再加到本表，避免双源漂移。
 */
export const BACKFILL_FIELDS: ReadonlyArray<BackfillField> = [
  {
    path: 'schema_version',
    defaultValue: '1.1',
    note: '老 config schema_version 缺失：按当前框架 schema_version 回填',
  },
  {
    path: 'active_workflow',
    defaultValue: 'spec-driven',
    note: 'workflow 未声明：回填 spec-driven（对应 framework/workflows/spec-driven.workflow.yaml）',
  },
  {
    path: 'lifecycle_hooks_enabled',
    defaultValue: true,
    note: 'lifecycle_hooks_enabled 未声明：回填 true（与默认 spec-driven workflow 期望一致）',
  },

  // paths.* —— 与 config.ts DEFAULT_PATHS 严格对齐
  {
    path: 'paths.features_dir',
    defaultValue: DEFAULT_PATHS.features_dir,
    note: 'paths.features_dir 缺失：回填 doc/features（业务过程产物根目录）',
  },
  {
    path: 'paths.module_catalog',
    defaultValue: DEFAULT_PATHS.module_catalog,
    note: 'paths.module_catalog 缺失：回填 doc/module-catalog.yaml',
  },
  {
    path: 'paths.glossary',
    defaultValue: DEFAULT_PATHS.glossary,
    note: 'paths.glossary 缺失：回填 doc/glossary.yaml',
  },
  {
    path: 'paths.glossary_seed',
    defaultValue: DEFAULT_PATHS.glossary_seed,
    note: 'paths.glossary_seed 缺失：回填 doc/glossary-seed.txt',
  },
  {
    path: 'paths.architecture_md',
    defaultValue: DEFAULT_PATHS.architecture_md,
    note: 'paths.architecture_md 缺失：回填 doc/architecture.md',
  },
  {
    path: 'paths.extension_dir',
    defaultValue: DEFAULT_PATHS.extension_dir,
    note: 'paths.extension_dir 缺失：回填 doc/extensions（实例扩展根目录，v2.5 新增）',
  },
  {
    path: 'paths.state_file',
    defaultValue: DEFAULT_PATHS.state_file,
    note: 'paths.state_file 缺失：回填 framework/harness/state/.current-phase.json（Stop hook 状态文件，v2.4 新增）',
  },
  {
    path: 'paths.receipt_dir_pattern',
    defaultValue: DEFAULT_PATHS.receipt_dir_pattern,
    note: 'paths.receipt_dir_pattern 缺失：回填 doc/features/<feature>/<phase>（完成回执目录模式）',
  },
  // paths.reports_dir_pattern 不在 BACKFILL —— 见 CONFIRM_FIELDS + S2 CONFIRM pass。
  {
    path: 'paths.docs_committed',
    defaultValue: DEFAULT_PATHS.docs_committed,
    note: 'paths.docs_committed 缺失：回填 false（默认假定业务过程产物不入主仓；演示仓可自行改为 true）',
  },

  // state_machine.* —— 与 config.ts DEFAULT_STATE_MACHINE 严格对齐
  {
    path: 'state_machine.grace_period_minutes',
    defaultValue: DEFAULT_STATE_MACHINE.grace_period_minutes,
    note: 'state_machine.grace_period_minutes 缺失：回填 5 分钟',
  },
  {
    path: 'state_machine.ttl_hours',
    defaultValue: DEFAULT_STATE_MACHINE.ttl_hours,
    note: 'state_machine.ttl_hours 缺失：回填 12 小时',
  },
  {
    path: 'state_machine.schema_version',
    defaultValue: DEFAULT_STATE_MACHINE.schema_version,
    note: 'state_machine.schema_version 缺失：回填 1.1',
  },

  // toolchain.hvigor.* —— 与模板 framework.config.template.json 默认值一致
  // 不补 toolchain.devEcoStudio（Skill 5.6 detect-deveco 独立处理）。
  {
    path: 'toolchain.hvigor.daemon',
    defaultValue: true,
    note: 'toolchain.hvigor.daemon 缺失：回填 true（hvigor daemon 模式）',
  },
  {
    path: 'toolchain.hvigor.parallel',
    defaultValue: true,
    note: 'toolchain.hvigor.parallel 缺失：回填 true',
  },
  {
    path: 'toolchain.hvigor.incremental',
    defaultValue: true,
    note: 'toolchain.hvigor.incremental 缺失：回填 true',
  },
  {
    path: 'toolchain.hvigor.analyze',
    defaultValue: 'advanced',
    note: "toolchain.hvigor.analyze 缺失：回填 'advanced'",
  },

  // tools.hylyre.* —— hmos-app Skill 6 真机自动化；与 DEFAULT_HYLYRE_TOOL_CONFIG / 模板对齐
  {
    path: 'tools.hylyre.vendor_dir',
    defaultValue: DEFAULT_HYLYRE_TOOL_CONFIG.vendor_dir,
    note: 'tools.hylyre.vendor_dir 缺失：回填 hmos-app vendor/hylyre 目录',
  },
  {
    path: 'tools.hylyre.venv_dir',
    defaultValue: DEFAULT_HYLYRE_TOOL_CONFIG.venv_dir,
    note: 'tools.hylyre.venv_dir 缺失：回填 .hylyre/venv',
  },
  {
    path: 'tools.hylyre.app_snapshot_cache_dir',
    defaultValue: DEFAULT_HYLYRE_TOOL_CONFIG.app_snapshot_cache_dir,
    note: 'tools.hylyre.app_snapshot_cache_dir 缺失：回填 doc/app-snapshot-cache',
  },
  {
    path: 'tools.hylyre.pypi_extra_index_url',
    defaultValue: DEFAULT_HYLYRE_TOOL_CONFIG.pypi_extra_index_url,
    note: 'tools.hylyre.pypi_extra_index_url 缺失：回填清华 PyPI 镜像（可改内网源）',
  },
  {
    path: 'tools.hylyre.auto_install',
    defaultValue: DEFAULT_HYLYRE_TOOL_CONFIG.auto_install,
    note: 'tools.hylyre.auto_install 缺失：回填 true',
  },
  {
    path: 'tools.hylyre.doctor_first_run',
    defaultValue: DEFAULT_HYLYRE_TOOL_CONFIG.doctor_first_run,
    note: 'tools.hylyre.doctor_first_run 缺失：回填 true',
  },
  {
    path: 'tools.hylyre.hypium_page_name',
    defaultValue: DEFAULT_HYLYRE_TOOL_CONFIG.hypium_page_name,
    note: 'tools.hylyre.hypium_page_name 缺失：回填空串（由 device-test-run 扫描 entry mainElement）',
  },
];

// --------------------------------------------------------------------------
// Pass 2 — MIGRATION_RULES（modernize 已有 key，安全等价于 runtime normalize）
// --------------------------------------------------------------------------

export interface MigrationRule {
  id: string;
  note: string;
  detect: (raw: Record<string, unknown>) => boolean;
  apply: (base: Record<string, unknown>) => { applied: boolean; summary: string };
}

function ensureProjectProfileObject(base: Record<string, unknown>): Record<string, unknown> {
  const existing = base.project_profile;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const created: Record<string, unknown> = { name: 'hmos-app' };
  base.project_profile = created;
  return created;
}

function hasNonEmptySubVariant(pp: Record<string, unknown>): boolean {
  return typeof pp.sub_variant === 'string' && pp.sub_variant.trim().length > 0;
}

/**
 * UPDATE 模式可被自动 modernize 的迁移规则（SSOT）。
 * 与 BACKFILL 不同：会修改/删除已有 key。
 */
function projectHasLegacyPersonalFields(raw: Record<string, unknown>): boolean {
  if (typeof raw.agent_adapter === 'string' && raw.agent_adapter.trim()) return true;
  const tc = raw.toolchain;
  if (!tc || typeof tc !== 'object' || Array.isArray(tc)) return false;
  const deveco = (tc as Record<string, unknown>).devEcoStudio;
  if (!deveco || typeof deveco !== 'object' || Array.isArray(deveco)) return false;
  const installPath = (deveco as Record<string, unknown>).installPath;
  return typeof installPath === 'string' && installPath.trim().length > 0;
}

/** 从项目级 legacy config 构造待写入 framework.local.json 的内容（不修改 raw）。 */
export function buildLocalFromProjectLegacy(raw: unknown): FrameworkLocalConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const local: FrameworkLocalConfig = { schema_version: LOCAL_SCHEMA_VERSION };
  let hasAny = false;
  if (typeof obj.agent_adapter === 'string' && obj.agent_adapter.trim()) {
    local.agent_adapter = obj.agent_adapter.trim();
    hasAny = true;
  }
  const tc = obj.toolchain;
  if (tc && typeof tc === 'object' && !Array.isArray(tc)) {
    const deveco = (tc as Record<string, unknown>).devEcoStudio;
    if (deveco && typeof deveco === 'object' && !Array.isArray(deveco)) {
      const installPath = (deveco as Record<string, unknown>).installPath;
      const hvigorBin = (deveco as Record<string, unknown>).hvigorBin;
      const ip = typeof installPath === 'string' ? installPath.trim() : '';
      const hb = typeof hvigorBin === 'string' ? hvigorBin.trim() : '';
      if (ip || hb) {
        local.toolchain = {
          devEcoStudio: {
            ...(ip ? { installPath: ip } : {}),
            ...(hb ? { hvigorBin: hb } : {}),
          },
        };
        hasAny = true;
      }
    }
  }
  return hasAny ? local : null;
}

export const MIGRATION_RULES: ReadonlyArray<MigrationRule> = [
  {
    id: 'project_type_to_sub_variant',
    note: '迁移 legacy 顶层 project_type → project_profile.sub_variant 并删除 project_type',
    detect: raw => Object.prototype.hasOwnProperty.call(raw, 'project_type'),
    apply: base => {
      const projectType = base.project_type;
      const pp = ensureProjectProfileObject(base);
      let changed = false;
      if (!hasNonEmptySubVariant(pp)) {
        pp.sub_variant = projectType === 'atomic_service' ? 'element-service' : 'app';
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(base, 'project_type')) {
        delete base.project_type;
        changed = true;
      }
      return {
        applied: changed,
        summary: changed
          ? `project_type=${String(projectType)} → project_profile.sub_variant=${String(pp.sub_variant)}，已删除 project_type`
          : 'project_type 已迁移',
      };
    },
  },
  {
    id: 'default_sub_variant_app',
    note: '补全 project_profile.sub_variant=app（无 legacy project_type 且缺 sub_variant 时）',
    detect: raw => {
      if (Object.prototype.hasOwnProperty.call(raw, 'project_type')) return false;
      const pp = raw.project_profile;
      if (!pp || typeof pp !== 'object' || Array.isArray(pp)) return false;
      const name = (pp as Record<string, unknown>).name;
      if (typeof name !== 'string' || name.trim().length === 0) return false;
      return !hasNonEmptySubVariant(pp as Record<string, unknown>);
    },
    apply: base => {
      const pp = ensureProjectProfileObject(base);
      if (hasNonEmptySubVariant(pp)) {
        return { applied: false, summary: 'project_profile.sub_variant 已存在' };
      }
      pp.sub_variant = 'app';
      return { applied: true, summary: '补全 project_profile.sub_variant=app' };
    },
  },
  {
    id: 'extract_personal_to_local',
    note: '外迁 agent_adapter / DevEco installPath 到 framework.local.json；项目 config 保留 materialized_adapters',
    detect: raw =>
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? projectHasLegacyPersonalFields(raw as Record<string, unknown>)
        : false,
    apply: base => {
      let changed = false;
      const adapter =
        typeof base.agent_adapter === 'string' && base.agent_adapter.trim()
          ? base.agent_adapter.trim()
          : null;
      const ma = base.materialized_adapters;
      const hasMa = Array.isArray(ma) && ma.length > 0;
      if (adapter && !hasMa) {
        base.materialized_adapters = [adapter];
        changed = true;
      } else if (adapter && hasMa && !ma.includes(adapter)) {
        base.materialized_adapters = [...ma, adapter];
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(base, 'agent_adapter')) {
        delete base.agent_adapter;
        changed = true;
      }
      const tc = base.toolchain;
      if (tc && typeof tc === 'object' && !Array.isArray(tc)) {
        const row = tc as Record<string, unknown>;
        const deveco = row.devEcoStudio;
        if (deveco && typeof deveco === 'object' && !Array.isArray(deveco)) {
          const d = deveco as Record<string, unknown>;
          const installPath = typeof d.installPath === 'string' ? d.installPath.trim() : '';
          const hvigorBin = typeof d.hvigorBin === 'string' ? d.hvigorBin.trim() : '';
          if (installPath || hvigorBin) {
            if (installPath) delete d.installPath;
            if (hvigorBin) delete d.hvigorBin;
            if (Object.keys(d).length === 0) delete row.devEcoStudio;
            if (Object.keys(row).length === 0) delete base.toolchain;
            changed = true;
          }
        }
      }
      return {
        applied: changed,
        summary: changed
          ? '已外迁 personal 字段（agent_adapter / DevEco）并写入 materialized_adapters'
          : 'personal 字段已外迁',
      };
    },
  },
];

export interface PendingMigrationEntry {
  id: string;
  note: string;
}

export interface MigrationReport {
  appliedMigrations: Array<{ id: string; summary: string }>;
}

export function detectPendingMigrations(raw: unknown): PendingMigrationEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const obj = raw as Record<string, unknown>;
  const out: PendingMigrationEntry[] = [];
  for (const rule of MIGRATION_RULES) {
    if (rule.detect(obj)) {
      out.push({ id: rule.id, note: rule.note });
    }
  }
  return out;
}

export function applyMigrations(raw: unknown): {
  merged: Record<string, unknown>;
  report: MigrationReport;
} {
  const base: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (deepClone(raw) as Record<string, unknown>)
      : {};
  const applied: MigrationReport['appliedMigrations'] = [];
  for (const rule of MIGRATION_RULES) {
    if (rule.detect(base)) {
      const result = rule.apply(base);
      if (result.applied) {
        applied.push({ id: rule.id, summary: result.summary });
      }
    }
  }
  return { merged: base, report: { appliedMigrations: applied } };
}

// --------------------------------------------------------------------------
// Pass 3 — CONFIRM_FIELDS（行为级变更，须 CONFIRM pass 后才写入）
// --------------------------------------------------------------------------

export interface ConfirmField {
  path: string;
  confirmKey: string;
  defaultValue: unknown;
  note: string;
}

export const CONFIRM_FIELDS: ReadonlyArray<ConfirmField> = [
  {
    path: 'paths.reports_dir_pattern',
    confirmKey: 'reports_dir_pattern',
    defaultValue: DEFAULT_REPORTS_DIR_PATTERN,
    note: '启用 feature-phase 报告外置（doc/features/<feature>/<phase>/reports）；拒绝则保持 legacy framework/harness/reports/<feature>/<phase>/',
  },
];

export interface PendingConfirmEntry {
  confirmKey: string;
  path: string;
  defaultValue: unknown;
  note: string;
}

export interface ConfirmApplyReport {
  appliedFields: PendingConfirmEntry[];
  rejectedKeys: string[];
}

export function detectMissingConfirmFields(raw: unknown): PendingConfirmEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return CONFIRM_FIELDS.map(f => ({
      confirmKey: f.confirmKey,
      path: f.path,
      defaultValue: f.defaultValue,
      note: f.note,
    }));
  }
  const out: PendingConfirmEntry[] = [];
  for (const f of CONFIRM_FIELDS) {
    if (!hasDottedKey(raw, f.path)) {
      out.push({
        confirmKey: f.confirmKey,
        path: f.path,
        defaultValue: f.defaultValue,
        note: f.note,
      });
    }
  }
  return out;
}

export function applyConfirmFields(
  raw: unknown,
  answers: Record<string, boolean>,
): { merged: Record<string, unknown>; report: ConfirmApplyReport } {
  const base: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (deepClone(raw) as Record<string, unknown>)
      : {};
  const applied: PendingConfirmEntry[] = [];
  const rejected: string[] = [];
  for (const f of CONFIRM_FIELDS) {
    const ans = answers[f.confirmKey];
    if (ans === undefined) continue;
    if (!ans) {
      rejected.push(f.confirmKey);
      continue;
    }
    if (!hasDottedKey(base, f.path)) {
      setDottedKey(base, f.path, f.defaultValue);
      applied.push({
        confirmKey: f.confirmKey,
        path: f.path,
        defaultValue: f.defaultValue,
        note: f.note,
      });
    }
  }
  return { merged: base, report: { appliedFields: applied, rejectedKeys: rejected } };
}

/**
 * 三 pass 合并：backfill → migration → confirm（confirm 仅当 answers 含对应 key）。
 */
export function mergeFrameworkConfig(
  raw: unknown,
  confirmAnswers: Record<string, boolean> = {},
): {
  merged: Record<string, unknown>;
  backfillReport: MergeReport;
  migrationReport: MigrationReport;
  confirmReport: ConfirmApplyReport;
} {
  const { merged: afterBackfill, report: backfillReport } = mergeBackfillFields(raw);
  const { merged: afterMigration, report: migrationReport } = applyMigrations(afterBackfill);
  const { merged, report: confirmReport } = applyConfirmFields(afterMigration, confirmAnswers);
  return { merged, backfillReport, migrationReport, confirmReport };
}

/** 字段路径是否在白名单内（用于外部诊断/单测）。 */
export function isBackfillablePath(p: string): boolean {
  return BACKFILL_FIELDS.some(f => f.path === p);
}

// --------------------------------------------------------------------------
// 内部：点分路径访问
// --------------------------------------------------------------------------

/**
 * 判断对象沿点分路径是否存在 own key（不递归 prototype，不区分 undefined 与缺失）。
 *
 * 例：has({ paths: { a: 1 } }, 'paths.a') === true
 *     has({ paths: { a: 1 } }, 'paths.b') === false
 *     has({ paths: {} }, 'paths') === true
 */
function hasDottedKey(obj: unknown, dotted: string): boolean {
  const keys = dotted.split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return false;
    if (!Object.prototype.hasOwnProperty.call(cur as Record<string, unknown>, k)) return false;
    cur = (cur as Record<string, unknown>)[k];
  }
  return true;
}

/**
 * 沿点分路径写入值；中间不存在的对象按需创建（仅当我们已经决定补缺该路径时调用）。
 * 不会覆盖已存在的同名 key（外层调用方应保证只对"缺失路径"调本函数）。
 */
function setDottedKey(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const next = cur[k];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = deepClone(value);
}

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  // structuredClone 在 Node 17+ 可用；为兼容旧环境用 JSON 兜底（白名单默认值都是 JSON 安全的）。
  if (typeof (globalThis as { structuredClone?: <U>(u: U) => U }).structuredClone === 'function') {
    return (globalThis as { structuredClone: <U>(u: U) => U }).structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

// --------------------------------------------------------------------------
// 公共 API
// --------------------------------------------------------------------------

/** 单条缺失字段诊断。 */
export interface MissingFieldEntry {
  path: string;
  defaultValue: unknown;
  note: string;
}

/**
 * 检测老 config 中缺失但属于白名单的字段。**纯函数**，不动 raw。
 * 返回顺序与 BACKFILL_FIELDS 一致，便于稳定 diff。
 */
export function detectMissingBackfillFields(raw: unknown): MissingFieldEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    // 无法识别为对象时退化为「全部缺失」语义；上层（CREATE 模式）通常不会走到这里。
    return BACKFILL_FIELDS.map(f => ({
      path: f.path,
      defaultValue: f.defaultValue,
      note: f.note,
    }));
  }
  const out: MissingFieldEntry[] = [];
  for (const f of BACKFILL_FIELDS) {
    if (!hasDottedKey(raw, f.path)) {
      out.push({ path: f.path, defaultValue: f.defaultValue, note: f.note });
    }
  }
  return out;
}

/** 合并报告。 */
export interface MergeReport {
  /** 实际写入（或将要写入）的缺失字段。 */
  appliedFields: MissingFieldEntry[];
  /** 白名单之外、user 已声明的字段，本工具不会动；这里仅供调试 / 信息展示。 */
  preservedFieldsCount: number;
}

/**
 * 对 raw 进行字段级补缺合并，返回**新对象**与报告。原 raw 不被修改。
 *
 * 行为：
 *   - 对每个 `BACKFILL_FIELDS` 中的 path，若 raw 中**缺失**则用默认值填入；
 *   - 已存在的 key 一律保留原值（哪怕等于默认值，也不动顺序）；
 *   - 不动数组、不动白名单外的字段；
 *   - 不写入空对象——若一条 path 的父级缺失，会逐层 mkdirsync 一样建到位。
 *
 * 调用方负责把返回的对象格式化（2 空格缩进 + 末尾换行）后写盘。
 */
export function mergeBackfillFields(raw: unknown): {
  merged: Record<string, unknown>;
  report: MergeReport;
} {
  const base: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (deepClone(raw) as Record<string, unknown>)
      : {};
  const applied: MissingFieldEntry[] = [];
  for (const f of BACKFILL_FIELDS) {
    if (!hasDottedKey(base, f.path)) {
      setDottedKey(base, f.path, f.defaultValue);
      applied.push({ path: f.path, defaultValue: f.defaultValue, note: f.note });
    }
  }
  return {
    merged: base,
    report: {
      appliedFields: applied,
      preservedFieldsCount: countLeafKeys(raw),
    },
  };
}

/** 简易统计：raw 中的"叶子键"数量（用于 dry-run 报告"原 config 保留 X 个字段"展示）。 */
function countLeafKeys(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  let n = 0;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      n += countLeafKeys(v);
    } else {
      n += 1;
    }
  }
  return n;
}

/** ensure-config 写盘禁止落盘的顶层 legacy / personal 键（与 MIGRATION_RULES / template SSOT 对齐） */
export const PROJECT_CONFIG_INIT_WRITE_FORBIDDEN_TOP_KEYS = [
  'agent_adapter',
  'project_type',
] as const;

function stripPersonalDevEcoFromToolchain(obj: Record<string, unknown>): void {
  const tc = obj.toolchain;
  if (!tc || typeof tc !== 'object' || Array.isArray(tc)) return;
  const tcObj = tc as Record<string, unknown>;
  const deveco = tcObj.devEcoStudio;
  if (!deveco || typeof deveco !== 'object' || Array.isArray(deveco)) return;
  const devecoObj = { ...(deveco as Record<string, unknown>) };
  delete devecoObj.installPath;
  delete devecoObj.hvigorBin;
  if (Object.keys(devecoObj).length === 0) {
    delete tcObj.devEcoStudio;
  } else {
    tcObj.devEcoStudio = devecoObj;
  }
  if (Object.keys(tcObj).length === 0) {
    delete obj.toolchain;
  }
}

/**
 * ensure-config 写盘专用：校验走 normalize/validate，落盘仅保留 Skill 提供的项目级字段。
 * 禁止 normalize 回填 agent_adapter / legacy project_type / personal DevEco 路径。
 */
export function sanitizeProjectConfigForInitWrite(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  for (const key of PROJECT_CONFIG_INIT_WRITE_FORBIDDEN_TOP_KEYS) {
    delete out[key];
  }
  stripPersonalDevEcoFromToolchain(out);
  return out;
}
