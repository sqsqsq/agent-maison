// ============================================================================
// Spec 文件加载器
// ============================================================================
// 读取 YAML 规约文件，返回类型安全的对象。
// 支持两类 Spec：
//   1. 阶段级规约 (framework/specs/phase-rules/*.yaml)  ← 框架通用
//   2. 功能级规约 (<features_dir>/<feature>/{contracts,acceptance}.yaml) ← 实例工程
//      阶段 9：contracts/acceptance 与 spec/plan 扁平同目录，无 specs/ 子层。
// 阶段 3：路径默认值不再硬编码，全部从 `framework/harness/config.ts` 读取。
//        调用方可通过构造参数显式覆盖（测试/特殊布局）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  Phase,
  PhaseRuleSpec,
  ContractsSpec,
  AcceptanceSpec,
  FeatureSpec,
  UseCasesSpec,
} from './types';
import {
  resolvePaths,
  featuresDirPath,
  resolveFeatureArtifact,
  type FeaturePathOptions,
} from '../../config';
import { validateProjectRelativePath } from './project-relative-path';

export type FeatureArtifactVerdict =
  | 'ok'
  | 'missing_required_files'
  | 'missing_directory'
  | 'path_not_directory';

export interface FeatureArtifactInspection {
  feature: string;
  featureDir: string;
  pathKind: 'directory' | 'file' | 'other' | 'missing';
  requiredFiles: string[];
  missingRequiredFiles: string[];
  optionalFiles: string[];
  presentOptionalFiles: string[];
  sameNameArchives: string[];
  relatedSiblingEntries: string[];
  verdict: FeatureArtifactVerdict;
}

const PHASE_RULE_FILENAMES: Record<Phase, string> = {
  spec: 'spec-rules.yaml',
  plan: 'plan-rules.yaml',
  coding: 'coding-rules.yaml',
  review: 'review-rules.yaml',
  ut: 'ut-rules.yaml',
  testing: 'testing-rules.yaml',
  catalog: 'catalog-rules.yaml',
  glossary: 'glossary-rules.yaml',
  docs: 'docs-rules.yaml',
  init: 'init-rules.yaml',
  extensions: 'extensions-rules.yaml',
  'module-graph': 'module-graph-rules.yaml',
};

const ARCHIVE_EXTENSIONS = [
  '.rar',
  '.zip',
  '.7z',
  '.tar',
  '.tar.gz',
  '.tgz',
  '.tar.bz2',
  '.tbz2',
];

// phase-evidence-manifest.ts（goal-fakepass-hardening t8）复用两表作为各阶段"真实读取面"
// SSOT——增删阶段文件只改这里，evidence manifest 自动传导，禁止另立手写表。
export const REQUIRED_FEATURE_FILES_BY_PHASE: Partial<Record<Phase, string[]>> = {
  spec: ['spec.md', 'acceptance.yaml'],
  plan: ['spec.md', 'plan.md', 'acceptance.yaml', 'contracts.yaml'],
  coding: ['plan.md', 'acceptance.yaml', 'contracts.yaml'],
  review: ['plan.md', 'acceptance.yaml', 'contracts.yaml'],
  ut: ['spec.md', 'plan.md', 'acceptance.yaml', 'contracts.yaml'],
  testing: ['spec.md', 'plan.md', 'acceptance.yaml'],
};

export const OPTIONAL_FEATURE_FILES_BY_PHASE: Partial<Record<Phase, string[]>> = {
  review: ['spec.md'],
  ut: ['use-cases.yaml'],
  testing: ['contracts.yaml', 'use-cases.yaml', 'review-report.md'],
};

export class SpecLoader {
  private projectRoot: string;
  private phaseRulesDir: string;
  private featuresDir: string;

  constructor(projectRoot: string, phaseRulesDir?: string, featuresDir?: string, frameworkRoot?: string) {
    // 阶段 3：默认值来自 framework.config.json（经 resolvePaths 归一化）；
    //        调用方可以用构造参数覆盖（单测/自定义 layout / 外部 frameworkRoot）。
    const resolved = resolvePaths(projectRoot, frameworkRoot);
    this.projectRoot = resolved.projectRoot;
    this.phaseRulesDir = phaseRulesDir ?? resolved.phaseRulesDir;
    this.featuresDir = featuresDir ?? resolved.featuresDir;
  }

