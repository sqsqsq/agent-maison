// ============================================================================
// device-test-evidence.ts — 真机缺陷结构化合成与机器归因（plan d9e4b7c1 T2）
// ----------------------------------------------------------------------------
// 输入全部为**机器产物**（gap-notes/test-report 等 agent 散文不作输入）：
//   · hylyre trace.json：cases[].status + notes 里机器写入的 failure_artifacts 子句
//     （宿主实锤：failure_dir 会积累多个 step 的诊断文件且 dump 顶层无失败标记，
//      真失败 step 只能从该子句解析——缺失/多义/冲突一律 unjoinable，禁猜）；
//   · 选中派生计划 test-plan.hylyre.md：步骤定义（selector/动作，机器拥有）；
//   · failure_dir UI dump：expected screen 语境核验（basename 防逃逸）；
//   · ui-spec.yaml：spec 声明锚点（must_have_elements + 组件树 id/text）。
//
// 归因四分类（只有 product_actionable 可驱动回 coding，collector 侧再叠
// physical-only 白名单）：
//   product_actionable —— 三条件齐备：(i) selector 可归到 spec 锚点且推导出唯一
//     expected screen；(ii) 失败 dump 命中该屏**其他** identity 锚点（确认真机在
//     预期页面——防"导航错页时合法 selector 自然缺失"误回 coding）；(iii) 仅目标
//     selector 缺失（精确形态——namespaced 变体不算在场，这正是宿主 hc_bank_row_cmb
//     缺陷的形态）。
//   environment —— 只消费既有结构化来源（trace.run_failure_kind ∈ 设备/连接类）；
//     **绝不重新扫描散文日志**。
//   test_contract —— selector 无 spec 依据（测试自造）。
//   unknown —— 三条件不齐/歧义/其余（诚实降级，进 unverified 通路）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { loadUiSpecFile, uiSpecAbsPath, type UiSpecComponentNode, type UiSpecDoc } from '../../../harness/scripts/utils/ui-spec-shared';
import type {
  DeviceDefectClassification,
  DeviceTestEvidenceCase,
  DeviceTestEvidenceDocDraft,
} from '../../../harness/scripts/utils/device-test-evidence-shared';
import { computeHapSha256Full } from './build-fingerprint';

/** run 级结构化失败里属"设备/连接/会话"的环境类（RunFailureKind 子集） */
const ENVIRONMENT_RUN_FAILURE_KINDS: ReadonlySet<string> = new Set([
  'device_locked',
  'device_disconnect',
]);

export interface DerivedPlanStep {
  action: string;
  selectorKind?: 'by_id' | 'by_text';
  selector?: string;
  scope?: string;
}

/**
 * trace notes 的机器子句：`failure_artifacts: ui_dump=TC-001-step-9.json, screenshot=...`
 * **恰好一个**合法子句才返回结果（review P1：多子句静默取第一个会把旧 step 当作当前
 * 失败 step、误生成 product_actionable 牵引 coding 改错地方）——0 个或 >1 个一律 null，
 * 调用方按 unjoinable 处理（契约：缺失/多义/冲突禁猜）。
 */
export function parseFailureArtifactsClause(
  notes: string | undefined,
): { uiDump: string; screenshot?: string } | null {
  if (typeof notes !== 'string') return null;
  const matches = [...notes.matchAll(/failure_artifacts:\s*ui_dump=([^,\s]+)(?:\s*,\s*screenshot=([^,\s]+))?/g)];
  if (matches.length !== 1) return null;
  return { uiDump: matches[0][1], screenshot: matches[0][2] };
}

/**
 * 解析派生计划（markdown 表格）为 caseId → steps[]。
 * 步骤列为分号分隔的 JSON 对象序列（hylyre 派生格式）；单步解析失败保留占位
 * （action='__unparsed__'），命中失败 index 时按 unjoinable 处理。
 */
