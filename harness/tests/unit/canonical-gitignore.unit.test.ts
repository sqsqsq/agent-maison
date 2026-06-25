// ============================================================================
// canonical-gitignore.unit.test.ts — init .gitignore ensure SSOT
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  CANONICAL_IGNORE_PATTERNS,
  collectGitignoreAdvisories,
  ensureCanonicalGitignore,
  listMissingCanonicalPatterns,
  parseGitignoreLines,
  patternIsCovered,
} from '../../scripts/utils/canonical-gitignore';
import { __testing } from '../../scripts/check-init';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function withTmpProject<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-gitignore-'));
  try {
    return fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  const run = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: (e as Error).message });
    }
  };

  run('CANONICAL_IGNORE_PATTERNS 含 goal-runs 且保留 reports/_adhoc', () => {
    assert(CANONICAL_IGNORE_PATTERNS.includes('doc/features/*/goal-runs/'), 'goal-runs');
    assert(CANONICAL_IGNORE_PATTERNS.includes('doc/features/*/*/reports/*'), 'reports');
    assert(CANONICAL_IGNORE_PATTERNS.includes('/doc/features/_adhoc/'), '_adhoc');
    assert(CANONICAL_IGNORE_PATTERNS.includes('doc/features/*/ux-reference/_fidelity-cache/'), 'fidelity-cache');
    assert(!CANONICAL_IGNORE_PATTERNS.includes('doc/features/'), 'no whole features tree');
    assert(!CANONICAL_IGNORE_PATTERNS.includes('doc/goal-runs/'), 'no doc/goal-runs');
  });

  run('CANONICAL_IGNORE_PATTERNS 含 Claude Code 个人 settings.local.json', () => {
    assert(
      CANONICAL_IGNORE_PATTERNS.includes('**/.claude/settings.local.json'),
      'settings.local.json',
    );
    assert(
      patternIsCovered('**/.claude/settings.local.json', ['.claude/settings.local.json']),
      'equiv .claude/settings.local.json',
    );
    assert(
      patternIsCovered('**/.claude/settings.local.json', ['/.claude/settings.local.json']),
      'equiv /.claude/settings.local.json',
    );
  });

  run('空目录 ensure：创建文件且 added 含全部 canonical', () => {
    withTmpProject(root => {
      const r = ensureCanonicalGitignore(root);
      assert(r.created === true, 'created');
      assert(r.added.length === CANONICAL_IGNORE_PATTERNS.length, `added.length=${r.added.length}`);
      const txt = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
      const missing = listMissingCanonicalPatterns(parseGitignoreLines(txt));
      assert(missing.length === 0, `still missing: ${missing.join(', ')}`);
    });
  });

  run('仅有 **/node_modules 时不重复追加 framework/harness/node_modules/', () => {
    withTmpProject(root => {
      fs.writeFileSync(path.join(root, '.gitignore'), '**/node_modules\n', 'utf-8');
      const r = ensureCanonicalGitignore(root);
      assert(!r.added.includes('framework/harness/node_modules/'), 'should not add duplicate');
      assert(patternIsCovered('framework/harness/node_modules/', parseGitignoreLines('**/node_modules')), 'equiv');
    });
  });

  run('错行 /harness/reports/* 时 ensure 追加 framework/harness/reports/*', () => {
    withTmpProject(root => {
      fs.writeFileSync(path.join(root, '.gitignore'), '/harness/reports/*\n', 'utf-8');
      const r = ensureCanonicalGitignore(root);
      assert(r.added.includes('framework/harness/reports/*'), 'should add canonical reports');
      const lines = parseGitignoreLines(fs.readFileSync(path.join(root, '.gitignore'), 'utf-8'));
      assert(patternIsCovered('framework/harness/reports/*', lines), 'reports covered');
      const adv = collectGitignoreAdvisories(fs.readFileSync(path.join(root, '.gitignore'), 'utf-8'));
      assert(adv.some(a => a.includes('/harness/reports')), 'advisory for wrong path');
    });
  });

  run('已全部覆盖时 added=[] 且内容 hash 不变', () => {
    withTmpProject(root => {
      ensureCanonicalGitignore(root);
      const p = path.join(root, '.gitignore');
      const before = fs.readFileSync(p, 'utf-8');
      const h0 = sha256(before);
      const r = ensureCanonicalGitignore(root);
      assert(r.added.length === 0, 'no additions');
      assert(sha256(fs.readFileSync(p, 'utf-8')) === h0, 'content unchanged');
    });
  });

  run('CHECK_INIT_SKIP_GITIGNORE_SYNC=1 不创建文件', () => {
    withTmpProject(root => {
      withEnv('CHECK_INIT_SKIP_GITIGNORE_SYNC', '1', () => {
        const r = ensureCanonicalGitignore(root);
        assert(r.skipped === true, 'skipped');
        assert(!fs.existsSync(path.join(root, '.gitignore')), 'no file');
      });
    });
  });

  run('CANONICAL_IGNORE_PATTERNS 含 harness 根 init staging json 且不误伤 package.json', () => {
    const stagingPatterns = [
      'framework/harness/decision.json',
      'framework/harness/context.json',
      'framework/harness/init-decision.json',
      'framework/harness/init-context.json',
    ];
    for (const p of stagingPatterns) {
      assert(CANONICAL_IGNORE_PATTERNS.includes(p), `missing ${p}`);
      assert(patternIsCovered(p, [p]), `covered ${p}`);
    }
    const lines = [...CANONICAL_IGNORE_PATTERNS];
    assert(!patternIsCovered('framework/harness/package.json', lines), 'package.json not ignored');
    assert(!patternIsCovered('framework/harness/tsconfig.json', lines), 'tsconfig.json not ignored');
  });

  run('ensure 后 inspect11 为 POPULATED', () => {
    withTmpProject(root => {
      ensureCanonicalGitignore(root);
      const ins = __testing.inspect11({
        projectRoot: root,
        cfg: {} as Parameters<typeof __testing.inspect11>[0]['cfg'],
        adapter: null,
        renderEnv: null,
      });
      assert(ins.status === 'POPULATED', `status=${ins.status} diagnosis=${ins.diagnosis}`);
    });
  });

  return results;
}
