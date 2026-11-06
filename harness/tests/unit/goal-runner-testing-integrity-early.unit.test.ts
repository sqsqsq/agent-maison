import { listCaseGroups as listGroups } from './goal-runner-testing-integrity.unit.test';
import { runSelectedCases as runCases } from './goal-runner-testing-integrity.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'early');
export const runAll = async () => (await runSelectedCases()).results;

// Daily keeps normal delivery/recovery; historical and combined boundaries stay formal.
const dailyPrefixes = [
  "干净 run →",
  "E2E-1 pre-existing dirty",
  "E2E-2a testing 改产品源码",
  "E2E-3 PASS+新鲜 must_fix",
  "T1-5 mixed-case env",
  "t3 就绪门：READY",
  "A5 当前原生429",
  "R-6a identity",
  "R1-2b no-progress公开恢复"
];
export const listCaseGroups = () => listGroups('early').map(group => ({ ...group,
  releaseOnly: !group.caseNames.some(name => dailyPrefixes.some(prefix => name.startsWith(prefix))) }));
