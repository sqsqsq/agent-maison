// ============================================================================
// detect-product.unit.test.ts — v2.7 hvigor product 自动探测
// ============================================================================
//
// 为什么写这层（不是 fixture）：
//   detectProduct 是 hvigor-runner 的纯函数 + 文件 IO，不需要真跑 hvigor 就能
//   覆盖。fixture 反向注入只能验"出口装配是否带 -p product=X"，无法独立暴露
//   product 探测每一档兜底是否正确。
//
// 覆盖矩阵（9 case）：
//   1. 默认工程（无 framework.config.json，无 build-profile.json5）→ 'default'
//   2. build-profile.json5 自定义 product 'mirror' → 'mirror'
//   3. build-profile.json5 app.products 为空数组 → 兜底 'default'
//   4. build-profile.json5 文件不存在 → 兜底 'default'
//   5. build-profile.json5 解析失败（无效 JSON） → 兜底 'default'，不抛
//   6. framework.config.json 含 toolchain.preferredProduct='phone'，同时
//      build-profile.json5 自定义 'mirror' → preferredProduct 覆盖，返回 'phone'
//   7. build-profile.json5 含 // 注释 + 尾逗号（典型 DevEco 模板）→ 仍能解析
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectProduct } from '../../../../../harness/scripts/utils/hvigor-runner';
import { clearFrameworkConfigCache } from '../../../../../harness/config';

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

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'detectProduct: 空工程（无 config / 无 build-profile） → 兜底 default',
    run: () => withTmpDir(root => {
      assertEq(detectProduct(root), 'default', '应兜底为 default');
    }),
  },
  {
    name: 'detectProduct: build-profile.json5 自定义 product=mirror → 返回 mirror',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'mirror', signingConfig: 'default' }] } }),
      );
      assertEq(detectProduct(root), 'mirror', '应取 products[0].name');
    }),
  },
  {
    name: 'detectProduct: build-profile.json5 app.products 为空数组 → 兜底 default',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [] } }),
      );
      assertEq(detectProduct(root), 'default', '空 products 应兜底 default');
    }),
  },
  {
    name: 'detectProduct: build-profile.json5 文件不存在 → 兜底 default（且不抛）',
    run: () => withTmpDir(root => {
      assertEq(detectProduct(root), 'default', '文件缺失走兜底');
    }),
  },
  {
    name: 'detectProduct: build-profile.json5 解析失败 → 兜底 default（吞异常）',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        '{ app: { products: [ { "name": "x" }',
      );
      assertEq(detectProduct(root), 'default', '坏 JSON 应吞异常并兜底 default');
    }),
  },
  {
    name: 'detectProduct: framework.config.json toolchain.preferredProduct=phone 覆盖 build-profile mirror',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'mirror' }] } }),
      );
      writeFile(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.0.0',
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
          toolchain: { preferredProduct: 'phone' },
        }),
      );
      assertEq(detectProduct(root), 'phone', 'preferredProduct 应覆盖 build-profile');
    }),
  },
  {
    name: 'detectProduct: 多 product 时优先命中名为 product 的条目（优于 products[0]）',
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
      assertEq(detectProduct(root), 'product', '应优先 product 名称');
    }),
  },
  {
    name: 'detectProduct: 无 product 名时优先命中 default（优于无序首位）',
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
      assertEq(detectProduct(root), 'default', '应优先 default 名称');
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
      assertEq(detectProduct(root), 'altproduct', 'JSON5 注释 + 尾逗号应被容忍');
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
