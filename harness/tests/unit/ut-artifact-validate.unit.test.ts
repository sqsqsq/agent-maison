// ============================================================================
// ut-artifact-validate.unit.test.ts — UT 产物格式预校验
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveUtArtifactFilePath,
  validateMockPlanContent,
  validateTestabilityAuditContent,
} from '../../scripts/utils/ut-artifact-validate';
import {
  checkUtMachineArtifactParseable,
  inspectMockPlan,
  inspectTestabilityAudit,
} from '../../scripts/check-ut';
import type { CheckContext } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function withTmp(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-artifact-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testAuditRejectsMarkdownTable(): void {
  const text = `| AC | level |\n| AC-1 | L0 |`;
  const r = validateTestabilityAuditContent(text);
  assert(!r.ok, 'markdown table should fail');
  assert(r.errors.some(e => e.field === 'format'), 'expect format error');
}

function testAuditAcceptsFencedYaml(): void {
  const text = `\`\`\`yaml\nrecords:\n  - acceptance_id: AC-1\n    testability_level: L0\n    verdict: testable\n\`\`\``;
  const r = validateTestabilityAuditContent(text);
  assert(r.ok, `expected ok, got ${JSON.stringify(r.errors)}`);
}

function testMockPlanAcceptsYamlStandaloneComment(): void {
  const text = `# mock-plan 说明\nschema_version: "1.0"\nspies:\n  - target_class: Api\n    methods:\n      - name: fetch\n        returns:\n          ts_expr: "null as ApiResult"\n`;
  const r = validateMockPlanContent(text);
  assert(r.ok, `expected ok, got ${JSON.stringify(r.errors)}`);
}

function testMockPlanRejectsMarkdownFence(): void {
  const text = '```yaml\nschema_version: "1.0"\nspies: []\n```\n';
  const r = validateMockPlanContent(text);
  assert(!r.ok, 'markdown fence should fail');
}

function testMockPlanAcceptsPureYaml(): void {
  const text = `schema_version: "1.0"\nspies:\n  - target_class: Api\n    methods:\n      - name: fetch\n        returns:\n          ts_expr: "null as ApiResult"\n`;
  const r = validateMockPlanContent(text);
  assert(r.ok, `expected ok, got ${JSON.stringify(r.errors)}`);
}

function testAuditRejectsPartiallyMalformedFencedYaml(): void {
  const text = [
    '```yaml',
    'records:',
    '  - acceptance_id: AC-1',
    '```',
    '```yaml',
    'records: [',
    '```',
  ].join('\n');
  const r = validateTestabilityAuditContent(text);
  assert(!r.ok, 'one valid block must not hide another malformed block');
  assert(r.errors.some(e => e.field === 'yaml' && e.message.includes('fenced yaml #2')), JSON.stringify(r.errors));
}

function testMockPlanRejectsArrayRoot(): void {
  const r = validateMockPlanContent('- target_class: Api\n');
  assert(!r.ok, 'array root must fail');
  assert(r.errors.some(e => e.field === 'root'), JSON.stringify(r.errors));
}

function makeCtx(projectRoot: string): CheckContext {
  return {
    projectRoot,
    frameworkRoot: projectRoot,
    feature: 'demo',
    phaseRule: {
      structure_checks: {
        ut_testability_audit_parseable: { description: 'audit parseable' },
        ut_mock_plan_parseable: { description: 'mock parseable' },
      },
    } as unknown as CheckContext['phaseRule'],
    featureSpec: {},
    resolvedProfile: { name: 'hmos-app', profileDir: '', personalPrerequisites: {} },
  } as CheckContext;
}

function testInspectorsKeepCorruptArtifactPaths(): void {
  withTmp(dir => {
    const ctx = makeCtx(dir);
    const missingAudit = inspectTestabilityAudit(ctx);
    const missingMock = inspectMockPlan(ctx);
    fs.mkdirSync(path.dirname(missingAudit.absPath), { recursive: true });
    fs.writeFileSync(
      missingAudit.absPath,
      '```yaml\nrecords:\n  - acceptance_id: AC-1\n```\n```yaml\nrecords: [\n```\n',
      'utf-8',
    );
    fs.mkdirSync(path.dirname(missingMock.absPath), { recursive: true });
    fs.writeFileSync(missingMock.absPath, '- target_class: Api\n', 'utf-8');

    const audit = inspectTestabilityAudit(ctx);
    const mock = inspectMockPlan(ctx);
    assert(audit.status === 'invalid', audit.status);
    assert(mock.status === 'invalid', mock.status);
    const result = checkUtMachineArtifactParseable(
      ctx,
      'ut_testability_audit_parseable',
      'testability-audit.md',
      audit,
    )[0];
    assert(result.status === 'FAIL', result.status);
    assert(result.details.includes(missingAudit.absPath), result.details);
    assert(result.details.includes('fenced yaml #2'), result.details);
    assert(result.suggestion?.includes('不需要 git add') === true, result.suggestion ?? '');
  });
}

function testMockPlanSemanticIssueRemainsLoaded(): void {
  withTmp(dir => {
    const ctx = makeCtx(dir);
    const missing = inspectMockPlan(ctx);
    fs.mkdirSync(path.dirname(missing.absPath), { recursive: true });
    fs.writeFileSync(
      missing.absPath,
      [
        'schema_version: "1.0"',
        'spies:',
        '  - target_class: Api',
        '    methods:',
        '      - name: fetch',
        '        returns: []',
      ].join('\n'),
      'utf-8',
    );

    const observed = inspectMockPlan(ctx);
    assert(observed.status === 'loaded', `semantic issue must reach typed gate: ${observed.status}`);
    const parseable = checkUtMachineArtifactParseable(
      ctx,
      'ut_mock_plan_parseable',
      'mock-plan.yaml',
      observed,
    )[0];
    assert(parseable.status === 'PASS', JSON.stringify(parseable));
  });
}

function testResolvePathFromProjectRoot(): void {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const rel = 'doc/features/_nonexistent_probe_/ut/mock-plan.yaml';
  const resolved = resolveUtArtifactFilePath(rel, repoRoot);
  assert(resolved === path.resolve(repoRoot, rel), 'should resolve relative to project root');
}

function testResolvePathPrefersExistingCwd(): void {
  withTmp(dir => {
    const rel = 'mock-plan.yaml';
    fs.writeFileSync(path.join(dir, rel), 'schema_version: "1.0"\nspies: []\n', 'utf-8');
    const prev = process.cwd();
    try {
      process.chdir(dir);
      const resolved = resolveUtArtifactFilePath(rel);
      assert(resolved === path.join(dir, rel), 'cwd-relative file wins');
    } finally {
      process.chdir(prev);
    }
  });
}

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 'audit rejects markdown table', fn: testAuditRejectsMarkdownTable },
    { name: 'audit accepts fenced yaml', fn: testAuditAcceptsFencedYaml },
    { name: 'mock-plan accepts yaml standalone comment', fn: testMockPlanAcceptsYamlStandaloneComment },
    { name: 'mock-plan rejects markdown fence', fn: testMockPlanRejectsMarkdownFence },
    { name: 'mock-plan accepts pure yaml', fn: testMockPlanAcceptsPureYaml },
    { name: 'audit rejects partially malformed fenced yaml', fn: testAuditRejectsPartiallyMalformedFencedYaml },
    { name: 'mock-plan rejects array root', fn: testMockPlanRejectsArrayRoot },
    { name: 'inspectors keep corrupt artifact paths', fn: testInspectorsKeepCorruptArtifactPaths },
    { name: 'mock-plan semantic issue remains loaded for typed gate', fn: testMockPlanSemanticIssueRemainsLoaded },
    { name: 'resolve path from project root', fn: testResolvePathFromProjectRoot },
    { name: 'resolve path prefers cwd when file exists', fn: testResolvePathPrefersExistingCwd },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
