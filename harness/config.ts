// ============================================================================
// Framework Config 加载器（架构 DSL + 可覆盖路径的统一入口）
// ============================================================================
// 本文件是阶段 2「架构元模型化」+ 阶段 3「路径参数化」的核心入口，负责从
// 实例工程根的 `framework.config.json` 读取：
//
//   1. 架构 DSL（outer_layers / module_inner_layers / …），供 harness 的
//      check-*.ts 在运行时决定「什么是合法的 layer / 哪些依赖合法 / 模块内
//      四层的方向」。原本硬编码在 check-catalog.ts / check-coding.ts /
//      ast-analyzer.ts 里的「五层 + 模块内四层」从这里统一产出。
//   2. 可覆盖路径：features_dir / module_catalog / glossary / glossary_seed /
//      architecture_md。以前散落在 harness-runner.ts 与各 check-*.ts 里的硬
//      编码前缀（"doc/features"、"doc/module-catalog.yaml" 等）全部收敛到
//      这里；调用方统一用 `resolvePaths(projectRoot)` 或下方 `catalogPath()` /
//      `featureFilePath()` 等便捷函数，不再自行拼 `path.join`。
//
// 阶段 9（合并 specs/features → doc/features）：老字段 `feature_docs_dir` /
//   `feature_specs_dir` 已收敛为单字段 `features_dir`（默认 "doc/features"），
//   不再支持兼容 alias；`framework.config.json` 里若仍写老字段会在加载时抛
//   错提示迁移。
//
// 元规则（**framework 必守、不可被 DSL 关掉**）：
//
//   - 所有 outer_layers 的依赖关系构成 DAG（禁止循环）。
//   - `can_depend_on` 只能指向其他已声明的 layer（不得凭空出现）。
//   - `module_inner_layers` 的数组顺序即依赖顺序（upward：索引小的层可被
//     索引大的层 import，反之禁止）。方向只支持 "upward"。
//   - `cross_module_exports_file` 必须是非空字符串（默认 "index.ets"），
//     framework 始终强制「跨模块访问只能通过该文件」。
//
// 读取顺序：
//   ./framework.config.json（实例工程根）→ 未提供时回退到 LEGACY_DEFAULT_DSL
//   （保留首个参考实例的 5 外层 + 4 内层，作为向后兼容的 defaults；
//   具体 layer / sublayer id 仅作为示例，新工程应通过 framework.config.json
//   自行声明）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { applyDefaults, loadProfileConfigDefaults } from './profile-loader';

// --------------------------------------------------------------------------
// 架构 DSL 类型
// --------------------------------------------------------------------------

export type IntraLayerDepsMode = 'forbid' | 'dag' | 'sublayer';

/** outer_layers[] 中子层级结构（当 intra_layer_deps === 'sublayer' 时生效） */
export interface SublayerSpec {
  id: string;
  /** 该子层包含哪些模块名；可以是精确列表，未来可扩展为 glob 模式 */
  members_pattern_or_list: string[];
  /** 该子层可依赖哪些兄弟子层（同一 outer layer 内） */
  can_depend_on_sublayers: string[];
}

export interface OuterLayerSpec {
  id: string;
  /** 本层可以依赖哪些外层（按 id 引用） */
  can_depend_on: string[];
  /**
   * 层内依赖模式：
   *   - forbid：同层模块之间不得互相 import
   *   - dag：同层可依赖，但必须 DAG（由 check-*.ts 在模块粒度扫描）
   *   - sublayer：同层再拆子层级，按 sublayers[*].can_depend_on_sublayers 判定
   */
  intra_layer_deps: IntraLayerDepsMode;
  /** 仅当 intra_layer_deps === 'sublayer' 时需要填 */
  sublayers?: SublayerSpec[];
}

export interface ArchitectureDsl {
  outer_layers: OuterLayerSpec[];
  /** 模块内部分层顺序（小索引 → 大索引：小的可以被大的 import） */
  module_inner_layers: string[];
  /** 当前版本仅支持 'upward'——按 module_inner_layers 顺序单向依赖 */
  inner_dependency_direction: 'upward';
  /** 跨模块唯一合法导出入口文件（默认 index.ets） */
  cross_module_exports_file: string;
}

/**
 * 工具链配置（阶段 2.3：DevEco Studio 路径可配置化）
 *
 * 场景：现代 DevEco Studio 已把 hvigor 完全内置在 IDE 安装路径下，不再向
 * 项目根生成 `hvigorw.bat` / `hvigorw` wrapper。coding_hvigor_build /
 * ut_hvigor_build / ut_hvigor_test 三条 BLOCKER 规则需要真实调用 hvigor，
 * 因此项目必须通过此处声明 DevEco 的安装路径（或显式 hvigor 可执行文件）。
 *
 * 查找顺序（实现在 scripts/utils/hvigor-runner.ts）：
 *   ① toolchain.devEcoStudio.hvigorBin（显式覆盖，绝对路径）
 *   ② toolchain.devEcoStudio.installPath → 推导 <installPath>/tools/hvigor/bin/hvigorw{.bat}
 *   ③ 项目根 hvigorw.bat / hvigorw（向后兼容 Gradle-wrapper 风格工程）
 *   ④ 系统 PATH
 *   ⑤ 都命中不到 → toolMissing=true，规则 FAIL，错误消息指向本字段。
 *
 * 本节不做实际路径存在性校验（避免 harness 启动强依赖 IDE 安装），
 * 只做"字段格式 / 必填"校验；存在性由 hvigor-runner 在真实执行时报告。
 */
export interface DevEcoStudioConfig {
  /** DevEco Studio 安装根目录（绝对路径）。Windows 可用正斜杠或反斜杠。 */
  installPath?: string;
  /** 显式指定 hvigor 可执行文件（绝对路径）；为空时从 installPath 推导。 */
  hvigorBin?: string;
}

export type HvigorAnalyzeMode = 'off' | 'normal' | 'advanced';

/**
 * coding_hvigor_build 的 hvigor 调用形态（与 DevEco 手动 / Build 面板对齐时可调）。
 *
 * - `node_hvigorw_js`（默认）：`node <DevEco>/tools/hvigor/bin/hvigorw.js --mode module … assembleHap …`
 * - `hvigorw_wrapper`：走 `hvigorw.bat` / `hvigorw`（与 v2.3 resolve 链一致）
 * - `assemble_app_project`：项目级 `--mode project assembleApp`（v2.7 旧默认）
 */
export interface HvigorCodingConfig {
  driver?: 'node_hvigorw_js' | 'hvigorw_wrapper' | 'assemble_app_project';
  mode?: 'module' | 'project';
  task?: string;
  /**
   * 是否显式传 `-p buildMode=debug`。
   * DevEco 常见手动命令会带上；默认 true。
   */
  passBuildModeDebug?: boolean;
  /** 成功哨兵：正则源字符串；至少命中一条且 exitCode=0 且无解析 error 才允许 coding PASS */
  successMarkers?: string[];
  /** 追加在 task 与调优 flag 之后，便于覆盖 `-p` 等 */
  extraArgs?: string[];
}

/**
 * hvigor 命令行调优开关。
 *
 * 默认值由 `scripts/utils/hvigor-runner.ts` 决定，当前对齐内网真实工程常用命令：
 *   - daemon=true       → 传 `--daemon`
 *   - parallel=true     → 传 `--parallel`
 *   - incremental=true  → 传 `--incremental`
 *   - analyze='advanced'→ 传 `--analyze=advanced`
 *
 * 内网工程若存在自定义 onlineSign / archivePackage 等任务，可通过本段做 A/B，
 * 避免 agent 直接清空缓存掩盖真实问题。
 */
export interface HvigorOptionsConfig {
  daemon?: boolean;
  parallel?: boolean;
  incremental?: boolean;
  analyze?: HvigorAnalyzeMode;
  /**
   * hvigor 子进程超时（毫秒）。
   * 未配置时：coding 默认 45min，ut 相关默认 15min（由 hvigor-runner 分派）。
   * 上限 6h，防止配置笔误刷爆常驻任务。
   */
  timeoutMs?: number;
  /** coding 阶段专用装配 / 哨兵 */
  coding?: HvigorCodingConfig;
}

