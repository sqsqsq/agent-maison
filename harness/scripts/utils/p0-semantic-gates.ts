// ============================================================================
// p0-semantic-gates.ts — P0 结构化业务状态迁移证明 + skip 治理
// （goal-fakepass-hardening t4/t5；openspec harness-gates delta）
// ============================================================================
// 事故对位（bc-openCard）：
//   - TC-006「点银行→直达成功页」在 trace 里"通过"，但验的是 fast path——"有动作+有断言"
//     级别的规则杀不死它（codex 二轮 P0-1）；必须要求 checkpoint 级状态迁移证据与
//     linked_flow 中间屏有序出现；
//   - 18 用例 explicit_skip 11 条（含正好能抓 bug 的 TC-011/017），通过率按已执行子集
//     100% 判「达标」——P0 skip 必须 fail-closed，waiver 只降级不洗白，双口径强制重算。
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

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { featureFilePath, receiptDirPath, resolveFeatureArtifact } from '../../config';
import {
  defaultTrustRegistryPath,
  validateConfirmationReceiptFile,
} from './confirmation-receipt';
import {
  extractDerivedPlanCases,
  loadExplicitSkipTcIds,
  parsePlannedStepsFromCell,
  selectBestNonPlaceholderDerivedPlan,
} from './derived-hylyre-plan';
import { extractTables, getSectionContent } from './markdown-parser';
import { sha256File } from './phase-evidence-manifest';
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
  snippet_sha256?: string;
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

  // ② requirement_ref 验存：snippet 哈希一致 且 逐字存在于源文档（引文级可追溯）
  for (const ac of p0) {
    const ref = ac.requirement_ref;
    if (!ref?.source_path || !ref.snippet || !ref.snippet_sha256) {
      failures.push(`${ac.id}：缺 requirement_ref{source_path,snippet,snippet_sha256}`);
      continue;
    }
    const snippetSha = crypto.createHash('sha256').update(ref.snippet, 'utf-8').digest('hex');
    if (snippetSha !== ref.snippet_sha256) {
      failures.push(`${ac.id}：requirement_ref.snippet 与 snippet_sha256 失配`);
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
        '为每个 P0 交互 AC 补 checkpoint（pre/action/post/required）与 requirement_ref（源文档逐字片段+sha256）；' +
        'flows 声明有序屏链且每条边由 ≥1 P0 AC 拥有。',
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details: `P0 交互 AC ${p0.length} 条 checkpoint/引文/flow 合成全部合法。`,
  }];
}

/** flow_contract 绑定哈希口径（签发侧对齐；requirement 文本由调用方传入） */
export function flowContractObjectHash(
  projectRoot: string,
  feature: string,
  requirementText: string,
): string {
  const acc = resolveFeatureArtifact(projectRoot, feature, 'acceptance.yaml');
  const uiSpec = featureFilePath(projectRoot, feature, path.join('spec', 'ui-spec.yaml'));
  const parts = [
    acc.exists ? sha256File(acc.actualPath) ?? '' : '',
    fs.existsSync(uiSpec) ? sha256File(uiSpec) ?? '' : '',
    crypto.createHash('sha256').update(requirementText, 'utf-8').digest('hex'),
  ];
  return crypto.createHash('sha256').update(parts.join('\n'), 'utf-8').digest('hex');
}

export function flowContractReceiptPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'flow-contract.receipt.json'));
}

/**
 * t4b flow_contract 确认点（codex 四轮 P0-3）：首次生成的结构化流程模型须真人确认；
 * AC/checkpoint/flow/ui-spec/需求任一改动 → 绑定哈希失配自动 stale。
 * 无有效 receipt：WARN（工作可继续）+ 完成侧 clean_pass 拒绝（不得 FEATURE_COMPLETED）。
 */
export function evaluateFlowContract(
  projectRoot: string,
  feature: string,
  requirementText: string,
): CheckResult[] {
  const id = 'acceptance_flow_contract';
  const description = '结构化流程模型真人确认（flow_contract receipt；改动即 stale）';
  const doc = loadAcceptanceFlowsDoc(projectRoot, feature);
  const applicable = doc && doc.criteria.some(isP0DeviceInteractive) && Object.keys(doc.flows).length > 0;
  if (!applicable) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: '无 P0 device flow，flow_contract 不适用。' }];
  }
  const v = validateConfirmationReceiptFile(
    flowContractReceiptPath(projectRoot, feature),
    defaultTrustRegistryPath(projectRoot),
    { action: 'flow_contract', feature, object_hash: flowContractObjectHash(projectRoot, feature, requirementText) },
  );
  if (v.valid) {
    return [{ id, category: 'structure', description, severity: 'MAJOR', status: 'PASS', details: 'flow_contract receipt 有效（绑定哈希当前）。' }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'MAJOR', status: 'WARN',
    details:
      `flow_contract receipt 缺失/无效/已 stale：${v.reasons.join('；')}。` +
      '结构化流程模型（AC 集是否完整转写需求）无法全机器证明——须真人确认；' +
      '工作可继续，但 feature 不得 FEATURE_COMPLETED（clean_pass 拒绝），run 封顶 AWAITING_HUMAN_REVIEW。',
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

/** 顶层 test-plan.md 用例表：id + 优先级 + 行内 AC-\d+ 引用 */
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
      const acRefs = [...new Set((row.join(' ').match(/AC-\d+/gi) ?? []).map((s) => s.toUpperCase()))];
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

export interface SkipWaiverEntry {
  tc_id: string;
  reason?: string;
  receipt_path?: string;
}

export function skipWaiversPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('testing', 'skip-waivers.yaml'));
}

