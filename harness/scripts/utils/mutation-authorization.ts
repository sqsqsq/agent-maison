// ============================================================================
// mutation-authorization.ts — 源码变更可信授权链（visual-capability-truth S4 / P0-D）
// ----------------------------------------------------------------------------
// 20260718 事故：`approved_by: headless-testability-setter-seam` 等 **agent 自签**
// 被当作授权。可信授权只认三源（codex plan 审查二轮 B3 + 四轮 P1）：
//   human            真人 confirmation receipt
//   runner_policy    runner 预定义、范围严格的安全 policy
//   pre_run_manifest goal 启动前 manifest 明确授权（run_started 冻结 manifest hash，
//                    运行中补写的可变 manifest 不构成授权）
// 拒收：agent 写入的 approved_by、user_requirement 泛化哨兵、agent 自产 gap-notes、
// 无文件范围宽授权。实际 diff 超出 allowed_files/max_files/change kind → 翻转
// unauthorized → HALT，不自动 backtrack。
// v1 分类边界（诚实声明）：无 git 快照输入面，「外部并发/归因不明」与「out-of-scope」
// 不单列——一律落 unauthorized（HALT 侧，安全方向）；细分类随 git 状态面接入再拆。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  defaultTrustRegistryPath,
  validateConfirmationReceiptFile,
} from './confirmation-receipt';
import { stableStringify } from './phase-evidence-manifest';

export type MutationAuthorityKind = 'human' | 'runner_policy' | 'pre_run_manifest';

export interface MutationAuthorizationReceipt {
  schema_version: '1.0';
  run_id: string;
  phase: string;
  /** project-relative 路径清单（正斜杠）；空数组=无范围授权，一律无效 */
  allowed_files: string[];
  allowed_change_kind: 'test_seam' | 'integration_glue';
  max_files: number;
  source_inventory_before?: string;
  approved_by: string;
  authority_kind: MutationAuthorityKind;
  authority_ref?: string;
  manifest_hash_at_run_start?: string;
  manifest_entry_id?: string;
  receipt_hash?: string;
  /** plan e7c2a4d8 T3b：人工裁决绑定的 drift fingerprint（computeDriftFingerprint
   * 口径——真人裁决的是**这份内容**；classifier 落地前它是唯一自动放行凭据，且已入
   * v2 签名范围，签发后改写即失配）。 */
  adjudicated_drift_fingerprint?: string;
}

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

/**
 * runner-owned 安全 policy 注册表（authority_kind=runner_policy 的唯一合法来源——
 * framework 代码即 runner 信任域；receipt.authority_ref 须命中注册 id）。
 * v1 空表=不采信任何 runner_policy（诚实：框架尚未定义任何预授权 policy；
 * 新增须走 openspec change，不得由宿主/agent 注入）。
 */
export const RUNNER_MUTATION_POLICIES: ReadonlySet<string> = new Set<string>([]);

export type DriftClassification =
  | { kind: 'no_drift' }
  | { kind: 'authorized_backtrack'; matched: MutationAuthorizationReceipt[]; files: string[] }
  | { kind: 'unauthorized'; files: string[]; violations: string[] };

const norm = (p: string): string => p.replace(/\\/g, '/').trim();

export interface ReceiptValidationCtx {
  runId: string;
  frozenManifestHash: string | null;
  /** drift 发生的 phase（receipt.phase 必须匹配——ut 授权不得用于 testing 改码） */
  phase?: string;
  /** review closure attestation 的 inventory aggregate_sha256（source_inventory_before 锚点） */
  expectedInventoryHash?: string | null;
  /** human 源 authority_ref 文件读取根（校验 receipt_hash 绑定 + 越界防护） */
  projectRoot?: string;
  /** human 源 confirmation receipt 的 feature 绑定（expectation 对账用） */
  feature?: string;
  /** 十三轮 review P1-3：manifest 身份链是否具备 writer authenticity（HMAC 部署 + checkpoint
   * 验真）。显式 false（无 key 部署/checkpoint 未验真）→ pre_run_manifest 源不构成机器可信
   * 授权（manifest 与冻结 hash 事件均在 agent 可写面，无 MAC 即整链可伪造）——弱信任处置，
   * 须 human receipt。undefined=调用方未断言（兼容非 runner 语境），不启用本降级。 */
  manifestIdentityAuthenticated?: boolean;
  /** plan e7c2a4d8 T3b：当前 drift 的内容 fingerprint（runner 在 reconcile 时从盘上
   * 计算；null=不可计算/未提供）。classifier 落地前唯一自动裁决判据。 */
  currentDriftFingerprint?: string | null;
}

