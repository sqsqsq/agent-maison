import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig } from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { loadResolvedProfile, loadPhaseRuleWithOverlays } from '../../profile-loader';
import { prepareExplicitRequest, requestProtectedPaths, type PreparedRequest } from './capability-resolution-entry-input';
import * as crypto from 'crypto';
import { resolveRequestInputs, readBoundInput } from './capability-resolution';
import { SpecLoader } from './spec-loader';
import { checkFactsArtifact } from './context-facts';
import { generateRequestScriptReport } from './report-generator';
import type { CheckResult, HarnessResolvedProfile, PhaseChecker, RequestCheckContext } from './types';
import { dispatchRequestTests, dispatchRequestTargetProbe, isCapabilitySkipped } from '../../capability-registry';
import { isInsideProjectRoot } from './project-relative-path';
import { classifyUtExpectations, extractUtItBlocks, type UtExpectationScan } from './ut-it-blocks';

export async function checkRequestTests(ctx: RequestCheckContext): Promise<CheckResult[]> {
  // R2：预期来源登记与 provider 执行**并列产出**，每条 return 路径都带上它（失败、未执行、provider 异常同样要呈现）。
  const expectation = scanRequestExpectations(ctx);
  const withExpectation = (checks: CheckResult[], result?: RequestProviderResult): CheckResult[] =>
    (expectation ? [...checks, finalizeExpectationCheck(expectation, result)] : checks);
  if (ctx.phase === 'ut' && !ctx.request.targets.tests.length) return withExpectation([requestFailure('request_tests_missing', 'UT test targets are not yet prepared')]);
  if (ctx.phase === 'testing' && ctx.resolvedInputs.values.cases?.state !== 'resolved') return [requestFailure('request_cases_missing', 'device cases must resolve through the existing cases provider')];
  try {
    const result = await dispatchRequestTests(ctx) as RequestProviderResult;
    if (Array.isArray(result?.checks) && result.checks.some(check => !check || !['PASS', 'FAIL', 'WARN', 'SKIP'].includes(check.status) || !['BLOCKER', 'MAJOR', 'MINOR'].includes(check.severity) || typeof check.id !== 'string' || typeof check.details !== 'string')) return withExpectation([requestFailure('request_provider_result_invalid', 'provider returned malformed checks')]);
    if (!result || result.executed !== true || !Number.isInteger(result.total) || result.total! < 1 || !Number.isInteger(result.failed) || result.failed! < 0 || result.failed! > result.total!
      || !Array.isArray(result.checks) || !result.evidence_paths?.length) return withExpectation([...(Array.isArray(result?.checks) ? result.checks : []), requestFailure('request_test_not_executed', 'provider did not return actual case results and evidence')]);
    const protectedPaths = requestProtectedPaths(ctx.projectRoot, ctx.frameworkRoot);
    const evidence: Array<{ path: string; sha256: string }> = [];
    for (const file of result.evidence_paths) {
      const absolute = path.resolve(ctx.reportDir, file);
      const real = fs.realpathSync(absolute);
      if (!isInsideProjectRoot(fs.realpathSync(ctx.projectRoot), real) || protectedPaths.some(dir => isInsideProjectRoot(dir, real)) || !fs.statSync(real).isFile()) return withExpectation([requestFailure('request_test_evidence_invalid', 'provider evidence must be in an isolated host report directory')], result);
      evidence.push({ path: path.relative(ctx.projectRoot, real).replace(/\\/g, '/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex') });
    }
    return withExpectation([...result.checks, { id: 'request_test_execution', category: 'structure', severity: 'BLOCKER', status: result.failed === 0 ? 'PASS' : 'FAIL', description: '专项测试实际执行结果', details: `total=${result.total}, failed=${result.failed}`, affected_files: evidence.map(item => item.path), structured: { request_evidence: evidence }, suggestion: result.failed ? '修复本次失败后重新执行，不复用旧报告宣称通过。' : undefined }], result);
  } catch (error) { return withExpectation([requestFailure('request_provider_unavailable', String(error))]); }
}

interface RequestProviderResult { executed?: boolean; total?: number; failed?: number; checks?: CheckResult[]; evidence_paths?: string[] }

