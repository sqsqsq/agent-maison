import type { UnitCaseResult } from '../run-unit';
import { setRuntimeTestCase } from './runtime-test-control';

const discovered = Symbol('discovered');

export function discoveryResult(name: string): UnitCaseResult {
  return Object.assign({ name, ok: true }, { [discovered]: true });
}

export function isDiscoveryResult(row: UnitCaseResult): boolean {
  return (row as UnitCaseResult & { [discovered]?: boolean })[discovered] === true;
}

type CaseBoundary = (event: 'start' | 'end', name: string) => void;
let context: { discover: boolean; boundary: CaseBoundary } | undefined;

export function configureUnitCases(discover: boolean, boundary: CaseBoundary): void {
  context = { discover, boundary };
}

export function beginUnitCase(name: string): (() => void) | undefined {
  if (!context) return () => undefined;
  context.boundary('start', name);
  if (context.discover) {
    context.boundary('end', name);
    return;
  }
  const end = setRuntimeTestCase(name);
  return () => {
    end();
    context!.boundary('end', name);
  };
}

interface Case {
  name: string;
  run(): unknown;
}

function failure(name: string, error: unknown): UnitCaseResult {
  return { name, ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) };
}

export function runUnitCases(cases: readonly Case[]): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    const end = beginUnitCase(test.name);
    if (!end) continue;
    try {
      const returned = test.run() as { then?: unknown } | null | undefined;
      if (typeof returned?.then === 'function') {
        void Promise.resolve(returned).catch(() => undefined);
        throw new Error('a synchronous test returned a Promise; run it with runUnitCasesAsync()');
      }
      results.push({ name: test.name, ok: true });
    } catch (error) {
      results.push(failure(test.name, error));
    } finally {
      end();
    }
  }
  return results;
}

export async function runUnitCasesAsync(cases: readonly Case[]): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    const end = beginUnitCase(test.name);
    if (!end) continue;
    try {
      await test.run();
      results.push({ name: test.name, ok: true });
    } catch (error) {
      results.push(failure(test.name, error));
    } finally {
      end();
    }
  }
  return results;
}
