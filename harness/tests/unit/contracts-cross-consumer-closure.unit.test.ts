/**
 * plan c7e2a9d4 T4 — contracts 统一解析边界的**跨消费者**交汇面。
 *
 * 事故形态是「同一份 contracts 被两套代码各自解释，只在宿主真实文书上第一次相遇」。
 * 本套把那次相遇提前到 CI：铺一份**宿主形态** INPUT，**单次 SpecLoader 装载**，
 * 对同一个 FeatureSpec 分别驱动
 *   ① 生产 plan 闭环 `checkContractFileReferenceClosure`（路径规范化 + contracts.files 授权）；
 *   ② profile coding host 的结构检查入口（取 `page_registration` 结果）。
 *
 * 边界：不扩 fixture-runner 协议（其协议是单 CMD 单 phase）；**不断言 file_completeness**
 * ——它属 root check-coding.ts、不在 profile runStructureChecks 接线内，物理存在性的正式
 * 裁决归 coding 相，由既有生产覆盖保证。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { tryLoadProfileCodingHost } from '../../profile-host-loader';
import { checkContractFileReferenceClosure } from '../../scripts/check-plan';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import type { CheckContext, CheckResult, FeatureSpec } from '../../scripts/utils/types';
import { ensureConsumerFrameworkTree, DEFAULT_LAYOUT } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

interface Case { name: string; run: () => void; }

const FEATURE = 'bc-openCard';
const PROFILES_ROOT = path.resolve(__dirname, '..', '..', '..', 'profiles');
const HMOS_PROFILE_DIR = path.join(PROFILES_ROOT, 'hmos-app');

const COMPONENT_FILE = '02-Feature/CardFeature/src/main/ets/pages/CardPage.ets';
const MAIN_PAGES = '02-Feature/CardFeature/src/main/resources/base/profile/main_pages.json';
const ROUTE_MAP = '02-Feature/CardFeature/src/main/resources/base/profile/route_map.json';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

interface HostShape {
  /** navigation.config_files 声明值（默认两份真实注册文件） */
  configFiles?: string[];
  /** 实际落盘的注册文件（默认与 configFiles 一致；置空模拟"已授权但未建"） */
  materialize?: string[];
  /** 以**目录**形式占位的声明路径（复现 existsSync 为真但 readFileSync 抛 EISDIR） */
  materializeAsDir?: string[];
  /** contracts.files 授权集（默认覆盖组件文件 + configFiles） */
  authorized?: string[];
  /** 追加进 **navigation 段内**的原始片段（缩进两格；宿主 registration_points 即此层级） */
  navigationExtraYaml?: string[];
}

/**
 * 宿主形态 INPUT：带 nav_destination 的组件 + navigation.config_files 指向真实
 * main_pages.json / route_map.json + contracts.files 授权 + 背书文件树。
 */
function hostContractsYaml(shape: HostShape): string {
  const configFiles = shape.configFiles ?? [MAIN_PAGES, ROUTE_MAP];
  const authorized = shape.authorized ?? [COMPONENT_FILE, ...configFiles];
  return [
    'schema_version: "1.0"',
    `feature: ${FEATURE}`,
    'source: plan.md',
    'version: "1"',
    'modules:',
    '  - name: CardFeature',
    '    layer: 02-Feature',
    '    format: HAR',
    '    change_type: modify',
    '    package_path: 02-Feature/CardFeature',
    'components:',
    `  - { name: CardPage, module: CardFeature, file: ${COMPONENT_FILE}, kind: page, nav_destination: CardPage }`,
    'navigation:',
    ...(configFiles.length > 0
      ? ['  config_files:', ...configFiles.map(file => `    - ${file}`)]
      : ['  config_files: []']),
    ...(shape.navigationExtraYaml ?? []),
    'files:',
    ...(authorized.length > 0 ? authorized.map(file => `  - ${file}`) : ['  []']),
  ].join('\n');
}

