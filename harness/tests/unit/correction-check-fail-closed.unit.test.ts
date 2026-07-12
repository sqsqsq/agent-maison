// ============================================================================
// correction-check-fail-closed.unit.test.ts — codex review 采纳：
// touched_layers 对账在 git diff 不可执行 / base_commit 不可达时必须 fail-closed
// ============================================================================
// 回归覆盖：runCorrectionCheck 真实端到端（真 git 仓库 + spawnSync），
// 锁死"对账不可判 → 不放行"这条红线，防止之前 diff.executed 分支缺失时的
// 静默放行回归。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runCorrectionCheck } from '../../scripts/utils/correction-commands';
import { correctionStatePath, readCorrectionState } from '../../scripts/utils/correction-state';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, shell: false });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr?.toString() ?? r.error?.message ?? 'unknown'}`);
  }
}

function headSha(cwd: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8', shell: false });
  return r.stdout.trim();
}

/** 最小可用工程：git 仓库 + framework.config.json + workflows/（repo-layout 探测需要）。 */
function mkGitProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'correction-failclosed-'));
  fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0',
    project_name: 'correction-failclosed-fixture',
    project_profile: { name: 'generic' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features' },
  }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dir, '02-Feature-placeholder.txt'), 'baseline\n', 'utf-8');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'baseline']);
  return dir;
}

function writeCorrectionState(dir: string, baseCommit: string): void {
  // 夹具是 standalone 布局(根下 workflows/)——走 SSOT 路径 helper,不手拼
  // framework/ 前缀(旧写法恰好依赖了 statefilePath 的布局无感 bug,即 2026-07-08
  // 杂散 framework/harness/state/ 事故的形态)。
  const abs = correctionStatePath(dir);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({
    schema_version: '1.0',
    feature: 'demo-feat',
    root_layer: 'coding',
    touched_layers: ['coding'],
    revalidate: [{ phase: 'coding', status: 'pending' }],
    status: 'pending',
    created_at: new Date(Date.now() - 60_000).toISOString(),
    session_id: null,
    base_commit: baseCommit,
    request_fingerprint: 'abc123',
    enforcement_tier: 'soft_rule_only',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }, null, 2) + '\n', 'utf-8');
}

function writePassingScriptReport(dir: string): void {
  const reportsDir = path.join(dir, 'doc', 'features', 'demo-feat', 'coding', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'script-report.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { verdict: 'PASS' },
  }, null, 2), 'utf-8');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'runCorrectionCheck: base_commit 不可达（baseIsFallback）→ fail-closed 不收口',
    run: () => {
      const dir = mkGitProject();
      try {
        // 40 位十六进制但仓库中不存在的 SHA——git rev-parse --verify 会失败，
        // diffChangedFiles 静默退化为 HEAD..HEAD（baseIsFallback=true）。
        const bogusSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
        writeCorrectionState(dir, bogusSha);
        writePassingScriptReport(dir);

        const exitCode = runCorrectionCheck(dir, path.join(dir, 'framework', 'harness'));
        eq(exitCode, 1, 'base_commit 不可达时 correction-check 应返回非零（不收口）');

        const state = readCorrectionState(dir);
        eq(state?.status, 'pending', 'state.status 应仍为 pending，不得静默 closed');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'runCorrectionCheck: base_commit 有效 + 无未声明层改动 → 正常收口（对照组）',
    run: () => {
      const dir = mkGitProject();
      try {
        const validSha = headSha(dir);
        writeCorrectionState(dir, validSha);
        writePassingScriptReport(dir);

        const exitCode = runCorrectionCheck(dir, path.join(dir, 'framework', 'harness'));
        eq(exitCode, 0, '有效 base_commit + revalidate 全绿 + 无越权改动应正常收口');

        const state = readCorrectionState(dir);
        eq(state?.status, 'closed', 'state.status 应变为 closed');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
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
