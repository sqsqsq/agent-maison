/**
 * spec.visual_handoff → provider `script`（实现见同目录 `spec-visual-handoff-check.ts`）
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script',
  capability: 'spec.visual_handoff',
  exports: ['checkVisualHandoff'],
};

export { checkVisualHandoff } from '../spec-visual-handoff-check';
