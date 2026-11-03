import { listCaseGroups as listGroups } from './reliability-scenarios.unit.test';
import { runSelectedScenarioGroup } from './reliability-scenarios.unit.test';

export const runSelectedCases = (selector?: string) => runSelectedScenarioGroup(selector, ['S1', 'S2', 'S10', 'S3', 'S4'], true);

export const runAll = async () => (await runSelectedCases()).results;

export const listCaseGroups = () => listGroups(['S1', 'S2', 'S10', 'S3', 'S4'], true);
