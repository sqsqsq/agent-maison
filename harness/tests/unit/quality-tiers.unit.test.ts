// Legacy suite id retained as a regression anchor; behavior is now global assurance.
import { assuranceSatisfies, validateMinimumAssurance } from '../../scripts/utils/skill-contract';
import * as path from 'path';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
interface TestCase { name: string; run: () => void }

const cases: TestCase[] = [
  {
    name: 'global assurance has a total order rather than contract-local tier names',
    run: () => {
      assert(assuranceSatisfies('full', 'degraded'), 'full must satisfy degraded');
      assert(!assuranceSatisfies('degraded', 'full'), 'degraded must not satisfy full');
      assert(!assuranceSatisfies('blocked', 'degraded'), 'blocked must never satisfy the minimum');
    },
  },
  {
    name: 'minimum assurance is sparse and rejects unknown phase or invalid enum',
    run: () => {
      let phaseError = '';
      try { validateMinimumAssurance(FRAMEWORK_ROOT, { 'device-testing': 'full' }, new Set(['testing'])); }
      catch (error) { phaseError = (error as Error).message; }
      assert(phaseError.includes('不在 active workflow'), phaseError);
      let valueError = '';
      try { validateMinimumAssurance(FRAMEWORK_ROOT, { coding: 'basic' as never }, new Set(['coding'])); }
      catch (error) { valueError = (error as Error).message; }
      assert(valueError.includes('仅支持 degraded|full'), valueError);
      validateMinimumAssurance(FRAMEWORK_ROOT, { coding: 'degraded' }, new Set(['coding']));
    },
  },
];

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => { try { testCase.run(); return { name: testCase.name, ok: true }; } catch (error) { return { name: testCase.name, ok: false, error: (error as Error).message }; } });
}