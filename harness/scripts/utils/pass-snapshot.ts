// ============================================================================
// pass-snapshot.ts — PASS 态冻结：artifact-class resolver / 双协议域快照 / 失效 journal
// （plan 7c4f2e9b P0-3，OpenSpec change cc-spec-deadlock-hardening）
// ============================================================================
// 事故根因：spec-i2 harness 全门禁 PASS 仅因 agent_timeout_unclosed 被整轮重试，i3 冷启动
// 重写毁掉 PASS 产物且不可恢复。本模块提供：
//   1) artifact-class resolver（四类，唯一纯函数，快照/差异/恢复三处共同消费）；
//   2) runner-owned 快照存储：不可变 pass_snapshot_manifest（文件清单+逐文件哈希，历史
//      永不重写）+ 可变 pass_snapshot_head（仅 active/superseded 两态；唯一改状态处）——
//      HMAC 协议域与 vision checkpoint 隔离（跨协议互塞必须 invalid）；
//   3) run 级全局 invalidation journal（唯一事务 pending SSOT；resume 先恢复 journal 再读
//      任何 head；不可验证 → fail-closed，限 --resume/重启路径）；
//   4) 恢复安全：逐级 lstat 拒 symlink/junction、realpath 域内、单 buffer TOCTOU、原子写。
// 信任分两层（codex 三轮#1）：同进程内存 digest 验真即可恢复（与 HMAC 无关）；
// resume/重启须 HMAC 验签，未配密钥只检测+halt，绝不用弱信任快照覆盖用户文件。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { artifactReadCandidatePaths, featureDir, featureFilePath, resolveFeatureArtifact } from '../../config';
import {
  PHASE_OUTPUT_FILES_BY_PHASE,
  PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE,
  PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE,
  stableStringify,
} from './phase-evidence-manifest';
import type { Phase } from './types';

// ---------------------------------------------------------------------------
// trust-state 根（与 goal-runner.visionTrustDir 同一约定——泛化为共享导出；
// MAISON_GOAL_CHECKPOINT_DIR 覆盖、该 env 已由 agent-invoke 从 agent 子进程剥离）
// ---------------------------------------------------------------------------

export const PASS_SNAPSHOT_HMAC_ENV = 'MAISON_HMAC_GOAL_CHECKPOINT';

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

/** 快照命名空间：<trust>/<projectHash>/<feature>/<runId>/pass-snapshots/…（独立于
 * vision checkpoint 单文件 <runId>.json 与 vision-heads/ 子树，互不触碰） */
export function passSnapshotRunDir(projectRoot: string, feature: string, runId: string): string {
  return path.join(
    goalTrustRootDir(),
    projectIdentityHash(projectRoot),
    safeFeatureName(feature),
    runId,
    'pass-snapshots',
  );
}

export function passSnapshotPhaseDir(projectRoot: string, feature: string, runId: string, phase: string, epoch: number): string {
  return path.join(passSnapshotRunDir(projectRoot, feature, runId), phase, String(epoch));
}

export function passSnapshotHeadPath(projectRoot: string, feature: string, runId: string, phase: string): string {
  return path.join(passSnapshotRunDir(projectRoot, feature, runId), phase, 'head.json');
}

export function invalidationJournalPath(projectRoot: string, feature: string, runId: string): string {
  return path.join(passSnapshotRunDir(projectRoot, feature, runId), 'invalidation.json');
}

// ---------------------------------------------------------------------------
// artifact-class resolver（codex 六轮 P0#2：四类；三张产出表全消费；控制面逐一登记，
// 禁 *.receipt.* 通配）
// ---------------------------------------------------------------------------

export type PassArtifactClass = 'frozen_deliverable' | 'mutable_closure' | 'mutable_control_plane' | 'derived';

/** 视觉二期合法控制面（closure/后续 attempt 合法新增，不判 added、不被恢复删除）。
 * 按具体语义逐一登记；crop-provenance 为目录级注册语义（<key>.receipt.json）。 */
const MUTABLE_CONTROL_PLANE_FILES: ReadonlySet<string> = new Set([
  'spec/fidelity-downgrade.receipt.json',
  'vision/capability-receipt.json',
  'vision/spec-refs-receipt.json',
  'vision/artifact-attestations.jsonl',
  'vision/policy-downgrades.jsonl',
]);
const MUTABLE_CONTROL_PLANE_DIR_SUFFIX: ReadonlyArray<{ dir: string; suffix: string }> = [
  { dir: 'spec/crop-provenance/', suffix: '.receipt.json' },
];

/** relPath 为 featureDir 内 posix 相对路径 */
export function classifyPassArtifact(phase: string, relPath: string): PassArtifactClass {
  const p = relPath.replace(/\\/g, '/');
  if (
    p === `${phase}/phase-completion-receipt.md` ||
    p === `${phase}/headless-assumptions.jsonl` ||
    p === `${phase}/headless-assumptions.md`
  ) {
    return 'mutable_closure';
  }
  if (MUTABLE_CONTROL_PLANE_FILES.has(p)) return 'mutable_control_plane';
  for (const { dir, suffix } of MUTABLE_CONTROL_PLANE_DIR_SUFFIX) {
    if (p.startsWith(dir) && p.endsWith(suffix)) return 'mutable_control_plane';
  }
  if (p.includes('/reports/') || p.startsWith('goal-runs/') || p.includes('/.cache/')) return 'derived';
  if (p === `${phase}/phase-evidence-manifest.json`) return 'derived';
  return 'frozen_deliverable';
}

export interface FrozenFileEntry {
  /** featureDir 内 posix 相对路径 */
  rel: string;
  abs: string;
  sha256: string;
  bytes: number;
}

export interface FrozenManifestBody {
  kind: 'pass_snapshot_manifest';
  schema_version: '1.0';
  project_identity_hash: string;
  feature: string;
  run_id: string;
  phase: string;
  pass_epoch: number;
  /** watched roots（featureDir 内相对目录）——added 差异的判定域 */
  watched_roots: string[];
  files: Array<{ rel: string; sha256: string; bytes: number }>;
}

export interface PassSnapshotHeadBody {
  kind: 'pass_snapshot_head';
  schema_version: '1.0';
  project_identity_hash: string;
  feature: string;
  run_id: string;
  phase: string;
  /** 事务 pending 语义唯一存于 run 级 journal——head 仅两态（codex 九轮 P1） */
  state: 'active' | 'superseded';
  pass_epoch: number;
  generation: number;
  manifest_sha256: string;
}

