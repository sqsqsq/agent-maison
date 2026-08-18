// ============================================================================
// product-selection-t5.unit.test.ts — 单次解析贯穿全链 + 来源语义（plan a7c3f9e2 t5）
// ============================================================================
// 覆盖：
//   1. explicit_run / confirmed_env（含 device_test 自动读 env）来源语义
//   2. carrier：构建前解析的 selection 与分类/详情收到的同一对象（生产路径行为断言
//      + 接线回归——"构建期间外部状态改变"场景证明报告使用冻结值、无二次解析）
//   3. 失败归因首句：source 非可信集合（sole_candidate）时 explanation 首句声明形态未经确认
//   4. ut / device_test 构建入口接线（显式 product + unresolved 阻断）
//   5. goal 桥：chainRequiresProduct / goalProductPurpose / resolveProductSelectionViaProfile
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import { withDefaultLayoutFields, DEFAULT_LAYOUT } from '../../../../../harness/tests/utils/layout-test-helper';
import {
  resolveProductSelection,
  describeProductSelection,
  TRUSTED_PRODUCT_SOURCES,
  type ProductSelection,
} from '../../product-selection';
import { classifyCodingCompileFailure, isCompilePass } from '../../coding-host-rules';
import {
  chainRequiresProduct,
  goalProductPurpose,
  resolveProductSelectionViaProfile,
} from '../../../../../harness/scripts/utils/product-selection-bridge';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const PROFILES_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', 'profiles');
const hmosProfileDir = path.join(PROFILES_ROOT, 'hmos-app');

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ps-t5-'));
}

