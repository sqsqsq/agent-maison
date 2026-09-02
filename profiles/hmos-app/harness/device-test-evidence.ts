// ============================================================================
// device-test-evidence.ts — legacy 真机缺陷结构化兼容与机器归因
// （native 0.4 CaseResult/StepResult 不经本模块合成；本模块只保留历史 bounded evidence）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  loadUiSpecFile,
  uiSpecAbsPath,
  type UiSpecComponentNode,
  type UiSpecDoc,
} from '../../../harness/scripts/utils/ui-spec-shared';
import type {
  DeviceDefectClassification,
  DeviceEvidenceObservation,
  DeviceTestEvidenceCase,
  DeviceTestEvidenceDocDraft,
} from '../../../harness/scripts/utils/device-test-evidence-shared';
import { composeRuntimeFidelityEvidence } from '../../../harness/scripts/utils/runtime-step-evidence';
import { computeHapSha256Full } from './build-fingerprint';

const ENVIRONMENT_RUN_FAILURE_KINDS: ReadonlySet<string> = new Set([
  'device_locked',
  'device_disconnect',
]);

const OBSERVABLE_STATE_KEYS = [
  'enabled',
  'visible',
  'clickable',
  'checked',
  'selected',
  'focused',
] as const;
// all:[...] 等组合选择器内的状态语义本期不提升为节点状态；无法稳定绑定单一节点时诚实落 unknown。
type ObservableStateKey = typeof OBSERVABLE_STATE_KEYS[number];

export interface DerivedPlanStep {
  action: string;
  selectorKind?: 'by_id' | 'by_text';
  selector?: string;
  scope?: string;
  /** action body 原样保真；未知字段不得丢失。 */
  payload: Record<string, unknown>;
}

export function parseFailureArtifactsClause(
  notes: string | undefined,
): { uiDump: string; screenshot?: string } | null {
  if (typeof notes !== 'string') return null;
  const matches = [...notes.matchAll(/failure_artifacts:\s*ui_dump=([^,\s]+)(?:\s*,\s*screenshot=([^,\s]+))?/g)];
  if (matches.length !== 1) return null;
  return { uiDump: matches[0][1], screenshot: matches[0][2] };
}

/** 解析派生计划为 caseId → steps[]；payload 保留 action body 全字段。 */
export function parseDerivedPlanSteps(planMdRaw: string): Map<string, DerivedPlanStep[]> {
  const out = new Map<string, DerivedPlanStep[]>();
  const lines = planMdRaw.split('\n');
  let stepsCol = -1;
  let idCol = -1;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').map(c => c.trim());
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
    const steps: DerivedPlanStep[] = (cells[stepsCol] ?? '')
      .split(/;\s*/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(sRaw => {
        try {
          const obj = JSON.parse(sRaw) as Record<string, unknown>;
          const action = Object.keys(obj)[0];
          const rawBody = obj[action];
          const payload =
            rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
              ? { ...(rawBody as Record<string, unknown>) }
              : {};
          const selectorKind =
            typeof payload.by_id === 'string' ? ('by_id' as const)
            : typeof payload.by_text === 'string' ? ('by_text' as const)
            : undefined;
          return {
            action,
            selectorKind,
            selector: selectorKind ? String(payload[selectorKind]) : undefined,
            scope: typeof payload.scope === 'string' ? payload.scope : undefined,
            payload,
          };
        } catch {
          return { action: '__unparsed__', payload: {} };
        }
      });
    out.set(caseId, steps);
  }
  return out;
}

interface SpecAnchorIndex {
  idToScreens: Map<string, string[]>;
  textToScreens: Map<string, string[]>;
  screenIdentityAnchors: Map<string, string[]>;
  screenIds: Set<string>;
}

function walkNodes(node: UiSpecComponentNode | undefined, fn: (n: UiSpecComponentNode) => void): void {
  if (!node) return;
  fn(node);
  for (const child of node.children ?? []) walkNodes(child, fn);
}

