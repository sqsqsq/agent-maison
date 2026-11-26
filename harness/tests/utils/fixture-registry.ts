import * as fs from 'fs';
import * as path from 'path';
export function fixtureDisplayName(directory: string): string {
  const normalized = path.resolve(directory).replace(/\\/g, '/');
  const segment = '/tests/fixtures/';
  const index = normalized.lastIndexOf(segment);
  if (index < 0) throw new Error(`fixture is outside its declared test directory: ${directory}`);
  return normalized.slice(index + segment.length);
}
const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
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
  walk(path.join(FRAMEWORK_ROOT, 'harness/tests/fixtures'));
  const profiles = path.join(FRAMEWORK_ROOT, 'profiles');
  if (fs.existsSync(profiles)) {
    for (const entry of fs.readdirSync(profiles, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(profiles, entry.name, 'harness/tests/fixtures'));
    }
  }
  return [...logical.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, directory]) => directory);
}