/**
 * 阶段状态机时间常量（v2.4：跨会话隔离）
 *
 * Stop hook（由具备 `hooks` 的 adapter 下发到实例根）在判定 state 是否
 * "陈旧"时使用本节配置：
 *   - `grace_period_minutes`：runner 写完 state 到 hook 第一次"盖章"
 *     （写入 session_id）之间的容忍窗口。该窗口内 state.session_id=null
 *     不视为遗留——视为"刚跑完 harness 还没来得及盖章"。
 *   - `ttl_hours`：极端兜底——payload.session_id 缺失（hook 协议异常或
 *     未来 cli adapter 不传）时，仅靠 state.updated_at 判定陈旧度的
 *     时间阈值。常规路径走 session_id 比对，TTL 是保险栓。
 *
 * 范围限制（双端校验：runner 端抛错、hook 端 best-effort 回退默认值）：
 *   - grace_period_minutes ∈ (0, 60]
 *   - ttl_hours            ∈ [1, 168]（一周）
 *
 * 默认值见 [DEFAULT_STATE_MACHINE]；hook 内嵌默认值与本常量
 * 必须保持一致，由 framework/harness/test/hook-stale-state.spec.ts 的
 * T11"配置一致性"用例兜底校验。
 */
export interface StateMachineConfig {
  grace_period_minutes: number;
  ttl_hours: number;
  /**
   * state schema 版本号；当前实现只识别 '1.1'。
   * 不在此处声明时，runner 写 state 时仍按 1.1 落盘。
   */
  schema_version?: string;
}

export interface ToolchainConfig {
  devEcoStudio?: DevEcoStudioConfig;
  hvigor?: HvigorOptionsConfig;
  /**
   * 可选：覆盖 hvigor `-p product=` 装配时的探测结果。
   *
   * 探测优先级（由 hvigor-runner.ts `detectProduct` 实现）：
   *   ① toolchain.preferredProduct（本字段，用户显式覆盖）
   *   ② build-profile.json5 app.products：若存在名为 `product` / `default` 的条目则优先于无序首位，否则取 products[0].name
   *   ③ 兜底常量 'default'
   *
   * 多 product 工程若 harness 不应猜首位，必须在此显式声明（常见为 `"product"`）。空字符串等同未声明。
   */
  preferredProduct?: string;
}

/** Skill 6 真机自动化（hmos-app profile · tools.hylyre） */
export interface HylyreToolConfig {
  /** 相对 projectRoot：vendor wheel + release.manifest.json */
  vendor_dir: string;
  /** 相对 projectRoot：隔离 Python 环境目录 */
  venv_dir: string;
  /** 相对 projectRoot：App 快照缓存根目录（经环境变量注入子进程） */
  app_snapshot_cache_dir: string;
  /** PyPI extra index；空字符串表示仅使用用户/全局 pip 配置 */
  pypi_extra_index_url: string;
  /** false：环境缺失时 fail-fast，不自动建 venv / 安装 */
  auto_install: boolean;
  /** true：首次 pip 安装成功后执行一次 doctor */
  doctor_first_run: boolean;
  /**
   * Hypium `start_app` 的 ability 名（与 hylyre `run --page-name` 一致，对应 entry 模块 `module.json5` 的 mainElement）。
   * 空字符串时由 device-test-run 自动扫描工程内首个 `"type": "entry"` 模块的 mainElement。
   */
  hypium_page_name: string;
}

export interface FrameworkToolsConfig {
  hylyre?: Partial<HylyreToolConfig>;
}

export interface FrameworkPaths {
  /**
   * 功能级需求目录：每个 feature 一个子目录，扁平归档所有产物
   * （PRD.md / design.md / contracts.yaml / contracts.planned.yaml /
   *   acceptance.yaml / boundaries.yaml / review-report.md /
   *   test-plan.md / test-report.md 等）。
   *
   * 阶段 9 前曾存在 `feature_docs_dir` + `feature_specs_dir` 两个字段；
   * 现已合并为本字段，老字段会在加载时被检测并抛错。
   */
  features_dir: string;
  /** 模块画像 SSOT */
  module_catalog: string;
  /** 术语表 SSOT */
  glossary: string;
  /** 术语种子 */
  glossary_seed: string;
  /** 架构说明文档 */
  architecture_md: string;
  /**
   * 阶段状态机文件（agent 工作流强制门 / Layer 3）。
   *
   * 由 harness-runner.ts 在每次运行完成后写入；Stop hook
   * （实例根 Stop hook，若已配置）在 agent 即将结束消息时读取，
   * 用于物理拦截"未跑 harness / 未完成 verifier 就声称完成"的弱模型行为。
   *
   * 默认 `framework/harness/state/.current-phase.json`。仓库实际可设为 ignore
   * （每开发者本地状态机），由 `.gitkeep` 占位保留目录结构。
   */
  state_file?: string;
  /**
   * 阶段完成回执（phase-completion-receipt.md）的目录模式。
   *
   * 占位符：
   *   - `<feature>` 替换为 feature 名
   *   - `<phase>`   替换为阶段名
   *
   * 默认 `doc/features/<feature>/<phase>/phase-completion-receipt.md` 的父目录，
   * 即 `doc/features/<feature>/<phase>`。check-receipt.ts 与 Stop hook 会按此
   * 模式定位回执文件。
   */
  receipt_dir_pattern?: string;
  /**
   * `doc/features/**` 是否预期提交到版本库。
   *
   * 默认 **false**：真实工程中需求过程产物仅存工作区不入主仓；
   * 模拟 / 归档工程可设为 true（如本仓库将需求产物归档入库的演示配置）。
   */
  docs_committed?: boolean;
  /**
   * 实例侧 extension 根目录（相对实例工程根）。默认 `doc/extensions`。
   */
  extension_dir?: string;
  /**
   * Feature 阶段 harness 报告目录（相对实例工程根）的占位符模式。
   *
   * 占位符：`<feature>`、`<phase>`（与 `receipt_dir_pattern` 一致）。
   * 典型值：`doc/features/<feature>/<phase>/reports` —— 报告与需求产物同树，
   * 便于整体替换 `framework/` 子目录而不丢失过程记录。
   *
   * **未在 `framework.config.json` 中声明时**：回退到旧布局
   * `framework/harness/reports/<feature>/<phase>/`（与历史实例兼容）。
   */
  reports_dir_pattern?: string;
  /**
   * generic adapter：agent 产物 bundle 根目录（相对实例工程根），如 `.agents`、`.codex`。
   * `agent_adapter === "generic"` 时必填。
   */
  agent_bundle_root?: string;
  /**
   * generic adapter：bundle 内 skills 物化方式。
   * - `inline`：从 `framework/skills/` 生成带 frontmatter 的完整 SKILL（strict 类 agent）
   * - `bridge`：薄跳板 + 链接（Cursor 类等会跟进链接的 agent）
   */
  agent_bundle_skill_mode?: AgentBundleSkillMode;
}

export type AgentBundleSkillMode = 'bridge' | 'inline';

/** PRD harness Visual Handoff 守门档位（`prd` 段为 opt-in 时写入） */
export type VisualHandoffEnforcementMode = 'strict' | 'warn' | 'reachable' | 'off';

export interface VisualSourcesConfig {
  external_roots?: Record<string, string>;
  allow_absolute_paths?: boolean;
  allow_network_paths?: boolean;
}

export interface PrdHarnessConfig {
  /**
   * Visual Handoff（ui_change / kind / authoritative_refs）脚本守门强度；
   * 未配置整个 `prd` 段时，check-prd 对「缺失 ui_change 块」**静默**，见 check-prd 文档。
   */
  visual_handoff_enforcement?: VisualHandoffEnforcementMode;
  /** 外部 UX 根目录与绝对路径 / UNC 安全开关 */
  visual_sources?: VisualSourcesConfig;
}

export interface ProjectProfileConfig {
  /** 与 framework/profiles/<name>/ 对齐 */
  name: string;
  /** 同一 profile 下的子变体（如 hmos-app → element-service） */
  sub_variant?: string;
}

/**
 * AGENTS.md / CLAUDE.md 等入口文档中「子型」占位符：未配置 `project_profile.sub_variant` 时的展示文案（如标准 HAP 应用）。
 */
export const DEFAULT_PROJECT_PROFILE_SUB_VARIANT_DISPLAY = '标准应用';

