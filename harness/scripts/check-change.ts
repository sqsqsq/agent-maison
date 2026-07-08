// ============================================================================
// change 阶段（lite track）— change.md 单文档契约校验（C1 feature-track，plan d4a7c1e8）
// ============================================================================
// lite 的唯一叙述产物：<features_dir>/<feature>/change.md
// 契约：## 意图 / ## Scope（yaml 块 in_scope_modules 非空）/ ## 验收清单（checkbox）
//       / ## 任务（checkbox）；术语快查、关键契约为可选节。

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { PhaseChecker, CheckContext, CheckResult } from './utils/types';
import { featureArtifactPath, loadFrameworkConfig } from '../config';

export interface ChangeScope {
  in_scope_modules: string[];
  out_of_scope_modules?: string[];
}

export interface ParsedChangeDoc {
  raw: string;
  sections: Map<string, string>;
  scope: ChangeScope | null;
  scopeError?: string;
  acceptance: Array<{ checked: boolean; text: string }>;
  tasks: Array<{ checked: boolean; text: string }>;
}

const REQUIRED_SECTIONS = ['意图', 'Scope', '验收清单', '任务'] as const;

export function changeDocPath(projectRoot: string, feature: string): string {
  return featureArtifactPath(projectRoot, feature, 'change.md');
}

function splitSections(raw: string): Map<string, string> {
  const sections = new Map<string, string>();
  const matches = [...raw.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : raw.length;
    sections.set(title, raw.slice(start, end));
  }
  return sections;
}

function parseCheckboxes(sectionBody: string): Array<{ checked: boolean; text: string }> {
  const out: Array<{ checked: boolean; text: string }> = [];
  for (const m of sectionBody.matchAll(/^\s*-\s*\[( |x|X)\]\s*(.+?)\s*$/gm)) {
    out.push({ checked: m[1].toLowerCase() === 'x', text: m[2] });
  }
  return out;
}

export function parseChangeDoc(raw: string): ParsedChangeDoc {
  const sections = splitSections(raw);
  let scope: ChangeScope | null = null;
  let scopeError: string | undefined;

  const scopeBody = sections.get('Scope') ?? '';
  const yamlBlock = scopeBody.match(/```ya?ml\s*\n([\s\S]*?)```/);
  if (yamlBlock) {
    try {
      const parsed = YAML.parse(yamlBlock[1]) as Partial<ChangeScope> | null;
      const inScope = parsed?.in_scope_modules;
      if (Array.isArray(inScope) && inScope.length > 0 && inScope.every((m) => typeof m === 'string')) {
        scope = {
          in_scope_modules: inScope,
          out_of_scope_modules: Array.isArray(parsed?.out_of_scope_modules)
            ? (parsed!.out_of_scope_modules as string[])
            : undefined,
        };
      } else {
        scopeError = 'Scope yaml 块缺少非空 in_scope_modules 数组';
      }
    } catch (err) {
      scopeError = `Scope yaml 块解析失败：${(err as Error).message}`;
    }
  } else {
    scopeError = 'Scope 节缺少 ```yaml 代码块（须含 in_scope_modules）';
  }

  return {
    raw,
    sections,
    scope,
    scopeError,
    acceptance: parseCheckboxes(sections.get('验收清单') ?? ''),
    tasks: parseCheckboxes(sections.get('任务') ?? ''),
  };
}

/** module-catalog.yaml 的模块名集合（形状容错：modules[].name / 顶层 map 键）；不可解析 → null。 */
export function loadCatalogModuleNames(projectRoot: string): Set<string> | null {
  try {
    const fw = loadFrameworkConfig(projectRoot);
    const rel = fw.paths?.module_catalog;
    if (!rel) return null;
    const abs = path.resolve(projectRoot, rel);
    if (!fs.existsSync(abs)) return null;
    const doc = YAML.parse(fs.readFileSync(abs, 'utf-8')) as unknown;
    if (!doc || typeof doc !== 'object') return null;
    const names = new Set<string>();
    const modules = (doc as { modules?: unknown }).modules;
    if (Array.isArray(modules)) {
      for (const m of modules) {
        const n = (m as { name?: unknown; module?: unknown })?.name ?? (m as { module?: unknown })?.module;
        if (typeof n === 'string') names.add(n);
      }
    }
    return names.size > 0 ? names : null;
  } catch {
    return null;
  }
}

