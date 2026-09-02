// ============================================================================
// runtime-step-evidence.ts — P0 device flow runtime fidelity evidence
// ============================================================================
// Historical compatibility reader for the pre-0.4 runtime telemetry shape.
// Native 0.4 CaseResult.steps[] is consumed directly by p0-semantic-gates;
// this module never writes or synthesizes a CaseResult/StepResult ledger.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { receiptDirPath, resolveFeatureArtifact } from '../../config';
import { buildSourceInventory } from './closure-attestation';
import {
  extractDerivedPlanCases,
  parsePlannedStepsFromCell,
} from './derived-hylyre-plan';
import type {
  DeviceTestEvidenceDoc,
  RuntimeCheckpointEvidence,
  RuntimeFidelityEvidence,
} from './device-test-evidence-shared';
import {
  loadPhaseEvidenceManifest,
  sha256File,
  stableStringify,
} from './phase-evidence-manifest';
import {
  isP0DeviceInteractive,
  loadAcceptanceFlowsDoc,
  parsePlanTcEntries,
} from './p0-semantic-gates';
import { loadUiSpecFile, uiSpecAbsPath, type UiSpecComponentNode } from './ui-spec-shared';

export const RUNTIME_STEP_TELEMETRY_SCHEMA = '1.0';
export const RUNTIME_FIDELITY_EVIDENCE_SCHEMA = '1.0';

export interface RuntimeTelemetryStep {
  case_id: string;
  step_index: number;
  action_kind: string;
  step_sha256: string;
  declared_target: { kind: string; value: string } | null;
  actual_hit: {
    stable_node_id: string | null;
    bounds: [number, number, number, number] | null;
  } | null;
  pre_screen: { signature_sha256: string; observed_element_ids: string[] } | null;
  post_screen: { signature_sha256: string; observed_element_ids: string[] } | null;
  outcome: 'passed' | 'failed';
  capture_error?: string | null;
}

export interface RuntimeStepTelemetry {
  schema_version: string;
  provider: {
    id: string;
    version: string;
    collector: string;
    collector_version: string;
  };
  goal_run_id: string;
  attempt_id: string;
  device_target: {
    serial: string | null;
    target_kind: string | null;
    session_id: string | null;
  };
  steps: RuntimeTelemetryStep[];
}

interface RuntimeTrace {
  schema_version?: string;
  feature?: string;
  cases?: Array<{ id?: string; status?: string }>;
  runtime_step_telemetry?: RuntimeStepTelemetry;
}

export interface ComposeRuntimeFidelityOptions {
  projectRoot: string;
  feature: string;
  tracePath: string;
  hapSha256Full: string;
  goalRunId: string;
  attemptId: string;
  deviceTarget: {
    serial: string | null;
    target_kind: string | null;
    session_id: string | null;
  };
}

export type ComposeRuntimeFidelityResult =
  | { ok: true; applicable: false }
  | { ok: true; applicable: true; evidence: RuntimeFidelityEvidence }
  | { ok: false; reason: string };

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function walkUiNodes(node: UiSpecComponentNode | undefined, fn: (node: UiSpecComponentNode) => void): void {
  if (!node) return;
  fn(node);
  for (const child of node.children ?? []) walkUiNodes(child, fn);
}

function buildUiElementScreens(projectRoot: string, feature: string): Map<string, Set<string>> | null {
  const doc = loadUiSpecFile(uiSpecAbsPath(projectRoot, feature));
  if (!doc) return null;
  const out = new Map<string, Set<string>>();
  const add = (id: string, screen: string): void => {
    const screens = out.get(id) ?? new Set<string>();
    screens.add(screen);
    out.set(id, screens);
  };
  for (const screen of doc.screens ?? []) {
    for (const id of screen.must_have_elements ?? []) add(id, screen.id);
    walkUiNodes(screen.root, node => {
      if (typeof node.id === 'string' && node.id) add(node.id, screen.id);
    });
  }
  return out;
}

function elementBelongsToScreen(
  index: Map<string, Set<string>>,
  elementId: string,
  screenId: string,
): boolean {
  return index.get(elementId)?.has(screenId) === true;
}

