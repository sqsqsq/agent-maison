/**
 * spec.ui_spec → provider `script_ui_spec`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script_ui_spec',
  capability: 'spec.ui_spec',
  exports: ['checkUiSpecStructure', 'checkUiSpecFidelityGate', 'checkCaptureCompleteness', 'checkCaptureStyleFields'],
};

export { checkUiSpecStructure, checkUiSpecFidelityGate } from '../spec-ui-spec-check';
export { checkCaptureCompleteness, checkCaptureStyleFields } from '../capture-completeness-check';
