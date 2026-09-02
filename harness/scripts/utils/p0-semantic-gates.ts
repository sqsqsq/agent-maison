// ============================================================================
// p0-semantic-gates.ts — P0 acceptance coverage + native StepResult reconciliation
// （testing-stepresult-evidence；openspec harness-gates delta）
// ============================================================================
// CaseResult.execution/verification/evidence 与同一 case 的 steps[] 是唯一执行事实；
// 计划只提供 checkpoint 义务和 step index，旧 status/报告文本不能洗白缺证据或 explicit skip。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { receiptDirPath, resolveFeatureArtifact } from '../../config';
// e9d4b7a3 t2：AC/BD id 词法 SSOT 由 acceptance 侧承载，行内引用解析不再自写第二套正则
import { extractAcceptanceIdRefs } from './check-acceptance';
import {
  extractDerivedPlanCases,
  loadExplicitSkipTcIds,
  parsePlannedStepsFromCell,
  selectBestNonPlaceholderDerivedPlan,
} from './derived-hylyre-plan';
import { extractTables, getSectionContent } from './markdown-parser';
import type { CheckResult } from './types';
import type {
  HylyreEvidenceGateResult,
  HylyreStepResult,
  HylyreTrace,
  HylyreTraceCase,
} from '../../../profiles/hmos-app/harness/providers/device-test-run';
import {
  loadUiSpecFile,
  uiSpecAbsPath,
  type UiSpecDoc,
} from './ui-spec-shared';
import {
  buildCanonicalSelectorIndex,
  canonicalIdsForPlannedStep,
  normalizePlannedStep,
  type CanonicalSelectorIndex,
} from './planned-step-normalizer';

// ----------------------------------------------------------------------------
// acceptance.yaml 扩展 schema（flows + checkpoint + requirement_ref）
// ----------------------------------------------------------------------------

export interface AcCheckpoint {
  pre_screen?: string;
  action?: { type?: string; target_element_id?: string; value_class?: string };
  post_screen?: string;
  required_element_ids?: string[];
  forbidden_element_ids?: string[];
}

export interface AcRequirementRef {
  source_path?: string;
  locator?: string;
  snippet?: string;
  // snippet_sha256 已退役（openspec runner-owned-machine-facts）：hash 是机器可派生
  // 事实，门禁自行读源文档验 snippet 逐字在场——存量 YAML 中的该字段被忽略，无需迁移。
}

export interface AcceptanceCriterion {
  id: string;
  priority?: string;
  ut_layer?: string;
  linked_flow?: string;
  description?: string;
  checkpoint?: AcCheckpoint;
  requirement_ref?: AcRequirementRef;
}

export interface AcceptanceFlowsDoc {
  flows: Record<string, string[]>;
  criteria: AcceptanceCriterion[];
}

export function loadAcceptanceFlowsDoc(projectRoot: string, feature: string): AcceptanceFlowsDoc | null {
  const res = resolveFeatureArtifact(projectRoot, feature, 'acceptance.yaml');
  if (!res.exists) return null;
  try {
    const doc = YAML.parse(fs.readFileSync(res.actualPath, 'utf-8')) as {
      flows?: Record<string, { screens?: string[] } | string[]>;
      criteria?: AcceptanceCriterion[];
    };
    const flows: Record<string, string[]> = {};
    for (const [name, v] of Object.entries(doc?.flows ?? {})) {
      const screens = Array.isArray(v) ? v : v?.screens;
      if (Array.isArray(screens) && screens.every((s) => typeof s === 'string')) {
        flows[name] = screens as string[];
      }
    }
    return { flows, criteria: Array.isArray(doc?.criteria) ? doc!.criteria! : [] };
  } catch {
    return null;
  }
}

export function isP0DeviceInteractive(ac: AcceptanceCriterion): boolean {
  const layer = (ac.ut_layer ?? '').toLowerCase();
  return ac.priority === 'P0' && (layer === 'device' || layer === 'both') && Boolean(ac.linked_flow);
}

function checkpointComplete(cp: AcCheckpoint | undefined): boolean {
  return Boolean(
    cp &&
      cp.pre_screen &&
      cp.post_screen &&
      cp.action?.target_element_id &&
      Array.isArray(cp.required_element_ids) &&
      cp.required_element_ids.length > 0,
  );
}

// ----------------------------------------------------------------------------
// t4a：check-spec 侧——结构化 checkpoint + 三约束 + requirement_ref 验存
// ----------------------------------------------------------------------------

