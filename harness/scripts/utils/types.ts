// ============================================================================
// Harness 公共类型定义
// ============================================================================

/** 支持的开发阶段（运行时由 workflow YAML 定义；此处为通用字符串别名） */
export type Phase = string;

/** IDE / 校验脚本常用的已知 phase id（非穷尽） */
export type KnownPhase =
  | 'prd'
  | 'design'
  | 'coding'
  | 'review'
  | 'ut'
  | 'testing'
  | 'catalog'
  | 'glossary'
  | 'docs'
  | 'init'
  | 'extensions';

/** catalog / glossary / docs / init / extensions 等全局 phase 使用本哨兵 feature */
export const GLOBAL_FEATURE_SENTINEL = '_global';

/**
 * 向后兼容启发式：未知 workflow 或未加载 workflow 时的兜底。
 * 正常运行时应使用 `isPhaseGlobalInWorkflow(spec, phase)`。
 */
export function isGlobalPhase(phase: Phase): boolean {
  return (
    phase === 'catalog' ||
    phase === 'glossary' ||
    phase === 'docs' ||
    phase === 'init' ||
    phase === 'extensions'
  );
}

/** 检查严重等级 */
export type Severity = 'BLOCKER' | 'MAJOR' | 'MINOR';

/** 单项检查结果状态 */
export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

/** 最终裁定 */
export type Verdict = 'PASS' | 'FAIL';

// --------------------------------------------------------------------------
// Spec 相关类型
// --------------------------------------------------------------------------

/**
 * 规则体类型：优先使用结构化嵌套映射（弱模型友好），
 * 兼容旧版 `rule: |` 块级标量字符串形态，避免迁移过程中破坏兼容。
 */
export type RuleBody = Record<string, unknown> | string;

export interface StructureCheck {
  description: string;
  severity: Severity;
  rule?: RuleBody;
  method?: string;
  check?: string;
  ai_prompt_hint?: string;
}

export interface SemanticCheck {
  description: string;
  severity: Severity;
  ai_prompt_hint?: string;
}

export interface TraceabilityCheck {
  description: string;
  severity: Severity;
  rule?: RuleBody;
  ai_prompt_hint?: string;
}

/** 阶段级规约 (phase-rules/*.yaml) */
export interface PhaseRuleSpec {
  phase: string;
  version: string;
  applies_to: string | Record<string, string>;
  structure_checks: Record<string, StructureCheck>;
  semantic_checks: Record<string, SemanticCheck>;
  traceability_checks: Record<string, TraceabilityCheck>;
}

interface ResourceEntry {
  key: string;
  value: string;
  description?: string;
}

/** 功能级规约 — 接口契约 (features/{name}/contracts.yaml) */
export interface ContractsSpec {
  feature: string;
  source: string;
  version: string;
  modules: Array<{
    name: string;
    layer: string;
    format: string;
    change_type: string;
    package_path: string;
  }>;
  module_dependencies: Record<string, string[]>;
  data_models: Array<{
    name: string;
    module: string;
    file: string;
    kind: string;
    fields: Array<{
      name: string;
      type: string;
      required: boolean;
      default?: string;
    }>;
    computed_properties?: Array<{
      name: string;
      type: string;
      description: string;
    }>;
    values?: Array<{ name: string; value: string }>;
  }>;
  interfaces: Array<{
    module: string;
    layer: string;
    file: string;
    class: string;
    methods: Array<{
      name: string;
      params: Array<{ name: string; type: string }>;
      return: string;
      async: boolean;
      description: string;
    }>;
  }>;
  components: Array<{
    name: string;
    module: string;
    file: string;
    kind: string;
    decorator?: string;
    linked_functions?: string[];
    state?: Array<{ name: string; decorator: string; type: string }>;
    props?: Array<{ name: string; decorator: string; type: string }>;
    events?: Array<{ name: string; description: string }>;
    children?: string[];
    nav_destinations?: string[];
    nav_destination?: string;
    description?: string;
  }>;
  files: string[];
  resource_keys?: Record<string, Record<string, ResourceEntry[]>>;
  prd_to_code_traceability?: Array<{
    prd_id: string;
    priority: string;
    key_files: string[];
  }>;
  state_management?: Array<{
    data: string;
    scope: string;
    decorator: string;
    holder: string;
    module: string;
  }>;
  navigation?: Record<string, unknown>;
}

/** UT 分层（AC / BD 级别）：
 *  - unit   : 仅 Hypium 业务级 UT 覆盖
 *  - device : 仅真机 UI 自动化覆盖（Skill 6）
 *  - both   : UT + Device 共同覆盖
 */
export type UtLayer = 'unit' | 'device' | 'both';

