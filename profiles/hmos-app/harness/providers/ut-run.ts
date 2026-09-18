/**
 * ut.run → provider `hvigor_hypium`（含 probeDevices 供 env 提示）
 */
import type { CapabilityProvider } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { listBuildProfileModules, runHvigorTest as executeUt } from '../hvigor-runner';
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

/** Explicit request target selection; the existing HAP build/install/aa-test chain remains the executor. */
export async function runRequestTests(ctx: RequestCheckContext) {
  if (process.env.HARNESS_SKIP_HVIGOR || process.env.HARNESS_SKIP_HVIGOR_TEST || ctx.resolvedProfile.capabilities['ut.compile']?.severity === 'SKIP') throw new Error('UT native compile/run disabled; request cannot claim execution');
  // 模块归属 / 载体判据与准备期**共用同一函数**（不复制谓词）；源码内容校验仍在本函数内。
  const inspected = inspectRequestTargets(ctx.projectRoot, ctx.request.targets.tests);
  // 只对执行期本来就拒绝的落点类缺口抛错；载体类缺口是准备期的事前告知，执行期沿用既有反应。
  const blocking = inspected.typedGaps.find(gap => gap.kind === 'landing');
  if (blocking) throw new Error(blocking.message);
  const ownerOf = (file: string): { name: string; srcPath: string } => {
    const owner = [...inspected.groups.values()].find(module => file.startsWith(`${module.srcPath}/src/ohosTest/`));
    if (!owner) throw new Error(`UT target must belong to one configured ohosTest module: ${file}`);
    return owner;
  };
  const groups = new Map<string, { name: string; srcPath: string; classes: Set<string>; count: number }>();
  for (const file of ctx.request.targets.tests) {
    const module = ownerOf(file);
    const source = ctx.request.sourceContents.find(item => item.path === file)?.content;
    const classes = [...(source ?? '').matchAll(/\bdescribe\s*\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    const count = extractUtItBlocks(source ?? '').length;
    if (!count || !classes.length || classes.some(name => !/^[A-Za-z0-9_.-]+$/.test(name))) throw new Error(`UT target needs real literal Hypium classes and assertions: ${file}`);
    const group = groups.get(module.name) ?? { ...module, classes: new Set<string>(), count: 0 };
    for (const name of classes) { if (group.classes.has(name)) throw new Error(`duplicate selected UT class: ${name}`); group.classes.add(name); }
    group.count += count; groups.set(module.name, group);
  }
  if (!groups.size) throw new Error('no selected UT module');
  const gate = await applyPhaseEntryDeviceGate({ projectRoot: ctx.projectRoot, phase: 'ut', startedBy: `request-${ctx.request.request_sha256}`, log: message => console.error(message) });
  if (!gate.ok) throw new Error(gate.reason ?? 'UT device environment unavailable');
  const checks: CheckResult[] = []; const evidence_paths: string[] = []; let total = 0; let failed = 0; let executed = true;
  for (const group of groups.values()) {
    const reportDir = path.join(ctx.reportDir, group.name); fs.mkdirSync(reportDir, { recursive: true });
    const result = executeUt({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, harnessRoot: ctx.harnessRoot, phase: 'ut', reportDir, moduleName: group.name, moduleSrcPath: group.srcPath, testClasses: [...group.classes] });
    const ok = result.executed && result.exitCode === 0 && result.testResult?.total === group.count && result.testResult.failed === 0 && result.testResult.skipped === 0;
    executed &&= result.executed && !!result.testResult;
    total += result.testResult?.total ?? 0; failed += ok ? 0 : Math.max(1, result.testResult?.failed ?? 0);
    checks.push({ id: 'request_ut_native', category: 'structure', severity: 'BLOCKER', status: ok ? 'PASS' : 'FAIL', description: '指定 Hypium 类的原生执行', details: `${group.name}: requested=${group.count}; actual=${result.testResult?.total ?? 0}\n${result.logExcerpt}`, ...(ok ? {} : { suggestion: '修复真实工具链/注册/断言问题后重跑；不以模块其他测试的 PASS 替代目标。' }) });
    if (result.logPath) evidence_paths.push(path.resolve(result.logPath));
  }
  return { executed, total, failed, checks, evidence_paths };
}
