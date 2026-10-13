import { runSelectedCases as runCases } from './successor-exit.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'late');
export const runAll = async () => (await runSelectedCases()).results;
