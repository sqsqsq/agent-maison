import assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import { loadInstanceExtensions } from '../../extension-loader';
import { detectRepoLayout } from '../../repo-layout';
import { changeExtension, withExtensionWrite, type ExtensionMutation } from '../../scripts/utils/extension-lifecycle';
import { activeExtensionRequests, inspectExtensionRequest } from '../../scripts/utils/extension-requests';
import { writePhaseExecutionRequestMaterial } from '../../scripts/utils/session-execution-handoff';

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
    activeRequests: (ability, source) => activeExtensionRequests(projectRoot, ability, source),
  }));
}

function cli(projectRoot: string, ...words: string[]) {
  const harness = path.join(frameworkRoot, 'harness');
  const child = spawnSync(process.execPath, [
    '-r', require.resolve('ts-node/register/transpile-only'), path.join(harness, 'scripts/extension.ts'),
    ...words, '--project-root', projectRoot, '--json',
  ], { cwd: harness, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

function publishedBindings(projectRoot: string) {
  return loadInstanceExtensions(projectRoot, 'doc/extensions', { frameworkRoot }).bindings;
}

function issueDesign(projectRoot: string, requestId: string, source: string) {
  const feature = 'opening';
  const runId = '20261125T000000Z-abc123';
  const reportDir = `doc/features/${feature}/goal-runs/${runId}`;
  const runDir = path.join(projectRoot, reportDir);
  fs.mkdirSync(runDir, { recursive: true });
  const phase = 'initial-design-author';
  const issuedAt = '2026-11-25T00:01:00Z';
  const owner = { run_id: runId, owner_id: 'writer', epoch: 1, kind: 'session' as const };
  const material = writePhaseExecutionRequestMaterial({
    invokeId: requestId, issuedAt, gateTimeoutMs: 60_000, cleanupReserveMs: 2000,
    preSnapshot: null, writeBoundary: null,
    context: {
      projectRoot, frameworkRoot, feature, runId, runDir, reportDir, phase, workflowId: 'default',
      track: 'full', chain: [phase], attemptId: requestId, adapter: 'generic', owner, childEnv: {},
      runtimeFacts: { receiptRequired: false, resume: false, successor: false },
      workInput: { material: {
        purpose: phase,
        segments: [{ extension_preparation: { at, role: 'author', blueprint_id: feature, bindings: [
          { source, ability: 'ux', id: 'fill', at, kind: 'action', ref: 'ux', delivery: 'action' },
        ] } }],
      } },
    },
  });
  write(path.join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId }));
  const eventsFile = path.join(runDir, 'events.jsonl');
  const append = (event: object): void => fs.appendFileSync(eventsFile, JSON.stringify({ ts: issuedAt, ...event }) + '\n');
  append({ type: 'run_start' });
  append({ type: 'agent_invoke_start', invoke_id: requestId, phase });
  append({ type: 'phase_start', invoke_id: requestId, phase, handoff_request: material.reference, driver: 'session' });
  return { append, phase, path: `${reportDir}/${material.reference.path}` };
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
      assert.throws(() => state(project, 'install', { source }), /已被宿主修改/);
      const exit = state(project, 'uninstall');
      assert(exit.retained.some(item => item.path === 'doc/extensions/knowledge/intake.md'));
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
