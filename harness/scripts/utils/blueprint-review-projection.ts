import { BlueprintRecord, asRecord, asRecords, asStrings, nonEmptyString } from './component-blueprint-model';

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function refs(value: unknown): string {
  const values = asStrings(value);
  return values.length > 0 ? values.join(', ') : '—';
}

export function renderBlueprintReviewMarkdown(blueprint: BlueprintRecord, artifactSha256: string): string {
  if (!nonEmptyString(blueprint.component_id) || !nonEmptyString(blueprint.blueprint_id)) {
    throw new Error('生成评审投影前必须有 component_id 与 blueprint_id。');
  }
  const derivedFrom = {
    artifact: blueprint.artifact,
    component_id: blueprint.component_id,
    blueprint_id: blueprint.blueprint_id,
    revision: blueprint.revision,
    source_fingerprint: blueprint.source_fingerprint,
    artifact_sha256: artifactSha256,
  };
  const review = asRecord(blueprint.review_summary);
  const decisions = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions);
  const gaps = asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps);
  const conventions = asRecords(asRecord(blueprint.discovery)?.facts)
    .map(fact => asRecord(fact.provenance))
    .filter(provenance => provenance?.source_kind === 'convention' && nonEmptyString(provenance.source_ref))
    .map(provenance => String(provenance!.source_ref))
    .sort();
  const lines: string[] = [
    '---',
    'derived_from:',
    ...Object.entries(derivedFrom).map(([key, value]) => `  ${key}: ${String(value)}`),
    'projection: component-blueprint-review@1',
    '---',
    '',
    `# ${String(review?.title ?? blueprint.component_id)}`,
    '',
    String(review?.summary ?? ''),
    '',
  ];
  if (conventions.length > 0) {
    lines.push(
      '## Adopted conventions',
      '',
      ...conventions.map(sourceRef => `- ${sourceRef.slice(sourceRef.lastIndexOf('#') + 1)} — ${sourceRef}`),
      '',
    );
  }
  lines.push('## Design views', '');
  for (const view of asRecords(blueprint.design_views)) {
    lines.push(
      `### ${String(view.view_id)}`,
      '',
      `- Applicability: ${display(view.applicability)}`,
      // M7：evolution_impact 是与 applicability 正交的独立维度，必须出现在 publication 投影里，
      // 否则宿主装配的 Story Document 无从区分"本次改了"与"本次核实未变"。
      `- Evolution impact: ${display(view.evolution_impact)}`,
      `- Unchanged evidence: ${refs(asRecord(view.unchanged_evidence)?.evidence_refs)}`,
      `- Purpose: ${display(view.purpose)}`,
      `- Stakeholders: ${refs(view.stakeholders)}`,
      `- Current: ${display(view.current_state)}`,
      `- Target: ${display(view.target_state)}`,
      `- Delta: ${display(view.delta)}`,
      `- Decisions/gaps: ${refs(view.decisions_and_gaps)}`,
      `- Verification: ${refs(view.verification_refs)}`,
      '',
      'Nodes:',
      '',
    );
    const nodes = asRecords(view.nodes);
    if (nodes.length === 0) lines.push('- None (evidence-backed not applicable view).');
    for (const node of nodes) {
      lines.push(`- ${String(node.node_id)} — owner=${display(node.owner)}; current=${display(node.current_state)}; target=${display(node.target_state)}; basis=${refs(node.design_basis_refs)}; verification=${refs(node.verification_refs)}`);
    }
    lines.push('');
  }

  lines.push('## Runtime data flows', '');
  const runtime = asRecords(blueprint.design_views).find(view => view.view_id === 'runtime');
  for (const flow of asRecords(runtime?.runtime_data_flows)) {
    const sourceOfTruth = asRecord(flow.source_of_truth);
    const initialLoad = asRecord(flow.initial_load);
    const stateOwner = asRecord(flow.state_owner);
    const recovery = asRecord(flow.failure_recovery);
    lines.push(
      `### ${String(flow.flow_id)}`,
      '',
      `- Data domains: ${refs(flow.data_domain_refs)}`,
      `- External contracts: ${refs(flow.external_contract_refs)}`,
      `- Logical contracts: ${refs(flow.logical_contract_refs)}`,
      `- Development owner: ${display(flow.development_owner_ref)}`,
      `- Source of truth: authority=${display(sourceOfTruth?.authority)}; persistence=${display(sourceOfTruth?.persistence)}; projections=${refs(sourceOfTruth?.projections_and_caches)}; reconciliation=${display(sourceOfTruth?.reconciliation)}`,
      `- Initial load: id=${display(initialLoad?.initial_load_id)}; strategy=${display(initialLoad?.strategy)}; owner=${display(initialLoad?.owner)}; freshness=${display(initialLoad?.freshness)}`,
      `- State owner: ${display(stateOwner?.ref)}; states=${refs(stateOwner?.states)}`,
      `- Recovery: id=${display(recovery?.recovery_id)}; persistence=${display(recovery?.persistence_failure)}; subscription=${display(recovery?.subscription_failure)}; process=${display(recovery?.process_recreation)}`,
      `- Evidence: ${refs(flow.evidence_refs)}`,
      `- Verification: ${refs(flow.verification_refs)}`,
      '',
      'Triggers:',
      '',
      ...asRecords(flow.triggers).map(item => `- ${display(item.kind)} — timing=${display(item.timing)}; idempotency=${display(item.idempotency)}`),
      '',
      'Mutations and publications:',
      '',
      ...asRecords(flow.mutations).map(item => `- mutation ${display(item.mutation_id)} — persistence=${display(item.persistence_ref)}; publication=${display(item.publication_ref)}; recovery=${display(item.recovery_ref)}`),
      ...asRecords(flow.publications).map(item => `- publication ${display(item.publication_id)} — snapshot=${display(item.snapshot)}`),
      '',
      'Subscriptions and consumers:',
      '',
      ...asRecords(flow.subscriptions).map(item => `- subscription ${display(item.subscription_id)} — consumer=${display(item.consumer_ref)}; attach=${display(item.attach)}; detach=${display(item.detach)}; cleanup=${display(item.cleanup)}; replay=${display(item.replay_or_snapshot)}; ordering=${display(item.ordering)}`),
      ...asRecords(flow.consumers).map(item => `- consumer ${display(item.consumer_id)} — initial_load=${display(item.initial_load_ref)}; update=${display(item.update_ref)}`),
      '',
    );
  }

  lines.push('## Authority contracts', '');
  for (const contract of asRecords(blueprint.contracts)) {
    const operation = asRecord(contract.operation);
    const request = asRecord(contract.request_dto);
    const response = asRecord(contract.response_dto);
    lines.push(
      `### ${String(contract.contract_id)}`,
      '',
      `- Owner: ${display(contract.owner)}; needed by: ${display(contract.needed_by)}`,
      `- Operation: ${display(operation?.operation_id)} ${display(operation?.version)} (${display(operation?.direction)}); source=${display(operation?.source_ref)}`,
      `- Request DTO: ${display(request?.dto_id)}; source=${display(request?.source_ref)}`,
      ...asRecords(request?.fields).map(field => `  - ${display(field.field_id)}: ${display(field.type)}; required=${display(field.required)}; nullable=${display(field.nullable)}; semantics=${display(field.semantics)}; source=${display(field.source_ref)}`),
      `- Response DTO: ${display(response?.dto_id)}; source=${display(response?.source_ref)}`,
      ...asRecords(response?.fields).map(field => `  - ${display(field.field_id)}: ${display(field.type)}; required=${display(field.required)}; nullable=${display(field.nullable)}; semantics=${display(field.semantics)}; source=${display(field.source_ref)}`),
      '- Mappings:',
      ...asRecords(contract.mappings).map(mapping => `  - ${display(mapping.mapping_id)} (${display(mapping.kind)}): ${refs(mapping.source_fields)} → ${display(mapping.target_field)}; rule=${display(mapping.rule)}; source=${display(mapping.source_ref)}`),
      `- Errors: ${display(asRecord(contract.errors)?.items)}`,
      `- Idempotency: ${display(asRecord(contract.idempotency)?.rule)}`,
      `- NFR: ${display(asRecord(contract.nfr)?.requirements)}`,
      '',
    );
  }

  lines.push('## Cross-view relations', '');
  for (const relation of asRecords(blueprint.relations)) {
    lines.push(`- ${display(relation.relation_id)}: ${display(relation.from)} → ${display(relation.to)} (${display(relation.relation_type)}); owner=${display(relation.owner)}; verification=${refs(relation.verification_refs)}`);
  }

  const questioning = asRecord(review?.questioning);
  lines.push('', '## Independent questioning', '', `- Provider: ${display(questioning?.provider_id)}; status=${display(questioning?.status)}; isolated=${display(questioning?.isolated_context)}; writes_ssot=${display(questioning?.writes_ssot)}`);
  for (const item of asRecords(questioning?.items)) {
    lines.push(`- ${display(item.scope_ref)} [${display(item.disposition)}]: ${display(item.question)} — ${display(item.answer)}; owner=${display(item.owner)}; evidence=${refs(item.evidence_refs)}; verification=${refs(item.verification_refs)}`);
  }

  const admission = asRecord(review?.admission);
  const currentSlice = asRecord(admission?.current_slice);
  lines.push(
    '',
    '## Admission',
    '',
    `- Status: ${display(admission?.status)}`,
    `- Root questions complete: ${display(admission?.root_questions_complete)}`,
    `- Current slice: ${display(currentSlice?.slice_id)}; contracts_ready=${display(currentSlice?.contracts_ready)}; design_refs_ready=${display(currentSlice?.design_refs_ready)}; controlled_fakes=${display(currentSlice?.controlled_fakes)}`,
    `- Blockers: ${refs(admission?.blocker_refs)}`,
    '',
    '## Decisions and gaps',
    '',
    ...decisions.map(decision => `- decision ${String(decision.decision_id)}: ${String(decision.status)}; owner=${display(decision.owner)}; verification=${refs(decision.verification_refs)}`
      + (decision.kind === 'component_asset_selection' ? `; target_ref=${display(decision.target_ref)}; asset_resolution=${display(decision.asset_resolution)}; component_ref=${display(decision.component_ref)}; rationale=${display(decision.rationale)}` : '')),
    ...gaps.map(gap => `- gap ${String(gap.gap_id)}: ${String(gap.status)}; owner=${String(gap.owner)}; needed_by=${display(gap.needed_by)}; unlock=${display(gap.unlock_condition)}`),
    '',
    '> Derived projection only. The canonical YAML remains the machine SSOT.',
    '',
  );
  return lines.join('\n');
}
