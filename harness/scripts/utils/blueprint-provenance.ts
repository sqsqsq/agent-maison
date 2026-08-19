import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  issue,
  nonEmptyString,
} from './component-blueprint-model';

const REQUIRED_PROVENANCE_FIELDS = [
  'source_kind',
  'source_ref',
  'observed_at',
  'evidence_strength',
  'extraction_method',
] as const;

export function validateProvenanceRecord(value: unknown, atPath: string): BlueprintIssue[] {
  const record = asRecord(value);
  if (!record) return [issue('blueprint_provenance_missing', atPath, 'provenance 必须是对象。')];
  const out: BlueprintIssue[] = [];
  for (const field of REQUIRED_PROVENANCE_FIELDS) {
    if (!nonEmptyString(record[field])) {
      out.push(issue('blueprint_provenance_missing', `${atPath}.${field}`, `${field} 必填。`));
    }
  }
  if (!['authoritative', 'observed', 'inferred', 'unknown'].includes(String(record.evidence_strength))) {
    out.push(issue('blueprint_provenance_strength_invalid', `${atPath}.evidence_strength`, 'evidence_strength 非法。'));
  }
  return out;
}

function validateOwnedCollections(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const visit = (items: unknown, atPath: string): void => {
    asRecords(items).forEach((item, index) => {
      out.push(...validateProvenanceRecord(item.provenance, `${atPath}[${index}].provenance`));
    });
  };
  asRecords(blueprint.design_views).forEach((view, viewIndex) => {
    visit(view.nodes, `$.design_views[${viewIndex}].nodes`);
    visit(view.runtime_data_flows, `$.design_views[${viewIndex}].runtime_data_flows`);
  });
  visit(blueprint.relations, '$.relations');
  visit(blueprint.contracts, '$.contracts');
  const decisionsAndGaps = asRecord(blueprint.decisions_and_gaps);
  visit(decisionsAndGaps?.decisions, '$.decisions_and_gaps.decisions');
  visit(decisionsAndGaps?.gaps, '$.decisions_and_gaps.gaps');
  visit(asRecord(blueprint.discovery)?.facts, '$.discovery.facts');
  return out;
}

export function validateBlueprintProvenance(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out = validateProvenanceRecord(blueprint.provenance, '$.provenance');
  out.push(...validateOwnedCollections(blueprint));

  asRecords(asRecord(blueprint.discovery)?.conflicts).forEach((conflict, index) => {
    const sources = asRecords(conflict.sources);
    if (sources.length < 2) {
      out.push(issue('blueprint_authority_conflict_incomplete', `$.discovery.conflicts[${index}].sources`, '冲突必须保留至少两个来源。'));
    }
    if (conflict.resolution === 'last_write_wins') {
      out.push(issue('blueprint_authority_last_write_wins', `$.discovery.conflicts[${index}].resolution`, '权威冲突禁止 last-write-wins。'));
    }
    if (!nonEmptyString(conflict.owner)) {
      out.push(issue('blueprint_authority_conflict_owner_missing', `$.discovery.conflicts[${index}].owner`, '冲突必须登记 owner。'));
    }
  });

  asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps).forEach((gap, index) => {
    if (!['open_decision', 'blocker', 'not_applicable'].includes(String(gap.status))) {
      out.push(issue('blueprint_gap_disposition_invalid', `$.decisions_and_gaps.gaps[${index}].status`, '缺口必须使用合法 disposition。'));
    }
    for (const field of ['owner', 'needed_by', 'unlock_condition']) {
      if (!nonEmptyString(gap[field])) {
        out.push(issue('blueprint_gap_control_missing', `$.decisions_and_gaps.gaps[${index}].${field}`, `unknown/缺口必须登记 ${field}。`));
      }
    }
  });
  return out;
}