export interface InvalidationJournalBody {
  kind: 'pass_snapshot_invalidation';
  schema_version: '1.0';
  project_identity_hash: string;
  feature: string;
  run_id: string;
  tx_id: string;
  state: 'pending' | 'committed';
  cause_phase: string;
  invalidated_phases: string[];
  old_head_hashes: Record<string, string | null>;
  target_generations: Record<string, number>;
}

// ---------------------------------------------------------------------------
// HMAC 协议域（复用 MAISON_HMAC_GOAL_CHECKPOINT 密钥模型；签名体独立 kind+域前缀，
// checkpoint/head/HWM/reseal ↔ manifest/head/journal 跨协议互塞必须 invalid）
// ---------------------------------------------------------------------------

function macFor(body: { kind: string }): string | null {
  const key = process.env[PASS_SNAPSHOT_HMAC_ENV]?.trim();
  if (!key) return null;
  return createHmac('sha256', key).update(`${body.kind}:${stableStringify(body)}`, 'utf-8').digest('hex');
}

export type MacVerdict = 'ok' | 'ok_unauthenticated' | 'invalid';

function verifyMac(body: { kind: string }, mac: unknown): MacVerdict {
  const expected = macFor(body);
  if (expected === null) {
    // 未配密钥：如实降级（不冒充强信任）——写入时 mac=null
    return typeof mac === 'string' && mac ? 'invalid' : 'ok_unauthenticated';
  }
  if (typeof mac !== 'string' || !mac) return 'invalid';
  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(mac, 'utf-8');
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'invalid';
}

export function sha256Buf(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
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

/** 词法包含判定（诚实命名：非 realpath——链接逃逸由 assertNoLinkInChain 先行排除，
 * 二者必须成对使用，词法包含才等价于真实包含）。 */
function assertInsideRoot(targetAbs: string, rootAbs: string): void {
  const rel = path.relative(path.resolve(rootAbs), path.resolve(targetAbs));
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`[pass-snapshot] 路径越界（词法包含失败）：${targetAbs} 不在 ${rootAbs} 内`);
  }
}