/**
 * human 源授权范围规范化哈希（confirmation receipt payload.object_hash 绑定源）：
 * 真人签的是**这个范围**——agent 改写 JSONL 行放宽 allowed_files/max_files 即哈希失配。
 * plan e7c2a4d8 T3b（codex 二轮 P0-a + 三轮 P1-E + 四轮 P1-③）：**版本化 v2 单一
 * 定义**——七字段（+source_inventory_before 纵深防御 + adjudicated_drift_fingerprint
 * ?? null）+ domain separation。旧 v1 签名（五字段口径）必然失配 →
 * INVALID_SCOPE_VERSION 不进裁决，不留 v1 verifier（现网 registry 不存在，零兼容成本）。
 */
export function mutationAuthorizationScopeHash(r: MutationAuthorizationReceipt): string {
  return crypto
    .createHash('sha256')
    .update(
      stableStringify({
        scope_version: 'v2',
        run_id: r.run_id,
        phase: r.phase,
        source_inventory_before: r.source_inventory_before ?? null,
        allowed_files: [...(r.allowed_files ?? [])].map(norm).sort(),
        allowed_change_kind: r.allowed_change_kind,
        max_files: r.max_files,
        adjudicated_drift_fingerprint: r.adjudicated_drift_fingerprint ?? null,
      }),
      'utf-8',
    )
    .digest('hex');
}

/** receipt 结构与信任源有效性（不含 diff 比对）。无效原因返回列表（空=有效）。
 * codex 实施 review P0-4 硬化：三源各有可验证锚点，缺锚=无效——防「换个 schema 的
 * approved_by 自签」：human 须绑定实存 confirmation receipt 文件（authority_ref +
 * receipt_hash=文件 sha256 前 16）；runner_policy 须命中 framework 注册表；
 * pre_run_manifest 须冻结 hash 匹配；phase/source_inventory_before 全员必验。 */
