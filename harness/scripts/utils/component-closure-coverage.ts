import { SpecLoader } from './spec-loader';
import { asRecord, asRecords, asStrings } from './component-blueprint-model';
import { blueprintRefAddress } from './change-unit-model';
import { ComponentClosureObligation } from './component-closure-obligations';
import { ResolvedComponentClosureInputs } from './component-closure-inputs';
import {
  ComponentClosureCoverageRow,
  ClosureObservation,
  compareCodePoint,
  stableSortStrings,
} from './component-closure-model';
import { createClosureEvidenceIdentity } from './component-closure-evidence';

interface MappingEvidence {
  mappingRef: string;
  evidenceRefs: string[];
}

interface UnitMappings {
  byPredicate: Map<string, MappingEvidence>;
  byProvide: Map<string, MappingEvidence>;
  byDesign: Map<string, MappingEvidence>;
}

function mappingEvidence(owner: string, record: Record<string, unknown>): MappingEvidence {
  return {
    mappingRef: owner,
    evidenceRefs: stableSortStrings([
      ...asStrings(record.test_refs),
      ...asStrings(record.verification_refs),
    ]),
  };
}

function loadMappings(projectRoot: string, inputs: ResolvedComponentClosureInputs): Map<string, UnitMappings> {
  const out = new Map<string, UnitMappings>();
  for (const unit of inputs.currentUnits) {
    const featureId = unit.input.feature_id;
    const contracts = new SpecLoader(projectRoot).loadFeatureSpec(featureId).contracts;
    const section = asRecord(contracts?.change_unit);
    const byPredicate = new Map<string, MappingEvidence>();
    for (const record of asRecords(section?.predicate_mappings)) {
      const id = String(record.predicate_id ?? '');
      if (id) byPredicate.set(id, mappingEvidence(`feature:${featureId}/predicate:${id}`, record));
    }
    const byProvide = new Map<string, MappingEvidence>();
    for (const record of asRecords(section?.provide_mappings)) {
      const id = String(record.provide_id ?? '');
      if (id) byProvide.set(id, mappingEvidence(`feature:${featureId}/provide:${id}`, record));
    }
    const byDesign = new Map<string, MappingEvidence>();
    for (const record of asRecords(section?.design_ref_mappings)) {
      const ref = asRecord(record.design_ref);
      if (!ref) continue;
      const address = blueprintRefAddress(record.design_ref as never);
      byDesign.set(address, mappingEvidence(`feature:${featureId}/design:${address}`, record));
    }
    out.set(unit.changeUnit.change_unit_id, { byPredicate, byProvide, byDesign });
  }
  return out;
}

function completionObservation(states: string[]): ClosureObservation {
  if (states.includes('INVALID')) return 'invalid';
  if (states.includes('STALE')) return 'stale';
  if (states.includes('ABSENT')) return 'uncovered';
  return 'covered';
}

function commonEvidence(evidenceByOwner: string[][]): string[] {
  if (evidenceByOwner.length === 0) return [];
  const [first, ...rest] = evidenceByOwner;
  return stableSortStrings(first.filter(item => rest.every(items => items.includes(item))));
}

function designRootAddress(address: string): string {
  const local = address.match(/^(view:runtime\/flow:[^/]+)\/(?:trigger|initial-load|state-owner|mutation|publication|subscription|consumer|recovery|lifecycle):/);
  return local ? local[1] : address;
}

