import assert from 'assert';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import { loadInstanceExtensions } from '../../extension-loader';
import { detectRepoLayout } from '../../repo-layout';
import { changeExtension, withExtensionWrite, type ExtensionMutation } from '../../scripts/utils/extension-lifecycle';
import { inspectExtensionRequest } from '../../scripts/utils/extension-requests';
import { acceptSessionExecution, capturePhaseBinding, writePhaseExecutionRequestMaterial } from '../../scripts/utils/session-execution-handoff';
import { casAcquireRunOwner, ensureRunControl } from '../../scripts/utils/goal-run-control';
import { capturePhaseInvocationSnapshot, type PhaseWriteBoundaryResolution } from '../../scripts/utils/phase-write-boundary';

const frameworkRoot = detectRepoLayout(__dirname).frameworkRoot;
const at = 'component-design.before_discovery@1';

function write(file: string, bytes: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function inProject(body: (projectRoot: string, source: string, extensionDir: string) => void): void {
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
    body(project, source, extensionDir);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function state(projectRoot: string, action: ExtensionMutation, opts: { ability?: string; source?: string; binding?: string } = {}) {
  return withExtensionWrite(projectRoot, frameworkRoot, () => changeExtension(action, {
    projectRoot, frameworkRoot, ability: 'ux', ...opts,
  }));
}

function runCli(projectRoot: string, ...words: string[]) {
  const harness = path.join(frameworkRoot, 'harness');
  return spawnSync(process.execPath, [
    '-r', require.resolve('ts-node/register/transpile-only'), path.join(harness, 'scripts/extension.ts'),
    ...words, '--project-root', projectRoot, '--json',
  ], { cwd: harness, encoding: 'utf8' });
}

function cli(projectRoot: string, ...words: string[]) {
  const child = runCli(projectRoot, ...words);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

function publishedBindings(projectRoot: string) {
  return loadInstanceExtensions(projectRoot, 'doc/extensions', { frameworkRoot }).bindings;
}

function issueDesign(projectRoot: string, requestId: string, source: string, cu = false,
  boundary: PhaseWriteBoundaryResolution | null = null) {
  const feature = 'opening';
  const runId = '20261125T000000Z-abc123';
  const workspace = cu ? `${feature}/unit-1` : feature;
  if (cu) write(path.join(projectRoot, 'doc/features', workspace, 'change-unit.yaml'), 'id: unit-1\n');
  const reportDir = `doc/features/${workspace}/goal-runs/${runId}`;
  const runDir = path.join(projectRoot, reportDir);
  fs.mkdirSync(runDir, { recursive: true });
  const phase = cu ? 'work-unit-author' : 'initial-design-author';
  const issuedAt = '2026-11-25T00:01:00Z';
  const owner = { run_id: runId, owner_id: 'writer', epoch: 1, kind: 'session' as const };
  const binding = { source, ability: 'ux', id: 'fill', at, kind: 'action', ref: 'ux', delivery: 'action',
    path: 'doc/extensions/skills/ux/SKILL.md' };
  if (boundary) {
    ensureRunControl(runDir, runId);
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
  append({ type: 'agent_invoke_start', invoke_id: requestId, phase });
  const event = { type: 'phase_start', invoke_id: requestId, phase, handoff_request: material.reference, driver: 'session',
    owner_id: owner.owner_id, owner_epoch: owner.epoch, attempt_id: requestId };
  append(event);
  const issued = { ...material, event };
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
        '  knowledge: [knowledge/host.md]', '  mcp_actions: {}', '',
      ].join('\n'));
      const handWritten = '# facts\n\n手写原样。\n';
      write(path.join(extensionDir, 'knowledge/host.md'), handWritten);
      write(path.join(extensionDir, 'skills/8_Story/SKILL.md'), '# existing\n');
      const one = state(project, 'install', { source });
      assert(one.changed && one.filesWritten.length === 3);
      const yaml = path.join(extensionDir, 'manifest.yaml');
      const manifest = () => YAML.parse(fs.readFileSync(yaml, 'utf8'));
      assert.equal(manifest().schema_version, '2.0');
      assert.equal(manifest().name, 'Existing name');
      assert.deepEqual(manifest().provides.skills, ['8_Story', 'ux']);
      assert.deepEqual(manifest().provides.knowledge, [{ path: 'knowledge/host.md', audience: 'none' }]);
      assert.equal(fs.readFileSync(path.join(extensionDir, 'knowledge/host.md'), 'utf8'), handWritten);
      assert(fs.readFileSync(yaml, 'utf8').includes('# 宿主注释'));
      state(project, 'disable', { binding: 'fill' });
      const oldManifest = fs.readFileSync(yaml);
      const ownedFile = path.join(extensionDir, 'skills/ux/reference/stable.md');
      fs.unlinkSync(ownedFile);
      const repaired = state(project, 'install', { source });
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
    name: '外置新版管理 CLI 先核宿主实际发布件 reader，旧版清单与文件原样保留',
    run: () => inProject((project, source, extensionDir) => {
      const manifest = path.join(extensionDir, 'manifest.yaml');
      const original = '# 宿主原清单\nschema_version: "1.0"\nname: host\n';
      write(manifest, original);
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
      state(project, 'install', { source });
      write(target, '# host edit\n');
      write(path.join(extensionDir, 'skills/ux/hand-written.md'), 'host extra\n');
      assert.throws(() => state(project, 'install', { source }), /已被宿主修改/);
      const exit = state(project, 'uninstall');
      assert(exit.retained.some(item => item.path === 'doc/extensions/knowledge/intake.md'));
      assert(exit.retained.some(item => item.path === 'doc/extensions/skills/ux/hand-written.md'));
      assert.equal(fs.readFileSync(target, 'utf8'), '# host edit\n');
      assert(fs.existsSync(path.join(source, 'skills/ux/SKILL.md')));
      assert(!fs.existsSync(path.join(extensionDir, 'skills/ux/SKILL.md')));
    }),
  },
  {
    name: '卸载通过原始签发绑定保留资源到当前请求交回，停用只影响新请求',
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
      signed.append({ type: 'run_end', status: 'waiting' });
      assert.deepEqual(state(project, 'uninstall').requestIds, ['active-author']);
      assert(fs.existsSync(path.join(extensionDir, 'skills/ux/SKILL.md')));
      signed.append({ type: 'agent_invoke_end', invoke_id: 'active-author', phase: signed.phase, exit_code: 0 });
      assert.equal(inspectExtensionRequest(project, signed.path, 'ux').settled, true);
      assert(state(project, 'uninstall').filesRemoved.includes('doc/extensions/skills/ux/SKILL.md'));
      assert(!fs.existsSync(path.join(extensionDir, 'skills/ux/SKILL.md')));
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
      const report = (artifact: string) => `extension-result: ${JSON.stringify({
        ability: 'ux', binding: 'fill', status: 'generated', artifacts: [artifact],
      })}\n`;
      write(path.join(project, old), report('from-old-request.ux.yaml'));
      const signed = issueDesign(project, 'linked-author', 'local-ux', false, {
        projectRoot: project, feature: 'opening', executionRole: 'author', phaseOrder: [], domains: [],
        protectedRoots: [blueprint], diagnostics: [], unresolvedSourcePhases: [],
      });
      write(path.join(project, linked), report('from-linked-report.ux.yaml'));
      write(path.join(project, unlinked), report('from-unlinked-report.ux.yaml'));
      const encodedPath = path.join(project, linked).replace(/\\/g, '/').replace(/ /g, '%20');
      acceptSessionExecution({
        runDir: signed.runDir, issued: signed.issued, emit: signed.append,
        report: { phase: signed.phase, status: 'passed', details: `[旧说明](${old}) · [本次作者交回](${encodedPath})` },
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
];

export function runAll() {
  return cases.map(item => {
    try { item.run(); return { name: item.name, ok: true }; }
    catch (error) { return { name: item.name, ok: false, error: (error as Error).stack }; }
  });
}
