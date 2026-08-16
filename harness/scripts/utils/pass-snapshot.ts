// ============================================================================
// pass-snapshot.ts — goal trust-state 命名空间：per-run 场外状态回收 + coding 基线锚
// ----------------------------------------------------------------------------
// 【pass snapshot 机制已整体退役 · openspec runner-owned-machine-facts（codex 审计定案）】
// 旧机制（PASS 产物冻结快照：artifact-class resolver / take/diff/restore/discard /
// trusted 加载 / epoch+head+journal）的全部职责已被更简单的既有事实取代：
//   · closure-only 流程状态 ← 上一轮权威 phase_verdict（PASS+advance_blocked+retry）；
//   · plan 授权/UI scope 白名单 ← plan closure 的 phase-evidence-manifest（跨 run 稳定）；
//   · PASS 产物防篡改 ← 下一轮完整 harness 重验 + closure manifest 绑定当前字节
//     （改坏=FAIL；改了仍合法=重新过全部门禁；快照在此之外只徒增故障面：
//     pass_snapshot_unavailable / pre_invoke_snapshot_failed / head+epoch+锚 /
//     可选产物空集误判 / 责任阶段重跑待办态）。
// 本文件保留两块**职责真实**的存留：
//   1) per-run 场外 trust 状态回收（deleteRunTrustState——场外数据 = 活跃/可恢复 run 的
//      临时恢复区，成功封卷或明确 supersede 即删；含历史 run 遗留的 pass-snapshots 目录）；
//   2) coding 基线锚（coding-base.json——ui_diff_within_declared_files 的 diff baseRef，
//      与快照机制无关，只是碰巧同住 trust 命名空间）。
//
// 【场外状态红线（plan b7e4d2a9）】场外数据 = 活跃/可恢复 run 的临时恢复区，**不是
// 历史档案库**：per-run 状态只在 run 活跃或可恢复期间存在，成功封卷或明确 supersede
// 即删（deleteRunTrustState）；普通完整性靠仓内签名/hash 做"检测并停止"。**新增任何
// 场外状态类型，必须先证明「in-repo 产物 + 签名/哈希绑定」做不到；默认答案是不允许。**
// （另一路径入口：goal-runner.ts visionTrustDir()——两处红线同文，勿分叉。）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// trust-state 根（与 goal-runner.visionTrustDir 同一约定——泛化为共享导出；
// MAISON_GOAL_CHECKPOINT_DIR 覆盖、该 env 已由 agent-invoke 从 agent 子进程剥离）
// ---------------------------------------------------------------------------

export function goalTrustRootDir(): string {
  const dirOverride = process.env.MAISON_GOAL_CHECKPOINT_DIR?.trim();
  return dirOverride ? path.resolve(dirOverride) : path.join(os.homedir(), '.maison', 'goal-checkpoints');
}

/** 与 goal-runner.projectIdentityHash 同一公式（大小写不敏感路径身份，8 hex） */
export function projectIdentityHash(projectRoot: string): string {
  return createHash('sha256')
    .update(path.resolve(projectRoot).replace(/\\/g, '/').toLowerCase(), 'utf-8')
    .digest('hex')
    .slice(0, 8);
}

function safeFeatureName(feature: string): string {
  return feature.replace(/[^\w.-]/g, '_');
}

/** coding 基线锚（c4e8b1d3 G1-1）：run 命名空间下的独立文件。 */
export function codingBasePath(projectRoot: string, feature: string, runId: string): string {
  return path.join(
    goalTrustRootDir(),
    projectIdentityHash(projectRoot),
    safeFeatureName(feature),
    runId,
    'coding-base.json',
  );
}

// ---------------------------------------------------------------------------
// 路径安全（codex 三轮#3 + 四轮#3 TOCTOU）
// ---------------------------------------------------------------------------

/** lexists 语义：lstat 不跟随链接——dangling symlink 也返回其 lstat（existsSync 会
 * 跟随链接对 dangling 返回 false，是 post-impl round2 P1#4 的漏检根源）。 */