export function buildSpecAnchorIndex(doc: UiSpecDoc): SpecAnchorIndex {
  const idToScreens = new Map<string, string[]>();
  const textToScreens = new Map<string, string[]>();
  const screenIdentityAnchors = new Map<string, string[]>();
  const screenIds = new Set<string>();
  const add = (map: Map<string, string[]>, key: string, screen: string): void => {
    const values = map.get(key) ?? [];
    if (!values.includes(screen)) values.push(screen);
    map.set(key, values);
  };
  for (const screen of doc.screens ?? []) {
    screenIds.add(screen.id);
    const identity = (screen.must_have_elements ?? []).filter(element => !/^ref_/.test(element));
    screenIdentityAnchors.set(screen.id, identity);
    for (const element of identity) add(idToScreens, element, screen.id);
    walkNodes(screen.root, node => {
      if (typeof node.id === 'string' && node.id) add(idToScreens, node.id, screen.id);
      if (typeof node.text === 'string' && node.text) add(textToScreens, node.text, screen.id);
    });
  }
  return { idToScreens, textToScreens, screenIdentityAnchors, screenIds };
}

interface DumpNode {
  id?: string;
  text?: string;
  originalText?: string;
  enabled?: boolean;
  visible?: boolean;
  clickable?: boolean;
  checked?: boolean;
  selected?: boolean;
  focused?: boolean;
}

function collectDumpNodes(dumpRaw: string): DumpNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(dumpRaw);
  } catch {
    return [];
  }
  const nodes: DumpNode[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.id === 'string' ||
      typeof record.text === 'string' ||
      typeof record.originalText === 'string'
    ) {
      const node: DumpNode = {};
      for (const key of ['id', 'text', 'originalText'] as const) {
        if (typeof record[key] === 'string') node[key] = record[key] as string;
      }
      for (const key of OBSERVABLE_STATE_KEYS) {
        const value = record[key];
        if (typeof value === 'boolean') node[key] = value;
        else if (value === 'true' || value === 'false') node[key] = value === 'true';
      }
      nodes.push(node);
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(parsed);
  return nodes;
}

interface TraceCaseLike {
  id?: string;
  status?: string;
  notes?: string;
}

interface TraceLike {
  schema_version?: string;
  outcome?: string;
  run_failure_kind?: string;
  cases?: TraceCaseLike[];
}

