import { resolveExecutionScope, executionScopeFingerprint } from '../../scripts/utils/execution-scope';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';

/** Existing stage delivery only; fixtures that author a 1.2 candidate must freeze that candidate themselves. */
export function freezeExistingGoalDelivery(projectRoot: string, feature: string): void {
  const phases = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
  const scope = resolveExecutionScope({ contract_fingerprints: [], request: { completion_target: 'feature', requested_results: ['既有开卡交付'], requested_phases: phases }, facts: [] }, {
    schema_version: '1.2', name: 'fixture-existing-delivery', auto_chain: phases,
    artifacts: phases.map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })),
  });
  freezeFeatureExecutionScope({ projectRoot, feature, scope, candidateFingerprint: executionScopeFingerprint(scope) });
}
