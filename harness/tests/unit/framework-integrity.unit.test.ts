/**
 * framework-integrity — unit tests for consumer 防漂移 preflight（c2 + P1-5 放行收权）。
 * 覆盖：source/dev no-op、PASS、漂移 BLOCKER、缺失 BLOCKER、运行时额外文件不误报；
 * P1-5（plan c9e2a7f4，2026-07-05 实锤 agent 自批放行）：legacy 字符串条目/布尔 allow_local_drift=true/
 * 自动化署名/user_requirement/缺 rationale 全部无效照报；结构化真人签放行；无 allowlist 行为不变。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { runFrameworkIntegrityPreflight } from '../../scripts/utils/framework-integrity';
import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void | Promise<void> }> = [];
function test(name: string, run: () => void | Promise<void>): void {
  CASES.push({ name, run });
}

/** G3b 后返回多结果（selfcheck/integrity/foreign 并列）——按 id 取 integrity 主结果。 */
function integrityOf(results: ReturnType<typeof runFrameworkIntegrityPreflight>) {
  const r = results.find(x => x.id === 'framework_integrity');
  assert.ok(r, '应有 framework_integrity 结果');
  return r!;
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
    /** 缺省 true：写与 manifest 匹配的包内 sidecar（健康 consumer 态）；false=模拟被删 */
    sidecar?: boolean;
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
    const manifestAbs = path.join(frameworkRoot, 'RELEASE-MANIFEST.json');
    fs.writeFileSync(
      manifestAbs,
      JSON.stringify({ schema_version: '1.0', version: '2.4.0', files: manifestFiles }, null, 2),
      'utf-8',
    );
    if (o.sidecar !== false) {
      const raw = fs.readFileSync(manifestAbs);
      const sha = crypto.createHash('sha256').update(raw).digest('hex');
      fs.writeFileSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256'), `${sha}\n`, 'utf-8');
    }
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
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.id, 'framework_integrity');
  assert.strictEqual(r.status, 'SKIP');
});

test('all files match manifest → BLOCKER PASS', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello', 'sub/b.ts': 'world' });
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'PASS');
  assert.strictEqual(r.severity, 'BLOCKER');
});

test('tampered file → BLOCKER FAIL (framework_drift)', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' }, { tamper: ['a.ts'] });
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'FAIL');
  assert.strictEqual(r.severity, 'BLOCKER');
  assert.strictEqual(r.failure_kind, 'framework_drift');
  assert.ok(r.details.includes('a.ts'));
});

test('manifest file missing on disk → BLOCKER FAIL', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' }, { missing: { 'gone.ts': 'zzz' } });
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'FAIL');
  assert.ok(r.details.includes('gone.ts'));
});

test('p1_5_legacy_boolean_allow_local_drift_invalid_still_blocks', () => {
  // 2026-07-05 实锤路径：agent 可绕过 allowlist 直改布尔总开关——legacy true 无效照报 BLOCKER
  const { projectRoot, frameworkRoot } = setup(
    { 'a.ts': 'hello' },
    { tamper: ['a.ts'], config: { integrity: { allow_local_drift: true } } },
  );
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'FAIL');
  assert.strictEqual(r.severity, 'BLOCKER');
  assert.ok(/legacy 布尔.*无效|已无效/.test(r.details), r.details);
  // fixHint 不得教绕过（不出现"置 allow_local_drift=true"类文案）
  assert.ok(!/置\s*(integrity\.)?allow_local_drift\s*=\s*true/.test(r.suggestion ?? ''), r.suggestion);
  assert.ok(/真人|具名审批/.test(r.suggestion ?? ''), r.suggestion);
});

test('p1_5_structured_human_approved_allow_local_drift_warns', () => {
  const { projectRoot, frameworkRoot } = setup(
    { 'a.ts': 'hello' },
    { tamper: ['a.ts'], config: { integrity: { allow_local_drift: { enabled: true, rationale: '本地调试 fork', approved_by: 'shengqsq' } } } },
  );
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'WARN');
  assert.strictEqual(r.severity, 'MINOR'); // 不阻断 verdict（resolveVerdictFromChecks 只数 FAIL+BLOCKER）
});