interface ExpectationScanState {
  /** 本次授权写入的文件（问责面）与只读历史目标（呈现面）分列 */
  authorized: Array<{ file: string; scan: UtExpectationScan; extractorCount: number }>;
  readonly: Array<{ file: string; scan: UtExpectationScan; extractorCount: number }>;
  rows: Array<{ file: string; it: string; class: string; ref?: string; ref_kind?: 'path' | 'tag'; ref_sha256?: string; scope: 'authorized' | 'readonly' }>;
  blocking: string[];
  warnings: string[];
  sourcedPath: number;
  sourcedTag: number;
  characterization: number;
  unregisteredAuthorized: string[];
  unregisteredReadonly: number;
  identifiedTotal: number;
}

/** R2 补齐方法：逐字进 suggestion——宿主 agent 拿到的就是这几句。 */
const EXPECTATION_FIX_HINTS = [
  '文件头或 describe 上的标注不算登记',
  '在每条用例名前加 [CHAR-…]，或在紧邻该行上方加 // characterization',
  '保留原测试与期望值，不要为过检查改断言',
];
const EXPECTATION_LAYOUT_HINT = '每条断言单独成行、以 it( 或 test( 起行、名字用字符串字面量，并逐条登记；不要用 skip / each 等变体绕开登记';

/**
 * 解析本次请求目标里的预期来源登记（plan a9f3c7d2 第二笔 · R2）。
 *
 * 机器只证明「登记有效」：标注在不在、`// expectation:` 指的路径在不在项目内可不可读。
 * **语义（这条条目到底是现状记载还是授权要求）由写测试的 agent 按 business-ut 的四步核对承担**，
 * 框架不判断，也不因此新增 verifier。
 */
function scanRequestExpectations(ctx: RequestCheckContext): ExpectationScanState | undefined {
  if (ctx.phase !== 'ut') return undefined;
  const authorizedSet = new Set(ctx.request.allowed_test_writes);
  const state: ExpectationScanState = {
    authorized: [], readonly: [], rows: [], blocking: [], warnings: [],
    sourcedPath: 0, sourcedTag: 0, characterization: 0, unregisteredAuthorized: [], unregisteredReadonly: 0, identifiedTotal: 0,
  };
  const projectRoot = fs.realpathSync(ctx.projectRoot);
  for (const file of ctx.request.targets.tests) {
    const content = ctx.request.sourceContents.find(item => item.path === file)?.content;
    if (content === undefined) continue; // 授权写入但尚未落盘：既有 `gaps` 已经报过，这里不重复问责
    const scope: 'authorized' | 'readonly' = authorizedSet.has(file) ? 'authorized' : 'readonly';
    const scan = classifyUtExpectations(content);
    const extractorCount = extractUtItBlocks(content).length;
    (scope === 'authorized' ? state.authorized : state.readonly).push({ file, scan, extractorCount });
    state.identifiedTotal += scan.parsed;
    // 零解析：授权面是 BLOCKER（空集合不得满足来源检查），只读面只 WARN。
    if (scan.parsed === 0) {
      const message = scope === 'authorized'
        ? `本次授权写入的 ${file} 解析不到可识别的断言声明，无法核对预期来源`
        : `${file} 解析不到可识别的断言声明，本次无法分类呈现`;
      (scope === 'authorized' ? state.blocking : state.warnings).push(message);
    }
    // 第一道对账：识别出的 `it(` 条数必须等于执行器同源提取器的条数。
    if (scan.itFormCount !== extractorCount) {
      const message = `${file} 声明条数对账不等：分类器识别 ${scan.itFormCount} 条 it(，执行器同源提取器 ${extractorCount} 条（差 ${extractorCount - scan.itFormCount}）`;
      (scope === 'authorized' ? state.blocking : state.warnings).push(message);
    }
    for (const entry of scan.entries) {
      const row: ExpectationScanState['rows'][number] = { file, it: entry.name, class: entry.class, scope, ...(entry.ref ? { ref: entry.ref } : {}), ...(entry.ref_kind ? { ref_kind: entry.ref_kind } : {}) };
      if (entry.class === 'unclassifiable') {
        // 认不全一律不算登记成功：授权侧阻断，只读侧告警并计入历史未登记。
        const message = `${file} 的声明「${entry.name}」无法分类：${EXPECTATION_LAYOUT_HINT}`;
        if (scope === 'authorized') { state.blocking.push(message); state.unregisteredAuthorized.push(`${file}::${entry.name}`); }
        else { state.warnings.push(message); state.unregisteredReadonly += 1; }
        state.rows.push(row);
        continue;
      }
      if (entry.class === 'sourced' && entry.ref_kind === 'path') {
        // 来源核验边界与 P8 的 `impact.basis` 同款：只核路径存在、在项目内、可读并记指纹，**不判断语义**。
        const ref = entry.ref!.split('#')[0];
        let real: string | undefined;
        try { real = fs.realpathSync(path.resolve(projectRoot, ref)); } catch { real = undefined; }
        if (!real || !isInsideProjectRoot(projectRoot, real) || !fs.statSync(real).isFile()) {
          // 问责面按 scope 分流：授权侧 BLOCKER；**只读历史目标只告警**（历史文件引用的文档可能早已删除，
          // 那不是本次请求的责任——否则「只跑一遍历史测试」会被判 FAIL）。
          const message = `${file} 的断言「${entry.name}」登记的来源不可核验：${entry.ref}（须是项目内可读文件）`;
          row.class = 'unregistered';
          if (scope === 'authorized') { state.blocking.push(message); state.unregisteredAuthorized.push(`${file}::${entry.name}`); }
          else { state.warnings.push(message); state.unregisteredReadonly += 1; }
          state.rows.push(row);
          continue;
        }
        row.ref_sha256 = crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex');
        state.sourcedPath += 1;
      } else if (entry.class === 'sourced') state.sourcedTag += 1;
      else if (entry.class === 'characterization') state.characterization += 1;
      else if (scope === 'authorized') state.unregisteredAuthorized.push(`${file}::${entry.name}`);
      else state.unregisteredReadonly += 1;
      state.rows.push(row);
    }
  }
  return state;
}