/** 单 buffer TOCTOU 安全安装：读一次→验哈希→同一 buffer 写同目录临时文件→原子 rename。 */
export function installBufferAtomic(srcAbs: string, expectedSha256: string, destAbs: string): void {
  const buf = fs.readFileSync(srcAbs);
  const actual = sha256Buf(buf);
  if (actual !== expectedSha256) {
    throw new Error(`[pass-snapshot] 快照字节验哈希失败：${srcAbs} expected=${expectedSha256} actual=${actual}`);
  }
  const tmp = path.join(path.dirname(destAbs), `.pass-restore-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, destAbs);
}

function writeJsonAtomic(absPath: string, doc: unknown): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  fs.renameSync(tmp, absPath);
}

// ---------------------------------------------------------------------------
// frozen 清单解析（三张产出表全消费——codex 六轮 P0#2）
// ---------------------------------------------------------------------------

export interface FrozenResolveInput {
  projectRoot: string;
  feature: string;
  phase: Phase | string;
}

/**
 * 该 phase 是否存在 frozen 保护面（三张产出表任一非空）。coding/ut 的产出是源码树
 * （closure-attestation 承载），表为空——保护不适用属设计内；表非空却 resolve 出零文件
 * = PASS 无产物的不变量违例，调用方须 fail-closed（post-impl review P0#2）。
 */
export function phaseHasFrozenSurface(phase: Phase | string): boolean {
  const p = phase as Phase;
  return (
    (PHASE_OUTPUT_FILES_BY_PHASE[p] ?? []).length > 0 ||
    (PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE[p] ?? []).length > 0 ||
    (PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE[p] ?? []).length > 0
  );
}

/** watched roots：frozen 差异判定域（featureDir 内相对目录）。 */
export function watchedRootsForPhase(phase: string): string[] {
  // 目前各 phase 的 frozen 产物均落 <phase>/ 目录（含 spec/ 子目录产物）；acceptance.yaml
  // 等 feature 根产物以显式文件参与，不纳目录域（根目录混杂 goal-runs 等非产物）。
  return [`${phase}/`];
}

export function resolveFrozenDeliverables(input: FrozenResolveInput): FrozenFileEntry[] {
  const { projectRoot, feature } = input;
  const phase = String(input.phase);
  const featDir = featureDir(projectRoot, feature);
  const absSet = new Map<string, string>(); // rel -> abs
  const push = (abs: string): void => {
    if (!fs.existsSync(abs)) return;
    const rel = path.relative(featDir, abs).replace(/\\/g, '/');
    if (rel.startsWith('..')) return;
    if (classifyPassArtifact(phase, rel) !== 'frozen_deliverable') return;
    // P1#4（post-impl review）：建快照前逐级 lstat——frozen 文件或其父目录为
    // symlink/junction 时 fail-closed，禁止跟随链接读取域外内容进快照。
    assertNoLinkInChain(abs, featDir);
    absSet.set(rel, abs);
  };
  for (const name of PHASE_OUTPUT_FILES_BY_PHASE[phase as Phase] ?? []) {
    push(resolveFeatureArtifact(projectRoot, feature, name).actualPath);
  }
  for (const name of PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE[phase as Phase] ?? []) {
    push(resolveFeatureArtifact(projectRoot, feature, name).actualPath);
  }
  for (const rel of PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE[phase as Phase] ?? []) {
    push(featureFilePath(projectRoot, feature, rel));
  }
  const out: FrozenFileEntry[] = [];
  for (const [rel, abs] of [...absSet.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const buf = fs.readFileSync(abs);
    out.push({ rel, abs, sha256: sha256Buf(buf), bytes: buf.length });
  }
  return out;
}

/** round5 P0：必需 frozen 产物的候选 rel 集（canonical+legacy，**磁盘无关**——纯注册表
 * 推导）。根级契约（spec 的 acceptance.yaml / plan 的 contracts.yaml）不在 watched_roots
 * 目录域内，manifest.files 是其唯一差异判定入口：弱信任 resume 伪造 manifest 只删该
 * 条目（roots 保持精确等价、其余 files 合法）即可让改毁根级产物零 diff 通过。
 * 完整性对账据此表在建快照与可信加载两端同构执行。 */
export function requiredFrozenRelCandidates(
  projectRoot: string,
  feature: string,
  phase: string,
): Array<{ artifact: string; rels: string[] }> {
  const featDir = featureDir(projectRoot, feature);
  const out: Array<{ artifact: string; rels: string[] }> = [];
  for (const name of PHASE_OUTPUT_FILES_BY_PHASE[phase as Phase] ?? []) {
    const rels: string[] = [];
    for (const abs of artifactReadCandidatePaths(projectRoot, feature, name)) {
      const rel = path.relative(featDir, abs).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      if (classifyPassArtifact(phase, rel) !== 'frozen_deliverable') continue;
      if (!rels.includes(rel)) rels.push(rel);
    }
    if (rels.length > 0) out.push({ artifact: name, rels });
  }
  return out;
}

/** round6 P1：注册表推导的**根级** frozen 候选 rel（三张产出表全消费，磁盘无关）——
 * watched_roots 目录域之外的产物（acceptance.yaml / contracts.yaml / use-cases.yaml 等
 * 非 phase-scoped artifact 落 feature 根），manifest 条目与本候选表是其仅有的两条检测
 * 通道：diff 的 added 域与弱信任载侧对账都据此表消费。
 * 诚实边界：无 HMAC 时，若 optional 文件与其 manifest 条目在 resume 前被**一并**删除，
 * 其历史存在性无从证明（候选表只知"可能有"，不知"曾经有"）——强抗篡改仍须配 HMAC。 */
export function rootLevelFrozenCandidateRels(
  projectRoot: string,
  feature: string,
  phase: string,
): string[] {
  const featDir = featureDir(projectRoot, feature);
  const roots = watchedRootsForPhase(phase);
  const out: string[] = [];
  const pushAbs = (abs: string): void => {
    const rel = path.relative(featDir, abs).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
    if (!isCanonicalRel(rel)) return;
    if (roots.some(r => rel.startsWith(r))) return; // 目录域内由 watched 扫描承载
    if (classifyPassArtifact(phase, rel) !== 'frozen_deliverable') return;
    if (!out.includes(rel)) out.push(rel);
  };
  for (const name of [
    ...(PHASE_OUTPUT_FILES_BY_PHASE[phase as Phase] ?? []),
    ...(PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE[phase as Phase] ?? []),
  ]) {
    for (const abs of artifactReadCandidatePaths(projectRoot, feature, name)) pushAbs(abs);
  }
  for (const rel of PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE[phase as Phase] ?? []) {
    pushAbs(featureFilePath(projectRoot, feature, rel));
  }
  return out;
}

/** 完整性对账：manifest files 未覆盖某必需产物（任一候选 rel 均缺席）→ 返回缺失产物名。
 * 必需产物即使磁盘已被删也必须在 manifest 中——删除本身就是必须检出的漂移。 */
export function findMissingRequiredFrozenRels(
  projectRoot: string,
  feature: string,
  phase: string,
  fileRels: ReadonlySet<string>,
): string[] {
  const missing: string[] = [];
  for (const req of requiredFrozenRelCandidates(projectRoot, feature, phase)) {
    if (!req.rels.some(rel => fileRels.has(rel))) missing.push(req.artifact);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// 快照建立 / head / journal
// ---------------------------------------------------------------------------

export interface TakenSnapshot {
  manifest: FrozenManifestBody;
  manifestSha256: string;
  head: PassSnapshotHeadBody;
  phaseDir: string;
  /** 同进程内存信任锚（goal-runner 持有；resume 后不可用） */
  memoryDigest: { manifestSha256: string; fileHashes: Record<string, string> };
}

export function takePassSnapshot(input: {
  projectRoot: string;
  feature: string;
  runId: string;
  phase: string;
  epoch: number;
  files: FrozenFileEntry[];
}): TakenSnapshot {
  const { projectRoot, feature, runId, phase, epoch, files } = input;
  // round5 P0（建侧）：必需产物缺席即拒建——与加载侧完整性对账同构，绝不落盘一份
  // "对账必失败"的 manifest。PASS 却缺必需产物本身即门禁不变量违例，调用方按保护
  // 失败处置（halt pass_snapshot_unavailable），不得静默建出不完整保护面。
  const missingAtTake = findMissingRequiredFrozenRels(projectRoot, feature, phase, new Set(files.map(f => f.rel)));
  if (missingAtTake.length > 0) {
    throw new Error(
      `[pass-snapshot] PASS 冻结清单缺必需产物：${missingAtTake.join(', ')}——拒建快照（PASS 态与产出表不一致，属门禁不变量违例）`,
    );
  }
  // round6 P1（建侧全集对账）：传入 files 须覆盖 resolveFrozenDeliverables 的**当前完整
  // 集合**（三张产出表全消费）——必需表之外，磁盘在场的 optional 产物（如根级
  // use-cases.yaml）漏出清单即建出"该文件永远不参与差异判定"的保护面。
  const providedRels = new Set(files.map(f => f.rel));
  const uncovered = resolveFrozenDeliverables({ projectRoot, feature, phase })
    .filter(f => !providedRels.has(f.rel))
    .map(f => f.rel);
  if (uncovered.length > 0) {
    throw new Error(
      `[pass-snapshot] PASS 冻结清单未覆盖当前可解析 frozen 产物：${uncovered.join(', ')}——拒建快照（清单与产出表解析结果不一致）`,
    );
  }
  const phaseDir = passSnapshotPhaseDir(projectRoot, feature, runId, phase, epoch);
  // P0#2（post-impl review）：目标 epoch 目录若已含**合法** manifest → 拒绝覆盖
  // （不可变 manifest 语义——历史快照永不重写）；仅无 manifest 的孤儿残留（建到一半
  // 崩溃、head 从未引用）才允许清理重建。
  if (fs.existsSync(phaseDir)) {
    const existing = readFrozenManifest(phaseDir);
    if (existing.body) {
      throw new Error(
        `[pass-snapshot] epoch ${epoch} 已存在合法 manifest——不可变快照禁止覆盖（调用方应递增 epoch 或 halt 求人）`,
      );
    }
    fs.rmSync(phaseDir, { recursive: true, force: true });
  }
  // 临时目录构建 + 逐文件验哈希 + 原子 rename（codex 三轮#1）
  const featDirForTake = featureDir(projectRoot, feature);
  const tmpDir = `${phaseDir}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of files) {
    // P1#4：读取前再验链接链（清单与读取之间的换链窗口）
    assertNoLinkInChain(f.abs, featDirForTake);
    const dest = path.join(tmpDir, f.rel.replace(/\//g, '__'));
    const buf = fs.readFileSync(f.abs);
    const actual = sha256Buf(buf);
    if (actual !== f.sha256) {
      throw new Error(`[pass-snapshot] 建快照时字节漂移：${f.rel}（清单后被改写？）`);
    }
    fs.writeFileSync(dest, buf);
  }
  fs.mkdirSync(path.dirname(phaseDir), { recursive: true });
  fs.renameSync(tmpDir, phaseDir);

  const manifest: FrozenManifestBody = {
    kind: 'pass_snapshot_manifest',
    schema_version: '1.0',
    project_identity_hash: projectIdentityHash(projectRoot),
    feature,
    run_id: runId,
    phase,
    pass_epoch: epoch,
    watched_roots: watchedRootsForPhase(phase),
    files: files.map(f => ({ rel: f.rel, sha256: f.sha256, bytes: f.bytes })),
  };
  const manifestDoc = { ...manifest, mac: macFor(manifest) };
  writeJsonAtomic(path.join(phaseDir, 'manifest.json'), manifestDoc);
  const manifestSha256 = sha256Buf(Buffer.from(JSON.stringify(manifestDoc, null, 2), 'utf-8'));

  const prevHead = readPassSnapshotHead(projectRoot, feature, runId, phase);
  const head: PassSnapshotHeadBody = {
    kind: 'pass_snapshot_head',
    schema_version: '1.0',
    project_identity_hash: projectIdentityHash(projectRoot),
    feature,
    run_id: runId,
    phase,
    state: 'active',
    pass_epoch: epoch,
    generation: (prevHead.body?.generation ?? 0) + 1,
    manifest_sha256: manifestSha256,
  };
  writeJsonAtomic(passSnapshotHeadPath(projectRoot, feature, runId, phase), { ...head, mac: macFor(head) });

  const fileHashes: Record<string, string> = {};
  for (const f of files) fileHashes[f.rel] = f.sha256;
  return { manifest, manifestSha256, head, phaseDir, memoryDigest: { manifestSha256, fileHashes } };
}

export interface HeadReadResult {
  body: PassSnapshotHeadBody | null;
  mac: MacVerdict | 'absent';
}

// post-impl round2 P0#2：运行时 shape 校验——kind/schema_version 只挡跨协议互塞，
// 字段级篡改（state 改任意串/epoch 改字符串等）须同样判 invalid。
function isValidHeadShape(b: Record<string, unknown>): boolean {
  return (
    typeof b.project_identity_hash === 'string' &&
    typeof b.feature === 'string' &&
    typeof b.run_id === 'string' &&
    typeof b.phase === 'string' &&
    (b.state === 'active' || b.state === 'superseded') &&
    typeof b.pass_epoch === 'number' && Number.isInteger(b.pass_epoch) && b.pass_epoch >= 1 &&
    typeof b.generation === 'number' && Number.isInteger(b.generation) && b.generation >= 1 &&
    typeof b.manifest_sha256 === 'string' && /^[0-9a-f]{64}$/.test(b.manifest_sha256)
  );
}

/** post-impl round3 P1#5：canonical 相对路径判定——绝对路径/../反斜杠/空段一律拒
 * （path.join 前置防线：非法 rel 会在 assertInsideRoot 之前读写 feature 根之外）。 */
function isCanonicalRel(rel: string): boolean {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || path.isAbsolute(rel)) return false;
  const segs = rel.split('/');
  return segs.every(s => s !== '' && s !== '.' && s !== '..');
}

function isValidManifestShape(b: Record<string, unknown>): boolean {
  if (
    typeof b.project_identity_hash !== 'string' ||
    typeof b.feature !== 'string' ||
    typeof b.run_id !== 'string' ||
    typeof b.phase !== 'string' ||
    typeof b.pass_epoch !== 'number' || !Number.isInteger(b.pass_epoch) || b.pass_epoch < 1
  ) {
    return false;
  }
  const phase = b.phase as string;
  // post-impl round3 P1#5 + round4 P0：watched_roots 须与 watchedRootsForPhase(phase)
  // **精确集合等价**——仅前缀校验时 `spec/nonexistent/` 可把差异判定域缩窄到空目录，
  // 弱信任 resume 伪造 manifest（roots 缩窄 + files 漏关键产物）即可让改毁 ui-spec 零
  // diff 通过；files 非空、rel canonical 且唯一、bytes 非负整数、且逐一与 artifact-class
  // resolver 一致（frozen_deliverable）。
  const expectedRoots = watchedRootsForPhase(phase);
  if (
    !Array.isArray(b.watched_roots) ||
    (b.watched_roots as unknown[]).length !== expectedRoots.length ||
    !expectedRoots.every(r => (b.watched_roots as unknown[]).includes(r))
  ) {
    return false;
  }
  if (!Array.isArray(b.files) || (b.files as unknown[]).length === 0) return false;
  const seen = new Set<string>();
  for (const f of b.files as Array<Record<string, unknown>>) {
    if (!f || typeof f.rel !== 'string' || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256 as string)) {
      return false;
    }
    // round5 P2：bytes 无条件必填（与 FrozenManifestBody 类型声明一致）——缺失同判 invalid
    if (typeof f.bytes !== 'number' || !Number.isInteger(f.bytes) || f.bytes < 0) {
      return false;
    }
    const rel = f.rel as string;
    if (!isCanonicalRel(rel)) return false;
    if (seen.has(rel)) return false;
    seen.add(rel);
    if (classifyPassArtifact(phase, rel) !== 'frozen_deliverable') return false;
  }
  return true;
}

