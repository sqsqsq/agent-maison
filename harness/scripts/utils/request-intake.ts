import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { diffChangedFilesWithStatus } from './git-diff';
import { resolveDeliveryPolicy, type DeliveryFacts, type DeliveryPolicy, type DeliveryScale } from './execution-scope';
import { realProjectPath, isInsideProjectRoot } from './project-relative-path';
import { loadFrameworkConfig, featuresDirPath } from '../../config';
import { projectImplementationModules } from './diff-scope';

interface NativeMessage { id: string; role: string; text: string; at?: string; line: number; origin?: { store?: string; parentId?: string } }
interface NativeRead { path: string; content: string; complete: boolean; exact?: boolean }
interface NativeOrigin { store?: string; parentId?: string; partId?: string; callId?: string; callSeq?: number; resultSeq?: number }
interface NativeTool { name: string; input: unknown; output: string; line: number; resultLine?: number; error?: boolean; completed?: boolean; startedTime?: number; completionTime?: number; read?: NativeRead; readExact?(): NativeRead | undefined; origin?: NativeOrigin }
interface NativeAssociation { line: number; origin?: NativeOrigin; detail: string }
interface NativeSession { file: string; sessionId: string; cwd: string; request: NativeMessage; messages: NativeMessage[]; tools: NativeTool[]; associations?: NativeAssociation[]; userControlVerified?: boolean; gaps?: string[]; origin?: { store?: string } }
const native = require('../../../agents/shared/native-request.cjs') as {
  currentNativeSession(env?: NodeJS.ProcessEnv, projectRoot?: string): { file?: string; cwd?: string; gap?: string };
  samePath(left: string, right: string): boolean;
  toolSucceeded(tool: NativeTool): boolean;
  toolCompletedBefore(tool: NativeTool, message: NativeMessage | number): boolean;
  readNativeSession(reference: string, projectRoot: string): NativeSession;
  userControl(message: string): { exempt: boolean; session: boolean; revoke: boolean; fixed?: string; excluded: string[]; included: string[];
    transport?: 'attended' | 'unattended'; fullDiffAttribution?: boolean };
  editedPaths(tools: NativeTool[], candidates?: boolean): string[];
  toolInput(tool: NativeTool): string;
  productTarget(root: string, frameworkRoot: string, file: string, roots?: string[], explicit?: boolean): boolean;
};

