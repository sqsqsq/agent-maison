/**
 * Hylyre 派生计划（test-plan.hylyre.md）与顶层 test-plan.md 的覆盖关系工具。
 * SSOT：顶层 test-plan.md；派生表仅消费，不自动生成。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { getSectionContent, extractTables, type MdTable } from './markdown-parser';
import type { DeriveHintTestCaseRow } from './test-plan-derive-hint';
import {
  FORBIDDEN_STEP_ROOT_KEY_SET,
  PLANNED_STEP_ROOT_KEY_SET,
} from './hylyre-planned-step-keys';

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

export type DerivedPlanCaseRow = {
  tc_id: string;
  name: string;
  precondition: string;
  steps_raw: string;
  expected: string;
  priority: string;
  ac_ref: string;
};

const RESET_STEP_ROOTS = new Set([
  'back',
  'home',
  'stop_app',
  'clear_app',
  'start_app',
]);

const HORIZONTAL_SWIPE_DIRS = new Set(['RIGHT', 'LEFT', 'R', 'L']);

function pickColumnIndex(table: MdTable, keywords: string[]): number {
  for (const kw of keywords) {
    const idx = table.headers.findIndex(h => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** 从派生 test-plan.hylyre.md 解析用例行（含测试步骤列） */
export function extractDerivedPlanCases(planMd: string): DerivedPlanCaseRow[] {
  const section = getSectionContent(planMd, '测试用例') ?? getSectionContent(planMd, '测试用例清单') ?? '';
  const tables = extractTables(section || planMd);
  if (tables.length === 0) return [];

  const t = tables[0];
  const iId = pickColumnIndex(t, ['用例编号', '编号']);
  const iName = pickColumnIndex(t, ['用例名称', '名称']);
  const iPre = pickColumnIndex(t, ['前置条件']);
  const iSteps = pickColumnIndex(t, ['测试步骤', '步骤']);
  const iExp = pickColumnIndex(t, ['预期结果']);
  const iPri = pickColumnIndex(t, ['优先级']);
  const iAc = pickColumnIndex(t, ['关联 AC', '关联']);

  const out: DerivedPlanCaseRow[] = [];
  for (const row of t.rows) {
    const tcRaw = (iId >= 0 ? row[iId] : row[0] || '').trim();
    const m = tcRaw.match(/TC-\d+/i);
    if (!m) continue;
    out.push({
      tc_id: m[0].toUpperCase(),
      name: (iName >= 0 ? row[iName] : '').trim(),
      precondition: (iPre >= 0 ? row[iPre] : '').trim(),
      steps_raw: (iSteps >= 0 ? row[iSteps] : '').trim(),
      expected: (iExp >= 0 ? row[iExp] : '').trim(),
      priority: (iPri >= 0 ? row[iPri] : '').trim(),
      ac_ref: (iAc >= 0 ? row[iAc] : '').trim(),
    });
  }
  return out;
}

/** Strip markdown backticks / normalize semicolons for one step fragment. */
export function normalizePlannedStepFragment(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s[0] === s[s.length - 1] && (s[0] === '`' || s[0] === "'")) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/** Normalize full 「测试步骤」 cell: `；` → `;`, strip backticks per fragment. */
export function normalizePlannedStepsCell(raw: string): string {
  const normalized = raw.replace(/；/g, ';');
  return normalized
    .split(';')
    .map(p => normalizePlannedStepFragment(p))
    .filter(Boolean)
    .join(' ; ');
}

function stepRootKeys(step: Record<string, unknown>): string[] {
  return Object.keys(step);
}

function isActionWrappedTouchInputSwipeScroll(step: Record<string, unknown>): boolean {
  const act = step.action;
  if (!act || typeof act !== 'object' || Array.isArray(act)) return false;
  const t = String((act as Record<string, unknown>).type ?? '').toLowerCase();
  return ['touch', 'input', 'swipe', 'scroll'].includes(t);
}

