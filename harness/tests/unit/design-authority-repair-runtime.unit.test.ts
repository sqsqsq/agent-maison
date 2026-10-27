import { getCases as designRepairCases, runSelectedCases as selectDesignRepair } from './design-authority-repair.unit.test';

export const getCases = () => designRepairCases('runtime');

export const runSelectedCases = (selector?: string) => selectDesignRepair(selector, 'runtime');

export const runAll = async () => (await runSelectedCases()).results;
