// planned-step-normalizer.ts — Maison/Hylyre planned-step 共享规范化
// ============================================================================
// 只归一化计划事实，不执行步骤、不读取 dump/cache。P0 acceptance、静态 selector
// 门与 native runtime selector 门必须消费同一份 root/kind/selector/disambiguator 视图。
// ============================================================================

import type {
  UiSpecComponentNode,
  UiSpecDoc,
} from './ui-spec-shared';

export type PlannedSelectorKind = 'by_id' | 'by_text' | 'by_type' | 'by_key';

export interface NormalizedPlannedSelector {
  kind: PlannedSelectorKind;
  value: string;
  /** Parent `match` is inherited by an `all[]` text selector, matching Hylyre. */
  match: string | null;
  body: Record<string, unknown>;
  path: string;
}

export interface NormalizedPlannedStep {
  index: number;
  root: string;
  kind: string;
  role: 'action' | 'assertion';
  body: Record<string, unknown>;
  selector: NormalizedPlannedSelector | null;
  selectors: NormalizedPlannedSelector[];
  disambiguated: boolean;
}

export interface CanonicalSelectorNode {
  id: string;
  screenId: string;
  text?: string;
  ancestorIds: ReadonlySet<string>;
  hasChildren?: boolean;
}

export interface CanonicalSelectorIndex {
  byId: Map<string, CanonicalSelectorNode[]>;
  byText: Map<string, CanonicalSelectorNode[]>;
}

const ASSERTION_KINDS = new Set(['wait_for', 'wait_gone', 'assert_toast', 'expected_check']);
const SELECTOR_KEYS: Array<[PlannedSelectorKind, string]> = [
  ['by_id', 'by_id'],
  ['by_text', 'by_text'],
  ['by_type', 'by_type'],
  ['by_key', 'by_key'],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function selectorMatch(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function disambiguatedBy(body: Record<string, unknown>): boolean {
  return body.index !== undefined || body.scope !== undefined || body.within !== undefined || body.all !== undefined;
}

function selectorFromRecord(
  record: Record<string, unknown>,
  path: string,
  inheritedMatch: string | null,
  parentBody: Record<string, unknown>,
): NormalizedPlannedSelector | null {
  for (const [kind, key] of SELECTOR_KEYS) {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const effectiveMatch = selectorMatch(record.match) ?? inheritedMatch;
    return {
      kind,
      value: value.trim(),
      match: effectiveMatch,
      body: {
        ...parentBody,
        ...record,
        ...(effectiveMatch ? { match: effectiveMatch } : {}),
      },
      path,
    };
  }
  return null;
}

function collectSelectors(
  value: unknown,
  path: string,
  inheritedMatch: string | null,
  parentBody: Record<string, unknown>,
  out: NormalizedPlannedSelector[],
): void {
  if (!isRecord(value)) return;
  const direct = selectorFromRecord(value, path, inheritedMatch, parentBody);
  if (direct) out.push(direct);

  const nextMatch = selectorMatch(value.match) ?? inheritedMatch;
  if (Array.isArray(value.all)) {
    value.all.forEach((item, index) => {
      if (isRecord(item)) {
        collectSelectors(item, `${path}.all[${index}]`, nextMatch, {
          ...parentBody,
          ...value,
        }, out);
      }
    });
  }
  for (const key of ['within', 'below', 'above', 'after', 'before']) {
    const anchor = value[key];
    if (isRecord(anchor)) {
      collectSelectors(anchor, `${path}.${key}`, nextMatch, {
        ...parentBody,
        ...value,
      }, out);
    }
  }
}

/** Normalize one parsed JSON step exactly as the native Hylyre runner names it. */
export function normalizePlannedStep(
  value: Record<string, unknown>,
  index = 0,
): NormalizedPlannedStep {
  const roots = Object.keys(value);
  const root = roots.length === 1 ? roots[0]! : '';
  const rawBody = root ? value[root] : undefined;
  const body = isRecord(rawBody) ? rawBody : {};
  const kind = root === 'action' && typeof body.type === 'string' && body.type.trim()
    ? body.type.trim().toLowerCase()
    : root;
  const selectors: NormalizedPlannedSelector[] = [];
  collectSelectors(body, `$${root ? `.${root}` : ''}`, selectorMatch(body.match), body, selectors);
  return {
    index,
    root,
    kind,
    role: ASSERTION_KINDS.has(kind) ? 'assertion' : 'action',
    body,
    selector: selectors[0] ?? null,
    selectors,
    disambiguated: disambiguatedBy(body) || selectors.some(selector => disambiguatedBy(selector.body)),
  };
}

export function normalizePlannedSteps(values: Record<string, unknown>[]): NormalizedPlannedStep[] {
  return values.map((value, index) => normalizePlannedStep(value, index));
}

/** Build canonical selector nodes from ui-spec only; runtime dumps never enter this index. */
export function buildCanonicalSelectorIndex(doc: UiSpecDoc): CanonicalSelectorIndex {
  const byId = new Map<string, CanonicalSelectorNode[]>();
  const byText = new Map<string, CanonicalSelectorNode[]>();
  const add = (map: Map<string, CanonicalSelectorNode[]>, key: string, node: CanonicalSelectorNode): void => {
    const values = map.get(key) ?? [];
    values.push(node);
    map.set(key, values);
  };
  const visit = (
    node: UiSpecComponentNode | undefined,
    screenId: string,
    ancestors: Set<string>,
  ): void => {
    if (!node || typeof node !== 'object') return;
    const nextAncestors = new Set(ancestors);
    if (typeof node.id === 'string' && node.id.trim()) {
      const canonical: CanonicalSelectorNode = {
        id: node.id.trim(),
        screenId,
        ...(typeof node.text === 'string' && node.text ? { text: node.text } : {}),
        ancestorIds: new Set(ancestors),
        ...(node.children && node.children.length > 0 ? { hasChildren: true } : {}),
      };
      add(byId, canonical.id, canonical);
      if (canonical.text) add(byText, canonical.text, canonical);
      nextAncestors.add(canonical.id);
    }
    for (const child of node.children ?? []) visit(child, screenId, nextAncestors);
  };
  for (const screen of doc.screens ?? []) {
    // `must_have_elements` is a declaration of obligations, not another
    // rendering of the component tree. Prefer the concrete tree node when it
    // exists so a canonical singleton is not falsely made ambiguous.
    visit(screen.root, screen.id, new Set());
    for (const id of screen.must_have_elements ?? []) {
      if (typeof id !== 'string' || !id.trim()) continue;
      const normalizedId = id.trim();
      const existsInScreen = (byId.get(normalizedId) ?? []).some(node => node.screenId === screen.id);
      if (!existsInScreen) {
        add(byId, normalizedId, { id: normalizedId, screenId: screen.id, ancestorIds: new Set() });
      }
    }
  }
  return { byId, byText };
}

function anchorIds(
  value: unknown,
  index: CanonicalSelectorIndex,
  screenId?: string,
): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!isRecord(value)) return [];
  const byId = typeof value.by_id === 'string' ? value.by_id.trim() : '';
  if (byId) return [byId];
  const byText = typeof value.by_text === 'string' ? value.by_text.trim() : '';
  if (!byText) return [];
  const match = selectorMatch(value.match) ?? 'contains';
  const candidates = match === 'exact'
    ? (index.byText.get(byText) ?? [])
    : [...index.byText.values()].flat().filter(node => typeof node.text === 'string' && node.text.includes(byText));
  return [...new Set(candidates.filter(node => !screenId || node.screenId === screenId).map(node => node.id))];
}

