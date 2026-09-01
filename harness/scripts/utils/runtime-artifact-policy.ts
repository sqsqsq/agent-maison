// ============================================================================
// runtime-artifact-policy.ts — framework 运行时产物策略 reader（Git 中性）
// ============================================================================
// SSOT：specs/runtime-artifact-policy.json。本模块只是它的 TS 侧 reader/matcher，
// 服务两件真实能力：
//   1) release pack/verify 对 ignored 目录内**发布件**的文件集合保护；
//   2) 与 agents/shared/guard-framework-write-core.mjs 共用同一份清单与同一套
//      glob-lite 语义（跨实现一致性单测钉死，改任一侧须同步）。
//
// plan 33714d0c：本文件由已删除的宿主忽略配置模块原位迁出——只搬既有 reader，
// 不新增状态、不复制 JSON、不建第二份真源。策略只描述 Maison 自己在 framework/ 内的
// 输出与守卫路径，**不派生、不描述、不补偿宿主 SCM 配置**。

import * as fs from 'fs';
import * as path from 'path';

export interface RuntimeArtifactPolicy {
  ignored_runtime_patterns: string[];
  /** e5d8a2c4 T4#1：runtime 目录内的**发布件**精确路径（禁 glob）；旧 policy 缺键回退 [] */
  shipped_files_in_runtime_dirs: string[];
  generated_file_patterns: string[];
  reserved_metadata_files: string[];
}

/** 读 SSOT；本模块随 harness 走，policy 与之同发布件——读取失败即抛（构建期错误，不静默）。 */
export function loadRuntimeArtifactPolicy(): RuntimeArtifactPolicy {
  const abs = path.resolve(__dirname, '..', '..', '..', 'specs', 'runtime-artifact-policy.json');
  const doc = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Partial<RuntimeArtifactPolicy>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    ignored_runtime_patterns: arr(doc.ignored_runtime_patterns),
    // 旧发布件无此键 → []（不炸；届时行为回落为整目录视为运行时产物的历史语义）
    shipped_files_in_runtime_dirs: arr(doc.shipped_files_in_runtime_dirs),
    generated_file_patterns: arr(doc.generated_file_patterns),
    reserved_metadata_files: arr(doc.reserved_metadata_files),
  };
}

// glob-lite 匹配（语义与 agents/shared/guard-framework-write-core.mjs 等价——尾 '/' 目录
// 前缀、'**' 任意层段、'*' 段内通配；跨实现一致性单测钉死，改任一侧须同步）。

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function segsMatch(patSegs: string[], relSegs: string[]): boolean {
  if (patSegs.length === 0) return relSegs.length === 0;
  const [head, ...rest] = patSegs;
  if (head === '**') {
    for (let skip = 0; skip <= relSegs.length; skip += 1) {
      if (segsMatch(rest, relSegs.slice(skip))) return true;
    }
    return false;
  }
  if (relSegs.length === 0) return false;
  const re = new RegExp('^' + head.split('*').map(escapeRe).join('[^/]*') + '$');
  if (!re.test(relSegs[0])) return false;
  return segsMatch(rest, relSegs.slice(1));
}

/** rel（framework 根相对、POSIX、无首尾斜杠）是否命中 policy pattern。 */
export function matchesPolicyPattern(rel: string, pattern: string): boolean {
  const p = pattern.replace(/\\/g, '/');
  const isDir = p.endsWith('/');
  const patSegs = (isDir ? p.slice(0, -1) : p).split('/').filter(Boolean);
  const relSegs = rel.split('/').filter(Boolean);
  if (isDir) {
    for (let take = patSegs.filter(s => s !== '**').length; take <= relSegs.length; take += 1) {
      if (segsMatch(patSegs, relSegs.slice(0, take))) return true;
    }
    return false;
  }
  return segsMatch(patSegs, relSegs);
}
