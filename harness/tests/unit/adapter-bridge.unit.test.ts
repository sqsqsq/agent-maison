import { beginUnitCase, discoveryResult } from '../utils/unit-cases';
// ============================================================================
// adapter-bridge — 包内 Skill 登记与 bridge id 冲突解析
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import * as YAML from 'yaml';
import {
  emitInstanceSkillBridge,
  type EmitInstanceSkillBridgeResult,
  formatExtensionSkillSectionMarkdown,
  loadReservedBridgeIds,
  inspectInstanceSkillBridgeArtifacts,
  resolveBridgeTargets,
  extensionSkillRows,
} from '../../scripts/utils/instance-skill-bridge';
import { putPlugin } from './extension-test-fixture';
import { loadInstanceExtensions } from '../../extension-loader';
import { detectRepoLayout } from '../../repo-layout';
import { clearFrameworkConfigCache } from '../../config';
import { resolveRenderBridgeAdapters } from '../../scripts/render-agents-md';
import { materializeExtensions } from '../../scripts/extension';
import { git, provisionFrameworkUnder } from '../utils/real-chain-host';

const FRAMEWORK_DIR = detectRepoLayout(__dirname).frameworkRoot;

function minimalArch(): Record<string, unknown> {
  return {
    outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
    module_inner_layers: ['shared'],
    inner_dependency_direction: 'upward',
    cross_module_exports_file: 'index.ets',
  };
}

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function write(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
}