export interface FrameworkConfig {
  schema_version: string;
  project_name: string;
  /**
   * 应用子型（遗留字段）：**请改用** `project_profile.sub_variant`。
   * `atomic_service` ≡ `sub_variant: element-service`；`app` ≡ 省略 sub_variant 或后续显式 `app`。
   */
  project_type: 'app' | 'atomic_service';
  /** 工程类型模板（与 agent_adapter 正交），未在 JSON 中声明时归一为 hmos-app */
  project_profile: ProjectProfileConfig;
  /** 本阶段仅记录，不驱动行为；阶段 5 的 adapter 层会消费 */
  agent_adapter: 'generic' | 'claude' | 'cursor' | string;
  architecture: ArchitectureDsl;
  paths: FrameworkPaths;
  /**
   * 工具链配置（v2.3 起）。
   * 可选字段：老工程未声明时保持 undefined，不影响现有 check-*.ts 行为；
   * 新工程或从 IDE 迁移来的工程应在 framework-init 时填写。
   */
  toolchain?: ToolchainConfig;
  /**
   * 阶段状态机时间常量（v2.8 起）。可选；未声明时使用 DEFAULT_STATE_MACHINE。
   * 给 Stop hook 的"陈旧 state"判定提供可调阈值，详见 [StateMachineConfig]。
   */
  state_machine?: StateMachineConfig;
  /** PRD 脚本阶段行为（可选） */
  prd?: PrdHarnessConfig;
  /**
   * Harness workflow 名称（无后缀），对应 `framework/workflows/<name>.workflow.yaml`。
   * 默认 `spec-driven`。
   */
  active_workflow?: string;
  /**
   * 是否启用 lifecycle hooks（workflow/extension）。默认 true。
   */
  lifecycle_hooks_enabled?: boolean;
  /**
   * 可选宿主工具配置（如 hmos-app 真机自动化）；未声明时由 resolve* 辅助函数回退默认值。
   */
  tools?: FrameworkToolsConfig;
}

// --------------------------------------------------------------------------
// 参考实例默认 DSL（向后兼容：无 framework.config.json 时以此为准）
//
// 以 HarmonyOS 应用常见的 5 外层 + 4 内层作为示例，仅保证历史 feature 在无
// config 时可继续跑通；新工程应通过 framework.config.json 显式声明自己的
// 架构 DSL，不要依赖这里的具体 id。
// --------------------------------------------------------------------------

export const LEGACY_DEFAULT_DSL: ArchitectureDsl = {
  outer_layers: [
    {
      id: '01-Product',
      can_depend_on: ['02-Feature', '03-CommonBusiness', '04-BusinessBase', '05-SystemBase'],
      intra_layer_deps: 'forbid',
    },
    {
      id: '02-Feature',
      can_depend_on: ['03-CommonBusiness', '04-BusinessBase', '05-SystemBase'],
      intra_layer_deps: 'forbid',
    },
    {
      id: '03-CommonBusiness',
      can_depend_on: ['04-BusinessBase', '05-SystemBase'],
      intra_layer_deps: 'dag',
    },
    {
      id: '04-BusinessBase',
      can_depend_on: ['05-SystemBase'],
      intra_layer_deps: 'forbid',
    },
    {
      id: '05-SystemBase',
      can_depend_on: [],
      intra_layer_deps: 'sublayer',
      sublayers: [
        {
          id: 'CommUI',
          members_pattern_or_list: ['CommUI'],
          can_depend_on_sublayers: ['CommFunc'],
        },
        {
          id: 'CommFunc',
          members_pattern_or_list: ['CommFunc'],
          can_depend_on_sublayers: [],
        },
      ],
    },
  ],
  module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
  inner_dependency_direction: 'upward',
  cross_module_exports_file: 'index.ets',
};

function mergeAgentBundlePathDefaults(paths: FrameworkPaths, agentAdapter: string): FrameworkPaths {
  if (agentAdapter !== 'generic') {
    return paths;
  }
  const next = { ...paths };
  if (!next.agent_bundle_root || !String(next.agent_bundle_root).trim()) {
    next.agent_bundle_root = '.agents';
  }
  if (next.agent_bundle_skill_mode === undefined || next.agent_bundle_skill_mode === null) {
    next.agent_bundle_skill_mode = 'inline';
  }
  return next;
}

function validateAgentBundleForConfig(cfg: FrameworkConfig): void {
  if (cfg.agent_adapter !== 'generic') {
    return;
  }
  const root = typeof cfg.paths.agent_bundle_root === 'string' ? cfg.paths.agent_bundle_root.trim() : '';
  if (!root) {
    throw new Error(
      '[agent-bundle] agent_adapter=generic 时必须配置 paths.agent_bundle_root（如 ".agents"）',
    );
  }
  if (root.includes('..') || path.isAbsolute(root) || /^[a-zA-Z]:/.test(root)) {
    throw new Error('[agent-bundle] paths.agent_bundle_root 必须是相对实例工程根的安全路径');
  }
  const mode = cfg.paths.agent_bundle_skill_mode;
  if (mode !== undefined && mode !== 'bridge' && mode !== 'inline') {
    throw new Error('[agent-bundle] paths.agent_bundle_skill_mode 必须是 bridge 或 inline');
  }
}

export const DEFAULT_PATHS: FrameworkPaths = {
  features_dir: 'doc/features',
  module_catalog: 'doc/module-catalog.yaml',
  glossary: 'doc/glossary.yaml',
  glossary_seed: 'doc/glossary-seed.txt',
  architecture_md: 'doc/architecture.md',
  state_file: 'framework/harness/state/.current-phase.json',
  receipt_dir_pattern: 'doc/features/<feature>/<phase>',
  docs_committed: false,
  extension_dir: 'doc/extensions',
};

/**
 * 阶段状态机时间常量默认值（v2.4）。
 *
 * **重要**：本对象的字段值须与实例根 Stop hook 脚本内嵌的
 * `HOOK_DEFAULT_GRACE_MS` / `HOOK_DEFAULT_TTL_MS` 保持一致，由
 * `framework/harness/test/hook-stale-state.spec.ts` 的 T11"配置一致性"
 * 用例校验。修改其中一边后必须同步修改另一边。
 */
export const DEFAULT_STATE_MACHINE: StateMachineConfig = {
  grace_period_minutes: 5,
  ttl_hours: 12,
  schema_version: '1.1',
};

/** state_machine 字段的有效范围（双端共享，hook 端通过文档同步而非 import） */
export const STATE_MACHINE_RANGES = {
  grace_period_minutes: { min: 0.0001, max: 60 }, // 严格 > 0；上限 60 分钟
  ttl_hours: { min: 1, max: 168 }, // 1 小时 ~ 7 天
} as const;

/** 阶段 9 被合并废弃的老路径字段，检测到即拒绝加载。 */
const DEPRECATED_PATH_FIELDS = ['feature_docs_dir', 'feature_specs_dir'] as const;

// --------------------------------------------------------------------------
// 加载
// --------------------------------------------------------------------------

const CONFIG_FILENAME = 'framework.config.json';

let cachedConfig: { root: string; config: FrameworkConfig } | null = null;

/** `project_type` 弃用提示：每进程最多 stderr 一次，避免批量单测刷屏 */
let warnedProjectTypeAliasMigration = false;
let warnedMissingProjectProfile = false;

/**
 * 加载 framework 配置。读取顺序：
 *   1. `<projectRoot>/framework.config.json`（若存在且合法）
 *   2. 回退到 LEGACY_DEFAULT_DSL + DEFAULT_PATHS 组装的默认配置
 *
 * 每次调用时针对 projectRoot 做一次内存缓存，避免 check-*.ts 互相调用
 * 时反复读盘。若同一进程内需要切换项目根（测试场景），可调用
 * `clearFrameworkConfigCache()` 显式失效。
 */
export function loadFrameworkConfig(projectRoot: string): FrameworkConfig {
  if (cachedConfig && cachedConfig.root === projectRoot) {
    return cachedConfig.config;
  }

  const configPath = path.join(projectRoot, CONFIG_FILENAME);
  let config: FrameworkConfig;
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `[framework/config.ts] ${CONFIG_FILENAME} 不是合法 JSON：${(err as Error).message}`,
      );
    }
    assertNoDeprecatedPaths(parsed);
    config = normalizeConfig(parsed as Partial<FrameworkConfig>);
  } else {
    config = buildDefaultConfig();
  }

  validateArchitectureDsl(config.architecture);
  if (config.state_machine) {
    validateStateMachine(config.state_machine);
  }
  validateAgentBundleForConfig(config);

  cachedConfig = { root: projectRoot, config };
  return config;
}

/** 方便外层调用——多数 check-*.ts 只关心架构 DSL */
export function loadArchitectureDsl(projectRoot: string): ArchitectureDsl {
  return loadFrameworkConfig(projectRoot).architecture;
}

/** 清缓存（供测试使用） */
export function clearFrameworkConfigCache(): void {
  cachedConfig = null;
}

export function resetFrameworkConfigWarningsForTest(): void {
  warnedProjectTypeAliasMigration = false;
  warnedMissingProjectProfile = false;
}

