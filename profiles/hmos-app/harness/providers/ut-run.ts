/**
 * ut.run → provider `hvigor_hypium`（含 probeDevices 供 env 提示）
 */
import type { CapabilityProvider } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { listBuildProfileModules, runHvigorTest as executeUt, runHvigorBuild, isHvigorBuildSuccessful, type HvigorRunResult } from '../hvigor-runner';
import { discoverOhosTestArtifacts, resolveExecutionDeviceIdentity } from '../hdc-runner';
import { computeHapSha256Full } from '../build-fingerprint';
import { computeHvigorConfigDigest } from '../toolchain-probe';
import { resolveProductSelection, summarizeUnresolvedCause } from '../product-selection';
import { decideReuse, startExecutionKeyRun, writeExecutionKeyRecord, freezeRunArtifacts, restoreFrozenRunArtifacts, utFrozenRunArtifacts, sha256Text, computeExecutionKey, type ExecutionKeyInputs } from '../execution-key';
import { CheckExecutionError } from '../../../../harness/scripts/utils/check-execution';
import { buildUtHvigorTestFailDetails } from '../ut-hvigor-test-failure';
import { findFilesRecursive } from '../../../../harness/scripts/utils/find-files-recursive';
import { extractUtItBlocks } from '../../../../harness/scripts/utils/ut-it-blocks';
import { applyPhaseEntryDeviceGate } from '../../../../harness/scripts/utils/device-readiness-gate';
import { validateProjectRelativePath } from '../../../../harness/scripts/utils/project-relative-path';
import type { RequestCheckContext, CheckResult } from '../../../../harness/scripts/utils/types';

export const provider: CapabilityProvider = {
  id: 'hvigor_hypium',
  capability: 'ut.run',
  exports: ['runHvigorTest', 'probeDevices', 'runRequestTests', 'inspectRequestTargets'],
};

export { runHvigorTest } from '../hvigor-runner';
export { probeDevices } from '../hdc-runner';

/**
 * 只读的「目标落点 / 载体」探测（plan a9f3c7d2 A9）。
 *
 * 与执行期**共用同一谓词**，边界只有两件事：
 *   1. 模块归属——文件必须落在某个已声明模块的 `<srcPath>/src/ohosTest/` 下且唯一命中；
 *   2. 载体在场——该模块存在 `<srcPath>/src/ohosTest/module.json5`（执行期 `loadOhosTestModuleName` 的硬要求）。
 *
 * **源码内容校验（describe / it 数量、类名）留在执行期**：准备期的关键正例恰恰是
 * 「载体在场、而授权写入的测试文件还不存在」，此时读不到字节，沿用执行期校验必然误报。
 */
export interface RequestTargetGap {
  /** `landing` = 落点不兼容（执行期本来就拒）；`carrier` = 模块无测试载体（准备期新增的事前告知）。 */
  kind: 'landing' | 'carrier';
  message: string;
}

export function inspectRequestTargets(projectRoot: string, tests: readonly string[]): {
  groups: Map<string, { name: string; srcPath: string }>;
  gaps: string[];
  typedGaps: RequestTargetGap[];
} {
  const modules = listBuildProfileModules(projectRoot);
  const groups = new Map<string, { name: string; srcPath: string }>();
  const typedGaps: RequestTargetGap[] = [];
  for (const file of tests) {
    const matches = modules.filter(module => file.startsWith(`${module.srcPath}/src/ohosTest/`));
    if (matches.length !== 1) {
      typedGaps.push({ kind: 'landing', message: `capability:ut.run:${file} 不在任何已配置模块的 src/ohosTest/ 下（该 profile 的 UT 专项只执行该目录下的 Hypium 用例）` });
      continue;
    }
    const module = matches[0];
    try {
      validateProjectRelativePath(projectRoot, module.srcPath, 'UT module');
    } catch (error) {
      typedGaps.push({ kind: 'landing', message: `capability:ut.run:${module.name} 模块路径非法：${(error as Error).message}` });
      continue;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(module.name) || module.name === '.' || module.name === '..') {
      typedGaps.push({ kind: 'landing', message: `capability:ut.run:${module.name} 模块名不受支持` });
      continue;
    }
    groups.set(module.name, { name: module.name, srcPath: module.srcPath });
    // 载体缺失是**准备期的事前告知**：执行期对它的既有反应留在原处（`loadOhosTestModuleName` 读不到
    // `module.json5` 时抛），本函数不把它升级成新的执行期拒绝——执行语义一行不变。
    if (!fs.existsSync(path.join(projectRoot, module.srcPath, 'src', 'ohosTest', 'module.json5'))) {
      typedGaps.push({
        kind: 'carrier',
        message:
          `capability:ut.run:${module.name} 无测试载体（缺 src/ohosTest/module.json5）——这是 profile 能力缺口，` +
          '请如实报告，不要改投其它目录或用其它模块的通过代替；新建测试载体或改模块构建配置属于本次请求范围外的工程改动，' +
          '须先向用户说明并获认可',
      });
    }
  }
  return { groups, gaps: typedGaps.map(gap => gap.message), typedGaps };
}

