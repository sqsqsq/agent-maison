// ============================================================================
// device-test-evidence-shared.ts — device-test-evidence.json schema（plan d9e4b7c1 T2）
// ----------------------------------------------------------------------------
// 单一覆盖式产物：goal 正式 testing gate（check-testing 协调层）在 build→强制
// install→run 全部完成后统一写入；goal-runner collector 当前轮立即消费。
// **不是账本**：当前轮写、当前轮读，无跨轮信任语义（v7-v9 的 history/resolver
// 体系已被判过度设计删除——正式 gate 强制安装使"设备当前运行的就是该 HAP"成为
// 由动作保证的事实，而非待证命题）。
//
// 防伪最小化：runner 在 spawn gate harness 之前删除本文件；harness 结束后文件
// 存在且身份匹配 = gate 所写（agent 已于 invoke 结束退出，窗口内无其他写者）。
// ============================================================================

import * as path from 'path';

export const DEVICE_TEST_EVIDENCE_BASENAME = 'device-test-evidence.json';

export function deviceTestEvidencePath(reportsDir: string): string {
  return path.join(reportsDir, DEVICE_TEST_EVIDENCE_BASENAME);
}

export type DeviceDefectClassification =
  | 'product_actionable'
  | 'environment'
  | 'test_contract'
  | 'unknown'
  | 'unjoinable';

export interface DeviceTestEvidenceCase {
  case_id: string;
  /** hylyre trace 原状态（失败/阻塞） */
  status: string;
  classification: DeviceDefectClassification;
  /** 非 product_actionable 时的机器判定原因（人读） */
  reason?: string;
  /** failure_artifacts 严格 join 出的失败 step（product_actionable 必有） */
  failing_step?: {
    /** 派生计划 steps 的 0-based index（与 hylyre failure_artifacts 命名一致） */
    index: number;
    action: string;
    selector_kind: 'by_id' | 'by_text';
    selector: string;
    scope?: string;
  };
  /** product_actionable：由 spec 锚点推导出的 expected screen */
  expected_screen?: string;
  /** dump/截图相对 reports 目录的路径（人读证据） */
  evidence?: { ui_dump: string; screenshot?: string };
  /** trace notes 的机器错误文本节选 */
  error_excerpt?: string;
}

export interface DeviceTestEvidenceDoc {
  schema_version: '1.0';
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
}

/** coordinator 写入前的草稿（written_at 由 check-testing 落盘时刻统一盖） */
export type DeviceTestEvidenceDocDraft = Omit<DeviceTestEvidenceDoc, 'written_at'>;