/**
 * Hash the exact normalized planned-step text executed by Hylyre. Hashing the
 * parsed object is not cross-language stable (`1.0` is retained by Python but
 * stringified as `1` by JavaScript), while the plan text is the shared input.
 */
export function runtimeStepHashFromText(stepText: string): string {
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.createHash('sha256').update(stepText.trim(), 'utf-8').digest('hex');
}

function normalizedIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) return null;
  return [...new Set(value as string[])].sort();
}

function validateTelemetryEnvelope(
  telemetry: RuntimeStepTelemetry | undefined,
  opts: ComposeRuntimeFidelityOptions,
): string | null {
  if (!telemetry) return 'trace 缺 runtime_step_telemetry';
  if (telemetry.schema_version !== RUNTIME_STEP_TELEMETRY_SCHEMA) {
    return `runtime telemetry schema 不受支持：${String(telemetry.schema_version)}`;
  }
  if (
    !telemetry.provider ||
    telemetry.provider.id !== 'hylyre' ||
    !telemetry.provider.version ||
    telemetry.provider.collector !== 'maison-hylyre-runtime-telemetry' ||
    !telemetry.provider.collector_version
  ) {
    return 'runtime telemetry provider/collector 身份不完整';
  }
  if (telemetry.goal_run_id !== opts.goalRunId || telemetry.attempt_id !== opts.attemptId) {
    return `runtime telemetry run/attempt 不匹配（${telemetry.goal_run_id}/${telemetry.attempt_id} vs ${opts.goalRunId}/${opts.attemptId}）`;
  }
  const actual = telemetry.device_target ?? { serial: null, target_kind: null, session_id: null };
  if (
    (actual.serial ?? null) !== (opts.deviceTarget.serial ?? null) ||
    (actual.target_kind ?? null) !== (opts.deviceTarget.target_kind ?? null) ||
    (actual.session_id ?? null) !== (opts.deviceTarget.session_id ?? null)
  ) {
    return 'runtime telemetry device target 三元组与本 attempt 不匹配';
  }
  if (!Array.isArray(telemetry.steps)) return 'runtime telemetry steps 缺失';
  return null;
}