function isValidJournalShape(b: Record<string, unknown>): boolean {
  return (
    typeof b.project_identity_hash === 'string' &&
    typeof b.feature === 'string' &&
    typeof b.run_id === 'string' &&
    typeof b.tx_id === 'string' &&
    (b.state === 'pending' || b.state === 'committed') &&
    typeof b.cause_phase === 'string' &&
    Array.isArray(b.invalidated_phases) && (b.invalidated_phases as unknown[]).every(p => typeof p === 'string') &&
    !!b.old_head_hashes && typeof b.old_head_hashes === 'object' &&
    !!b.target_generations && typeof b.target_generations === 'object'
  );
}

export function readPassSnapshotHead(projectRoot: string, feature: string, runId: string, phase: string): HeadReadResult {
  const p = passSnapshotHeadPath(projectRoot, feature, runId, phase);
  if (!fs.existsSync(p)) return { body: null, mac: 'absent' };
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as PassSnapshotHeadBody & { mac?: unknown };
    const { mac, ...body } = doc;
    if (body.kind !== 'pass_snapshot_head' || body.schema_version !== '1.0') {
      return { body: null, mac: 'invalid' }; // 跨协议互塞 → invalid
    }
    if (!isValidHeadShape(body as unknown as Record<string, unknown>)) {
      return { body: null, mac: 'invalid' };
    }
    return { body: body as PassSnapshotHeadBody, mac: verifyMac(body, mac) };
  } catch {
    return { body: null, mac: 'invalid' };
  }
}

