import { runSelectedCases as selectDesignRepair } from './design-authority-repair.unit.test';

export const runSelectedCases = (selector?: string) => selectDesignRepair(selector, 'runtime');

export const runAll = async () => (await runSelectedCases()).results;
