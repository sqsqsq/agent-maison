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
