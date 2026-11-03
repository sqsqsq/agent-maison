import { listCaseGroups as listGroups } from './goal-runner-testing-integrity.unit.test';
import { runSelectedCases as runCases } from './goal-runner-testing-integrity.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'late');
export const runAll = async () => (await runSelectedCases()).results;

export const listCaseGroups = () => listGroups('late');
