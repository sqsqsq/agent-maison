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
  exports: ['runHvigorTest', 'probeDevices', 'runRequestTests'],
};

export { runHvigorTest } from '../hvigor-runner';
export { probeDevices } from '../hdc-runner';

/** Explicit request target selection; the existing HAP build/install/aa-test chain remains the executor. */
export async function runRequestTests(ctx: RequestCheckContext) {
  if (process.env.HARNESS_SKIP_HVIGOR || process.env.HARNESS_SKIP_HVIGOR_TEST || ctx.resolvedProfile.capabilities['ut.compile']?.severity === 'SKIP') throw new Error('UT native compile/run disabled; request cannot claim execution');
  const modules = listBuildProfileModules(ctx.projectRoot);
  const groups = new Map<string, { name: string; srcPath: string; classes: Set<string>; count: number }>();
  for (const file of ctx.request.targets.tests) {
    const matches = modules.filter(module => file.startsWith(`${module.srcPath}/src/ohosTest/`));
    if (matches.length !== 1) throw new Error(`UT target must belong to one configured ohosTest module: ${file}`);
    const module = matches[0]; validateProjectRelativePath(ctx.projectRoot, module.srcPath, 'UT module');
    if (!/^[A-Za-z0-9_.-]+$/.test(module.name) || module.name === '.' || module.name === '..') throw new Error('unsupported UT module name');
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
