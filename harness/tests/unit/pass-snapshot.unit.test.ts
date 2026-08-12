// ============================================================================
// pass-snapshot.unit.test.ts — e5d8a2c4 5b/5c
// 快照是可丢弃缓存：不读 HMAC、不恢复旧字节、不消费旧 journal。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertNoLinkInChain,
  classifyPassArtifact,
  codingBasePath,
  discardPassSnapshotCache,
  diffFrozenAgainstManifest,
  loadTrustedSnapshotContext,
  passSnapshotHeadPath,
  passSnapshotPhaseDir,
  passSnapshotRunDir,
  phaseHasFrozenSurface,
  readCodingBase,
  readFrozenManifest,
  readFrozenSnapshotFile,
  readPassSnapshotHead,
  recordCodingBase,
  resolveFrozenDeliverables,
  sha256Buf,
  takePassSnapshot,
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

function setupEnv(): Env {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-snap-'));
  const previousDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  const previousHmac = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust');
  // 5b 行为钉：即使旧部署残留这个 env，pass-snapshot 也不得读取它。
  process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'unit-test-key';
  const featDir = path.join(root, 'doc', 'features', FEATURE);
  fs.mkdirSync(path.join(featDir, 'spec'), { recursive: true });
  fs.mkdirSync(path.join(featDir, 'plan'), { recursive: true });
  fs.writeFileSync(path.join(featDir, 'spec', 'spec.md'), '# spec v1\n', 'utf-8');
  fs.writeFileSync(path.join(featDir, 'spec', 'ui-spec.yaml'), 'schema_version: "1.0"\n', 'utf-8');
  fs.writeFileSync(path.join(featDir, 'spec', 'ref-elements.yaml'), 'elements: []\n', 'utf-8');
  fs.writeFileSync(path.join(featDir, 'plan', 'plan.md'), '# plan v1\n', 'utf-8');
  fs.writeFileSync(path.join(featDir, 'acceptance.yaml'), 'criteria: []\n', 'utf-8');
  fs.writeFileSync(path.join(featDir, 'contracts.yaml'), 'contracts: []\n', 'utf-8');
  fs.writeFileSync(path.join(featDir, 'use-cases.yaml'), 'use_cases: []\n', 'utf-8');
  return {
    root,
    featDir,
    restore: () => {
      if (previousDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
      else process.env.MAISON_GOAL_CHECKPOINT_DIR = previousDir;
      if (previousHmac === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
      else process.env.MAISON_HMAC_GOAL_CHECKPOINT = previousHmac;
    },
  };
}

function take(env: Env, phase = 'spec', epoch = 1) {
  const files = resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase });
  return takePassSnapshot({ projectRoot: env.root, feature: FEATURE, runId: RUN, phase, epoch, files });
}

function readManifest(env: Env, phase = 'spec') {
  const head = readPassSnapshotHead(env.root, FEATURE, RUN, phase);
  if (!head.body) throw new Error(`缺 head：${JSON.stringify(head)}`);
  const result = readFrozenManifest(passSnapshotPhaseDir(env.root, FEATURE, RUN, phase, head.body.pass_epoch));
  if (!result.body) throw new Error(`缺 manifest：${JSON.stringify(result)}`);
  return result.body;
}

function changed(env: Env, phase = 'spec') {
  return diffFrozenAgainstManifest({
    projectRoot: env.root,
    feature: FEATURE,
    phase,
    manifest: readManifest(env, phase),
  });
}

