// legacy-skill-bridge-cleanup.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { FrameworkConfig } from '../../config';
import {
  applyLegacySkillBridgeCleanup,
  collectLegacySkillBridgePaths,
  detectLegacySkillBridgePresence,
  readGenericBundlePathsFromConfigPaths,
} from '../../scripts/utils/legacy-skill-bridge-cleanup';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-bridge-'));
}

function baseConfig(paths?: Partial<FrameworkConfig['paths']>): FrameworkConfig {
  return {
    schema_version: '1.1',
    project_name: 't',
    architecture: {
      outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', ...paths } as FrameworkConfig['paths'],
    agent_adapter: 'cursor',
  } as unknown as FrameworkConfig;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'collectLegacySkillBridgePaths：cursor+generic 不含 claude',
    run: () => {
      const config = baseConfig({ agent_bundle_root: '.codex' });
      const paths = collectLegacySkillBridgePaths({
        projectRoot: '/tmp',
        materializedAdapters: ['cursor', 'generic'],
        mode: 'update',
        config,
      });
      assert(paths.some(p => p.relPosix === '.cursor/skills/3-coding/'));
      assert(paths.some(p => p.relPosix === '.codex/skills/3-coding/'));
      assert(!paths.some(p => p.relPosix.includes('.claude/commands')));
    },
  },
  {
    name: 'readGenericBundlePathsFromConfigPaths：不依赖 active adapter',
    run: () => {
      const bundle = readGenericBundlePathsFromConfigPaths({
        features_dir: 'doc/features',
        agent_bundle_root: '.codex',
        agent_bundle_skill_mode: 'inline',
      } as FrameworkConfig['paths'] & { agent_bundle_root: string; agent_bundle_skill_mode: string });
      assert.strictEqual(bundle.skillsDir, '.codex/skills');
      assert.strictEqual(bundle.skillMode, 'inline');
    },
  },
  {
    name: 'applyLegacySkillBridgeCleanup UPDATE：删编号留扁平',
    run: () => {
      const root = mkTmp();
      const legacyDir = path.join(root, '.cursor', 'skills', '3-coding');
      const flatDir = path.join(root, '.cursor', 'skills', 'coding');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, 'SKILL.md'), 'legacy');
      fs.mkdirSync(flatDir, { recursive: true });
      fs.writeFileSync(path.join(flatDir, 'SKILL.md'), 'flat');

      const config = baseConfig();
      const { cleaned, backupRelDir } = applyLegacySkillBridgeCleanup({
        projectRoot: root,
        materializedAdapters: ['cursor'],
        mode: 'update',
        config,
      });
      assert.strictEqual(cleaned.length, 1);
      assert(!fs.existsSync(legacyDir));
      assert(fs.existsSync(flatDir));
      assert(backupRelDir);
      assert(fs.existsSync(path.join(root, backupRelDir!, '.cursor', 'skills', '3-coding', 'SKILL.md')));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'applyLegacySkillBridgeCleanup CREATE：0 删除',
    run: () => {
      const root = mkTmp();
      const legacyDir = path.join(root, '.cursor', 'skills', '3-coding');
      fs.mkdirSync(legacyDir, { recursive: true });
      const config = baseConfig();
      const { cleaned } = applyLegacySkillBridgeCleanup({
        projectRoot: root,
        materializedAdapters: ['cursor'],
        mode: 'create',
        config,
      });
      assert.strictEqual(cleaned.length, 0);
      assert(fs.existsSync(legacyDir));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'detectLegacySkillBridgePresence：只计数存在路径',
    run: () => {
      const root = mkTmp();
      fs.mkdirSync(path.join(root, '.agents', 'skills', '3-coding'), { recursive: true });
      const config = baseConfig({ agent_bundle_root: '.agents' });
      const presence = detectLegacySkillBridgePresence(root, config, ['generic']);
      assert.strictEqual(presence.count, 1);
      assert(presence.samples[0]!.includes('3-coding'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: '根目录安全：agent_bundle_root 含 .. 抛错',
    run: () => {
      const root = mkTmp();
      const config = baseConfig({ agent_bundle_root: '../evil' });
      assert.throws(() =>
        collectLegacySkillBridgePaths({
          projectRoot: root,
          materializedAdapters: ['generic'],
          mode: 'update',
          config,
        }),
      );
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
