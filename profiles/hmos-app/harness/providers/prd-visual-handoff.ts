/**
 * prd.visual_handoff → provider `script`（实现位于 harness/scripts/hmos-app/）
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script',
  capability: 'prd.visual_handoff',
  exports: ['checkVisualHandoff'],
};

export { checkVisualHandoff } from '../../../../harness/scripts/hmos-app/prd-visual-handoff-check';