export function evaluateAcceptanceFlowStructure(projectRoot: string, feature: string): CheckResult[] {
  const id = 'acceptance_flow_structure';
  const description = 'P0 交互 AC 结构化 checkpoint + flows 三约束 + requirement_ref 验存';
  const doc = loadAcceptanceFlowsDoc(projectRoot, feature);
  if (!doc) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: 'acceptance.yaml 不存在/不可解析。' }];
  }
  const p0 = doc.criteria.filter(isP0DeviceInteractive);
  if (p0.length === 0) {
    return [{ id, category: 'structure', description, severity: 'BLOCKER', status: 'PASS', details: '无 P0 device 交互型 AC，flows 约束不适用。' }];
  }
  const failures: string[] = [];

  // ① P0 交互 AC 必须有完整结构化 checkpoint（纯自然语言锚点 FAIL——rev3 起 P0 不降级）
  for (const ac of p0) {
    if (!checkpointComplete(ac.checkpoint)) {
      failures.push(`${ac.id}：缺完整结构化 checkpoint（pre_screen/action.target_element_id/post_screen/required_element_ids）`);
    }
  }

  // ② requirement_ref 验存：snippet 逐字存在于源文档（引文级可追溯）。
  //    snippet_sha256 已退役——hash 是机器可派生事实，不让 agent 用 shell 计算再抄写
  //    （宿主实锤 20260815：无 shell 权限的 headless agent 在此烧掉整个 attempt）；
  //    存量 YAML 里的该字段被忽略，不校验、不要求迁移。
  for (const ac of p0) {
    const ref = ac.requirement_ref;
    if (!ref?.source_path || !ref.snippet) {
      failures.push(`${ac.id}：缺 requirement_ref{source_path,snippet}`);
      continue;
    }
    const abs = path.resolve(projectRoot, ref.source_path);
    if (!abs.startsWith(path.resolve(projectRoot) + path.sep) || !fs.existsSync(abs)) {
      failures.push(`${ac.id}：requirement_ref.source_path 不存在：${ref.source_path}`);
      continue;
    }
    const sourceText = fs.readFileSync(abs, 'utf-8').replace(/\r\n/g, '\n');
    if (!sourceText.includes(ref.snippet.replace(/\r\n/g, '\n'))) {
      failures.push(`${ac.id}：requirement_ref.snippet 在源文档中不存在（引文伪造/漂移）`);
    }
  }

  // ③ flows 三约束：每条边被 ≥1 P0 checkpoint 拥有；checkpoint 边必须在其 flow 中相邻；
  //    flow=checkpoint edges 有序合成（无 AC 支撑的跳边 FAIL）
  const edgeOwners = new Map<string, string[]>(); // "flow|pre>post" → ac ids
  for (const ac of p0) {
    if (!checkpointComplete(ac.checkpoint) || !ac.linked_flow) continue;
    const cp = ac.checkpoint!;
    const flow = doc.flows[ac.linked_flow];
    if (!flow) {
      failures.push(`${ac.id}：linked_flow=${ac.linked_flow} 未在 flows 注册`);
      continue;
    }
    const preIdx = flow.indexOf(cp.pre_screen!);
    const postIdx = flow.indexOf(cp.post_screen!);
    if (preIdx < 0 || postIdx < 0) {
      failures.push(`${ac.id}：checkpoint 屏 ${cp.pre_screen}→${cp.post_screen} 不在 flow ${ac.linked_flow} 声明的屏序内`);
      continue;
    }
    if (postIdx !== preIdx + 1 && postIdx !== preIdx) {
      failures.push(
        `${ac.id}：checkpoint 边 ${cp.pre_screen}→${cp.post_screen} 是无 AC 支撑的跳边` +
          `（flow ${ac.linked_flow} 中二者不相邻——bank_list→add_success 型错误建模）`,
      );
      continue;
    }
    if (postIdx === preIdx + 1) {
      const key = `${ac.linked_flow}|${cp.pre_screen}>${cp.post_screen}`;
      edgeOwners.set(key, [...(edgeOwners.get(key) ?? []), ac.id]);
    }
  }
  for (const [flowName, screens] of Object.entries(doc.flows)) {
    const flowHasP0 = p0.some((ac) => ac.linked_flow === flowName);
    if (!flowHasP0) continue;
    for (let i = 0; i + 1 < screens.length; i++) {
      const key = `${flowName}|${screens[i]}>${screens[i + 1]}`;
      if (!edgeOwners.has(key)) {
        failures.push(`flow ${flowName}：边 ${screens[i]}→${screens[i + 1]} 无任何 P0 AC checkpoint 拥有（流程节点缺证据主体）`);
      }
    }
  }

  if (failures.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details: `P0 结构化流程模型不完整（${failures.length} 项）：\n` + failures.slice(0, 10).join('\n') + (failures.length > 10 ? '\n…' : ''),
      suggestion:
        '为每个 P0 交互 AC 补 checkpoint（pre/action/post/required）与 requirement_ref（source_path + 源文档逐字 snippet）；' +
        'flows 声明有序屏链且每条边由 ≥1 P0 AC 拥有。',
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details: `P0 交互 AC ${p0.length} 条 checkpoint/引文/flow 合成全部合法。`,
  }];
}

