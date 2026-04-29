// ============================================================================
// hvigor-args.unit.test.ts — v2.7 hvigor args 装配回归
// ============================================================================
//
// 为什么写这层（不是 fixture / 端到端）：
//   v2.7+ 加入了 -p buildMode=debug / --parallel / --incremental / --daemon /
//   --analyze=advanced 等加速与诊断 flag
//   以及 product 自动探测。这些参数装配错位（例如 buildMode=debug 漏掉、product
//   写成 default、extraArgs 顺序放反让用户覆盖失效）会让"加速"静默退化甚至直
//   接编译失败。fixture 里没法跑 hvigor 真实编译（CI 不带 DevEco），只能回到
//   纯函数 + 字符串断言这一档。
//
// 覆盖矩阵（3 case）：
//   1. assembleApp（coding 阶段）：
//      a. --mode project 出现且只一次
//      b. -p product=<detect 结果> 出现
//      c. -p buildMode=debug 出现（这是 release→debug 加速的关键）
//      d. --daemon / --parallel / --incremental / --analyze=advanced 都在
//      e. extraArgs 透传到 task 之前的末端（让用户的 -p buildMode=release
//         能覆盖 framework 默认值）
//   2. ohosTest 路径（ut 阶段）：
//      a. -p module=<name>@ohosTest 出现
//      b. **不**含 -p buildMode=debug（HAP 默认即 debug，多余 flag 反而是噪音）
//      c. --daemon / --parallel / --incremental / --analyze=advanced 都在
//      d. -p product=<detect 结果> 出现
//   3. preferredProduct 覆盖：
//      framework.config.json 写 toolchain.preferredProduct=mirror，buildAssembleAppArgs
//      装出的 -p product=mirror（覆盖 build-profile.json5 默认）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildHvigorDiagnostics,
  buildAssembleAppArgs,
  buildModuleHapArgs,
} from '../../scripts/utils/hvigor-runner';
import { clearFrameworkConfigCache } from '../../config';

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

function assertContains(args: string[], expected: string, label: string): void {
  if (!args.includes(expected)) {
    throw new Error(`${label}\n    args: ${JSON.stringify(args)}\n    missing: ${expected}`);
  }
}

function assertNotContains(args: string[], banned: string, label: string): void {
  if (args.includes(banned)) {
    throw new Error(`${label}\n    args: ${JSON.stringify(args)}\n    unexpected: ${banned}`);
  }
}

/**
 * args 中按"-p key=val"模式查所有 value。返回数组以验证不重复 / 命中正确值。
 */
