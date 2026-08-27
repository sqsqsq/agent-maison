// ============================================================================
// p0-semantic-gates.ts — P0 结构化业务状态迁移证明 + skip 治理
// （goal-fakepass-hardening t4/t5；openspec harness-gates delta）
// ============================================================================
// 事故对位（bc-openCard）：
//   - TC-006「点银行→直达成功页」在 trace 里"通过"，但验的是 fast path——"有动作+有断言"
//     级别的规则杀不死它（codex 二轮 P0-1）；必须要求 checkpoint 级状态迁移证据与
//     linked_flow 中间屏有序出现；
//   - 18 用例 explicit_skip 11 条（含正好能抓 bug 的 TC-011/017），通过率按已执行子集
//     100% 判「达标」——P0 skip 必须 fail-closed，双口径强制重算；人工 waiver 无效。
//
// 证据层次（诚实边界声明）：
//   本门禁对账的是【派生 Hylyre 计划的 step 序列】（真机实际执行物，trace outcome 证实
//   已执行）+ trace case 状态。当前 Hylyre trace 无 step 级运行时观测（页面签名/逐步
//   layout dump），坐标 touch 的运行时 hit-test 与 forbidden_element 运行时缺席证明
//   需要 provider 采集扩展——作为显式 deferred 项记录于 change tasks，不假装已覆盖。
//   即便如此，本层已确定性击杀事故形态：纯 wait 冒充（TC-007/008）、动作不指向
//   checkpoint 目标元素（TC-006 fast path 的 steps 不含 card_type_sheet 锚点）、
//   中间屏边无已执行 TC 支撑。
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
// t4b/t5：check-testing 侧——状态迁移证据 + 中间屏有序链 + skip 治理 + 双口径
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

function stepKind(step: ParsedStep): { kind: string; byId?: string; byText?: string } {
  const key = Object.keys(step)[0] ?? '';
  const body = (step[key] ?? {}) as Record<string, unknown>;
  return {
    kind: key,
    byId: typeof body.by_id === 'string' ? body.by_id : undefined,
    byText: typeof body.by_text === 'string' ? body.by_text : undefined,
  };
}

const ACTION_KINDS = new Set(['touch', 'input', 'swipe', 'scroll']);

export interface P0GateInputs {
  projectRoot: string;
  feature: string;
  planMd: string;
  reportMd: string;
  /** trace case 状态（id → 通过/失败/阻塞/跳过）；null=无 trace */
  traceCaseStatus: Map<string, string> | null;
  /** 报告结论声明（parseReportConclusionVerdict 输出） */
  reportConclusion: string | null;
  now?: () => Date;
}

/**
 * t5→c7e4a2d9：P0 覆盖 fail-closed。skip/未执行的 P0 一律 BLOCKER；缺口
 * **全部属于既有 explicit_skip_tc_ids 登记**时才复用既有
 * failure_kind=code_regression + actionability=agent_fixable（默认回 coding 恢复可测性/
 * 修复产品缺陷——不降低验收标准，修复不是授权行为）；status 为空或未经登记的 trace skip
 * 不产 coding 候选（留在 testing 补执行/派生事实）；外部条件仍由既有 envBlocked/DEFERRED
 * 优先处置，不伪装 explicit skip；任何 P0 skip 存在时报告结论不得
 * 无条件「达标」；双口径（全分母执行覆盖率+通过率）写入 details，与"已执行子集 100%"话术对账。
 */
