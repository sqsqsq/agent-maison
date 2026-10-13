import { runSelectedCases as runCases } from './execution-scope.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'prepare-late');
export const runAll = async () => (await runSelectedCases()).results;