// --------------------------------------------------------------------------
// 归一化 / defaults 合并
// --------------------------------------------------------------------------

function buildDefaultConfig(profileName = 'hmos-app'): FrameworkConfig {
  const profileDefaults = loadProfileConfigDefaults(profileName);
  const projectProfileDefault =
    profileDefaults.project_profile && typeof profileDefaults.project_profile === 'object'
      ? (profileDefaults.project_profile as ProjectProfileConfig)
      : { name: profileName };
  const architectureDefault = profileDefaults.architecture
    ? normalizeArchitecture(profileDefaults.architecture as Partial<ArchitectureDsl>, LEGACY_DEFAULT_DSL)
    : cloneDsl(LEGACY_DEFAULT_DSL);
  const pathsDefault = applyDefaults(profileDefaults.paths ?? {}, DEFAULT_PATHS) as FrameworkPaths;
  const agentAdapter = 'generic';
  return {
    schema_version: '1.1',
    project_name: 'unknown',
    project_type: 'app',
    project_profile: {
      name: projectProfileDefault.name ?? profileName,
      ...(projectProfileDefault.sub_variant ? { sub_variant: projectProfileDefault.sub_variant } : {}),
    },
    agent_adapter: agentAdapter,
    architecture: architectureDefault,
    paths: mergeAgentBundlePathDefaults({ ...pathsDefault }, agentAdapter),
    state_machine: { ...DEFAULT_STATE_MACHINE },
    active_workflow: 'spec-driven',
    lifecycle_hooks_enabled: true,
  };
}

function normalizeProjectProfile(
  rawProfile: unknown,
  projectType: 'app' | 'atomic_service' | undefined,
): ProjectProfileConfig {
  if (
    rawProfile &&
    typeof rawProfile === 'object' &&
    typeof (rawProfile as ProjectProfileConfig).name === 'string' &&
    (rawProfile as ProjectProfileConfig).name.trim().length > 0
  ) {
    const p = rawProfile as ProjectProfileConfig;
    const n = p.name.trim();
    const sv =
      typeof p.sub_variant === 'string' && p.sub_variant.trim().length > 0
        ? p.sub_variant.trim()
        : undefined;
    return { name: n, ...(sv ? { sub_variant: sv } : {}) };
  }
  if (!warnedMissingProjectProfile) {
    warnedMissingProjectProfile = true;
    console.warn(
      '[framework/config] advisory：framework.config.json 缺少 `project_profile`，本进程按 hmos-app 兼容默认值运行。建议执行 framework-init UPDATE 写入显式 project_profile。',
    );
  }
  const sub = projectType === 'atomic_service' ? 'element-service' : undefined;
  if (projectType === 'atomic_service') {
    console.warn(
      `[framework/config] 检测到 legacy project_type=atomic_service：` +
        ' 推导为 project_profile=hmos-app + sub_variant=element-service。建议在 `framework.config.json` 显式写入 `"project_profile": { "name": "hmos-app", "sub_variant": "element-service" }` 并减少对 project_type 的依赖。',
    );
  }
  return { name: 'hmos-app', ...(sub ? { sub_variant: sub } : {}) };
}

/**
 * 阶段 9：检测 `framework.config.json` 是否仍含被合并掉的老路径字段。
 * 本仓是目前唯一实例工程，硬切策略——读到老字段直接抛错，引导用户迁移。
 */
function assertNoDeprecatedPaths(parsed: unknown): void {
  if (!parsed || typeof parsed !== 'object') return;
  const paths = (parsed as { paths?: unknown }).paths;
  if (!paths || typeof paths !== 'object') return;
  const record = paths as Record<string, unknown>;
  const hit = DEPRECATED_PATH_FIELDS.filter((k) => record[k] !== undefined);
  if (hit.length > 0) {
    throw new Error(
      `[framework/config.ts] ${CONFIG_FILENAME} 含有已废弃字段：${hit.join(', ')}。` +
        '\n阶段 9 起已合并为单字段 `features_dir`（默认 "doc/features"）。' +
        '\n请把 `paths.feature_docs_dir` 与 `paths.feature_specs_dir` 删除，改为：' +
        '\n  "paths": { "features_dir": "doc/features", ... }',
    );
  }
}

function normalizeTools(raw: FrameworkToolsConfig | undefined): FrameworkToolsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const hy = raw.hylyre;
  if (!hy || typeof hy !== 'object') return undefined;
  return { hylyre: { ...hy } };
}

function normalizePrdHarness(raw: PrdHarnessConfig | undefined): PrdHarnessConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  let visual_handoff_enforcement: VisualHandoffEnforcementMode | undefined;
  const modeRaw = raw.visual_handoff_enforcement;
  if (modeRaw !== undefined && modeRaw !== null) {
    const mode = String(modeRaw).trim() as VisualHandoffEnforcementMode;
    const allowed = new Set<VisualHandoffEnforcementMode>(['strict', 'warn', 'reachable', 'off']);
    if (!allowed.has(mode)) {
      throw new Error(
        `[framework/config.ts] prd.visual_handoff_enforcement 必须是 "strict" | "warn" | "reachable" | "off"，收到 ${String(modeRaw)}`,
      );
    }
    visual_handoff_enforcement = mode;
  }

  let visual_sources: VisualSourcesConfig | undefined;
  const vsRaw = raw.visual_sources;
  if (vsRaw && typeof vsRaw === 'object') {
    const roots = vsRaw.external_roots;
    visual_sources = {
      ...(roots && typeof roots === 'object' && !Array.isArray(roots)
        ? { external_roots: { ...(roots as Record<string, string>) } }
        : {}),
      allow_absolute_paths: Boolean(vsRaw.allow_absolute_paths),
      allow_network_paths: Boolean(vsRaw.allow_network_paths),
    };
  }

  const hasAny =
    visual_handoff_enforcement !== undefined || (visual_sources !== undefined && Object.keys(visual_sources).length > 0);
  if (!hasAny) return undefined;

  return {
    ...(visual_handoff_enforcement !== undefined ? { visual_handoff_enforcement } : {}),
    ...(visual_sources !== undefined ? { visual_sources } : {}),
  };
}

function normalizeConfig(raw: Partial<FrameworkConfig>): FrameworkConfig {
  const project_profile = normalizeProjectProfile(raw.project_profile, raw.project_type);
  const fallback = buildDefaultConfig(project_profile.name);
  const project_type =
    raw.project_type ?? (project_profile.sub_variant === 'element-service' ? 'atomic_service' : 'app');
  if (raw.project_type !== undefined && !warnedProjectTypeAliasMigration) {
    warnedProjectTypeAliasMigration = true;
    console.warn(
      '[framework/config] Deprecated：`project_type` 仅存 alias；请改用 `project_profile.sub_variant`（`element-service` = 原 atomic_service）。',
    );
  }

  return {
    schema_version: raw.schema_version ?? fallback.schema_version,
    project_name: raw.project_name ?? fallback.project_name,
    project_type,
    project_profile,
    agent_adapter: raw.agent_adapter ?? fallback.agent_adapter,
    architecture: raw.architecture
      ? normalizeArchitecture(raw.architecture, fallback.architecture)
      : fallback.architecture,
    paths: mergeAgentBundlePathDefaults(
      { ...fallback.paths, ...(raw.paths ?? {}) },
      raw.agent_adapter ?? fallback.agent_adapter,
    ),
    toolchain: normalizeToolchain(raw.toolchain),
    state_machine: normalizeStateMachine(raw.state_machine),
    prd: normalizePrdHarness(raw.prd),
    active_workflow:
      typeof raw.active_workflow === 'string' && raw.active_workflow.trim().length > 0
        ? raw.active_workflow.trim()
        : fallback.active_workflow ?? 'spec-driven',
    lifecycle_hooks_enabled: raw.lifecycle_hooks_enabled !== false,
    tools: normalizeTools(raw.tools),
  };
}

/**
 * 归一化 state_machine：
 *   - 未声明 → 完整默认值
 *   - 声明部分字段 → 与默认值合并
 *   - 显式声明的字段会被原样保留供后续 validateStateMachine 校验，
 *     非法值由校验阶段抛错，归一化阶段不悄悄"修正"。
 */
function normalizeStateMachine(raw: StateMachineConfig | undefined): StateMachineConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE_MACHINE };
  return {
    grace_period_minutes:
      typeof raw.grace_period_minutes === 'number'
        ? raw.grace_period_minutes
        : DEFAULT_STATE_MACHINE.grace_period_minutes,
    ttl_hours:
      typeof raw.ttl_hours === 'number'
        ? raw.ttl_hours
        : DEFAULT_STATE_MACHINE.ttl_hours,
    schema_version:
      typeof raw.schema_version === 'string' && raw.schema_version.trim()
        ? raw.schema_version.trim()
        : DEFAULT_STATE_MACHINE.schema_version,
  };
}

