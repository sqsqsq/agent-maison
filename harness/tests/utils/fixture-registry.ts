import * as fs from 'fs';
import * as path from 'path';
import { fixtureDisplayName } from './fixture-runner';
const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
const ROOTS = ['harness/tests/fixtures', 'profiles/hmos-app/harness/tests/fixtures', 'profiles/generic/harness/tests/fixtures'];
export function collectAllFixtureDirs(): string[] {
  const logical = new Map<string, string>();
  const walk = (directory: string): void => {
    if (!fs.existsSync(directory)) return;
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    if (entries.some(entry => entry.name === 'INPUT' && entry.isDirectory()) && entries.some(entry => entry.name === 'CMD.json' && entry.isFile())) {
      const name = fixtureDisplayName(directory), previous = logical.get(name);
      if (previous && previous !== directory) throw new Error(`fixture 逻辑路径重复 "${name}"：\n  A: ${previous}\n  B: ${directory}\n仅保留其一。`);
      logical.set(name, directory); return;
    }
    for (const entry of entries) if (entry.isDirectory()) walk(path.join(directory, entry.name));
  };
  for (const root of ROOTS) walk(path.join(FRAMEWORK_ROOT, root));
  return [...logical.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, directory]) => directory);
}
