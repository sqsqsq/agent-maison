/**
 * framework package identity — runtime Git/hash gate 已退场（plan c3d8e1f6）。
 * 本套件只覆盖非阻断 identity 与通用 EOL helper，并反向锁死 Git/check writer 不得复活。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildFrameworkIdentityResult,
  formatFrameworkPackageIdentity,
  normalizeIntegrityTextEol,
  readFrameworkManifestSha256,
  readFrameworkPackageIdentity,
} from '../../scripts/utils/framework-integrity';
import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void | Promise<void> }> = [];
function test(name: string, run: () => void | Promise<void>): void {
  CASES.push({ name, run });
}

const MANIFEST_SHA = 'a'.repeat(64);

function setupIdentity(opts?: { manifest?: string | null; sidecar?: string | null }): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-identity-')));
  const manifest = opts?.manifest === undefined
    ? JSON.stringify({
        schema_version: '1.0',
        version: '3.0.0',
        source_commit: '1234567890abcdef1234567890abcdef12345678',
        built_at: '2026-09-01T00:00:00Z',
        files: [{ path: 'README.md', sha256: '0'.repeat(64) }],
      })
    : opts.manifest;
  if (manifest !== null) fs.writeFileSync(path.join(root, 'RELEASE-MANIFEST.json'), manifest, 'utf-8');
  const sidecar = opts?.sidecar === undefined ? `${MANIFEST_SHA}\n` : opts.sidecar;
  if (sidecar !== null) fs.writeFileSync(path.join(root, 'RELEASE-MANIFEST.sha256'), sidecar, 'utf-8');
  return root;
}

test('valid identity：version/source_commit/built_at + sidecar 声明值原样呈现', () => {
  const root = setupIdentity();
  try {
    const identity = readFrameworkPackageIdentity(root);
    assert.strictEqual(identity.state, 'valid');
    assert.strictEqual(identity.version, '3.0.0');
    assert.strictEqual(identity.source_commit, '1234567890abcdef1234567890abcdef12345678');
    assert.strictEqual(identity.built_at, '2026-09-01T00:00:00Z');
    assert.strictEqual(identity.manifest_sha256, MANIFEST_SHA, '不得哈希 sidecar 文本');
    assert.strictEqual(readFrameworkManifestSha256(root), MANIFEST_SHA);
    const result = buildFrameworkIdentityResult(identity);
    assert.strictEqual(result.status, 'PASS');
    assert.strictEqual(result.severity, 'MINOR');
    assert.ok((result.details ?? '').includes(`manifest_sha256=${MANIFEST_SHA}`));
    assert.ok(formatFrameworkPackageIdentity(identity).includes(`manifest_sha256=${MANIFEST_SHA}`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sidecar 缺失或非法：manifest identity 仍非阻断，sha 如实 unknown', () => {
  for (const sidecar of [null, 'not-a-sha\n']) {
    const root = setupIdentity({ sidecar });
    try {
      const identity = readFrameworkPackageIdentity(root);
      assert.strictEqual(identity.state, 'valid');
      assert.strictEqual(identity.manifest_sha256, 'unknown');
      assert.strictEqual(buildFrameworkIdentityResult(identity).status, 'PASS');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('manifest corrupt：WARN；absent：SKIP；两者都不是 BLOCKER', () => {
  const corruptRoot = setupIdentity({ manifest: '{ broken' });
  const absentRoot = setupIdentity({ manifest: null, sidecar: null });
  try {
    const corrupt = buildFrameworkIdentityResult(readFrameworkPackageIdentity(corruptRoot));
    assert.strictEqual(corrupt.status, 'WARN');
    assert.strictEqual(corrupt.severity, 'MINOR');
    const absent = buildFrameworkIdentityResult(readFrameworkPackageIdentity(absentRoot));
    assert.strictEqual(absent.status, 'SKIP');
    assert.strictEqual(absent.severity, 'MINOR');
  } finally {
    fs.rmSync(corruptRoot, { recursive: true, force: true });
    fs.rmSync(absentRoot, { recursive: true, force: true });
  }
});

test('生产模块零 Git/check writer：无 child_process/framework_integrity/control_plane_dirty', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/utils/framework-integrity.ts'), 'utf-8');
  for (const forbidden of [
    "from 'child_process'",
    'spawnSync',
    'runFrameworkIntegrityPreflight',
    'resolveFrameworkGitScope',
    'framework_control_plane_dirty',
    "id: 'framework_integrity'",
    "'git'",
  ]) {
    assert.ok(!source.includes(forbidden), `identity 模块不得含 ${forbidden}`);
  }
});

test('当前发布内容零操作性 submodule/HEAD/tracked-commit 生效叙事', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const roots = [
    'README.md', 'MIGRATION.md', 'skills', 'specs', 'harness', 'profiles',
    'agents', 'workflows', 'templates', 'docs',
  ];
  const patterns = [
    new RegExp(['git', 'submodule', '(?:add|update)'].join('\\s+'), 'i'),
    new RegExp(['submodule', 'vendor'].join('\\s*[/|]\\s*'), 'i'),
    new RegExp(['vendor', 'submodule'].join('\\s*[/|]\\s*'), 'i'),
    new RegExp(['framework', 'HEAD'].join('\\s+'), 'i'),
    new RegExp(['framework', '已跟踪文件'].join('.*'), 'i'),
    new RegExp(['framework', '纳入版本管理'].join('.*'), 'i'),
  ];
  const allowedExt = new Set(['.md', '.mdc', '.ts', '.mjs', '.json', '.yaml', '.yml']);
  const violations: string[] = [];
  const walk = (abs: string, rel: string): void => {
    if (!fs.existsSync(abs)) return;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      const posix = rel.replace(/\\/g, '/');
      if (
        posix.includes('/node_modules') || posix.includes('/reports') ||
        posix.startsWith('harness/tests') || /^profiles\/[^/]+\/harness\/tests/.test(posix) ||
        posix.startsWith('profiles/hmos-app/vendor') || posix.startsWith('docs/vendor')
      ) return;
      for (const name of fs.readdirSync(abs)) walk(path.join(abs, name), path.join(rel, name));
      return;
    }
    if (!allowedExt.has(path.extname(abs).toLowerCase())) return;
    const text = fs.readFileSync(abs, 'utf-8');
    for (const pattern of patterns) {
      if (pattern.test(text)) violations.push(`${rel}: ${pattern}`);
    }
  };
  for (const rel of roots) walk(path.join(repoRoot, rel), rel);
  assert.deepStrictEqual(violations, [], violations.join('\n'));
});

test('通用 EOL helper 保留：CRLF 与孤立 CR 统一为 LF', () => {
  assert.strictEqual(normalizeIntegrityTextEol('a\r\nb\rc\n'), 'a\nb\nc\n');
});

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (e) {
      out.push({ name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }
  return out;
}
