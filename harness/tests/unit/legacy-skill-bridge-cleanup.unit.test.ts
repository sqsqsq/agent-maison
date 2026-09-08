// legacy-skill-bridge-cleanup.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, type FrameworkConfig } from '../../config';
import { executeInitTask } from '../../scripts/utils/init-task-executor';
import { probeInitTaskPlan } from '../../scripts/utils/init-task-planner';
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
    name: 'collectLegacySkillBridgePaths：codeagent 走 .cac/commands 同径，不落 .claude（plan c7a9e2f4 #12）',
    run: () => {
      const config = baseConfig();
      const paths = collectLegacySkillBridgePaths({
        projectRoot: '/tmp',
        materializedAdapters: ['codeagent'],
        mode: 'update',
        config,
      });
      assert(paths.length > 0, 'codeagent 应登记 legacy 探测路径');
      assert(paths.every(p => p.relPosix.startsWith('.cac/commands/')), JSON.stringify(paths));
      assert(paths.some(p => p.relPosix === '.cac/commands/3-coding.md'));
      assert(!paths.some(p => p.relPosix.includes('.claude/')), 'codeagent 不得探测 .claude');
    },
  },
  {
    name: 'kernel legacy 路径 manifest 化（codex P2 回灌）：非标 commands target_dir 时跟随 manifest 不漂移',
    run: () => {
      const root = mkTmp();
      const adapterDir = path.join(root, 'framework', 'agents', 'codeagent');
      fs.mkdirSync(adapterDir, { recursive: true });
      // consumer 布局判据：framework/skills 存在（inferRepoLayout hasFrameworkTree）
      fs.mkdirSync(path.join(root, 'framework', 'skills'), { recursive: true });
      fs.writeFileSync(
        path.join(adapterDir, 'adapter.yaml'),
        ['adapter_name: codeagent', 'commands:', '  target_dir: .cac2/commands'].join('\n'),
        'utf-8',
      );
      const config = baseConfig();
      const paths2 = collectLegacySkillBridgePaths({
        projectRoot: root,
        materializedAdapters: ['codeagent'],
        mode: 'update',
        config,
      });
      assert(paths2.length > 0);
      assert(paths2.every(p => p.relPosix.startsWith('.cac2/commands/')), JSON.stringify(paths2.slice(0, 2)));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'applyLegacySkillBridgeCleanup UPDATE：codeagent 遗留 .cac/commands/3-coding.md 备份后清理',
    run: () => {
      const root = mkTmp();
      const legacyFile = path.join(root, '.cac', 'commands', '3-coding.md');
      const flatFile = path.join(root, '.cac', 'commands', 'coding.md');
      fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
      fs.writeFileSync(legacyFile, 'legacy');
      fs.writeFileSync(flatFile, 'flat');
      const config = baseConfig();
      const { cleaned, backupRelDir } = applyLegacySkillBridgeCleanup({
        projectRoot: root,
        materializedAdapters: ['codeagent'],
        mode: 'update',
        config,
      });
      assert.strictEqual(cleaned.length, 1, JSON.stringify(cleaned));
      assert(!fs.existsSync(legacyFile), 'legacy 应被清理');
      assert(fs.existsSync(flatFile), '扁平名不受影响');
      assert(backupRelDir && fs.existsSync(path.join(root, backupRelDir!, '.cac', 'commands', '3-coding.md')), '应先备份');
      fs.rmSync(root, { recursive: true, force: true });
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
      // inline 已彻底废弃：config 写 inline 也一律解析为 bridge
      assert.strictEqual(bundle.skillMode, 'bridge');
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
    // 缺陷 3：S1 只读探测撞上指向工程外的 junction/symlink 时曾整体抛错，
    // 让 probeInitTaskPlan 生不出计划——探测须逐条跳过并如实报告。
    name: 'detectLegacySkillBridgePresence：路径经 junction 指向工程外时不抛错，逐条计入 skipped；planner 仍出计划并在 title 提示',
    run: () => {
      const root = fs.realpathSync(mkTmp());
      const outside = fs.realpathSync(mkTmp());
      try {
        fs.mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
        fs.symlinkSync(outside, path.join(root, '.codex', 'skills', 'app-component-blueprint'),
          process.platform === 'win32' ? 'junction' : 'dir');

        const presence = detectLegacySkillBridgePresence(root, baseConfig(), ['codex']);
        assert.strictEqual(presence.skipped.length, 1, `skipped 应恰含一条，实际=${JSON.stringify(presence.skipped)}`);
        assert(presence.skipped[0]!.relPosix.includes('app-component-blueprint'));
        assert(presence.skipped[0]!.reason.length > 0, 'skipped 须带原因');

        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1',
          project_name: 'junction-probe',
          materialized_adapters: ['codex'],
          architecture: baseConfig().architecture,
          paths: { features_dir: 'doc/features' },
        }));
        clearFrameworkConfigCache();
        const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project', adapter: 'codex' });
        assert.strictEqual(plan.mode, 'update', 'framework.config.json 存在时应为 UPDATE');
        const task = plan.tasks.find(t => t.id === 'cleanup-deprecated');
        assert(task, '计划应含 cleanup-deprecated');
        assert(task!.title.includes('无法探测') && task!.title.includes('S3 将报告清理异常'),
          `title 未提示无法探测的路径：${task!.title}`);
      } finally {
        fs.rmSync(path.join(root, '.codex'), { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    // 缺陷 3 的第二形态：整根 `.codex` 就是指向工程外的 junction。
    // S1 只读探测须跳过并出计划；S3 删除路径保持抛错——该 adapter 记 failed、任务 failed，
    // 其他 adapter 照常清理。
    name: '整根 .codex 为工程外 junction：planner 仍出计划，S3 该 adapter failed 且其他 adapter 照常清理',
    run: () => {
      const root = fs.realpathSync(mkTmp());
      const outside = fs.realpathSync(mkTmp());
      try {
        fs.mkdirSync(path.join(outside, 'skills', 'app-component-blueprint'), { recursive: true });
        fs.symlinkSync(outside, path.join(root, '.codex'), process.platform === 'win32' ? 'junction' : 'dir');
        fs.mkdirSync(path.join(root, '.claude', 'commands'), { recursive: true });
        fs.writeFileSync(path.join(root, '.claude', 'commands', 'goal-orchestration.md'), 'old bridge');
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1',
          project_name: 'junction-root',
          materialized_adapters: ['codex'],
          architecture: baseConfig().architecture,
          paths: { features_dir: 'doc/features' },
        }));
        clearFrameworkConfigCache();

        const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project', adapter: 'codex' });
        const task = plan.tasks.find(t => t.id === 'cleanup-deprecated');
        assert(task, '计划应含 cleanup-deprecated');
        assert(task!.title.includes('无法探测'), `title 未提示无法探测的路径：${task!.title}`);

        const result = executeInitTask({ ...task!, id: 'cleanup-deprecated' }, 'run', {
          projectRoot: root, harnessRoot: path.resolve(__dirname, '../..'),
          materializedAdapters: ['codex'], plan,
        });
        assert.strictEqual(result.failed, true, '越界异常须把任务判为 failed');
        const failure = result.cleanup_results?.find(
          r => r.adapter === 'codex' && r.kind === 'legacy_skill_bridge' && r.status === 'failed');
        assert(failure, `codex legacy 清理应记 failed：${JSON.stringify(result.cleanup_results)}`);
        assert(/越界/.test(failure!.message ?? ''), `failed 原因须点名越界：${failure!.message}`);
        assert(failure!.message?.includes('.codex/'), `failed 原因须点名越界路径：${failure!.message}`);
        assert(!fs.existsSync(path.join(root, '.claude', 'commands', 'goal-orchestration.md')),
          '其他 adapter 的旧跳板应照常清理');
      } finally {
        fs.rmSync(path.join(root, '.codex'), { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'collectLegacySkillBridgePaths：cursor 含语义旧名 prd-design / requirement-design',
    run: () => {
      const config = baseConfig();
      const paths = collectLegacySkillBridgePaths({
        projectRoot: '/tmp',
        materializedAdapters: ['cursor'],
        mode: 'update',
        config,
      });
      assert(paths.some(p => p.relPosix === '.cursor/skills/prd-design/'));
      assert(paths.some(p => p.relPosix === '.cursor/skills/requirement-design/'));
    },
  },
  {
    name: 'collectLegacySkillBridgePaths：claude 含语义与编号旧名 .md',
    run: () => {
      const config = baseConfig();
      const paths = collectLegacySkillBridgePaths({
        projectRoot: '/tmp',
        materializedAdapters: ['claude'],
        mode: 'update',
        config,
      });
      assert(paths.some(p => p.relPosix === '.claude/commands/prd-design.md'));
      assert(paths.some(p => p.relPosix === '.claude/commands/requirement-design.md'));
      assert(paths.some(p => p.relPosix === '.claude/commands/1-prd-design.md'));
    },
  },
  {
    name: 'applyLegacySkillBridgeCleanup UPDATE：删 prd-design 留 spec',
    run: () => {
      const root = mkTmp();
      const legacyDir = path.join(root, '.cursor', 'skills', 'prd-design');
      const canonicalDir = path.join(root, '.cursor', 'skills', 'spec');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, 'SKILL.md'), 'legacy');
      fs.mkdirSync(canonicalDir, { recursive: true });
      fs.writeFileSync(path.join(canonicalDir, 'SKILL.md'), 'canonical');

      const config = baseConfig();
      const { cleaned } = applyLegacySkillBridgeCleanup({
        projectRoot: root,
        materializedAdapters: ['cursor'],
        mode: 'update',
        config,
      });
      assert(cleaned.some(c => c.legacy_id === 'prd-design'));
      assert(!fs.existsSync(legacyDir));
      assert(fs.existsSync(canonicalDir));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'detectLegacySkillBridgePresence：cursor prd-design 计入 S1 sample',
    run: () => {
      const root = mkTmp();
      fs.mkdirSync(path.join(root, '.cursor', 'skills', 'prd-design'), { recursive: true });
      const config = baseConfig();
      const presence = detectLegacySkillBridgePresence(root, config, ['cursor']);
      assert(presence.count >= 1);
      assert(presence.samples.some(s => s.includes('prd-design')));
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