/** 功能级规约 — 验收标准 (features/{name}/acceptance.yaml) */
export interface AcceptanceSpec {
  feature: string;
  source: string;
  version: string;
  criteria: Array<{
    id: string;
    prd_function: string | null;
    priority: string;
    description: string;
    testable: boolean;
    verification_steps: string[];
    expected_result: string;
    data_constraints?: Record<string, unknown>;
    /** UT 分层归属（v2 新增，acceptance.yaml 建议必填） */
    ut_layer?: UtLayer;
    /** UT 关切点简述（ut_layer ∈ {unit, both} 时推荐） */
    ut_focus?: string;
    /** 关联到 use-cases.yaml 中的 use_case id（ut_layer ∈ {unit, both}） */
    linked_flow?: string;
    /** 关联到该 use_case 的某个 branch id（ut_layer ∈ {unit, both}） */
    linked_branch?: string;
  }>;
  boundaries: Array<{
    id: string;
    prd_exception: string;
    scenario: string;
    description: string;
    priority: string;
    handling: string;
    expected_behavior: string;
    affected_functions?: string[];
    ut_layer?: UtLayer;
    ut_focus?: string;
    linked_flow?: string;
    linked_branch?: string;
  }>;
  performance?: Array<{
    id: string;
    metric: string;
    threshold: string;
    unit: string;
    description: string;
  }>;
}

// --------------------------------------------------------------------------
// use-cases.yaml Schema v2（Skill 2 产出、Skill 5 消费）
// v2 定位：规约文档，不强制代码形态；核心字段是 ui_bindings 映射表
// --------------------------------------------------------------------------

export interface UseCaseUserAction {
  trigger: string;       // 用户动作的自然语言描述
  calls: string;         // UT 要调用的命名函数符号（如 "flow.chooseCard"）
}

export interface UseCaseUiBinding {
  ui: string;                         // 页面或组件名
  role: 'entry' | 'progress' | 'dialog' | 'result' | 'passive';
  subscribes?: string[];              // 订阅的 state 字段
  user_actions: UseCaseUserAction[];  // 空数组 = 纯展示，UT 不覆盖
}

export interface UseCaseDataBoundary {
  name: string;                       // 在 coordinator 里的引用名
  type: string;                       // 现有类名
  kind: 'cloud' | 'storage' | 'system';
  methods: Array<{
    name: string;
    params: string[];
    returns?: string;
    async?: boolean;
  }>;
}

export interface UseCaseBranch {
  id: string;
  scenario: string;
  user_sequence?: string[];                // UT 按此顺序 await 的 calls 列表
  cloud_stubs?: Record<string, unknown>;
  local_stubs?: Record<string, unknown>;
  expected_phase_seq?: string[];
  expected_port_calls?: string[];
  expected_state?: Record<string, unknown>;
  not_called?: string[];
  local_expect?: string[];
  linked_acceptance: string[];
}

export interface UseCaseDef {
  id: string;
  description?: string;
  coordinator: string;                    // 类名 / 方法路径 / 函数名
  coordinator_file?: string | null;       // optional：简单场景可省
  ui_bindings: UseCaseUiBinding[];
  data_boundaries?: UseCaseDataBoundary[];
  state_model: {
    phases: string[];
    fields?: Array<{ name: string; type: string }>;
  };
  branches: UseCaseBranch[];
}

export interface UseCasesSpec {
  schema_version: string;
  feature: string;
  use_cases: UseCaseDef[];
}

/** 加载后的完整功能级规约 */
export interface FeatureSpec {
  feature: string;
  contracts?: ContractsSpec;
  acceptance?: AcceptanceSpec;
  /** v2 新增：use-cases.yaml（若存在），供 UT 端到端分支覆盖使用 */
  useCases?: UseCasesSpec;
}

// --------------------------------------------------------------------------
// 报告相关类型
// --------------------------------------------------------------------------

/** 单项检查结果 */
export interface VisualHandoffResolutionRow {
  ref_id: string;
  declared_path?: string;
  /** URL 类 kind 时填写，供 merged-report「Resolved Visual Sources」列示 */
  declared_url?: string;
  resolved_absolute?: string;
  agent_reachable: boolean;
  resolution_kind?: string;
  note?: string;
}

/** 单项检查结果 */
export interface CheckResult {
  id: string;
  category: 'structure' | 'semantic' | 'traceability';
  description: string;
  severity: Severity;
  status: CheckStatus;
  details: string;
  affected_files?: string[];
  suggestion?: string;
  /** 机器可读失败归因；优先供 summary.json / next_action 消费，details 只做人读。 */
  failure_kind?: string;
  /** 机器可读阻塞类别；用于区分外部阻塞、契约缺失、工具链等。 */
  blocking_class?: string;
  /** PRD Visual Handoff：各 authoritative_ref 路径解析结果（merged-report 可读） */
  visual_resolution_rows?: VisualHandoffResolutionRow[];
}

/** 报告摘要 */
export interface ReportSummary {
  total: number;
  pass: number;
  fail: number;
  warn: number;
  skip: number;
  blockers: number;
  verdict: Verdict;
}

