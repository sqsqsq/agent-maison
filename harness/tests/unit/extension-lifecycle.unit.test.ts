import { runUnitCasesAsync } from '../utils/unit-cases';
import { testCliArgs } from '../utils/test-cli-args';
import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
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
import { changeExtension, withExtensionWrite, type ExtensionMutation } from '../../scripts/utils/extension-lifecycle';
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
    schema_version: '2.0', name: 'local-ux',
    provides: { skills: ['ux'] },
    bindings: { ux: {
      read: { at, kind: 'knowledge', ref: 'knowledge/intake.md', enabled_by_default: true },
      fill: { at, kind: 'action', ref: 'ux', enabled_by_default: true },
    } },
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
  const output = 'knowledge/ux/guide.md';
  write(path.join(source, 'manifest.yaml'), YAML.stringify({
    schema_version: '2.1', name: 'local-ux', version, provides: { skills: ['ux'] },
    bindings: { ux: {
      read: { at: 'feature.before_phase_work@1', phase: 'coding', kind: 'knowledge', ref: output, enabled_by_default: true },
      fill: { at, kind: 'action', ref: 'ux', enabled_by_default: true },
    } },
    activation: { ux: { steps: [{ id: 'make', cwd: 'skills/ux', run: ['node', 'make.cjs'], outputs: [output] }] } },
  }));
  write(path.join(source, 'skills/ux/make.cjs'), `
    const fs = require('node:fs');
    const path = require('node:path');
    const out = path.join(process.env.MAISON_EXTENSION_ROOT, '${output}');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, '${version}');
    ${fail ? 'process.exit(23);' : ''}
  `);
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
  const binding = { source, ability: 'ux', id: 'fill', at, kind: 'action', ref: 'ux', delivery: 'action',
    path: 'doc/extensions/skills/ux/SKILL.md' };
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
    name: '扩展安装从 1.0 原位迁移、保留原选择、新绑定缺省关闭，并恢复中断落盘',
    run: () => inProject((project, source, extensionDir) => {
      write(path.join(extensionDir, 'manifest.yaml'), [
        '# 宿主注释', 'schema_version: "1.0"', 'name: Existing name', 'description: 宿主说明', 'provides:',
        '  knowledge: [knowledge/host.md]', '  mcp_actions: {}', 'phase_bindings: {}', '',
      ].join('\n'));
      const handWritten = '# facts\n\n手写原样。\n';
      write(path.join(extensionDir, 'knowledge/host.md'), handWritten);
      write(path.join(extensionDir, 'skills/8_Story/SKILL.md'), '# existing\n');
      const one = cli(project, 'install', source, 'ux').mutation;
      assert(one.changed && one.filesWritten.length === 3);
      assert.deepEqual(one.migration, { hostRemoved: ['phase_bindings', 'provides.mcp_actions'] });
      const yaml = path.join(extensionDir, 'manifest.yaml');
      const manifest = () => YAML.parse(fs.readFileSync(yaml, 'utf8'));
      assert.equal(manifest().schema_version, '2.0');
      assert(loadInstanceExtensions(project, undefined, { frameworkRoot }).manifestUsable);
      assert.equal(manifest().name, 'Existing name');
      assert.equal(manifest().phase_bindings, undefined);
      assert.equal(manifest().provides.mcp_actions, undefined);
      assert.deepEqual(manifest().provides.skills, ['8_Story', 'ux']);
      assert.deepEqual(manifest().provides.knowledge, [{ path: 'knowledge/host.md', audience: 'none' }]);
      assert.equal(fs.readFileSync(path.join(extensionDir, 'knowledge/host.md'), 'utf8'), handWritten);
      assert(fs.readFileSync(yaml, 'utf8').includes('# 宿主注释'));
      state(project, 'disable', { binding: 'fill' });
      const oldManifest = fs.readFileSync(yaml);
      const ownedFile = path.join(extensionDir, 'skills/ux/reference/stable.md');
      fs.unlinkSync(ownedFile);
      const repaired = state(project, 'install', { source });
      assert.equal(repaired.migration, undefined);
      assert.deepEqual(repaired.filesWritten, ['doc/extensions/skills/ux/reference/stable.md']);
      assert.deepEqual(fs.readFileSync(yaml), oldManifest);
      const sourceFile = path.join(source, 'manifest.yaml');
      const updated = YAML.parse(fs.readFileSync(sourceFile, 'utf8'));
      updated.bindings.ux.new = { ...updated.bindings.ux.read };
      write(sourceFile, YAML.stringify(updated));
      state(project, 'install', { source });
      assert.deepEqual(manifest().installations.ux.bindings, { read: true, fill: false, new: false });
      assert.deepEqual(publishedBindings(project).map(b => [b.id, b.enabled]), [
        ['read', true], ['fill', false], ['new', false],
      ]);
    }),
  },
  {
    name: '安装回执只报告 1.0 来源实际忽略的声明，保留来源清单原件',
    run: () => inProject((project, source, extensionDir) => {
      const sourceManifest = path.join(source, 'manifest.yaml');
      const original = 'schema_version: "1.0"\nname: local-ux\nprovides:\n  mcp_actions: {}\n';
      write(sourceManifest, original);
      const { mutation } = cli(project, 'install', source, 'ux');
      assert.deepEqual(mutation.migration, { sourceIgnored: ['provides.mcp_actions'] });
      assert.equal(fs.readFileSync(sourceManifest, 'utf8'), original);
      const installed = YAML.parse(fs.readFileSync(path.join(extensionDir, 'manifest.yaml'), 'utf8'));
      assert.equal(installed.provides.mcp_actions, undefined);
      assert.equal(installed.phase_bindings, undefined);
      assert.deepEqual(publishedBindings(project), []);
    }),
  },
  {
    name: '旧 1.0 清单含 2.0 不识别的宿主顶层字段时，安装拒绝迁移且保持清单和资源字节',
    run: () => inProject((project, source, extensionDir) => {
      const manifest = path.join(extensionDir, 'manifest.yaml');
      const story = path.join(extensionDir, 'skills/story/SKILL.md');
      write(manifest, '# 旧宿主扩展注释\nschema_version: "1.0"\nname: wallet\nx-wallet-maintainer-note: 自有备注\n');
      write(story, '# Existing story\n');
      const manifestBefore = fs.readFileSync(manifest);
      const storyBefore = fs.readFileSync(story);
      assert.deepEqual(cli(project, 'verify').inspection.manifestErrors, []);

      const attempted = runCli(project, 'install', source, 'ux');
      assert.equal(attempted.status, 1, attempted.stderr + attempted.stdout);
      assert.match(attempted.stderr, /manifest 2\.0 不支持字段：x-wallet-maintainer-note/);
      assert.deepStrictEqual(fs.readFileSync(manifest), manifestBefore);
      assert.deepStrictEqual(fs.readFileSync(story), storyBefore);
      assert(!fs.existsSync(path.join(extensionDir, 'skills/ux')));
      assert(!fs.existsSync(path.join(extensionDir, 'knowledge')));
      assert(!fs.existsSync(path.join(project, 'AGENTS.md')));
      assert.deepEqual(cli(project, 'verify').inspection.manifestErrors, []);
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
      assert.match(attempted.stderr, /目标 Maison 发布件无法读取 extension manifest 2\.0/);
      assert.equal(fs.readFileSync(manifest, 'utf8'), original);
      assert(!fs.existsSync(path.join(extensionDir, 'skills/ux/SKILL.md')));
    }),
  },
  {
    name: '纯手动能力无 bindings 映射时可同源重装并按归属分别卸载',
    run: () => inProject((project, source, extensionDir) => {
      write(path.join(source, 'manifest.yaml'), YAML.stringify({
        schema_version: '2.0', name: 'manual-pair', provides: { skills: ['qa-before', 'qa-after'] },
      }));
      write(path.join(source, 'skills/qa-before/notes.md'), 'original notes\n');
      for (const ability of ['qa-before', 'qa-after']) {
        write(path.join(source, 'skills', ability, 'SKILL.md'), `# ${ability}\n`);
        assert(state(project, 'install', { source, ability }).changed);
      }
      const manifest = path.join(extensionDir, 'manifest.yaml');
      const before = fs.readFileSync(manifest, 'utf8');
      assert.equal(YAML.parse(before).bindings, undefined);
      const repeated = state(project, 'install', { source, ability: 'qa-before' });
      assert.equal(repeated.changed, false);
      assert.deepEqual(repeated.filesWritten, []);
      assert.equal(fs.readFileSync(manifest, 'utf8'), before);

      const notes = path.join(extensionDir, 'skills/qa-before/notes.md');
      write(notes, 'host notes\n');
      write(path.join(source, 'skills/qa-before/added.md'), 'new asset\n');
      const repaired = state(project, 'install', { source, ability: 'qa-before' });
      assert.deepEqual(repaired.filesWritten, ['doc/extensions/skills/qa-before/added.md']);
      assert.equal(fs.readFileSync(notes, 'utf8'), 'host notes\n');

      const removed = state(project, 'uninstall', { ability: 'qa-before' });
      assert.deepEqual(removed.filesRemoved.sort(),
        ['doc/extensions/skills/qa-before/SKILL.md', 'doc/extensions/skills/qa-before/added.md']);
      assert.equal(fs.readFileSync(notes, 'utf8'), 'host notes\n');
      assert(!fs.existsSync(path.join(extensionDir, 'skills/qa-before/SKILL.md')));
      assert.equal(fs.readFileSync(path.join(extensionDir, 'skills/qa-after/SKILL.md'), 'utf8'), '# qa-after\n');
      const remaining = YAML.parse(fs.readFileSync(manifest, 'utf8'));
      assert.deepEqual(remaining.provides.skills, ['qa-after']);
      assert.deepEqual(Object.keys(remaining.installations), ['qa-after']);
      assert.equal(remaining.bindings, undefined);
      write(manifest, YAML.stringify({ ...remaining, bindings: {} }));
      assert.deepEqual(state(project, 'uninstall', { ability: 'qa-after' }).filesRemoved,
        ['doc/extensions/skills/qa-after/SKILL.md']);
      assert.deepEqual(YAML.parse(fs.readFileSync(manifest, 'utf8')).bindings, {});
    }),
  },
  {
    name: '生命周期拒绝无归属或越界目标，并保护宿主修改与原地来源',
    run: () => inProject((project, source, extensionDir) => {
      const target = path.join(extensionDir, 'knowledge/intake.md');
      write(target, 'private\n');
      assert.throws(() => state(project, 'install', { source }), /无本次安装归属/);
      assert.equal(fs.readFileSync(target, 'utf8'), 'private\n');
      assert(!fs.existsSync(path.join(extensionDir, 'manifest.yaml')));
      fs.unlinkSync(target);
      const outside = path.join(path.dirname(project), 'outside');
      fs.mkdirSync(outside);
      fs.rmdirSync(path.dirname(target));
      fs.symlinkSync(outside, path.dirname(target), process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => state(project, 'install', { source }), /junction|符号链接/);
      assert.deepEqual(fs.readdirSync(outside), []);
      fs.unlinkSync(path.dirname(target));
      const manifest = path.join(extensionDir, 'manifest.yaml');
      const resource = 'doc/extensions/knowledge/intake.md';
      const ownedHash = () => YAML.parse(fs.readFileSync(manifest, 'utf8')).installations.ux.files[resource];
      state(project, 'install', { source });
      const importHash = ownedHash();
      write(target, '# host edit\n');
      write(path.join(extensionDir, 'skills/ux/hand-written.md'), 'host extra\n');
      write(path.join(source, 'skills/ux/reference/added.md'), 'new independent file\n');
      const update = state(project, 'install', { source });
      assert(update.retained.some(item => item.path === resource && item.reason.includes('来源内容未变')));
      assert.deepStrictEqual(update.filesWritten, ['doc/extensions/skills/ux/reference/added.md']);
      assert.equal(fs.readFileSync(target, 'utf8'), '# host edit\n');
      assert.equal(fs.readFileSync(path.join(extensionDir, 'skills/ux/reference/added.md'), 'utf8'), 'new independent file\n');
      assert.equal(ownedHash(), importHash, '原归属仍用于识别宿主定制');

      const beforeConflict = fs.readFileSync(manifest);
      const sourceResource = path.join(source, 'knowledge/intake.md');
      write(sourceResource, '# independent source edit\n');
      write(path.join(source, 'skills/ux/reference/conflict-pending.md'), 'should not be copied\n');
      assert.throws(() => state(project, 'install', { source }), /宿主修改且来源已有不同内容/);
      assert.equal(fs.readFileSync(target, 'utf8'), '# host edit\n');
      assert.equal(fs.readFileSync(sourceResource, 'utf8'), '# independent source edit\n');
      assert.deepStrictEqual(fs.readFileSync(manifest), beforeConflict);
      assert(!fs.existsSync(path.join(extensionDir, 'skills/ux/reference/conflict-pending.md')));

      const exit = state(project, 'uninstall');
      assert(exit.retained.some(item => item.path === 'doc/extensions/knowledge/intake.md'));
      assert(exit.retained.some(item => item.path === 'doc/extensions/skills/ux/hand-written.md'));
      assert.equal(fs.readFileSync(target, 'utf8'), '# host edit\n');
      assert(fs.existsSync(path.join(source, 'skills/ux/SKILL.md')));
      assert(!fs.existsSync(path.join(extensionDir, 'skills/ux/SKILL.md')));
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
      assert(fs.existsSync(path.join(extensionDir, 'skills/ux/SKILL.md')));
      signed.append({ type: 'run_end', status: 'INTERRUPTED' });
      const { mutation, request } = cli(project, 'uninstall', 'ux');
      assert.equal(request, undefined);
      assert.equal(mutation.requestIds, undefined);
      assert.deepEqual(mutation.inactiveRequests, [{
        requestId: 'active-author', runId: testRunId, requestFile: signed.path, reason: '运行已结束（run_end）',
      }]);
      assert(mutation.filesRemoved.includes('doc/extensions/skills/ux/SKILL.md'));
      assert(!fs.existsSync(path.join(extensionDir, 'skills/ux/SKILL.md')));
      const history = inspectExtensionRequest(project, signed.path, 'ux');
      assert.equal(history.settled, false);
      assert.deepEqual(history.results, []);
    }),
  },
  {
    name: '在途签发只保护实质改变的受管动作资源，同字节与无关更新仍可安装',
    run: () => inProject((project, source, extensionDir) => {
      state(project, 'install', { source });
      const signed = issueDesign(project, 'active-update-author', 'local-ux');
      assert.deepEqual(state(project, 'install', { source }).filesWritten, []);
      write(path.join(source, 'knowledge/intake.md'), '# updated independent knowledge\n');
      assert.deepEqual(state(project, 'install', { source }).filesWritten, ['doc/extensions/knowledge/intake.md']);

      const sourceManifest = path.join(source, 'manifest.yaml');
      const declarations = YAML.parse(fs.readFileSync(sourceManifest, 'utf8'));
      declarations.provides.skills.push('neighbor');
      declarations.bindings.neighbor = { read: { ...declarations.bindings.ux.read } };
      write(sourceManifest, YAML.stringify(declarations));
      write(path.join(source, 'skills/neighbor/SKILL.md'), '# unrelated skill\n');
      assert.deepEqual(state(project, 'install', { source, ability: 'neighbor' }).filesWritten,
        ['doc/extensions/skills/neighbor/SKILL.md']);
      write(path.join(source, 'knowledge/intake.md'), '# incompatible shared update\n');
      assert.throws(() => state(project, 'install', { source, ability: 'neighbor' }), /文件被其他能力拥有/);
      assert.equal(fs.readFileSync(path.join(extensionDir, 'knowledge/intake.md'), 'utf8'), '# updated independent knowledge\n');
      write(path.join(source, 'knowledge/intake.md'), '# updated independent knowledge\n');

      const skill = 'skills/ux/SKILL.md';
      const reference = 'skills/ux/reference/stable.md';
      const file = path.join(extensionDir, skill);
      const asset = path.join(extensionDir, reference);
      const manifest = path.join(extensionDir, 'manifest.yaml');
      const before = [file, asset, manifest, path.join(project, signed.path)].map(target => fs.readFileSync(target));
      write(path.join(source, skill), '---\nname: ux\n---\n# updated UX skill\n');
      write(path.join(source, reference), '# updated skill asset\n');
      const deferred = runCli(project, 'install', source, 'ux');
      assert.equal(deferred.status, 1, deferred.stdout + deferred.stderr);
      const output = JSON.parse(deferred.stdout);
      assert.deepEqual(output.mutation.requestIds, ['active-update-author']);
      assert.match(output.mutation.message, /重试安装/);
      assert.deepEqual(output.mutation.retained.map((item: { path: string }) => item.path),
        ['doc/extensions/' + skill, 'doc/extensions/' + reference]);
      assert.deepEqual(output.mutation.filesWritten, []);
      assert.deepEqual([file, asset, manifest, path.join(project, signed.path)].map(target => fs.readFileSync(target)), before);

      signed.append({ type: 'agent_invoke_end', invoke_id: 'active-update-author', phase: signed.phase, exit_code: 0 });
      assert.deepEqual(state(project, 'install', { source }).filesWritten.sort(),
        ['doc/extensions/' + skill, 'doc/extensions/' + reference]);
      assert.equal(fs.readFileSync(asset, 'utf8'), '# updated skill asset\n');
    }),
  },
  {
    name: '缺少旧版版本字段时，同内容重装保持在途绑定，真正升级仍待原签发交回',
    run: () => inProject((project, source, extensionDir) => {
      const sourceManifest = path.join(source, 'manifest.yaml');
      const offered = YAML.parse(fs.readFileSync(sourceManifest, 'utf8'));
      offered.version = '1.0.0';
      write(sourceManifest, YAML.stringify(offered));
      state(project, 'install', { source });
      state(project, 'disable', { binding: 'read' });
      const file = path.join(extensionDir, 'manifest.yaml');
      const installed = () => YAML.parse(fs.readFileSync(file, 'utf8'));
      const legacy = installed();
      delete legacy.installations.ux.version;
      write(file, YAML.stringify(legacy));
      const expectedBindings = publishedBindings(project).map(row => [row.id, row.enabled]);
      const author = issueDesign(project, 'versioned-inflight-author', 'local-ux');

      const same = state(project, 'install', { source });
      assert.deepEqual(same.filesWritten, []);
      assert.equal(same.requestIds, undefined);
      assert.equal(installed().installations.ux.version, '1.0.0');
      assert.equal(installed().installations.ux.pending_cleanup, undefined);
      assert.deepEqual(publishedBindings(project).map(row => [row.id, row.enabled]), expectedBindings);

      offered.version = '2.0.0';
      write(sourceManifest, YAML.stringify(offered));
      const resource = 'skills/ux/reference/stable.md';
      write(path.join(source, resource), '# version two\n');
      assert.deepEqual(state(project, 'install', { source }).requestIds, ['versioned-inflight-author']);
      assert.equal(installed().installations.ux.enabled, false);
      assert.equal(installed().installations.ux.version, '1.0.0');
      assert.equal(fs.readFileSync(path.join(extensionDir, resource), 'utf8'), '# initial\n');
      author.append({ type: 'agent_invoke_end', invoke_id: 'versioned-inflight-author', phase: author.phase, exit_code: 0 });
      assert.equal(state(project, 'install', { source }).outcomes[0].state, 'enabled');
      assert.equal(installed().installations.ux.version, '2.0.0');
      assert.equal(fs.readFileSync(path.join(extensionDir, resource), 'utf8'), '# version two\n');
      assert.deepEqual(publishedBindings(project).map(row => [row.id, row.enabled]), expectedBindings);
    }),
  },
  {
    name: '作者真锁失效后沿原卸载命令完成清理，原签发历史保持可查',
    run: () => inProject(async (project, source, extensionDir) => {
      const asset = 'doc/extensions/skills/ux/reference/stable.md';
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
        assert.deepEqual(state(project, 'install', { source }).requestIds, ['killed-author']);
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
        assert.throws(() => state(project, 'install', { source }), /重试 uninstall ux/);
        const removed = state(project, 'uninstall');
        assert.deepEqual(removed.inactiveRequests, expected);
        assert(removed.filesRemoved.includes(asset));
        assert(!fs.existsSync(path.join(extensionDir, 'skills/ux/SKILL.md')));
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
        '.agents/skills/ux/SKILL.md', '.claude/commands/ux.md', 'AGENTS.md', 'doc/extensions/hooks/.gitkeep',
        'doc/extensions/knowledge/.gitkeep', 'doc/extensions/knowledge/intake.md', 'doc/extensions/manifest.yaml',
        'doc/extensions/skills/.gitkeep', 'doc/extensions/skills/ux/SKILL.md', 'doc/extensions/skills/ux/reference/stable.md',
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
      assert(!fs.existsSync(path.join(extensionDir, 'skills/ux/SKILL.md')));
    }),
  },
  {
    name: '原地来源卸载只撤回参与，保留源声明和字节',
    run: () => inProject((project, source, extensionDir) => {
      fs.cpSync(source, extensionDir, { recursive: true });
      state(project, 'install', { source: extensionDir });
      const exit = state(project, 'uninstall');
      assert(exit.retained.some(item => item.path === 'doc/extensions/skills/ux/SKILL.md'));
      assert.equal(exit.filesRemoved.length, 0);
      const manifest = YAML.parse(fs.readFileSync(path.join(extensionDir, 'manifest.yaml'), 'utf8'));
      assert(manifest.bindings.ux.fill);
      assert.equal(manifest.installations.ux.enabled, false);
      assert(publishedBindings(project).every(b => !b.enabled));
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
      assert(disabled.mutation.materialization.bridges.some((bridge: { filesRemoved: string[] }) => bridge.filesRemoved.includes('.claude/commands/ux.md')));
      assert(!fs.existsSync(generated));
      assert(fs.readFileSync(rootEntry, 'utf8').startsWith(handWritten));
      assert(!fs.readFileSync(rootEntry, 'utf8').includes('skills/ux/SKILL.md'));
    }),
  },
  {
    name: '裸 Skill 按 frontmatter 名称发布手动入口，同源重装保留宿主阶段声明且不运行包内命令',
    run: () => inProject((project, source, extensionDir) => {
      const bare = path.join(path.dirname(source), 'unrelated-folder-name');
      const skill = '---\nname: bare-guide\ndescription: 读取指南\n---\n# 在编码前读说明\n';
      write(path.join(bare, 'SKILL.md'), skill);
      write(path.join(bare, 'guide.md'), '# Handled by the owner\n');
      write(path.join(bare, 'package.json'), '{"scripts":{"install":"node run.cjs"}}');
      write(path.join(bare, 'run.cjs'), 'require("node:fs").writeFileSync("ran", "bad");');
      write(path.join(bare, '.git'), 'gitdir: D:/other/local-metadata\n');
      write(path.join(bare, 'reference/.git/HEAD'), 'ref: refs/heads/main\n');
      write(path.join(bare, 'reference/example.md'), '# Available reference\n');
      write(path.join(bare, 'node_modules/bundled/index.cjs'), 'module.exports = true;');
      const installed = cli(project, 'install', bare);
      assert.equal(installed.mutation.outcomes[0].ability, 'bare-guide');
      assert.equal(installed.mutation.outcomes[0].state, 'enabled');
      assert(fs.existsSync(path.join(project, '.claude/commands/bare-guide.md')));
      assert.deepEqual(publishedBindings(project), []);
      assert.equal(fs.readFileSync(path.join(extensionDir, 'skills/bare-guide/SKILL.md'), 'utf8'), skill);
      const manifest = path.join(extensionDir, 'manifest.yaml');
      const raw = YAML.parse(fs.readFileSync(manifest, 'utf8'));
      raw.bindings = { 'bare-guide': { guide: {
        at: 'feature.before_phase_work@1', phase: 'coding', kind: 'knowledge', ref: 'skills/bare-guide/guide.md',
      } } };
      write(manifest, YAML.stringify(raw));
      cli(project, 'enable', 'bare-guide', 'guide', '--phase', 'review');
      const accepted = fs.readFileSync(manifest, 'utf8');
      assert.equal(cli(project, 'install', bare).mutation.changed, false);
      assert.equal(fs.readFileSync(manifest, 'utf8'), accepted);
      assert.deepEqual(publishedBindings(project).map(row => [row.id, row.phase, row.enabled]), [['guide', 'review', true]]);
      assert(!fs.existsSync(path.join(bare, 'ran')) && !fs.existsSync(path.join(extensionDir, 'skills/bare-guide/ran')));
      assert(!fs.existsSync(path.join(extensionDir, 'skills/bare-guide/.git')));
      assert(!fs.existsSync(path.join(extensionDir, 'skills/bare-guide/reference/.git')));
      assert(fs.existsSync(path.join(extensionDir, 'skills/bare-guide/node_modules/bundled/index.cjs')));
      assert.deepEqual(fs.readdirSync(bare).sort(), ['.git', 'SKILL.md', 'guide.md', 'node_modules', 'package.json', 'reference', 'run.cjs']);
    }),
  },
  {
    name: '改写或无法核实的输出不下架现有启用，单纯缺失可显式补齐',
    run: () => inProject((project, source, extensionDir) => {
      dynamicSource(source, '1.0.0');
      const sourceManifest = path.join(source, 'manifest.yaml');
      const offered = YAML.parse(fs.readFileSync(sourceManifest, 'utf8'));
      offered.activation.ux.steps[0].outputs.push('knowledge/ux/healthy.md');
      write(sourceManifest, YAML.stringify(offered));
      fs.appendFileSync(path.join(source, 'skills/ux/make.cjs'), '\nfs.writeFileSync(path.join(path.dirname(out), "healthy.md"), "still active");\n');
      cli(project, 'install', source, 'ux');
      const guide = path.join(extensionDir, 'knowledge/ux/guide.md');
      const healthy = path.join(extensionDir, 'knowledge/ux/healthy.md');
      const file = path.join(extensionDir, 'manifest.yaml');
      const before = fs.readFileSync(file);
      const previous = YAML.parse(before.toString()).installations.ux.activation_result.instance_id;

      write(guide, 'host edit');
      for (const kind of ['changed', 'unverifiable']) {
        if (kind === 'unverifiable') {
          fs.unlinkSync(guide);
          fs.symlinkSync(path.dirname(source), guide, process.platform === 'win32' ? 'junction' : 'dir');
        }
        const failed = runCli(project, 'enable', 'ux');
        assert.equal(failed.status, 1, failed.stderr + failed.stdout);
        assert(!failed.stderr.includes('[extension activation]'));
        const receipt = JSON.parse(failed.stdout).mutation;
        assert.equal(receipt.changed, false);
        assert.equal(receipt.outcomes[0].activation.instance_id, previous);
        assert.match(receipt.outcomes[0].reason, /knowledge\/ux\/guide\.md/);
        assert.deepEqual(fs.readFileSync(file), before);
        assert(fs.existsSync(path.join(project, '.claude/commands/ux.md')));
        assert.equal(publishedBindings(project).find(row => row.id === 'fill')?.enabled, true);
        assert.equal(fs.readFileSync(healthy, 'utf8'), 'still active');
        if (kind === 'changed') assert.equal(fs.readFileSync(guide, 'utf8'), 'host edit');
        else assert(fs.lstatSync(guide).isSymbolicLink());
      }
      fs.unlinkSync(guide);
      const installedScript = path.join(extensionDir, 'skills/ux/make.cjs');
      const script = fs.readFileSync(installedScript, 'utf8');
      write(installedScript, '# host modified the input script');
      const invalidInput = runCli(project, 'enable', 'ux');
      assert.equal(invalidInput.status, 1);
      assert.match(invalidInput.stderr, /已安装源文件被改写/);
      assert.deepEqual(fs.readFileSync(file), before);
      write(installedScript, script);
      assert.equal(cli(project, 'enable', 'ux').mutation.outcomes[0].state, 'enabled');
      assert.equal(fs.readFileSync(guide, 'utf8'), '1.0.0');
      assert.notEqual(YAML.parse(fs.readFileSync(file, 'utf8')).installations.ux.activation_result.instance_id, previous);
    }),
  },
  {
    name: '动态只安装和显式启用，变更阶段复用结果，在途关闭即回执，原命令重试才清理',
    run: () => inProject((project, source, extensionDir) => {
      dynamicSource(source, '1.0.0');
      const output = path.join(extensionDir, 'knowledge/ux/guide.md');
      const manifest = () => YAML.parse(fs.readFileSync(path.join(extensionDir, 'manifest.yaml'), 'utf8'));
      const onlyInstall = cli(project, 'install', source, 'ux', '--no-enable');
      assert.equal(onlyInstall.mutation.outcomes[0].state, 'installed');
      assert(publishedBindings(project).every(row => !row.enabled));
      assert(!fs.existsSync(output));
      assert(!fs.existsSync(path.join(project, '.claude/commands/ux.md')));
      const enabled = runCli(project, 'enable', 'ux');
      assert.equal(enabled.status, 0, enabled.stderr + enabled.stdout);
      assert.match(enabled.stderr, /\[extension activation\].*make\.cjs/);
      const instance = manifest().installations.ux.activation_result.instance_id;
      assert.equal(fs.readFileSync(output, 'utf8'), '1.0.0');
      assert(fs.existsSync(path.join(project, '.claude/commands/ux.md')));
      const moved = runCli(project, 'enable', 'ux', 'read', '--at', 'feature.before_phase_work@1', '--phase', 'review');
      assert.equal(moved.status, 0, moved.stderr + moved.stdout);
      assert(!moved.stderr.includes('[extension activation]'));
      assert.equal(manifest().installations.ux.activation_result.instance_id, instance);
      assert.deepEqual(publishedBindings(project).filter(row => row.id === 'read').map(row => [row.phase, row.enabled]), [['review', true]]);
      const author = issueDesign(project, 'still-running', 'local-ux');
      assert.equal(cli(project, 'disable', 'ux', 'read').mutation.requestIds, undefined);
      const deferred = runCli(project, 'disable', 'ux');
      assert.equal(deferred.status, 1, deferred.stderr + deferred.stdout);
      const mutation = JSON.parse(deferred.stdout).mutation;
      assert.deepEqual(mutation.requestIds, ['still-running']);
      assert.deepEqual(mutation.outcomes[0].pending.command, ['disable', 'ux']);
      assert(!fs.existsSync(path.join(project, '.claude/commands/ux.md')));
      assert(publishedBindings(project).every(item => !item.enabled));
      assert.equal(fs.readFileSync(output, 'utf8'), '1.0.0');
      author.append({ type: 'run_end', status: 'INTERRUPTED' });
      assert.deepEqual(cli(project, 'inspect', 'ux').inspection.installations[0].pendingCleanup.requestIds, []);
      cli(project, 'disable', 'ux');
      assert(!fs.existsSync(output));
      assert.equal(manifest().installations.ux.pending_cleanup, undefined);
      cli(project, 'enable', 'ux');
      assert.notEqual(manifest().installations.ux.activation_result.instance_id, instance);
      assert.equal(publishedBindings(project).find(row => row.id === 'read')?.enabled, false);
    }),
  },
  {
    name: '动态升级提交前恢复旧资源和启用，提交后失败保留新版，重试可修复',
    run: () => inProject((project, source, extensionDir) => {
      dynamicSource(source, '1.0.0');
      const asset = path.join(extensionDir, 'skills/ux/make.cjs');
      const output = path.join(extensionDir, 'knowledge/ux/guide.md');
      const manifest = () => YAML.parse(fs.readFileSync(path.join(extensionDir, 'manifest.yaml'), 'utf8')).installations.ux;
      const before = state(project, 'install', { source });
      assert.equal(before.outcomes[0].state, 'enabled');
      const oldScript = fs.readFileSync(asset, 'utf8');
      dynamicSource(source, '2.0.0', true);
      const rename = fs.renameSync;
      let injected = false;
      const fault = mock.method(require('fs') as typeof fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
        if (!injected && path.basename(String(to)) === 'make.cjs') {
          injected = true;
          throw new Error('injected swap failure');
        }
        return rename(from, to);
      });
      try {
        const restored = state(project, 'install', { source });
        assert.equal(restored.outcomes[0].state, 'failed');
        assert.match(restored.outcomes[0].reason ?? '', /injected swap failure.*已恢复旧版文件和原开关/);
      } finally { fault.mock.restore(); }
      assert(injected);
      assert.equal(manifest().version, '1.0.0');
      assert.equal(manifest().enabled, true);
      assert.equal(fs.readFileSync(asset, 'utf8'), oldScript);
      assert.equal(fs.readFileSync(output, 'utf8'), '1.0.0');
      const failed = state(project, 'install', { source });
      assert.equal(failed.outcomes[0].state, 'failed');
      assert.match(failed.outcomes[0].reason ?? '', /23/);
      assert.equal(manifest().version, '2.0.0');
      assert.equal(manifest().enabled, false);
      assert(!fs.existsSync(output));
      dynamicSource(source, '2.0.1');
      assert.equal(state(project, 'install', { source }).outcomes[0].state, 'installed');
      assert.equal(state(project, 'enable').outcomes[0].state, 'enabled');
      assert.equal(fs.readFileSync(output, 'utf8'), '2.0.1');
    }),
  },
  {
    name: '受管作者无持久写权，多能力安装单项失败仍保留相邻手动能力',
    run: () => inProject((project, source, extensionDir) => {
      dynamicSource(source, '1.0.0', true);
      const sourceManifest = path.join(source, 'manifest.yaml');
      const raw = YAML.parse(fs.readFileSync(sourceManifest, 'utf8'));
      raw.provides.skills.push('story');
      write(sourceManifest, YAML.stringify(raw));
      write(path.join(source, 'skills/story/SKILL.md'), '# Story');
      const prior = process.env.MAISON_GOAL_RUN_ID;
      process.env.MAISON_GOAL_RUN_ID = 'managed-author';
      try {
        const rejected = runCli(project, 'install', source);
        assert.equal(rejected.status, 1);
        assert.match(rejected.stderr, /受管 Goal 作者只能检视或校验扩展/);
        assert(!fs.existsSync(path.join(extensionDir, 'manifest.yaml')));
      } finally {
        if (prior === undefined) delete process.env.MAISON_GOAL_RUN_ID;
        else process.env.MAISON_GOAL_RUN_ID = prior;
      }
      const merged = runCli(project, 'install', source);
      assert.equal(merged.status, 1, merged.stderr + merged.stdout);
      assert.deepEqual(JSON.parse(merged.stdout).mutation.outcomes.map((row: { ability: string; state: string }) => [row.ability, row.state]), [
        ['story', 'enabled'], ['ux', 'failed'],
      ]);
      assert(fs.existsSync(path.join(project, '.claude/commands/story.md')));
      assert(!fs.existsSync(path.join(project, '.claude/commands/ux.md')));
      assert(!fs.existsSync(path.join(extensionDir, 'knowledge/ux/guide.md')));
    }),
  },
  {
    name: '升级资源替换期间中断，原安装入口可恢复新增及删除的文件再提交新版',
    run: () => inProject((project, source, extensionDir) => {
      dynamicSource(source, '1.0.0');
      state(project, 'install', { source });
      const removed = 'skills/ux/reference/stable.md';
      const created = 'skills/ux/reference/created.md';
      const restored = 'skills/ux/reference/restored.md';
      const installedRemoved = path.join(extensionDir, removed);
      dynamicSource(source, '2.0.0');
      fs.unlinkSync(path.join(source, removed));
      write(path.join(source, created), 'new resource');
      write(path.join(source, restored), 'second new resource');

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
      const manifest = () => YAML.parse(fs.readFileSync(path.join(extensionDir, 'manifest.yaml'), 'utf8')).installations.ux;
      const saved = manifest();
      assert.equal(saved.version, '1.0.0');
      assert.equal(saved.enabled, false);
      const records = saved.pending_cleanup.replacement.files as Array<{ path: string; before?: string; after?: string }>;
      assert.deepEqual(Object.keys(records.find(item => item.path === created)!).sort(), ['after', 'path']);
      assert.deepEqual(Object.keys(records.find(item => item.path === removed)!).sort(), ['before', 'path']);
      assert(!fs.existsSync(installedRemoved));
      assert.equal(fs.readFileSync(path.join(extensionDir, created), 'utf8'), 'new resource');

      // An interrupted recovery can already have removed one newly published file.
      fs.unlinkSync(path.join(extensionDir, restored));
      const upgraded = state(project, 'install', { source });
      assert.equal(upgraded.outcomes[0].state, 'enabled');
      assert(upgraded.filesWritten.includes(`doc/extensions/${removed}`));
      assert(upgraded.filesRemoved.includes(`doc/extensions/${created}`));
      assert.equal(manifest().pending_cleanup, undefined);
      assert.equal(manifest().version, '2.0.0');
      assert(!fs.existsSync(installedRemoved));
      assert.equal(fs.readFileSync(path.join(extensionDir, 'knowledge/ux/guide.md'), 'utf8'), '2.0.0');
    }),
  },
];

export async function runAll() {
  return runUnitCasesAsync(cases);
}
