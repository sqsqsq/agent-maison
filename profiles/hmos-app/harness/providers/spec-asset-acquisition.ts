/**
 * spec.asset_acquisition → provider `script_asset_acquisition`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'script_asset_acquisition',
  capability: 'spec.asset_acquisition',
  exports: ['checkAssetAcquisition', 'checkAssetManifest', 'checkAssetCropValidation'],
};

export { checkAssetAcquisition } from '../asset-acquisition';
export { checkAssetManifest } from '../asset-manifest-check';
export { checkAssetCropValidation } from '../asset-crop-validation';
