/**
 * framework-integrity — unit tests for consumer 防漂移 preflight（c2）。
 * 覆盖：source/dev no-op、PASS、漂移 BLOCKER、缺失 BLOCKER、allow_local_drift WARN、allowlist 放行、运行时额外文件不误报。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { runFrameworkIntegrityPreflight } from '../../scripts/utils/framework-integrity';
import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf-8')).digest('hex');
}

interface Setup {
  projectRoot: string;
  frameworkRoot: string;
}

function setup(
  files: Record<string, string>,
  opts?: {
    writeManifest?: boolean;
    tamper?: string[]; // 这些文件 manifest 记录错误 sha（模拟本地改动）
    missing?: Record<string, string>; // manifest 登记但不落盘（模拟缺失）
    config?: object; // 写 projectRoot/framework.config.json
  },
): Setup {
  const o = opts ?? {};
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-integ-'));
  const frameworkRoot = path.join(projectRoot, 'framework');
  fs.mkdirSync(frameworkRoot, { recursive: true });

  const manifestFiles: Array<{ path: string; sha256: string }> = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(frameworkRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    const tampered = (o.tamper ?? []).includes(rel);
    manifestFiles.push({ path: rel, sha256: tampered ? sha256(content + 'TAMPER') : sha256(content) });
  }
  for (const [rel, content] of Object.entries(o.missing ?? {})) {
    manifestFiles.push({ path: rel, sha256: sha256(content) }); // 故意不落盘
  }
  if (o.writeManifest !== false) {
    fs.writeFileSync(
      path.join(frameworkRoot, 'RELEASE-MANIFEST.json'),
      JSON.stringify({ schema_version: '1.0', version: '2.4.0', files: manifestFiles }, null, 2),
      'utf-8',
    );
  }
  if (o.config) {
    fs.writeFileSync(
      path.join(projectRoot, 'framework.config.json'),
      JSON.stringify(o.config, null, 2),
      'utf-8',
    );
  }
  return { projectRoot, frameworkRoot };
}

test('no in-zip manifest (source/dev layout) → SKIP no-op', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'x' }, { writeManifest: false });
  const [r] = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(r.id, 'framework_integrity');
  assert.strictEqual(r.status, 'SKIP');
});

test('all files match manifest → BLOCKER PASS', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello', 'sub/b.ts': 'world' });
  const [r] = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(r.status, 'PASS');
  assert.strictEqual(r.severity, 'BLOCKER');
});

test('tampered file → BLOCKER FAIL (framework_drift)', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' }, { tamper: ['a.ts'] });
  const [r] = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(r.status, 'FAIL');
  assert.strictEqual(r.severity, 'BLOCKER');
  assert.strictEqual(r.failure_kind, 'framework_drift');
  assert.ok(r.details.includes('a.ts'));
});

test('manifest file missing on disk → BLOCKER FAIL', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' }, { missing: { 'gone.ts': 'zzz' } });
  const [r] = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(r.status, 'FAIL');
  assert.ok(r.details.includes('gone.ts'));
});

test('allow_local_drift=true → WARN, non-blocking (MINOR)', () => {
  const { projectRoot, frameworkRoot } = setup(
    { 'a.ts': 'hello' },
    { tamper: ['a.ts'], config: { integrity: { allow_local_drift: true } } },
  );
  const [r] = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(r.status, 'WARN');
  assert.strictEqual(r.severity, 'MINOR'); // 不阻断 verdict（resolveVerdictFromChecks 只数 FAIL+BLOCKER）
});

test('drift_allowlist covers drifted file → BLOCKER PASS', () => {
  const { projectRoot, frameworkRoot } = setup(
    { 'a.ts': 'hello', 'b.ts': 'world' },
    { tamper: ['a.ts'], config: { integrity: { drift_allowlist: ['a.ts'] } } },
  );
  const [r] = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(r.status, 'PASS');
});

test('extra on-disk file not in manifest (runtime artifact) → no false positive', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.mkdirSync(path.join(frameworkRoot, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(path.join(frameworkRoot, 'harness', 'state', 'current.json'), '{}', 'utf-8');
  const [r] = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(r.status, 'PASS');
});

export function runAll(): UnitCaseResult[] {
  return CASES.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
    }
  });
}
