// ============================================================================
// pass-snapshot.unit.test.ts — P0-3（plan 7c4f2e9b）
// artifact-class / 快照双协议域 / 两层信任恢复 / invalidation journal / 路径安全
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertNoLinkInChain,
  beginInvalidationTx,
  classifyPassArtifact,
  commitInvalidationTx,
  diffFrozenAgainstManifest,
  invalidationJournalPath,
  passSnapshotHeadPath,
  passSnapshotPhaseDir,
  readFrozenManifest,
  readInvalidationJournal,
  readPassSnapshotHead,
  recoverInvalidationJournal,
  loadTrustedSnapshotContext,
  resolveFrozenDeliverables,
  restoreFrozenFromSnapshot,
  sha256Buf,
  takePassSnapshot,
  PASS_SNAPSHOT_HMAC_ENV,
} from '../../scripts/utils/pass-snapshot';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FEATURE = 'bc-fixture';
const RUN = '20260101T000000Z';

interface Env {
  root: string;
  featDir: string;
  restore: () => void;
}

function setupEnv(withHmac: boolean): Env {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-snap-'));
  const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  const prevKey = process.env[PASS_SNAPSHOT_HMAC_ENV];
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust');
  if (withHmac) process.env[PASS_SNAPSHOT_HMAC_ENV] = 'unit-test-key';
  else delete process.env[PASS_SNAPSHOT_HMAC_ENV];
  const featDir = path.join(root, 'doc', 'features', FEATURE);
  fs.mkdirSync(path.join(featDir, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(featDir, 'spec', 'spec.md'), '# spec v1\n', 'utf-8');
  fs.writeFileSync(path.join(featDir, 'spec', 'ui-spec.yaml'), 'schema_version: "1.0"\n', 'utf-8');
  fs.writeFileSync(path.join(featDir, 'spec', 'ref-elements.yaml'), 'elements: []\n', 'utf-8');
  // round5 P0：根级契约（watched_roots 之外，manifest files 是唯一差异入口）——真实
  // spec PASS 形态必含；缺席时 takePassSnapshot 现在会按不变量违例拒建
  fs.writeFileSync(path.join(featDir, 'acceptance.yaml'), 'criteria: []\n', 'utf-8');
  // round6 P1：根级 optional 产物（PHASE_OPTIONAL_OUTPUT_FILES，非 phase-scoped 落根）
  // ——磁盘在场即须入 manifest（建侧全集对账），伪造删条目由弱信任载侧+diff added 双拦
  fs.writeFileSync(path.join(featDir, 'use-cases.yaml'), 'use_cases: []\n', 'utf-8');
  return {
    root,
    featDir,
    restore: () => {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
      else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env[PASS_SNAPSHOT_HMAC_ENV];
      else process.env[PASS_SNAPSHOT_HMAC_ENV] = prevKey;
    },
  };
}

function take(env: Env) {
  const frozen = resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'spec' });
  return takePassSnapshot({
    projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
    epoch: 1, files: frozen,
  });
}

function diffs(env: Env) {
  const head = readPassSnapshotHead(env.root, FEATURE, RUN, 'spec');
  const m = readFrozenManifest(passSnapshotPhaseDir(env.root, FEATURE, RUN, 'spec', head.body!.pass_epoch));
  return diffFrozenAgainstManifest({ projectRoot: env.root, feature: FEATURE, phase: 'spec', manifest: m.body! });
}

/** round5 P0：一致性伪造——manifest 改写后同步换 head.manifest_sha256（弱信任下两文件
 * 均可被一致伪造，sha 绑定不构成防线；用于验证完整性对账是最后一道拦截） */
function forgeManifestConsistently(env: Env, phase: string, epoch: number, mutate: (doc: Record<string, unknown>) => void): void {
  const mPath = path.join(passSnapshotPhaseDir(env.root, FEATURE, RUN, phase, epoch), 'manifest.json');
  const doc = JSON.parse(fs.readFileSync(mPath, 'utf-8')) as Record<string, unknown>;
  mutate(doc);
  const raw = JSON.stringify(doc, null, 2);
  fs.writeFileSync(mPath, raw);
  const hPath = passSnapshotHeadPath(env.root, FEATURE, RUN, phase);
  const hDoc = JSON.parse(fs.readFileSync(hPath, 'utf-8')) as Record<string, unknown>;
  hDoc.manifest_sha256 = sha256Buf(Buffer.from(raw, 'utf-8'));
  fs.writeFileSync(hPath, JSON.stringify(hDoc, null, 2));
}

