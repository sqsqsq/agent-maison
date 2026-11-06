import { listCaseGroups as listGroups } from './goal-runner-testing-integrity.unit.test';
import { runSelectedCases as runCases } from './goal-runner-testing-integrity.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'late');
export const runAll = async () => (await runSelectedCases()).results;

// Daily keeps normal delivery/recovery; historical and combined boundaries stay formal.
const dailyPrefixes = [
  "31063a73 U3 编译失败出口",
  "31063a73 U3 测试断言失败出口 对照",
  "A4 pure framework gap",
  "c6a3d918 verifier format recovery corrected:",
  "c6a3d918 verifier format recovery still-bad:",
  "repair1 R3 UT UNVERIFIED corrected",
  "P3 t5 A12/A14 foreground",
  "P3 t5 A13 foreground：真实孤儿锁",
  "a7b615ff runtime canary completed",
  "repair1 R1 disclosed visual MAJOR"
];
export const listCaseGroups = () => listGroups('late').map(group => ({ ...group,
  releaseOnly: !group.caseNames.some(name => dailyPrefixes.some(prefix => name.startsWith(prefix))) }));
