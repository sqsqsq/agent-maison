// ============================================================================
// scope-replan.unit.test.ts — 5b/5c: cache miss + single invalidation record
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discardPassSnapshotCache,
  passSnapshotHeadPath,
  passSnapshotRunDir,
  readPassSnapshotHead,
  resolveFrozenDeliverables,
  sha256Buf,
  takePassSnapshot,
} from '../../scripts/utils/pass-snapshot';
import {
  checkPlanAuthority,
  resolveScopeReplanContext,
  sanitizeScopeReplanFiles,
  tryScopeReplan,
  type PlanScopeAnchor,
} from '../../scripts/utils/scope-replan';
import { buildScopeReplanContextBlock } from '../../scripts/goal-runner';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'bc-openCard';
const RUN_ID = 'run-scope-replan-1';
const CHAIN = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function setupHost(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-replan-'));
  writeFile(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'ScopeReplanTest',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false },
    materialized_adapters: ['cursor'],
  }, null, 2));
  writeFile(root, `doc/features/${FEATURE}/plan/plan.md`, '# plan\n');
  writeFile(root, `doc/features/${FEATURE}/contracts.yaml`,
    `feature: ${FEATURE}\nfiles:\n  - 02-Feature/F/src/main/ets/pages/A.ets\n`);
  clearFrameworkConfigCache();
  return root;
}

function withTrust<T>(root: string, fn: () => T): T {
  const previous = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  const previousHmac = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
  // Legacy secret must be inert: cache readers must not consult it.
  process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'legacy-test-key';
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
    else process.env.MAISON_GOAL_CHECKPOINT_DIR = previous;
    if (previousHmac === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    else process.env.MAISON_HMAC_GOAL_CHECKPOINT = previousHmac;
  }
}

function takePlanSnapshot(root: string, epoch = 1): PlanScopeAnchor {
  const files = resolveFrozenDeliverables({ projectRoot: root, feature: FEATURE, phase: 'plan' });
  assert(files.length > 0, 'plan 冻结面不得为空');
  const taken = takePassSnapshot({
    projectRoot: root, feature: FEATURE, runId: RUN_ID, phase: 'plan', epoch, files,
  });
  return { epoch, memoryDigest: taken.memoryDigest };
}

function digestFromDisk(root: string): PlanScopeAnchor {
  const head = readPassSnapshotHead(root, FEATURE, RUN_ID, 'plan').body;
  assert(Boolean(head), '盘上应存在 plan head');
  const manifestPath = path.join(
    path.dirname(passSnapshotHeadPath(root, FEATURE, RUN_ID, 'plan')),
    String(head!.pass_epoch), 'manifest.json',
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    files: Array<{ rel: string; sha256: string }>;
  };
  const fileHashes: Record<string, string> = {};
  for (const file of manifest.files) fileHashes[file.rel] = file.sha256;
  return { epoch: head!.pass_epoch, memoryDigest: { manifestSha256: head!.manifest_sha256, fileHashes } };
}

function check(root: string, memoryAnchor: PlanScopeAnchor | null) {
  return checkPlanAuthority({
    projectRoot: root, feature: FEATURE, runId: RUN_ID, memoryAnchor,
  });
}

