// ============================================================================
// repo-layout.ts — 消费者工程 (framework/) vs AgentMaison 独立仓 (standalone) 路径解析
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

export type RepoLayoutKind = 'standalone' | 'consumer';

export interface RepoLayout {
  kind: RepoLayoutKind;
  /** 实例工程根（消费者）或 AgentMaison 仓根（standalone） */
  projectRoot: string;
  /** skills/ profiles/ harness/ 等 framework 资产所在绝对路径 */
  frameworkRoot: string;
  /** projectRoot → frameworkRoot 的 POSIX 相对前缀：'' 或 'framework' */
  frameworkRel: string;
}

/** 从任意子目录向上定位 harness/（含 harness-runner.ts） */
export function resolveHarnessRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'harness-runner.ts'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot locate harness root from ${startDir}`);
}

function hasFrameworkTree(root: string): boolean {
  return (
    fs.existsSync(path.join(root, 'skills')) ||
    fs.existsSync(path.join(root, 'workflows'))
  );
}

/**
 * 根据 projectRoot 推断 layout。
 * - consumer：`<projectRoot>/framework/skills` 或 `framework/workflows` 存在
 * - standalone：`<projectRoot>/skills` 或 `workflows` 存在（AgentMaison 独立仓）
 */
export function inferRepoLayout(projectRoot: string): RepoLayout {
  const norm = path.resolve(projectRoot);
  const consumerFramework = path.join(norm, 'framework');
  if (hasFrameworkTree(consumerFramework)) {
    return {
      kind: 'consumer',
      projectRoot: norm,
      frameworkRoot: consumerFramework,
      frameworkRel: 'framework',
    };
  }
  if (hasFrameworkTree(norm)) {
    return {
      kind: 'standalone',
      projectRoot: norm,
      frameworkRoot: norm,
      frameworkRel: '',
    };
  }
  throw new Error(`No framework tree (skills/ or workflows/) under projectRoot=${norm}`);
}

/** 从单测目录或 harness 子路径自动检测当前 checkout 的 layout */
export function detectRepoLayout(startDir?: string): RepoLayout {
  const harnessRoot = resolveHarnessRoot(startDir ?? __dirname);
  const parent = path.resolve(harnessRoot, '..');
  const grandparent = path.resolve(harnessRoot, '../..');
  if (fs.existsSync(path.join(grandparent, 'framework', 'skills'))) {
    return inferRepoLayout(grandparent);
  }
  return inferRepoLayout(parent);
}

export function frameworkAbs(layout: RepoLayout, ...segments: string[]): string {
  return path.join(layout.frameworkRoot, ...segments);
}

export function frameworkRelPath(layout: RepoLayout, ...segments: string[]): string {
  const parts = layout.frameworkRel ? [layout.frameworkRel, ...segments] : segments;
  return path.posix.join(...parts.map(s => s.replace(/\\/g, '/')));
}

/** 将 `framework/...` 或裸 segments 解析为绝对路径（兼容 standalone / consumer） */
export function resolveFrameworkPrefixedPath(projectRoot: string, relPosix: string): string {
  const layout = inferRepoLayout(projectRoot);
  const norm = relPosix.replace(/\\/g, '/');
  if (layout.kind === 'consumer') {
    if (norm.startsWith('framework/')) {
      return path.join(projectRoot, norm);
    }
    return frameworkAbs(layout, ...norm.split('/').filter(Boolean));
  }
  const stripped = norm.startsWith('framework/') ? norm.slice('framework/'.length) : norm;
  return path.join(projectRoot, ...stripped.split('/').filter(Boolean));
}
