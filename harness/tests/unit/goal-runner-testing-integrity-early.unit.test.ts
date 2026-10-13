import { runSelectedCases as runCases } from './goal-runner-testing-integrity.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'early');
export const runAll = async () => (await runSelectedCases()).results;
