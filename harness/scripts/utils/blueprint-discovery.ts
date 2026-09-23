import * as crypto from 'crypto';
import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import type { CurrentScopeItem } from './blueprint-requirement-traceability';
import { resolveAdmittedModules } from './component-assets';
import { loadGlossary, lookupTerm } from './glossary-parser';

export interface DiscoveryInput {
  assertion_id: string;
  subject: string;
  value: unknown;
  source_kind: string;
  source_ref: string;
  source_revision?: string;
  evidence_strength: 'authoritative' | 'observed' | 'inferred' | 'unknown';
  observed_at: string;
  extraction_method: string;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintDiscoveryInputs(inputs: DiscoveryInput[]): string {
  const normalized = [...inputs].sort((a, b) => a.assertion_id.localeCompare(b.assertion_id));
  return `sha256:${crypto.createHash('sha256').update(stableJson(normalized)).digest('hex')}`;
}

export function fingerprintDiscoveryFacts(facts: BlueprintRecord[]): string {
  const inputs: DiscoveryInput[] = facts.map(fact => {
    const provenance = (fact.provenance ?? {}) as BlueprintRecord;
    return {
      assertion_id: String(fact.fact_id ?? ''),
      subject: String(fact.subject ?? ''),
      value: fact.value,
      source_kind: String(provenance.source_kind ?? ''),
      source_ref: String(provenance.source_ref ?? ''),
      source_revision: typeof provenance.source_revision === 'string' ? provenance.source_revision : undefined,
      evidence_strength: String(provenance.evidence_strength ?? 'unknown') as DiscoveryInput['evidence_strength'],
      observed_at: String(provenance.observed_at ?? ''),
      extraction_method: String(provenance.extraction_method ?? ''),
    };
  });
  return fingerprintDiscoveryInputs(inputs);
}

export function fingerprintDiscoverySources(
  facts: BlueprintRecord[],
  scopeItems: CurrentScopeItem[],
): string {
  const factInputs = facts.map(fact => {
    const provenance = (fact.provenance ?? {}) as BlueprintRecord;
    return {
      assertion_id: String(fact.fact_id ?? ''),
      subject: String(fact.subject ?? ''),
      value: fact.value,
      source_kind: String(provenance.source_kind ?? ''),
      source_ref: String(provenance.source_ref ?? ''),
      source_revision: typeof provenance.source_revision === 'string' ? provenance.source_revision : undefined,
      evidence_strength: String(provenance.evidence_strength ?? 'unknown'),
      observed_at: String(provenance.observed_at ?? ''),
      extraction_method: String(provenance.extraction_method ?? ''),
    };
  });
  const currentScopeSources = scopeItems.map(item => ({
    item_id: item.item_id,
    kind: item.kind,
    source_ref: item.source_ref,
    source_revision: item.source_revision,
    source_sha256: item.source_sha256,
    provenance: item.provenance,
  }));
  const normalized = {
    facts: factInputs.sort((a, b) => a.assertion_id < b.assertion_id ? -1 : a.assertion_id > b.assertion_id ? 1 : 0),
    current_scope_items: currentScopeSources.sort((a, b) => a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0),
  };
  return `sha256:${crypto.createHash('sha256').update(stableJson(normalized)).digest('hex')}`;
}

export function buildDiscoveryBundle(inputs: DiscoveryInput[]): BlueprintRecord {
  const facts = inputs.map(input => ({
    fact_id: input.assertion_id,
    subject: input.subject,
    value: input.value,
    provenance: {
      source_kind: input.source_kind,
      source_ref: input.source_ref,
      source_revision: input.source_revision,
      observed_at: input.observed_at,
      evidence_strength: input.evidence_strength,
      extraction_method: input.extraction_method,
    },
  }));
  const bySubject = new Map<string, BlueprintRecord[]>();
  for (const fact of facts) {
    const list = bySubject.get(String(fact.subject)) ?? [];
    list.push(fact);
    bySubject.set(String(fact.subject), list);
  }
  const conflicts: BlueprintRecord[] = [];
  for (const [subject, subjectFacts] of bySubject) {
    const values = new Set(subjectFacts.map(fact => stableJson(fact.value)));
    if (values.size > 1) {
      conflicts.push({
        conflict_id: `conflict:${subject}`,
        subject,
        sources: subjectFacts.map(fact => ({
          source_ref: (fact.provenance as BlueprintRecord).source_ref,
          value: fact.value,
        })),
        owner: 'unassigned',
        resolution: 'open_decision',
      });
    }
  }
  return { source_fingerprint: fingerprintDiscoveryInputs(inputs), facts, conflicts };
}

export function discoveryHasTrustedCurrentFacts(discovery: BlueprintRecord): boolean {
  return asRecords(discovery.facts).some(fact => {
    const provenance = fact.provenance as BlueprintRecord | undefined;
    return provenance
      && ['code', 'schema', 'interface', 'config', 'test'].includes(String(provenance.source_kind))
      && nonEmptyString(provenance.source_ref);
  });
}

export interface TermFact {
  term: string;
  canonical_module: string;
  confidence: string;
  easily_confused_with: string[];
  extraction_method: string;
}

/** plan a3c7e9d1 t2：术语映射 = discovery.facts 中 `subject: term:<原始术语>` 的条目（spec 术语表只投影）。 */
export function terminologyFacts(blueprint: BlueprintRecord): TermFact[] {
  return asRecords(asRecord(blueprint.discovery)?.facts)
    .filter(fact => String(fact.subject ?? '').startsWith('term:'))
    .map(fact => {
      const value = asRecord(fact.value);
      return {
        term: String(fact.subject).slice('term:'.length),
        canonical_module: String(value?.canonical_module ?? ''),
        confidence: String(value?.confidence ?? ''),
        easily_confused_with: asStrings(value?.easily_confused_with),
        extraction_method: String(asRecord(fact.provenance)?.extraction_method ?? ''),
      };
    });
}

/**
 * 检查 id `terminology_facts_confirmed`：canonical_module 为获准模块；真实确认 `user_confirmed`；
 * headless 自动继续 `headless_assumed` 只 WARN 入 must-review（不停步、不回写 glossary）；
 * medium|low 未确认 → BLOCKER（admission 派生 blocker），受控远期 open_decision gap 停放的除外（WARN）；
 * high 只能由 glossary 精确命中直确认。
 */
export function validateTerminologyFacts(blueprint: BlueprintRecord, projectRoot?: string): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const facts = asRecords(asRecord(blueprint.discovery)?.facts);
  const admitted = projectRoot ? resolveAdmittedModules(projectRoot, blueprint) : undefined;
  const glossary = projectRoot ? loadGlossary(projectRoot) : undefined;
  const gaps = asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps);
  const currentSliceId = asRecord(asRecord(asRecord(blueprint.review_summary)?.admission)?.current_slice)?.slice_id;
  facts.forEach((fact, index) => {
    if (!String(fact.subject ?? '').startsWith('term:')) return;
    const at = `$.discovery.facts[${index}]`;
    const term = String(fact.subject).slice('term:'.length);
    const value = asRecord(fact.value);
    const provenance = asRecord(fact.provenance);
    const method = String(provenance?.extraction_method ?? '');
    const fail = (message: string, severity: 'BLOCKER' | 'WARN' = 'BLOCKER') => out.push(issue('terminology_facts_confirmed', at, `术语「${term}」：${message}`, severity));
    if (!term.trim() || !nonEmptyString(value?.canonical_module) || !['high', 'medium', 'low'].includes(String(value?.confidence))
      || !Array.isArray(value?.easily_confused_with) || asStrings(value?.easily_confused_with).length !== value!.easily_confused_with.length) {
      fail('value 必须是 {canonical_module, confidence: high|medium|low, easily_confused_with: []}。');
      return;
    }
    if (!['glossary', 'catalog'].includes(String(provenance?.source_kind))) fail('provenance.source_kind 只能是 glossary|catalog。');
    const module = String(value.canonical_module);
    if (admitted?.catalogOk && !admitted.modules.has(module)) fail(`canonical_module=${module} 不是获准模块（catalog ∪ 本蓝图 add_module/move_module 声明）。`);
    if (method === 'user_confirmed') return;
    if (method === 'headless_assumed') {
      fail('headless 自动继续（headless_assumed），入 must-review；不得记为 user_confirmed，也不回写 glossary。', 'WARN');
      return;
    }
    if (value.confidence !== 'high') {
      // 远期切片的未决术语沿既有受控 gap 停放：open_decision、needed_by ≠ 当前切片、verification_refs 引用该事实 subject；
      // 同一术语只要还有当前切片 gap（needed_by=当前切片或 status=blocker）就不得停放。
      const termGaps = gaps.filter(gap => asStrings(gap.verification_refs).includes(String(fact.subject)));
      const neededNow = termGaps.some(gap => gap.needed_by === currentSliceId || gap.status === 'blocker');
      const parked = nonEmptyString(currentSliceId) && !neededNow
        && termGaps.find(gap => gap.status === 'open_decision' && nonEmptyString(gap.needed_by) && gap.needed_by !== currentSliceId);
      if (parked) {
        fail(`${String(value.confidence)} 置信度未确认，已由 gap ${String(parked.gap_id)} 停放到远期切片 ${String(parked.needed_by)}；进入该切片前须确认并记 user_confirmed。`, 'WARN');
        return;
      }
      fail(`${String(value.confidence)} 置信度未经用户确认（extraction_method=${method || '(空)'}）；交互态须当场确认并记 user_confirmed；仅远期切片使用的术语可登记 open_decision gap（needed_by=远期切片，verification_refs 含 ${String(fact.subject)}）停放。`);
      return;
    }
    const hit = glossary?.ok ? lookupTerm(glossary.glossary, term) : undefined;
    if (provenance?.source_kind !== 'glossary' || (glossary && (!hit || hit.matched_as !== 'exact' || hit.term.canonical_module !== module))) {
      fail('high 只能由 glossary 精确命中且 canonical_module 一致时直确认；否则降为 medium|low 并请用户确认。');
    }
  });
  return out;
}

const SOURCE_AUTHORITY_RANK: Record<string, number> = {
  test: 5,
  schema: 5,
  interface: 5,
  config: 5,
  code: 5,
  external_contract: 4,
  product_requirement: 3,
  architecture: 2,
  catalog: 2,
  glossary: 2,
  code_graph: 2,
  convention: 2,
  document: 1,
  model_inference: 0,
};

export function rankDiscoveryFactSources(facts: BlueprintRecord[]): BlueprintRecord[] {
  return [...facts].sort((left, right) => {
    const leftKind = String((left.provenance as BlueprintRecord | undefined)?.source_kind ?? 'model_inference');
    const rightKind = String((right.provenance as BlueprintRecord | undefined)?.source_kind ?? 'model_inference');
    return (SOURCE_AUTHORITY_RANK[rightKind] ?? 0) - (SOURCE_AUTHORITY_RANK[leftKind] ?? 0);
  });
}
