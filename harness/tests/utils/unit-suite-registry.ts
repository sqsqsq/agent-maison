import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectAllFixtureDirs, fixtureDisplayName } from './fixture-registry';
import { REPO_ROOT } from './test-input-snapshot';
import type { Suite } from './unit-suite-processes';

function suitesIn(directory: string, suffix: string, kind: Suite['kind'], prefix = ''): Suite[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => ({ id: prefix + entry.name.slice(0, -suffix.length), modulePath: path.join(directory, entry.name), kind }));
}

export function discoverProfileUnitSuites(profilesRoot = path.join(REPO_ROOT, 'profiles')): Suite[] {
  if (!fs.existsSync(profilesRoot)) return [];
  return fs.readdirSync(profilesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => suitesIn(path.join(profilesRoot, entry.name, 'harness/tests/unit'), '.unit.test.ts', 'unit', `profile:${entry.name}:`));
}

export function collectSuites(): Suite[] {
  const suites = [
    ...suitesIn(path.join(REPO_ROOT, 'harness/tests/unit'), '.unit.test.ts', 'unit'),
    ...discoverProfileUnitSuites(),
    ...collectAllFixtureDirs().map(modulePath => ({ id: `fixture:${fixtureDisplayName(modulePath)}`, modulePath, kind: 'fixture' as const })),
    ...suitesIn(path.join(REPO_ROOT, 'scripts/tests'), '.unit.mjs', 'root', 'root:'),
  ];
  if (new Set(suites.map(suite => suite.id)).size !== suites.length) throw new Error('duplicate suite identity');
  return suites;
}

export function filterSuites(suites: Suite[], filter?: string): Suite[] {
  const matches = filter === undefined ? suites : suites.filter(suite => suite.id.includes(filter));
  if (!matches.length) throw new Error(filter === undefined ? 'no test suites discovered' : `no test suites match ${JSON.stringify(filter)}`);
  return matches;
}