export function composeRuntimeFidelityEvidence(
  opts: ComposeRuntimeFidelityOptions,
): ComposeRuntimeFidelityResult {
  const acceptance = loadAcceptanceFlowsDoc(opts.projectRoot, opts.feature);
  const p0Criteria = (acceptance?.criteria ?? []).filter(isP0DeviceInteractive);
  if (!acceptance || p0Criteria.length === 0) return { ok: true, applicable: false };

  const acceptanceFile = resolveFeatureArtifact(opts.projectRoot, opts.feature, 'acceptance.yaml');
  const topPlanFile = resolveFeatureArtifact(opts.projectRoot, opts.feature, 'test-plan.md');
  const derivedPlanPath = path.join(path.dirname(opts.tracePath), 'test-plan.hylyre.md');
  const acceptanceSha = acceptanceFile.exists ? sha256File(acceptanceFile.actualPath) : null;
  const testPlanSha = topPlanFile.exists ? sha256File(topPlanFile.actualPath) : null;
  const derivedPlanSha = sha256File(derivedPlanPath);
  const traceSha = sha256File(opts.tracePath);
  if (!acceptanceSha || !testPlanSha || !derivedPlanSha || !traceSha) {
    return { ok: false, reason: 'runtime fidelity 绑定输入缺失（acceptance/test-plan/derived-plan/trace）' };
  }
  if (!/^[0-9a-f]{64}$/.test(opts.hapSha256Full)) {
    return { ok: false, reason: 'runtime fidelity HAP 完整哈希非法' };
  }

  const trace = readJson<RuntimeTrace>(opts.tracePath);
  if (!trace || trace.feature !== opts.feature) {
    return { ok: false, reason: 'trace 不可解析或 feature 身份不匹配' };
  }
  // inventory §一 G7：legacy telemetry 桥只对**非 native** trace 适用。native 判据随协议
  // 提升到 v1——0.3-p0 自本版起并入 legacy，故这里认的是 v1 的 trace schema。
  if (trace.schema_version === '0.4-p0') {
    return { ok: true, applicable: false };
  }
  const envelopeIssue = validateTelemetryEnvelope(trace.runtime_step_telemetry, opts);
  if (envelopeIssue) return { ok: false, reason: envelopeIssue };
  const telemetry = trace.runtime_step_telemetry!;

  const derivedRaw = fs.readFileSync(derivedPlanPath, 'utf-8');
  const derivedRows = extractDerivedPlanCases(derivedRaw);
  const derivedCaseOrder = new Map(derivedRows.map((row, index) => [row.tc_id.toUpperCase(), index]));
  const derivedSteps = new Map<string, { steps: Record<string, unknown>[]; stepTexts: string[] }>();
  for (const row of derivedRows) {
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    if (!parsed.ok) return { ok: false, reason: `${row.tc_id} 派生步骤无法解析：${parsed.error}` };
    derivedSteps.set(row.tc_id.toUpperCase(), { steps: parsed.steps, stepTexts: parsed.stepTexts });
  }

  const seen = new Set<string>();
  let previousOrder = -1;
  for (const event of telemetry.steps) {
    const caseId = String(event?.case_id ?? '').toUpperCase();
    const caseOrder = derivedCaseOrder.get(caseId);
    if (caseOrder === undefined || !Number.isInteger(event?.step_index) || event.step_index < 0) {
      return { ok: false, reason: `runtime telemetry 含未知 case/step：${caseId}#${String(event?.step_index)}` };
    }
    const key = `${caseId}#${event.step_index}`;
    if (seen.has(key)) return { ok: false, reason: `runtime telemetry 重复 step：${key}` };
    seen.add(key);
    const order = caseOrder * 1_000_000 + event.step_index;
    if (order <= previousOrder) return { ok: false, reason: `runtime telemetry 步骤乱序：${key}` };
    previousOrder = order;
  }

  const statusByCase = new Map(
    (trace.cases ?? []).map(row => [String(row.id ?? '').toUpperCase(), String(row.status ?? '')]),
  );
  const telemetryByStep = new Map(
    telemetry.steps.map(step => [`${step.case_id.toUpperCase()}#${step.step_index}`, step]),
  );
  const planEntries = parsePlanTcEntries(fs.readFileSync(topPlanFile.actualPath, 'utf-8'));
  const uiElementScreens = buildUiElementScreens(opts.projectRoot, opts.feature);
  if (!uiElementScreens) {
    return { ok: false, reason: 'P0 runtime fidelity 需要可解析的 ui-spec.yaml 来验证屏幕/元素归属' };
  }

  const checkpoints: RuntimeCheckpointEvidence[] = [];
  for (const ac of p0Criteria) {
    const cp = ac.checkpoint;
    if (
      !ac.linked_flow || !cp?.pre_screen || !cp.post_screen ||
      !cp.action?.target_element_id || !Array.isArray(cp.required_element_ids)
    ) {
      return { ok: false, reason: `${ac.id} 缺完整 P0 checkpoint` };
    }
    if (!elementBelongsToScreen(uiElementScreens, cp.action.target_element_id, cp.pre_screen)) {
      return { ok: false, reason: `${ac.id} target ${cp.action.target_element_id} 不属于 pre_screen=${cp.pre_screen}` };
    }
    for (const id of cp.required_element_ids) {
      if (!elementBelongsToScreen(uiElementScreens, id, cp.post_screen)) {
        return { ok: false, reason: `${ac.id} required ${id} 不属于 post_screen=${cp.post_screen}` };
      }
    }

    const mappedCases = planEntries
      .filter(entry => entry.acRefs.includes(ac.id))
      .map(entry => entry.id.toUpperCase());
    let accepted: RuntimeCheckpointEvidence | null = null;
    const failures: string[] = [];
    for (const caseId of mappedCases) {
      if (statusByCase.get(caseId) !== '通过') {
        failures.push(`${caseId} trace 非通过`);
        continue;
      }
      const planned = derivedSteps.get(caseId);
      if (!planned) {
        failures.push(`${caseId} 无派生步骤`);
        continue;
      }
      const { steps, stepTexts } = planned;
      const runtimeForCase = telemetry.steps.filter(step => step.case_id.toUpperCase() === caseId);
      if (runtimeForCase.length !== steps.length) {
        failures.push(`${caseId} runtime step 数 ${runtimeForCase.length}≠计划 ${steps.length}`);
        continue;
      }
      let fullSequenceOk = true;
      for (let index = 0; index < steps.length; index += 1) {
        const event = telemetryByStep.get(`${caseId}#${index}`);
        const root = Object.keys(steps[index])[0] ?? '';
        if (
          !event || event.action_kind !== root || event.step_sha256 !== runtimeStepHashFromText(stepTexts[index]) ||
          event.outcome !== 'passed' || Boolean(event.capture_error) ||
          !event.pre_screen || !event.post_screen ||
          !isSha256(event.pre_screen.signature_sha256) || !isSha256(event.post_screen.signature_sha256) ||
          !normalizedIds(event.pre_screen.observed_element_ids) ||
          !normalizedIds(event.post_screen.observed_element_ids)
        ) {
          fullSequenceOk = false;
          break;
        }
      }
      if (!fullSequenceOk) {
        failures.push(`${caseId} runtime 步序/内容与派生计划不一致`);
        continue;
      }
      const targetIndex = steps.findIndex(step => {
        const root = Object.keys(step)[0];
        const body = root && step[root];
        return body && typeof body === 'object' && !Array.isArray(body) &&
          (body as Record<string, unknown>).by_id === cp.action!.target_element_id;
      });
      if (targetIndex < 0) {
        failures.push(`${caseId} 无指向 target 的 action step`);
        continue;
      }
      const event = telemetryByStep.get(`${caseId}#${targetIndex}`)!;
      const postEvent = [...runtimeForCase]
        .filter(step => step.step_index >= targetIndex && step.post_screen)
        .sort((a, b) => b.step_index - a.step_index)[0] ?? event;
      const preIds = normalizedIds(event.pre_screen?.observed_element_ids);
      const postIds = normalizedIds(postEvent.post_screen?.observed_element_ids);
      const bounds = event.actual_hit?.bounds;
      if (
        event.outcome !== 'passed' || event.capture_error ||
        event.declared_target?.kind !== 'by_id' ||
        event.declared_target.value !== cp.action.target_element_id ||
        event.actual_hit?.stable_node_id !== cp.action.target_element_id ||
        !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) ||
        !event.pre_screen || !postEvent.post_screen ||
        !isSha256(event.pre_screen.signature_sha256) || !isSha256(postEvent.post_screen.signature_sha256) ||
        !preIds || !postIds || !preIds.includes(cp.action.target_element_id)
      ) {
        failures.push(`${caseId} target step 缺真实命中/bounds/屏幕签名`);
        continue;
      }
      if (cp.pre_screen !== cp.post_screen && event.pre_screen.signature_sha256 === postEvent.post_screen.signature_sha256) {
        failures.push(`${caseId} 宣称跨屏但 pre/post 签名相同`);
        continue;
      }
      const required = cp.required_element_ids.map(elementId => ({
        element_id: elementId,
        present: postIds.includes(elementId),
      }));
      const forbidden = (cp.forbidden_element_ids ?? []).map(elementId => ({
        element_id: elementId,
        present: postIds.includes(elementId),
      }));
      if (required.some(row => !row.present) || forbidden.some(row => row.present)) {
        failures.push(`${caseId} required/forbidden 运行时观测不符`);
        continue;
      }
      accepted = {
        acceptance_id: ac.id,
        flow_id: ac.linked_flow,
        case_id: caseId,
        step_index: targetIndex,
        action_kind: event.action_kind,
        declared_target_element_id: cp.action.target_element_id,
        actual_hit: {
          stable_node_id: event.actual_hit.stable_node_id,
          bounds: bounds as [number, number, number, number],
        },
        pre_screen: {
          declared_screen_id: cp.pre_screen,
          signature_sha256: event.pre_screen.signature_sha256,
          observed_element_ids: preIds,
        },
        post_screen: {
          declared_screen_id: cp.post_screen,
          signature_sha256: postEvent.post_screen.signature_sha256,
          observed_element_ids: postIds,
        },
        required_observations: required,
        forbidden_observations: forbidden,
        outcome: 'passed',
      };
      break;
    }
    if (!accepted) {
      return {
        ok: false,
        reason: `${ac.id} 无可信 runtime checkpoint：${failures.slice(0, 4).join('；') || '无映射 TC'}`,
      };
    }
    checkpoints.push(accepted);
  }

  return {
    ok: true,
    applicable: true,
    evidence: {
      schema_version: RUNTIME_FIDELITY_EVIDENCE_SCHEMA,
      provider: { ...telemetry.provider },
      bindings: {
        feature: opts.feature,
        goal_run_id: opts.goalRunId,
        attempt_id: opts.attemptId,
        device_session_id: opts.deviceTarget.session_id,
        acceptance_sha256: acceptanceSha,
        test_plan_sha256: testPlanSha,
        derived_plan_sha256: derivedPlanSha,
        hap_sha256_full: opts.hapSha256Full,
        testing_source_aggregate: buildSourceInventory(opts.projectRoot, { expectProductSources: false }).aggregate_sha256,
        trace_sha256: traceSha,
      },
      checkpoints,
    },
  };
}

