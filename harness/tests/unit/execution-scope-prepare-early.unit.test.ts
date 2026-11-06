import { listCaseGroups as listGroups } from './execution-scope.unit.test';
import { runSelectedCases as runCases } from './execution-scope.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'prepare-early');
export const runAll = async () => (await runSelectedCases()).results;

export const listCaseGroups = () => listGroups('prepare-early').map(group => ({ ...group,
  releaseOnly: group.caseNames.some(name => name.startsWith('38e5a7c2 host contracts first materialize')
    || /^real prepare CLI \/ bridge scope lifecycle: revision-(?:precut|cut)$/.test(name)),
}));
