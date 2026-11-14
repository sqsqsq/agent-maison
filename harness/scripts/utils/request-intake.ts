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
interface NativeTool { name: string; input: unknown; output: string; line: number; resultLine?: number; error?: boolean; completed?: boolean; startedTime?: number; completionTime?: number; read?: NativeRead; readExact?(): NativeRead | undefined; origin?: { store?: string; parentId?: string; partId?: string; callId?: string } }
interface NativeSession { file: string; sessionId: string; cwd: string; request: NativeMessage; messages: NativeMessage[]; tools: NativeTool[]; userControlVerified?: boolean; gaps?: string[]; origin?: { store?: string } }
const native = require('../../../agents/shared/native-request.cjs') as {
  currentNativeSession(env?: NodeJS.ProcessEnv, projectRoot?: string): { file?: string; cwd?: string; gap?: string };
  samePath(left: string, right: string): boolean;
  toolSucceeded(tool: NativeTool): boolean;
  toolCompletedBefore(tool: NativeTool, message: NativeMessage | number): boolean;
  isEditingTool(tool: NativeTool): boolean;
  readNativeSession(reference: string, projectRoot: string): NativeSession;
  userControl(message: string): { exempt: boolean; session: boolean; revoke: boolean; fixed?: string; excluded: string[]; included: string[] };
  editedPaths(tools: NativeTool[]): string[];
  frontDoorLoaded(session: NativeSession, projectRoot: string, frameworkRoot: string): boolean;
  toolInput(tool: NativeTool): string;
  productTarget(root: string, frameworkRoot: string, file: string, roots?: string[], explicit?: boolean): boolean;
};

