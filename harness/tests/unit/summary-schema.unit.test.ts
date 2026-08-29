// ============================================================================
// summary-schema.unit.test.ts — summary.json 稳定契约回归
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const HARNESS_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(HARNESS_ROOT, 'schemas', 'summary.schema.json');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function loadSchema(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8')) as Record<string, unknown>;
}

function validSample(): Record<string, unknown> {
  return {
    schema_version: '1.0',
    phase: 'coding',
    feature: 'demo',
    verdict: 'FAIL',
    blocker_count: 1,
    fail_count: 2,
    warn_count: 1,
    script_report: 'doc/features/demo/coding/reports/script-report.json',
    merged_report: 'doc/features/demo/coding/reports/merged-report.md',
    ai_prompt: 'doc/features/demo/coding/reports/ai-prompt.md',
    summary_json: 'doc/features/demo/coding/reports/summary.json',
    run_statuses: [{
      id: 'coding_run_status',
      status: 'FAIL',
      can_claim_done: false,
      details: 'can_claim_done: NO',
    }],
    readiness_signals: [{
      id: 'bootstrap_incomplete',
      status: 'incomplete',
      source_check: 'modules_is_list',
      message: 'modules 数组为空',
    }],
    blocking_warnings: [{
      id: 'scope_declaration',
      blocking_class: 'prd_scope',
      details_excerpt: 'rationale 为空',
      suggestion: '补齐 rationale',
    }],
    blocking_skips: [{
      id: 'diff_within_scope',
      blocking_class: 'git_diff',
      details_excerpt: '无法执行 git diff',
    }],
    blockers: [{
      id: 'coding_hvigor_build',
      severity: 'BLOCKER',
      status: 'FAIL',
      classification: 'project_build',
      details_excerpt: '项目级 assembleApp 失败',
      affected_files: ['entry (module)'],
      suggestion: '读取完整日志',
    }, {
      // review#3：blocker 须允许 blocking_class（device_test_run 崩溃标 device_toolchain，保真传 goal-runner 失败分类）
      id: 'device_test_run',
      severity: 'BLOCKER',
      status: 'FAIL',
      blocking_class: 'device_toolchain',
      details_excerpt: '真机自动化执行失败（runner 崩溃）',
    }],
    next_action: 'fix_run_status_blockers_then_rerun',
    receipt_status: 'missing',
    closure_status: 'open',
    compile_first_error: {
      file: '02-Feature/TransportCard/src/main/ets/WiseCardService.ets',
      line: 4,
      message: "Cannot find module '@hms-paf/wisepaf-api'",
      kind: 'project_dependency_missing',
    },
  };
}

function assertSummaryShape(summary: Record<string, unknown>): void {
  const required = [
    'schema_version',
    'phase',
    'feature',
    'verdict',
    'blocker_count',
    'fail_count',
    'warn_count',
    'script_report',
    'merged_report',
    'ai_prompt',
    'summary_json',
    'run_statuses',
    'readiness_signals',
    'blocking_warnings',
    'blocking_skips',
    'blockers',
    'next_action',
  ];
  for (const key of required) {
    assert(Object.prototype.hasOwnProperty.call(summary, key), `summary 缺少必填字段：${key}`);
  }
  assert(summary.schema_version === '1.0', 'schema_version 必须为 1.0');
  assert(['PASS', 'FAIL', 'INCOMPLETE'].includes(String(summary.verdict)), 'verdict 必须是 PASS/FAIL/INCOMPLETE');
  assert(Array.isArray(summary.run_statuses), 'run_statuses 必须是数组');
  assert(Array.isArray(summary.readiness_signals), 'readiness_signals 必须是数组');
  assert(Array.isArray(summary.blocking_warnings), 'blocking_warnings 必须是数组');
  assert(Array.isArray(summary.blocking_skips), 'blocking_skips 必须是数组');
  assert(Array.isArray(summary.blockers), 'blockers 必须是数组');
  if (summary.compile_first_error != null) {
    const e = summary.compile_first_error as Record<string, unknown>;
    assert(typeof e.message === 'string' && e.message.length > 0, 'compile_first_error.message 必填');
  }
}

function testSchemaRequiredFields(): void {
  const schema = loadSchema();
  const required = schema.required as string[];
  // 条件字段不进 required：closure 三态字段随闭环出现；`ai_prompt` 自 1.3 起随
  // verifier 能力（resolveVerifierPlan）出现——disabled 的 phase 根本不装配 prompt，
  // 把它写进 required 等于要求每个阶段都产一份 verifier 产物（plan a9d4e7c2）。
  const CONDITIONAL = new Set([
    'receipt_status',
    'closure_status',
    'compile_first_error',
    'soft_advisories',
    'ai_prompt',
  ]);
  for (const key of Object.keys(validSample())) {
    if (CONDITIONAL.has(key)) continue;
    assert(required.includes(key), `schema.required 未声明 ${key}`);
  }
  assert(!required.includes('ai_prompt'), 'ai_prompt 必须是条件字段（verifier disabled 时不生成）');
  const props = schema.properties as Record<string, Record<string, unknown>>;
  assert(
    Object.prototype.hasOwnProperty.call(props, 'verifier_request'),
    'properties 须含 verifier_request（短 request 协议的投递体路径）',
  );
}

