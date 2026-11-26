import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { loadFrameworkConfig } from '../../config';
import { readInvokeFinalText } from './agent-invoke';
import { classifyGoalRunsDir } from './fidelity-shared';
import { assertFencedOwner, readRunControl } from './goal-run-control';
import { ordinaryFile, relativeExtensionPath, type ExtensionFileChange, type ObserveExtensionWrite } from './extension-files';
import { invocationOutputLogPath, loadAuthoritativeEvents, type GoalRunEvent } from './goal-runner-phase';
import { realProjectPath } from './project-relative-path';
import { readPhaseRecoveryFile } from './phase-write-boundary';
import { acceptedSessionReport, readExecutionRequestOriginal, readSessionWriteWindows, type IssuedSessionExecution } from './session-execution-handoff';

type Data = Record<string, unknown>;

function record(value: unknown): Data {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}

function directories(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(item => item.isDirectory() && !item.name.startsWith('.'))
    .map(item => path.join(root, item.name));
}

const AUTHOR_PHASES = new Set(['initial-design-author', 'work-unit-author']);

function* authorRequests(projectRoot: string, requested?: string, activeOnly = false) {
  const features = realProjectPath(projectRoot, loadFrameworkConfig(projectRoot).paths.features_dir, 'paths.features_dir');
  const ownerDirectories = directories(features).flatMap(workspace => [
    workspace,
    // A canonical CU uses one child of the blueprint workspace as its Feature carrier.
    ...directories(workspace).filter(dir => fs.lstatSync(path.join(dir, 'change-unit.yaml'), { throwIfNoEntry: false })?.isFile()),
  ]);
  for (const directory of ownerDirectories) {
    const runsDir = path.join(directory, 'goal-runs');
    if (!fs.lstatSync(runsDir, { throwIfNoEntry: false })?.isDirectory()) continue;
    const { runs } = classifyGoalRunsDir(runsDir);
    for (const runId of runs) {
      const runDir = path.join(runsDir, runId);
      const events = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
      const finished = new Set(events.filter(event => event.type === 'agent_invoke_end').map(event => event.invoke_id));
      const starts = events.filter(event => event.type === 'agent_invoke_start' && event.invoke_id
        && event.phase && AUTHOR_PHASES.has(event.phase));
      for (const start of starts) {
        const requestId = start.invoke_id!;
        if (activeOnly && finished.has(requestId)) continue;
        if (requested && !requested.includes('/') && requested !== requestId && requested !== `${runId}:${requestId}`) continue;
        const issued = readExecutionRequestOriginal(runDir, requestId, events);
        if (!issued || issued.request.invoke_id !== requestId || issued.request.context.runId !== runId
          || issued.request.context.phase !== start.phase) continue;
        const requestFile = relativeExtensionPath(projectRoot, path.join(runDir, issued.reference.path));
        if (requested && requested !== requestId && requested !== `${runId}:${requestId}` && requested !== requestFile) continue;
        const segments = issued.request.context.workInput?.material.segments ?? [];
        const bindings = segments.flatMap(segment => {
          const data = record(segment);
          const design = record(data.extension_preparation);
          const rows = start.phase === 'work-unit-author' ? data.extension_feature_bindings
            : design.at === 'component-design.before_discovery@1' ? design.bindings : undefined;
          return Array.isArray(rows) ? rows.map(record) : [];
        });
        yield { requestId, requestFile, runId, runDir, events, issued, bindings, settled: finished.has(requestId) };
      }
    }
  }
}

function activeRequestIds(matches: Array<{ runId: string; requestId: string }>): string[] {
  return [...new Set(matches.map(request => matches.some(other => request.requestId === other.requestId && request.runId !== other.runId)
    ? `${request.runId}:${request.requestId}` : request.requestId))].sort();
}

export function activeExtensionRequests(projectRoot: string, ability: string, source: string): string[] {
  return activeRequestIds([...authorRequests(projectRoot, undefined, true)]
    .filter(request => request.bindings.some(binding => binding.ability === ability && binding.source === source)));
}

export function activeExtensionResourceRequests(projectRoot: string, paths: readonly string[]): { paths: string[]; requestIds: string[] } {
  const retained = new Set<string>();
  if (!paths.length) return { paths: [], requestIds: [] };
  const comparable = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const files = paths.map(file => ({ file, normalized: comparable(file) }));
  const active = [...authorRequests(projectRoot, undefined, true)].filter(request => {
    const root = request.issued.request.context.projectRoot;
    let matched = false;
    for (const binding of request.bindings) {
      if (typeof binding.path !== 'string' || (binding.delivery !== 'action' && binding.delivery !== 'pointer')) continue;
      const resource = comparable(relativeExtensionPath(root, path.resolve(root, binding.path)));
      const skill = binding.delivery === 'action' && path.posix.basename(resource) === comparable('SKILL.md')
        ? path.posix.dirname(resource) + '/' : undefined;
      for (const { file, normalized } of files) {
        if (normalized !== resource && (!skill || !normalized.startsWith(skill))) continue;
        retained.add(file);
        matched = true;
      }
    }
    return matched;
  });
  return { paths: [...retained].sort(), requestIds: activeRequestIds(active) };
}

