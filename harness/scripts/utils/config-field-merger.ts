// ============================================================================
// config-field-merger — framework.config.json 字段级"只补缺、不覆盖"合并器
// ============================================================================
//
// 背景：Skill 00 UPDATE 模式历史上只有「整文件替换 / 跳过」两档（见 SKILL.md §5.1），
// 当 framework 引入新字段（如 paths.extension_dir / paths.state_file /
// state_machine.* / active_workflow / lifecycle_hooks_enabled 等）后，老工程
// 重新跑 /framework-init 无法机器化补齐，常见现象是「重新 init 后只新增了几个
// 显眼字段，其它新字段全漏」。
//
// 本 util 把"哪些字段允许在缺失时回填默认值"的白名单与合并逻辑收敛到单一位置，
// 供 check-init.ts（识别缺失字段、报告给 stdout）与 merge-framework-config.ts
// （实际执行合并 + 备份）共用。
//
// 严格约束：
//   1. 只补"老 config 完全没有"的 key；已有 key（哪怕值不同于默认）一律保留。
//   2. 不动用户必填字段（project_name / project_type / architecture / agent_adapter）
//      —— 它们的缺失走 Skill 主流程的交互。
//   3. 不动 opt-in 字段（prd / atomic_service）—— 这些需要维护者手工选择档位。
//   4. 不动 toolchain.devEcoStudio.installPath —— 由 Skill 5.6 detect-deveco 单独处理。
//
// 新增字段时只需扩展本文件的 BACKFILL_FIELDS 白名单：
//   - check-init 自动把它纳入 "缺失字段" 报告；
//   - merge-framework-config.ts 自动把它纳入补缺合并范围；
//   - 老工程下次 UPDATE 即可机器化追平。
// ============================================================================

import {
  DEFAULT_HYLYRE_TOOL_CONFIG,
  DEFAULT_PATHS,
  DEFAULT_STATE_MACHINE,
} from '../../config';

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
  // 故意不补 `paths.reports_dir_pattern`：DEFAULT_PATHS 中**有意未定义**该字段，
  // 未配置时 harness 回退到 legacy 报告路径 `framework/harness/reports/<feature>/<phase>/`
  // 与历史实例兼容（见 framework/harness/config.ts 第 263-267 行注释）。
  // 若自动补 "doc/features/<feature>/<phase>/reports"，老工程升级后报告落点会突然搬家，
  // 属于行为级变更，必须由维护者显式决定 → 留给 Skill 00 Step 7 收尾提示，
  // 或由维护者手工在 framework.config.json 中添加。
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
