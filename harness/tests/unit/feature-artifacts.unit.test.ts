// ============================================================================
// feature-artifacts.unit.test.ts — feature 归档解析回归
// ============================================================================
//
// 目标：确保 doc/features 下只有精确目录会被当作正式 feature。
// 同名 .rar/.zip 等归档、同名前缀目录/文件都只能作为旁证，不能进入
// listAvailableFeatures，也不能替代缺失的上游产物。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

function assertIncludes(actual: string[], expected: string, label: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`${label}\n    expected to include: ${expected}\n    actual: ${JSON.stringify(actual)}`);
  }
}

function withTmpProject<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-artifacts-'));
  try {
    clearFrameworkConfigCache();
    writeFile(
      path.join(dir, 'framework.config.json'),
      JSON.stringify({
        schema_version: '1.0.0',
        project_name: 'feature-artifacts-unit',
        project_type: 'app',
        agent_adapter: 'generic',
        architecture: {
          outer_layers: [{
            id: '01-Product',
            name: 'Product',
            order: 1,
            can_depend_on: [],
            intra_layer_deps: 'forbid',
          }],
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
      }),
    );
    ensureConsumerFrameworkTree(dir);
    return fn(dir);
  } finally {
    clearFrameworkConfigCache();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeFeatureFiles(root: string, feature: string, files: string[]): void {
  for (const file of files) {
    writeFile(path.join(root, 'doc', 'features', feature, file), `${file}\n`);
  }
}

interface Case { name: string; run: () => void; }

const cases: Case[] = [
  {
    name: 'feature artifacts: 精确目录 + 同名 rar → 选择目录并忽略归档',
    run: () => withTmpProject(root => {
      const feature = 'HWP-PaymentButton';
      writeFeatureFiles(root, feature, ['PRD.md', 'design.md', 'acceptance.yaml', 'contracts.yaml']);
      writeFile(path.join(root, 'doc', 'features', `${feature}.rar`), 'archive');

      const loader = new SpecLoader(root);
      assertEq(loader.listAvailableFeatures(), [feature], '只应列出正式目录');

      const inspection = loader.inspectFeatureArtifacts(feature, 'ut');
      assertEq(inspection.pathKind, 'directory', '应识别为目录');
      assertEq(inspection.verdict, 'ok', '必需文件齐全应 ok');
      assertEq(inspection.sameNameArchives, [`${feature}.rar`], '应记录同名归档旁证');
      assertEq(inspection.missingRequiredFiles, [], '不应缺必需文件');
    }),
  },
  {
    name: 'feature artifacts: 只有同名 rar → 不列为 feature，诊断为缺目录',
    run: () => withTmpProject(root => {
      const feature = 'HWP-PaymentButton';
      writeFile(path.join(root, 'doc', 'features', `${feature}.rar`), 'archive');

      const loader = new SpecLoader(root);
      assertEq(loader.listAvailableFeatures(), [], '归档不能进入 feature 列表');

      const inspection = loader.inspectFeatureArtifacts(feature, 'ut');
      assertEq(inspection.pathKind, 'missing', '精确目录不存在');
      assertEq(inspection.verdict, 'missing_directory', '应快速失败为缺目录');
      assertEq(inspection.sameNameArchives, [`${feature}.rar`], '应记录同名归档旁证');
    }),
  },
  {
    name: 'feature artifacts: 同名前缀条目 → 只作为旁证，不替代精确目录',
    run: () => withTmpProject(root => {
      const feature = 'HWP-PaymentButton';
      writeFeatureFiles(root, feature, ['PRD.md', 'acceptance.yaml']);
      fs.mkdirSync(path.join(root, 'doc', 'features', `${feature}-old`), { recursive: true });
      writeFile(path.join(root, 'doc', 'features', `${feature}.md`), 'notes');

      const loader = new SpecLoader(root);
      assertEq(loader.listAvailableFeatures().sort(), [feature, `${feature}-old`].sort(), '目录列表仍只包含目录');

      const inspection = loader.inspectFeatureArtifacts(feature, 'prd');
      assertEq(inspection.verdict, 'ok', '精确目录满足 PRD 阶段必需文件');
      assertIncludes(inspection.relatedSiblingEntries, `${feature}-old`, '应记录同名前缀目录');
      assertIncludes(inspection.relatedSiblingEntries, `${feature}.md`, '应记录同名前缀文件');
    }),
  },
  {
    name: 'feature artifacts: 目录存在但缺上游文件 → 报缺文件，不建议归档补洞',
    run: () => withTmpProject(root => {
      const feature = 'HWP-PaymentButton';
      writeFeatureFiles(root, feature, ['PRD.md']);
      writeFile(path.join(root, 'doc', 'features', `${feature}.zip`), 'archive');

      const loader = new SpecLoader(root);
      const inspection = loader.inspectFeatureArtifacts(feature, 'coding');
      assertEq(inspection.pathKind, 'directory', '精确目录存在');
      assertEq(inspection.verdict, 'missing_required_files', '应报告缺少阶段必需文件');
      assertEq(inspection.missingRequiredFiles.sort(), ['acceptance.yaml', 'contracts.yaml', 'design.md'].sort(), '缺失文件集合');
      assertEq(inspection.sameNameArchives, [`${feature}.zip`], '同名归档仍只作为旁证');
    }),
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