test('p1_5_legacy_string_allowlist_entry_invalid_still_blocks', () => {
  // 2026-07-05 实锤形态：三条字符串条目自批放行——legacy 字符串一律无效
  const { projectRoot, frameworkRoot } = setup(
    { 'a.ts': 'hello', 'b.ts': 'world' },
    { tamper: ['a.ts'], config: { integrity: { drift_allowlist: ['a.ts'] } } },
  );
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'FAIL');
  assert.ok(r.details.includes('a.ts'));
  assert.ok(/legacy 字符串条目.*无效|已无效/.test(r.details), r.details);
});

test('p1_5_structured_human_approved_allowlist_entry_passes', () => {
  const { projectRoot, frameworkRoot } = setup(
    { 'a.ts': 'hello', 'b.ts': 'world' },
    { tamper: ['a.ts'], config: { integrity: { drift_allowlist: [{ path: 'a.ts', rationale: '本地 fork：修 nav 参数', approved_by: 'shengqsq' }] } } },
  );
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'PASS');
  assert.ok(/真人签放行 1 项/.test(r.details), r.details);
});

test('p1_5_automation_or_sentinel_or_missing_rationale_all_invalid', () => {
  const badEntries = [
    { path: 'a.ts', rationale: 'x', approved_by: 'goal-mode-auto' }, // 自动化自批
    { path: 'a.ts', rationale: 'x', approved_by: 'user_requirement' }, // 授权哨兵冒充（P0-6 同口径）
    { path: 'a.ts', approved_by: 'alice' }, // 缺 rationale
    { path: 'a.ts', rationale: 'x' }, // 缺签名
  ];
  for (const entry of badEntries) {
    const { projectRoot, frameworkRoot } = setup(
      { 'a.ts': 'hello' },
      { tamper: ['a.ts'], config: { integrity: { drift_allowlist: [entry] } } },
    );
    const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
    assert.strictEqual(r.status, 'FAIL', `无效条目必须照报：${JSON.stringify(entry)}`);
    assert.ok(/无效/.test(r.details), r.details);
  }
});

test('extra on-disk file not in manifest (runtime artifact) → no false positive', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.mkdirSync(path.join(frameworkRoot, 'harness', 'state'), { recursive: true });
  fs.writeFileSync(path.join(frameworkRoot, 'harness', 'state', 'current.json'), '{}', 'utf-8');
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(integrityOf(results).status, 'PASS');
  // G2：运行时产物在 policy 白名单内 → foreign 扫描亦 PASS
  const foreign = results.find(r => r.id === 'framework_foreign_file');
  assert.ok(foreign, '应有 framework_foreign_file 结果');
  assert.strictEqual(foreign!.status, 'PASS');
});

// ==========================================================================
// G2（plan e8f5a2c7）：extra-file 扫描
// ==========================================================================

function foreignOf(results: ReturnType<typeof runFrameworkIntegrityPreflight>) {
  const r = results.find(x => x.id === 'framework_foreign_file');
  assert.ok(r, '应有 framework_foreign_file 结果');
  return r!;
}

test('g2_non_whitelisted_extra_file → framework_foreign_file BLOCKER FAIL（本事故 tmp-ocr-audit 形态）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.mkdirSync(path.join(frameworkRoot, 'harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(frameworkRoot, 'harness', 'scripts', 'tmp-ocr-audit.mjs'), '// evil', 'utf-8');
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(integrityOf(results).status, 'PASS', 'per-file 完整性不受影响');
  const foreign = foreignOf(results);
  assert.strictEqual(foreign.status, 'FAIL');
  assert.strictEqual(foreign.severity, 'BLOCKER');
  assert.strictEqual(foreign.failure_kind, 'framework_foreign_file');
  assert.ok(foreign.details.includes('harness/scripts/tmp-ocr-audit.mjs'), foreign.details);
  assert.ok(/scratch\//.test(foreign.suggestion ?? ''), '教育文案应指向 scratch 约定');
});

