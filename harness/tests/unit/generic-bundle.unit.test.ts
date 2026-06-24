// ============================================================================
// generic-bundle — agent bundle 路径解析与 inline 物化
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import { __testing as checkInitTesting } from '../../scripts/check-init';
import { validateAgentBundleRoot, readAgentBundlePathsFromConfig, resolveGenericBundlePathsFromPaths } from '../../scripts/utils/agent-bundle-paths';
import {
  materializeInlineSkillMarkdown,
  materializeAgentBundleSkills,
  posixRelativeFromSkillStubTo,
  renderBridgeSkillStubMarkdown,
} from '../../scripts/utils/materialize-agent-bundle-skills';
import { loadReservedBridgeIds } from '../../scripts/utils/instance-skill-bridge';
import { detectRepoLayout } from '../../repo-layout';

const FRAMEWORK_DIR = detectRepoLayout(__dirname).frameworkRoot;

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'validateAgentBundleRoot：拒绝 .. 与绝对路径',
    run: () => {
      assert.throws(() => validateAgentBundleRoot('../evil'));
      assert.throws(() => validateAgentBundleRoot('C:/abs'));
    },
  },
  {
    name: 'resolveGenericBundlePathsFromPaths：不依赖 agent_adapter',
    run: () => {
      const bundle = resolveGenericBundlePathsFromPaths({
        agent_bundle_root: '.custom-agents',
        features_dir: 'doc/features',
      } as never);
      assert.strictEqual(bundle.skillsDir, '.custom-agents/skills');
      assert.strictEqual(bundle.root, '.custom-agents');
    },
  },
  {
    name: 'readAgentBundlePathsFromConfig：generic 缺省 root 使用 .agents/bridge',
    run: () => {
      const defaultBundle = readAgentBundlePathsFromConfig({
        agent_adapter: 'generic',
        paths: { features_dir: 'doc/features' } as never,
      });
      assert.strictEqual(defaultBundle?.root, '.agents');
      assert.strictEqual(defaultBundle?.skillMode, 'bridge');
      // inline 已彻底废弃：config 写 inline 也一律解析为 bridge
      const b = readAgentBundlePathsFromConfig({
        agent_adapter: 'generic',
        paths: {
          features_dir: 'doc/features',
          agent_bundle_root: '.codex',
          agent_bundle_skill_mode: 'inline',
        } as never,
      });
      assert.strictEqual(b?.skillsDir, '.codex/skills');
      assert.strictEqual(b?.skillMode, 'bridge');
    },
  },
  {
    // 真正复现历史缺陷的场景：active=generic + config 残留 inline。
    // 旧代码会读 config inline → 物化全量 SKILL（materialized）；修复后恒 bridge 薄跳板（verbatim）。
    name: 'resolveBundleForInitInspect：active=generic + config inline 仍恒 bridge 薄跳板',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-resolve-'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 't',
            agent_adapter: 'generic',
            materialized_adapters: ['generic'],
            architecture: {
              outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
              module_inner_layers: ['shared'],
              inner_dependency_direction: 'upward',
              cross_module_exports_file: 'index.ets',
            },
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
      const raw = checkInitTesting.loadRawFrameworkConfig(root);
      const bundle = checkInitTesting.resolveBundleForInitInspect('generic', raw, root);
      assert.strictEqual(bundle?.skillMode, 'bridge');
      const adapter = checkInitTesting.loadAdapter('generic');
      checkInitTesting.applyGenericAdapterBundle(adapter, bundle!);
      const coding = adapter.templateFiles.find(
        f => f.targetRel === '.agents/skills/coding/SKILL.md',
      );
      assert.strictEqual(coding?.kind, 'verbatim');
      // 不得有任何全量 materialized 内置 skill 条目
      assert.strictEqual(
        adapter.templateFiles.some(f => f.kind === 'materialized'),
        false,
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'loadAdapter(generic)+applyGeneric：inline 物化条目',
    run: () => {
      const adapter = checkInitTesting.loadAdapter('generic');
      checkInitTesting.applyGenericAdapterBundle(adapter, {
        root: '.agents',
        skillsDir: '.agents/skills',
        rulesDir: '.agents/rules',
        skillMode: 'inline',
      });
      const inline = adapter.templateFiles.filter(f => f.kind === 'materialized');
      assert(inline.length >= 8);
      assert(inline.some(f => f.targetRel === '.agents/skills/framework-init/SKILL.md'));
    },
  },
  {
    name: 'loadAdapter(generic)+applyGeneric：bridge 拷贝 skills-bridge',
    run: () => {
      const adapter = checkInitTesting.loadAdapter('generic');
      checkInitTesting.applyGenericAdapterBundle(adapter, {
        root: '.codex',
        skillsDir: '.codex/skills',
        rulesDir: '.codex/rules',
        skillMode: 'bridge',
      });
      assert(
        adapter.templateFiles.some(
          f => f.targetRel === '.codex/skills/framework-init/SKILL.md' && f.kind === 'verbatim',
        ),
      );
    },
  },
  {
    name: 'loadAdapter(generic)+applyGeneric：interaction-renderer 随 bundle root 重定位',
    run: () => {
      const adapter = checkInitTesting.loadAdapter('generic');
      checkInitTesting.applyGenericAdapterBundle(adapter, {
        root: '.codex',
        skillsDir: '.codex/skills',
        rulesDir: '.codex/rules',
        skillMode: 'inline',
      });
      assert(
        adapter.templateFiles.some(
          f =>
            f.origin === 'user_confirmation.interaction_renderer_rule'
            && f.targetRel === '.codex/rules/interaction-renderer.md',
        ),
      );
      assert(
        !adapter.templateFiles.some(
          f =>
            f.origin === 'user_confirmation.interaction_renderer_rule'
            && f.targetRel.startsWith('.agents/'),
        ),
      );
    },
  },
  {
    name: 'materializeInlineSkillMarkdown：name 与目录一致',
    run: () => {
      const md = materializeInlineSkillMarkdown(FRAMEWORK_DIR, 'framework-init');
      assert(md.includes('name: framework-init'));
      assert(md.includes('Framework 工程初始化'));
    },
  },
  {
    name: 'materializeInlineSkillMarkdown：相对链接改写为 framework/ 逻辑路径',
    run: () => {
      const stubRel = '.agents/skills/coding/SKILL.md';
      const md = materializeInlineSkillMarkdown(FRAMEWORK_DIR, 'coding', {
        projectRoot: FRAMEWORK_DIR,
        stubTargetRelPosix: stubRel,
      });
      assert(
        md.includes('framework/skills/reference/') || md.includes('](framework/skills/'),
        'inline 物化应把 ../../reference 类链接改为 framework/skills/...',
      );
      assert(!md.includes('](../../reference/'), '不得保留指向 .agents/reference 的相对链');
    },
  },
  {
    name: 'materializeInlineSkillMarkdown：宿主 doc/ 与 framework.config.json 链按 stub 深度改写',
    run: () => {
      const stubRel = '.agents/skills/spec/SKILL.md';
      const md = materializeInlineSkillMarkdown(FRAMEWORK_DIR, 'spec', {
        projectRoot: FRAMEWORK_DIR,
        stubTargetRelPosix: stubRel,
      });
      assert(
        md.includes('](../../../doc/glossary.yaml)'),
        'spec 源链 ../../../../doc/ 应改写为相对 stub 的 ../../../doc/',
      );
      assert(!md.includes('](../../../../doc/'), '不得保留逃出宿主根的 ../../../../doc/ 链');
      const reqMd = materializeInlineSkillMarkdown(FRAMEWORK_DIR, 'plan', {
        projectRoot: FRAMEWORK_DIR,
        stubTargetRelPosix: '.agents/skills/plan/SKILL.md',
      });
      assert(
        reqMd.includes('](../../../framework.config.json)'),
        'plan framework.config 应改写为 ../../../framework.config.json',
      );
    },
  },
  {
    name: 'posixRelativeFromSkillStubTo：多段 bundle 根',
    run: () => {
      const rel = posixRelativeFromSkillStubTo(
        'tools/my-agent/skills/coding/SKILL.md',
        'framework/skills/feature/coding/SKILL.md',
      );
      assert.strictEqual(rel, '../../../../framework/skills/feature/coding/SKILL.md');
    },
  },
  {
    name: 'renderBridgeSkillStubMarkdown：name 等于 bridgeId',
    run: () => {
      const md = renderBridgeSkillStubMarkdown(
        'catalog-bootstrap',
        '.agents/skills/catalog-bootstrap/SKILL.md',
        'framework/skills/project/catalog-bootstrap/SKILL.md',
      );
      assert(md.includes('name: catalog-bootstrap'));
    },
  },
  {
    name: 'renderBridgeSkillStubMarkdown：goal-mode 注入运行身份',
    run: () => {
      const md = renderBridgeSkillStubMarkdown(
        'goal-mode',
        '.cursor/skills/goal-mode/SKILL.md',
        'framework/skills/project/goal-mode/SKILL.md',
        'codex',
      );
      assert(md.includes('RESOLVED_ADAPTER'));
      assert(md.includes('codex'));
    },
  },
  {
    name: 'renderBridgeSkillStubMarkdown：非 goal-mode 不注入身份',
    run: () => {
      const md = renderBridgeSkillStubMarkdown(
        'coding',
        '.cursor/skills/coding/SKILL.md',
        'framework/skills/feature/coding/SKILL.md',
        'cursor',
      );
      assert(!md.includes('RESOLVED_ADAPTER'));
    },
  },
  {
    name: 'materializeAgentBundleSkills：goal-mode bridge 注入 adapterName',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bundle-goal-'));
      materializeAgentBundleSkills({
        projectRoot: dir,
        frameworkDir: FRAMEWORK_DIR,
        bundle: {
          root: '.agents',
          skillsDir: '.agents/skills',
          rulesDir: '.agents/rules',
          skillMode: 'bridge',
        },
        skillIds: ['goal-mode'],
        adapterName: 'cursor',
      });
      const p = path.join(dir, '.agents/skills/goal-mode/SKILL.md');
      assert(fs.existsSync(p));
      const txt = fs.readFileSync(p, 'utf8');
      assert(txt.includes('RESOLVED_ADAPTER'));
      assert(txt.includes('cursor'));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'Claude goal-mode 静态模板含 RESOLVED_ADAPTER',
    run: () => {
      const tpl = path.join(
        FRAMEWORK_DIR,
        'agents/claude/templates/commands/goal-mode.md',
      );
      assert(fs.existsSync(tpl));
      const txt = fs.readFileSync(tpl, 'utf8');
      assert(txt.includes('RESOLVED_ADAPTER'));
      assert(txt.includes('claude'));
    },
  },
  {
    name: 'materializeAgentBundleSkills：写入临时目录',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bundle-'));
      const outcome = materializeAgentBundleSkills({
        projectRoot: dir,
        frameworkDir: FRAMEWORK_DIR,
        bundle: {
          root: '.agents',
          skillsDir: '.agents/skills',
          rulesDir: '.agents/rules',
          skillMode: 'inline',
        },
      });
      assert(outcome.filesWritten.length >= 8);
      const p = path.join(dir, '.agents/skills/framework-init/SKILL.md');
      assert(fs.existsSync(p));
      const txt = fs.readFileSync(p, 'utf8');
      assert(txt.includes('name: framework-init'));
    },
  },
  {
    name: 'loadReservedBridgeIds：扫描 shared/skills-bridge',
    run: () => {
      const ids = loadReservedBridgeIds(FRAMEWORK_DIR);
      assert(ids.has('framework-init'));
      assert(ids.has('device-testing'));
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
