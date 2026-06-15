/**
 * UT 测试文件 feature-scoped 分区（双集合：all / scoped）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext } from '../../../harness/scripts/utils/types';
import { diffChangedFiles } from '../../../harness/scripts/utils/git-diff';

const harnessRequire = createRequire(
  path.resolve(__dirname, '..', '..', '..', 'harness', 'package.json'),
);
const YAML = harnessRequire('yaml');

export interface UtFileEntry {
  path: string;
  content: string;
}

export interface UtFilePartition {
  all: UtFileEntry[];
  scoped: UtFileEntry[];
  scopeSources: string[];
}

const TEST_FILE_RE = /\.test\.ets$/i;
const OHOSTEST_PATH_RE = /[/\\]ohosTest[/\\]ets[/\\]test[/\\]/i;

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/');
}

function isUtTestPath(rel: string): boolean {
  return TEST_FILE_RE.test(rel) && OHOSTEST_PATH_RE.test(rel);
}

function collectDeclaredTestPathsFromContextExploration(projectRoot: string, feature: string): string[] {
  const candidates = [
    path.join(projectRoot, 'doc/features', feature, 'ut/context-exploration.md'),
    path.join(projectRoot, 'doc/features', feature, 'context-exploration.md'),
  ];
  const out = new Set<string>();
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, '');
    const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fm) {
      try {
        const doc = YAML.parse(fm[1]) as { source_code_paths?: unknown };
        const paths = doc.source_code_paths;
        if (Array.isArray(paths)) {
          for (const item of paths) {
            if (typeof item === 'string' && isUtTestPath(item)) {
              out.add(normalizeRel(item));
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    const pathLike = text.match(/[`"]?([^\s`"]+\.test\.ets)[`"]?/gi) ?? [];
    for (const m of pathLike) {
      const cleaned = m.replace(/[`"]/g, '').trim();
      if (isUtTestPath(cleaned)) {
        out.add(normalizeRel(cleaned));
      }
    }
  }
  return [...out];
}

function collectGitScopedTestPaths(projectRoot: string): string[] {
  const diff = diffChangedFiles({ projectRoot, baseRef: 'working' });
  if (!diff.executed) return [];
  return diff.changedFiles.map(normalizeRel).filter(isUtTestPath);
}

/**
 * 将全量 UT 文件分区为 all（编译/注册）与 scoped（追溯/命名）。
 * 无 scope 线索时 scoped = all（向后兼容）。
 */
export function partitionUtFiles(
  ctx: CheckContext,
  allUtFiles: UtFileEntry[],
): UtFilePartition {
  const scopeSources: string[] = [];
  const scopedPaths = new Set<string>();

  for (const p of collectGitScopedTestPaths(ctx.projectRoot)) {
    scopedPaths.add(p);
    scopeSources.push(`git:${p}`);
  }
  for (const p of collectDeclaredTestPathsFromContextExploration(ctx.projectRoot, ctx.feature)) {
    scopedPaths.add(p);
    scopeSources.push(`context:${p}`);
  }

  const allPaths = new Set(allUtFiles.map(f => normalizeRel(f.path)));
  for (const p of [...scopedPaths]) {
    if (!allPaths.has(p)) {
      scopedPaths.delete(p);
    }
  }

  if (scopedPaths.size === 0) {
    return { all: allUtFiles, scoped: allUtFiles, scopeSources: ['fallback:all'] };
  }

  const scoped = allUtFiles.filter(f => scopedPaths.has(normalizeRel(f.path)));
  return { all: allUtFiles, scoped, scopeSources };
}