export function validateRuntimeFidelityEvidenceDocument(opts: {
  projectRoot: string;
  feature: string;
  doc: DeviceTestEvidenceDoc;
  expectedGoalRunId?: string | null;
  expectedAttemptId?: string | null;
  requirePhaseManifestBinding?: boolean;
}): string | null {
  const runtime = opts.doc.runtime_fidelity;
  if (!runtime) return 'device-test-evidence 缺 runtime_fidelity';
  if (opts.expectedGoalRunId && runtime.bindings.goal_run_id !== opts.expectedGoalRunId) {
    return `runtime evidence goal_run_id 不匹配（${runtime.bindings.goal_run_id} vs ${opts.expectedGoalRunId}）`;
  }
  if (opts.expectedAttemptId && runtime.bindings.attempt_id !== opts.expectedAttemptId) {
    return `runtime evidence attempt_id 不匹配（${runtime.bindings.attempt_id} vs ${opts.expectedAttemptId}）`;
  }
  const recomposed = composeRuntimeFidelityEvidence({
    projectRoot: opts.projectRoot,
    feature: opts.feature,
    tracePath: opts.doc.trace_path,
    hapSha256Full: opts.doc.hap_sha256_full,
    goalRunId: opts.doc.goal_run_id,
    attemptId: opts.doc.attempt_id,
    deviceTarget: opts.doc.device_target,
  });
  if (!recomposed.ok) return recomposed.reason;
  if (!recomposed.applicable) return 'runtime evidence 存在但当前 feature 无 P0 device flow';
  if (stableStringify(recomposed.evidence) !== stableStringify(runtime)) {
    return 'runtime evidence 与当前 trace/acceptance/plan/HAP/源码重算结果不一致';
  }

  if (opts.requirePhaseManifestBinding !== false) {
    const loaded = loadPhaseEvidenceManifest(opts.projectRoot, opts.feature, 'testing');
    if (!loaded) return 'testing phase-evidence-manifest 缺失';
    const evidencePath = path.join(
      receiptDirPath(opts.projectRoot, opts.feature, 'testing'),
      'reports',
      'device-test-evidence.json',
    );
    const expected = [evidencePath, opts.doc.trace_path].map(abs => ({
      rel: path.relative(opts.projectRoot, path.resolve(abs)).split(path.sep).join('/'),
      sha: sha256File(path.resolve(abs)),
    }));
    for (const item of expected) {
      const entry = loaded.manifest.outputs.find(row => row.path === item.rel);
      if (!item.sha || !entry || entry.sha256 !== item.sha || entry.exists !== true) {
        return `testing phase evidence 未绑定 runtime 产物：${item.rel}`;
      }
    }
  }
  return null;
}