/**
 * 结构化流程模型来自 spec-owned acceptance.yaml，并由同阶段结构门禁与 phase evidence
 * manifest 共同校验内容和 freshness；不再附加真人 flow_contract receipt。
 */
export function evaluateFlowContract(
  projectRoot: string,
  feature: string,
  _requirementText: string,
): CheckResult[] {
  const id = 'acceptance_flow_contract';
  const description = '结构化流程模型机器契约（spec-owned + phase-evidence freshness）';
  const doc = loadAcceptanceFlowsDoc(projectRoot, feature);
  const applicable = doc && doc.criteria.some(isP0DeviceInteractive) && Object.keys(doc.flows).length > 0;
  if (!applicable) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: '无 P0 device flow，flow_contract 不适用。' }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'MAJOR', status: 'PASS',
    details: 'P0 flow/checkpoint 来自 spec-owned acceptance.yaml；结构由 acceptance_flow_model 校验，freshness 由当前 phase evidence manifest 绑定。',
  }];
}

// ----------------------------------------------------------------------------
// Native CaseResult/StepResult acceptance reconciliation and denominator gates
// ----------------------------------------------------------------------------

interface PlanTcEntry {
  id: string;
  priority: string;
  acRefs: string[];
}

/** 顶层 test-plan.md 用例表：id + 优先级 + 行内 AC/BD 引用（词法 SSOT=ACCEPTANCE_ID_PATTERN，
 * e9d4b7a3 t2：旧 `/AC-\d+/gi` 吃不下 AC-G* → 与 acceptance 侧全集不对称，恒报零覆盖） */
export function parsePlanTcEntries(planMd: string): PlanTcEntry[] {
  const section = getSectionContent(planMd, '测试用例') ?? planMd;
  const out: PlanTcEntry[] = [];
  for (const table of extractTables(section)) {
    const iId = table.headers.findIndex((h) => /用例编号|编号/.test(h));
    const iPri = table.headers.findIndex((h) => /优先级/.test(h));
    if (iId < 0 || iPri < 0) continue;
    for (const row of table.rows) {
      const m = (row[iId] ?? '').match(/TC-\d+/i);
      if (!m) continue;
      const acRefs = extractAcceptanceIdRefs(row.join(' '));
      out.push({ id: m[0].toUpperCase(), priority: (row[iPri] ?? '').trim(), acRefs });
    }
    if (out.length > 0) break;
  }
  return out;
}

type ParsedStep = Record<string, unknown>;

const ACTION_KINDS = new Set(['touch', 'input', 'swipe', 'scroll']);

export interface P0GateInputs {
  projectRoot: string;
  feature: string;
  planMd: string;
  reportMd: string;
  /** Native trace is the only accepted execution evidence for production P0 gates. */
  trace?: HylyreTrace | null;
  /** T4 gate decision produced from the same final trace/ready/manifest chain. */
  evidenceGate?: HylyreEvidenceGateResult | null;
  /** Authoritative derived plan bound to this trace; never fall back to a newer plan. */
  derivedPlanPath?: string | null;
  /** 报告结论声明（parseReportConclusionVerdict 输出） */
  reportConclusion: string | null;
  now?: () => Date;
}

interface NativeCaseEvaluation {
  caseId: string;
  passed: boolean;
  reasons: string[];
  acIds: string[];
}

interface NativeP0Evaluation {
  p0Entries: PlanTcEntry[];
  passedCaseIds: string[];
  skippedCaseIds: string[];
  explicitSkipCaseIds: string[];
  traceSkipCaseIds: string[];
  unexecutedCaseIds: string[];
  caseEvaluations: NativeCaseEvaluation[];
  acceptedAcIds: Set<string>;
  acFailures: string[];
  gateFailure?: string;
}

function canonicalIdsForStep(
  step: ParsedStep,
  index: CanonicalSelectorIndex,
  screenId?: string,
): string[] {
  return canonicalIdsForPlannedStep(normalizePlannedStep(step), index, screenId);
}

function nativeStep(step: unknown): HylyreStepResult | null {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
  return step as HylyreStepResult;
}

// plan a6c4e9f2 T4 返修：以下三个 helper 原来读的是 0.3 flat 字段
// （`step.status` / `step.evidence` / `selector.candidate_count` / `selector.selected_id`）。
// v1 把成败与观测收进 `outcome`、把选择器事实收进 `selector.resolution`，
// 旧读法在真实 v1 上一律取到 undefined——门禁会静默失去判据，而不是报错。

