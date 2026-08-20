import * as crypto from 'crypto';
import {
  BlueprintRecord,
  asRecords,
  nonEmptyString,
} from './component-blueprint-model';
import type { CurrentScopeItem } from './blueprint-requirement-traceability';

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
