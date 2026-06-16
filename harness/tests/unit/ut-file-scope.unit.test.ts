// ============================================================================
// ut-file-scope.unit.test.ts — partitionUtFiles 双集合回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { partitionUtFiles } from '../../../profiles/hmos-app/harness/ut-file-scope';
import type { CheckContext } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const TEST_A = 'mod/src/ohosTest/ets/test/FeatureA.test.ets';
const TEST_B = 'mod/src/ohosTest/ets/test/FeatureB.test.ets';

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email test@test.com', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name test', { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# tmp\n', 'utf-8');
  execSync('git add README.md', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m init', { cwd: dir, stdio: 'ignore' });
}

function makeCtx(projectRoot: string, feature: string): CheckContext {
  return {
    projectRoot,
    feature,
    frameworkRoot: projectRoot,
    phaseRule: {} as CheckContext['phaseRule'],
    featureSpec: {} as CheckContext['featureSpec'],
    resolvedProfile: { name: 'hmos-app', profileDir: '', subVariant: undefined, personalPrerequisites: {} },
  } as CheckContext;
}

function withTmpRepo(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-file-scope-'));
  try {
    initGitRepo(dir);
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testFallbackAllWhenNoScope(): void {
  withTmpRepo(dir => {
    const all = [
      { path: TEST_A, content: 'export function tA() {}' },
      { path: TEST_B, content: 'export function tB() {}' },
    ];
    const part = partitionUtFiles(makeCtx(dir, 'demo'), all);
    assert(part.scoped.length === 2, 'scoped should equal all');
    assert(part.scopeSources.includes('fallback:all'), 'fallback source');
  });
}

function testContextExplorationScoped(): void {
  withTmpRepo(dir => {
    const explDir = path.join(dir, 'doc/features/demo/ut');
    fs.mkdirSync(explDir, { recursive: true });
    fs.writeFileSync(
      path.join(explDir, 'context-exploration.md'),
      ['---', 'source_code_paths:', `  - ${TEST_A}`, '---', ''].join('\n'),
      'utf-8',
    );
    const all = [
      { path: TEST_A, content: 'a' },
      { path: TEST_B, content: 'b' },
    ];
    const part = partitionUtFiles(makeCtx(dir, 'demo'), all);
    assert(part.scoped.length === 1, 'only declared test in scope');
    assert(part.scoped[0].path.replace(/\\/g, '/') === TEST_A, 'scoped path');
    assert(part.scopeSources.some(s => s.startsWith('context:')), 'context source');
  });
}

function testGitWorkingTreeScoped(): void {
  withTmpRepo(dir => {
    const rel = TEST_B;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'export function tB() {}\n', 'utf-8');
    const all = [
      { path: TEST_A, content: 'a' },
      { path: rel, content: 'b' },
    ];
    const part = partitionUtFiles(makeCtx(dir, 'demo'), all);
    assert(part.scoped.length === 1, 'git untracked test scoped');
    assert(part.scoped[0].path.replace(/\\/g, '/') === rel, 'git scoped path');
    assert(part.scopeSources.some(s => s.startsWith('git:')), 'git source');
  });
}

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 'fallback all when no scope', fn: testFallbackAllWhenNoScope },
    { name: 'context-exploration declares scoped test', fn: testContextExplorationScoped },
    { name: 'git working tree scopes changed test', fn: testGitWorkingTreeScoped },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