export function parseDerivedPlanSteps(planMdRaw: string): Map<string, DerivedPlanStep[]> {
  const out = new Map<string, DerivedPlanStep[]>();
  const lines = planMdRaw.split('\n');
  let stepsCol = -1;
  let idCol = -1;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').map(c => c.trim());
    // cells[0]/[last] 为空（表格边界）
    if (stepsCol < 0) {
      const sIdx = cells.findIndex(c => c.includes('测试步骤'));
      const iIdx = cells.findIndex(c => c.includes('用例编号'));
      if (sIdx >= 0 && iIdx >= 0) {
        stepsCol = sIdx;
        idCol = iIdx;
      }
      continue;
    }
    const caseId = cells[idCol] ?? '';
    if (!/^TC-/i.test(caseId)) continue;
    const stepsCell = cells[stepsCol] ?? '';
    const steps: DerivedPlanStep[] = stepsCell
      .split(/;\s*/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(sRaw => {
        try {
          const obj = JSON.parse(sRaw) as Record<string, Record<string, unknown>>;
          const action = Object.keys(obj)[0];
          const body = (obj[action] ?? {}) as Record<string, unknown>;
          const selectorKind =
            typeof body.by_id === 'string' ? ('by_id' as const)
            : typeof body.by_text === 'string' ? ('by_text' as const)
            : undefined;
          return {
            action,
            selectorKind,
            selector: selectorKind ? String(body[selectorKind]) : undefined,
            scope: typeof body.scope === 'string' ? body.scope : undefined,
          };
        } catch {
          return { action: '__unparsed__' };
        }
      });
    out.set(caseId, steps);
  }
  return out;
}

interface SpecAnchorIndex {
  /** 锚点（id 或 text）→ 声明它的 screen ids（去重） */
  idToScreens: Map<string, string[]>;
  textToScreens: Map<string, string[]>;
  /** screen → identity 锚点（must_have_elements 中的元素 id，排除 ref_* 参考图条目） */
  screenIdentityAnchors: Map<string, string[]>;
}

function walkNodes(node: UiSpecComponentNode | undefined, fn: (n: UiSpecComponentNode) => void): void {
  if (!node) return;
  fn(node);
  for (const c of node.children ?? []) walkNodes(c, fn);
}

export function buildSpecAnchorIndex(doc: UiSpecDoc): SpecAnchorIndex {
  const idToScreens = new Map<string, string[]>();
  const textToScreens = new Map<string, string[]>();
  const screenIdentityAnchors = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, screen: string): void => {
    const arr = map.get(key) ?? [];
    if (!arr.includes(screen)) arr.push(screen);
    map.set(key, arr);
  };
  for (const sc of doc.screens ?? []) {
    const identity = (sc.must_have_elements ?? []).filter(e => !/^ref_/.test(e));
    screenIdentityAnchors.set(sc.id, identity);
    for (const e of identity) add(idToScreens, e, sc.id);
    walkNodes(sc.root, n => {
      if (typeof n.id === 'string' && n.id) add(idToScreens, n.id, sc.id);
      if (typeof n.text === 'string' && n.text) add(textToScreens, n.text, sc.id);
    });
  }
  return { idToScreens, textToScreens, screenIdentityAnchors };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** dump 命中判定：id 须精确形态（namespaced 变体不算）；text 为存在性 */
export function anchorPresentInDump(
  dumpRaw: string,
  anchor: { kind: 'by_id' | 'by_text'; value: string },
): boolean {
  if (anchor.kind === 'by_id') {
    return new RegExp(`"id"\\s*:\\s*"${escapeRegExp(anchor.value)}"`).test(dumpRaw);
  }
  return dumpRaw.includes(anchor.value);
}

interface TraceCaseLike {
  id?: string;
  status?: string;
  notes?: string;
}

interface TraceLike {
  outcome?: string;
  run_failure_kind?: string;
  cases?: TraceCaseLike[];
}