// P1-10（plan 7c4f2e9b）：07-17 cc-spec 事故复现——i5 向 framework/harness/ 根写
// debug-coverage.ts（fixture foreign-file-delta.json 实录形态）。
// ① manifest 在位（发布包部署）→ framework_foreign_file BLOCKER 必拦；
// ② manifest 缺失（源码树形态部署）→ 整线 SKIP no-op（spec source-layout Scenario）——
//    这是事故最可能根因；goal-runner 现对该形态输出部署告警（只告警不改门）。
test('p1_10_incident_debug_coverage_ts → manifest 在位必拦 / 缺 manifest 诚实 SKIP', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.mkdirSync(path.join(frameworkRoot, 'harness'), { recursive: true });
  fs.writeFileSync(path.join(frameworkRoot, 'harness', 'debug-coverage.ts'), '// incident i5 write', 'utf-8');
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const foreign = foreignOf(results);
  assert.strictEqual(foreign.status, 'FAIL');
  assert.strictEqual(foreign.severity, 'BLOCKER');
  assert.ok(foreign.details.includes('harness/debug-coverage.ts'), foreign.details);
  // ② 缺 manifest → SKIP（记录事故根因形态；宿主须改发布包部署）
  fs.rmSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.json'), { force: true });
  const noManifest = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const skipped = noManifest.find(r => r.status === 'SKIP');
  assert.ok(skipped, '无 manifest 应 SKIP no-op（source layout 语义）');
  assert.ok(!noManifest.some(r => r.id === 'framework_foreign_file' && r.status === 'FAIL'), '无 manifest 时 foreign 防线不激活——事故根因形态');
});

test('g2_canary_pattern_allowed_but_other_assets_file_fails（收窄生效）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.mkdirSync(path.join(frameworkRoot, 'harness', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(frameworkRoot, 'harness', 'assets', 'vision-canary-abc.png'), 'png', 'utf-8');
  fs.writeFileSync(path.join(frameworkRoot, 'harness', 'assets', 'vision-canary-abc.answer-key.json'), '{}', 'utf-8');
  let results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(foreignOf(results).status, 'PASS', 'canary 两模式应放行');
  fs.writeFileSync(path.join(frameworkRoot, 'harness', 'assets', 'smuggled.mjs'), '// hide', 'utf-8');
  results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const foreign = foreignOf(results);
  assert.strictEqual(foreign.status, 'FAIL');
  assert.ok(foreign.details.includes('harness/assets/smuggled.mjs'), foreign.details);
});

test('g2_sidecar_reserved_metadata_not_foreign', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  // 写与 manifest 匹配的 sidecar（G3b 落地后假 sidecar 会先被 selfcheck 拦停——此处只验证
  // "sidecar 在场不被 G2 当 foreign"这一件事）
  const manifestRaw = fs.readFileSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.json'));
  const sha = crypto.createHash('sha256').update(manifestRaw).digest('hex');
  fs.writeFileSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256'), `${sha}\n`, 'utf-8');
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(foreignOf(results).status, 'PASS', 'sidecar 属保留元数据不算 foreign');
});

test('g2_symlink_junction_not_followed_and_itself_foreign', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  // 工程外目标：若扫描跟随链接就会"逃出 framework/"——链接自身应判 foreign 且不深入
  const outside = path.join(projectRoot, 'outside-dir');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x', 'utf-8');
  const linkAbs = path.join(frameworkRoot, 'linked');
  try {
    fs.symlinkSync(outside, linkAbs, 'junction'); // Windows junction（无需管理员）
  } catch {
    return; // 环境不支持链接（极少数受限 FS）——跳过不判失败
  }
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const foreign = foreignOf(results);
  assert.strictEqual(foreign.status, 'FAIL');
  assert.ok(/linked（symlink\/junction，不跟随）/.test(foreign.details), foreign.details);
  assert.ok(!foreign.details.includes('secret.txt'), '不得跟随链接扫到工程外内容');
});

