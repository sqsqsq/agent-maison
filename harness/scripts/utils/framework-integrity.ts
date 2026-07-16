// framework-integrity.ts — consumer framework 防漂移完整性 preflight（全局自检）
// 以发布件包内 RELEASE-MANIFEST.json 为准，逐文件 sha256 比对 consumer framework/，
// 发现源码漂移默认 BLOCKER。**全局自检**：由 harness-runner 入口对所有模式（普通+goal）直调，
// 不经 capability-registry（避免被 profile SKIP / provider 缺失影响）。
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import type { CheckResult } from './types';
import { isHumanVerified } from './fidelity-shared';
import {
  loadRuntimeArtifactPolicy,
  isPolicyAllowedPath,
  type RuntimeArtifactPolicy,
} from './canonical-gitignore';

const MANIFEST_NAME = 'RELEASE-MANIFEST.json';
const SIDECAR_NAME = 'RELEASE-MANIFEST.sha256';
const CHECK_ID = 'framework_integrity';
const CHECK_DESC =
  'framework 发布源码完整性（防漂移）：consumer framework/ 与发布件 per-file 哈希一致';
const FOREIGN_CHECK_ID = 'framework_foreign_file';
const FOREIGN_CHECK_DESC =
  'framework 外来文件扫描（G2，plan e8f5a2c7）：framework/ 树上存在但不在发布件 manifest 的文件';
const SELFCHECK_ID = 'framework_manifest_selfcheck';
const SELFCHECK_DESC =
  'manifest 自校验（G3b，plan e8f5a2c7）：RELEASE-MANIFEST.json 字节 vs 包内 sidecar RELEASE-MANIFEST.sha256';
const TMP_HYGIENE_ID = 'workspace_tmp_hygiene';
const TMP_HYGIENE_DESC =
  'workspace 临时脚本卫生（G4b，plan e8f5a2c7）：repo 根/scripts/ 下 tmp-* 命名的疑似临时诊断脚本';

interface IntegrityManifest {
  schema_version?: string;
  version?: string;
  files?: Array<{ path: string; sha256: string }>;
}

interface IntegrityOptOut {
  allow_local_drift: boolean;
  drift_allowlist: Set<string>;
  /** P1-5：无效放行配置的说明（legacy 形态/缺签名等），随 details 上桌 */
  invalid_notes: string[];
}