function normalizeToolchain(raw: ToolchainConfig | undefined): ToolchainConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const deveco = raw.devEcoStudio;
  let normalizedDeveco: DevEcoStudioConfig | undefined;
  if (deveco && typeof deveco === 'object') {
    const installPath = typeof deveco.installPath === 'string' ? deveco.installPath.trim() : '';
    const hvigorBin = typeof deveco.hvigorBin === 'string' ? deveco.hvigorBin.trim() : '';
    if (installPath || hvigorBin) {
      normalizedDeveco = {
        ...(installPath ? { installPath } : {}),
        ...(hvigorBin ? { hvigorBin } : {}),
      };
    }
  }

  const preferredProduct = typeof raw.preferredProduct === 'string' ? raw.preferredProduct.trim() : '';
  const hvigor = normalizeHvigorOptions(raw.hvigor);

  if (!normalizedDeveco && !preferredProduct && !hvigor) return undefined;

  return {
    ...(normalizedDeveco ? { devEcoStudio: normalizedDeveco } : {}),
    ...(hvigor ? { hvigor } : {}),
    ...(preferredProduct ? { preferredProduct } : {}),
  };
}

function normalizeHvigorCoding(raw: unknown): HvigorCodingConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const allowedDrivers = new Set<string>(['node_hvigorw_js', 'hvigorw_wrapper', 'assemble_app_project']);
  const out: HvigorCodingConfig = {};

  if (typeof r.driver === 'string' && r.driver.trim()) {
    const d = r.driver.trim();
    if (!allowedDrivers.has(d)) {
      throw new Error(
        `[framework/config.ts] toolchain.hvigor.coding.driver 必须是 ` +
          `"node_hvigorw_js" | "hvigorw_wrapper" | "assemble_app_project"，收到 "${d}"`,
      );
    }
    out.driver = d as HvigorCodingConfig['driver'];
  }
  if (typeof r.mode === 'string' && r.mode.trim()) {
    const m = r.mode.trim();
    if (m !== 'module' && m !== 'project') {
      throw new Error(`[framework/config.ts] toolchain.hvigor.coding.mode 必须是 "module" | "project"，收到 "${m}"`);
    }
    out.mode = m;
  }
  if (typeof r.task === 'string' && r.task.trim()) {
    out.task = r.task.trim();
  }
  if (typeof r.passBuildModeDebug === 'boolean') {
    out.passBuildModeDebug = r.passBuildModeDebug;
  }
  if (Array.isArray(r.extraArgs)) {
    const xs = r.extraArgs.filter((x): x is string => typeof x === 'string');
    if (xs.length > 0) out.extraArgs = xs;
  }
  if (Array.isArray(r.successMarkers)) {
    const xs = r.successMarkers.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    if (xs.length > 0) out.successMarkers = xs.map((s) => s.trim());
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeHvigorOptions(raw: HvigorOptionsConfig | undefined): HvigorOptionsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const out: HvigorOptionsConfig = {};
  if (typeof raw.daemon === 'boolean') out.daemon = raw.daemon;
  if (typeof raw.parallel === 'boolean') out.parallel = raw.parallel;
  if (typeof raw.incremental === 'boolean') out.incremental = raw.incremental;
  if (typeof raw.analyze === 'string' && raw.analyze.trim()) {
    const analyze = raw.analyze.trim();
    if (analyze !== 'off' && analyze !== 'normal' && analyze !== 'advanced') {
      throw new Error(
        `[framework/config.ts] toolchain.hvigor.analyze 只支持 "off" | "normal" | "advanced"，收到 "${raw.analyze}"`,
      );
    }
    out.analyze = analyze;
  }

  if (typeof raw.timeoutMs === 'number') {
    if (!Number.isFinite(raw.timeoutMs) || raw.timeoutMs <= 0) {
      throw new Error(`[framework/config.ts] toolchain.hvigor.timeoutMs 必须是正数，收到 ${String(raw.timeoutMs)}`);
    }
    const cap = 6 * 3600 * 1000;
    if (raw.timeoutMs > cap) {
      throw new Error(`[framework/config.ts] toolchain.hvigor.timeoutMs 超过上限 6h（${cap} ms）`);
    }
    out.timeoutMs = Math.floor(raw.timeoutMs);
  }

  const coding = normalizeHvigorCoding(raw.coding);
  if (coding) out.coding = coding;

  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeArchitecture(
  raw: Partial<ArchitectureDsl>,
  fallback: ArchitectureDsl = LEGACY_DEFAULT_DSL,
): ArchitectureDsl {
  return {
    outer_layers: raw.outer_layers
      ? raw.outer_layers.map((l) => ({
          id: l.id,
          can_depend_on: [...(l.can_depend_on ?? [])],
          intra_layer_deps: l.intra_layer_deps ?? 'forbid',
          sublayers: l.sublayers
            ? l.sublayers.map((s) => ({
                id: s.id,
                members_pattern_or_list: [...(s.members_pattern_or_list ?? [])],
                can_depend_on_sublayers: [...(s.can_depend_on_sublayers ?? [])],
              }))
            : undefined,
        }))
      : cloneDsl(fallback).outer_layers,
    module_inner_layers: raw.module_inner_layers
      ? [...raw.module_inner_layers]
      : [...fallback.module_inner_layers],
    inner_dependency_direction: raw.inner_dependency_direction ?? fallback.inner_dependency_direction,
    cross_module_exports_file: raw.cross_module_exports_file ?? fallback.cross_module_exports_file,
  };
}

function cloneDsl(dsl: ArchitectureDsl): ArchitectureDsl {
  return JSON.parse(JSON.stringify(dsl)) as ArchitectureDsl;
}

// --------------------------------------------------------------------------
// 元规则校验
// --------------------------------------------------------------------------

/**
 * 守 4 条 framework 元规则：
 *
 *   1. outer_layers[].id 唯一且非空；
 *   2. outer_layers[].can_depend_on 每个引用都能在 outer_layers[].id 里找到；
 *   3. outer_layers 的依赖图是 DAG（禁止自环、禁止循环）；
 *   4. module_inner_layers 非空；inner_dependency_direction === 'upward'；
 *      cross_module_exports_file 非空。
 *
 * 任一失败均抛异常——配置错了就别启动，避免后续 check-*.ts 拿到半残的 DSL
 * 得出误报结论。
 */
export function validateArchitectureDsl(arch: ArchitectureDsl): void {
  if (!Array.isArray(arch.outer_layers) || arch.outer_layers.length === 0) {
    throw new Error('[framework/config.ts] architecture.outer_layers 不能为空。');
  }

  const seenIds = new Set<string>();
  for (const layer of arch.outer_layers) {
    if (!layer.id || typeof layer.id !== 'string') {
      throw new Error(
        '[framework/config.ts] architecture.outer_layers[].id 必须是非空字符串。',
      );
    }
    if (seenIds.has(layer.id)) {
      throw new Error(
        `[framework/config.ts] architecture.outer_layers 中存在重复的 id "${layer.id}"。`,
      );
    }
    seenIds.add(layer.id);
  }

  for (const layer of arch.outer_layers) {
    for (const dep of layer.can_depend_on) {
      if (!seenIds.has(dep)) {
        throw new Error(
          `[framework/config.ts] outer layer "${layer.id}".can_depend_on 引用了未声明的 layer "${dep}"。`,
        );
      }
      if (dep === layer.id) {
        throw new Error(
          `[framework/config.ts] outer layer "${layer.id}" 不能自依赖（can_depend_on 出现自身）。`,
        );
      }
    }

    if (layer.intra_layer_deps === 'sublayer') {
      if (!layer.sublayers || layer.sublayers.length === 0) {
        throw new Error(
          `[framework/config.ts] outer layer "${layer.id}" 声明了 intra_layer_deps=sublayer，但 sublayers 为空。`,
        );
      }
      const subIds = new Set<string>();
      for (const sub of layer.sublayers) {
        if (!sub.id) {
          throw new Error(
            `[framework/config.ts] outer layer "${layer.id}".sublayers[].id 必须非空。`,
          );
        }
        if (subIds.has(sub.id)) {
          throw new Error(
            `[framework/config.ts] outer layer "${layer.id}" 中存在重复 sublayer id "${sub.id}"。`,
          );
        }
        subIds.add(sub.id);
      }
      for (const sub of layer.sublayers) {
        for (const ref of sub.can_depend_on_sublayers) {
          if (!subIds.has(ref)) {
            throw new Error(
              `[framework/config.ts] outer layer "${layer.id}".sublayer "${sub.id}".can_depend_on_sublayers 引用了未声明的 "${ref}"。`,
            );
          }
          if (ref === sub.id) {
            throw new Error(
              `[framework/config.ts] outer layer "${layer.id}".sublayer "${sub.id}" 不能自依赖。`,
            );
          }
        }
      }
      // sublayer 依赖图 DAG 自检
      detectCycle(
        layer.sublayers.map((s) => s.id),
        (id) => {
          const sub = layer.sublayers!.find((s) => s.id === id)!;
          return sub.can_depend_on_sublayers;
        },
        `outer layer "${layer.id}".sublayers`,
      );
    } else if (layer.sublayers && layer.sublayers.length > 0) {
      throw new Error(
        `[framework/config.ts] outer layer "${layer.id}".sublayers 仅在 intra_layer_deps=sublayer 时允许填写。`,
      );
    }
  }

  // outer 层依赖图 DAG 自检
  detectCycle(
    arch.outer_layers.map((l) => l.id),
    (id) => arch.outer_layers.find((l) => l.id === id)!.can_depend_on,
    'architecture.outer_layers',
  );

  if (!Array.isArray(arch.module_inner_layers) || arch.module_inner_layers.length === 0) {
    throw new Error('[framework/config.ts] architecture.module_inner_layers 不能为空。');
  }
  const innerSeen = new Set<string>();
  for (const l of arch.module_inner_layers) {
    if (!l || typeof l !== 'string') {
      throw new Error('[framework/config.ts] module_inner_layers 元素必须为非空字符串。');
    }
    if (innerSeen.has(l)) {
      throw new Error(
        `[framework/config.ts] module_inner_layers 中存在重复层名 "${l}"。`,
      );
    }
    innerSeen.add(l);
  }

  if (arch.inner_dependency_direction !== 'upward') {
    throw new Error(
      `[framework/config.ts] 当前版本仅支持 inner_dependency_direction="upward"，收到 "${arch.inner_dependency_direction}"。`,
    );
  }

  if (!arch.cross_module_exports_file || typeof arch.cross_module_exports_file !== 'string') {
    throw new Error(
      '[framework/config.ts] architecture.cross_module_exports_file 必须是非空字符串（例如 "index.ets"）。',
    );
  }
}

function detectCycle(
  nodes: string[],
  getDeps: (id: string) => string[],
  contextLabel: string,
): void {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n, WHITE]));

  const dfs = (node: string, trail: string[]): void => {
    color.set(node, GRAY);
    trail.push(node);
    for (const dep of getDeps(node)) {
      const c = color.get(dep);
      if (c === GRAY) {
        const cycle = trail.slice(trail.indexOf(dep)).concat(dep).join(' → ');
        throw new Error(
          `[framework/config.ts] ${contextLabel} 存在循环依赖：${cycle}`,
        );
      }
      if (c === WHITE) dfs(dep, trail);
    }
    trail.pop();
    color.set(node, BLACK);
  };

  for (const n of nodes) {
    if (color.get(n) === WHITE) dfs(n, []);
  }
}

