// framework-integrity.ts — consumer framework 防漂移完整性 preflight（全局自检）
// 以发布件包内 RELEASE-MANIFEST.json 为准，逐文件 sha256 比对 consumer framework/，
// 发现源码漂移默认 BLOCKER。**全局自检**：由 harness-runner 入口对所有模式（普通+goal）直调，
// 不经 capability-registry（避免被 profile SKIP / provider 缺失影响）。
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { CheckResult } from './types';
import { isHumanVerified } from './fidelity-shared';

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
  /** P1-5：无效放行配置的说明（legacy 形态/缺签名等），随 details 上桌 */
  invalid_notes: string[];
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * P1-5 审批有效性：rationale 非空 + approved_by 真人（isHumanVerified——非空、非自动化身份、
 * 非 user_requirement 授权哨兵）。返回 null=有效，否则返回无效原因。
 * 2026-07-05 实锤：agent 自改 framework 后自加 allowlist 三条（字符串形态）自批放行——放行通道
 * 必须责任到具体真人，agent 自加的条目没有真人签名，加了也无效。
 */
function approvalInvalidReason(rationale: unknown, approvedBy: unknown): string | null {
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
    ? `（allowlist 真人签放行 ${optOut.drift_allowlist.size} 项）` : '';
  const invalidNote = optOut.invalid_notes.length > 0
    ? `\n无效放行配置（不生效）：\n${optOut.invalid_notes.map(n => `- ${n}`).join('\n')}` : '';

  if (missing.length === 0 && drifted.length === 0) {
    return [result('BLOCKER', 'PASS',
      `framework/ ${files.length} 个发布文件与 ${MANIFEST_NAME} 哈希一致${allowedNote}。` +
      (optOut.invalid_notes.length > 0 ? `\n提示：${optOut.invalid_notes.length} 条放行配置无效（当前无漂移故不影响判定，建议清理或补真人审批）。` : ''))];
  }

  const issues = [...missing.map(f => `缺失: ${f}`), ...drifted.map(f => `改动: ${f}`)];
  const sample = issues.slice(0, 15).join('\n');
  const more = issues.length > 15 ? `\n… 另有 ${issues.length - 15} 项` : '';
  // P1-5：fixHint 不得教绕过（旧文案"置 allow_local_drift=true 或加入 drift_allowlist"等于给
  // agent 发作弊指南）——放行必须真人具名审批，agent 不得自批。
  const fixHint =
    '上游修复请回灌 agent-maison 并重新发布；确需本地 fork：由**真人**在 framework.config.json ' +
    'integrity.drift_allowlist 添加 {path, rationale, approved_by} 具名审批（approved_by 须真人——' +
    '自动化身份/user_requirement 无效；agent 不得自改 framework 后自批放行，发现框架问题应 halt 上报），' +
    '或还原文件后重跑。';

  if (optOut.allow_local_drift) {
    return [result('MINOR', 'WARN',
      `检测到 ${issues.length} 处 framework 源码漂移，但 integrity.allow_local_drift 已经真人具名审批放行（仅告警）：\n${sample}${more}${invalidNote}`,
      { failure_kind: 'framework_drift', blocking_class: 'integrity', suggestion: fixHint })];
  }
  return [result('BLOCKER', 'FAIL',
    `检测到 ${issues.length} 处 framework 发布源码漂移（与发布件不一致，疑似被本地改动）：\n${sample}${more}${invalidNote}`,
    { failure_kind: 'framework_drift', blocking_class: 'integrity', suggestion: fixHint })];
}