/** 第二道对账（需要 provider 结果）与最终结论。 */
function finalizeExpectationCheck(state: ExpectationScanState, result?: RequestProviderResult): CheckResult {
  const blocking = [...state.blocking];
  const warnings = [...state.warnings];
  const executed = result?.executed === true && Number.isInteger(result?.total);
  if (executed && result!.total !== state.identifiedTotal) {
    const message = `识别总数对账不等：识别总数 ${state.identifiedTotal} 与 provider 实际执行 total=${result!.total} 不等（差 ${result!.total! - state.identifiedTotal}）`;
    (state.authorized.length ? blocking : warnings).push(message);
  }
  for (const item of state.unregisteredAuthorized) blocking.push(`${item} 既无预期来源、也未标注 characterization`);
  const lines = [
    `已登记来源 ${state.sourcedPath + state.sourcedTag} 条（路径已核 ${state.sourcedPath}、仅标签 ${state.sourcedTag}）`,
    `现状记录 ${state.characterization} 条（characterization，仅记录现状，不构成正确性结论）`,
    `历史未登记 ${state.unregisteredReadonly} 条（只读目标，不问责）`,
  ];
  // 「登记数」与「通过数」是两回事：provider 只给聚合结果，没有 it→结果映射，故一律不按类写通过数。
  if (!executed) lines.push('本次用例未执行，登记数不代表通过数（逐用例归属不可得）。');
  else if (result!.failed !== 0) lines.push('本次存在失败用例，登记数不代表通过数（逐用例归属不可得）。');
  else if (result!.total === state.identifiedTotal) lines.push('本次全部用例实际执行通过。');
  if (blocking.length) lines.push(...blocking.map(item => `BLOCKER: ${item}`));
  if (warnings.length) lines.push(...warnings.map(item => `WARN: ${item}`));
  const status: CheckResult['status'] = blocking.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS';
  return {
    id: 'request_expectation_source',
    category: 'structure',
    severity: 'BLOCKER',
    status,
    description: '预期来源登记',
    details: lines.join('\n'),
    affected_files: [...new Set(state.rows.map(row => row.file))],
    structured: { expectation_classes: state.rows },
    ...(status === 'PASS' ? {} : { suggestion: [...EXPECTATION_FIX_HINTS, ...(blocking.concat(warnings).some(item => item.includes('对账不等')) ? [EXPECTATION_LAYOUT_HINT] : [])].join('；') }),
  };
}