// --------------------------------------------------------------------------
// 架构 DSL 消费辅助函数
// --------------------------------------------------------------------------

/** outer layer id → 在 outer_layers 数组中的索引（便于"索引小的 = 上层"这种判断） */
export function buildOuterLayerIndex(arch: ArchitectureDsl): Map<string, number> {
  const idx = new Map<string, number>();
  arch.outer_layers.forEach((l, i) => idx.set(l.id, i));
  return idx;
}

/** inner layer 名 → 在 module_inner_layers 数组中的索引 */
export function buildInnerLayerIndex(arch: ArchitectureDsl): Map<string, number> {
  const idx = new Map<string, number>();
  arch.module_inner_layers.forEach((l, i) => idx.set(l, i));
  return idx;
}

/**
 * 判断"from 模块内层"是否可以 import "to 模块内层"。
 *
 * 在 upward 方向下：
 *   - 自身可依赖自身；
 *   - 索引大的层（如 presentation）可依赖索引小的层（如 shared / data / domain）；
 *   - 索引小的层不得反向依赖索引大的层。
 */
export function isInnerDepAllowed(arch: ArchitectureDsl, from: string, to: string): boolean {
  const idx = buildInnerLayerIndex(arch);
  const fi = idx.get(from);
  const ti = idx.get(to);
  if (fi === undefined || ti === undefined) return true;
  return fi >= ti;
}

/** 返回内层被禁止 import 的其他内层（即 from 不能向上依赖的那些层） */
export function getForbiddenInnerImports(arch: ArchitectureDsl, from: string): string[] {
  const idx = buildInnerLayerIndex(arch);
  const fi = idx.get(from);
  if (fi === undefined) return [];
  return arch.module_inner_layers.filter((_, i) => i > fi);
}

/** 判断"from outer layer"是否允许依赖"to outer layer" */
export function isOuterDepAllowed(arch: ArchitectureDsl, from: string, to: string): boolean {
  if (from === to) {
    // 同层：由 check-*.ts 在模块/子层粒度另行判定，这里直接返回 true
    return true;
  }
  const fromLayer = arch.outer_layers.find((l) => l.id === from);
  if (!fromLayer) return true;
  return fromLayer.can_depend_on.includes(to);
}

/** 返回所有 outer layer id（按声明顺序） */
export function getOuterLayerIds(arch: ArchitectureDsl): string[] {
  return arch.outer_layers.map((l) => l.id);
}

/** 给定模块名，在 DSL 中查其所属的 sublayer id（没有则返回 undefined） */
export function findSublayerOf(
  arch: ArchitectureDsl,
  outerLayerId: string,
  moduleName: string,
): string | undefined {
  const layer = arch.outer_layers.find((l) => l.id === outerLayerId);
  if (!layer || layer.intra_layer_deps !== 'sublayer' || !layer.sublayers) return undefined;
  for (const sub of layer.sublayers) {
    if (sub.members_pattern_or_list.includes(moduleName)) return sub.id;
  }
  return undefined;
}

/** 与 `scripts/utils/types` 中 GLOBAL_FEATURE_SENTINEL（`_global`）一致；不 import types 以防环依赖 */
const GLOBAL_FEATURE_REPORTS_SENTINEL = '_global';

// --------------------------------------------------------------------------
// 路径解析（阶段 3：集中管理可覆盖路径）
// --------------------------------------------------------------------------
//
// 设计原则：
//   - 调用方只要拿到 `projectRoot`，就能通过本节的函数获得任何框架关心的路径；
//     不允许绕过这里自己拼 "doc/..." 或 "specs/..." 字符串。
//   - 绝对路径函数命名为 `xxxPath` / `xxxDir`，相对路径（供错误信息 / 报告
//     `affected_files` 展示）命名为 `relXxx`。相对路径始终以 POSIX 正斜杠
//     呈现（Windows 下也不转 `\`），保持错误消息跨平台一致。
//   - `phaseRulesDir` / `reportsDir` / `promptsDir` 是 framework 侧资产，默认
//     位于 `<projectRoot>/framework/...` 下；若 framework/ 被放到其他位置，
//     调用方可显式传入 `frameworkRoot` 覆盖。
//   - Feature 维度脚本报告：优先 `featurePhaseReportsDir()`（可与 `doc/features/.../reports`
//     对齐）；全局阶段 `_global` 仍使用 `reportsDir` 树下路径。

/** 运行时解析后的绝对路径集合（由 `resolvePaths` 返回） */
export interface ResolvedPaths {
  projectRoot: string;
  frameworkRoot: string;
  /** framework/specs/phase-rules 的绝对路径 */
  phaseRulesDir: string;
  /** framework/harness/reports 的绝对路径（全局 `_global` 与未配置 reports_dir_pattern 时的 feature 回退） */
  reportsDir: string;
  /** framework/harness/prompts 的绝对路径 */
  promptsDir: string;
  /**
   * 实例工程的功能级需求目录（如 <root>/doc/features）：每个 feature 子目录
   * 同时容纳文档（PRD/design/report）与契约（contracts/acceptance）。
   */
  featuresDir: string;
  /** 模块画像 SSOT 绝对路径 */
  moduleCatalogYaml: string;
  /** 术语表 SSOT 绝对路径 */
  glossaryYaml: string;
  /** 术语种子绝对路径 */
  glossarySeedTxt: string;
  /** 架构说明文档绝对路径 */
  architectureMd: string;
  /** 阶段状态机文件绝对路径（agent 工作流强制门 / Stop hook 读取） */
  stateFile: string;
  /** 回执目录模式（含 `<feature>` / `<phase>` 占位符），未替换的相对路径 */
  receiptDirPattern: string;
}