export function deriveComponentClosureCoverage(
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
  obligations: ComponentClosureObligation[],
): ComponentClosureCoverageRow[] {
  const mappings = loadMappings(projectRoot, inputs);
  const unitById = new Map(inputs.currentUnits.map(unit => [unit.changeUnit.change_unit_id, unit]));
  const featureById = new Map(inputs.manifest.features.map(feature => [feature.feature_id, feature]));
  return obligations.map(item => {
    const ownerIds = stableSortStrings(item.owner_hint_change_unit_ids);
    const owners = ownerIds.map(id => unitById.get(id)).filter((unit): unit is NonNullable<typeof unit> => Boolean(unit));
    const featureIds = stableSortStrings(owners.map(unit => unit.input.feature_id));
    const mappingEntries: MappingEvidence[] = [];
    for (const owner of owners) {
      const ownerMappings = mappings.get(owner.changeUnit.change_unit_id);
      let found: MappingEvidence | undefined;
      if (item.mapping_kind === 'predicate') found = ownerMappings?.byPredicate.get(String(item.mapping_id));
      if (item.mapping_kind === 'provide') found = ownerMappings?.byProvide.get(String(item.mapping_id));
      if (item.mapping_kind === 'design') {
        const candidateAddresses = (item.blueprint_refs.length > 0 ? item.blueprint_refs : [String(item.mapping_id ?? '')])
          .map(designRootAddress);
        const entries = candidateAddresses.flatMap(address => {
          const entry = ownerMappings?.byDesign.get(address);
          return entry ? [entry] : [];
        });
        if (entries.length > 0) {
          found = {
            mappingRef: entries.map(entry => entry.mappingRef).sort(compareCodePoint).join('+'),
            evidenceRefs: stableSortStrings(entries.flatMap(entry => entry.evidenceRefs)),
          };
          if (item.mapping_id && designRootAddress(String(item.mapping_id)) !== String(item.mapping_id)) {
            found.mappingRef = `${found.mappingRef}/local:${String(item.mapping_id)}`;
          }
        }
      }
      if (item.mapping_kind === 'completion') {
        const feature = featureById.get(owner.input.feature_id);
        const allMappings = [
          ...[...(ownerMappings?.byPredicate.values() ?? [])],
          ...[...(ownerMappings?.byProvide.values() ?? [])],
          ...[...(ownerMappings?.byDesign.values() ?? [])],
        ];
        found = {
          mappingRef: item.kind === 'dependency'
            ? `feature:${owner.input.feature_id}/dependency-combination`
            : `feature:${owner.input.feature_id}/completion`,
          evidenceRefs: stableSortStrings([
            ...allMappings.flatMap(entry => entry.evidenceRefs),
            ...(feature?.completion_sha256 ? [`feature:${owner.input.feature_id}/completion:${feature.completion_sha256}`] : []),
          ]),
        };
      }
      if (found) mappingEntries.push(found);
    }

    let observation: ClosureObservation;
    let evidenceIdentities: string[];
    if (item.mapping_kind === 'fact') {
      evidenceIdentities = stableSortStrings(item.source_refs);
      observation = item.required && evidenceIdentities.length === 0 ? 'uncovered' : 'covered';
      if (item.kind === 'knowledge_gap' && item.required) observation = 'blocked';
    } else if (owners.length === 0) {
      evidenceIdentities = [];
      observation = 'uncovered';
    } else {
      observation = completionObservation(owners.map(owner => owner.input.completion));
      if (owners.some(owner => !owner.input.carry_forward)) observation = 'stale';
      if (owners.some(owner => (featureById.get(owner.input.feature_id)?.projection_issue_ids.length ?? 0) > 0)) observation = 'invalid';
      if (mappingEntries.length !== owners.length) observation = 'uncovered';
      const evidenceByOwner = mappingEntries.map(entry => item.evidence_refs.length > 0 ? item.evidence_refs : entry.evidenceRefs);
      const rawEvidenceRefs = owners.length > 1
        ? commonEvidence(evidenceByOwner)
        : stableSortStrings(evidenceByOwner.flat());
      evidenceIdentities = stableSortStrings(rawEvidenceRefs.flatMap(ref => {
        const identity = createClosureEvidenceIdentity(
          projectRoot,
          item.obligation_id,
          ref,
          featureIds,
          item.evidence_level,
        );
        return identity ? [identity] : [];
      }));
      if (evidenceIdentities.length === 0) observation = 'uncovered';
    }
    return {
      obligation_id: item.obligation_id,
      kind: item.kind,
      required: item.required,
      source_refs: item.source_refs,
      blueprint_refs: item.blueprint_refs,
      owner_change_unit_ids: ownerIds,
      feature_ids: featureIds,
      feature_mapping_refs: stableSortStrings(mappingEntries.map(entry => entry.mappingRef)),
      evidence_level: item.evidence_level,
      evidence_identities: evidenceIdentities,
      observation,
    };
  }).sort((a, b) => compareCodePoint(a.obligation_id, b.obligation_id));
}
