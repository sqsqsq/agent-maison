/**
 * 顶层 TC 抽取、完整派生上下文与 canonical 源语义基线。
 * check-testing 自动 writer 与 derive-hylyre-plan-hint CLI 共用，实时诊断归原 check。
 */
import { getSectionContent, extractTables, type MdTable } from './markdown-parser';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { appSnapshotCacheAbsFor, isSnapshotCacheEmpty, listSnapshotPages, resolveDefaultSnapshotBundle } from './app-snapshot-cache-hint';
import { featureDeviceTestPaths, hylyreDerivedPlanPath } from '../../config';
import { buildStandardHylyreDerivePayloadBase, resolveHylyreResetIdentity } from './hylyre-standard-derive-knowledge';
import { loadUiSpecFile, uiSpecAbsPath } from './ui-spec-shared';
import { buildSelectorContractQuery } from '../../../profiles/hmos-app/harness/selector-contract';
import { EXECUTION_CHANNEL_DOMAIN } from './execution-channel';
import { loadAcceptanceFlowsDoc, resolveCheckpointAction } from './p0-semantic-gates';
import { extractDerivedPlanCases, FORMAL_BY_TEXT_MATCHES } from './derived-hylyre-plan';
import { PLANNED_SELECTOR_DISAMBIGUATION_FIELDS } from './planned-step-normalizer';

export interface DeriveHintTestCaseRow {
  tc_id: string;
  name: string;
  precondition: string;
  steps_natural_language: string;
  expected: string;
  priority: string;
  ac_ref: string;
  /**
   * plan a6c4e9f2 T3：顶层声明的编译期执行通道原始字面量（`hylyre|visual|manual|provider:<id>`）。
   * legacy 计划无该列时为空串——派生器**不得**据此猜通道，只能报一次性迁移要求。
   */
  execution_channel: string;
}

export interface TcFreshnessBaseline { test_cases?: DeriveHintTestCaseRow[] }

export interface DerivePlanDifference {
  kind: 'text' | 'behavior' | 'missing_source' | 'source_identity' | 'runtime_inputs';
  tc_id?: string;
  field: string;
  top: unknown;
  derived: unknown;
}

export function compareDerivedPlanTcTable(top: string, derived: string, baseline?: TcFreshnessBaseline | null, derivedAfterHint = true): DerivePlanDifference | null {
  const topSection = getSectionContent(top, '测试用例');
  const derivedSection = getSectionContent(derived, '测试用例清单') ?? getSectionContent(derived, '测试用例');
  const topTable = topSection ? extractTables(topSection)[0] : undefined;
  const derivedTable = derivedSection ? extractTables(derivedSection)[0] : undefined;
  if (!topTable) return null;
  const sharedColumns = [
    ['用例编号', '编号'], ['用例名称', '名称'], ['前置条件'], ['测试步骤', '步骤'],
    ['预期结果'], ['优先级'], ['关联 AC', '关联验收标准', '关联'],
  ];
  const missingColumn = (table: MdTable | undefined, groups: string[][]) => groups.find(group => !group.some(key => table?.headers.some(header => header.includes(key))));
  const topMissing = missingColumn(topTable, [...sharedColumns, ['执行通道', 'execution_channel']]);
  const derivedMissing = missingColumn(derivedTable, sharedColumns);
  if (topMissing || derivedMissing) return { kind: 'missing_source', field: 'TC 表列', top: topMissing ? `缺 ${topMissing[0]}` : topTable.headers,
    derived: derivedMissing ? `缺 ${derivedMissing[0]}` : derivedTable?.headers };

  const rows = extractTopPlanTestCasesForDeriveHint(top);
  const compiled = new Map(extractDerivedPlanCases(derived).map(row => [row.tc_id, row]));
  const common = ['name', 'precondition', 'expected', 'priority', 'ac_ref'] as const;
  const behavior = [...common, 'steps_natural_language', 'execution_channel'] as const;
  const normalize = (key: string, value: string) => {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return ['priority', 'ac_ref', 'execution_channel'].includes(key) ? trimmed.toLowerCase() : trimmed;
  };
  const source = baseline?.test_cases;
  const prior = Array.isArray(source) && source.every(row => row && typeof row.tc_id === 'string' && behavior.every(key => typeof row[key] === 'string'))
    ? new Map(source.map(row => [row.tc_id.toUpperCase(), row])) : null;
  for (const row of rows) {
    const selected = compiled.get(row.tc_id);
    // Set coverage belongs to the existing execution-channel gate.
    if (selected) for (const field of common) if (normalize(field, row[field]) !== normalize(field, selected[field])) {
      return { kind: field === 'name' ? 'text' : 'behavior', tc_id: row.tc_id, field, top: row[field], derived: selected[field] };
    }
    if (!prior) continue;
    const from = prior.get(row.tc_id);
    if (!from) return { kind: 'missing_source', tc_id: row.tc_id, field: 'source_tc', top: row, derived: null };
    for (const field of behavior) if (normalize(field, row[field]) !== normalize(field, from[field])) {
      return { kind: field === 'name' ? 'text' : 'behavior', tc_id: row.tc_id, field, top: row[field], derived: from[field] };
    }
  }
  if (!prior) return { kind: 'missing_source', field: 'derive-hint-from-plan.json:test_cases', top: '有效顶层 TC 源快照', derived: null };
  return derivedAfterHint ? null : { kind: 'source_identity', field: 'derive-hint-from-plan.json 顺序', top: '当前源快照', derived: '所选派生早于源快照' };
}