/**
 * 把 `framework.config.json` 中声明的相对路径统一解析为绝对路径。
 *
 * @param projectRoot 实例工程根的绝对路径
 * @param frameworkRoot framework/ 所在绝对路径；默认 `<projectRoot>/framework`
 */
export function resolvePaths(projectRoot: string, frameworkRoot?: string): ResolvedPaths {
  const cfg = loadFrameworkConfig(projectRoot);
  const fRoot = frameworkRoot ?? path.join(projectRoot, 'framework');
  return {
    projectRoot,
    frameworkRoot: fRoot,
    phaseRulesDir: path.join(fRoot, 'specs', 'phase-rules'),
    reportsDir: path.join(fRoot, 'harness', 'reports'),
    promptsDir: path.join(fRoot, 'harness', 'prompts'),
    featuresDir: path.resolve(projectRoot, cfg.paths.features_dir),
    moduleCatalogYaml: path.resolve(projectRoot, cfg.paths.module_catalog),
    glossaryYaml: path.resolve(projectRoot, cfg.paths.glossary),
    glossarySeedTxt: path.resolve(projectRoot, cfg.paths.glossary_seed),
    architectureMd: path.resolve(projectRoot, cfg.paths.architecture_md),
    stateFile: path.resolve(
      projectRoot,
      cfg.paths.state_file ?? DEFAULT_PATHS.state_file!,
    ),
    receiptDirPattern: cfg.paths.receipt_dir_pattern ?? DEFAULT_PATHS.receipt_dir_pattern!,
  };
}

// ---- 单条绝对路径 -------------------------------------------------------

export function catalogPath(projectRoot: string): string {
  return path.join(projectRoot, loadFrameworkConfig(projectRoot).paths.module_catalog);
}

export function glossaryPath(projectRoot: string): string {
  return path.join(projectRoot, loadFrameworkConfig(projectRoot).paths.glossary);
}

export function glossarySeedPath(projectRoot: string): string {
  return path.join(projectRoot, loadFrameworkConfig(projectRoot).paths.glossary_seed);
}

export function architectureMdPath(projectRoot: string): string {
  return path.join(projectRoot, loadFrameworkConfig(projectRoot).paths.architecture_md);
}

/** 功能级需求目录的绝对路径（<root>/doc/features） */
export function featuresDirPath(projectRoot: string): string {
  return path.join(projectRoot, loadFrameworkConfig(projectRoot).paths.features_dir);
}

/** 某 feature 的完整目录（<features_dir>/<feature>） */
export function featureDir(projectRoot: string, feature: string): string {
  return path.join(featuresDirPath(projectRoot), feature);
}

/** feature 局部的框架升级 compat 约定路径（<features_dir>/<feature>/compat.yaml） */
export function featureCompatPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'compat.yaml');
}

/**
 * feature 目录下的某个文件的绝对路径，如 PRD.md / design.md / contracts.yaml /
 * acceptance.yaml / review-report.md / test-plan.md / test-report.md 等。
 * 阶段 9 合并前的 `featureDocPath` 与 `featureSpecPath` 现均由本函数承担。
 */
export function featureFilePath(projectRoot: string, feature: string, fileName: string): string {
  return path.join(featureDir(projectRoot, feature), fileName);
}

/** 阶段状态机文件绝对路径（agent 工作流强制门用） */
export function statefilePath(projectRoot: string): string {
  const cfg = loadFrameworkConfig(projectRoot);
  const rel = cfg.paths.state_file ?? DEFAULT_PATHS.state_file!;
  return path.resolve(projectRoot, rel);
}

/**
 * 将 receipt_dir_pattern 中的 `<feature>` / `<phase>` 占位符替换为实参，并返回绝对路径。
 * 默认指向 `doc/features/<feature>/<phase>` 目录。
 */
export function receiptDirPath(projectRoot: string, feature: string, phase: string): string {
  const cfg = loadFrameworkConfig(projectRoot);
  const pattern = cfg.paths.receipt_dir_pattern ?? DEFAULT_PATHS.receipt_dir_pattern!;
  const rel = pattern.replace(/<feature>/g, feature).replace(/<phase>/g, phase);
  return path.resolve(projectRoot, rel);
}

/** 阶段完成回执文件绝对路径 = receiptDirPath / phase-completion-receipt.md */
export function receiptFilePath(projectRoot: string, feature: string, phase: string): string {
  return path.join(receiptDirPath(projectRoot, feature, phase), 'phase-completion-receipt.md');
}

/**
 * 某一 feature 在某 phase 下 harness 报告产出目录的绝对路径。
 *
 * - `feature === '_global'`（全局阶段 catalog / glossary / init 等）：固定为
 *   `<frameworkRoot>/harness/reports/_global/<phase>`。
 * - 否则：若配置了 `paths.reports_dir_pattern`，按占位符解析到实例根下路径；
 *   未配置则回退到 `<frameworkRoot>/harness/reports/<feature>/<phase>`。
 */
export function featurePhaseReportsDir(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): string {
  const fRoot = frameworkRoot ?? path.join(projectRoot, 'framework');
  if (feature === GLOBAL_FEATURE_REPORTS_SENTINEL) {
    return path.join(fRoot, 'harness', 'reports', '_global', phase);
  }
  const cfg = loadFrameworkConfig(projectRoot);
  const pattern = cfg.paths.reports_dir_pattern;
  if (typeof pattern === 'string' && pattern.trim().length > 0) {
    const rel = pattern.replace(/<feature>/g, feature).replace(/<phase>/g, phase);
    return path.resolve(projectRoot, rel);
  }
  return path.join(fRoot, 'harness', 'reports', feature, phase);
}

/** `featurePhaseReportsDir` 相对 `projectRoot` 的 POSIX 风格路径（用于日志 / summary）。 */
export function relFeaturePhaseReportsDir(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): string {
  const abs = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
  return toPosix(path.relative(projectRoot, abs));
}

// ---- 单条相对路径（用于 affected_files / 错误消息展示） ------------------

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function relCatalog(projectRoot: string): string {
  return toPosix(loadFrameworkConfig(projectRoot).paths.module_catalog);
}

export function relGlossary(projectRoot: string): string {
  return toPosix(loadFrameworkConfig(projectRoot).paths.glossary);
}

export function relGlossarySeed(projectRoot: string): string {
  return toPosix(loadFrameworkConfig(projectRoot).paths.glossary_seed);
}

export function relArchitectureMd(projectRoot: string): string {
  return toPosix(loadFrameworkConfig(projectRoot).paths.architecture_md);
}

export function relFeaturesDir(projectRoot: string): string {
  return toPosix(loadFrameworkConfig(projectRoot).paths.features_dir);
}

/**
 * feature 目录下某文件的相对路径字符串（POSIX 正斜杠，用于错误消息 /
 * trace 的 affected_files 展示）。阶段 9 前的 `relFeatureDoc` 与
 * `relFeatureSpec` 现均由本函数承担。
 */
export function relFeatureFile(projectRoot: string, feature: string, fileName: string): string {
  return `${relFeaturesDir(projectRoot)}/${feature}/${fileName}`;
}

// --------------------------------------------------------------------------
// 架构 DSL 消费辅助函数（续）
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// 阶段状态机配置消费辅助（v2.4）
// --------------------------------------------------------------------------

/**
 * 校验 state_machine 段。配错即抛——避免 hook / harness 拿到非法值后
 * 行为退化为"默认值悄悄生效"，而用户以为自己的配置在用。
 *
 * 与 validateArchitectureDsl 一样属于"硬校验"层级。
 */
export function validateStateMachine(sm: StateMachineConfig): void {
  const gpm = sm.grace_period_minutes;
  if (
    typeof gpm !== 'number' ||
    !Number.isFinite(gpm) ||
    gpm <= 0 ||
    gpm > STATE_MACHINE_RANGES.grace_period_minutes.max
  ) {
    throw new Error(
      `[framework/config.ts] state_machine.grace_period_minutes 必须是 (0, ${STATE_MACHINE_RANGES.grace_period_minutes.max}] 之间的数，收到 ${String(gpm)}`,
    );
  }
  const tlh = sm.ttl_hours;
  if (
    typeof tlh !== 'number' ||
    !Number.isFinite(tlh) ||
    tlh < STATE_MACHINE_RANGES.ttl_hours.min ||
    tlh > STATE_MACHINE_RANGES.ttl_hours.max
  ) {
    throw new Error(
      `[framework/config.ts] state_machine.ttl_hours 必须是 [${STATE_MACHINE_RANGES.ttl_hours.min}, ${STATE_MACHINE_RANGES.ttl_hours.max}] 之间的数，收到 ${String(tlh)}`,
    );
  }
}