export interface RequestIntake {
  session_ref: string;
  session_id: string;
  user: { id: string; text: string; at?: string; line: number };
  user_messages?: Array<{ id: string; text: string; at?: string; line: number }>;
  boundary: { origin_user_id: string; explanation: string; source_line: number };
  front_door_loaded: boolean;
  control: { exempt: boolean; scope: 'request' | 'session'; fixed?: DeliveryScale; excluded: string[]; sources: string[] };
  facts: DeliveryFacts;
  policy: DeliveryPolicy;
  baseline: { base?: string; head: 'WORKTREE'; source: 'captured' | 'reflog' | 'unknown'; detail: string; initial_dirty: string[] | 'unknown'; preimages?: Record<string, { content: string; source_line: number }> };
  targets: string[];
  attribution_unknown: string[];
  source_reads: string[];
  content_fingerprint: string;
  gaps: string[];
}
const scales: Record<string, DeliveryScale> = { 特别简单: 'trivial', 小型: 'small', 中型: 'medium', 复杂: 'complex' };
export function nativeFixedScale(value?: string): DeliveryScale | undefined { return value ? scales[value] : undefined; }
const labels: Record<keyof DeliveryFacts, string> = { design_tradeoff: 'Q1', unclosed_impact: 'Q2', irreversible_data: 'Q3', dependent_results: '依赖结果', cross_component: '跨部件', expectations_clear: '预期明确', unique_approach: '做法唯一' };
function git(root: string, args: string[]): string { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function nativePath(root: string, file: string): string {
  return realProjectPath(root, path.relative(root, path.resolve(root, file)).replace(/\\/g, '/'), 'native source');
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
      const match = /^([a-f0-9]{40}) ([a-f0-9]{40}) .+> (\d+) [+-]\d{4}\t/.exec(line);
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

function sourceReads(root: string, tools: NativeTool[]): string[] {
  const paths = new Set<string>();
  for (const tool of tools) {
    if (!native.toolSucceeded(tool) || !tool.output.trim() && !tool.read) continue;
    const input = native.toolInput(tool);
    if (!/(?:Read|read_file|exec|shell|command|functions|pwsh|bash)/i.test(tool.name)) continue;
    // Only actual read commands, never an edit mentioning a source path.
    if (!/^(?:Read|read_file)$/i.test(tool.name) && !/(?:Get-Content|\bcat\s|\brg\s|readFile|read_file)/.test(input)) continue;
    for (const match of input.matchAll(/(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[\w.@\-/\\]+\.(?:[cm]?[jt]sx?|ets|json5?|ya?ml|md|sql)/g)) {
      try { const file = nativePath(root, match[0]); if (fs.existsSync(file) && fs.statSync(file).isFile()) paths.add(path.relative(root, file).replace(/\\/g, '/')); } catch { /* Tool paths outside this project are not request sources. */ }
    }
    const structured = tool.input as { file_path?: string; filePath?: string; path?: string };
    for (const file of [structured?.file_path, structured?.filePath, structured?.path]) if (file) {
      try { const abs = nativePath(root, file); if (!fs.existsSync(abs) || fs.statSync(abs).isFile()) paths.add(path.relative(root, abs).replace(/\\/g, '/')); } catch { /* Same boundary. */ }
    }
  }
  return [...paths].sort();
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
  const origin = session.request;
  const allUsers = session.messages.filter(message => message.role === 'user');
  const relatedUsers = new Set<string>([origin.id]);
  const boundaries = new Map<string, NativeMessage>();
  for (let index = 0; index < allUsers.length; index++) {
    const user = allUsers[index];
    if (user.line < origin.line) continue;
    const next = allUsers[index + 1]?.line ?? Infinity;
    const explanation = [...session.messages].reverse().find(message => message.role === 'assistant'
      && (message.origin?.store === 'opencode' ? message.origin.parentId === user.id : message.line > user.line && message.line < next)
      && /(?:本请求|继续原任务|request boundary)/i.test(message.text) && !/新独立请求|new independent request/i.test(message.text)
      && (user.id === origin.id || message.text.includes(origin.id)));
    if (explanation) { relatedUsers.add(user.id); boundaries.set(user.id, explanation); }
  }
  const belongs = (record: NativeMessage | NativeTool): boolean => relatedUsers.has(record.origin?.store === 'opencode'
    ? record.origin.parentId ?? ('id' in record ? record.id : '') : allUsers.filter(user => user.line <= record.line).at(-1)?.id ?? '');
  const messages = session.messages.filter(message => message.line >= origin.line && belongs(message));
  const tools = session.tools.filter(tool => tool.line >= origin.line && belongs(tool));
  const observations = tools.filter(native.toolSucceeded).map(tool => ({ tool, files: sourceReads(root, [tool]) }));
  const reads = [...new Set(observations.flatMap(item => item.files))].sort();
  const facts = {} as DeliveryFacts;
  const anchors = {} as Record<keyof DeliveryFacts, { line: number; known: Set<string> }>;
  for (const key of Object.keys(labels) as Array<keyof DeliveryFacts>) facts[key] = { value: 'unknown', reason: `${labels[key]}尚无带来源的调研判断`, sources: [] };
  for (const message of messages.filter(message => message.role === 'assistant')) {
    const available = observations.filter(item => native.toolCompletedBefore(item.tool, message));
    const known = new Set(available.flatMap(item => item.files));
    for (const key of Object.keys(labels) as Array<keyof DeliveryFacts>) {
      const match = new RegExp(`${labels[key]}\\s*[=:：]\\s*(是|否|未知|true|false|unknown)`, 'i').exec(message.text);
      if (!match) continue;
      const sources = [...known].filter(file => message.text.includes(file));
      if (!sources.length) continue;
      const raw = match[1].toLowerCase();
      const value = raw === '是' || raw === 'true' ? true : raw === '否' || raw === 'false' ? false : 'unknown';
      const anchor = anchors[key];
      if (anchor && facts[key].value !== value) {
        const newBasis = sources.some(file => !anchor.known.has(file));
        const edited = native.editedPaths(tools.filter(tool => tool.line > anchor.line && native.toolCompletedBefore(tool, message))).flatMap(file => {
          try { return [path.relative(root, nativePath(root, file)).replace(/\\/g, '/')]; } catch { return []; }
        });
        const actualChange = sources.some(file => edited.includes(file));
        const correction = /(?:纠正|原(?:判断|事实).{0,8}(?:错误|有误))/.test(message.text);
        if (!newBasis && !actualChange && !correction) continue;
      }
      if (!anchor || facts[key].value !== value || sources.some(file => !facts[key].sources.includes(file))) facts[key] = { value, reason: message.text, sources };
      anchors[key] = { line: message.line, known };
    }
  }
  const latestUser = (session.origin?.store === 'opencode' ? allUsers.filter(user => relatedUsers.has(user.id)) : allUsers).at(-1)!;
  const boundaryMessage = boundaries.get(latestUser.id);
  const associated = relatedUsers.has(latestUser.id);
  const boundary = { origin_user_id: origin.id, explanation: boundaryMessage?.text ?? '当前定位的原始 user 消息；语义请求归属尚待原入口解释', source_line: boundaryMessage?.line ?? origin.line };
  let control: RequestIntake['control'] = { exempt: false, scope: 'request', excluded: [], sources: [] };
  for (const message of session.messages.filter(message => message.role === 'user' && session.userControlVerified !== false)) {
    const change = native.userControl(message.text);
    const current = relatedUsers.has(message.id);
    if (change.revoke && (current || control.scope === 'session')) control = { ...control, exempt: false, sources: [...control.sources, `${session.file}#${message.id}`] };
    if (change.exempt && (change.session || current && boundaryMessage)) control = { ...control, exempt: true, scope: change.session ? 'session' : 'request', sources: [...control.sources, `${session.file}#${message.id}`] };
    if (current && (change.fixed || change.excluded.length)) control = { ...control, ...(change.fixed ? { fixed: scales[change.fixed] } : {}), excluded: [...new Set([...control.excluded, ...change.excluded])], sources: [...control.sources, `${session.file}#${message.id}`] };
    if (current && change.included.length) control = { ...control, excluded: control.excluded.filter(family => !change.included.includes(family)), sources: [...control.sources, `${session.file}#${message.id}`] };
  }
  let baseline: RequestIntake['baseline'] = { head: 'WORKTREE', source: 'unknown', detail: '起始HEAD未核', initial_dirty: 'unknown' };
  const firstWrite = tools.find(native.isEditingTool);
  const beforeWrite = (tool: NativeTool): boolean => !firstWrite || (Number.isFinite(firstWrite.startedTime) ? native.toolCompletedBefore(tool, { id: '', role: '', text: '', at: new Date(firstWrite.startedTime!).toISOString(), line: firstWrite.line }) : native.toolCompletedBefore(tool, firstWrite.line));
  const capture = tools.find(tool => native.toolSucceeded(tool) && beforeWrite(tool) && /git\s+(?:-C\s+\S+\s+)?rev-parse\s+(?:--verify\s+)?HEAD/.test(native.toolInput(tool)) && /\b[a-f0-9]{40}\b/.test(tool.output));
  if (capture) {
    const hashes = [...new Set(capture.output.match(/\b[a-f0-9]{40}\b/g))];
    const location = capture.origin?.partId ? `${session.file} (native part=${capture.origin.partId}${capture.origin.callId ? ', call=' + capture.origin.callId : ''})`
      : Number.isInteger(capture.resultLine) ? `${session.file}:${capture.resultLine}` : `${session.file} (normalized position=${capture.line})`;
    if (hashes.length === 1) try { baseline = { ...baseline, base: git(root, ['rev-parse', '--verify', `${hashes[0]}^{commit}`]), source: 'captured', detail: location }; } catch { /* An unreachable object is unknown. */ }
  }
  if (!baseline.base && origin.at) {
    const base = requestStartFromReflog(root, origin.at);
    if (base) baseline = { ...baseline, base, source: 'reflog', detail: `本worktree HEAD reflog覆盖${origin.at}` };
  }
  const status = tools.find(tool => native.toolSucceeded(tool) && beforeWrite(tool) && /git\s+status\b[^\n]*(?:--porcelain|--short|\s-s(?=[\s"';]|$))/.test(native.toolInput(tool)));
  if (status) baseline.initial_dirty = status.output.split(/\r?\n/).filter(line => /^[ MADRCU?!]{2} /.test(line)).map(line => line.slice(3).split(' -> ').at(-1)!.replace(/\\/g, '/'));
  if (Array.isArray(baseline.initial_dirty)) {
    const preimages: NonNullable<RequestIntake['baseline']['preimages']> = {};
    for (const file of baseline.initial_dirty) {
      const read = tools.find(tool => native.toolSucceeded(tool) && beforeWrite(tool) && /^(?:Read|read|read_file)$/i.test(tool.name)
        && (() => { try { const input = tool.input as { file_path?: string; filePath?: string; path?: string }; return path.relative(root, nativePath(root, input.file_path ?? input.filePath ?? input.path ?? '')).replace(/\\/g, '/') === file; } catch { return false; } })());
      const preimage = read?.readExact?.() ?? read?.read;
      // Raw native results retain exact bytes. Numbered/truncated presentation is not an exact preimage.
      if (read && preimage?.complete && preimage.exact !== false && path.relative(root, nativePath(root, preimage.path)).replace(/\\/g, '/') === file) preimages[file] = { content: preimage.content, source_line: read.resultLine ?? read.line };
      else if (read && !read.read && read.resultLine && read.output && !/^\s*\d+[→\t]|<system-reminder>|truncated|被截断/m.test(read.output)) preimages[file] = { content: read.output, source_line: read.resultLine };
    }
    if (Object.keys(preimages).length) baseline.preimages = preimages;
  }
  if (options.previous) {
    if (options.previous.session_id !== session.sessionId || options.previous.user.id !== origin.id) throw new Error('原request不属于本次定位的请求，不能重置基线或覆盖选择');
    if (baseline.base && options.previous.baseline.base && baseline.base !== options.previous.baseline.base) throw new Error('原request基线与原生起始依据不一致，不能换当前HEAD重置');
  }
  const explicit = (options.explicitTargets ?? []).map(file => path.relative(root, realProjectPath(root, file, 'target')).replace(/\\/g, '/'));
  const edits = native.editedPaths(tools).flatMap(file => { try { return [path.relative(root, nativePath(root, file)).replace(/\\/g, '/')]; } catch { return []; } });
  const diff = baseline.base ? diffChangedFilesWithStatus({ projectRoot: root, baseRef: baseline.base }) : undefined;
  const dirty = baseline.initial_dirty;
  const candidates = [...new Set([...explicit, ...edits, ...(diff?.entries ?? []).filter(entry => dirty !== 'unknown' && !dirty.includes(entry.path) || explicit.includes(entry.path) || edits.includes(entry.path)).map(entry => entry.path)])];
  const targets = candidates.filter(file => isProductTarget(root, options.frameworkRoot, file, [...explicit, ...edits]));
  const attribution_unknown = targets.filter(file => dirty === 'unknown' || dirty.includes(file) && !baseline.preimages?.[file]);
  const content_fingerprint = crypto.createHash('sha256').update(JSON.stringify(targets.sort().map(file => {
    const absolute = nativePath(root, file);
    return [file, fs.existsSync(absolute) ? crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') : null];
  }))).digest('hex');
  const gaps = [...(!baseline.base ? ['起始提交未核：只可执行显式目标检查，不能签全部diff对账'] : []), ...(dirty === 'unknown' ? ['初始dirty未核'] : []), ...(!boundaryMessage ? ['本请求边界解释未核：继续原任务须给原始user消息定位，新需求不能复用旧豁免'] : []), ...(!reads.length ? ['本请求源码调研原件未核'] : []), ...(!targets.length ? ['本请求产品目标未定位'] : [])];
  if (!associated) for (const key of Object.keys(labels) as Array<keyof DeliveryFacts>) facts[key] = { ...facts[key], value: 'unknown', reason: '当前请求未关联到所指原始user；' + facts[key].reason };
  gaps.push(...(session.gaps ?? []));
  return { session_ref: `${session.file}#${origin.id}`, session_id: session.sessionId,
    user: { id: origin.id, text: origin.text, at: origin.at, line: origin.line },
    user_messages: allUsers.filter(message => relatedUsers.has(message.id)).map(message => ({ id: message.id, text: message.text, at: message.at, line: message.line })), boundary,
    front_door_loaded: native.frontDoorLoaded(session, root, options.frameworkRoot), control, facts,
    policy: resolveDeliveryPolicy(facts, control.fixed), baseline, targets, attribution_unknown,
    source_reads: reads, content_fingerprint, gaps };
}

export function intakeIdentity(intake: RequestIntake): string {
  return crypto.createHash('sha256').update(`${intake.session_id}\n${intake.user.id}`).digest('hex').slice(0, 16);
}