/** Resolve a normalized selector against canonical ui-spec nodes and apply existing disambiguators. */
export function canonicalSelectorCandidates(
  selector: NormalizedPlannedSelector | null,
  index: CanonicalSelectorIndex,
  screenId?: string,
): CanonicalSelectorNode[] {
  if (!selector) return [];
  let candidates = selector.kind === 'by_id'
    ? [...(index.byId.get(selector.value) ?? [])]
    : selector.kind === 'by_text'
      ? selector.match === 'exact'
        ? [...(index.byText.get(selector.value) ?? [])]
        : selector.match === 'contains'
          ? [...index.byText.values()].flat().filter(node => typeof node.text === 'string' && node.text.includes(selector.value))
          : []
      : [];
  if (screenId) candidates = candidates.filter(node => node.screenId === screenId);

  const within = selector.body.within ?? (
    selector.body.scope === 'top_overlay' ? undefined : selector.body.scope
  );
  const ids = anchorIds(within, index, screenId);
  if (ids.length > 0) {
    candidates = candidates.filter(node => ids.some(id => node.id === id || node.ancestorIds.has(id)));
  }
  if (Number.isInteger(selector.body.index) && Number(selector.body.index) >= 0) {
    const indexValue = Number(selector.body.index);
    candidates = candidates.slice(indexValue, indexValue + 1);
  }
  return candidates;
}

export function canonicalIdsForPlannedStep(
  step: NormalizedPlannedStep,
  index: CanonicalSelectorIndex,
  screenId?: string,
): string[] {
  return [...new Set(canonicalSelectorCandidates(step.selector, index, screenId).map(node => node.id))];
}

export function inferScreenIdsFromText(
  text: string,
  doc: UiSpecDoc,
): string[] {
  const haystack = text.trim().toLowerCase();
  if (!haystack) return [];
  return (doc.screens ?? [])
    .filter(screen => [screen.id, screen.ref_id].some(value => typeof value === 'string' && value.trim() && haystack.includes(value.trim().toLowerCase())))
    .map(screen => screen.id);
}