function selectorCandidateCount(step: HylyreStepResult): number | null {
  const count = step.selector?.resolution?.candidate_count;
  return Number.isInteger(count) ? (count as number) : null;
}

/** v1 的断言观测：只在 `passed` 上存在，且必须是 assertion 面。 */
function assertionObservation(step: HylyreStepResult): Record<string, unknown> | null {
  if (step.outcome?.status !== 'passed') return null;
  const observation = step.outcome.observation as unknown as Record<string, unknown> | undefined;
  if (!observation || observation.kind !== 'assertion') return null;
  return observation;
}

function observationFacts(step: HylyreStepResult): Record<string, unknown> | null {
  const facts = assertionObservation(step)?.facts;
  return facts && typeof facts === 'object' && !Array.isArray(facts)
    ? (facts as Record<string, unknown>)
    : null;
}

/**
 * 身份护栏（plan §139/§346、spec「Identity guardrail」）：**P0 checkpoint 的
 * required/forbidden 身份证据必须由 `by_id` 断言承载**。`required_element_ids` 是 id，
 * 一次成功的 `by_text` 观测不构成 id 身份证明。
 *
 * 不加这层会留两个真实缺口：
 *   - `by_text` + `unique` + `selected.id` 恰好等于目标 id → 闭合 required；
 *   - `by_text` + `not_found` → 闭合 forbidden（"某段文字没找到"不等于"某个 id 不在场"）。
 *
 * 注意作用域：这条限定只属于 **P0 身份覆盖** 这条路径。冻结契约与 spec 明确禁止把
 * **运行时 selector 门**写成按 `request.kind` 的固定旁路——那里语义随执行路径走
 * （native by_text 合法地产出 not_attempted）。两者不是同一道门，不要互相搬。
 */
function requestProvesIdentity(step: HylyreStepResult, targetId: string): boolean {
  const request = step.selector?.request;
  if (!request) return false;
  if (request.kind !== 'by_id') return false;
  return typeof request.value === 'string' && request.value === targetId;
}

function selectorEvidenceMatches(
  step: HylyreStepResult,
  targetId: string,
  absence: boolean,
  plannedSelector?: ReturnType<typeof normalizePlannedStep>['selector'],
  canonicalIds: string[] = [],
): boolean {
  const resolution = step.selector?.resolution;
  if (!resolution) return false;
  // 请求面先过身份护栏：请求的不是这个 id，解析结果再漂亮也不构成该 id 的身份证据。
  if (!requestProvesIdentity(step, targetId)) return false;
  const selectedId = resolution.selected?.id ?? null;
  // absence 的正例是 resolver 确认零候选（v1 的 not_found），不是"没解析过"。
  if (absence) return resolution.candidate_count === 0 && selectedId === null;
  if (selectedId !== targetId) return false;
  // plan a6c4e9f2 T4 返修：0.3 时代这里还有一条"candidate_count>1 但已由
  // index/scope/within/all 消歧、且带 bounds"的放行分支。冻结契约 §6.1 明确
  // **Schema 直接拒绝 `candidate_count>1` + 非空 `selected`**——该分支在合法 v1 上
  // 永不可达，留着只会让人以为那种形态可接受。v1 里消歧表达在
  // `request.constraints.index`，resolver 应用谓词后回 `unique`/count=1。
  return resolution.candidate_count === 1;
}

function assertionEvidenceMatches(
  step: HylyreStepResult,
  targetId: string,
  absence: boolean,
  plannedSelector?: ReturnType<typeof normalizePlannedStep>['selector'],
  canonicalIds: string[] = [],
): boolean {
  if (step.role !== 'assertion' || step.outcome?.status !== 'passed') return false;
  const observation = assertionObservation(step);
  const facts = observationFacts(step);
  if (!observation || !facts) return false;
  if (absence) {
    if (observation.assertion_type !== 'absence' || facts.observed_present !== false) return false;
    const count = typeof facts.candidate_count === 'number' ? facts.candidate_count : selectorCandidateCount(step);
    return count === 0 && selectorEvidenceMatches(step, targetId, true, plannedSelector, canonicalIds);
  }
  if (observation.assertion_type !== 'presence' || facts.observed_present !== true) return false;
  const count = typeof facts.candidate_count === 'number' ? facts.candidate_count : selectorCandidateCount(step);
  return count !== null && count > 0 && selectorEvidenceMatches(step, targetId, false, plannedSelector, canonicalIds);
}

function isAssertionPlanKind(kind: string): boolean {
  return kind === 'wait_for' || kind === 'wait_gone' || kind === 'assert_toast';
}