export function receiptValidityIssues(
  r: MutationAuthorizationReceipt,
  ctx: ReceiptValidationCtx,
): string[] {
  const issues: string[] = [];
  if (r.schema_version !== '1.0') issues.push('schema_version 非 1.0');
  if (!['human', 'runner_policy', 'pre_run_manifest'].includes(r.authority_kind)) {
    issues.push(`authority_kind 非三源（${String(r.authority_kind)}）——agent 自签/泛化哨兵不构成授权`);
  }
  if (r.run_id !== ctx.runId) issues.push(`run_id 不匹配（${r.run_id} ≠ ${ctx.runId}）`);
  if (ctx.phase && r.phase !== ctx.phase) {
    issues.push(`phase 不匹配（授权 ${r.phase} ≠ drift 发生的 ${ctx.phase}）——跨阶段授权不采信`);
  }
  if (!Array.isArray(r.allowed_files) || r.allowed_files.length === 0) {
    issues.push('allowed_files 为空——无文件范围的宽授权不被采信');
  } else {
    // T3b（路径规范化 fail-closed）：绝对路径/../重复项不采信。
    issues.push(...relPathIssues(r.allowed_files).map((m) => `allowed_files ${m}`));
  }
  if (!Number.isInteger(r.max_files) || r.max_files <= 0) issues.push('max_files 须为正整数');
  if (!['test_seam', 'integration_glue'].includes(r.allowed_change_kind)) {
    issues.push(`allowed_change_kind 非法（${String(r.allowed_change_kind)}）`);
  }
  // source_inventory_before 锚定（pre_run_manifest 豁免：其时点=run 启动前，review 尚未跑，
  // 锚点是冻结 manifest hash 本身；run 中签发的 human/runner_policy 授权须锚定 review 基线）
  if (r.authority_kind !== 'pre_run_manifest' && ctx.expectedInventoryHash !== undefined) {
    if (!r.source_inventory_before) {
      issues.push('缺 source_inventory_before——授权未锚定变更前源码快照');
    } else if (ctx.expectedInventoryHash && r.source_inventory_before !== ctx.expectedInventoryHash) {
      issues.push('source_inventory_before 与 review closure inventory 不符——授权锚定的不是当前基线');
    }
  }
  if (r.authority_kind === 'human') {
    // codex 实施 review 二轮 P0-3："文件实存 + hash 相等"仍是 agent 可闭环的自签流程
    //（agent 自建普通文件、自算 hash 即通过）。human 源必须过 confirmation-receipt 信任链：
    // workspace 外 trust registry + 签名覆盖规范化 payload + action/feature/run/object_hash
    // 全绑定（object_hash=授权范围哈希——真人签名换皮到更宽授权行即失配）。
    if (!r.authority_ref || !r.receipt_hash) {
      issues.push('human 源须绑定 authority_ref（confirmation receipt 路径）+ receipt_hash——裸 approved_by 不构成真人授权');
    } else if (!ctx.projectRoot || !ctx.feature) {
      issues.push('human 源校验缺 projectRoot/feature 语境——无法执行信任链校验（fail-closed 不采信）');
    } else {
      const rootAbs = path.resolve(ctx.projectRoot);
      const refAbs = path.resolve(rootAbs, r.authority_ref);
      const rel = path.relative(rootAbs, refAbs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        issues.push(`authority_ref 越出 projectRoot（${r.authority_ref}）——路径穿越引用不采信`);
      } else if (!fs.existsSync(refAbs)) {
        issues.push(`authority_ref 指向的 receipt 文件不存在（${r.authority_ref}）`);
      } else {
        const h = sha256FileHex(refAbs)?.slice(0, 16) ?? '';
        if (h !== r.receipt_hash) {
          issues.push('receipt_hash 与 authority_ref 文件不符（引用被篡改/伪造）');
        } else {
          const v = validateConfirmationReceiptFile(refAbs, defaultTrustRegistryPath(rootAbs), {
            action: 'source_mutation_authorization',
            feature: ctx.feature,
            object_hash: mutationAuthorizationScopeHash(r),
            run_id: ctx.runId,
          });
          if (!v.valid) {
            issues.push(
              `human confirmation receipt 信任链校验失败（${v.reasons.slice(0, 3).join('；')}）——` +
              '须由预置 trust registry 签发方签名并绑定本授权范围' +
              '（注：v1 五字段 scope 的旧签名已废止=INVALID_SCOPE_VERSION，须按 v2 口径重签）',
            );
          }
        }
      }
    }
  }
  if (r.authority_kind === 'runner_policy') {
    if (!r.authority_ref || !RUNNER_MUTATION_POLICIES.has(r.authority_ref)) {
      issues.push(
        `runner_policy 源 authority_ref（${r.authority_ref ?? '缺失'}）不在 framework 注册表——` +
        '宿主/agent 注入的 policy 不构成 runner 授权',
      );
    }
  }
  if (r.authority_kind === 'pre_run_manifest') {
    // 十三轮 P1-3：无 writer authenticity（无 HMAC 部署/checkpoint 未验真）时 manifest 与
    // 冻结 hash 事件均在 agent 可写面——整链可伪造，不构成机器可信授权（须 human receipt）。
    if (ctx.manifestIdentityAuthenticated === false) {
      issues.push(
        'manifest 身份链无 writer authenticity（未配 HMAC/checkpoint 未验真）——pre_run_manifest ' +
        '不构成机器可信授权（弱信任处置：改用 human confirmation receipt）',
      );
    }
    if (!r.manifest_hash_at_run_start) {
      issues.push('pre_run_manifest 源缺 manifest_hash_at_run_start');
    } else if (!ctx.frozenManifestHash) {
      issues.push('run_started 未冻结 manifest hash——无法证明授权先于运行');
    } else if (r.manifest_hash_at_run_start !== ctx.frozenManifestHash) {
      issues.push('manifest hash 与 run_started 冻结快照不符——运行中补写的 manifest 不构成授权');
    }
  }
  return issues;
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
  receipts: MutationAuthorizationReceipt[],
  ctx: ReceiptValidationCtx,
): DriftClassification {
  const files = [...drift.added, ...drift.modified, ...drift.deleted].map(norm);
  if (files.length === 0) return { kind: 'no_drift' };
  const valid: MutationAuthorizationReceipt[] = [];
  const violations: string[] = [];
  for (const r of receipts) {
    const issues = receiptValidityIssues(r, ctx);
    if (issues.length === 0) valid.push(r);
    else violations.push(`receipt(${r.approved_by ?? '?'}) 无效：${issues.join('；')}`);
  }
  const deletedSet = new Set(drift.deleted.map(norm));
  const coverableSet = new Set(files.filter(f => !deletedSet.has(f)));
  const matched = valid
    .map(r => ({ r, covered: [...new Set(r.allowed_files.map(norm))].filter(f => coverableSet.has(f)) }))
    .filter(m => m.covered.length > 0);
  const allowed = new Set(matched.flatMap(m => m.covered));
  const uncovered = files.filter(f => !allowed.has(f));
  const quotaViolations = matched.filter(m => m.covered.length > m.r.max_files);

  // 三轮 review P1-6 + plan e7c2a4d8 T3b + 实施 round2 P0：added/modified 的内容级
  // change kind 判定（diff 内容分类器）未实现——classifier 落地前**唯一自动裁决路径**
  // = human receipt 携 adjudicated_drift_fingerprint 且与当前 drift 内容精确吻合，且
  // 这些裁决 receipt 的 allowed_files **独立**覆盖全部 drift、各自配额合规。coverage
  // 绝不与 preauth/无 fingerprint receipt 拼接（「human 裁 A + preauth 盖 B」拼成 A+B
  // 放行=preauth 实际参与放行，违反"意图预登记永不作为放行路"）。
  const currentFp = ctx.currentDriftFingerprint ?? null;
  const adjudicators = currentFp
    ? matched.filter(
        (m) => m.r.authority_kind === 'human' && m.r.adjudicated_drift_fingerprint === currentFp,
      )
    : [];
  if (adjudicators.length > 0) {
    const adjAllowed = new Set(adjudicators.flatMap((m) => m.covered));
    const adjUncovered = files.filter((f) => !adjAllowed.has(f));
    const adjQuotaViolations = adjudicators.filter((m) => m.covered.length > m.r.max_files);
    if (adjUncovered.length === 0 && adjQuotaViolations.length === 0) {
      return { kind: 'authorized_backtrack', matched: adjudicators.map((m) => m.r), files };
    }
  }
  if (uncovered.length === 0 && quotaViolations.length === 0 && matched.length > 0) {
    const humansWithFp = matched.filter(
      (m) => m.r.authority_kind === 'human' && typeof m.r.adjudicated_drift_fingerprint === 'string',
    );
    const detail =
      adjudicators.length > 0
        ? 'human 裁决 receipt fingerprint 吻合但其 allowed_files/配额不能独立覆盖全部 drift' +
          '（preauth/无 fingerprint receipt 不参与放行覆盖）——须补签独立覆盖全量 drift 的裁决'
        : humansWithFp.length > 0
          ? currentFp
            ? 'human 裁决 receipt 在场但 adjudicated_drift_fingerprint 与当前 drift 内容失配（裁决签发后内容又变？）——须按当前内容重新裁决'
            : '当前 drift fingerprint 不可计算（文件不可读）——无法与裁决绑定内容比对（fail-closed）'
          : '无 fingerprint 吻合的人工裁决 receipt——preauth/无 fingerprint 授权仅意图预登记，' +
            'change kind 内容级判定未实现（openspec 待办）前不放行';
    return {
      kind: 'unauthorized',
      files,
      violations: [
        `授权 receipt 命中（覆盖/配额合规：${matched.map(m => m.r.approved_by ?? '?').join('、')}），` +
        `但 ${detail}（HALT 安全方向）`,
      ],
    };
  }
  const deletedTouched = files.filter(f => deletedSet.has(f));
  if (deletedTouched.length > 0) {
    violations.push(
      `删除源文件（${deletedTouched.length}）不属于 test_seam/integration_glue 授权语义，恒不可授权：` +
      `${deletedTouched.slice(0, 5).join('、')}${deletedTouched.length > 5 ? '…' : ''}`,
    );
  }
  if (uncovered.length > 0) {
    violations.push(`未授权变更文件（${uncovered.length}）：${uncovered.slice(0, 8).join('、')}${uncovered.length > 8 ? '…' : ''}`);
  }
  for (const q of quotaViolations) {
    violations.push(
      `receipt(${q.r.approved_by ?? '?'}) 实际覆盖 ${q.covered.length} 文件超出其自身 max_files=${q.r.max_files}——翻转 unauthorized（配额不跨 receipt 汇总）`,
    );
  }
  if (valid.length === 0 && receipts.length === 0) {
    violations.push('无任何授权 receipt（testing/ut 期产品改码须三源授权）');
  }
  return { kind: 'unauthorized', files, violations };
}

