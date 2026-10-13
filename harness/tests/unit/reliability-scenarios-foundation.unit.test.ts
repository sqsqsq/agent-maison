import { runSelectedScenarioGroup } from './reliability-scenarios.unit.test';

export const runSelectedCases = (selector?: string) => runSelectedScenarioGroup(selector, ['S1', 'S2', 'S10', 'S3', 'S4'], true);

export const runAll = async () => (await runSelectedCases()).results;
