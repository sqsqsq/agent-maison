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
// 覆盖矩阵：
//   1. assembleApp（coding 阶段）：…
//   2. buildUtHvigorArgs（ut / ohosTest）：DevEco 对齐 --mode module、isOhosTest、buildMode=test、task 后接 analyze=normal
//   3. buildModuleHapArgs(default)： historic 无 --mode
//   4. preferredProduct 覆盖 ut/coding
//   …
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildHvigorDiagnostics,
  detectSignSkip,
  ensureFailedAtStageTag,
  buildOnDeviceSignDiagnosis,
  buildOnDeviceFailureEvidence,
  buildAssembleAppArgs,
  buildModuleHapArgs,
  buildUtHvigorArgs,
  looksLikeUtHvigorCommandMismatch,
  buildCodingHvigorArgs,
  analyzeProjectDependencyIssue,
  detectHvigorTaskNotFound,
  moduleDeclaresOhosTestTarget,
  sanitizeLogModuleName,
  parseBuildErrors,
} from '../../../../../harness/scripts/utils/hvigor-runner';
import { clearFrameworkConfigCache } from '../../../../../harness/config';
import { DEFAULT_LAYOUT } from '../../../../../harness/tests/utils/layout-test-helper';

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
  fs.mkdirSync(path.join(dir, 'framework', 'workflows'), { recursive: true });
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

