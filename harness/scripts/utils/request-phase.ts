import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig } from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { loadResolvedProfile, loadPhaseRuleWithOverlays } from '../../profile-loader';
import { prepareExplicitRequest, requestProtectedPaths } from './capability-resolution-entry-input';
import * as crypto from 'crypto';
import { resolveRequestInputs, readBoundInput } from './capability-resolution';
import { SpecLoader } from './spec-loader';
import { checkFactsArtifact } from './context-facts';
import { generateRequestScriptReport } from './report-generator';
import type { CheckResult, PhaseChecker, RequestCheckContext } from './types';
import { dispatchRequestTests } from '../../capability-registry';
import { isInsideProjectRoot } from './project-relative-path';

export async function checkRequestTests(ctx: RequestCheckContext): Promise<CheckResult[]> {
  if (ctx.phase === 'ut' && !ctx.request.targets.tests.length) return [requestFailure('request_tests_missing', 'UT test targets are not yet prepared')];
  if (ctx.phase === 'testing' && ctx.resolvedInputs.values.cases?.state !== 'resolved') return [requestFailure('request_cases_missing', 'device cases must resolve through the existing cases provider')];
  try {
    const result = await dispatchRequestTests(ctx) as { executed?: boolean; total?: number; failed?: number; checks?: CheckResult[]; evidence_paths?: string[] };
    if (!result || result.executed !== true || !Number.isInteger(result.total) || result.total! < 1 || !Number.isInteger(result.failed) || result.failed! < 0 || result.failed! > result.total!
      || !Array.isArray(result.checks) || !result.evidence_paths?.length) return [requestFailure('request_test_not_executed', 'provider did not return actual case results and evidence')];
    if (result.checks.some(check => !check || !['PASS', 'FAIL', 'WARN', 'SKIP'].includes(check.status) || !['BLOCKER', 'MAJOR', 'MINOR'].includes(check.severity) || typeof check.id !== 'string' || typeof check.details !== 'string')) return [requestFailure('request_provider_result_invalid', 'provider returned malformed checks')];
    const protectedPaths = requestProtectedPaths(ctx.projectRoot, ctx.frameworkRoot);
    const evidence: Array<{ path: string; sha256: string }> = [];
    for (const file of result.evidence_paths) {
      const absolute = path.resolve(ctx.reportDir, file);
      const real = fs.realpathSync(absolute);
      if (!isInsideProjectRoot(fs.realpathSync(ctx.projectRoot), real) || protectedPaths.some(dir => isInsideProjectRoot(dir, real)) || !fs.statSync(real).isFile()) return [requestFailure('request_test_evidence_invalid', 'provider evidence must be in an isolated host report directory')];
      evidence.push({ path: path.relative(ctx.projectRoot, real).replace(/\\/g, '/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex') });
    }
    return [...result.checks, { id: 'request_test_execution', category: 'structure', severity: 'BLOCKER', status: result.failed === 0 ? 'PASS' : 'FAIL', description: '专项测试实际执行结果', details: `total=${result.total}, failed=${result.failed}`, affected_files: evidence.map(item => item.path), structured: { request_evidence: evidence }, suggestion: result.failed ? '修复本次失败后重新执行，不复用旧报告宣称通过。' : undefined }];
  } catch (error) { return [requestFailure('request_provider_unavailable', String(error))]; }
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
    if (args['prepare-request']) {
      const { sourceContents: _contents, ...output } = prepared;
      console.log(JSON.stringify(output, null, 2)); return 0;
    }
    const profile = loadResolvedProfile(options.projectRoot, config, options.frameworkRoot);
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
