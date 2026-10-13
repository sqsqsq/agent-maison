import { runSelectedScenarioGroup } from './reliability-scenarios.unit.test';

export const runSelectedCases = (selector?: string) => runSelectedScenarioGroup(selector, ['S5', 'S6', 'S7', 'S8', 'S9', 'S11', 'S12', 'S13']);

export const runAll = async () => (await runSelectedCases()).results;
