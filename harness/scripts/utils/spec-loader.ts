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
} from './types';
import { resolvePaths, featureFilePath } from '../../config';

const PHASE_RULE_FILENAMES: Record<Phase, string> = {
  prd: 'prd-rules.yaml',
  design: 'design-rules.yaml',
  coding: 'coding-rules.yaml',
  review: 'review-rules.yaml',
  ut: 'ut-rules.yaml',
  testing: 'testing-rules.yaml',
  catalog: 'catalog-rules.yaml',
  glossary: 'glossary-rules.yaml',
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
      spec.contracts = this.loadYaml<ContractsSpec>(contractsPath);
    }

    const acceptancePath = path.join(featureDir, 'acceptance.yaml');
    if (fs.existsSync(acceptancePath)) {
      spec.acceptance = this.loadYaml<AcceptanceSpec>(acceptancePath);
    }

    return spec;
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

    for (const relativePath of contracts.files) {
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
