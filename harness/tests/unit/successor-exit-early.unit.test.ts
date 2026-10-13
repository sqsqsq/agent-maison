import { runSelectedCases as runCases } from './successor-exit.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'early');
export const runAll = async () => (await runSelectedCases()).results;
