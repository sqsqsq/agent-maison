// ============================================================================
// extension-loader.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadInstanceExtensions,
  applyInstanceExtensions,
} from '../../extension-loader';
import type { HarnessResolvedProfile } from '../../scripts/utils/types';
import { extensionSkillIdsForBridge } from '../../extension-loader';
import { checkExtensionManifest } from '../../scripts/utils/extension-runtime';
import { buildAgentsTemplateVars } from '../../scripts/utils/template-renderer';
import { clearFrameworkConfigCache } from '../../config';

const FRAMEWORK_DIR = path.resolve(__dirname, '..', '..', '..');

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ext-load-'));
}

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function baseResolved(): HarnessResolvedProfile {
  return {
    name: 'unit-profile',
    profileDir: '/tmp/no-such-profile',
    yaml: { name: 'unit-profile' },
    phasesDisabled: new Set(),
    capabilities: {
      'coding.compile': { provider: 'hvigor', severity: 'BLOCKER' },
    },
    personalPrerequisites: {},
  };
}

interface Case {
  name: string;
  run: () => void;
}

const cases: Case[] = [
  {
    name: '无 doc/extensions 目录 → rootDir=null',
    run: () => {
      const dir = mkTmp();
      const b = loadInstanceExtensions(dir);
      assert(b.rootDir === null, 'rootDir');
      assert(b.errors.length === 0, 'errors');
      assert(b.skills.length === 0, 'skills');
    },
  },
  {
    name: '有扩展目录但无 manifest.yaml → 空 provides',
    run: () => {
      const dir = mkTmp();
      fs.mkdirSync(path.join(dir, 'doc', 'extensions'), { recursive: true });
      const b = loadInstanceExtensions(dir);
      assert(b.rootDir !== null, 'rootDir set');
      assert(b.manifestPath === null, 'manifest');
      assert(b.skills.length === 0 && b.errors.length === 0, 'clean');
    },
  },
  {
    name: 'manifest name 非法类型 → errors + provides 清空',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(root, { recursive: true });
      write(path.join(root, 'manifest.yaml'), 'schema_version: "1.0"\nname: 123\n');
      const b = loadInstanceExtensions(dir);
      assert(b.errors.some(e => e.code === 'manifest_name'), 'manifest_name');
      assert(b.skills.length === 0, 'wiped skills');
    },
  },
  {
    name: '合法 manifest → skills / knowledge / hooks / capability / overlay 路径生效',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
      write(path.join(root, 'knowledge', 'x.md'), '# x');
      fs.mkdirSync(path.join(root, 'hooks', 'catalog'), { recursive: true });
      write(path.join(root, 'hooks', 'catalog', 'pre_phase.mjs'), 'export default async () => ({})');
      write(path.join(root, 'caps', 'p.ts'), 'export const x = 1;\n');
      write(
        path.join(root, 'overlay', 'coding-rules.overlay.yaml'),
        [
          'phase: coding',
          'version: "9"',
          'applies_to: test',
          'structure_checks: {}',
          'semantic_checks: {}',
          'traceability_checks: {}',
        ].join('\n'),
      );
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: demo-ext',
          'provides:',
          '  skills: [ my-skill ]',
          '  knowledge: [ knowledge/x.md ]',
          '  hooks:',
          '    catalog:',
          '      pre_phase: [ hooks/catalog/pre_phase.mjs ]',
          '  capabilities:',
          '    business.x:',
          '      provider: caps/p.ts',
          '      severity: MAJOR',
          '  phase_rules_overlays:',
          '    coding: overlay/coding-rules.overlay.yaml',
        ].join('\n'),
      );
      const b = loadInstanceExtensions(dir);
      assert(b.errors.length === 0, JSON.stringify(b.errors));
      assert(b.skills.includes('my-skill'), 'skills');
      assert(b.knowledgePaths.some(p => p.endsWith(`${path.sep}x.md`)), 'knowledge');
      assert(b.hooks.catalog?.pre_phase?.length === 1, 'hooks');
      const pr = b.extensionCapabilities['business.x']?.provider;
      assert(pr !== undefined && pr.endsWith(`${path.sep}p.ts`), 'cap');
      assert(b.phaseRuleOverlayPaths.coding?.includes('coding-rules.overlay.yaml'), 'overlay');
    },
  },
  {
    name: 'phase_rules_overlay 指向缺失文件 → errors + provides 清空',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(root, { recursive: true });
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: bad-overlay',
          'provides:',
          '  phase_rules_overlays:',
          '    coding: missing.yaml',
        ].join('\n'),
      );
      const b = loadInstanceExtensions(dir);
      assert(b.errors.some(e => e.code === 'overlay_missing'), 'overlay_missing');
      assert(b.phaseRuleOverlayPaths.coding === undefined, 'wiped');
    },
  },
  {
    name: 'applyInstanceExtensions：extension capability 覆盖 profile 同名 key',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(path.join(root, 'caps'), { recursive: true });
      write(path.join(root, 'caps', 'override.ts'), 'export const z = 1;\n');
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: cap-override',
          'provides:',
          '  capabilities:',
          '    coding.compile:',
          '      provider: caps/override.ts',
          '      severity: SKIP',
        ].join('\n'),
      );
      const resolved = applyInstanceExtensions(baseResolved(), dir);
      assert(resolved.capabilities['coding.compile']?.severity === 'SKIP', 'override severity');
      const prov = resolved.capabilities['coding.compile']?.provider;
      assert(prov !== undefined && prov.includes('override.ts'), 'override path');
    },
  },
  {
    name: 'manifest 校验失败时不合并 capability（保留 profile 原值）',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(root, { recursive: true });
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: bad',
          'provides:',
          '  capabilities:',
          '    coding.compile:',
          '      provider: missing.ts',
          '      severity: MAJOR',
        ].join('\n'),
      );
      const resolved = applyInstanceExtensions(baseResolved(), dir);
      assert(resolved.extensionBundle!.errors.length > 0, 'errors');
      assert(resolved.capabilities['coding.compile']?.provider === 'hvigor', 'profile kept');
    },
  },
  {
    name: 'provides.skill_assets 解析为绝对路径并合并 skillId/assetKey',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
      write(path.join(root, 'assets', 'extra.md'), '# extra\n');
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: skill-assets-ext',
          'provides:',
          '  skill_assets:',
          '    spec:',
          '      prd_template: assets/extra.md',
        ].join('\n'),
      );
      const b = loadInstanceExtensions(dir);
      assert(b.errors.length === 0, JSON.stringify(b.errors));
      const abs = b.skillAssetAbsPaths.spec?.prd_template;
      assert(abs !== undefined && abs.endsWith(`${path.sep}extra.md`), 'skill asset abs');
    },
  },
  {
    name: 'legacy phase key prd/design：hooks 与 phase_rules_overlays 规范化为 spec/plan',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(path.join(root, 'hooks', 'spec'), { recursive: true });
      fs.mkdirSync(path.join(root, 'hooks', 'plan'), { recursive: true });
      write(path.join(root, 'hooks', 'spec', 'pre.mjs'), 'export default async () => ({})');
      write(path.join(root, 'hooks', 'plan', 'pre.mjs'), 'export default async () => ({})');
      write(
        path.join(root, 'overlay-spec.yaml'),
        [
          'phase: spec',
          'version: "1"',
          'applies_to: test',
          'structure_checks: {}',
          'semantic_checks: {}',
          'traceability_checks: {}',
        ].join('\n'),
      );
      write(
        path.join(root, 'overlay-plan.yaml'),
        [
          'phase: plan',
          'version: "1"',
          'applies_to: test',
          'structure_checks: {}',
          'semantic_checks: {}',
          'traceability_checks: {}',
        ].join('\n'),
      );
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: legacy-phase-keys',
          'provides:',
          '  hooks:',
          '    prd:',
          '      pre_phase: [ hooks/spec/pre.mjs ]',
          '    design:',
          '      pre_phase: [ hooks/plan/pre.mjs ]',
          '  phase_rules_overlays:',
          '    prd: overlay-spec.yaml',
          '    design: overlay-plan.yaml',
        ].join('\n'),
      );
      const warnSpy = console.warn;
      const warns: string[] = [];
      console.warn = (...args: unknown[]) => {
        warns.push(args.map(String).join(' '));
      };
      try {
        const b = loadInstanceExtensions(dir);
        assert(b.errors.length === 0, JSON.stringify(b.errors));
        assert(b.hooks.spec?.pre_phase?.length === 1, 'spec hook');
        assert(b.hooks.plan?.pre_phase?.length === 1, 'plan hook');
        assert(b.hooks.prd === undefined && b.hooks.design === undefined, 'no legacy hook keys');
        assert(
          b.phaseRuleOverlayPaths.spec?.includes('overlay-spec.yaml'),
          'spec overlay',
        );
        assert(
          b.phaseRuleOverlayPaths.plan?.includes('overlay-plan.yaml'),
          'plan overlay',
        );
        assert(
          warns.some((w) => w.includes('hooks') && w.includes('prd')),
          'warn hooks prd',
        );
      } finally {
        console.warn = warnSpy;
      }
    },
  },
  {
    name: '自定义 paths.extension_dir：相对实例根解析',
    run: () => {
      const dir = mkTmp();
      const alt = path.join(dir, 'my-ext');
      fs.mkdirSync(alt, { recursive: true });
      write(path.join(alt, 'manifest.yaml'), 'schema_version: "1.0"\nname: alt-root\n');
      const b = loadInstanceExtensions(dir, 'my-ext');
      assert(b.manifestPath !== null && b.manifestPath.includes('my-ext'), 'manifest path');
      assert(b.errors.length === 0, 'valid');
    },
  },
  {
    name: 'manifest 1.1：knowledge audience、mcp_actions、三槽位解析',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      write(path.join(root, 'skills', 'story-input', 'SKILL.md'), '# story\n');
      write(path.join(root, 'knowledge', 'global.md'), '# global\n');
      write(path.join(root, 'knowledge', 'spec.md'), '# spec\n');
      write(path.join(root, 'manifest.yaml'), [
        'schema_version: "1.1"', 'name: extension-11', 'provides:',
        '  skills: [story-input]', '  knowledge:',
        '    - path: knowledge/global.md', '      summary: 全局约束', '      audience: global',
        '    - path: knowledge/spec.md', '      summary: spec 输入', '      audience: [spec]',
        '    - knowledge/legacy.md',
        '  mcp_actions:', '    fetch-story:', '      tool: story.fetch', '      required: true',
        '      severity: BLOCKER', '      produces: [doc/requirements/story.materialization.json]',
        '      usage: component design 前取数',
        'phase_bindings:', '  spec:', '    before_phase_work:',
        '      - { kind: knowledge, ref: knowledge/spec.md }', '    before_phase_verify:',
        '      - { kind: mcp, ref: fetch-story }', '',
      ].join('\n'));
      write(path.join(root, 'knowledge', 'legacy.md'), '# legacy\n');
      const b = loadInstanceExtensions(dir);
      assert(b.errors.length === 0, JSON.stringify(b.errors));
      assert(b.manifestVersion === '1.1', 'version');
      assert(b.knowledge.some(item => item.audience === 'global' && !item.legacy), 'global');
      assert(b.knowledge.some(item => item.legacy && Array.isArray(item.audience)), 'legacy');
      assert(b.mcpActions['fetch-story']?.severity === 'BLOCKER', 'action');
      assert(b.phaseBindings.spec?.before_phase_verify?.[0]?.ref === 'fetch-story', 'binding');
    },
  },
  {
    name: 'manifest 1.1：MCP 连接字段与 before_component_design 均拒绝',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      write(path.join(root, 'manifest.yaml'), [
        'schema_version: "1.1"', 'name: forbidden', 'provides:', '  mcp_actions:', '    bad:',
        '      tool: bad.tool', '      required: true', '      produces: [doc/out.json]', '      usage: bad',
        '      token: secret', 'phase_bindings:', '  spec:', '    before_component_design: []', '',
      ].join('\n'));
      const b = loadInstanceExtensions(dir);
      assert(b.errors.some(error => error.code === 'mcp_action_forbidden_field'), 'token rejected');
      assert(b.errors.some(error => error.code === 'phase_binding_slot'), 'slot rejected');
      assert(Object.keys(b.mcpActions).length === 0 && Object.keys(b.phaseBindings).length === 0, 'wiped');
    },
  },
  {
    name: 'manifest 1.1：component-design / catalog / 未知 slug 均不是 Feature phase',
    run: () => {
      for (const phase of ['component-design', 'catalog', 'specc']) {
        const dir = mkTmp();
        const root = path.join(dir, 'doc', 'extensions');
        write(path.join(root, 'manifest.yaml'), [
          'schema_version: "1.1"', 'name: bad-phase', 'provides:', '  skills: []',
          'phase_bindings:', `  ${phase}:`, '    before_phase_work: []', '',
        ].join('\n'));
        const b = loadInstanceExtensions(dir);
        assert(b.errors.some(error => error.code === 'phase_binding_phase'), `${phase}: ${JSON.stringify(b.errors)}`);
      }
    },
  },
  {
    name: 'manifest 1.1：knowledge audience 也只接受 active workflow Feature phase',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      write(path.join(root, 'knowledge', 'bad.md'), '# bad\n');
      write(path.join(root, 'manifest.yaml'), [
        'schema_version: "1.1"', 'name: bad-audience', 'provides:', '  knowledge:',
        '    - { path: knowledge/bad.md, summary: bad, audience: [catalog] }', '',
      ].join('\n'));
      const b = loadInstanceExtensions(dir);
      assert(b.errors.some(error => error.code === 'provides_knowledge_item'), JSON.stringify(b.errors));
    },
  },
  {
    name: 'manifest 1.1：active workflow 的 full/lite 并集与自定义 Feature phase',
    run: () => {
      const defaults = mkTmp();
      const defaultRoot = path.join(defaults, 'doc', 'extensions');
      write(path.join(defaultRoot, 'manifest.yaml'), 'schema_version: "1.1"\nname: default-phases\nprovides: {}\n');
      const defaultBundle = loadInstanceExtensions(defaults);
      for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing', 'change', 'exit']) {
        assert(defaultBundle.featurePhases.includes(phase), `default phase missing: ${phase}`);
      }

      const dir = mkTmp();
      const frameworkRoot = path.join(dir, 'framework');
      write(path.join(frameworkRoot, 'workflows', 'custom.workflow.yaml'), [
        'schema_version: "1.0"', 'name: custom', 'auto_chain: [custom-work]', 'artifacts:',
        '  - id: custom-global', '    scope: global', '    requires: []',
        '  - id: custom-work', '    scope: feature', '    requires: []', '',
      ].join('\n'));
      write(path.join(dir, 'framework.config.json'), JSON.stringify({ active_workflow: 'custom' }));
      const root = path.join(dir, 'doc', 'extensions');
      write(path.join(root, 'knowledge', 'custom.md'), '# custom\n');
      write(path.join(root, 'manifest.yaml'), [
        'schema_version: "1.1"', 'name: custom-phases', 'provides:', '  knowledge:',
        '    - { path: knowledge/custom.md, summary: custom, audience: [custom-work] }',
        'phase_bindings:', '  custom-work:', '    before_phase_work:',
        '      - { kind: knowledge, ref: knowledge/custom.md }', '',
      ].join('\n'));
      const custom = loadInstanceExtensions(dir, undefined, { frameworkRoot });
      assert(custom.errors.length === 0, JSON.stringify(custom.errors));
      assert(custom.featurePhases.includes('custom-work') && !custom.featurePhases.includes('custom-global'), 'custom scopes');

      write(path.join(dir, 'framework.config.json'), JSON.stringify({ active_workflow: 'missing' }));
      clearFrameworkConfigCache();
      const unresolved = loadInstanceExtensions(dir, undefined, { frameworkRoot });
      assert(unresolved.errors.some(error => error.code === 'manifest_workflow_unresolvable'), JSON.stringify(unresolved.errors));
    },
  },
  {
    name: 'manifest 非法：bridge 选择严格为空且 manifest 诊断保留',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      write(path.join(root, 'skills', 'rogue', 'SKILL.md'), '# rogue\n');
      write(path.join(root, 'manifest.yaml'), [
        'schema_version: "1.1"', 'name: invalid', 'unknown: true', 'provides:', '  skills: []',
        '  mcp_actions:', '    required:', '      tool: host.required', '      required: true',
        '      produces: [doc/missing.json]', '      usage: required', 'phase_bindings:', '  spec:',
        '    before_phase_verify:', '      - { kind: mcp, ref: required }', '',
      ].join('\n'));
      const b = loadInstanceExtensions(dir);
      assert(b.errors.some(error => error.code === 'manifest_unknown_field'), JSON.stringify(b.errors));
      assert(extensionSkillIdsForBridge(b)?.length === 0, 'invalid manifest must select zero skills');
      assert(checkExtensionManifest(b).some(check => check.status === 'FAIL' && check.severity === 'BLOCKER'), 'Feature gate blocker');
      const vars = buildAgentsTemplateVars({ project_name: 'invalid' }, {
        entryFile: 'AGENTS.md', projectRoot: dir, frameworkRoot: FRAMEWORK_DIR,
      });
      assert(!vars.EXTENSION_SKILL_SECTION.includes('rogue'), 'invalid manifest must not inject rogue into AGENTS');
    },
  },
  {
    name: 'paths.extension_dir：拒绝越界/绝对/盘符，接受自定义相对路径',
    run: () => {
      const dir = mkTmp();
      for (const bad of ['../outside', '/absolute', 'C:/outside']) {
        const b = loadInstanceExtensions(dir, bad);
        assert(b.errors.some(error => error.code === 'extension_dir_path'), `${bad}: ${JSON.stringify(b.errors)}`);
      }
      write(path.join(dir, 'my', 'extensions', 'manifest.yaml'), 'schema_version: "1.0"\nname: safe\n');
      const safe = loadInstanceExtensions(dir, 'my/extensions');
      assert(safe.errors.length === 0 && Boolean(safe.manifestPath?.includes(path.join('my', 'extensions'))), JSON.stringify(safe.errors));
    },
  },
  {
    name: 'manifest 1.0：新域不消费且 legacy knowledge 保持无 audience 行为',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      write(path.join(root, 'knowledge', 'legacy.md'), '# legacy\n');
      write(path.join(root, 'manifest.yaml'), [
        'schema_version: "1.0"', 'name: legacy', 'provides:', '  knowledge: [knowledge/legacy.md]',
        '  mcp_actions:', '    ignored: { tool: x, required: true, produces: [doc/x], usage: x }',
        'phase_bindings:', '  spec:', '    before_phase_work: [{ kind: mcp, ref: ignored }]', '',
      ].join('\n'));
      const b = loadInstanceExtensions(dir);
      assert(b.errors.length === 0, JSON.stringify(b.errors));
      assert(b.manifestVersion === '1.0' && b.knowledge.length === 1, 'legacy loaded');
      assert(Object.keys(b.mcpActions).length === 0 && Object.keys(b.phaseBindings).length === 0, 'new behavior absent');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
