import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { applyInstanceExtensions, loadInstanceExtensions, loadInstanceExtensionSource, readExtensionTimings } from '../../extension-loader';
import { checkExtensionManifest } from '../../scripts/utils/extension-runtime';
import { buildAgentsTemplateVars } from '../../scripts/utils/template-renderer';
import type { HarnessResolvedProfile } from '../../scripts/utils/types';
import { runUnitCases } from '../utils/unit-cases';
import { putPlugin } from './extension-test-fixture';

const frameworkRoot = path.resolve(__dirname, '../../..');
const ext = 'doc/extensions';
const author = 'feature.before_phase_work@1';
const projectEntry = 'project.entry@1';
const guide = { at: author, phase: 'spec', kind: 'knowledge', ref: 'knowledge/guide.md', enabled_by_default: true };
const file = (root: string, relative: string, value: string) => {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, value);
  return absolute;
};

const cases: { name: string; run(root: string): void }[] = [
  { name: '空目录和未登记包均不产生贡献', run(root) {
    assert.equal(loadInstanceExtensions(root).rootDir, null);
    file(root, ext + '/unregistered/manifest.yaml', 'schema_version: "2.0"\nkind: plugin\nname: unregistered\nversion: "1"\n');
    file(root, ext + '/skills/legacy/SKILL.md', '# absent');
    const bundle = loadInstanceExtensions(root);
    assert.equal(bundle.manifestPath, null);
    assert.deepEqual(bundle.manualSkills, []);
    assert.deepEqual(bundle.bindings, []);
    assert.deepEqual(bundle.errors, []);
  } },
  { name: '识别已发布平铺、内测格式和损坏的新清单，活动旧根只读且不阻断普通业务', run(root) {
    const resource = file(root, ext + '/skills/old/SKILL.md', '# legacy');
    const cases = [
      { raw: { schema_version: '1.0', name: 'old', provides: { skills: ['old'] } }, code: 'manifest_legacy_layout' },
      { raw: { schema_version: '1.1', name: 'old', provides: {} }, code: 'manifest_legacy_layout' },
      { raw: { schema_version: '2.0', name: 'old', installations: {} }, code: 'manifest_legacy_layout' },
      { raw: { schema_version: '2.1', name: 'old', installations: {} }, code: 'manifest_legacy_layout' },
      { raw: { schema_version: '2.0', plugins: {} }, code: 'manifest_kind' },
      { raw: { schema_version: '2.0', kind: 'plugin', name: 'old', version: '1' }, code: 'manifest_kind' },
      { raw: { schema_version: '2.0', kind: 'host', name: 'old', plugins: {} }, code: 'manifest_unknown_field' },
      { raw: { schema_version: '2.0', kind: 'host', plugins: [] }, code: 'plugins_shape' },
      { raw: { schema_version: '3.0', kind: 'host', plugins: {} }, code: 'manifest_schema_version' },
    ];
    for (const { raw, code } of cases) {
      const yaml = YAML.stringify(raw);
      const manifest = file(root, ext + '/manifest.yaml', yaml);
      const view = loadInstanceExtensions(root);
      assert.equal(view.manifestUsable, false);
      assert.equal(view.errors[0]?.code, code);
      assert.deepEqual(view.manualSkills, []);
      assert.equal(checkExtensionManifest(view)[0]?.status, code === 'manifest_legacy_layout' ? 'WARN' : 'FAIL');
      assert.equal(fs.readFileSync(resource, 'utf8'), '# legacy');
      assert.equal(fs.readFileSync(manifest, 'utf8'), yaml);
    }
    file(root, ext + '/manifest.yaml', 'bad: [');
    assert.equal(loadInstanceExtensions(root).errors[0]?.code, 'manifest_yaml_parse');
  } },
  { name: '两个包的同名知识、动作与绑定按包解析，关闭其一保留另一包', run(root) {
    const declaration = (tool: string) => ({
      provides: { mcp_actions: { fetch: { tool, required: true, produces: ['doc/report.json'], usage: 'fetch data' } } },
      bindings: { guide, fetch: { at: 'feature.before_phase_verify@1', phase: 'spec', kind: 'action', ref: 'fetch' } },
    });
    putPlugin(root, 'one', { declaration: declaration('host.one'), files: { [guide.ref]: 'one' } });
    putPlugin(root, 'two', { declaration: declaration('host.two'), files: { [guide.ref]: 'two' } });
    const resolved = loadInstanceExtensions(root);
    assert.deepEqual(resolved.errors, []);
    assert.deepEqual(resolved.bindings.filter(row => row.action).map(row => [row.ability, row.action?.tool]), [['one', 'host.one'], ['two', 'host.two']]);
    assert.deepEqual(resolved.bindings.filter(row => row.absPath).map(row => fs.readFileSync(row.absPath!, 'utf8')), ['one', 'two']);
    putPlugin(root, 'one', { declaration: declaration('host.one'), selection: { enabled: false } });
    assert.deepEqual(loadInstanceExtensions(root).bindings.filter(row => row.enabled).map(row => row.ability), ['two', 'two']);
  } },
  { name: '多个手动 Skill、UT 目录资产、规则与能力覆盖，冲突记录双方插件', run(root) {
    const declaration = { provides: {
      skills: ['first', 'second'],
      skill_assets: { 'business-ut': { sample_flow_dir: 'templates' } },
      capabilities: { 'coding.compile': { provider: 'provider.mjs', severity: 'MAJOR' } },
      phase_rules_overlays: { plan: 'overlay.yaml' },
    } };
    const files = { 'skills/first/SKILL.md': '# first', 'skills/second/SKILL.md': '# second',
      'provider.mjs': 'export default {}', 'overlay.yaml': '{}', 'templates/sample.md': '# sample' };
    putPlugin(root, 'one', { declaration, files });
    const two = putPlugin(root, 'two', { declaration, files });
    const base: HarnessResolvedProfile = { name: 'generic', profileDir: root, yaml: { name: 'generic' },
      phasesDisabled: new Set(), capabilities: { 'coding.compile': { provider: 'profile', severity: 'BLOCKER' } }, personalPrerequisites: {} };
    const profile = applyInstanceExtensions(base, root);
    const bundle = profile.extensionBundle!;
    assert.equal(profile.capabilities['coding.compile']?.provider, path.join(two, 'provider.mjs'));
    assert.equal(bundle.phaseRuleOverlayPaths.plan, path.join(two, 'overlay.yaml'));
    assert.equal(bundle.skillAssetAbsPaths['business-ut'].sample_flow_dir, path.join(two, 'templates'));
    assert.deepEqual(bundle.manualSkills.map(row => [row.pluginId, row.skillId]), [['one', 'first'], ['one', 'second'], ['two', 'first'], ['two', 'second']]);
    assert(bundle.errors.some(error => error.code === 'plugin_contribution_conflict' && error.message.includes('one') && error.message.includes('two')));
  } },
  { name: '来源默认与宿主开关分离，未知字段和无效时点定位到声明', run(root) {
    const plugin = putPlugin(root, 'select', {
      declaration: { bindings: { guide, bad: { ...guide, at: 'feature.invented@1' }, beyond: { ...guide, ref: '../outside.md' },
        unrelated: { ...guide, phase: 'catalog' } } },
      selection: { bindings: { guide: false, bad: true, beyond: true, unrelated: true } }, files: { [guide.ref]: '# guide' },
    });
    const source = loadInstanceExtensionSource(plugin, root);
    assert(source.bindings.find(row => row.id === 'guide')?.enabled);
    const host = loadInstanceExtensions(root);
    assert(!host.bindings.find(row => row.id === 'guide')?.enabled);
    assert(host.errors.some(error => error.code === 'extension_binding_unknown_timing' && error.bindingId === 'bad'));
    assert(host.bindings.find(row => row.id === 'beyond')?.issue);
    assert(host.bindings.find(row => row.id === 'unrelated')?.issue);
  } },
  { name: '时点覆盖进入实际 Feature、设计和 Hook，未知绑定及不兼容类型被识别', run(root) {
    putPlugin(root, 'rules', {
      declaration: { bindings: { guide, design: guide, hook: { at: 'harness.pre_check@1', phase: 'spec', kind: 'action', ref: 'hooks/check.mjs' }, bad: guide } },
      selection: { binding_overrides: { guide: { at: author, phase: 'review' }, design: { at: 'component-design.before_discovery@1' },
        hook: { at: 'harness.pre_phase@1', phase: 'plan' }, bad: { at: 'feature.before_phase_verify@1', phase: 'spec' },
        'unused-id': { at: author, phase: 'review' } } },
      files: { [guide.ref]: '# guide', 'hooks/check.mjs': 'export default () => ({})' },
    });
    const bundle = loadInstanceExtensions(root);
    const active = bundle.bindings.filter(row => row.enabled).map(row => [row.id, row.at, row.phase, row.hookEvent]);
    assert.deepEqual(active, [['guide', author, 'review', undefined], ['design', 'component-design.before_discovery@1', undefined, undefined],
      ['hook', 'harness.pre_phase@1', 'plan', 'pre_phase']]);
    assert(bundle.errors.some(error => error.code === 'installation_binding_override' && error.bindingId === 'bad'));
    assert(bundle.errors.some(error => error.code === 'installation_binding_selection' && error.message.includes('unused-id')));
  } },
  { name: '项目入口静态索引消费已登记的随仓知识，并标识插件', run(root) {
    putPlugin(root, 'index', { declaration: { bindings: { guide, shared: { at: projectEntry, kind: 'knowledge', ref: 'knowledge/shared.md', summary: '共享说明' } } },
      files: { [guide.ref]: '# feature', 'knowledge/shared.md': '# project' } });
    const entry = buildAgentsTemplateVars({}, { projectRoot: root, frameworkRoot, entryFile: 'AGENTS.md' });
    assert.match(entry.EXTENSION_SKILL_SECTION, /实例知识索引/);
    assert.match(entry.EXTENSION_SKILL_SECTION, /index.*knowledge\/shared.md.*共享说明/);
    assert.doesNotMatch(entry.EXTENSION_SKILL_SECTION, /guide\.md/);
    assert(readExtensionTimings(frameworkRoot).has(projectEntry));
  } },
  { name: '自定义扩展根按配置解析，越界和错误的插件身份保持隔离', run(root) {
    file(root, 'framework.config.json', JSON.stringify({ paths: { extension_dir: 'custom/extensions' } }));
    putPlugin(root, 'wrong', { extensionDir: 'custom/extensions', declaration: { name: 'elsewhere', bindings: { guide } } });
    putPlugin(root, 'safe', { extensionDir: 'custom/extensions', declaration: { bindings: { guide } }, files: { [guide.ref]: 'safe' } });
    for (const candidate of ['../outside', path.resolve(root), 'C:elsewhere']) assert(!loadInstanceExtensions(root, candidate).manifestUsable);
    const bundle = loadInstanceExtensions(root);
    assert(bundle.errors.some(error => error.code === 'plugin_identity' && error.ability === 'wrong'));
    assert.deepEqual(bundle.bindings.map(row => row.ability), ['safe']);
  } },
  { name: '生成资源仅依所属包声明等待准备，失败排除独立插件', run(root) {
    const generated = 'knowledge/result.md';
    const step = { id: 'generate', cwd: '.', scope: 'local', run: ['node', 'script.cjs'],
      outputs: [generated, 'knowledge/index.json'], ready: { version_file: 'knowledge/index.json' } };
    putPlugin(root, 'generator', { declaration: { activation: { steps: [step] }, bindings: {
      wait: { ...guide, ref: generated }, foreign: { ...guide, ref: '../sibling/knowledge/result.md' },
      entry: { at: projectEntry, kind: 'knowledge', ref: generated },
    } } });
    putPlugin(root, 'sibling', { declaration: { bindings: { guide } }, files: { [guide.ref]: 'ready', [generated]: 'other' } });
    const bundle = loadInstanceExtensions(root, undefined, { excludedPlugins: new Map([['generator', 'generation failed']]) });
    const wait = bundle.bindings.find(row => row.id === 'wait');
    assert(wait?.selected && wait.pendingGenerated && !wait.enabled);
    assert.equal(wait.reason, 'generation failed');
    assert(bundle.bindings.find(row => row.id === 'foreign')?.issue);
    assert(bundle.bindings.find(row => row.id === 'entry')?.issue);
    assert(bundle.bindings.find(row => row.ability === 'sibling')?.enabled);
  } },
];

export function runAll() {
  return runUnitCases(cases.map(test => ({ name: test.name, run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-loader-'));
    try { test.run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } })));
}
