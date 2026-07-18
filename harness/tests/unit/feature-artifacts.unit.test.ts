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
import { checkDesignToCode } from '../../scripts/check-coding';
import type { CheckContext } from '../../scripts/utils/types';
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
      writeFeatureFiles(root, feature, ['spec.md', 'plan.md', 'acceptance.yaml', 'contracts.yaml']);
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
      writeFeatureFiles(root, feature, ['spec.md', 'acceptance.yaml']);
      fs.mkdirSync(path.join(root, 'doc', 'features', `${feature}-old`), { recursive: true });
      writeFile(path.join(root, 'doc', 'features', `${feature}.md`), 'notes');

      const loader = new SpecLoader(root);
      assertEq(loader.listAvailableFeatures().sort(), [feature, `${feature}-old`].sort(), '目录列表仍只包含目录');

      const inspection = loader.inspectFeatureArtifacts(feature, 'spec');
      assertEq(inspection.verdict, 'ok', '精确目录满足 PRD 阶段必需文件');
      assertIncludes(inspection.relatedSiblingEntries, `${feature}-old`, '应记录同名前缀目录');
      assertIncludes(inspection.relatedSiblingEntries, `${feature}.md`, '应记录同名前缀文件');
    }),
  },
  {
    name: 'feature artifacts: featuresDir 构造覆盖 → inspect/load 走自定义目录',
    run: () => withTmpProject(root => {
      const feature = 'alt-feature';
      const altFeatures = path.join(root, 'alt', 'features');
      writeFile(path.join(altFeatures, feature, 'spec', 'spec.md'), 'prd\n');
      writeFile(path.join(altFeatures, feature, 'acceptance.yaml'), 'criteria: []\n');

      const loader = new SpecLoader(root, undefined, altFeatures);
      assertEq(loader.listAvailableFeatures(), [feature], '自定义 featuresDir 下列出 feature');

      const inspection = loader.inspectFeatureArtifacts(feature, 'spec');
      assertEq(inspection.verdict, 'ok', 'canonical PRD 在 alt/features 下应识别为存在');
      assertEq(inspection.missingRequiredFiles, [], '不应缺 PRD/acceptance');

      const prd = loader.loadFeatureDoc(root, feature, 'spec.md');
      if (prd !== 'prd\n') {
        throw new Error(`loadFeatureDoc 应从 alt/features 读取 PRD，got: ${JSON.stringify(prd)}`);
      }
    }),
  },
  {
    name: 'feature artifacts: 目录存在但缺上游文件 → 报缺文件，不建议归档补洞',
    run: () => withTmpProject(root => {
      const feature = 'HWP-PaymentButton';
      writeFeatureFiles(root, feature, ['spec.md']);
      writeFile(path.join(root, 'doc', 'features', `${feature}.zip`), 'archive');

      const loader = new SpecLoader(root);
      const inspection = loader.inspectFeatureArtifacts(feature, 'coding');
      assertEq(inspection.pathKind, 'directory', '精确目录存在');
      assertEq(inspection.verdict, 'missing_required_files', '应报告缺少阶段必需文件');
      assertEq(inspection.missingRequiredFiles.sort(), ['acceptance.yaml', 'contracts.yaml', 'plan.md'].sort(), '缺失文件集合');
      assertEq(inspection.sameNameArchives, [`${feature}.zip`], '同名归档仍只作为旁证');
    }),
  },
  // ==========================================================================
  // P0-2 复审（plan d9b4f7e2）：spec-loader 根节点守卫 + 集合字段形状留痕
  // ==========================================================================
  {
    name: 'P0-2 spec-loader: contracts.yaml 解析为 null（空文件）→ 不崩、按缺失处理、shape_issues 留痕',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(path.join(root, 'doc', 'features', feature, 'contracts.yaml'), '# 只有注释\n');
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      assertEq(spec.contracts === undefined, true, '根 null 须按"无法解析"处理（不挂载）');
      assertEq((spec.shape_issues ?? []).length >= 1, true, '须留 shape_issues 痕迹');
      assertEq(/根节点应为映射/.test((spec.shape_issues ?? []).join('|')), true, '留痕须可行动');
    }),
  },
  {
    name: 'P0-2 spec-loader: contracts.modules/components 与 acceptance.criteria/boundaries dict 形 → 归空+留痕',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        ['feature: bc-open', 'modules: {}', 'components: ""'].join('\n'),
      );
      writeFile(
        path.join(root, 'doc', 'features', feature, 'acceptance.yaml'),
        ['feature: bc-open', 'criteria: {}', 'boundaries: "oops"'].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      assertEq(Array.isArray(spec.contracts?.modules), true, 'modules 归空数组防崩');
      assertEq(Array.isArray(spec.acceptance?.criteria), true, 'criteria 归空数组防崩（复审修复：字段是 criteria 非 use_cases）');
      assertEq(Array.isArray(spec.acceptance?.boundaries), true, 'boundaries 归空数组防崩');
      const joined = (spec.shape_issues ?? []).join('|');
      assertEq((spec.shape_issues ?? []).length, 4, `四处坏形状全留痕: ${joined}`);
      assertEq(/criteria/.test(joined) && /boundaries/.test(joined) && /modules/.test(joined) && /components/.test(joined), true, `留痕字段齐全: ${joined}`);
    }),
  },
  {
    name: 'P0-2 spec-loader: 合法形状零留痕（无 shape_issues 字段）',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        ['feature: bc-open', 'modules: []', 'components: []'].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      assertEq(spec.shape_issues === undefined, true, '合法形状不得留痕（防误 FAIL）');
    }),
  },
  {
    name: 'P0-2 复审: 旧 throw 形状（files/{} module_dependencies/"" traceability/{}）→ 不炸、留痕、归安全值',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        [
          'feature: bc-open',
          'files: {}',
          'module_dependencies: ""',
          'prd_to_code_traceability: {}',
        ].join('\n'),
      );
      const loader = new SpecLoader(root);
      // 旧实现这里直接 throw（harness 无 summary 致命退出）——现在必须正常返回。
      const spec = loader.loadFeatureSpec(feature);
      assertEq(Array.isArray(spec.contracts?.files), true, 'files 归空数组');
      assertEq(
        spec.contracts !== undefined && typeof spec.contracts.module_dependencies === 'object' && !Array.isArray(spec.contracts.module_dependencies),
        true,
        'module_dependencies 归空 Record',
      );
      const joined = (spec.shape_issues ?? []).join('|');
      assertEq((spec.shape_issues ?? []).length, 3, `三处坏形状全留痕: ${joined}`);
      assertEq(/files/.test(joined) && /module_dependencies/.test(joined) && /prd_to_code_traceability/.test(joined), true, `留痕字段齐全: ${joined}`);
    }),
  },
  {
    name: 'P0-2 复审: files 含非法条目 → 剔除坏项保留好项 + 留痕（不再 throw）',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        ['feature: bc-open', 'files:', '  - "src/a.ets"', '  - 42', '  - { oops: true }'].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      assertEq(spec.contracts?.files, ['src/a.ets'], '合法条目保留');
      assertEq((spec.shape_issues ?? []).some(s => /files\[1\]|files\[2\]/.test(s)), true, '非法条目留痕');
    }),
  },
  {
    name: 'P0-2 第四轮复审: module_dependencies Record 值 {} / traceability 标量条目 / key_files 坏形状 → 三层验证留痕（codex 实测样例复现）',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        [
          'feature: bc-open',
          'module_dependencies:',
          '  A: {}',
          '  B: ["ok", 42]',
          'prd_to_code_traceability:',
          '  - prd_id: AC-1',
          '    key_files: {}',
          '  - 42',
          '  - prd_id: AC-2',
          '    key_files: ["src/a.ets", 7]',
        ].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      const deps = spec.contracts?.module_dependencies as Record<string, unknown>;
      assertEq(Array.isArray(deps.A) && (deps.A as unknown[]).length === 0, true, 'Record 值 {} 归空数组（coding-host-rules for..of 防崩）');
      assertEq(deps.B, ['ok'], 'Record 值内非字符串条目剔除');
      const trace = spec.contracts?.prd_to_code_traceability as Array<Record<string, unknown>>;
      assertEq(trace.length, 2, '标量条目（42）已剔除');
      assertEq(Array.isArray(trace[0].key_files) && (trace[0].key_files as unknown[]).length === 0, true, 'key_files: {} 归空数组');
      assertEq(trace[1].key_files, ['src/a.ets'], 'key_files 非字符串条目剔除');
      const joined = (spec.shape_issues ?? []).join('|');
      assertEq((spec.shape_issues ?? []).length >= 5, true, `五处坏形状全留痕（不再静默假 PASS）: ${joined}`);
      assertEq(/module_dependencies\.A/.test(joined) && /prd_to_code_traceability\[1\]/.test(joined) && /key_files/.test(joined), true, `留痕可定位: ${joined}`);
    }),
  },
  {
    name: 'P0-2 第五轮复审: 集合条目 null/标量（modules/criteria/use_cases/ui_bindings [null]）→ 剔除 + 带索引留痕（codex 实测复现）',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        // 七轮 P1-2 起 package_path 必填——本用例只验"非 map 条目剔除"，给 M1 合法路径
        ['feature: bc-open', 'modules:', '  - null', '  - name: M1', '    package_path: mod1'].join('\n'),
      );
      writeFile(
        path.join(root, 'doc', 'features', feature, 'acceptance.yaml'),
        ['feature: bc-open', 'criteria:', '  - null', '  - id: AC-1'].join('\n'),
      );
      writeFile(
        path.join(root, 'doc', 'features', feature, 'use-cases.yaml'),
        [
          'schema_version: "1.0"',
          'feature: bc-open',
          'use_cases:',
          '  - null',
          '  - id: uc-1',
          '    coordinator: X',
          '    ui_bindings:',
          '      - null',
          '      - ui: HomePage',
          '        role: entry',
          '        user_actions: []',
        ].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      assertEq((spec.contracts?.modules as unknown[]).length, 1, 'modules null 条目剔除（check-ut mod.package_path 防崩）');
      assertEq((spec.acceptance?.criteria as unknown[]).length, 1, 'criteria null 条目剔除（c.ut_layer 防崩）');
      const ucs = spec.useCases?.use_cases ?? [];
      assertEq(ucs.length, 1, 'use_cases null 条目剔除（uc.id 防崩）');
      assertEq((ucs[0]?.ui_bindings as unknown[]).length, 1, 'ui_bindings null 条目剔除（ub.ui 防崩）');
      const joined = (spec.shape_issues ?? []).join('|');
      assertEq((spec.shape_issues ?? []).length, 4, `四处非 map 条目全留痕: ${joined}`);
      assertEq(/modules\[0\]/.test(joined) && /use_cases\[0\]/.test(joined), true, `留痕带索引: ${joined}`);
    }),
  },
  {
    name: '七轮 P1-2: modules[].package_path 边界校验——越界/绝对/缺失剔除留痕；反斜杠 canonical 化写回',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        [
          'feature: bc-open',
          'modules:',
          '  - name: OK',
          '    package_path: app/feature',
          "  - name: BackslashOK",
          "    package_path: 'app\\sub'",
          '  - name: Escape',
          '    package_path: ../outside',
          '  - name: Abs',
          "    package_path: 'D:/evil'",
          '  - name: NoPath',
        ].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      const mods = (spec.contracts?.modules ?? []) as Array<{ name?: string; package_path: string }>;
      assertEq(mods.map(m => m.package_path), ['app/feature', 'app/sub'], '合法条目保留且 canonical 化（反斜杠→正斜杠）');
      const joined = (spec.shape_issues ?? []).join('|');
      assertEq(
        /modules\[2\]\.package_path/.test(joined) && /modules\[3\]\.package_path/.test(joined) && /modules\[4\]\.package_path/.test(joined),
        true,
        `越界/绝对/缺失三类全留痕（feature_spec_shape 结构化 BLOCKER 消费）: ${joined}`,
      );
      assertEq(/越出宿主根|越界|不得包含|相对 project-root/.test(joined), true, `留痕可行动: ${joined}`);
    }),
  },
  {
    name: 'P0-2 第五轮复审: plan_to_code 空集不再真空 PASS（条目存在但 0 key_files → BLOCKER FAIL）',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        ['feature: bc-open', 'prd_to_code_traceability:', '  - prd_id: AC-1'].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      const ctx = {
        phase: 'coding',
        feature,
        projectRoot: root,
        featureSpec: spec,
        phaseRule: { phase: 'coding', traceability_checks: { plan_to_code: { description: 'plan_to_code' } } },
      } as unknown as CheckContext;
      const r = checkDesignToCode(ctx);
      const hit = r.find(x => x.id === 'plan_to_code');
      if (!hit) throw new Error(JSON.stringify(r));
      assertEq(hit.status, 'FAIL', `07-13 形态（15 条全缺 key_files）不得再"全部 0 个关键文件均存在"假 PASS: ${JSON.stringify(hit)}`);
      assertEq(/未映射任何 key_files/.test(hit.details ?? ''), true, '报错须可行动');
    }),
  },
  {
    name: 'P0-2 第六轮复审: plan_to_code 逐条目校验——一条空 + 一条合法（文件存在）仍须 FAIL 并点名空条目',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(path.join(root, 'src', 'ok.ets'), 'export {}');
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        [
          'feature: bc-open',
          'prd_to_code_traceability:',
          '  - prd_id: AC-empty',
          '    key_files: []',
          '  - prd_id: AC-ok',
          '    key_files: ["src/ok.ets"]',
        ].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      const ctx = {
        phase: 'coding',
        feature,
        projectRoot: root,
        featureSpec: spec,
        phaseRule: { phase: 'coding', traceability_checks: { plan_to_code: { description: 'plan_to_code' } } },
      } as unknown as CheckContext;
      const r = checkDesignToCode(ctx);
      const hit = r.find(x => x.id === 'plan_to_code');
      if (!hit) throw new Error(JSON.stringify(r));
      assertEq(hit.status, 'FAIL', `部分条目空 key_files 不得被合法条目掩护 PASS: ${JSON.stringify(hit)}`);
      assertEq(/AC-empty/.test(hit.details ?? ''), true, `须点名空条目 prd_id: ${hit.details}`);
      assertEq(/1\/2/.test(hit.details ?? ''), true, `须给出空/总计数: ${hit.details}`);
    }),
  },
  {
    name: 'P0-2 第七轮复审: plan_to_code 伪造路径四件套（""/"."/目录/越根）→ BLOCKER FAIL 非内部错误',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      const mkCtx = (keyFilesYaml: string): CheckContext => {
        writeFile(
          path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
          ['feature: bc-open', 'prd_to_code_traceability:', '  - prd_id: AC-1', `    key_files: ${keyFilesYaml}`].join('\n'),
        );
        clearFrameworkConfigCache();
        return {
          phase: 'coding',
          feature,
          projectRoot: root,
          featureSpec: new SpecLoader(root).loadFeatureSpec(feature),
          phaseRule: { phase: 'coding', traceability_checks: { plan_to_code: { description: 'plan_to_code' } } },
        } as unknown as CheckContext;
      };
      for (const [yaml, label] of [
        ['[""]', '空串'],
        ['["."]', '"." 指向 projectRoot'],
        ['["src"]', '目录'],
        ['["../outside.ets"]', '越根'],
      ] as const) {
        const r = checkDesignToCode(mkCtx(yaml));
        const hit = r.find(x => x.id === 'plan_to_code');
        assertEq(hit?.status, 'FAIL', `${label} 不得 PASS（伪造追溯）: ${JSON.stringify(hit)}`);
        assertEq(hit?.severity, 'BLOCKER', `${label} 须 BLOCKER`);
      }
    }),
  },
  {
    name: 'P0-2 第七轮复审: 缺失/空白 prd_id 的条目 → BLOCKER FAIL（无法追溯到任何 PRD）',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(path.join(root, 'src', 'ok.ets'), 'export {}');
      const cases = [
        ['  - key_files: ["src/ok.ets"]', '缺失 prd_id'],
        ['  - prd_id: ""\n    key_files: ["src/ok.ets"]', '空串 prd_id'],
        ['  - prd_id: "   "\n    key_files: ["src/ok.ets"]', '纯空格 prd_id'],
      ] as const;
      for (const [entryYaml, label] of cases) {
        writeFile(
          path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
          ['feature: bc-open', 'prd_to_code_traceability:', entryYaml].join('\n'),
        );
        clearFrameworkConfigCache();
        const ctx = {
          phase: 'coding',
          feature,
          projectRoot: root,
          featureSpec: new SpecLoader(root).loadFeatureSpec(feature),
          phaseRule: { phase: 'coding', traceability_checks: { plan_to_code: { description: 'plan_to_code' } } },
        } as unknown as CheckContext;
        const r = checkDesignToCode(ctx);
        const hit = r.find(x => x.id === 'plan_to_code');
        assertEq(hit?.status, 'FAIL', `${label} 不得 PASS: ${JSON.stringify(hit)}`);
        assertEq(/prd_id/.test(hit?.details ?? ''), true, `${label} 报错须指向 prd_id`);
      }
    }),
  },
  {
    name: 'P0-2 第六轮复审: plan_to_code 全条目有 key_files 且文件存在 → PASS（防过严回归）',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(path.join(root, 'src', 'ok.ets'), 'export {}');
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        ['feature: bc-open', 'prd_to_code_traceability:', '  - prd_id: AC-ok', '    key_files: ["src/ok.ets"]'].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      const ctx = {
        phase: 'coding',
        feature,
        projectRoot: root,
        featureSpec: spec,
        phaseRule: { phase: 'coding', traceability_checks: { plan_to_code: { description: 'plan_to_code' } } },
      } as unknown as CheckContext;
      const r = checkDesignToCode(ctx);
      const hit = r.find(x => x.id === 'plan_to_code');
      assertEq(hit?.status, 'PASS', `合法追溯不得误伤: ${JSON.stringify(hit)}`);
    }),
  },
  {
    name: 'P0-2 第五轮复审: key_files:"" 不得借合法 files 静默绕过留痕（别名仅缺失时生效）',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'contracts.yaml'),
        [
          'feature: bc-open',
          'prd_to_code_traceability:',
          '  - prd_id: AC-1',
          '    key_files: ""',
          '    files: ["src/a.ets"]',
        ].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      const joined = (spec.shape_issues ?? []).join('|');
      assertEq(/key_files/.test(joined), true, `key_files:"" 须留形状痕迹（不被 files 别名洗掉）: ${joined}`);
    }),
  },
  {
    name: 'P0-2 复审: use-cases 嵌套集合（ui_bindings/user_actions/data_boundaries/branches）dict 形 → loader 统一归一+留痕',
    run: () => withTmpProject(root => {
      const feature = 'bc-open';
      writeFile(
        path.join(root, 'doc', 'features', feature, 'use-cases.yaml'),
        [
          'schema_version: "1.0"',
          'feature: bc-open',
          'use_cases:',
          '  - id: uc-1',
          '    coordinator: X',
          '    ui_bindings: {}',
          '    data_boundaries: ""',
          '    branches: { oops: 1 }',
          '  - id: uc-2',
          '    coordinator: Y',
          '    ui_bindings:',
          '      - ui: HomePage',
          '        role: entry',
          '        user_actions: {}',
        ].join('\n'),
      );
      const loader = new SpecLoader(root);
      const spec = loader.loadFeatureSpec(feature);
      const ucs = spec.useCases?.use_cases ?? [];
      assertEq(Array.isArray(ucs[0]?.ui_bindings), true, 'ui_bindings 归空数组（check-ut reduce 防崩）');
      assertEq(Array.isArray(ucs[0]?.data_boundaries), true, 'data_boundaries 归空数组');
      assertEq(Array.isArray(ucs[0]?.branches), true, 'branches 归空数组');
      assertEq(Array.isArray(ucs[1]?.ui_bindings?.[0]?.user_actions), true, '嵌套 user_actions 归空数组（trace-gates 遍历防崩）');
      const joined = (spec.shape_issues ?? []).join('|');
      assertEq((spec.shape_issues ?? []).length, 4, `四处嵌套坏形状全留痕: ${joined}`);
      assertEq(/use_cases\[uc-1\]\.ui_bindings/.test(joined), true, `嵌套留痕带路径: ${joined}`);
      assertEq(/use_cases\[uc-2\]\.ui_bindings\[HomePage\]\.user_actions/.test(joined), true, `深层留痕带路径: ${joined}`);
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
