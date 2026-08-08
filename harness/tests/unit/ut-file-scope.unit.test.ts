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

function makeCtx(
  projectRoot: string,
  feature: string,
  featureSpec: CheckContext['featureSpec'] = {} as CheckContext['featureSpec'],
): CheckContext {
  return {
    projectRoot,
    feature,
    frameworkRoot: projectRoot,
    phaseRule: {} as CheckContext['phaseRule'],
    featureSpec,
    resolvedProfile: { name: 'hmos-app', profileDir: '', subVariant: undefined, personalPrerequisites: {} },
  } as CheckContext;
}

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-file-scope-nongit-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

function writeContextPath(dir: string, feature: string, testPath: string): void {
  const explDir = path.join(dir, `doc/features/${feature}/ut`);
  fs.mkdirSync(explDir, { recursive: true });
  fs.writeFileSync(
    path.join(explDir, 'context-exploration.md'),
    ['---', 'source_code_paths:', `  - ${testPath}`, '---', ''].join('\n'),
    'utf-8',
  );
}

function testIgnoredFileScopedByContextPath(): void {
  withTmpRepo(dir => {
    fs.writeFileSync(path.join(dir, '.gitignore'), `${TEST_B}\n`, 'utf-8');
    const abs = path.join(dir, TEST_B);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "it('[AC-01] ignored but relevant', 0, () => { expect(true); });\n", 'utf-8');
    writeContextPath(dir, 'demo', TEST_B);
    const all = [
      { path: TEST_A, content: "it('[AC-01] same local id from old feature', 0, () => { expect(true); });" },
      { path: TEST_B, content: fs.readFileSync(abs, 'utf-8') },
    ];
    const part = partitionUtFiles(makeCtx(dir, 'demo'), all);
    assert(part.scoped.length === 1, `expected context-only scope, got ${part.scoped.length}`);
    assert(part.scoped[0].path === TEST_B, part.scoped.map(f => f.path).join(','));
    assert(part.scopeSources.some(s => s === `context:${TEST_B}`), part.scopeSources.join(','));
    assert(!part.scopeSources.some(s => s === `git:${TEST_B}`), 'ignored test must not rely on git');
  });
}

function testNonGitContextScopeAndFallbackDiagnostics(): void {
  withTmpDir(dir => {
    const all = [
      { path: TEST_A, content: "it('[AC-01] relevant', 0, () => { expect(true); });" },
      { path: TEST_B, content: "it('[AC-99] unrelated', 0, () => { expect(true); });" },
    ];
    writeContextPath(dir, 'demo', TEST_A);
    const contextual = partitionUtFiles(makeCtx(dir, 'demo'), all);
    assert(contextual.scoped.length === 1 && contextual.scoped[0].path === TEST_A, 'non-git context scope');
    assert(contextual.scopeSources.includes(`context:${TEST_A}`), contextual.scopeSources.join(','));
    assert(contextual.scopeDiagnostics.some(s => s.startsWith('git-unavailable:')), contextual.scopeDiagnostics.join(','));

    fs.rmSync(path.join(dir, 'doc'), { recursive: true, force: true });
    const fallback = partitionUtFiles(makeCtx(dir, 'demo'), all);
    assert(fallback.scoped.length === 2, 'non-git fallback must keep all files');
    assert(fallback.scopeSources.includes('fallback:all'), fallback.scopeSources.join(','));
    assert(fallback.scopeDiagnostics.some(s => s.startsWith('git-unavailable:')), fallback.scopeDiagnostics.join(','));
  });
}

function testSameLocalAcDoesNotExpandGitScope(): void {
  withTmpRepo(dir => {
    const currentAbs = path.join(dir, TEST_B);
    fs.mkdirSync(path.dirname(currentAbs), { recursive: true });
    fs.writeFileSync(currentAbs, "it('[AC-01] current feature', 0, () => { expect(true); });\n", 'utf-8');
    const all = [
      { path: TEST_A, content: "it('[AC-01] previous feature', 0, () => { expect(true); });" },
      { path: TEST_B, content: fs.readFileSync(currentAbs, 'utf-8') },
    ];
    const part = partitionUtFiles(makeCtx(dir, 'current-feature', {
      acceptance: { criteria: [{ id: 'AC-01' }], boundaries: [] },
    } as unknown as CheckContext['featureSpec']), all);
    assert(part.scoped.length === 1 && part.scoped[0].path === TEST_B, part.scoped.map(f => f.path).join(','));
    assert(part.scopeSources.includes(`git:${TEST_B}`), part.scopeSources.join(','));
    assert(!part.scoped.some(file => file.path === TEST_A), 'same local AC id must not assign old file to feature');
  });
}

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 'fallback all when no scope', fn: testFallbackAllWhenNoScope },
    { name: 'context-exploration declares scoped test', fn: testContextExplorationScoped },
    { name: 'git working tree scopes changed test', fn: testGitWorkingTreeScoped },
    { name: 'ignored test is scoped by explicit feature context', fn: testIgnoredFileScopedByContextPath },
    { name: 'non-git context scope and fallback are deterministic', fn: testNonGitContextScopeAndFallbackDiagnostics },
    { name: 'same local AC id does not expand current feature scope', fn: testSameLocalAcDoesNotExpandGitScope },
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
