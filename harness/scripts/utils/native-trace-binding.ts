// native-trace-binding.ts — native trace 与同一最终派生计划的身份闭合
// ============================================================================
// 这是既有 run/evidence identity 的校验工具，不是新的 evidence sidecar、ledger 或
// case 状态。它只证明 trace、top plan、actual derived plan 与 StepResult 序列属于同一轮。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  extractDerivedPlanCases,
  parsePlannedStepsFromCell,
} from './derived-hylyre-plan';
import { normalizePlannedStep } from './planned-step-normalizer';
import type { DeviceTestArtifactBinding } from './device-test-evidence-shared';

export interface NativeTraceBindingTrace {
  feature?: string;
  schema_version?: string;
  artifacts?: Record<string, unknown>;
  cases?: Array<{
    id?: string;
    steps?: Array<{ index?: number; kind?: string }>;
  }>;
}

export interface NativeTraceBindingOptions {
  trace: NativeTraceBindingTrace | null;
  expectedFeature?: string;
  tracePath: string;
  testPlanPath: string;
  derivedPlanPath: string;
  expectedTestPlanPath?: string | null;
  expectedDerivedPlanPath?: string | null;
  expectedTracePath?: string | null;
  expectedTestPlanSha256?: string | null;
  expectedDerivedPlanSha256?: string | null;
  expectedTraceSha256?: string | null;
}

