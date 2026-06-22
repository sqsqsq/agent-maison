/**
 * coding.deps_install → provider `ohpm`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'ohpm',
  capability: 'coding.deps_install',
  exports: ['installProjectDeps'],
};

export { installProjectDeps } from '../ohpm-runner';
