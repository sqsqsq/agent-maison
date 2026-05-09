/**
 * coding.compile → provider `hvigor`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'hvigor',
  capability: 'coding.compile',
  exports: [
    'runHvigorBuild',
    'runHvigorAssembleApp',
    'analyzeProjectDependencyIssue',
    'buildCodingHvigorArgs',
    'resolveCodingHvigorSpawnPlan',
  ],
};

export {
  runHvigorBuild,
  runHvigorAssembleApp,
  analyzeProjectDependencyIssue,
  buildCodingHvigorArgs,
  resolveCodingHvigorSpawnPlan,
} from '../hvigor-runner';
