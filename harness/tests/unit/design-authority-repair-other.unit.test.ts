import { getCases as designRepairCases, runSelectedCases as selectDesignRepair } from './design-authority-repair.unit.test';

export const getCases = () => designRepairCases('other');

export const runSelectedCases = (selector?: string) => selectDesignRepair(selector, 'other');

export const runAll = async () => (await runSelectedCases()).results;
