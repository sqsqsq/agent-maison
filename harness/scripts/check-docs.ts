// ============================================================================
// Docs 阶段脚本 Harness — check-docs.ts
// ============================================================================
// 作用对象: framework/docs/DOC_INVENTORY.yaml + framework/docs/**.md
//
// 检查项（与 docs-rules.yaml 对应）:
//   Structure:    inventory_exists, inventory_schema_valid, doc_files_exist
//   Traceability: doc_freshness, source_paths_resolvable
//
// 设计要点：
//   - 时间戳来源 = `git log -1 --format=%cI -- <path>`（committer date, ISO8601）
//   - 仓库不是 git 或 git 不可用 → 全部条目 SKIP，整体 PASS（不阻塞 CI）
//   - 单文件无 git 历史（新建未提交）→ 视为"无穷新"，触发 stale
//   - 主体判定逻辑都委托给 utils/doc-freshness.ts，本文件只做 IO + 报告组装
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import {
  PhaseChecker,
  CheckContext,
  CheckResult,
} from './utils/types';
import {
  DocEntry,
  loadInventoryFromFile,
  compareTimestamps,
  SourceTimestamp,
  FreshnessReport,
} from './utils/doc-freshness';
import { validateProfileSkillAssetsForProject } from './utils/profile-skill-assets';
import { runConfirmationUxChecks } from './check-skills-confirmation-ux';
import { runNoNumberedSkillPathsChecks } from './check-no-numbered-skill-paths';
import { runNoNumberedSkillProseChecks } from './check-no-numbered-skill-prose';
import {
  frameworkAbs,
  frameworkLogicalRelPath,
  frameworkRelPath,
  repoLayoutFromContext,
  resolveFrameworkPrefixedPath,
  type RepoLayout,
} from '../repo-layout';

// --------------------------------------------------------------------------
// git log 时间戳读取
// --------------------------------------------------------------------------

interface GitProbe {
  available: boolean;
  message: string;
}

// 单次 git 调用上限 5 秒；超时一律视作"无历史"，避免 docs phase 把 CI 卡死。
const GIT_TIMEOUT_MS = 5_000;

function probeGit(projectRoot: string): GitProbe {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    shell: false,
    timeout: GIT_TIMEOUT_MS,
  });
  if (r.status !== 0) {
    return { available: false, message: `非 git 仓库或 git 不可用: ${(r.stderr ?? r.stdout ?? '').trim()}` };
  }
  return { available: true, message: 'git 可用' };
}

/** 取最近一次 commit 的 ISO8601 时间；无历史 / git 超时一律返回 null。 */
function gitLastCommitTime(projectRoot: string, relOrAbs: string): string | null {
  const r = spawnSync(
    'git',
    ['log', '-1', '--format=%cI', '--', relOrAbs],
    { cwd: projectRoot, encoding: 'utf-8', shell: false, timeout: GIT_TIMEOUT_MS },
  );
  if (r.status !== 0) return null;
  const out = (r.stdout ?? '').trim();
  return out.length > 0 ? out : null;
}

// --------------------------------------------------------------------------
// 检查工具
// --------------------------------------------------------------------------

function existsInRepo(layout: RepoLayout, rel: string): boolean {
  return fs.existsSync(resolveFrameworkPrefixedPath(layout.projectRoot, rel, layout));
}

/** inventory / doc 路径在 git 中使用的仓库相对路径（standalone 会剥掉 framework/ 前缀） */
function gitPathFromInventoryRel(layout: RepoLayout, rel: string): string {
  const abs = resolveFrameworkPrefixedPath(layout.projectRoot, rel, layout);
  return path.relative(layout.projectRoot, abs).replace(/\\/g, '/');
}

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description?: string }> | undefined;
  return checks?.[id]?.description?.trim() ?? id;
}

// --------------------------------------------------------------------------
// 单项检查
// --------------------------------------------------------------------------

