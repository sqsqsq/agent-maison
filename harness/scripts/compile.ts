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
import { readRequestIntake, resolveRequestSessionReference, type RequestIntake } from './utils/request-intake';
import { deriveContentImpact } from './utils/content-impact';
import { checkArchitectureFiles } from './check-coding';
import { SpecLoader } from './utils/spec-loader';
import { loadPhaseRuleWithOverlays } from '../profile-loader';
import { isBlockingCheck, isRequiredCheckGap } from './utils/check-disposition';
import { realProjectPath } from './utils/project-relative-path';

export function runCompile(options: { projectRoot: string; reportDir?: string; frameworkRoot?: string; sessionRef?: string; targets?: string[]; architectureOnly?: boolean }): ProjectCompileResult & { reportDir: string; intake?: RequestIntake; intakeGap?: string; contentImpact?: ReturnType<typeof deriveContentImpact>; architectureAnalyzed: number } {
  const projectRoot = fs.realpathSync(options.projectRoot);
  const frameworkRoot = options.frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot, __dirname);
  const resolvedProfile = loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot), frameworkRoot);
  if (!options.architectureOnly && isCapabilitySkipped(resolvedProfile, 'coding.compile')) {
    throw new Error(`profile ${resolvedProfile.name} 不提供 coding.compile：本次未执行编译`);
  }
  const host = tryLoadProfileCodingHost(resolvedProfile.profileDir);
  if (!options.architectureOnly && !host?.compileProject) throw new Error(`profile ${resolvedProfile.name} 尚未提供独立工程级编译`);
  let intake: RequestIntake | undefined;
  const location = resolveRequestSessionReference(options.sessionRef, projectRoot);
  let intakeGap = location.gap;
  if (location.sessionRef) try { intake = readRequestIntake({ projectRoot, frameworkRoot, sessionRef: location.sessionRef, explicitTargets: options.targets }); }
  catch (error) { intakeGap = String(error); }
  const files = (intake?.targets ?? options.targets ?? []).map(file => path.relative(projectRoot, realProjectPath(projectRoot, file, 'architecture target')).replace(/\\/g, '/'));
  const architectureAnalyzed = files.filter(file => /\.(?:ets|[cm]?[jt]sx?)$/.test(file) && fs.existsSync(path.resolve(projectRoot, file)) && fs.statSync(path.resolve(projectRoot, file)).isFile()).length;
  if (intake?.control.excluded.includes(options.architectureOnly ? 'architecture' : 'compile')) throw new Error('用户已明确排除此能力；本次未执行');
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const reportDir = standaloneReportDir(projectRoot, frameworkRoot, options.reportDir ?? `doc/reports/compile/${stamp}`);
  const setup = ensurePersonalSetup(projectRoot, {
    requiredPrerequisites: new Set(options.architectureOnly ? [] : resolvedProfile.personalPrerequisites?.['coding.compile'] ?? []),
  });
  if (!setup.ok) throw new Error(setup.message);
  fs.mkdirSync(reportDir, { recursive: true });
  const context = { projectRoot, frameworkRoot, harnessRoot: path.join(frameworkRoot, 'harness'), resolvedProfile, reportDir };
  const result: ProjectCompileResult = options.architectureOnly ? { checks: [], execution: { executed: false } } : host!.compileProject!(context);
  if (files.length && !intake?.control.excluded.includes('architecture')) {
    const phaseRule = loadPhaseRuleWithOverlays('coding', new SpecLoader(projectRoot, undefined, undefined, frameworkRoot).loadPhaseRule('coding'), resolvedProfile);
    result.checks.push(...checkArchitectureFiles(projectRoot, files, phaseRule), ...(host?.checkProjectArchitecture?.({ ...context, files, phaseRule }) ?? []));
  }
  if (options.architectureOnly && !files.length) throw new Error('架构检查需要本请求实际文件或显式 --target，不签空集通过');
  const contentImpact = intake ? deriveContentImpact(projectRoot, intake) : undefined;
  fs.writeFileSync(path.join(reportDir, 'compile-report.json'), JSON.stringify({ ...result, architecture_analyzed: architectureAnalyzed, ...(intake ? { intake_context: intake, content_impact: contentImpact } : { intake_gap: intakeGap }), next: contentImpact?.map(impact => ({ kind: impact.kind, verification: impact.verification, verification_family: impact.verification_family, excluded_by_user: impact.excluded_by_user })) }, null, 2) + '\n');
  return { ...result, reportDir, architectureAnalyzed, ...(intake ? { intake, contentImpact } : { intakeGap }) };
}

export function main(argv = process.argv.slice(2)): number {
  const args = minimist(argv, { string: ['project-root', 'report-dir', 'session-ref', 'target'], boolean: ['json', 'help', 'architecture-only'] });
  if (args.help) {
    console.log('npm run compile -- --project-root <宿主根> [--report-dir <宿主相对路径>] [--session-ref <原生transcript>#<原始user消息id>] [--target <项目相对路径>] [--architecture-only] [--json]\n执行当前工程构建/架构检查，不需要 Feature。原生来源缺失时只证明实际执行能力，不签完整请求对账。');
    return 0;
  }
  try {
    const unknown = Object.keys(args).filter(key => !['_', 'project-root', 'report-dir', 'json', 'help', 'session-ref', 'target', 'architecture-only'].includes(key));
    if (unknown.length || args._.length) throw new Error(`不支持的编译参数：${[...unknown, ...args._].join(', ')}`);
    const projectRoot = path.resolve(args['project-root'] || detectRepoLayout(__dirname).projectRoot);
    const result = runCompile({
      projectRoot,
      reportDir: args['report-dir'],
      sessionRef: args['session-ref'], targets: args.target ? [].concat(args.target) : undefined, architectureOnly: args['architecture-only'],
    });
    const ok = (args['architecture-only'] ? result.architectureAnalyzed > 0 && result.checks.some(check => check.status === 'PASS') && !result.checks.some(check => check.status === 'WARN') : result.execution?.executed === true)
      && result.checks.length > 0 && !result.checks.some(check => isBlockingCheck(check) || isRequiredCheckGap(check));
    const check = result.checks.find(item => isBlockingCheck(item) || isRequiredCheckGap(item)) ?? result.checks.find(item => item.id === 'coding_compile') ?? result.checks[0];
    const run = result.execution;
    const summary = {
      target: 'project', status: ok ? 'PASS' : 'FAIL', executed: run?.executed === true,
      exitCode: run?.exitCode, command: run?.command, durationMs: run?.durationMs,
      logPath: run?.logPath, metaPath: run?.metaPath, reportDir: result.reportDir,
      failure_kind: check?.failure_kind, message: check?.details.split('\n')[0], suggestion: check?.suggestion,
      ...(result.intakeGap ? { intake_gap: result.intakeGap } : {}),
      ...(result.intake ? { intake: result.intake, content_impact: result.contentImpact,
        next: [...new Set(result.contentImpact?.filter(impact => !impact.excluded_by_user).map(impact => `npm run ${impact.verification_family === 'architecture' ? 'compile' : 'check:' + impact.verification_family} -- --project-root ${JSON.stringify(projectRoot)} --session-ref ${JSON.stringify(result.intake!.session_ref)}${impact.verification_family === 'architecture' ? ' --architecture-only' : ''}`))] } : {}),
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