function testSchemaAllowsSoftAdvisories(): void {
  const schema = loadSchema();
  const props = schema.properties as Record<string, unknown>;
  assert(Object.prototype.hasOwnProperty.call(props, 'soft_advisories'), 'properties 须含 soft_advisories');
  const defs = schema.$defs as Record<string, unknown>;
  assert(Object.prototype.hasOwnProperty.call(defs, 'soft_advisory'), '$defs 须含 soft_advisory');
  const withAdvisory = {
    ...validSample(),
    soft_advisories: [{
      id: 'visual_multimodal_parity',
      status: 'WARN',
      details: '未取得读图证据',
      effective_image_input: 'tool_read',
      source: 'check-receipt',
    }],
  };
  assertSummaryShape(withAdvisory);
  const adv = (withAdvisory.soft_advisories as Array<Record<string, unknown>>)[0];
  assert(adv.status === 'WARN', 'soft_advisory.status');
}

function testValidSampleShape(): void {
  assertSummaryShape(validSample());
}

function testPhaseEnumIncludesCanonicalAndLegacy(): void {
  const schema = loadSchema();
  const props = schema.properties as Record<string, { enum?: string[] }>;
  const phaseEnum = props.phase?.enum ?? [];
  for (const id of ['spec', 'plan', 'prd', 'design', 'coding']) {
    assert(phaseEnum.includes(id), `phase.enum 须含 ${id}`);
  }
}

function testSpecPlanSamplesValidateShape(): void {
  for (const phase of ['spec', 'plan'] as const) {
    const sample = { ...validSample(), phase };
    assertSummaryShape(sample);
  }
}

function testInvalidSampleRejectedByUnitGuard(): void {
  const bad = validSample();
  delete bad.next_action;
  try {
    assertSummaryShape(bad);
  } catch {
    return;
  }
  throw new Error('缺少 next_action 的 summary 应被拒绝');
}

function testSchemaV12ClosureFields(): void {
  const schema = loadSchema();
  const props = schema.properties as Record<string, Record<string, unknown>>;
  assert((props.schema_version.enum as string[]).includes('1.2'), 'schema_version 须兼容读取 1.2');
  assert((props.schema_version.enum as string[]).includes('1.3'), 'schema_version 须支持当代 1.3');
  assert(Object.prototype.hasOwnProperty.call(props, 'assurance'), 'properties 须含 assurance');
  assert(Object.prototype.hasOwnProperty.call(props, 'capability_resolutions'), 'properties 须含 capability_resolutions');
  assert(Object.prototype.hasOwnProperty.call(props, 'capability_resolution_contract_fingerprint'), 'properties 须含 capability resolution fingerprint');
  assert(Object.prototype.hasOwnProperty.call(props, 'closure_commit'), 'properties 须含 closure_commit');
  const commit = props.closure_commit;
  const required = commit.required as string[];
  for (const key of ['schema_version', 'committed_at', 'receipt_path', 'evidence_manifest_path']) {
    assert(required.includes(key), `closure_commit.required 未声明 ${key}`);
  }
  const allOf = schema.allOf as Array<Record<string, unknown>>;
  assert(Array.isArray(allOf) && allOf.length > 0, '1.2 条件必填约束缺失');
  const serialized = JSON.stringify(allOf);
  assert(serialized.includes('assurance'), '1.2/1.3 必须条件要求 assurance');
  assert(serialized.includes('closure_status'), '1.2/1.3 必须条件要求 closure_status');
  assert(serialized.includes('"1.3"'), 'assurance 条件必须覆盖当代 1.3（否则 1.3 可裸写）');
  assert(!serialized.includes('closure_commit'), 'open summary 不应强制 closure_commit');
}

function runCase(name: string, fn: () => void): UnitCaseResult {
  try {
    fn();
    return { name, ok: true };
  } catch (err) {
    return { name, ok: false, error: (err as Error).message };
  }
}

export function runAll(): UnitCaseResult[] {
  return [
    runCase('summary schema: required 字段覆盖稳定消费字段', testSchemaRequiredFields),
    runCase('summary schema: 合法样例通过形状校验', testValidSampleShape),
    runCase('summary schema: phase enum 含 spec/plan 与 legacy', testPhaseEnumIncludesCanonicalAndLegacy),
    runCase('summary schema: spec/plan 样例通过形状校验', testSpecPlanSamplesValidateShape),
    runCase('summary schema: 缺少 next_action 会被拒绝', testInvalidSampleRejectedByUnitGuard),
    runCase('summary schema: soft_advisories 可选且形状合法', testSchemaAllowsSoftAdvisories),
    runCase('summary schema: 1.2 assurance 与 closure_commit 条件稳定', testSchemaV12ClosureFields),
  ];
}
