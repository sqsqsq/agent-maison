import {
  buildUtInstallBlockingCheckDetails,
  mapInstallBlockingToUtCheckFields,
} from './device-install-diag';
import type { HvigorRunResult } from './hvigor-runner';

export type UtHvigorTestFailureKind =
  | 'device_tool_missing'
  | 'ohos_test_sign_gap'
  | 'ohos_test_hap_missing'
  | 'device_install_failed'
  /** 运行期 hdc install 才识别出的版本降级（预检漏判路径）——须走用户确认，不得压成通用安装失败 */
  | 'install_needs_confirmation';

export interface UtHvigorTestFailureModule {
  module: string;
  result: HvigorRunResult;
}

export interface UtHvigorTestFailDetails {
  lines: string[];
  blockingClass?: string;
  failureKind?: string;
  suggestion: string;
  affectedFiles: string[];
}

interface ClassifiedFailure extends UtHvigorTestFailureModule {
  toolchain: boolean;
  phase: string;
  failureKind?: UtHvigorTestFailureKind;
  /**
   * t1（openspec device-readiness-and-completion）：设备环境阻断（当前唯一来源=运行期锁屏）。
   * **与 `toolchain` 正交**——锁屏不是工具链缺失，归 `device_toolchain` 会误导"修工具链"，
   * 而留在默认分支（`toolchain:false`）又会让上层 goal-failure-classifier 兜底成
   * `code_regression`（须改码、可重试）。故单列一维，聚合时映射到既有
   * `externalBlocked`/`device_blocked` 契约（DEFAULT_DEPENDENCY_POLICY 的可 defer 集合）。
   */
  deviceBlocked?: boolean;
  /** 设备阻断的精确子类（仅供人读的 details，**不进 summary 顶层**——schema 为 additionalProperties:false） */
  deviceSubkind?: string;
}

/** 运行期设备阻断诊断族：目前只有锁屏；新增前须确认其语义确为"人修环境即可解除、改码无用"。 */
const DEVICE_BLOCKING_RUN_DIAGNOSIS_KINDS: ReadonlySet<string> = new Set(['device_locked']);

// t6（plan e6a3c9f4）：实现移至共享 diagnostic-header.ts（hvigor build 链共同消费，
// 避免 hvigor-runner 反向依赖本 UT 聚合模块）；此处 import+re-export 保持既有导入面零变化。
import { buildCompactDiagnosticHeader } from './diagnostic-header';
export { buildCompactDiagnosticHeader };

function classifyFailure(entry: UtHvigorTestFailureModule): ClassifiedFailure {
  const evidence = entry.result.onDeviceFailureEvidence;
  if (entry.result.toolMissing === true) {
    return { ...entry, toolchain: true, phase: 'tool_missing', failureKind: 'device_tool_missing' };
  }
  const installBlocking = entry.result.installBlocking;
  if (installBlocking?.kind && installBlocking.kind !== 'clear') {
    return {
      ...entry,
      toolchain: true,
      phase: 'install_preflight_' + installBlocking.kind,
    };
  }
  if (evidence?.failedAt === 'hap_not_found') {
    const signGap =
      evidence.unsignedPresent === true ||
      evidence.signSkipped === true ||
      evidence.signingConfigMissing === true;
    return {
      ...entry,
      toolchain: true,
      phase: 'hap_not_found',
      failureKind: signGap ? 'ohos_test_sign_gap' : 'ohos_test_hap_missing',
    };
  }
  if (evidence?.failedAt === 'install') {
    // plan 423e5d0f P0-4（codex 实锤）：宿主真实路径=预检漏判 → 运行期 hdc install 返回
    // 9568263 → installDiagnosis.kind='install_downgrade'。此处必须消费该结构化分类：
    // 降级是"用户确认处理设备"类问题，压成通用 device_install_failed/device_toolchain
    // 会把用户决策问题误导成工具链修复问题。
    if (evidence.installDiagnosis?.kind === 'install_downgrade') {
      return { ...entry, toolchain: true, phase: 'install', failureKind: 'install_needs_confirmation' };
    }
    return { ...entry, toolchain: true, phase: 'install', failureKind: 'device_install_failed' };
  }
  const phase =
    evidence?.failedAt ??
    (entry.result.testResult?.failed
      ? 'no_pass'
      : entry.result.executed
        ? 'run_or_result'
        : 'not_executed');
  // t1：运行期设备阻断按**结构化** runDiagnosis.kind 判定（不做 stageHint 散文子串匹配）。
  const runKind = evidence?.runDiagnosis?.kind;
  if (runKind && DEVICE_BLOCKING_RUN_DIAGNOSIS_KINDS.has(runKind)) {
    return { ...entry, toolchain: false, phase, deviceBlocked: true, deviceSubkind: runKind };
  }
  return { ...entry, toolchain: false, phase };
}


