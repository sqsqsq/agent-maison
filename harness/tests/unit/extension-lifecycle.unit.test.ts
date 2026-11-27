import { runUnitCasesAsync } from '../utils/unit-cases';
import { testCliArgs } from '../utils/test-cli-args';
import assert from 'assert';
import { execFileSync, spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { once } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mock } from 'node:test';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import { loadInstanceExtensions } from '../../extension-loader';
import { detectRepoLayout } from '../../repo-layout';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';
import { changeExtension, cleanupDeletedExtensionPlugins, prepareExtensionPlugins, withExtensionWrite, type ExtensionMutation } from '../../scripts/utils/extension-lifecycle';
import { inspectExtensionRequest } from '../../scripts/utils/extension-requests';
import { acceptSessionExecution, capturePhaseBinding, writePhaseExecutionRequestMaterial } from '../../scripts/utils/session-execution-handoff';
import { casAcquireRunOwner, ensureRunControl } from '../../scripts/utils/goal-run-control';
import { isLockStale, readLockRecord, releaseLock, RUN_LOCK_NAME } from '../../scripts/utils/goal-run-lock';
import { writeExtensionFileAtomic, type ExtensionFileChange } from '../../scripts/utils/extension-files';
import { capturePhaseInvocationSnapshot, type PhaseWriteBoundaryResolution } from '../../scripts/utils/phase-write-boundary';

const frameworkRoot = detectRepoLayout(__dirname).frameworkRoot;
const at = 'component-design.before_discovery@1';

