import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { featurePhaseReportsDir } from '../../config';
import { inferRepoLayout } from '../../repo-layout';
import { DEFAULT_LAYOUT } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const HARNESS_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(HARNESS_ROOT, '..');
const STAGING_ROOT = path.join(REPO_ROOT, 'dist', 'release-staging', 'framework');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmDirBestEffort(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (let i = 0; i < 3; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch {
      /* Windows file lock — retry */
    }
  }
}

function runHarnessDocs(cwd: string): { status: number | null; stderr: string } {
  const localTsNode = path.join(cwd, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const cmd = fs.existsSync(localTsNode) ? process.execPath : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const args = fs.existsSync(localTsNode)
    ? [localTsNode, 'harness-runner.ts', '--phase', 'docs', '--failures-only']
    : ['ts-node', 'harness-runner.ts', '--phase', 'docs', '--failures-only'];
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf-8', shell: !fs.existsSync(localTsNode), timeout: 120_000 });
  return { status: r.status, stderr: (r.stderr ?? '') + (r.stdout ?? '') };
}

function ensureReleaseStaging(): void {
  if (fs.existsSync(path.join(STAGING_ROOT, 'harness', 'harness-runner.ts'))) return;
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'pack-release.mjs'), '--stage-only'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    shell: false,
    timeout: 120_000,
  });
  assert(r.status === 0, `release:pack --stage-only failed: ${r.stderr ?? r.stdout}`);
  assert(fs.existsSync(path.join(STAGING_ROOT, 'harness', 'harness-runner.ts')), 'staging missing harness-runner');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'standalone: featurePhaseReportsDir uses harness/reports not framework/harness',
    run: () => {
      const dir = featurePhaseReportsDir(
        DEFAULT_LAYOUT.projectRoot,
        '_global',
        'docs',
        DEFAULT_LAYOUT.frameworkRoot,
      );
      const rel = path.relative(DEFAULT_LAYOUT.projectRoot, dir).replace(/\\/g, '/');
      assert(rel.startsWith('harness/reports/'), `expected harness/reports, got ${rel}`);
      assert(!rel.startsWith('framework/harness/'), `wrong prefix: ${rel}`);
      const wrong = path.join(DEFAULT_LAYOUT.projectRoot, 'framework', 'harness', 'reports');
      assert(!dir.startsWith(wrong), 'must not resolve under framework/harness/reports');
    },
  },
  {
    name: 'consumer: featurePhaseReportsDir uses framework/harness/reports',
    run: () => {
      const host = mkTmp('layout-consumer-reports-');
      fs.mkdirSync(path.join(host, 'framework', 'skills'), { recursive: true });
      const layout = inferRepoLayout(host);
      const dir = featurePhaseReportsDir(host, '_global', 'docs', layout.frameworkRoot);
      assert(
        dir === path.join(host, 'framework', 'harness', 'reports', '_global', 'docs'),
        `unexpected dir: ${dir}`,
      );
    },
  },
  {
    name: 'external frameworkRoot: tmp host without framework tree uses explicit frameworkRoot',
    run: () => {
      const host = mkTmp('layout-ext-fw-');
      fs.writeFileSync(path.join(host, 'framework.config.json'), '{}', 'utf8');
      const fwRoot = DEFAULT_LAYOUT.frameworkRoot;
      const dir = featurePhaseReportsDir(host, '_global', 'docs', fwRoot);
      assert(
        dir === path.join(fwRoot, 'harness', 'reports', '_global', 'docs'),
        `unexpected dir: ${dir}`,
      );
    },
  },
];

if (process.env.HARNESS_LAYOUT_SMOKE === '1') {
  cases.push(
    {
      name: 'e2e standalone: --phase docs writes harness/reports and not framework/harness/reports',
      run: () => {
        const wrongReports = path.join(REPO_ROOT, 'framework', 'harness', 'reports');
        rmDirBestEffort(wrongReports);
        const r = runHarnessDocs(HARNESS_ROOT);
        assert(r.status === 0, `standalone docs failed: ${r.stderr}`);
        const goodReports = path.join(HARNESS_ROOT, 'reports', '_global', 'docs', 'script-report.json');
        assert(fs.existsSync(goodReports), `missing ${goodReports}`);
        assert(!fs.existsSync(wrongReports), 'standalone must not recreate framework/harness/reports');
      },
    },
    {
      name: 'e2e consumer: release staging under tmp host/framework runs --phase docs',
      run: () => {
        ensureReleaseStaging();
        const host = mkTmp('harness-consumer-smoke-');
        try {
          const fwDest = path.join(host, 'framework');
          copyDir(STAGING_ROOT, fwDest);
          fs.writeFileSync(
            path.join(host, 'framework.config.json'),
            JSON.stringify(
              {
                schema_version: '1.0',
                project_profile: 'hmos-app',
                paths: { features_dir: 'doc/features', docs_committed: true },
              },
              null,
              2,
            ),
            'utf8',
          );
          const harnessCwd = path.join(fwDest, 'harness');
          const install = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], {
            cwd: harnessCwd,
            encoding: 'utf-8',
            shell: true,
            timeout: 180_000,
          });
          assert(install.status === 0, `npm install failed: ${install.stderr ?? install.stdout}`);
          assert(!fs.existsSync(path.join(host, 'node_modules')), 'host root must not get node_modules');
          const localTsNode = path.join(harnessCwd, 'node_modules', 'ts-node', 'dist', 'bin.js');
          assert(fs.existsSync(localTsNode), `missing local ts-node: ${localTsNode}`);
          const r = spawnSync(
            process.execPath,
            [localTsNode, 'harness-runner.ts', '--phase', 'docs', '--failures-only'],
            { cwd: harnessCwd, encoding: 'utf-8', shell: false, timeout: 120_000 },
          );
          assert(r.status === 0, `consumer docs failed: ${r.stderr ?? r.stdout}`);
          const report = path.join(fwDest, 'harness', 'reports', '_global', 'docs', 'script-report.json');
          assert(fs.existsSync(report), `missing consumer report ${report}`);
        } finally {
          rmDirBestEffort(host);
        }
      },
    },
  );
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return out;
}