  /** 当构造参数覆盖 `features_dir` 时，传给 resolver 的选项 */
  private featurePathOpts(projectRoot: string): FeaturePathOptions | undefined {
    const configured = featuresDirPath(projectRoot);
    if (path.resolve(this.featuresDir) === path.resolve(configured)) {
      return undefined;
    }
    return { featuresDirAbs: this.featuresDir };
  }

  // --------------------------------------------------------------------------
  // 阶段级规约
  // --------------------------------------------------------------------------

  loadPhaseRule(phase: Phase): PhaseRuleSpec {
    // 已知 phase 用显式映射；其余按 `<phase>-rules.yaml` 约定派生（C0 判定单点化：
    // workflow 1.1 起 phase 集由 workflow 声明，loader 不再持有封闭枚举——lite 的
    // change/exit 与未来新 phase 一等公民）。约定文件不存在才视为未知 phase。
    const filename = PHASE_RULE_FILENAMES[phase] ?? `${phase}-rules.yaml`;
    const filePath = path.join(this.phaseRulesDir, filename);
    if (!PHASE_RULE_FILENAMES[phase] && !fs.existsSync(filePath)) {
      throw new Error(`Unknown phase: ${phase}（约定规则文件 ${filename} 不存在于 ${this.phaseRulesDir}）`);
    }
    return this.loadYaml<PhaseRuleSpec>(filePath);
  }

  listAvailablePhaseRules(): Phase[] {
    if (!fs.existsSync(this.phaseRulesDir)) return [];

    const phases: Phase[] = [];
    for (const [phase, filename] of Object.entries(PHASE_RULE_FILENAMES)) {
      if (fs.existsSync(path.join(this.phaseRulesDir, filename))) {
        phases.push(phase as Phase);
      }
    }
    // 约定派生 phase（与 loadPhaseRule 的 `<phase>-rules.yaml` 派生对齐——发现面不落
    // 后于加载面；lite 的 change/exit 及未来新 phase 由此进 --list）
    const known = new Set(Object.values(PHASE_RULE_FILENAMES));
    const extras = fs
      .readdirSync(this.phaseRulesDir)
      .filter((f) => /^[a-z][a-z0-9_-]*-rules\.yaml$/.test(f) && !known.has(f))
      .map((f) => f.replace(/-rules\.yaml$/, '') as Phase)
      .sort();
    return [...phases, ...extras];
  }

  // --------------------------------------------------------------------------
  // 功能级规约
  // --------------------------------------------------------------------------

