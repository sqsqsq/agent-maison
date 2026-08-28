import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import { checkContractFileReferenceClosure } from '../../scripts/check-plan';
import {
  CONTRACT_FILE_REFERENCE_FIELDS,
  CONTRACT_FILE_REFERENCE_KINDS,
  findUnauthorizedContractFileReferences,
} from '../../scripts/utils/contract-reference-closure';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import type { CheckContext, FeatureSpec } from '../../scripts/utils/types';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

interface Case { name: string; run: () => void; }

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE_ROOT = path.resolve(__dirname, '..', 'fixtures', 'contract-reference-closure', 'bc-openCard');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else out.push(path.relative(root, absolute).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out.sort();
}

function withProject<T>(contractsYaml: string, fn: (root: string, spec: FeatureSpec) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-reference-closure-'));
  try {
    clearFrameworkConfigCache();
    writeFile(path.join(root, 'framework.config.json'), JSON.stringify({
      schema_version: '1.0.0',
      project_name: 'contract-reference-closure-unit',
      project_type: 'app',
      agent_adapter: 'generic',
      architecture: {
        outer_layers: [{
          id: '02-Feature',
          name: 'Feature',
          order: 2,
          can_depend_on: [],
          intra_layer_deps: 'forbid',
        }],
        module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
        inner_dependency_direction: 'upward',
        cross_module_exports_file: 'Index.ets',
      },
      paths: {
        features_dir: 'doc/features',
        module_catalog: 'doc/module-catalog.yaml',
        glossary: 'doc/glossary.yaml',
        glossary_seed: 'doc/glossary-seed.txt',
        architecture_md: 'doc/architecture.md',
      },
    }));
    ensureConsumerFrameworkTree(root);
    writeFile(path.join(root, 'doc', 'features', 'bc-openCard', 'contracts.yaml'), contractsYaml);
    const spec = new SpecLoader(root).loadFeatureSpec('bc-openCard');
    return fn(root, spec);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function closureCheck(root: string, spec: FeatureSpec) {
  return checkContractFileReferenceClosure({
    phase: 'plan',
    feature: 'bc-openCard',
    projectRoot: root,
    featureSpec: spec,
    phaseRule: {
      phase: 'plan',
      traceability_checks: {
        contract_file_reference_closure: { description: 'contracts file reference closure' },
      },
    },
  } as unknown as CheckContext)[0];
}

function incidentYaml(state: 'undeclared' | 'declared'): string {
  return fs.readFileSync(path.join(FIXTURE_ROOT, state, 'contracts.yaml'), 'utf8');
}

const cases: Case[] = [
  {
    name: 'M3 bc-openCard: production YAML loader rejects twenty undeclared logo media paths',
    run: () => withProject(incidentYaml('undeclared'), (root, spec) => {
      assert(spec.referenceClosure, 'production SpecLoader must return referenceClosure');
      assert(spec.referenceClosure.invalid_paths.length === 0, JSON.stringify(spec.referenceClosure.invalid_paths));
      const missing = findUnauthorizedContractFileReferences(spec.referenceClosure);
      assert(missing.length === 20, `expected 20 missing logo paths, got ${missing.length}`);
      assert(missing.every(item => item.sources.some(source => source.kind === 'resource_keys.path')), JSON.stringify(missing));
      const result = closureCheck(root, spec);
      assert(result.status === 'FAIL' && result.severity === 'BLOCKER', JSON.stringify(result));
      assert(/20 个文件引用/.test(result.details ?? ''), result.details ?? 'missing details');
      assert(/resource_keys\.CardFeature\.media\[0\]\.path/.test(result.details ?? ''), result.details ?? 'missing source');
    }),
  },
  {
    name: 'M3 bc-openCard: declaring all twenty media paths closes through the same production API without sidecar writes',
    run: () => withProject(incidentYaml('declared'), (root, spec) => {
      const before = listFiles(root);
      assert(spec.referenceClosure, 'production SpecLoader must return referenceClosure');
      assert(findUnauthorizedContractFileReferences(spec.referenceClosure).length === 0, 'green fixture must close');
      const result = closureCheck(root, spec);
      assert(result.status === 'PASS', JSON.stringify(result));
      const after = listFiles(root);
      assert(JSON.stringify(after) === JSON.stringify(before), `closure must not persist graph/manifest/facts sidecars\nbefore=${before}\nafter=${after}`);
      assert(!after.some(file => /reference.*(graph|manifest|facts)/i.test(file)), JSON.stringify(after));
    }),
  },
  {
    name: 'M3 resolver inventory: every schema-declared file kind has an explicit branch and legal non-path strings are ignored',
    run: () => {
      const pathFor = (name: string) => `refs/${name.replace(/[^a-z0-9]+/gi, '_')}.txt`;
      const files = CONTRACT_FILE_REFERENCE_KINDS.map(pathFor);
      const yaml = [
        'schema_version: "1.0"',
        'feature: bc-openCard',
        'modules:',
        '  - name: CardFeature',
        '    layer: 02-Feature',
        '    format: HAR',
        '    change_type: modify',
        '    package_path: 02-Feature/CardFeature',
        `    har_index: ${pathFor('modules.har_index')}`,
        `    builder: ${pathFor('modules.builder')}`,
        `    export_file: ${pathFor('modules.export_file')}`,
        `    export_files: [${pathFor('modules.export_files')}]`,
        'data_models:',
        `  - { name: M, module: CardFeature, file: ${pathFor('data_models.file')}, kind: interface, fields: [] }`,
        'interfaces:',
        `  - { module: CardFeature, layer: data, file: ${pathFor('interfaces.file')}, class: Api, methods: [] }`,
        'components:',
        `  - { name: Page, module: CardFeature, file: ${pathFor('components.file')}, kind: page }`,
        'resource_keys:',
        '  CardFeature:',
        '    media:',
        `      - { key: logo, value: app.media.logo, path: ${pathFor('resource_keys.path')}, media: ${pathFor('resource_keys.media')} }`,
        'navigation:',
        `  main_pages_file: ${pathFor('navigation.main_pages_file')}`,
        `  route_map_file: ${pathFor('navigation.route_map_file')}`,
        `  page_registration_file: ${pathFor('navigation.page_registration_file')}`,
        `  route_registration_file: ${pathFor('navigation.route_registration_file')}`,
        `  page_files: [${pathFor('navigation.page_files')}]`,
        `  route_files: [${pathFor('navigation.route_files')}]`,
        '  pages:',
        `    - { name: P, file: ${pathFor('navigation.pages.file')}, page_file: ${pathFor('navigation.pages.page_file')}, route_file: ${pathFor('navigation.pages.route_file')}, registration_file: ${pathFor('navigation.pages.registration_file')} }`,
        '  routes:',
        `    - { name: R, file: ${pathFor('navigation.routes.file')}, page_file: ${pathFor('navigation.routes.page_file')}, route_file: ${pathFor('navigation.routes.route_file')}, registration_file: ${pathFor('navigation.routes.registration_file')} }`,
        'prd_to_code_traceability:',
        '  - prd_id: AC-1',
        '    priority: P0',
        `    key_files: [${pathFor('prd_to_code_traceability.key_files')}]`,
        'files:',
        ...files.map(file => `  - ${file}`),
      ].join('\n');
      withProject(yaml, (root, spec) => {
        assert(spec.referenceClosure, 'missing referenceClosure');
        const actualKinds = [...new Set(spec.referenceClosure.references.map(ref => ref.kind))].sort();
        const expectedKinds = [...CONTRACT_FILE_REFERENCE_KINDS].sort();
        assert(JSON.stringify(actualKinds) === JSON.stringify(expectedKinds), `expected=${expectedKinds}\nactual=${actualKinds}`);
        assert(!spec.referenceClosure.references.some(ref => ref.path === 'app.media.logo'), 'resource value is not a file field');
        assert(closureCheck(root, spec).status === 'PASS', 'all explicit fields are authorized');
      });

      const schema = YAML.parse(fs.readFileSync(path.join(REPO_ROOT, 'specs', 'artifact-schemas', 'contracts.schema.yaml'), 'utf8')) as Record<string, unknown>;
      const schemaFields = schema['x-file-reference-fields'];
      const expectedSchemaFields = CONTRACT_FILE_REFERENCE_FIELDS.map(field => field.schemaField);
      assert(JSON.stringify(schemaFields) === JSON.stringify(expectedSchemaFields), `schema inventory drift\nexpected=${expectedSchemaFields}\nactual=${JSON.stringify(schemaFields)}`);
    },
  },
  {
    name: 'M3 normalization: contracts.files and references share canonical repository-relative path rules',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'components:',
      "  - { name: Page, file: 'src\\pages\\Page.ets', kind: page }",
      'files:',
      '  - ./src/pages/Page.ets',
    ].join('\n'), (root, spec) => {
      assert(spec.contracts?.files[0] === 'src/pages/Page.ets', JSON.stringify(spec.contracts?.files));
      assert(spec.referenceClosure?.references[0]?.path === 'src/pages/Page.ets', JSON.stringify(spec.referenceClosure));
      assert(closureCheck(root, spec).status === 'PASS', 'canonical equivalent paths must close');
    }),
  },
  {
    name: 'M3 invalid reference: traversal is a parser shape issue and plan closure fails closed',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'components:',
      '  - { name: Page, file: ../outside.ets, kind: page }',
      'files: []',
    ].join('\n'), (root, spec) => {
      assert((spec.shape_issues ?? []).some(issue => /components\[0\]\.file/.test(issue)), JSON.stringify(spec.shape_issues));
      const result = closureCheck(root, spec);
      assert(result.status === 'FAIL' && /非法文件引用/.test(result.details ?? ''), JSON.stringify(result));
    }),
  },
  {
    name: 'M3 unknown file-like fields cannot bypass the explicit reference inventory',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'modules:',
      '  - name: CardFeature',
      '    layer: 02-Feature',
      '    format: HAR',
      '    change_type: modify',
      '    package_path: 02-Feature/CardFeature',
      '    exports: 02-Feature/CardFeature/Index.ets',
      'navigation:',
      '  route_map: 02-Feature/CardFeature/src/routes.json',
      '  analytics_label: routes-v2',
      'files:',
      '  - 02-Feature/CardFeature/Index.ets',
      '  - 02-Feature/CardFeature/src/routes.json',
    ].join('\n'), (root, spec) => {
      const issues = spec.referenceClosure?.invalid_paths ?? [];
      assert(issues.filter(issue => issue.kind === 'unconsumed_file_field').length === 2,
        JSON.stringify(issues));
      assert(issues.some(issue => issue.source === 'modules[0].exports'), JSON.stringify(issues));
      assert(issues.some(issue => issue.source === 'navigation.route_map'), JSON.stringify(issues));
      assert(!issues.some(issue => issue.source === 'navigation.analytics_label'), JSON.stringify(issues));
      const result = closureCheck(root, spec);
      assert(result.status === 'FAIL' && /非法文件引用/.test(result.details ?? ''), JSON.stringify(result));
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(testCase => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) };
    }
  });
}