function findFlagValues(args: string[], pKey: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === '-p' && args[i + 1].startsWith(`${pKey}=`)) {
      result.push(args[i + 1].slice(pKey.length + 1));
    }
  }
  return result;
}

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvigor-args-unit-'));
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
    name: 'buildAssembleAppArgs: 含 buildMode=debug + parallel + incremental + product 自动探测，extraArgs 在 task 前',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'default' }] } }),
      );
      const args = buildAssembleAppArgs(root, 'assembleApp', ['-p', 'buildMode=release']);

      assertContains(args, '--mode', '应含 --mode');
      assertEq(
        args[args.indexOf('--mode') + 1],
        'project',
        '--mode 后必须是 project',
      );
      assertContains(args, '--parallel', '应含 --parallel');
      assertContains(args, '--incremental', '应含 --incremental');
      assertContains(args, '--daemon', '应含 --daemon');
      assertContains(args, '--analyze=advanced', '应含 --analyze=advanced');
      assertNotContains(args, '--no-daemon', '默认不应再传 --no-daemon');

      const buildModes = findFlagValues(args, 'buildMode');
      assertEq(
        buildModes,
        ['debug', 'release'],
        'buildMode 顺序必须是 default(debug) → extraArgs(release)，让用户覆盖生效',
      );

      const products = findFlagValues(args, 'product');
      assertEq(products, ['default'], 'product 应来自 detectProduct，不再硬写死');

      assertEq(args[args.length - 1], 'assembleApp', 'task 必须是最后一个参数');
    }),
  },

  {
    name: 'buildModuleHapArgs(target=ohosTest): 含 module + parallel + incremental，**不**含 buildMode',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'default' }] } }),
      );
      const args = buildModuleHapArgs(root, 'WalletMain', 'ohosTest', 'genOnDeviceTestHap');

      const modules = findFlagValues(args, 'module');
      assertEq(modules, ['WalletMain@ohosTest'], '应当形如 module=<name>@ohosTest');

      const products = findFlagValues(args, 'product');
      assertEq(products, ['default'], 'product 走 detectProduct');

      assertContains(args, '--parallel', '应含 --parallel');
      assertContains(args, '--incremental', '应含 --incremental');
      assertContains(args, '--daemon', '应含 --daemon');
      assertContains(args, '--analyze=advanced', '应含 --analyze=advanced');
      assertNotContains(args, '--no-daemon', '默认不应再传 --no-daemon');

      const buildModes = findFlagValues(args, 'buildMode');
      assertEq(
        buildModes,
        [],
        'ohosTest 路径不应硬写 buildMode（HAP / ohosTest 默认即 debug）',
      );

      assertNotContains(args, '--mode', 'module 级路径不传 --mode');
      assertEq(
        args[args.length - 1],
        'genOnDeviceTestHap',
        'task 必须是最后一个参数',
      );
    }),
  },

  {
    name: 'detectProduct via preferredProduct=mirror 覆盖时，args 含 -p product=mirror',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'default' }] } }),
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
            cross_module_exports_file: 'Index.ets',
          },
          paths: {},
          toolchain: { preferredProduct: 'mirror' },
        }),
      );

      const assembleArgs = buildAssembleAppArgs(root, 'assembleApp');
      assertEq(
        findFlagValues(assembleArgs, 'product'),
        ['mirror'],
        'assembleApp 路径应当以 preferredProduct 覆盖 build-profile',
      );

      const moduleArgs = buildModuleHapArgs(root, 'WalletMain', 'ohosTest', 'genOnDeviceTestHap');
      assertEq(
        findFlagValues(moduleArgs, 'product'),
        ['mirror'],
        'ohosTest 路径同样应当以 preferredProduct 覆盖',
      );
    }),
  },
  {
    name: 'hvigor tuning: toolchain.hvigor 可开启 daemon/analyze 并关闭 parallel/incremental',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'product' }] } }),
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
            cross_module_exports_file: 'Index.ets',
          },
          paths: {},
          toolchain: {
            hvigor: {
              daemon: true,
              parallel: false,
              incremental: false,
              analyze: 'advanced',
            },
          },
        }),
      );

      const args = buildAssembleAppArgs(root, 'assembleHap');
      assertContains(args, '--daemon', 'daemon=true 时应传 --daemon');
      assertContains(args, '--analyze=advanced', 'analyze=advanced 时应传诊断参数');
      assertNotContains(args, '--no-daemon', 'daemon=true 时不应再传 --no-daemon');
      assertNotContains(args, '--parallel', 'parallel=false 时不应传 --parallel');
      assertNotContains(args, '--incremental', 'incremental=false 时不应传 --incremental');
      assertEq(findFlagValues(args, 'product'), ['product'], 'product 仍应正常探测');
      assertEq(args[args.length - 1], 'assembleHap', 'task 仍应在最后');
    }),
  },
  {
    name: 'hvigor diagnostics: 00308018 + onlineSign + analyze/daemon 给出定向提示',
    run: () => {
      const diagnostics = buildHvigorDiagnostics([
        '$ hvigor --mode module -p product=product -p buildMode=debug assembleHap --analyze=advanced --parallel --incremental --daemon',
        '> hvigor ERROR: Failed ::onlineSignApp...',
        'Error Code: 00308018 Unknown Error - Failed to find the incremental input file:',
        'D:/repo/build/product/outputs/product/wallet-product-unsigned.hap',
        'Archive HAP Package task start.',
      ].join('\n'));

      assertEq(diagnostics.length, 4, '应识别增量输入缺失、onlineSign、analyze、daemon 四类提示');
      if (!diagnostics.some(d => d.includes('00308018'))) {
        throw new Error(`诊断中应包含 00308018：${JSON.stringify(diagnostics)}`);
      }
      if (!diagnostics.some(d => d.includes('onlineSign'))) {
        throw new Error(`诊断中应包含 onlineSign：${JSON.stringify(diagnostics)}`);
      }
      if (!diagnostics.some(d => d.includes('--analyze=advanced'))) {
        throw new Error(`诊断中应包含 analyze：${JSON.stringify(diagnostics)}`);
      }
      if (!diagnostics.some(d => d.includes('--daemon'))) {
        throw new Error(`诊断中应包含 daemon：${JSON.stringify(diagnostics)}`);
      }
    },
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
