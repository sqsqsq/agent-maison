import { listCaseGroups as listGroups } from './execution-scope.unit.test';
import { runSelectedCases as runCases } from './execution-scope.unit.test';

export const runSelectedCases = (selector?: string) => runCases(selector, 'runtime');
export const runAll = async () => (await runSelectedCases()).results;

// Direct scope rules remain daily; process matrices and historical multi-owner chains are formal.
const formalCases = /^(?:real prepare CLI|P7 Feature evidence|P7 two real CU|1804|b2d7|P1-T8|4f L3|c6a3d918 UT|repair1 R2)|(?:interleaved|half-written|write lock|foreign type|tampered|structurally broken|live pid|legacy|stale write lock|three real runless)/;
export const listCaseGroups = () => listGroups('runtime').map(group => ({ ...group,
  releaseOnly: group.caseNames.some(name => formalCases.test(name)) }));
