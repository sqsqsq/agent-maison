import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { loadFrameworkConfig } from '../config';
import { isCapabilitySkipped } from '../capability-registry';
import { loadResolvedProfile } from '../profile-loader';
import { tryLoadProfileCodingHost, type ProjectCompileResult } from '../profile-host-loader';
import { detectRepoLayout, resolveProbeFrameworkRoot } from '../repo-layout';
import { ensurePersonalSetup } from './utils/personal-setup-gate';
import { standaloneReportDir } from './utils/standalone-report-dir';

export function runCompile(options: { projectRoot: string; reportDir?: string; frameworkRoot?: string }): ProjectCompileResult & { reportDir: string } {
  const projectRoot = fs.realpathSync(options.projectRoot);
  const frameworkRoot = options.frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot, __dirname);
  const resolvedProfile = loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot), frameworkRoot);
  if (isCapabilitySkipped(resolvedProfile, 'coding.compile')) {
    throw new Error(`profile ${resolvedProfile.name} 不提供 coding.compile：本次未执行编译`);
  }
  const host = tryLoadProfileCodingHost(resolvedProfile.profileDir);
  if (!host?.compileProject) throw new Error(`profile ${resolvedProfile.name} 尚未提供独立工程级编译`);
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const reportDir = standaloneReportDir(projectRoot, frameworkRoot, options.reportDir ?? `doc/reports/compile/${stamp}`);
  const setup = ensurePersonalSetup(projectRoot, {
    requiredPrerequisites: new Set(resolvedProfile.personalPrerequisites?.['coding.compile'] ?? []),
  });
  if (!setup.ok) throw new Error(setup.message);
  fs.mkdirSync(reportDir, { recursive: true });
  return {
    ...host.compileProject({ projectRoot, frameworkRoot, harnessRoot: path.join(frameworkRoot, 'harness'), resolvedProfile, reportDir }),
    reportDir,
  };
}

export function main(argv = process.argv.slice(2)): number {
  const args = minimist(argv, { string: ['project-root', 'report-dir'], boolean: ['json', 'help'] });
  if (args.help) {
    console.log('npm run compile -- --project-root <宿主根> [--report-dir <宿主相对路径>] [--json]\n执行当前工程构建，不需要 Feature、diff 或修正登记。');
    return 0;
  }
  try {
    const unknown = Object.keys(args).filter(key => !['_', 'project-root', 'report-dir', 'json', 'help'].includes(key));
    if (unknown.length || args._.length) throw new Error(`不支持的编译参数：${[...unknown, ...args._].join(', ')}`);
    const result = runCompile({
      projectRoot: path.resolve(args['project-root'] || detectRepoLayout(__dirname).projectRoot),
      reportDir: args['report-dir'],
    });
    const ok = result.execution?.executed === true && result.checks.length > 0 && result.checks.every(check => check.status === 'PASS');
    const check = result.checks.find(item => item.id === 'coding_compile') ?? result.checks[0];
    const run = result.execution;
    const summary = {
      target: 'project', status: ok ? 'PASS' : 'FAIL', executed: run?.executed === true,
      exitCode: run?.exitCode, command: run?.command, durationMs: run?.durationMs,
      logPath: run?.logPath, metaPath: run?.metaPath, reportDir: result.reportDir,
      failure_kind: check?.failure_kind, message: check?.details.split('\n')[0], suggestion: check?.suggestion,
    };
    if (args.json) console.log(JSON.stringify(summary, null, 2));
    else console.log(`${summary.status}: ${summary.message}\n日志：${summary.logPath ?? '(未执行)'}\n元数据：${summary.metaPath ?? '(无)'}${summary.suggestion ? `\n${summary.suggestion}` : ''}`);
    return ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) console.log(JSON.stringify({ target: 'project', status: 'FAIL', executed: false, message }));
    else console.error(message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
