// ============================================================================
// hylyre-root-pollution-warn.unit.test.ts — testing reports 根污染 WARN
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  formatRootPollutionWarnDetails,
  loadTestingRootPollutionMeta,
} from '../../scripts/utils/hylyre-root-pollution-warn';
import type { RootPollutionMeta } from '../../../profiles/hmos-app/harness/hylyre-root-pollution';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function withTmpDir<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-root-pollution-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeMeta(base: string, file: string, pollution: RootPollutionMeta | null): void {
  fs.mkdirSync(base, { recursive: true });
  const body = pollution ? { root_pollution: pollution } : {};
  fs.writeFileSync(path.join(base, file), JSON.stringify(body), 'utf-8');
}

const samplePollution: RootPollutionMeta = {
  tmp_hypium: true,
  reports: true,
  reports_changed: false,
  detected_at: '2026-01-01T00:00:00.000Z',
  phase: 'run',
};

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'loadTestingRootPollutionMeta: 无 meta 文件 → null',
    run: () => {
      withTmpDir(base => {
        const hit = loadTestingRootPollutionMeta(base);
        assert(hit === null, `expected null, got ${JSON.stringify(hit)}`);
      });
    },
  },
  {
    name: 'loadTestingRootPollutionMeta: 优先 hylyre-ready.meta.json',
    run: () => {
      withTmpDir(base => {
        writeMeta(base, 'hylyre-ready.meta.json', samplePollution);
        writeMeta(base, 'device-test-run.meta.json', { ...samplePollution, phase: 'ensure' });
        const hit = loadTestingRootPollutionMeta(base);
        assert(hit !== null && hit.source === 'hylyre-ready.meta.json', `source=${hit?.source}`);
        assert(hit!.pollution.phase === 'run', `phase=${hit!.pollution.phase}`);
      });
    },
  },
  {
    name: 'loadTestingRootPollutionMeta: 回退 device-test-run.meta.json',
    run: () => {
      withTmpDir(base => {
        writeMeta(base, 'device-test-run.meta.json', samplePollution);
        const hit = loadTestingRootPollutionMeta(base);
        assert(hit !== null && hit.source === 'device-test-run.meta.json', `source=${hit?.source}`);
      });
    },
  },
  {
    name: 'loadTestingRootPollutionMeta: 有文件但无 root_pollution → null',
    run: () => {
      withTmpDir(base => {
        writeMeta(base, 'hylyre-ready.meta.json', null);
        const hit = loadTestingRootPollutionMeta(base);
        assert(hit === null, `expected null, got ${JSON.stringify(hit)}`);
      });
    },
  },
  {
    name: 'loadTestingRootPollutionMeta: 非法 JSON → 视为不存在 (null)',
    run: () => {
      withTmpDir(base => {
        fs.mkdirSync(base, { recursive: true });
        fs.writeFileSync(path.join(base, 'hylyre-ready.meta.json'), '{not json', 'utf-8');
        const hit = loadTestingRootPollutionMeta(base);
        assert(hit === null, `expected null, got ${JSON.stringify(hit)}`);
      });
    },
  },
  {
    name: 'formatRootPollutionWarnDetails: 列出命中的 flags 与来源路径',
    run: () => {
      const base = '/tmp/reports';
      const msg = formatRootPollutionWarnDetails(
        { source: 'hylyre-ready.meta.json', pollution: samplePollution },
        base,
      );
      assert(msg.includes('tmp_hypium'), `missing tmp_hypium: ${msg}`);
      assert(msg.includes('reports'), `missing reports: ${msg}`);
      assert(!msg.includes('reports_changed'), `should not list reports_changed: ${msg}`);
      assert(msg.includes('phase=run'), `missing phase: ${msg}`);
      assert(msg.includes(path.join(base, 'hylyre-ready.meta.json')), `missing source path: ${msg}`);
    },
  },
  {
    name: 'formatRootPollutionWarnDetails: 全 flag 关闭时回退 unknown',
    run: () => {
      const msg = formatRootPollutionWarnDetails(
        {
          source: 'device-test-run.meta.json',
          pollution: { tmp_hypium: false, reports: false, detected_at: '', phase: 'ensure' },
        },
        '/tmp/x',
      );
      assert(msg.includes('unknown'), `expected unknown, got ${msg}`);
      assert(msg.includes('phase=ensure'), `missing phase: ${msg}`);
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
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