export function lstatOrNull(absPath: string): fs.Stats | null {
  try {
    return fs.lstatSync(absPath);
  } catch {
    return null;
  }
}

/** 目标及全部父目录逐级 lstat：任何 symlink/junction/reparse point → fail-closed 抛错。
 * stopRoot 须为已验真实体目录（含）之上不再检查。 */
export function assertNoLinkInChain(targetAbs: string, stopRootAbs: string): void {
  const stop = path.resolve(stopRootAbs);
  let cur = path.resolve(targetAbs);
  while (true) {
    const st = lstatOrNull(cur);
    if (st?.isSymbolicLink()) {
      throw new Error(`[pass-snapshot] 路径链含 symlink/junction，fail-closed：${cur}`);
    }
    if (cur === stop) return;
    const parent = path.dirname(cur);
    if (parent === cur) {
      throw new Error(`[pass-snapshot] 目标 ${targetAbs} 不在允许根 ${stopRootAbs} 内`);
    }
    cur = parent;
  }
}

function writeJsonAtomic(absPath: string, doc: unknown): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  fs.renameSync(tmp, absPath);
}

// ---------------------------------------------------------------------------
// per-run 场外状态回收（b7e4d2a9 Todo2）：场外数据 = 活跃/可恢复 run 的临时恢复区，
// 成功封卷或明确 supersede 即删。逻辑删除单元 = 同 runId 的目录
// （<feature>/<runId>/，含历史遗留的 pass-snapshots/invalidation 与 coding-base）。
// ---------------------------------------------------------------------------

export interface RunTrustGcResult {
  deleted: string[];
  diagnostics: string[];
}

/** runId 严格路径契约：单个合法 basename，禁分隔符与 ./..（--supersede 输入来自原始 CLI 串）。 */
export function isValidRunIdBasename(runId: string): boolean {
  if (typeof runId !== 'string' || !runId.trim()) return false;
  if (runId.includes('/') || runId.includes('\\')) return false;
  if (runId === '.' || runId === '..') return false;
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(runId);
}

/**
 * best-effort 删除某 run 的全部场外 trust 状态（逻辑删除单元，允许部分成功）。
 * 任一路径校验失败 → 不删该路径、只记 diagnostics（fail-closed 于删除方向）：
 * runId 合法 basename → resolve 后严格位于 <projectHash>/<feature> 根下 → 逐级非
 * symlink/junction。调用方须先完成身份验证（目标 manifest.run_id === runId）与审计
 * 事件落盘——本函数只做路径安全与删除本身，不落任何事件（零新增机制）。
 */