function write(file: string, bytes: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

async function inProject(body: (projectRoot: string, source: string, extensionDir: string) => void | Promise<void>): Promise<void> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-extension-lifecycle-'));
  const project = path.join(temporary, 'host');
  const source = path.join(temporary, 'source');
  const extensionDir = path.join(project, 'doc/extensions');
  write(path.join(project, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1',
    project_name: 'lifecycle',
    project_profile: { name: 'generic', sub_variant: 'app' },
    materialized_adapters: ['generic', 'claude'],
    architecture: {
      outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', architecture_md: 'doc/architecture.md', glossary: 'doc/glossary.yaml',
      module_catalog: 'doc/module-catalog.yaml', extension_dir: 'doc/extensions' },
  }));
  write(path.join(source, 'manifest.yaml'), YAML.stringify({
    schema_version: '2.0', kind: 'plugin', name: 'ux', version: '1.0.0',
    provides: { skills: ['ux'] },
    bindings: {
      read: { at, kind: 'knowledge', ref: 'knowledge/intake.md', enabled_by_default: true },
      fill: { at, kind: 'action', ref: 'ux', enabled_by_default: true },
    },
  }));
  write(path.join(source, 'knowledge/intake.md'), '# intake\n');
  write(path.join(source, 'skills/ux/SKILL.md'), '---\nname: ux\n---\n# UX skill\n');
  write(path.join(source, 'skills/ux/reference/stable.md'), '# initial\n');
  try {
    clearFrameworkConfigCache();
    await body(project, source, extensionDir);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function state(projectRoot: string, action: ExtensionMutation, opts: {
  ability?: string; source?: string; binding?: string; noEnable?: boolean; at?: string; phase?: string;
} = {}) {
  return withExtensionWrite(projectRoot, frameworkRoot, () => changeExtension(action, {
    projectRoot, frameworkRoot, ability: 'ux', ...opts,
  }));
}

function runCli(projectRoot: string, ...words: string[]) {
  const harness = path.join(frameworkRoot, 'harness');
  return spawnSync(process.execPath, [
    ...testCliArgs(path.join(harness, 'scripts/extension.ts')),
    ...words, '--project-root', projectRoot, '--json',
  ], { cwd: harness, encoding: 'utf8', timeout: 15_000 });
}

function cli(projectRoot: string, ...words: string[]) {
  const child = runCli(projectRoot, ...words);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

function publishedBindings(projectRoot: string) {
  return loadInstanceExtensions(projectRoot, 'doc/extensions', { frameworkRoot }).bindings;
}

function dynamicSource(source: string, version: string, fail = false): void {
  const output = 'knowledge/guide.md';
  const index = 'knowledge/index.json';
  write(path.join(source, 'manifest.yaml'), YAML.stringify({
    schema_version: '2.0', kind: 'plugin', name: 'ux', version, provides: { skills: ['ux'] },
    bindings: {
      read: { at: 'feature.before_phase_work@1', phase: 'coding', kind: 'knowledge', ref: output, enabled_by_default: true },
      fill: { at, kind: 'action', ref: 'ux', enabled_by_default: true },
    },
    activation: { steps: [{ id: 'make', scope: 'local', cwd: '.', run: ['node', 'scripts/make.cjs'],
      outputs: [output, index], ready: { version_file: index } }] },
  }));
  write(path.join(source, 'scripts/make.cjs'), `
    const fs = require('node:fs');
    fs.mkdirSync('knowledge', { recursive: true });
    fs.writeFileSync('${output}', '${version}');
    fs.writeFileSync('${index}', JSON.stringify({ plugin_version: process.env.MAISON_EXTENSION_VERSION }));
    ${fail ? 'process.exit(23);' : ''}
  `);
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

const testRunId = '20261125T000000Z-abc123';

function issueDesign(projectRoot: string, requestId: string, source: string, cu = false,
  boundary: PhaseWriteBoundaryResolution | null = null, ownerKind: 'session' | 'process' = 'session', beforeBinding?: () => void) {
  const feature = 'opening';
  const runId = testRunId;
  const workspace = cu ? `${feature}/unit-1` : feature;
  if (cu) write(path.join(projectRoot, 'doc/features', workspace, 'change-unit.yaml'), 'id: unit-1\n');
  const reportDir = `doc/features/${workspace}/goal-runs/${runId}`;
  const runDir = path.join(projectRoot, reportDir);
  fs.mkdirSync(runDir, { recursive: true });
  const phase = cu ? 'work-unit-author' : 'initial-design-author';
  const issuedAt = new Date().toISOString();
  const owner = { run_id: runId, owner_id: 'writer', epoch: 1, kind: ownerKind };
  const binding = { source, ability: source === 'different-source' ? 'other' : 'ux', id: 'fill', at, kind: 'action', ref: 'ux', delivery: 'action',
    path: source === 'different-source' ? 'doc/extensions/other/skills/other/SKILL.md' : 'doc/extensions/ux/skills/ux/SKILL.md',
    plugin_manifest: source === 'different-source' ? 'doc/extensions/other/manifest.yaml' : 'doc/extensions/ux/manifest.yaml' };
  const control = ensureRunControl(runDir, runId);
  if (!control.current_epoch) {
    assert(casAcquireRunOwner(runDir, runId, 0, { kind: owner.kind, owner_id: owner.owner_id }).ok);
  }
  const material = writePhaseExecutionRequestMaterial({
    invokeId: requestId, issuedAt, gateTimeoutMs: 60_000, cleanupReserveMs: 2000,
    preSnapshot: boundary ? capturePhaseInvocationSnapshot(boundary) : null, writeBoundary: boundary,
    ...(boundary && !cu ? { purpose: 'author', snapshotOptions: { ownedPrefixes: boundary.protectedRoots } } : {}),
    context: {
      projectRoot, frameworkRoot, feature, runId, runDir, reportDir, phase, workflowId: 'default',
      track: 'full', chain: [phase], attemptId: requestId, adapter: 'generic', owner, childEnv: {},
      runtimeFacts: { receiptRequired: false, resume: false, successor: false },
      workInput: { material: {
        purpose: phase,
        segments: cu ? [{ extension_feature_bindings: [binding] }]
          : [{ extension_preparation: { at, role: 'author', blueprint_id: feature, bindings: [binding] } }],
      } },
    },
  });
  write(path.join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId }));
  const eventsFile = path.join(runDir, 'events.jsonl');
  const append = (event: object): void => fs.appendFileSync(eventsFile, JSON.stringify({ ts: issuedAt, ...event }) + '\n');
  append({ type: 'run_start' });
  append({ type: 'agent_invoke_start', invoke_id: requestId, phase,
    ...(ownerKind === 'process' ? { handoff_request: material.reference, owner_id: owner.owner_id, owner_epoch: owner.epoch } : {}) });
  const event = { type: 'phase_start', invoke_id: requestId, phase, handoff_request: material.reference, driver: 'session',
    owner_id: owner.owner_id, owner_epoch: owner.epoch, attempt_id: requestId };
  if (ownerKind === 'session') append(event);
  const issued = { ...material, event };
  beforeBinding?.();
  if (boundary) append({ type: 'agent_process_bound', invoke_id: requestId, phase, owner_id: owner.owner_id,
    owner_epoch: owner.epoch, binding_snapshot: capturePhaseBinding(runDir, issued) });
  return { append, phase, path: `${reportDir}/${material.reference.path}`, runDir, issued };
}

const cases = [
  {
    name: '旧 1.0 清单含 2.0 不识别的宿主顶层字段时，安装拒绝迁移且保持清单和资源字节',
    run: () => inProject((project, source, extensionDir) => {
      const manifest = path.join(extensionDir, 'manifest.yaml');
      const story = path.join(extensionDir, 'skills/story/SKILL.md');
      write(manifest, '# 旧宿主扩展注释\nschema_version: "1.0"\nname: wallet\nx-wallet-maintainer-note: 自有备注\n');
      write(story, '# Existing story\n');
      const manifestBefore = fs.readFileSync(manifest);
      const storyBefore = fs.readFileSync(story);
      assert.match(JSON.stringify(cli(project, 'inspect').inspection.manifestErrors), /旧版扩展未加载/);

      const attempted = runCli(project, 'install', source, 'ux');
      assert.equal(attempted.status, 1, attempted.stderr + attempted.stdout);
      assert.match(attempted.stderr, /旧版扩展未加载/);
      assert.deepStrictEqual(fs.readFileSync(manifest), manifestBefore);
      assert.deepStrictEqual(fs.readFileSync(story), storyBefore);
      assert(!fs.existsSync(path.join(extensionDir, 'skills/ux')));
      assert(!fs.existsSync(path.join(extensionDir, 'knowledge')));
      assert(!fs.existsSync(path.join(project, 'AGENTS.md')));
      assert.match(JSON.stringify(cli(project, 'inspect').inspection.manifestErrors), /旧版扩展未加载/);
    }),
  },
  {
    name: '外置新版管理 CLI 先核宿主实际发布件 reader，旧版清单与文件原样保留',
    run: () => inProject((project, source, extensionDir) => {
      const manifest = path.join(extensionDir, 'manifest.yaml');
      const original = '# 宿主原清单\nschema_version: "1.0"\nname: host\n';
      write(manifest, original);
      ensureConsumerFrameworkTree(project);
      write(path.join(project, 'framework/specs/instance-extension-manifest.schema.yaml'), YAML.stringify({
        schema_version: '1.1',
        root_object: { properties: { schema_version: { enum: ['1.0', '1.1'] } } },
      }));
      const attempted = runCli(project, 'install', source, 'ux');
      assert.equal(attempted.status, 1, attempted.stderr + attempted.stdout);
      assert.match(attempted.stderr, /目标 Maison 发布件不支持按插件的扩展清单 2\.0/);
      assert.equal(fs.readFileSync(manifest, 'utf8'), original);
      assert(!fs.existsSync(path.join(extensionDir, 'ux/skills/ux/SKILL.md')));
    }),
  },
  {
    name: '卸载保护已签发且未启动的会话，run_end 后只提示原定位，停用只影响新请求',
    run: () => inProject((project, source, extensionDir) => {
      state(project, 'install', { source });
      const unrelated = issueDesign(project, 'other-package-author', 'different-source');
      const signed = issueDesign(project, 'active-author', 'local-ux');
      // The workspace can have one persisted run with more than one invocation.
      signed.append({ type: 'agent_invoke_start', invoke_id: 'other-package-author', phase: unrelated.phase });
      const before = inspectExtensionRequest(project, signed.path, 'ux');
      assert.equal(before.requestId, 'active-author');
      assert.equal(before.settled, false);
      state(project, 'disable');
      assert(publishedBindings(project).every(b => !b.enabled));
      assert.deepEqual(state(project, 'uninstall').requestIds, ['active-author']);
      assert(!fs.existsSync(path.join(signed.runDir, RUN_LOCK_NAME)));
      assert(fs.existsSync(path.join(extensionDir, 'ux/skills/ux/SKILL.md')));
      signed.append({ type: 'run_end', status: 'INTERRUPTED' });
      const { mutation, request } = cli(project, 'uninstall', 'ux');
      assert.equal(request, undefined);
      assert.equal(mutation.requestIds, undefined);
      assert.deepEqual(mutation.inactiveRequests.filter((item: { requestId: string }) => item.requestId === 'active-author'), [{
        requestId: 'active-author', runId: testRunId, requestFile: signed.path, reason: '运行已结束（run_end）',
      }]);
      assert(mutation.filesRemoved.includes('doc/extensions/ux/skills/ux/SKILL.md'));
      assert(!fs.existsSync(path.join(extensionDir, 'ux/skills/ux/SKILL.md')));
      const history = inspectExtensionRequest(project, signed.path, 'ux');
      assert.equal(history.settled, false);
      assert.deepEqual(history.results, []);
    }),
  },
  {
    name: '作者真锁失效后沿原卸载命令完成清理，原签发历史保持可查',
    run: () => inProject(async (project, source, extensionDir) => {
      const asset = 'doc/extensions/ux/skills/ux/reference/stable.md';
      state(project, 'install', { source });
      write(path.join(source, 'skills/ux/reference/stable.md'), '# upgrade after orphan\n');
      const reportDir = `doc/features/opening/goal-runs/${testRunId}`;
      const runDir = path.join(project, reportDir);
      const lockPath = path.join(runDir, RUN_LOCK_NAME);
      const child = spawn(process.execPath, [
        '-r', require.resolve('ts-node/register/transpile-only'), '-e', `
          const path = require('path');
          const [runDir, runId, reportDir] = process.argv.slice(1);
          const { tryAcquireLock, RUN_LOCK_NAME } = require('./scripts/utils/goal-run-lock');
          const { casAcquireRunOwner, ensureRunControl } = require('./scripts/utils/goal-run-control');
          const lock = tryAcquireLock(path.join(runDir, RUN_LOCK_NAME), {
            run_id: runId, report_dir: reportDir, run_mode: 'authoritative', ownerId: 'writer',
          });
          if (!lock) throw new Error('fixture runner lock busy');
          const control = ensureRunControl(runDir, runId);
          if (!casAcquireRunOwner(runDir, runId, control.current_epoch, { kind: 'process', owner_id: lock.ownerId }).ok) {
            throw new Error('fixture owner busy');
          }
          process.send('locked');
          setInterval(() => {}, 1000);
        `, runDir, testRunId, reportDir,
      ], { cwd: path.join(frameworkRoot, 'harness'), stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
      const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
      try {
        const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(8000) });
        assert.equal(ready, 'locked');
        const lock = readLockRecord(lockPath)!;
        assert.equal(lock.pid, child.pid);
        assert.equal(isLockStale(lock), false);
        const signed = issueDesign(project, 'killed-author', 'local-ux', false, null, 'process');
        signed.append({ type: 'agent_process_bound', invoke_id: 'killed-author', phase: signed.phase, pid: child.pid });
        assert.deepEqual(state(project, 'uninstall').requestIds, ['killed-author']);
        assert.equal(fs.readFileSync(path.join(project, asset), 'utf8'), '# initial\n');
        const original = fs.readFileSync(path.join(project, signed.path));
        const eventsPath = path.join(runDir, 'events.jsonl');
        const events = fs.readFileSync(eventsPath);
        assert(child.kill('SIGKILL'));
        await closed;
        assert.equal(isLockStale(readLockRecord(lockPath)!), true);

        const expected = [{ requestId: 'killed-author', runId: testRunId, requestFile: signed.path, reason: '运行锁已失效或已释放' }];
        releaseLock(lockPath, lock.ownerId);
        assert(!fs.existsSync(lockPath));
        const removed = state(project, 'uninstall');
        assert.deepEqual(removed.inactiveRequests, expected);
        assert(removed.filesRemoved.includes(asset));
        assert(!fs.existsSync(path.join(extensionDir, 'ux/skills/ux/SKILL.md')));
        const installed = cli(project, 'install', source, 'ux').mutation;
        assert(installed.filesWritten.includes(asset));
        assert.equal(fs.readFileSync(path.join(project, asset), 'utf8'), '# upgrade after orphan\n');
        assert.deepEqual(fs.readFileSync(path.join(project, signed.path)), original);
        assert.deepEqual(fs.readFileSync(eventsPath), events);
        const history = inspectExtensionRequest(project, signed.path, 'ux');
        assert.equal(history.requestId, 'killed-author');
        assert.equal(history.settled, false);
        assert.deepEqual(history.results, []);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await closed;
      }
    }),
  },
  {
    name: '独占新增资源保护已有文件，清理部分写入且只观察成功后实际落盘的内容',
    run: () => inProject((project) => {
      const target = path.join(project, 'resource.md');
      const observed: ExtensionFileChange[] = [];
      const observe = (change: ExtensionFileChange) => observed.push(change);
      write(target, 'host-owned');
      assert.throws(() => writeExtensionFileAtomic(target, 'candidate', true, observe), { code: 'EEXIST' });
      assert.equal(fs.readFileSync(target, 'utf8'), 'host-owned');
      assert.deepEqual(observed, []);
      fs.unlinkSync(target);

      const originalWrite = fs.writeFileSync;
      const fault = mock.method(require('fs') as typeof fs, 'writeFileSync', (file: Parameters<typeof fs.writeFileSync>[0]) => {
        originalWrite(file, 'partial');
        throw new Error('injected file write failure');
      });
      try {
        assert.throws(() => writeExtensionFileAtomic(target, 'candidate', true, observe), /injected file write failure/);
      } finally {
        fault.mock.restore();
      }
      assert(!fs.existsSync(target));
      assert.deepEqual(observed, []);
      writeExtensionFileAtomic(target, 'candidate', true, observe);
      assert.equal(fs.readFileSync(target, 'utf8'), 'candidate');
      assert.deepEqual(observed, [{ path: target, pre_sha256: null, post_sha256: createHash('sha256').update('candidate').digest('hex') }]);
    }),
  },
  {
    name: '管理操作后段失败仍只记已经落盘的精确文件变化',
    run: () => inProject((project, source) => {
      fs.mkdirSync(path.join(project, 'CLAUDE.md'));
      const signed = issueDesign(project, 'partial-install-author', 'local-ux', false, {
        projectRoot: project, feature: 'opening', executionRole: 'author', phaseOrder: [], domains: [],
        protectedRoots: ['doc/extensions', '.agents', '.claude', 'AGENTS.md'],
        diagnostics: [], unresolvedSourcePhases: [],
      });
      const result = runCli(project, 'install', source, 'ux');
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /路径不是普通文件：CLAUDE\.md/);
      const observations = fs.readFileSync(path.join(signed.runDir, 'events.jsonl'), 'utf8').trim().split('\n')
        .map(line => JSON.parse(line))
        .filter(event => event.type === 'phase_write_observed' && event.producer === 'extension-management');
      assert.equal(observations.length, 1);
      const receipt = observations[0];
      assert.equal(receipt.invoke_id, 'partial-install-author');
      assert.deepEqual(receipt.produced.map((row: { path: string }) => row.path).sort(), [
        '.agents/skills/ux/SKILL.md', '.claude/commands/ux.md', 'AGENTS.md', 'doc/extensions/.gitignore', 'doc/extensions/manifest.yaml',
        'doc/extensions/ux/knowledge/intake.md', 'doc/extensions/ux/manifest.yaml', 'doc/extensions/ux/skills/ux/SKILL.md', 'doc/extensions/ux/skills/ux/reference/stable.md',
      ]);
      for (const row of receipt.produced) {
        assert.equal(row.pre_sha256, null);
        assert.equal(row.post_sha256, createHash('sha256').update(fs.readFileSync(path.join(project, row.path))).digest('hex'));
      }
    }),
  },
  {
    name: '历史检视只读取已接受交回明确链接且字节仍匹配本次执行窗的作者报告',
    run: () => inProject(project => {
      const blueprint = 'doc/features/opening/blueprint';
      const linked = `${blueprint}/author handoff.md`;
      const old = `${blueprint}/old.md`;
      const unlinked = `${blueprint}/unlinked.md`;
      const unrelated = 'doc/other-request.md';
      const report = (artifact: string) => `extension-result: ${JSON.stringify({
        ability: 'ux', binding: 'fill', status: 'generated', artifacts: [artifact],
      })}\n`;
      write(path.join(project, old), report('from-old-request.ux.yaml'));
      const signed = issueDesign(project, 'linked-author', 'local-ux', false, {
        projectRoot: project, feature: 'opening', executionRole: 'author', phaseOrder: [],
        domains: [{ owner: 'initial-design-author', match: 'prefix', kind: 'artifact', path: blueprint, source: 'request' }],
        protectedRoots: [blueprint, unrelated], diagnostics: [], unresolvedSourcePhases: [],
      }, 'session', () => write(path.join(project, unrelated), report('unrelated-before-binding.ux.yaml')));
      write(path.join(project, unrelated), report('unrelated-after-binding.ux.yaml'));
      write(path.join(project, linked), report('from-linked-report.ux.yaml'));
      write(path.join(project, unlinked), report('from-unlinked-report.ux.yaml'));
      const encodedPath = path.join(project, linked).replace(/\\/g, '/').replace(/ /g, '%20');
      acceptSessionExecution({
        runDir: signed.runDir, issued: signed.issued, emit: signed.append,
        report: { phase: signed.phase, status: 'passed', details: `[旧说明](${old}) · [其他任务](${unrelated}) · [本次作者交回](${encodedPath})` },
      });

      assert.deepEqual(inspectExtensionRequest(project, signed.path, 'ux').results, [{
        ability: 'ux', binding: 'fill', status: 'generated', evidence: 'author-report',
        reportedArtifacts: ['from-linked-report.ux.yaml'], reportPath: linked,
      }]);
      write(path.join(project, linked), report('modified-after-acceptance.ux.yaml'));
      const changed = inspectExtensionRequest(project, signed.path, 'ux');
      assert.deepEqual(changed.results, []);
      assert.match(String(changed.message), /未提供可核对/);
    }),
  },
  {
    name: 'CU 作者的已有签发原件占用同一已安装资源，交回后才能清理',
    run: () => inProject((project, source, extensionDir) => {
      state(project, 'install', { source });
      const signed = issueDesign(project, 'cu-author', 'local-ux', true);
      assert.deepEqual(state(project, 'uninstall').requestIds, ['cu-author']);
      assert.equal(inspectExtensionRequest(project, signed.path, 'ux').requestId, 'cu-author');
      signed.append({ type: 'agent_invoke_end', invoke_id: 'cu-author', phase: signed.phase, exit_code: 0 });
      state(project, 'uninstall');
      assert(!fs.existsSync(path.join(extensionDir, 'ux/skills/ux/SKILL.md')));
    }),
  },
  {
    name: '具名 CLI 物化并撤下已接入适配器的入口，逐字节保留宿主手写正文',
    run: () => inProject((project, source) => {
      const handWritten = '# 我的宿主说明\n\n生产设置请参考原文。\n';
      const rootEntry = path.join(project, 'AGENTS.md');
      write(rootEntry, handWritten);
      const first = cli(project, 'install', source, 'ux');
      assert(first.inspection.rows.some((item: { bindingId: string; state: string }) => item.bindingId === 'fill' && item.state === 'scheduled'));
      assert(fs.readFileSync(rootEntry, 'utf8').startsWith(handWritten));
      const generated = path.join(project, '.claude/commands/ux.md');
      assert(fs.existsSync(generated));
      assert(fs.existsSync(path.join(project, '.agents/skills/ux/SKILL.md')));
      const disabled = cli(project, 'disable', 'ux');
      assert(disabled.mutation.closedMaterializations[0].bridges.some((bridge: { filesRemoved: string[] }) => bridge.filesRemoved.includes('.claude/commands/ux.md')));
      assert(!fs.existsSync(generated));
      assert(fs.readFileSync(rootEntry, 'utf8').startsWith(handWritten));
      assert(!fs.readFileSync(rootEntry, 'utf8').includes('skills/ux/SKILL.md'));
    }),
  },
  {
    name: 'same-version drift is refused and an upgraded disabled switch and host changes survive',
    run: () => inProject((project, source, root) => {
      state(project, 'install', { source, noEnable: true });
      const manifest = path.join(source, 'manifest.yaml');
      const offered = YAML.parse(fs.readFileSync(manifest, 'utf8'));
      write(path.join(source, 'knowledge/intake.md'), 'changed in source');
      assert.throws(() => state(project, 'install', { source }), /先升版/);
      write(path.join(root, 'ux/knowledge/intake.md'), 'edited by host');
      offered.version = '2.0.0';
      write(manifest, YAML.stringify(offered));
      assert.throws(() => state(project, 'install', { source }), /宿主改写与来源升级冲突/);
      write(path.join(source, 'knowledge/intake.md'), '# intake\n');
      offered.bindings.new = { ...offered.bindings.read };
      write(manifest, YAML.stringify(offered));
      assert.equal(state(project, 'install', { source }).outcomes[0].state, 'installed');
      const installed = YAML.parse(fs.readFileSync(path.join(root, 'manifest.yaml'), 'utf8')).plugins.ux;
      assert.equal(installed.enabled, false);
      assert.equal(installed.bindings.new, false);
      assert.equal(installed.version, undefined);
      assert(state(project, 'uninstall').retained.some(item => item.path.endsWith('knowledge/intake.md')));
      assert.equal(fs.readFileSync(path.join(root, 'ux/knowledge/intake.md'), 'utf8'), 'edited by host');
    }),
  },
  {
    name: 'install resolves an explicit CLI source from the working directory and stores a project-relative identity',
    run: () => inProject(project => {
      const cwd = path.join(project, 'framework', 'harness');
      fs.mkdirSync(cwd, { recursive: true });
      const sample = 'framework/docs/operations/samples/design-notes';
      fs.cpSync(path.join(frameworkRoot, 'docs/operations/samples/design-notes'), path.join(project, sample), { recursive: true });
      const installed = spawnSync(process.execPath, [
        ...testCliArgs(path.join(frameworkRoot, 'harness/scripts/extension.ts')),
        'install', '../docs/operations/samples/design-notes', '--no-enable', '--project-root', project, '--json',
      ], { cwd, encoding: 'utf8', timeout: 15_000 });
      assert.equal(installed.status, 0, installed.stderr + installed.stdout);
      const registered = loadInstanceExtensions(project, undefined, { frameworkRoot }).plugins['design-notes'];
      assert.equal(registered.source, sample);
      assert.equal(registered.enabled, false);
    }),
  },
  {
    name: 'bare Skill uses only a manual bridge and reinstallation preserves an explicitly edited declaration',
    run: () => inProject((project, source, root) => {
      const bare = path.join(source, 'bare');
      write(path.join(bare, 'SKILL.md'), '---\nname: bare-guide\n---\nCall deliberately.\n');
      write(path.join(bare, 'install.cjs'), 'process.exit(69)');
      cli(project, 'install', bare);
      assert.equal(publishedBindings(project).length, 0);
      assert.equal(cli(project, 'prepare-skill', '--plugin', 'bare-guide', '--skill', 'bare-guide').path,
        'doc/extensions/bare-guide/skills/bare-guide/SKILL.md');
      const manifest = path.join(root, 'bare-guide/manifest.yaml');
      const plugin = YAML.parse(fs.readFileSync(manifest, 'utf8'));
      assert.deepEqual(plugin.provides.skills, ['bare-guide']);
      assert.equal(plugin.activation, undefined);
      plugin.bindings = { fill: { at, kind: 'action', ref: 'bare-guide' } };
      const edited = YAML.stringify(plugin);
      write(manifest, edited);
      cli(project, 'install', bare);
      assert.equal(fs.readFileSync(manifest, 'utf8'), edited);
      assert(!publishedBindings(project)[0].enabled);
    }),
  },
  {
    name: 'upgrade stops new dispatch while in flight, preserves team switch and rolls back failed activation',
    run: () => inProject((project, source, root) => {
      dynamicSource(source, '1.0.0');
      state(project, 'install', { source });
      const active = issueDesign(project, 'upgrade-author', source);
      const old = fs.readFileSync(path.join(root, 'manifest.yaml'));
      const guide = path.join(root, 'ux/knowledge/guide.md');
      dynamicSource(source, '2.0.0', true);
      assert.deepEqual(state(project, 'install', { source }).requestIds, ['upgrade-author']);
      assert.deepEqual(fs.readFileSync(path.join(root, 'manifest.yaml')), old);
      assert.equal(fs.readFileSync(guide, 'utf8'), '1.0.0');
      assert(!prepareExtensionPlugins(project, frameworkRoot, () => ['ux']).bundle.manualSkills.length);
      active.append({ type: 'agent_invoke_end', invoke_id: 'upgrade-author', phase: active.phase });
      const failed = state(project, 'install', { source });
      assert.match(failed.outcomes[0].reason ?? '', /旧版已恢复/);
      assert.equal(fs.readFileSync(guide, 'utf8'), '1.0.0');
      assert(prepareExtensionPlugins(project, frameworkRoot, () => ['ux']).bundle.manualSkills.length);
      dynamicSource(source, '2.0.0');
      assert.equal(state(project, 'install', { source }).outcomes[0].state, 'enabled');
      assert.equal(fs.readFileSync(guide, 'utf8'), '2.0.0');
      assert(!fs.existsSync(path.join(root, '.manifest-upgrades/ux')));
    }),
  },
  {
    name: 'Git keeps handwritten ignores and cleans only managed residuals in deleted and disabled plugins',
    run: () => inProject((project, source, root) => {
      git(project, 'init', '-q');
      dynamicSource(source, '1.0.0');
      write(path.join(root, '.gitignore'), '# handwritten\n/notes/\n');
      state(project, 'install', { source });
      const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      assert(ignore.startsWith('# handwritten\n/notes/\n'));
      const team = path.join(root, 'manifest.yaml');
      const host = YAML.parse(fs.readFileSync(team, 'utf8'));
      host.plugins.ux.enabled = false;
      write(team, YAML.stringify(host));
      assert.equal(prepareExtensionPlugins(project, frameworkRoot, () => []).cleaned[0].state, 'removed');
      assert(!fs.existsSync(path.join(root, 'ux/knowledge/guide.md')));
      state(project, 'uninstall');
      write(path.join(root, 'ux/knowledge/guide.md'), 'local residual');
      write(path.join(root, 'ux/private.md'), 'host-owned');
      assert.equal(cleanupDeletedExtensionPlugins(project, frameworkRoot)[0].state, 'retained');
      assert(fs.existsSync(path.join(root, 'ux/private.md')));
      fs.unlinkSync(path.join(root, 'ux/private.md'));
      assert.equal(cli(project, 'inspect').cleaned[0].state, 'removed');
      assert(!fs.existsSync(path.join(root, 'ux')));
      assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), ignore);
    }),
  },
  {
    name: 'an upgraded local output can become a tracked provider resource',
    run: () => inProject((project, source, root) => {
      git(project, 'init', '-q');
      dynamicSource(source, '1.0.0');
      state(project, 'install', { source });
      const manifest = path.join(source, 'manifest.yaml');
      const raw = YAML.parse(fs.readFileSync(manifest, 'utf8'));
      raw.version = '2.0.0';
      delete raw.activation;
      write(manifest, YAML.stringify(raw));
      write(path.join(source, 'knowledge/guide.md'), 'shared by the provider');
      assert.equal(state(project, 'install', { source }).outcomes[0].state, 'enabled');
      const file = 'doc/extensions/ux/knowledge/guide.md';
      git(project, 'add', '--', file);
      assert.equal(git(project, 'ls-files', '--', file), file);
      assert(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('/ux/knowledge/index.json'));
    }),
  },
  {
    name: 'interrupted upgrade restores original managed resources before retrying the source replacement',
    run: () => inProject((project, source, root) => {
      dynamicSource(source, '1.0.0');
      state(project, 'install', { source });
      const oldSelection = fs.readFileSync(path.join(root, 'manifest.yaml'));
      const removed = 'skills/ux/reference/stable.md';
      const created = 'skills/ux/reference/created.md';
      const installedRemoved = path.join(root, 'ux', removed);
      dynamicSource(source, '2.0.0');
      fs.unlinkSync(path.join(source, removed));
      write(path.join(source, created), 'new resource');
      const hook = path.join(path.dirname(source), 'crash-swap.cjs');
      write(hook, `
        const fs = require('node:fs');
        const unlink = fs.unlinkSync;
        fs.unlinkSync = (target) => {
          unlink(target);
          if (target === ${JSON.stringify(installedRemoved)}) process.exit(87);
        };
      `);
      const harness = path.join(frameworkRoot, 'harness');
      const interrupted = spawnSync(process.execPath, ['-r', hook,
        ...testCliArgs(path.join(harness, 'scripts/extension.ts')), 'install', source, 'ux', '--project-root', project, '--json',
      ], { cwd: harness, encoding: 'utf8', timeout: 15_000 });
      assert.equal(interrupted.status, 87, interrupted.stderr + interrupted.stdout);
      assert.deepEqual(fs.readFileSync(path.join(root, 'manifest.yaml')), oldSelection);
      assert(!fs.existsSync(installedRemoved));
      assert(fs.existsSync(path.join(root, 'ux', created)));
      assert(!prepareExtensionPlugins(project, frameworkRoot, () => ['ux']).bundle.manualSkills.length);
      const upgraded = state(project, 'install', { source });
      assert.equal(upgraded.outcomes[0].state, 'enabled');
      assert(upgraded.filesWritten.includes(`doc/extensions/ux/${created}`));
      assert(upgraded.filesRemoved.includes(`doc/extensions/ux/${removed}`));
      assert(!fs.existsSync(installedRemoved));
      assert.equal(fs.readFileSync(path.join(root, 'ux/knowledge/guide.md'), 'utf8'), '2.0.0');
      assert(!fs.existsSync(path.join(root, '.manifest-upgrades/ux')));
      assert(!fs.existsSync(path.join(root, '.manifest-upgrades/.previous-ux')));
    }),
  },
  {
    name: 'unregistering an in-place plugin keeps the plugin manifest and handwritten resources',
    run: () => inProject((project, source, root) => {
      cli(project, 'init');
      const installed = path.join(root, 'ux');
      fs.cpSync(source, installed, { recursive: true });
      const installedManifest = path.join(installed, 'manifest.yaml');
      const manifest = fs.readFileSync(installedManifest);
      assert.equal(state(project, 'install', { source: installed }).outcomes[0].state, 'enabled');
      assert.equal(state(project, 'uninstall').outcomes[0].state, 'uninstalled');
      assert.deepEqual(fs.readFileSync(installedManifest), manifest);
      assert(fs.existsSync(path.join(installed, 'skills/ux/SKILL.md')));
      assert(!publishedBindings(project).length);
    }),
  },
  {
    name: 'two concurrent manual preparations generate a missing local output once',
    run: () => inProject(async (project, source, root) => {
      dynamicSource(source, '1.0.0');
      const script = path.join(source, 'scripts/make.cjs');
      fs.appendFileSync(script, "if (process.env.EXTENSION_TEST_LOG) fs.appendFileSync(process.env.EXTENSION_TEST_LOG, 'ran\\n');");
      state(project, 'install', { source });
      const guide = path.join(root, 'ux/knowledge/guide.md');
      fs.unlinkSync(guide);
      const harness = path.join(frameworkRoot, 'harness');
      const log = path.join(path.dirname(project), 'output.log');
      const invoke = () => {
        const child = spawn(process.execPath, [...testCliArgs(path.join(harness, 'scripts/extension.ts')),
          'prepare-skill', '--plugin', 'ux', '--skill', 'ux', '--project-root', project],
        { cwd: harness, env: { ...process.env, EXTENSION_TEST_LOG: log }, windowsHide: true });
        let output = '';
        child.stdout.on('data', text => { output += text; });
        child.stderr.on('data', text => { output += text; });
        return once(child, 'close').then(([status]) => assert.equal(status, 0, output));
      };
      await Promise.all([invoke(), invoke()]);
      assert.equal(fs.readFileSync(log, 'utf8'), 'ran\n');
      assert.equal(fs.readFileSync(guide, 'utf8'), '1.0.0');
    }),
  },
  {
    name: 'Git CRLF checkout supports preparation, same-version reinstall, upgrade and owned removal without masking edits',
    run: () => inProject((project, source) => {
      git(project, 'init', '-q');
      git(project, 'config', 'core.autocrlf', 'false');
      const offer = path.join(project, 'offer');
      fs.cpSync(source, offer, { recursive: true });
      dynamicSource(offer, '1.0.0');
      write(path.join(project, '.gitattributes'), '*.dat -text\n');
      write(path.join(offer, 'data.dat'), 'binary-looking-to-git?\npayload\n');
      const extension = 'doc/extensions';
      write(path.join(project, extension, '.gitignore'), '# handwritten rule before\n/host-cache/\n');
      state(project, 'install', { source: offer });
      const manifestA = path.join(project, extension, 'manifest.yaml');
      write(manifestA, fs.readFileSync(manifestA, 'utf8')
        .replace('enabled: true', 'enabled: true # team owns this switch')
        .replace('fill: true', 'fill: true # keep this choice'));
      fs.appendFileSync(path.join(project, extension, '.gitignore'), '# handwritten rule after\n/host-cache-next/\n');
      git(project, 'add', '--all');
      git(project, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
        'commit', '-qm', 'installed with LF');

      const clone = path.join(path.dirname(project), 'crlf-host');
      git(project, 'clone', '-q', '-c', 'core.autocrlf=true', project, clone);
      const plugin = 'doc/extensions/ux';
      const scriptRel = `${plugin}/scripts/make.cjs`;
      const guide = path.join(clone, plugin, 'knowledge/guide.md');
      const script = path.join(clone, scriptRel);
      const data = path.join(clone, plugin, 'data.dat');
      assert(fs.readFileSync(script).includes(Buffer.from('\r\n')));
      assert(!fs.readFileSync(data).includes(Buffer.from('\r\n')));
      assert(!fs.existsSync(guide));
      const prepare = () => prepareExtensionPlugins(clone, frameworkRoot, () => ['ux']).bundle;
      assert.deepEqual(prepare().manualSkills.map(skill => skill.skillId), ['ux']);
      assert.equal(fs.readFileSync(guide, 'utf8'), '1.0.0');
      const teamManifest = path.join(clone, extension, 'manifest.yaml');
      const ignores = path.join(clone, extension, '.gitignore');
      const teamBefore = fs.readFileSync(teamManifest);
      const ignoresBefore = fs.readFileSync(ignores);
      const cloneOffer = path.join(clone, 'offer');
      assert(teamBefore.includes(Buffer.from('\r\n')) && ignoresBefore.includes(Buffer.from('\r\n')));
      assert.equal(git(clone, 'status', '--porcelain=v1'), '');
      const repeat = state(clone, 'install', { source: cloneOffer });
      assert.equal(repeat.changed, false);
      assert.deepEqual(repeat.filesWritten, []);
      assert.deepEqual(fs.readFileSync(teamManifest), teamBefore);
      assert.deepEqual(fs.readFileSync(ignores), ignoresBefore);
      assert.equal(git(clone, 'status', '--porcelain=v1'), '');

      const assertCrlf = (file: string): void => {
        const text = fs.readFileSync(file, 'utf8');
        assert(text.includes('\r\n') && !text.replace(/\r\n/g, '').includes('\n'), file);
      };
      const disabled = state(clone, 'disable');
      assert.equal(disabled.outcomes[0].state, 'disabled');
      assert(disabled.changed);
      assertCrlf(teamManifest);
      assert(!fs.existsSync(guide));
      assert.equal(state(clone, 'enable').outcomes[0].state, 'enabled');
      assert.deepEqual(fs.readFileSync(teamManifest), teamBefore);
      assert.equal(git(clone, 'status', '--porcelain=v1'), '');

      fs.unlinkSync(guide);
      fs.appendFileSync(script, '\r\n// host edit\r\n');
      const modified = prepare();
      assert(modified.errors.some(error => error.message.includes('已安装源文件被改写')));
      assert(!modified.manualSkills.length && !fs.existsSync(guide));
      git(clone, 'restore', '--', scriptRel);
      const bytes = fs.readFileSync(data, 'utf8').replace(/\n/g, '\r\n');
      fs.writeFileSync(data, bytes);
      assert(prepare().errors.some(error => error.message.includes('data.dat')));
      assert.equal(fs.readFileSync(data, 'utf8'), bytes);
      git(clone, 'restore', '--', `${plugin}/data.dat`);

      dynamicSource(cloneOffer, '2.0.0');
      const sourceManifest = path.join(cloneOffer, 'manifest.yaml');
      const v2 = YAML.parse(fs.readFileSync(sourceManifest, 'utf8'));
      v2.activation.steps[0].outputs.push('knowledge/extra.txt');
      write(sourceManifest, YAML.stringify(v2));
      fs.appendFileSync(path.join(cloneOffer, 'scripts/make.cjs'), "fs.writeFileSync('knowledge/extra.txt', 'extra');");
      assert.equal(state(clone, 'install', { source: cloneOffer }).outcomes[0].state, 'enabled');
      assert.equal(fs.readFileSync(guide, 'utf8'), '2.0.0');
      assertCrlf(teamManifest);
      const teamText = fs.readFileSync(teamManifest, 'utf8');
      assert(teamText.includes('enabled: true # team owns this switch'));
      assert(teamText.includes('fill: true # keep this choice'));
      assertCrlf(ignores);
      const ignoreText = fs.readFileSync(ignores, 'utf8');
      assert(ignoreText.startsWith('# handwritten rule before\r\n/host-cache/\r\n'));
      assert(ignoreText.includes('/ux/knowledge/extra.txt\r\n'));
      assert(ignoreText.endsWith('# handwritten rule after\r\n/host-cache-next/\r\n'));
      const hostEdited = path.join(clone, plugin, 'skills/ux/reference/stable.md');
      write(hostEdited, 'host text edit\r\n');
      fs.writeFileSync(data, bytes);
      const removed = state(clone, 'uninstall');
      assert(removed.filesRemoved.includes(`${plugin}/skills/ux/SKILL.md`));
      assert(removed.retained.some(item => item.path === `${plugin}/skills/ux/reference/stable.md`));
      assert(removed.retained.some(item => item.path === `${plugin}/data.dat`));
      assert.equal(fs.readFileSync(hostEdited, 'utf8'), 'host text edit\r\n');
      assert.equal(fs.readFileSync(data, 'utf8'), bytes);
    }),
  },
];

export async function runAll() {
  return runUnitCasesAsync(cases);
}
