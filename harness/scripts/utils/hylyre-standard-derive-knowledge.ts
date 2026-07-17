// ============================================================================
// hylyre-standard-derive-knowledge.ts — 标准 feature 派生提示的机器知识块
// （t7a，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// 动机（07-16 宿主事故 B「hylyre 翻译偶现失能」）：Hylyre 是内部工具，模型训练数据里
// 没有它——agent 写步骤的全部语法知识只能来自注入。此前只有即席（adhoc）派生 payload
// 携带 allowed_step_roots/step_shape_catalog 机器目录，标准 feature 路径（CLI
// derive-hylyre-plan-hint 与 check-testing 失败时自动写出的 derive-hint-from-plan.json）
// 均为纯用例行——agent 一旦没读过语法文档或长会话被压缩，就"突然不会翻译"。
//
// 本模块 = 标准路径三入口（CLI / device_test_run 缺计划 hint / coverage·stale·lint
// 失败 hint）的**唯一共享知识源**：知识由机器携带，不赌 agent 读没读文档。
// 键集与 STEP lint 同源（hylyre-planned-step-keys.ts），与 vendor wheel 的一致性由
// hylyre-keyset-consistency 元门禁锁死。
// ============================================================================

import {
  PLANNED_STEP_ROOT_KEYS,
  FORBIDDEN_STEP_ROOT_KEYS,
} from './hylyre-planned-step-keys';
import { STEP_SHAPE_CATALOG, WAIT_FIELD_TIMING_REF } from './adhoc-derive-helpers';

/** 标准派生提示 payload 版本：4 = 3 + 机器知识块（向后兼容，只增字段） */
export const STANDARD_DERIVE_HINT_SCHEMA = 4;

/**
 * 统一 payload 基座（v2，post-impl review）：schema + 生成时刻 + 机器知识块——
 * CLI derive-hylyre-plan-hint 与 check-testing 自动 hint 的**共同前缀**；各入口只追加
 * 自身特有字段（快照信息 / 覆盖对账），schema 与知识块永不分叉。
 */
export function buildStandardHylyreDerivePayloadBase(): Record<string, unknown> {
  return {
    schema: STANDARD_DERIVE_HINT_SCHEMA,
    generated_at: new Date().toISOString(),
    ...buildStandardHylyreDeriveKnowledge(),
  };
}

/** 语法教学文档（人读深潜用；机器目录在本 payload 内自足） */
export const HYLYRE_PLANNED_STEP_FIELDS_REF =
  'framework/profiles/hmos-app/skills/device-testing/reference/hylyre-planned-step-fields.md';

export interface StandardHylyreDeriveKnowledge {
  allowed_step_roots: string[];
  forbidden_in_steps: string[];
  step_shape_catalog: typeof STEP_SHAPE_CATALOG;
  wait_field_timing_ref: typeof WAIT_FIELD_TIMING_REF;
  hylyre_planned_step_fields_ref: string;
  canonical_format: string;
}

/**
 * 标准 feature 派生（test-plan.hylyre.md）的步骤知识块。
 * 与 check-testing 的 STEP lint（lintHylyrePlanStepRules，默认 forbidStartApp）判据同源：
 * 派生计划步骤同样禁 start_app（冷启由 hylyre run --plan 负责）。
 */
export function buildStandardHylyreDeriveKnowledge(): StandardHylyreDeriveKnowledge {
  return {
    allowed_step_roots: PLANNED_STEP_ROOT_KEYS.filter(k => k !== 'action' && k !== 'start_app'),
    forbidden_in_steps: ['start_app', ...FORBIDDEN_STEP_ROOT_KEYS],
    step_shape_catalog: STEP_SHAPE_CATALOG,
    wait_field_timing_ref: WAIT_FIELD_TIMING_REF,
    hylyre_planned_step_fields_ref: HYLYRE_PLANNED_STEP_FIELDS_REF,
    canonical_format:
      '派生表「测试步骤」列 = 裸单行 JSON 数组，每步恰好一个根键（禁 Markdown 反引号包裹）；' +
      '固定等待用 {"wait":{"seconds":N}}（禁 timeout/duration）；' +
      'touch 禁嵌套 selector（用 {"touch":{"by_text":"…"}} / by_id / 富选择器字段）；' +
      'wait_for 必须带 selector/by_text/by_id/by_key/by_type/富选择器之一；' +
      '禁止 start_app 与 dump_ui 等 CLI 子命令作根键（冷启与观察由 harness 负责）。',
  };
}