export function evaluateP0CoverageIntegrity(inp: P0GateInputs): CheckResult[] {
  const id = 'p0_coverage_integrity';
  const description = 'P0 用例覆盖 fail-closed（skip 不可豁免；双口径重算；达标结论对账）';
  const entries = parsePlanTcEntries(inp.planMd);
  const p0 = entries.filter((e) => e.priority.toUpperCase() === 'P0');
  if (p0.length === 0) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: '计划无 P0 用例（或表格无法解析）。' }];
  }

  const reportsBase = path.join(receiptDirPath(inp.projectRoot, inp.feature, 'testing'), 'reports');
  const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
  const explicitSkips = new Set(
    pick.selected ? loadExplicitSkipTcIds(pick.selected.hylyrePath, pick.selected.content) : [],
  );

  const status = (tc: string): string => inp.traceCaseStatus?.get(tc) ?? '';
  const executedPassed = p0.filter((e) => status(e.id) === '通过');
  // 三组分别计算（c7e4a2d9）：explicit skip（既有 explicit_skip_tc_ids 登记）/
  // trace 明确 skip（未经登记的「跳过」）/ status 为空（未执行且无任何登记）。
  const skipped = p0.filter((e) => explicitSkips.has(e.id) || status(e.id) === '跳过' || status(e.id) === '');
  const isExplicit = (tc: string): boolean => explicitSkips.has(tc);

  const unexecutedExplicit: string[] = [];
  const unexecutedTraceOrEmpty: string[] = [];
  for (const e of skipped) {
    (isExplicit(e.id) ? unexecutedExplicit : unexecutedTraceOrEmpty).push(e.id);
  }

  const coverage = `${executedPassed.length}/${p0.length}`;
  const dual = `全分母口径：P0 执行通过 ${coverage}（覆盖率 ${Math.round((executedPassed.length / p0.length) * 100)}%），skip ${skipped.length}`;

  const results: CheckResult[] = [];
  if (unexecutedExplicit.length > 0 || unexecutedTraceOrEmpty.length > 0) {
    const explicitOnly = unexecutedTraceOrEmpty.length === 0;
    const items = [...unexecutedExplicit, ...unexecutedTraceOrEmpty];
    const fail: CheckResult = {
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details:
        `P0 用例被跳过/未执行（${items.length}）：${items.slice(0, 10).join('、')}${items.length > 10 ? '…' : ''}。\n${dual}。\n` +
        (explicitOnly
          ? '全部缺口均属既有 explicit_skip_tc_ids 登记——仓内需恢复可执行性的缺陷（code_regression），' +
            '默认回 coding 修复最小可测性/产品缺陷并重测；人工 waiver 不能降低 P0 标准。'
          : '含 status 为空或未经 explicit_skip_tc_ids 登记的 trace skip——留在 testing 恢复执行/派生计划；' +
            '外部环境阻塞走既有 DEFERRED；人工 waiver 不能改写执行事实。'),
      suggestion: explicitOnly
        ? '不降低验收标准的修复不是授权行为：回 coding 恢复可测性/修复缺陷后重跑；同指纹无进展由既有熔断收口。'
        : '在 testing 补 P0 执行或派生事实后重跑；外部阻塞按 DEFERRED 登记。',
    };
    if (explicitOnly) {
      // c7e4a2d9：未豁免缺口全为 explicit skip → 复用既有 code_regression（agent_fixable），
      // testing summary writer 据此产普通 RepairCandidate(category=coding)，不注册整个 check。
      fail.failure_kind = 'code_regression';
      fail.actionability = 'agent_fixable';
    }
    results.push(fail);
  } else {
    results.push({
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `${dual}。P0 全量执行通过。`,
    });
  }

  // 达标结论对账：存在任何 P0 skip（含 waived）时不得无条件「达标」
  if (skipped.length > 0 && inp.reportConclusion === '达标') {
    results.push({
      id: 'p0_pass_rate_dual_metrics',
      category: 'structure',
      description: '通过率双口径对账（skip 计入分母；结论不得以已执行子集冒充全量）',
      severity: 'BLOCKER', status: 'FAIL',
      details:
        `报告结论声明「达标」，但 ${dual}——已执行子集通过率不构成全量达标` +
        '（bc-openCard：7/7=100% 冒充 18 条全量）。结论应为「有条件达标」并列示全分母双口径。',
    });
  } else {
    results.push({
      id: 'p0_pass_rate_dual_metrics',
      category: 'structure',
      description: '通过率双口径对账（skip 计入分母；结论不得以已执行子集冒充全量）',
      severity: 'BLOCKER', status: 'PASS',
      details: dual,
    });
  }
  return results;
}

/**
 * t4b：P0 状态迁移证据（对账派生计划 step 序列——真机实际执行物）：
 *   ①映射完整：每个 P0 交互 AC → ≥1 计划 TC（ac_refs）；
 *   ②纯 wait 冒充：已执行 P0 TC（映射交互 AC）步序无任何动作 step → FAIL；
 *   ③动作指向：checkpoint.action.target_element_id 必须出现在某动作 step 的 by_id；
 *   ④后置断言：目标动作之后存在 wait_for/assert 且 by_id ∈ required_element_ids；
 *   ⑤中间屏有序链：flow 每条边须有 ≥1 已执行且通过的 owning TC（缺中间屏证据=事故死刑条款）。
 */
