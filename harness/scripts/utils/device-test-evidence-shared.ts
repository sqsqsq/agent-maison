// ============================================================================
// device-test-evidence-shared.ts — device-test-evidence.json schema
// （d9e4b7c1 T2 + e3c7d95f predicate/state/anchor attribution）
// ============================================================================

import * as path from 'path';

export const DEVICE_TEST_EVIDENCE_BASENAME = 'device-test-evidence.json';

export function deviceTestEvidencePath(reportsDir: string): string {
  return path.join(reportsDir, DEVICE_TEST_EVIDENCE_BASENAME);
}

// plan e6b3f8d2 t3：锚点漂移分类已整链删除——它的语义是「产品代码未注入 framework
// 规定的 canonical anchor」，而那套强制 anchor 约定本身已被撤销。历史 run 的 evidence
// 里可能残留该分类字符串，读侧照常解析、但不再据其驱动回修（见 goal-runner actionable 白名单）。
export type DeviceDefectClassification =
  | 'product_actionable'
  | 'product_state'
  | 'environment'
  | 'test_contract'
  | 'unknown'
  | 'unjoinable';

export interface DeviceEvidenceObservation {
  case_id: string;
  step_index: number;
  ui_dump: string;
  node: {
    id?: string;
    text?: string;
    enabled?: boolean;
    visible?: boolean;
    clickable?: boolean;
    checked?: boolean;
    selected?: boolean;
    focused?: boolean;
  };
}

export interface DeviceTestEvidenceCase {
  case_id: string;
  /** hylyre trace 原状态（失败/阻塞） */
  status: string;
  classification: DeviceDefectClassification;
  /** 稳定机器原因码；自由文案不得作为无进展指纹输入。 */
  reason_code?: string;
  /** 人读判定原因。 */
  reason?: string;
  /** 次级诊断；主分类优先于 drift 时在此保留漂移事实，禁止双发 defect。 */
  diagnostics?: Array<{ code: string; message: string }>;
  /** failure_artifacts 严格 join 出的失败 step。 */
  failing_step?: {
    /** 派生计划 steps 的 0-based index（与 hylyre failure_artifacts 命名一致） */
    index: number;
    action: string;
    selector_kind: 'by_id' | 'by_text';
    selector: string;
    /** action body 原样透传；未知字段也不得丢失。 */
    payload: Record<string, unknown>;
    scope?: string;
  };
  /** 由 ui-spec / canonical anchor 推导出的 expected screen。 */
  expected_screen?: string;
  /** dump/截图相对工程根的路径与跨帧节点摘要。 */
  evidence?: {
    ui_dump: string;
    screenshot?: string;
    observations?: DeviceEvidenceObservation[];
    expected_state?: Record<string, boolean>;
  };
  /** trace notes 的机器错误文本节选 */
  error_excerpt?: string;
}

/** Same-run artifact identity retained by the existing run/evidence receipts. */
export interface DeviceTestArtifactBinding {
  test_plan_path: string;
  test_plan_sha256: string;
  derived_plan_path: string;
  derived_plan_sha256: string;
  trace_path: string;
  trace_sha256: string;
}

export interface RuntimeScreenObservation {
  signature_sha256: string;
  observed_element_ids: string[];
}

export interface RuntimeCheckpointEvidence {
  acceptance_id: string;
  flow_id: string;
  case_id: string;
  step_index: number;
  action_kind: string;
  declared_target_element_id: string;
  actual_hit: {
    stable_node_id: string;
    bounds: [number, number, number, number];
  };
  pre_screen: RuntimeScreenObservation & { declared_screen_id: string };
  post_screen: RuntimeScreenObservation & { declared_screen_id: string };
  required_observations: Array<{ element_id: string; present: boolean }>;
  forbidden_observations: Array<{ element_id: string; present: boolean }>;
  outcome: 'passed';
}

/**
 * The existing artifact retains goal identity/HAP binding. Native P0 runtime
 * fidelity remains in the authoritative Hylyre trace; the optional field is
 * read-only legacy compatibility and is not a parallel case/step ledger.
 */
export interface RuntimeFidelityEvidence {
  schema_version: '1.0';
  provider: {
    id: string;
    version: string;
    collector: string;
    collector_version: string;
  };
  bindings: {
    feature: string;
    goal_run_id: string;
    attempt_id: string;
    device_session_id: string | null;
    acceptance_sha256: string;
    test_plan_sha256: string;
    derived_plan_sha256: string;
    hap_sha256_full: string;
    testing_source_aggregate: string;
    trace_sha256: string;
  };
  checkpoints: RuntimeCheckpointEvidence[];
}

export interface DeviceTestEvidenceDoc {
  schema_version: '1.1';
  goal_run_id: string;
  attempt_id: string;
  device_target: {
    serial: string | null;
    target_kind: string | null;
    session_id: string | null;
  };
  /** 装机前计算的完整 64 hex HAP 摘要（写前复算一致才允许写入） */
  hap_sha256_full: string;
  install_executed: boolean;
  install_ok: boolean;
  /** 直取本轮 pipeline holder 的 trace 路径（绝对路径；writer 禁调 authoritative resolver） */
  trace_path: string;
  /** run 级结构化失败分类（RunFailureKind；无失败为 null） */
  run_failure_kind: string | null;
  /** collector 唯一时间裁决字段（写入时刻 ISO）；文件 mtime 仅诊断 */
  written_at: string;
  cases: DeviceTestEvidenceCase[];
  /** 仅 P0 device flow 适用；非 P0 文档不写该字段。 */
  runtime_fidelity?: RuntimeFidelityEvidence;
  /** Native trace/run identity; this is binding metadata, not a second evidence ledger. */
  artifact_binding?: DeviceTestArtifactBinding;
}

/** coordinator 写入前的草稿（written_at 由 check-testing 落盘时刻统一盖） */
export type DeviceTestEvidenceDocDraft = Omit<DeviceTestEvidenceDoc, 'written_at'>;