  loadFeatureSpec(feature: string): FeatureSpec {
    const featureDir = path.join(this.featuresDir, feature);

    const spec: FeatureSpec = { feature };
    // P0-2（plan d9b4f7e2 复审）：形状偏差留痕——由 harness-runner 产出结构化 FAIL
    // （feature_spec_shape），归一化只防崩溃，不许静默洗形状（warn 只写 console，
    // headless 下没人看，等于洗）。
    const shapeIssues: string[] = [];

    const contractsPath = path.join(featureDir, 'contracts.yaml');
    if (fs.existsSync(contractsPath)) {
      // 复审修复（codex P1）：根节点守卫——YAML 解析为 null/标量/数组时，旧实现在
      // normalizeContractsFiles 解引用即 TypeError，harness 在 safeRun 之前致命退出、
      // 无 summary（比门禁 FAIL 更毒）。按"无法解析"语义处理：不挂载 + 留痕，
      // 下游 acceptance_yaml_present/契约类门禁按缺失裁决。
      const contracts = this.loadYamlMappingOrNull<ContractsSpec>(contractsPath, shapeIssues);
      if (contracts) {
        normalizeContractsFiles(contracts, contractsPath, shapeIssues);
        normalizeModuleDependencies(contracts, contractsPath, shapeIssues);
        normalizeTraceability(contracts, contractsPath, shapeIssues);
        // P0-2：agent 常把集合字段写成 {}/""（非数组真值），下游 for..of/.filter 直接
        // TypeError（07-13 现场门禁连环崩的同类）。归空 + 留痕（不 throw）。
        normalizeArrayField(contracts as unknown as Record<string, unknown>, 'modules', contractsPath, shapeIssues);
        // codex 七轮 P1-2：package_path 是全部源码/media 只读扫描的路径根（source-ref-scan/
        // visual-parity-backstop 等直接 path.join）——`../outside` 会越出宿主根且外部文件可
        // 影响门禁裁决。加载边界统一收口：必填字符串 + 宿主根内校验 + canonical 化后再交
        // 消费者；非法条目剔除并经 shape_issues → feature_spec_shape 结构化 BLOCKER。
        normalizeContractsModulePaths(contracts, contractsPath, this.projectRoot, shapeIssues);
        normalizeArrayField(contracts as unknown as Record<string, unknown>, 'components', contractsPath, shapeIssues);
        // S6（visual-capability-truth P1-F）：integration_points 机器块归一——map 数组 +
        // consumer_module/provider_module 必填字符串（缺失剔除 + shape_issues 留痕，
        // 镜像 modules[] 边界行为——feature_spec_shape 结构化 BLOCKER 消费）。
        normalizeArrayField(contracts as unknown as Record<string, unknown>, 'integration_points', contractsPath, shapeIssues);
        {
          const pts = contracts.integration_points;
          if (Array.isArray(pts) && pts.length > 0) {
            const kept: NonNullable<ContractsSpec['integration_points']> = [];
            pts.forEach((p, i) => {
              const rec = p as unknown as Record<string, unknown>;
              const consumer = typeof rec.consumer_module === 'string' ? rec.consumer_module.trim() : '';
              const provider = typeof rec.provider_module === 'string' ? rec.provider_module.trim() : '';
              if (!consumer || !provider) {
                shapeIssues.push(
                  `${path.basename(contractsPath)} 的 \`integration_points[${i}]\` 缺 consumer_module/provider_module 必填字符串——条目已剔除`,
                );
                return;
              }
              kept.push({
                consumer_module: consumer,
                provider_module: provider,
                requires_modification: rec.requires_modification === true,
                ...(typeof rec.entry_symbol === 'string' && rec.entry_symbol.trim()
                  ? { entry_symbol: rec.entry_symbol.trim() }
                  : {}),
              });
            });
            contracts.integration_points = kept;
          }
        }
        spec.contracts = contracts;
      }
    }

    const acceptancePath = path.join(featureDir, 'acceptance.yaml');
    if (fs.existsSync(acceptancePath)) {
      const acceptance = this.loadYamlMappingOrNull<AcceptanceSpec>(acceptancePath, shapeIssues);
      if (acceptance) {
        // 复审修复（cursor 阻断2）：AcceptanceSpec 的集合字段是 criteria/boundaries
        // （rev1 误写 use_cases——acceptance 根本没有该字段，等于零防护）。
        normalizeArrayField(acceptance as unknown as Record<string, unknown>, 'criteria', acceptancePath, shapeIssues);
        normalizeArrayField(acceptance as unknown as Record<string, unknown>, 'boundaries', acceptancePath, shapeIssues);
        spec.acceptance = acceptance;
      }
    }

    // v2: use-cases.yaml（可选）——定义业务流程 UseCase / ports / branches
    const useCasesPath = path.join(featureDir, 'use-cases.yaml');
    if (fs.existsSync(useCasesPath)) {
      const useCases = this.loadYamlMappingOrNull<UseCasesSpec>(useCasesPath, shapeIssues);
      if (useCases) {
        normalizeArrayField(useCases as unknown as Record<string, unknown>, 'use_cases', useCasesPath, shapeIssues);
        // P0-2 复审（codex P1/cursor）：嵌套集合在 loader 统一归一——check-ut 的 reduce、
        // testing-trace-gates 的遍历、named-handler 等**所有消费点**一处防崩；坏形状经
        // shape_issues → feature_spec_shape 结构化 FAIL（不再落 safeRun 误归 framework_bug）。
        for (const uc of useCases.use_cases ?? []) {
          if (!uc || typeof uc !== 'object') continue;
          const ur = uc as unknown as Record<string, unknown>;
          const tag = `use_cases[${String(ur.id ?? '?')}]`;
          normalizeArrayField(ur, 'ui_bindings', useCasesPath, shapeIssues, tag);
          normalizeArrayField(ur, 'data_boundaries', useCasesPath, shapeIssues, tag);
          normalizeArrayField(ur, 'branches', useCasesPath, shapeIssues, tag);
          for (const ub of uc.ui_bindings ?? []) {
            if (!ub || typeof ub !== 'object') continue;
            const br = ub as unknown as Record<string, unknown>;
            normalizeArrayField(br, 'user_actions', useCasesPath, shapeIssues, `${tag}.ui_bindings[${String(br.ui ?? '?')}]`);
          }
        }
        spec.useCases = useCases;
      }
    }

    if (shapeIssues.length > 0) {
      spec.shape_issues = shapeIssues;
    }
    return spec;
  }