function checkInventoryExistsAndSchema(ctx: CheckContext): {
  results: CheckResult[];
  docs?: DocEntry[];
} {
  const layout = repoLayoutFromContext(ctx);
  const inventoryRel = frameworkLogicalRelPath('docs', 'DOC_INVENTORY.yaml');
  const inventoryAbs = frameworkAbs(layout, 'docs', 'DOC_INVENTORY.yaml');
  const parsed = loadInventoryFromFile(inventoryAbs);

  if (!parsed.ok) {
    return {
      results: [
        {
          id: 'inventory_exists',
          category: 'structure',
          description: ruleDesc(ctx, 'structure_checks', 'inventory_exists'),
          severity: 'BLOCKER',
          status: 'FAIL',
          details: parsed.errors.map(e => `[${e.kind}] ${e.message}`).join('\n'),
          affected_files: [inventoryRel],
          suggestion: '修正 inventory 结构。最小骨架:\n```yaml\nschema_version: "1.0"\ndocs: []\n```',
        },
      ],
    };
  }

  return {
    results: [
      {
        id: 'inventory_exists',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'inventory_exists'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `${inventoryRel} 存在且为合法 YAML（${parsed.inventory!.docs.length} 条文档登记）。`,
      },
      {
        id: 'inventory_schema_valid',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'inventory_schema_valid'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: 'inventory schema 通过：根含 schema_version + docs，每条 doc 含 path/role/sources。',
      },
    ],
    docs: parsed.inventory!.docs,
  };
}

function checkDocFilesExist(ctx: CheckContext, docs: DocEntry[]): CheckResult[] {
  const layout = repoLayoutFromContext(ctx);
  const missing = docs.filter(d => !existsInRepo(layout, d.path));
  if (missing.length === 0) {
    return [{
      id: 'doc_files_exist',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'doc_files_exist'),
      severity: 'MAJOR',
      status: 'PASS',
      details: `全部 ${docs.length} 份文档文件均存在。`,
    }];
  }
  return [{
    id: 'doc_files_exist',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'doc_files_exist'),
    severity: 'MAJOR',
    status: 'FAIL',
    details: `${missing.length} 份在 inventory 中登记的文档不存在：\n` +
      missing.map(d => `  - ${d.path}`).join('\n'),
    affected_files: missing.map(d => d.path),
    suggestion: '撰写缺失的文档；或暂时无法撰写时把该条 inventory 删除。',
  }];
}

function checkSourcePathsResolvable(ctx: CheckContext, docs: DocEntry[]): CheckResult[] {
  const layout = repoLayoutFromContext(ctx);
  const broken: string[] = [];
  for (const d of docs) {
    for (const s of d.sources) {
      if (!existsInRepo(layout, s)) {
        broken.push(`${d.path} → ${s}`);
      }
    }
  }
  if (broken.length === 0) {
    return [{
      id: 'source_paths_resolvable',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'source_paths_resolvable'),
      severity: 'MAJOR',
      status: 'PASS',
      details: '全部 source 路径在仓库中可定位。',
    }];
  }
  return [{
    id: 'source_paths_resolvable',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'source_paths_resolvable'),
    severity: 'MAJOR',
    status: 'FAIL',
    details: `${broken.length} 条 source 路径不存在：\n` +
      broken.map(s => `  - ${s}`).join('\n'),
    suggestion: '修正路径；或 source 已删除则在 inventory 中清理。',
  }];
}

function checkProfileSkillAssetsResolvable(ctx: CheckContext): CheckResult[] {
  const layout = repoLayoutFromContext(ctx);
  const v = validateProfileSkillAssetsForProject(ctx.projectRoot, layout);
  if (v.ok) {
    return [
      {
        id: 'profile_skill_assets_resolvable',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'profile_skill_assets_resolvable'),
        severity: 'MAJOR',
        status: 'PASS',
        details: 'profile skill-assets 清单、根 SKILL 资产引用与相对链接校验通过。',
      },
    ];
  }
  return [
    {
      id: 'profile_skill_assets_resolvable',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'profile_skill_assets_resolvable'),
      severity: 'MAJOR',
      status: 'FAIL',
      details: v.errors.join('\n'),
      suggestion:
        '1) 补全 framework/profiles/<project_profile>/skills/skill-assets.yaml；2) 将根 SKILL 中失效的 templates/ 链接改为 `profile-skill-asset:...`；3) 删除根 SKILL 中对其它 profile 物理目录的硬编码路径。',
    },
  ];
}

