import { listCaseGroups as listGroups } from './design-authority-repair.unit.test';
import { getCases as designRepairCases, runSelectedCases as selectDesignRepair } from './design-authority-repair.unit.test';
import { getCases as dailyCases, runSelectedCases as selectDaily, listCaseGroups as dailyGroups } from './design-authority-repair-daily.unit.test';
import { selectedUnitCases } from '../utils/unit-case-selection';

export const getCases = () => [...designRepairCases('runtime'), ...dailyCases('runtime')];

export const runSelectedCases = async (selector?: string) => {
  const original = await selectDesignRepair(selector, 'runtime'), daily = await selectDaily(selector, 'runtime');
  return selectedUnitCases([...original.results, ...daily.results], selector, [...original.executionTimings, ...daily.executionTimings]);
};

export const runAll = async () => (await runSelectedCases()).results;

export const listCaseGroups = () => [
  ...listGroups('runtime').map(group => ({ ...group, releaseOnly: true })),
  ...dailyGroups('runtime'),
];
