import { listCaseGroups as listGroups } from './execution-scope.unit.test';
import { runSelectedCases as runCases } from './execution-scope.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'runtime');
export const runAll = async () => (await runSelectedCases()).results;

export const listCaseGroups = () => listGroups('runtime');
