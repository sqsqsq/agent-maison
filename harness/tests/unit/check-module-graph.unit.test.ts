// ============================================================================
// check-module-graph.unit.test.ts — module-graph 全局 phase 回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { computeAnchorContentHash } from '../../code-graph/anchor-hash';
import checker from '../../scripts/check-module-graph';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import type { CheckContext } from '../../scripts/utils/types';
import { ensureConsumerFrameworkTree, layoutFieldsForHost } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeMinimalProject(root: string): void {
  ensureConsumerFrameworkTree(root);
  writeFile(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.1',
      project_name: 'module-graph-unit',
      project_type: 'app',
      project_profile: { name: 'generic' },
      agent_adapter: 'generic',
      architecture: {
        outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'forbid' }],
        module_inner_layers: ['shared'],
        inner_dependency_direction: 'upward',
        cross_module_exports_file: 'index.ets',
      },
      paths: {
        features_dir: 'doc/features',
        module_catalog: 'doc/module-catalog.yaml',
        glossary: 'doc/glossary.yaml',
        glossary_seed: 'doc/glossary-seed.txt',
        architecture_md: 'doc/architecture.md',
        extension_dir: 'doc/extensions',
        docs_committed: false,
      },
    }),
  );
  writeFile(
    path.join(root, 'doc', 'module-catalog.yaml'),
    [
      'schema_version: "1.0"',
      'modules:',
      '  - name: DemoMod',
      '    layer: 02-Feature',
      '    sub_layer: null',
      '    one_liner: demo',
      '    responsibilities: []',
      '    NOT_responsible_for: []',
      '    typical_business_terms: []',
      '    easily_confused_with: []',
      '    key_exports: []',
      '    entry_file: index.ets',
    ].join('\n'),
  );
}

function ctx(root: string): CheckContext {
  clearFrameworkConfigCache();
  const loader = new SpecLoader(FRAMEWORK_ROOT);
  const phaseRule = loader.loadPhaseRule('module-graph');
  return {
    phase: 'module-graph',
    feature: '',
    projectRoot: root,
    ...layoutFieldsForHost(root),
    phaseRule,
    featureSpec: { feature: '' } as CheckContext['featureSpec'],
    resolvedProfile: {
      name: 'generic',
      profileDir: path.join(FRAMEWORK_ROOT, 'profiles', 'generic'),
      yaml: {} as CheckContext['resolvedProfile']['yaml'],
      phasesDisabled: new Set(),
      capabilities: {},
      personalPrerequisites: {},
    },
  };
}

