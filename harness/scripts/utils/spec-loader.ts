// ============================================================================
// Spec 文件加载器
// ============================================================================
// 读取 YAML 规约文件，返回类型安全的对象。
// 支持两类 Spec：
//   1. 阶段级规约 (framework/specs/phase-rules/*.yaml)  ← 框架通用
//   2. 功能级规约 (<features_dir>/<feature>/{contracts,acceptance}.yaml) ← 实例工程
//      阶段 9：contracts/acceptance 与 PRD/design 扁平同目录，无 specs/ 子层。
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
import { resolvePaths, featureFilePath } from '../../config';

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
  prd: 'prd-rules.yaml',
  design: 'design-rules.yaml',
  coding: 'coding-rules.yaml',
  review: 'review-rules.yaml',
  ut: 'ut-rules.yaml',
  testing: 'testing-rules.yaml',
  catalog: 'catalog-rules.yaml',
  glossary: 'glossary-rules.yaml',
  docs: 'docs-rules.yaml',
  init: 'init-rules.yaml',
  extensions: 'extensions-rules.yaml',
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

const REQUIRED_FEATURE_FILES_BY_PHASE: Partial<Record<Phase, string[]>> = {
  prd: ['PRD.md', 'acceptance.yaml'],
  design: ['PRD.md', 'design.md', 'acceptance.yaml', 'contracts.yaml'],
  coding: ['design.md', 'acceptance.yaml', 'contracts.yaml'],
  review: ['design.md', 'acceptance.yaml', 'contracts.yaml'],
  ut: ['PRD.md', 'design.md', 'acceptance.yaml', 'contracts.yaml'],
  testing: ['PRD.md', 'design.md', 'acceptance.yaml'],
};

const OPTIONAL_FEATURE_FILES_BY_PHASE: Partial<Record<Phase, string[]>> = {
  review: ['PRD.md'],
  ut: ['use-cases.yaml', 'device-testing-todo.md'],
  testing: ['contracts.yaml', 'use-cases.yaml', 'device-testing-todo.md', 'review-report.md'],
};

export class SpecLoader {
  private phaseRulesDir: string;
  private featuresDir: string;

  constructor(projectRoot: string, phaseRulesDir?: string, featuresDir?: string) {
    // 阶段 3：默认值来自 framework.config.json（经 resolvePaths 归一化）；
    //        调用方可以用构造参数覆盖（单测/自定义 layout）。
    const resolved = resolvePaths(projectRoot);
    this.phaseRulesDir = phaseRulesDir ?? resolved.phaseRulesDir;
    this.featuresDir = featuresDir ?? resolved.featuresDir;
  }

  // --------------------------------------------------------------------------
  // 阶段级规约
  // --------------------------------------------------------------------------

  loadPhaseRule(phase: Phase): PhaseRuleSpec {
    const filename = PHASE_RULE_FILENAMES[phase];
    if (!filename) {
      throw new Error(`Unknown phase: ${phase}`);
    }
    const filePath = path.join(this.phaseRulesDir, filename);
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
    return phases;
  }

  // --------------------------------------------------------------------------
  // 功能级规约
  // --------------------------------------------------------------------------