/**
 * 准备期能力缺口（plan a9f3c7d2 A8）。两条来源都判，缺一条 generic 这类 profile 就只报得出一半：
 *   1. `phasesDisabled`——该 phase 被 profile 关掉（执行期是 `request_phase_disabled`）；
 *   2. capability 声明为 SKIP——复用既有 `isCapabilitySkipped`，与 `dispatchRequestTests` 同一判据。
 * 其余落点 / 载体判据由 profile provider 的只读探测给出（未导出即无 gap，旧 profile 现状不变）。
 */
export function requestCapabilityGaps(profile: HarnessResolvedProfile, projectRoot: string, prepared: PreparedRequest): string[] {
  const gaps: string[] = [];
  if (profile.phasesDisabled.has(prepared.phase)) gaps.push(`capability:phase_disabled:${prepared.phase}（当前 profile 关闭了该阶段）`);
  const key = prepared.phase === 'ut' ? 'ut.run' : prepared.phase === 'testing' ? 'device_test.run' : undefined;
  if (!key) return gaps; // review 没有执行类 capability，只有 phase 维度
  if (isCapabilitySkipped(profile, key)) gaps.push(`capability:${key}:capability_skipped（当前 profile 声明该能力为 SKIP，本次请求无法执行）`);
  gaps.push(...dispatchRequestTargetProbe(profile, prepared.phase, projectRoot, prepared.targets.tests));
  return gaps;
}

export function requestFailure(id: string, details: string): CheckResult {
  return { id, category: 'structure', severity: 'BLOCKER', status: 'FAIL', description: '专项请求未满足执行条件', details, suggestion: '修正本次目标/输入后重新准备；provider 不支持时交框架/profile 维护者处理，不改写门禁或伪造成功。' };
}
export function checkRequestInputs(ctx: RequestCheckContext): CheckResult[] {
  const failures = Object.entries(ctx.resolvedInputs.values).filter(([, value]) => value.state !== 'resolved').map(([id, value]) => requestFailure('request_input_unresolved', `${id}: ${value.state === 'resolved' ? '' : value.detail}`));
  return [...failures, ...checkFactsArtifact(ctx.projectRoot, undefined, ctx.phase, { request: ctx.request, resolvedInputs: ctx.resolvedInputs, factsContext: ctx.factsContext, frameworkRoot: ctx.frameworkRoot, profileName: ctx.resolvedProfile.name, phaseRule: ctx.phaseRule })];
}