/**
 * plan a6c4e9f2 D1（T4 返修 2026-09-02）：计划步骤 → checkpoint 元素的**绑定**是开放世界的。
 *
 * `by_id` 是字面身份——计划写的就是这个 id，feature ui-spec 有没有登记它与"绑得上绑不上"
 * 无关：feature ui-spec 只建模本 feature 触碰的页面，既有入口天然缺席。此前这里只经
 * `canonicalIdsForPlannedStep` 绑定，等于把 ui-spec 当封闭白名单——宿主 T8 的 AC-1/10/14
 * 正是这样被判成"计划中无 canonical action"，还被归咎为宿主 spec 没建模 ui-spec。
 *
 * 只有 `by_text` 没有字面身份，才需要借 ui-spec 的 canonical 文本映射（保留 screen 限定
 * 与 ui-spec 已证明的歧义）。这里只回答"计划里哪一步在说这个 id"；身份是否成立另由
 * selectorEvidenceMatches 用 native resolution 证明，两层不要互相搬。
 */
function plannedStepBindsTarget(
  info: ReturnType<typeof normalizePlannedStep>,
  targetId: string,
  canonical: CanonicalSelectorIndex,
  screenId?: string,
): boolean {
  const selector = info.selector;
  if (!selector) return false;
  if (selector.kind === 'by_id') return selector.value === targetId;
  if (selector.kind === 'by_text') return canonicalIdsForPlannedStep(info, canonical, screenId).includes(targetId);
  return false;
}

function findPlannedStepIndex(
  steps: ParsedStep[],
  targetId: string,
  canonical: CanonicalSelectorIndex,
  screenId: string | undefined,
  afterIndex: number,
  absence: boolean,
): number | null {
  for (let i = Math.max(0, afterIndex + 1); i < steps.length; i += 1) {
    const info = normalizePlannedStep(steps[i], i);
    if (!isAssertionPlanKind(info.kind)) continue;
    if (absence !== (info.kind === 'wait_gone')) continue;
    if (plannedStepBindsTarget(info, targetId, canonical, screenId)) return i;
  }
  return null;
}

function findActionStepIndex(
  steps: ParsedStep[],
  targetId: string,
  canonical: CanonicalSelectorIndex,
  screenId: string,
): number | null {
  for (let i = 0; i < steps.length; i += 1) {
    const info = normalizePlannedStep(steps[i], i);
    if (!ACTION_KINDS.has(info.kind)) continue;
    if (plannedStepBindsTarget(info, targetId, canonical, screenId)) return i;
  }
  return null;
}