function pickColumnIndex(table: MdTable, keywords: string[]): number {
  for (const kw of keywords) {
    const idx = table.headers.findIndex(h => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * 从 test-plan.md 全文解析；若无「测试用例」节或表格则返回空数组。
 */
export function extractTopPlanTestCasesForDeriveHint(planMd: string): DeriveHintTestCaseRow[] {
  const section = getSectionContent(planMd, '测试用例');
  if (!section) return [];
  const tables = extractTables(section);
  if (tables.length === 0) return [];

  const t = tables[0];
  const iId = pickColumnIndex(t, ['用例编号', '编号']);
  const iName = pickColumnIndex(t, ['用例名称', '名称']);
  const iPre = pickColumnIndex(t, ['前置条件']);
  const iSteps = pickColumnIndex(t, ['测试步骤', '步骤']);
  const iExp = pickColumnIndex(t, ['预期结果']);
  const iPri = pickColumnIndex(t, ['优先级']);
  const iAc = pickColumnIndex(t, ['关联 AC', '关联']);
  const iChannel = pickColumnIndex(t, ['执行通道', 'execution_channel']);

  const out: DeriveHintTestCaseRow[] = [];
  for (const row of t.rows) {
    const tcRaw = (iId >= 0 ? row[iId] : row[0] || '').trim();
    const m = tcRaw.match(/TC-\d+/i);
    if (!m) continue;
    const tc_id = m[0].toUpperCase();
    out.push({
      tc_id,
      name: (iName >= 0 ? row[iName] : '').trim(),
      precondition: (iPre >= 0 ? row[iPre] : '').trim(),
      steps_natural_language: (iSteps >= 0 ? row[iSteps] : '').trim(),
      expected: (iExp >= 0 ? row[iExp] : '').trim(),
      priority: (iPri >= 0 ? row[iPri] : '').trim(),
      ac_ref: (iAc >= 0 ? row[iAc] : '').trim(),
      execution_channel: (iChannel >= 0 ? (row[iChannel] ?? '') : '').trim(),
    });
  }
  return out;
}

/** 供 Agent 派生 test-plan.hylyre.md 时消费的导航约束（机器可读） */
export interface NavigationHint {
  requires_nav_reset: boolean;
  forbidden_patterns: string[];
  suggested_preamble_steps: string[];
  suggested_teardown_steps: string[];
  reason: string;
}

function preconditionRequiresHomeTab(precondition: string): boolean {
  return /首页\s*Tab|「首页」|已在.*首页|底\s*Tab.*首页/i.test(precondition);
}

function preconditionRequiresNavReturn(precondition: string): boolean {
  return /返回|手势返回|系统返回|需先.*返回|回.*首页/i.test(precondition);
}

function expectedImpliesSubPageNavigation(expected: string): boolean {
  return /进入.+页|跳转.+页|push/i.test(expected);
}

/** 从顶层 test-plan 单行推导导航 hint */
export function buildNavigationHintForCase(row: DeriveHintTestCaseRow): NavigationHint {
  const requires =
    preconditionRequiresNavReturn(row.precondition) ||
    (preconditionRequiresHomeTab(row.precondition) &&
      /需先|若.*已入|返回至|回到|先.*返回/i.test(row.precondition));
  const entersSubPage = expectedImpliesSubPageNavigation(row.expected);
  const forbidden_patterns: string[] = [];
  const suggested_preamble_steps: string[] = [];
  const suggested_teardown_steps: string[] = [];
  const reasons: string[] = [];

  if (requires) {
    forbidden_patterns.push('swipe.horizontal.without_area');
    suggested_preamble_steps.push('{"back":{}}');
    reasons.push('前置条件要求已在首页 Tab 或需先系统/手势返回');
  }
  if (entersSubPage) {
    suggested_teardown_steps.push('{"back":{}}');
    reasons.push('预期进入 Nav 子页；单会话 run --plan 时建议用例末 teardown');
  }

  return {
    requires_nav_reset: requires,
    forbidden_patterns,
    suggested_preamble_steps,
    suggested_teardown_steps,
    reason: reasons.join('；') || '无额外导航约束',
  };
}

export type DeriveHintTestCaseWithNav = DeriveHintTestCaseRow & {
  navigation_hint: NavigationHint;
};

export function attachNavigationHints(cases: DeriveHintTestCaseRow[]): DeriveHintTestCaseWithNav[] {
  return cases.map(c => ({
    ...c,
    navigation_hint: buildNavigationHintForCase(c),
  }));
}

/** Only source behavior and executable grammar version the canonical hint. */
export function deriveHintSemanticInputs(value: unknown): unknown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, any>;
  const source = p.source ?? p.source_relative;
  if (p.schema !== 4 || typeof source !== 'string' || typeof p.feature !== 'string' || !Array.isArray(p.test_cases)) return null;
  const fields = ['tc_id', 'name', 'precondition', 'steps_natural_language', 'expected', 'priority', 'ac_ref', 'execution_channel'];
  if (p.test_cases.some((row: any) => !row || fields.some(key => typeof row[key] !== 'string'))) return null;
  if (!Array.isArray(p.allowed_step_roots) || !Array.isArray(p.forbidden_in_steps) || !p.step_shape_catalog || !p.wait_field_timing_ref || typeof p.reset_preamble?.available !== 'boolean') return null;
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const reset = p.reset_preamble;
  if (reset.available && (typeof reset.bundle !== 'string' || typeof reset.page_name !== 'string' || !Array.isArray(reset.order) || typeof reset.position !== 'string')) return null;
  return {
    schema: p.schema, feature: p.feature, source: path.posix.normalize(source.replace(/\\/g, '/')),
    test_cases: p.test_cases.map((row: DeriveHintTestCaseWithNav) => {
      const nav = row.navigation_hint ?? buildNavigationHintForCase(row);
      return {
      ...Object.fromEntries(fields.map(key => {
        let text = norm(row[key as keyof DeriveHintTestCaseRow]);
        if (['tc_id', 'priority', 'ac_ref'].includes(key)) text = text.toUpperCase();
        if (key === 'execution_channel') text = text.toLowerCase();
        return [key, text];
      })),
      // Legacy schema 4 can reconstruct navigation only from its own recorded row.
      navigation_hint: {
        requires_nav_reset: nav.requires_nav_reset, forbidden_patterns: nav.forbidden_patterns,
        suggested_preamble_steps: nav.suggested_preamble_steps, suggested_teardown_steps: nav.suggested_teardown_steps,
      },
    }; }),
    allowed_step_roots: p.allowed_step_roots, forbidden_in_steps: p.forbidden_in_steps,
    step_shape_catalog: p.step_shape_catalog, wait_field_timing_ref: p.wait_field_timing_ref,
    acceptance_assertions: p.acceptance_assertions ?? [],
    reset_preamble: reset.available
      ? { available: true, bundle: reset.bundle, page_name: reset.page_name, position: reset.position, order: reset.order }
      : { available: false },
    execution_channel_policy: {
      domain: p.execution_channel_policy?.domain ?? EXECUTION_CHANNEL_DOMAIN,
      executable_channels: p.execution_channel_policy?.executable_channels ?? ['hylyre'],
    },
    // Schema 4's fixed syntax was implicit in old automatic hints, not a missing source snapshot.
    selector_contract: {
      match_modes: p.selector_contract?.match_modes ?? ['exact', 'contains'],
      disambiguation_fields: p.selector_contract?.disambiguation_fields ?? ['index', 'scope', 'within', 'all'],
    },
  };
}

export function compareDeriveHintSource(prior: unknown, current: unknown): DerivePlanDifference | null {
  const a = deriveHintSemanticInputs(prior) as Record<string, unknown> | null;
  const b = deriveHintSemanticInputs(current) as Record<string, unknown> | null;
  if (!a || !b) return { kind: 'missing_source', field: 'derive-hint-from-plan.json', top: '有效顶层源和执行条件', derived: null };
  // Object keys are presentation; arrays retain their executable ordering.
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, stable(v[key])])) : v;
  for (const field of Object.keys(b)) if (JSON.stringify(stable(a[field])) !== JSON.stringify(stable(b[field]))) {
    const kind = ['feature', 'source', 'schema'].includes(field) ? 'source_identity'
      : field === 'reset_preamble' ? 'runtime_inputs' : 'behavior';
    return { kind, field, top: b[field], derived: a[field] };
  }
  return null;
}

