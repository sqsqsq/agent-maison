import { runSelectedCases as selectDesignRepair } from './design-authority-repair.unit.test';

export const runSelectedCases = (selector?: string) => selectDesignRepair(selector, 'continuation');

export const runAll = async () => (await runSelectedCases()).results;
