/**
 * spec.ui_spec → provider `script_ui_spec`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script_ui_spec',
  capability: 'spec.ui_spec',
  exports: ['checkUiSpecStructure', 'checkUiSpecFidelityGate'],
};

export { checkUiSpecStructure, checkUiSpecFidelityGate } from '../spec-ui-spec-check';