test('g2_policy_whitelisted_dir_junction_still_foreign（第八轮 codex P1-2：reports 被 junction 到树外不得静默放行）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  const outside = path.join(projectRoot, 'evil-reports');
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(frameworkRoot, 'harness'), { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(frameworkRoot, 'harness', 'reports'), 'junction');
  } catch {
    return; // 环境不支持链接——跳过不判失败
  }
  const foreign = foreignOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(foreign.status, 'FAIL', '白名单目录被链接顶替必须上报（链接最先判，policy 不豁免）');
  assert.ok(/harness\/reports（symlink\/junction，不跟随）/.test(foreign.details), foreign.details);
});

test('g3b_sidecar_symlink_is_tampered（第八轮 codex P1-2：锚点被链接顶替 → selfcheck BLOCKER 停机）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' }, { sidecar: false });
  // 攻击者把 sidecar 指向树外可控文件（内容甚至可与 manifest 匹配）——锚点必须是真实文件
  const outside = path.join(projectRoot, 'evil-sidecar');
  const manifestRaw = fs.readFileSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.json'));
  fs.writeFileSync(outside, `${crypto.createHash('sha256').update(manifestRaw).digest('hex')}\n`, 'utf-8');
  try {
    fs.symlinkSync(outside, path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256'), 'file');
  } catch {
    return; // 无文件符号链接权限——跳过不判失败
  }
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const sc = selfcheckOf(results);
  assert.strictEqual(sc.status, 'FAIL', '即便链接内容匹配，锚点为链接即 tampered');
  assert.ok(/symlink\/junction/.test(sc.details), sc.details);
});

test('g2_manifest_path_replaced_by_symlink_still_foreign（第七轮 codex P2：同哈希树外链接不得借 manifest 身份放行）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  // 把 manifest 内的 a.ts 替换成指向树外同内容文件的链接——per-file sha 跟随链接会相等
  const outside = path.join(projectRoot, 'outside.ts');
  fs.writeFileSync(outside, 'hello', 'utf-8');
  fs.rmSync(path.join(frameworkRoot, 'a.ts'));
  try {
    fs.symlinkSync(outside, path.join(frameworkRoot, 'a.ts'), 'file');
  } catch {
    return; // 环境不支持文件符号链接（Windows 无开发者模式）——跳过不判失败
  }
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const foreign = foreignOf(results);
  assert.strictEqual(foreign.status, 'FAIL', '链接自身即 foreign，不受 manifest 身份豁免');
  assert.ok(/a\.ts（symlink\/junction，不跟随）/.test(foreign.details), foreign.details);
});

test('g2_drift_allowlist_exempts_foreign_file（真人具名审批同口径豁免）', () => {
  const { projectRoot, frameworkRoot } = setup(
    { 'a.ts': 'hello' },
    { config: { integrity: { drift_allowlist: [{ path: 'local-fork.ts', rationale: '本地新增工具', approved_by: 'shengqsq' }] } } },
  );
  fs.writeFileSync(path.join(frameworkRoot, 'local-fork.ts'), '// fork', 'utf-8');
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(foreignOf(results).status, 'PASS');
});

test('g2_allow_local_drift_downgrades_foreign_to_warn', () => {
  const { projectRoot, frameworkRoot } = setup(
    { 'a.ts': 'hello' },
    { config: { integrity: { allow_local_drift: { enabled: true, rationale: '本地调试', approved_by: 'shengqsq' } } } },
  );
  fs.writeFileSync(path.join(frameworkRoot, 'stray.mjs'), '// stray', 'utf-8');
  const foreign = foreignOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(foreign.status, 'WARN');
  assert.strictEqual(foreign.severity, 'MINOR');
});

test('g2_coexistence_drift_and_foreign_both_visible（互不吞没）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' }, { tamper: ['a.ts'] });
  fs.writeFileSync(path.join(frameworkRoot, 'stray.mjs'), '// stray', 'utf-8');
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const integ = results.find(r => r.id === 'framework_integrity');
  const foreign = results.find(r => r.id === 'framework_foreign_file');
  assert.strictEqual(integ?.status, 'FAIL', 'drift BLOCKER 应在');
  assert.strictEqual(foreign?.status, 'FAIL', 'foreign BLOCKER 应同时在');
});