async function withProject<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-module-graph-'));
  writeMinimalProject(dir);
  try {
    return await fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: '零图谱 → PASS（no_module_graphs）',
    run: async () => withProject(async root => {
      const results = await checker.check(ctx(root));
      const hit = results.find(r => r.id === 'no_module_graphs');
      assert(hit?.status === 'PASS', `expected PASS, got ${hit?.status}`);
    }),
  },
  {
    name: 'schema 非法 → code_graph_schema_valid BLOCKER',
    run: async () => withProject(async root => {
      writeFile(
        path.join(root, '02-Feature', 'DemoMod', 'code-graph.yaml'),
        'schema_version: "1.0"\nmodule: DemoMod\nnodes: not-an-array\n',
      );
      const results = await checker.check(ctx(root));
      const hit = results.find(r => r.id === 'code_graph_schema_valid' && r.status === 'FAIL');
      assert(hit?.severity === 'BLOCKER', 'schema invalid must BLOCKER');
    }),
  },
  {
    name: '缺 content_hash → code_graph_schema_valid BLOCKER',
    run: async () => withProject(async root => {
      const rel = '02-Feature/DemoMod/src/NoHash.ets';
      writeFile(path.join(root, rel), 'function nohash() { return 0; }');
      writeFile(
        path.join(root, '02-Feature', 'DemoMod', 'code-graph.yaml'),
        [
          'schema_version: "1.0"',
          'module: DemoMod',
          'nodes:',
          '  - id: n1',
          '    core: true',
          '    anchor:',
          `      file: ${rel}`,
          '      symbol: nohash',
        ].join('\n'),
      );
      const results = await checker.check(ctx(root));
      const hit = results.find(r => r.id === 'code_graph_schema_valid' && r.status === 'FAIL');
      assert(hit?.severity === 'BLOCKER', 'missing content_hash must BLOCKER');
      assert(
        (hit?.details ?? '').includes('content_hash'),
        `details=${hit?.details}`,
      );
    }),
  },
  {
    name: '缺锚文件 → anchor_file_present BLOCKER',
    run: async () => withProject(async root => {
      writeFile(
        path.join(root, '02-Feature', 'DemoMod', 'code-graph.yaml'),
        [
          'schema_version: "1.0"',
          'module: DemoMod',
          'nodes:',
          '  - id: n1',
          '    core: true',
          '    anchor:',
          '      file: src/Missing.ets',
          '      symbol: foo',
          '      content_hash: abc',
        ].join('\n'),
      );
      const results = await checker.check(ctx(root));
      const hit = results.find(r => r.id === 'anchor_file_present' && r.status === 'FAIL');
      assert(hit?.severity === 'BLOCKER', 'missing file BLOCKER');
    }),
  },
  {
    name: '非 core 体变 → noncore_body_drift WARN',
    run: async () => withProject(async root => {
      const rel = '02-Feature/DemoMod/src/Foo.ets';
      const body = 'function foo() { return 1; }';
      writeFile(path.join(root, rel), body);
      writeFile(
        path.join(root, '02-Feature', 'DemoMod', 'code-graph.yaml'),
        [
          'schema_version: "1.0"',
          'module: DemoMod',
          'nodes:',
          '  - id: n1',
          '    anchor:',
          '      file: 02-Feature/DemoMod/src/Foo.ets',
          '      symbol: foo',
          '      content_hash: deadbeef00000000',
        ].join('\n'),
      );
      const results = await checker.check(ctx(root));
      const hit = results.find(r => r.id === 'noncore_body_drift');
      assert(hit?.status === 'WARN', `expected WARN, got ${hit?.status}`);
    }),
  },
  {
    name: 'core 体变 → core_anchor_drift BLOCKER',
    run: async () => withProject(async root => {
      const rel = '02-Feature/DemoMod/src/Core.ets';
      const body = 'function bar() { return 2; }';
      writeFile(path.join(root, rel), body);
      writeFile(
        path.join(root, '02-Feature', 'DemoMod', 'code-graph.yaml'),
        [
          'schema_version: "1.0"',
          'module: DemoMod',
          'nodes:',
          '  - id: core1',
          '    core: true',
          '    anchor:',
          '      file: 02-Feature/DemoMod/src/Core.ets',
          '      symbol: bar',
          '      content_hash: deadbeef00000000',
        ].join('\n'),
      );
      const results = await checker.check(ctx(root));
      const hit = results.find(r => r.id === 'core_anchor_drift' && r.status === 'FAIL');
      assert(hit?.severity === 'BLOCKER', 'core drift BLOCKER');
    }),
  },
  {
    name: '锚 hash 匹配 → schema PASS 且无 drift FAIL',
    run: async () => withProject(async root => {
      const rel = '02-Feature/DemoMod/src/Ok.ets';
      const body = 'function ok() { return 0; }';
      writeFile(path.join(root, rel), body);
      const hash = computeAnchorContentHash(root, rel, 'ok');
      assert(hash !== null, 'hash computed');
      writeFile(
        path.join(root, '02-Feature', 'DemoMod', 'code-graph.yaml'),
        [
          'schema_version: "1.0"',
          'module: DemoMod',
          'nodes:',
          '  - id: n1',
          '    core: true',
          '    anchor:',
          `      file: ${rel}`,
          '      symbol: ok',
          `      content_hash: ${hash}`,
        ].join('\n'),
      );
      const results = await checker.check(ctx(root));
      assert(
        results.some(r => r.id === 'code_graph_schema_valid' && r.status === 'PASS'),
        'schema pass',
      );
      assert(
        !results.some(r => r.status === 'FAIL' && r.id !== 'code_graph_schema_valid'),
        `unexpected FAIL: ${results.filter(r => r.status === 'FAIL').map(r => r.id).join(',')}`,
      );
    }),
  },
  {
    name: 'listAvailablePhaseRules 含 module-graph',
    run: async () => {
      const loader = new SpecLoader(FRAMEWORK_ROOT);
      const phases = loader.listAvailablePhaseRules();
      assert(phases.includes('module-graph'), `phases=${phases.join(',')}`);
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (e) {
      out.push({
        name: c.name,
        ok: false,
        error: e instanceof Error ? e.stack ?? e.message : String(e),
      });
    }
  }
  return out;
}
