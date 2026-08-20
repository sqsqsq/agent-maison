import { ResolvedComponentClosureInputs } from './component-closure-inputs';
import {
  ClosureProviderObservation,
  ComponentClosureCoverageRow,
  compareCodePoint,
  stableSortStrings,
} from './component-closure-model';
import { providerForEvidenceLevel, verifyClosureEvidenceIdentity } from './component-closure-evidence';

export interface ClosureEvidenceProviderResult {
  provider_id: ClosureProviderObservation['provider_id'];
  available: boolean;
  claimed_evidence_identities: string[];
}

export type ClosureEvidenceProvider = (
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
  requestedEvidenceIdentities: string[],
) => ClosureEvidenceProviderResult;

const PROVIDER_IDS: ClosureProviderObservation['provider_id'][] = [
  'automated-construction-evidence',
  'ui-device-visual-evidence',
  'human-acceptance-risk',
];

function exactProvider(
  providerId: ClosureProviderObservation['provider_id'],
  availableByDefault: boolean,
): ClosureEvidenceProvider {
  return (projectRoot, inputs, requested) => ({
    provider_id: providerId,
    available: availableByDefault && requested.length > 0,
    claimed_evidence_identities: availableByDefault
      ? requested.filter(identity => verifyClosureEvidenceIdentity(projectRoot, identity, inputs, providerId).status === 'current')
      : [],
  });
}

export const automatedConstructionEvidenceProvider = exactProvider('automated-construction-evidence', true);
export const uiDeviceVisualEvidenceProvider = exactProvider('ui-device-visual-evidence', true);
export const humanAcceptanceRiskEvidenceProvider = exactProvider('human-acceptance-risk', false);

function requestedByProvider(
  rows: ComponentClosureCoverageRow[],
  providerId: ClosureProviderObservation['provider_id'],
): string[] {
  return stableSortStrings(rows
    .filter(row => providerForEvidenceLevel(row.evidence_level) === providerId)
    .flatMap(row => row.evidence_identities));
}

export function deriveClosureProviderObservations(
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
  rows: ComponentClosureCoverageRow[],
  providers: ClosureEvidenceProvider[] = [
    automatedConstructionEvidenceProvider,
    uiDeviceVisualEvidenceProvider,
    humanAcceptanceRiskEvidenceProvider,
  ],
): ClosureProviderObservation[] {
  const results = providers.map(provider => {
    const probe = provider(projectRoot, inputs, []);
    const requested = requestedByProvider(rows, probe.provider_id);
    return provider(projectRoot, inputs, requested);
  });
  const grouped = new Map<ClosureProviderObservation['provider_id'], ClosureEvidenceProviderResult[]>();
  for (const providerId of PROVIDER_IDS) grouped.set(providerId, []);
  for (const result of results) grouped.get(result.provider_id)?.push(result);

  return PROVIDER_IDS.map(providerId => {
    const items = grouped.get(providerId) ?? [];
    const requested = requestedByProvider(rows, providerId);
    if (items.length !== 1) {
      return { provider_id: providerId, available: false, observations: [], status: items.length === 0 ? 'missing' as const : 'conflict' as const };
    }
    const item = items[0];
    const claims = stableSortStrings(item.claimed_evidence_identities);
    const requestedSet = new Set(requested);
    if ((!item.available && claims.length > 0) || claims.some(identity => !requestedSet.has(identity))) {
      return { provider_id: providerId, available: false, observations: [], status: 'conflict' as const };
    }
    const observations = claims
      .map(identity => verifyClosureEvidenceIdentity(projectRoot, identity, inputs, providerId))
      .sort((a, b) => compareCodePoint(a.evidence_identity, b.evidence_identity));
    const nonCurrent = observations.some(observation => observation.status !== 'current');
    return {
      provider_id: providerId,
      available: item.available,
      observations,
      status: !item.available ? 'missing' as const : nonCurrent ? 'stale' as const : 'current' as const,
    };
  }).sort((a, b) => compareCodePoint(a.provider_id, b.provider_id));
}
