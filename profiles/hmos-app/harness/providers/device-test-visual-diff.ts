/**
 * device_test.visual_diff → provider `hylyre_visual_diff`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'hylyre_visual_diff',
  capability: 'device_test.visual_diff',
  exports: ['checkVisualDiff'],
};

export { checkVisualDiff } from '../visual-diff-check';