  loadFeatureSpec(feature: string): FeatureSpec {
    const featureDir = path.join(this.featuresDir, feature);

    const spec: FeatureSpec = { feature };

    const contractsPath = path.join(featureDir, 'contracts.yaml');
    if (fs.existsSync(contractsPath)) {
      const contracts = this.loadYaml<ContractsSpec>(contractsPath);
      normalizeContractsFiles(contracts, contractsPath);
      normalizeModuleDependencies(contracts, contractsPath);
      normalizeTraceability(contracts, contractsPath);
      spec.contracts = contracts;
    }

    const acceptancePath = path.join(featureDir, 'acceptance.yaml');
    if (fs.existsSync(acceptancePath)) {
      spec.acceptance = this.loadYaml<AcceptanceSpec>(acceptancePath);
    }

    // v2: use-cases.yaml（可选）——定义业务流程 UseCase / ports / branches
    const useCasesPath = path.join(featureDir, 'use-cases.yaml');
    if (fs.existsSync(useCasesPath)) {
      spec.useCases = this.loadYaml<UseCasesSpec>(useCasesPath);
    }

    return spec;
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

    const missingRequiredFiles = pathKind === 'directory'
      ? requiredFiles.filter(file => !fs.existsSync(path.join(featureDir, file)))
      : requiredFiles.slice();
    const presentOptionalFiles = pathKind === 'directory'
      ? optionalFiles.filter(file => fs.existsSync(path.join(featureDir, file)))
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
   * 加载功能模块的过程文档 (PRD.md, design.md 等)
   * @param feature 功能模块名 (如 'home-page')
   * @param docName 文档名 (如 'PRD.md', 'design.md')
   */
  loadFeatureDoc(projectRoot: string, feature: string, docName: string): string | null {
    const docPath = featureFilePath(projectRoot, feature, docName);
    if (!fs.existsSync(docPath)) return null;
    return fs.readFileSync(docPath, 'utf-8');
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

function normalizeContractsFiles(contracts: ContractsSpec, contractsPath: string): void {
  const files = contracts.files;
  if (files === undefined || files === null) {
    contracts.files = [];
    return;
  }
  if (!Array.isArray(files)) {
    throw new Error(
      `[spec-loader] ${contractsPath} 的 \`files\` 必须是数组，实际类型：${typeof files}`
    );
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
    const detail = bad
      .map(b => `  - files[${b.index}] = ${JSON.stringify(b.raw)}`)
      .join('\n');
    throw new Error(
      `[spec-loader] ${contractsPath} 的 \`files\` 存在非字符串条目（期望形如 "path/to/file.ets"）：\n${detail}`
    );
  }

  contracts.files = normalized;
}

// ---------------------------------------------------------------------------
// module_dependencies schema 规范化
// ---------------------------------------------------------------------------
// 契约上 ContractsSpec.module_dependencies 是 Record<string, string[]>
// （key = 源模块名，value = 依赖模块名数组）。
// 但实际 YAML 里常见另一种更自然的写法，来自 Skill 2 从架构图依赖箭头提取：
//   module_dependencies:
//     - from: "<FeatureModule>"
//       to: "<SharedUIModule>"
//       kind: "oh_package"
// 如果下游不识别这种形态，`contracts.module_dependencies[mod.name]` 恒为
// undefined，`oh_package_dependencies` 规则会在"未检出任何依赖"的情况下
// 虚假 PASS（规则实际失效）。这里在加载期把数组形归一到 Record 形。
// ---------------------------------------------------------------------------

function normalizeModuleDependencies(contracts: ContractsSpec, contractsPath: string): void {
  const deps = contracts.module_dependencies as unknown;
  if (deps === undefined || deps === null) {
    contracts.module_dependencies = {};
    return;
  }

  // 已是 Record 形：原样放行
  if (!Array.isArray(deps) && typeof deps === 'object') {
    return;
  }

  if (!Array.isArray(deps)) {
    throw new Error(
      `[spec-loader] ${contractsPath} 的 \`module_dependencies\` 类型非法（期望 Record<string,string[]> 或 {from,to}[]），` +
      `实际：${typeof deps}`
    );
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
      .map(b => `  - module_dependencies[${b.index}] = ${JSON.stringify(b.raw)}`)
      .join('\n');
    throw new Error(
      `[spec-loader] ${contractsPath} 的 \`module_dependencies\` 数组形式要求每项含 from/to 字符串：\n${detail}`
    );
  }

  contracts.module_dependencies = rec;
}

// ---------------------------------------------------------------------------
// prd_to_code_traceability 字段别名归一
// ---------------------------------------------------------------------------
// ContractsSpec 契约字段名是 key_files，但当前 Skill 2 规范和 home-page 样例
// 写的是 files。如果两种写法都可以被接受，则需要在加载期把 files 别名为
// key_files，否则下游 `for (const f of item.key_files)` 直接 TypeError。
// 该规范化**只做别名回填**，不删除原字段，以免影响其他消费者。
// ---------------------------------------------------------------------------

function normalizeTraceability(contracts: ContractsSpec, contractsPath: string): void {
  const trace = contracts.prd_to_code_traceability as unknown;
  if (trace === undefined || trace === null) return;
  if (!Array.isArray(trace)) {
    throw new Error(
      `[spec-loader] ${contractsPath} 的 \`prd_to_code_traceability\` 必须是数组，实际：${typeof trace}`
    );
  }

  for (let i = 0; i < trace.length; i++) {
    const item = trace[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') continue;
    if (!item.key_files && Array.isArray(item.files)) {
      item.key_files = item.files;
    }
    // 若仍非数组，赋空数组避免下游 for...of 崩栈（保留可查的告警）
    if (!Array.isArray(item.key_files)) {
      console.warn(
        `[spec-loader] ${contractsPath} prd_to_code_traceability[${i}] 缺少 key_files/files，` +
        `prd_id=${JSON.stringify((item as { prd_id?: unknown }).prd_id)}；已按空数组处理`
      );
      item.key_files = [];
    }
  }
}
