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
import { validatePlannedStepObject } from './hylyre-planned-step-lint';
import { normalizePlannedSteps } from './planned-step-normalizer';

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

export type EvaluateChannelCoverageInput = {
  /** 顶层声明 execution_channel=hylyre 的 TC 集合 */
  hylyreTcIds: string[];
  derivedTcIds: string[];
  /** 历史产物里的 explicit skip（只用于**解释**缺口，绝不参与减除） */
  legacyExplicitSkipTcIds?: string[];
};

export type EvaluateChannelCoverageResult = {
  ok: boolean;
  /** hylyre − derived：派生器必须全有或全无，缺任何一条都不得启动整份计划 */
  missing: string[];
  /** derived − hylyre：派生器无权把其它通道的 TC 拉进 Hylyre 执行集合 */
  extra: string[];
  /** missing ∩ legacy explicit skip：显式点名"被 skip 洗掉"的缺口，仍计入 missing */
  laundered_skips: string[];
};

/**
 * plan a6c4e9f2 T3：通道精确覆盖。与 legacy `evaluateDerivedCoverage` 的关键差别是
 * **explicit skip 不再减除缺口**——派生器没有 skip 决策权，Hylyre 集合由顶层通道声明，
 * 少一条就是编译失败而不是"已覆盖"。
 */
export function evaluateChannelDerivedCoverage(
  inp: EvaluateChannelCoverageInput,
): EvaluateChannelCoverageResult {
  const hylyre = [...new Set(inp.hylyreTcIds.map(x => x.toUpperCase()))];
  const derived = new Set(inp.derivedTcIds.map(x => x.toUpperCase()));
  const hylyreSet = new Set(hylyre);
  const skips = new Set((inp.legacyExplicitSkipTcIds ?? []).map(x => x.toUpperCase()));
  const missing = hylyre.filter(id => !derived.has(id)).sort();
  const extra = [...derived].filter(id => !hylyreSet.has(id)).sort();
  return {
    ok: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    laundered_skips: missing.filter(id => skips.has(id)),
  };
}

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

export const FORMAL_BY_TEXT_MATCHES = ['exact', 'contains'] as const;
export type FormalByTextMatch = (typeof FORMAL_BY_TEXT_MATCHES)[number];

/**
 * T2：正式 feature 派生计划中的 by_text 必须显式选择 Hylyre 的匹配语义。
 * 这里只校验结构和值域，不替作者决定 exact/contains；该选择来自 acceptance 意图。
 * 递归检查 within/all/in 等既有富选择器，避免嵌套 by_text 依赖未声明的默认值。
 */
export function validateFormalByTextSelectors(step: unknown): Array<{
  path: string;
  message: string;
}> {
  const violations: Array<{ path: string; message: string }> = [];
  const visit = (value: unknown, valuePath: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${valuePath}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.by_text === 'string' && record.by_text.trim().length > 0) {
      const match = record.match;
      if (typeof match !== 'string' || !FORMAL_BY_TEXT_MATCHES.includes(match as FormalByTextMatch)) {
        violations.push({
          path: valuePath,
          message:
            typeof match === 'string'
              ? `by_text 的 match=${JSON.stringify(match)} 非法；正式派生计划只允许 exact/contains，禁止运行时静默放宽`
              : '正式 by_text selector 必须显式声明 match: exact|contains；请按 acceptance 意图选择，不能依赖执行器默认值',
        });
      }
    }
    for (const [key, nested] of Object.entries(record)) {
      visit(nested, `${valuePath}.${key}`);
    }
  };
  visit(step, '$');
  return violations;
}

export type StepLintViolation = {
  rule_id:
    | 'STEP-001'
    | 'STEP-002'
    | 'STEP-003'
    | 'STEP-004'
    | 'STEP-005'
    | 'STEP-006'
    | 'STEP-007'
    | 'STEP-SETUP'
    | 'STEP-WAIT'
    | 'STEP-WAIT-SECONDS';
  severity: 'BLOCKER' | 'WARN';
  tc_id: string;
  message: string;
  suggested_fix: string;
};