function reject(details: string, failure_kind?: string): never {
  throw new CheckExecutionError({ id: 'request_ut_native', category: 'structure', severity: 'BLOCKER', status: failure_kind ? 'SKIP' : 'FAIL', description: '专项 UT 未满足执行条件', details,
    ...(failure_kind ? { failure_kind, blocking_class: 'externalBlocked' } : {}) });
}

/** Explicit request target selection; the existing HAP build/install/aa-test chain remains the executor. */
export async function runRequestTests(ctx: RequestCheckContext) {
  if (process.env.HARNESS_SKIP_HVIGOR || process.env.HARNESS_SKIP_HVIGOR_TEST || ctx.resolvedProfile.capabilities['ut.compile']?.severity === 'SKIP') reject('UT native compile/run disabled; request cannot claim execution', 'capability_missing');
  // 模块归属 / 载体判据与准备期**共用同一函数**（不复制谓词）；源码内容校验仍在本函数内。
  const inspected = inspectRequestTargets(ctx.projectRoot, ctx.request.targets.tests);
  // 输入拒绝与测试载体能力缺口在事实已知处分别保留。
  const blocking = inspected.typedGaps.find(gap => gap.kind === 'landing');
  if (blocking) reject(blocking.message);
  const missingCarrier = inspected.typedGaps.find(gap => gap.kind === 'carrier');
  if (missingCarrier) reject(missingCarrier.message, 'capability_missing');
  const ownerOf = (file: string): { name: string; srcPath: string } => {
    const owner = [...inspected.groups.values()].find(module => file.startsWith(`${module.srcPath}/src/ohosTest/`));
    if (!owner) reject(`UT target must belong to one configured ohosTest module: ${file}`);
    return owner;
  };
  const groups = new Map<string, { name: string; srcPath: string; classes: Set<string>; count: number }>();
  for (const file of ctx.request.targets.tests) {
    const module = ownerOf(file);
    const source = ctx.request.sourceContents.find(item => item.path === file)?.content;
    const classes = [...(source ?? '').matchAll(/\bdescribe\s*\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    const count = extractUtItBlocks(source ?? '').length;
    if (!count || !classes.length || classes.some(name => !/^[A-Za-z0-9_.-]+$/.test(name))) reject(`UT target needs real literal Hypium classes and assertions: ${file}`);
    const group = groups.get(module.name) ?? { ...module, classes: new Set<string>(), count: 0 };
    for (const name of classes) { if (group.classes.has(name)) reject(`duplicate selected UT class: ${name}`); group.classes.add(name); }
    group.count += count; groups.set(module.name, group);
  }
  if (!groups.size) reject('no selected UT module');
  const selection = resolveProductSelection({ projectRoot: ctx.projectRoot, purpose: 'ut' });
  if (!selection.product) reject(summarizeUnresolvedCause(selection), 'project_build_environment_inconsistent');
  const inputs: ExecutionKeyInputs = {
    hap_sha256_full: null,
    derived_plan_sha256: sha256Text(JSON.stringify({ targets: ctx.request.targets.tests, groups: [...groups.values()].map(group => ({ module: group.name, path: group.srcPath, classes: [...group.classes], count: group.count })) })),
    device: process.env.HARNESS_HDC_TARGET?.trim() || null, display_env: '', reset_mode: 'n/a', hylyre_version: null, manifest_version: null,
    profile: ctx.resolvedProfile.name, tool_config_sha256: computeHvigorConfigDigest(ctx.projectRoot), flags: ['request_ut', 'ohosTest', 'selected_classes', 'product=' + selection.product],
  };
  const started = startExecutionKeyRun(ctx.reportDir, 'ut', inputs);
  const runDir = started.runDir; let record = started.record;
  const gate = await applyPhaseEntryDeviceGate({ projectRoot: ctx.projectRoot, phase: 'ut', startedBy: 'request-' + ctx.request.request_sha256, log: message => console.error(message) });
  if (!gate.ok) reject(gate.reason ?? 'UT device environment unavailable', 'device_blocked');
  const identity = resolveExecutionDeviceIdentity();
  const builds = new Map<string, HvigorRunResult>();
  const haps: Array<[string, string | null]> = [];
  for (const group of groups.values()) {
    const build = runHvigorBuild({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, harnessRoot: ctx.harnessRoot,
      phase: 'ut', reportDir: runDir, moduleName: group.name, target: 'ohosTest', product: selection.product });
    builds.set(group.name, build);
    haps.push([group.name, computeHapSha256Full(discoverOhosTestArtifacts(ctx.projectRoot, group.srcPath, group.name, selection.product).signedPath)]);
  }
  Object.assign(inputs, { hap_sha256_full: sha256Text(JSON.stringify(haps)), device: identity.device, display_env: identity.display_env });
  record = { ...record, inputs, execution_key: computeExecutionKey(inputs) }; writeExecutionKeyRecord(runDir, record);
  const artifacts = [...utFrozenRunArtifacts([...groups.keys()]), ...[...groups.keys()].map(name => ({ top: 'hvigor-build.' + name + '.log', frozen: 'frozen.hvigor-build.' + name + '.log', group: 'execution' as const }))];
  const eligible = haps.every(([, digest]) => digest) && [...builds.values()].every(isHvigorBuildSuccessful);
  const reused = !ctx.forceDevice && eligible && identity.device
    ? decideReuse(ctx.reportDir, record.execution_key, { leg: 'ut', artifacts, excludeRunDir: runDir }).reusable : null;
  if (reused) restoreFrozenRunArtifacts(reused.runDir, runDir, artifacts);
  for (const [name, build] of builds) if (build.logPath && fs.existsSync(path.resolve(build.logPath))) fs.copyFileSync(path.resolve(build.logPath), path.join(runDir, 'hvigor-build.' + name + '.log'));
  const checks: CheckResult[] = []; const evidence_paths: string[] = []; let total = 0; let failed = 0; let executed = true;
  for (const group of groups.values()) {
    const resultFile = path.join(runDir, 'ut-result.' + group.name + '.json');
    let result: HvigorRunResult | undefined;
    if (reused) { try { result = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch { /* Damaged evidence is rerun. */ } }
    if (!result?.testResult) result = executeUt({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, harnessRoot: ctx.harnessRoot,
      phase: 'ut', reportDir: runDir, moduleName: group.name, moduleSrcPath: group.srcPath, testClasses: [...group.classes], product: selection.product,
      prebuild: builds.get(group.name) });
    fs.writeFileSync(resultFile, JSON.stringify(result));
    const nativeLog = path.join(runDir, 'hdc-test.' + group.name + '.log');
    if (!fs.existsSync(nativeLog) && result.logPath && fs.existsSync(path.resolve(result.logPath))) fs.copyFileSync(path.resolve(result.logPath), nativeLog);
    const ok = result.executed && !result.toolMissing && !result.skippedByEnv && !result.timedOut && !result.installBlocking && result.exitCode === 0 && result.testResult?.total === group.count && result.testResult.failed === 0 && result.testResult.skipped === 0;
    executed &&= result.executed && !!result.testResult;
    total += result.testResult?.total ?? 0; failed += ok ? 0 : Math.max(1, result.testResult?.failed ?? 0);
    const diagnosis = ok ? undefined : buildUtHvigorTestFailDetails([{ module: group.name, packagePath: group.srcPath, result }]);
    const external = result.toolMissing || result.skippedByEnv ? 'capability_missing' : diagnosis?.blockingClass === 'externalBlocked' ? diagnosis.failureKind : undefined;
    checks.push({ id: 'request_ut_native', category: 'structure', severity: 'BLOCKER', status: ok ? 'PASS' : external ? 'SKIP' : 'FAIL', description: '指定 Hypium 类的原生执行', details: group.name + ': requested=' + group.count + '; actual=' + (result.testResult?.total ?? 0) + (reused ? '; reused_by_execution_key' : '') + '\n' + result.logExcerpt,
      ...(external ? { failure_kind: external, blocking_class: 'externalBlocked' } : diagnosis ? { failure_kind: diagnosis.failureKind, blocking_class: diagnosis.blockingClass } : {}),
      ...(ok ? {} : { suggestion: diagnosis?.suggestion ?? '修复真实工具链/注册/断言问题后重跑；不以模块其他测试的 PASS 替代目标。' }) });
    evidence_paths.push(resultFile);
    if (fs.existsSync(nativeLog)) evidence_paths.push(nativeLog);
    const buildLog = path.join(runDir, 'hvigor-build.' + group.name + '.log');
    if (fs.existsSync(buildLog)) evidence_paths.push(buildLog);
  }
  const frozen = freezeRunArtifacts(runDir, runDir, artifacts);
  writeExecutionKeyRecord(runDir, { ...record, outcome: executed && failed === 0 ? 'success' : 'failed', timing_complete: frozen.length === artifacts.length, frozen_files: frozen });
  return { executed, total, failed, checks, evidence_paths: [...new Set([...evidence_paths, ...findFilesRecursive(runDir, /^(?!frozen\.)/)])] };
}