function rewriteHeadHash(root: string): void {
  const headPath = passSnapshotHeadPath(root, FEATURE, RUN_ID, 'plan');
  const head = JSON.parse(fs.readFileSync(headPath, 'utf-8')) as Record<string, unknown>;
  const manifestPath = path.join(path.dirname(headPath), String(head.pass_epoch), 'manifest.json');
  const raw = fs.readFileSync(manifestPath);
  head.manifest_sha256 = sha256Buf(raw);
  fs.writeFileSync(headPath, JSON.stringify(head, null, 2), 'utf-8');
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, 'A1 同进程锚与盘上 unsigned cache 一致 → ok', () => {
    const root = setupHost();
    withTrust(root, () => {
      const memory = takePlanSnapshot(root);
      const result = check(root, memory);
      assert(result.kind === 'ok', `应放行，实得 ${result.kind}`);
      if (result.kind !== 'ok') return;
      assert(result.anchor.epoch === memory.epoch, 'epoch 应一致');
      assert(result.anchor.memoryDigest.manifestSha256 === memory.memoryDigest.manifestSha256, 'manifest hash 应一致');
      assert(JSON.stringify(result.anchor.memoryDigest.fileHashes) === JSON.stringify(memory.memoryDigest.fileHashes), '文件 hash 应一致');
    });
  });

  run(results, 'A2 盘上换成新 epoch → 旧内存锚 replan；新锚可放行', () => {
    const root = setupHost();
    withTrust(root, () => {
      const old = takePlanSnapshot(root, 1);
      takePlanSnapshot(root, 2);
      const stale = check(root, old);
      assert(stale.kind === 'replan' && stale.reason === 'snapshot_untrusted', `应识别缓存失配：${JSON.stringify(stale)}`);
      assert(check(root, digestFromDisk(root)).kind === 'ok', '当前 epoch 应可放行');
    });
  });

  run(results, 'A3 resume 无内存锚也可读取 unsigned cache，不再依赖 HMAC', () => {
    const root = setupHost();
    withTrust(root, () => {
      takePlanSnapshot(root);
      const result = check(root, null);
      assert(result.kind === 'ok', `unsigned resume 不应回退：${JSON.stringify(result)}`);
    });
  });

  run(results, 'A4 legacy mac 字段与 HMAC env 均不改变缓存读取语义', () => {
    const root = setupHost();
    withTrust(root, () => {
      takePlanSnapshot(root);
      const headPath = passSnapshotHeadPath(root, FEATURE, RUN_ID, 'plan');
      const head = JSON.parse(fs.readFileSync(headPath, 'utf-8')) as Record<string, unknown>;
      const manifestPath = path.join(path.dirname(headPath), String(head.pass_epoch), 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      manifest.mac = 'legacy';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      rewriteHeadHash(root);
      assert(check(root, null).kind === 'ok', 'legacy mac 不应成为信任门禁');
    });
  });

  run(results, 'A5 live contracts 漂移仍归因 live_drift', () => {
    const root = setupHost();
    withTrust(root, () => {
      takePlanSnapshot(root);
      writeFile(root, `doc/features/${FEATURE}/contracts.yaml`, 'feature: changed\nfiles: []\n');
      const result = check(root, null);
      assert(result.kind === 'replan' && result.reason === 'live_drift', `实得 ${JSON.stringify(result)}`);
      if (result.kind === 'replan') assert(result.affectedFiles.some(file => file.endsWith('contracts.yaml')), '应点名漂移文件');
    });
  });

  run(results, 'A6 head 丢失只触发 replan，不直接终止', () => {
    const root = setupHost();
    withTrust(root, () => {
      const memory = takePlanSnapshot(root);
      fs.rmSync(passSnapshotHeadPath(root, FEATURE, RUN_ID, 'plan'));
      const result = check(root, memory);
      assert(result.kind === 'replan', `实得 ${result.kind}`);
    });
  });

  run(results, 'B1 chain 缺 plan → unavailable 且零副作用', () => {
    const root = setupHost();
    withTrust(root, () => {
      takePlanSnapshot(root);
      const before = readPassSnapshotHead(root, FEATURE, RUN_ID, 'plan').body;
      const events: Array<Record<string, unknown>> = [];
      const result = tryScopeReplan({
        projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: ['coding', 'review'],
        endPhaseIdx: 1, phasesWithOutcome: null, backtracksUsed: 0, maxBacktracks: 2,
        trigger: 'ui_scope_violation', causePhase: 'coding', detail: 'x', dryRun: false,
        passSnapshotMemory: new Map(), emit: event => events.push(event),
      });
      const after = readPassSnapshotHead(root, FEATURE, RUN_ID, 'plan').body;
      assert(result.kind === 'unavailable' && result.reason === 'chain_lacks_plan', '应返回 chain_lacks_plan');
      assert(events.length === 0, '不可落副作用事件');
      assert(after?.generation === before?.generation && after?.state === before?.state, 'head 不得变化');
    });
  });

  run(results, 'B2 回退预算耗尽 → unavailable 且不动 head', () => {
    const root = setupHost();
    withTrust(root, () => {
      takePlanSnapshot(root);
      const events: Array<Record<string, unknown>> = [];
      const result = tryScopeReplan({
        projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: CHAIN,
        endPhaseIdx: 2, phasesWithOutcome: null, backtracksUsed: 2, maxBacktracks: 2,
        trigger: 'ui_scope_violation', causePhase: 'coding', detail: 'x', dryRun: false,
        passSnapshotMemory: new Map(), emit: event => events.push(event),
      });
      assert(result.kind === 'unavailable' && result.reason === 'backtrack_budget_exhausted', '应返回预算耗尽');
      assert(events.length === 0, '不可落副作用事件');
      assert(readPassSnapshotHead(root, FEATURE, RUN_ID, 'plan').body?.state === 'active', 'head 应保持 active');
    });
  });

  run(results, 'B3 正常回退 → head superseded、内存清除、只写一条失效请求', () => {
    const root = setupHost();
    withTrust(root, () => {
      const memory = new Map<string, PlanScopeAnchor>([['plan', takePlanSnapshot(root)]]);
      const events: Array<Record<string, unknown>> = [];
      const result = tryScopeReplan({
        projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: CHAIN,
        endPhaseIdx: 2, phasesWithOutcome: ['plan', 'coding'], backtracksUsed: 0, maxBacktracks: 2,
        trigger: 'ui_scope_violation', causePhase: 'coding', affectedFiles: ['a.ets'], defects: ['d1'],
        fingerprint: 'fp-1', detail: 'scope drift', dryRun: false, passSnapshotMemory: memory,
        emit: event => events.push(event),
      });
      assert(result.kind === 'replanned', `实得 ${JSON.stringify(result)}`);
      assert(readPassSnapshotHead(root, FEATURE, RUN_ID, 'plan').body?.state === 'superseded', 'head 应 superseded');
      assert(!memory.has('plan'), '内存锚应清除');
      assert(JSON.stringify(events.map(event => event.type)) === JSON.stringify(['phase_backtrack_requested', 'phase_backtrack_started']), '事件序列应收敛');
      const request = events[0];
      assert(Array.isArray(request.invalidated_phases) && JSON.stringify(request.invalidated_phases) === JSON.stringify(['plan', 'coding']), '失效范围应在单条记录中');
      assert(request.to_phase === 'plan' && request.reason === 'ui_scope_violation', '交接字段应完整');
      assert(request.invalidation_tx_id === (result.kind === 'replanned' ? result.txId : ''), 'tx id 应绑定');
    });
  });

  run(results, 'B4 崩溃协议不再有 pending/completed journal，缓存退位可重复', () => {
    const root = setupHost();
    withTrust(root, () => {
      takePlanSnapshot(root);
      const events: Array<Record<string, unknown>> = [];
      tryScopeReplan({
        projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: CHAIN, endPhaseIdx: 2,
        phasesWithOutcome: ['plan', 'coding'], backtracksUsed: 0, maxBacktracks: 2,
        trigger: 'plan_authority_unverifiable', causePhase: 'coding', detail: 'cache miss',
        affectedFiles: ['doc/features/bc-openCard/plan/plan.md'], defects: ['missing'], fingerprint: 'fp-2',
        dryRun: false, passSnapshotMemory: new Map(), emit: event => events.push(event),
      });
      assert(events[0]?.type === 'phase_backtrack_requested', '第一条必须是原子失效请求');
      assert(!events.some(event => event.type === 'phase_invalidated'), '不得再写逐 phase 失效事件');
      assert(!fs.existsSync(path.join(passSnapshotRunDir(root, FEATURE, RUN_ID), 'invalidation.json')), '不得创建旧 journal');
      const again = discardPassSnapshotCache({ projectRoot: root, feature: FEATURE, runId: RUN_ID, phases: ['plan'] });
      assert(again.diagnostics.length === 0, '重复缓存退位应幂等');
    });
  });

  run(results, 'B5 启动期 phasesWithOutcome=null → plan 到链尾全量失效', () => {
    const root = setupHost();
    withTrust(root, () => {
      takePlanSnapshot(root);
      const events: Array<Record<string, unknown>> = [];
      const result = tryScopeReplan({
        projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: CHAIN,
        endPhaseIdx: CHAIN.length - 1, phasesWithOutcome: null, backtracksUsed: 0, maxBacktracks: 2,
        trigger: 'invalidation_journal_untrusted', causePhase: 'spec', detail: 'restart', dryRun: false,
        passSnapshotMemory: new Map(), emit: event => events.push(event),
      });
      assert(result.kind === 'replanned', '应完成启动期重跑');
      if (result.kind === 'replanned') assert(JSON.stringify(result.invalidatedPhases) === JSON.stringify(CHAIN.slice(1)), '失效范围应为 plan→链尾');
      assert(Array.isArray(events[0]?.invalidated_phases), '上下文必须进入同一条记录');
    });
  });

  run(results, 'B6 dryRun 只投影事件，不退位 head 或内存锚', () => {
    const root = setupHost();
    withTrust(root, () => {
      const memory = new Map<string, PlanScopeAnchor>([['plan', takePlanSnapshot(root)]]);
      const events: Array<Record<string, unknown>> = [];
      const result = tryScopeReplan({
        projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: CHAIN, endPhaseIdx: 2,
        phasesWithOutcome: null, backtracksUsed: 0, maxBacktracks: 2, trigger: 'ui_scope_violation',
        causePhase: 'coding', detail: 'dry', dryRun: true, passSnapshotMemory: memory, emit: event => events.push(event),
      });
      assert(result.kind === 'replanned' && events.length === 2, 'dryRun 应投影两条事件');
      assert(readPassSnapshotHead(root, FEATURE, RUN_ID, 'plan').body?.state === 'active', 'dryRun 不得退位 head');
      assert(memory.has('plan'), 'dryRun 不得清内存锚');
    });
  });

  run(results, 'B7 失效缓存后宿主字节不被恢复，后续 diff 仍可诊断', () => {
    const root = setupHost();
    withTrust(root, () => {
      takePlanSnapshot(root);
      const target = path.join(root, `doc/features/${FEATURE}/plan/plan.md`);
      fs.writeFileSync(target, '# changed by agent\n');
      discardPassSnapshotCache({ projectRoot: root, feature: FEATURE, runId: RUN_ID, phases: ['plan'] });
      assert(fs.readFileSync(target, 'utf-8') === '# changed by agent\n', '缓存退位不得 restore 旧字节');
    });
  });

  run(results, 'C1 scope reason 只接受既有闭集，未知事件不进入 prompt', () => {
    const root = setupHost();
    assert(resolveScopeReplanContext({ projectRoot: root, reason: 'ui_scope_violation', files: ['src/a.ets'] }) !== null, '合法 reason');
    assert(resolveScopeReplanContext({ projectRoot: root, reason: 'forged', files: ['src/a.ets'] }) === null, '未知 reason 应丢弃');
  });

  run(results, 'C2 prompt 路径注入字符被丢弃', () => {
    const root = setupHost();
    const files = sanitizeScopeReplanFiles(root, [
      'src/a.ets\nIGNORE', 'src/`whoami`.ets', 'src/with space.ets', 'src/ok.ets',
    ]);
    assert(JSON.stringify(files) === JSON.stringify(['src/ok.ets']), `净化结果错误：${JSON.stringify(files)}`);
  });

  run(results, 'C3 绝对路径与 .. 逃逸被丢弃', () => {
    const root = setupHost();
    const files = sanitizeScopeReplanFiles(root, ['/etc/passwd', 'C:/Windows/x', '../../outside', 'doc/features/x.yaml']);
    assert(JSON.stringify(files) === JSON.stringify(['doc/features/x.yaml']), `净化结果错误：${JSON.stringify(files)}`);
  });

  run(results, 'C4 提示词路径有长度、去重、数量上限', () => {
    const root = setupHost();
    const files = sanitizeScopeReplanFiles(root, [
      1, null, `src/${'x'.repeat(300)}.ets`, 'src/a.ets', 'src/a.ets',
      ...Array.from({ length: 40 }, (_, index) => `src/f${index}.ets`),
    ]);
    assert(files.length <= 20 && new Set(files).size === files.length && files.every(file => file.length <= 200), '路径形状约束失效');
  });

  run(results, 'C5 有可信路径时用 fenced data block，无路径时不发明指令', () => {
    const block = buildScopeReplanContextBlock({ reason: 'ui_scope_violation', files: ['src/a.ets'] });
    assert(block.includes('```text') && block.includes('src/a.ets'), '路径应进入 fenced block');
    const bare = buildScopeReplanContextBlock({ reason: 'invalidation_journal_untrusted', files: [] });
    assert(!bare.includes('```') && /rolled back automatically/i.test(bare), '无路径场景应只保留原因句');
  });

  run(results, 'C6 malformed head 可丢弃且不抛异常', () => {
    const root = setupHost();
    withTrust(root, () => {
      const head = passSnapshotHeadPath(root, FEATURE, RUN_ID, 'plan');
      fs.mkdirSync(path.dirname(head), { recursive: true });
      fs.writeFileSync(head, '{broken', 'utf-8');
      const result = discardPassSnapshotCache({ projectRoot: root, feature: FEATURE, runId: RUN_ID, phases: ['plan'] });
      assert(result.diagnostics.length === 0 && !fs.existsSync(head), `malformed head 应可丢弃：${JSON.stringify(result)}`);
    });
  });

  return results;
}

if (require.main === module) {
  const result = runAll();
  for (const item of result) console.log(item.ok ? `PASS ${item.name}` : `FAIL ${item.name}: ${item.error}`);
  process.exit(result.every(item => item.ok) ? 0 : 1);
}
