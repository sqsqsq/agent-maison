/**
 * coding.visual_parity → provider `script_visual_parity`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script_visual_parity',
  capability: 'coding.visual_parity',
  exports: ['checkVisualParity'],
};

export { checkVisualParity } from '../coding-visual-parity-check';
