// ============================================================================
// module-graph-probe.unit.test.ts — probe readiness（schema + drift + 异常路径）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { computeAnchorContentHash } from '../../code-graph/anchor-hash';
import { probeModuleGraphReadiness } from '../../code-graph/module-graph-probe';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'module-graph-probe-'));
}

function writeMinimalConfig(root: string): void {
  fs.mkdirSync(path.join(root, 'doc'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.0',
        project_profile: { name: 'generic-app' },
        paths: {
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          features_dir: 'doc/features',
          architecture_md: 'doc/architecture.md',
        },
        architecture: {
          outer_layers: [{ id: 'Feature', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['shared'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
}

const CATALOG_MODULE_YAML = (name: string) =>
  `schema_version: "1.0"\nmodules:\n  - name: ${name}\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n`;

function writeValidGraph(root: string, moduleName = 'Wallet'): void {
  const anchorRel = `Feature/${moduleName}/index.ets`;
  const anchorAbs = path.join(root, ...anchorRel.split('/'));
  fs.mkdirSync(path.dirname(anchorAbs), { recursive: true });
  fs.writeFileSync(anchorAbs, 'function foo() { return 1; }', 'utf-8');
  const hash = computeAnchorContentHash(root, anchorRel, 'foo');
  assert(hash !== null, 'hash');
  const graphPath = path.join(root, 'Feature', moduleName, 'code-graph.yaml');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(
    graphPath,
    [
      'schema_version: "1.0"',
      `module: ${moduleName}`,
      'nodes:',
      '  - id: n1',
      '    anchor:',
      `      file: ${anchorRel}`,
      '      symbol: foo',
      `      content_hash: ${hash}`,
    ].join('\n'),
    'utf-8',
  );
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'catalog 未 ready → missing',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      assert(probeModuleGraphReadiness(root, 'missing').state === 'missing', 'missing');
    },
  },
  {
    name: '完整 graph → ready',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        CATALOG_MODULE_YAML('Wallet'),
        'utf-8',
      );
      writeValidGraph(root);
      assert(probeModuleGraphReadiness(root, 'ready').state === 'ready', 'ready');
    },
  },
  {
    name: '锚定源不可读 → corrupt（非 missing），保留 module',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        CATALOG_MODULE_YAML('Wallet'),
        'utf-8',
      );
      const anchorRel = 'Feature/Wallet/index.ets';
      const anchorAbs = path.join(root, ...anchorRel.split('/'));
      fs.mkdirSync(anchorAbs, { recursive: true });
      const hash = 'deadbeef00000000';
      const graphPath = path.join(root, 'Feature', 'Wallet', 'code-graph.yaml');
      fs.mkdirSync(path.dirname(graphPath), { recursive: true });
      fs.writeFileSync(
        graphPath,
        [
          'schema_version: "1.0"',
          'module: Wallet',
          'nodes:',
          '  - id: n1',
          '    anchor:',
          `      file: ${anchorRel}`,
          '      symbol: foo',
          `      content_hash: ${hash}`,
        ].join('\n'),
        'utf-8',
      );
      const result = probeModuleGraphReadiness(root, 'ready');
      assert(result.state === 'corrupt', JSON.stringify(result));
      assert(result.module === 'Wallet', JSON.stringify(result));
      assert(
        (result.error ?? '').includes('module-graph readiness 探测失败'),
        result.error ?? 'no error',
      );
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