function suggestedFixForSharedStepLint(ruleId: string): string {
  if (ruleId === 'STEP-WAIT-SECONDS') return '{"wait":{"seconds":2}}';
  if (ruleId === 'STEP-WAIT') return '{"wait_for":{"by_text":"…","match":"exact","timeout":10}}';
  return '{"touch":{"by_text":"…","match":"exact"}}';
}

export type LintHylyrePlanResult = {
  ok: boolean;
  violations: StepLintViolation[];
  nav: LintDerivedHylyrePlanResult;
};

/** plan b3d7e5a1 T4：harness 预启同源身份（安装候选 bundleName + hypium_page_name/entry mainElement）。 */
export interface HylyreResetIdentity {
  bundle: string;
  page_name: string;
}

const LIFECYCLE_STEP_ROOTS = new Set(['start_app', 'stop_app']);

function singleRootOf(step: Record<string, unknown> | undefined): string {
  if (!step) return '';
  const roots = stepRootKeys(step);
  return roots.length === 1 ? roots[0]! : '';
}

/**
 * plan b3d7e5a1 T4（STEP-003）：case 首部受限复位前奏。
 * 判据只有一条：index 0 才可为 stop_app、index 1 才可为 start_app（且 index 0 必须是 stop_app），
 * 其它任何位置出现 start_app/stop_app 根键即 BLOCKER——由此保证前奏成对、至多一组、只在首部。
 * 前奏在场时 bundle/page_name 必须逐字等于 harness 预启身份；身份不可解析 → BLOCKER 而不是放行。
 * `forbidStartApp:true` 是即席语义：harness 冷重启负责复位，steps 内 start_app 一律禁止。
 */
function lintResetPreamble(
  steps: Record<string, unknown>[],
  tcId: string,
  opts: { forbidStartApp: boolean; resetIdentity?: HylyreResetIdentity | null },
): StepLintViolation[] {
  const out: StepLintViolation[] = [];
  const push = (message: string, suggested_fix: string): void => {
    out.push({ rule_id: 'STEP-003', severity: 'BLOCKER', tc_id: tcId, message, suggested_fix });
  };
  if (opts.forbidStartApp) {
    steps.forEach((step, index) => {
      if (singleRootOf(step) === 'start_app') {
        push(`step #${index}：即席 steps 禁止 start_app（harness 冷重启负责复位）。`, '（删除 start_app 步骤）');
      }
    });
    return out;
  }
  const PREAMBLE_FIX =
    '复位只允许 case 首部恰好一组：{"stop_app":{"bundle":B}}; {"start_app":{"bundle":B,"page_name":P}}' +
    '（B/P 见 derive hint 的 reset_preamble），其它位置删除该步骤';
  const hasPreamble = singleRootOf(steps[0]) === 'stop_app';
  steps.forEach((step, index) => {
    const root = singleRootOf(step);
    if (!LIFECYCLE_STEP_ROOTS.has(root)) return;
    if (index === 0 && root === 'stop_app') return;
    if (index === 1 && root === 'start_app' && hasPreamble) return;
    push(
      `step #${index} 的 ${root} 不在合法复位前奏位置：只允许 index 0 为 stop_app、index 1 为 start_app（恰好一组、只在 case 首部）；` +
        (root === 'start_app' && index === 0 ? 'start_app 前必须紧跟 stop_app。' : '其它位置一律禁止。'),
      PREAMBLE_FIX,
    );
  });
  if (!hasPreamble) return out;
  if (singleRootOf(steps[1]) !== 'start_app') {
    push('stop_app 必须被紧邻的 start_app 闭合（stop_app→start_app 成对），不能单独出现。', PREAMBLE_FIX);
    return out;
  }
  const identity = opts.resetIdentity;
  if (!identity) {
    push(
      '无法解析 harness 预启身份（安装候选 bundleName / tools.hylyre.hypium_page_name 或 entry mainElement），复位前奏不可验证：修复身份来源或删除前奏。',
      PREAMBLE_FIX,
    );
    return out;
  }
  const stop = steps[0]!.stop_app as Record<string, unknown> | undefined;
  const start = steps[1]!.start_app as Record<string, unknown> | undefined;
  const problems: string[] = [];
  if (stop?.bundle !== identity.bundle) problems.push(`stop_app.bundle=${JSON.stringify(stop?.bundle ?? null)} ≠ ${identity.bundle}`);
  if (start?.bundle !== identity.bundle) problems.push(`start_app.bundle=${JSON.stringify(start?.bundle ?? null)} ≠ ${identity.bundle}`);
  if (start?.page_name !== identity.page_name) problems.push(`start_app.page_name=${JSON.stringify(start?.page_name ?? null)} ≠ ${identity.page_name}`);
  if (problems.length > 0) {
    push(
      `复位前奏身份与 harness 预启不一致：${problems.join('；')}（来源：安装候选 bundleName + tools.hylyre.hypium_page_name/entry mainElement；派生不得自拟）。`,
      PREAMBLE_FIX,
    );
  }
  return out;
}

