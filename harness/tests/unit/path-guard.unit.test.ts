import * as fs from 'fs';
import * as path from 'path';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const HARNESS_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(HARNESS_ROOT, '..');

const FORBIDDEN = [
  /path\.join\s*\(\s*projectRoot\s*,\s*['"]framework['"]/,
  /path\.join\s*\(\s*ctx\.projectRoot\s*,\s*['"]framework['"]/,
  /path\.resolve\s*\(\s*projectRoot\s*,\s*['"]framework['"]/,
  /path\.resolve\s*\(\s*ctx\.projectRoot\s*,\s*['"]framework['"]/,
];

const SCAN_ROOTS = [
  path.join(HARNESS_ROOT),
  path.join(REPO_ROOT, 'profiles'),
];

const EXCLUDE_FILE_NAMES = new Set([
  'repo-layout.ts',
  'config.ts',
]);

function shouldScan(file: string): boolean {
  const base = path.basename(file);
  if (EXCLUDE_FILE_NAMES.has(base)) return false;
  if (file.includes(`${path.sep}tests${path.sep}`)) return false;
  if (base.endsWith('.unit.test.ts')) return false;
  if (!file.endsWith('.ts')) return false;
  if (file.includes(`${path.sep}profiles${path.sep}`) && !file.includes(`${path.sep}harness${path.sep}`)) {
    return false;
  }
  return true;
}

function collectTsFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      collectTsFiles(abs, out);
    } else if (shouldScan(abs)) {
      out.push(abs);
    }
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'no hardcoded path.join(projectRoot, framework, ...) in harness/profiles harness',
    run: () => {
      const files: string[] = [];
      for (const root of SCAN_ROOTS) {
        collectTsFiles(root, files);
      }
      const violations: string[] = [];
      for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (line.trim().startsWith('//') || line.includes('frameworkLogicalRelPath')) continue;
          for (const re of FORBIDDEN) {
            if (re.test(line)) {
              violations.push(`${path.relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
            }
          }
        }
      }
      if (violations.length > 0) {
        throw new Error(`Forbidden framework path patterns:\n${violations.join('\n')}`);
      }
    },
  },
];

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