/**
 * 返回归一化（含默认值）后的 state_machine 配置。永远不返回 undefined。
 */
export function loadStateMachineConfig(projectRoot: string): StateMachineConfig {
  const cfg = loadFrameworkConfig(projectRoot);
  return { ...DEFAULT_STATE_MACHINE, ...(cfg.state_machine ?? {}) };
}

/** state_machine 的运行时时间值（毫秒），由 hook 与 runner 共同使用 */
export interface ResolvedStateTimings {
  gracePeriodMs: number;
  ttlMs: number;
}

/**
 * 把 grace_period_minutes / ttl_hours 解析为毫秒值，便于直接与
 * `Date.now() - new Date(state.updated_at).getTime()` 比较。
 */
export function resolveStateTimings(projectRoot: string): ResolvedStateTimings {
  const sm = loadStateMachineConfig(projectRoot);
  return {
    gracePeriodMs: sm.grace_period_minutes * 60 * 1000,
    ttlMs: sm.ttl_hours * 3600 * 1000,
  };
}

// --------------------------------------------------------------------------
// 工具链配置消费辅助（v2.3）
// --------------------------------------------------------------------------

/**
 * 从 DevEco Studio 安装根目录推导 hvigor wrapper 的绝对路径。
 *
 * 约定（基于 DevEco Studio 5.x / 6.x 实际目录结构）：
 *   {installPath}/tools/hvigor/bin/hvigorw.bat   (Windows)
 *   {installPath}/tools/hvigor/bin/hvigorw       (macOS / Linux)
 *
 * 若 `installPath` 为空/不是字符串则返回 null；不做文件存在性校验
 * （由调用方真实执行时报告缺失）。
 */
export function deriveHvigorBinFromInstallPath(installPath: string | undefined): string | null {
  if (!installPath || typeof installPath !== 'string') return null;
  const trimmed = installPath.trim();
  if (!trimmed) return null;
  const winBin = path.join(trimmed, 'tools', 'hvigor', 'bin', 'hvigorw.bat');
  const unixBin = path.join(trimmed, 'tools', 'hvigor', 'bin', 'hvigorw');
  return process.platform === 'win32' ? winBin : unixBin;
}

/**
 * 从 DevEco Studio 安装根目录推导 DEVECO_SDK_HOME 环境变量的值。
 * hvigor 在命令行模式下必须能找到 SDK，否则报
 *   `Invalid value of 'DEVECO_SDK_HOME' in the system environment path`。
 * 约定：{installPath}/sdk（其下含 default/openharmony + default/hms）。
 */
export function deriveSdkHomeFromInstallPath(installPath: string | undefined): string | null {
  if (!installPath || typeof installPath !== 'string') return null;
  const trimmed = installPath.trim();
  if (!trimmed) return null;
  return path.join(trimmed, 'sdk');
}

/**
 * 从 DevEco Studio 安装根目录推导 JAVA_HOME。
 * DevEco 自带 JBR（{installPath}/jbr），签名工具 hap-sign-tool.jar 依赖 java。
 * 约定：{installPath}/jbr 下必须含 bin/java(.exe)；由调用方校验存在性。
 */
export function deriveJbrHomeFromInstallPath(installPath: string | undefined): string | null {
  if (!installPath || typeof installPath !== 'string') return null;
  const trimmed = installPath.trim();
  if (!trimmed) return null;
  return path.join(trimmed, 'jbr');
}

/**
 * 返回已归一化的 DevEco Studio 配置；未声明则返回 undefined。
 */
export function loadDevEcoConfig(projectRoot: string): DevEcoStudioConfig | undefined {
  return loadFrameworkConfig(projectRoot).toolchain?.devEcoStudio;
}

/**
 * 按 v2.3 查找顺序解析 hvigor 可执行文件绝对路径的"config 来源"部分：
 *   ① toolchain.devEcoStudio.hvigorBin（显式）
 *   ② toolchain.devEcoStudio.installPath → derive
 * 若两者都未声明，返回 null，由调用方回退到项目根 wrapper / PATH。
 */
export function resolveHvigorBinFromConfig(projectRoot: string): string | null {
  const cfg = loadDevEcoConfig(projectRoot);
  if (!cfg) return null;
  if (cfg.hvigorBin) return cfg.hvigorBin;
  return deriveHvigorBinFromInstallPath(cfg.installPath);
}

// --------------------------------------------------------------------------
// tools.hylyre（hmos-app · 真机自动化消费）
// --------------------------------------------------------------------------

export const DEFAULT_HYLYRE_TOOL_CONFIG: HylyreToolConfig = {
  vendor_dir: 'framework/profiles/hmos-app/vendor/hylyre',
  venv_dir: '.hylyre/venv',
  app_snapshot_cache_dir: 'doc/app-snapshot-cache',
  pypi_extra_index_url: 'https://pypi.tuna.tsinghua.edu.cn/simple',
  auto_install: true,
  doctor_first_run: true,
  hypium_page_name: '',
};

/**
 * 合并 `framework.config.json > tools.hylyre` 与默认值；字段均为解析后的绝对/相对路径语义（相对路径仍相对于 projectRoot）。
 */
export function resolveHylyreToolConfig(projectRoot: string): HylyreToolConfig {
  const partial = loadFrameworkConfig(projectRoot).tools?.hylyre;
  const p = partial ?? {};
  return {
    vendor_dir: (typeof p.vendor_dir === 'string' && p.vendor_dir.trim()) ? p.vendor_dir.trim() : DEFAULT_HYLYRE_TOOL_CONFIG.vendor_dir,
    venv_dir: (typeof p.venv_dir === 'string' && p.venv_dir.trim()) ? p.venv_dir.trim() : DEFAULT_HYLYRE_TOOL_CONFIG.venv_dir,
    app_snapshot_cache_dir:
      (typeof p.app_snapshot_cache_dir === 'string' && p.app_snapshot_cache_dir.trim())
        ? p.app_snapshot_cache_dir.trim()
        : DEFAULT_HYLYRE_TOOL_CONFIG.app_snapshot_cache_dir,
    pypi_extra_index_url:
      typeof p.pypi_extra_index_url === 'string'
        ? p.pypi_extra_index_url.trim()
        : DEFAULT_HYLYRE_TOOL_CONFIG.pypi_extra_index_url,
    auto_install: typeof p.auto_install === 'boolean' ? p.auto_install : DEFAULT_HYLYRE_TOOL_CONFIG.auto_install,
    doctor_first_run:
      typeof p.doctor_first_run === 'boolean' ? p.doctor_first_run : DEFAULT_HYLYRE_TOOL_CONFIG.doctor_first_run,
    hypium_page_name:
      typeof p.hypium_page_name === 'string'
        ? p.hypium_page_name.trim()
        : DEFAULT_HYLYRE_TOOL_CONFIG.hypium_page_name,
  };
}

/**
 * 判断在某个 outer layer 内，from 模块能否 import to 模块（同层内）：
 *   - forbid 模式：一律禁止；
 *   - dag 模式：允许（环路由调用方自己扫，DSL 只给许可）；
 *   - sublayer 模式：看 from 所在子层的 can_depend_on_sublayers 是否覆盖
 *     to 所在子层。
 */
export function isIntraLayerDepAllowed(
  arch: ArchitectureDsl,
  outerLayerId: string,
  fromModule: string,
  toModule: string,
): boolean {
  const layer = arch.outer_layers.find((l) => l.id === outerLayerId);
  if (!layer) return true;
  if (fromModule === toModule) return true;

  switch (layer.intra_layer_deps) {
    case 'forbid':
      return false;
    case 'dag':
      return true;
    case 'sublayer': {
      if (!layer.sublayers) return true;
      const fromSub = findSublayerOf(arch, outerLayerId, fromModule);
      const toSub = findSublayerOf(arch, outerLayerId, toModule);
      if (!fromSub || !toSub) return true; // 未声明的模块不强行拦
      if (fromSub === toSub) return true;
      const fromSpec = layer.sublayers.find((s) => s.id === fromSub)!;
      return fromSpec.can_depend_on_sublayers.includes(toSub);
    }
  }
}
