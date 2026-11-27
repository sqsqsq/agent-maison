import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { loadFrameworkConfig } from '../config';
import { isCapabilitySkipped } from '../capability-registry';
import { preparePhaseExtensionInputs } from './utils/extension-runtime';
import { loadResolvedProfile } from '../profile-loader';
import { tryLoadProfileCodingHost, type ProjectCompileResult } from '../profile-host-loader';
import { detectRepoLayout, resolveProbeFrameworkRoot } from '../repo-layout';
import { ensurePersonalSetup } from './utils/personal-setup-gate';
import { standaloneReportDir } from './utils/standalone-report-dir';
import { intakeIdentity, readRequestIntake, resolveRequestSessionReference, requestTargetFingerprint, type RequestIntake } from './utils/request-intake';
import { compareRequestContent, deriveContentImpact } from './utils/content-impact';
import { readDesignVerificationRequest, requestTestingScope } from './utils/automatic-request';
import { selectBlueprintRequestContent } from './utils/blueprint-skill-projection';
import type { AcceptanceSpec } from './utils/types';
import { checkArchitectureFiles } from './check-coding';
import { SpecLoader } from './utils/spec-loader';
import { loadPhaseRuleWithOverlays } from '../profile-loader';
import { isBlockingCheck, isRequiredCheckGap } from './utils/check-disposition';
import { realProjectPath } from './utils/project-relative-path';
import { readRequestCompileHap, readRequestExecutionInputs, type RequestBuildArtifact, type RequestExecutionInputs } from './utils/request-execution-inputs';
import { computeGateFingerprint } from './utils/gate-fingerprint';

