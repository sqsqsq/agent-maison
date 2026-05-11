/**
 * prd.visual_handoff → provider `script`（实现见同目录 `prd-visual-handoff-check.ts`）
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script',
  capability: 'prd.visual_handoff',
  exports: ['checkVisualHandoff'],
};

export { checkVisualHandoff } from '../prd-visual-handoff-check';
