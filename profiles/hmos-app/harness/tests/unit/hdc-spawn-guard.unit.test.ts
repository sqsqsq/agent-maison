/**
 * Guardrail: profile hmos harness must not bypass hdc-runner.runHdcRaw for hdc spawns.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const PROFILE_HARNESS_ROOT = path.resolve(__dirname, '../..');

const BYPASS_PATTERNS: RegExp[] = [
  /spawnSync\s*\(\s*hdcExe\b/,
  /spawnSync\s*\(\s*resolveHdcExecutableSync\s*\(/,
  /spawnSync\s*\(\s*exe\b/,
  /spawnSync\s*\(\s*executable\b/,
  /spawnSync\s*\(\s*['"`]hdc['"`]/,
  /spawn\s*\(\s*hdcExe\b/,
  /spawn\s*\(\s*resolveHdcExecutableSync\s*\(/,
  /spawn\s*\(\s*exe\b/,
  /spawn\s*\(\s*executable\b/,
  /spawn\s*\(\s*['"`]hdc['"`]/,
  /execFileSync\s*\(\s*hdcExe\b/,
  /execFileSync\s*\(\s*exe\b/,
  /execFileSync\s*\(\s*resolveHdcExecutableSync\s*\(/,
  /execFileSync\s*\(\s*['"`]hdc['"`]/,
  /execFile\s*\(\s*hdcExe\b/,
  /execFile\s*\(\s*exe\b/,
  /execFile\s*\(\s*resolveHdcExecutableSync\s*\(/,
  /execSync\s*\(\s*[`'"]hdc\b/,
  /exec\s*\(\s*[`'"]hdc\b/,
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'tests') continue;
      out.push(...listTsFiles(abs));
      continue;
    }
    if (ent.isFile() && ent.name.endsWith('.ts')) out.push(abs);
  }
  return out;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'hdc spawn guard: no bypass of runHdcRaw in profile harness',
    run: () => {
      const violations: string[] = [];
      for (const file of listTsFiles(PROFILE_HARNESS_ROOT)) {
        const base = path.basename(file);
        if (base === 'hdc-runner.ts') continue;
        const rel = path.relative(PROFILE_HARNESS_ROOT, file).replace(/\\/g, '/');
        const content = fs.readFileSync(file, 'utf-8');
        for (const pat of BYPASS_PATTERNS) {
          if (pat.test(content)) {
            violations.push(`${rel}: ${pat.source}`);
          }
        }
      }
      if (violations.length > 0) {
        throw new Error(`hdc wrapper bypass detected:\n  ${violations.join('\n  ')}`);
      }
    },
  },
  {
    name: 'ut provider probeDevices re-exports hdc-runner (not duplicate impl)',
    run: () => {
      const utRun = fs.readFileSync(path.join(PROFILE_HARNESS_ROOT, 'providers/ut-run.ts'), 'utf-8');
      if (!/export\s*\{\s*probeDevices\s*\}\s*from\s*['"]\.\.\/hdc-runner['"]/.test(utRun)) {
        throw new Error('ut-run.ts must export probeDevices from hdc-runner');
      }
      const hvigor = fs.readFileSync(path.join(PROFILE_HARNESS_ROOT, 'hvigor-runner.ts'), 'utf-8');
      if (/export function probeDevices/.test(hvigor)) {
        throw new Error('hvigor-runner.ts must not define probeDevices — use hdc-runner re-export');
      }
    },
  },
  {
    name: 'hylyre-spawn calls ensureHdcServerWarm before python spawn',
    run: () => {
      const src = fs.readFileSync(path.join(PROFILE_HARNESS_ROOT, 'hylyre-spawn.ts'), 'utf-8');
      if (!/ensureHdcServerWarm\s*\(/.test(src)) {
        throw new Error('hylyre-spawn.ts must call ensureHdcServerWarm');
      }
      if (!/prewarmed=\$\{warm\.prewarmed\}/.test(src)) {
        throw new Error('hylyre-spawn.ts must log warm.prewarmed (not hardcoded true)');
      }
      if (!/warm_error=\$\{warm\.warm_error/.test(src)) {
        throw new Error('hylyre-spawn.ts must log warm.warm_error for failed prewarm diagnosis');
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