export interface NativeTraceBindingResult {
  ok: boolean;
  reasons: string[];
  binding?: DeviceTestArtifactBinding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sha256File(filePath: string): string | null {
  try {
    const crypto = require('crypto') as typeof import('crypto');
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function normalizeAbsolutePath(raw: string, baseDir: string): string {
  const portable = raw.trim().replace(/\\/g, '/');
  const osPath = portable.replace(/\//g, path.sep);
  return path.resolve(path.isAbsolute(osPath) ? osPath : path.join(baseDir, osPath));
}

function samePath(left: string, right: string, baseDir: string): boolean {
  return normalizeAbsolutePath(left, baseDir) === normalizeAbsolutePath(right, baseDir);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function recordBindingValue(
  record: Record<string, unknown> | null,
  key: keyof DeviceTestArtifactBinding,
): string | null {
  if (!record) return null;
  return stringValue(record[key]);
}

function validateStepSequence(
  trace: NativeTraceBindingTrace,
  derivedPlanPath: string,
  reasons: string[],
): void {
  let derivedText: string;
  try {
    derivedText = fs.readFileSync(derivedPlanPath, 'utf-8');
  } catch (error) {
    reasons.push(`derived plan 不可读：${(error as Error).message}`);
    return;
  }

  const plannedByCase = new Map<string, string[]>();
  for (const row of extractDerivedPlanCases(derivedText)) {
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    if (!parsed.ok) {
      reasons.push(`${row.tc_id} 派生步骤不可解析：${parsed.error}`);
      continue;
    }
    plannedByCase.set(
      row.tc_id.toUpperCase(),
      parsed.steps.map((step, index) => normalizePlannedStep(step, index).kind),
    );
  }

  const traceCases = trace.cases ?? [];
  const seen = new Set<string>();
  for (const traceCase of traceCases) {
    const caseId = stringValue(traceCase.id)?.toUpperCase();
    if (!caseId) continue;
    seen.add(caseId);
    const expectedKinds = plannedByCase.get(caseId);
    if (!expectedKinds) {
      reasons.push(`${caseId} trace CaseResult 不在实际派生计划中`);
      continue;
    }
    const actualSteps = Array.isArray(traceCase.steps) ? traceCase.steps : [];
    const expectedCheckIndexes = actualSteps
      .map((step, index) => ({ step, index }))
      .filter(item => item.step?.kind === 'expected_check')
      .map(item => item.index);
    if (expectedCheckIndexes.length > 1) {
      reasons.push(`${caseId} 含多个 expected_check StepResult`);
    }
    if (expectedCheckIndexes.some(index => index !== actualSteps.length - 1)) {
      reasons.push(`${caseId} expected_check 不是唯一尾部步骤`);
    }
    expectedCheckIndexes.forEach(index => {
      if (actualSteps[index]?.index !== index) {
        reasons.push(`${caseId} expected_check index=${String(actualSteps[index]?.index)}，期望=${index}`);
      }
    });
    const plannedResults = actualSteps.filter(step => step?.kind !== 'expected_check');
    if (plannedResults.length !== expectedKinds.length) {
      reasons.push(`${caseId} StepResult 数量=${plannedResults.length}，实际计划步骤=${expectedKinds.length}`);
      continue;
    }
    plannedResults.forEach((step, index) => {
      if (step?.index !== index) reasons.push(`${caseId} StepResult index=${String(step?.index)}，期望=${index}`);
      if (step?.kind !== expectedKinds[index]) {
        reasons.push(`${caseId} step ${index} kind=${String(step?.kind)}，期望=${expectedKinds[index]}`);
      }
    });
  }
  for (const caseId of plannedByCase.keys()) {
    if (!seen.has(caseId)) reasons.push(`${caseId} 实际派生计划存在但 trace 缺少 CaseResult`);
  }
}

/** Validate and, only when valid, return the same-run native artifact binding. */
export function validateNativeTraceArtifactBinding(
  options: NativeTraceBindingOptions,
): NativeTraceBindingResult {
  const reasons: string[] = [];
  const tracePath = path.resolve(options.tracePath);
  const testPlanPath = path.resolve(options.testPlanPath);
  const derivedPlanPath = path.resolve(options.derivedPlanPath);
  const baseDir = path.dirname(tracePath);
  const trace = options.trace;
  const artifactPlan = isRecord(trace?.artifacts) ? stringValue(trace.artifacts.plan) : null;

  if (!trace) reasons.push('native trace 不可解析');
  if (options.expectedFeature && trace?.feature !== options.expectedFeature) {
    reasons.push(`trace.feature=${String(trace?.feature)} 与当前 feature=${options.expectedFeature} 不一致`);
  }
  if (!artifactPlan) {
    reasons.push('trace.artifacts.plan 缺失，无法绑定实际派生计划');
  } else if (!samePath(artifactPlan, derivedPlanPath, baseDir)) {
    reasons.push(`trace.artifacts.plan=${artifactPlan} 未指向实际派生计划 ${derivedPlanPath}`);
  }
  if (!fs.existsSync(testPlanPath)) reasons.push(`top test-plan.md 不存在：${testPlanPath}`);
  if (!fs.existsSync(derivedPlanPath)) reasons.push(`derived test-plan.hylyre.md 不存在：${derivedPlanPath}`);
  if (!fs.existsSync(tracePath)) reasons.push(`trace.json 不存在：${tracePath}`);

  const testPlanSha256 = sha256File(testPlanPath);
  const derivedPlanSha256 = sha256File(derivedPlanPath);
  const traceSha256 = sha256File(tracePath);
  if (!testPlanSha256) reasons.push('top test-plan.md SHA-256 不可计算');
  if (!derivedPlanSha256) reasons.push('derived test-plan.hylyre.md SHA-256 不可计算');
  if (!traceSha256) reasons.push('trace.json SHA-256 不可计算');

  if (options.expectedTestPlanPath && !samePath(options.expectedTestPlanPath, testPlanPath, baseDir)) {
    reasons.push(`记录的 test_plan_path=${options.expectedTestPlanPath} 与当前=${testPlanPath} 不一致`);
  }
  if (options.expectedDerivedPlanPath && !samePath(options.expectedDerivedPlanPath, derivedPlanPath, baseDir)) {
    reasons.push(`记录的 derived_plan_path=${options.expectedDerivedPlanPath} 与当前=${derivedPlanPath} 不一致`);
  }
  if (options.expectedTracePath && !samePath(options.expectedTracePath, tracePath, baseDir)) {
    reasons.push(`记录的 trace_path=${options.expectedTracePath} 与当前=${tracePath} 不一致`);
  }
  // plan 07a41ec6 T6：顶层 test_plan_sha256 退为审计信息——真实执行以派生计划（注入后 run 副本）为准，
  // 改标题/措辞/版本号不得使 run 失效；派生计划与 trace 的 sha 仍严格绑定。
  void options.expectedTestPlanSha256;
  if (options.expectedDerivedPlanSha256 && derivedPlanSha256 !== options.expectedDerivedPlanSha256.trim().toLowerCase()) {
    reasons.push(`derived-plan SHA-256 与运行前记录不一致：${derivedPlanSha256 ?? '(missing)'} != ${options.expectedDerivedPlanSha256}`);
  }
  if (options.expectedTraceSha256 && traceSha256 !== options.expectedTraceSha256.trim().toLowerCase()) {
    reasons.push(`trace SHA-256 与运行记录不一致：${traceSha256 ?? '(missing)'} != ${options.expectedTraceSha256}`);
  }

  if (trace && derivedPlanSha256 && testPlanSha256 && traceSha256) {
    validateStepSequence(trace, derivedPlanPath, reasons);
  }
  if (reasons.length > 0 || !testPlanSha256 || !derivedPlanSha256 || !traceSha256) {
    return { ok: false, reasons: [...new Set(reasons)] };
  }
  return {
    ok: true,
    reasons: [],
    binding: {
      test_plan_path: testPlanPath,
      test_plan_sha256: testPlanSha256,
      derived_plan_path: derivedPlanPath,
      derived_plan_sha256: derivedPlanSha256,
      trace_path: tracePath,
      trace_sha256: traceSha256,
    },
  };
}

export function parseRecordedNativeBinding(value: unknown): Partial<DeviceTestArtifactBinding> | null {
  if (!isRecord(value)) return null;
  const result: Partial<DeviceTestArtifactBinding> = {};
  for (const key of [
    'test_plan_path',
    'test_plan_sha256',
    'derived_plan_path',
    'derived_plan_sha256',
    'trace_path',
    'trace_sha256',
  ] as const) {
    const string = recordBindingValue(value, key);
    if (string) result[key] = string;
  }
  return Object.keys(result).length > 0 ? result : null;
}
