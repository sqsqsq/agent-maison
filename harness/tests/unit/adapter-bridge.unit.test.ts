// ============================================================================
// adapter-bridge — doc/extensions/skills 扫描与 bridge id 冲突解析
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import {
  emitInstanceSkillBridge,
  formatExtensionSkillSectionMarkdown,
  loadReservedBridgeIds,
  inspectInstanceSkillBridgeArtifacts,
  renderExtensionSkillStubMarkdown,
  resolveBridgeTargets,
  scanExtensionSkills,
} from '../../scripts/utils/instance-skill-bridge';
import { detectRepoLayout } from '../../repo-layout';
import { clearFrameworkConfigCache } from '../../config';
import { resolveRenderBridgeAdapters } from '../../scripts/render-agents-md';

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
    name: 'scanExtensionSkills：无扩展目录 → 空数组',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
      const rows = scanExtensionSkills(dir, 'doc/extensions');
      assert.deepStrictEqual(rows, []);
    },
  },
  {
    name: 'scanExtensionSkills：单个 SKILL.md → 一行',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
      write(path.join(dir, 'doc/extensions/skills/wallet-sdk-onboarding/SKILL.md'), '# Demo\n');
      const rows = scanExtensionSkills(dir, 'doc/extensions');
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].sourceSlug, 'wallet-sdk-onboarding');
      assert(
        rows[0].skillMdRepoRel.replace(/\\/g, '/').endsWith('doc/extensions/skills/wallet-sdk-onboarding/SKILL.md'),
      );
    },
  },
  {
    name: 'resolveBridgeTargets：与预留名冲突 → ext- 前缀 + 告警 + 小节含原名',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
      write(path.join(dir, 'doc/extensions/skills/coding/SKILL.md'), '# collide\n');
      const rows = scanExtensionSkills(dir, 'doc/extensions');
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
      write(
        path.join(root, 'doc/extensions/skills/wallet-sdk-onboarding/SKILL.md'),
        '---\nname: wallet-sdk-onboarding\n---\n\n# 正文\n\nFULL-BODY-MARKER-不应出现在薄跳板\n',
      );
      clearFrameworkConfigCache();
      const res = emitInstanceSkillBridge({
        repoRoot: root,
        frameworkDir: FRAMEWORK_DIR,
        agentAdapter: 'generic',
      });
      const stubAbs = path.join(root, '.agents/skills/wallet-sdk-onboarding/SKILL.md');
      assert(res.filesWritten.some(f => f.endsWith('wallet-sdk-onboarding/SKILL.md')));
      const stub = fs.readFileSync(stubAbs, 'utf8');
      assert(stub.includes('跳板文件'), 'should be a bridge stub');
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
      write(path.join(root, 'doc/extensions/skills/customer-context/SKILL.md'), '# Customer context\n');
      const first = ['cursor', 'claude'].map(agentAdapter => emitInstanceSkillBridge({
        repoRoot: root, frameworkDir: FRAMEWORK_DIR, agentAdapter,
      }));
      assert(first.every(result => result.filesWritten.length === 1));
      const cursor = fs.readFileSync(path.join(root, '.cursor/skills/customer-context/SKILL.md'), 'utf8');
      const claude = fs.readFileSync(path.join(root, '.claude/commands/customer-context.md'), 'utf8');
      assert(cursor.includes('agent-maison:instance-extension-bridge'));
      assert(claude.includes('agent-maison:instance-extension-bridge'));
      const second = ['cursor', 'claude'].map(agentAdapter => emitInstanceSkillBridge({
        repoRoot: root, frameworkDir: FRAMEWORK_DIR, agentAdapter,
      }));
      assert(second.every(result => result.filesWritten.length === 0), 'canonical bytes must not be rewritten');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'ownership 三态：规范孤儿清理、漂移保留、无标记不接管',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-ownership-'));
      write(path.join(root, 'doc/extensions/skills/owned/SKILL.md'), '# Owned\n');
      emitInstanceSkillBridge({ repoRoot: root, frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      const owned = path.join(root, '.cursor/skills/owned/SKILL.md');
      fs.appendFileSync(owned, '\nmanual drift\n', 'utf8');
      fs.rmSync(path.join(root, 'doc/extensions/skills/owned'), { recursive: true, force: true });
      const drift = emitInstanceSkillBridge({ repoRoot: root, frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      assert(drift.driftedFiles.some(item => item.endsWith('owned/SKILL.md')));
      assert(fs.existsSync(owned), 'drifted owned file must stay');

      write(path.join(root, 'doc/extensions/skills/clean/SKILL.md'), '# Clean\n');
      emitInstanceSkillBridge({ repoRoot: root, frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      const clean = path.join(root, '.cursor/skills/clean/SKILL.md');
      fs.rmSync(path.join(root, 'doc/extensions/skills/clean'), { recursive: true, force: true });
      const removed = emitInstanceSkillBridge({ repoRoot: root, frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      assert(removed.filesRemoved.some(item => item.endsWith('clean/SKILL.md')));
      assert(!fs.existsSync(clean), 'canonical orphan must be removed');

      write(path.join(root, 'doc/extensions/skills/manual/SKILL.md'), '# Source\n');
      const manual = path.join(root, '.cursor/skills/manual/SKILL.md');
      write(manual, '# user file\n');
      const untouched = emitInstanceSkillBridge({ repoRoot: root, frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      assert(untouched.untouchedFiles.some(item => item.endsWith('manual/SKILL.md')));
      assert.strictEqual(fs.readFileSync(manual, 'utf8'), '# user file\n');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: '旧版规范 bridge 即使字节匹配也保持 unowned/untouched',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-legacy-unowned-'));
      write(path.join(root, 'doc/extensions/skills/legacy/SKILL.md'), '# Legacy\n');
      const targetRel = '.cursor/skills/legacy/SKILL.md';
      const target = path.join(root, targetRel);
      const legacy = renderExtensionSkillStubMarkdown('legacy', 'doc/extensions/skills/legacy/SKILL.md', targetRel, {
        inline: false, frameworkDir: FRAMEWORK_DIR, projectRoot: root,
      });
      write(target, legacy);
      const before = inspectInstanceSkillBridgeArtifacts({
        repoRoot: root, frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor',
      });
      assert(before.some(item => item.path === targetRel && item.state === 'unowned'));
      const result = emitInstanceSkillBridge({ repoRoot: root, frameworkDir: FRAMEWORK_DIR, agentAdapter: 'cursor' });
      assert(result.untouchedFiles.includes(targetRel), JSON.stringify(result));
      assert(!result.filesWritten.includes(targetRel), JSON.stringify(result));
      assert.strictEqual(fs.readFileSync(target, 'utf8'), legacy);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