function buildHapHeader(result: HvigorRunResult): string {
  const evidence = result.onDeviceFailureEvidence;
  if (
    !evidence ||
    (evidence.unsignedPresent !== true &&
      evidence.signSkipped !== true &&
      evidence.signingConfigMissing !== true)
  ) {
    return '未发现 ohosTest 测试 HAP（signed/unsigned 均未见），不推断签名原因，请核对构建产物路径与 genOnDeviceTestHap 日志';
  }
  let reason: string;
  if (evidence.signingConfigMissing === true) {
    reason =
      'ohosTest 签名环境缺口：signingConfigs 未配置；宿主请补 signingConfigs 或通过自定义签名任务覆盖 ohosTest';
  } else if (evidence.signSkipped === true) {
    reason = 'ohosTest 签名环境缺口：hvigor 明确跳过签名，具体原因见构建日志';
  } else {
    reason = 'ohosTest 签名环境缺口：signed 缺失，原因未知，见下方诊断';
  }
  return evidence.unsignedPresent === true ? `${reason}；ohosTest 仅产出 unsigned HAP` : reason;
}

function compactModuleName(module: string, max = 28): string {
  const normalized = module.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function aggregateHeader(items: ClassifiedFailure[]): string {
  const allToolchain = items.every(item => item.toolchain);
  const allSignGap = items.every(item => item.failureKind === 'ohos_test_sign_gap');
  const allInstallBlocking = items.every(item => {
    const diag = item.result.installBlocking;
    return Boolean(diag?.kind && diag.kind !== 'clear');
  });
  const shown = items
    .slice(0, 2)
    .map(item => compactModuleName(item.module) + '=' + (item.failureKind ?? item.phase));
  if (items.length > shown.length) shown.push('等 ' + (items.length - shown.length) + ' 个模块');
  const title = allInstallBlocking
    ? '多模块装机预检阻塞'
    : allToolchain && allSignGap
      ? '多模块工具链失败（均为 ohosTest 签名缺口）'
      : allToolchain
        ? '多模块工具链失败'
        : '多模块失败性质不同';
  return title + '：' + shown.join('，') + '，勿按单一原因处理';
}
function singleToolchainHeader(item: ClassifiedFailure): string {
  if (item.failureKind === 'device_tool_missing') return '工具链不可用：未找到 hvigor/hdc';
  if (item.failureKind === 'device_install_failed' || item.failureKind === 'install_needs_confirmation') {
    const diagnosis = item.result.onDeviceFailureEvidence?.installDiagnosis;
    return diagnosis?.summary
      ? `安装阶段失败：${diagnosis.summary}`
      : `安装阶段失败：exit code ${item.result.exitCode ?? 'unknown'}`;
  }
  return buildHapHeader(item.result);
}

function stageHintOf(result: HvigorRunResult): string | undefined {
  return result.errors?.find(error => /失败阶段：/.test(error.message))?.message;
}

function appendOtherErrors(lines: string[], result: HvigorRunResult, stageHint?: string): void {
  const messages = (result.errors ?? []).map(error => error.message).filter(msg => msg !== stageHint);
  if (messages.length === 0) return;
  lines.push('诊断：');
  messages.forEach(message => lines.push(`  - ${message}`));
}

function appendModuleDetails(
  lines: string[],
  item: ClassifiedFailure,
  includeStructuredDiagnosis = false,
): void {
  const { module, result } = item;
  lines.push('ohosTest 模块 "' + module + '" 装机执行失败：');
  const installBlocking = result.installBlocking;
  if (
    includeStructuredDiagnosis &&
    item.toolchain &&
    !(installBlocking?.kind && installBlocking.kind !== 'clear')
  ) {
    lines.push('阶段诊断：' + buildCompactDiagnosticHeader(singleToolchainHeader(item)));
  }
  const stageHint = stageHintOf(result);
  if (stageHint) lines.push(stageHint);
  if (installBlocking?.kind && installBlocking.kind !== 'clear') {
    buildUtInstallBlockingCheckDetails(installBlocking)
      .split(/\r?\n/)
      .forEach(line => lines.push(line));
    return;
  }
  if (result.toolMissing) {
    appendOtherErrors(lines, result, stageHint);
    lines.push(
      '原因：未找到 hvigor / hdc 可执行文件（请在 framework.local.json > toolchain.devEcoStudio 配置本机 DevEco 路径；hdc 由 DevEco SDK toolchains 提供）。',
    );
    result.logExcerpt.split(/\r?\n/).forEach(line => lines.push(line));
    return;
  }
  if (!result.executed) {
    appendOtherErrors(lines, result, stageHint);
    lines.push('on-device 执行链未启动（见上方失败阶段与诊断）。');
    lines.push('日志尾部：', result.logExcerpt);
    return;
  }
  if (result.exitCode !== 0 && !result.testResult) {
    lines.push(`链路异常退出 exit_code=${result.exitCode}。`, '日志尾部：', result.logExcerpt);
    return;
  }
  if (!result.testResult) {
    lines.push('aa test 未输出 OHOS_REPORT_RESULT，无法证明用例已真实执行。');
    appendOtherErrors(lines, result, stageHint);
    lines.push('', `日志落盘：${result.logPath ?? '(未落盘)'}`);
    return;
  }
  const test = result.testResult;
  lines.push(
    `hypium 结果：total=${test.total}, passed=${test.passed}, failed=${test.failed}, skipped=${test.skipped}`,
  );
  if (test.total === 0) {
    lines.push(
      '警告：total=0 表示 hvigor test 没有跑到任何用例。请检查 List.test.ets 是否正确注册了所有 *.test.ets 入口。',
    );
  }
  if (test.failures.length > 0) {
    lines.push('失败用例（前 15 条）：');
    test.failures
      .slice(0, 15)
      .forEach(failure => lines.push(`  - [${failure.suite}] ${failure.test}  →  ${failure.message}`));
  }
  lines.push('', `日志落盘：${result.logPath ?? '(未落盘)'}`);
}

function actionFor(item: ClassifiedFailure): string {
  const installBlocking = item.result.installBlocking;
  if (installBlocking?.kind && installBlocking.kind !== 'clear') {
    return mapInstallBlockingToUtCheckFields(installBlocking).suggestion;
  }
  if (item.failureKind === 'device_tool_missing') {
    return '配置 framework.local.json 中的 DevEco/hvigor 路径，并确认 SDK toolchains 中的 hdc 可用。';
  }
  if (item.failureKind === 'ohos_test_sign_gap') {
    return `${singleToolchainHeader(item)}；签名配置属宿主资产，请宿主按该诊断处理后重跑。`;
  }
  if (item.failureKind === 'ohos_test_hap_missing') {
    return '核对 ohosTest 构建产物路径与 genOnDeviceTestHap 完整日志，不推断签名原因。';
  }
  if (item.failureKind === 'install_needs_confirmation') {
    // UT 专属处置追加在场景中立的底层诊断之后（底层被 testing 链共用，不得写死 UT 策略）。
    const base = item.result.onDeviceFailureEvidence?.installDiagnosis?.suggestion ?? '';
    return (
      `${base}${base ? '\n' : ''}` +
      'UT 链没有自动卸载能力：请等待用户手动处理设备（自行卸载或换测试机）后重跑；agent 不得自行卸载或设置卸载环境变量。'
    );
  }
  if (item.failureKind === 'device_install_failed') {
    return (
      item.result.onDeviceFailureEvidence?.installDiagnosis?.suggestion ??
      '按 hdc install 的错误码与设备日志处理后重跑。'
    );
  }
  const stageHint = stageHintOf(item.result);
  // t1：改用结构化 deviceBlocked 判定（此前为 stageHint 散文子串匹配——同类子串误判已有前科）。
  return item.deviceBlocked
    ? '设备已连接但锁屏：请人解锁真机并保持在桌面/前台后重跑；这是环境问题，不要改动代码或 UT。'
    : stageHint
      ? '按上方“失败阶段/修复建议”处理后重跑；完整输出见 hdc-test.log。'
      : '按失败用例堆栈定位问题：可能是 UT 逻辑错误、被测业务实现与 UT 预期不一致、或 Spy/Stub 预设值不对。' +
        '修改 UT 后重跑；若需要动业务源码，先按 SKILL.md > 约束 #12 的 HARD STOP 流程征得用户同意。';
}

export function buildUtHvigorTestFailDetails(
  bad: UtHvigorTestFailureModule[],
): UtHvigorTestFailDetails {
  if (bad.length === 0) throw new Error('buildUtHvigorTestFailDetails requires at least one failure');
  const onlyInstallBlocking = bad.length === 1 ? bad[0].result.installBlocking : undefined;
  if (onlyInstallBlocking?.kind && onlyInstallBlocking.kind !== 'clear') {
    const meta = mapInstallBlockingToUtCheckFields(onlyInstallBlocking);
    return {
      lines: buildUtInstallBlockingCheckDetails(onlyInstallBlocking).split(/\r?\n/),
      blockingClass: meta.blocking_class,
      failureKind: meta.failure_kind,
      suggestion: meta.suggestion,
      affectedFiles: [bad[0].module + '@ohosTest'],
    };
  }
  const items = bad.map(classifyFailure);
  const allToolchain = items.every(item => item.toolchain);
  const firstKind = items[0].failureKind;
  // 纯 externalBlocked 仍保留其可 defer 元数据；一旦与 sign-gap 等非代码工具链阻塞共存，
  // 组合结果必须归 device_toolchain，不能继承 externalBlocked 而把真实签名缺口一并 defer。
  let blockingClass: string | undefined = allToolchain ? 'device_toolchain' : undefined;
  let failureKind: string | undefined =
    allToolchain && firstKind && items.every(item => item.failureKind === firstKind)
      ? firstKind
      : undefined;
  // t1：全员设备阻断 → 接既有 externalBlocked/device_blocked 契约（可 defer、指引修环境）。
  // **混合场景必须不整体 defer**：只要有一个模块是真实用例失败/工具链缺口，就不得因另一个
  // 模块锁屏而把整体标成可 defer——否则设备问题会掩盖代码问题（同 257 行 sign-gap 同款理由）。
  const allDeviceBlocked = items.every(item => item.deviceBlocked === true);
  if (allDeviceBlocked) {
    blockingClass = 'externalBlocked';
    failureKind = 'device_blocked';
  }
  // plan 423e5d0f P0-4：runtime 降级（全员）→ needsConfirmation 契约，decideNextAction
  // 才会落 confirm 分支而不是 device_toolchain 的"修工具链"误导。
  if (failureKind === 'install_needs_confirmation') {
    blockingClass = 'needsConfirmation';
  }
  const activeInstallBlockings = items
    .map(item => item.result.installBlocking)
    .filter(diag => Boolean(diag?.kind && diag.kind !== 'clear'));
  const firstInstallBlocking = activeInstallBlockings[0];
  if (
    firstInstallBlocking &&
    activeInstallBlockings.length === items.length &&
    activeInstallBlockings.every(diag => diag?.kind === firstInstallBlocking.kind)
  ) {
    const meta = mapInstallBlockingToUtCheckFields(firstInstallBlocking);
    blockingClass = meta.blocking_class;
    failureKind = meta.failure_kind;
  }
  const lines: string[] = [];
  if (items.length === 1 && items[0].toolchain) {
    lines.push(buildCompactDiagnosticHeader(singleToolchainHeader(items[0])));
  } else if (items.length > 1) {
    lines.push(buildCompactDiagnosticHeader(aggregateHeader(items)));
  }
  items.forEach((item, index) => {
    if (lines.length > 0) lines.push('');
    appendModuleDetails(lines, item, items.length > 1);
    if (index < items.length - 1) lines.push('');
  });
  const suggestion =
    items.length > 1 && !allToolchain
      ? '多模块失败性质不同，勿按单一原因处理；' +
        items.map(item => `${item.module}：${actionFor(item)}`).join('；')
      : items.length > 1
        ? items.map(item => `${item.module}：${actionFor(item)}`).join('；')
        : actionFor(items[0]);
  return {
    lines,
    blockingClass,
    failureKind,
    suggestion,
    affectedFiles: [...new Set(bad.map(item => `${item.module}@ohosTest`))],
  };
}
