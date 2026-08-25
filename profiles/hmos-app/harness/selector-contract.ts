// ============================================================================
// selector-contract.ts — 测试计划 selector 的 ui-spec 来源契约（SELECTOR-SPEC-001）
// ----------------------------------------------------------------------------
// 规则不变：运行时 dump / snapshot cache 只能**发现候选**，不能成为 selector 真值——
// `by_id` 必须能反解到 ui-spec 组件节点 id，`by_text` 必须与 ui-spec text 精确等值。
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

export const SELECTOR_SPEC_RULE_ID = 'SELECTOR-SPEC-001';

export interface SelectorContractEntry {
  screen_id: string;
  node_id: string;
  text?: string;
  /** 同屏同 id 出现多次=repeated（纯 ui-spec 事实，供测试作者判断需不需要 scope 限定）。 */
  cardinality: 'singleton' | 'repeated';
}

export interface SelectorContractViolation {
  rule_id: typeof SELECTOR_SPEC_RULE_ID;
  severity: 'WARN';
  tc_id: string;
  step_index: number;
  selector_kind: 'by_id' | 'by_text';
  selector: string;
  message: string;
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
      });
    }
  }
  return entries;
}

function selectorsOf(step: Record<string, unknown>): Array<{
  kind: 'by_id' | 'by_text';
  value: string;
}> {
  const out: Array<{ kind: 'by_id' | 'by_text'; value: string }> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.by_id === 'string' && record.by_id) {
      out.push({ kind: 'by_id', value: record.by_id });
    }
    if (typeof record.by_text === 'string' && record.by_text) {
      out.push({ kind: 'by_text', value: record.by_text });
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(step);
  return out;
}

export function lintDerivedPlanSelectorContract(
  derivedMd: string,
  doc: UiSpecDoc,
  feature?: string,
): SelectorContractViolation[] {
  const query = buildSelectorContractQuery(doc, feature);
  const texts = new Set(query.map(e => e.text).filter((x): x is string => Boolean(x)));
  const bareIds = new Set(query.map(e => e.node_id));
  const violations: SelectorContractViolation[] = [];
  for (const row of extractDerivedPlanCases(derivedMd)) {
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    if (!parsed.ok) continue;
    parsed.steps.forEach((step, stepIndex) => {
      for (const selector of selectorsOf(step)) {
        const valid = selector.kind === 'by_text'
          ? texts.has(selector.value)
          : bareIds.has(selector.value);
        if (!valid) {
          violations.push({
            rule_id: SELECTOR_SPEC_RULE_ID,
            severity: 'WARN',
            tc_id: row.tc_id,
            step_index: stepIndex,
            selector_kind: selector.kind,
            selector: selector.value,
            message: selector.kind === 'by_id'
              ? 'by_id 不是当前 feature ui-spec 声明的组件节点 id；运行时 dump 只能发现候选，不能成为 selector 真值'
              : 'by_text 与 ui-spec text 不精确等值；请先修正 ui-spec/测试计划或显式跳过',
          });
        }
      }
    });
  }
  return violations;
}