  /** 根节点须为 YAML map；null/标量/数组 → 留痕并按"无法解析"返回 null（不 throw）。 */
  private loadYamlMappingOrNull<T>(filePath: string, shapeIssues: string[]): T | null {
    const doc = this.loadYaml<unknown>(filePath);
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) return doc as T;
    const kind = doc === null ? 'null（空文件/仅注释）' : Array.isArray(doc) ? 'array' : typeof doc;
    shapeIssues.push(
      `${path.basename(filePath)} 根节点应为映射（YAML map），实际是 ${kind}——文件已按"无法解析"处理，相关门禁按缺失裁决`,
    );
    console.warn(`[spec-loader] ${filePath} 根节点非 map（${kind}），按无法解析处理`);
    return null;
  }

  inspectFeatureArtifacts(feature: string, phase?: Phase): FeatureArtifactInspection {
    const featureDir = path.join(this.featuresDir, feature);
    const featureDirParent = this.featuresDir;
    const requiredFiles = phase ? REQUIRED_FEATURE_FILES_BY_PHASE[phase] ?? [] : [];
    const optionalFiles = phase ? OPTIONAL_FEATURE_FILES_BY_PHASE[phase] ?? [] : [];

    let pathKind: FeatureArtifactInspection['pathKind'] = 'missing';
    if (fs.existsSync(featureDir)) {
      const stat = fs.statSync(featureDir);
      if (stat.isDirectory()) {
        pathKind = 'directory';
      } else if (stat.isFile()) {
        pathKind = 'file';
      } else {
        pathKind = 'other';
      }
    }

    const pathOpts = this.featurePathOpts(this.projectRoot);
    const missingRequiredFiles =
      pathKind === 'directory'
        ? requiredFiles.filter((file) => !resolveFeatureArtifact(this.projectRoot, feature, file, pathOpts).exists)
        : requiredFiles.slice();
    const presentOptionalFiles =
      pathKind === 'directory'
        ? optionalFiles.filter((file) => resolveFeatureArtifact(this.projectRoot, feature, file, pathOpts).exists)
        : [];

    const sameNameArchives: string[] = [];
    const relatedSiblingEntries: string[] = [];
    if (fs.existsSync(featureDirParent) && fs.statSync(featureDirParent).isDirectory()) {
      const featureLower = feature.toLowerCase();
      const exactArchiveNames = new Set(ARCHIVE_EXTENSIONS.map(ext => `${featureLower}${ext}`));
      for (const dirent of fs.readdirSync(featureDirParent, { withFileTypes: true })) {
        const nameLower = dirent.name.toLowerCase();
        if (exactArchiveNames.has(nameLower) && dirent.isFile()) {
          sameNameArchives.push(dirent.name);
          continue;
        }
        if (dirent.name !== feature && nameLower.startsWith(featureLower)) {
          relatedSiblingEntries.push(dirent.name);
        }
      }
    }

    let verdict: FeatureArtifactVerdict = 'ok';
    if (pathKind === 'missing') {
      verdict = 'missing_directory';
    } else if (pathKind !== 'directory') {
      verdict = 'path_not_directory';
    } else if (missingRequiredFiles.length > 0) {
      verdict = 'missing_required_files';
    }

    return {
      feature,
      featureDir,
      pathKind,
      requiredFiles,
      missingRequiredFiles,
      optionalFiles,
      presentOptionalFiles,
      sameNameArchives: sameNameArchives.sort(),
      relatedSiblingEntries: relatedSiblingEntries.sort(),
      verdict,
    };
  }

  listAvailableFeatures(): string[] {
    if (!fs.existsSync(this.featuresDir)) return [];

    return fs.readdirSync(this.featuresDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  }

  // --------------------------------------------------------------------------
  // 文档加载辅助
  // --------------------------------------------------------------------------

  /**
   * 加载功能模块的过程文档 (spec.md, plan.md 等)
   * @param feature 功能模块名 (如 'home-page')
   * @param docName 文档名 (如 'spec.md', 'plan.md')
   */
  loadFeatureDoc(projectRoot: string, feature: string, docName: string): string | null {
    const resolved = resolveFeatureArtifact(projectRoot, feature, docName, this.featurePathOpts(projectRoot));
    if (!resolved.exists) return null;
    return fs.readFileSync(resolved.actualPath, 'utf-8');
  }

  /**
   * 收集功能模块下的源代码文件内容（从 contracts.yaml 的 files 列表中）
   * @returns 文件路径→内容的映射
   */
  collectSourceFiles(
    projectRoot: string,
    contracts: ContractsSpec | undefined,
    filterExt?: string
  ): Map<string, string> {
    const result = new Map<string, string>();
    if (!contracts?.files) return result;

    for (let i = 0; i < contracts.files.length; i++) {
      const raw = contracts.files[i];
      const relativePath = coerceToPathString(raw);
      if (relativePath === null) {
        console.warn(
          `[spec-loader] contracts.files[${i}] 非字符串，已跳过：` +
          `${JSON.stringify(raw)}（期望形如 "path/to/file.ets"）`
        );
        continue;
      }
      if (filterExt && !relativePath.endsWith(filterExt)) continue;

      const fullPath = path.join(projectRoot, relativePath);
      if (fs.existsSync(fullPath)) {
        result.set(relativePath, fs.readFileSync(fullPath, 'utf-8'));
      }
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // 内部方法
  // --------------------------------------------------------------------------

  private loadYaml<T>(filePath: string): T {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Spec file not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return YAML.parse(content) as T;
  }
}

// ---------------------------------------------------------------------------
// contracts.files schema 规范化
// ---------------------------------------------------------------------------
// 背景：ContractsSpec.files 契约上是 string[]，但历史上出现过以下不规范写法
// 导致下游 `.endsWith/.includes` 抛 `TypeError: X is not a function`：
//   1) 误写成对象： `- path: "xxx"` / `- { file: "xxx" }`
//   2) 漏写引号让值被 YAML 解析成数字/布尔： `- 123`
//   3) 空项被解析成 null： `- `
// 这里在加载时做一次校验+兜底：
//   - 字符串直接接受
//   - `{path|file|src: string}` 对象形式自动抽取
//   - 其他情况：抛出带文件路径+索引+原值的清晰错误，便于一眼定位
// ---------------------------------------------------------------------------

function coerceToPathString(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.path ?? obj.file ?? obj.src;
    if (typeof candidate === 'string') return candidate;
  }
  return null;
}

/**
 * P0-2（plan d9b4f7e2）：集合字段非数组真值 → 归空数组 + shapeIssues 留痕（缺失/null
 * 只归空不留痕——缺失语义由各门禁裁决）。不 throw（对齐"agent 产 YAML 形状偏差不得炸
 * harness"——炸了连 summary 都没有，下游只剩 stale FAIL）；留痕由 harness-runner 产出
 * feature_spec_shape 结构化 FAIL（复审修复：console.warn 在 headless 下没人看=静默洗）。
 */
function normalizeArrayField(
  obj: Record<string, unknown>,
  field: string,
  filePath: string,
  shapeIssues: string[],
  /** 嵌套字段的路径前缀（如 use_cases[uc-1]）——留痕可定位。 */
  parentLabel?: string,
): void {
  const label = parentLabel ? `${parentLabel}.${field}` : field;
  const v = obj[field];
  if (v === undefined || v === null) return;
  if (!Array.isArray(v)) {
    const kind = typeof v === 'object' ? 'object(dict)' : typeof v;
    shapeIssues.push(
      `${path.basename(filePath)} 的 \`${label}\` 应为数组（YAML list），实际是 ${kind}——已按空数组防崩处理；最小合法样例：\`${field}: []\`（每项以 \`- \` 开头）`,
    );
    console.warn(`[spec-loader] ${filePath} 的 \`${label}\` 非数组（${kind}），已归空并留痕`);
    obj[field] = [];
    return;
  }
  // 第五轮复审（codex P1）：容器合法不等于条目合法——`- null` / `- 42` / 嵌套数组条目
  // 会在下游 `mod.package_path` / `uc.id` 等解引用处崩成 framework_bug 误归因。
  // 本 loader 的这些集合语义上都是 map 数组：剔除非 map 条目 + 带索引留痕。
  const badIdx: number[] = [];
  const cleaned = (v as unknown[]).filter((it, i) => {
    const ok = it !== null && typeof it === 'object' && !Array.isArray(it);
    if (!ok) badIdx.push(i);
    return ok;
  });
  if (badIdx.length > 0) {
    shapeIssues.push(
      `${path.basename(filePath)} 的 \`${label}[${badIdx.join(',')}]\` 应为映射（map，形如 \`- key: value\`），实际为 null/标量/数组——非法条目已剔除、合法条目保留`,
    );
    console.warn(`[spec-loader] ${filePath} 的 \`${label}\` 含 ${badIdx.length} 个非 map 条目，已剔除并留痕`);
    obj[field] = cleaned;
  }
}

/**
 * codex 七轮 P1-2：modules[].package_path 加载边界校验——必填字符串 + 拒绝绝对路径/盘符/
 * `..` 段（validateProjectRelativePath）+ canonical 化（反斜杠→正斜杠、去尾斜杠）后写回，
 * 所有消费者拿到统一安全形态。非法条目剔除 + shape_issues 留痕（feature_spec_shape 结构化
 * BLOCKER），不 throw（loader 在 safeRun 外，炸=无 summary）、不放行越界读取。
 */
function normalizeContractsModulePaths(
  contracts: ContractsSpec,
  contractsPath: string,
  projectRoot: string,
  shapeIssues: string[],
): void {
  const mods = contracts.modules;
  if (!Array.isArray(mods) || mods.length === 0) return;
  const kept: typeof mods = [];
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i] as unknown as Record<string, unknown>;
    const pp = m.package_path;
    if (typeof pp !== 'string' || !pp.trim()) {
      shapeIssues.push(
        `${path.basename(contractsPath)} 的 \`modules[${i}].package_path\` 必填字符串（实际 ${JSON.stringify(pp)}）——条目已剔除；最小合法样例：\`package_path: app/feature\``,
      );
      continue;
    }
    try {
      m.package_path = validateProjectRelativePath(projectRoot, pp.trim(), `modules[${i}].package_path`);
      kept.push(mods[i]);
    } catch (e) {
      shapeIssues.push(
        `${path.basename(contractsPath)} 的 \`modules[${i}].package_path\`（${JSON.stringify(pp)}）越界/非法：${(e as Error).message}——条目已剔除；源码/media 扫描不得越出宿主根`,
      );
    }
  }
  if (kept.length !== mods.length) {
    contracts.modules = kept;
  }
}

