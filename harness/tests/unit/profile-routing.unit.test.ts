// ============================================================================
// profile-routing.unit.test.ts — project_profile defaults / capability / prompt overlay
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  clearFrameworkConfigCache,
  featurePhaseReportsDir,
  loadFrameworkConfig,
  resetFrameworkConfigWarningsForTest,
} from '../../config';
import {
  dispatchCodingCompile,
  isCapabilitySkipped,
} from '../../capability-registry';
import { assembleAIPrompt } from '../../scripts/utils/report-generator';
import type { CheckContext, HarnessResolvedProfile } from '../../scripts/utils/types';
import { withDefaultLayoutFields, ensureConsumerFrameworkTree } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertIncludes(actual: string, expected: string, label: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`${label}\nexpected substring: ${expected}\nactual: ${actual}`);
  }
}

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function resolvedProfile(
  profileDir: string,
  capabilities: HarnessResolvedProfile['capabilities'],
): HarnessResolvedProfile {
  return {
    name: 'unit-profile',
    profileDir,
    yaml: { name: 'unit-profile', capabilities },
    phasesDisabled: new Set(),
    capabilities,
  };
}

function ctxFor(profile: HarnessResolvedProfile): CheckContext {
  return withDefaultLayoutFields({
    phase: 'coding',
    feature: 'demo',
    projectRoot: process.cwd(),
    phaseRule: { phase: 'coding', structure_checks: {}, semantic_checks: {}, traceability_checks: {} } as any,
    featureSpec: { feature: 'demo' },
    resolvedProfile: profile,
  });
}

interface Case { name: string; run: () => void; }

