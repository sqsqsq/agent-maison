/**
 * ut.run → provider `hvigor_hypium`（含 probeDevices 供 env 提示）
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'hvigor_hypium',
  capability: 'ut.run',
  exports: ['runHvigorTest', 'probeDevices'],
};

export { runHvigorTest, probeDevices } from '../hvigor-runner';
