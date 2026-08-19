import {
  BlueprintIssue,
  BlueprintRecord,
  asRecords,
  asStrings,
  getId,
  issue,
  nonEmptyString,
} from './component-blueprint-model';

export const STATIC_BLUEPRINT_PROVIDERS = [
  'current-facts-discovery',
  'se-manual-contracts',
  'app-design-lens',
  'independent-design-questioning',
] as const;

const FORBIDDEN_WRITES = ['goal_events', 'goal_receipt', 'goal_evidence', 'p2_ready_set', 'p3_closure'];

const STATIC_PROVIDER_SOURCE_RULES: Record<string, { authority_rule: string; source_rule: string }> = {
  'current-facts-discovery': {
    authority_rule: 'Code, schema, interface, config, and tests are current-state authority.',
    source_rule: 'Every assertion carries source_ref and source revision when available.',
  },
  'se-manual-contracts': {
    authority_rule: 'Authorized SE or contract owner is external-contract authority.',
    source_rule: 'Every contract segment carries source_ref, verification ref, and provenance.',
  },
  'app-design-lens': {
    authority_rule: 'Lens is not fact authority and cannot override inputs.',
    source_rule: 'Projection cites inputs, viewpoint contract, and lens rule version.',
  },
  'independent-design-questioning': {
    authority_rule: 'Questioning is not fact or decision authority.',
    source_rule: 'Answers cite isolated blueprint, evidence package, and registered external inputs.',
  },
};

export function validateBlueprintProviders(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const providers = asRecords(blueprint.providers);
  const providerCounts = new Map<string, number>();
  for (const provider of providers) {
    const id = getId(provider, 'provider_id');
    if (id) providerCounts.set(id, (providerCounts.get(id) ?? 0) + 1);
  }
  for (const [providerId, count] of providerCounts) {
    if (count > 1) {
      out.push(issue('blueprint_provider_duplicate_authority', '$.providers', `同一 provider seam 重复 ${count} 次：${providerId}；禁止 Map/顺序覆盖。`));
    }
  }
  const byId = new Map(providers.map(provider => [getId(provider, 'provider_id'), provider]));
  for (const providerId of STATIC_BLUEPRINT_PROVIDERS) {
    const provider = byId.get(providerId);
    if (!provider) {
      out.push(issue('blueprint_required_provider_missing', '$.providers', `缺少静态 provider seam：${providerId}。`));
      continue;
    }
    for (const field of ['definition', 'consumer', 'provider', 'requirement', 'authority_rule', 'source_rule', 'missing_behavior', 'replacement_behavior', 'exit_behavior', 'conflict_behavior']) {
      const value = provider[field];
      if (!nonEmptyString(value) && asStrings(value).length === 0) {
        out.push(issue('blueprint_provider_seam_incomplete', `$.providers[${providers.indexOf(provider)}].${field}`, `${providerId} Seam Card 缺 ${field}。`));
      }
    }
    if (!['required', 'optional'].includes(String(provider.requirement))) {
      out.push(issue('blueprint_provider_requirement_invalid', `$.providers[${providers.indexOf(provider)}].requirement`, 'provider requirement 只允许 required|optional。'));
    }
    const frozenRules = STATIC_PROVIDER_SOURCE_RULES[providerId];
    for (const field of ['authority_rule', 'source_rule'] as const) {
      if (provider[field] !== frozenRules[field]) {
        out.push(issue('blueprint_provider_authority_rule_mismatch', `$.providers[${providers.indexOf(provider)}].${field}`, `${providerId}.${field} 必须与静态 Seam Card 契约一致。`));
      }
    }
    if (provider.available === false && provider.requirement === 'required' && provider.missing_disposition !== 'blocker') {
      out.push(issue('blueprint_required_provider_missing', `$.providers[${providers.indexOf(provider)}].missing_disposition`, 'required provider 缺失必须形成 blocker。'));
    }
    if (provider.available === false && provider.requirement !== 'required' && !['unknown', 'degraded', 'not_applicable'].includes(String(provider.missing_disposition))) {
        out.push(issue('blueprint_optional_provider_degradation_missing', `$.providers[${providers.indexOf(provider)}].missing_disposition`, 'optional provider 缺失必须显式降级或保留 unknown。'));
    }
    for (const write of asStrings(provider.writes)) {
      if (FORBIDDEN_WRITES.includes(write)) {
        out.push(issue('blueprint_provider_boundary_violation', `$.providers[${providers.indexOf(provider)}].writes`, `P1 provider 不得写入 ${write}。`));
      }
    }
    if (provider.loading === 'dynamic' || nonEmptyString(provider.registry_ref)) {
      out.push(issue('blueprint_provider_dynamic_registry_forbidden', `$.providers[${providers.indexOf(provider)}]`, 'P1 provider 必须静态内置，不得引入动态 loader/registry。'));
    }
  }
  return out;
}
