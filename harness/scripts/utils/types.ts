// ============================================================================
// Harness 公共类型定义
// ============================================================================

/** 支持的开发阶段 */
export type Phase =
  | 'prd'
  | 'design'
  | 'coding'
  | 'review'
  | 'ut'
  | 'testing'
  | 'catalog'    // Skill 0 · Phase A 产物：doc/module-catalog.yaml
  | 'glossary';  // Skill 0 · Phase B 产物：doc/glossary.yaml

/** catalog / glossary 两个"全局"阶段不归属任何 feature，使用本哨兵值 */
export const GLOBAL_FEATURE_SENTINEL = '_global';

/** 判断给定 phase 是否是"全局" phase（不需要 --feature 参数） */
export function isGlobalPhase(phase: Phase): boolean {
  return phase === 'catalog' || phase === 'glossary';
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
  }>;
  performance?: Array<{
    id: string;
    metric: string;
    threshold: string;
    unit: string;
    description: string;
  }>;
}

/** 加载后的完整功能级规约 */
export interface FeatureSpec {
  feature: string;
  contracts?: ContractsSpec;
  acceptance?: AcceptanceSpec;
}

// --------------------------------------------------------------------------
// 报告相关类型
// --------------------------------------------------------------------------

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

/** 脚本 Harness 报告 */
export interface ScriptReport {
  phase: Phase;
  feature: string;
  timestamp: string;
  project_root: string;
  checks: CheckResult[];
  summary: ReportSummary;
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
}
