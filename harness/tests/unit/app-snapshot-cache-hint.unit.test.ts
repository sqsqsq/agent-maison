// ============================================================================
// app-snapshot-cache-hint.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isCacheLayoutMismatch,
  isSnapshotCacheEmpty,
  isSnapshotMetaJsonBasename,
  listSnapshotPages,
  resolveSnapshotPageJsonPath,
} from '../../scripts/utils/app-snapshot-cache-hint';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkCache(bundle: string, layout: { pages?: string[]; root?: string[] }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-cache-'));
  const bundleDir = path.join(root, bundle);
  fs.mkdirSync(bundleDir, { recursive: true });
  if (layout.pages?.length) {
    const pagesDir = path.join(bundleDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    for (const slug of layout.pages) {
      fs.writeFileSync(path.join(pagesDir, `${slug}.json`), '{"text":"page"}', 'utf-8');
    }
  }
  for (const slug of layout.root ?? []) {
    fs.writeFileSync(path.join(bundleDir, `${slug}.json`), '{"text":"root"}', 'utf-8');
  }
  return root;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'isSnapshotMetaJsonBasename excludes meta files',
    run: () => {
      if (!isSnapshotMetaJsonBasename('app-meta.json')) throw new Error('app-meta');
      if (!isSnapshotMetaJsonBasename('dump-ui-20260101.json')) throw new Error('dump-ui');
      if (isSnapshotMetaJsonBasename('home.json')) throw new Error('home should count');
    },
  },
  {
    name: 'listSnapshotPages: pages/ only',
    run: () => {
      const cache = mkCache('com.test', { pages: ['home', 'settings'] });
      const pages = listSnapshotPages(cache, 'com.test');
      if (pages.length !== 2 || !pages.includes('home')) throw new Error(JSON.stringify(pages));
    },
  },
  {
    name: 'listSnapshotPages: flat root fallback',
    run: () => {
      const cache = mkCache('com.test', { root: ['home', 'card_package', 'app-meta'] });
      const pages = listSnapshotPages(cache, 'com.test');
      if (pages.length !== 2 || pages.includes('app-meta')) throw new Error(JSON.stringify(pages));
      if (isSnapshotCacheEmpty(cache, 'com.test')) throw new Error('should not be empty');
    },
  },
  {
    name: 'isCacheLayoutMismatch when root only',
    run: () => {
      const cache = mkCache('com.test', { root: ['home'] });
      if (!isCacheLayoutMismatch(cache, 'com.test')) throw new Error('expected mismatch');
    },
  },
  {
    name: 'isCacheLayoutMismatch false when pages/ populated',
    run: () => {
      const cache = mkCache('com.test', { pages: ['home'], root: ['legacy'] });
      if (isCacheLayoutMismatch(cache, 'com.test')) throw new Error('pages/ wins');
    },
  },
  {
    name: 'resolveSnapshotPageJsonPath prefers pages/',
    run: () => {
      const cache = mkCache('com.test', { pages: ['home'], root: ['home'] });
      const p = resolveSnapshotPageJsonPath(cache, 'com.test', 'home');
      if (!p?.includes(`${path.sep}pages${path.sep}`)) throw new Error(p ?? 'null');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