export function sameDeriveHintInputs(prior: unknown, current: unknown): boolean {
  return compareDeriveHintSource(prior, current) === null;
}

/** Fresh auxiliary output is returned even when the persisted source baseline stays untouched. */
export function writeCanonicalDeriveHint(target: string, current: Record<string, any>): { payload: Record<string, any>; updated: boolean } {
  let prior: Record<string, any> | null = null;
  try { prior = JSON.parse(fs.readFileSync(target, 'utf8')); } catch { /* Missing/bad baseline is rebuilt from the actual source. */ }
  if (sameDeriveHintInputs(prior, current)) {
    return { payload: { ...current, generated_at: prior!.generated_at }, updated: false };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return { payload: current, updated: true };
}

/** Canonical source and full current authoring context, shared by both production writers. */
export function buildCanonicalDeriveHintPayload(projectRoot: string, feature: string, planMd?: string): Record<string, any> {
  const { topPlan: resolved, reportsDir, stableDerivedPlan } = featureDeviceTestPaths(projectRoot, feature);
  const relative = (file: string) => path.relative(projectRoot, file).replace(/\\/g, '/');
  const raw = planMd ?? (resolved.exists ? fs.readFileSync(resolved.actualPath, 'utf8') : '');
  const test_cases = attachNavigationHints(extractTopPlanTestCasesForDeriveHint(raw));
  const snapshotBundle = resolveDefaultSnapshotBundle(projectRoot);
  const cacheAbs = appSnapshotCacheAbsFor(projectRoot);
  const snapshot_cache_empty = snapshotBundle
    ? isSnapshotCacheEmpty(cacheAbs, snapshotBundle)
    : true;
  const available_pages = snapshotBundle ? listSnapshotPages(cacheAbs, snapshotBundle) : [];
  const uiSpec = loadUiSpecFile(uiSpecAbsPath(projectRoot, feature));
  const selector_contract = uiSpec ? buildSelectorContractQuery(uiSpec, feature) : [];
  const criteria = loadAcceptanceFlowsDoc(projectRoot, feature)?.criteria ?? [];
  const acceptanceAssertions = criteria.filter(item => item.checkpoint?.assertions?.length).map(item => ({ id: item.id, assertions: item.checkpoint!.assertions }));
  const returnActions = criteria.flatMap(item => {
    const cp = item.checkpoint;
    const action = resolveCheckpointAction(cp?.action);
    if (!cp || action?.kind !== 'back') return [];
    return [{ id: item.id, pre_screen: cp.pre_screen, pre_screen_element_id: cp.pre_screen_element_id,
      step: { back: action.mode === 'key' ? {} : { mode: action.mode, side: action.side } },
      post_screen: cp.post_screen, required_element_ids: cp.required_element_ids, forbidden_element_ids: cp.forbidden_element_ids }];
  });
  const derivedInput = relative(hylyreDerivedPlanPath(reportsDir, '<轮次>'));

  return {
    // t7a（plan e6a3c9f4）：统一基座（与 check-testing 自动 hint 同源，schema/知识块永不分叉）
    ...buildStandardHylyreDerivePayloadBase(resolveHylyreResetIdentity(projectRoot)),
    feature,
    source: relative(resolved.actualPath),
    stable_derived_reference: relative(stableDerivedPlan),
    derived_execution_input: derivedInput,
    snapshot_bundle: snapshotBundle || null,
    snapshot_cache_empty,
    available_pages,
    selector_contract: {
      rule_id: 'SELECTOR-SPEC-001',
      policy:
        'snapshot-cache/device dump only discover candidates; the feature ui-spec is an OPEN WORLD static hint (pre-existing entry screens are legitimately absent) and a miss is a provenance WARN, not proof of an illegal selector — the run\'s own native StepResult selector evidence is the final truth; formal by_text MUST explicitly declare match exact|contains chosen by acceptance intent; runtime MUST NOT fallback',
      static_blockers:
        'only determinable errors block: illegal selector/match, missing explicit by_text match, a ui-spec-proven same-screen multi-mapping without index/scope/within/all, a contains hit that only matches an aggregate Text/Row with children, and a structured acceptance conflict (same checkpoint action target_element_id != the plan action by_id)',
      match_modes: [...FORMAL_BY_TEXT_MATCHES],
      match_selection:
        'Maison/agent chooses exact or contains from acceptance intent; never infer contains from digits/date or other text shape',
      disambiguation_fields: [...PLANNED_SELECTOR_DISAMBIGUATION_FIELDS],
      entries: selector_contract,
    },
    navigation_discipline:
      '系统返回用 {"back":{}}，边缘返回用 {"back":{"mode":"swipe","side":"RIGHT"}}（按 checkpoint 换成 LEFT 或 RIGHT）。每次返回前以裸 by_id wait_for 观察实际起始屏，返回后按 checkpoint 核后置屏及禁止元素。禁止无 area/at 的普通横向 swipe 代替返回。',
    next_agent_step:
      `按 profile「真机自动化」与「单会话导航纪律」把派生计划写入 ${derivedInput}，遵守各 test_cases[].navigation_hint。顶层 test-plan.md 为 SSOT。差异与 lint 诊断见本轮 script-report.json 的 device_test_run.structured.derive_hint。`,
    execution_channel_policy: {
      domain: EXECUTION_CHANNEL_DOMAIN,
      executable_channels: ['hylyre'],
      source: 'top-level test-plan.md 「执行通道」column (compile-time dispatch, part of plan identity)',
      derive_authority:
        'compile EXACTLY the channel=hylyre set; never add, remove, or rewrite a channel; never emit explicit_skip_tc_ids',
      all_or_nothing:
        'if any channel=hylyre case cannot be compiled (step lint, selector BLOCKER, unparseable steps, or no same-case setup/navigation action before its first assertion), do NOT produce a runnable plan — report that case root cause and the next responsible phase instead',
      setup_before_assertion:
        'every channel=hylyre case MUST contain at least one setup/navigation action before its first assertion step in the same case (STEP-SETUP); current_app/has_app/get_component_property are query actions and do not count as setup; do not rely on screen state left by another case',
      manual_note:
        'manual:<known_class> with no tool primitive is an unsupported_gap: keep it in the denominator, never count it as PASS, and allow completion with disclosure; bare manual or an unknown class is invalid_test before device execution',
    },
    ...(acceptanceAssertions.length ? { acceptance_assertions: acceptanceAssertions } : {}),
    ...(returnActions.length ? { acceptance_return_actions: returnActions } : {}),
    test_cases,
  };
}
