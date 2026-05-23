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
    }],
    next_action: 'fix_run_status_blockers_then_rerun',
    receipt_status: 'missing',
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
  assert(['PASS', 'FAIL'].includes(String(summary.verdict)), 'verdict 必须是 PASS/FAIL');
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
  for (const key of Object.keys(validSample())) {
    if (key === 'receipt_status' || key === 'compile_first_error') continue;
    assert(required.includes(key), `schema.required 未声明 ${key}`);
  }
}

function testValidSampleShape(): void {
  assertSummaryShape(validSample());
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
    runCase('summary schema: 缺少 next_action 会被拒绝', testInvalidSampleRejectedByUnitGuard),
  ];
}