export const checker: PhaseChecker = {
  phase: 'change',
  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const abs = changeDocPath(ctx.projectRoot, ctx.feature);

    if (!fs.existsSync(abs)) {
      results.push({
        id: 'change_file_exists',
        category: 'structure',
        description: 'lite track 的叙述产物 change.md 必须存在',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `未找到 ${abs}（路径经 paths.features_dir 解析）`,
      });
      return results;
    }
    results.push({
      id: 'change_file_exists',
      category: 'structure',
      description: 'change.md 存在',
      severity: 'BLOCKER',
      status: 'PASS',
      details: abs,
    });

    const doc = parseChangeDoc(fs.readFileSync(abs, 'utf-8'));

    for (const sec of REQUIRED_SECTIONS) {
      const ok = doc.sections.has(sec);
      results.push({
        id: `change_section_${sec === 'Scope' ? 'scope' : sec}`,
        category: 'structure',
        description: `change.md 必须含 "## ${sec}" 节`,
        severity: 'BLOCKER',
        status: ok ? 'PASS' : 'FAIL',
        details: ok ? '' : `缺少 "## ${sec}"`,
      });
    }

    results.push({
      id: 'change_scope_yaml',
      category: 'structure',
      description: 'Scope 节须含可解析的 yaml 块且 in_scope_modules 非空',
      severity: 'BLOCKER',
      status: doc.scope ? 'PASS' : 'FAIL',
      details: doc.scope ? `in_scope=${doc.scope.in_scope_modules.join(', ')}` : doc.scopeError ?? '',
    });

    if (doc.scope) {
      const catalog = loadCatalogModuleNames(ctx.projectRoot);
      if (catalog) {
        const unknown = doc.scope.in_scope_modules.filter((m) => !catalog.has(m));
        results.push({
          id: 'change_scope_modules_known',
          category: 'traceability',
          description: 'in_scope_modules 须存在于 module-catalog',
          severity: 'BLOCKER',
          status: unknown.length === 0 ? 'PASS' : 'FAIL',
          details:
            unknown.length === 0
              ? `${doc.scope.in_scope_modules.length} 个模块全部命中 catalog`
              : `catalog 未收录：${unknown.join(', ')}`,
        });
      } else {
        results.push({
          id: 'change_scope_modules_known',
          category: 'traceability',
          description: 'in_scope_modules 对照 catalog（catalog 缺失/不可解析时跳过）',
          severity: 'MINOR',
          status: 'PASS',
          details: 'module-catalog 缺失或形状不可解析——小工程 small 档合法形态，跳过模块名比对',
        });
      }
    }

    const checkboxIssues: string[] = [];
    if (doc.sections.has('验收清单') && doc.acceptance.length === 0) {
      checkboxIssues.push('验收清单节没有任何 checkbox（- [ ] / - [x]）条目');
    }
    if (doc.sections.has('任务') && doc.tasks.length === 0) {
      checkboxIssues.push('任务节没有任何 checkbox 条目');
    }
    results.push({
      id: 'change_checkbox_syntax',
      category: 'structure',
      description: '验收清单与任务节须各含 ≥1 个 checkbox 条目',
      severity: 'BLOCKER',
      status: checkboxIssues.length === 0 ? 'PASS' : 'FAIL',
      details:
        checkboxIssues.length === 0
          ? `验收 ${doc.acceptance.length} 项 / 任务 ${doc.tasks.length} 项`
          : checkboxIssues.join('；'),
    });

    return results;
  },
};

export default checker;
