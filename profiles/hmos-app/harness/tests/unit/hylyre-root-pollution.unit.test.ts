import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { legacyHypiumTmpAtProjectRoot } from '../../device-test-hypium-workdir';
import {
  ROOT_HYLYRE_POLLUTION_ANCHOR,
  beginHylyrePhasePollutionGuard,
  diffRootHylyrePollution,
  finishHylyrePhasePollutionGuard,
} from '../../hylyre-root-pollution';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function withTempRoot(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-pollution-'));
  try {
    fn(root);
  } finally {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'diffRootHylyrePollution: tmp_hypium_new when created after before',
    run: () => {
      const before = {
        tmp_hypium: { exists: false, mtimeMs: null, entryCount: null },
        reports: { exists: false, mtimeMs: null, entryCount: null },
      };
      const after = {
        tmp_hypium: { exists: true, mtimeMs: 1, entryCount: 0 },
        reports: { exists: false, mtimeMs: null, entryCount: null },
      };
      const d = diffRootHylyrePollution(before, after);
      if (!d.tmp_hypium_new || d.reports_new || d.reports_changed) {
        throw new Error(JSON.stringify(d));
      }
    },
  },
  {
    name: 'diffRootHylyrePollution: reports_changed on mtime',
    run: () => {
      const before = {
        tmp_hypium: { exists: false, mtimeMs: null, entryCount: null },
        reports: { exists: true, mtimeMs: 100, entryCount: 1 },
      };
      const after = {
        tmp_hypium: { exists: false, mtimeMs: null, entryCount: null },
        reports: { exists: true, mtimeMs: 200, entryCount: 1 },
      };
      const d = diffRootHylyrePollution(before, after);
      if (!d.reports_changed || d.reports_new) {
        throw new Error(JSON.stringify(d));
      }
    },
  },
  {
    name: 'begin guard removes pre-existing tmp_hypium then snapshots clean',
    run: () => {
      withTempRoot(root => {
        fs.mkdirSync(legacyHypiumTmpAtProjectRoot(root), { recursive: true });
        const before = beginHylyrePhasePollutionGuard(root);
        if (before.tmp_hypium.exists) {
          throw new Error('tmp_hypium should be gone before snapshot');
        }
        fs.mkdirSync(legacyHypiumTmpAtProjectRoot(root), { recursive: true });
        const meta = finishHylyrePhasePollutionGuard(root, before, { phase: 'ensure' });
        if (!meta?.tmp_hypium) {
          throw new Error('expected tmp_hypium_new pollution');
        }
      });
    },
  },
  {
    name: 'finishHylyrePhasePollutionGuard returns null when no change',
    run: () => {
      withTempRoot(root => {
        const before = beginHylyrePhasePollutionGuard(root);
        const meta = finishHylyrePhasePollutionGuard(root, before, { phase: 'run' });
        if (meta !== null) throw new Error(`unexpected meta ${JSON.stringify(meta)}`);
      });
    },
  },
  {
    name: 'ROOT_HYLYRE_POLLUTION_ANCHOR is stable',
    run: () => {
      if (ROOT_HYLYRE_POLLUTION_ANCHOR !== 'ROOT_HYLYRE_POLLUTION=1') {
        throw new Error('anchor mismatch');
      }
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
