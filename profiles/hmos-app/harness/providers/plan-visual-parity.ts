/**
 * plan.visual_parity → provider `script_visual_parity_plan`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script_visual_parity_plan',
  capability: 'plan.visual_parity',
  exports: ['checkVisualParityCoverage'],
};

export { checkVisualParityCoverage } from '../plan-visual-parity-check';
