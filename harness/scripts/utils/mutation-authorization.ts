// ============================================================================
// mutation-authorization.ts — 源码漂移归因与 owner 重验（visual-capability-truth S4 / P0-D）
// ----------------------------------------------------------------------------
// Legacy authorization records remain parseable for diagnostics, but no receipt, approved_by,
// runner policy, or manifest entry may trust post-review source bytes. Any drift invalidates the
// old closure and returns to coding through the shared recovery transaction.
// 旧授权记录即使仍在宿主文件中也完全惰性；drift 一律保留字节、失效旧 closure，
// 由共享 backtrack 事务回 coding owner 完整重验。持续并发/预算/指纹熔断在 runner 层终止。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { stableStringify } from './phase-evidence-manifest';

// ---------------------------------------------------------------------------
// plan e7c2a4d8 T3b：drift fingerprint 规范化（人工裁决替代未实现的内容分类器）。
// entries=[{op: added|modified, path: canonical 项目相对, sha256: 内容哈希}]，
// 稳定排序 + domain separation；deleted 恒不可授权不入 fingerprint；op 变化即失配。
// ---------------------------------------------------------------------------

export interface DriftFingerprintEntry {
  op: 'added' | 'modified';
  path: string;
  sha256: string;
}

const DRIFT_FP_DOMAIN = 'MAISON_MUTATION_DRIFT_FP.v1';

/** 项目相对路径规范化校验（v4 轮 P1-E：拒绝绝对路径/../重复项，fail-closed）。
 * 返回问题列表（空=合法）。 */
export function relPathIssues(paths: string[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const p = norm(raw);
    if (!p) { issues.push('存在空路径项'); continue; }
    if (path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.startsWith('//')) {
      issues.push(`绝对路径不采信：${raw}`);
    }
    if (p.split('/').some((seg) => seg === '..' || seg === '.')) {
      issues.push(`含 ./.. 段的路径不采信：${raw}`);
    }
    if (seen.has(p)) issues.push(`重复路径项：${raw}`);
    seen.add(p);
  }
  return issues;
}

export function computeDriftFingerprint(entries: DriftFingerprintEntry[]): string {
  const canonical = entries
    .map((e) => ({ op: e.op, path: norm(e.path), sha256: e.sha256 }))
    .sort((a, b) => (a.path === b.path ? a.op.localeCompare(b.op) : a.path.localeCompare(b.path)));
  return crypto
    .createHash('sha256')
    .update(`${DRIFT_FP_DOMAIN}\n${stableStringify(canonical)}`, 'utf-8')
    .digest('hex');
}

/** 当前 drift 的 fingerprint（runner 在 reconcile 时从盘上内容计算；deleted 不入）。
 * 任一文件不可读 → null（fail-closed：无法证明内容即无法裁决）。 */
export function computeCurrentDriftFingerprint(
  projectRoot: string,
  drift: SourceDriftInput,
): { fingerprint: string; entries: DriftFingerprintEntry[] } | null {
  const entries: DriftFingerprintEntry[] = [];
  const push = (op: 'added' | 'modified', files: string[]): boolean => {
    for (const f of files) {
      const sha = sha256FileHex(path.join(projectRoot, ...norm(f).split('/')));
      if (!sha) return false;
      entries.push({ op, path: norm(f), sha256: sha });
    }
    return true;
  };
  if (!push('added', drift.added)) return null;
  if (!push('modified', drift.modified)) return null;
  return { fingerprint: computeDriftFingerprint(entries), entries };
}

export interface SourceDriftInput {
  added: string[];
  modified: string[];
  deleted: string[];
}

export type DriftClassification =
  | { kind: 'no_drift' }
  | { kind: 'unauthorized'; files: string[]; violations: string[] };

const norm = (p: string): string => p.replace(/\\/g, '/').trim();

export interface SourceDriftContext {
  runId: string;
  frozenManifestHash: string | null;
  phase?: string;
  expectedInventoryHash?: string | null;
  projectRoot?: string;
  feature?: string;
  manifestIdentityAuthenticated?: boolean;
  currentDriftFingerprint?: string | null;
}

/**
 * 改码分类（决策表核心，codex 实施 review 二/三轮重构）：
 *   - 配额**逐 receipt**：与本次变更零交集的 receipt 不入判定（防"借无关大配额放大
 *     另一份授权范围"）；每份 matched receipt 自身实际覆盖数 ≤ 自己的 max_files；
 *   - change kind 确定性切片：**删除**源文件不属于 test_seam/integration_glue 任一语义
 *     （两类 v1 kind 都是增改接缝/胶水）——deleted 文件恒不可授权（HALT 安全方向）；
 *   - **自动回退当前禁用（三轮 P1-6）**：added/modified 的内容级 kind 判定（diff 内容
 *     分类器）未实现前，receipt 覆盖/配额全部合规也只产出 unauthorized + "receipt 命中但
 *     须人工裁决"违规说明——`authorized_backtrack` 分支保留给分类器落地后启用。
 */
export function classifySourceDrift(
  drift: SourceDriftInput,
  legacyAuthorizations: readonly unknown[],
  _ctx: SourceDriftContext,
): DriftClassification {
  const files = [...drift.added, ...drift.modified, ...drift.deleted].map(norm);
  if (files.length === 0) return { kind: 'no_drift' };
  const violations: string[] = [
    'source_mutation_authorization 已退役：receipt、approved_by、runner policy 与 manifest preauthorization 均不能信任非 owner 阶段写入的源码字节',
  ];
  const deletedSet = new Set(drift.deleted.map(norm));
  const deletedTouched = files.filter(f => deletedSet.has(f));
  if (deletedTouched.length > 0) {
    violations.push(
      `删除源文件（${deletedTouched.length}）同样必须回 owner 重验：` +
      `${deletedTouched.slice(0, 5).join('、')}${deletedTouched.length > 5 ? '…' : ''}`,
    );
  }
  violations.push(`变更文件（${files.length}）：${files.slice(0, 8).join('、')}${files.length > 8 ? '…' : ''}`);
  if (legacyAuthorizations.length > 0) violations.push(`忽略 ${legacyAuthorizations.length} 条 legacy mutation authorization 记录`);
  return { kind: 'unauthorized', files, violations };
}

export function sha256FileHex(absPath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}