export interface ComposeDeviceTestEvidenceOptions {
  projectRoot: string;
  feature: string;
  /** 本轮 pipeline holder 的 trace 路径（coordinator 直传；本模块不做任何 trace 寻找） */
  tracePath: string;
  /** 装机前计算的完整摘要；本函数写前复算当前 HAP，二者不一致即拒绝合成 */
  hapPath: string;
  expectedHapSha256Full: string;
  goalRunId: string;
  attemptId: string;
  deviceTarget: { serial: string | null; target_kind: string | null; session_id: string | null };
  installExecuted: boolean;
  installOk: boolean;
}

export type ComposeDeviceTestEvidenceResult =
  | { ok: true; doc: DeviceTestEvidenceDocDraft }
  | { ok: false; reason: string };

/**
 * coordinator（check-testing）调用的合成入口。写入门槛中的"复算 hash 一致"在此执行
 * （TOCTOU：装机后 HAP 被并发重建 → 拒绝合成，collector 走 unverified）。
 */
export function composeDeviceTestEvidence(
  opts: ComposeDeviceTestEvidenceOptions,
): ComposeDeviceTestEvidenceResult {
  const nowSha = computeHapSha256Full(opts.hapPath);
  if (!nowSha || nowSha !== opts.expectedHapSha256Full) {
    return {
      ok: false,
      reason: `HAP 在装机后被改写或不可读（装机前 ${opts.expectedHapSha256Full.slice(0, 12)}… vs 现 ${nowSha ? `${nowSha.slice(0, 12)}…` : '(不可读)'}）`,
    };
  }
  let trace: TraceLike;
  try {
    trace = JSON.parse(fs.readFileSync(opts.tracePath, 'utf-8')) as TraceLike;
  } catch (e) {
    return { ok: false, reason: `trace 不可读：${(e as Error).message}` };
  }
  const runFailureKind = typeof trace.run_failure_kind === 'string' ? trace.run_failure_kind : null;

  // spec 锚点索引（ui-spec 缺失/不可解析 → 全部归 unknown，诚实降级不猜）
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(opts.projectRoot, opts.feature));
  const anchors = uiDoc ? buildSpecAnchorIndex(uiDoc) : null;

  // 派生计划步骤定义（与 trace 同目录）
  const planPath = path.join(path.dirname(opts.tracePath), 'test-plan.hylyre.md');
  let planSteps: Map<string, DerivedPlanStep[]> | null = null;
  try {
    planSteps = parseDerivedPlanSteps(fs.readFileSync(planPath, 'utf-8'));
  } catch {
    planSteps = null;
  }

  const failureDir = path.resolve(path.dirname(opts.tracePath), 'failures');
  const cases: DeviceTestEvidenceCase[] = [];

  for (const c of trace.cases ?? []) {
    const caseId = typeof c.id === 'string' ? c.id : '';
    if (!caseId) continue;
    if (c.status !== '失败' && c.status !== '阻塞') continue;
    const notesExcerpt = typeof c.notes === 'string' ? c.notes.slice(0, 400) : undefined;
    const push = (
      classification: DeviceDefectClassification,
      extra: Partial<DeviceTestEvidenceCase> & { reason?: string } = {},
    ): void => {
      cases.push({
        case_id: caseId,
        status: String(c.status),
        classification,
        error_excerpt: notesExcerpt,
        ...extra,
      });
    };

    // run 级环境失败：整轮 case 归 environment（结构化来源，禁扫散文）
    if (runFailureKind && ENVIRONMENT_RUN_FAILURE_KINDS.has(runFailureKind)) {
      push('environment', { reason: `run 级结构化失败：${runFailureKind}` });
      continue;
    }

    // failure_artifacts 严格 join（缺失/多义/冲突一律 unjoinable，禁猜）
    const clause = parseFailureArtifactsClause(c.notes);
    if (!clause) {
      push('unjoinable', { reason: 'trace notes 无 failure_artifacts 机器子句' });
      continue;
    }
    const nameMatch = /^(.+)-step-(\d+)\.json$/.exec(clause.uiDump);
    if (!nameMatch || nameMatch[1] !== caseId) {
      push('unjoinable', { reason: `failure_artifacts 文件名与 case 不一致：${clause.uiDump}` });
      continue;
    }
    const dumpAbs = path.resolve(failureDir, clause.uiDump);
    if (!dumpAbs.startsWith(failureDir + path.sep)) {
      push('unjoinable', { reason: 'failure_artifacts 路径逃逸 failure_dir' });
      continue;
    }
    if (!fs.existsSync(dumpAbs)) {
      push('unjoinable', { reason: `UI dump 不存在：${clause.uiDump}` });
      continue;
    }
    const stepIdx = Number(nameMatch[2]);
    const steps = planSteps?.get(caseId);
    const step = steps?.[stepIdx];
    if (!step || step.action === '__unparsed__') {
      push('unjoinable', { reason: `派生计划中查不到 step ${stepIdx} 的定义` });
      continue;
    }
    if (!step.selectorKind || !step.selector) {
      push('unknown', { reason: `失败 step（${step.action}）无选择器，无法归因` });
      continue;
    }
    const failingStep = {
      index: stepIdx,
      action: step.action,
      selector_kind: step.selectorKind,
      selector: step.selector,
      ...(step.scope ? { scope: step.scope } : {}),
    };
    const evidence = {
      ui_dump: path.relative(opts.projectRoot, dumpAbs).split(path.sep).join('/'),
      ...(clause.screenshot
        ? { screenshot: path.relative(opts.projectRoot, path.resolve(failureDir, clause.screenshot)).split(path.sep).join('/') }
        : {}),
    };

    if (!anchors) {
      push('unknown', { reason: 'ui-spec.yaml 缺失或不可解析，selector 无从归 spec', failing_step: failingStep, evidence });
      continue;
    }
    const screens =
      step.selectorKind === 'by_id'
        ? anchors.idToScreens.get(step.selector)
        : anchors.textToScreens.get(step.selector);
    if (!screens || screens.length === 0) {
      push('test_contract', { reason: `selector 无 spec 依据（${step.selectorKind}=${step.selector} 不在 ui-spec）`, failing_step: failingStep, evidence });
      continue;
    }
    if (screens.length > 1) {
      push('unknown', { reason: `selector 归属多屏（${screens.join('、')}），expected screen 不唯一`, failing_step: failingStep, evidence });
      continue;
    }
    const screenId = screens[0];
    let dumpRaw: string;
    try {
      dumpRaw = fs.readFileSync(dumpAbs, 'utf-8');
    } catch {
      push('unjoinable', { reason: 'UI dump 不可读', failing_step: failingStep, evidence });
      continue;
    }
    const identity = anchors.screenIdentityAnchors.get(screenId) ?? [];
    const others = identity.filter(a => !(step.selectorKind === 'by_id' && a === step.selector));
    const otherHits = others.filter(a => anchorPresentInDump(dumpRaw, { kind: 'by_id', value: a }));
    if (others.length === 0 || otherHits.length === 0) {
      push('unknown', {
        reason: `dump 未命中 expected screen（${screenId}）的其他 identity 锚点——无法确认真机在预期页面（可能导航错页）`,
        failing_step: failingStep, expected_screen: screenId, evidence,
      });
      continue;
    }
    if (anchorPresentInDump(dumpRaw, { kind: step.selectorKind, value: step.selector })) {
      push('unknown', {
        reason: `目标锚点在 dump 中以精确形态在场——失败原因非缺失（可能 scope/时序问题）`,
        failing_step: failingStep, expected_screen: screenId, evidence,
      });
      continue;
    }
    push('product_actionable', { failing_step: failingStep, expected_screen: screenId, evidence });
  }

  return {
    ok: true,
    doc: {
      schema_version: '1.0',
      goal_run_id: opts.goalRunId,
      attempt_id: opts.attemptId,
      device_target: opts.deviceTarget,
      hap_sha256_full: opts.expectedHapSha256Full,
      install_executed: opts.installExecuted,
      install_ok: opts.installOk,
      trace_path: path.resolve(opts.tracePath),
      run_failure_kind: runFailureKind,
      cases,
    },
  };
}
