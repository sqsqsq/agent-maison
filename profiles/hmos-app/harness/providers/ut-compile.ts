/**
 * ut.compile → provider `hvigor_ohostest`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'hvigor_ohostest',
  capability: 'ut.compile',
  exports: [
    'runHvigorBuild',
    'analyzeProjectDependencyIssue',
    'mergeHvigorLogForUtClassification',
    'looksLikeUtHvigorCommandMismatch',
    'buildUtHvigorArgs',
    'resolveUtHvigorSpawnPlan',
  ],
};

export {
  runHvigorBuild,
  analyzeProjectDependencyIssue,
  mergeHvigorLogForUtClassification,
  looksLikeUtHvigorCommandMismatch,
  buildUtHvigorArgs,
  resolveUtHvigorSpawnPlan,
} from '../hvigor-runner';
