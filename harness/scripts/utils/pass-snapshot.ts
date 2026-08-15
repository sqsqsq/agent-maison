// ============================================================================
// pass-snapshot.ts — PASS 态冻结：artifact-class resolver / 可丢弃的缓存快照
// （plan 7c4f2e9b P0-3，OpenSpec change cc-spec-deadlock-hardening）
// ============================================================================
// 事故根因：spec-i2 harness 全门禁 PASS 仅因 agent_timeout_unclosed 被整轮重试，i3 冷启动
// 重写毁掉 PASS 产物且不可恢复。本模块提供：
//   1) artifact-class resolver（四类，唯一纯函数，快照/差异/加载三处共同消费）；
//   2) runner-owned 快照存储：不可变 pass_snapshot_manifest（文件清单+逐文件哈希，历史
//      永不重写）+ 可变 pass_snapshot_head（仅 active/superseded 两态）；它只是可丢弃的
//      内容缓存，不是授权、回退或恢复来源；
//   3) 失效事件落盘后，缓存可安全丢弃并由责任阶段重新生成；旧 journal 仅作为遗留磁盘
//      垃圾，不再参与运行决策；
//   4) 缓存读写仍逐级 lstat 拒 symlink/junction、realpath 域内、原子写。
// 任何缓存缺失、损坏或上下文失配都归为 cache miss；恢复旧字节的路径已删除，生产流程
// 必须重新通过完整门禁后再产生新快照。
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
import { artifactReadCandidatePaths, featureDir, featureFilePath, resolveFeatureArtifact } from '../../config';
import {
  PHASE_OUTPUT_FILES_BY_PHASE,
  PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE,
  PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE,
} from './phase-evidence-manifest';
import type { Phase } from './types';

// ---------------------------------------------------------------------------
// trust-state 根（与 goal-runner.visionTrustDir 同一约定——泛化为共享导出；
// MAISON_GOAL_CHECKPOINT_DIR 覆盖、该 env 已由 agent-invoke 从 agent 子进程剥离）
// ---------------------------------------------------------------------------

/**
 * plan b3e8d4c7 t4：**scope 内存锚的跨进程载体**（`<phase>:<epoch>:<manifestSha256>`）。
 *
 * `loadTrustedSnapshotContext` 早就有内存锚防线（expectedAnchor：盘上任何消失/退位/换代
 * 都判篡改），但 ui-scope-gate 跑在 runner spawn 的 gate harness **子进程**里，拿不到
 * runner 的内存，于是一直传 null——防线整个关掉。宿主实锤（run 20260804T033834Z-99c0a1）：
 * agent 自调 takePassSnapshot 造出 epoch 2 / mac:null 的 head，scope 门禁照单全收，
 * 越界文件被自我授权。
 *
 * **只注入 gate harness，不进 agent env**——信任材料不下发（与 GATE_HARNESS 同款口径）。
 * 缺 env 时消费方退回 null（非 goal / 人工跑 harness 的既有行为不变）。
 */
export const PASS_SNAPSHOT_ANCHOR_ENV = 'MAISON_GOAL_SCOPE_ANCHOR';

export function formatSnapshotAnchorEnv(
  phase: string,
  anchor: { epoch: number; manifestSha256: string },
): string {
  return `${phase}:${anchor.epoch}:${anchor.manifestSha256}`;
}

/**
 * 解析 scope 锚 env。
 *
 * **必须区分"不存在"与"损坏"（codex 复核 P1）**：初版把两者都返回 null，于是 env 传播
 * 出错/被截断时不是 fail-closed，而是**退回相信盘上的 head**——本仓已多次实锤环境变量
 * 传播缺失，这不是理论问题。
 *   · `absent`：非 goal / 人工跑 harness → 消费方按既有 resume 策略处理；
 *   · `invalid`：env 在场但形状/phase 不符 → 消费方**直接 FAIL**，不得降级为弱快照。
 */
export type SnapshotAnchorParse =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; anchor: { epoch: number; manifestSha256: string } };