function normalizeContractsFiles(
  contracts: ContractsSpec,
  contractsPath: string,
  shapeIssues: string[],
): void {
  const files = contracts.files;
  if (files === undefined || files === null) {
    contracts.files = [];
    return;
  }
  // P0-2 复审（codex P1）：旧实现在此 throw——loadFeatureSpec 位于 checker safeRun 之外，
  // throw = harness 无 summary 致命退出（比门禁 FAIL 更毒）。改留痕 + 归安全值，
  // shape_issues 经 feature_spec_shape 出结构化 BLOCKER。
  if (!Array.isArray(files)) {
    shapeIssues.push(
      `${path.basename(contractsPath)} 的 \`files\` 应为数组（YAML list），实际是 ${typeof files === 'object' ? 'object(dict)' : typeof files}——已按空数组防崩处理；最小合法样例：\`files: []\``,
    );
    contracts.files = [];
    return;
  }

  const bad: Array<{ index: number; raw: unknown }> = [];
  const normalized: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const coerced = coerceToPathString(files[i]);
    if (coerced === null) {
      bad.push({ index: i, raw: files[i] });
    } else {
      normalized.push(coerced);
    }
  }

  if (bad.length > 0) {
    const detail = bad.map(b => `files[${b.index}]=${JSON.stringify(b.raw)}`).join('；');
    shapeIssues.push(
      `${path.basename(contractsPath)} 的 \`files\` 存在非字符串条目（期望形如 "path/to/file.ets"）：${detail}——非法条目已剔除、合法条目保留`,
    );
  }

  contracts.files = normalized;
}