export function runCompile(options: { projectRoot: string; reportDir?: string; frameworkRoot?: string; sessionRef?: string; requestFile?: string; targets?: string[]; architectureOnly?: boolean }): ProjectCompileResult & { reportDir: string; intake?: RequestIntake; intakeGap?: string; contentImpact?: ReturnType<typeof deriveContentImpact>; next?: string[]; architectureAnalyzed: number } {
  const projectRoot = fs.realpathSync(options.projectRoot);
  const frameworkRoot = options.frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot, __dirname);
  const extensions = preparePhaseExtensionInputs(projectRoot, frameworkRoot, ['coding'], 'standalone');
  const resolvedProfile = loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot), frameworkRoot, extensions);
  if (!options.architectureOnly && isCapabilitySkipped(resolvedProfile, 'coding.compile')) {
    throw new Error(`profile ${resolvedProfile.name} 不提供 coding.compile：本次未执行编译`);
  }
  const host = tryLoadProfileCodingHost(resolvedProfile.profileDir);
  if (!options.architectureOnly && !host?.compileProject) throw new Error(`profile ${resolvedProfile.name} 尚未提供独立工程级编译`);
  let intake: RequestIntake | undefined;
  let intakeGap: string | undefined;
  let design: ReturnType<typeof readDesignVerificationRequest> | undefined;
  if (options.requestFile) {
    if (options.sessionRef) throw new Error('编译的 --request-file 已绑定原生来源');
    design = readDesignVerificationRequest(projectRoot, frameworkRoot, options.requestFile, { targets: options.targets, compile: !options.architectureOnly });
    intake = design.intake;
    intakeGap = design.source.originGap;
  } else {
    const location = resolveRequestSessionReference(options.sessionRef, projectRoot);
    intakeGap = location.gap;
    if (location.sessionRef) try {
      intake = readRequestIntake({ projectRoot, frameworkRoot, sessionRef: location.sessionRef, explicitTargets: options.targets });
      const original = `doc/reports/request/${intakeIdentity(intake)}/component-design/request.json`;
      if (intake.policy.selected === 'small' && fs.existsSync(path.resolve(projectRoot, original))) {
        design = readDesignVerificationRequest(projectRoot, frameworkRoot, original, { targets: options.targets, compile: !options.architectureOnly });
        intake = design.intake;
        intakeGap = design.source.originGap;
      }
    } catch (error) { intakeGap = String(error); }
  }
  const files = ([...new Set([...(design?.targets ?? intake?.targets ?? []), ...(options.targets ?? [])])]).map(file => path.relative(projectRoot, realProjectPath(projectRoot, file, 'architecture target')).replace(/\\/g, '/'));
  const requestFile = design && path.relative(projectRoot, design.file).replace(/\\/g, '/');
  const contentFingerprint = requestTargetFingerprint(projectRoot, files);
  const architectureAnalyzed = files.filter(file => /\.(?:ets|[cm]?[jt]sx?)$/.test(file) && fs.existsSync(path.resolve(projectRoot, file)) && fs.statSync(path.resolve(projectRoot, file)).isFile()).length;
  if (intake?.control.excluded.includes(options.architectureOnly ? 'architecture' : 'compile')) throw new Error('用户已明确排除此能力；本次未执行');
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const reportDir = standaloneReportDir(projectRoot, frameworkRoot, options.reportDir ?? (design
    ? path.relative(projectRoot, path.join(design.source.reportDir, options.architectureOnly ? 'architecture' : 'compile')).replace(/\\/g, '/')
    : `doc/reports/compile/${stamp}`));
  const reportPath = path.join(reportDir, 'compile-report.json');
  let priorCompile: { execution_inputs?: RequestExecutionInputs; execution_artifact?: RequestBuildArtifact } | undefined;
  if (fs.existsSync(reportPath)) {
    const previous = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const prior = previous.intake_context;
    const ownedLegacy = requestFile && prior && intake && prior.session_id === intake.session_id && prior.user?.id === intake.user.id
      && (path.resolve(reportDir, '..', 'request.json') === design!.file);
    if (previous.request_file !== requestFile && !ownedLegacy) throw new Error('编译报告目录属于另一请求');
    priorCompile = previous;
  }
  const setup = ensurePersonalSetup(projectRoot, {
    requiredPrerequisites: new Set(options.architectureOnly ? [] : resolvedProfile.personalPrerequisites?.['coding.compile'] ?? []),
  });
  if (!setup.ok) throw new Error(setup.message);
  fs.mkdirSync(reportDir, { recursive: true });
  const context = { projectRoot, frameworkRoot, harnessRoot: path.join(frameworkRoot, 'harness'), resolvedProfile, reportDir };
  const boundExecution = Boolean(requestFile && !options.architectureOnly);
  const executionInputs = boundExecution ? readRequestExecutionInputs(projectRoot, frameworkRoot, 'compile', files) : undefined;
  const beforePackage = executionInputs && readRequestCompileHap(projectRoot, resolvedProfile.profileDir);
  const result: ProjectCompileResult = options.architectureOnly ? { checks: [], execution: { executed: false } } : host!.compileProject!(context);
  if (files.length && !intake?.control.excluded.includes('architecture')) {
    const phaseRule = loadPhaseRuleWithOverlays('coding', new SpecLoader(projectRoot, undefined, undefined, frameworkRoot).loadPhaseRule('coding'), resolvedProfile);
    result.checks.push(...checkArchitectureFiles(projectRoot, files, phaseRule), ...(host?.checkProjectArchitecture?.({ ...context, files, phaseRule }) ?? []));
  }
  if (options.architectureOnly && !files.length) throw new Error('架构检查需要本请求实际文件或显式 --target，不签空集通过');
  if (requestTargetFingerprint(projectRoot, files) !== contentFingerprint) {
    const { requestFailure } = require('./utils/request-phase') as typeof import('./utils/request-phase');
    result.checks.push(requestFailure('request_execution_inputs_changed', '所选目标在编译过程中已变化，执行记录仍对应开始时的输入'));
  }
  if (boundExecution && result.execution?.executed
    && (!executionInputs || executionInputs.sha256 !== readRequestExecutionInputs(projectRoot, frameworkRoot, 'compile', files)?.sha256)) {
    const { requestFailure } = require('./utils/request-phase') as typeof import('./utils/request-phase');
    result.checks.push(requestFailure('request_execution_inputs_changed', executionInputs
      ? `实际编译期间所用模块或构建输入发生变化：${executionInputs.scope.join('、')}`
      : '本次实际编译已记录，模块或构建输入尚未核实'));
  }
  const checkedPackage = executionInputs && result.execution?.executed && result.execution.exitCode === 0
    && !result.checks.some(check => isBlockingCheck(check) || isRequiredCheckGap(check))
    ? readRequestCompileHap(projectRoot, resolvedProfile.profileDir) : null;
  const executionArtifact = checkedPackage && (checkedPackage.sha256 !== beforePackage?.sha256
    || priorCompile?.execution_inputs?.sha256 === executionInputs?.sha256
      && priorCompile?.execution_artifact?.sha256 === checkedPackage.sha256) ? checkedPackage : null;
  if (intake) intake = { ...intake, targets: files, content_fingerprint: contentFingerprint };
  const comparison = compareRequestContent(projectRoot, design?.baseline);
  const contentImpact = intake ? deriveContentImpact(projectRoot, intake, design?.baseline, comparison) : undefined;
  const acceptance = design?.blueprint && selectBlueprintRequestContent(design.blueprint).acceptance as unknown as AcceptanceSpec | undefined;
  const device = acceptance && requestTestingScope(projectRoot, intake, acceptance, design!.binding!.acceptance_ids, design?.baseline);
  const families = new Set(contentImpact?.filter(impact => !impact.excluded_by_user).map(impact => impact.verification_family));
  if (device?.required) families.add('testing');
  const next = intake && !intake.control.exempt ? [...families].map(family => {
    const project = `--project-root ${JSON.stringify(projectRoot)}`;
    const origin = requestFile ? `--request-file ${JSON.stringify(requestFile)}` : `--session-ref ${JSON.stringify(intake.session_ref)}`;
    if (family === 'architecture') return `npm run compile -- ${project} ${origin} --architecture-only`;
    if (intake.policy.selected === 'small') return `npm run check -- ${project} --phase ${family} ${requestFile ? origin : '--request-file <原 component-design request_file>'} --prepare-request`;
    return `npm run check:${family} -- ${project} ${origin}`;
  }) : [];
  fs.writeFileSync(reportPath, JSON.stringify({ ...result, architecture_analyzed: architectureAnalyzed,
    ...(intake ? { intake_context: intake, content_impact: contentImpact } : {}),
    ...(requestFile ? { request_file: requestFile, baseline: design!.baseline, targets: files, content_fingerprint: contentFingerprint } : {}),
    ...(executionInputs ? { execution_inputs: executionInputs, gate_fingerprint: computeGateFingerprint(frameworkRoot, 'coding') } : {}),
    ...(executionArtifact ? { execution_artifact: executionArtifact } : {}),
    ...(comparison.executed ? { comparison_candidates: comparison.entries } : { comparison_gap: comparison.error }), ...(intakeGap ? { intake_gap: intakeGap } : {}),
    ...(device ? { device_acceptance_ids: device.items.map(item => item.id) } : {}),
    next: contentImpact?.map(impact => ({ kind: impact.kind, verification: impact.verification, verification_family: impact.verification_family, excluded_by_user: impact.excluded_by_user })) }, null, 2) + '\n');
  return { ...result, reportDir, architectureAnalyzed, ...(intake ? { intake, contentImpact, next } : {}), ...(intakeGap ? { intakeGap } : {}) };
}