export function recordExtensionManagementWrites<T>(
  projectRoot: string, work: (observe?: ObserveExtensionWrite) => T,
): T {
  const active = [...authorRequests(projectRoot, undefined, true)].filter(({ issued: { request } }) =>
    request.context.phase === 'initial-design-author' || (request.context.phase === 'work-unit-author'
      && !request.purpose && request.write_boundary?.executionRole === 'author'));
  if (!active.length) return work();
  const produced: ExtensionFileChange[] = [];
  try {
    return work(change => produced.push({ ...change, path: relativeExtensionPath(projectRoot, change.path) }));
  } finally {
    if (produced.length) for (const actor of active) {
      const { owner, feature, phase } = actor.issued.request.context;
      const eventsPath = ordinaryFile(actor.runDir, 'events.jsonl');
      if (loadAuthoritativeEvents(eventsPath).some(event => event.type === 'agent_invoke_end' && event.invoke_id === actor.requestId)) continue;
      const current = readRunControl(actor.runDir, owner.run_id);
      if (current?.owner?.owner_id !== owner.owner_id || current.current_epoch !== owner.epoch || current.owner.state !== 'active') continue;
      assertFencedOwner(actor.runDir, owner, 'extension_management_observed');
      const observation = {
        ts: new Date().toISOString(), type: 'phase_write_observed', producer: 'extension-management', phase,
        invoke_id: actor.requestId, feature, owner_id: owner.owner_id, owner_epoch: owner.epoch, produced,
      };
      fs.appendFileSync(eventsPath, JSON.stringify(observation) + '\n', 'utf8');
    }
  }
}

function resultLines(text: string, bindings: Data[]): Data[] {
  const results: Data[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*extension-result:\s*(\{.*\})\s*$/.exec(line);
    if (!match) continue;
    try {
      const item = record(JSON.parse(match[1]));
      if (bindings.some(binding => binding.ability === item.ability && binding.id === item.binding)
        && ['reused', 'generated', 'skipped', 'failed', 'read'].includes(String(item.status))) {
        results.push({
          ability: item.ability, binding: item.binding, status: item.status, evidence: 'author-report',
          ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
          ...(Array.isArray(item.artifacts) ? { reportedArtifacts: item.artifacts.filter(value => typeof value === 'string') } : {}),
        });
      }
    } catch { /* A malformed result line does not establish participation. */ }
  }
  return results;
}

function* linkedAuthorReports(
  projectRoot: string, request: { issued: IssuedSessionExecution; runDir: string; events: readonly GoalRunEvent[] },
  accepted: NonNullable<ReturnType<typeof acceptedSessionReport>>,
) {
  const { issued, runDir, events } = request;
  const { postSnapshot, report, event } = accepted;
  if (!postSnapshot || !report.details || 'write_evidence_rejected' in event) return;
  const windows = readSessionWriteWindows(runDir, issued, postSnapshot, events);
  if (windows?.kind !== 'checked' || windows.window !== 'execution_window' || windows.beforeBinding.length) return;
  const returned = new Map(windows.returned.filter(write => write.how === 'added' || write.how === 'modified')
    .map(write => [write.path, write.postSha256]));
  const originalRoot = issued.request.context.projectRoot;

  for (const link of report.details.matchAll(/(?<!!)\[[^\]\r\n]+\]\((?:<([^>\r\n]+)>|([^)\r\n]+))\)/g)) {
    try {
      const ref = decodeURIComponent((link[1] ?? link[2]).trim().split('#', 1)[0]);
      if (!/\.(?:md|txt)$/i.test(ref)) continue;
      const relative = relativeExtensionPath(originalRoot, path.resolve(originalRoot, ref));
      const hash = returned.get(relative);
      if (!hash || !postSnapshot.entries.some(entry => entry.path === relative && entry.kind === 'file' && entry.sha256 === hash)) continue;
      const { bytes } = readPhaseRecoveryFile(projectRoot, path.resolve(projectRoot, relative));
      if (bytes && createHash('sha256').update(bytes).digest('hex') === hash) {
        yield { relative, text: bytes.toString('utf8') };
      }
    } catch { /* Missing, changed or redirected paths do not establish a historical report. */ }
  }
}

export function inspectExtensionRequest(projectRoot: string, request: string, ability?: string): Record<string, unknown> {
  let reference = request.replace(/\\/g, '/').replace(/^\.\//, '');
  if (reference.includes('/')) {
    reference = path.relative(projectRoot, realProjectPath(projectRoot, reference, 'extension --request')).replace(/\\/g, '/');
  }
  const matches = [...authorRequests(projectRoot, reference)];
  if (matches.length !== 1) return {
    request,
    message: matches.length > 1
      ? '请求 ID 对应多个记录，请使用签发请求的项目相对路径'
      : '没有可核对的签发请求原件。直接调用的结果请查原会话交回。',
  };
  const [match] = matches;
  const bindings = match.bindings.filter(binding => !ability || binding.ability === ability);
  const accepted = match.settled && acceptedSessionReport(match.runDir, match.issued, match.events);
  const output = !match.settled ? '' : accepted ? accepted.report.details ?? ''
    : readInvokeFinalText('', invocationOutputLogPath(match.runDir, match.issued.request.context.phase, match.requestId),
      match.issued.request.context.adapter) ?? '';
  const results = resultLines(output, bindings);
  const alreadyReported = (ability: unknown, binding: unknown): boolean => results.some(item => item.ability === ability && item.binding === binding);
  if (accepted && bindings.some(binding => !alreadyReported(binding.ability, binding.id))) {
    for (const document of linkedAuthorReports(projectRoot, match, accepted)) {
      for (const result of resultLines(document.text, bindings)) {
        if (!alreadyReported(result.ability, result.binding)) {
          results.push({ ...result, reportPath: document.relative });
        }
      }
    }
  }
  return {
    requestId: match.requestId, runId: match.runId, requestFile: match.requestFile, settled: match.settled,
    bindings, results,
    ...(results.length ? {} : {
      message: bindings.length ? '签发原件可核对，现有交回未提供可核对的扩展结果。' : '签发原件没有该范围的扩展绑定。',
    }),
  };
}