export async function runExplicitRequest(options: { projectRoot: string; frameworkRoot: string; args: Record<string, unknown> }): Promise<number> {
  options = { ...options, projectRoot: fs.realpathSync(options.projectRoot), frameworkRoot: fs.realpathSync(options.frameworkRoot) };
  const { args } = options;
  if (typeof args['request-file'] !== 'string' || typeof args['report-dir'] !== 'string') throw new Error('--request-file and --report-dir must be supplied together');
  for (const key of ['feature', 'f', 'goal-run-id', 'goal-attempt-id', 'goal-owner-id', 'goal-owner-epoch', 'run-id', 'attach-created', 'resume', 'manifest', 'sync-closure', 'revalidate', 'report-reconcile-only']) if (args[key] !== undefined && args[key] !== false) throw new Error(`request cannot be combined with --${key}`);
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) if (/^MAISON_(GOAL_|FEATURE|CURRENT_PHASE|PHASE_|RUN_ID|ORCHESTRATION)/i.test(key)) { saved[key] = process.env[key]; delete process.env[key]; }
  try {
    const parseOptions = { projectRoot: options.projectRoot, frameworkRoot: options.frameworkRoot, phase: String(args.phase ?? ''), requestFile: args['request-file'], reportDir: args['report-dir'] };
    const prepared = prepareExplicitRequest(parseOptions);
    const config = loadFrameworkConfig(options.projectRoot);
    const workflow = resolveWorkflowSpec(options.projectRoot, { frameworkRoot: options.frameworkRoot, config, workflowOverride: typeof args.workflow === 'string' ? args.workflow : undefined });
    const artifact = workflow.artifacts.find(artifact => artifact.id === prepared.phase);
    if (!artifact?.check) throw new Error('active workflow does not declare this request checker');
    // plan a9f3c7d2 A8：profile 载入前移到 `--prepare-request` 早退之前——落点与能力缺口必须在
    // agent **写测试之前**就拿到，而不是等到执行期才抛（原先 `request_phase_disabled` 只在 :76 出现）。
    const profile = loadResolvedProfile(options.projectRoot, config, options.frameworkRoot);
    if (args['prepare-request']) {
      const { sourceContents: _contents, ...output } = prepared;
      console.log(JSON.stringify({ ...output, gaps: [...output.gaps, ...requestCapabilityGaps(profile, options.projectRoot, prepared)] }, null, 2)); return 0;
    }
    const loader = new SpecLoader(options.projectRoot, undefined, undefined, options.frameworkRoot);
    const rulePath = artifact.rule ? path.resolve(options.frameworkRoot, 'specs', artifact.rule) : undefined;
    if (rulePath && !isInsideProjectRoot(path.join(options.frameworkRoot, 'specs'), rulePath)) throw new Error('workflow rule escaped specs');
    const ctx: RequestCheckContext = {
      subject: 'request', request: prepared, reportDir: prepared.reportDir, phase: prepared.phase,
      projectRoot: options.projectRoot, frameworkRoot: options.frameworkRoot,
      frameworkRel: path.relative(options.projectRoot, options.frameworkRoot).replace(/\\/g, '/'), harnessRoot: path.join(options.frameworkRoot, 'harness'),
      phaseRule: loadPhaseRuleWithOverlays(prepared.phase, loader.loadPhaseRule(prepared.phase, rulePath), profile),
      resolvedProfile: profile,
      resolvedInputs: resolveRequestInputs(options.projectRoot, options.frameworkRoot, prepared),
      factsContext: { subject: { request_sha256: prepared.request_sha256, report_dir: path.relative(options.projectRoot, prepared.reportDir).replace(/\\/g, '/') }, first_phase: prepared.phase, source_paths: [...new Set([...prepared.bindings.filter(binding => binding.exists).map(binding => binding.path), ...Object.entries(prepared.inputs).filter(([id, file]) => id !== 'review_report' && fs.existsSync(file)).map(([, file]) => path.relative(options.projectRoot, file).replace(/\\/g, '/'))])], required_input_snippets: [] },
    };
    let checks = checkRequestInputs(ctx);
    if (ctx.resolvedProfile.phasesDisabled.has(ctx.phase)) checks.push(requestFailure('request_phase_disabled', 'active profile disables this phase'));
    if (!checks.some(check => check.status === 'FAIL')) {
      const checkerPath = path.resolve(ctx.harnessRoot, 'scripts', artifact.check);
      if (!checkerPath.startsWith(path.resolve(ctx.harnessRoot) + path.sep)) throw new Error('workflow checker escaped harness');
      const loaded = require(checkerPath); const checker: PhaseChecker = loaded.default ?? loaded.checker ?? loaded;
      if (checker.phase !== ctx.phase || !checker.subjects?.includes('request')) checks.push(requestFailure('request_checker_unsupported', `${artifact.check} does not support this phase/request subject`));
      else {
        try { checks.push(...await checker.check(ctx)); }
        catch (error) { checks.push(requestFailure('request_checker_error', String(error))); }
      }
    }
    try {
      const current = prepareExplicitRequest(parseOptions);
      if (current.request_sha256 !== prepared.request_sha256) checks.push(requestFailure('request_input_changed', 'targets/baseline changed during execution; prepare again'));
      if (JSON.stringify(current.bindings) !== JSON.stringify(prepared.bindings)) checks.push(requestFailure('request_execution_inputs_changed', 'test/source bytes changed during execution; run again against the final bytes'));
    } catch (error) { console.error(`request changed or report path unsafe: ${String(error)}`); return 1; }
    for (const input of Object.values(ctx.resolvedInputs.values)) if (input.state === 'resolved') {
      try { readBoundInput({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, phase: ctx.phase, track: 'full', inputContext: ctx.resolvedInputs.context, request: prepared, adhocCases: prepared.inputs.cases && fs.existsSync(prepared.inputs.cases) ? fs.readFileSync(prepared.inputs.cases, 'utf8') : undefined }, input.binding); }
      catch (error) { checks.push(requestFailure('request_binding_stale', String(error))); }
    }
    const result = generateRequestScriptReport(ctx, checks);
    console.log(JSON.stringify({ subject: 'request', request_sha256: prepared.request_sha256, verdict: result.verdict, report: result.reportPath }));
    return result.verdict === 'PASS' ? 0 : 1;
  } finally { for (const [key, value] of Object.entries(saved)) process.env[key] = value; }
}