function hasMarkdownBacktickInCell(stepsRaw: string): boolean {
  return /`/.test(stepsRaw);
}

export type StepLintViolation = {
  rule_id: 'STEP-001' | 'STEP-002' | 'STEP-003' | 'STEP-004' | 'STEP-005' | 'STEP-006';
  severity: 'BLOCKER' | 'WARN';
  tc_id: string;
  message: string;
  suggested_fix: string;
};

export type LintHylyrePlanResult = {
  ok: boolean;
  violations: StepLintViolation[];
  nav: LintDerivedHylyrePlanResult;
};

export type LintHylyrePlanOptions = {
  forbidStartApp?: boolean;
  canonicalTouch?: boolean;
  /** When false, STEP-005 backtick is WARN only (post-normalize retry path). */
  backtickBlocker?: boolean;
};

/** STEP-001~006 static lint on derived plan markdown. */
export function lintHylyrePlanStepRules(
  derivedMd: string,
  opts?: LintHylyrePlanOptions,
): { ok: boolean; violations: StepLintViolation[] } {
  const violations: StepLintViolation[] = [];
  const forbidStartApp = opts?.forbidStartApp !== false;
  const canonicalTouch = opts?.canonicalTouch !== false;
  const backtickBlocker = opts?.backtickBlocker !== false;

  for (const row of extractDerivedPlanCases(derivedMd)) {
    if (hasMarkdownBacktickInCell(row.steps_raw)) {
      violations.push({
        rule_id: 'STEP-005',
        severity: backtickBlocker ? 'BLOCKER' : 'WARN',
        tc_id: row.tc_id,
        message: '测试步骤列含 Markdown 反引号；Hylyre _JSONISH 无法识别，请使用裸 JSON。',
        suggested_fix: normalizePlannedStepsCell(row.steps_raw),
      });
    }

    const cellForParse = normalizePlannedStepsCell(row.steps_raw);
    const parsed = parsePlannedStepsFromCell(cellForParse);
    if (!parsed.ok) {
      violations.push({
        rule_id: 'STEP-001',
        severity: 'BLOCKER',
        tc_id: row.tc_id,
        message: `测试步骤 JSON 无法解析：${parsed.error}`,
        suggested_fix: '{"touch":{"by_text":"…"}}',
      });
      continue;
    }

    for (const step of parsed.steps) {
      const roots = stepRootKeys(step);
      if (roots.length !== 1) {
        violations.push({
          rule_id: 'STEP-001',
          severity: 'BLOCKER',
          tc_id: row.tc_id,
          message: `每步须恰好一个 JSON 根键，实际：${roots.join(', ') || '(empty)'}`,
          suggested_fix: '{"touch":{"by_text":"…"}}',
        });
        continue;
      }
      const root = roots[0];
      if (FORBIDDEN_STEP_ROOT_KEY_SET.has(root)) {
        violations.push({
          rule_id: 'STEP-002',
          severity: 'BLOCKER',
          tc_id: row.tc_id,
          message: `禁止将 CLI 命令名 "${root}" 作为步骤根键（如 dump-ui 应走探索，不是 plan 步骤）。`,
          suggested_fix: '{"touch":{"by_text":"…"}}',
        });
      } else if (!PLANNED_STEP_ROOT_KEY_SET.has(root)) {
        violations.push({
          rule_id: 'STEP-001',
          severity: 'BLOCKER',
          tc_id: row.tc_id,
          message: `未知步骤根键 "${root}"；允许：${[...PLANNED_STEP_ROOT_KEY_SET].join(', ')}`,
          suggested_fix: '{"touch":{"by_text":"…"}}',
        });
      }

      if (forbidStartApp && root === 'start_app') {
        violations.push({
          rule_id: 'STEP-003',
          severity: 'BLOCKER',
          tc_id: row.tc_id,
          message: 'harness 已 aa start 预启；步骤列勿重复 start_app，前置条件写「已启动 app」。',
          suggested_fix: '（删除 start_app 步骤）',
        });
      }

      const act = step.action;
      if (act && typeof act === 'object' && !Array.isArray(act)) {
        const t = String((act as Record<string, unknown>).type ?? '').toLowerCase();
        if (t === 'start_app') {
          violations.push({
            rule_id: 'STEP-004',
            severity: 'BLOCKER',
            tc_id: row.tc_id,
            message: '禁止 {"action":{"type":"start_app"}}；预启由 harness 完成。',
            suggested_fix: '（删除该步骤）',
          });
        }
      }

      if (canonicalTouch && isActionWrappedTouchInputSwipeScroll(step)) {
        violations.push({
          rule_id: 'STEP-006',
          severity: 'WARN',
          tc_id: row.tc_id,
          message: '推荐使用 direct 根键（如 {"touch":{"by_text":"…"}}），action 包装为兼容形态。',
          suggested_fix: '改用 direct touch/input/swipe/scroll 根键',
        });
      }
    }
  }

  const blockers = violations.filter(v => v.severity === 'BLOCKER');
  return { ok: blockers.length === 0, violations };
}

/** Combined STEP + NAV lint for test-plan.hylyre.md */
export function lintHylyrePlanMarkdown(
  derivedMd: string,
  topCases?: DeriveHintTestCaseRow[],
  opts?: LintHylyrePlanOptions,
): LintHylyrePlanResult {
  const step = lintHylyrePlanStepRules(derivedMd, opts);
  const nav = lintDerivedHylyrePlanSteps(derivedMd, topCases);
  return { ok: step.ok && nav.ok, violations: step.violations, nav };
}

/** 将「测试步骤」单元格拆成逐步 JSON 对象（`;` / `；` 分隔） */
export function parsePlannedStepsFromCell(stepsRaw: string): { ok: true; steps: Record<string, unknown>[] } | { ok: false; error: string } {
  const normalized = normalizePlannedStepsCell(stepsRaw);
  const parts = normalized
    .split(';')
    .map(s => normalizePlannedStepFragment(s))
    .filter(Boolean);
  const steps: Record<string, unknown>[] = [];
  for (const part of parts) {
    try {
      const obj = JSON.parse(part) as unknown;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { ok: false, error: `step is not a JSON object: ${part.slice(0, 80)}` };
      }
      steps.push(obj as Record<string, unknown>);
    } catch (e) {
      return { ok: false, error: `invalid JSON step: ${(e as Error).message}` };
    }
  }
  return { ok: true, steps };
}

function swipePayloadFromStep(step: Record<string, unknown>): Record<string, unknown> | null {
  if ('swipe' in step && step.swipe && typeof step.swipe === 'object') {
    return step.swipe as Record<string, unknown>;
  }
  const act = step.action;
  if (act && typeof act === 'object' && !Array.isArray(act)) {
    const a = act as Record<string, unknown>;
    if (String(a.type || '').toLowerCase() === 'swipe') {
      return a;
    }
  }
  return null;
}

function swipeHasScrollScope(payload: Record<string, unknown>): boolean {
  return Boolean(
    payload.area ||
      payload.at ||
      payload.scroll_target ||
      (payload.area_by_type ?? payload.area_by_text ?? payload.area_by_id),
  );
}

/** NAV-001：无 area/at 的横向 swipe 不能充当 Nav 返回 */
export function isFullscreenHorizontalSwipeStep(step: Record<string, unknown>): boolean {
  const payload = swipePayloadFromStep(step);
  if (!payload) return false;
  const dir = String(payload.direction ?? '')
    .trim()
    .toUpperCase();
  const base = dir.replace(/^SWIPE_/, '');
  if (!HORIZONTAL_SWIPE_DIRS.has(base) && !HORIZONTAL_SWIPE_DIRS.has(dir)) {
    return false;
  }
  return !swipeHasScrollScope(payload);
}

export function isNavResetStep(step: Record<string, unknown>): boolean {
  const roots = Object.keys(step);
  if (roots.some(r => RESET_STEP_ROOTS.has(r))) return true;
  const act = step.action;
  if (act && typeof act === 'object' && !Array.isArray(act)) {
    const t = String((act as Record<string, unknown>).type ?? '').toLowerCase();
    if (RESET_STEP_ROOTS.has(t)) return true;
  }
  return false;
}

function touchTargetsTabChrome(step: Record<string, unknown>): boolean {
  const touch = (step.touch ?? (step.action as Record<string, unknown> | undefined)) as
    | Record<string, unknown>
    | undefined;
  if (!touch || typeof touch !== 'object') return false;
  const text = String(touch.by_text ?? '').trim();
  return text === '首页' || text === '+';
}

export function preconditionRequiresHomeTab(precondition: string): boolean {
  return /首页\s*Tab|「首页」|已在.*首页|底\s*Tab.*首页/i.test(precondition);
}

export function preconditionRequiresNavReturn(precondition: string): boolean {
  return /返回|手势返回|系统返回|回.*首页/i.test(precondition);
}

export function expectedImpliesSubPageNavigation(expected: string): boolean {
  return /进入.+页|跳转.+页|push/i.test(expected);
}

export type NavLintViolation = {
  rule_id: 'NAV-001' | 'NAV-002' | 'NAV-003';
  tc_id: string;
  message: string;
  suggested_fix: string;
};

export type LintDerivedHylyrePlanResult = {
  ok: boolean;
  violations: NavLintViolation[];
};

/**
 * 派生计划步骤静态门禁（NAV-001/002/003）。
 * @param derivedMd test-plan.hylyre.md 全文
 * @param topCases 顶层 test-plan 用例行（可选，用于 NAV-002 前置语义）
 */
export function lintDerivedHylyrePlanSteps(
  derivedMd: string,
  topCases?: DeriveHintTestCaseRow[],
): LintDerivedHylyrePlanResult {
  const violations: NavLintViolation[] = [];
  const derivedCases = extractDerivedPlanCases(derivedMd);
  const topById = new Map((topCases ?? []).map(c => [c.tc_id.toUpperCase(), c]));

  for (let i = 0; i < derivedCases.length; i++) {
    const row = derivedCases[i];
    const top = topById.get(row.tc_id);
    const precondition = top?.precondition || row.precondition;
    const expected = top?.expected || row.expected;

    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    if (!parsed.ok) {
      violations.push({
        rule_id: 'NAV-002',
        tc_id: row.tc_id,
        message: `测试步骤 JSON 无法解析：${parsed.error}`,
        suggested_fix: '{"back":{}}',
      });
      continue;
    }

    const steps = parsed.steps;

    for (const step of steps) {
      if (isFullscreenHorizontalSwipeStep(step)) {
        violations.push({
          rule_id: 'NAV-001',
          tc_id: row.tc_id,
          message:
            '全屏横向 swipe（无 area/at/scroll_target）不能代替 Nav 返回；请改用 {"back":{}} 或 {"back":{"mode":"swipe","side":"RIGHT"}}。',
          suggested_fix: '{"back":{}}',
        });
      }
    }

    if (
      preconditionRequiresNavReturn(precondition) &&
      steps.length > 0 &&
      !isNavResetStep(steps[0]) &&
      (isFullscreenHorizontalSwipeStep(steps[0]) || touchTargetsTabChrome(steps[0]))
    ) {
      violations.push({
        rule_id: 'NAV-002',
        tc_id: row.tc_id,
        message:
          '前置条件要求先系统/手势返回，但首步不是 back/home/start_app/stop_app 等复位步骤。',
        suggested_fix: '{"back":{}}',
      });
    }

    if (i > 0) {
      const prev = derivedCases[i - 1];
      const prevTop = topById.get(prev.tc_id);
      const prevExpected = prevTop?.expected || prev.expected;
      if (
        expectedImpliesSubPageNavigation(prevExpected) &&
        preconditionRequiresHomeTab(precondition) &&
        steps.length > 0 &&
        !isNavResetStep(steps[0])
      ) {
        violations.push({
          rule_id: 'NAV-003',
          tc_id: row.tc_id,
          message: `单会话 run --plan：前序用例 ${prev.tc_id} 预期进入子页，本用例前置要求首页 Tab，但首步不是 back/home/start_app/stop_app 等复位步骤。`,
          suggested_fix: '{"back":{}}',
        });
      }
    }
  }

  const seen = new Set<string>();
  const deduped = violations.filter(v => {
    const key = `${v.rule_id}:${v.tc_id}:${v.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: deduped.length === 0, violations: deduped };
}

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