function evaluateNativeCase(
  traceCase: HylyreTraceCase | undefined,
  acs: AcceptanceCriterion[],
  derivedSteps: ParsedStep[],
  canonical: CanonicalSelectorIndex,
): NativeCaseEvaluation {
  const caseId = traceCase?.id?.toUpperCase() ?? '(missing)';
  const reasons: string[] = [];
  if (!traceCase) return { caseId, passed: false, reasons: ['trace 无该 CaseResult，未执行 case 不得凭计划状态通过'], acIds: acs.map(ac => ac.id) };
  if (traceCase.execution !== 'completed') reasons.push(`execution=${String(traceCase.execution)}`);
  if (traceCase.verification !== 'passed') reasons.push(`verification=${String(traceCase.verification)}`);
  if (traceCase.evidence !== 'complete') reasons.push(`evidence=${String(traceCase.evidence)}`);
  if (!Array.isArray(traceCase.steps) || traceCase.steps.length === 0) reasons.push('CaseResult.steps[] 缺失或为空');
  const nativeSteps = Array.isArray(traceCase.steps) ? traceCase.steps.map(nativeStep) : [];
  if (traceCase.expected_check_mode === 'checked_vlm') {
    const expected = nativeSteps.find(step => step?.kind === 'expected_check');
    if (
      !expected || expected.role !== 'assertion' ||
      expected.outcome?.status !== 'passed' || !assertionObservation(expected)
    ) {
      reasons.push('expected_check_mode=checked_vlm 但 expected_check StepResult 未通过/缺证据');
    }
  }

  for (const ac of acs) {
    const cp = ac.checkpoint;
    if (!checkpointComplete(cp)) {
      reasons.push(`${ac.id} checkpoint 不完整`);
      continue;
    }
    const actionIndex = findActionStepIndex(derivedSteps, cp!.action!.target_element_id!, canonical, cp!.pre_screen!);
    if (actionIndex === null) {
      reasons.push(`${ac.id} 计划中无绑定 target=${cp!.action!.target_element_id} 的 action（by_id 须字面相等；by_text 须 ui-spec 文本映射）`);
      continue;
    }
    const action = nativeSteps[actionIndex];
    const actionPlan = normalizePlannedStep(derivedSteps[actionIndex], actionIndex);
    const actionCanonicalIds = canonicalIdsForStep(derivedSteps[actionIndex], canonical, cp!.pre_screen!);
    if (
      !action || action.index !== actionIndex || action.role !== 'action' ||
      action.outcome?.status !== 'passed' ||
      !selectorEvidenceMatches(
        action,
        cp!.action!.target_element_id!,
        false,
        actionPlan.selector,
        actionCanonicalIds,
      )
    ) {
      reasons.push(`${ac.id} action StepResult #${actionIndex} 缺失或未通过`);
    }
    for (const elementId of cp!.required_element_ids ?? []) {
      const plannedIndex = findPlannedStepIndex(derivedSteps, elementId, canonical, cp!.post_screen!, actionIndex, false);
      const step = plannedIndex === null ? null : nativeSteps[plannedIndex];
      const planned = plannedIndex === null ? null : normalizePlannedStep(derivedSteps[plannedIndex], plannedIndex);
      const canonicalIds = plannedIndex === null ? [] : canonicalIdsForStep(derivedSteps[plannedIndex], canonical, cp!.post_screen!);
      if (
        plannedIndex === null ||
        !step ||
        step.index !== plannedIndex ||
        !assertionEvidenceMatches(step, elementId, false, planned?.selector, canonicalIds)
      ) {
        reasons.push(`${ac.id} required=${elementId} 缺 role=assertion,status=passed 的 presence StepResult`);
      }
    }
    // forbidden 不按 post_screen 限定：要求"应消失的元素"登记在 post_screen 的 ui-spec 里
    // 才能证明它不在场，自相矛盾（宿主 AC-3 的 forbidden 只属 pre_screen）。by_id 字面绑定后
    // 限屏本就无意义；by_text 用不限屏的 canonical 映射。
    for (const elementId of cp!.forbidden_element_ids ?? []) {
      const plannedIndex = findPlannedStepIndex(derivedSteps, elementId, canonical, undefined, actionIndex, true);
      const step = plannedIndex === null ? null : nativeSteps[plannedIndex];
      const planned = plannedIndex === null ? null : normalizePlannedStep(derivedSteps[plannedIndex], plannedIndex);
      const canonicalIds = plannedIndex === null ? [] : canonicalIdsForStep(derivedSteps[plannedIndex], canonical);
      if (
        plannedIndex === null ||
        !step ||
        step.index !== plannedIndex ||
        !assertionEvidenceMatches(step, elementId, true, planned?.selector, canonicalIds)
      ) {
        reasons.push(`${ac.id} forbidden=${elementId} 缺 role=assertion,status=passed 的 absence StepResult`);
      }
    }
  }
  return { caseId, passed: reasons.length === 0 && acs.length > 0, reasons, acIds: acs.map(ac => ac.id) };
}

