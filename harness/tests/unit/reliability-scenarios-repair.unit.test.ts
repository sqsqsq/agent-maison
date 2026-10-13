import { runSelectedScenarioGroup } from './reliability-scenarios.unit.test';

export const runSelectedCases = (selector?: string) => runSelectedScenarioGroup(selector, ['S14', 'S16']);

export const runAll = async () => (await runSelectedCases()).results;
