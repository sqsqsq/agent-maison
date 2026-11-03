import { listCaseGroups as listGroups } from './reliability-scenarios.unit.test';
import { runSelectedScenarioGroup } from './reliability-scenarios.unit.test';

export const runSelectedCases = (selector?: string) => runSelectedScenarioGroup(selector, ['S15']);

export const runAll = async () => (await runSelectedCases()).results;

export const listCaseGroups = () => listGroups(['S15'], false);