function withTmp<T>(fn: (root: string) => T): T {
  const root = mkTmp();
  try {
    return fn(root);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeBuildProfile(root: string, products: string[]): void {
  fs.writeFileSync(
    path.join(root, 'build-profile.json5'),
    JSON.stringify({ app: { products: products.map(name => ({ name })) } }, null, 2),
    'utf-8',
  );
}

function mkCtx(projectRoot: string): CheckContext {
  return {
    phase: 'coding',
    feature: 'unit',
    projectRoot,
    phaseRule: { phase: 'coding', structure_checks: {}, semantic_checks: {}, traceability_checks: {} } as never,
    featureSpec: { feature: 'unit' } as never,
    resolvedProfile: {
      name: 'hmos-app',
      profileDir: hmosProfileDir,
      yaml: {} as never,
      phasesDisabled: new Set<string>(),
      capabilities: {
        'coding.compile': { provider: 'hvigor', severity: 'BLOCKER' },
        'ut.compile': { provider: 'hvigor', severity: 'BLOCKER' },
        'ut.run': { provider: 'hvigor', severity: 'BLOCKER' },
        'device_test.build': { provider: 'hvigor_app', severity: 'BLOCKER' },
      } as never,
      personalPrerequisites: {},
    } as never,
    ...withDefaultLayoutFields({}),
  } as CheckContext;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 't5(explicit_run) 本次调用显式参数 → explicit_run',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['a', 'b']);
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding', explicitProduct: 'b' });
      assert.strictEqual(sel.source, 'explicit_run');
      assert.strictEqual(sel.product, 'b');
    }),
  },
  {
    name: 't5(confirmed_env) 显式 env 参数 → confirmed_env',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['a', 'b']);
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'device_test', envProduct: 'a' });
      assert.strictEqual(sel.source, 'confirmed_env');
    }),
  },
  {
    name: 't5(confirmed_env) device_test 自动读 HARNESS_DEVICE_TEST_PRODUCT（真实调用链）',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['a', 'b']);
      const prev = process.env.HARNESS_DEVICE_TEST_PRODUCT;
      process.env.HARNESS_DEVICE_TEST_PRODUCT = 'b';
      try {
        const sel = resolveProductSelection({ projectRoot: root, purpose: 'device_test' });
        assert.strictEqual(sel.source, 'confirmed_env');
        assert.strictEqual(sel.product, 'b');
        // coding/ut purpose 不读该 env（仍 unresolved）
        const coding = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
        assert.strictEqual(coding.source, 'unresolved');
        const ut = resolveProductSelection({ projectRoot: root, purpose: 'ut' });
        assert.strictEqual(ut.source, 'unresolved');
      } finally {
        if (prev === undefined) delete process.env.HARNESS_DEVICE_TEST_PRODUCT;
        else process.env.HARNESS_DEVICE_TEST_PRODUCT = prev;
      }
    }),
  },
  {
    name: 't5(carrier) 构建期间外部状态改变 → 分类/报告仍用构建前冻结的 selection（无二次解析）',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['mirror', 'product']);
      const frozen = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(frozen.source, 'unresolved');
      // 模拟"构建期间外部配置改变"：候选被外部删成单候选且写下意外确认
      writeBuildProfile(root, ['mirror']);
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify({
          schema_version: '1.0',
          toolchain: { productSelection: { confirmed: { value: 'mirror', confirmed_at: 'x' } } },
        }),
      );
      const after = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(after.source, 'sole_candidate', '外部已改 → 重新解析会不同');
      assert.notStrictEqual(after.source, frozen.source, '必须存在"若二次解析结果会变"的证明条件');
      // 冻结对象逐字段不变（含 candidates 快照），报告行使用冻结值
      assert.strictEqual(frozen.product, null);
      assert.deepStrictEqual(frozen.candidates, ['product', 'mirror']);
      assert.strictEqual(frozen.resolvedAt, frozen.resolvedAt);
      const reportLine = describeProductSelection(frozen);
      assert(reportLine.includes('(unresolved)'), reportLine);
      assert(reportLine.includes('product, mirror'), '报告展示冻结时的候选快照（外部改变不影响）');
    }),
  },
  {
    name: 't5(classify 注入) 同一 selection 进分类；sole_candidate 时 explanation 首句声明形态未经确认',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['mirror']);
      const frozen = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(frozen.source, 'sole_candidate');
      const res = {
        executed: true,
        exitCode: 1,
        errors: [{ file: 'src/pages/A.ets', line: 3, message: 'boom' }],
        successMarkerFound: false,
        logExcerpt: 'boom',
      };
      const cls = classifyCodingCompileFailure(res, mkCtx(DEFAULT_LAYOUT.projectRoot), frozen);
      assert.strictEqual(cls.kind, 'project_build');
      const firstLine = cls.explanation.split('\n')[0] ?? '';
      assert(firstLine.includes('编译形态未经确认'), `首句须声明形态未经确认：${firstLine}`);
      assert(firstLine.includes('mirror'), firstLine);
      assert(firstLine.includes('sole_candidate'), firstLine);
      // 可信来源（explicit_run）不产生首句声明
      const trusted = resolveProductSelection({ projectRoot: root, purpose: 'coding', explicitProduct: 'mirror' });
      const clsTrusted = classifyCodingCompileFailure(res, mkCtx(DEFAULT_LAYOUT.projectRoot), trusted);
      assert(!clsTrusted.explanation.startsWith('编译形态未经确认'), clsTrusted.explanation);
    }),
  },
  {
    name: 't5(接线) checkCodingCompile 单次解析贯穿构建/分类/详情（生产路径接线回归）',
    run: () => {
      const src = fs.readFileSync(path.join(hmosProfileDir, 'harness', 'coding-host-rules.ts'), 'utf-8');
      const calls = src.match(/resolveProductSelection\(\{ projectRoot: ctx\.projectRoot, purpose: 'coding' \}\)/g) ?? [];
      assert.strictEqual(calls.length, 1, `checkCodingCompile 须且仅解析一次（实际 ${calls.length}）`);
      assert(
        src.includes('product: compileSelection.product ?? undefined,'),
        '构建参数须显式使用该次解析出的 product',
      );
      const classifyPasses = src.match(/classifyCodingCompileFailure\(\{ \.\.\.res, errors: res\.errors \?\? \[\] \}, ctx, compileSelection\)/g) ?? [];
      assert.strictEqual(classifyPasses.length, 3, '首判/事务重跑/终判三处 classify 均须传同一 selection');
      assert(
        src.includes('buildCompilePassDetails(res, modules.length, depsAutoFixNote, compileSelection)'),
        'PASS details 须传同一 selection',
      );
      assert(
        src.includes('buildCompileFailDetails(res, failure, [...buildTxnRetryLines, ...installExtraLines], compileSelection)'),
        'FAIL details 须传同一 selection',
      );
      assert(src.includes("source === 'unresolved'"), 'unresolved 分支在场');
    },
  },
  {
    name: 't5(接线) ut-host 构建/执行入口单次解析 + 显式 product + unresolved 阻断',
    run: () => {
      const src = fs.readFileSync(path.join(hmosProfileDir, 'harness', 'ut-host-impl.ts'), 'utf-8');
      const buildResolves = src.match(/const selection = resolveProductSelection\(\{ projectRoot: ctx\.projectRoot, purpose: 'ut' \}\)/g) ?? [];
      assert.strictEqual(buildResolves.length, 2, `checkUtHvigorBuild/checkUtHvigorTest 各解析一次（实际 ${buildResolves.length}）`);
      assert(
        (src.match(/product: selection\.product \?\? undefined,/g) ?? []).length >= 2,
        'ut 编译与执行均显式传递 product',
      );
      const unresolvedBlocks = src.match(/source === 'unresolved'/g) ?? [];
      assert.strictEqual(unresolvedBlocks.length, 2, 'build 与 test 两个入口均有 unresolved 阻断');
      assert(src.includes("blocking_class: 'externalBlocked'"), '阻断复用既有 externalBlocked 语义');
    },
  },
  {
    name: 't5(接线) device_test.build provider 单次解析 + result 携带 selection + unresolved 阻断桩',
    run: () => {
      const src = fs.readFileSync(
        path.join(hmosProfileDir, 'harness', 'providers', 'device-test-build.ts'),
        'utf-8',
      );
      const resolves = src.match(/resolveProductSelection\(\{/g) ?? [];
      assert.strictEqual(resolves.length, 1, 'provider 只解析一次（实际 ' + resolves.length + '）');
      assert(
        src.includes("purpose: 'device_test'"),
        'purpose=device_test（env 读取语义）',
      );
      assert(src.includes('productSelection: selection'), 'result 返回同一 selection 对象');
      assert(/source === 'unresolved'/.test(src), 'unresolved 阻断在场');
      assert(src.includes('exitCode: 1'), '阻断桩 exitCode=1（fail，不崩溃）');
      assert(
        src.includes('metaExtras') && src.includes('productSelection:'),
        'metaExtras 仅审计落盘（含 selection 快照）',
      );
      // review P2：reuse evaluator 直接消费冻结 product，不得隐式二次解析（无 import、无调用）
      const reuseSrc = fs.readFileSync(
        path.join(hmosProfileDir, 'harness', 'device-test-build-reuse.ts'),
        'utf-8',
      );
      assert(
        !/import[\s\S]*resolve(?:DeviceTest)?Product/.test(reuseSrc) &&
          !/(?:resolveDeviceTestProduct|resolveProductSelection)\(/.test(reuseSrc),
        'reuse evaluator 不得 import/调用任何 product 解析器',
      );
      assert(/product: string;/.test(reuseSrc), 'reuse 入参须为冻结的 product（必填）');
      assert(
        src.includes('product: selection.product!,'),
        'provider 把冻结 product 显式传给 reuse evaluator',
      );
    },
  },
  {
    name: 't5(goal 桥) chainRequiresProduct / goalProductPurpose / resolveProductSelectionViaProfile',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['a', 'b']);
      const ctx = mkCtx(root);
      assert.strictEqual(chainRequiresProduct(['spec', 'plan'], ctx.resolvedProfile), false, '无构建 phase 不检查');
      assert.strictEqual(chainRequiresProduct(['spec', 'coding'], ctx.resolvedProfile), true);
      assert.strictEqual(chainRequiresProduct(['spec', 'ut'], ctx.resolvedProfile), true);
      assert.strictEqual(chainRequiresProduct(['spec', 'testing'], ctx.resolvedProfile), true);
      // review P1：purpose 按**链路首个需 product 的 phase**——env（testing-only）不得
      // 放行 coding 起点的完整链路（否则启动预检过、coding 中途才 unresolved）。
      assert.strictEqual(goalProductPurpose(['spec', 'coding', 'ut']), 'coding');
      assert.strictEqual(goalProductPurpose(['spec', 'coding']), 'coding');
      assert.strictEqual(goalProductPurpose(['spec', 'ut', 'testing']), 'ut');
      assert.strictEqual(goalProductPurpose(['spec', 'testing']), 'device_test');
      assert.strictEqual(goalProductPurpose(['testing']), 'device_test', 'testing-only 链路 env 可解除');
      const viaProfile = resolveProductSelectionViaProfile(root, path.join(hmosProfileDir, 'harness'), 'coding');
      assert(viaProfile, 'profile 解析器应可用');
      assert.strictEqual(viaProfile.ok, true);
      if (viaProfile.ok) {
        assert.strictEqual(viaProfile.selection.source, 'unresolved');
        assert.deepStrictEqual(viaProfile.selection.candidates, ['a', 'b']);
      }
      const missing = resolveProductSelectionViaProfile(root, path.join(root, 'no-such-dir'), 'coding');
      assert(missing && missing.ok === false && missing.reason === 'missing', '解析器缺失 → missing（可跳过）');
      // 解析器执行失败（模拟 require 到坏模块）→ error，不得静默跳过
      const brokenDir = mkTmp();
      try {
        fs.mkdirSync(path.join(brokenDir, 'bad-profile', 'harness'), { recursive: true });
        fs.writeFileSync(
          path.join(brokenDir, 'bad-profile', 'harness', 'product-selection.ts'),
          'throw new Error("boom");\n',
          'utf-8',
        );
        fs.writeFileSync(
          path.join(brokenDir, 'bad-profile', 'harness', 'product-selection.js'),
          'throw new Error("boom");\n',
          'utf-8',
        );
        const err = resolveProductSelectionViaProfile(root, path.join(brokenDir, 'bad-profile', 'harness'), 'coding');
        assert(err && err.ok === false && err.reason === 'error', '解析器执行失败 → error，不得跳过');
      } finally {
        fs.rmSync(brokenDir, { recursive: true, force: true });
      }
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: (e as Error).stack ?? (e as Error).message };
    }
  });
}