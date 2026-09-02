// ============================================================================
// selector-contract.ts — 测试计划 selector 的 ui-spec 来源契约（SELECTOR-SPEC-001）
// ----------------------------------------------------------------------------
// 规则不变：运行时 dump / snapshot cache 只能**发现候选**，不能成为 selector 真值。
// 静态门只消费 canonical ui-spec；运行时 candidate_count 由 native StepResult 证明。
//
// plan a6c4e9f2 D1（2026-08-31 首次宿主回灌纠偏）：feature ui-spec 是**开放世界**——
// 它只建模本 feature 新增的页面，首页/卡包/添加卡片等既有入口天然缺席。因此
// 「selector 不在 ui-spec」只说明静态资料不足，不能推出 selector 非法：miss 降为
// provenance WARN，允许进入 runtime，由本轮 native selector evidence 最终裁决。
// 保留 BLOCKER 的只有**可确定错误**：非法/缺失 match、ui-spec 已证明的同屏多映射
// 无消歧、contains 只命中带 children 的聚合 Text/Row，以及唯一一条散文外的
// acceptance 冲突判据（见 findCheckpointConflict）。
// 明确否决：ui-spec ∪ acceptance ∪ contracts 的 canonical 白名单并集——那会立刻引入
// 优先级、冲突与失效同步问题，等于重新长出一套 selector registry。
//
// plan e6b3f8d2 t3（撤销强制 Maison UI kit）：本模块**不再读 kit 的 block 清单**、
// 不再生成 `maison:` canonical anchor 与 child suffix 契约——那是随 kit 一并删除的
// framework 侧组件实现约定，不是宿主产品的 selector 真值。查询回归**普通 ui-spec
// node.id / text**：合法 selector = 声明在 ui-spec 里的裸 node id，或与节点 text 等值。
// 存量带 `maison:` 前缀的测试计划产物须重新生成（见 MIGRATION.md）。
// ============================================================================

