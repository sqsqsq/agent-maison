/**
 * spec.visual_handoff → provider `script`（实现见同目录 `spec-visual-handoff-check.ts`）
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script',
  capability: 'spec.visual_handoff',
  exports: [
    'checkVisualHandoff',
    'checkFidelityGovernance',
    'checkFidelitySnapshotPromise',
    'checkStructuredRefElements',
    'checkAuthoritativeRefLockConflicts',
  ],
};

export { checkVisualHandoff } from '../spec-visual-handoff-check';
export { checkFidelityGovernance } from '../fidelity-governance-check';
export { checkFidelitySnapshotPromise } from '../fidelity-snapshot-check';
export { checkStructuredRefElements } from '../structured-ref-elements';
export { checkAuthoritativeRefLockConflicts } from '../authoritative-ref-images';
