// ============================================================================
// worktree-digest.unit.test.ts — 产品工作区摘要（t2 v5，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// codex 第四轮阻断1 的直接复现回归：core.quotePath=true（git 默认）下中文等非 ASCII
// untracked 路径被引号+八进制转义，非 -z 实现 readFileSync 必失败 → 恒 unreadable →
// 内容 A→B 摘要不变（旧 PASS 件可跨源码变更复用）。本套件用真实临时 git 仓覆盖：
// 中文/空格/# 路径的内容变化必须反映进摘要；未变时摘要稳定（不误报）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  computeProductWorktreeDigest,
  WORKTREE_DIGEST_UNVERIFIABLE,
  __testing_setDigestReadFile,
} from '../../scripts/utils/worktree-digest';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function mkGitProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-digest-'));
  const git = (args: string[]): void => {
    spawnSync('git', args, { cwd: root, shell: false });
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  // 显式按 git 默认 quotePath=true 跑（防本机全局配置关掉后测试失去复现力）
  git(['config', 'core.quotePath', 'true']);
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', 'tracked.ets'), 'base\n', 'utf-8');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'baseline']);
  return root;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '中文 untracked 路径：内容 A→B 摘要必须变（codex 第四轮实测绕过场景）',
    run: () => {
      const root = mkGitProject();
      try {
        const cn = path.join(root, 'app', '中文.ets');
        fs.writeFileSync(cn, 'A', 'utf-8');
        const d1 = computeProductWorktreeDigest(root, ['app']);
        assert(/^[0-9a-f]{16}$/.test(d1), `应得 16 hex 摘要，got ${d1}`);
        fs.writeFileSync(cn, 'B', 'utf-8');
        const d2 = computeProductWorktreeDigest(root, ['app']);
        assert(d1 !== d2, `中文路径内容变化摘要必须变（d1=${d1} d2=${d2}）`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '空格与 # 的 untracked 路径：内容变化摘要必须变；未变时摘要稳定',
    run: () => {
      const root = mkGitProject();
      try {
        const tricky = path.join(root, 'app', '路径 空格#测试.ets');
        fs.writeFileSync(tricky, 'v1', 'utf-8');
        const d1 = computeProductWorktreeDigest(root, ['app']);
        const d1b = computeProductWorktreeDigest(root, ['app']);
        assert(d1 === d1b, '未变时摘要须稳定（不误报）');
        fs.writeFileSync(tricky, 'v2', 'utf-8');
        const d2 = computeProductWorktreeDigest(root, ['app']);
        assert(d1 !== d2, `空格/#/中文混合路径内容变化摘要必须变（d1=${d1} d2=${d2}）`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'ASCII 基线不回归：untracked 内容变化/tracked 修改/根配置修改分别改变摘要',
    run: () => {
      const root = mkGitProject();
      try {
        fs.writeFileSync(path.join(root, 'app', 'plain.ets'), 'A', 'utf-8');
        const d1 = computeProductWorktreeDigest(root, ['app']);
        fs.writeFileSync(path.join(root, 'app', 'plain.ets'), 'B', 'utf-8');
        const d2 = computeProductWorktreeDigest(root, ['app']);
        assert(d1 !== d2, 'ASCII untracked 内容变化须变摘要');
        fs.writeFileSync(path.join(root, 'app', 'tracked.ets'), 'modified\n', 'utf-8');
        const d3 = computeProductWorktreeDigest(root, ['app']);
        assert(d2 !== d3, 'tracked 文件修改须变摘要');
        fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ "app": {} }\n', 'utf-8');
        const d4 = computeProductWorktreeDigest(root, ['app']);
        assert(d3 !== d4, '根级构建配置（untracked 新增）须变摘要');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '边界：空 layerDirs → no-layers；非 git 目录 → no-git（哨兵语义保持）',
    run: () => {
      const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-nogit-'));
      try {
        assert(computeProductWorktreeDigest(plain, []) === 'no-layers', '空 layer 须 no-layers');
        assert(computeProductWorktreeDigest(plain, ['app']) === 'no-git', '非 git 须 no-git');
      } finally {
        fs.rmSync(plain, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'v6 故障注入：untracked 文件持续不可读 → unverifiable（不折叠成稳定常量假匹配）',
    run: () => {
      const root = mkGitProject();
      try {
        fs.writeFileSync(path.join(root, 'app', 'locked.ets'), 'A', 'utf-8');
        // 基线：可读时正常 hex
        const before = computeProductWorktreeDigest(root, ['app']);
        assert(/^[0-9a-f]{16}$/.test(before), `基线应为 hex，got ${before}`);
        // 注入持续读失败（codex 第五轮 P1：旧实现折叠成 path=unreadable 稳定常量——
        // 内容 A→B 期间持续不可读则摘要不变，两侧假匹配）
        __testing_setDigestReadFile(abs => {
          if (abs.endsWith('locked.ets')) throw new Error('EACCES simulated');
          return fs.readFileSync(abs);
        });
        const d = computeProductWorktreeDigest(root, ['app']);
        assert(d === WORKTREE_DIGEST_UNVERIFIABLE, `不可读须 unverifiable，got ${d}`);
      } finally {
        __testing_setDigestReadFile(null);
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
