// ============================================================================
// detect-product.unit.test.ts — product 探测语义（plan a7c3f9e2 t5 重定义）
// ============================================================================
//
// 旧语义（v2.7）：detectProduct 按名称启发式静默猜测（preferredProduct > 命中
// product/default 名 > 首位 > 兜底 default）——猜错且恰好编译成功会直接签发 PASS，
// 且把推断值冒充用户意图。t5 起：
//   - 生产解析 = resolveProductSelection（explicit_run → confirmed_env →
//     explicit_config → sole_candidate → unresolved）；
//   - preferredProduct **只有**在 framework.local.json 有匹配确认记录时才可信；
//   - 多候选且无可信来源 → unresolved：detectProduct 抛错（薄包装），不兜底 default；
//   - 名称启发式（product/default/首位）仅供候选展示排序，不产出选定值。
//
// 覆盖矩阵（10 case）：
//   1. 空工程（无 config / 无 build-profile）→ unresolved：detectProduct 抛错（不再虚构 default）
//   2. build-profile.json5 自定义 product=mirror → 'mirror'
//   3. app.products 为空数组 → unresolved：抛错（真实声明为空，stop）
//   4. build-profile.json5 文件不存在 → unresolved：抛错
//   5. build-profile.json5 解析失败 → unresolved：抛错（不可解析，stop）
//   6. config preferredProduct='phone'（**未确认**）+ 单候选 mirror → 不采信，回落 'mirror'
//   6b. config preferredProduct='phone'（local 已确认）→ 'phone'
//   7. 多 product（mirror/product）未确认 → unresolved：detectProduct 抛错
//   8. 多 product（mirror/default）未确认 → unresolved：抛错（不得偏爱 default 名）
//   9. 多 product 未确认 → resolveProductSelection.candidates 按 product→default→其余排序
//   10. build-profile.json5 含 // 注释 + 尾逗号 → 仍能解析（单候选 → 该名）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import { detectProduct } from '../../../../../harness/scripts/utils/hvigor-runner';
import { resolveProductSelection } from '../../product-selection';
import { clearFrameworkConfigCache } from '../../../../../harness/config';
import { writeLocalConfig } from '../../../../../harness/scripts/utils/framework-local-config';

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

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-product-unit-'));
  try {
    clearFrameworkConfigCache();
    return fn(dir);
  } finally {
    clearFrameworkConfigCache();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

/** 写可被 loadFrameworkConfig 接受的 config（regulator 兜底要求完整基础字段） */
function writeConfigWithPreferred(root: string, preferred: string): void {
  writeFile(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.1',
      project_name: 'demo',
      project_type: 'app',
      agent_adapter: 'generic',
      architecture: {
        outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
        module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
        inner_dependency_direction: 'upward',
        cross_module_exports_file: 'index.ets',
      },
      paths: {},
      toolchain: { preferredProduct: preferred },
    }),
  );
}