// ==========================================================================
// G3（plan e8f5a2c7）：sha EOL 同源归一 + manifest sidecar 自校验
// ==========================================================================

function sha256Raw(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function writeSidecar(frameworkRoot: string): void {
  const manifestRaw = fs.readFileSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.json'));
  fs.writeFileSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256'), `${sha256Raw(manifestRaw)}\n`, 'utf-8');
}

function selfcheckOf(results: ReturnType<typeof runFrameworkIntegrityPreflight>) {
  const r = results.find(x => x.id === 'framework_manifest_selfcheck');
  assert.ok(r, '应有 framework_manifest_selfcheck 结果');
  return r!;
}

test('g3a_crlf_rewrite_no_false_drift（2026-07-09 宿主事故根因 d：adhoc-input-path.ts 形态）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'line1\nline2\n' });
  // 工具把文件重写成 CRLF（内容不变）——旧裸字节 sha 会假漂移，G3a 归一后不再误报
  fs.writeFileSync(path.join(frameworkRoot, 'a.ts'), 'line1\r\nline2\r\n', 'utf-8');
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'PASS', `CRLF 重写不应判漂移：${r.details}`);
});

test('g3a_lone_cr_also_normalized（与 pack /\\r\\n?/g 口径一致）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'line1\nline2\n' });
  fs.writeFileSync(path.join(frameworkRoot, 'a.ts'), 'line1\rline2\r', 'utf-8');
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'PASS', `孤立 CR 应归一：${r.details}`);
});

test('g3a_real_content_change_still_drifts（归一不放过真改动）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'line1\nline2\n' });
  fs.writeFileSync(path.join(frameworkRoot, 'a.ts'), 'line1\nCHANGED\n', 'utf-8');
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'FAIL');
});

test('g3a_no_nul_binary_extension_uses_raw_bytes（codex 第二轮 P1：无 NUL 的 PNG 含 0D0A 不得被改字节）', () => {
  // 构造无 NUL 但含 CRLF 字节序列的 .png：pack 按扩展名黑名单以原始字节记 sha；
  // consumer 若按"无 NUL 即文本"归一会改字节 → 口径分裂假漂移。
  const pngBytes = Buffer.from([0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x63]); // 无 0x00
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-integ-'));
  const frameworkRoot = path.join(projectRoot, 'framework');
  fs.mkdirSync(frameworkRoot, { recursive: true });
  fs.writeFileSync(path.join(frameworkRoot, 'img.png'), pngBytes);
  fs.writeFileSync(
    path.join(frameworkRoot, 'RELEASE-MANIFEST.json'),
    JSON.stringify({ schema_version: '1.0', version: '3.0.0', files: [{ path: 'img.png', sha256: sha256Raw(pngBytes) }] }),
    'utf-8',
  );
  const r = integrityOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(r.status, 'PASS', `二进制扩展应按原始字节：${r.details}`);
});

test('g3a_pack_parity_matrix（与 release-pack-rules.mjs 分类/归一逐一等价——源仓一致性单测）', async () => {
  // consumer 发布件不带 scripts/，运行时无法 import——本测试只在源仓跑，钉死语义复制不漂移
  const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<{
    isReleaseBinaryRelPath: (rel: string) => boolean;
    isProbablyBinaryBuffer: (buf: Buffer) => boolean;
    normalizeReleaseTextEol: (text: string) => string;
    RELEASE_BINARY_EXTENSIONS: Set<string>;
  }>;
  const { pathToFileURL } = await import('url');
  const { detectRepoLayout } = await import('../../repo-layout');
  const layout = detectRepoLayout(__dirname);
  const rulesAbs = path.join(layout.frameworkRoot, 'scripts', 'release-pack-rules.mjs');
  if (!fs.existsSync(rulesAbs)) return; // consumer 布局无 scripts/ → 本测试架构性只在源仓有效
  const rules = await dynamicImport(pathToFileURL(rulesAbs).href);
  const integrity = await import('../../scripts/utils/framework-integrity');
  // 扩展名黑名单集合逐项一致
  assert.deepStrictEqual(
    [...integrity.INTEGRITY_BINARY_EXTENSIONS].sort(),
    [...rules.RELEASE_BINARY_EXTENSIONS].sort(),
    'RELEASE_BINARY_EXTENSIONS 漂移',
  );
  // 归一化语义一致（CRLF / 孤立 CR / 混合）
  for (const s of ['a\r\nb', 'a\rb', 'a\r\r\nb\n', 'plain\n', '']) {
    assert.strictEqual(integrity.normalizeIntegrityTextEol(s), rules.normalizeReleaseTextEol(s), `归一化分裂：${JSON.stringify(s)}`);
  }
});

