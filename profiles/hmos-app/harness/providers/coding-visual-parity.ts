/**
 * coding.visual_parity → provider `script_visual_parity`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script_visual_parity',
  capability: 'coding.visual_parity',
  exports: ['checkVisualParity', 'checkMediaReferenceIntegrity'],
};

export { checkVisualParity } from '../coding-visual-parity-check';

// v23 F4：悬空 $r 引用扫描——coding 侧确定性 FAIL（档位无关）
export { checkMediaReferenceIntegrity } from '../visual-parity-backstop';
