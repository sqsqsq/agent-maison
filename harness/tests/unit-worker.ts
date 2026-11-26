import './utils/transpile-only-env';
import { cleanupStrict } from './utils/test-trust-bootstrap';
import type { UnitCaseResult } from './run-unit';
import { configureUnitCases, isDiscoveryResult } from './utils/unit-cases';
import { mergeRuntimeTestFailures } from './utils/runtime-test-control';

const [kind, modulePath, phase] = process.argv.slice(2);
const discover = phase === 'discover';

async function main(): Promise<void> {
  const names: string[] = [];
  let results: UnitCaseResult[] = [];
  const boundary = (type: 'start' | 'end', name: string): void => {
    if (discover) {
      if (type === 'start') names.push(name);
    } else {
      process.send?.({ type, name });
    }
  };

  try {
    if (kind === 'root') {
      const { runRootTests } = require('./root-test.cjs');
      const root = await runRootTests(modulePath, discover, boundary);
      names.push(...root.names);
      results = root.results;
    } else if (kind === 'fixture') {
      const { fixtureDisplayName } = await import('./utils/fixture-registry');
      const { runFixture } = await import('./utils/fixture-runner');
      const name = fixtureDisplayName(modulePath);
      boundary('start', name);
      if (!discover) {
        const fixture = await runFixture(modulePath);
        results = [{ name: fixture.name, ok: fixture.ok, ...(fixture.ok ? {} : { error: fixture.failures.join('\n') }) }];
      }
      boundary('end', name);
    } else {
      configureUnitCases(discover, boundary);
      const suite = require(modulePath) as { runAll(): UnitCaseResult[] | Promise<UnitCaseResult[]> };
      if (typeof suite.runAll !== 'function') throw new Error('suite does not export runAll()');
      results = await suite.runAll();
      if (discover && results.some(row => !isDiscoveryResult(row))) {
        const unregistered = results.filter(row => !isDiscoveryResult(row)).map(row => row.name);
        throw new Error(`discovery executed cases without a registered boundary: ${unregistered.join(', ')}`);
      }
      if (discover) results = [];
      if (!discover) mergeRuntimeTestFailures(results);
    }
    const cleaned = cleanupStrict();
    if (!cleaned.ok) throw new Error(`test trust cleanup failed: ${cleaned.leftoverPath}`);
    process.send?.({ type: 'result', names, results }, error => {
      if (error) { console.error(error); process.exitCode = 1; }
      if (process.connected) process.disconnect();
    });
  } catch (error) {
    process.exitCode = 1;
    console.error(error);
    if (process.connected) process.disconnect();
  }
}
void main();