/** script-report.json 中 compat 降级审计段 */
export interface ScriptReportCompatApplied {
  count: number;
  ids: string[];
  suggestion: string;
}

export interface ScriptReportCompatExpired {
  feature: string;
  suggestion: string;
}

/** 脚本 Harness 报告 */
export interface ScriptReport {
  phase: Phase;
  feature: string;
  timestamp: string;
  project_root: string;
  checks: CheckResult[];
  summary: ReportSummary;
  compat_applied?: ScriptReportCompatApplied;
  compat_expired?: ScriptReportCompatExpired;
}

/** AI Harness 组装后的 prompt 信息 */
export interface AIPromptOutput {
  phase: Phase;
  feature: string;
  timestamp: string;
  prompt_template: string;
  assembled_prompt: string;
  context_files: Array<{ path: string; content: string }>;
}

// --------------------------------------------------------------------------
// Project profile（framework/profiles/<name>/）— 与 adapter 正交
// --------------------------------------------------------------------------

export type CapabilitySeverityKeyword = 'BLOCKER' | 'SKIP' | 'WARN' | 'MAJOR' | 'MINOR';

export type CapabilityKey =
  | 'coding.compile'
  | 'coding.lint'
  | 'ut.compile'
  | 'ut.run'
  | 'device_test.run'
  | 'device_test.build'
  | 'device_test.install'
  | 'prd.visual_handoff';

export interface ProfileCapabilitySpec {
  provider?: string;
  severity: CapabilitySeverityKeyword;
}

/** profile.yaml 解析后的最小结构（供 harness 使用） */
export interface ProfileYamlStub {
  name: string;
  display_name?: string;
  /** Catalog：module card `format` 合法枚举（由 profile 声明；缺省 HAP/HAR/AtomicService） */
  catalog_allowed_module_formats?: string[];
  phases_disabled?: string[];
  capabilities?: Partial<Record<CapabilityKey, ProfileCapabilitySpec>>;
  phase_rules_overlays_dir?: string;
  [key: string]: unknown;
}

/** 实例扩展 manifest 校验错误（非 extensions phase 仅记入 ExtensionBundle.errors） */
export interface ExtensionValidationError {
  severity: 'MAJOR';
  code: string;
  message: string;
  path?: string;
}

/** doc/extensions 解析产物（manifest 缺失则为零值 + rootDir=null） */
export interface ExtensionBundle {
  rootDir: string | null;
  manifestPath: string | null;
  skills: string[];
  knowledgePaths: string[];
  hooks: Record<string, Record<string, string[]>>;
  extensionCapabilities: Record<string, ProfileCapabilitySpec>;
  phaseRuleOverlayPaths: Record<string, string>;
  errors: ExtensionValidationError[];
}

/** loadResolvedProfile 的运行时结果 */
export interface HarnessResolvedProfile {
  name: string;
  subVariant?: string;
  profileDir: string;
  yaml: ProfileYamlStub;
  phasesDisabled: Set<Phase>;
  capabilities: Partial<Record<CapabilityKey, ProfileCapabilitySpec>>;
  /** 实例扩展包；未扫描或无 manifest 时仍为对象（errors/slots 为空） */
  extensionBundle?: ExtensionBundle;
}

// --------------------------------------------------------------------------
// 脚本 Harness 检查器接口
// --------------------------------------------------------------------------

/** 每个阶段的检查器必须实现此接口 */
export interface PhaseChecker {
  phase: Phase;
  check(context: CheckContext): Promise<CheckResult[]>;
}

/** 传入检查器的上下文 */
export interface CheckContext {
  phase: Phase;
  feature: string;
  projectRoot: string;
  phaseRule: PhaseRuleSpec;
  featureSpec: FeatureSpec;
  /** init 阶段专用：CLI --adapter 透传值（其他阶段为 undefined） */
  adapter?: string;
  /**
   * PRD：Visual Handoff 脚本守门档位（framework.config.json → prd.visual_handoff_enforcement，**opt-in**）。
   * 未设置（整个 `prd` 段缺失或未配置 enforcement）时 check-prd 对「缺失 ui_change 块」静默。
   */
  visualHandoffEnforcement?: 'strict' | 'warn' | 'reachable' | 'off';
  /** PRD：`prd.visual_sources`（opt-in）；未设置则为 undefined */
  prdVisualSources?: {
    external_roots?: Record<string, string>;
    allow_absolute_paths?: boolean;
    allow_network_paths?: boolean;
  };
  /** paths.docs_committed；默认语义见 framework.config.template.json */
  docsCommitted?: boolean;
  /** CLI `--skip-visual-handoff`：跳过 Visual Handoff 相关脚本检查 */
  skipVisualHandoff?: boolean;
  /** project profile（framework/profiles）。缺配置时由 config 归一为 hmos-app */
  resolvedProfile: HarnessResolvedProfile;
}