function rewriteHeadHash(env: Env, phase: string, epoch: number): void {
  const manifestPath = path.join(passSnapshotPhaseDir(env.root, FEATURE, RUN, phase, epoch), 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const headPath = passSnapshotHeadPath(env.root, FEATURE, RUN, phase);
  const head = JSON.parse(fs.readFileSync(headPath, 'utf-8')) as Record<string, unknown>;
  head.manifest_sha256 = sha256Buf(Buffer.from(raw, 'utf-8'));
  fs.writeFileSync(headPath, JSON.stringify(head, null, 2), 'utf-8');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'classify: closure/control/derived/frozen 四类保持唯一解析',
    run: () => {
      if (classifyPassArtifact('spec', 'spec/phase-completion-receipt.md') !== 'mutable_closure') throw new Error('closure');
      if (classifyPassArtifact('spec', 'vision/capability-receipt.json') !== 'mutable_control_plane') throw new Error('control');
      if (classifyPassArtifact('spec', 'spec/reports/summary.json') !== 'derived') throw new Error('derived');
      if (classifyPassArtifact('spec', 'spec/ui-spec.yaml') !== 'frozen_deliverable') throw new Error('frozen');
      if (classifyPassArtifact('spec', 'spec/fake.receipt.json') === 'mutable_control_plane') throw new Error('receipt 通配泄漏');
    },
  },
  {
    name: 'snapshot: HMAC env 不参与写入，manifest/head 仅含内容结构',
    run: () => {
      const env = setupEnv();
      try {
        const taken = take(env);
        const headDoc = JSON.parse(fs.readFileSync(passSnapshotHeadPath(env.root, FEATURE, RUN, 'spec'), 'utf-8')) as Record<string, unknown>;
        const manifestDoc = JSON.parse(fs.readFileSync(path.join(taken.phaseDir, 'manifest.json'), 'utf-8')) as Record<string, unknown>;
        if ('mac' in headDoc || 'mac' in manifestDoc) throw new Error('写入面仍带 mac');
        if (readPassSnapshotHead(env.root, FEATURE, RUN, 'spec').status !== 'ok') throw new Error('head status');
        if (!taken.manifest.files.length) throw new Error('空清单');
      } finally { env.restore(); }
    },
  },
  {
    name: 'snapshot: HMAC env 被设置仍可正常 resume 读取缓存',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec', null);
        if (loaded.kind !== 'active') throw new Error(`HMAC env 不应改变缓存语义：${JSON.stringify(loaded)}`);
      } finally { env.restore(); }
    },
  },
  {
    name: 'diff: modified/added/deleted 与 mutable 豁免仍可诊断',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        fs.writeFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'broken\n');
        fs.writeFileSync(path.join(env.featDir, 'spec', 'stray.yaml'), 'x\n');
        fs.rmSync(path.join(env.featDir, 'spec', 'ref-elements.yaml'));
        fs.mkdirSync(path.join(env.featDir, 'vision'), { recursive: true });
        fs.writeFileSync(path.join(env.featDir, 'vision', 'capability-receipt.json'), '{}');
        const result = changed(env);
        if (!result.some(d => d.rel === 'spec/ui-spec.yaml' && d.class === 'modified')) throw new Error('modified');
        if (!result.some(d => d.rel === 'spec/stray.yaml' && d.class === 'added')) throw new Error('added');
        if (!result.some(d => d.rel === 'spec/ref-elements.yaml' && d.class === 'deleted')) throw new Error('deleted');
        if (result.some(d => d.rel.includes('capability-receipt'))) throw new Error('mutable 被误判');
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache: active head 失效后不恢复宿主字节，只退位为 superseded',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        fs.writeFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'agent bytes\n');
        const out = discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec'] });
        if (out.diagnostics.length || out.discardedPhases[0] !== 'spec') throw new Error(JSON.stringify(out));
        if (fs.readFileSync(path.join(env.featDir, 'spec', 'ui-spec.yaml'), 'utf-8') !== 'agent bytes\n') throw new Error('发生旧字节恢复');
        if (readPassSnapshotHead(env.root, FEATURE, RUN, 'spec').body?.state !== 'superseded') throw new Error('未退位');
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache: discard 幂等且 generation 只单调前进',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        const first = discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec'] });
        const gen = readPassSnapshotHead(env.root, FEATURE, RUN, 'spec').body?.generation ?? 0;
        const second = discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec'] });
        if (first.diagnostics.length || second.diagnostics.length) throw new Error('discard diagnostics');
        if ((readPassSnapshotHead(env.root, FEATURE, RUN, 'spec').body?.generation ?? 0) !== gen) throw new Error('幂等重复涨代');
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache: superseded head 只返回 inactive，不再作为授权',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec'] });
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec', null);
        if (loaded.kind !== 'inactive') throw new Error(`应 inactive：${JSON.stringify(loaded)}`);
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache miss: 损坏 head 可丢弃且不阻塞为人工等待',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        const headPath = passSnapshotHeadPath(env.root, FEATURE, RUN, 'spec');
        fs.writeFileSync(headPath, '{broken', 'utf-8');
        if (loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec').kind !== 'fail_closed') throw new Error('损坏 head 未识别');
        const out = discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec'] });
        if (out.diagnostics.length || fs.existsSync(headPath)) throw new Error(`损坏缓存未清：${JSON.stringify(out)}`);
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache miss: manifest 损坏只报告 fail_closed 缓存失效',
    run: () => {
      const env = setupEnv();
      try {
        const taken = take(env);
        fs.writeFileSync(path.join(taken.phaseDir, 'manifest.json'), '{broken', 'utf-8');
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (loaded.kind !== 'fail_closed' || !/缓存失效|manifest/.test(loaded.reason)) throw new Error(JSON.stringify(loaded));
      } finally { env.restore(); }
    },
  },
  {
    name: 'anchor: 同进程 head 消失仍判缓存失效，不能把保护面静默清空',
    run: () => {
      const env = setupEnv();
      try {
        const taken = take(env);
        fs.rmSync(passSnapshotHeadPath(env.root, FEATURE, RUN, 'spec'));
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec', { epoch: 1, manifestSha256: taken.manifestSha256 });
        if (loaded.kind !== 'fail_closed') throw new Error('锚在场 head 消失未识别');
      } finally { env.restore(); }
    },
  },
  {
    name: 'anchor: epoch 换代后旧内存锚只得缓存失效',
    run: () => {
      const env = setupEnv();
      try {
        const first = take(env);
        discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec'] });
        take(env, 'spec', 2);
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec', { epoch: 1, manifestSha256: first.manifestSha256 });
        if (loaded.kind !== 'fail_closed') throw new Error('旧锚未拦截换代');
      } finally { env.restore(); }
    },
  },
  {
    name: 'binding: 跨 phase 复制 head 不被当作可用缓存',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        const source = passSnapshotHeadPath(env.root, FEATURE, RUN, 'spec');
        const target = passSnapshotHeadPath(env.root, FEATURE, RUN, 'coding');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'coding');
        if (loaded.kind !== 'fail_closed') throw new Error(`跨 phase 缓存未失效：${JSON.stringify(loaded)}`);
      } finally { env.restore(); }
    },
  },
  {
    name: 'shape: manifest ../绝对路径/反斜杠/重复/空 files 一律 invalid',
    run: () => {
      const env = setupEnv();
      try {
        const taken = take(env);
        const manifestPath = path.join(taken.phaseDir, 'manifest.json');
        const good = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
        const bad = [
          { ...good, files: [{ rel: '../escape.yaml', sha256: 'a'.repeat(64), bytes: 1 }] },
          { ...good, files: [{ rel: 'C:/absolute.yaml', sha256: 'a'.repeat(64), bytes: 1 }] },
          { ...good, files: [{ rel: 'spec\\win.yaml', sha256: 'a'.repeat(64), bytes: 1 }] },
          { ...good, files: [{ rel: 'spec/a.yaml', sha256: 'a'.repeat(64), bytes: 1 }, { rel: 'spec/a.yaml', sha256: 'a'.repeat(64), bytes: 1 }] },
          { ...good, files: [] },
        ];
        for (const doc of bad) {
          fs.writeFileSync(manifestPath, JSON.stringify(doc, null, 2));
          if (readFrozenManifest(taken.phaseDir).status !== 'invalid') throw new Error('非法 manifest 被接受');
        }
      } finally { env.restore(); }
    },
  },
  {
    name: 'integrity: 根级 acceptance 条目被一致伪造删除仍 fail_closed',
    run: () => {
      const env = setupEnv();
      try {
        const taken = take(env);
        const manifestPath = path.join(taken.phaseDir, 'manifest.json');
        const doc = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
        doc.files = (doc.files as Array<{ rel: string }>).filter(file => file.rel !== 'acceptance.yaml');
        fs.writeFileSync(manifestPath, JSON.stringify(doc, null, 2));
        rewriteHeadHash(env, 'spec', 1);
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (loaded.kind !== 'fail_closed' || !/acceptance/.test(loaded.reason)) throw new Error(JSON.stringify(loaded));
      } finally { env.restore(); }
    },
  },
  {
    name: 'integrity: plan 根级 contracts 条目同样受对账保护',
    run: () => {
      const env = setupEnv();
      try {
        const taken = take(env, 'plan');
        const manifestPath = path.join(taken.phaseDir, 'manifest.json');
        const doc = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
        doc.files = (doc.files as Array<{ rel: string }>).filter(file => file.rel !== 'contracts.yaml');
        fs.writeFileSync(manifestPath, JSON.stringify(doc, null, 2));
        rewriteHeadHash(env, 'plan', 1);
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'plan');
        if (loaded.kind !== 'fail_closed' || !/contracts/.test(loaded.reason)) throw new Error(JSON.stringify(loaded));
      } finally { env.restore(); }
    },
  },
  {
    name: 'take: 缺必需 acceptance 不落不完整缓存',
    run: () => {
      const env = setupEnv();
      try {
        fs.rmSync(path.join(env.featDir, 'acceptance.yaml'));
        let error = '';
        try { take(env); } catch (e) { error = (e as Error).message; }
        if (!/acceptance/.test(error)) throw new Error(`应拒建：${error}`);
        if (readPassSnapshotHead(env.root, FEATURE, RUN, 'spec').body !== null) throw new Error('拒建留下 head');
      } finally { env.restore(); }
    },
  },
  {
    name: 'take: files 漏掉磁盘在场 optional use-cases 时拒建',
    run: () => {
      const env = setupEnv();
      try {
        const files = resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'plan' })
          .filter(file => file.rel !== 'use-cases.yaml');
        let error = '';
        try { takePassSnapshot({ projectRoot: env.root, feature: FEATURE, runId: RUN, phase: 'plan', epoch: 1, files }); }
        catch (e) { error = (e as Error).message; }
        if (!/use-cases/.test(error)) throw new Error(`应拒建：${error}`);
      } finally { env.restore(); }
    },
  },
  {
    name: 'diff: PASS 后新增根级 optional 文件判 added',
    run: () => {
      const env = setupEnv();
      try {
        fs.rmSync(path.join(env.featDir, 'use-cases.yaml'));
        take(env, 'plan');
        fs.writeFileSync(path.join(env.featDir, 'use-cases.yaml'), 'use_cases: [new]\n');
        if (!changed(env, 'plan').some(file => file.rel === 'use-cases.yaml' && file.class === 'added')) throw new Error('optional added 未检出');
      } finally { env.restore(); }
    },
  },
  {
    name: 'take: 同 epoch 合法 manifest 不可覆盖',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        let threw = false;
        try { take(env); } catch { threw = true; }
        if (!threw) throw new Error('不可变 manifest 被覆盖');
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache miss: 改坏 frozen 文件后丢缓存，宿主仍保持改后字节',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        const target = path.join(env.featDir, 'spec', 'ui-spec.yaml');
        fs.writeFileSync(target, 'changed by agent\n');
        discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec'] });
        if (fs.readFileSync(target, 'utf-8') !== 'changed by agent\n') throw new Error('丢缓存触发旧字节恢复');
        if (changed(env).length === 0) throw new Error('漂移诊断消失');
      } finally { env.restore(); }
    },
  },
  {
    name: 'snapshot bytes: 只读校验用于诊断，不提供安装/恢复入口',
    run: () => {
      const env = setupEnv();
      try {
        const taken = take(env);
        const file = readFrozenSnapshotFile(taken.phaseDir, 'spec/ui-spec.yaml', taken.manifest.files.find(f => f.rel === 'spec/ui-spec.yaml')!.sha256);
        if (!file || file.toString('utf-8') !== 'schema_version: "1.0"\n') throw new Error('快照字节读取失败');
        if (readFrozenSnapshotFile(taken.phaseDir, 'spec/ui-spec.yaml', '0'.repeat(64)) !== null) throw new Error('坏 hash 被接受');
      } finally { env.restore(); }
    },
  },
  {
    name: 'legacy: 旧 JSON 带 mac 字段只按缓存内容读取，不触发验签分支',
    run: () => {
      const env = setupEnv();
      try {
        const taken = take(env);
        const manifestPath = path.join(taken.phaseDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
        manifest.mac = 'legacy';
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        rewriteHeadHash(env, 'spec', 1);
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (loaded.kind !== 'active') throw new Error(`legacy mac 不应成为凭据门：${JSON.stringify(loaded)}`);
      } finally { env.restore(); }
    },
  },
  {
    name: 'legacy journal: 残留 pending 文件不被读取或驱动缓存状态',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        const dir = passSnapshotRunDir(env.root, FEATURE, RUN);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'invalidation.json'), JSON.stringify({ state: 'pending', invalidated_phases: ['spec'] }));
        if (loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec').kind !== 'active') throw new Error('旧 journal 改变缓存读取');
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache: 多 phase 失效记录一次性退位全部目标 head',
    run: () => {
      const env = setupEnv();
      try {
        take(env, 'spec');
        take(env, 'plan');
        const out = discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec', 'plan'] });
        if (out.discardedPhases.length !== 2) throw new Error(JSON.stringify(out));
        if (readPassSnapshotHead(env.root, FEATURE, RUN, 'spec').body?.state !== 'superseded') throw new Error('spec');
        if (readPassSnapshotHead(env.root, FEATURE, RUN, 'plan').body?.state !== 'superseded') throw new Error('plan');
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache: 严重损坏 head 的丢弃动作只删除缓存，不抛异常',
    run: () => {
      const env = setupEnv();
      try {
        const head = passSnapshotHeadPath(env.root, FEATURE, RUN, 'spec');
        fs.mkdirSync(path.dirname(head), { recursive: true });
        fs.writeFileSync(head, '{bad');
        const out = discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec'] });
        if (out.diagnostics.length || fs.existsSync(head)) throw new Error(JSON.stringify(out));
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache: 失效后完整重跑可用新 epoch 建立 active 缓存',
    run: () => {
      const env = setupEnv();
      try {
        take(env, 'spec', 1);
        discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['spec'] });
        take(env, 'spec', 2);
        const head = readPassSnapshotHead(env.root, FEATURE, RUN, 'spec');
        if (head.body?.state !== 'active' || head.body.pass_epoch !== 2) throw new Error(JSON.stringify(head));
      } finally { env.restore(); }
    },
  },
  {
    name: 'coding base: 记录内容不带 HMAC，读取以结构 status 区分 absent/ok',
    run: () => {
      const env = setupEnv();
      try {
        const recorded = recordCodingBase({ projectRoot: env.root, feature: FEATURE, runId: RUN, baseSha: 'a'.repeat(40) });
        if (recorded.kind !== 'recorded') throw new Error(recorded.kind);
        const read = readCodingBase(env.root, FEATURE, RUN);
        if (read.status !== 'ok' || !read.body) throw new Error(JSON.stringify(read));
        const doc = JSON.parse(fs.readFileSync(codingBasePath(env.root, FEATURE, RUN), 'utf-8')) as Record<string, unknown>;
        if ('mac' in doc) throw new Error('coding base 仍带 mac');
      } finally { env.restore(); }
    },
  },
  {
    name: 'none: 无 head 的 phase 是普通 cache miss，不伪造 active',
    run: () => {
      const env = setupEnv();
      try {
        const loaded = loadTrustedSnapshotContext(env.root, FEATURE, RUN, 'spec');
        if (loaded.kind !== 'none') throw new Error(JSON.stringify(loaded));
      } finally { env.restore(); }
    },
  },
  {
    name: 'phase surface: frozen 产物表非空与源码 phase 设计区分',
    run: () => {
      if (!phaseHasFrozenSurface('spec')) throw new Error('spec 应有 frozen surface');
      if (phaseHasFrozenSurface('coding')) throw new Error('coding 不应走 frozen cache');
    },
  },
  {
    name: 'diff: 已知 frozen 文件换成目录仍只做 modified 诊断',
    run: () => {
      const env = setupEnv();
      try {
        take(env);
        const target = path.join(env.featDir, 'spec', 'ui-spec.yaml');
        fs.rmSync(target);
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'inner.txt'), 'x');
        const entry = changed(env).find(file => file.rel === 'spec/ui-spec.yaml');
        if (entry?.class !== 'modified') throw new Error(JSON.stringify(entry));
      } finally { env.restore(); }
    },
  },
  {
    name: 'path: 预存 junction/symlink 路径仍 fail-closed 读取',
    run: () => {
      const env = setupEnv();
      try {
        const target = path.join(env.root, 'real-target');
        const linked = path.join(env.featDir, 'spec-linked');
        fs.mkdirSync(target, { recursive: true });
        try { fs.symlinkSync(target, linked, 'junction'); } catch { return; }
        let threw = false;
        try { assertNoLinkInChain(path.join(linked, 'x.yaml'), env.featDir); } catch { threw = true; }
        if (!threw) throw new Error('link chain 未阻断');
      } finally { env.restore(); }
    },
  },
  {
    name: 'cache: 未知 phase 也只处理给定 head，不创建额外状态',
    run: () => {
      const env = setupEnv();
      try {
        const out = discardPassSnapshotCache({ projectRoot: env.root, feature: FEATURE, runId: RUN, phases: ['unknown'] });
        if (out.diagnostics.length || out.discardedPhases.length) throw new Error(JSON.stringify(out));
      } finally { env.restore(); }
    },
  },
  // ==========================================================================
  // 环 A（plan f3a8c6d2 t2）：建侧/验侧集合等价三条不变量。
  // 事故复现：`<phase>/context-exploration.md` 三张注册表皆无，但 classifyPassArtifact
  // 兜底判 frozen_deliverable → 旧实现建侧不收、验侧判 added，重建快照也不收敛。
  // ==========================================================================
  {
    name: '环A①: 未登记但兜底判 frozen 的产物（context-exploration）建快照时纳入，零 diff',
    run: () => {
      const env = setupEnv();
      try {
        // 事故文件：agent 每阶段必写、三张注册表皆无
        fs.writeFileSync(path.join(env.featDir, 'plan', 'context-exploration.md'), '# ctx v1\n', 'utf-8');
        if (classifyPassArtifact('plan', 'plan/context-exploration.md') !== 'frozen_deliverable') {
          throw new Error('前提失效：该文件已不再被兜底判 frozen_deliverable');
        }
        take(env, 'plan');
        const manifest = readManifest(env, 'plan');
        if (!manifest.files.some(f => f.rel === 'plan/context-exploration.md')) {
          throw new Error(`建侧未收该文件（集合不对称）：${JSON.stringify(manifest.files.map(f => f.rel))}`);
        }
        const diffs = changed(env, 'plan');
        if (diffs.length !== 0) throw new Error(`应零 diff，实得：${JSON.stringify(diffs)}`);
      } finally { env.restore(); }
    },
  },
  {
    name: '环A②: 快照建立后才新增的未登记 frozen 产物仍判 added（冻结语义不被削弱）',
    run: () => {
      const env = setupEnv();
      try {
        take(env, 'plan');
        // 快照之后才出现 → 必须仍是 added，不得因同源扫描而被放行
        fs.writeFileSync(path.join(env.featDir, 'plan', 'context-exploration.md'), '# ctx late\n', 'utf-8');
        const diffs = changed(env, 'plan');
        const hit = diffs.find(d => d.rel === 'plan/context-exploration.md');
        if (!hit || hit.class !== 'added') {
          throw new Error(`快照后新增应判 added，实得：${JSON.stringify(diffs)}`);
        }
      } finally { env.restore(); }
    },
  },
  {
    name: '环A③: 任意未登记文件——建侧收录集合与验侧 frozen 分类逐条一致',
    run: () => {
      const env = setupEnv();
      try {
        // 三类未登记文件混放：兜底 frozen / derived(reports) / mutable_closure(receipt)
        fs.mkdirSync(path.join(env.featDir, 'plan', 'reports'), { recursive: true });
        fs.mkdirSync(path.join(env.featDir, 'plan', 'nested', 'deep'), { recursive: true });
        fs.writeFileSync(path.join(env.featDir, 'plan', 'context-exploration.md'), '# ctx\n', 'utf-8');
        fs.writeFileSync(path.join(env.featDir, 'plan', 'nested', 'deep', 'notes.md'), '# deep\n', 'utf-8');
        fs.writeFileSync(path.join(env.featDir, 'plan', 'reports', 'summary.json'), '{}\n', 'utf-8');
        fs.writeFileSync(path.join(env.featDir, 'plan', 'phase-completion-receipt.md'), '# receipt\n', 'utf-8');
        const built = new Set(
          resolveFrozenDeliverables({ projectRoot: env.root, feature: FEATURE, phase: 'plan' }).map(f => f.rel),
        );
        // 验侧口径：watched_roots 目录域内凡 frozen_deliverable 者，建侧必须已收
        const expectFrozen = ['plan/plan.md', 'plan/context-exploration.md', 'plan/nested/deep/notes.md'];
        for (const rel of expectFrozen) {
          if (classifyPassArtifact('plan', rel) !== 'frozen_deliverable') throw new Error(`前提失效：${rel}`);
          if (!built.has(rel)) throw new Error(`建侧漏收 frozen：${rel}（集合不对称）`);
        }
        // 非 frozen 类两侧同样一致豁免
        for (const rel of ['plan/reports/summary.json', 'plan/phase-completion-receipt.md']) {
          if (classifyPassArtifact('plan', rel) === 'frozen_deliverable') throw new Error(`前提失效：${rel}`);
          if (built.has(rel)) throw new Error(`建侧误收非 frozen：${rel}`);
        }
        // 端到端：混放后建快照仍零 diff
        take(env, 'plan');
        const diffs = changed(env, 'plan');
        if (diffs.length !== 0) throw new Error(`应零 diff，实得：${JSON.stringify(diffs)}`);
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
  const result = runAll();
  for (const item of result) console.log(item.ok ? `PASS ${item.name}` : `FAIL ${item.name}: ${item.error}`);
  process.exit(result.every(item => item.ok) ? 0 : 1);
}
