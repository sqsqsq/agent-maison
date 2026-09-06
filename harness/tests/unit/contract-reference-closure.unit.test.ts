import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import {
  checkComponentTreePerPage,
  checkContractFileReferenceClosure,
  checkDataModelTyped,
  checkInterfaceSignaturesComplete,
} from '../../scripts/check-plan';
import {
  CONTRACT_FILE_REFERENCE_FIELDS,
  CONTRACT_FILE_REFERENCE_KINDS,
  findUnauthorizedContractFileReferences,
  selectContractReferencePaths,
} from '../../scripts/utils/contract-reference-closure';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { isCheckNotApplicable, type CheckContext, type CheckResult, type FeatureSpec } from '../../scripts/utils/types';
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

function withProject<T>(contractsYaml: string | null, fn: (root: string, spec: FeatureSpec) => T): T {
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
    // contractsYaml === null：**不写** contracts.yaml（V4 的「真源缺失」负例）。
    if (contractsYaml !== null) {
      writeFile(path.join(root, 'doc', 'features', 'bc-openCard', 'contracts.yaml'), contractsYaml);
    } else {
      fs.mkdirSync(path.join(root, 'doc', 'features', 'bc-openCard'), { recursive: true });
    }
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

/**
 * plan c7e2a9d4 T1：3.0 canonical 只保留 `navigation.config_files`；fbdf0ad5 自造的
 * 推测性同义字段（平铺 + pages[]/routes[] 嵌套形态）全部裁撤，逐条按未知 file-like 字段
 * fail-closed。嵌套两族尤其关键——外层 key `pages`/`routes` 本身不命中 file-like 正则，
 * 若无未知子项递归就会静默 fail-open。
 */
const RETIRED_SHAPE_PATH = '02-Feature/CardFeature/src/nav-artifact.json';
const RETIRED_NAVIGATION_SHAPES: ReadonlyArray<{ source: string; yaml: string[] }> = [
  { source: 'navigation.main_pages_file', yaml: [`  main_pages_file: ${RETIRED_SHAPE_PATH}`] },
  { source: 'navigation.route_map_file', yaml: [`  route_map_file: ${RETIRED_SHAPE_PATH}`] },
  { source: 'navigation.page_registration_file', yaml: [`  page_registration_file: ${RETIRED_SHAPE_PATH}`] },
  { source: 'navigation.route_registration_file', yaml: [`  route_registration_file: ${RETIRED_SHAPE_PATH}`] },
  { source: 'navigation.page_files', yaml: [`  page_files: [${RETIRED_SHAPE_PATH}]`] },
  { source: 'navigation.route_files', yaml: [`  route_files: [${RETIRED_SHAPE_PATH}]`] },
  { source: 'navigation.pages[0].file', yaml: ['  pages:', `    - { name: P, file: ${RETIRED_SHAPE_PATH} }`] },
  { source: 'navigation.pages[0].page_file', yaml: ['  pages:', `    - { name: P, page_file: ${RETIRED_SHAPE_PATH} }`] },
  { source: 'navigation.pages[0].route_file', yaml: ['  pages:', `    - { name: P, route_file: ${RETIRED_SHAPE_PATH} }`] },
  { source: 'navigation.pages[0].registration_file', yaml: ['  pages:', `    - { name: P, registration_file: ${RETIRED_SHAPE_PATH} }`] },
  { source: 'navigation.routes[0].file', yaml: ['  routes:', `    - { name: R, file: ${RETIRED_SHAPE_PATH} }`] },
  { source: 'navigation.routes[0].page_file', yaml: ['  routes:', `    - { name: R, page_file: ${RETIRED_SHAPE_PATH} }`] },
  { source: 'navigation.routes[0].route_file', yaml: ['  routes:', `    - { name: R, route_file: ${RETIRED_SHAPE_PATH} }`] },
  { source: 'navigation.routes[0].registration_file', yaml: ['  routes:', `    - { name: R, registration_file: ${RETIRED_SHAPE_PATH} }`] },
];

// ============================================================================
// V4（plan 7b3e9a15 D2/S1）：plan 三章节的「依据明确的不适用」出口
// ============================================================================
// 一律经**真实 SpecLoader**（withProject 已用）+ **真实 check-plan 导出函数**——不手拼
// FeatureSpec，也不复刻判定逻辑。
//
// 正例（contracts 对应集合为空、真源可信）→ SKIP；反例（contracts 里有条目却写 n/a）→
// FAIL 且 severity 与今天相同；三条**真源不可信**负例 → 一律不得出现 SKIP，落回今天的判定
// （这三条是**改前改后均绿的回归护栏**，不是缺陷断言：S1 之前三个 check 根本没有 SKIP 出口）。
const NA_PLAN_MD = [
  '## 数据模型定义',
  '',
  '不适用：本 feature 是纯路由改造，不引入任何新模型。',
  '',
  '## 服务层接口定义',
  '',
  '- 不适用：无新增服务层接口，复用既有 CardService。',
  '',
  '## 页面组件树',
  '',
  '**不适用**：本 feature 不新增页面。',
  '',
].join('\n');

/** 三章节都在场、但都写了真实内容（用于确认 n/a 分支确实是被声明行触发的）。 */
const EMPTY_CONTRACTS = ['schema_version: "1.0"', 'feature: bc-openCard', 'files: []'].join('\n');

function planCtx(root: string, spec: FeatureSpec): CheckContext {
  return {
    phase: 'plan',
    feature: 'bc-openCard',
    projectRoot: root,
    featureSpec: spec,
    phaseRule: { phase: 'plan', structure_checks: {} },
  } as unknown as CheckContext;
}

interface NaProbe { id: string; status: string; severity: string; details: string; suggestion?: string; structured?: unknown }

function runThreeChecks(root: string, spec: FeatureSpec, design: string): NaProbe[] {
  const ctx = planCtx(root, spec);
  return [
    checkDataModelTyped(ctx, design)[0],
    checkInterfaceSignaturesComplete(ctx, design)[0],
    checkComponentTreePerPage(ctx, design)[0],
  ] as NaProbe[];
}

const naCases: Case[] = [
  {
    name: 'V4 正例：三章节声明「不适用：<依据>」且 contracts 对应集合为空 → SKIP（severity 各自不变）',
    run: () => withProject(EMPTY_CONTRACTS, (root, spec) => {
      assert(spec.contracts !== undefined, '构造性前提：contracts 必须挂载（真源在场）');
      assert(!spec.shape_issues?.length, `构造性前提：不得有 shape_issues，实得 ${JSON.stringify(spec.shape_issues)}`);
      const [dm, iface, comp] = runThreeChecks(root, spec, NA_PLAN_MD);
      for (const [r, collection] of [[dm, 'data_models'], [iface, 'interfaces'], [comp, 'components']] as Array<[NaProbe, string]>) {
        assert(r.status === 'SKIP', `${r.id} 应 SKIP，实得 ${r.status}：${r.details}`);
        assert(r.details.includes(`contracts.${collection} 长度为 0`), `${r.id} details 须写明判据来源：${r.details}`);
        // codex 实施 review 一轮 medium：真 n/a 必须带机读标注，否则 SKIP+BLOCKER 会被
        // writer 当成"门禁没跑完"收进 blocking_skips，提前返回 review_blocking_skips_then_verifier。
        assert(
          isCheckNotApplicable(r as unknown as CheckResult),
          `${r.id} 的 SKIP 必须带 structured.applicability=not_applicable，实得 ${JSON.stringify(r.structured)}`,
        );
      }
      assert(dm.details.includes('纯路由改造'), `须带出作者依据：${dm.details}`);
      assert(dm.severity === 'BLOCKER' && iface.severity === 'BLOCKER', 'BLOCKER 两项 severity 不变');
      assert(comp.severity === 'MAJOR', `component_tree_per_page 仍是 MAJOR，实得 ${comp.severity}`);
    }),
  },
  {
    name: 'V4 反例：contracts 里有条目却声明不适用 → 假 n/a 仍 FAIL（severity 与今天相同、details 点名条目、有 suggestion）',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'files: []',
      'data_models:',
      '  - name: CardSummary',
      '    module: CardFeature',
      '    file: 02-Feature/CardFeature/src/main/ets/model/CardSummary.ets',
      '    kind: interface',
      '    fields: []',
      'interfaces:',
      '  - module: CardFeature',
      '    layer: domain',
      '    file: 02-Feature/CardFeature/src/main/ets/service/CardService.ets',
      '    class: CardService',
      '    methods: []',
      'components:',
      '  - name: CardListPage',
      '    module: CardFeature',
      '    file: 02-Feature/CardFeature/src/main/ets/pages/CardListPage.ets',
      '    kind: page',
    ].join('\n'), (root, spec) => {
      const [dm, iface, comp] = runThreeChecks(root, spec, NA_PLAN_MD);
      for (const [r, needle] of [[dm, 'CardSummary'], [iface, 'CardService'], [comp, 'CardListPage']] as Array<[NaProbe, string]>) {
        assert(r.status === 'FAIL', `${r.id} 假 n/a 必须 FAIL，实得 ${r.status}`);
        assert(r.details.includes(needle), `${r.id} details 须点名 contracts 条目：${r.details}`);
        assert(Boolean(r.suggestion), `${r.id} 假 n/a 的 FAIL 必须自带 suggestion（ratchet 只减不增）`);
      }
      assert(dm.severity === 'BLOCKER' && iface.severity === 'BLOCKER' && comp.severity === 'MAJOR', '三者 severity 与今天相同');
    }),
  },
  {
    name: 'V4 护栏：contracts.yaml 缺失 → 三个 check 一律不出现 SKIP（落回今天的判定）',
    run: () => withProject(null, (root, spec) => {
      assert(spec.contracts === undefined, '构造性前提：contracts 不得挂载');
      for (const r of runThreeChecks(root, spec, NA_PLAN_MD)) {
        assert(r.status !== 'SKIP', `${r.id} 在真源缺失时不得放行，实得 ${r.status}`);
      }
    }),
  },
  {
    name: 'V4 护栏：contracts.yaml 根节点非 mapping（解析失败）→ 三个 check 一律不出现 SKIP',
    run: () => withProject('- just\n- a\n- list\n', (root, spec) => {
      assert(spec.contracts === undefined, '构造性前提：根节点非 mapping 时 loader 不挂载 contracts');
      for (const r of runThreeChecks(root, spec, NA_PLAN_MD)) {
        assert(r.status !== 'SKIP', `${r.id} 在解析失败时不得放行，实得 ${r.status}`);
      }
    }),
  },
  {
    name: 'V4 护栏：data_models/interfaces/components 被写成 {} 归空并留 shape_issues → 一律不出现 SKIP',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'files: []',
      'data_models: {}',
      'interfaces: {}',
      'components: {}',
    ].join('\n'), (root, spec) => {
      assert(spec.contracts !== undefined, '构造性前提：contracts 仍挂载（只是集合被归空）');
      for (const collection of ['data_models', 'interfaces', 'components']) {
        assert(
          (spec.shape_issues ?? []).some(i => i.includes('contracts.yaml') && i.includes(`\`${collection}\``)),
          `构造性前提：${collection} 必须留下 shape_issues；实得 ${JSON.stringify(spec.shape_issues)}`,
        );
        assert(
          ((spec.contracts as unknown as Record<string, unknown>)[collection] as unknown[]).length === 0,
          `构造性前提：${collection} 已被归空数组（"集合为空"在这里不等于"确实不涉及"）`,
        );
      }
      for (const r of runThreeChecks(root, spec, NA_PLAN_MD)) {
        assert(r.status !== 'SKIP', `${r.id} 在该集合有形状留痕时不得放行，实得 ${r.status}`);
      }
    }),
  },
];

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
        `  config_files: [${pathFor('navigation.config_files')}]`,
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
  ...RETIRED_NAVIGATION_SHAPES.map(shape => ({
    name: `c7e2a9d4 T1 retired navigation shape rejected: ${shape.source}`,
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'navigation:',
      ...shape.yaml,
      'files:',
      `  - ${RETIRED_SHAPE_PATH}`,
    ].join('\n'), (root, spec) => {
      const issues = spec.referenceClosure?.invalid_paths ?? [];
      assert(
        issues.some(issue => issue.kind === 'unconsumed_file_field' && issue.source === shape.source),
        `${shape.source} 未被判 unconsumed_file_field：${JSON.stringify(issues)}`,
      );
      // 裁撤字段一律不得产出正向引用（递归只做拒绝检测，不是引用解析器）。
      assert(
        (spec.referenceClosure?.references ?? []).length === 0,
        `裁撤形态不得产生 references：${JSON.stringify(spec.referenceClosure?.references)}`,
      );
      const result = closureCheck(root, spec);
      assert(
        result.status === 'FAIL' && result.severity === 'BLOCKER' && /非法文件引用/.test(result.details ?? ''),
        JSON.stringify(result),
      );
    }),
  })),
  {
    name: 'c7e2a9d4 T1 nested escape: unknown non-file-like containers are scanned down for file-like leaves',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'navigation:',
      '  groups:',
      '    - name: main',
      '      tabs:',
      '        - { label: home, registration_file: 02-Feature/CardFeature/src/main_pages.json }',
      '      analytics_label: nav-v2',
      'files:',
      '  - 02-Feature/CardFeature/src/main_pages.json',
    ].join('\n'), (root, spec) => {
      const issues = spec.referenceClosure?.invalid_paths ?? [];
      assert(
        issues.some(issue =>
          issue.kind === 'unconsumed_file_field'
          && issue.source === 'navigation.groups[0].tabs[0].registration_file'),
        `深层嵌套 file-like 子项逃逸：${JSON.stringify(issues)}`,
      );
      assert(
        !issues.some(issue => /analytics_label/.test(issue.source)),
        `非 file-like 叶子被误伤：${JSON.stringify(issues)}`,
      );
      assert(closureCheck(root, spec).status === 'FAIL', '嵌套逃逸必须让 plan 闭环 FAIL');
    }),
  },
  {
    // review P1：任意深度截断本身就是 fail-open——把 file 埋得够深即可静默过关。
    name: 'c7e2a9d4 T1 nested escape: a path buried 12 unknown containers deep is still rejected',
    run: () => {
      const DEPTH = 12;
      const lines: string[] = ['navigation:', '  config_files: []'];
      let indent = '  ';
      let source = 'navigation';
      for (let level = 0; level < DEPTH; level += 1) {
        lines.push(`${indent}level_${level}:`);
        indent += '  ';
        source += `.level_${level}`;
      }
      lines.push(`${indent}file: 02-Feature/CardFeature/src/hidden.ets`);
      withProject([
        'schema_version: "1.0"',
        'feature: bc-openCard',
        ...lines,
        'files:',
        '  - 02-Feature/CardFeature/src/hidden.ets',
      ].join('\n'), (root, spec) => {
        const issues = spec.referenceClosure?.invalid_paths ?? [];
        assert(
          issues.some(issue =>
            issue.kind === 'unconsumed_file_field' && issue.source === `${source}.file`),
          `深埋 ${DEPTH} 层的 file-like 子项被静默放行（既未授权也未拒绝 = fail-open）：` +
          JSON.stringify(issues),
        );
        assert(
          (spec.referenceClosure?.references ?? []).length === 0,
          '拒绝扫描不得产出 references',
        );
        assert(closureCheck(root, spec).status === 'FAIL', '深埋逃逸必须让 plan 闭环 FAIL');
      });
    },
  },
  {
    name: 'c7e2a9d4 T1 nested escape: cyclic anchors terminate without truncating the scan',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'navigation:',
      '  config_files: []',
      '  groups: &group',
      '    - self: *group',
      '      registration_file: 02-Feature/CardFeature/src/main_pages.json',
      'files:',
      '  - 02-Feature/CardFeature/src/main_pages.json',
    ].join('\n'), (root, spec) => {
      const issues = spec.referenceClosure?.invalid_paths ?? [];
      assert(
        issues.some(issue =>
          issue.kind === 'unconsumed_file_field'
          && issue.source === 'navigation.groups[0].registration_file'),
        `环形锚点下仍须命中 file-like 子项：${JSON.stringify(issues)}`,
      );
      assert(closureCheck(root, spec).status === 'FAIL', JSON.stringify(spec.referenceClosure));
    }),
  },
  {
    // review 二轮 P1：环出现在 **file-like 字段的值内部** 时，判定要走 containsFileLikeValue——
    // 它曾是无环检测的递归，YAML 自引用锚点直接爆 RangeError；而闭环在 SpecLoader 装载期
    // 执行，异常会打断整个装载，连结构化的 unconsumed_file_field 都产不出来。
    name: 'c7e2a9d4 T1 nested escape: a cycle inside a file-like value neither throws nor escapes detection',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'navigation:',
      '  config_files: []',
      '  registration_points: &points',
      '    - self: *points',
      '    - file: 02-Feature/CardFeature/src/hidden.ets',
      'files:',
      '  - 02-Feature/CardFeature/src/hidden.ets',
    ].join('\n'), (root, spec) => {
      // 注意：issue.raw 持有环形结构，断言消息不得用 JSON.stringify。
      const issues = spec.referenceClosure?.invalid_paths ?? [];
      const sources = issues.map(issue => `${issue.kind}@${issue.source}`).join(', ');
      assert(
        issues.some(issue =>
          issue.kind === 'unconsumed_file_field' && issue.source === 'navigation.registration_points'),
        `环形锚点下的 file-like 值未被拒绝：${sources}`,
      );
      assert((spec.referenceClosure?.references ?? []).length === 0, `拒绝扫描不得产出 references：${sources}`);
      const result = closureCheck(root, spec);
      assert(result.status === 'FAIL' && result.severity === 'BLOCKER', `${result.status}/${result.severity}`);
    }),
  },
  {
    name: 'c7e2a9d4 T1 registration_points stays rejected at the host shape (navigation.*) and at top level',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'navigation:',
      '  config_files: [02-Feature/CardFeature/src/main_pages.json]',
      // 宿主事故原形：registration_points 嵌在 navigation 段下（不是顶层）
      '  registration_points:',
      '    - { name: CardPage, file: 02-Feature/CardFeature/src/main_pages.json }',
      'registration_points:',
      '  - { name: CardPage, file: 02-Feature/CardFeature/src/main_pages.json }',
      'files:',
      '  - 02-Feature/CardFeature/src/main_pages.json',
    ].join('\n'), (root, spec) => {
      const issues = spec.referenceClosure?.invalid_paths ?? [];
      assert(
        issues.some(issue =>
          issue.kind === 'unconsumed_file_field' && issue.source === 'navigation.registration_points'),
        `宿主形态 navigation.registration_points 未被拒绝：${JSON.stringify(issues)}`,
      );
      assert(
        issues.some(issue =>
          issue.kind === 'unconsumed_file_field' && issue.source === 'contracts.registration_points'),
        `顶层 registration_points 未被拒绝：${JSON.stringify(issues)}`,
      );
      const result = closureCheck(root, spec);
      assert(result.status === 'FAIL' && result.severity === 'BLOCKER', JSON.stringify(result));
    }),
  },
  {
    name: 'c7e2a9d4 T1 canonical navigation.config_files closes through contracts.files authorization',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'navigation:',
      '  config_files:',
      '    - 02-Feature/CardFeature/src/main/resources/base/profile/main_pages.json',
      '    - 02-Feature/CardFeature/src/main/resources/base/profile/route_map.json',
      'files:',
      '  - 02-Feature/CardFeature/src/main/resources/base/profile/main_pages.json',
      '  - 02-Feature/CardFeature/src/main/resources/base/profile/route_map.json',
    ].join('\n'), (root, spec) => {
      const closure = spec.referenceClosure;
      assert(closure, 'missing referenceClosure');
      assert(closure.invalid_paths.length === 0, JSON.stringify(closure.invalid_paths));
      const selected = selectContractReferencePaths(closure, 'navigation.config_files');
      assert(
        JSON.stringify(selected) === JSON.stringify([
          '02-Feature/CardFeature/src/main/resources/base/profile/main_pages.json',
          '02-Feature/CardFeature/src/main/resources/base/profile/route_map.json',
        ]),
        JSON.stringify(selected),
      );
      assert(closureCheck(root, spec).status === 'PASS', 'authorized config_files must close');
    }),
  },
  {
    name: 'c7e2a9d4 T1 unauthorized navigation.config_files fails plan closure (authorization, not existence)',
    run: () => withProject([
      'schema_version: "1.0"',
      'feature: bc-openCard',
      'navigation:',
      '  config_files: [02-Feature/CardFeature/src/main/resources/base/profile/main_pages.json]',
      'files: []',
    ].join('\n'), (root, spec) => {
      const missing = findUnauthorizedContractFileReferences(spec.referenceClosure!);
      assert(missing.length === 1 && missing[0].sources[0].kind === 'navigation.config_files',
        JSON.stringify(missing));
      const result = closureCheck(root, spec);
      assert(result.status === 'FAIL' && result.severity === 'BLOCKER', JSON.stringify(result));
    }),
  },
  ...naCases,
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