export function p0SkipObjectHash(feature: string, tcId: string): string {
  return crypto.createHash('sha256').update(`${feature}\n${tcId}`, 'utf-8').digest('hex');
}

function loadSkipWaivers(projectRoot: string, feature: string): SkipWaiverEntry[] {
  const p = skipWaiversPath(projectRoot, feature);
  if (!fs.existsSync(p)) return [];
  try {
    const doc = YAML.parse(fs.readFileSync(p, 'utf-8')) as { waivers?: SkipWaiverEntry[] };
    return Array.isArray(doc?.waivers) ? doc.waivers : [];
  } catch {
    return [];
  }
}

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
 * t5：P0 覆盖 fail-closed。skip/未执行的 P0 须逐条 receipt waiver（p0_skip_waiver），
 * 否则 BLOCKER（failure_kind=await_human_p0_skip → goal 首触 halt 求人）；
 * waived 仅降级 WARN；任何 P0 skip 存在时报告结论不得无条件「达标」；
 * 双口径（全分母执行覆盖率+通过率）写入 details，与"已执行子集 100%"话术对账。
 */
export function evaluateP0CoverageIntegrity(inp: P0GateInputs): CheckResult[] {
  const id = 'p0_coverage_integrity';
  const description = 'P0 用例覆盖 fail-closed（skip 须凭证 waiver；双口径重算；达标结论对账）';
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
  const skipped = p0.filter((e) => explicitSkips.has(e.id) || status(e.id) === '跳过' || status(e.id) === '');

  const waivers = loadSkipWaivers(inp.projectRoot, inp.feature);
  const registryPath = defaultTrustRegistryPath(inp.projectRoot);
  const unwaived: string[] = [];
  const waived: string[] = [];
  for (const e of skipped) {
    const w = waivers.find((x) => x.tc_id?.toUpperCase() === e.id);
    if (w?.receipt_path) {
      const v = validateConfirmationReceiptFile(
        path.join(inp.projectRoot, w.receipt_path),
        registryPath,
        { action: 'p0_skip_waiver', feature: inp.feature, object_hash: p0SkipObjectHash(inp.feature, e.id), now: inp.now },
      );
      if (v.valid) {
        waived.push(e.id);
        continue;
      }
      unwaived.push(`${e.id}（waiver receipt 无效：${v.reasons.slice(0, 2).join('；')}）`);
      continue;
    }
    unwaived.push(e.id);
  }

  const coverage = `${executedPassed.length}/${p0.length}`;
  const dual = `全分母口径：P0 执行通过 ${coverage}（覆盖率 ${Math.round((executedPassed.length / p0.length) * 100)}%），skip ${skipped.length}（waived ${waived.length}）`;

  const results: CheckResult[] = [];
  if (unwaived.length > 0) {
    results.push({
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'await_human_p0_skip',
      details:
        `P0 用例被跳过/未执行且无有效凭证 waiver（${unwaived.length}）：${unwaived.slice(0, 10).join('、')}${unwaived.length > 10 ? '…' : ''}。\n${dual}。\n` +
        'P0 skip 不可由 agent 自决：外部环境阻塞走 DEFERRED；非外部原因（selector 缺失/计划未写完/产品 bug）请修复后执行；' +
        '真人豁免须 skip-waivers.yaml 逐条 receipt（p0_skip_waiver）。',
      suggestion: '这是设计内求人时刻（首触即 halt）：请真人裁决各 skip 的去留后 resume。',
    });
  } else if (skipped.length > 0) {
    results.push({
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'WARN',
      details: `${dual}。全部 skip 已凭证豁免——降级不洗白：run 封顶 AWAITING_HUMAN_REVIEW，feature 不得 FEATURE_COMPLETED。`,
    });
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
  // 诚实边界（codex 六轮 P0-3）：本层证据=派生计划 step 文本 + trace case 状态，
  // **不含**运行时逐步屏幕序列/实际 action target/layout hit-test/forbidden 缺席。
  // "计划文本正确 + 运行时仍走 fast path + TC 自报通过"这一残余面须待 provider step 级
  // 采集扩展封死——PASS 不得被读成"运行时忠实执行了声明流程"。附加显式 WARN 声明该边界，
  // 避免绿灯被误读为完整运行时证明。
  return [
    {
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `P0 交互 AC ${p0Acs.length} 条状态迁移证据（计划 step 级）成立；flow 中间屏边全部有已执行通过的 owning TC。`,
    },
    {
      id: 'p0_runtime_step_evidence_boundary',
      category: 'structure',
      description: 'P0 运行时逐步证据边界声明（deferred：需 Hylyre provider step 级采集）',
      severity: 'MAJOR', status: 'WARN',
      details:
        '本 PASS 基于派生计划 step 文本 + trace case 状态，**不构成运行时忠实性证明**：' +
        '实际 action target / 逐步屏幕序列 / layout hit-test / forbidden 元素缺席尚未运行时校验' +
        '（Hylyre trace 现无 step 级观测，provider 采集扩展为 change deferred 项）。' +
        '风险残余面：计划文本正确但运行时走 fast path 且 TC 自报通过。视觉 diff（visual_diff_capture）' +
        '与真机 trace outcome 为当前互补证据；完整封死待 provider 扩展。',
    },
  ];
}