// 宿主 08-13 build_maison_fail.txt 真实失败日志逐字切片（plan c9e3f7d1，保留 ANSI 原文与行序）：
//   L202  `> hvigor ^[[91mERROR: Failed :entry:product@CompileArkTS...`（失败任务，尾窗之外）
//   L1488 `> hvigor ^[[91mERROR: ^[[31mError Code: 00308018 Unknown Error`（ANSI 前缀后即错误正文）
//   L1489 `isReferencedAliasDeclaration is not a function`
//   L1490 `COMPILE RESULT:FAIL`
//   L1493 `This error is unknown, view the detailed error logs:`
//   L1501 `> hvigor ^[[91mERROR: BUILD FAILED in 55 s 595 ms`（包装行）
// 中间区间（430 条 ArkTS WARN 等）省略；process_lazy_import 堆栈与 etsLoaderVersion 属
// `.hvigor` 内部 build.log（plan 立项事实节一），不在本切片中。
const HOST_FAIL_SLICE_ANSI = [
  '> hvigor \x1b[91mERROR: Failed :entry:product@CompileArkTS...',
  '…（L203–L1487：430 条 ArkTS WARN 等，省略）…',
  '> hvigor \x1b[91mERROR: \x1b[31mError Code: 00308018 Unknown Error',
  'isReferencedAliasDeclaration is not a function',
  'COMPILE RESULT:FAIL',
  '…（L1491–L1492，省略）…',
  'This error is unknown, view the detailed error logs:',
  '…（L1494–L1500，省略）…',
  '> hvigor \x1b[91mERROR: BUILD FAILED in 55 s 595 ms',
].join('\n');

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
      assertContains(args, '--analyze=normal', '应含 --analyze=normal');
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
    name: 'buildCodingHvigorArgs（默认）: --mode module、末尾 assembleHap、buildMode=debug',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'phone' }] } }),
      );
      const args = buildCodingHvigorArgs(root);
      assertEq(args[args.length - 1], 'assembleHap', '默认 task assembleHap');
      assertEq(args[args.indexOf('--mode') + 1], 'module', '--mode module');
      assertContains(args, '--parallel', '');
      assertContains(args, '--daemon', '');
      assertEq(findFlagValues(args, 'product'), ['phone'], 'product 探测');
      assertEq(findFlagValues(args, 'buildMode'), ['debug'], '默认 buildMode=debug');
    }),
  },

  {
    name: 'buildCodingHvigorArgs: forceNoDaemon → --no-daemon 且无 --incremental',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'phone' }] } }),
      );
      const args = buildCodingHvigorArgs(root, { forceNoDaemon: true });
      assertContains(args, '--no-daemon', '应 --no-daemon');
      if (args.includes('--daemon')) {
        throw new Error('不应含 --daemon');
      }
      if (args.includes('--incremental')) {
        throw new Error('装依赖后重编译不应 incremental');
      }
    }),
  },

  {
    name: 'buildCodingHvigorArgs: driver=assemble_app_project → --mode project assembleApp',
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
            cross_module_exports_file: 'index.ets',
          },
          paths: {},
          toolchain: {
            hvigor: {
              coding: { driver: 'assemble_app_project' },
            },
          },
        }),
      );

      const args = buildCodingHvigorArgs(root);
      assertEq(args[args.indexOf('--mode') + 1], 'project', 'assemble_app_project');
      assertEq(args[args.length - 1], 'assembleApp', '默认 assembleApp');
    }),
  },

  {
    name: 'buildUtHvigorArgs: DevEco 对齐 --mode module、isOhosTest=true、buildMode=test、task 后接 tuning（analyze=normal）',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'default' }] } }),
      );
      const args = buildUtHvigorArgs(root, 'FeatureAlpha', 'genOnDeviceTestHap');

      assertEq(args[args.indexOf('--mode') + 1], 'module', '--mode module');
      assertEq(findFlagValues(args, 'module'), ['FeatureAlpha@ohosTest'], 'module=@ohosTest');
      assertEq(findFlagValues(args, 'isOhosTest'), ['true'], 'isOhosTest=true');
      assertEq(findFlagValues(args, 'buildMode'), ['test'], 'buildMode=test');
      assertEq(findFlagValues(args, 'product'), ['default'], 'product 探测');

      const taskIdx = args.indexOf('genOnDeviceTestHap');
      if (taskIdx < 0) throw new Error('缺 task genOnDeviceTestHap');
      assertContains(args.slice(taskIdx + 1), '--analyze=normal', 'task 后应为 UT 默认 analyze=normal');
      assertContains(args, '--parallel', '应含 --parallel');
      assertContains(args, '--incremental', '应含 --incremental');
      assertContains(args, '--daemon', '应含 --daemon');
      assertNotContains(args, '--analyze=advanced', 'UT 默认不应沿用全局 advanced');
    }),
  },

  {
    name: 'buildModuleHapArgs(target=default): 无 --mode，仍含 assembleHap 与 product',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'phone' }] } }),
      );
      const args = buildModuleHapArgs(root, 'FeatureAlpha', 'default', 'assembleHap');
      assertNotContains(args, '--mode', 'default 模块路径不传 --mode');
      assertEq(findFlagValues(args, 'module'), ['FeatureAlpha@default'], 'module=@default');
      assertEq(findFlagValues(args, 'product'), ['phone'], 'product');
      assertEq(args[args.length - 1], 'assembleHap', 'task 最后');
    }),
  },

  {
    name: 'buildModuleHapArgs(ohosTest): 委托 buildUtHvigorArgs',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'default' }] } }),
      );
      const a = buildModuleHapArgs(root, 'X', 'ohosTest', 'genOnDeviceTestHap');
      const b = buildUtHvigorArgs(root, 'X', 'genOnDeviceTestHap');
      assertEq(a, b, 'ohosTest 应与 buildUtHvigorArgs 一致');
    }),
  },

  {
    name: 'preferredProduct 未确认不再覆盖 args；local 确认后生效（plan a7c3f9e2 t5）',
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
            cross_module_exports_file: 'index.ets',
          },
          paths: {},
          toolchain: { preferredProduct: 'mirror' },
        }),
      );

      const assembleArgs = buildAssembleAppArgs(root, 'assembleApp');
      assertEq(
        findFlagValues(assembleArgs, 'product'),
        ['default'],
        '未确认的 preferredProduct 不得冒充用户意图（单候选回落 sole_candidate）',
      );

      const utArgs = buildUtHvigorArgs(root, 'FeatureAlpha', 'genOnDeviceTestHap');
      assertEq(findFlagValues(utArgs, 'product'), ['default'], 'ohosTest 路径同源语义');

      // local 确认后（config 值 === local 确认值）→ explicit_config 生效
      writeFile(
        path.join(root, 'framework.local.json'),
        JSON.stringify(
          {
            schema_version: '1.0',
            toolchain: {
              productSelection: { confirmed: { value: 'mirror', confirmed_at: '2026-08-17T00:00:00.000Z' } },
            },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();
      const confirmedArgs = buildAssembleAppArgs(root, 'assembleApp');
      assertEq(
        findFlagValues(confirmedArgs, 'product'),
        ['mirror'],
        'config 值且 local 确认值相等 → explicit_config',
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
            cross_module_exports_file: 'index.ets',
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
    // plan c9e3f7d1 t1：config 缺省（无 toolchain.hvigor）时默认 analyze=normal（与 DevEco 对齐）
    name: 'hvigor tuning: config 缺省 → 默认 --analyze=normal（assembleApp 与 coding 两条路径）',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'build-profile.json5'),
        JSON.stringify({ app: { products: [{ name: 'product' }] } }),
      );

      const assembleArgs = buildAssembleAppArgs(root, 'assembleHap');
      assertContains(assembleArgs, '--analyze=normal', 'assembleApp 路径 config 缺省时应回退 normal');
      assertNotContains(assembleArgs, '--analyze=advanced', 'assembleApp 路径缺省时不得出现 advanced');

      const codingArgs = buildCodingHvigorArgs(root);
      assertContains(codingArgs, '--analyze=normal', 'coding 路径 config 缺省时应回退 normal');
      assertNotContains(codingArgs, '--analyze=advanced', 'coding 路径缺省时不得出现 advanced');
    }),
  },
  {
    name: 'hvigor diagnostics: 00308018 + onlineSign + analyze/daemon 给出定向提示',
    run: () => {
      const diagnostics = buildHvigorDiagnostics([
        '$ hvigor --mode module -p product=product -p buildMode=debug assembleHap --analyze=advanced --parallel --incremental --daemon',
        '> hvigor ERROR: Failed ::onlineSignApp...',
        'Error Code: 00308018 Unknown Error - Failed to find the incremental input file:',
        'D:/repo/build/product/outputs/product/demo-product-unsigned.hap',
        'Archive HAP Package task start.',
      ].join('\n'));

      assertEq(diagnostics.length, 4, '应识别增量输入缺失、onlineSign、analyze、daemon 四类提示');
      if (!diagnostics.some(d => d.includes('增量输入缺失'))) {
        throw new Error(`诊断中应包含增量输入缺失：${JSON.stringify(diagnostics)}`);
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
  {
    name: 'hvigor diagnostics: spawn java ENOENT 给出签名链 / JBR / stop-daemon 提示',
    run: () => {
      const diagnostics = buildHvigorDiagnostics([
        '> hvigor ERROR: Failed :Phone:default@PackageHap...',
        'Error Code: 00308018 Unknown Error',
        'spawn java ENOENT',
      ].join('\n'));
      if (!diagnostics.some(d => d.includes('spawn java ENOENT'))) {
        throw new Error(`应包含 java ENOENT 诊断：${JSON.stringify(diagnostics)}`);
      }
      if (!diagnostics.some(d => d.includes('stop-daemon'))) {
        throw new Error(`应提及 stop-daemon：${JSON.stringify(diagnostics)}`);
      }
    },
  },
  {
    name: 'detectSignSkip: "Will skip sign" + "No signingConfigs profile is configured" → 两标志皆 true（宿主 bc-openCard 实测日志）',
    run: () => {
      const log = [
        '> hvigor UP-TO-DATE :WalletMain:ohosTest@PackageHap...',
        "> hvigor WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured in current project.",
        '             If needed, configure the signingConfigs in build-profile.json5.',
        '> hvigor Finished :WalletMain:ohosTest@SignHap... after 2 ms',
        '> hvigor BUILD SUCCESSFUL in 449 ms',
      ].join('\n');
      const r = detectSignSkip(log);
      assertEq(r.signSkipped, true, 'signSkipped');
      assertEq(r.signingConfigMissing, true, 'signingConfigMissing');
    },
  },
  {
    name: 'detectSignSkip: 无 "Will skip sign" → 两标志皆 false（正常签名日志不误报）',
    run: () => {
      const log = [
        '> hvigor Finished :Phone:onlineSignHap... after 1 s 131 ms',
        '> hvigor Finished :Phone:product@PackingCheck... after 7 ms',
        '> hvigor BUILD SUCCESSFUL in 4 s 572 ms',
      ].join('\n');
      const r = detectSignSkip(log);
      assertEq(r.signSkipped, false, 'signSkipped 不应误报');
      assertEq(r.signingConfigMissing, false, 'signingConfigMissing 不应误报');
    },
  },
  {
    name: 'buildHvigorDiagnostics: sign-skip 日志给出定向提示，且不影响既有 00308018 规则计数',
    run: () => {
      const diagnostics = buildHvigorDiagnostics(
        "> hvigor WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured in current project.",
      );
      if (!diagnostics.some(d => d.includes('Will skip sign'))) {
        throw new Error(`诊断中应包含 Will skip sign 提示：${JSON.stringify(diagnostics)}`);
      }
      if (!diagnostics.some(d => d.includes('signingConfigs'))) {
        throw new Error(`诊断中应提及 signingConfigs 配置建议：${JSON.stringify(diagnostics)}`);
      }
      if (diagnostics.some(d => d.includes('可自动生成并持久化'))) {
        throw new Error(
          `不得承诺 DevEco 自动签名"必定持久化"（codex round5 P2；已改"不承诺特定 IDE 版本点击后必定持久化，请核实落盘结果"）：${JSON.stringify(diagnostics)}`,
        );
      }
    },
  },
  {
    name: 'buildHvigorDiagnostics: 00308018 场景（无 sign-skip 文本）不新增 sign-skip 诊断，既有计数不受影响',
    run: () => {
      const diagnostics = buildHvigorDiagnostics([
        '$ hvigor --mode module -p product=product -p buildMode=debug assembleHap --analyze=advanced --parallel --incremental --daemon',
        '> hvigor ERROR: Failed ::onlineSignApp...',
        'Error Code: 00308018 Unknown Error - Failed to find the incremental input file:',
        'D:/repo/build/product/outputs/product/demo-product-unsigned.hap',
        'Archive HAP Package task start.',
      ].join('\n'));
      assertEq(diagnostics.length, 4, '不应因新增 sign-skip 规则而多出诊断条目');
    },
  },
  {
    // plan c9e3f7d1 t2：宿主 08-13 真实失败日志切片（保留 ANSI 原文）
    // build_maison_fail.txt 实证三处 ERROR：
    //   L202  `> hvigor ^[[91mERROR: Failed :entry:product@CompileArkTS...`（失败任务）
    //   L1488 `> hvigor ^[[91mERROR: ^[[31mError Code: 00308018 Unknown Error^[[0m`（实质错误 + ets-loader 堆栈）
    //   L1501 `> hvigor ^[[91mERROR: BUILD FAILED in 55 s 595 ms^[[0m`（包装行）
    name: 'buildHvigorDiagnostics: ANSI 宿主切片 → 失败任务 entry:product@CompileArkTS 进 diagnostics（t2 a）',
    run: () => {
      const diagnostics = buildHvigorDiagnostics(HOST_FAIL_SLICE_ANSI);
      if (!diagnostics.some(d => d.includes('失败任务') && d.includes('entry:product@CompileArkTS'))) {
        throw new Error(
          `应从 ANSI 日志解析出失败任务 entry:product@CompileArkTS：${JSON.stringify(diagnostics)}`,
        );
      }
    },
  },
  {
    name: 'buildHvigorDiagnostics: 00308018 无增量正文 → 不产增量/签名/daemon 指引，只报 SDK 未知错误（t2 b）',
    run: () => {
      const diagnostics = buildHvigorDiagnostics(HOST_FAIL_SLICE_ANSI);
      if (diagnostics.some(d => d.includes('增量输入缺失'))) {
        throw new Error(`不得给增量指引：${JSON.stringify(diagnostics)}`);
      }
      if (diagnostics.some(d => d.includes('onlineSign') || d.includes('自定义签名任务'))) {
        throw new Error(`不得给签名指引：${JSON.stringify(diagnostics)}`);
      }
      if (diagnostics.some(d => d.includes('daemon'))) {
        throw new Error(`不得给 daemon 指引：${JSON.stringify(diagnostics)}`);
      }
      const unknown = diagnostics.find(d => d.includes('00308018 即 hvigor 的 Unknown Error 码'));
      if (!unknown) {
        throw new Error(`应有 SDK/hvigor 内部未知错误诊断：${JSON.stringify(diagnostics)}`);
      }
      if (!unknown.includes('isReferencedAliasDeclaration is not a function')) {
        throw new Error(`未知错误诊断应保留原始错误正文：${unknown}`);
      }
      const errors = parseBuildErrors(HOST_FAIL_SLICE_ANSI);
      const first = errors[0];
      if (!first || !first.message.includes('Error Code: 00308018 Unknown Error')) {
        throw new Error(`errors 首条应为 00308018 实质错误：${JSON.stringify(errors)}`);
      }
      if (!first.message.includes('isReferencedAliasDeclaration is not a function')) {
        throw new Error(`errors 原始正文应保留堆栈首行：${JSON.stringify(errors)}`);
      }
    },
  },
  {
    name: 'parseBuildErrors: ANSI 宿主切片 → 包装行不进 errors，首条即主错误（t2 a/c/d 防回归）',
    run: () => {
      const errors = parseBuildErrors(HOST_FAIL_SLICE_ANSI);
      if (errors.some(e => e.message.includes('BUILD FAILED'))) {
        throw new Error(`BUILD FAILED 包装行不得进 errors：${JSON.stringify(errors)}`);
      }
      if (errors.some(e => e.message.includes('Failed :'))) {
        throw new Error(`Failed : 失败任务包装行不得进 errors：${JSON.stringify(errors)}`);
      }
      assertEq(errors.length, 1, '1700WARN 场景应只解析出 1 条实质错误');
    },
  },
  {
    name: 'parseBuildErrors + buildHvigorDiagnostics: 模块/产品名含 -/.（base-common / hms.core）的失败任务仍识别且不进 errors',
    run: () => {
      // 点号模块名单独验证（plan t2④：全量日志只报首个失败任务，多行场景验证的是首条）
      const dotted = buildHvigorDiagnostics('> hvigor ERROR: Failed :hms.core:default@CompileArkTS...');
      if (!dotted.some(d => d.includes('hms.core:default@CompileArkTS'))) {
        throw new Error(`应识别点号模块名失败任务：${JSON.stringify(dotted)}`);
      }
      assertEq(parseBuildErrors('> hvigor ERROR: Failed :hms.core:default@CompileArkTS...').length, 0, '点号模块名包装行不进 errors');

      // 多行场景：任一失败任务行都不进 errors；诊断只报首个（连字符模块名）
      const log = [
        '> hvigor ERROR: Failed :base-common:product@CompileArkTS...',
        '> hvigor ERROR: Failed :hms.core:default@CompileArkTS...',
      ].join('\n');
      const errors = parseBuildErrors(log);
      assertEq(errors.length, 0, '失败任务包装行不得进 errors');
      const diagnostics = buildHvigorDiagnostics(log);
      if (!diagnostics.some(d => d.includes('base-common:product@CompileArkTS'))) {
        throw new Error(`应识别连字符模块名失败任务：${JSON.stringify(diagnostics)}`);
      }
    },
  },
  {
    name: 'parseBuildErrors: 正文含 "Failed:" 的真实错误不被吞（签名/编译器消息），errors 逐条保留',
    run: () => {
      const log = [
        '> hvigor ERROR: Error Message: Failed: cannot resolve symbol',
        'ERROR: Failed: cannot open signing profile',
        'ArkTS:ERROR File: a.ets:1:2 Build Failed: bad token',
      ].join('\n');
      const errors = parseBuildErrors(log);
      assertEq(errors.length, 3, `三条真实错误均应保留（不得被包装行排除吞掉）：${JSON.stringify(errors)}`);
      if (!errors.some(e => e.message.includes('cannot open signing profile'))) {
        throw new Error(`签名消息应进 errors：${JSON.stringify(errors)}`);
      }
      if (!errors.some(e => e.message.includes('bad token'))) {
        throw new Error(`ArkTS 错误应进 errors：${JSON.stringify(errors)}`);
      }
    },
  },
  {
    name: 'buildHvigorDiagnostics: Failed to find the incremental input file 仍走原增量分支（t2 c 防回归）',
    run: () => {
      const diagnostics = buildHvigorDiagnostics([
        '> hvigor ERROR: Failed :entry:product@CompileArkTS...',
        'Error Code: 00308018 Unknown Error - Failed to find the incremental input file:',
        'D:/repo/build/product/outputs/product/demo-product-unsigned.hap',
      ].join('\n'));
      if (!diagnostics.some(d => d.includes('增量输入缺失'))) {
        throw new Error(`正文命中时仍应走增量分支：${JSON.stringify(diagnostics)}`);
      }
      if (diagnostics.some(d => d.includes('00308018 即 hvigor 的 Unknown Error 码'))) {
        throw new Error(`正文命中时不得额外给未知错误诊断：${JSON.stringify(diagnostics)}`);
      }
      if (!diagnostics.some(d => d.includes('失败任务') && d.includes('entry:product@CompileArkTS'))) {
        throw new Error(`失败任务诊断仍应给出：${JSON.stringify(diagnostics)}`);
      }
    },
  },
  {
    name: 'ensureFailedAtStageTag: errors 为空 → 合成一条"失败阶段：<X>"（既有行为不破）',
    run: () => {
      const result = ensureFailedAtStageTag([], 'hap_not_found');
      assertEq(result.length, 1, '应合成一条');
      assertEq(result[0]!.message, '失败阶段：hap_not_found', '内容应为标准前缀+X');
    },
  },
  {
    name: 'ensureFailedAtStageTag: errors 非空但均无"失败阶段："前缀 → 前插标签，保留原诊断（codex round5 P1）',
    run: () => {
      const richDiagnostic = 'ohosTest HAP 已构建但未发现对应 signed HAP。hvigor 明确报告 signingConfigs 未配置。';
      const result = ensureFailedAtStageTag([{ message: richDiagnostic }], 'hap_not_found');
      assertEq(result.length, 2, '应前插而非替换，原诊断不丢失');
      assertEq(result[0]!.message, '失败阶段：hap_not_found', '标签应在最前，供 ut-host-impl.ts 的 stageHint 检测命中');
      assertEq(result[1]!.message, richDiagnostic, '原始诊断消息应保留在数组中');
    },
  },
  {
    name: 'ensureFailedAtStageTag: 已有"失败阶段："前缀（哪怕内容更细粒度如 device_locked）→ 不重复插入、不丢失细粒度诊断',
    run: () => {
      const specific = '失败阶段：device_locked；设备已连接但锁屏。';
      const result = ensureFailedAtStageTag([{ message: specific }], 'run');
      assertEq(result.length, 1, '不应额外前插粗粒度 "失败阶段：run"，避免覆盖细粒度诊断');
      assertEq(result[0]!.message, specific, 'stageHint 检测应仍命中原有细粒度消息（含 device_locked）');
    },
  },
  {
    name: 'ensureFailedAtStageTag: failedAt 为 undefined → errors 原样返回',
    run: () => {
      const original = [{ message: 'x' }];
      const result = ensureFailedAtStageTag(original, undefined);
      assertEq(result, original, 'failedAt 缺失时不应合成/修改');
    },
  },
  {
    name: 'buildOnDeviceSignDiagnosis: 正确把 buildRes 字段 + mainAppSignedPath 组装进 signDiagnosis（cursor round5 minor：接线单测）',
    run: () => {
      const diag = buildOnDeviceSignDiagnosis(
        { signSkipped: true, signingConfigMissing: true },
        '/x/Phone-product-signed.hap',
      );
      assertEq(diag.signSkipped, true, 'signSkipped 应透传');
      assertEq(diag.signingConfigMissing, true, 'signingConfigMissing 应透传');
      assertEq(diag.mainAppSignedPath, '/x/Phone-product-signed.hap', 'mainAppSignedPath 应透传');
    },
  },
  {
    name: 'buildOnDeviceSignDiagnosis: buildRes 字段缺失时透传 undefined（不臆造 false）',
    run: () => {
      const diag = buildOnDeviceSignDiagnosis({}, null);
      assertEq(diag.signSkipped, undefined, 'signSkipped 缺失时应为 undefined，不应臆造 false');
      assertEq(diag.signingConfigMissing, undefined, 'signingConfigMissing 缺失时应为 undefined');
      assertEq(diag.mainAppSignedPath, null, 'mainAppSignedPath 应透传 null');
    },
  },
  {
    name: 'buildOnDeviceFailureEvidence: failedAt/unsigned/sign flags/install+runDiagnosis 六项保真',
    run: () => {
      const evidence = buildOnDeviceFailureEvidence(
        { signSkipped: true, signingConfigMissing: true },
        {
          failedAt: 'install',
          unsignedPresent: true,
          install: {
            ok: false,
            exitCode: 1,
            durationMs: 12,
            output: 'fail',
            diagnosis: {
              kind: 'install_signature_mismatch',
              summary: '签名不一致',
              suggestion: '卸载旧包或使用一致签名',
            },
          },
          // t1（openspec device-readiness-and-completion）：aa test 诊断须结构化透传，
          // 否则下游只能靠 errors 散文子串判 device_locked（脆弱且无法参与机器判定）。
          aaTest: {
            ok: false,
            exitCode: 1,
            durationMs: 30,
            output: 'screen is locked',
            diagnosis: {
              kind: 'device_locked',
              summary: '屏幕锁定',
              suggestion: '请人解锁真机',
            },
          },
        },
      );
      assertEq(evidence.failedAt, 'install', 'failedAt 应透传');
      assertEq(evidence.unsignedPresent, true, 'unsignedPresent 应透传');
      assertEq(evidence.signSkipped, true, 'signSkipped 应透传');
      assertEq(evidence.signingConfigMissing, true, 'signingConfigMissing 应透传');
      assertEq(evidence.installDiagnosis?.summary, '签名不一致', 'installDiagnosis 应透传');
      assertEq(evidence.runDiagnosis?.kind, 'device_locked', 'runDiagnosis 应透传');
    },
  },
  {
    name: 'buildOnDeviceFailureEvidence: 缺失值保持 undefined，install 无 diagnosis 不臆造',
    run: () => {
      const evidence = buildOnDeviceFailureEvidence(
        {},
        {
          install: { ok: false, exitCode: 7, durationMs: 12, output: 'failed' },
        },
      );
      assertEq(evidence.failedAt, undefined, 'failedAt 不臆造');
      assertEq(evidence.unsignedPresent, undefined, 'unsignedPresent 不臆造');
      assertEq(evidence.signSkipped, undefined, 'signSkipped 不臆造');
      assertEq(evidence.signingConfigMissing, undefined, 'signingConfigMissing 不臆造');
      assertEq(evidence.installDiagnosis, undefined, 'installDiagnosis 不臆造');
      assertEq(evidence.runDiagnosis, undefined, 'runDiagnosis 不臆造');
    },
  },
  {
    name: 'project dependency issue: Failed to resolve OhmUrl 识别依赖缺失与安装建议',
    run: () => withTmpDir(root => {
      writeFile(path.join(root, 'oh-package.json5'), [
        '{',
        '  "dependencies": {',
        '    "@hms-network/url": "file:../mock"',
        '  }',
        '}',
      ].join('\n'));
      const issue = analyzeProjectDependencyIssue(root, [
        '1 ERROR: 10311002 ArkTS: ERROR',
        'Failed to resolve OhmUrl @hms-network/url/src/network/restclient/RequestOption',
        'Failed to resolve OhmUrl @hms-security/agoh-crypto/src/main/ets/d/crypto/v1/w1',
      ].join('\n'));
      assertEq(issue.found, true, '应识别依赖解析失败');
      assertEq(issue.dependencies, ['@hms-network/url', '@hms-security/agoh-crypto'], '应归一化依赖包名');
      assertEq(issue.missingDeclarations, ['@hms-security/agoh-crypto'], '应识别未声明依赖');
      if (!issue.installHints.some(h => h.includes('ohpm install'))) {
        throw new Error(`应给出 ohpm install 建议：${JSON.stringify(issue.installHints)}`);
      }
    }),
  },
  {
    name: 'analyzeProjectDependencyIssue: logAbsPath 大文件合并分析（不只看 logExcerpt）',
    run: () => withTmpDir(root => {
      const logPath = path.join(root, 'hv.log');
      const pad = 'x'.repeat(60_000);
      fs.writeFileSync(
        logPath,
        `${pad}\nFailed to resolve OhmUrl @my-scope/my-lib/src/main\n`,
        'utf-8',
      );
      const issue = analyzeProjectDependencyIssue(root, {
        logExcerpt: 'too short',
        errors: [],
        logAbsPath: logPath,
      });
      assertEq(issue.found, true, '应识别依赖解析失败');
      if (!issue.dependencies.includes('@my-scope/my-lib')) {
        throw new Error(`应解析出 @my-scope/my-lib：${JSON.stringify(issue.dependencies)}`);
      }
    }),
  },
  {
    // 根因 A 回归：路径碎片（.ohpm/@<版本>/oh_modules）只出现在构建进度行、不在解析失败行 →
    // 不得被误抓成依赖；且无真实失败信号时 found=false（不误判依赖问题）。
    name: 'analyzeProjectDependencyIssue(A): 路径碎片/版本目录不入 deps，无失败信号 found=false',
    run: () => withTmpDir(root => {
      const log = [
        '> hvigor building module FinancialCard...',
        'resolving oh_modules/.ohpm/@1.0.0-301/oh_modules/xxx/index.ets',
        'copy node_modules/@14.18.3-302/oh_modules/foo',
        'CardLifecycle.ets:59 Unexpected token (Note that you need plugins to import files that are not JavaScript)',
      ].join('\n');
      const issue = analyzeProjectDependencyIssue(root, log);
      assertEq(issue.found, false, '仅提及 oh_modules 路径 + 真实语法错，不该判依赖问题');
      assertEq(issue.dependencies, [], '路径碎片不得被当依赖名');
      assertEq(issue.missingDeclarations, [], '不得产出垃圾未声明依赖');
    }),
  },
  {
    // 根因 A.2/A.3 回归：真实失败行里的版本碎片被丢、点分 SDK 命名空间被丢、
    // 但连字符 vendor 包（@hms-*）保留为真实缺声明。
    name: 'analyzeProjectDependencyIssue(A): 失败行内过滤版本碎片/点分SDK，保留 vendor 包',
    run: () => withTmpDir(root => {
      const log = [
        'Failed to resolve OhmUrl @1.0.0-301/oh_modules/x',
        'Failed to resolve OhmUrl @ohos.multimedia/image/index',
        'Failed to resolve OhmUrl @kit.ArkUI/x/y',
        'Failed to resolve OhmUrl @hms-security/agoh-crypto/src/main/ets',
      ].join('\n');
      const issue = analyzeProjectDependencyIssue(root, log);
      assertEq(issue.found, true, '有真实解析失败信号');
      assertEq(issue.dependencies, ['@hms-security/agoh-crypto'], '只保留可声明的 vendor 包');
      assertEq(issue.missingDeclarations, ['@hms-security/agoh-crypto'], 'SDK/碎片不得进未声明清单');
    }),
  },
  {
    name: 'analyzeProjectDependencyIssue: external frameworkRoot 不 infer projectRoot',
    run: () => {
      const host = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-ext-'));
      const issue = analyzeProjectDependencyIssue(
        host,
        'Failed to resolve OhmUrl @hms-network/url/src/network/restclient/RequestOption',
        DEFAULT_LAYOUT.frameworkRoot,
      );
      assertEq(issue.found, true, '应识别依赖解析失败');
      const expectedHarnessReady = fs.existsSync(
        path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness', 'node_modules', 'ts-node', 'package.json'),
      );
      assertEq(issue.harnessNodeModulesReady, expectedHarnessReady, 'harness 依赖应按 frameworkRoot 判定');
    },
  },
  {
    name: 'looksLikeUtHvigorCommandMismatch: isOhosTest=false + genOnDeviceTestHap → true',
    run: () => {
      const log = '$ hvigorw.bat -p module=M@ohosTest genOnDeviceTestHap\nenableX: false, isOhosTest: false\n';
      if (!looksLikeUtHvigorCommandMismatch(log)) {
        throw new Error('应识别命令不对齐');
      }
    },
  },
  {
    name: 'looksLikeUtHvigorCommandMismatch: genOnDeviceTestHap 但无 --mode module → true',
    run: () => {
      const log = '$ hvigorw.bat -p module=M@ohosTest genOnDeviceTestHap\n';
      if (!looksLikeUtHvigorCommandMismatch(log)) {
        throw new Error('缺少 --mode module 应判为不对齐');
      }
    },
  },
  {
    name: 'looksLikeUtHvigorCommandMismatch: 已对齐的摘录 → false',
    run: () => {
      const log = [
        '$ node hvigorw.js --mode module -p module=M@ohosTest -p isOhosTest=true -p buildMode=test genOnDeviceTestHap',
        'isOhosTest: true',
      ].join('\n');
      if (looksLikeUtHvigorCommandMismatch(log)) {
        throw new Error('不应误判已对齐命令');
      }
    },
  },
  {
    // plan 423e5d0f P0：宿主实录形态（含 ANSI 转义也须命中）
    name: 'detectHvigorTaskNotFound: 命中宿主实录形态',
    run: () => {
      const hit = detectHvigorTaskNotFound(
        "ERROR: Task 'genOnDeviceTestHap' was not found in project phone.\n",
      );
      assertEq(hit?.task, 'genOnDeviceTestHap', '应抽出 task 名');
      const ansi = detectHvigorTaskNotFound(
        "[91mERROR: [31mTask 'genOnDeviceTestHap' was not found[0m",
      );
      assertEq(ansi?.task, 'genOnDeviceTestHap', 'ANSI 日志也应命中');
      const miss = detectHvigorTaskNotFound('ArkTS:ERROR File: x.ets:31:9 arkts-no-method-reassignment');
      assertEq(miss, null, '普通编译错误不得误判');
    },
  },
  {
    name: 'moduleDeclaresOhosTestTarget: 三态（有/无/不可判定）',
    run: () => withTmpDir(root => {
      fs.writeFileSync(
        path.join(root, 'build-profile.json5'),
        [
          '{',
          '  // 工程根 build-profile（含注释与尾逗号，考验 JSON5 容错）',
          '  "modules": [',
          '    { "name": "LifecycleFramework", "srcPath": "./03/L", "targets": [ { "name": "default" }, { "name": "ohosTest" }, ] },',
          '    { "name": "phone", "srcPath": "./01/phone", "targets": [ { "name": "default" } ] },',
          '  ],',
          '}',
        ].join('\n'),
        'utf-8',
      );
      assertEq(moduleDeclaresOhosTestTarget(root, 'LifecycleFramework'), true, '已注册 ohosTest');
      assertEq(moduleDeclaresOhosTestTarget(root, 'phone'), false, '未注册 ohosTest');
      assertEq(moduleDeclaresOhosTestTarget(root, 'NoSuchModule'), undefined, '模块未列出 → 不可判定');
    }),
  },
  {
    name: 'sanitizeLogModuleName: 模块名消毒',
    run: () => {
      assertEq(sanitizeLogModuleName('LifecycleFramework'), 'LifecycleFramework', '常规名不变');
      assertEq(sanitizeLogModuleName('a/b\\c d'), 'a_b_c_d', '路径分隔与空格转下划线');
      assertEq(sanitizeLogModuleName(''), 'module', '空名兜底');
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
