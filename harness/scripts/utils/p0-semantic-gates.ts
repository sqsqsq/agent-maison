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

import { receiptDirPath, resolveFeatureArtifact, relFeaturesDir } from '../../config';
import { collectCurrentRequirementText, loadSpecMarkdown, resolveUiRelevanceForRun } from './fidelity-shared';
// e9d4b7a3 t2：AC/BD id 词法 SSOT 由 acceptance 侧承载，行内引用解析不再自写第二套正则
import { extractAcceptanceIdRefs } from './check-acceptance';
import type { ChannelEvidenceBinding } from './execution-channel-evidence';
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
  parseUiChangeFromSpecMarkdown,
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

export function loadAcceptanceFlowsDoc(projectRoot: string, feature: string, supplied?: unknown): AcceptanceFlowsDoc | null {
  const res = resolveFeatureArtifact(projectRoot, feature, 'acceptance.yaml');
  if (supplied === undefined && !res.exists) return null;
  try {
    const doc = (supplied === undefined ? YAML.parse(fs.readFileSync(res.actualPath, 'utf-8')) : supplied) as {
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
  return ac.priority === 'P0' && (layer === 'device' || layer === 'both');
}

/** linked_flow names a business use case; it never decides whether device evidence is owed. */
export function resolveP0DeviceObligations(projectRoot: string, feature: string, supplied?: unknown) {
  const acceptance = loadAcceptanceFlowsDoc(projectRoot, feature, supplied);
  const device = (acceptance?.criteria ?? []).filter(isP0DeviceInteractive);
  const spec = loadSpecMarkdown(projectRoot, feature);
  let requirement = collectCurrentRequirementText(projectRoot, feature, relFeaturesDir(projectRoot));
  // Typed blueprint input may precede materialized spec/fidelity. Its bound requirement files remain the source.
  if (!spec && !requirement.trim()) {
    requirement = [...new Set(device.map(ac => ac.requirement_ref?.source_path).filter((p): p is string => !!p))]
      .flatMap(relative => {
        const file = path.resolve(projectRoot, relative);
        try { return file.startsWith(path.resolve(projectRoot) + path.sep) ? [fs.readFileSync(file, 'utf8')] : []; }
        catch { return []; }
      }).join('\n');
  }
  const uiKnown = spec ? parseUiChangeFromSpecMarkdown(spec) !== null : requirement.trim().length > 0;
  const uiRelevant = resolveUiRelevanceForRun(projectRoot, feature, requirement);
  return { acceptance, device, uiKnown, uiRelevant,
    uiCheckpoints: uiRelevant ? device : [], checkpoints: device.filter(ac => uiRelevant || ac.checkpoint !== undefined), flows: acceptance?.flows ?? {} };
}

export function checkpointComplete(cp: AcCheckpoint | undefined): boolean {
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

export function evaluateAcceptanceFlowStructure(projectRoot: string, feature: string, supplied?: unknown, mode: 'complete' | 'declared' = 'complete'): CheckResult[] {
  const id = 'acceptance_flow_structure';
  const description = 'P0 交互 AC 结构化 checkpoint + flows 三约束 + requirement_ref 验存';
  // Canonical design is admitted before spec can supplement UI definitions. Validate what it declares, not stage-owned omissions.
  const obligations = mode === 'complete' ? resolveP0DeviceObligations(projectRoot, feature, supplied) : null;
  const doc = obligations?.acceptance ?? loadAcceptanceFlowsDoc(projectRoot, feature, supplied);
  if (!doc) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: 'acceptance.yaml 不存在/不可解析。' }];
  }
  const p0 = obligations?.checkpoints ?? doc.criteria.filter(ac => isP0DeviceInteractive(ac) && ac.checkpoint !== undefined);
  const failures: string[] = [];
  if (obligations && obligations.device.length > 0 && !obligations.uiKnown) failures.push('P0 设备义务的 UI 相关性未定义：在 spec.md 声明 ui_change（非 UI 写 none），或在尚无 spec 时提供有效需求输入；不能据此豁免 UI checkpoint');
  if (p0.length === 0 && failures.length === 0) {
    return [{ id, category: 'structure', description, severity: 'BLOCKER', status: 'PASS', details: '无 P0 UI 交互型 AC，UI checkpoint/flows 约束不适用；设备义务另按原生步骤核验。' }];
  }

  // ① P0 交互 AC 必须有完整结构化 checkpoint（纯自然语言锚点 FAIL——rev3 起 P0 不降级）
  for (const ac of p0) {
    if (!checkpointComplete(ac.checkpoint)) {
      failures.push(`${ac.id}：缺完整结构化 checkpoint（pre_screen/action.target_element_id/post_screen/required_element_ids）`);
    }
  }

  // ①' plan 07a41ec6 T2：checkpoint.action.type 必须是可绑定动作——assert_visible 之类不是动作，
  //    结构上永远绑不到 StepResult；在 spec 期就报，不等跑完真机。
  for (const ac of p0) {
    const type = ac.checkpoint?.action?.type;
    if (typeof type === 'string' && type.trim() && !CHECKPOINT_ACTION_TYPES.has(type.trim().toLowerCase())) {
      failures.push(
        `${ac.id}：checkpoint.action.type=${type.trim()} 不是可绑定动作（可用：${[...CHECKPOINT_ACTION_TYPES].join('/')}）；` +
          'assert_visible 类改为指定触发动作，并把要看见的元素放进 required_element_ids',
      );
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
  const edgeOwners = new Map<string, string[]>();
  const ownedFlows = new Set<string>();
  for (const ac of p0) {
    if (!checkpointComplete(ac.checkpoint)) continue;
    const cp = ac.checkpoint!;
    const containing = Object.entries(doc.flows).filter(([, flow]) => flow.includes(cp.pre_screen!) && flow.includes(cp.post_screen!));
    const adjacent = containing.filter(([, flow]) => flow.indexOf(cp.post_screen!) === flow.indexOf(cp.pre_screen!)
      || flow.indexOf(cp.post_screen!) === flow.indexOf(cp.pre_screen!) + 1);
    if (containing.length && !adjacent.length) failures.push(`${ac.id}：checkpoint 边 ${cp.pre_screen}→${cp.post_screen} 是无 AC 支撑的跳边（声明屏链中二者不相邻）`);
    for (const [flowName] of adjacent) {
      ownedFlows.add(flowName);
      if (cp.pre_screen !== cp.post_screen) {
        const key = `${flowName}|${cp.pre_screen}>${cp.post_screen}`;
        edgeOwners.set(key, [...(edgeOwners.get(key) ?? []), ac.id]);
      }
    }
  }
  for (const [flowName, screens] of Object.entries(doc.flows)) {
    if (!ownedFlows.has(flowName)) continue;
    for (let i = 0; i + 1 < screens.length; i++) {
      const key = `${flowName}|${screens[i]}>${screens[i + 1]}`;
      if (!edgeOwners.has(key)) failures.push(`flow ${flowName}：边 ${screens[i]}→${screens[i + 1]} 无任何 P0 AC checkpoint 拥有（流程节点缺证据主体）`);
    }
  }

  if (failures.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      repair_owner: 'spec',
      affected_files: [path.relative(projectRoot, resolveFeatureArtifact(projectRoot, feature, obligations && !obligations.uiKnown ? 'spec.md' : 'acceptance.yaml').actualPath).replace(/\\/g, '/')],
      details: `P0 结构化流程模型不完整（${failures.length} 项）：\n` + failures.slice(0, 10).join('\n') + (failures.length > 10 ? '\n…' : ''),
      suggestion:
        '为每个 P0 交互 AC 补 checkpoint（pre/action/post/required）与 requirement_ref（source_path + 源文档逐字 snippet）；' +
        'flows 可选；若声明屏链，每条边须由 ≥1 P0 AC 拥有。',
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
  supplied?: unknown,
): CheckResult[] {
  const id = 'acceptance_flow_contract';
  const description = '结构化流程模型机器契约（spec-owned + phase-evidence freshness）';
  const obligations = resolveP0DeviceObligations(projectRoot, feature, supplied);
  const applicable = obligations.checkpoints.length > 0 && Object.keys(obligations.flows).length > 0;
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

export const ACTION_KINDS = new Set(['touch', 'input', 'swipe', 'scroll']);
/** acceptance checkpoint.action.type 的可绑定值域（tap/click 是 touch 的 acceptance 侧写法） */
export const CHECKPOINT_ACTION_TYPES = new Set(['tap', 'touch', 'click', 'input', 'swipe', 'scroll']);
/** trace 里 selector 为 null 的动作种类：checkpoint 经其后的身份断言（post-state）绑定，不要求 selector 身份 */
const IDENTITY_FREE_ACTION_KINDS = new Set(['scroll', 'swipe']);

/**
 * plan 07a41ec6 T3：身份断言的**精确形状**——{"wait_for"|"wait_gone":{"by_id":<id>,"timeout":N}}。
 * 不维护 Hylyre 约束键镜像：多任何一个键都不是身份断言（那是 UX 断言，保留但不算身份）。
 */
export function isBareIdentityAssertion(step: unknown, kind: 'wait_for' | 'wait_gone', elementId: string): boolean {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
  const root = step as Record<string, unknown>;
  const keys = Object.keys(root);
  if (keys.length !== 1 || keys[0] !== kind) return false;
  const body = root[kind];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const bodyKeys = Object.keys(body as Record<string, unknown>);
  if (bodyKeys.some(k => k !== 'by_id' && k !== 'timeout')) return false;
  return (body as Record<string, unknown>).by_id === elementId;
}

export interface P0GateInputs {
  projectRoot: string;
  feature: string;
  acceptance?: unknown;
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
  /** plan 07a41ec6 T2：静态三态判定出的 unsupported_gap TC——留在分母、不算 PASS/FAIL、不阻止完成 */
  unsupportedGapTcIds?: readonly string[];
  /** 与 testing channel obligation / report 共用的一次逐 TC 机器裁决。 */
  channelEvidenceBindings?: readonly ChannelEvidenceBinding[];
  now?: () => Date;
}

/**
 * plan c3f8a2d7 §3.2：外部能力缺席的唯一投影（visual_diff provider 缺席、证据义务门、两项 P0 门共用），
 * 最终由共享裁决 `areBlockersOnlyCapabilityMissing` 给 INCOMPLETE。放在本模块是因为 check-testing 依赖本模块，反向引用会成环。
 */
export const CAPABILITY_ABSENCE_PROJECTION = {
  blocking_class: 'externalBlocked', failure_kind: 'capability_missing',
} as const satisfies Pick<CheckResult, 'blocking_class' | 'failure_kind'>;
export const CAPABILITY_ABSENCE_NOTE = '视觉能力缺席，非产品失败';

/** 结构化判据：该检查是否就是上面那份能力缺席投影（run_status 与报告 writer 共用）。 */
export function isCapabilityAbsenceCheck(check: { blocking_class?: string; failure_kind?: string }): boolean {
  return check.blocking_class === CAPABILITY_ABSENCE_PROJECTION.blocking_class
    && check.failure_kind === CAPABILITY_ABSENCE_PROJECTION.failure_kind;
}

interface NativeCaseEvaluation {
  caseId: string;
  passed: boolean;
  reasons: string[];
  acIds: string[];
  /** 内部参数：未通过的 visual TC 由其绑定带来的责任方（只有"视觉产物不可用"那一支才有）。 */
  repairOwner?: ChannelEvidenceBinding['repair_owner'];
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
  /** unsupported_gap 的 P0 TC（留分母） */
  gapCaseIds: string[];
  /** 只被 gap TC 引用、因此本轮无法验证的 P0 AC */
  gapAcIds: string[];
  gateFailure?: string;
  definitionFailure?: CheckResult;
  /** 每条未通过的 P0 TC / AC 都有失败来源且全部是 capability 归属的视觉缺席、trace 无失败（plan c3f8a2d7 §3.2③）。 */
  capabilityAbsenceOnly?: boolean;
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
export function plannedStepBindsTarget(
  info: ReturnType<typeof normalizePlannedStep>,
  targetId: string,
  canonical: CanonicalSelectorIndex | null,
  screenId?: string,
): boolean {
  const selector = info.selector;
  if (!selector) return false;
  if (selector.kind === 'by_id') return selector.value === targetId;
  if (selector.kind === 'by_text') return canonical ? canonicalIdsForPlannedStep(info, canonical, screenId).includes(targetId) : false;
  return false;
}

/** 绑定 checkpoint 元素的全部 action 候选；多个 step 可以是同一流程中的合法重复触发。 */
export function findActionStepCandidates(
  steps: ParsedStep[],
  targetId: string,
  canonical: CanonicalSelectorIndex | null,
  screenId?: string,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const info = normalizePlannedStep(steps[i], i);
    if (!ACTION_KINDS.has(info.kind)) continue;
    if (plannedStepBindsTarget(info, targetId, canonical, screenId)) out.push(i);
  }
  return out;
}

/** 注入与消费共用触发区间；目标自身不唯一才是歧义，重复触发不是歧义。 */
export function resolveCheckpointActionWindows(
  steps: ParsedStep[],
  targetId: string,
  canonical: CanonicalSelectorIndex | null,
  screenId?: string,
): { windows: Array<{ actionIndex: number; endIndex: number }>; ambiguousSteps: number[] } {
  const candidates = findActionStepCandidates(steps, targetId, canonical, screenId);
  const ambiguousSteps = candidates.filter(i => {
    const info = normalizePlannedStep(steps[i], i);
    return info.selector?.kind === 'by_text' && canonical !== null &&
      canonicalIdsForPlannedStep(info, canonical, screenId).length !== 1;
  });
  const windows = candidates.map((actionIndex, n) => {
    let endIndex = candidates[n + 1] ?? steps.length;
    for (let i = actionIndex + 1; i < endIndex; i += 1) {
      if (['back', 'home', 'stop_app', 'start_app', 'clear_app'].includes(normalizePlannedStep(steps[i], i).kind)) {
        endIndex = i;
        break;
      }
    }
    return { actionIndex, endIndex };
  });
  return { windows, ambiguousSteps };
}

function findPlannedStepIndex(
  steps: ParsedStep[],
  targetId: string,
  canonical: CanonicalSelectorIndex,
  screenId: string | undefined,
  afterIndex: number,
  absence: boolean,
  endIndex: number,
): number | null {
  for (let i = Math.max(0, afterIndex + 1); i < endIndex; i += 1) {
    const info = normalizePlannedStep(steps[i], i);
    if (!isAssertionPlanKind(info.kind)) continue;
    if (absence !== (info.kind === 'wait_gone')) continue;
    if (isBareIdentityAssertion(steps[i], absence ? 'wait_gone' : 'wait_for', targetId)) return i;
    // UX 谓词断言不是身份；by_text 抢先仍按既有 STEP-BYTEXT-ORDER 判无效，不能冒充裸 by_id。
    if (info.selector?.kind === 'by_text' && plannedStepBindsTarget(info, targetId, canonical, screenId)) return i;
  }
  return null;
}

function evaluateNativeCase(
  traceCase: HylyreTraceCase | undefined,
  acs: AcceptanceCriterion[],
  derivedSteps: ParsedStep[],
  canonical: CanonicalSelectorIndex | null,
  plannedCaseId?: string,
  checkpointAcIds: ReadonlySet<string> = new Set(acs.map(ac => ac.id)),
): NativeCaseEvaluation {
  // plan 07a41ec6 T2：未执行的 case 也要按计划 id 点名，诊断不得只剩 "(missing)"
  const caseId = traceCase?.id?.toUpperCase() ?? plannedCaseId?.toUpperCase() ?? '(missing)';
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

  if (acs.some(ac => !checkpointAcIds.has(ac.id))) {
    const assertions = derivedSteps.map((step, index) => normalizePlannedStep(step, index)).filter(step => isAssertionPlanKind(step.kind));
    if (assertions.length === 0) reasons.push('非 UI P0 用例缺计划断言，不能仅凭 CaseResult 状态通过');
    for (const expected of assertions) {
      const actual = nativeSteps[expected.index];
      if (!actual || actual.kind !== expected.kind || !assertionObservation(actual)) reasons.push(`step ${expected.index} 计划断言缺有效原生证据`);
    }
  }
  for (const ac of acs.filter(ac => checkpointAcIds.has(ac.id))) {
    const cp = ac.checkpoint;
    if (!checkpointComplete(cp) || !canonical) {
      reasons.push(`${ac.id} checkpoint 不完整`);
      continue;
    }
    const { windows, ambiguousSteps } = resolveCheckpointActionWindows(derivedSteps, cp!.action!.target_element_id!, canonical, cp!.pre_screen!);
    if (windows.length === 0) {
      reasons.push(`${ac.id} 计划中无绑定 target=${cp!.action!.target_element_id} 的 action（by_id 须字面相等；by_text 须 ui-spec 文本映射）——改法：在该 TC 补一步 touch/input/swipe/scroll 触发动作，或修正 checkpoint.action.target_element_id`);
      continue;
    }
    if (ambiguousSteps.length > 0) {
      reasons.push(`${caseId} ${ac.id} 候选 action step ${ambiguousSteps.join(', ')} 的 by_text 对应多个目标，缺唯一 selector 绑定；补 by_id 或现有 scope/index 消歧，保留全部导航动作`);
      continue;
    }
    for (const { actionIndex, endIndex } of windows) {
      const action = nativeSteps[actionIndex];
      const actionPlan = normalizePlannedStep(derivedSteps[actionIndex], actionIndex);
      const actionCanonicalIds = canonicalIdsForStep(derivedSteps[actionIndex], canonical, cp!.pre_screen!);
      // plan 07a41ec6 T2：scroll/swipe 在 trace 里 selector 为 null——按步骤种类与顺序定位后经其后的
      // 身份断言（post-state）绑定，不要求 selector 身份；真实用户动作是 scroll 就保留 scroll，不改 touch。
      const identityFree = IDENTITY_FREE_ACTION_KINDS.has(actionPlan.kind);
      const actionOk = Boolean(
        action && action.index === actionIndex && action.kind === actionPlan.kind && action.role === 'action' && action.outcome?.status === 'passed' &&
        (identityFree || selectorEvidenceMatches(action, cp!.action!.target_element_id!, false, actionPlan.selector, actionCanonicalIds)),
      );
      if (!actionOk) {
        reasons.push(
          `${ac.id} action step ${actionIndex}（${actionPlan.kind}）StepResult 缺失或未通过` +
            (identityFree ? '' : `（须 outcome.status=passed 且 selector 身份匹配 ${cp!.action!.target_element_id}）`),
        );
      }
      for (const elementId of cp!.required_element_ids ?? []) {
        const plannedIndex = findPlannedStepIndex(derivedSteps, elementId, canonical, cp!.post_screen!, actionIndex, false, endIndex);
        const step = plannedIndex === null ? null : nativeSteps[plannedIndex];
        const planned = plannedIndex === null ? null : normalizePlannedStep(derivedSteps[plannedIndex], plannedIndex);
        const canonicalIds = plannedIndex === null ? [] : canonicalIdsForStep(derivedSteps[plannedIndex], canonical, cp!.post_screen!);
        if (
          plannedIndex === null ||
          !isBareIdentityAssertion(derivedSteps[plannedIndex], 'wait_for', elementId) ||
          !step ||
          step.index !== plannedIndex ||
          step.kind !== 'wait_for' ||
          !assertionEvidenceMatches(step, elementId, false, planned?.selector, canonicalIds)
        ) {
          reasons.push(
            plannedIndex === null
              ? `${ac.id} action step ${actionIndex} 后、step ${endIndex} 前 required=${elementId}：计划中无裸 by_id 身份断言（期望形状 {"wait_for":{"by_id":"${elementId}","timeout":N}}，不得借用其它触发区间的证据；UX 谓词断言保留）`
              : `${ac.id} required=${elementId}：step ${plannedIndex} 的 presence StepResult 未通过或身份不匹配（request.kind 须为 by_id 且 selected.id=${elementId}）`,
          );
        }
      }
      // forbidden 不按 post_screen 限定：要求"应消失的元素"登记在 post_screen 的 ui-spec 里
      // 才能证明它不在场，自相矛盾（宿主 AC-3 的 forbidden 只属 pre_screen）。by_id 字面绑定后
      // 限屏本就无意义；by_text 用不限屏的 canonical 映射。
      for (const elementId of cp!.forbidden_element_ids ?? []) {
        const plannedIndex = findPlannedStepIndex(derivedSteps, elementId, canonical, undefined, actionIndex, true, endIndex);
        const step = plannedIndex === null ? null : nativeSteps[plannedIndex];
        const planned = plannedIndex === null ? null : normalizePlannedStep(derivedSteps[plannedIndex], plannedIndex);
        const canonicalIds = plannedIndex === null ? [] : canonicalIdsForStep(derivedSteps[plannedIndex], canonical);
        if (
          plannedIndex === null ||
          !isBareIdentityAssertion(derivedSteps[plannedIndex], 'wait_gone', elementId) ||
          !step ||
          step.index !== plannedIndex ||
          step.kind !== 'wait_gone' ||
          !assertionEvidenceMatches(step, elementId, true, planned?.selector, canonicalIds)
        ) {
          reasons.push(
            plannedIndex === null
              ? `${ac.id} action step ${actionIndex} 后、step ${endIndex} 前 forbidden=${elementId}：计划中无裸 by_id 缺席断言（期望形状 {"wait_gone":{"by_id":"${elementId}","timeout":N}}，不得借用其它触发区间的证据）`
              : `${ac.id} forbidden=${elementId}：step ${plannedIndex} 的 absence StepResult 未通过或身份不匹配（request.kind 须为 by_id，candidate_count=0）`,
          );
        }
      }
    }
  }
  return { caseId, passed: reasons.length === 0 && acs.length > 0, reasons, acIds: acs.map(ac => ac.id) };
}

function evaluateNativeP0(inp: P0GateInputs): NativeP0Evaluation {
  const p0Entries = parsePlanTcEntries(inp.planMd).filter(entry => entry.priority.toUpperCase() === 'P0');
  const obligations = resolveP0DeviceObligations(inp.projectRoot, inp.feature, inp.acceptance);
  const p0Acs = obligations.device;
  const empty: NativeP0Evaluation = { p0Entries, passedCaseIds: [], skippedCaseIds: p0Entries.map(e => e.id),
    explicitSkipCaseIds: [], traceSkipCaseIds: [], unexecutedCaseIds: p0Entries.map(e => e.id),
    caseEvaluations: [], acceptedAcIds: new Set(), acFailures: [], gapCaseIds: [], gapAcIds: [] };
  const fail = (gateFailure: string): NativeP0Evaluation => ({ ...empty, gateFailure });
  if (p0Acs.length === 0 && p0Entries.length === 0) return empty;
  const missingCheckpoints = obligations.checkpoints.filter(ac => !checkpointComplete(ac.checkpoint));
  if (p0Acs.length > 0 && (!obligations.uiKnown || missingCheckpoints.length > 0)) {
    const definitionFailure = evaluateAcceptanceFlowStructure(inp.projectRoot, inp.feature, inp.acceptance).find(c => c.status === 'FAIL');
    return { ...fail(definitionFailure?.details ?? 'P0 UI checkpoint 定义缺失'), definitionFailure };
  }
  if (p0Entries.length === 0) return fail('存在 P0 设备验收义务，但测试计划没有对应 P0 用例；补齐计划，不能把漏列义务当作不适用。');
  const gate = inp.evidenceGate;
  if (!gate?.native) return fail(`native evidence 未启用：${gate?.reasons.join('；') || '缺少同轮 native Hylyre evidence gate 结果'}；legacy case status 不得贡献 verification=passed`);
  const trace = inp.trace;
  if (!trace) return fail('authoritative trace 缺失，无法消费 CaseResult.steps[]');
  const reportsBase = path.join(receiptDirPath(inp.projectRoot, inp.feature, 'testing'), 'reports');
  const selected = inp.derivedPlanPath
    ? fs.existsSync(inp.derivedPlanPath)
      ? { hylyrePath: inp.derivedPlanPath, content: fs.readFileSync(inp.derivedPlanPath, 'utf-8') }
      : null
    : (() => {
        const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
        return pick.selected ? { hylyrePath: pick.selected.hylyrePath, content: pick.selected.content } : null;
      })();
  if (!selected) return fail('无 authoritative 派生 Hylyre 计划，无法按 step index 对账');
  const selectorDoc = obligations.checkpoints.length > 0 ? loadUiSpecFile(uiSpecAbsPath(inp.projectRoot, inp.feature)) : null;
  if (obligations.checkpoints.length > 0 && !selectorDoc) {
    const detail = 'canonical ui-spec 不可解析；由 spec 补齐 UI 定义，不能记为能力缺口';
    return { ...fail(detail), definitionFailure: { id: 'acceptance_flow_structure', category: 'structure',
      description: detail, severity: 'MAJOR', status: 'FAIL', repair_owner: 'spec',
      affected_files: [path.relative(inp.projectRoot, uiSpecAbsPath(inp.projectRoot, inp.feature)).replace(/\\/g, '/')], details: detail } };
  }
  const canonical = selectorDoc ? buildCanonicalSelectorIndex(selectorDoc) : null;
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
  // plan 07a41ec6 T2：unsupported_gap 的 P0 TC 不进 pass/fail 评估，但留在分母（五数口径）
  const gapSet = new Set((inp.unsupportedGapTcIds ?? []).map(id => id.toUpperCase()));
  const visualBindings = new Map(
    (inp.channelEvidenceBindings ?? [])
      .filter(binding => binding.channel === 'visual')
      .map(binding => [binding.tc_id.toUpperCase(), binding] as const),
  );
  const gapCaseIds: string[] = [];
  for (const entry of p0Entries) {
    if (gapSet.has(entry.id.toUpperCase())) {
      gapCaseIds.push(entry.id);
      continue;
    }
    const acs = p0Acs.filter(ac => entry.acRefs.includes(ac.id));
    const visualBinding = visualBindings.get(entry.id.toUpperCase());
    if (visualBinding) {
      const evaluation: NativeCaseEvaluation = {
        caseId: entry.id,
        passed: visualBinding.verdict.kind === 'covered' && acs.length > 0,
        reasons: visualBinding.verdict.kind === 'covered'
          ? (acs.length > 0 ? [] : ['visual TC 未关联可验收的 P0 AC'])
          : [visualBinding.verdict.detail],
        acIds: acs.map(ac => ac.id),
        ...(visualBinding.verdict.kind !== 'covered' && acs.length > 0 && visualBinding.repair_owner
          ? { repairOwner: visualBinding.repair_owner } : {}),
      };
      evaluations.push(evaluation);
      if (evaluation.passed) {
        passedCaseIds.push(entry.id);
        for (const acId of evaluation.acIds) acceptedAcIds.add(acId);
      } else {
        skippedCaseIds.push(entry.id);
      }
      continue;
    }
    const traceCase = traceByTc.get(entry.id);
    const evaluation = evaluateNativeCase(traceCase, acs, derivedByTc.get(entry.id) ?? [], canonical, entry.id, new Set(obligations.checkpoints.map(ac => ac.id)));
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
  const gapAcIds = p0Acs
    .filter(ac => !acceptedAcIds.has(ac.id))
    .filter(ac => {
      const refs = p0Entries.filter(entry => entry.acRefs.includes(ac.id));
      return refs.length > 0 && refs.every(entry => gapSet.has(entry.id.toUpperCase()));
    })
    .map(ac => ac.id);
  const gapAcSet = new Set(gapAcIds);
  const failedAcs = p0Acs.filter(ac => !acceptedAcIds.has(ac.id) && !gapAcSet.has(ac.id));
  // plan c3f8a2d7 §3.2③：归属判断先于 acFailures 文案，只看结构化事实；空关联集合不放行（不用真空 every）。
  const capabilityOwned = (e: NativeCaseEvaluation): boolean => e.repairOwner === 'capability';
  const failedEvaluations = evaluations.filter(e => !e.passed);
  const traceClean = trace.outcome === 'success' && !(trace.cases ?? []).some(c => c.status === '失败' || c.status === '阻塞');
  const capabilityAbsenceOnly = traceClean && failedEvaluations.length > 0 && failedEvaluations.every(capabilityOwned)
    && failedAcs.every(ac => {
      const related = evaluations.filter(e => e.acIds.includes(ac.id));
      return related.length > 0 && related.every(capabilityOwned);
    });
  const acFailures = failedAcs
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
    gapCaseIds,
    gapAcIds,
    capabilityAbsenceOnly,
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
    ...(evaluation.definitionFailure ? { repair_owner: evaluation.definitionFailure.repair_owner, affected_files: evaluation.definitionFailure.affected_files } : {}),
    suggestion: evaluation.definitionFailure?.suggestion ?? (evaluation.definitionFailure ? '返回 spec 补齐定义后重验。' : '按上述实际原因补齐同轮计划与原生证据；仅在明确版本/协议不支持时升级工具。'),
  };
}

function evaluateNativeP0CoverageIntegrity(inp: P0GateInputs): CheckResult[] {
  const id = 'p0_coverage_integrity';
  const description = 'P0 用例覆盖（CaseResult 三轴 + StepResult required/forbidden 对账）';
  const evaluation = evaluateNativeP0(inp);
  if (evaluation.p0Entries.length === 0 && !evaluation.gateFailure) {
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
  // plan 07a41ec6 T2：五数口径——gap 留在原始总分母、不算 PASS、不算 FAIL（codex 二轮 review）
  const total = evaluation.p0Entries.length;
  const verifiedPass = evaluation.passedCaseIds.length;
  const gapCount = evaluation.gapCaseIds.length;
  const failed = total - verifiedPass - gapCount;
  const coveragePct = Math.round((verifiedPass / total) * 1000) / 10;
  const rate = `P0 total ${total} / verified_pass ${verifiedPass} / unsupported_gap ${gapCount} / failed ${failed} / verified_coverage ${coveragePct}%`;
  const structured = {
    p0_total: total,
    verified_pass: verifiedPass,
    unsupported_gap: gapCount,
    failed,
    verified_coverage: coveragePct,
    gap_case_ids: evaluation.gapCaseIds,
    gap_ac_ids: evaluation.gapAcIds,
  };
  const failedEvaluations = evaluation.caseEvaluations.filter(item => !item.passed);
  const capabilityAbsent = failed > 0 && evaluation.capabilityAbsenceOnly === true;
  const result: CheckResult = {
    id,
    category: 'structure',
    description,
    severity: 'BLOCKER',
    status: failed === 0 ? 'PASS' : 'FAIL',
    ...(capabilityAbsent ? CAPABILITY_ABSENCE_PROJECTION : {}),
    structured,
    details: [
      capabilityAbsent ? `${CAPABILITY_ABSENCE_NOTE}：未通过的 P0 TC 全部因视觉能力缺席而未验证，能力恢复后由同一检查重验。` : null,
      rate,
      gapCount > 0
        ? `unsupported_gap ${gapCount} 条（留在分母、不算 PASS、不阻止普通开发完成；报告与 completion_status 须披露 COMPLETE_WITH_P0_GAPS）：${evaluation.gapCaseIds.join(', ')}`
        : null,
      failed > 0
        ? `缺口分类：explicit skip ${evaluation.explicitSkipCaseIds.length}，trace skip ${evaluation.traceSkipCaseIds.length}，无执行记录 ${evaluation.unexecutedCaseIds.length}，执行了但证据不足 ${failed - evaluation.explicitSkipCaseIds.length - evaluation.traceSkipCaseIds.length - evaluation.unexecutedCaseIds.length}`
        : null,
      ...failedEvaluations.slice(0, 10).map(item => `  - ${item.caseId}：${item.reasons.slice(0, 3).join('；') || '无完整 acceptance evidence'}`),
    ].filter((line): line is string => typeof line === 'string').join('\n'),
    suggestion: failed === 0
      ? (gapCount > 0
          ? '已验证的 P0 全部通过；unsupported_gap 按缺口类别登记在报告结论，completion_status 为 COMPLETE_WITH_P0_GAPS，不阻止完成。'
          : '继续由当前 authoritative trace 驱动 report/summary/quality axes。')
      : '逐条按上面 TC/step 的原因处理：缺身份断言→重跑 harness 让注入生效或补触发动作；StepResult 未通过→修产品或修计划；未执行→补跑该 TC。explicit skip 留在 testing，零自动 coding。',
  };
  const results: CheckResult[] = [result];
  if (failed > 0 && inp.reportConclusion === '达标') {
    results.push({
      id: 'p0_pass_rate_dual_metrics',
      category: 'structure',
      description: 'P0 通过率与全分母对账',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `报告声明「达标」，但 native evidence 五数口径为 ${rate}，不得以旧 case status 或已执行子集冒充全量。`,
      suggestion: '将报告结论改为真实状态并补齐未覆盖的 native StepResult evidence。',
    });
  } else {
    results.push({
      id: 'p0_pass_rate_dual_metrics',
      category: 'structure',
      description: 'P0 通过率与全分母对账',
      severity: 'BLOCKER',
      status: 'PASS',
      details: `native evidence 五数口径：${rate}。`,
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
  if (evaluation.p0Entries.length === 0 && !evaluation.gateFailure) {
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
      ...(evaluation.capabilityAbsenceOnly ? CAPABILITY_ABSENCE_PROJECTION : {}),
      details:
        (evaluation.capabilityAbsenceOnly ? `${CAPABILITY_ABSENCE_NOTE}：未成立的 P0 AC 全部只因视觉能力缺席而未验证。\n` : '') +
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
      details:
        `P0 acceptance coverage 已按 ${evaluation.acceptedAcIds.size} 个 checkpoint 的 required/forbidden StepResult evidence 完整对账` +
        (evaluation.gapAcIds.length > 0 ? `；unsupported_gap 覆盖的 AC（本轮无法验证、已披露）：${evaluation.gapAcIds.join(', ')}` : '') + '。',
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
