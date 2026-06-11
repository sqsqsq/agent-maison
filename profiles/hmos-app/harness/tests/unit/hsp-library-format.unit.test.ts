// ============================================================================
// hsp-library-format.unit.test.ts — HSP 库模块 format 回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';

import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../../../../harness/config';
import { loadResolvedProfile } from '../../../../../harness/profile-loader';
import type { CheckContext, PhaseRuleSpec } from '../../../../../harness/scripts/utils/types';
import type { ModuleCatalog } from '../../../../../harness/scripts/utils/catalog-parser';
import { DEFAULT_LAYOUT } from '../../../../../harness/tests/utils/layout-test-helper';
import { isLibraryFormat } from '../../har-export-resolve';
import { checkEntryFileMatchesOhPackageMain } from '../../catalog-entry-file-har';
import { checkKeyExportsFreshVsIndex } from '../../catalog-key-exports-har';
import { profileCodingHost } from '../../coding-host-rules';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const PROFILES_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const hmosProfileDir = path.join(PROFILES_ROOT, 'hmos-app');

function stubCatalogPhaseRule(): PhaseRuleSpec {
  return {
    phase: 'catalog',
    structure_checks: {},
    traceability_checks: {
      entry_file_matches_oh_package_main: { description: 'entry_file 与 oh-package main 一致' },
      key_exports_fresh_vs_index: { description: 'key_exports 与导出入口同步' },
    },
  } as unknown as PhaseRuleSpec;
}

function stubCodingPhaseRule(): PhaseRuleSpec {
  return {
    phase: 'coding',
    structure_checks: {
      har_index_export: { description: 'HAR/HSP 库模块导出入口' },
    },
    traceability_checks: {},
  } as unknown as PhaseRuleSpec;
}

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsp-library-format-'));
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function buildCatalogCtx(root: string): CheckContext {
  clearFrameworkConfigCache();
  const cfg = loadFrameworkConfig(root);
  const resolvedProfile = loadResolvedProfile(root, cfg);
  return {
    phase: 'catalog',
    feature: '__global__',
    projectRoot: root,
    frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
    frameworkRel: DEFAULT_LAYOUT.frameworkRel,
    harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
    layoutKind: DEFAULT_LAYOUT.kind,
    phaseRule: stubCatalogPhaseRule(),
    featureSpec: { feature: '__global__' },
    resolvedProfile,
  };
}

function buildCodingCtx(root: string): CheckContext {
  clearFrameworkConfigCache();
  const cfg = loadFrameworkConfig(root);
  const resolvedProfile = loadResolvedProfile(root, cfg);
  return {
    phase: 'coding',
    feature: 'demo',
    projectRoot: root,
    frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
    frameworkRel: DEFAULT_LAYOUT.frameworkRel,
    harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
    layoutKind: DEFAULT_LAYOUT.kind,
    phaseRule: stubCodingPhaseRule(),
    featureSpec: {
      feature: 'demo',
      contracts: {
        feature: 'demo',
        source: 'plan.md',
        version: '1',
        module_dependencies: {},
        files: [],
        modules: [
          {
            name: 'DynamicLib',
            layer: '02-Feature',
            format: 'HSP',
            change_type: 'new',
            package_path: '02-Feature/DynamicLib',
          },
        ],
        data_models: [],
        interfaces: [],
        components: [],
      } as import('../../../../../harness/scripts/utils/types').ContractsSpec,
    },
    resolvedProfile,
  };
}

function seedHspModule(root: string): ModuleCatalog {
  writeFile(path.join(root, '02-Feature/DynamicLib/oh-package.json5'), `{
  "main": "index.ets"
}`);
  writeFile(path.join(root, '02-Feature/DynamicLib/index.ets'), 'export class SharedUtil {}\n');

  return {
    schema_version: '1.0',
    modules: [
      {
        name: 'DynamicLib',
        layer: '02-Feature',
        sub_layer: null,
        format: 'HSP',
        one_liner: '动态共享库 fixture',
        responsibilities: ['提供共享能力'],
        NOT_responsible_for: ['页面 UI'],
        typical_business_terms: ['动态库'],
        easily_confused_with: [],
        key_exports: ['SharedUtil'],
        entry_file: '02-Feature/DynamicLib/index.ets',
      },
    ],
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'isLibraryFormat: HAR/HSP 命中，HAP/undefined 不命中',
    run: () => {
      assert.strictEqual(isLibraryFormat('HAR'), true);
      assert.strictEqual(isLibraryFormat('HSP'), true);
      assert.strictEqual(isLibraryFormat('har'), true);
      assert.strictEqual(isLibraryFormat('hsp'), true);
      assert.strictEqual(isLibraryFormat('HAP'), false);
      assert.strictEqual(isLibraryFormat(undefined), false);
      assert.strictEqual(isLibraryFormat(''), false);
    },
  },
  {
    name: 'catalog: HSP 模块 entry_file_matches_oh_package_main PASS',
    run: () => withTmpDir(root => {
      const catalog = seedHspModule(root);
      const ctx = buildCatalogCtx(root);
      const results = checkEntryFileMatchesOhPackageMain(ctx, catalog);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].id, 'entry_file_matches_oh_package_main');
      assert.strictEqual(results[0].status, 'PASS');
    }),
  },
  {
    name: 'catalog: HSP 模块 key_exports_fresh_vs_index PASS',
    run: () => withTmpDir(root => {
      const catalog = seedHspModule(root);
      const ctx = buildCatalogCtx(root);
      const results = checkKeyExportsFreshVsIndex(ctx, catalog);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].id, 'key_exports_fresh_vs_index');
      assert.strictEqual(results[0].status, 'PASS');
    }),
  },
  {
    name: 'coding: HSP 模块 har_index_export PASS（非 SKIP）',
    run: () => withTmpDir(root => {
      seedHspModule(root);
      const ctx = buildCodingCtx(root);
      const results = profileCodingHost.runStructureChecks(ctx, []);
      const hit = results.find(r => r.id === 'har_index_export');
      assert.ok(hit, '必须产出 har_index_export');
      assert.strictEqual(hit!.status, 'PASS', hit!.details);
      assert.match(hit!.details ?? '', /HAR\/HSP/);
    }),
  },
  {
    name: 'hmos-app profile.yaml 含 HSP 枚举',
    run: () => {
      const yaml = fs.readFileSync(path.join(hmosProfileDir, 'profile.yaml'), 'utf-8');
      assert.match(yaml, /catalog_allowed_module_formats:[\s\S]*- HSP/m);
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
