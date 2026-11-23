import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { featurePhaseReportsDir } from '../../config';
import type { loadResolvedProfile } from '../../profile-loader';
import type { WorkflowSpec } from '../../workflow-loader';
import type { WorkUnitExecutionContext } from './goal-phase-executor';
import type { HarnessRunSummary } from './types';
import { sanitizeSpawnEnv } from './process-integrity';
import { capturePhaseBinding, readHandoffMaterial, stageVerifierHandbacks, type HandoffReference, type IssuedSessionExecution } from './session-execution-handoff';
import { diffPhaseInvocationSnapshots, readPhaseRecoveryFile, type PhaseInvocationSnapshot, type PhaseWriteBoundaryResolution } from './phase-write-boundary';
import { realProjectPath, validateProjectRelativePath } from './project-relative-path';
import { computePromptSha256, parseVerifierRequest, verifierRequestFilename, type VerifierRequest } from './verifier-request';
import { loadVerifierEvidenceForSubject, parseVerifierEvidenceText, planVerifierItemReview, verifierReportItemGaps, verifierReportMdPath, type LoadVerifierEvidenceResult } from './verifier-evidence';
import { computeMaterialSha256, readVerifierMaterialOrNull, verifierMaterialFilename, VERIFIER_MATERIAL_SCHEMA } from './verifier-material';
import { workflowVerifierPrompt } from './verifier-plan';
import { loadVerifierPromptTemplate, renderVerifierItemReviewNotice } from './report-generator';

export interface StageVerifierLocation {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  phase: string;
}

export function readSignedStageVerifier(input: StageVerifierLocation, summary?: Pick<HarnessRunSummary,
  'verifier_request' | 'verifier_report' | 'verifier_subject_id'>) {
  const { projectRoot, frameworkRoot, feature, phase } = input;
  const reportsDir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
  const resolve = (value: string) => {
    const safe = validateProjectRelativePath(projectRoot, value, 'verifier input');
    realProjectPath(projectRoot, safe, 'verifier input');
    return path.resolve(projectRoot, safe);
  };
  try {
    summary ??= JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8')) as HarnessRunSummary;
    if (!summary.verifier_request || !summary.verifier_report || !summary.verifier_subject_id) return null;
    const requestPath = resolve(summary.verifier_request);
    const reportPath = resolve(summary.verifier_report);
    const requestText = fs.readFileSync(requestPath, 'utf8');
    const request = parseVerifierRequest(requestText);
    if (!request || request.feature !== feature || request.phase !== phase || request.subject_id !== summary.verifier_subject_id
      || requestPath !== path.join(reportsDir, verifierRequestFilename(request.subject_id))
      || reportPath !== verifierReportMdPath(reportsDir, request.subject_id)) return null;
    const material = readVerifierMaterialOrNull(reportsDir, request.subject_id);
    if (!material || material.material_sha256 !== request.material_sha256
      || material.schema === VERIFIER_MATERIAL_SCHEMA && computeMaterialSha256(material) !== request.material_sha256) return null;
    const promptPath = resolve(request.prompt_path);
    if (computePromptSha256(fs.readFileSync(promptPath, 'utf8')) !== request.prompt_sha256) return null;
    return { request, requestText, reportsDir, requestPath, reportPath, promptPath, reportRel: summary.verifier_report };
  } catch { return null; }
}

export { stageVerifierDraftPath, standaloneVerifierRunDir } from './session-execution-handoff';

export function protectStageVerifierInputs(boundary: PhaseWriteBoundaryResolution,
  signed: NonNullable<ReturnType<typeof readSignedStageVerifier>>, draft?: string): void {
  boundary.immutableInputPaths = [...new Set([...(boundary.immutableInputPaths ?? []),
    signed.requestPath, signed.promptPath, signed.reportPath, path.join(signed.reportsDir, 'summary.json'),
    path.join(signed.reportsDir, 'script-report.json'),
    path.join(signed.reportsDir, verifierMaterialFilename(signed.request.subject_id))])].filter(file => file !== draft);
}

export function resolveStageVerifierItemFocus(qualification: Parameters<typeof verifierReportItemGaps>[0],
  signed: NonNullable<ReturnType<typeof readSignedStageVerifier>>, workflow: WorkflowSpec,
  profile: ReturnType<typeof loadResolvedProfile>, report: LoadVerifierEvidenceResult): string {
  if (!report.ok) return '';
  const material = readVerifierMaterialOrNull(signed.reportsDir, signed.request.subject_id);
  const templatePath = workflowVerifierPrompt(workflow, qualification.phase);
  if (!material || !templatePath || !qualification.frameworkRoot) return '';
  const templateText = loadVerifierPromptTemplate(path.join(qualification.frameworkRoot, 'harness'), qualification.phase, profile, templatePath);
  const itemReview = planVerifierItemReview({ ...qualification, currentMaterial: material, templateText });
  return renderVerifierItemReviewNotice(qualification.projectRoot, { ...itemReview, currentReportPath: signed.reportRel });
}

export function spawnIndependentWorker(entry: string, args: readonly string[], logFd: number,
  spawnChild: typeof spawn = spawn, preload = require.resolve('ts-node/register/transpile-only')) {
  return spawnChild(process.execPath, ['-r', preload, entry, ...args], {
    detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true, cwd: process.cwd(),
    env: { ...sanitizeSpawnEnv(process.env).env, TS_NODE_PROJECT: path.resolve(__dirname, '../../tsconfig.json') },
  });
}

