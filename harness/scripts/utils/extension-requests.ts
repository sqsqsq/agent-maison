import * as fs from 'fs';
import * as path from 'path';

import { loadFrameworkConfig } from '../../config';
import { readInvokeFinalText } from './agent-invoke';
import { classifyGoalRunsDir } from './fidelity-shared';
import { assertFencedOwner, readRunControl } from './goal-run-control';
import { relativeExtensionPath, type ExtensionFileChange, type ObserveExtensionWrite } from './extension-files';
import { invocationOutputLogPath, loadAuthoritativeEvents } from './goal-runner-phase';
import { realProjectPath } from './project-relative-path';
import { acceptedSessionReport, readExecutionRequestOriginal } from './session-execution-handoff';

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

function* designRequests(projectRoot: string, requested?: string, activeOnly = false) {
  const features = realProjectPath(projectRoot, loadFrameworkConfig(projectRoot).paths.features_dir, 'paths.features_dir');
  for (const workspace of directories(features)) {
    // The initial-design author runs at the blueprint workspace's own Goal boundary.
    const runsDir = path.join(workspace, 'goal-runs');
    if (!fs.lstatSync(runsDir, { throwIfNoEntry: false })?.isDirectory()) continue;
    const { runs } = classifyGoalRunsDir(runsDir);
    for (const runId of runs) {
      const runDir = path.join(runsDir, runId);
      const events = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
      const finished = new Set(events.filter(event => event.type === 'agent_invoke_end').map(event => event.invoke_id));
      const starts = new Set(events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'initial-design-author')
        .map(event => event.invoke_id).filter((id): id is string => Boolean(id)));
      for (const requestId of starts) {
        if (activeOnly && finished.has(requestId)) continue;
        if (requested && !requested.includes('/') && requested !== requestId) continue;
        const issued = readExecutionRequestOriginal(runDir, requestId, events);
        if (!issued) continue;
        const requestFile = path.relative(projectRoot, path.join(runDir, issued.reference.path)).replace(/\\/g, '/');
        if (requested && requested !== requestId && requested !== requestFile) continue;
        const segments = issued.request.context.workInput?.material.segments ?? [];
        const preparation = segments.map(item => record(record(item).extension_preparation))
          .find(item => item.at === 'component-design.before_discovery@1');
        const bindings = Array.isArray(preparation?.bindings) ? preparation.bindings.map(record) : [];
        yield { requestId, requestFile, runId, runDir, events, issued, bindings, settled: finished.has(requestId) };
      }
    }
  }
}

export function activeExtensionRequests(projectRoot: string, ability: string, source: string): string[] {
  return [...new Set([...designRequests(projectRoot, undefined, true)]
    .filter(request => request.bindings.some(binding => binding.ability === ability && binding.source === source))
    .map(request => request.requestId))].sort();
}

export function recordExtensionManagementWrites<T>(
  projectRoot: string, work: (observe?: ObserveExtensionWrite) => T,
): T {
  const active = [...designRequests(projectRoot, undefined, true)];
  if (!active.length) return work();
  const produced: ExtensionFileChange[] = [];
  try {
    return work(change => produced.push({ ...change, path: relativeExtensionPath(projectRoot, change.path) }));
  } finally {
    if (produced.length) for (const actor of active) {
      const { owner, feature, phase } = actor.issued.request.context;
      const eventsPath = path.join(actor.runDir, 'events.jsonl');
      if (loadAuthoritativeEvents(eventsPath).some(event => event.type === 'agent_invoke_end' && event.invoke_id === actor.requestId)) continue;
      const current = readRunControl(actor.runDir, owner.run_id);
      if (current?.owner?.owner_id !== owner.owner_id || current.current_epoch !== owner.epoch) continue;
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
          ability: item.ability, binding: item.binding, status: item.status,
          ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
          ...(Array.isArray(item.artifacts) ? { artifacts: item.artifacts.filter(value => typeof value === 'string') } : {}),
        });
      }
    } catch { /* A malformed result line does not establish participation. */ }
  }
  return results;
}

export function inspectExtensionRequest(projectRoot: string, request: string, ability?: string): Record<string, unknown> {
  let reference = request.replace(/\\/g, '/').replace(/^\.\//, '');
  if (reference.includes('/')) {
    reference = path.relative(projectRoot, realProjectPath(projectRoot, reference, 'extension --request')).replace(/\\/g, '/');
  }
  const matches = [...designRequests(projectRoot, reference)];
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
  return {
    requestId: match.requestId, runId: match.runId, requestFile: match.requestFile, settled: match.settled,
    bindings, results,
    ...(results.length ? {} : {
      message: bindings.length ? '签发原件可核对，现有交回未提供可核对的扩展结果。' : '签发原件没有该范围的扩展绑定。',
    }),
  };
}