import type {
  UiSpecComponentNode,
  UiSpecDoc,
  UiSpecScreen,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { parsePlannedStepsFromCell, extractDerivedPlanCases } from '../../../harness/scripts/utils/derived-hylyre-plan';
import { extractAcceptanceIdRefs } from '../../../harness/scripts/utils/check-acceptance';
import {
  buildCanonicalSelectorIndex,
  canonicalSelectorCandidates,
  inferScreenIdsFromText,
  normalizePlannedStep,
  type NormalizedPlannedSelector,
  type NormalizedPlannedStep,
} from '../../../harness/scripts/utils/planned-step-normalizer';

export const SELECTOR_SPEC_RULE_ID = 'SELECTOR-SPEC-001';

export interface SelectorContractEntry {
  screen_id: string;
  node_id: string;
  text?: string;
  /** 同屏同 id 出现多次=repeated（纯 ui-spec 事实，供测试作者判断需不需要 scope 限定）。 */
  cardinality: 'singleton' | 'repeated';
  has_children?: boolean;
}

export interface SelectorContractViolation {
  rule_id: typeof SELECTOR_SPEC_RULE_ID;
  severity: 'BLOCKER' | 'WARN';
  tc_id: string;
  step_index: number;
  selector_kind: 'by_id' | 'by_text';
  selector: string;
  match?: 'exact' | 'contains';
  canonical_ids?: string[];
  message: string;
}

/**
 * 结构化 acceptance 绑定：唯一一条「散文外」冲突判据的输入。
 * 只接受 acceptance.yaml 里已声明的机器字段（`criteria[].checkpoint.action.target_element_id`）；
 * 不解析用例名、precondition、expected、contracts 散文，也不据此建第二套 canonical registry。
 */
export interface AcceptanceActionBinding {
  /** `AC-<n>`，与派生计划「关联 AC」列同一命名空间 */
  ac_id: string;
  /** checkpoint.action.target_element_id（非空才有意义） */
  target_element_id: string;
}

export interface SelectorContractLintOptions {
  /** 结构化 checkpoint action 绑定；缺省=不做冲突判定（不是"无冲突"，是"无判据"） */
  acceptanceActionBindings?: AcceptanceActionBinding[];
}

/**
 * 唯一散文外冲突判据（plan a6c4e9f2 §2.1 / 四.2）。成立需要**双向唯一**：
 * 1. 派生行的「关联 AC」列恰好指向一个 AC；
 * 2. 该 AC 恰好声明一个非空 `checkpoint.action.target_element_id`；
 * 3. 该 case 恰好有一个携带 `by_id` 的 action step（否则无法机器判定"哪一步是 checkpoint action"）。
 * 任一侧不唯一即视为**没有结构化绑定**，不判冲突——宁可漏报，也不从散文/相邻 step 猜绑定。
 */
function findCheckpointConflict(
  acRefCell: string,
  normalizedSteps: NormalizedPlannedStep[],
  bindings: AcceptanceActionBinding[] | undefined,
): { target: string; planned: string; step_index: number } | null {
  if (!bindings || bindings.length === 0) return null;
  // AC id 词法复用 check-acceptance 的 SSOT——本地窄版 /AC-\d+/ 会漏掉 AC-G1 等合法形态，
  // 导致这类 case 的冲突判据静默失效（review 实证）。
  const acIds = [...new Set(extractAcceptanceIdRefs(acRefCell).map(value => value.toUpperCase()))];
  if (acIds.length !== 1) return null;
  const matched = bindings.filter(
    binding => binding.ac_id.trim().toUpperCase() === acIds[0] && binding.target_element_id.trim().length > 0,
  );
  if (matched.length !== 1) return null;
  const target = matched[0].target_element_id.trim();
  const plannedActionByIds = normalizedSteps
    .filter(step => step.role === 'action')
    .flatMap(step =>
      step.selector && step.selector.kind === 'by_id' && step.selector.value.trim()
        ? [{ step_index: step.index, value: step.selector.value.trim() }]
        : [],
    );
  if (plannedActionByIds.length !== 1) return null;
  const planned = plannedActionByIds[0];
  if (planned.value === target) return null;
  return { target, planned: planned.value, step_index: planned.step_index };
}

function walk(node: UiSpecComponentNode | undefined, visit: (node: UiSpecComponentNode) => void): void {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function nodesOf(screen: UiSpecScreen): UiSpecComponentNode[] {
  const nodes: UiSpecComponentNode[] = [];
  walk(screen.root, node => nodes.push(node));
  return nodes;
}

export function buildSelectorContractQuery(doc: UiSpecDoc, _feature?: string): SelectorContractEntry[] {
  const entries: SelectorContractEntry[] = [];
  for (const screen of doc.screens ?? []) {
    const nodes = nodesOf(screen);
    const counts = new Map<string, number>();
    for (const node of nodes) {
      if (typeof node.id === 'string' && node.id) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    }
    for (const node of nodes) {
      if (typeof node.id !== 'string' || !node.id) continue;
      entries.push({
        screen_id: screen.id,
        node_id: node.id,
        ...(typeof node.text === 'string' && node.text ? { text: node.text } : {}),
        cardinality: (counts.get(node.id) ?? 0) > 1 ? 'repeated' : 'singleton',
        ...(node.children && node.children.length > 0 ? { has_children: true } : {}),
      });
    }
  }
  return entries;
}

export function lintDerivedPlanSelectorContract(
  derivedMd: string,
  doc: UiSpecDoc,
  feature?: string,
  options?: SelectorContractLintOptions,
): SelectorContractViolation[] {
  const canonical = buildCanonicalSelectorIndex(doc);
  const violations: SelectorContractViolation[] = [];
  for (const row of extractDerivedPlanCases(derivedMd)) {
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    if (!parsed.ok) continue;
    const currentScreenIds = inferScreenIdsFromText(row.precondition, doc);
    // 前置条件唯一点名了当前 screen 时，候选先按该 screen 收窄；点不出来就不收窄，
    // 由下游按「候选是否落在同一个 screen」判断歧义是否已被 ui-spec 证明。
    const currentScreenId = currentScreenIds.length === 1 ? currentScreenIds[0] : undefined;
    const normalizedSteps: NormalizedPlannedStep[] = parsed.steps.map((step, index) =>
      normalizePlannedStep(step, index),
    );

    const conflict = findCheckpointConflict(row.ac_ref, normalizedSteps, options?.acceptanceActionBindings);
    if (conflict) {
      violations.push({
        rule_id: SELECTOR_SPEC_RULE_ID,
        severity: 'BLOCKER',
        tc_id: row.tc_id,
        step_index: conflict.step_index,
        selector_kind: 'by_id',
        selector: conflict.planned,
        message:
          `与已绑定 acceptance checkpoint 明确冲突：checkpoint.action.target_element_id=${conflict.target}，` +
          `计划 action by_id=${conflict.planned}。请修正其一，不要以 dump/散文另立目标`,
      });
    }

    normalizedSteps.forEach((normalized, stepIndex) => {
      const comparableSelectors = normalized.selectors.filter(
        (item): item is NormalizedPlannedSelector & { kind: 'by_id' | 'by_text' } =>
          item.kind === 'by_id' || item.kind === 'by_text',
      );
      for (const selector of comparableSelectors) {
        if (selector.kind === 'by_id') {
          const canonicalCandidates = canonicalSelectorCandidates(
            selector,
            canonical,
            currentScreenId,
          );
          // 「同屏多映射」= 全部候选落在**同一个 screen** 且数量 >1。此时无论前置条件有没有
          // 点名当前 screen，歧义都已被 ui-spec 证明。候选跨多个 screen 且当前 screen 无法
          // 唯一确定时，则是静态资料不足（开放世界交 runtime 裁决），不得当确定错误阻断。
          const candidateScreens = new Set(canonicalCandidates.map(entry => entry.screenId));
          const sameScreenAmbiguous = candidateScreens.size === 1 && canonicalCandidates.length > 1;
          if (canonicalCandidates.length === 0) {
            // 开放世界：feature ui-spec 未建模既有入口/前置页面时，缺席只是静态资料不足。
            violations.push({
              rule_id: SELECTOR_SPEC_RULE_ID,
              severity: 'WARN',
              tc_id: row.tc_id,
              step_index: stepIndex,
              selector_kind: selector.kind,
              selector: selector.value,
              canonical_ids: [],
              message:
                'by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；' +
                '静态放行，最终由本轮 native selector evidence 裁决',
            });
          } else if (sameScreenAmbiguous && !normalized.disambiguated) {
            violations.push({
              rule_id: SELECTOR_SPEC_RULE_ID,
              severity: 'BLOCKER',
              tc_id: row.tc_id,
              step_index: stepIndex,
              selector_kind: selector.kind,
              selector: selector.value,
              canonical_ids: canonicalCandidates.map(entry => entry.id),
              message: 'by_id 在当前 screen/canonical ui-spec 中多映射且无 index/scope/within/all 消歧',
            });
          } else if (candidateScreens.size > 1 && !normalized.disambiguated) {
            violations.push({
              rule_id: SELECTOR_SPEC_RULE_ID,
              severity: 'WARN',
              tc_id: row.tc_id,
              step_index: stepIndex,
              selector_kind: selector.kind,
              selector: selector.value,
              canonical_ids: [...new Set(canonicalCandidates.map(entry => entry.id))],
              message:
                `by_id 在 ${candidateScreens.size} 个 screen 上重复，且前置条件未唯一确定当前 screen——` +
                '静态资料不足，不构成"已证明的同屏多映射"；静态放行，由本轮 native selector evidence 裁决',
            });
          }
          continue;
        }

        const rawMatch = selector.match;
        if (rawMatch !== 'exact' && rawMatch !== 'contains') {
          violations.push({
            rule_id: SELECTOR_SPEC_RULE_ID,
            severity: 'BLOCKER',
            tc_id: row.tc_id,
            step_index: stepIndex,
            selector_kind: selector.kind,
            selector: selector.value,
            message: '正式 by_text selector 必须显式声明 match=exact|contains；不能使用 Hylyre 默认值或运行时放宽',
          });
          continue;
        }

        let candidates = canonicalSelectorCandidates(
          selector,
          canonical,
          currentScreenId,
        );
        if (rawMatch === 'contains' && candidates.length > 1) {
          const independentTargets = candidates.filter(entry => entry.hasChildren !== true);
          if (independentTargets.length === 1) candidates = independentTargets;
        }
        const candidateIds = [...new Set(candidates.map(entry => entry.id))];
        const candidateScreens = new Set(candidates.map(entry => entry.screenId));
        const ambiguous = candidateScreens.size === 1 && candidateIds.length > 1 && !normalized.disambiguated;
        const aggregateParent = rawMatch === 'contains' && candidates.some(
          entry => entry.hasChildren === true && entry.text !== selector.value,
        );
        if (candidateIds.length === 0) {
          violations.push({
            rule_id: SELECTOR_SPEC_RULE_ID,
            severity: 'WARN',
            tc_id: row.tc_id,
            step_index: stepIndex,
            selector_kind: selector.kind,
            selector: selector.value,
            match: rawMatch,
            canonical_ids: [],
            message:
              'by_text 未映射到当前 feature ui-spec text（开放世界：既有入口/前置页面通常不重复建模）；' +
              '静态放行，最终由本轮 native selector evidence 裁决',
          });
        } else if (!ambiguous && !aggregateParent && candidateScreens.size > 1 && !normalized.disambiguated) {
          violations.push({
            rule_id: SELECTOR_SPEC_RULE_ID,
            severity: 'WARN',
            tc_id: row.tc_id,
            step_index: stepIndex,
            selector_kind: selector.kind,
            selector: selector.value,
            match: rawMatch,
            canonical_ids: candidateIds,
            message:
              `by_text 在 ${candidateScreens.size} 个 screen 上重复，且前置条件未唯一确定当前 screen——` +
              '静态资料不足，不构成"已证明的同屏多映射"；静态放行，由本轮 native selector evidence 裁决',
          });
        } else if (ambiguous || aggregateParent) {
          violations.push({
            rule_id: SELECTOR_SPEC_RULE_ID,
            severity: 'BLOCKER',
            tc_id: row.tc_id,
            step_index: stepIndex,
            selector_kind: selector.kind,
            selector: selector.value,
            match: rawMatch,
            canonical_ids: candidateIds,
            message: aggregateParent
              ? '富文本聚合 Text/Row 仅包含该片段但未声明独立 interaction target；禁止点击父节点中心'
              : 'by_text 在 canonical ui-spec 中多映射且无 index/scope/within/all 消歧',
          });
        }
      }
    });
  }
  return violations;
}
