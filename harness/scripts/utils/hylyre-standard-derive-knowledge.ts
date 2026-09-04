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
// 键集与 STEP lint 同源（hylyre-planned-step-keys.ts），与 vendor 发布件（源码树/wheel）
// 的一致性由 hylyre-keyset-consistency 元门禁锁死。
// ============================================================================

import {
  PLANNED_STEP_ROOT_KEYS,
  FORBIDDEN_STEP_ROOT_KEYS,
} from './hylyre-planned-step-keys';
import { STEP_SHAPE_CATALOG, WAIT_FIELD_TIMING_REF } from './adhoc-derive-helpers';
import type { HylyreResetIdentity } from './derived-hylyre-plan';
import { resolveHylyreToolConfig } from '../../config';
import { loadAppInstallCandidateMeta } from '../../../profiles/hmos-app/harness/hdc-runner';
import { discoverEntryMainElement } from '../../../profiles/hmos-app/harness/discover-entry-main-element';

/** 标准派生提示 payload 版本：4 = 3 + 机器知识块（向后兼容，只增字段） */
export const STANDARD_DERIVE_HINT_SCHEMA = 4;

/**
 * 统一 payload 基座（v2，post-impl review）：schema + 生成时刻 + 机器知识块——
 * CLI derive-hylyre-plan-hint 与 check-testing 自动 hint 的**共同前缀**；各入口只追加
 * 自身特有字段（快照信息 / 覆盖对账），schema 与知识块永不分叉。
 */
export function buildStandardHylyreDerivePayloadBase(reset?: ResolvedHylyreResetIdentity): Record<string, unknown> {
  return {
    schema: STANDARD_DERIVE_HINT_SCHEMA,
    generated_at: new Date().toISOString(),
    ...buildStandardHylyreDeriveKnowledge(reset),
  };
}

export interface ResolvedHylyreResetIdentity {
  identity: HylyreResetIdentity | null;
  /** identity 为 null 时的原因（写进 reset_preamble.reason，派生器据此不写前奏） */
  reason?: string;
}

/**
 * plan b3d7e5a1 T4：harness 预启同源身份——**冻结的两个静态来源**（codex 七轮返修：不再借道完整 resolver）。
 * - bundle = `loadAppInstallCandidateMeta().bundleName`（装机门同一份 JSON5 解析，不用正则）；
 * - page_name = `tools.hylyre.hypium_page_name || discoverEntryMainElement()`。
 * 只读工程文件：不读 bundle_abilities、不读/不删 app-meta cache 与 `.stale`、不发 bm dump——lint、derive hint 与
 * report-only 调用它都不产生副作用。run 侧把同一 resolved page 作为 hypiumPageName 传下去（override 优先级最高），
 * 所以 lint / hint / dispatch 三处逐字一致；身份未解析时不写前奏（lint BLOCKER），run 走自己的既有分层。
 */
export function resolveHylyreResetIdentity(projectRoot: string): ResolvedHylyreResetIdentity {
  let bundle = '';
  try {
    bundle = loadAppInstallCandidateMeta(projectRoot).bundleName.trim();
  } catch (e) {
    return { identity: null, reason: `安装候选 bundleName 不可读：${(e as Error).message}` };
  }
  if (!bundle) return { identity: null, reason: '安装候选 bundleName 为空' };
  let pageName = '';
  try {
    pageName = (resolveHylyreToolConfig(projectRoot).hypium_page_name ?? '').trim();
  } catch {
    pageName = '';
  }
  if (!pageName) pageName = (discoverEntryMainElement(projectRoot) ?? '').trim();
  if (!pageName) return { identity: null, reason: 'tools.hylyre.hypium_page_name 为空且 entry 模块 mainElement 不可发现' };
  return { identity: { bundle, page_name: pageName } };
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
  /** plan b3d7e5a1 T4：case 首部受限复位前奏的机器知识（身份由 harness 给出，派生器不得自拟） */
  reset_preamble:
    | { available: true; position: 'case_head_only'; order: ['stop_app', 'start_app']; bundle: string; page_name: string; example: string; rule: string }
    | { available: false; reason: string; rule: string };
}