export type LintHylyrePlanOptions = {
  /** true = 即席语义：steps 内 start_app 一律禁止；默认 false = 正式路径的受限复位前奏（plan b3d7e5a1 T4） */
  forbidStartApp?: boolean;
  /** 正式路径：harness 预启同源身份；前奏在场而身份为 null → BLOCKER */
  resetIdentity?: HylyreResetIdentity | null;
  canonicalTouch?: boolean;
  /** When false, STEP-005 backtick is WARN only (post-normalize retry path). */
  backtickBlocker?: boolean;
};

/** STEP-001~007 static lint on derived plan markdown. */
export function lintHylyrePlanStepRules(
  derivedMd: string,
  opts?: LintHylyrePlanOptions,
): { ok: boolean; violations: StepLintViolation[] } {
  const violations: StepLintViolation[] = [];
  const forbidStartApp = opts?.forbidStartApp === true;
  const canonicalTouch = opts?.canonicalTouch !== false;
  const backtickBlocker = opts?.backtickBlocker !== false;

  for (const row of extractDerivedPlanCases(derivedMd)) {
    if (hasMarkdownBacktickInCell(row.steps_raw)) {
      violations.push({
        rule_id: 'STEP-005',
        severity: backtickBlocker ? 'BLOCKER' : 'WARN',
        tc_id: row.tc_id,
        message: '测试步骤列含 Markdown 反引号；Hylyre _JSONISH 无法识别，请使用裸 JSON。',
        suggested_fix: '去除 Markdown 反引号，并为每个 by_text 按 acceptance 意图显式补 match: exact|contains。',
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
        suggested_fix: '{"touch":{"by_text":"…","match":"exact"}}',
      });
      continue;
    }

    // plan a6c4e9f2 D4/T3（wrong-screen 最低防线）：每个 Hylyre case 的首个 assertion
    // 之前必须在同 case 至少有一个 setup/navigation action。这是结构最小规则，不解析
    // precondition 散文、不推导跨 case screen state、不建可达性状态机。
    // 事故形态：入口 case 被跳过后，TC-015 的首断言直接在首页求值——设备从未进入目标页，
    // 失败却被当成产品缺陷。
    const normalizedForSetup = normalizePlannedSteps(parsed.steps);
    const firstAssertionIndex = normalizedForSetup.findIndex(step => step.role === 'assertion');
    if (firstAssertionIndex >= 0) {
      const hasPrecedingAction = normalizedForSetup
        .slice(0, firstAssertionIndex)
        .some(step => step.role === 'action');
      if (!hasPrecedingAction) {
        violations.push({
          rule_id: 'STEP-SETUP',
          severity: 'BLOCKER',
          tc_id: row.tc_id,
          message:
            `首个 assertion（step #${firstAssertionIndex}）之前没有同 case 的 setup/navigation action：` +
            '该断言会在未进入目标页时求值，失败会被误归产品缺陷。请在本 case 内补入口动作，' +
            '不要依赖其它 case 遗留的屏幕状态。',
          suggested_fix: '在首个断言前补同 case 入口动作，例如 {"touch":{"by_id":"…"}} 或 {"back":{}}',
        });
      }
    }

    violations.push(...lintResetPreamble(parsed.steps, row.tc_id, { forbidStartApp, resetIdentity: opts?.resetIdentity }));

    for (let stepIndex = 0; stepIndex < parsed.steps.length; stepIndex++) {
      const step = parsed.steps[stepIndex];
      const roots = stepRootKeys(step);
      if (roots.length !== 1) {
        violations.push({
          rule_id: 'STEP-001',
          severity: 'BLOCKER',
          tc_id: row.tc_id,
          message: `每步须恰好一个 JSON 根键，实际：${roots.join(', ') || '(empty)'}`,
          suggested_fix: '{"touch":{"by_text":"…","match":"exact"}}',
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
          suggested_fix: '{"touch":{"by_text":"…","match":"exact"}}',
        });
      } else if (!PLANNED_STEP_ROOT_KEY_SET.has(root)) {
        violations.push({
          rule_id: 'STEP-001',
          severity: 'BLOCKER',
          tc_id: row.tc_id,
          message: `未知步骤根键 "${root}"；允许：${[...PLANNED_STEP_ROOT_KEY_SET].join(', ')}`,
          suggested_fix: '{"touch":{"by_text":"…","match":"exact"}}',
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
          message: '推荐使用 direct 根键（如 {"touch":{"by_text":"…","match":"exact"}}），action 包装为兼容形态。',
          suggested_fix: '改用 direct touch/input/swipe/scroll 根键',
        });
      }

      for (const v of validateFormalByTextSelectors(step)) {
        violations.push({
          rule_id: 'STEP-007',
          severity: 'BLOCKER',
          tc_id: row.tc_id,
          message: `${v.path}：${v.message}`,
          suggested_fix: '根据 acceptance 意图显式填写 "match":"exact" 或 "match":"contains"；不要按数字/日期等字符启发式选择',
        });
      }

      for (const v of validatePlannedStepObject(step, stepIndex)) {
        if (v.rule_id !== 'STEP-WAIT' && v.rule_id !== 'STEP-WAIT-SECONDS') continue;
        violations.push({
          rule_id: v.rule_id,
          severity: 'BLOCKER',
          tc_id: row.tc_id,
          message: v.message,
          suggested_fix: suggestedFixForSharedStepLint(v.rule_id),
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

/** 将「测试步骤」单元格拆成逐步 JSON 对象（`;` / `；` 分隔）。
 * `stepTexts` 保留 Hylyre 实际执行的规范化 JSON 文本，用于跨语言逐字节绑定。 */
export function parsePlannedStepsFromCell(stepsRaw: string):
  | { ok: true; steps: Record<string, unknown>[]; stepTexts: string[] }
  | { ok: false; error: string } {
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
  return { ok: true, steps, stepTexts: parts };
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

// ============================================================================
// run-directory-freshness（plan 420a5005，2026-08-12 宿主实测纠偏项）
// ============================================================================
// 事故：执行产物写回旧 timestamp 目录——宿主 bc-openCard 08-12 的 trace/report 被写进
// `testing/reports/20260810T184000-codex-testing/`（目录名 08-10、内容 08-12），同目录
// 顶层 test-report.md 仍是 08-10 旧件，读者无法从目录名判断执行时间。
// 落点（复制前移，零新机制）：每次执行新建 <timestamp>/hylyre/ 目录，把选中的
// test-plan.hylyre.md（及同目录 derive-manifest.json，若存在）**原样复制**到新目录；
// 本轮 test-report.md / trace.json / failures/ 全写入新目录；原派生目录保持字节不变
// （只读输入）；新目录已存在则 fail-closed，不覆盖、不复用。
// 消费者无需改动：选择器按 mtime 从新到旧取，刚复制的新目录 mtime 最新自然被选中；
// evidence composer / trace resolver 从 dirname(trace) 读取，因同置于新目录而继续成立。
// ----------------------------------------------------------------------------

/**
 * `<timestamp>` 目录名：UTC ISO 压缩形态（如 `20260814T024500Z-123`），与宿主惯例
 * 一致并保留毫秒精度——同秒连续执行仍产生互异目录（review P1：秒级截断会让同秒
 * 第二次执行撞同名目录）。
 */
export function hylyreRunTimestamp(nowMs?: number): string {
  const d = new Date(nowMs ?? Date.now());
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return d
    .toISOString()
    .replace(/[-:.]/g, '')
    .replace(/(\d{4}T\d{6})\d+Z$/, `$1Z-${ms}`);
}

export type FreshHylyreRunDirResult =
  | { ok: true; runDir: string; hylyrePlanAbsPath: string; copiedManifest: boolean }
  | { ok: false; error: string };

/**
 * 为本轮执行准备全新的 `<reportsBase>/<timestamp>/hylyre/` 目录并复制选中派生计划。
 * fail-closed：目标目录已存在 → 返回失败（不覆盖、不复用、零写入）。
 * **原子认领（review P1）**：用排他式 mkdir（无 recursive）作目录占位——`recursive:true`
 * 的 mkdir 在目录已存在时只是成功返回，配合前置 existsSync 存在 TOCTOU，两个并发进程
 * 可能同时通过检查后各自复制覆盖；`mkdir` 非 recursive 时对已存在目录抛 `EEXIST`，
 * 天然互斥，捕获 EEXIST 即按冲突 fail-closed。
 */
export function prepareFreshHylyreRunDir(opts: {
  reportsBase: string;
  sourceHylyrePlanAbsPath: string;
  nowMs?: number;
}): FreshHylyreRunDirResult {
  const { reportsBase, sourceHylyrePlanAbsPath } = opts;
  if (!fs.existsSync(sourceHylyrePlanAbsPath)) {
    return { ok: false, error: `源派生计划不存在：${sourceHylyrePlanAbsPath}` };
  }
  const stamp = hylyreRunTimestamp(opts.nowMs);
  const runDir = path.join(reportsBase, stamp, 'hylyre');
  try {
    // 排他式认领：父目录需先存在——reportsBase 由调用方保证（featurePhaseReportsDir 建模）
    fs.mkdirSync(path.dirname(runDir), { recursive: true });
    fs.mkdirSync(runDir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return {
        ok: false,
        error: `本轮执行目录已存在（原子认领冲突）：${runDir}——不覆盖、不复用（run-directory-freshness fail-closed；如为并发/重入，请勿复用旧 timestamp 目录，改由下一轮新目录承载）`,
      };
    }
    return { ok: false, error: `无法创建本轮执行目录：${(e as Error).message}` };
  }
  const hylyrePlanAbsPath = path.join(runDir, 'test-plan.hylyre.md');
  fs.copyFileSync(sourceHylyrePlanAbsPath, hylyrePlanAbsPath);

  // 同目录 derive-manifest.json 若存在一并复制（显式 skip 登记随执行目录走）
  const manifestSrc = path.join(path.dirname(sourceHylyrePlanAbsPath), 'derive-manifest.json');
  let copiedManifest = false;
  if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(manifestSrc, path.join(runDir, 'derive-manifest.json'));
    copiedManifest = true;
  }
  // 复制件的 mtime 以本次执行时点为准（选择器按 mtime 从新到旧取，新目录须为最新）
  const stampMs = opts.nowMs ?? Date.now();
  fs.utimesSync(hylyrePlanAbsPath, stampMs / 1000, stampMs / 1000);
  if (copiedManifest) {
    fs.utimesSync(path.join(runDir, 'derive-manifest.json'), stampMs / 1000, stampMs / 1000);
  }
  return { ok: true, runDir, hylyrePlanAbsPath, copiedManifest };
}
