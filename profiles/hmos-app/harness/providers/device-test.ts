/**
 * device_test.run → provider `hdc`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'hdc',
  capability: 'device_test.run',
  exports: [
    'runOnDeviceUt',
    'probeDevices',
    'loadOhosTestMetadata',
    'findOhosTestSignedHap',
    'parseHypiumStdout',
  ],
};

export {
  runOnDeviceUt,
  probeDevices,
  loadOhosTestMetadata,
  findOhosTestSignedHap,
  parseHypiumStdout,
} from '../hdc-runner';