const cases: Case[] = [
  {
    name: 'capability registry: provider module is dynamically required',
    run: () => {
      const dir = mkTmp('profile-provider-ok-');
      writeFile(
        path.join(dir, 'harness', 'providers', 'unit-provider.js'),
        `exports.provider = { id: 'unit-provider', capability: 'coding.compile', exports: ['runHvigorAssembleApp'] };\nexports.runHvigorAssembleApp = (options) => ({ executed: true, feature: options.feature });\n`,
      );
      const profile = resolvedProfile(dir, {
        'coding.compile': { provider: 'unit-provider', severity: 'BLOCKER' },
      });
      const result = dispatchCodingCompile(ctxFor(profile), { feature: 'demo' });
      assert(result.executed === true, 'provider result should be returned');
      assert(result.feature === 'demo', 'dispatch should pass options into provider export');
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'capability registry: SKIP capability does not require provider',
    run: () => {
      const dir = mkTmp('profile-provider-skip-');
      const profile = resolvedProfile(dir, {
        'coding.compile': { provider: 'none', severity: 'SKIP' },
      });
      assert(isCapabilitySkipped(profile, 'coding.compile'), 'SKIP severity should be detected');
      let thrown = '';
      try {
        dispatchCodingCompile(ctxFor(profile), { feature: 'demo' });
      } catch (err) {
        thrown = (err as Error).message;
      }
      assertIncludes(thrown, '不可执行', 'dispatching skipped capability should fail before provider require');
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'capability registry: missing provider export is reported',
    run: () => {
      const dir = mkTmp('profile-provider-bad-export-');
      writeFile(
        path.join(dir, 'harness', 'providers', 'bad-provider.js'),
        `exports.provider = { id: 'bad-provider', capability: 'coding.compile', exports: ['runHvigorAssembleApp'] };\nexports.other = () => null;\n`,
      );
      const profile = resolvedProfile(dir, {
        'coding.compile': { provider: 'bad-provider', severity: 'BLOCKER' },
      });
      let thrown = '';
      try {
        dispatchCodingCompile(ctxFor(profile), { feature: 'demo' });
      } catch (err) {
        thrown = (err as Error).message;
      }
      assertIncludes(thrown, '缺少导出函数 runHvigorAssembleApp', 'missing provider export should be explicit');
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'capability registry: provider metadata capability mismatch is reported',
    run: () => {
      const dir = mkTmp('profile-provider-bad-meta-');
      writeFile(
        path.join(dir, 'harness', 'providers', 'bad-meta-provider.js'),
        `exports.provider = { id: 'bad-meta-provider', capability: 'ut.compile', exports: ['runHvigorAssembleApp'] };\nexports.runHvigorAssembleApp = () => null;\n`,
      );
      const profile = resolvedProfile(dir, {
        'coding.compile': { provider: 'bad-meta-provider', severity: 'BLOCKER' },
      });
      let thrown = '';
      try {
        dispatchCodingCompile(ctxFor(profile), { feature: 'demo' });
      } catch (err) {
        thrown = (err as Error).message;
      }
      assertIncludes(thrown, 'provider metadata capability 不匹配', 'metadata capability mismatch should be explicit');
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'verify prompt: profile overlay is appended when present',
    run: () => {
      const projectRoot = mkTmp('prompt-overlay-proj-');
      ensureConsumerFrameworkTree(projectRoot);
      const harnessRoot = path.join(projectRoot, 'framework', 'harness');
      const profileDir = mkTmp('prompt-overlay-profile-');
      fs.mkdirSync(path.join(harnessRoot, 'prompts'), { recursive: true });
      writeFile(path.join(harnessRoot, 'prompts', 'verify-coding.md'), 'base {feature_name} {context_files}');
      writeFile(path.join(profileDir, 'harness', 'prompts', 'verify-coding.overlay.md'), 'overlay rules');
      const assembled = assembleAIPrompt(
        harnessRoot,
        projectRoot,
        'coding',
        'demo',
        [{ label: 'Doc', content: 'content' }],
        '{}',
        'phase: coding',
        resolvedProfile(profileDir, {}),
      );
      assertIncludes(assembled, 'base demo', 'base template should still be rendered');
      assertIncludes(assembled, 'Profile Overlay：unit-profile', 'profile overlay heading should be appended');
      assertIncludes(assembled, 'overlay rules', 'overlay content should be appended');
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(profileDir, { recursive: true, force: true });
    },
  },
  {
    name: 'config defaults: missing project_profile falls back to hmos-app with advisory',
    run: () => {
      const root = mkTmp('profile-config-missing-');
      writeFile(path.join(root, 'framework.config.json'), JSON.stringify({
        schema_version: '1.0',
        project_name: 'missing-profile',
        agent_adapter: 'generic',
      }, null, 2));
      clearFrameworkConfigCache();
      resetFrameworkConfigWarningsForTest();
      const warns: string[] = [];
      const oldWarn = console.warn;
      console.warn = (msg?: unknown) => { warns.push(String(msg)); };
      try {
        const cfg = loadFrameworkConfig(root);
        assert(cfg.project_profile.name === 'hmos-app', 'missing profile should normalize to hmos-app');
        assert(cfg.architecture.outer_layers.length === 5, 'hmos-app profile defaults should supply architecture');
      } finally {
        console.warn = oldWarn;
        clearFrameworkConfigCache();
        resetFrameworkConfigWarningsForTest();
        fs.rmSync(root, { recursive: true, force: true });
      }
      assert(warns.some(w => w.includes('缺少 `project_profile`')), 'missing profile advisory should be emitted');
    },
  },
  {
    name: 'config defaults: 磁盘未写 reports_dir_pattern → normalize 注入，featurePhaseReportsDir 走 doc/features',
    run: () => {
      const root = mkTmp('profile-reports-default-');
      writeFile(path.join(root, 'framework.config.json'), JSON.stringify({
        schema_version: '1.1',
        project_name: 'legacy-reports',
        project_profile: { name: 'hmos-app', sub_variant: 'app' },
        agent_adapter: 'generic',
        architecture: {
          outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: {
          features_dir: 'doc/features',
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          glossary_seed: 'doc/glossary-seed.txt',
          architecture_md: 'doc/architecture.md',
        },
      }, null, 2));
      clearFrameworkConfigCache();
      try {
        ensureConsumerFrameworkTree(root);
        const cfg = loadFrameworkConfig(root);
        assert(
          cfg.paths.reports_dir_pattern === 'doc/features/<feature>/<phase>/reports',
          `normalize 应注入 reports_dir_pattern；实际：${String(cfg.paths.reports_dir_pattern)}`,
        );
        const reportsDir = featurePhaseReportsDir(root, 'demo-feature', 'coding');
        assert(
          reportsDir.replace(/\\/g, '/').includes('doc/features/demo-feature/coding/reports'),
          `应走 doc/features 外置路径；实际：${reportsDir}`,
        );
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'config defaults: generic profile uses generic architecture defaults',
    run: () => {
      const root = mkTmp('profile-config-generic-');
      writeFile(path.join(root, 'framework.config.json'), JSON.stringify({
        schema_version: '1.0',
        project_name: 'generic-profile',
        project_profile: { name: 'generic' },
        agent_adapter: 'generic',
      }, null, 2));
      clearFrameworkConfigCache();
      try {
        const cfg = loadFrameworkConfig(root);
        assert(cfg.project_profile.name === 'generic', 'explicit generic profile should be preserved');
        assert(cfg.architecture.outer_layers.length === 1, 'generic profile should not inherit hmos 5-layer defaults');
        assert(cfg.architecture.outer_layers[0].id === 'app', 'generic profile should use generic layer id');
        assert(cfg.architecture.module_inner_layers[0] === 'content', 'generic profile should use generic inner layer');
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
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