export function readFrozenManifest(phaseDir: string): { body: FrozenManifestBody | null; mac: MacVerdict } {
  const p = path.join(phaseDir, 'manifest.json');
  if (!fs.existsSync(p)) return { body: null, mac: 'invalid' };
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as FrozenManifestBody & { mac?: unknown };
    const { mac, ...body } = doc;
    if (body.kind !== 'pass_snapshot_manifest' || body.schema_version !== '1.0') {
      return { body: null, mac: 'invalid' };
    }
    if (!isValidManifestShape(body as unknown as Record<string, unknown>)) {
      return { body: null, mac: 'invalid' };
    }
    return { body: body as FrozenManifestBody, mac: verifyMac(body, mac) };
  } catch {
    return { body: null, mac: 'invalid' };
  }
}

// ---------------------------------------------------------------------------
// post-impl round2 P0#2：统一可信快照加载——**spawn agent 之前**调用一次，整个 attempt
// 复用返回值（内存副本，防"attempt 中途盘上换 manifest"）。任何坏 MAC/shape/上下文
// 绑定/head↔manifest 绑定 → fail_closed（调用方 halt，不 spawn agent）。
// ---------------------------------------------------------------------------

export type TrustedSnapshotContext =
  | { kind: 'none' }
  | { kind: 'inactive' }
  | {
      kind: 'active';
      head: PassSnapshotHeadBody;
      headMac: MacVerdict;
      manifest: FrozenManifestBody;
      manifestMac: MacVerdict;
      phaseDir: string;
    }
  | { kind: 'fail_closed'; reason: string };

export function loadTrustedSnapshotContext(
  projectRoot: string,
  feature: string,
  runId: string,
  phase: string,
  // post-impl round3 P0#1：同进程内存锚——存在时盘上任何「消失/退位/换代」都是篡改
  // （两轮绕过：N 轮只删 head 不碰产物→零 diff；N+1 轮 loader 若返回 none 则保护全关）。
  // 合法 supersede（backtrack 事务）会先清内存锚，不经此路径。
  expectedAnchor?: { epoch: number; manifestSha256: string } | null,
): TrustedSnapshotContext {
  const head = readPassSnapshotHead(projectRoot, feature, runId, phase);
  if (head.mac === 'invalid') return { kind: 'fail_closed', reason: 'head 损坏/跨协议/shape 非法/验签失败' };
  if (!head.body) {
    if (expectedAnchor) {
      return { kind: 'fail_closed', reason: '同进程内存锚在场但盘上 head 消失——判篡改（两轮绕过形态）' };
    }
    return { kind: 'none' };
  }
  if (expectedAnchor) {
    if (head.body.state !== 'active') {
      return { kind: 'fail_closed', reason: `内存锚在场但 head.state=${head.body.state}——非本进程合法退位路径` };
    }
    if (head.body.pass_epoch !== expectedAnchor.epoch || head.body.manifest_sha256 !== expectedAnchor.manifestSha256) {
      return { kind: 'fail_closed', reason: '内存锚与盘上 head 的 epoch/manifest_sha 失配——head 被换代' };
    }
  }
  if (
    head.body.project_identity_hash !== projectIdentityHash(projectRoot) ||
    head.body.feature !== feature ||
    head.body.run_id !== runId ||
    head.body.phase !== phase
  ) {
    return { kind: 'fail_closed', reason: 'head 上下文绑定失配（跨 project/feature/run/phase 重放）' };
  }
  if (head.body.state !== 'active') return { kind: 'inactive' };
  const phaseDir = passSnapshotPhaseDir(projectRoot, feature, runId, phase, head.body.pass_epoch);
  const manifest = readFrozenManifest(phaseDir);
  if (!manifest.body || manifest.mac === 'invalid') {
    return { kind: 'fail_closed', reason: 'head active 但 manifest 缺失/损坏/shape 非法/验签失败' };
  }
  if (
    manifest.body.project_identity_hash !== head.body.project_identity_hash ||
    manifest.body.feature !== feature ||
    manifest.body.run_id !== runId ||
    manifest.body.phase !== phase ||
    manifest.body.pass_epoch !== head.body.pass_epoch
  ) {
    return { kind: 'fail_closed', reason: 'manifest 上下文绑定失配（跨 run/phase/epoch 重放）' };
  }
  const manifestRaw = fs.readFileSync(path.join(phaseDir, 'manifest.json'), 'utf-8');
  if (sha256Buf(Buffer.from(manifestRaw, 'utf-8')) !== head.body.manifest_sha256) {
    return { kind: 'fail_closed', reason: 'manifest 与 head 绑定失配（快照被换）' };
  }
  // round5 P0（载侧）：完整性对账——根级必需产物（acceptance.yaml/contracts.yaml）在
  // watched_roots 目录域之外，files 条目是其唯一差异入口；弱信任伪造 manifest+head
  // 一致改写、只删该条目即可让改毁零 diff 通过。必需产物按注册表要求必须在 manifest
  // （磁盘已删也须在——删除正是要检出的漂移）。
  const manifestFileRels = new Set(manifest.body.files.map(f => f.rel));
  const missingRequired = findMissingRequiredFrozenRels(projectRoot, feature, phase, manifestFileRels);
  if (missingRequired.length > 0) {
    return {
      kind: 'fail_closed',
      reason: `manifest 完整性对账失败：缺必需 frozen 产物 ${missingRequired.join(', ')}（根级产物仅凭 files 条目参与差异判定，缺席即保护面被洗）`,
    };
  }
  // round6 P1（弱信任载侧）：manifest 未认证（MAC 非 ok 且无内存锚）时，磁盘在场的根级
  // 候选（含 optional，如 use-cases.yaml）缺条目 → fail_closed（伪造删条目形态，spawn 前
  // 拦截）。认证态（HMAC ok / 同进程锚）下 manifest 可信，同况只能是 PASS 后漂移——由
  // diff 'added' 检出并恢复，不误拉 trust 闸。诚实边界：无 HMAC 且文件+条目被一并删除
  // 时历史存在性无从证明，强抗篡改仍须配 HMAC。
  const manifestAuthenticated = manifest.mac === 'ok' || !!expectedAnchor;
  if (!manifestAuthenticated) {
    const featDirForAudit = featureDir(projectRoot, feature);
    for (const rel of rootLevelFrozenCandidateRels(projectRoot, feature, phase)) {
      if (manifestFileRels.has(rel)) continue;
      if (!lstatOrNull(path.join(featDirForAudit, rel))) continue;
      return {
        kind: 'fail_closed',
        reason: `manifest 完整性对账失败：磁盘在场的根级 frozen 产物 ${rel} 无 files 条目（未认证 manifest 疑似伪造删条目——该文件在 watched_roots 之外，缺条目即不参与任何差异判定）`,
      };
    }
  }
  return { kind: 'active', head: head.body, headMac: head.mac as MacVerdict, manifest: manifest.body, manifestMac: manifest.mac, phaseDir };
}

