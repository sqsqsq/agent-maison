import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SCRIPT = path.resolve(__dirname, '../../../scripts/migrate-feature-phase-paths.mjs');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'migrate-feature-phase-paths dry-run 列出 prd→spec 与 design→plan',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-phase-'));
      try {
        const feat = path.join(root, 'doc', 'features', 'demo');
        fs.mkdirSync(path.join(feat, 'prd'), { recursive: true });
        fs.mkdirSync(path.join(feat, 'design'), { recursive: true });
        fs.writeFileSync(path.join(feat, 'prd', 'PRD.md'), '# prd\n');
        fs.writeFileSync(path.join(feat, 'design', 'design.md'), '# design\n');
        const out = execFileSync(
          process.execPath,
          [SCRIPT, '--project-root', root],
          { encoding: 'utf8' },
        ).replace(/\\/g, '/');
        assert(out.includes('prd/PRD.md'), out);
        assert(out.includes('spec/spec.md'), out);
        assert(out.includes('design/design.md'), out);
        assert(out.includes('plan/plan.md'), out);
        assert(out.includes('Dry-run: 2 move(s)'), out);
        assert(fs.existsSync(path.join(feat, 'prd', 'PRD.md')), 'dry-run must not move');
        assert(!fs.existsSync(path.join(feat, 'spec', 'spec.md')), 'dry-run must not create');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