test('g3b_sidecar_match_pass_and_continue', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  writeSidecar(frameworkRoot);
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(selfcheckOf(results).status, 'PASS');
  assert.strictEqual(integrityOf(results).status, 'PASS', '后续 per-file 照常执行');
  assert.ok(results.find(r => r.id === 'framework_foreign_file'), 'G2 扫描照常执行');
});

test('g3b_sidecar_mismatch_blocker_and_stop（宿主事故实锤路径：重算 manifest 迁就漂移）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  writeSidecar(frameworkRoot);
  // 模拟 agent 重算 manifest（内容变了，sidecar 没跟）
  const manifestAbs = path.join(frameworkRoot, 'RELEASE-MANIFEST.json');
  const doc = JSON.parse(fs.readFileSync(manifestAbs, 'utf-8'));
  doc.files[0].sha256 = 'f'.repeat(64);
  fs.writeFileSync(manifestAbs, JSON.stringify(doc, null, 2), 'utf-8');
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const sc = selfcheckOf(results);
  assert.strictEqual(sc.status, 'FAIL');
  assert.strictEqual(sc.severity, 'BLOCKER');
  assert.strictEqual(sc.failure_kind, 'framework_manifest_tampered');
  assert.ok(/勿手工重算/.test(sc.suggestion ?? ''), sc.suggestion);
  // 停止后续：不再产出 per-file / foreign 结果；G4b hygiene 始终独立在场（不被吞没）
  assert.ok(!results.find(r => r.id === 'framework_integrity'), 'manifest 不可信应停止 per-file');
  assert.ok(!results.find(r => r.id === 'framework_foreign_file'), 'manifest 不可信应停止 foreign 扫描');
  assert.ok(results.find(r => r.id === 'workspace_tmp_hygiene'), 'G4b hygiene 应始终独立在场');
});

// ==========================================================================
// G4b（plan e8f5a2c7）：workspace tmp 卫生扫描（独立 check id workspace_tmp_hygiene）
// ==========================================================================

function hygieneOf(results: ReturnType<typeof runFrameworkIntegrityPreflight>) {
  const r = results.find(x => x.id === 'workspace_tmp_hygiene');
  assert.ok(r, '应有 workspace_tmp_hygiene 结果');
  return r!;
}

test('g4b_root_and_scripts_tmp_script_warns（本事故第二条腿 scripts/tmp-add-ocr.js 形态）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.mkdirSync(path.join(projectRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'scripts', 'tmp-add-ocr.js'), '// bulk defer', 'utf-8');
  fs.writeFileSync(path.join(projectRoot, 'tmp-probe.mjs'), '// probe', 'utf-8');
  const h = hygieneOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(h.status, 'WARN');
  assert.strictEqual(h.severity, 'MAJOR');
  assert.ok(h.details.includes('scripts/tmp-add-ocr.js'), h.details);
  assert.ok(h.details.includes('tmp-probe.mjs'), h.details);
  assert.ok(/scratch\//.test(h.suggestion ?? ''), '教育文案应指向 scratch 约定');
});

test('g4b_no_tmp_scripts_pass_and_non_tmp_names_not_flagged', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.mkdirSync(path.join(projectRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'scripts', 'build-all.mjs'), '// legit', 'utf-8');
  fs.writeFileSync(path.join(projectRoot, 'scripts', 'template.txt'), 'tmp-not-a-script', 'utf-8');
  const h = hygieneOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(h.status, 'PASS');
});

