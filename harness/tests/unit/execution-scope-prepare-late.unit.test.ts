import { listCaseGroups as listGroups } from './execution-scope.unit.test';
import { runSelectedCases as runCases } from './execution-scope.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'prepare-late');
export const runAll = async () => (await runSelectedCases()).results;

// Daily keeps normal delivery/recovery; historical and combined boundaries stay formal.
const dailyPrefixes = [
  "scope revision direct:",
  "real prepare CLI / bridge scope lifecycle: request-ut",
  "real prepare CLI / bridge scope lifecycle: request-spec (",
  "real prepare CLI / bridge scope lifecycle: request-plan (",
  "real prepare CLI / bridge scope lifecycle: request-coding"
];
export const listCaseGroups = () => listGroups('prepare-late').map(group => ({ ...group,
  releaseOnly: !group.caseNames.some(name => dailyPrefixes.some(prefix => name.startsWith(prefix))) }));