function evaluateNativeP0(inp: P0GateInputs): NativeP0Evaluation {
  const p0Entries = parsePlanTcEntries(inp.planMd).filter(entry => entry.priority.toUpperCase() === 'P0');
  const gate = inp.evidenceGate;
  if (!gate?.native) {
    const reason = gate?.reasons.join('；') || '缺少 native Hylyre evidence gate 结果';
    return {
      p0Entries,
      passedCaseIds: [],
      skippedCaseIds: p0Entries.map(entry => entry.id),
      explicitSkipCaseIds: [],
      traceSkipCaseIds: [],
      unexecutedCaseIds: p0Entries.map(entry => entry.id),
      caseEvaluations: [],
      acceptedAcIds: new Set(),
      acFailures: [],
      gateFailure: `native evidence 未启用：${reason}；legacy case status 不得贡献 verification=passed`,
    };
  }
  const trace = inp.trace;
  if (!trace) {
    return {
      p0Entries,
      passedCaseIds: [],
      skippedCaseIds: p0Entries.map(entry => entry.id),
      explicitSkipCaseIds: [],
      traceSkipCaseIds: [],
      unexecutedCaseIds: p0Entries.map(entry => entry.id),
      caseEvaluations: [],
      acceptedAcIds: new Set(),
      acFailures: [],
      gateFailure: 'authoritative trace 缺失，无法消费 CaseResult.steps[]',
    };
  }
  const acceptance = loadAcceptanceFlowsDoc(inp.projectRoot, inp.feature);
  const p0Acs = (acceptance?.criteria ?? []).filter(isP0DeviceInteractive);
  const reportsBase = path.join(receiptDirPath(inp.projectRoot, inp.feature, 'testing'), 'reports');
  const selected = inp.derivedPlanPath
    ? fs.existsSync(inp.derivedPlanPath)
      ? { hylyrePath: inp.derivedPlanPath, content: fs.readFileSync(inp.derivedPlanPath, 'utf-8') }
      : null
    : (() => {
        const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
        return pick.selected ? { hylyrePath: pick.selected.hylyrePath, content: pick.selected.content } : null;
      })();
  if (!selected) {
    return {
      p0Entries,
      passedCaseIds: [],
      skippedCaseIds: p0Entries.map(entry => entry.id),
      explicitSkipCaseIds: [],
      traceSkipCaseIds: [],
      unexecutedCaseIds: p0Entries.map(entry => entry.id),
      caseEvaluations: [],
      acceptedAcIds: new Set(),
      acFailures: [],
      gateFailure: '无 authoritative 派生 Hylyre 计划，无法按 step index 对账',
    };
  }
  const selectorDoc = loadUiSpecFile(uiSpecAbsPath(inp.projectRoot, inp.feature));
  if (!selectorDoc) {
    return {
      p0Entries,
      passedCaseIds: [],
      skippedCaseIds: p0Entries.map(entry => entry.id),
      explicitSkipCaseIds: [],
      traceSkipCaseIds: [],
      unexecutedCaseIds: p0Entries.map(entry => entry.id),
      caseEvaluations: [],
      acceptedAcIds: new Set(),
      acFailures: [],
      gateFailure: 'canonical ui-spec 不可解析，required/forbidden selector 映射拒绝通过',
    };
  }
  const canonical = buildCanonicalSelectorIndex(selectorDoc);
  const explicitSkips = new Set(loadExplicitSkipTcIds(selected.hylyrePath, selected.content));
  const derivedByTc = new Map<string, ParsedStep[]>();
  for (const row of extractDerivedPlanCases(selected.content)) {
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    derivedByTc.set(row.tc_id.toUpperCase(), parsed.ok ? parsed.steps : []);
  }
  const traceByTc = new Map((trace.cases ?? []).map(row => [row.id.toUpperCase(), row]));
  const evaluations: NativeCaseEvaluation[] = [];
  const passedCaseIds: string[] = [];
  const skippedCaseIds: string[] = [];
  const explicitSkipCaseIds: string[] = [];
  const traceSkipCaseIds: string[] = [];
  const unexecutedCaseIds: string[] = [];
  const acceptedAcIds = new Set<string>();
  for (const entry of p0Entries) {
    const acs = p0Acs.filter(ac => entry.acRefs.includes(ac.id));
    const traceCase = traceByTc.get(entry.id);
    const evaluation = evaluateNativeCase(traceCase, acs, derivedByTc.get(entry.id) ?? [], canonical);
    evaluations.push(evaluation);
    if (evaluation.passed) {
      passedCaseIds.push(entry.id);
      for (const acId of evaluation.acIds) acceptedAcIds.add(acId);
    } else {
      skippedCaseIds.push(entry.id);
      if (explicitSkips.has(entry.id) && (!traceCase || !Array.isArray(traceCase.steps) || traceCase.steps.length === 0)) {
        explicitSkipCaseIds.push(entry.id);
      } else if (traceCase?.status === '跳过') {
        traceSkipCaseIds.push(entry.id);
      } else if (!traceCase) {
        unexecutedCaseIds.push(entry.id);
      }
    }
  }
  const acFailures = p0Acs
    .filter(ac => !acceptedAcIds.has(ac.id))
    .map(ac => {
      const related = evaluations.filter(e => e.acIds.includes(ac.id));
      const reason = related.flatMap(e => e.reasons).slice(0, 3).join('；') || '无通过的 StepResult 证据';
      return `${ac.id}：${reason}`;
    });
  return {
    p0Entries,
    passedCaseIds,
    skippedCaseIds,
    explicitSkipCaseIds,
    traceSkipCaseIds,
    unexecutedCaseIds,
    caseEvaluations: evaluations,
    acceptedAcIds,
    acFailures,
  };
}

function nativeGateFailureResult(
  id: string,
  description: string,
  evaluation: NativeP0Evaluation,
): CheckResult {
  return {
    id,
    category: 'structure',
    description,
    severity: 'BLOCKER',
    status: 'FAIL',
    details: evaluation.gateFailure ?? 'native StepResult acceptance 对账未通过',
    suggestion: '升级/核验 Hylyre 0.5.0 + trace schema 0.4-p0 + hylyre.step-outcome/1 后重跑；不得用旧 case status 或报告散文补证据。',
  };
}