export interface RequestIntake {
  session_ref: string;
  session_id: string;
  user: { id: string; text: string; at?: string; line: number };
  user_messages?: Array<{ id: string; text: string; at?: string; line: number }>;
  boundary: { origin_user_id: string; explanation: string; source_line: number };
  /** Readable on old carriers. Ordinary intake no longer collects a read inventory. */
  front_door_loaded?: boolean;
  source_reads?: string[];
  control: { exempt: boolean; scope: 'request' | 'session'; fixed?: DeliveryScale; excluded: string[]; sources: string[]; full_diff_attribution?: boolean;
    transport?: { mode: 'attended' | 'unattended'; source: string } };
  facts: DeliveryFacts;
  policy: DeliveryPolicy;
  baseline: { base?: string; head: 'WORKTREE'; source: 'captured' | 'reflog' | 'unknown'; detail: string; initial_dirty: string[] | 'unknown'; preimages?: Record<string, { content: string; source_line: number }>; initially_absent?: string[]; dirty_digests?: Record<string, string | null>; dirty_digests_at?: 'prepare' };
  explicit_targets?: string[];
  targets: string[];
  attribution_unknown: string[];
  attribution_disclosures?: Array<{ path: string; reason: string }>;
  source_results?: Array<{ detail: string; paths: string[] }>;
  content_fingerprint: string;
  gaps: string[];
}
const scales: Record<string, DeliveryScale> = { 特别简单: 'trivial', 小型: 'small', 中型: 'medium', 复杂: 'complex' };
export function nativeFixedScale(value?: string): DeliveryScale | undefined { return value ? scales[value] : undefined; }
const labels: Record<keyof DeliveryFacts, string> = { design_tradeoff: 'Q1', unclosed_impact: 'Q2', irreversible_data: 'Q3', dependent_results: '依赖结果', cross_component: '跨部件', expectations_clear: '预期明确', unique_approach: '做法唯一' };
function git(root: string, args: string[]): string { return execFileSync('git', args, { windowsHide: true, cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function nativePath(root: string, file: string): string {
  return realProjectPath(root, path.relative(root, path.resolve(root, file)).replace(/\\/g, '/'), 'native source');
}

function toolLocation(tool: NativeTool): string {
  const start = tool.origin?.callSeq !== undefined ? `seq=${tool.origin.callSeq}` : tool.origin?.partId ? `part=${tool.origin.partId}` : `行 ${tool.line}`;
  const end = tool.origin?.resultSeq !== undefined ? `，结果 seq=${tool.origin.resultSeq}` : tool.resultLine ? `，结果行 ${tool.resultLine}` : '';
  return `${tool.name} ${start}${tool.origin?.callId ? ` ID=${tool.origin.callId}` : ''}${end}`;
}

export function isProductTarget(root: string, frameworkRoot: string, file: string, explicit: string[] = []): boolean {
  const abs = realProjectPath(root, file, 'product target');
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  if (isInsideProjectRoot(frameworkRoot, abs) || isInsideProjectRoot(path.join(root, '.git'), abs)
    || isInsideProjectRoot(featuresDirPath(root), abs) || /^(?:\.cursor|\.codex|\.claude|\.cac|\.opencode)\//.test(rel)) return false;
  if (/^doc\/(?:reports|runs)\//.test(rel)) return false;
  const config = loadFrameworkConfig(root);
  const roots = config.architecture.outer_layers.map(layer => layer.id);
  for (const card of projectImplementationModules(root)) if (card.package_path) roots.push(card.package_path);
  return native.productTarget(root, frameworkRoot, file, roots, explicit.includes(rel));
}

/** Reconstruct only from this worktree's complete raw HEAD reflog. */
export function requestStartFromReflog(root: string, at: string): string | undefined {
  const second = Math.floor(Date.parse(at) / 1000);
  if (!Number.isFinite(second)) return;
  try {
    const file = git(root, ['rev-parse', '--git-path', 'logs/HEAD']);
    const rows = fs.readFileSync(path.resolve(root, file), 'utf8').trim().split('\n').map(line => {
      const match = /^([a-f0-9]{40}) ([a-f0-9]{40}) .+ <[^<>]*> (\d+) [+-]\d{4}(?:\t.*)?$/.exec(line.replace(/\r$/, ''));
      return match ? { old: match[1], head: match[2], at: Number(match[3]) } : undefined;
    });
    if (!rows.length || rows.some(row => !row)) return;
    const valid = rows as Array<{ old: string; head: string; at: number }>;
    const before = valid.filter(row => row.at <= second);
    if (!before.length || valid.some(row => row.at === second)) return;
    const chosen = before.at(-1)!;
    const tail = valid.slice(valid.indexOf(chosen));
    if (tail.some((row, i) => i > 0 && (row.old !== tail[i - 1].head || row.at < tail[i - 1].at))
      || tail.at(-1)!.head !== git(root, ['rev-parse', 'HEAD'])) return;
    return git(root, ['rev-parse', '--verify', `${chosen.head}^{commit}`]);
  } catch { return; }
}

const referencePattern = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)?[\p{L}\p{N}_@.\-/\\]+\.[a-zA-Z0-9]+/gu;

function references(text: string): string[] {
  return [...new Set([
    ...[...text.matchAll(/`([^`\r\n]+\.[\p{L}\p{N}]+)`/gu)].map(match => match[1]),
    ...[...text.matchAll(referencePattern)].map(match => match[0]),
  ])];
}

function projectReferences(root: string, text: string): string[] {
  return [...new Set(references(text).flatMap(file => {
    try { return [path.relative(root, nativePath(root, file)).replace(/\\/g, '/')]; } catch { return []; }
  }))];
}

function readableReferences(root: string, text: string): string[] {
  return projectReferences(root, text).filter(file => {
    try {
      const absolute = nativePath(root, file);
      fs.accessSync(absolute, fs.constants.R_OK);
      return fs.statSync(absolute).isFile();
    } catch { return false; }
  });
}

/** Only an actual user reference that disambiguates this request can extend it. */
function refersToRequest(message: NativeMessage, origin: NativeMessage, earlier: NativeMessage[], root: string, targets: string[]): boolean {
  if (!/(?:纠正|更正|继续|刚才|原请求|原任务|原验收|仍然|仍未|还是|接着|补跑|补验|恢复|correction|continue|still)/i.test(message.text)
    || /(?:另外|另一个|新请求|新任务|separate request|new task)/i.test(message.text)) return false;
  if (message.text.includes(origin.id) && !/(?:引用|举例|example|quote)/i.test(message.text)) return true;
  const candidates = new Set([...projectReferences(root, origin.text), ...targets]);
  if (projectReferences(root, message.text).some(file => candidates.has(file)
    && !earlier.some(other => other.id !== origin.id && projectReferences(root, other.text).includes(file)))) return true;
  const text = origin.text + ' ' + targets.join(' ');
  const businessPhrases = message.text.replace(/刚才|原请求|原任务|原验收|继续|纠正|更正|还是|仍然|还是|还有/g, ' ')
    .match(/[\p{Script=Han}]{4,}|\bAC-\d+\b/gu) ?? [];
  return businessPhrases.some(phrase => {
    const anchors = phrase.startsWith('AC-') ? [phrase] : Array.from({ length: phrase.length - 3 }, (_, index) => phrase.slice(index, index + 4));
    return anchors.some(anchor => text.includes(anchor)
      && !earlier.some(other => other.id !== origin.id && other.text.includes(anchor)));
  });
}

function compareFullAttribution(root: string, frameworkRoot: string, origin: NativeMessage, tools: NativeTool[], targets: string[]) {
  const permittedGit = (tool: NativeTool, command: RegExp) => {
    const input = tool.input as { cwd?: string; workdir?: string };
    return native.toolSucceeded(tool) && native.samePath(input?.cwd ?? input?.workdir ?? root, root) && command.test(native.toolInput(tool).trim());
  };
  const capture = tools.find(tool => permittedGit(tool, /^git rev-parse (?:--verify )?HEAD$/) && /^[\da-f]{40}$/i.test(tool.output.trim()));
  const status = tools.find(tool => permittedGit(tool, /^git status(?:\s+(?:--porcelain(?:=v1)?|--short|-s|--untracked-files=all|-uall))+$/));
  const base = capture?.output.trim() ?? (origin.at ? requestStartFromReflog(root, origin.at) : undefined);
  if (!base || !status) return { unresolved: [], gaps: ['完整 diff 归属缺少可信的开工提交、状态或作者原件'] };
  const diff = diffChangedFilesWithStatus({ projectRoot: root, baseRef: base });
  if (!diff.executed) return { unresolved: [], gaps: [`完整 diff 归属缺少可核比较范围：${diff.error}`] };
  const disclosures: NonNullable<RequestIntake['attribution_disclosures']> = [];
  const unresolved = diff.entries.filter(entry => {
    const file = entry.path;
    try {
      if (!isProductTarget(root, frameworkRoot, file, targets)) return false;
      const writes = tools.filter(tool => native.editedPaths([tool], true).some(candidate => {
        try { return nativePath(root, candidate) === nativePath(root, file); } catch { return false; }
      }));
      const write = writes.at(-1);
      if (!write || !native.toolSucceeded(write) || !native.toolCompletedBefore(status, write.line)
        || capture && !native.toolCompletedBefore(capture, write.line) || entry.oldPath) return true;
      const openingStatus = status.output.split(/\r?\n/).filter(Boolean);
      if (openingStatus.some(row => row.slice(3).replace(/\\/g, '/').includes(file))) return true;
      const input = write.input as { content?: string };
      if (!/^write$/i.test(write.name) || typeof input?.content !== 'string'
        || !fs.readFileSync(nativePath(root, file)).equals(Buffer.from(input.content))) return true;
      disclosures.push({ path: file, reason: `开工比较 ${base}，${toolLocation(write)} 成功写入的字节与现文件一致` });
      return false;
    } catch { return true; }
  }).map(entry => entry.path);
  return { unresolved, disclosures, gaps: unresolved.length ? [`完整 diff 归属缺少可信的开工状态与作者原件：${unresolved.join('、')}`] : [] };
}

export function resolveRequestSessionReference(requested?: string, projectRoot?: string): { sessionRef?: string; gap?: string } {
  if (requested) return { sessionRef: requested };
  const located = native.currentNativeSession(process.env, projectRoot);
  if (located.file && located.cwd && projectRoot) {
    if (!native.samePath(located.cwd, projectRoot)) return { gap: '当前精确原生线程不属于本项目目录或目录无法核实；仅可核本次显式局部目标' };
  }
  return located.file ? { sessionRef: located.file } : { gap: located.gap };
}

export function readRequestIntake(options: { projectRoot: string; frameworkRoot: string; sessionRef?: string; explicitTargets?: string[]; previous?: RequestIntake }): RequestIntake {
  const root = fs.realpathSync(options.projectRoot);
  const location = resolveRequestSessionReference(options.sessionRef ?? options.previous?.session_ref, root);
  if (!location.sessionRef) throw new Error(location.gap);
  const session = native.readNativeSession(location.sessionRef, root);
  const allUsers = session.messages.filter(message => message.role === 'user');
  const selected = session.request;
  const priorUsers = allUsers.filter(user => user.line < selected.line);
  const previousReferences = location.sessionRef.includes('#') ? [] : priorUsers.filter(user => refersToRequest(selected, user, priorUsers, root, []));
  const origin = previousReferences.length === 1 ? previousReferences[0] : selected;
  if (options.previous && (options.previous.session_id !== session.sessionId || options.previous.user.id !== origin.id || options.previous.user.text !== origin.text)) {
    throw new Error('原request不属于本次定位的真实用户请求');
  }
  const explicit = [...new Set((options.explicitTargets ?? options.previous?.explicit_targets ?? []).map(file =>
    path.relative(root, realProjectPath(root, file, 'target')).replace(/\\/g, '/')))].sort();
  const relatedUsers = new Set([origin.id]);
  for (const user of allUsers) {
    if (user.line > origin.line && refersToRequest(user, origin, allUsers.filter(other => other.line < user.line && !relatedUsers.has(other.id)), root, explicit)) {
      relatedUsers.add(user.id);
    }
  }
  const belongs = (record: NativeMessage | NativeTool | NativeAssociation): boolean => relatedUsers.has(record.origin?.store === 'opencode'
    ? record.origin.parentId ?? ('id' in record ? record.id : '') : allUsers.filter(user => user.line <= record.line).at(-1)?.id ?? '');
  const messages = session.messages.filter(message => message.line >= origin.line && belongs(message));
  const tools = session.tools.filter(tool => tool.line >= origin.line && belongs(tool));
  const facts = {} as DeliveryFacts;
  const factKeys = Object.keys(labels) as Array<keyof DeliveryFacts>;
  for (const key of factKeys) facts[key] = { value: 'unknown', reason: `${labels[key]}尚无带来源的调研判断`, sources: [] };
  const factLabel = new RegExp(`(${Object.values(labels).join('|')})\\s*[=:：]\\s*(是|否|未知|true|false|unknown)`, 'gi');
  for (const message of messages.filter(message => message.role === 'assistant')) {
    const matches = [...message.text.matchAll(factLabel)];
    if (!matches.length) continue;
    // A cited path in a judgment belongs to that judgment. A shared basis before
    // the labels or introduced explicitly after them can support the other labels.
    const last = matches.at(-1)!;
    const lastEnd = last.index! + last[0].length;
    const sharedStart = /[。；;\n]\s*[*_]*\s*(?:判(?:断|档)依据|共同依据|依据|来源)(?:[（(][^）)]*[）)])?\s*[:：]?/.exec(message.text.slice(lastEnd));
    const common = message.text.slice(0, matches[0].index) + (sharedStart ? message.text.slice(lastEnd + sharedStart.index) : '');
    for (const [index, match] of matches.entries()) {
      const key = factKeys.find(id => labels[id].toLowerCase() === match[1].toLowerCase())!;
      const end = matches[index + 1]?.index ?? (sharedStart ? lastEnd + sharedStart.index : message.text.length);
      const line = message.text.slice(match.index, end);
      const cited = references(line).length ? line : references(common).length ? common : message.text;
      const sources = readableReferences(root, cited);
      const raw = match[2].toLowerCase();
      const value = !sources.length || raw === '未知' || raw === 'unknown' ? 'unknown' : raw === '是' || raw === 'true';
      const previous = facts[key];
      if (previous.value !== 'unknown' && previous.value !== value && value !== 'unknown'
        && !sources.some(file => !previous.sources.includes(file)) && !/(?:纠正|更正|原(?:判断|事实).{0,8}(?:错误|有误))/.test(message.text)) continue;
      facts[key] = { value, reason: line.trim(), sources };
    }
  }
  const boundary = { origin_user_id: origin.id, explanation: '已定位原始真实用户请求及其明确指向的补充', source_line: origin.line };
  let control: RequestIntake['control'] = { exempt: false, scope: 'request', excluded: [], sources: [] };
  for (const message of allUsers.filter(message => session.userControlVerified !== false)) {
    const change = native.userControl(message.text);
    const current = relatedUsers.has(message.id);
    if (current && change.transport) control.transport = { mode: change.transport, source: `${session.file}#${message.id}` };
    if (current && change.fullDiffAttribution !== undefined) control.full_diff_attribution = change.fullDiffAttribution;
    if (change.revoke && (current || control.scope === 'session')) control = { ...control, exempt: false, sources: [...control.sources, `${session.file}#${message.id}`] };
    if (change.exempt && (change.session || current)) control = { ...control, exempt: true, scope: change.session ? 'session' : 'request', sources: [...control.sources, `${session.file}#${message.id}`] };
    if (current && (change.fixed || change.excluded.length)) control = { ...control, ...(change.fixed ? { fixed: scales[change.fixed] } : {}), excluded: [...new Set([...control.excluded, ...change.excluded])], sources: [...control.sources, `${session.file}#${message.id}`] };
    if (current && change.included.length) control = { ...control, excluded: control.excluded.filter(family => !change.included.includes(family)), sources: [...control.sources, `${session.file}#${message.id}`] };
  }
  const legacyBaseline = options.previous?.baseline;
  const baseline: RequestIntake['baseline'] = {
    head: 'WORKTREE', source: legacyBaseline?.source ?? 'unknown',
    ...(legacyBaseline?.base ? { base: legacyBaseline.base } : {}),
    detail: '内容影响另用当前 HEAD 比较；保留原请求已记录的身份', initial_dirty: 'unknown',
  };
  const targets = [...new Set([...explicit, ...projectReferences(root, origin.text).filter(file => {
    try { return isProductTarget(root, options.frameworkRoot, file) && fs.statSync(nativePath(root, file)).isFile(); } catch { return false; }
  })])].sort();
  const rejectedAssociations = (session.associations ?? []).filter(record => record.line >= origin.line && belongs(record));
  const source_results = [
    ...tools.filter(tool => !native.toolSucceeded(tool)).map(tool => ({
      detail: `${toolLocation(tool)} ${tool.error ? '执行失败' : '工具结果尚未配对'}`,
      paths: [...new Set([...projectReferences(root, native.toolInput(tool)), ...native.editedPaths([tool], true).flatMap(file => projectReferences(root, file))])],
    })),
    ...rejectedAssociations.map(record => ({ detail: record.detail, paths: [] })),
    ...(session.gaps ?? []).map(detail => ({ detail, paths: [] })),
  ];
  const { unresolved: attribution_unknown, disclosures, gaps } = control.full_diff_attribution
    ? compareFullAttribution(root, options.frameworkRoot, origin, tools, targets) : { unresolved: [], disclosures: undefined, gaps: [] };
  return { session_ref: `${session.file}#${origin.id}`, session_id: session.sessionId,
    user: { id: origin.id, text: origin.text, at: origin.at, line: origin.line },
    user_messages: allUsers.filter(message => relatedUsers.has(message.id)).map(message => ({ id: message.id, text: message.text, at: message.at, line: message.line })), boundary,
    control, facts, policy: resolveDeliveryPolicy(facts, control.fixed), baseline, explicit_targets: explicit, targets, attribution_unknown,
    ...(disclosures?.length ? { attribution_disclosures: disclosures } : {}),
    ...(source_results.length ? { source_results } : {}), content_fingerprint: requestTargetFingerprint(root, targets), gaps };
}

export function requestTargetFingerprint(root: string, targets: readonly string[]): string {
  return crypto.createHash('sha256').update(JSON.stringify([...new Set(targets)].sort().map(file => {
    const absolute = nativePath(root, file);
    return [file, fs.existsSync(absolute) && fs.statSync(absolute).isFile()
      ? crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') : null];
  }))).digest('hex');
}

export function intakeIdentity(intake: RequestIntake): string {
  return crypto.createHash('sha256').update(`${intake.session_id}\n${intake.user.id}`).digest('hex').slice(0, 16);
}
