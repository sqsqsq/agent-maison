// ============================================================================
// release-shipped-in-ignored-dirs.unit.test.ts — 跨清单对账（e5d8a2c4 T1/T4#1）
// ----------------------------------------------------------------------------
// 这是本次事故的**防复发核心**，比修那两个文件重要。
//
// 根因不是某个清单写错，而是两份清单**各自都自洽、合起来矛盾**，且没有任何检查看
// 它们的交集：
//   · scripts/release-excludes.json          → 这两个文件**要发**（includeOverrides）
//   · specs/runtime-artifact-policy.json     → `harness/trace/` **整目录忽略**
// 于是 framework-init 给宿主写下目录式 gitignore，`git add` 静默吞掉发布件，
// 换机 clone 后 RELEASE-MANIFEST 仍要求它们存在 → framework_integrity 必 BLOCKER。
//
// 三方一致性单测当时**全绿**——它保证的是"三方读同一份 SSOT"，而本次是三方
// **一致地错**。一致性 ≠ 正确性；防内容矛盾要靠跨清单对账。
//
// 对账口径取**打包侧真实产出**（collectReleaseFiles），不取中间表 includeOverrides：
// 文件也可能经普通 include 落进 ignored 目录（12 条 ignored 模式中有 6 条在打包侧
// 没有任何排除规则），只查 includeOverrides 会漏。
// ============================================================================

import * as path from 'path';
import { loadRuntimeArtifactPolicy, matchesPolicyPattern } from '../../scripts/utils/canonical-gitignore';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

interface PackRules {
  loadReleaseExcludes(): unknown;
  collectReleaseFiles(repoRoot: string, rules: unknown): { included: string[] };
}

// ts-node(commonjs) 会把 `import()` 降级成 require()，加载不了 .mjs——用 Function 包一层
// 保住真正的动态 import（与 guard-framework-write.unit.test.ts 同款手法）。
// Windows 下路径必须经 pathToFileURL（`file://D:/…` 少一个斜杠即 MODULE_NOT_FOUND）。
const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;

async function loadPackRules(): Promise<PackRules> {
  const { pathToFileURL } = await import('url');
  const abs = path.join(REPO_ROOT, 'scripts', 'release-pack-rules.mjs');
  return (await dynamicImport(pathToFileURL(abs).href)) as PackRules;
}

/** 发布产出中落在某条 ignored_runtime_patterns 覆盖范围内的文件（framework 根相对） */
function shippedInsideIgnoredDirs(included: string[], ignored: string[]): string[] {
  return included
    .map(p => p.replace(/\\/g, '/'))
    .filter(rel => ignored.some(pat => matchesPolicyPattern(rel, pat)))
    .sort();
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  const run = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  };

  await run('对账（双向集合相等）：发布真实产出 ∩ ignored 覆盖 == shipped_files_in_runtime_dirs', async () => {
    const rulesMod = await loadPackRules();
    const rules = rulesMod.loadReleaseExcludes();
    const { included } = rulesMod.collectReleaseFiles(REPO_ROOT, rules);
    const policy = loadRuntimeArtifactPolicy();
    const actual = shippedInsideIgnoredDirs(included, policy.ignored_runtime_patterns);
    const declared = [...policy.shipped_files_in_runtime_dirs].map(s => s.replace(/\\/g, '/')).sort();

    const missing = actual.filter(f => !declared.includes(f));
    const stale = declared.filter(f => !actual.includes(f));
    assert(
      missing.length === 0,
      '以下文件会被发布、却落在宿主 gitignore 的 ignored 目录内且未登记例外——' +
      `它们会被宿主 git 静默吞掉（本次事故形态）：\n  ${missing.join('\n  ')}\n` +
      '处置：登记进 specs/runtime-artifact-policy.json 的 shipped_files_in_runtime_dirs，' +
      '或让打包侧排除它们。',
    );
    assert(
      stale.length === 0,
      '以下路径登记为"ignored 目录内的发布件"、但打包侧实际不发它——' +
      `等于给不存在的发布件开了 gitignore 口子：\n  ${stale.join('\n  ')}`,
    );
  });

  await run('例外字段的形状约束：framework 根相对、禁 glob、且必须真落在某个 ignored 目录下', () => {
    const policy = loadRuntimeArtifactPolicy();
    for (const f of policy.shipped_files_in_runtime_dirs) {
      assert(!f.startsWith('/') && !/^[A-Za-z]:/.test(f), `须是相对路径：${f}`);
      assert(!f.includes('*'), `禁 glob（精确文件路径）：${f}`);
      assert(!f.endsWith('/'), `须是文件不是目录：${f}`);
      assert(
        policy.ignored_runtime_patterns.some(p => matchesPolicyPattern(f, p)),
        `未落在任何 ignored 目录下——本字段只为"被忽略目录内的发布件"存在：${f}`,
      );
      // 本机制只支持非 glob 目录（含 `**` 的模式不适用，见 plan T4#1 边界）
      const owner = policy.ignored_runtime_patterns.find(p => matchesPolicyPattern(f, p))!;
      assert(!owner.includes('*'), `其所属 ignored 模式含通配，本机制不适用：${f} ← ${owner}`);
      // **只能是 ignored 目录的直接子文件**（codex P2）：派生形状是
      // `!<dir>/` + `<dir>/*` + `!<dir>/<file>`——`<dir>/*` 会把**直接子目录整体**忽略，
      // 而 git 无法用 `!` 穿透被忽略的父目录，故 `<dir>/sub/file` 登记了也不会生效。
      // 按简单优先：**收窄字段契约**，不实现递归祖先展开。
      const rest = f.slice(owner.length);
      assert(
        rest.length > 0 && !rest.includes('/'),
        `只能登记 ignored 目录的**直接子文件**（登记嵌套路径不会生效，派生形状穿透不了被忽略的父目录）：${f}`,
      );
    }
  });

  return results;
}
