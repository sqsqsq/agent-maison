import { listCaseGroups as listGroups } from './reliability-scenarios.unit.test';
import { runSelectedScenarioGroup } from './reliability-scenarios.unit.test';

export const runSelectedCases = (selector?: string) => runSelectedScenarioGroup(selector, ['S14', 'S16']);

export const runAll = async () => (await runSelectedCases()).results;

export const listCaseGroups = () => listGroups(['S14', 'S16'], false);