export function parseSnapshotAnchorEnv(
  raw: string | undefined,
  expectedPhase: string,
): SnapshotAnchorParse {
  const text = (raw ?? '').trim();
  if (!text) return { kind: 'absent' };
  const parts = text.split(':');
  if (parts.length !== 3) return { kind: 'invalid', reason: `期望 <phase>:<epoch>:<sha256>，实得 ${parts.length} 段` };
  const [phase, epochRaw, manifestSha256] = parts;
  if (phase !== expectedPhase) {
    return { kind: 'invalid', reason: `锚 phase=${phase} 与消费方 ${expectedPhase} 不符` };
  }
  const epoch = Number(epochRaw);
  if (!Number.isInteger(epoch) || epoch <= 0) return { kind: 'invalid', reason: `epoch 非法：${epochRaw}` };
  if (!/^[0-9a-f]{64}$/.test(manifestSha256)) return { kind: 'invalid', reason: 'manifest sha256 形状非法' };
  return { kind: 'ok', anchor: { epoch, manifestSha256 } };
}

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

/** 快照命名空间：<trust>/<projectHash>/<feature>/<runId>/pass-snapshots/…。 */
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

/**
 * Return the next immutable cache epoch.  The head is only an active pointer;
 * after a cache miss it may be absent or malformed while the old epoch
 * directory remains on disk, so choosing `head.pass_epoch + 1` is not safe.
 */