test('g4b_framework_internal_tmp_belongs_to_g2_not_double_reported', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.mkdirSync(path.join(frameworkRoot, 'harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(frameworkRoot, 'harness', 'scripts', 'tmp-ocr-audit.mjs'), '// x', 'utf-8');
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(hygieneOf(results).status, 'PASS', 'framework 内 tmp 归 G2，G4b 不重复报');
  assert.strictEqual(foreignOf(results).status, 'FAIL', 'G2 应报 foreign');
});

test('g4b_coexistence_foreign_and_tmp_both_visible（codex 次要②：互不吞没）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.writeFileSync(path.join(frameworkRoot, 'stray.mjs'), '// stray', 'utf-8');
  fs.mkdirSync(path.join(projectRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'scripts', 'tmp-add-ocr.js'), '// x', 'utf-8');
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  assert.strictEqual(foreignOf(results).status, 'FAIL', 'foreign BLOCKER 应在');
  assert.strictEqual(hygieneOf(results).status, 'WARN', 'tmp hygiene WARN 应同时在');
});

test('g3b_sidecar_missing_blocker_and_continues（第七轮 codex P1：删 sidecar+重算 manifest 的绕过链被堵——缺失即 BLOCKER，per-file/G2 照跑供诊断）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' }, { tamper: ['a.ts'], sidecar: false });
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const sc = selfcheckOf(results);
  assert.strictEqual(sc.status, 'FAIL', 'selfcheck 代码随 ≥3.0.0 包同树，缺 sidecar 只能是被删——BLOCKER');
  assert.strictEqual(sc.severity, 'BLOCKER');
  assert.strictEqual(sc.failure_kind, 'framework_manifest_sidecar_missing');
  assert.ok(/勿手工补写|framework-init UPDATE/.test(sc.suggestion ?? ''), sc.suggestion);
  const integ = integrityOf(results);
  assert.strictEqual(integ.status, 'FAIL', 'drift 校验照跑供诊断');
  assert.ok(results.find(r => r.id === 'framework_foreign_file'), 'G2 扫描照跑');
});

test('g3b_delete_sidecar_recompute_manifest_bypass_is_dead（codex 第七轮实测绕过链回归钉死）', () => {
  // 绕过链：改文件 → 重算 manifest 迁就 → 删 sidecar（让 selfcheck 无锚）——三步后必须仍有 BLOCKER
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' });
  fs.writeFileSync(path.join(frameworkRoot, 'a.ts'), 'EVIL\n', 'utf-8');
  const manifestAbs = path.join(frameworkRoot, 'RELEASE-MANIFEST.json');
  const doc = JSON.parse(fs.readFileSync(manifestAbs, 'utf-8'));
  doc.files[0].sha256 = crypto.createHash('sha256').update(Buffer.from('EVIL\n', 'utf-8')).digest('hex');
  fs.writeFileSync(manifestAbs, JSON.stringify(doc, null, 2), 'utf-8');
  fs.rmSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256'));
  const results = runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot });
  const blockers = results.filter(r => r.severity === 'BLOCKER' && r.status === 'FAIL');
  assert.ok(blockers.length >= 1, `绕过链后必须仍有 BLOCKER，实际 ${results.map(r => `${r.id}=${r.status}`).join(',')}`);
  assert.strictEqual(selfcheckOf(results).status, 'FAIL', 'sidecar 缺失即 BLOCKER，链条被斩断');
});

test('g3b_sidecar_strict_lf_format（与 release:verify 口径一致：缺末尾 LF 不算合法锚点）', () => {
  const { projectRoot, frameworkRoot } = setup({ 'a.ts': 'hello' }, { sidecar: false });
  const raw = fs.readFileSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.json'));
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  fs.writeFileSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256'), sha, 'utf-8'); // 无 LF
  const sc = selfcheckOf(runFrameworkIntegrityPreflight({ frameworkRoot, projectRoot }));
  assert.strictEqual(sc.status, 'FAIL', '缺 LF 的 sidecar 不合法（防手写伪造格式漂移）');
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