export function deleteRunTrustState(input: {
  projectRoot: string;
  feature: string;
  runId: string;
}): RunTrustGcResult {
  const { projectRoot, feature, runId } = input;
  const out: RunTrustGcResult = { deleted: [], diagnostics: [] };
  if (!isValidRunIdBasename(runId)) {
    out.diagnostics.push(`runId 非法（拒删）：${JSON.stringify(runId)}`);
    return out;
  }
  const trustRoot = goalTrustRootDir();
  const featureRoot = path.join(trustRoot, projectIdentityHash(projectRoot), safeFeatureName(feature));
  const units = [
    { label: `checkpoint ${runId}.json`, abs: path.join(featureRoot, `${runId}.json`) },
    { label: `run 目录 ${runId}/`, abs: path.join(featureRoot, runId) },
  ];
  for (const u of units) {
    const abs = path.resolve(u.abs);
    const rel = path.relative(path.resolve(featureRoot), abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
      out.diagnostics.push(`${u.label} 越界（拒删）：${abs}`);
      continue;
    }
    const st = lstatOrNull(abs);
    if (!st) continue; // 不存在——无事
    if (st.isSymbolicLink()) {
      out.diagnostics.push(`${u.label} 是符号链接（拒删）`);
      continue;
    }
    try {
      assertNoLinkInChain(abs, trustRoot);
    } catch (e) {
      out.diagnostics.push(`${u.label} 路径链含链接（拒删）：${(e as Error).message}`);
      continue;
    }
    try {
      fs.rmSync(abs, { recursive: true, force: true });
      out.deleted.push(u.label);
    } catch (e) {
      out.diagnostics.push(`${u.label} 删除失败（best-effort，不阻断）：${(e as Error).message}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// coding 基线锚（c4e8b1d3 G1-1：pre-coding 锚定）
// ---------------------------------------------------------------------------
// runner 在**首次 coding agent invoke 前**记录当时的 git HEAD（agent 尚未动码）。
// write-once：同 run 已有合法记录即复用（resume 不得重新取 HEAD——那会把 agent
// 已 commit 的越界文件洗出 diff 基线）。harness 侧 ui_diff_within_declared_files
// 以此为 diff baseRef；缺失/损坏 → 门禁 fail-closed BLOCKER。

export interface CodingBaseBody {
  kind: 'coding_base';
  schema_version: '1.0';
  project_identity_hash: string;
  feature: string;
  run_id: string;
  base_sha: string;
  recorded_at: string;
}

function isValidCodingBaseShape(b: Record<string, unknown>): boolean {
  return (
    typeof b.project_identity_hash === 'string' &&
    typeof b.feature === 'string' &&
    typeof b.run_id === 'string' &&
    typeof b.base_sha === 'string' && /^[0-9a-f]{40}$/.test(b.base_sha as string) &&
    typeof b.recorded_at === 'string'
  );
}

export function readCodingBase(
  projectRoot: string,
  feature: string,
  runId: string,
): { body: CodingBaseBody | null; status: 'ok' | 'invalid' | 'absent' } {
  const p = codingBasePath(projectRoot, feature, runId);
  if (!fs.existsSync(p)) return { body: null, status: 'absent' };
  try {
    const body = JSON.parse(fs.readFileSync(p, 'utf-8')) as CodingBaseBody;
    if (body.kind !== 'coding_base' || body.schema_version !== '1.0') {
      return { body: null, status: 'invalid' };
    }
    if (!isValidCodingBaseShape(body as unknown as Record<string, unknown>)) {
      return { body: null, status: 'invalid' };
    }
    if (
      body.project_identity_hash !== projectIdentityHash(projectRoot) ||
      body.feature !== feature ||
      body.run_id !== runId
    ) {
      return { body: null, status: 'invalid' }; // 跨 project/feature/run 重放
    }
    return { body: body as CodingBaseBody, status: 'ok' };
  } catch {
    return { body: null, status: 'invalid' };
  }
}

/** 当前 git HEAD（40-hex）；非 git 仓库/失败 → null。供 runner 锚定 coding_base 用。 */
export function resolveGitHeadSha(projectRoot: string): string | null {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot, encoding: 'utf-8', shell: false,
  });
  if (r.status !== 0) return null;
  const sha = (r.stdout ?? '').trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export type CodingBaseRecordOutcome =
  | { kind: 'recorded'; body: CodingBaseBody }
  | { kind: 'reused'; body: CodingBaseBody }
  | { kind: 'invalid_existing' };

export function recordCodingBase(input: {
  projectRoot: string;
  feature: string;
  runId: string;
  baseSha: string;
}): CodingBaseRecordOutcome {
  const { projectRoot, feature, runId, baseSha } = input;
  const existing = readCodingBase(projectRoot, feature, runId);
  if (existing.body && existing.status === 'ok') {
    return { kind: 'reused', body: existing.body }; // write-once：resume 复用原 SHA
  }
  if (existing.status === 'invalid') {
    // 损坏/不匹配的既有记录不覆盖洗白——保留现场，调用方与门禁侧 fail-closed
    return { kind: 'invalid_existing' };
  }
  const body: CodingBaseBody = {
    kind: 'coding_base',
    schema_version: '1.0',
    project_identity_hash: projectIdentityHash(projectRoot),
    feature,
    run_id: runId,
    base_sha: baseSha,
    recorded_at: new Date().toISOString(),
  };
  writeJsonAtomic(codingBasePath(projectRoot, feature, runId), body);
  return { kind: 'recorded', body };
}