export function nextPassSnapshotEpoch(
  projectRoot: string,
  feature: string,
  runId: string,
  phase: string,
): number {
  const phaseDir = path.join(passSnapshotRunDir(projectRoot, feature, runId), phase);
  let maxEpoch = 0;
  if (!fs.existsSync(phaseDir)) return 1;
  for (const entry of fs.readdirSync(phaseDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const epoch = Number(entry.name);
    if (Number.isSafeInteger(epoch) && epoch > maxEpoch) maxEpoch = epoch;
  }
  return maxEpoch + 1;
}

/** coding 基线锚（c4e8b1d3 G1-1）：与 pass-snapshots 同 run 命名空间的兄弟文件。 */
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
// per-run 场外状态回收（b7e4d2a9 Todo2）：场外数据 = 活跃/可恢复 run 的临时恢复区，
// 成功封卷或明确 supersede 即删。逻辑删除单元 = 同 runId 的目录
// （<feature>/<runId>/，含 pass-snapshots/invalidation/coding-base）。
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
  /** head 仅两态；失效事实由事件日志承载，head 退位是可重复副作用。 */
  state: 'active' | 'superseded';
  pass_epoch: number;
  generation: number;
  manifest_sha256: string;
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
  // ---------------------------------------------------------------------------
  // 环 A（plan f3a8c6d2 t2）：建侧与验侧**集合等价**——本扫描域与
  // diffFrozenAgainstManifest 的 added 域逐条同构（watched_roots 目录树 +
  // classifyPassArtifact 兜底），注册表退化为"必需项存在性校验"。
  //
  // 事故（bc-openCard run 20260808T071335Z-4b0136）：建侧只认三张注册表、验侧遍历
  // 目录并用 classifyPassArtifact（**黑名单兜底、默认 frozen_deliverable**）判定，
  // 于是 agent 每阶段必写的 `<phase>/context-exploration.md`（三表皆无）恒判 added
  // ——重建快照仍不收它，结构上不可能收敛，plan 阶段两轮 closure_wall 直接 TERMINAL。
  //
  // 修法**不是**把该文件移出冻结面：它是 agent 写入且参与阶段验真的研究证据，既非
  // closure/control-plane 也非 derived，豁免等于允许 closure-only 阶段篡改 PASS 依据。
  // 同源扫描后它在建快照时自然进入冻结清单，误报自消，且"快照后才新增"仍判 added。
  // ---------------------------------------------------------------------------
  for (const root of watchedRootsForPhase(phase)) {
    const rootAbs = path.join(featDir, root);
    if (!fs.existsSync(rootAbs)) continue;
    const stack = [rootAbs];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        if (ent.isSymbolicLink()) {
          // 与验侧对称（diff 把 frozen symlink 判 link/added=违规）：frozen 面上的
          // 链接一律 fail-closed，不入快照也不静默跳过；非 frozen 类照常豁免。
          const rel = path.relative(featDir, abs).replace(/\\/g, '/');
          if (classifyPassArtifact(phase, rel) === 'frozen_deliverable') {
            assertNoLinkInChain(abs, featDir);
          }
          continue;
        }
        if (ent.isDirectory()) {
          stack.push(abs);
          continue;
        }
        push(abs);
      }
    }
  }
  // 注册表三张表：根级产物（acceptance.yaml / contracts.yaml / use-cases.yaml 等落
  // feature 根、不在 watched_roots 目录域内）的唯一入口——与验侧 added 域的
  // rootLevelFrozenCandidateRels 同源；phase 内条目已被上面的目录扫描收全，此处按
  // rel 去重不会重复。
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
 * 目录域内，manifest.files 是其唯一差异判定入口；完整性对账据此表在建快照与缓存加载两端
 * 同构执行。缓存缺条目即丢弃重跑，不把它升级为凭据或人工门禁。 */
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
 * 诚实边界：可选文件与其 manifest 条目若在 resume 前被**一并**删除，历史存在性无从
 * 证明；这属于内容缓存能力边界，完整门禁会在缓存失效后重跑责任阶段，不引入凭据机制。 */
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
// 快照建立 / head
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
  writeJsonAtomic(path.join(phaseDir, 'manifest.json'), manifest);
  const manifestSha256 = sha256Buf(Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

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
  writeJsonAtomic(passSnapshotHeadPath(projectRoot, feature, runId, phase), head);

  const fileHashes: Record<string, string> = {};
  for (const f of files) fileHashes[f.rel] = f.sha256;
  return { manifest, manifestSha256, head, phaseDir, memoryDigest: { manifestSha256, fileHashes } };
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

export interface HeadReadResult {
  body: PassSnapshotHeadBody | null;
  status: 'ok' | 'invalid' | 'absent';
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

export function readPassSnapshotHead(projectRoot: string, feature: string, runId: string, phase: string): HeadReadResult {
  const p = passSnapshotHeadPath(projectRoot, feature, runId, phase);
  if (!fs.existsSync(p)) return { body: null, status: 'absent' };
  try {
    const body = JSON.parse(fs.readFileSync(p, 'utf-8')) as PassSnapshotHeadBody;
    if (body.kind !== 'pass_snapshot_head' || body.schema_version !== '1.0') {
      return { body: null, status: 'invalid' }; // 跨协议互塞 → invalid
    }
    if (!isValidHeadShape(body as unknown as Record<string, unknown>)) {
      return { body: null, status: 'invalid' };
    }
    if (
      body.project_identity_hash !== projectIdentityHash(projectRoot) ||
      body.feature !== feature ||
      body.run_id !== runId ||
      body.phase !== phase
    ) {
      return { body: null, status: 'invalid' };
    }
    return { body: body as PassSnapshotHeadBody, status: 'ok' };
  } catch {
    return { body: null, status: 'invalid' };
  }
}

export function readFrozenManifest(phaseDir: string): { body: FrozenManifestBody | null; status: 'ok' | 'invalid' } {
  const p = path.join(phaseDir, 'manifest.json');
  if (!fs.existsSync(p)) return { body: null, status: 'invalid' };
  try {
    const body = JSON.parse(fs.readFileSync(p, 'utf-8')) as FrozenManifestBody;
    if (body.kind !== 'pass_snapshot_manifest' || body.schema_version !== '1.0') {
      return { body: null, status: 'invalid' };
    }
    if (!isValidManifestShape(body as unknown as Record<string, unknown>)) {
      return { body: null, status: 'invalid' };
    }
    return { body: body as FrozenManifestBody, status: 'ok' };
  } catch {
    return { body: null, status: 'invalid' };
  }
}

/** 读取快照内存储的 frozen 文件字节（存储名 = rel 的 `/`→`__`），并验哈希。
 * 缺失/哈希不符 → null（调用方 fail-closed）。 */
export function readFrozenSnapshotFile(phaseDir: string, rel: string, expectedSha256: string): Buffer | null {
  const stored = path.join(phaseDir, rel.replace(/\//g, '__'));
  if (!fs.existsSync(stored)) return null;
  try {
    const buf = fs.readFileSync(stored);
    if (sha256Buf(buf) !== expectedSha256) return null;
    return buf;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 统一快照加载——**spawn agent 之前**调用一次，整个 attempt 复用返回值（内存副本，防
// "attempt 中途盘上换 manifest"）。shape/上下文/head↔manifest 失配只表示缓存不可用，
// 调用方必须丢缓存并重跑责任阶段，不得用它恢复旧字节或停放求人。
// ---------------------------------------------------------------------------

export type TrustedSnapshotContext =
  | { kind: 'none' }
  | { kind: 'inactive' }
  | {
      kind: 'active';
      head: PassSnapshotHeadBody;
      manifest: FrozenManifestBody;
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
  if (!head.body) {
    if (expectedAnchor) {
      return { kind: 'fail_closed', reason: '同进程内存锚在场但盘上 head 消失——缓存失效' };
    }
    return head.status === 'invalid'
      ? { kind: 'fail_closed', reason: 'head 缺失/损坏/上下文不匹配——缓存失效' }
      : { kind: 'none' };
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
  if (!manifest.body || manifest.status === 'invalid') {
    return { kind: 'fail_closed', reason: 'head active 但 manifest 缺失/损坏/shape 非法——缓存失效' };
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
  return { kind: 'active', head: head.body, manifest: manifest.body, phaseDir };
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
      // （modified）处理；旧实现直接 readFileSync 抛 EISDIR 会让诊断链 uncaught。
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
            // P1#3（post-impl review）：known link=清单文件被换成链接 → 'link'；
            // 新增 link（不在清单）→ 'added'，两者都必须进入差异结果。
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
  // →缓存失效并重跑）或 PASS 后新增，两况都不得零 diff。
  for (const rel of rootLevelFrozenCandidateRels(projectRoot, feature, phase)) {
    if (known.has(rel)) continue;
    if (!lstatOrNull(path.join(featDir, rel))) continue;
    out.push({ rel, class: 'added' });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// ---------------------------------------------------------------------------
// 缓存丢弃（事件已落盘后可重复执行；不恢复旧字节）
// ---------------------------------------------------------------------------

export interface PassSnapshotDiscardResult {
  discardedPhases: string[];
  diagnostics: string[];
}

/**
 * 将受失效事件覆盖的 head 退位为 superseded。该动作只影响缓存，不改变事件事实；
 * 即使进程在事件落盘后、缓存退位前崩溃，resume 仍会重放这条记录并再次执行本函数。
 * 损坏的 head 直接删除；任何磁盘故障只记录诊断，由调用方按基础设施故障处置。
 */
export function discardPassSnapshotCache(input: {
  projectRoot: string;
  feature: string;
  runId: string;
  phases: readonly string[];
}): PassSnapshotDiscardResult {
  const discardedPhases: string[] = [];
  const diagnostics: string[] = [];
  for (const phase of [...new Set(input.phases.map(String))]) {
    const headPath = passSnapshotHeadPath(input.projectRoot, input.feature, input.runId, phase);
    const head = readPassSnapshotHead(input.projectRoot, input.feature, input.runId, phase);
    try {
      if (head.body) {
        if (head.body.state !== 'superseded') {
          writeJsonAtomic(headPath, {
            ...head.body,
            state: 'superseded',
            generation: head.body.generation + 1,
          } satisfies PassSnapshotHeadBody);
        }
        discardedPhases.push(phase);
      } else if (head.status === 'invalid') {
        fs.rmSync(headPath, { force: true });
        discardedPhases.push(phase);
      }
    } catch (e) {
      diagnostics.push(`${phase}: ${(e as Error).message}`);
    }
  }
  return { discardedPhases, diagnostics };
}