function evaluateNativeP0CoverageIntegrity(inp: P0GateInputs): CheckResult[] {
  const id = 'p0_coverage_integrity';
  const description = 'P0 用例覆盖（CaseResult 三轴 + StepResult required/forbidden 对账）';
  const evaluation = evaluateNativeP0(inp);
  if (evaluation.p0Entries.length === 0) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: '计划无 P0 用例（或表格无法解析）。' }];
  }
  if (evaluation.gateFailure) {
    return [
      nativeGateFailureResult(id, description, evaluation),
      {
        id: 'p0_pass_rate_dual_metrics',
        category: 'structure',
        description: 'P0 通过率与全分母对账',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: 'native evidence gate 未通过，不能计算或宣称 P0 acceptance 通过率。',
        suggestion: '先补齐同一最终 run 的 native CaseResult/StepResult 证据。',
      },
    ];
  }
  const passed = evaluation.passedCaseIds.length;
  const total = evaluation.p0Entries.length;
  const uncovered = total - passed;
  const rate = `${passed}/${total}（覆盖率 ${Math.round((passed / total) * 100)}%）`;
  const result: CheckResult = {
    id,
    category: 'structure',
    description,
    severity: 'BLOCKER',
    status: uncovered === 0 ? 'PASS' : 'FAIL',
    details: [
      `全分母口径：P0 CaseResult/StepResult 对账通过 ${rate}，未覆盖 ${uncovered}`,
      `缺口分类：explicit skip ${evaluation.explicitSkipCaseIds.length}，trace skip ${evaluation.traceSkipCaseIds.length}，无执行记录 ${evaluation.unexecutedCaseIds.length}`,
      ...evaluation.caseEvaluations
        .filter(item => !item.passed)
        .slice(0, 10)
        .map(item => `  - ${item.caseId}：${item.reasons.slice(0, 3).join('；') || '无完整 acceptance evidence'}`),
    ].join('\n'),
    suggestion: uncovered === 0
      ? '继续由当前 authoritative trace 驱动 report/summary/quality axes。'
      : '补齐同一 CaseResult.steps[] 的三轴、required presence 与 forbidden absence assertion 后重跑；explicit skip 留在 testing，零自动 coding。',
  };
  const results: CheckResult[] = [result];
  if (uncovered > 0 && inp.reportConclusion === '达标') {
    results.push({
      id: 'p0_pass_rate_dual_metrics',
      category: 'structure',
      description: 'P0 通过率与全分母对账',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `报告声明「达标」，但 native evidence 全分母仅 ${rate}，不得以旧 case status 或已执行子集冒充全量。`,
      suggestion: '将报告结论改为真实状态并补齐未覆盖的 native StepResult evidence。',
    });
  } else {
    results.push({
      id: 'p0_pass_rate_dual_metrics',
      category: 'structure',
      description: 'P0 通过率与全分母对账',
      severity: 'BLOCKER',
      status: 'PASS',
      details: `native evidence 全分母：${rate}，未覆盖 ${uncovered}。`,
    });
  }
  return results;
}

/** P0 coverage is always computed from the authoritative native trace. */
export function evaluateP0CoverageIntegrity(inp: P0GateInputs): CheckResult[] {
  return evaluateNativeP0CoverageIntegrity(inp);
}

/** P0 acceptance coverage is keyed by plan obligations and same-index StepResults. */
export function evaluateP0SemanticCoverage(inp: P0GateInputs): CheckResult[] {
  const id = 'p0_semantic_coverage_integrity';
  const description = 'P0 acceptance coverage（计划要求 × CaseResult.steps[] 实际证据）';
  const evaluation = evaluateNativeP0(inp);
  if (evaluation.p0Entries.length === 0) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: '无 P0 device flow 或 P0 测试用例。' }];
  }
  if (evaluation.gateFailure) return [nativeGateFailureResult(id, description, evaluation)];
  if (evaluation.acFailures.length > 0) {
    return [{
      id,
      category: 'structure',
      description,
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `P0 acceptance coverage 未成立（${evaluation.acFailures.length} 项）：\n` +
        evaluation.acFailures.slice(0, 12).map(item => `  - ${item}`).join('\n'),
      suggestion: '仅以 authoritative trace 的 CaseResult 三轴和同 index 的 assertion StepResult 对账；缺 required/forbidden evidence 留在 testing，不得从旧 status 或报告散文补齐。',
    }];
  }
  return [
    {
      id,
      category: 'structure',
      description,
      severity: 'BLOCKER',
      status: 'PASS',
      details: `P0 acceptance coverage 已按 ${evaluation.acceptedAcIds.size} 个 checkpoint 的 required/forbidden StepResult evidence 完整对账。`,
    },
    {
      id: 'p0_runtime_step_evidence_boundary',
      category: 'structure',
      description: 'P0 native StepResult 证据边界',
      severity: 'MINOR',
      status: 'PASS',
      details: 'CaseResult.execution/verification/evidence 与 CaseResult.steps[] 是唯一执行证据；不读取日志、tool_calls 或报告散文重建步骤。',
    },
  ];
}
