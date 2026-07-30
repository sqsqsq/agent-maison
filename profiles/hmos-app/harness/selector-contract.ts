import * as fs from 'fs';
import * as path from 'path';
import {
  buildInstanceAnchor,
  normalizeAnchorSegment,
  normalizeRuntimeAnchor,
} from './ui-kit-anchors';
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
  canonical_base_anchor: string;
  cardinality: 'singleton' | 'repeated';
  instance_key: 'forbidden' | 'required';
  applicable_suffixes: string[];
  applicable_suffix_patterns: string[];
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

interface BlockSuffixSpec {
  semantic_node: string;
  anchor_suffixes?: string[];
  anchor_suffix_patterns?: string[];
}

function blockSuffixesBySemantic(): Map<string, BlockSuffixSpec> {
  const manifestPath = path.resolve(__dirname, '..', 'ui-kit', 'blocks.json');
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    blocks?: Record<string, BlockSuffixSpec>;
  };
  return new Map(Object.values(parsed.blocks ?? {}).map(block => [block.semantic_node, block]));
}

export function buildSelectorContractQuery(doc: UiSpecDoc, feature: string): SelectorContractEntry[] {
  const suffixesBySemantic = blockSuffixesBySemantic();
  const entries: SelectorContractEntry[] = [];
  for (const screen of doc.screens ?? []) {
    const nodes = nodesOf(screen);
    const counts = new Map<string, number>();
    for (const node of nodes) {
      if (typeof node.id === 'string' && node.id) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    }
    for (const node of nodes) {
      if (typeof node.id !== 'string' || !node.id) continue;
      const repeated = (counts.get(node.id) ?? 0) > 1;
      const explicitBlock = (node as UiSpecComponentNode & { block?: unknown }).block;
      const semantic = typeof explicitBlock === 'string' && explicitBlock ? explicitBlock : node.type;
      const block = typeof semantic === 'string' ? suffixesBySemantic.get(semantic) : undefined;
      entries.push({
        screen_id: screen.id,
        node_id: node.id,
        ...(typeof node.text === 'string' && node.text ? { text: node.text } : {}),
        canonical_base_anchor: buildInstanceAnchor(feature, screen.id, node.id),
        cardinality: repeated ? 'repeated' : 'singleton',
        instance_key: repeated ? 'required' : 'forbidden',
        applicable_suffixes: [...(block?.anchor_suffixes ?? [])],
        applicable_suffix_patterns: [...(block?.anchor_suffix_patterns ?? [])],
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
  feature: string,
): SelectorContractViolation[] {
  const query = buildSelectorContractQuery(doc, feature);
  const texts = new Set(query.map(e => e.text).filter((x): x is string => Boolean(x)));
  const bareIds = new Set(query.map(e => e.node_id));
  const byScreenNode = new Set(query.map(e => `${e.screen_id}\0${e.node_id}`));
  const violations: SelectorContractViolation[] = [];
  for (const row of extractDerivedPlanCases(derivedMd)) {
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    if (!parsed.ok) continue;
    parsed.steps.forEach((step, stepIndex) => {
      for (const selector of selectorsOf(step)) {
        let valid = false;
        if (selector.kind === 'by_text') {
          valid = texts.has(selector.value);
        } else if (bareIds.has(selector.value)) {
          valid = true;
        } else {
          const normalized = normalizeRuntimeAnchor(selector.value);
          valid = normalized.validity === 'valid'
            && normalized.feature === normalizeAnchorSegment(feature)
            && Boolean(normalized.screen && normalized.specNode)
            && byScreenNode.has(`${normalized.screen}\0${normalized.specNode}`);
        }
        if (!valid) {
          violations.push({
            rule_id: SELECTOR_SPEC_RULE_ID,
            severity: 'WARN',
            tc_id: row.tc_id,
            step_index: stepIndex,
            selector_kind: selector.kind,
            selector: selector.value,
            message: selector.kind === 'by_id'
              ? 'by_id 无法反解到当前 feature/screen 的 ui-spec node；运行时 dump 只能发现候选，不能成为 selector 真值'
              : 'by_text 与 ui-spec text 不精确等值；请先修正 ui-spec/测试计划或显式跳过',
          });
        }
      }
    });
  }
  return violations;
}
