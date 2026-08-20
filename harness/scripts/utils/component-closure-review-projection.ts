import { ComponentClosureArtifact } from './component-closure-model';

function list(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '(none)';
}

function cell(value: unknown): string {
  return String(value ?? '(none)').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderComponentClosureMarkdown(closure: ComponentClosureArtifact, artifactSha256?: string): string {
  const lines: string[] = [
    '---',
    'derived_from:',
    `  component_id: ${closure.component_id}`,
    `  blueprint_id: ${closure.component_blueprint_ref.blueprint_id}`,
    `  blueprint_revision: ${closure.component_blueprint_ref.revision}`,
    `  blueprint_source_fingerprint: ${closure.component_blueprint_ref.source_fingerprint}`,
    `  blueprint_artifact_sha256: ${closure.component_blueprint_ref.artifact_sha256}`,
    `  input_fingerprint: ${closure.input_fingerprint}`,
    ...(artifactSha256 ? [`  closure_artifact_sha256: ${artifactSha256}`] : []),
    'projection: derived-only',
    '---',
    '',
    `# Component closure — ${closure.component_id}`,
    '',
    `Verdict: **${closure.verdict}**`,
    '',
    '## Current-scope sources and blueprint traceability',
    '',
    '| Kind | Item | Source | Revision | Raw SHA-256 | Blueprint mappings |',
    '|---|---|---|---|---|---|',
    ...closure.inputs.requirements.map(item => `| ${cell(item.kind)} | ${cell(item.item_id)} | ${cell(item.source_ref)} | ${cell(item.source_revision)} | ${cell(item.source_sha256)} | ${cell(list(item.blueprint_refs))} |`),
    '',
    '## Change Units, completion and carry-forward',
    '',
    '| CU | Revision | Artifact SHA-256 | Current / retired-by | Feature | Completion and reasons | Carry-forward and reasons |',
    '|---|---|---|---|---|---|---|',
    ...closure.inputs.change_units.map(item => `| ${cell(item.ref.change_unit_id)} | ${cell(item.ref.revision)} | ${cell(item.ref.artifact_sha256)} | ${item.current ? 'current' : `retired by ${cell(item.retired_by)}`} | ${cell(item.feature_id)} | ${cell(item.completion)} — ${cell(list(item.completion_reasons))} | ${cell(item.carry_forward)} — ${cell(list(item.carry_forward_reasons))} |`),
    '',
    '## Feature construction and evidence inputs',
    '',
    '| Feature | CU | contracts SHA-256 | acceptance SHA-256 | completion SHA-256 | evidence manifest hashes | projection issues | use-cases / DAG |',
    '|---|---|---|---|---|---|---|---|',
    ...closure.inputs.features.map(item => `| ${cell(item.feature_id)} | ${cell(item.change_unit_id)} | ${cell(item.contracts_sha256)} | ${cell(item.acceptance_sha256)} | ${cell(item.completion_sha256)} | ${cell(list(item.evidence_manifest_hashes))} | ${cell(list(item.projection_issue_ids))} | ${item.use_cases_required} / ${item.dag_required} |`),
    '',
    '## Complete coverage reconstruction',
    '',
    '| Obligation | Kind | Required | Source refs | Blueprint refs | Owner CU(s) | Feature(s) | Feature mapping refs | Evidence level | Exact evidence identities | Observation |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...closure.coverage_rows.map(row => `| ${cell(row.obligation_id)} | ${cell(row.kind)} | ${row.required} | ${cell(list(row.source_refs))} | ${cell(list(row.blueprint_refs))} | ${cell(list(row.owner_change_unit_ids))} | ${cell(list(row.feature_ids))} | ${cell(list(row.feature_mapping_refs))} | ${cell(row.evidence_level)} | ${cell(list(row.evidence_identities))} | ${cell(row.observation)} |`),
    '',
    '## Evidence Provider authority observations',
    '',
    ...closure.provider_observations.flatMap(provider => [
      `### ${provider.provider_id}`,
      '',
      `Status: ${provider.status}; available=${provider.available}`,
      '',
      '| Exact evidence identity | Authority ref | Source SHA-256 | Observation |',
      '|---|---|---|---|',
      ...(provider.observations.length > 0
        ? provider.observations.map(observation => `| ${cell(observation.evidence_identity)} | ${cell(observation.authority_ref)} | ${cell(observation.source_sha256)} | ${cell(observation.status)} |`)
        : ['| (none) | (none) | (none) | (none) |']),
      '',
    ]),
    '## Bounded degradations',
    '',
    ...(closure.degradations.length > 0
      ? closure.degradations.map(item => `- ${item.degradation_id}: ${item.impact}; owner=${item.owner}; retrigger=${item.retrigger_condition}`)
      : ['- None.']),
    '',
    '## Remaining gaps and repair routes',
    '',
    '| Gap | Class | Obligation refs | Source refs | Owner | Needed by | Reason | Unlock condition | Route |',
    '|---|---|---|---|---|---|---|---|---|',
    ...(closure.gaps.length > 0
      ? closure.gaps.map(gap => `| ${cell(gap.gap_id)} | ${cell(gap.classification)} | ${cell(list(gap.obligation_refs))} | ${cell(list(gap.source_refs))} | ${cell(gap.owner)} | ${cell(gap.needed_by)} | ${cell(gap.reason)} | ${cell(gap.unlock_condition)} | ${cell(gap.route)} |`)
      : ['| (none) | (none) | (none) | (none) | (none) | (none) | (none) | (none) | (none) |']),
    '',
    '## Stable knowledge writeback references',
    '',
    ...(closure.knowledge_writeback_refs.length > 0
      ? closure.knowledge_writeback_refs.map(ref => `- ${ref}`)
      : ['- None.']),
    '',
    '> Derived projection only. This Markdown is never an input to the closure verdict and does not claim Capability E2E completion.',
    '',
  ];
  return lines.join('\n');
}