function confirmPreferredOnLocal(root: string, value: string): void {
  writeLocalConfig(root, {
    schema_version: '1.0',
    toolchain: {
      productSelection: { confirmed: { value, confirmed_at: '2026-08-17T00:00:00.000Z' } },
    },
  });
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'detectProduct: 空工程（无 config / 无 build-profile）→ unresolved 抛错，不虚构 default',
    run: () => withTmpDir(root => {
      assert.throws(() => detectProduct(root), /build-profile|无法确定|product/);
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(sel.source, 'unresolved');
      assert.strictEqual(sel.unresolvedCause, 'no_build_profile');
      assert.deepStrictEqual(sel.candidates, [], '缺失 build-profile 不得产出虚构候选');
    }),
  },
  {
    name: 'detectProduct: build-profile.json5 自定义 product=mirror → 返回 mirror',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'mirror', signingConfig: 'default' }] } }),
      );
      assertEq(detectProduct(root), 'mirror', '单候选应取 products[0].name');
    }),
  },
  {
    name: 'detectProduct: build-profile.json5 app.products 为空数组 → unresolved（真实声明为空，stop）',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [] } }),
      );
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(sel.source, 'unresolved');
      assert.strictEqual(sel.unresolvedCause, 'empty_products');
      assert.throws(() => detectProduct(root), /无法确定/);
    }),
  },
  {
    name: 'detectProduct: build-profile.json5 文件不存在 → unresolved（stop，不猜 default）',
    run: () => withTmpDir(root => {
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(sel.source, 'unresolved');
      assert.strictEqual(sel.unresolvedCause, 'no_build_profile');
      assert.throws(() => detectProduct(root), /无法确定/);
    }),
  },
  {
    name: 'detectProduct: build-profile.json5 解析失败 → unresolved（不可解析，stop）',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        '{ app: { products: [ { "name": "x" }',
      );
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(sel.source, 'unresolved');
      assert.strictEqual(sel.unresolvedCause, 'unparseable_build_profile');
      assert.throws(() => detectProduct(root), /无法确定/);
    }),
  },
  {
    name: 'detectProduct: preferredProduct（未确认）不再覆盖——单候选回落 sole_candidate',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'mirror' }] } }),
      );
      writeConfigWithPreferred(root, 'phone');
      assertEq(detectProduct(root), 'mirror', '未确认的推断值不得冒充用户意图');
    }),
  },
  {
    name: 'detectProduct: preferredProduct（local 已确认）→ 生效',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'mirror' }] } }),
      );
      writeConfigWithPreferred(root, 'phone');
      confirmPreferredOnLocal(root, 'phone');
      assertEq(detectProduct(root), 'phone', 'config 值且 local 确认值相等 → explicit_config');
    }),
  },
  {
    name: 'detectProduct: 多 product（mirror/product）未确认 → unresolved 抛错（不猜 product 名）',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({
          app: {
            products: [
              { name: 'mirror' },
              { name: 'product' },
            ],
          },
        }),
      );
      assert.throws(
        () => detectProduct(root),
        (e: Error) => {
          assert(e.message.includes('product_selection') || e.message.includes('编译形态'), e.message);
          assert(e.message.includes('mirror'), '错误信息应含候选');
          return true;
        },
        '不得偏爱名为 product 的条目',
      );
    }),
  },
  {
    name: 'detectProduct: 多 product（mirror/default）未确认 → unresolved 抛错（不猜 default 名）',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({
          app: {
            products: [
              { name: 'mirror' },
              { name: 'default' },
            ],
          },
        }),
      );
      assert.throws(() => detectProduct(root), /unresolved|无法确定/);
    }),
  },
  {
    name: 'resolveProductSelection: 名称启发式仅供候选展示排序（product→default→其余）',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({
          app: {
            products: [
              { name: 'mirror' },
              { name: 'default' },
              { name: 'product' },
              { name: 'alt' },
            ],
          },
        }),
      );
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(sel.source, 'unresolved');
      assertEq(sel.candidates, ['product', 'default', 'mirror', 'alt'], '展示排序非选定值');
      assert.strictEqual(sel.product, null);
    }),
  },
  {
    name: 'detectProduct: build-profile.json5 含 // 注释 + 尾逗号（DevEco 模板风格） → 仍能解析',
    run: () => withTmpDir(root => {
      const content = [
        '{',
        '  // DevEco 默认生成模板',
        '  "app": {',
        '    "products": [',
        '      {',
        '        "name": "altproduct", // 主 product',
        '        "signingConfig": "default",',
        '      },',
        '    ],',
        '  },',
        '  /* 多 product 时第一个为 framework harness 默认值 */',
        '}',
      ].join('\n');
      writeFile(path.join(root, 'build-profile.json5'), content);
      assertEq(detectProduct(root), 'altproduct', 'JSON5 注释 + 尾逗号应被容忍（单候选）');
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
