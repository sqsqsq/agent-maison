// framework-integrity.ts — consumer framework 防漂移完整性 preflight（全局自检）
// 以发布件包内 RELEASE-MANIFEST.json 为准，逐文件 sha256 比对 consumer framework/，
// 发现源码漂移默认 BLOCKER。**全局自检**：由 harness-runner 入口对所有模式（普通+goal）直调，
// 不经 capability-registry（避免被 profile SKIP / provider 缺失影响）。
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { CheckResult } from './types';

const MANIFEST_NAME = 'RELEASE-MANIFEST.json';
const CHECK_ID = 'framework_integrity';
const CHECK_DESC =
  'framework 发布源码完整性（防漂移）：consumer framework/ 与发布件 per-file 哈希一致';

interface IntegrityManifest {
  schema_version?: string;
  version?: string;
  files?: Array<{ path: string; sha256: string }>;
}

interface IntegrityOptOut {
  allow_local_drift: boolean;
  drift_allowlist: Set<string>;
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** 读 framework.config.json 的 integrity opt-out（直接读，解耦 FrameworkConfig 类型）。 */
function loadOptOut(projectRoot: string): IntegrityOptOut {
  const empty: IntegrityOptOut = { allow_local_drift: false, drift_allowlist: new Set() };
  try {
    const cfgPath = path.join(projectRoot, 'framework.config.json');
    if (!fs.existsSync(cfgPath)) return empty;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as {
      integrity?: { allow_local_drift?: boolean; drift_allowlist?: string[] };
    };
    const integ = cfg.integrity ?? {};
    return {
      allow_local_drift: integ.allow_local_drift === true,
      drift_allowlist: new Set((integ.drift_allowlist ?? []).map(p => p.replace(/\\/g, '/'))),
    };
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

/**
 * 防漂移 preflight。
 * - source/dev layout（无包内 manifest，如 agent-maison 自身）→ no-op SKIP，不误伤 framework 自身 npm test。
 * - consumer layout（有包内 manifest）→ 逐文件 sha256 比对；漂移默认 BLOCKER FAIL。
 * - framework.config.json integrity.allow_local_drift=true → 降为 WARN（仅告警，不阻断）；
 *   integrity.drift_allowlist 内的路径不计漂移（显式本地 fork）。
 */
export function runFrameworkIntegrityPreflight(opts: {
  frameworkRoot: string;
  projectRoot: string;
}): CheckResult[] {
  const { frameworkRoot, projectRoot } = opts;
  const manifestPath = path.join(frameworkRoot, MANIFEST_NAME);

  // P2a：无包内 manifest → no-op（source/dev layout 或未经发布集成）
  if (!fs.existsSync(manifestPath)) {
    return [result('MINOR', 'SKIP',
      `未发现包内 ${MANIFEST_NAME}（source/dev layout 或未经发布集成）；跳过防漂移校验。`)];
  }

  let manifest: IntegrityManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as IntegrityManifest;
  } catch (e) {
    return [result('BLOCKER', 'FAIL',
      `包内 ${MANIFEST_NAME} 解析失败：${(e as Error).message}`,
      { failure_kind: 'framework_manifest_corrupt', blocking_class: 'integrity' })];
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0) {
    return [result('BLOCKER', 'FAIL',
      `包内 ${MANIFEST_NAME} 无 files[] 条目，无法校验完整性。`,
      { failure_kind: 'framework_manifest_empty', blocking_class: 'integrity' })];
  }

  const optOut = loadOptOut(projectRoot);
  const missing: string[] = [];
  const drifted: string[] = [];
  for (const entry of files) {
    const rel = entry.path;
    if (rel === MANIFEST_NAME) continue; // 自身排除
    if (optOut.drift_allowlist.has(rel)) continue;
    const abs = path.join(frameworkRoot, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); continue; }
    if (sha256File(abs) !== entry.sha256) drifted.push(rel);
  }

  const allowedNote = optOut.drift_allowlist.size > 0
    ? `（allowlist 放行 ${optOut.drift_allowlist.size} 项）` : '';

  if (missing.length === 0 && drifted.length === 0) {
    return [result('BLOCKER', 'PASS',
      `framework/ ${files.length} 个发布文件与 ${MANIFEST_NAME} 哈希一致${allowedNote}。`)];
  }

  const issues = [...missing.map(f => `缺失: ${f}`), ...drifted.map(f => `改动: ${f}`)];
  const sample = issues.slice(0, 15).join('\n');
  const more = issues.length > 15 ? `\n… 另有 ${issues.length - 15} 项` : '';
  const fixHint =
    '上游修复请回灌 agent-maison 并重新发布；确需本地 fork 请在 framework.config.json 置 ' +
    'integrity.allow_local_drift=true，或把文件加入 integrity.drift_allowlist。';

  if (optOut.allow_local_drift) {
    return [result('MINOR', 'WARN',
      `检测到 ${issues.length} 处 framework 源码漂移，但 integrity.allow_local_drift=true 放行（仅告警）：\n${sample}${more}`,
      { failure_kind: 'framework_drift', blocking_class: 'integrity', suggestion: fixHint })];
  }
  return [result('BLOCKER', 'FAIL',
    `检测到 ${issues.length} 处 framework 发布源码漂移（与发布件不一致，疑似被本地改动）：\n${sample}${more}`,
    { failure_kind: 'framework_drift', blocking_class: 'integrity', suggestion: fixHint })];
}