export interface ComposeDeviceTestEvidenceOptions {
  projectRoot: string;
  feature: string;
  tracePath: string;
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

interface PreparedFailure {
  traceCase: TraceCaseLike;
  caseId: string;
  status: string;
  notesExcerpt?: string;
  clause?: { uiDump: string; screenshot?: string };
  stepIdx?: number;
  step?: DerivedPlanStep;
  dumpAbs?: string;
  dumpRaw?: string;
  dumpNodes: DumpNode[];
  joinReason?: string;
}

interface PoolFrame {
  caseId: string;
  stepIdx: number;
  dumpAbs: string;
  dumpRaw: string;
  nodes: DumpNode[];
}

function relativePortable(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

function expectedStateOf(payload: Record<string, unknown>): Partial<Record<ObservableStateKey, boolean>> {
  const expected: Partial<Record<ObservableStateKey, boolean>> = {};
  for (const key of OBSERVABLE_STATE_KEYS) {
    if (typeof payload[key] === 'boolean') expected[key] = payload[key] as boolean;
  }
  return expected;
}

function nodeSatisfies(
  node: DumpNode,
  expected: Partial<Record<ObservableStateKey, boolean>>,
): boolean {
  return Object.entries(expected).every(([key, value]) => node[key as ObservableStateKey] === value);
}

function nodeSummary(node: DumpNode): DeviceEvidenceObservation['node'] {
  const summary: DeviceEvidenceObservation['node'] = {};
  if (node.id) summary.id = node.id;
  if (node.text) summary.text = node.text;
  for (const key of OBSERVABLE_STATE_KEYS) {
    if (typeof node[key] === 'boolean') summary[key] = node[key];
  }
  return summary;
}

/**
 * plan e6b3f8d2 t3：kit 撤销后**只认裸 ui-spec node id**——`maison:` 锚点反解分支
 * 随锚点模块一并删除（不保留第二套锚点机制）。screen 参数保留在签名上，
 * 是为了让调用点继续显式表达"在哪一屏找哪个节点"，判据本身与屏无关。
 */
function specNodePresentInFrame(frame: { dumpNodes: DumpNode[] }, _screen: string, specNode: string): boolean {
  return frame.dumpNodes.some(node => node.id === specNode);
}

interface SelectorBinding {
  screens: string[];
}

/**
 * plan e6b3f8d2 t3：selector 归属只走**既有 ui-spec 声明**（裸 node id / text）。
 * `maison:` anchor 反解与随之而来的锚点漂移归因整链删除——
 * 那条链要求产品代码注入 framework 侧规定的 canonical anchor，正是本轮撤销的错误约束。
 */
function resolveSelectorBinding(
  step: DerivedPlanStep,
  anchors: SpecAnchorIndex,
): SelectorBinding {
  if (!step.selectorKind || !step.selector) return { screens: [] };
  if (step.selectorKind === 'by_text') {
    return { screens: anchors.textToScreens.get(step.selector) ?? [] };
  }
  return { screens: anchors.idToScreens.get(step.selector) ?? [] };
}

function prepareFailures(
  trace: TraceLike,
  failureDir: string,
  planSteps: Map<string, DerivedPlanStep[]> | null,
): PreparedFailure[] {
  const prepared: PreparedFailure[] = [];
  for (const traceCase of trace.cases ?? []) {
    const caseId = typeof traceCase.id === 'string' ? traceCase.id : '';
    if (!caseId || (traceCase.status !== '失败' && traceCase.status !== '阻塞')) continue;
    const item: PreparedFailure = {
      traceCase,
      caseId,
      status: String(traceCase.status),
      notesExcerpt: typeof traceCase.notes === 'string' ? traceCase.notes.slice(0, 400) : undefined,
      dumpNodes: [],
    };
    const clause = parseFailureArtifactsClause(traceCase.notes);
    if (!clause) {
      item.joinReason = 'trace notes 无唯一 failure_artifacts 机器子句';
      prepared.push(item);
      continue;
    }
    item.clause = clause;
    const nameMatch = /^(.+)-step-(\d+)\.json$/.exec(clause.uiDump);
    if (!nameMatch || nameMatch[1] !== caseId) {
      item.joinReason = `failure_artifacts 文件名与 case 不一致：${clause.uiDump}`;
      prepared.push(item);
      continue;
    }
    const dumpAbs = path.resolve(failureDir, clause.uiDump);
    if (!dumpAbs.startsWith(failureDir + path.sep)) {
      item.joinReason = 'failure_artifacts 路径逃逸 failure_dir';
      prepared.push(item);
      continue;
    }
    if (!fs.existsSync(dumpAbs)) {
      item.joinReason = `UI dump 不存在：${clause.uiDump}`;
      prepared.push(item);
      continue;
    }
    item.stepIdx = Number(nameMatch[2]);
    item.dumpAbs = dumpAbs;
    try {
      item.dumpRaw = fs.readFileSync(dumpAbs, 'utf-8');
      item.dumpNodes = collectDumpNodes(item.dumpRaw);
    } catch {
      item.joinReason = 'UI dump 不可读';
      prepared.push(item);
      continue;
    }
    item.step = planSteps?.get(caseId)?.[item.stepIdx];
    if (!item.step || item.step.action === '__unparsed__') {
      item.joinReason = `派生计划中查不到 step ${item.stepIdx} 的定义`;
    }
    prepared.push(item);
  }
  return prepared;
}

export function composeDeviceTestEvidence(
  opts: ComposeDeviceTestEvidenceOptions,
): ComposeDeviceTestEvidenceResult {
  const nowSha = computeHapSha256Full(opts.hapPath);
  if (!nowSha || nowSha !== opts.expectedHapSha256Full) {
    return {
      ok: false,
      reason:
        `HAP 在装机后被改写或不可读（装机前 ${opts.expectedHapSha256Full.slice(0, 12)}… vs 现 ` +
        `${nowSha ? `${nowSha.slice(0, 12)}…` : '(不可读)'})`,
    };
  }
  let trace: TraceLike;
  try {
    trace = JSON.parse(fs.readFileSync(opts.tracePath, 'utf-8')) as TraceLike;
  } catch (error) {
    return { ok: false, reason: `trace 不可读：${(error as Error).message}` };
  }
  // inventory §一 G11：native evidence 合成的判据随协议提升到 v1。
  if (trace.schema_version === '0.4-p0') {
    return {
      ok: true,
      doc: {
        schema_version: '1.1',
        goal_run_id: opts.goalRunId,
        attempt_id: opts.attemptId,
        device_target: opts.deviceTarget,
        hap_sha256_full: opts.expectedHapSha256Full,
        install_executed: opts.installExecuted,
        install_ok: opts.installOk,
        trace_path: path.resolve(opts.tracePath),
        run_failure_kind: typeof trace.run_failure_kind === 'string' ? trace.run_failure_kind : null,
        cases: [],
      },
    };
  }
  const runFailureKind = typeof trace.run_failure_kind === 'string' ? trace.run_failure_kind : null;
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(opts.projectRoot, opts.feature));
  const anchors = uiDoc ? buildSpecAnchorIndex(uiDoc) : null;
  const planPath = path.join(path.dirname(opts.tracePath), 'test-plan.hylyre.md');
  let planSteps: Map<string, DerivedPlanStep[]> | null = null;
  try {
    planSteps = parseDerivedPlanSteps(fs.readFileSync(planPath, 'utf-8'));
  } catch {
    planSteps = null;
  }

  const failureDir = path.resolve(path.dirname(opts.tracePath), 'failures');
  const prepared = prepareFailures(trace, failureDir, planSteps);
  // 当前 trace 严格引用的可读 dump 才进证据池；按绝对路径去重，禁扫 failure_dir 残留。
  const poolByPath = new Map<string, PoolFrame>();
  for (const item of prepared) {
    if (!item.dumpAbs || item.dumpRaw === undefined || item.stepIdx === undefined) continue;
    if (!poolByPath.has(item.dumpAbs)) {
      poolByPath.set(item.dumpAbs, {
        caseId: item.caseId,
        stepIdx: item.stepIdx,
        dumpAbs: item.dumpAbs,
        dumpRaw: item.dumpRaw,
        nodes: item.dumpNodes,
      });
    }
  }
  const evidencePool = [...poolByPath.values()];
  const cases: DeviceTestEvidenceCase[] = [];

  for (const item of prepared) {
    const push = (
      classification: DeviceDefectClassification,
      extra: Partial<DeviceTestEvidenceCase> = {},
    ): void => {
      cases.push({
        case_id: item.caseId,
        status: item.status,
        classification,
        error_excerpt: item.notesExcerpt,
        ...extra,
      });
    };
    if (runFailureKind && ENVIRONMENT_RUN_FAILURE_KINDS.has(runFailureKind)) {
      push('environment', {
        reason_code: 'run_environment_failure',
        reason: `run 级结构化失败：${runFailureKind}`,
      });
      continue;
    }
    if (item.joinReason || !item.dumpAbs || item.stepIdx === undefined || !item.step) {
      push('unjoinable', {
        reason_code: 'failure_artifacts_unjoinable',
        reason: item.joinReason ?? 'failure_artifacts 无法 join',
      });
      continue;
    }
    const step = item.step;
    if (!step.selectorKind || !step.selector) {
      push('unknown', {
        reason_code: 'failing_step_without_selector',
        reason: `失败 step（${step.action}）无选择器，无法归因`,
      });
      continue;
    }
    const failingStep = {
      index: item.stepIdx,
      action: step.action,
      selector_kind: step.selectorKind,
      selector: step.selector,
      payload: { ...step.payload },
      ...(step.scope ? { scope: step.scope } : {}),
    };
    const evidenceBase = {
      ui_dump: relativePortable(opts.projectRoot, item.dumpAbs),
      ...(item.clause?.screenshot
        ? { screenshot: relativePortable(opts.projectRoot, path.resolve(failureDir, item.clause.screenshot)) }
        : {}),
    };
    if (!anchors) {
      push('unknown', {
        reason_code: 'ui_spec_unavailable',
        reason: 'ui-spec.yaml 缺失或不可解析，selector 无从归 spec',
        failing_step: failingStep,
        evidence: evidenceBase,
      });
      continue;
    }

    const binding = resolveSelectorBinding(step, anchors);
    const exactHits: Array<{ frame: PoolFrame; node: DumpNode }> = [];
    for (const frame of evidencePool) {
      for (const node of frame.nodes) {
        const exact =
          step.selectorKind === 'by_id'
            ? node.id === step.selector
            : node.text === step.selector || node.originalText === step.selector;
        if (!exact) continue;
        // 同屏确认：命中帧必须同时含该屏的其他 identity 锚点，否则不能确定"在预期页面"。
        // plan e6b3f8d2 t3：`maison:` 锚点自带屏信息的豁免分支随 anchor 机制一并删除——
        // 现在**所有** selector 一视同仁走同一条同屏确认。
        if (binding.screens.length !== 1) continue;
        const screen = binding.screens[0];
        const identities = anchors.screenIdentityAnchors.get(screen) ?? [];
        if (!identities.some(identity => specNodePresentInFrame(
          { dumpNodes: frame.nodes },
          screen,
          identity,
        ))) continue;
        exactHits.push({ frame, node });
      }
    }

    const observations: DeviceEvidenceObservation[] = exactHits.map(hit => ({
      case_id: hit.frame.caseId,
      step_index: hit.frame.stepIdx,
      ui_dump: relativePortable(opts.projectRoot, hit.frame.dumpAbs),
      node: nodeSummary(hit.node),
    }));
    const expectedState = expectedStateOf(step.payload);
    const expectedStateKeys = Object.keys(expectedState);

    if (exactHits.length > 0) {
      const comparableHits = exactHits.filter(hit =>
        expectedStateKeys.every(key => typeof hit.node[key as ObservableStateKey] === 'boolean'),
      );
      if (
        expectedStateKeys.length > 0 &&
        comparableHits.length > 0 &&
        comparableHits.every(hit => !nodeSatisfies(hit.node, expectedState))
      ) {
        push('product_state', {
          reason_code: 'observable_state_mismatch',
          reason:
            `selector 在同 attempt 证据池中命中，但可观测状态不满足：` +
            `${JSON.stringify(expectedState)}`,
          failing_step: failingStep,
          expected_screen: binding.screens[0],
          evidence: { ...evidenceBase, observations, expected_state: expectedState },
        });
      } else {
        push('unknown', {
          reason_code:
            expectedStateKeys.length === 0 ? 'selector_present_without_state_predicate' : 'state_observations_conflict',
          reason:
            expectedStateKeys.length === 0
              ? '目标在场，但失败步骤无 dump 可观测状态谓词（scope/时序/级联待查）'
              : comparableHits.length === 0
                ? '目标在场，但 dump 未提供完整可观测状态；不能归 product_state'
                : '跨帧状态观测包含满足谓词的帧，不能稳定归 product_state',
          failing_step: failingStep,
          expected_screen: binding.screens[0],
          evidence: { ...evidenceBase, observations, expected_state: expectedState },
        });
      }
      continue;
    }

    if (binding.screens.length === 0) {
      push('test_contract', {
        reason_code: 'selector_without_spec_basis',
        reason: `selector 无 spec 依据（${step.selectorKind}=${step.selector} 不在 ui-spec）`,
        failing_step: failingStep,
        evidence: evidenceBase,
      });
      continue;
    }
    if (binding.screens.length > 1) {
      push('unknown', {
        reason_code: 'selector_screen_ambiguous',
        reason: `selector 归属多屏（${binding.screens.join('、')}），expected screen 不唯一`,
        failing_step: failingStep,
        evidence: evidenceBase,
      });
      continue;
    }
    const screenId = binding.screens[0];
    const identity = anchors.screenIdentityAnchors.get(screenId) ?? [];
    const otherIdentityHits = identity.filter(identityNode =>
      !(step.selectorKind === 'by_id' && identityNode === step.selector) &&
      specNodePresentInFrame(item, screenId, identityNode),
    );
    if (identity.length === 0 || otherIdentityHits.length === 0) {
      push('unknown', {
        reason_code: 'expected_screen_not_confirmed',
        reason:
          `dump 未命中 expected screen（${screenId}）的其他 identity 锚点——` +
          '无法确认真机在预期页面（可能导航错页/级联）',
        failing_step: failingStep,
        expected_screen: screenId,
        evidence: evidenceBase,
      });
      continue;
    }
    push('product_actionable', {
      reason_code: 'spec_element_missing',
      reason: `ui-spec 要求 ${screenId} 含 ${step.selector}，同 attempt 证据池零精确命中`,
      failing_step: failingStep,
      expected_screen: screenId,
      evidence: evidenceBase,
    });
  }

  const runtime = composeRuntimeFidelityEvidence({
    projectRoot: opts.projectRoot,
    feature: opts.feature,
    tracePath: opts.tracePath,
    hapSha256Full: opts.expectedHapSha256Full,
    goalRunId: opts.goalRunId,
    attemptId: opts.attemptId,
    deviceTarget: opts.deviceTarget,
  });
  if (!runtime.ok) {
    return { ok: false, reason: `P0 runtime fidelity evidence 无效：${runtime.reason}` };
  }

  return {
    ok: true,
    doc: {
      schema_version: '1.1',
      goal_run_id: opts.goalRunId,
      attempt_id: opts.attemptId,
      device_target: opts.deviceTarget,
      hap_sha256_full: opts.expectedHapSha256Full,
      install_executed: opts.installExecuted,
      install_ok: opts.installOk,
      trace_path: path.resolve(opts.tracePath),
      run_failure_kind: runFailureKind,
      cases,
      ...(runtime.applicable ? { runtime_fidelity: runtime.evidence } : {}),
    },
  };
}