export function main(argv = process.argv.slice(2)): number {
  const args = minimist(argv, { string: ['project-root', 'report-dir', 'session-ref', 'request-file', 'target'], boolean: ['json', 'help', 'architecture-only'] });
  if (args.help) {
    console.log('npm run compile -- --project-root <宿主根> [--report-dir <宿主相对路径>] [--session-ref <原生transcript>#<原始user消息id> | --request-file <原component-design request>] [--target <项目相对路径>] [--architecture-only] [--json]\n执行当前工程构建/架构检查，不需要 Feature。原生来源缺失时只证明实际执行能力，不签完整请求对账。');
    return 0;
  }
  try {
    const unknown = Object.keys(args).filter(key => !['_', 'project-root', 'report-dir', 'json', 'help', 'session-ref', 'request-file', 'target', 'architecture-only'].includes(key));
    if (unknown.length || args._.length) throw new Error(`不支持的编译参数：${[...unknown, ...args._].join(', ')}`);
    const projectRoot = path.resolve(args['project-root'] || detectRepoLayout(__dirname).projectRoot);
    const result = runCompile({
      projectRoot,
      reportDir: args['report-dir'],
      sessionRef: args['session-ref'], requestFile: args['request-file'], targets: args.target ? [].concat(args.target) : undefined, architectureOnly: args['architecture-only'],
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
      ...(result.intake ? { intake: result.intake, content_impact: result.contentImpact, next: result.next } : {}),
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