function sha256Bytes(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// --------------------------------------------------------------------------
// G3a（plan e8f5a2c7）：consumer 侧哈希口径与 pack 完全同源——分类与归一化语义复制自
// scripts/release-pack-rules.mjs（consumer 发布件不带 repo 根 scripts/，无法直接 import；
// 源仓一致性单测动态 import 对照，改任一侧须同步）。
// 治 2026-07-09 宿主事故根因 d：Windows 工具把 framework 文件重写成 CRLF（内容不变）→
// 裸字节 sha 假漂移 → agent 重算 manifest 迁就。发布件本就 LF（pack staging 归一 +
// release:verify LF-only 检查），manifest 值即 LF 哈希——consumer 归一后比对即免假漂移。
// 代价如实：纯行尾篡改不可见（行尾无语义，可接受）。
// --------------------------------------------------------------------------

/** 与 release-pack-rules.mjs RELEASE_BINARY_EXTENSIONS 同步（一致性单测钉死）。 */
export const INTEGRITY_BINARY_EXTENSIONS = new Set([
  '.whl', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip', '.gz',
]);

function isBinaryRelPath(rel: string): boolean {
  const ext = path.posix.extname(rel.replace(/\\/g, '/')).toLowerCase();
  return INTEGRITY_BINARY_EXTENSIONS.has(ext);
}

function isProbablyBinaryBuffer(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  return sample.includes(0);
}

/** 与 release-pack-rules.mjs normalizeReleaseTextEol 同步：CRLF 与孤立 CR 均归 LF。 */
export function normalizeIntegrityTextEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * pack 同源口径的文件 sha：①扩展名黑名单先行（无 NUL 的 PNG 也按二进制原始字节，防
 * 口径分裂）→ ②NUL 启发式 → ③文本 EOL 归一后按 utf-8 字节。
 */
export function sha256FileEolNormalized(filePath: string, rel: string): string {
  const buf = fs.readFileSync(filePath);
  if (isBinaryRelPath(rel) || isProbablyBinaryBuffer(buf)) return sha256Bytes(buf);
  return sha256Bytes(Buffer.from(normalizeIntegrityTextEol(buf.toString('utf-8')), 'utf-8'));
}

/**
 * P1-5 审批有效性：rationale 非空 + approved_by 真人（isHumanVerified——非空、非自动化身份、
 * 非 user_requirement 授权哨兵）。返回 null=有效，否则返回无效原因。
 * 2026-07-05 实锤：agent 自改 framework 后自加 allowlist 三条（字符串形态）自批放行——放行通道
 * 必须责任到具体真人，agent 自加的条目没有真人签名，加了也无效。
 */
export function approvalInvalidReason(rationale: unknown, approvedBy: unknown): string | null {
  if (typeof approvedBy !== 'string' || !approvedBy.trim()) return '缺 approved_by 真人签名';
  if (!isHumanVerified(approvedBy)) {
    return `approved_by="${approvedBy.trim()}" 属自动化身份/授权哨兵（user_requirement），不算真人签名`;
  }
  if (typeof rationale !== 'string' || !rationale.trim()) return '缺 rationale';
  return null;
}

/** 读 framework.config.json 的 integrity opt-out（直接读，解耦 FrameworkConfig 类型）。 */
function loadOptOut(projectRoot: string): IntegrityOptOut {
  const empty: IntegrityOptOut = { allow_local_drift: false, drift_allowlist: new Set(), invalid_notes: [] };
  try {
    const cfgPath = path.join(projectRoot, 'framework.config.json');
    if (!fs.existsSync(cfgPath)) return empty;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as {
      integrity?: {
        allow_local_drift?: boolean | { enabled?: boolean; rationale?: string; approved_by?: string };
        drift_allowlist?: Array<string | { path?: string; rationale?: string; approved_by?: string }>;
      };
    };
    const integ = cfg.integrity ?? {};
    const notes: string[] = [];

    // 总开关（codex 意见实锤于本文件旧 :121——布尔 true 即全量降 WARN，agent 可绕过 allowlist 直改它）
    let allowLocalDrift = false;
    const ald = integ.allow_local_drift;
    if (ald === true) {
      notes.push('allow_local_drift=true（legacy 布尔）已无效：P1-5 起须 {enabled: true, rationale, approved_by} 真人具名审批');
    } else if (ald && typeof ald === 'object') {
      if (ald.enabled === true) {
        const why = approvalInvalidReason(ald.rationale, ald.approved_by);
        if (why) notes.push(`allow_local_drift 审批无效（${why}），不生效`);
        else allowLocalDrift = true;
      }
    }

    // 放行白名单
    const allowSet = new Set<string>();
    for (const entry of integ.drift_allowlist ?? []) {
      if (typeof entry === 'string') {
        notes.push(`drift_allowlist "${entry}"（legacy 字符串条目）已无效：P1-5 起须 {path, rationale, approved_by} 真人具名审批`);
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const p = typeof entry.path === 'string' ? entry.path.trim() : '';
      if (!p) {
        notes.push('drift_allowlist 条目缺 path，忽略');
        continue;
      }
      const why = approvalInvalidReason(entry.rationale, entry.approved_by);
      if (why) {
        notes.push(`drift_allowlist "${p}" 审批无效（${why}），不生效`);
        continue;
      }
      allowSet.add(p.replace(/\\/g, '/'));
    }
    return { allow_local_drift: allowLocalDrift, drift_allowlist: allowSet, invalid_notes: notes };
  } catch {
    return empty;
  }
}

function result(
  severity: CheckResult['severity'],
  status: CheckResult['status'],
  details: string,
  extra?: Partial<CheckResult>,
): CheckResult {
  return { id: CHECK_ID, category: 'structure', description: CHECK_DESC, severity, status, details, ...extra };
}

function foreignResult(
  severity: CheckResult['severity'],
  status: CheckResult['status'],
  details: string,
  extra?: Partial<CheckResult>,
): CheckResult {
  return { id: FOREIGN_CHECK_ID, category: 'structure', description: FOREIGN_CHECK_DESC, severity, status, details, ...extra };
}

function selfcheckResult(
  severity: CheckResult['severity'],
  status: CheckResult['status'],
  details: string,
  extra?: Partial<CheckResult>,
): CheckResult {
  return { id: SELFCHECK_ID, category: 'structure', description: SELFCHECK_DESC, severity, status, details, ...extra };
}

type SelfcheckOutcome =
  | { kind: 'ok'; result: CheckResult }
  | { kind: 'tampered'; result: CheckResult }
  | { kind: 'missing'; result: CheckResult };

/**
 * G3b manifest 自校验（独立 check id；缺失语义经第七轮 codex P1-1 收紧）：
 *   - sidecar 存在且匹配 → PASS，继续后续校验；
 *   - 存在但不匹配 → BLOCKER FAIL 且调用方**停止后续**（manifest 已不可信，per-file 无意义）；
 *   - **缺失 → BLOCKER FAIL 且继续**（照跑 per-file/G2 供诊断）。原设计"缺失=旧包 WARN"
 *     不成立：本 selfcheck 代码只随 ≥3.0.0 发布件存在，consumer 布局下代码与包同树——
 *     能跑到这里就说明包本应带 sidecar，缺失只能是被删除/非发布件铺设（"删 sidecar +
 *     重算 manifest"正是要堵的绕过链）；真正的旧包（2.4.0）跑的是旧代码，根本没有本检查。
 * manifest 按**原始字节**比对（不做 EOL 归一——manifest 被 CRLF 重写同样属"被本地改动"）；
 * sidecar 格式与 release:verify 严格一致（64 位小写 hex + **必须**末尾 LF）。
 */
function runManifestSelfcheck(frameworkRoot: string, manifestRaw: Buffer): SelfcheckOutcome {
  const sidecarAbs = path.join(frameworkRoot, SIDECAR_NAME);
  // 第八轮 codex P1-2 纵深：sidecar 被 symlink 顶替 → readFileSync 会跟随链接读到攻击者
  // 可控内容——锚点自身必须是真实普通文件（G2 也会把该链接判 foreign，此处先行硬拦）。
  try {
    if (fs.existsSync(sidecarAbs) && fs.lstatSync(sidecarAbs).isSymbolicLink()) {
      return {
        kind: 'tampered',
        result: selfcheckResult('BLOCKER', 'FAIL',
          `${SIDECAR_NAME} 是 symlink/junction——完整性锚点必须是真实文件（链接可指向树外可改内容，锚点失效）。`,
          {
            failure_kind: 'framework_manifest_tampered',
            blocking_class: 'integrity',
            suggestion: '删除链接并经 framework-init UPDATE 重铺发布件恢复真实 sidecar。',
          }),
      };
    }
  } catch {
    /* lstat 失败走后续 existsSync 分支 */
  }
  if (!fs.existsSync(sidecarAbs)) {
    return {
      kind: 'missing',
      result: selfcheckResult('BLOCKER', 'FAIL',
        `包内无 ${SIDECAR_NAME}——本校验代码与发布件同树（≥3.0.0 包必带 sidecar），缺失意味着` +
        'sidecar 被删除或 framework/ 非经发布件完整铺设（"删 sidecar + 重算 manifest"是已知绕过链）。' +
        'per-file/外来文件校验照常执行供诊断。',
        {
          failure_kind: 'framework_manifest_sidecar_missing',
          blocking_class: 'integrity',
          suggestion: '经 framework-init UPDATE 重铺发布件恢复 sidecar；请勿手工补写（agent 手写完整性锚点无效且被写守卫拦截）。',
        }),
    };
  }
  const text = fs.readFileSync(sidecarAbs, 'utf-8');
  const m = text.match(/^([0-9a-f]{64})\n$/);
  const actual = sha256Bytes(manifestRaw);
  if (!m || m[1] !== actual) {
    return {
      kind: 'tampered',
      result: selfcheckResult('BLOCKER', 'FAIL',
        `${MANIFEST_NAME} 与包内 sidecar ${SIDECAR_NAME} 不符——manifest 被本地改动（如为迁就漂移手工重算），` +
        '后续 per-file 校验已停止（manifest 不可信，比对无意义）。',
        {
          failure_kind: 'framework_manifest_tampered',
          blocking_class: 'integrity',
          // 第八轮 codex P2：本分支停止后续校验，drift_allowlist/allow_local_drift 在此
          // 无从生效——只给真正可行的处置，不误导。
          suggestion:
            '请勿手工重算 manifest。可行处置仅两条：还原 framework/RELEASE-MANIFEST.json 到发布件原状后重跑；' +
            '或经 framework-init UPDATE 重铺发布件。（drift 的 allowlist 审批发生在 per-file 层，manifest 自身失锚时不适用。）',
        }),
    };
  }
  return {
    kind: 'ok',
    result: selfcheckResult('BLOCKER', 'PASS', `${MANIFEST_NAME} 字节与包内 sidecar 一致（未被本地重算）。`),
  };
}

/**
 * G2（plan e8f5a2c7）：walk framework/ 树，收集不在 manifest、不在 policy 白名单、
 * 不在人签 allowlist 的外来文件。**不跟随 symlink/junction**——链接条目自身按 foreign
 * 处理（防扫描逃出 framework/ 或目录环；Windows junction 经 lstat 同样报 symlink）。
 */
function scanForeignFiles(
  frameworkRoot: string,
  manifestPaths: ReadonlySet<string>,
  policy: RuntimeArtifactPolicy | null,
  driftAllowlist: ReadonlySet<string>,
): string[] {
  const foreign: string[] = [];
  const walk = (dirAbs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dirAbs, ent.name);
      const rel = path.relative(frameworkRoot, abs).replace(/\\/g, '/');
      // 链接（含 Windows junction）**最先判、无条件 foreign**（第八轮 codex P1-2：原实现
      // 先算 allowed 再判链接——白名单目录（reports 等）被 junction 到树外时静默放行，
      // sidecar/reserved 文件被 symlink 顶替时锚点失效。manifest/policy/allowlist 一律不
      // 豁免链接；代价如实：pnpm 式 node_modules junction 布局也会被拦（宁严勿松，须用
      // 真实目录或 allow_local_drift 全局降 WARN）。
      if (ent.isSymbolicLink()) {
        foreign.push(`${rel}（symlink/junction，不跟随）`);
        continue;
      }
      if (rel === MANIFEST_NAME) continue; // manifest 自身由 selfcheck（G3b）负责
      const allowed =
        (policy !== null && isPolicyAllowedPath(rel, policy)) || driftAllowlist.has(rel);
      if (ent.isDirectory()) {
        if (allowed) continue; // 白名单目录整棵跳过（node_modules 等，控扫描成本）
        walk(abs);
        continue;
      }
      if (allowed) continue;
      if (!manifestPaths.has(rel)) foreign.push(rel);
    }
  };
  walk(frameworkRoot);
  return foreign.sort();
}