// ---------------------------------------------------------------------------
// 存储：runner-owned <report_dir>/mutation-authorizations.jsonl + manifest 预授权
// ---------------------------------------------------------------------------

export function mutationAuthorizationsPath(projectRoot: string, reportDirRel: string): string {
  return path.join(projectRoot, reportDirRel, 'mutation-authorizations.jsonl');
}

export function loadMutationAuthorizations(
  projectRoot: string,
  reportDirRel: string,
): MutationAuthorizationReceipt[] {
  const p = mutationAuthorizationsPath(projectRoot, reportDirRel);
  if (!fs.existsSync(p)) return [];
  const out: MutationAuthorizationReceipt[] = [];
  for (const line of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as MutationAuthorizationReceipt);
    } catch {
      /* 坏行跳过 */
    }
  }
  return out;
}

/** manifest 预授权条目 → receipt 形态（authority_kind 恒 pre_run_manifest，hash 由调用方注入冻结值）。 */
export function receiptsFromManifestEntries(
  entries: Array<Record<string, unknown>> | undefined,
  runId: string,
  frozenManifestHash: string | null,
): MutationAuthorizationReceipt[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(e => e && typeof e === 'object')
    .map((e, i) => ({
      schema_version: '1.0' as const,
      run_id: runId,
      phase: typeof e.phase === 'string' ? e.phase : '',
      allowed_files: Array.isArray(e.allowed_files) ? (e.allowed_files as string[]).map(String) : [],
      allowed_change_kind:
        e.allowed_change_kind === 'integration_glue' ? ('integration_glue' as const) : ('test_seam' as const),
      max_files: typeof e.max_files === 'number' ? e.max_files : 0,
      approved_by: typeof e.approved_by === 'string' ? e.approved_by : 'pre_run_manifest',
      authority_kind: 'pre_run_manifest' as const,
      manifest_entry_id: typeof e.id === 'string' ? e.id : `entry-${i}`,
      ...(frozenManifestHash ? { manifest_hash_at_run_start: frozenManifestHash } : {}),
    }));
}

export function sha256FileHex(absPath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}