export function evaluateP0SemanticCoverage(inp: P0GateInputs): CheckResult[] {
  const id = 'p0_semantic_coverage_integrity';
  const description = 'P0 结构化状态迁移证据（checkpoint 对账派生计划 step 序列 + 中间屏有序链）';
  const doc = loadAcceptanceFlowsDoc(inp.projectRoot, inp.feature);
  const p0Acs = (doc?.criteria ?? []).filter(isP0DeviceInteractive);
  if (!doc || p0Acs.length === 0) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: '无 P0 device 交互 AC（或 acceptance 不可解析）。' }];
  }

  const planEntries = parsePlanTcEntries(inp.planMd);
  const reportsBase = path.join(receiptDirPath(inp.projectRoot, inp.feature, 'testing'), 'reports');
  const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
  if (!pick.selected) {
    return [{ id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL', details: '无有效派生 Hylyre 计划——P0 状态迁移证据无从对账。' }];
  }
  const derivedCases = extractDerivedPlanCases(pick.selected.content);
  const explicitSkips = new Set(loadExplicitSkipTcIds(pick.selected.hylyrePath, pick.selected.content));
  const stepsByTc = new Map<string, ParsedStep[]>();
  for (const row of derivedCases) {
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    stepsByTc.set(row.tc_id.toUpperCase(), parsed.ok ? parsed.steps : []);
  }
  const passedTc = (tc: string): boolean => (inp.traceCaseStatus?.get(tc) ?? '') === '通过';
  const executedTcFor = (acId: string): string[] =>
    planEntries
      .filter((e) => e.acRefs.includes(acId))
      .map((e) => e.id)
      .filter((tc) => stepsByTc.has(tc) && !explicitSkips.has(tc));

  const failures: string[] = [];
  const acEvidenceOk = new Map<string, boolean>();

  for (const ac of p0Acs) {
    const mapped = planEntries.filter((e) => e.acRefs.includes(ac.id));
    if (mapped.length === 0) {
      failures.push(`${ac.id}：无任何计划 TC 引用（映射缺失——test-plan 用例行须含 ${ac.id}）`);
      acEvidenceOk.set(ac.id, false);
      continue;
    }
    const cp = ac.checkpoint;
    if (!checkpointComplete(cp)) {
      failures.push(`${ac.id}：acceptance 缺完整 checkpoint（spec 门禁应已拦截，此处兜底）`);
      acEvidenceOk.set(ac.id, false);
      continue;
    }
    const executed = executedTcFor(ac.id);
    if (executed.length === 0) {
      // 全部 skip → 归 t5 治理；本门禁记边无证据
      acEvidenceOk.set(ac.id, false);
      continue;
    }
    let acOk = false;
    const acWhy: string[] = [];
    for (const tc of executed) {
      const steps = stepsByTc.get(tc) ?? [];
      const kinds = steps.map(stepKind);
      const actionIdx = kinds.findIndex((k) => ACTION_KINDS.has(k.kind));
      if (actionIdx < 0) {
        acWhy.push(`${tc}：纯 wait 序列（无任何动作 step——TC-007/008 型冒充）`);
        continue;
      }
      const targetIdx = kinds.findIndex((k) => ACTION_KINDS.has(k.kind) && k.byId === cp!.action!.target_element_id);
      if (targetIdx < 0) {
        acWhy.push(`${tc}：动作未指向 checkpoint 目标元素 ${cp!.action!.target_element_id}`);
        continue;
      }
      const required = new Set(cp!.required_element_ids ?? []);
      const postAssert = kinds.slice(targetIdx + 1).some((k) => k.kind === 'wait_for' && k.byId !== undefined && required.has(k.byId));
      if (!postAssert) {
        acWhy.push(`${tc}：目标动作后无 wait_for(by_id ∈ required_element_ids=${[...required].join(',')}) 后置断言`);
        continue;
      }
      if (passedTc(tc)) {
        acOk = true;
        break;
      }
      acWhy.push(`${tc}：步序合规但 trace 非通过`);
    }
    acEvidenceOk.set(ac.id, acOk);
    if (!acOk) failures.push(`${ac.id}：无一执行 TC 提供合规状态迁移证据（${acWhy.slice(0, 3).join('；')}）`);
  }

  // ⑤ 中间屏有序链：每条 flow 边须有 owning AC 的证据成立
  for (const [flowName, screens] of Object.entries(doc.flows)) {
    if (!p0Acs.some((ac) => ac.linked_flow === flowName)) continue;
    for (let i = 0; i + 1 < screens.length; i++) {
      const owners = p0Acs.filter(
        (ac) =>
          ac.linked_flow === flowName &&
          checkpointComplete(ac.checkpoint) &&
          ac.checkpoint!.pre_screen === screens[i] &&
          ac.checkpoint!.post_screen === screens[i + 1],
      );
      if (owners.length === 0) continue; // spec 门禁已拦无主边
      if (!owners.some((ac) => acEvidenceOk.get(ac.id))) {
        failures.push(
          `flow ${flowName}：边 ${screens[i]}→${screens[i + 1]} 无已执行且通过的证据 TC` +
          `（缺中间屏证据——「点银行直达成功页」的确定性死刑条款）`,
        );
      }
    }
  }

  if (failures.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details: `P0 状态迁移证据不成立（${failures.length} 项）：\n` + failures.slice(0, 10).join('\n') + (failures.length > 10 ? '\n…' : ''),
      suggestion:
        '派生计划各 P0 TC 须：动作 step 指向 checkpoint.target_element_id + 其后 wait_for required_element_ids；' +
        'flow 每条边须有已执行通过的 owning TC。运行时 hit-test/页面签名扩展见 change tasks deferred 项。',
    }];
  }
  // This gate intentionally proves only the planned step contract. Runtime
  // observations are now enforced independently by p0_runtime_step_evidence;
  // keeping the boundaries separate avoids treating a plan match as a hit-test.
  return [
    {
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `P0 交互 AC ${p0Acs.length} 条状态迁移证据（计划 step 级）成立；flow 中间屏边全部有已执行通过的 owning TC。`,
    },
    {
      id: 'p0_runtime_step_evidence_boundary',
      category: 'structure',
      description: 'P0 计划级与运行时证据边界',
      severity: 'MINOR', status: 'PASS',
      details:
        '本检查只证明派生计划步序与 trace case 结果一致；实际 hit target、bounds、pre/post 屏幕签名、' +
        'required/forbidden 观测由独立 BLOCKER 检查 p0_runtime_step_evidence 负责。',
    },
  ];
}