const skills = (root: string) => loadInstanceExtensions(root).manualSkills;
function putSkill(root: string, id: string, content: string) {
  putPlugin(root, 'provider-' + id, { declaration: { provides: { skills: [id] } }, files: { [`skills/${id}/SKILL.md`]: content } });
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '--all-materialized-adapters 只读项目数组并去重，不回退 personal agent_adapter',
    run: () => {
      assert.deepStrictEqual(
        resolveRenderBridgeAdapters({ agent_adapter: 'generic', materialized_adapters: ['cursor', 'claude', 'cursor'] }, true),
        ['cursor', 'claude'],
      );
      assert.throws(() => resolveRenderBridgeAdapters({ agent_adapter: 'claude' }, true), /materialized_adapters/);
    },
  },
  {
    name: 'extensionSkillRows：无扩展目录 → 空数组',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
      const rows = extensionSkillRows(dir, skills(dir));
      assert.deepStrictEqual(rows, []);
    },
  },
  {
    name: 'extensionSkillRows：单个 SKILL.md → 一行',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
      putSkill(dir, 'wallet-sdk-onboarding', '# Demo\n');
      const rows = extensionSkillRows(dir, skills(dir));
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].sourceSlug, 'wallet-sdk-onboarding');
      assert(
        rows[0].skillMdRepoRel.replace(/\\/g, '/').endsWith('doc/extensions/provider-wallet-sdk-onboarding/skills/wallet-sdk-onboarding/SKILL.md'),
      );
    },
  },
  {
    name: 'resolveBridgeTargets：与预留名冲突 → ext- 前缀 + 告警 + 小节含原名',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
      putSkill(dir, 'coding', '# collide\n');
      const rows = extensionSkillRows(dir, skills(dir));
      const reserved = loadReservedBridgeIds(FRAMEWORK_DIR);
      assert.strictEqual(reserved.has('coding'), true);
      const { targets, warnings } = resolveBridgeTargets(rows, reserved);
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0].conflict, true);
      assert.strictEqual(targets[0].bridgeId.startsWith('ext-'), true);
      assert(warnings.some(w => w.includes('冲突')));
      const md = formatExtensionSkillSectionMarkdown(targets);
      assert(md.includes('原名'));
      assert(md.includes('coding'));
    },
  },
  {
    // 缺口②回归：config 残留 inline 时，扩展 skill 仍产出 bridge 薄跳板（不再 inline 全量正文）
    name: 'emitInstanceSkillBridge(generic)：config inline 仍产出 bridge 薄跳板',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-bridge-'));
      write(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'ext-bridge',
            agent_adapter: 'generic',
            materialized_adapters: ['generic'],
            architecture: minimalArch(),
            paths: {
              features_dir: 'doc/features',
              agent_bundle_root: '.agents',
              agent_bundle_skill_mode: 'inline',
            },
          },
          null,
          2,
        ),
      );
      putSkill(root, 'wallet-sdk-onboarding',
        '---\nname: wallet-sdk-onboarding\n---\n\n# 正文\n\nFULL-BODY-MARKER-不应出现在薄跳板\n');

      clearFrameworkConfigCache();
      const res = emitInstanceSkillBridge({
        repoRoot: root, skills: skills(root),
        frameworkDir: FRAMEWORK_DIR,
        agentAdapter: 'generic',
      });
      const stubAbs = path.join(root, '.agents/skills/wallet-sdk-onboarding/SKILL.md');
      assert(res.filesWritten.some(f => f.endsWith('wallet-sdk-onboarding/SKILL.md')));
      const stub = fs.readFileSync(stubAbs, 'utf8');
      assert(stub.includes('prepare-skill --plugin provider-wallet-sdk-onboarding --skill wallet-sdk-onboarding'), 'should be a bridge stub');
      assert(!stub.includes('FULL-BODY-MARKER'), 'must NOT inline full body');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'materialized_adapters：所有 adapter 都产出 ownership bridge，重复运行字节幂等',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-multi-'));
      write(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1', project_name: 'ext-multi', materialized_adapters: ['cursor', 'claude'],
          architecture: minimalArch(), paths: { features_dir: 'doc/features' },
        }),
      );
      putSkill(root, 'customer-context', '# Customer context\n');
      const first = ['cursor', 'claude'].map(agentAdapter => emitInstanceSkillBridge({
        repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter,
      }));
      assert(first.every(result => result.filesWritten.length === 1));
      const cursor = fs.readFileSync(path.join(root, '.cursor/skills/customer-context/SKILL.md'), 'utf8');
      const claude = fs.readFileSync(path.join(root, '.claude/commands/customer-context.md'), 'utf8');
      assert(cursor.includes('agent-maison:instance-extension-bridge') && cursor.includes('prepare-skill --plugin provider-customer-context'));
      assert(claude.includes('agent-maison:instance-extension-bridge') && claude.includes('仅在命令成功后'));
      const second = ['cursor', 'claude'].map(agentAdapter => emitInstanceSkillBridge({
        repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter,
      }));
      assert(second.every(result => result.filesWritten.length === 0), 'canonical bytes must not be rewritten');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: '宿主从生成的 Skill 桥执行 npm 命令，准备登记插件下的 Skill',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-bridge-command-'));
      try {
        const { frameworkRoot } = provisionFrameworkUnder(root, { linkDependencies: true });
        write(path.join(root, 'framework.config.json'), JSON.stringify({ project_profile: { name: 'generic' } }));
        putSkill(root, 'customer-context', '# Customer context\n');
        const emitted = emitInstanceSkillBridge({
          repoRoot: root, frameworkDir: frameworkRoot, agentAdapter: 'cursor', skills: skills(root),
        });
        const bridge = '.cursor/skills/customer-context/SKILL.md';
        assert(emitted.filesWritten.includes(bridge));
        const markdown = fs.readFileSync(path.join(root, bridge), 'utf8');
        const command = /^~~~shell\n([^\n]+)\n~~~$/m.exec(markdown)?.[1];
        assert(command, '生成的桥必须提供可执行的准备命令');
        const result = spawnSync(command, { cwd: root, encoding: 'utf8', shell: true, timeout: 20_000, windowsHide: true });
        assert.strictEqual(result.status, 0, String(result.error ?? (result.stderr + result.stdout)));
        assert.strictEqual(JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))).path,
          'doc/extensions/provider-customer-context/skills/customer-context/SKILL.md');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'Chrys 与 Generic 共享桥目录，旧标记只迁一次、双方检视生效且漂移保留',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-shared-bridge-'));
      try {
        const adapters = ['chrys', 'generic'];
        write(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1', project_name: 'extension-shared', materialized_adapters: adapters,
          architecture: minimalArch(), paths: { features_dir: 'doc/features', agent_bundle_root: '.agents' },
        }));
        const targetRel = '.agents/skills/shared-extension/SKILL.md';
        const target = path.join(root, targetRel);
        const options = (agentAdapter: string) => ({ repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter });
        const writeShared = () => adapters.flatMap(adapter => emitInstanceSkillBridge(options(adapter)).filesWritten);
        putSkill(root, 'shared-extension', '# Shared extension\n');
        assert.deepStrictEqual(writeShared(), [targetRel]);
        const canonical = fs.readFileSync(target, 'utf8');
        const legacy = canonical.replace('"kind":"skill_stub",', '"kind":"skill_stub","adapter":"generic",');
        assert.notStrictEqual(legacy, canonical);
        write(target, legacy);

        for (const adapter of adapters) {
          assert(inspectInstanceSkillBridgeArtifacts(options(adapter)).some(row => row.path === targetRel && row.state === 'present'));
        }
        assert.deepStrictEqual(writeShared(), [targetRel]);
        assert.strictEqual(fs.readFileSync(target, 'utf8'), canonical);
        assert.deepStrictEqual(writeShared(), []);

        write(target, legacy + '\n手写扩展内容\n');
        for (const adapter of adapters) {
          const result = emitInstanceSkillBridge(options(adapter));
          assert(result.driftedFiles.includes(targetRel));
          assert.deepStrictEqual(result.filesWritten, []);
        }
        assert.strictEqual(fs.readFileSync(target, 'utf8'), legacy + '\n手写扩展内容\n');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'CRLF clone reuses and refreshes managed bridges and entry text while preserving actual host edits',
    run: () => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-eol-'));
      try {
        const source = path.join(parent, 'a');
        const clone = path.join(parent, 'b');
        write(path.join(source, 'framework.config.json'), JSON.stringify({
          project_profile: { name: 'generic' }, materialized_adapters: ['claude'],
        }));
        write(path.join(source, '.gitattributes'), '*.md text\n');
        putSkill(source, 'fresh', '# Fresh\n');
        putSkill(source, 'edited', '# Edited\n');
        materializeExtensions(source, FRAMEWORK_DIR);
        git(source, ['init', '-q']);
        git(source, ['config', 'core.autocrlf', 'false']);
        git(source, ['add', '--all']);
        git(source, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'LF entry']);
        git(source, ['clone', '-q', '-c', 'core.autocrlf=true', source, clone]);

        const bridge = '.claude/commands/fresh.md';
        const changedBridge = '.claude/commands/edited.md';
        const entry = path.join(clone, 'CLAUDE.md');
        const entryBytes = fs.readFileSync(entry, 'utf8');
        const bridgeBytes = fs.readFileSync(path.join(clone, bridge), 'utf8');
        assert(entryBytes.includes('\r\n') && bridgeBytes.includes('\r\n'));
        const materialize = () => materializeExtensions(clone, FRAMEWORK_DIR) as {
          entryFilesWritten: string[]; entryFilesRetained: string[]; bridges: EmitInstanceSkillBridgeResult[];
        };
        assert(inspectInstanceSkillBridgeArtifacts({ repoRoot: clone, frameworkDir: FRAMEWORK_DIR, agentAdapter: 'claude', skills: skills(clone) })
          .some(row => row.path === bridge && row.state === 'present'));
        const unchanged = materialize();
        assert.deepStrictEqual(unchanged.entryFilesWritten, []);
        assert.deepStrictEqual(unchanged.entryFilesRetained, []);
        assert.deepStrictEqual(unchanged.bridges[0].filesWritten, []);
        assert.deepStrictEqual(unchanged.bridges[0].driftedFiles, []);
        assert.strictEqual(fs.readFileSync(entry, 'utf8'), entryBytes);
        assert.strictEqual(fs.readFileSync(path.join(clone, bridge), 'utf8'), bridgeBytes);

        const hostNotes = '\r\n# Host notes\nA manual LF line\r\n';
        fs.appendFileSync(entry, hostNotes);
        const changed = path.join(clone, changedBridge);
        const ownerEdit = fs.readFileSync(changed, 'utf8') + '\r\nHandwritten instruction.\r\n';
        fs.writeFileSync(changed, ownerEdit);
        const selection = path.join(clone, 'doc/extensions/manifest.yaml');
        const manifest = YAML.parse(fs.readFileSync(selection, 'utf8'));
        for (const id of ['provider-fresh', 'provider-edited']) manifest.plugins[id].enabled = false;
        fs.writeFileSync(selection, YAML.stringify(manifest));

        const refreshed = materialize();
        assert.deepStrictEqual(refreshed.entryFilesWritten, ['CLAUDE.md']);
        assert.deepStrictEqual(refreshed.entryFilesRetained, []);
        assert(refreshed.bridges[0].filesRemoved.includes(bridge));
        assert(refreshed.bridges[0].driftedFiles.includes(changedBridge));
        assert.strictEqual(fs.readFileSync(changed, 'utf8'), ownerEdit);
        const updated = fs.readFileSync(entry, 'utf8');
        assert(updated.endsWith(hostNotes) && !updated.includes('provider-fresh'));
        assert(!updated.slice(0, -hostNotes.length).replace(/\r\n/g, '').includes('\n'));

        manifest.plugins['provider-fresh'].enabled = true;
        fs.writeFileSync(selection, YAML.stringify(manifest));
        materialize();
        const bodyEdit = fs.readFileSync(entry, 'utf8').replace('调用对应桥接入口', '宿主另有桥接约定');
        fs.writeFileSync(entry, bodyEdit);
        manifest.plugins['provider-fresh'].enabled = false;
        fs.writeFileSync(selection, YAML.stringify(manifest));
        assert(materialize().entryFilesRetained.includes('CLAUDE.md'));
        assert.strictEqual(fs.readFileSync(entry, 'utf8'), bodyEdit);
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'materialize updates its signed block in an untracked CRLF entry and retains modified blocks',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-untracked-eol-'));
      try {
        write(path.join(root, 'framework.config.json'), JSON.stringify({
          project_profile: { name: 'generic' }, materialized_adapters: ['claude'],
        }));
        const entry = path.join(root, 'CLAUDE.md');
        const handwritten = '# Host notes\r\nOwner-maintained guidance.\r\n';
        write(entry, handwritten);
        putSkill(root, 'manual-style', '# Registered skill\n');
        const manifestPath = path.join(root, 'doc/extensions/manifest.yaml');
        const manifest = YAML.parse(fs.readFileSync(manifestPath, 'utf8'));
        const enable = (enabled: boolean) => {
          manifest.plugins['provider-manual-style'].enabled = enabled;
          fs.writeFileSync(manifestPath, YAML.stringify(manifest));
          return materializeExtensions(root, FRAMEWORK_DIR);
        };
        assert.deepStrictEqual(enable(true).entryFilesWritten, ['CLAUDE.md']);
        const initial = fs.readFileSync(entry, 'utf8');
        assert(initial.startsWith(handwritten) && initial.includes('provider-manual-style'));
        assert(!initial.replace(/\r\n/g, '').includes('\n'));
        assert.deepStrictEqual(enable(true).entryFilesWritten, []);
        assert.deepStrictEqual(enable(false).entryFilesRetained, []);
        const disabled = fs.readFileSync(entry, 'utf8');
        assert(disabled.startsWith(handwritten) && !disabled.includes('provider-manual-style'));

        const actualEdit = initial.replace('provider-manual-style', 'provider-host-edited');
        const mixedEol = initial.replace(/(调用对应桥接入口[^\r\n]+)\r\n/, '$1\n');
        for (const changed of [actualEdit, mixedEol]) {
          assert.notStrictEqual(changed, initial);
          fs.writeFileSync(entry, changed);
          assert.deepStrictEqual(enable(false).entryFilesRetained, ['CLAUDE.md']);
          assert.strictEqual(fs.readFileSync(entry, 'utf8'), changed);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'ownership 三态：规范孤儿清理、漂移保留、无标记不接管',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-ownership-'));
      putSkill(root, 'owned', '# Owned\n');
      emitInstanceSkillBridge({ repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      const owned = path.join(root, '.cursor/skills/owned/SKILL.md');
      fs.appendFileSync(owned, '\nmanual drift\n', 'utf8');
      putPlugin(root, 'provider-owned', { selection: { enabled: false } });
      const drift = emitInstanceSkillBridge({ repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      assert(drift.driftedFiles.some(item => item.endsWith('owned/SKILL.md')));
      assert(fs.existsSync(owned), 'drifted owned file must stay');

      putSkill(root, 'clean', '# Clean\n');
      emitInstanceSkillBridge({ repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      const clean = path.join(root, '.cursor/skills/clean/SKILL.md');
      putPlugin(root, 'provider-clean', { selection: { enabled: false } });
      const removed = emitInstanceSkillBridge({ repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      assert(removed.filesRemoved.some(item => item.endsWith('clean/SKILL.md')));
      assert(!fs.existsSync(clean), 'canonical orphan must be removed');

      putSkill(root, 'manual', '# Source\n');
      const manual = path.join(root, '.cursor/skills/manual/SKILL.md');
      write(manual, '# user file\n');
      const untouched = emitInstanceSkillBridge({ repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      assert(untouched.untouchedFiles.some(item => item.endsWith('manual/SKILL.md')));
      assert.strictEqual(fs.readFileSync(manual, 'utf8'), '# user file\n');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: '旧版规范 bridge 即使字节匹配也保持 unowned/untouched',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-legacy-unowned-'));
      putSkill(root, 'legacy', '# Legacy\n');
      const targetRel = '.cursor/skills/legacy/SKILL.md';
      const target = path.join(root, targetRel);
      const legacy = '# 跳板文件\n\n完整 Skill 定义请阅读：doc/extensions/skills/legacy/SKILL.md\n';
      write(target, legacy);
      const before = inspectInstanceSkillBridgeArtifacts({
        repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor',
      });
      assert(before.some(item => item.path === targetRel && item.state === 'unowned'));
      const result = emitInstanceSkillBridge({ repoRoot: root, skills: skills(root), frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      assert(result.untouchedFiles.includes(targetRel), JSON.stringify(result));
      assert(!result.filesWritten.includes(targetRel), JSON.stringify(result));
      assert.strictEqual(fs.readFileSync(target, 'utf8'), legacy);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    const endUnitCase = beginUnitCase(c.name);
    if (!endUnitCase) return discoveryResult(c.name);
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    } finally { endUnitCase(); }
  });
}
