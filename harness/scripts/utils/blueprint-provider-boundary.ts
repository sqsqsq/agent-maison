import * as fs from 'fs';
import { conventionsPath, relConventions, isConventionsPathExplicitlyConfigured } from '../../config';
import { extractHeadings } from './markdown-parser';
import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
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
  'conventions-knowledge',
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
  'conventions-knowledge': {
    authority_rule: 'Project conventions are stable knowledge input, not current-code authority.',
    source_rule: 'Applicable facts cite the configured conventions file and exact heading id.',
  },
};

function readConventions(projectRoot: string): { text: string | null; missing: boolean } {
  try {
    return { text: fs.readFileSync(conventionsPath(projectRoot), 'utf8'), missing: false };
  } catch (error) {
    return { text: null, missing: (error as NodeJS.ErrnoException).code === 'ENOENT' };
  }
}

export function validateBlueprintProviders(
  blueprint: BlueprintRecord,
  context: { projectRoot?: string } = {},
): BlueprintIssue[] {
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
      out.push(issue(
        providerId === 'conventions-knowledge'
          ? 'blueprint_conventions_provider_missing'
          : 'blueprint_required_provider_missing',
        '$.providers',
        `缺少静态 provider seam：${providerId}。`,
      ));
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
    if (providerId === 'conventions-knowledge') {
      if (provider.requirement !== 'optional') {
        out.push(issue('blueprint_conventions_provider_requirement_invalid', `$.providers[${providers.indexOf(provider)}].requirement`, 'conventions-knowledge 必须是 optional provider。'));
      }
      if (context.projectRoot) {
        const asset = readConventions(context.projectRoot);
        const readable = asset.text !== null;
        const explicit = isConventionsPathExplicitlyConfigured(context.projectRoot);
        const disabled = asset.missing && !explicit;
        const prefix = `${relConventions(context.projectRoot)}#`;
        const facts = asRecords(asRecord(blueprint.discovery)?.facts)
          .filter(fact => asRecord(fact.provenance)?.source_kind === 'convention');
        const factRefs = new Set(facts.map(fact => String(asRecord(fact.provenance)?.source_ref ?? '')));
        if (readable) {
          const validRefs = new Set(extractHeadings(asset.text!).filter(heading => heading.level === 2).map(heading => `${prefix}${heading.text}`));
          for (const ref of factRefs) {
            if (!validRefs.has(ref)) out.push(issue('blueprint_convention_source_invalid', '$.discovery.facts', `惯例 fact 必须引用配置文件中的真实 id：${ref}`));
          }
        }
        // 节点/decision 只引用同一 fact；projection/review 无需建立第二份惯例集合。
        const consumers = asRecords(blueprint.design_views).flatMap((view, viewIndex) =>
          asRecords(view.nodes).map((node, nodeIndex) => ({ value: node, at: `$.design_views[${viewIndex}].nodes[${nodeIndex}]` })),
        );
        consumers.push(...asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions)
          .map((decision, index) => ({ value: decision, at: `$.decisions_and_gaps.decisions[${index}]` })));
        for (const { value, at } of consumers) {
          const provenance = asRecord(value.provenance);
          const refs = asStrings(value.verification_refs).filter(ref => ref.startsWith(prefix));
          if (provenance?.source_kind === 'convention') refs.push(String(provenance.source_ref ?? ''));
          for (const ref of new Set(refs)) {
            if (!factRefs.has(ref)) out.push(issue('blueprint_convention_fact_missing', at, `惯例引用缺少同 source_ref 的 discovery fact：${ref}`));
          }
        }
        if (!readable && facts.length > 0) {
          out.push(issue('blueprint_conventions_provider_availability_mismatch', '$.discovery.facts', '惯例文件不可读时不得呈现已消费的 convention fact。'));
        }
        if (readable && provider.available !== true) {
          out.push(issue('blueprint_conventions_provider_availability_mismatch', `$.providers[${providers.indexOf(provider)}].available`, '惯例文件可读时 provider 必须标记 available=true。'));
        } else if (!readable && provider.available !== false) {
          out.push(issue('blueprint_conventions_provider_availability_mismatch', `$.providers[${providers.indexOf(provider)}].available`, '惯例文件不可读时 provider 不得声称 available=true。'));
        } else if (!readable && !disabled && !['unknown', 'degraded'].includes(String(provider.missing_disposition))) {
          out.push(issue('blueprint_conventions_provider_unreadable', `$.providers[${providers.indexOf(provider)}].missing_disposition`, '惯例读取失败或显式配置路径缺失时只能标记 unknown|degraded。'));
        } else if (disabled && provider.missing_disposition !== 'not_applicable') {
          out.push(issue('blueprint_conventions_provider_disabled_disposition_invalid', `$.providers[${providers.indexOf(provider)}].missing_disposition`, '默认路径无文件且未显式配置表示未启用，必须标记 not_applicable。'));
        }
      }
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