/** An exited launcher keeps the Windows worker out of its waiter's process tree. */
export function launchStandaloneVerifierWorker(entry: string, args: readonly string[], logFd: number,
  onError: (error: Error) => void): number | undefined {
  if (process.platform !== 'win32') {
    const child = spawnIndependentWorker(entry, args, logFd);
    child.once('error', onError);
    child.unref();
    return child.pid;
  }
  const launcher = [
    "const child = require('child_process').spawn(process.execPath, process.argv.slice(1),",
    "  { detached: true, stdio: ['ignore', 2, 2], windowsHide: true });",
    "child.once('spawn', () => { process.stdout.write(String(child.pid)); child.unref(); });",
    "child.once('error', error => { console.error(error.message); process.exitCode = 1; });",
  ].join('\n');
  const preload = require.resolve('ts-node/register/transpile-only');
  const child = spawnSync(process.execPath, ['-e', launcher, '--', '-r', preload, entry, ...args], {
    stdio: ['ignore', 'pipe', logFd], encoding: 'utf8', windowsHide: true,
    timeout: 15000, cwd: process.cwd(),
    env: { ...sanitizeSpawnEnv(process.env).env, TS_NODE_PROJECT: path.resolve(__dirname, '../../tsconfig.json') },
  });
  const pid = Number(child.stdout);
  // A helper killed after spawn may still leave a viable worker. The existing feature fence handles its startup.
  if (Number.isInteger(pid) && pid > 0) return pid;
  onError(child.error ?? new Error('Windows 独立启动进程没有提交执行者 PID，请查看原运行日志。'));
  return undefined;
}

export function restoreStageVerifierReport(runDir: string, request: VerifierRequest, reportPath: string, reportRel: string,
  qualification: Parameters<typeof verifierReportItemGaps>[0], options?: { retainIncomplete?: boolean }): boolean {
  try {
    const target = readPhaseRecoveryFile(qualification.projectRoot, reportPath);
    const { phase, feature, subject_id: currentSubject } = request;
    const parse = (bytes: Buffer) => parseVerifierEvidenceText({ feature, phase, currentSubject, text: bytes.toString('utf8'),
      mdAbs: reportPath, mdRel: reportRel });
    const existing = target.bytes ? loadVerifierEvidenceForSubject(qualification.projectRoot, feature, phase, currentSubject,
      { frameworkRoot: qualification.frameworkRoot }) : null;
    if (existing?.ok && !verifierReportItemGaps(qualification, existing.evidence).length) return false;
    const publicSha = target.bytes && createHash('sha256').update(target.bytes).digest('hex');
    for (const { bytes, publicPreimageSha256 } of stageVerifierHandbacks(runDir, request, reportPath)) {
      const original = parse(bytes);
      if (!original.ok) continue;
      const incomplete = verifierReportItemGaps(qualification, original.evidence).length > 0;
      if (incomplete && !options?.retainIncomplete) continue;
      // A later complete response may resolve this precise incomplete report. Older PASS is never a substitute.
      if (existing?.ok && existing.evidence.verdict === 'FAIL' && original.evidence.verdict === 'PASS'
        && (incomplete || publicPreimageSha256 !== publicSha)) continue;
      if (target.bytes?.equals(bytes)) return false;
      const temporary = `${target.actual}.runtime-${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes, { flag: 'wx' });
      try { fs.renameSync(temporary, target.actual); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      return true;
    }
  } catch { /* Recovery can reuse a readable original; the current verification gap remains otherwise. */ }
  return false;
}

export function renderStageVerifierRepairInstruction(input: {
  requestText: string; reportRel: string; diagnosis: string; itemFocus: string; formatFeedback: string;
}): string {
  const { requestText, reportRel, diagnosis, itemFocus, formatFeedback } = input;
  return itemFocus + '读取 request.prompt_path 独立核验。开头有复核范围时按该范围。'
    + '跨阶段原件只用于核对本阶段已签项目的依据与反证。'
    + `完整回复原样写入 ${reportRel}。不得修改实现、验收或正式机器结果。\n`
    + [diagnosis, formatFeedback, requestText].filter(Boolean).join('\n');
}

export function phaseBindingCapture(context: WorkUnitExecutionContext, original?: Pick<IssuedSessionExecution, 'request' | 'reference'>) {
  let snapshot: HandoffReference | undefined;
  return { beforeSpawn: () => {
    if (!original) return;
    snapshot = capturePhaseBinding(context.runDir, original);
    if (original.request.purpose === 'verifier_format_repair' && snapshot && original.request.pre_snapshot) {
      const captured = readHandoffMaterial<{ snapshot: PhaseInvocationSnapshot }>(context.runDir, snapshot);
      const drift = diffPhaseInvocationSnapshots(original.request.pre_snapshot, captured.snapshot);
      if (drift.kind !== 'clean') throw new Error('已签独立核验输入在原生派发前变化；请重新取得当前检查。');
    }
  }, fields: () => ({ owner_id: context.owner.owner_id, owner_epoch: context.owner.epoch, ...(snapshot ? { binding_snapshot: snapshot } : {}) }) };
}
