import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import { detectRepoLayout } from '../../repo-layout';
import { initExtension, materializeExtensions } from '../../scripts/extension';
import { formatExtensionInspection, inspectInstanceExtensions } from '../../scripts/utils/extension-inspect';

const FRAMEWORK_DIR = detectRepoLayout(__dirname).frameworkRoot;

function write(target: string, body: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
}

function config(root: string, extensionDir = 'doc/extensions'): void {
  write(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1',
    project_name: 'extension-fixture',
    project_profile: { name: 'generic', sub_variant: 'app' },
    materialized_adapters: ['cursor', 'claude'],
    architecture: {
      outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: {
      features_dir: 'doc/features', architecture_md: 'doc/architecture.md',
      module_catalog: 'doc/module-catalog.yaml', glossary: 'doc/glossary.yaml', extension_dir: extensionDir,
    },
  }, null, 2));
  clearFrameworkConfigCache();
}

export interface UnitCaseResult { name: string; ok: boolean; error?: string }

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'extension init/materialize 共用 project-relative-path：越界零写入，合法自定义目录通过',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-path-'));
      const escapedName = `escaped-${path.basename(root)}`;
      const escaped = path.join(root, '..', escapedName);
      config(root, `../${escapedName}`);
      assert.throws(() => initExtension(root, FRAMEWORK_DIR), /不得包含 "\.\." 段/);
      assert.throws(() => materializeExtensions(root, FRAMEWORK_DIR), /extension_dir_path/);
      assert(!fs.existsSync(escaped), '不得写出 project root');
      config(root, 'my/extensions');
      const written = initExtension(root, FRAMEWORK_DIR);
      assert(written.includes('my/extensions/manifest.yaml'));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: '内置 /extension 在六个非 generic adapter 全量有入口真源',
    run: () => {
      const index = YAML.parse(fs.readFileSync(path.join(FRAMEWORK_DIR, 'skills/skills.index.yaml'), 'utf8')) as {
        skills: Array<{ id: string }>;
      };
      assert(index.skills.some(skill => skill.id === 'extension'));
      for (const adapter of ['cursor', 'claude', 'codeagent']) {
        assert(fs.existsSync(path.join(FRAMEWORK_DIR, 'agents', adapter, 'templates', 'commands', 'extension.md')), `${adapter} command`);
      }
      assert(fs.existsSync(path.join(FRAMEWORK_DIR, 'agents/shared/agent-bundle/templates/skills-bridge/extension/SKILL.md')));
      for (const adapter of ['codex', 'chrys', 'opencode']) {
        const config = YAML.parse(fs.readFileSync(path.join(FRAMEWORK_DIR, 'agents', adapter, 'adapter.yaml'), 'utf8')) as Record<string, unknown>;
        assert(config.skill_bridge, `${adapter} skill bridge`);
      }
    },
  },
  {
    name: 'extension init 只补缺失 skeleton，不覆盖已有 manifest',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-init-'));
      config(root);
      const first = initExtension(root, FRAMEWORK_DIR);
      assert(first.includes('doc/extensions/manifest.yaml'));
      write(path.join(root, 'doc/extensions/manifest.yaml'), 'schema_version: "1.0"\nname: kept\n');
      const second = initExtension(root, FRAMEWORK_DIR);
      assert(!second.includes('doc/extensions/manifest.yaml'));
      assert(fs.readFileSync(path.join(root, 'doc/extensions/manifest.yaml'), 'utf8').includes('name: kept'));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'inspect 纯派生报告 manifest/目录漂移与桥接缺失',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-inspect-'));
      config(root);
      write(path.join(root, 'doc/extensions/skills/directory-only/SKILL.md'), '# directory only\n');
      write(path.join(root, 'doc/extensions/manifest.yaml'), [
        'schema_version: "1.0"', 'name: inspect', 'provides:', '  skills: [declared-only]', '',
      ].join('\n'));
      const result = inspectInstanceExtensions(root, FRAMEWORK_DIR);
      assert(result.findings.some(item => item.code === 'extension_skill_unlisted'));
      assert(result.findings.some(item => item.code === 'extension_skill_declared_missing'));
      assert(result.findings.filter(item => item.code === 'extension_bridge_missing').length === 2);
      assert(formatExtensionInspection(result).includes('| 类型 | 来源 | 生效时机 | 消费者 | 强度 | 状态 |'));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'materialize 全量读取项目 materialized_adapters 并同步入口与桥接',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-materialize-'));
      config(root);
      write(path.join(root, 'doc/extensions/skills/customer/SKILL.md'), '# Customer\n');
      write(path.join(root, 'doc/extensions/skills/unlisted/SKILL.md'), '# Unlisted\n');
      write(path.join(root, 'doc/extensions/knowledge/global.md'), '# Global\n');
      write(path.join(root, 'doc/extensions/knowledge/spec.md'), '# Spec\n');
      write(path.join(root, 'doc/extensions/manifest.yaml'), [
        'schema_version: "1.1"', 'name: materialize', 'provides:', '  skills: [customer]', '  knowledge:',
        '    - { path: knowledge/global.md, summary: 全局事实, audience: global }',
        '    - { path: knowledge/spec.md, summary: spec 输入, audience: [spec] }',
        'phase_bindings:', '  spec:', '    before_phase_work:',
        '      - { kind: knowledge, ref: knowledge/spec.md }', '',
      ].join('\n'));
      const result = materializeExtensions(root, FRAMEWORK_DIR) as { adapters: string[] };
      assert.deepStrictEqual(result.adapters, ['cursor', 'claude']);
      assert(fs.existsSync(path.join(root, '.cursor/skills/customer/SKILL.md')));
      assert(fs.existsSync(path.join(root, '.claude/commands/customer.md')));
      assert(!fs.existsSync(path.join(root, '.cursor/skills/unlisted/SKILL.md')), '1.1 must be manifest-driven');
      assert(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes('| `customer` |'));
      assert(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').includes('| `customer` |'));
      assert(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes('实例全局知识'));
      assert(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes('`spec` 动笔前'));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(item => {
    try { item.run(); return { name: item.name, ok: true }; }
    catch (error) { return { name: item.name, ok: false, error: (error as Error).stack }; }
  });
}
