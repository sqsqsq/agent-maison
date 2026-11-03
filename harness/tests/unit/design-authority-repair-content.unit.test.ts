import { listCaseGroups as listGroups } from './design-authority-repair.unit.test';
import { getCases as designRepairCases, runSelectedCases as selectDesignRepair } from './design-authority-repair.unit.test';

export const getCases = () => designRepairCases('content');

export const runSelectedCases = (selector?: string) => selectDesignRepair(selector, 'content');

export const runAll = async () => (await runSelectedCases()).results;

export const listCaseGroups = () => listGroups('content');