/**
 * 标准 feature 派生（test-plan.hylyre.md）的步骤知识块。
 * 与 check-testing 的 STEP lint（lintHylyrePlanStepRules 正式路径）判据同源：
 * start_app/stop_app 只允许作为 case 首部复位前奏（plan b3d7e5a1 T4），身份由 `reset` 注入。
 */
export function buildStandardHylyreDeriveKnowledge(reset?: ResolvedHylyreResetIdentity): StandardHylyreDeriveKnowledge {
  const RESET_RULE =
    '仅当 case 需要已知起始态时使用；恰好一组、只在 case 首部（index 0 stop_app、index 1 start_app）；' +
    'bundle/page_name 必须逐字等于此处给出的值（harness 预启同源，派生不得自拟）；不得使用 clear_app；' +
    '其它任何位置出现 start_app/stop_app 即 STEP-003 BLOCKER，整份计划不启动。';
  const reset_preamble: StandardHylyreDeriveKnowledge['reset_preamble'] = reset?.identity
    ? {
        available: true,
        position: 'case_head_only',
        order: ['stop_app', 'start_app'],
        bundle: reset.identity.bundle,
        page_name: reset.identity.page_name,
        example: `{"stop_app":{"bundle":"${reset.identity.bundle}"}}; {"start_app":{"bundle":"${reset.identity.bundle}","page_name":"${reset.identity.page_name}"}}`,
        rule: RESET_RULE,
      }
    : {
        available: false,
        reason: reset?.reason ?? 'harness 预启身份未注入',
        rule: '身份未解析时不得写任何 start_app/stop_app 步骤（写了即 STEP-003 BLOCKER）。',
      };
  return {
    allowed_step_roots: PLANNED_STEP_ROOT_KEYS.filter(k => k !== 'action'),
    forbidden_in_steps: [...FORBIDDEN_STEP_ROOT_KEYS],
    reset_preamble,
    step_shape_catalog: STEP_SHAPE_CATALOG,
    wait_field_timing_ref: WAIT_FIELD_TIMING_REF,
    hylyre_planned_step_fields_ref: HYLYRE_PLANNED_STEP_FIELDS_REF,
    canonical_format:
      '派生表「测试步骤」列 = 裸单行 JSON 对象序列，步骤之间用 `;` 分隔（**不是** JSON 数组），每步恰好一个根键（禁 Markdown 反引号包裹）；' +
      '固定等待用 {"wait":{"seconds":N}}（禁 timeout/duration）；' +
      '正式 by_text selector 必须显式写 match: exact 或 contains（由 acceptance 意图决定，禁止字符启发式与运行时 fallback）；' +
      'touch 禁嵌套 selector（用 {"touch":{"by_text":"…","match":"exact"}} / by_id / 富选择器字段）；' +
      'wait_for 必须带 selector/by_text/by_id/by_key/by_type/富选择器之一，by_text 同样显式 match；' +
      'action 默认 require unique 由 Hylyre 契约提供，消歧复用 index/scope/within/all，不新增 candidate_policy；' +
      'feature ui-spec 是开放世界静态提示（既有入口/前置页面通常不重复建模）：selector 不在其中只给 WARN、不阻断，' +
      '最终真值是本轮 native StepResult 的 selector evidence；不要为了消 WARN 改写目标或伪造 ui-spec 节点；' +
      'start_app/stop_app 只允许作为 case 首部复位前奏（恰好一组 stop_app→start_app，身份见 reset_preamble；不得使用 clear_app），其它位置禁止；' +
      '禁止 dump_ui 等 CLI 子命令作根键（观察由 harness 负责）；' +
      'P0 身份断言不用手写：harness 把派生计划装载进 run 目录时按 acceptance checkpoint 自动注入精确形状的 ' +
      '{"wait_for"|"wait_gone":{"by_id":<id>,"timeout":N}}（源派生计划不改），派生只写导航、动作与 UX 断言——' +
      'visible/enabled 等谓词断言保留但不算身份；scroll/swipe 是合法动作不改 touch；checkpoint action 在 case 内必须唯一，' +
      '多候选或无绑定动作 = invalid_test，跑机前必修。',
  };
}