// --------------------------------------------------------------------------
// G4b（plan e8f5a2c7）：workspace 临时脚本卫生扫描——本事故第二条腿
// scripts/tmp-add-ocr.js（宿主根 scripts/ 下的门禁糊弄脚本）在 G1/G2 射程外，
// 由本扫描兜。诚实定位：命名启发式（tmp-* 前缀）、不判脚本意图、MAJOR WARN 不
// BLOCKER（宿主根目录是宿主资产，硬拦越权）；目标是"git status 之外多一道显式提醒"。
// --------------------------------------------------------------------------

const TMP_SCRIPT_RE = /^tmp-.*\.(js|mjs|cjs|ts)$/i;

function listFilesShallow(dirAbs: string): string[] {
  try {
    return fs
      .readdirSync(dirAbs, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 命中项经 git check-ignore 过滤（gitignored 即宿主已自行处理，不再提醒）；git 不可用不过滤。 */
function filterGitIgnored(projectRoot: string, rels: string[]): string[] {
  if (rels.length === 0) return rels;
  try {
    const r = spawnSync('git', ['check-ignore', '--stdin'], {
      cwd: projectRoot,
      input: rels.join('\n'),
      encoding: 'utf-8',
      shell: false,
    });
    // exit 0=有命中 1=全不忽略 128=非 git 仓；stdout 为被忽略的路径列表
    if (r.status !== 0 && r.status !== 1) return rels;
    const ignored = new Set(
      (r.stdout ?? '').split(/\r?\n/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean),
    );
    return rels.filter((p) => !ignored.has(p));
  } catch {
    return rels;
  }
}

/**
 * 浅层扫描（控成本）：repo 根文件 + scripts/ 及其一级子目录文件；scratch/ 与 framework/
 * 不在扫描面（scratch 是约定去处；framework 内归 G2）。始终独立执行、与其余检查互不吞没。
 */
export function runWorkspaceTmpHygieneScan(projectRoot: string): CheckResult {
  const hits: string[] = [];
  for (const name of listFilesShallow(projectRoot)) {
    if (TMP_SCRIPT_RE.test(name)) hits.push(name);
  }
  const scriptsAbs = path.join(projectRoot, 'scripts');
  for (const name of listFilesShallow(scriptsAbs)) {
    if (TMP_SCRIPT_RE.test(name)) hits.push(`scripts/${name}`);
  }
  try {
    for (const ent of fs.existsSync(scriptsAbs)
      ? fs.readdirSync(scriptsAbs, { withFileTypes: true }).filter((e) => e.isDirectory())
      : []) {
      for (const name of listFilesShallow(path.join(scriptsAbs, ent.name))) {
        if (TMP_SCRIPT_RE.test(name)) hits.push(`scripts/${ent.name}/${name}`);
      }
    }
  } catch {
    /* 浅扫失败不阻断 */
  }
  const visible = filterGitIgnored(projectRoot, hits).sort();
  const base = {
    id: TMP_HYGIENE_ID,
    category: 'structure' as const,
    description: TMP_HYGIENE_DESC,
  };
  if (visible.length === 0) {
    return { ...base, severity: 'MAJOR', status: 'PASS', details: 'repo 根/scripts/ 未发现 tmp-* 命名的疑似临时诊断脚本。' };
  }
  return {
    ...base,
    severity: 'MAJOR',
    status: 'WARN',
    details:
      `发现 ${visible.length} 个 tmp-* 命名的疑似临时诊断脚本（命名启发式，非意图判定）：\n` +
      visible.map((f) => `  - ${f}`).join('\n'),
    suggestion:
      '临时诊断脚本请放 <repo-root>/scratch/（gitignored）或系统临时目录，用完即清；' +
      '勿在 repo 根/scripts/ 留 tmp 脚本（2026-07-09 宿主事故第二条腿即 scripts/tmp-add-ocr.js）。' +
      '若属正式脚本请改名并纳入版本管理。',
  };
}

/**
 * 防漂移 preflight。
 * - source/dev layout（无包内 manifest，如 agent-maison 自身）→ no-op SKIP，不误伤 framework 自身 npm test。
 * - consumer layout（有包内 manifest）→ 逐文件 sha256 比对；漂移默认 BLOCKER FAIL。
 * - P1-5（c9e2a7f4）放行通道全口径收紧：drift_allowlist 条目与 allow_local_drift 总开关均须
 *   结构化真人具名审批（rationale + approved_by 经 isHumanVerified）；legacy 字符串条目/布尔
 *   true 一律无效照报（说明进 details），agent 自批（自动化身份/user_requirement）无效。
 */
export function runFrameworkIntegrityPreflight(opts: {
  frameworkRoot: string;
  projectRoot: string;
}): CheckResult[] {
  const { frameworkRoot, projectRoot } = opts;
  const manifestPath = path.join(frameworkRoot, MANIFEST_NAME);
  // G4b：卫生扫描始终独立执行（三条返回路径都带上，与其余检查互不吞没）
  const hygiene = runWorkspaceTmpHygieneScan(projectRoot);

  // P2a：无包内 manifest → no-op（source/dev layout 或未经发布集成）
  if (!fs.existsSync(manifestPath)) {
    return [result('MINOR', 'SKIP',
      `未发现包内 ${MANIFEST_NAME}（source/dev layout 或未经发布集成）；跳过防漂移校验。`), hygiene];
  }

  let manifest: IntegrityManifest;
  let manifestRaw: Buffer;
  try {
    manifestRaw = fs.readFileSync(manifestPath);
    manifest = JSON.parse(manifestRaw.toString('utf-8')) as IntegrityManifest;
  } catch (e) {
    return [result('BLOCKER', 'FAIL',
      `包内 ${MANIFEST_NAME} 解析失败：${(e as Error).message}`,
      { failure_kind: 'framework_manifest_corrupt', blocking_class: 'integrity' }), hygiene];
  }

  // G3b：①manifest 解析（上）→ ②sidecar 自校验——不匹配即停（manifest 不可信，per-file/
  // foreign 比对无意义）；缺失 → BLOCKER FAIL 且继续 ③④（本检查代码随 ≥3.0.0 包同树，
  // 缺失只能是被删；后续检查照跑供诊断）。
  const selfcheck = runManifestSelfcheck(frameworkRoot, manifestRaw);
  if (selfcheck.kind === 'tampered') {
    return [selfcheck.result, hygiene];
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0) {
    return [result('BLOCKER', 'FAIL',
      `包内 ${MANIFEST_NAME} 无 files[] 条目，无法校验完整性。`,
      { failure_kind: 'framework_manifest_empty', blocking_class: 'integrity' }), hygiene];
  }

  const optOut = loadOptOut(projectRoot);
  const missing: string[] = [];
  const drifted: string[] = [];
  const manifestPaths = new Set<string>();
  for (const entry of files) {
    const rel = entry.path;
    manifestPaths.add(rel.replace(/\\/g, '/'));
    if (rel === MANIFEST_NAME) continue; // 自身排除
    if (optOut.drift_allowlist.has(rel)) continue;
    const abs = path.join(frameworkRoot, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); continue; }
    // G3a：pack 同源口径（扩展名黑名单先行 → NUL → EOL 归一）——CRLF 重写不再假漂移
    if (sha256FileEolNormalized(abs, rel) !== entry.sha256) drifted.push(rel);
  }

  // G2（plan e8f5a2c7）：外来文件扫描——白名单唯一来源 runtime-artifact-policy.json（三方
  // SSOT）；policy 读取失败按 null 处理（不放行任何运行时模式，宁严勿松，foreign 会多报
  // 但不会漏报——旧发布件无 policy 文件时运行时目录会误报，提示升级即可）。
  let policy: RuntimeArtifactPolicy | null = null;
  try {
    policy = loadRuntimeArtifactPolicy();
  } catch {
    policy = null;
  }
  const foreign = scanForeignFiles(frameworkRoot, manifestPaths, policy, optOut.drift_allowlist);

  const allowedNote = optOut.drift_allowlist.size > 0
    ? `（allowlist 真人签放行 ${optOut.drift_allowlist.size} 项）` : '';
  const invalidNote = optOut.invalid_notes.length > 0
    ? `\n无效放行配置（不生效）：\n${optOut.invalid_notes.map(n => `- ${n}`).join('\n')}` : '';

  // P1-5：fixHint 不得教绕过（旧文案"置 allow_local_drift=true 或加入 drift_allowlist"等于给
  // agent 发作弊指南）——放行必须真人具名审批，agent 不得自批。
  const fixHint =
    '上游修复请回灌 agent-maison 并重新发布；确需本地 fork：由**真人**在 framework.config.json ' +
    'integrity.drift_allowlist 添加 {path, rationale, approved_by} 具名审批（approved_by 须真人——' +
    '自动化身份/user_requirement 无效；agent 不得自改 framework 后自批放行，发现框架问题应 halt 上报），' +
    '或还原文件后重跑。' +
    // P1-6（plan d9b4f7e2，07-13 拉锯实证）：宿主在 goal run 进行中热修 framework →
    // goal 侧 halt 拉锯数小时——并发场景先停 run。
    '注意：goal run 进行中热修 framework 文件会让 run 内被本门禁 halt（漂移也可能是他人有意热修，' +
    '不确定来源时先问改动者，不要默认还原）——要热修请先停 run 或先补具名审批。';

  const out: CheckResult[] = [selfcheck.result];

  if (missing.length === 0 && drifted.length === 0) {
    out.push(result('BLOCKER', 'PASS',
      `framework/ ${files.length} 个发布文件与 ${MANIFEST_NAME} 哈希一致${allowedNote}。` +
      (optOut.invalid_notes.length > 0 ? `\n提示：${optOut.invalid_notes.length} 条放行配置无效（当前无漂移故不影响判定，建议清理或补真人审批）。` : '')));
  } else {
    const issues = [...missing.map(f => `缺失: ${f}`), ...drifted.map(f => `改动: ${f}`)];
    const sample = issues.slice(0, 15).join('\n');
    const more = issues.length > 15 ? `\n… 另有 ${issues.length - 15} 项` : '';
    if (optOut.allow_local_drift) {
      out.push(result('MINOR', 'WARN',
        `检测到 ${issues.length} 处 framework 源码漂移，但 integrity.allow_local_drift 已经真人具名审批放行（仅告警）：\n${sample}${more}${invalidNote}`,
        { failure_kind: 'framework_drift', blocking_class: 'integrity', suggestion: fixHint }));
    } else {
      out.push(result('BLOCKER', 'FAIL',
        `检测到 ${issues.length} 处 framework 发布源码漂移（与发布件不一致，疑似被本地改动）：\n${sample}${more}${invalidNote}`,
        { failure_kind: 'framework_drift', blocking_class: 'integrity', suggestion: fixHint }));
    }
  }

  // G2 foreign-file 结果（独立 check id，与 framework_integrity 并列——互不吞没）
  if (foreign.length === 0) {
    out.push(foreignResult('BLOCKER', 'PASS',
      'framework/ 树上未发现发布件之外的外来文件（运行时产物按 runtime-artifact-policy.json 放行）。'));
  } else {
    const sample = foreign.slice(0, 15).map(f => `  - ${f}`).join('\n');
    const more = foreign.length > 15 ? `\n  … 另有 ${foreign.length - 15} 项` : '';
    const foreignHint =
      'framework/ 是只读 vendored 发布件，不承载宿主/临时产物：临时诊断脚本请放 <repo-root>/scratch/' +
      '（gitignored）或系统临时目录；这些文件请移出或删除后重跑。确属有意本地新增：由真人在 ' +
      'framework.config.json integrity.drift_allowlist 具名审批（同漂移放行口径）。';
    if (optOut.allow_local_drift) {
      out.push(foreignResult('MINOR', 'WARN',
        `framework/ 树上发现 ${foreign.length} 个外来文件（allow_local_drift 已真人具名审批放行，仅告警）：\n${sample}${more}`,
        { failure_kind: 'framework_foreign_file', blocking_class: 'integrity', suggestion: foreignHint }));
    } else {
      out.push(foreignResult('BLOCKER', 'FAIL',
        `framework/ 树上发现 ${foreign.length} 个不属于发布件的外来文件（疑似临时脚本/宿主产物混入）：\n${sample}${more}`,
        { failure_kind: 'framework_foreign_file', blocking_class: 'integrity', suggestion: foreignHint }));
    }
  }

  out.push(hygiene); // G4b：始终独立在场
  return out;
}
