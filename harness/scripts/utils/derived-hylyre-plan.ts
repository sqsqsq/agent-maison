/**
 * Hylyre 派生计划（test-plan.hylyre.md）与顶层 test-plan.md 的覆盖关系工具。
 * SSOT：顶层 test-plan.md；派生表仅消费，不自动生成。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { getSectionContent, extractTables } from './markdown-parser';

const PLACEHOLDER_BODY_PATTERNS: RegExp[] = [
  /烟测占位/,
  /smoke\s*placeholder/i,
  /do\s+not\s+use\s+for\s+production/i,
  /hylyre\s*placeholder/i,
  /<!--\s*placeholder/i,
];

/** 与 check-testing 原逻辑一致：从「测试用例」首节表格抽取 TC 编号 */
export function extractTcIdsFromPlanTable(planMd: string): string[] {
  const section = getSectionContent(planMd, '测试用例') ?? '';
  const tables = extractTables(section);
  if (tables.length === 0) return [];
  const t = tables[0];
  const idx = t.headers.findIndex(h => h.includes('用例编号') || h.includes('编号'));
  const col = idx >= 0 ? idx : 0;
  const ids = new Set<string>();
  for (const row of t.rows) {
    const cell = row[col] || '';
    const found = cell.match(/TC-\d+/gi);
    if (found) {
      for (const x of found) {
        ids.add(x.toUpperCase());
      }
    }
  }
  return [...ids];
}

function stripFrontmatterBlock(md: string): string {
  if (!md.startsWith('---')) return md;
  const rest = md.slice(3);
  const endMatch = rest.match(/^([\s\S]*?)\n---(\r?\n|$)/);
  if (!endMatch) return md;
  return rest.slice(endMatch[0].length);
}

export function tryParseYamlFrontmatter(md: string): Record<string, unknown> | null {
  if (!md.startsWith('---')) return null;
  const rest = md.slice(3);
  const endMatch = rest.match(/^([\s\S]*?)\n---(\r?\n|$)/);
  if (!endMatch) return null;
  try {
    const doc = parseYaml(endMatch[1]);
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      return doc as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** 烟测 / 占位派生：不得作为有效 harness 选中目标 */
export function isPlaceholderDerivedPlan(mdContent: string): boolean {
  const fm = tryParseYamlFrontmatter(mdContent);
  if (fm) {
    if (fm.hylyre_placeholder === true) return true;
    if (fm.placeholder === true) return true;
    if (fm.plan_kind === 'smoke_placeholder') return true;
  }
  const body = stripFrontmatterBlock(mdContent);
  for (const re of PLACEHOLDER_BODY_PATTERNS) {
    if (re.test(body) || re.test(mdContent)) return true;
  }
  return false;
}

function normalizeTcToken(s: string): string {
  const m = String(s).trim().match(/TC-\d+/i);
  return m ? m[0].toUpperCase() : String(s).trim().toUpperCase();
}

function coerceTcIdList(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map(x => normalizeTcToken(String(x))).filter(x => /^TC-\d+$/i.test(x));
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[\s,;]+/u)
      .map(normalizeTcToken)
      .filter(x => /^TC-\d+$/i.test(x));
  }
  return [];
}

/** 从派生 md 的 YAML frontmatter 读取 explicit_skip_tc_ids */
export function parseExplicitSkipFromFrontmatter(mdContent: string): string[] {
  const fm = tryParseYamlFrontmatter(mdContent);
  if (!fm) return [];
  return coerceTcIdList(fm.explicit_skip_tc_ids);
}

export type DeriveManifestShape = {
  explicit_skip_tc_ids?: unknown;
};

/** 与同目录 derive-manifest.json 合并（JSON 优先合并进列表，去重） */
export function loadExplicitSkipTcIds(hylyrePlanAbsPath: string, mdContent: string): string[] {
  const fromFm = parseExplicitSkipFromFrontmatter(mdContent);
  const hylyreDir = path.dirname(hylyrePlanAbsPath);
  const manifestPath = path.join(hylyreDir, 'derive-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return [...new Set(fromFm)];
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const j = JSON.parse(raw) as DeriveManifestShape;
    const fromJson = coerceTcIdList(j.explicit_skip_tc_ids);
    return [...new Set([...fromFm, ...fromJson])];
  } catch {
    return [...new Set(fromFm)];
  }
}

export type DerivedPlanFileInfo = {
  hylyrePath: string;
  reportSubdir: string;
  mtimeMs: number;
};

/** 枚举 testing/reports 下各子目录的 hylyre/test-plan.hylyre.md */
export function listDerivedHylyrePlanFiles(reportsBase: string): DerivedPlanFileInfo[] {
  if (!fs.existsSync(reportsBase)) return [];
  const out: DerivedPlanFileInfo[] = [];
  for (const ent of fs.readdirSync(reportsBase, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const hylyrePath = path.join(reportsBase, ent.name, 'hylyre', 'test-plan.hylyre.md');
    if (!fs.existsSync(hylyrePath)) continue;
    const st = fs.statSync(hylyrePath);
    out.push({
      hylyrePath,
      reportSubdir: ent.name,
      mtimeMs: st.mtimeMs,
    });
  }
  return out;
}

export type EvaluateCoverageInput = {
  topTcIds: string[];
  derivedTcIds: string[];
  explicitSkipTcIds: string[];
};

export type EvaluateCoverageResult = {
  ok: boolean;
  missing: string[];
  extra: string[];
};

/** missing = top − derived − skip；extra = derived − top */
export function evaluateDerivedCoverage(inp: EvaluateCoverageInput): EvaluateCoverageResult {
  const top = new Set(inp.topTcIds.map(x => x.toUpperCase()));
  const der = new Set(inp.derivedTcIds.map(x => x.toUpperCase()));
  const skip = new Set(inp.explicitSkipTcIds.map(x => x.toUpperCase()));
  const missing = [...top].filter(id => !der.has(id) && !skip.has(id)).sort();
  const extra = [...der].filter(id => !top.has(id)).sort();
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

export type SelectDerivedPlanResult = {
  selected: DerivedPlanFileInfo & { content: string } | null;
  rejectedPlaceholders: string[];
  allCandidates: DerivedPlanFileInfo[];
};

/** 按 mtime 从新到旧，跳过 placeholder */
export function selectBestNonPlaceholderDerivedPlan(reportsBase: string): SelectDerivedPlanResult {
  const all = listDerivedHylyrePlanFiles(reportsBase).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const rejectedPlaceholders: string[] = [];
  for (const info of all) {
    const content = fs.readFileSync(info.hylyrePath, 'utf-8');
    if (isPlaceholderDerivedPlan(content)) {
      rejectedPlaceholders.push(info.hylyrePath);
      continue;
    }
    return { selected: { ...info, content }, rejectedPlaceholders, allCandidates: all };
  }
  return { selected: null, rejectedPlaceholders, allCandidates: all };
}
