import { runSelectedScenarioGroup } from './reliability-scenarios.unit.test';

export const runSelectedCases = (selector?: string) => runSelectedScenarioGroup(selector, ['S15']);

export const runAll = async () => (await runSelectedCases()).results;