// ---------------------------------------------------------------------------
// module_dependencies schema 规范化
// ---------------------------------------------------------------------------
// 契约上 ContractsSpec.module_dependencies 是 Record<string, string[]>
// （key = 源模块名，value = 依赖模块名数组）。
// 但实际 YAML 里常见另一种更自然的写法，来自 plan 从架构图依赖箭头提取：
//   module_dependencies:
//     - from: "<FeatureModule>"
//       to: "<SharedUIModule>"
//       kind: "oh_package"
// 如果下游不识别这种形态，`contracts.module_dependencies[mod.name]` 恒为
// undefined，`oh_package_dependencies` 规则会在"未检出任何依赖"的情况下
// 虚假 PASS（规则实际失效）。这里在加载期把数组形归一到 Record 形。
// ---------------------------------------------------------------------------

function normalizeModuleDependencies(
  contracts: ContractsSpec,
  contractsPath: string,
  shapeIssues: string[],
): void {
  const deps = contracts.module_dependencies as unknown;
  if (deps === undefined || deps === null) {
    contracts.module_dependencies = {};
    return;
  }

  // 已是 Record 形：**逐值验证**后放行（第四轮复审 codex P1：`A: {}` 直接放行会在
  // coding-host-rules 的 for..of 崩成 framework_bug 误归因；值须为 string[]）。
  if (!Array.isArray(deps) && typeof deps === 'object') {
    const rec = deps as Record<string, unknown>;
    for (const [mod, v] of Object.entries(rec)) {
      if (!Array.isArray(v)) {
        shapeIssues.push(
          `${path.basename(contractsPath)} 的 \`module_dependencies.${mod}\` 应为字符串数组，实际是 ${v !== null && typeof v === 'object' ? 'object(dict)' : typeof v}——已按空数组防崩处理`,
        );
        rec[mod] = [];
        continue;
      }
      const goodItems = v.filter((x) => typeof x === 'string');
      if (goodItems.length !== v.length) {
        shapeIssues.push(
          `${path.basename(contractsPath)} 的 \`module_dependencies.${mod}\` 含非字符串条目——非法条目已剔除、合法条目保留`,
        );
        rec[mod] = goodItems;
      }
    }
    return;
  }

  // P0-2 复审（codex P1）：非法标量（"" 等）旧实现 throw → harness 无 summary 致命退出。
  // 改留痕 + 归空 Record（下游 oh_package_dependencies 会按"未检出依赖"裁决）。
  if (!Array.isArray(deps)) {
    shapeIssues.push(
      `${path.basename(contractsPath)} 的 \`module_dependencies\` 类型非法（期望 Record<string,string[]> 或 {from,to}[]），实际是 ${typeof deps}——已按空映射防崩处理`,
    );
    contracts.module_dependencies = {};
    return;
  }

  const rec: Record<string, string[]> = {};
  const bad: Array<{ index: number; raw: unknown }> = [];
  for (let i = 0; i < deps.length; i++) {
    const entry = deps[i];
    if (!entry || typeof entry !== 'object') {
      bad.push({ index: i, raw: entry });
      continue;
    }
    const e = entry as Record<string, unknown>;
    const from = e.from;
    const to = e.to;
    if (typeof from !== 'string' || typeof to !== 'string') {
      bad.push({ index: i, raw: entry });
      continue;
    }
    if (!rec[from]) rec[from] = [];
    rec[from].push(to);
  }

  if (bad.length > 0) {
    const detail = bad
      .map(b => `module_dependencies[${b.index}]=${JSON.stringify(b.raw)}`)
      .join('；');
    shapeIssues.push(
      `${path.basename(contractsPath)} 的 \`module_dependencies\` 数组形式要求每项含 from/to 字符串：${detail}——非法条目已剔除、合法条目保留`,
    );
  }

  contracts.module_dependencies = rec;
}