function checkDocFreshness(
  ctx: CheckContext,
  docs: DocEntry[],
  gitProbe: GitProbe,
): CheckResult[] {
  if (!gitProbe.available) {
    return [{
      id: 'doc_freshness',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'doc_freshness'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: `跳过文档新鲜度检查：${gitProbe.message}`,
    }];
  }

  const layout = repoLayoutFromContext(ctx);
  const reports: FreshnessReport[] = [];
  for (const d of docs) {
    const docTs = existsInRepo(layout, d.path)
      ? gitLastCommitTime(ctx.projectRoot, gitPathFromInventoryRel(layout, d.path))
      : null;

    const sources: SourceTimestamp[] = d.sources.map(s => ({
      path: s,
      exists: existsInRepo(layout, s),
      ts: existsInRepo(layout, s)
        ? gitLastCommitTime(ctx.projectRoot, gitPathFromInventoryRel(layout, s))
        : null,
    }));

    reports.push(compareTimestamps(d.path, docTs, sources));
  }

  const stale = reports.filter(r => r.verdict === 'stale');
  const skipped = reports.filter(
    r => r.verdict === 'skip_no_sources' || r.verdict === 'skip_no_doc_history',
  );
  const fresh = reports.filter(r => r.verdict === 'fresh');

  if (stale.length === 0) {
    return [{
      id: 'doc_freshness',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'doc_freshness'),
      severity: 'MAJOR',
      status: 'PASS',
      details: `全部 ${reports.length} 份文档新鲜度通过：fresh=${fresh.length}, skip=${skipped.length}。`,
    }];
  }

  const lines: string[] = [];
  for (const r of stale) {
    lines.push(`${r.doc_path} (doc_ts=${r.doc_ts ?? 'N/A'}):`);
    for (const s of r.stale_sources) {
      lines.push(`    ↳ ${s.path} 更新于 ${s.ts}`);
    }
    for (const s of r.uncommitted_sources) {
      lines.push(`    ↳ ${s.path} 有未提交改动（视为无穷新）`);
    }
  }

  return [{
    id: 'doc_freshness',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'doc_freshness'),
    severity: 'MAJOR',
    status: 'FAIL',
    details: `${stale.length} 份文档可能已过期（source 在 doc 之后改动）：\n` + lines.join('\n'),
    affected_files: stale.map(r => r.doc_path),
    suggestion: [
      '逐份核对：',
      '  1. 若 source 改动确实影响 doc 描述 → 同步更新 doc 后 git commit；',
      '  2. 若 source 改动是无关重构（如内部变量重命名）→ touch doc 文件并 commit 一句"sync without content change"，',
      '     或在 inventory 中收紧 sources 范围（去掉那条不影响 doc 的源）。',
    ].join('\n'),
  }];
}

// --------------------------------------------------------------------------
// 入口
// --------------------------------------------------------------------------

const checker: PhaseChecker = {
  phase: 'docs',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const inv = checkInventoryExistsAndSchema(ctx);
    if (!inv.docs) {
      return inv.results;
    }
    const results: CheckResult[] = [...inv.results];
    const docs = inv.docs;

    results.push(...checkDocFilesExist(ctx, docs));
    results.push(...checkSourcePathsResolvable(ctx, docs));
    results.push(...checkProfileSkillAssetsResolvable(ctx));
    results.push(...runConfirmationUxChecks(ctx));
    results.push(...runNoNumberedSkillPathsChecks(ctx));
    results.push(...runNoNumberedSkillProseChecks(ctx));

    const gitProbe = probeGit(ctx.projectRoot);
    results.push(...checkDocFreshness(ctx, docs, gitProbe));

    return results;
  },
};

export default checker;