// ---------------------------------------------------------------------------
// 差异判定（modified/added/deleted/link 四类；watched namespace − mutable − derived）
// ---------------------------------------------------------------------------

export interface FrozenDiffEntry {
  rel: string;
  class: 'modified' | 'added' | 'deleted' | 'link';
}

export function diffFrozenAgainstManifest(input: {
  projectRoot: string;
  feature: string;
  phase: string;
  manifest: FrozenManifestBody;
}): FrozenDiffEntry[] {
  const { projectRoot, feature, phase, manifest } = input;
  const featDir = featureDir(projectRoot, feature);
  const known = new Map(manifest.files.map(f => [f.rel, f.sha256]));
  const out: FrozenDiffEntry[] = [];

  for (const [rel, sha] of known) {
    const abs = path.join(featDir, rel);
    const st = lstatOrNull(abs); // lexists 语义：dangling symlink 也可见
    if (!st) {
      out.push({ rel, class: 'deleted' });
      continue;
    }
    if (st.isSymbolicLink()) {
      out.push({ rel, class: 'link' });
      continue;
    }
    if (!st.isFile()) {
      // post-impl round2 P1#5：frozen 文件被换成目录/FIFO 等非常规类型——按结构差异
      // （modified）处理，恢复侧先移除再安装；旧实现直接 readFileSync 抛 EISDIR 崩掉
      // 整个保护链（violation 记不上、恢复不执行、runner uncaught）。
      out.push({ rel, class: 'modified' });
      continue;
    }
    const actual = sha256Buf(fs.readFileSync(abs));
    if (actual !== sha) out.push({ rel, class: 'modified' });
  }

  // added：watched roots 目录清单基线 − mutable − derived = frozen namespace
  for (const root of manifest.watched_roots) {
    const rootAbs = path.join(featDir, root);
    if (!fs.existsSync(rootAbs)) continue;
    const stack = [rootAbs];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        const rel = path.relative(featDir, abs).replace(/\\/g, '/');
        if (ent.isSymbolicLink()) {
          if (classifyPassArtifact(phase, rel) === 'frozen_deliverable') {
            // P1#3（post-impl review）：known link=清单文件被换成链接 → 'link'（恢复原字节）；
            // 新增 link（不在清单）→ 'added'（恢复时删除——旧实现记 'link' 后因查不到
            // manifest SHA 被 continue 静默留存）。
            out.push({ rel, class: known.has(rel) ? 'link' : 'added' });
          }
          continue;
        }
        if (ent.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (known.has(rel)) continue;
        if (classifyPassArtifact(phase, rel) !== 'frozen_deliverable') continue; // mutable/derived 豁免
        out.push({ rel, class: 'added' });
      }
    }
  }

  // round6 P1：added 域补根级候选（三表推导、watched_roots 之外）——known 之外磁盘在场
  // 即 added。合法 manifest 经建侧全集对账必含其条目；不在 known = 伪造删条目（弱信任
  // →restore 拒绝并 halt）或 PASS 后新增（强信任→restore 删除），两况都不得零 diff。
  for (const rel of rootLevelFrozenCandidateRels(projectRoot, feature, phase)) {
    if (known.has(rel)) continue;
    if (!lstatOrNull(path.join(featDir, rel))) continue;
    out.push({ rel, class: 'added' });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// ---------------------------------------------------------------------------
// 恢复（两层信任 + 路径安全）
// ---------------------------------------------------------------------------

export type RestoreTrust =
  | { tier: 'in_process'; memoryDigest: { manifestSha256: string; fileHashes: Record<string, string> } }
  | { tier: 'resume' };

export interface RestoreOutcome {
  restored: string[];
  deletedAdded: string[];
  refused?: string;
}

/**
 * 恢复资格判定 + 执行。拒绝路径返回 refused（调用方 halt 求人），绝不部分恢复弱信任内容。
 * post-impl round3 P0#2：恢复资格以 **pre-spawn 可信上下文（内存副本）** 为依据——
 * 不再从盘上重读 head/manifest 作判定（diff 用快照 A、restore 被换成快照 B 的 TOCTOU）；
 * 仅复核「盘上 head 仍与上下文逐字段一致」（换盘即拒），快照字节在安装时逐一验哈希。
 * - in_process：内存 digest 为锚——manifest sha 须与内存一致（HMAC 无关）。
 * - resume：上下文的 head+manifest MAC 均须 'ok'；ok_unauthenticated → refused。
 */
export function restoreFrozenFromSnapshot(input: {
  projectRoot: string;
  feature: string;
  runId: string;
  phase: string;
  diffs: FrozenDiffEntry[];
  trust: RestoreTrust;
  /** pre-spawn loadTrustedSnapshotContext 的 active 结果（attempt 级不可变上下文） */
  context: Extract<TrustedSnapshotContext, { kind: 'active' }>;
}): RestoreOutcome {
  const { projectRoot, feature, runId, phase, diffs, trust, context } = input;
  // 换盘复核：盘上 head 须与上下文逐字段一致（generation/epoch/manifest_sha/五元组）
  const headNow = readPassSnapshotHead(projectRoot, feature, runId, phase);
  if (!headNow.body) return { restored: [], deletedAdded: [], refused: `盘上 head 消失/损坏（${headNow.mac}）——与 attempt 上下文失配` };
  const c = context.head;
  if (
    headNow.body.state !== c.state ||
    headNow.body.pass_epoch !== c.pass_epoch ||
    headNow.body.generation !== c.generation ||
    headNow.body.manifest_sha256 !== c.manifest_sha256 ||
    headNow.body.project_identity_hash !== c.project_identity_hash ||
    headNow.body.feature !== c.feature ||
    headNow.body.run_id !== c.run_id ||
    headNow.body.phase !== c.phase
  ) {
    return { restored: [], deletedAdded: [], refused: '盘上 head 与 attempt 上下文失配（attempt 中途被换盘）' };
  }
  const phaseDir = context.phaseDir;
  const manifest = { body: context.manifest };

  if (trust.tier === 'in_process') {
    if (trust.memoryDigest.manifestSha256 !== c.manifest_sha256) {
      return { restored: [], deletedAdded: [], refused: '内存 digest 与上下文 manifest 失配（同进程锚被换）' };
    }
  } else {
    if (context.headMac !== 'ok' || context.manifestMac !== 'ok') {
      return {
        restored: [],
        deletedAdded: [],
        refused: `resume 信任层要求 HMAC 验签通过（head=${context.headMac} manifest=${context.manifestMac}）——未配密钥只检测不恢复`,
      };
    }
  }

  const featDir = featureDir(projectRoot, feature);
  const shaByRel = new Map(manifest.body.files.map(f => [f.rel, f.sha256]));
  const restored: string[] = [];
  const deletedAdded: string[] = [];
  for (const d of diffs) {
    const destAbs = path.join(featDir, d.rel);
    assertInsideRoot(destAbs, featDir);
    if (d.class === 'added') {
      // 冻结域内新增替代产物：删除（frozen 域内文件不属任何 mutable 类才会判 added）。
      // post-impl round2 P1#4：existsSync 会跟随链接——dangling symlink 判 false 导致
      // 「宣称删除实际残留」；改 lexists 语义 + rm 后 lstat 复核。
      assertNoLinkInChain(path.dirname(destAbs), featDir);
      fs.rmSync(destAbs, { recursive: true, force: true });
      if (lstatOrNull(destAbs)) {
        return { restored, deletedAdded, refused: `added 项删除失败仍残留：${d.rel}` };
      }
      deletedAdded.push(d.rel);
      continue;
    }
    const sha = shaByRel.get(d.rel);
    if (!sha) {
      // 防御（P1#3 同族）：非 added 分类却查不到清单 SHA——不静默留存，删除后计入清理
      fs.rmSync(destAbs, { recursive: true, force: true });
      if (lstatOrNull(destAbs)) {
        return { restored, deletedAdded, refused: `无清单 SHA 项删除失败仍残留：${d.rel}` };
      }
      deletedAdded.push(d.rel);
      continue;
    }
    const srcAbs = path.join(phaseDir, d.rel.replace(/\//g, '__'));
    if (trust.tier === 'in_process') {
      const memSha = trust.memoryDigest.fileHashes[d.rel];
      if (memSha !== sha) {
        return { restored, deletedAdded, refused: `内存 digest 与 manifest 文件哈希失配：${d.rel}` };
      }
    }
    if (d.class === 'link') {
      // 目标本体是链接：先移除链接本体再恢复（不跟随）
      fs.rmSync(destAbs, { force: true });
    }
    // post-impl round2 P1#5：目标被换成目录等非常规类型——rename 无法覆盖目录，
    // 路径安全验证后先移除再安装
    const destSt = lstatOrNull(destAbs);
    if (destSt && !destSt.isFile()) {
      assertNoLinkInChain(path.dirname(destAbs), featDir);
      fs.rmSync(destAbs, { recursive: true, force: true });
    }
    try {
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      assertNoLinkInChain(path.dirname(destAbs), featDir);
      installBufferAtomic(srcAbs, sha, destAbs);
    } catch (e) {
      // 快照 bytes 被篡改（验哈希失败）/路径链被换 junction → 拒绝并交调用方 halt，
      // 绝不部分安装未验真内容
      return { restored, deletedAdded, refused: `恢复安装失败：${(e as Error).message}` };
    }
    restored.push(d.rel);
  }
  return { restored, deletedAdded };
}

// ---------------------------------------------------------------------------
// run 级 invalidation journal（codex 八轮 P0：唯一事务 pending SSOT）
// ---------------------------------------------------------------------------

export function readInvalidationJournal(projectRoot: string, feature: string, runId: string): {
  body: InvalidationJournalBody | null;
  mac: MacVerdict | 'absent';
} {
  const p = invalidationJournalPath(projectRoot, feature, runId);
  if (!fs.existsSync(p)) return { body: null, mac: 'absent' };
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as InvalidationJournalBody & { mac?: unknown };
    const { mac, ...body } = doc;
    if (body.kind !== 'pass_snapshot_invalidation' || body.schema_version !== '1.0') {
      return { body: null, mac: 'invalid' };
    }
    if (!isValidJournalShape(body as unknown as Record<string, unknown>)) {
      return { body: null, mac: 'invalid' };
    }
    return { body: body as InvalidationJournalBody, mac: verifyMac(body, mac) };
  } catch {
    return { body: null, mac: 'invalid' };
  }
}

function writeJournal(projectRoot: string, feature: string, runId: string, body: InvalidationJournalBody): void {
  writeJsonAtomic(invalidationJournalPath(projectRoot, feature, runId), { ...body, mac: macFor(body) });
}

export interface InvalidationTxResult {
  txId: string;
  /** 事件层按 (tx_id, phase) 幂等追加——调用方据此补 phase_invalidated 事件投影 */
  invalidatedPhases: string[];
}

/**
 * 失效事务：journal pending → 全部受影响 head 置 superseded → （调用方追加事件）→ commit。
 * 崩溃窗恢复：resume 先 recoverInvalidationJournal 再读任何 head。
 */
export function beginInvalidationTx(input: {
  projectRoot: string;
  feature: string;
  runId: string;
  causePhase: string;
  invalidatedPhases: string[];
  txId: string;
}): InvalidationTxResult {
  const { projectRoot, feature, runId, causePhase, invalidatedPhases, txId } = input;
  const oldHashes: Record<string, string | null> = {};
  const targetGen: Record<string, number> = {};
  for (const ph of invalidatedPhases) {
    const h = readPassSnapshotHead(projectRoot, feature, runId, ph);
    oldHashes[ph] = h.body ? h.body.manifest_sha256 : null;
    targetGen[ph] = (h.body?.generation ?? 0) + 1;
  }
  writeJournal(projectRoot, feature, runId, {
    kind: 'pass_snapshot_invalidation',
    schema_version: '1.0',
    project_identity_hash: projectIdentityHash(projectRoot),
    feature,
    run_id: runId,
    tx_id: txId,
    state: 'pending',
    cause_phase: causePhase,
    invalidated_phases: invalidatedPhases,
    old_head_hashes: oldHashes,
    target_generations: targetGen,
  });
  applyInvalidationHeads(projectRoot, feature, runId, invalidatedPhases, targetGen);
  return { txId, invalidatedPhases };
}

function applyInvalidationHeads(
  projectRoot: string,
  feature: string,
  runId: string,
  phases: string[],
  targetGen: Record<string, number>,
): void {
  for (const ph of phases) {
    const h = readPassSnapshotHead(projectRoot, feature, runId, ph);
    if (!h.body) continue; // 无 PASS head 的 phase：合法（cause phase 可能从未 PASS）
    if (h.body.state === 'superseded' && h.body.generation >= (targetGen[ph] ?? 0)) continue; // 幂等
    const next: PassSnapshotHeadBody = {
      ...h.body,
      state: 'superseded',
      generation: Math.max(h.body.generation + 1, targetGen[ph] ?? 0),
    };
    writeJsonAtomic(passSnapshotHeadPath(projectRoot, feature, runId, ph), { ...next, mac: macFor(next) });
  }
}

/**
 * post-impl round2 P0#1 + round3 P0#3：commit 不得重新信任磁盘 body（洗白通道）；
 * **完成态=journal 文件不存在**——先写 committed（供「commit 后删除前崩溃」的
 * authenticated 清理路径识别），再原子移除。round3 病灶：无 HMAC 环境 mac=null，
 * 「pending 被篡改成 committed」若被当完成态忽略，未竟 heads/events 永不恢复——改用
 * 删除语义后，unauth 面上任何**在场** journal 一律 fail-closed 交人工。
 */
export function commitInvalidationTx(
  projectRoot: string,
  feature: string,
  runId: string,
  expectedTxId: string,
  // round4 P1#2：崩溃窗故障注入点（仅测试消费）——模拟「committed 已写盘、rm 前崩溃」，
  // 使 recover 的 authenticated 残留清理分支可被真实命中（合法 MAC 的 committed 残留）。
  opts?: { crashBeforeRemoveForTest?: boolean },
): void {
  const p = invalidationJournalPath(projectRoot, feature, runId);
  const j = readInvalidationJournal(projectRoot, feature, runId);
  if (!j.body) {
    if (j.mac === 'absent') return; // 已完成（幂等——完成态=不存在）
    throw new Error(`[pass-snapshot] commit 失败：journal 损坏（expected tx=${expectedTxId}）`);
  }
  if (j.mac === 'invalid') {
    throw new Error(`[pass-snapshot] commit 拒绝：journal MAC 无效——不得重签洗白（expected tx=${expectedTxId}）`);
  }
  if (j.body.tx_id !== expectedTxId) {
    throw new Error(`[pass-snapshot] commit 拒绝：journal tx_id=${j.body.tx_id} 与预期 ${expectedTxId} 失配`);
  }
  writeJournal(projectRoot, feature, runId, { ...j.body, state: 'committed' });
  if (opts?.crashBeforeRemoveForTest) return; // 故障注入：崩溃于 rm 之前
  fs.rmSync(p, { force: true });
}

export type JournalRecovery =
  | { kind: 'none' }
  | { kind: 'pending_heads_applied'; txId: string; invalidatedPhases: string[] }
  | { kind: 'fail_closed'; reason: string };

/**
 * resume/启动恢复：**先于任何 head 读取**调用。pending → 续跑 head 更新并返回待补事件，
 * **不在此 commit**（post-impl review P0#1：恢复顺序必须与正常路径同构 pending → heads →
 * events → commit——若本函数先 commit，「commit 后、事件补齐前」二次崩溃会让缺失事件
 * 永久不可修复：下次 resume 见 committed 直接 none）。调用方幂等补完 phase_invalidated
 * 事件后 **必须** 调 commitInvalidationTx()。head 更新幂等，重复恢复安全。
 * journal 不可验证（authenticated 环境下坏 MAC/损坏）→ fail_closed（不得改任何 head）。
 * 未配 HMAC（ok_unauthenticated）：journal 出自弱信任面——同样 fail_closed 交人工，
 * 不得依据不可信 journal 改 head（codex 九轮 P1；同进程路径不经此函数）。
 */
export function recoverInvalidationJournal(projectRoot: string, feature: string, runId: string): JournalRecovery {
  const j = readInvalidationJournal(projectRoot, feature, runId);
  if (j.mac === 'absent' || !j.body) {
    return j.mac === 'invalid'
      ? { kind: 'fail_closed', reason: 'invalidation journal 损坏/跨协议/验签失败' }
      : { kind: 'none' };
  }
  // post-impl round2 P0#1 + round3 P0#3：**MAC/绑定先于 state**，且完成态=文件不存在。
  // state 是攻击者可写字段：坏 MAC 或（unauth 面）无 MAC 的 committed 都不得被当完成态
  // 忽略——unauth 环境下任何**在场** journal 一律 fail-closed 交人工（正常完成路径已
  // 原子移除文件，不会走到这里）。
  if (j.mac === 'invalid') {
    return { kind: 'fail_closed', reason: 'invalidation journal MAC 无效——不论 state 一律不信' };
  }
  if (
    j.body.project_identity_hash !== projectIdentityHash(projectRoot) ||
    j.body.feature !== feature ||
    j.body.run_id !== runId
  ) {
    return { kind: 'fail_closed', reason: 'invalidation journal 上下文绑定失配（跨 project/feature/run 重放）' };
  }
  if (j.mac !== 'ok') {
    return {
      kind: 'fail_closed',
      reason: `invalidation journal 在场但信任不足（mac=${j.mac}，state=${j.body.state}）——完成态应为文件不存在，任何在场弱信任 journal 交人工`,
    };
  }
  if (j.body.state === 'committed') {
    // authenticated 清理路径：commit 写盘后、删除前崩溃——验签通过的 committed 残留
    // 安全清除，完成态收敛到「不存在」。
    fs.rmSync(invalidationJournalPath(projectRoot, feature, runId), { force: true });
    return { kind: 'none' };
  }
  applyInvalidationHeads(projectRoot, feature, runId, j.body.invalidated_phases, j.body.target_generations);
  return { kind: 'pending_heads_applied', txId: j.body.tx_id, invalidatedPhases: j.body.invalidated_phases };
}
