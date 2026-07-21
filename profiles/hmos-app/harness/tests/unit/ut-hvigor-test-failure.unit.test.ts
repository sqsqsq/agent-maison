import * as fs from 'fs';
import * as path from 'path';
import {
  buildCompactDiagnosticHeader,
  buildUtHvigorTestFailDetails,
} from '../../ut-hvigor-test-failure';
import type { HvigorRunResult, OnDeviceFailureEvidence } from '../../hvigor-runner';
import { buildSummaryBlockers } from '../../../../../harness/scripts/utils/summary-blockers';
import { extractPriorFailureContext } from '../../../../../harness/scripts/goal-runner';
import type { CheckResult } from '../../../../../harness/scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function result(
  evidence?: OnDeviceFailureEvidence,
  overrides: Partial<HvigorRunResult> = {},
): HvigorRunResult {
  return {
    executed: false,
    durationMs: 1,
    logExcerpt: 'BUILD SUCCESSFUL\n[log-marker] tail',
    errors: [{ message: '失败阶段：hap_not_found' }, { message: '分层签名诊断全文' }],
    onDeviceFailureEvidence: evidence,
    ...overrides,
  };
}

function firstLine(output: ReturnType<typeof buildUtHvigorTestFailDetails>): string {
  return output.lines[0] ?? '';
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// post-impl review P2#8（plan 7c4f2e9b）：诊断链验证面拆两半——toolchain_blocked 类
// blocker 的诊断存活面在 **summary blocker excerpt**（operator/halt guidance 消费），
// agent 重试回喂只保留 parked 行（agent 修不了环境，喂诊断只会诱导它「修环境」）。
function priorContext(output: ReturnType<typeof buildUtHvigorTestFailDetails>): { prior: string; excerpt: string } {
  const check: CheckResult = {
    id: 'ut_hvigor_test',
    category: 'structure',
    description: 'UT 真机执行',
    severity: 'BLOCKER',
    status: 'FAIL',
    details: output.lines.join('\n'),
    suggestion: output.suggestion,
    affected_files: output.affectedFiles,
    failure_kind: output.failureKind,
    blocking_class: output.blockingClass,
  };
  const blockers = buildSummaryBlockers(
    [check],
    (text, max) => (text.length > max ? text.slice(0, max) : text),
    () => undefined,
  );
  return {
    prior: extractPriorFailureContext({ verdict: 'FAIL', blockers } as any),
    excerpt: blockers[0]?.details_excerpt ?? '',
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'hap_not_found configMissing+unsigned: 诊断首行完整、errors 在日志前、旧措辞消失',
    run: () => {
      const output = buildUtHvigorTestFailDetails([
        {
          module: 'FeatureA',
          result: result({
            failedAt: 'hap_not_found',
            unsignedPresent: true,
            signSkipped: true,
            signingConfigMissing: true,
          }),
        },
      ]);
      const header = firstLine(output);
      const details = output.lines.join('\n');
      assert(header.includes('signingConfigs 未配置'), header);
      assert(header.includes('自定义签名任务覆盖 ohosTest'), header);
      assert(header.includes('仅产出 unsigned HAP'), header);
      assert(header.length <= 180, `首行过长：${header.length}`);
      assert(details.indexOf('分层签名诊断全文') < details.indexOf('[log-marker]'), '诊断必须在日志前');
      assert(!details.includes('原因：hvigor / hdc 未执行'), '旧误导措辞必须移除');
      assertEq(count(details, '失败阶段：hap_not_found'), 1, 'stageHint 不应重复');
      assertEq(output.blockingClass, 'device_toolchain', 'blockingClass');
      assertEq(output.failureKind, 'ohos_test_sign_gap', 'failureKind');
    },
  },
  {
    name: '签名摘要证据矩阵：skip+config / signSkipped-only / unsigned-only / config-only / 全无',
    run: () => {
      const skipAndConfig = firstLine(
        buildUtHvigorTestFailDetails([
          {
            module: 'A',
            result: result({
              failedAt: 'hap_not_found',
              signSkipped: true,
              signingConfigMissing: true,
            }),
          },
        ]),
      );
      assert(skipAndConfig.includes('signingConfigs 未配置'), skipAndConfig);
      assert(!skipAndConfig.includes('unsigned HAP'), skipAndConfig);

      const skip = firstLine(
        buildUtHvigorTestFailDetails([
          { module: 'A', result: result({ failedAt: 'hap_not_found', signSkipped: true }) },
        ]),
      );
      assert(skip.includes('明确跳过签名'), skip);
      assert(!skip.includes('signingConfigs 未配置'), skip);
      assert(!skip.includes('unsigned HAP'), skip);

      const unsigned = firstLine(
        buildUtHvigorTestFailDetails([
          { module: 'A', result: result({ failedAt: 'hap_not_found', unsignedPresent: true }) },
        ]),
      );
      assert(unsigned.includes('原因未知'), unsigned);
      assert(unsigned.includes('仅产出 unsigned HAP'), unsigned);

      const config = firstLine(
        buildUtHvigorTestFailDetails([
          { module: 'A', result: result({ failedAt: 'hap_not_found', signingConfigMissing: true }) },
        ]),
      );
      assert(config.includes('signingConfigs 未配置'), config);
      assert(!config.includes('unsigned HAP'), config);

      const unknown = firstLine(
        buildUtHvigorTestFailDetails([
          { module: 'A', result: result({ failedAt: 'hap_not_found' }) },
        ]),
      );
      assert(unknown.includes('signed/unsigned 均未见'), unknown);
      assert(unknown.includes('不推断签名原因'), unknown);
    },
  },
  {
    name: 'install 首行只消费 installDiagnosis，unsigned 同时存在也不归因签名',
    run: () => {
      const output = buildUtHvigorTestFailDetails([
        {
          module: 'A',
          result: result(
            {
              failedAt: 'install',
              unsignedPresent: true,
              installDiagnosis: {
                kind: 'install_conflict',
                summary: '设备上已有冲突包',
                suggestion: '卸载冲突包后重试',
              },
            },
            { executed: true, exitCode: 1, errors: [{ message: '失败阶段：install' }] },
          ),
        },
      ]);
      const header = firstLine(output);
      assert(header.includes('安装阶段失败：设备上已有冲突包'), header);
      assert(!header.includes('签名环境缺口'), header);
      assert(!header.includes('unsigned'), header);
      assertEq(output.failureKind, 'device_install_failed', 'install kind');
    },
  },
  {
    name: '工具链四 kind 正例与 stageHint 文本兜底负例',
    run: () => {
      const entries: Array<[HvigorRunResult, string]> = [
        [result(undefined, { toolMissing: true }), 'device_tool_missing'],
        [result({ failedAt: 'hap_not_found', signSkipped: true }), 'ohos_test_sign_gap'],
        [result({ failedAt: 'hap_not_found' }), 'ohos_test_hap_missing'],
        [result({ failedAt: 'install' }, { executed: true, exitCode: 1 }), 'device_install_failed'],
      ];
      for (const [value, expected] of entries) {
        const output = buildUtHvigorTestFailDetails([{ module: 'A', result: value }]);
        assertEq(output.blockingClass, 'device_toolchain', `${expected} blocking`);
        assertEq(output.failureKind, expected, `${expected} kind`);
      }
      const toolMissing = buildUtHvigorTestFailDetails([
        { module: 'A', result: result(undefined, { toolMissing: true }) },
      ]);
      const toolMissingDetails = toolMissing.lines.join('\n');
      assert(toolMissingDetails.includes('framework.local.json > toolchain.devEcoStudio'), toolMissingDetails);
      assert(!toolMissingDetails.includes('framework.config.json'), toolMissingDetails);
      assert(toolMissing.suggestion.includes('framework.local.json'), toolMissing.suggestion);

      const textOnly = buildUtHvigorTestFailDetails([
        { module: 'A', result: result(undefined) },
      ]);
      assertEq(textOnly.blockingClass, undefined, 'stageHint 不得参与分类');
      assertEq(textOnly.failureKind, undefined, 'stageHint 不得合成 kind');
    },
  },
  {
    name: '普通 no_pass/run/metadata 保持 code 失败语义和既有首行',
    run: () => {
      const noPass = result(
        { failedAt: 'no_pass' },
        {
          executed: true,
          exitCode: 1,
          testResult: { total: 1, passed: 0, failed: 1, skipped: 0, failures: [] },
          errors: [{ message: '失败阶段：no_pass' }],
        },
      );
      const output = buildUtHvigorTestFailDetails([{ module: 'Biz', result: noPass }]);
      assertEq(firstLine(output), 'ohosTest 模块 "Biz" 装机执行失败：', '普通失败首行');
      assertEq(output.blockingClass, undefined, 'no_pass 不得标 toolchain');
      for (const failedAt of ['run', 'metadata'] as const) {
        const value = buildUtHvigorTestFailDetails([
          { module: 'Biz', result: result({ failedAt }, { executed: true, exitCode: 1 }) },
        ]);
        assertEq(value.blockingClass, undefined, `${failedAt} 不得标 toolchain`);
      }
    },
  },
  {
    name: '多模块聚合：混合不打标；全工具链同构/异构按契约产出 kind',
    run: () => {
      const gap = result({ failedAt: 'hap_not_found', signingConfigMissing: true });
      const noPass = result(
        { failedAt: 'no_pass' },
        { executed: true, exitCode: 1, testResult: { total: 1, passed: 0, failed: 1, skipped: 0, failures: [] } },
      );
      const mixed = buildUtHvigorTestFailDetails([
        { module: 'A', result: gap },
        { module: 'B', result: noPass },
      ]);
      assert(firstLine(mixed).startsWith('多模块失败性质不同'), firstLine(mixed));
      assertEq(mixed.blockingClass, undefined, '混合不打标');
      assertEq(mixed.failureKind, undefined, '混合无顶层 kind');
      assert(mixed.suggestion.startsWith('多模块失败性质不同，勿按单一原因处理'), mixed.suggestion);

      const same = buildUtHvigorTestFailDetails([
        { module: 'A', result: gap },
        { module: 'B', result: result({ failedAt: 'hap_not_found', signSkipped: true }) },
      ]);
      assertEq(same.blockingClass, 'device_toolchain', '同构 toolchain 打标');
      assertEq(same.failureKind, 'ohos_test_sign_gap', '同 kind 聚合');
      assert(firstLine(same).includes('均为 ohosTest 签名缺口'), firstLine(same));
      assert(!firstLine(same).includes('signingConfigs 未配置'), '不得推广首模块具体原因');

      const differentKinds = buildUtHvigorTestFailDetails([
        { module: 'A', result: gap },
        { module: 'B', result: result({ failedAt: 'hap_not_found' }) },
      ]);
      assertEq(differentKinds.blockingClass, 'device_toolchain', '同 failedAt 异 kind 仍打标');
      assertEq(differentKinds.failureKind, undefined, '同 failedAt 异 kind 无顶层 kind');
      assert(firstLine(differentKinds).startsWith('多模块工具链失败'), firstLine(differentKinds));
      assert(firstLine(differentKinds).includes('ohos_test_sign_gap'), firstLine(differentKinds));
      assert(firstLine(differentKinds).includes('ohos_test_hap_missing'), firstLine(differentKinds));
      assert(!firstLine(differentKinds).includes('signingConfigs 未配置'), '不得推广首模块具体原因');

      const heterogeneous = buildUtHvigorTestFailDetails([
        { module: 'A', result: gap },
        { module: 'B', result: result({ failedAt: 'install' }, { executed: true, exitCode: 1 }) },
      ]);
      assertEq(heterogeneous.blockingClass, 'device_toolchain', '异构 toolchain 仍打标');
      assertEq(heterogeneous.failureKind, undefined, '异构无顶层 kind');
      assert(firstLine(heterogeneous).startsWith('多模块工具链失败'), firstLine(heterogeneous));
    },
  },
  {
    name: 'installBlocking 聚合：单模块保兼容、与 sign_gap 共存不误归 code、与 no_pass 共存不掩盖',
    run: () => {
      const externalBlocked = {
        kind: 'externalBlocked' as const,
        details: '设备在模块执行之间离线',
        partialReadinessReason: 'compile_passed_device_blocked' as const,
        nextAction: 'device_ready_then_rerun_ut',
        hdcPresent: true,
        deviceAvailable: false,
      };
      const externalResult = () =>
        result(undefined, {
          installBlocking: externalBlocked,
          errors: [{ message: '失败阶段：install_preflight (externalBlocked)' }],
        });
      const single = buildUtHvigorTestFailDetails([
        { module: 'A', result: externalResult() },
      ]);
      assertEq(single.blockingClass, 'externalBlocked', '单模块 installBlocking 保持既有 class');
      assertEq(single.failureKind, 'device_blocked', '单模块 installBlocking 保持既有 kind');
      assert(firstLine(single).startsWith('装机预检阻塞'), firstLine(single));

      const withSignGap = buildUtHvigorTestFailDetails([
        {
          module: 'SignGap',
          result: result({ failedAt: 'hap_not_found', signingConfigMissing: true }),
        },
        {
          module: 'Offline',
          result: externalResult(),
        },
      ]);
      assertEq(withSignGap.blockingClass, 'device_toolchain', '纯环境/工具链混合不得落 code_regression');
      assertEq(withSignGap.failureKind, undefined, '异构环境阻塞不推广单一 kind');
      assertEq(withSignGap.affectedFiles.length, 2, 'affected_files 覆盖全部失败模块');
      const details = withSignGap.lines.join('\n');
      assert(details.includes('signingConfigs 未配置'), details);
      assert(details.includes('设备在模块执行之间离线'), details);

      const noPass = result(
        { failedAt: 'no_pass' },
        {
          executed: true,
          exitCode: 1,
          testResult: { total: 1, passed: 0, failed: 1, skipped: 0, failures: [] },
        },
      );
      const withCodeFailure = buildUtHvigorTestFailDetails([
        { module: 'Offline', result: externalResult() },
        { module: 'NoPass', result: noPass },
      ]);
      assertEq(withCodeFailure.blockingClass, undefined, '真实 no_pass 共存时不得被环境类掩盖');
      assertEq(withCodeFailure.failureKind, undefined, '混合失败无顶层 kind');
    },
  },
  {
    name: '紧凑首行：长 install summary/模块名 单行≤180 且保留等 X 个模块',
    run: () => {
      const compact = buildCompactDiagnosticHeader(`a\n${'b'.repeat(300)}`);
      assert(!compact.includes('\n'), compact);
      assert(compact.length <= 180, `compact=${compact.length}`);
      const longName = 'Module-' + 'x'.repeat(120);
      const output = buildUtHvigorTestFailDetails([
        { module: longName + '1', result: result({ failedAt: 'hap_not_found' }) },
        { module: longName + '2', result: result({ failedAt: 'install' }, { executed: true }) },
        { module: longName + '3', result: result(undefined, { toolMissing: true }) },
      ]);
      const header = firstLine(output);
      assert(header.length <= 180, `header=${header.length}`);
      assert(header.includes('等 1 个模块'), header);
    },
  },
  {
    name: '生产截断链 800→300：单模块、混合/异构多模块与 install 诊断头均存活',
    run: () => {
      const signed = buildUtHvigorTestFailDetails([
        {
          module: 'A',
          result: result({
            failedAt: 'hap_not_found',
            unsignedPresent: true,
            signingConfigMissing: true,
          }),
        },
      ]);
      // 诊断在 operator 面（excerpt）存活；agent 回喂只见 parked 行（P2#8 新契约）
      const signedCtx = priorContext(signed);
      assert(signedCtx.excerpt.includes('signingConfigs 未配置'), signedCtx.excerpt);
      assert(signedCtx.excerpt.includes('自定义签名任务覆盖 ohosTest'), signedCtx.excerpt);
      assert(/parked, environment\/toolchain/.test(signedCtx.prior), signedCtx.prior);
      assert(!signedCtx.prior.includes('signingConfigs 未配置'), signedCtx.prior);

      const unknown = priorContext(
        buildUtHvigorTestFailDetails([
          { module: 'A', result: result({ failedAt: 'hap_not_found' }) },
        ]),
      );
      assert(!unknown.excerpt.includes('signingConfigs 未配置'), unknown.excerpt);

      const noPass = result(
        { failedAt: 'no_pass' },
        {
          executed: true,
          exitCode: 1,
          testResult: { total: 1, passed: 0, failed: 1, skipped: 0, failures: [] },
        },
      );
      const mixed = priorContext(
        buildUtHvigorTestFailDetails([
          {
            module: 'SignGap',
            result: result({ failedAt: 'hap_not_found', signingConfigMissing: true }),
          },
          { module: 'NoPass', result: noPass },
        ]),
      );
      assert(mixed.excerpt.includes('多模块失败性质不同'), mixed.excerpt);

      const heterogeneous = priorContext(
        buildUtHvigorTestFailDetails([
          {
            module: 'SignGap',
            result: result({ failedAt: 'hap_not_found', signSkipped: true }),
          },
          {
            module: 'Install',
            result: result({ failedAt: 'install' }, { executed: true, exitCode: 1 }),
          },
        ]),
      );
      assert(heterogeneous.excerpt.includes('多模块工具链失败'), heterogeneous.excerpt);
      assert(heterogeneous.excerpt.includes('device_install_failed'), heterogeneous.excerpt);

      const install = priorContext(
        buildUtHvigorTestFailDetails([
          {
            module: 'Install',
            result: result(
              {
                failedAt: 'install',
                unsignedPresent: true,
                installDiagnosis: {
                  kind: 'install_conflict',
                  summary: '设备上已有冲突包',
                  suggestion: '卸载冲突包后重试',
                },
              },
              { executed: true, exitCode: 1, errors: [{ message: '失败阶段：install' }] },
            ),
          },
        ]),
      );
      assert(install.excerpt.includes('安装阶段失败：设备上已有冲突包'), install.excerpt);
      assert(!install.excerpt.includes('签名环境缺口'), install.excerpt);
    },
  },
  {
    name: '接线回归：诊断 helper 只接入 checkUtHvigorTest，不得污染 ut_hvigor_build',
    run: () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../../ut-host-impl.ts'), 'utf-8');
      const buildStart = source.indexOf('function checkUtHvigorBuild(');
      const testStart = source.indexOf('function checkUtHvigorTest(');
      const nextAfterTest = source.indexOf('function checkTestRegistration(', testStart);
      const buildBlock = source.slice(buildStart, testStart);
      const testBlock = source.slice(testStart, nextAfterTest);
      assert(!buildBlock.includes('buildUtHvigorTestFailDetails'), 'build 分支不得调用 test helper');
      assert(testBlock.includes('buildUtHvigorTestFailDetails(bad)'), 'test 分支必须调用聚合 helper');
      assert(!testBlock.includes('const first = bad[0].result'), 'test 分支不得恢复 installBlocking first-only');
      assert(testBlock.includes("id: 'ut_hvigor_test'"), 'test 分支 id 不得串线');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(test => {
    try {
      test.run();
      return { name: test.name, ok: true };
    } catch (error) {
      return { name: test.name, ok: false, error: (error as Error).message };
    }
  });
}

if (require.main === module) {
  const results = runAll();
  results.forEach(item => console.log(item.ok ? `PASS ${item.name}` : `FAIL ${item.name}: ${item.error}`));
  process.exit(results.every(item => item.ok) ? 0 : 1);
}