// ---------------------------------------------------------------------------
// prd_to_code_traceability 字段别名归一
// ---------------------------------------------------------------------------
// ContractsSpec 契约字段名是 key_files，但当前 plan 规范和 home-page 样例
// 写的是 files。如果两种写法都可以被接受，则需要在加载期把 files 别名为
// key_files，否则下游 `for (const f of item.key_files)` 直接 TypeError。
// 该规范化**只做别名回填**，不删除原字段，以免影响其他消费者。
// ---------------------------------------------------------------------------

function normalizeTraceability(
  contracts: ContractsSpec,
  contractsPath: string,
  shapeIssues: string[],
): void {
  const trace = contracts.prd_to_code_traceability as unknown;
  if (trace === undefined || trace === null) return;
  // P0-2 复审（codex P1）：dict 形旧实现 throw → harness 无 summary 致命退出。留痕 + 归空。
  if (!Array.isArray(trace)) {
    shapeIssues.push(
      `${path.basename(contractsPath)} 的 \`prd_to_code_traceability\` 应为数组（YAML list），实际是 ${typeof trace === 'object' ? 'object(dict)' : typeof trace}——已按空数组防崩处理`,
    );
    (contracts as unknown as Record<string, unknown>).prd_to_code_traceability = [];
    return;
  }

  // 第四轮复审（codex P1）：三层验证——①非 object 条目（42/null 等）剔除留痕（旧实现
  // 原样保留 → check-coding 解引用崩）；②key_files 非数组真值（{} 等）留痕（旧实现
  // 静默归空 → 0 文件可能安静 PASS，feature_spec_shape 兜底拦截）；③key_files 含非
  // 字符串条目剔除留痕。
  const cleaned: unknown[] = [];
  for (let i = 0; i < trace.length; i++) {
    const raw = trace[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      shapeIssues.push(
        `${path.basename(contractsPath)} 的 \`prd_to_code_traceability[${i}]\` 应为映射（{prd_id, key_files}），实际是 ${raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw}——非法条目已剔除`,
      );
      continue;
    }
    const item = raw as Record<string, unknown>;
    // 第五轮复审（codex P1）：别名只在 key_files **缺失**（undefined/null）时生效——
    // 旧条件 `!item.key_files` 会让 `key_files: ""` 借合法 files 静默绕过形状留痕。
    if ((item.key_files === undefined || item.key_files === null) && Array.isArray(item.files)) {
      item.key_files = item.files;
    }
    if (item.key_files !== undefined && item.key_files !== null && !Array.isArray(item.key_files)) {
      shapeIssues.push(
        `${path.basename(contractsPath)} 的 \`prd_to_code_traceability[${i}].key_files\`（prd_id=${JSON.stringify(item.prd_id)}）应为字符串数组，实际是 ${typeof item.key_files === 'object' ? 'object(dict)' : typeof item.key_files}——已按空数组防崩处理`,
      );
      item.key_files = [];
    }
    if (!Array.isArray(item.key_files)) {
      // 缺失（undefined/null）：归空防崩 + console 留痕；**内容裁决在 plan_to_code 门禁**
      // （第五轮复审起：条目存在但总 key_files=0 → BLOCKER FAIL，空集不再真空 PASS）。
      console.warn(
        `[spec-loader] ${contractsPath} prd_to_code_traceability[${i}] 缺少 key_files/files，` +
        `prd_id=${JSON.stringify(item.prd_id)}；已按空数组处理`
      );
      item.key_files = [];
    } else {
      const goodFiles = (item.key_files as unknown[]).filter((f) => typeof f === 'string');
      if (goodFiles.length !== (item.key_files as unknown[]).length) {
        shapeIssues.push(
          `${path.basename(contractsPath)} 的 \`prd_to_code_traceability[${i}].key_files\`（prd_id=${JSON.stringify(item.prd_id)}）含非字符串条目——非法条目已剔除、合法条目保留`,
        );
        item.key_files = goodFiles;
      }
    }
    cleaned.push(item);
  }
  (contracts as unknown as Record<string, unknown>).prd_to_code_traceability = cleaned;
}