/** 单次 SpecLoader 装载：同一个 FeatureSpec 供两个消费者使用。 */
function withHostProject<T>(shape: HostShape, fn: (root: string, spec: FeatureSpec) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-cross-consumer-'));
  try {
    clearFrameworkConfigCache();
    writeFile(path.join(root, 'framework.config.json'), JSON.stringify({
      schema_version: '1.0.0',
      project_name: 'contracts-cross-consumer-unit',
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

    // 背书文件树：组件文件 + 落盘的注册配置文件（内容含 NavDestination 名，供真实校验）
    writeFile(path.join(root, COMPONENT_FILE), '@Component\nstruct CardPage {}\n');
    const configFiles = shape.configFiles ?? [MAIN_PAGES, ROUTE_MAP];
    for (const file of shape.materialize ?? configFiles) {
      const payload = file.endsWith('route_map.json')
        ? { routerMap: [{ name: 'CardPage', pageSourceFile: COMPONENT_FILE, buildFunction: 'CardPageBuilder' }] }
        : { src: ['pages/CardPage'] };
      writeFile(path.join(root, file), JSON.stringify(payload, null, 2));
    }
    for (const dir of shape.materializeAsDir ?? []) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }

    writeFile(
      path.join(root, 'doc', 'features', FEATURE, 'contracts.yaml'),
      hostContractsYaml(shape),
    );
    const spec = new SpecLoader(root).loadFeatureSpec(FEATURE);
    return fn(root, spec);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** 消费者①：生产 plan 引用闭环门禁。 */
function planClosure(root: string, spec: FeatureSpec): CheckResult {
  return checkContractFileReferenceClosure({
    phase: 'plan',
    feature: FEATURE,
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

/** 消费者②：profile coding host 结构检查入口（经生产 loader 取得，不硬 import profile）。 */
function pageRegistration(root: string, spec: FeatureSpec): CheckResult {
  const host = tryLoadProfileCodingHost(HMOS_PROFILE_DIR);
  assert(host, 'hmos-app profile coding host 必须可加载');
  clearFrameworkConfigCache();
  const cfg = loadFrameworkConfig(root);
  const ctx = {
    phase: 'coding',
    feature: FEATURE,
    projectRoot: root,
    frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
    frameworkRel: DEFAULT_LAYOUT.frameworkRel,
    harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
    layoutKind: DEFAULT_LAYOUT.kind,
    phaseRule: {
      phase: 'coding',
      structure_checks: {
        page_registration: { description: 'NavDestination 页面已在导航配置中注册' },
      },
      traceability_checks: {},
    },
    featureSpec: spec,
    resolvedProfile: loadResolvedProfile(root, cfg),
  } as unknown as CheckContext;
  const results = host.runStructureChecks(ctx, []);
  const hit = results.find(result => result.id === 'page_registration');
  assert(hit, `profile 结构检查未产出 page_registration：${JSON.stringify(results.map(r => r.id))}`);
  return hit;
}

const cases: Case[] = [
  {
    name: 'c7e2a9d4 T4 正例：宿主形态 config_files 同时通过 plan 闭环与 page_registration（非 SKIP）',
    run: () => withHostProject({}, (root, spec) => {
      assert(spec.referenceClosure, 'SpecLoader 必须产出 referenceClosure');
      assert(
        spec.referenceClosure.invalid_paths.length === 0,
        JSON.stringify(spec.referenceClosure.invalid_paths),
      );
      const closure = planClosure(root, spec);
      assert(closure.status === 'PASS', `plan 闭环应 PASS：${JSON.stringify(closure)}`);

      const registration = pageRegistration(root, spec);
      // PASS（而非 SKIP）本身就是"走了真实校验路径"的判据：SKIP 会在此断言处红。
      assert(registration.status === 'PASS', `page_registration 应 PASS 且不得以 SKIP 冒充：${JSON.stringify(registration)}`);
      assert(/1 个 NavDestination/.test(registration.details ?? ''), registration.details ?? '');
    }),
  },
  {
    name: 'c7e2a9d4 T4 负例①：config_files 路径不在 contracts.files → plan 闭环 FAIL',
    run: () => withHostProject({ authorized: [COMPONENT_FILE] }, (root, spec) => {
      const closure = planClosure(root, spec);
      assert(closure.status === 'FAIL' && closure.severity === 'BLOCKER', JSON.stringify(closure));
      assert(/main_pages\.json/.test(closure.details ?? ''), closure.details ?? '');
    }),
  },
  {
    name: 'c7e2a9d4 T4 负例②：已授权但文件未建 → plan 闭环仍 PASS，page_registration FAIL 非 SKIP',
    run: () => withHostProject({ materialize: [] }, (root, spec) => {
      // 阶段归属：plan 相只管路径安全/规范化 + 授权（允许声明 coding 将新建的文件）。
      const closure = planClosure(root, spec);
      assert(closure.status === 'PASS', `合法的"计划新建"不得在 plan 相被堵：${JSON.stringify(closure)}`);

      const registration = pageRegistration(root, spec);
      assert(registration.status === 'FAIL', `文件缺失必须 FAIL 而非 SKIP：${JSON.stringify(registration)}`);
      assert(registration.severity === 'BLOCKER', JSON.stringify(registration));
      assert(/main_pages\.json/.test(registration.details ?? ''), registration.details ?? '');
    }),
  },
  {
    // review P1：existsSync 对"路径其实是目录"返回 true，file_completeness 也只判存在 →
    // 若读取异常逃到 check-coding 的 safeRun，会被降级成 MINOR SKIP 且不计入阻断，
    // 于是"不可读"反而能宣称完成。必须在消费者内就地判普通文件并归为 BLOCKER FAIL。
    name: 'c7e2a9d4 T4 负例②b：声明路径是目录（existsSync 为真）→ page_registration FAIL，不得抛错或 SKIP',
    run: () => withHostProject({
      configFiles: [MAIN_PAGES],
      materialize: [],
      materializeAsDir: [MAIN_PAGES],
    }, (root, spec) => {
      assert(
        fs.statSync(path.join(root, MAIN_PAGES)).isDirectory(),
        '前置条件：声明路径必须真的是目录（existsSync 为真而不可读）',
      );
      const closure = planClosure(root, spec);
      assert(closure.status === 'PASS', `plan 相不裁决存在性/类型：${JSON.stringify(closure)}`);

      // 不得抛异常——抛出去就会被 check-coding 的 safeRun 降级成 MINOR SKIP
      let registration: CheckResult;
      try {
        registration = pageRegistration(root, spec);
      } catch (error) {
        throw new Error(
          `page_registration 不得把读取异常抛给外层（会被降级成 MINOR SKIP 而不阻断）：${String(error)}`,
        );
      }
      assert(registration.status === 'FAIL', `目录形态必须 FAIL：${JSON.stringify(registration)}`);
      assert(registration.severity === 'BLOCKER', JSON.stringify(registration));
      assert(/main_pages\.json/.test(registration.details ?? ''), registration.details ?? '');
    }),
  },
  {
    name: 'c7e2a9d4 T4 负例③：有 NavDestination 但 config_files 为空 → page_registration FAIL',
    run: () => withHostProject({ configFiles: [], materialize: [] }, (root, spec) => {
      const closure = planClosure(root, spec);
      assert(closure.status === 'PASS', `空 config_files 不是闭环问题：${JSON.stringify(closure)}`);

      const registration = pageRegistration(root, spec);
      assert(registration.status === 'FAIL', `缺注册配置声明必须 FAIL：${JSON.stringify(registration)}`);
      assert(/config_files/.test(registration.details ?? ''), registration.details ?? '');
    }),
  },
  {
    // 宿主事故原形：registration_points 嵌在 navigation 段下（不是顶层），source 应为
    // navigation.registration_points——顶层形态另由 T1 单测钉。
    name: 'c7e2a9d4 T4 负例④：宿主形态 navigation.registration_points → unconsumed_file_field BLOCKER',
    run: () => withHostProject({
      navigationExtraYaml: [
        '  registration_points:',
        `    - { name: CardPage, file: ${MAIN_PAGES} }`,
      ],
    }, (root, spec) => {
      const issues = spec.referenceClosure?.invalid_paths ?? [];
      assert(
        issues.some(issue =>
          issue.kind === 'unconsumed_file_field' && issue.source === 'navigation.registration_points'),
        `宿主形态 registration_points 未被拒绝：${JSON.stringify(issues)}`,
      );
      const closure = planClosure(root, spec);
      assert(closure.status === 'FAIL' && closure.severity === 'BLOCKER', JSON.stringify(closure));
      assert(/registration_points/.test(closure.details ?? ''), closure.details ?? '');
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