/** round3 P0#2：restore 以 attempt 级可信上下文为依据——测试统一经 loader 取 active 上下文 */
function ctx(env: Env) {
  const c = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
  if (c.kind !== 'active') throw new Error(`测试前置：上下文应 active，得 ${JSON.stringify(c)}`);
  return c;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'classify: receipt/账本=mutable_closure；控制面逐一登记；reports=derived；产物=frozen',
    run: () => {
      if (classifyPassArtifact('spec', 'spec/phase-completion-receipt.md') !== 'mutable_closure') throw new Error('receipt');
      if (classifyPassArtifact('spec', 'spec/headless-assumptions.jsonl') !== 'mutable_closure') throw new Error('ledger');
      if (classifyPassArtifact('spec', 'spec/fidelity-downgrade.receipt.json') !== 'mutable_control_plane') throw new Error('fidelity receipt');
      if (classifyPassArtifact('spec', 'spec/crop-provenance/logo.receipt.json') !== 'mutable_control_plane') throw new Error('crop receipt');
      if (classifyPassArtifact('spec', 'vision/capability-receipt.json') !== 'mutable_control_plane') throw new Error('capability receipt');
      if (classifyPassArtifact('spec', 'vision/artifact-attestations.jsonl') !== 'mutable_control_plane') throw new Error('attestation ledger');
      if (classifyPassArtifact('spec', 'spec/reports/summary.json') !== 'derived') throw new Error('reports');
      if (classifyPassArtifact('spec', 'spec/phase-evidence-manifest.json') !== 'derived') throw new Error('evidence manifest');
      if (classifyPassArtifact('spec', 'spec/ui-spec.yaml') !== 'frozen_deliverable') throw new Error('ui-spec');
      // 通配禁令：随便一个 .receipt.json 不入控制面
      if (classifyPassArtifact('spec', 'spec/fake.receipt.json') === 'mutable_control_plane') throw new Error('通配泄漏');
    },
  },
  {
    name: 'snapshot: PASS 冻结→manifest/head 落盘、六元组绑定、head active gen1',
    run: () => {
      const env = setupEnv(false);
      try {
        const taken = take(env);
        if (taken.manifest.kind !== 'pass_snapshot_manifest') throw new Error('manifest kind');
        for (const k of ['project_identity_hash', 'feature', 'run_id', 'phase', 'pass_epoch'] as const) {
          if (taken.manifest[k] === undefined) throw new Error(`manifest 缺 ${k}`);
        }
        const head = readPassSnapshotHead(env.root, FEATURE, RUN, 'spec');
        if (head.body?.state !== 'active' || head.body.generation !== 1) throw new Error(`head=${JSON.stringify(head.body)}`);
        if (head.mac !== 'ok_unauthenticated') throw new Error(`未配密钥应 ok_unauthenticated，得 ${head.mac}`);
        if (taken.manifest.files.length < 3) throw new Error('frozen 清单缺产物');
      } finally { env.restore(); }
    },
  },
  {
    name: 'diff: modified/added/deleted/link 四类 + 控制面新增豁免',
    run: () => {
      const env = setupEnv(false);
      try {
        take(env);
        fs.writeFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'schema_version: "1.0"\n# tampered\n');
        fs.writeFileSync(path.join(env.featDir, 'spec', 'stray-replacement.yaml'), 'x: 1\n');
        fs.rmSync(path.join(env.featDir, 'spec', 'ref-elements.yaml'));
        fs.mkdirSync(path.join(env.featDir, 'vision'), { recursive: true });
        fs.writeFileSync(path.join(env.featDir, 'vision', 'capability-receipt.json'), '{}');
        fs.writeFileSync(path.join(env.featDir, 'spec', 'phase-completion-receipt.md'), 'closure ok');
        const d = diffs(env);
        const byClass = (c: string) => d.filter(x => x.class === c).map(x => x.rel);
        if (!byClass('modified').includes('spec/ui-spec.yaml')) throw new Error('modified 未检出');
        if (!byClass('added').includes('spec/stray-replacement.yaml')) throw new Error('added 未检出');
        if (!byClass('deleted').includes('spec/ref-elements.yaml')) throw new Error('deleted 未检出');
        if (d.some(x => x.rel.includes('capability-receipt') || x.rel.includes('phase-completion-receipt'))) {
          throw new Error('mutable 类被误判');
        }
      } finally { env.restore(); }
    },
  },
  {
    name: 'restore: 无 HMAC+同进程（内存 digest）→ 恢复成功且 added 被清',
    run: () => {
      const env = setupEnv(false);
      try {
        const taken = take(env);
        fs.writeFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'broken\n');
        fs.writeFileSync(path.join(env.featDir, 'spec', 'stray.yaml'), 'x\n');
        const out = restoreFrozenFromSnapshot({
          projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
          diffs: diffs(env), trust: { tier: 'in_process', memoryDigest: taken.memoryDigest },
          context: ctx(env),
        });
        if (out.refused) throw new Error(`refused=${out.refused}`);
        const restored = fs.readFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'utf-8');
        if (!restored.startsWith('schema_version')) throw new Error('字节未恢复');
        if (fs.existsSync(path.join(env.featDir, 'spec', 'stray.yaml'))) throw new Error('added 未清');
      } finally { env.restore(); }
    },
  },
  {
    name: 'restore: 无 HMAC+resume → 只拒绝不恢复（弱信任不覆盖用户文件）',
    run: () => {
      const env = setupEnv(false);
      try {
        take(env);
        fs.writeFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'broken\n');
        const out = restoreFrozenFromSnapshot({
          projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
          diffs: diffs(env), trust: { tier: 'resume' },
          context: ctx(env),
        });
        if (!out.refused) throw new Error('resume 无 HMAC 应拒绝');
        if (fs.readFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'utf-8') !== 'broken\n') {
          throw new Error('拒绝时不得动用户文件');
        }
      } finally { env.restore(); }
    },
  },
  {
    name: 'restore: 配 HMAC+resume → 验签通过恢复',
    run: () => {
      const env = setupEnv(true);
      try {
        take(env);
        fs.writeFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'broken\n');
        const out = restoreFrozenFromSnapshot({
          projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
          diffs: diffs(env), trust: { tier: 'resume' },
          context: ctx(env),
        });
        if (out.refused) throw new Error(`refused=${out.refused}`);
        if (!fs.readFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'utf-8').startsWith('schema_version')) {
          throw new Error('未恢复');
        }
      } finally { env.restore(); }
    },
  },
  {
    name: 'restore: 快照 bytes 被篡改 → refused 不安装（TOCTOU 单 buffer 验证）',
    run: () => {
      const env = setupEnv(true);
      try {
        const taken = take(env);
        fs.writeFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'broken\n');
        // 篡改快照文件本体
        const snapFile = path.join(taken.phaseDir, 'spec__ui-spec.yaml');
        fs.writeFileSync(snapFile, 'evil-bytes\n');
        const out = restoreFrozenFromSnapshot({
          projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
          diffs: diffs(env), trust: { tier: 'in_process', memoryDigest: taken.memoryDigest },
          context: ctx(env),
        });
        if (!out.refused) throw new Error('篡改快照应拒绝');
        if (fs.readFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'utf-8') !== 'broken\n') {
          throw new Error('不得安装未验真内容');
        }
      } finally { env.restore(); }
    },
  },
  {
    name: 'restore: head superseded（旧 epoch MAC 合法）→ 拒绝重放',
    run: () => {
      const env = setupEnv(true);
      try {
        take(env);
        // round3 P0#2：上下文在 supersede 前捕获（attempt 级不可变）——恢复时盘上 head
        // 已退位，disk-vs-context 复核必须拒
        const staleCtx = ctx(env);
        beginInvalidationTx({
          projectRoot: env.root, feature: FEATURE, runId: RUN,
          causePhase: 'testing', invalidatedPhases: ['spec'], txId: 'tx-replay',
        });
        commitInvalidationTx(env.root, FEATURE, RUN, 'tx-replay');
        fs.writeFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'broken\n');
        const head = readPassSnapshotHead(env.root, FEATURE, RUN, 'spec');
        if (head.body?.state !== 'superseded') throw new Error('head 应 superseded');
        const m = readFrozenManifest(passSnapshotPhaseDir(env.root, FEATURE, RUN, 'spec', 1));
        const d = diffFrozenAgainstManifest({ projectRoot: env.root, feature: FEATURE, phase: 'spec', manifest: m.body! });
        const out = restoreFrozenFromSnapshot({
          projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
          diffs: d, trust: { tier: 'resume' },
          context: staleCtx,
        });
        if (!out.refused || !/失配|superseded/.test(out.refused)) throw new Error(`应拒重放：${out.refused}`);
      } finally { env.restore(); }
    },
  },
  {
    name: '跨协议替换: vision-checkpoint 形态文档塞 head/journal 位置 → invalid',
    run: () => {
      const env = setupEnv(true);
      try {
        take(env);
        const alien = JSON.stringify({ kind: 'vision_checkpoint', schema_version: '1.2', mac: 'x'.repeat(64) });
        fs.writeFileSync(passSnapshotHeadPath(env.root, FEATURE, RUN, 'spec'), alien);
        const head = readPassSnapshotHead(env.root, FEATURE, RUN, 'spec');
        if (head.body !== null || head.mac !== 'invalid') throw new Error(`head 应 invalid：${head.mac}`);
        fs.writeFileSync(invalidationJournalPath(env.root, FEATURE, RUN), alien);
        const j = readInvalidationJournal(env.root, FEATURE, RUN);
        if (j.body !== null || j.mac !== 'invalid') throw new Error(`journal 应 invalid：${j.mac}`);
        const rec = recoverInvalidationJournal(env.root, FEATURE, RUN);
        if (rec.kind !== 'fail_closed') throw new Error('损坏 journal 应 fail_closed');
      } finally { env.restore(); }
    },
  },
  {
    // post-impl review P0#1 契约反转：recover **不 commit**（恢复顺序与正常路径同构
    // pending→heads→events→commit）——先 commit 会让「commit 后事件补齐前」二次崩溃
    // 的缺失事件永久不可修复。commit 权在调用方补完事件之后。
    name: 'journal: pending 崩溃窗 → recover 只补 heads 不 commit；事件补齐前二次崩溃可重入',
    run: () => {
      const env = setupEnv(true);
      try {
        // 两个 phase 各有 PASS head
        take(env);
        const frozen = resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'spec' });
        takePassSnapshot({ projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'coding', epoch: 1, files: frozen });
        beginInvalidationTx({
          projectRoot: env.root, feature: FEATURE, runId: RUN,
          causePhase: 'testing', invalidatedPhases: ['spec', 'coding'], txId: 'tx-crash',
        });
        // 崩溃：不 commit。resume①：
        const rec = recoverInvalidationJournal(env.root, FEATURE, RUN);
        if (rec.kind !== 'pending_heads_applied') throw new Error(`应 pending_heads_applied：${rec.kind}`);
        if (rec.kind === 'pending_heads_applied' && rec.invalidatedPhases.length !== 2) throw new Error('多 phase 失效不全');
        for (const ph of ['spec', 'coding']) {
          const h = readPassSnapshotHead(env.root, FEATURE, RUN, ph);
          if (h.body?.state !== 'superseded') throw new Error(`${ph} head 未 supersede`);
        }
        // 关键：recover 后 journal 仍 pending（commit 权在调用方补完事件之后）
        if (readInvalidationJournal(env.root, FEATURE, RUN).body?.state !== 'pending') {
          throw new Error('recover 不得提前 commit——二次崩溃窗的事件将永久丢失');
        }
        // 二次崩溃（事件未补、未 commit）→ resume②：仍 pending_heads_applied（幂等可重入）
        const rec2 = recoverInvalidationJournal(env.root, FEATURE, RUN);
        if (rec2.kind !== 'pending_heads_applied') throw new Error(`二次 recover 应仍 pending_heads_applied：${rec2.kind}`);
        // 调用方补完事件后 commit → 完成态=journal 文件不存在（round3 P0#3 删除语义）
        commitInvalidationTx(env.root, FEATURE, RUN, 'tx-crash');
        if (readInvalidationJournal(env.root, FEATURE, RUN).mac !== 'absent') throw new Error('commit 后 journal 应被移除（完成态=不存在）');
        if (recoverInvalidationJournal(env.root, FEATURE, RUN).kind !== 'none') throw new Error('完成后应 none');
      } finally { env.restore(); }
    },
  },
  {
    name: 'journal: 无 HMAC 环境 pending journal → resume fail_closed（不改 head）',
    run: () => {
      const env = setupEnv(false);
      try {
        take(env);
        beginInvalidationTx({
          projectRoot: env.root, feature: FEATURE, runId: RUN,
          causePhase: 'testing', invalidatedPhases: ['spec'], txId: 'tx-weak',
        });
        // begin 已在同进程改 head（合法）；模拟 resume：弱信任 journal 不得再驱动 head 变更
        const rec = recoverInvalidationJournal(env.root, FEATURE, RUN);
        if (rec.kind !== 'fail_closed') throw new Error(`无 HMAC pending 应 fail_closed：${rec.kind}`);
      } finally { env.restore(); }
    },
  },
  {
    name: 'e2e 回放 A: i2-PASS fixture 冻结 → i3 式错键重写被恢复（未配 HMAC 默认环境）',
    run: () => {
      const env = setupEnv(false);
      try {
        const FIX = path.resolve(__dirname, '..', 'fixtures', 'cc-spec-deadlock');
        // i2 PASS 态产物落 feature spec/
        fs.copyFileSync(path.join(FIX, 'i2-pass-artifacts', 'ui-spec.yaml'), path.join(env.featDir, 'spec', 'ui-spec.yaml'));
        fs.copyFileSync(path.join(FIX, 'i2-pass-artifacts', 'ref-elements.yaml'), path.join(env.featDir, 'spec', 'ref-elements.yaml'));
        const taken = take(env);
        // i3 冷启动重写：错键 must_have 终态覆盖
        fs.copyFileSync(path.join(FIX, 'i3-wrong-key-ui-spec.yaml'), path.join(env.featDir, 'spec', 'ui-spec.yaml'));
        const d = diffs(env);
        if (!d.some(x => x.rel === 'spec/ui-spec.yaml' && x.class === 'modified')) throw new Error('重写未检出');
        const out = restoreFrozenFromSnapshot({
          projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
          diffs: d, trust: { tier: 'in_process', memoryDigest: taken.memoryDigest },
          context: ctx(env),
        });
        if (out.refused) throw new Error(`默认环境同进程应可恢复：${out.refused}`);
        const restored = fs.readFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'utf-8');
        if (!restored.includes('must_have_elements')) throw new Error('恢复的不是 i2 PASS 态');
        if (restored.includes('must_have:')) throw new Error('错键内容残留');
        if (diffs(env).length !== 0) throw new Error('恢复后应零差异');
      } finally { env.restore(); }
    },
  },
  {
    // post-impl review P1#3：新增 symlink（不在清单）须按 added 删除——旧实现记 'link'
    // 后因查不到 manifest SHA 被静默留存（violation 记了、restored 记了、链接还在）。
    name: 'restore: 冻结域内新增 symlink → 判 added 且被删除（不静默留存）',
    run: () => {
      const env = setupEnv(false);
      try {
        const taken = take(env);
        const linkTarget = path.join(env.root, 'outside.yaml');
        fs.writeFileSync(linkTarget, 'outside\n');
        const linkPath = path.join(env.featDir, 'spec', 'sneaky-link.yaml');
        try {
          fs.symlinkSync(linkTarget, linkPath);
        } catch { return; } // 无链接权限环境跳过
        const d = diffs(env);
        const entry = d.find(x => x.rel === 'spec/sneaky-link.yaml');
        if (!entry || entry.class !== 'added') throw new Error(`新增链接应判 added：${JSON.stringify(entry)}`);
        const out = restoreFrozenFromSnapshot({
          projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
          diffs: d, trust: { tier: 'in_process', memoryDigest: taken.memoryDigest },
          context: ctx(env),
        });
        if (out.refused) throw new Error(out.refused);
        if (fs.existsSync(linkPath)) throw new Error('新增 symlink 未被删除');
      } finally { env.restore(); }
    },
  },
  {
    // post-impl review P1#4：建快照真实入口跟链防护——frozen 文件所在目录被换 junction
    // 时 resolveFrozenDeliverables/takePassSnapshot 必须 fail-closed，不得跟随链接读域外。
    name: 'take: frozen 目录为 junction → 建快照入口 fail-closed（不跟链读域外）',
    run: () => {
      const env = setupEnv(false);
      try {
        const outside = path.join(env.root, 'outside-spec');
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, 'ui-spec.yaml'), 'evil: true\n');
        fs.writeFileSync(path.join(outside, 'spec.md'), '# evil\n');
        fs.writeFileSync(path.join(outside, 'ref-elements.yaml'), 'elements: []\n');
        const specDir = path.join(env.featDir, 'spec');
        fs.rmSync(specDir, { recursive: true, force: true });
        try {
          fs.symlinkSync(outside, specDir, 'junction');
        } catch { return; }
        let threw = false;
        try {
          resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'spec' });
        } catch { threw = true; }
        if (!threw) throw new Error('junction 化的 spec/ 未被建快照入口拦截');
      } finally { env.restore(); }
    },
  },
  {
    // post-impl review P0#2：不可变 manifest——同 epoch 已有合法 manifest 时禁止覆盖重建
    name: 'take: 同 epoch 已有合法 manifest → 拒绝覆盖（不可变语义）',
    run: () => {
      const env = setupEnv(false);
      try {
        take(env);
        const frozen = resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'spec' });
        let threw = false;
        try {
          takePassSnapshot({ projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec', epoch: 1, files: frozen });
        } catch { threw = true; }
        if (!threw) throw new Error('同 epoch 覆盖未被拒绝');
      } finally { env.restore(); }
    },
  },
  {
    // post-impl round2 P0#1：MAC 先于 state——「篡改成 committed + 坏 MAC」不得被忽略
    name: 'journal: 篡改 state=committed 但 MAC 无效 → fail_closed（不得按 committed 忽略）',
    run: () => {
      const env = setupEnv(true);
      try {
        take(env);
        beginInvalidationTx({
          projectRoot: env.root, feature: FEATURE, runId: RUN,
          causePhase: 'testing', invalidatedPhases: ['spec'], txId: 'tx-tamper',
        });
        // 攻击者把 pending 改成 committed（MAC 随之失效）
        const jp = invalidationJournalPath(env.root, FEATURE, RUN);
        const doc = JSON.parse(fs.readFileSync(jp, 'utf-8'));
        doc.state = 'committed';
        fs.writeFileSync(jp, JSON.stringify(doc, null, 2));
        const rec = recoverInvalidationJournal(env.root, FEATURE, RUN);
        if (rec.kind !== 'fail_closed') throw new Error(`应 fail_closed：${rec.kind}`);
        // commit 洗白拒绝：MAC 无效时 commit 必须抛
        let threw = false;
        try { commitInvalidationTx(env.root, FEATURE, RUN, 'tx-tamper'); } catch { threw = true; }
        if (!threw) throw new Error('坏 MAC journal 被 commit 重签洗白');
      } finally { env.restore(); }
    },
  },
  {
    name: 'journal: 跨 run 重放（绑定失配）→ fail_closed；commit tx_id 失配 → 抛',
    run: () => {
      const env = setupEnv(true);
      try {
        take(env);
        beginInvalidationTx({
          projectRoot: env.root, feature: FEATURE, runId: RUN,
          causePhase: 'testing', invalidatedPhases: ['spec'], txId: 'tx-bind',
        });
        // 另一 run 的 recover 不得消费本 journal（复制重放形态）
        const jp = invalidationJournalPath(env.root, FEATURE, 'OTHER-RUN');
        fs.mkdirSync(path.dirname(jp), { recursive: true });
        fs.copyFileSync(invalidationJournalPath(env.root, FEATURE, RUN), jp);
        const rec = recoverInvalidationJournal(env.root, FEATURE, 'OTHER-RUN');
        if (rec.kind !== 'fail_closed') throw new Error(`跨 run 重放应 fail_closed：${rec.kind}`);
        let threw = false;
        try { commitInvalidationTx(env.root, FEATURE, RUN, 'tx-wrong'); } catch { threw = true; }
        if (!threw) throw new Error('tx_id 失配的 commit 未被拒');
        commitInvalidationTx(env.root, FEATURE, RUN, 'tx-bind'); // 正确 txId 可 commit
      } finally { env.restore(); }
    },
  },
  {
    // post-impl round2 P1#4：dangling symlink——existsSync 跟随链接漏检
    name: 'restore: dangling symlink 新增 → 真实删除（lexists 语义，不再宣称删除实际残留）',
    run: () => {
      const env = setupEnv(false);
      try {
        const taken = take(env);
        const linkPath = path.join(env.featDir, 'spec', 'dangling-link.yaml');
        try {
          fs.symlinkSync(path.join(env.root, 'no-such-target.yaml'), linkPath);
        } catch { return; }
        const d = diffs(env);
        const entry = d.find(x => x.rel === 'spec/dangling-link.yaml');
        if (!entry || entry.class !== 'added') throw new Error(`dangling 链接应判 added：${JSON.stringify(entry)}`);
        const out = restoreFrozenFromSnapshot({
          projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
          diffs: d, trust: { tier: 'in_process', memoryDigest: taken.memoryDigest },
          context: ctx(env),
        });
        if (out.refused) throw new Error(out.refused);
        try {
          fs.lstatSync(linkPath);
          throw new Error('dangling symlink 仍残留（宣称删除实际未删）');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      } finally { env.restore(); }
    },
  },
  {
    // post-impl round2 P1#5：frozen 文件被换成目录——diff 不得 EISDIR 崩溃，恢复须移除重装
    name: 'diff/restore: frozen 文件被换成同名目录 → 判 modified 并恢复原字节（不崩溃）',
    run: () => {
      const env = setupEnv(false);
      try {
        const taken = take(env);
        const target = path.join(env.featDir, 'spec', 'ui-spec.yaml');
        fs.rmSync(target);
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'inner.txt'), 'x');
        const d = diffs(env); // 旧实现此处 EISDIR 崩溃
        const entry = d.find(x => x.rel === 'spec/ui-spec.yaml');
        if (!entry || entry.class !== 'modified') throw new Error(`目录替换应判 modified：${JSON.stringify(entry)}`);
        const out = restoreFrozenFromSnapshot({
          projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec',
          diffs: d, trust: { tier: 'in_process', memoryDigest: taken.memoryDigest },
          context: ctx(env),
        });
        if (out.refused) throw new Error(out.refused);
        const st = fs.lstatSync(target);
        if (!st.isFile()) throw new Error('目录未被移除重装');
        if (!fs.readFileSync(target, 'utf-8').startsWith('schema_version')) throw new Error('字节未恢复');
      } finally { env.restore(); }
    },
  },
  {
    // post-impl round2 P0#2：统一可信加载——坏 MAC/绑定失配在 spawn 前拦截
    name: 'loadTrustedSnapshotContext: active 全绑定通过；篡改 manifest → fail_closed；跨 phase 复制 → fail_closed',
    run: () => {
      const env = setupEnv(true);
      try {
        take(env);
        const ok = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (ok.kind !== 'active') throw new Error(`应 active：${JSON.stringify(ok)}`);
        // 篡改盘上 manifest（files 清空洗 diff）→ fail_closed（manifest sha 与 head 绑定失配）
        const mPath = path.join(passSnapshotPhaseDir(env.root, FEATURE, RUN, 'spec', 1), 'manifest.json');
        const mDoc = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
        mDoc.files = [];
        fs.writeFileSync(mPath, JSON.stringify(mDoc, null, 2));
        const bad = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (bad.kind !== 'fail_closed') throw new Error(`篡改 manifest 应 fail_closed：${JSON.stringify(bad)}`);
        // 跨 phase 复制 head+快照（HMAC 合法重放）→ 绑定失配 fail_closed
        const srcHead = passSnapshotHeadPath(env.root, FEATURE, RUN, 'spec');
        const dstHead = passSnapshotHeadPath(env.root, FEATURE, RUN, 'coding');
        fs.mkdirSync(path.dirname(dstHead), { recursive: true });
        fs.copyFileSync(srcHead, dstHead);
        const replay = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'coding');
        if (replay.kind !== 'fail_closed') throw new Error(`跨 phase 重放应 fail_closed：${JSON.stringify(replay)}`);
      } finally { env.restore(); }
    },
  },
  {
    // round3 P0#3：unauth 面上任何在场 journal（含被篡改成 committed 的）→ fail_closed
    name: 'journal: 无 HMAC 环境 pending 被篡改成 committed → 在场即 fail_closed（不被当完成态忽略）',
    run: () => {
      const env = setupEnv(false);
      try {
        take(env);
        beginInvalidationTx({
          projectRoot: env.root, feature: FEATURE, runId: RUN,
          causePhase: 'testing', invalidatedPhases: ['spec'], txId: 'tx-unauth',
        });
        const jp = invalidationJournalPath(env.root, FEATURE, RUN);
        const doc = JSON.parse(fs.readFileSync(jp, 'utf-8'));
        doc.state = 'committed';
        fs.writeFileSync(jp, JSON.stringify(doc, null, 2));
        const rec = recoverInvalidationJournal(env.root, FEATURE, RUN);
        if (rec.kind !== 'fail_closed') throw new Error(`unauth 在场 journal 应 fail_closed：${rec.kind}`);
      } finally { env.restore(); }
    },
  },
  {
    // round3 P0#3 + round4 P1#2：authenticated 环境 commit 写盘后、删除前崩溃——用生产
    // 故障注入点构造**合法 MAC 的 committed 残留**，命中 recover 的清理分支（上一版测试
    // 只覆盖了坏 MAC 分支，未命中目标）。
    name: 'journal: authenticated committed 残留（故障注入 commit-写后-rm 前）→ recover 清理为不存在',
    run: () => {
      const env = setupEnv(true);
      try {
        take(env);
        beginInvalidationTx({
          projectRoot: env.root, feature: FEATURE, runId: RUN,
          causePhase: 'testing', invalidatedPhases: ['spec'], txId: 'tx-residue',
        });
        // 故障注入：committed 已写盘（合法 MAC）、rm 前"崩溃"
        commitInvalidationTx(env.root, FEATURE, RUN, 'tx-residue', { crashBeforeRemoveForTest: true });
        const jp = invalidationJournalPath(env.root, FEATURE, RUN);
        if (!fs.existsSync(jp)) throw new Error('注入后 journal 应仍在盘（committed 残留）');
        const j = readInvalidationJournal(env.root, FEATURE, RUN);
        if (j.body?.state !== 'committed' || j.mac !== 'ok') throw new Error(`残留应为合法 MAC committed：state=${j.body?.state} mac=${j.mac}`);
        // recover：验签通过的 committed 残留 → 清理收敛到「不存在」+ none
        const rec = recoverInvalidationJournal(env.root, FEATURE, RUN);
        if (rec.kind !== 'none') throw new Error(`committed 残留清理应 none：${rec.kind}`);
        if (fs.existsSync(jp)) throw new Error('残留未被清除');
        // 伪造形态（pending 原文改 committed，MAC 失效）仍 fail_closed（回归保留）
        beginInvalidationTx({
          projectRoot: env.root, feature: FEATURE, runId: RUN,
          causePhase: 'testing', invalidatedPhases: ['spec'], txId: 'tx-forge',
        });
        const doc = JSON.parse(fs.readFileSync(jp, 'utf-8'));
        fs.writeFileSync(jp, JSON.stringify({ ...doc, state: 'committed' }, null, 2));
        if (recoverInvalidationJournal(env.root, FEATURE, RUN).kind !== 'fail_closed') {
          throw new Error('伪造 committed（坏 MAC）应 fail_closed');
        }
      } finally { env.restore(); }
    },
  },
  {
    // round3 P0#1：同进程内存锚——两轮绕过（先删 head，下轮保护全关）被 spawn 前拦截
    name: 'loadTrustedSnapshotContext: 内存锚在场 + head 被删/换代 → fail_closed（两轮绕过拦截）',
    run: () => {
      const env = setupEnv(false);
      try {
        const taken = take(env);
        const anchor = { epoch: 1, manifestSha256: taken.memoryDigest.manifestSha256 };
        // 正常：锚+盘上一致 → active
        const ok = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec', anchor);
        if (ok.kind !== 'active') throw new Error(`锚一致应 active：${JSON.stringify(ok)}`);
        // 绕过第 N 轮：agent 只删 head（不碰产物→零 diff）→ 第 N+1 轮 spawn 前必须 fail_closed
        fs.rmSync(passSnapshotHeadPath(env.root, FEATURE, RUN, 'spec'));
        const gone = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec', anchor);
        if (gone.kind !== 'fail_closed') throw new Error(`锚在场 head 消失应 fail_closed：${JSON.stringify(gone)}`);
        // 无锚（真无快照史）→ none 照旧
        const none = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec', null);
        if (none.kind !== 'none') throw new Error(`无锚无 head 应 none：${JSON.stringify(none)}`);
        // 换代：重建 epoch2 快照后用旧锚 → fail_closed
        const frozen = resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'spec' });
        takePassSnapshot({ projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec', epoch: 2, files: frozen });
        const swapped = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec', anchor);
        if (swapped.kind !== 'fail_closed') throw new Error(`锚与盘上 epoch 失配应 fail_closed：${JSON.stringify(swapped)}`);
      } finally { env.restore(); }
    },
  },
  {
    // round3 P1#5：manifest shape 拒非 canonical/越界/重复/空清单/非 frozen 类
    name: 'manifest shape: ../绝对路径/反斜杠/重复 rel/空 files/mutable 类文件 → 读取判 invalid',
    run: () => {
      const env = setupEnv(false);
      try {
        take(env);
        const mPath = path.join(passSnapshotPhaseDir(env.root, FEATURE, RUN, 'spec', 1), 'manifest.json');
        const good = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
        const sha = 'a'.repeat(64);
        const badVariants: Array<Record<string, unknown>> = [
          // round5 P2 后 bytes 无条件必填——各变体带合法 bytes，保证仍在测各自的目标拒因
          { ...good, files: [{ rel: '../escape.yaml', sha256: sha, bytes: 1 }] },
          { ...good, files: [{ rel: 'C:/abs.yaml', sha256: sha, bytes: 1 }] },
          { ...good, files: [{ rel: 'spec\\win.yaml', sha256: sha, bytes: 1 }] },
          { ...good, files: [{ rel: 'spec/a.yaml', sha256: sha, bytes: 1 }, { rel: 'spec/a.yaml', sha256: sha, bytes: 1 }] },
          { ...good, files: [] },
          { ...good, watched_roots: [] },
          { ...good, watched_roots: ['coding/'] },
          { ...good, files: [{ rel: 'spec/phase-completion-receipt.md', sha256: sha, bytes: 1 }] },
          // round4 P0：watched_roots 缩窄（弱信任 resume 洗差异检测通道）——须精确集合等价
          { ...good, watched_roots: ['spec/nonexistent/'] },
          { ...good, watched_roots: ['spec/', 'spec/extra/'] },
          // round4：bytes 非整数/负数；round5 P2：缺失同拒（类型声明必填，运行时同构）
          { ...good, files: [{ rel: 'spec/a.yaml', sha256: sha, bytes: -1 }] },
          { ...good, files: [{ rel: 'spec/a.yaml', sha256: sha, bytes: 1.5 }] },
          { ...good, files: [{ rel: 'spec/a.yaml', sha256: sha }] },
        ];
        for (const [i, v] of badVariants.entries()) {
          fs.writeFileSync(mPath, JSON.stringify(v, null, 2));
          const r = readFrozenManifest(path.dirname(mPath));
          if (r.body !== null || r.mac !== 'invalid') throw new Error(`变体 ${i} 应 invalid：${JSON.stringify(r.mac)}`);
        }
      } finally { env.restore(); }
    },
  },
  {
    // round5 P0：根级必需产物（acceptance.yaml）在 watched_roots ['spec/'] 之外，manifest
    // files 是其唯一差异入口——弱信任一致伪造（manifest+head 同步改写、roots 保持精确
    // 等价、仅删该条目）必须被完整性对账拦截，否则改毁根级契约零 diff 通过。
    name: '完整性对账: 弱信任伪造仅删根级 acceptance.yaml（roots 不变）→ fail_closed',
    run: () => {
      const env = setupEnv(false);
      try {
        take(env);
        const before = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (before.kind !== 'active') throw new Error(`伪造前应 active：${JSON.stringify(before)}`);
        if (!before.manifest.files.some(f => f.rel === 'acceptance.yaml')) {
          throw new Error('前置：合法 manifest 应含根级 acceptance.yaml');
        }
        forgeManifestConsistently(env, 'spec', 1, doc => {
          doc.files = (doc.files as Array<{ rel: string }>).filter(f => f.rel !== 'acceptance.yaml');
        });
        const forged = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (forged.kind !== 'fail_closed' || !/完整性对账|acceptance\.yaml/.test(forged.reason)) {
          throw new Error(`删根级必需产物应 fail_closed（完整性对账）：${JSON.stringify(forged)}`);
        }
      } finally { env.restore(); }
    },
  },
  {
    name: '完整性对账: plan 阶段同类——伪造仅删根级 contracts.yaml → fail_closed',
    run: () => {
      const env = setupEnv(false);
      try {
        fs.mkdirSync(path.join(env.featDir, 'plan'), { recursive: true });
        fs.writeFileSync(path.join(env.featDir, 'plan', 'plan.md'), '# plan v1\n', 'utf-8');
        fs.writeFileSync(path.join(env.featDir, 'contracts.yaml'), 'contracts: []\n', 'utf-8');
        const frozen = resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'plan' });
        takePassSnapshot({ projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'plan', epoch: 1, files: frozen });
        forgeManifestConsistently(env, 'plan', 1, doc => {
          doc.files = (doc.files as Array<{ rel: string }>).filter(f => f.rel !== 'contracts.yaml');
        });
        const forged = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'plan');
        if (forged.kind !== 'fail_closed' || !/完整性对账|contracts\.yaml/.test(forged.reason)) {
          throw new Error(`删根级 contracts.yaml 应 fail_closed：${JSON.stringify(forged)}`);
        }
      } finally { env.restore(); }
    },
  },
  {
    // round5 P0（建侧同构）：PASS 冻结清单缺必需产物即拒建——绝不落盘"载侧对账必失败"
    // 的 manifest（PASS 缺必需产物本身即门禁不变量违例，runner 按保护失败 halt）
    name: '完整性对账: 建快照时必需产物缺席（盘上无 acceptance.yaml）→ 拒建 throw',
    run: () => {
      const env = setupEnv(false);
      try {
        fs.rmSync(path.join(env.featDir, 'acceptance.yaml'));
        const frozen = resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'spec' });
        let threw = '';
        try {
          takePassSnapshot({ projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec', epoch: 1, files: frozen });
        } catch (e) { threw = (e as Error).message; }
        if (!/acceptance\.yaml/.test(threw)) throw new Error(`应拒建并点名缺失产物：${threw || '（未抛错）'}`);
        // 拒建后不得留下 head/manifest 残留
        if (readPassSnapshotHead(env.root, FEATURE, RUN, 'spec').body !== null) throw new Error('拒建不得写 head');
      } finally { env.restore(); }
    },
  },
  {
    // round6 P1：根级 **optional** 产物（use-cases.yaml）同类绕过——必需表对账够不着，
    // 弱信任载侧按"磁盘在场的根级候选缺条目"拦截（spawn 前）；diff added 域同时兜底
    name: '完整性对账: 弱信任伪造仅删根级 optional use-cases.yaml 条目 → fail_closed + diff added 兜底',
    run: () => {
      const env = setupEnv(false);
      try {
        take(env);
        const before = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (before.kind !== 'active') throw new Error(`伪造前应 active：${JSON.stringify(before)}`);
        if (!before.manifest.files.some(f => f.rel === 'use-cases.yaml')) {
          throw new Error('前置：合法 manifest 应含根级 use-cases.yaml（建侧全集对账）');
        }
        forgeManifestConsistently(env, 'spec', 1, doc => {
          doc.files = (doc.files as Array<{ rel: string }>).filter(f => f.rel !== 'use-cases.yaml');
        });
        // 载侧：未认证 manifest + 磁盘在场缺条目 → spawn 前 fail_closed
        const forged = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (forged.kind !== 'fail_closed' || !/use-cases\.yaml/.test(forged.reason)) {
          throw new Error(`删根级 optional 条目应 fail_closed：${JSON.stringify(forged)}`);
        }
        // diff 兜底：同一伪造 manifest 直接 diff（模拟绕过 loader 的消费方）→ added 检出
        const m = readFrozenManifest(passSnapshotPhaseDir(env.root, FEATURE, RUN, 'spec', 1));
        const d = diffFrozenAgainstManifest({ projectRoot: env.root, feature: FEATURE, phase: 'spec', manifest: m.body! });
        if (!d.some(x => x.rel === 'use-cases.yaml' && x.class === 'added')) {
          throw new Error(`diff added 域应含根级 use-cases.yaml：${JSON.stringify(d)}`);
        }
      } finally { env.restore(); }
    },
  },
  {
    name: '完整性对账: 建侧全集对账——files 漏磁盘在场的 use-cases.yaml → 拒建 throw',
    run: () => {
      const env = setupEnv(false);
      try {
        const frozen = resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'spec' })
          .filter(f => f.rel !== 'use-cases.yaml');
        let threw = '';
        try {
          takePassSnapshot({ projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'spec', epoch: 1, files: frozen });
        } catch (e) { threw = (e as Error).message; }
        if (!/use-cases\.yaml/.test(threw)) throw new Error(`应拒建并点名漏出产物：${threw || '（未抛错）'}`);
      } finally { env.restore(); }
    },
  },
  {
    // round6 P1：漂移方向——快照时不存在、PASS 后根级新增 → added（强信任 restore 删除；
    // 弱信任 restore 拒绝并 halt），不再是零 diff 盲区
    name: 'diff: PASS 后根级新增 use-cases.yaml（快照时不存在）→ added 检出',
    run: () => {
      const env = setupEnv(false);
      try {
        fs.rmSync(path.join(env.featDir, 'use-cases.yaml'));
        take(env);
        fs.writeFileSync(path.join(env.featDir, 'use-cases.yaml'), 'use_cases: [injected]\n', 'utf-8');
        const d = diffs(env);
        if (!d.some(x => x.rel === 'use-cases.yaml' && x.class === 'added')) {
          throw new Error(`根级新增应判 added：${JSON.stringify(d)}`);
        }
      } finally { env.restore(); }
    },
  },
  {
    name: '路径安全: 预存 junction → assertNoLinkInChain fail-closed',
    run: () => {
      const env = setupEnv(false);
      try {
        const realDir = path.join(env.root, 'real-target');
        fs.mkdirSync(realDir, { recursive: true });
        const linkDir = path.join(env.featDir, 'spec-linked');
        try {
          fs.symlinkSync(realDir, linkDir, 'junction');
        } catch {
          return; // 无权限创建链接的环境：跳过（Windows junction 通常无需管理员）
        }
        let threw = false;
        try {
          assertNoLinkInChain(path.join(linkDir, 'x.yaml'), env.featDir);
        } catch { threw = true; }
        if (!threw) throw new Error('链接链未 fail-closed');
      } finally { env.restore(); }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
