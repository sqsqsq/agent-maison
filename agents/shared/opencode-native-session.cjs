'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

function samePath(left, right) {
  try {
    const canonical = value => fs.realpathSync(value).replace(/^\\\\\?\\/, '');
    return process.platform === 'win32' ? canonical(left).toLowerCase() === canonical(right).toLowerCase() : canonical(left) === canonical(right);
  } catch { return false; }
}
function openCodeDatabase(env = process.env, home = os.homedir()) {
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local/share'), 'opencode/opencode.db');
}
function withOpenCodeSession(database, sessionId, cwd, consume, rootOnly = false) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const session = db.prepare('SELECT * FROM session WHERE id=?').get(sessionId);
    if (!session || !samePath(session.directory, cwd)) {
      if (rootOnly) throw new Error('OpenCode 原生会话与准确 session/项目不匹配');
      return undefined;
    }
    if (rootOnly && session.parent_id) throw new Error('OpenCode 子会话不能冒充根用户原请求或授权');
    return consume(db, session);
  } finally { db.close(); }
}
function reference(database, sessionId, callId) {
  return `opencode:${database}?session=${encodeURIComponent(sessionId)}${callId ? '&call=' + encodeURIComponent(callId) : ''}`;
}
function currentOpenCodeSession(env = process.env) {
  const sessionId = env.MAISON_OPENCODE_SESSION_ID, callId = env.MAISON_OPENCODE_CALL_ID;
  if (!sessionId || !callId) return { gap: 'OpenCode 当前 shell 未提供准确 sessionID/callID；PTY 不据 cwd 推断会话' };
  const database = openCodeDatabase(env);
  if (!fs.existsSync(database)) return { gap: 'OpenCode 原生 SQLite 不可用' };
  return { file: reference(database, sessionId, callId), sessionId };
}
function parseReference(value, env) {
  if (!value.startsWith('opencode:')) throw new Error('不是 OpenCode 原生引用');
  const hash = value.lastIndexOf('#'), query = value.indexOf('?');
  if (query < 0) throw new Error('OpenCode 原生引用缺准确 session');
  const database = value.slice('opencode:'.length, query);
  if (!samePath(database, openCodeDatabase(env))) throw new Error('OpenCode 原件不在已配置客户端的原生 SQLite 内');
  const params = new URLSearchParams(value.slice(query + 1, hash < 0 ? undefined : hash));
  const sessionId = params.get('session'), callId = params.get('call'), userId = hash < 0 ? undefined : value.slice(hash + 1);
  if (!sessionId || !userId && !callId) throw new Error('OpenCode 原生引用须有准确 user 或本次 callID，不选择最近消息');
  return { database, sessionId, callId, userId };
}
function snapshotRead(project, session, parts, part, display, database) {
  const step = parts.filter(item => item.message_id === part.message_id && item.data.type === 'step-start' && item.time_created <= part.time_created).at(-1);
  if (!step || !/^[a-f0-9]{40}$/.test(step.data.snapshot || '')) return undefined;
  // A prior tool in the same step may have changed bytes after the step snapshot.
  if (parts.some(item => item.message_id === part.message_id && item.data.type === 'tool' && item.time_created > step.time_created && item.time_created < part.time_created)) return undefined;
  if (!project) return undefined;
  const sessionRelative = path.relative(fs.realpathSync(project.worktree), fs.realpathSync(session.directory));
  if (sessionRelative.startsWith('..') || path.isAbsolute(sessionRelative)) return undefined;
  const relative = path.relative(project.worktree, path.resolve(session.directory, display.path)).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative) || !/^[a-zA-Z0-9_-]+$/.test(session.project_id)) return undefined;
  const directoryHash = createHash('sha1').update(path.resolve(project.worktree)).digest('hex');
  const gitdir = path.join(path.dirname(database), 'snapshot', session.project_id, directoryHash);
  try {
    const bytes = execFileSync('git', ['--git-dir', gitdir, 'cat-file', 'blob', `${step.data.snapshot}:${relative}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    const content = bytes.toString('utf8');
    if (!Buffer.from(content).equals(bytes)) return undefined;
    if (content.replace(/\r\n/g, '\n').replace(/\n$/, '') !== display.text) return undefined;
    return { content, snapshot: step.data.snapshot, snapshotPartId: step.id };
  } catch { return undefined; }
}
function readOpenCodeSession(ref, projectRoot, env = process.env) {
  const { database, sessionId, callId, userId } = parseReference(ref, env);
  return withOpenCodeSession(database, sessionId, projectRoot, (db, session) => {
    const rows = db.prepare('SELECT id,time_created,data FROM message WHERE session_id=? ORDER BY time_created,id').all(sessionId).map(row => ({ ...row, data: JSON.parse(row.data) }));
    const parts = db.prepare('SELECT id,message_id,time_created,time_updated,data FROM part WHERE session_id=? ORDER BY time_created,id').all(sessionId).map(row => ({ ...row, data: JSON.parse(row.data) }));
    const byId = new Map(rows.map(row => [row.id, row]));
    const isCompaction = row => row.data.summary === true || parts.some(part => part.message_id === row.id && part.data.type === 'compaction');
    let selected = userId;
    if (!selected) {
      const current = parts.filter(part => part.data.type === 'tool' && part.data.callID === callId);
      if (current.length !== 1) throw new Error('OpenCode 当前 callID 没有唯一原生 tool part（可能尚未落盘）');
      const assistant = byId.get(current[0].message_id);
      if (!assistant || assistant.data.role !== 'assistant' || isCompaction(assistant)) throw new Error('OpenCode 当前工具不属于真实 assistant 请求');
      selected = assistant.data.parentID;
    }
    // These are normalized event positions, never purported SQLite/JSONL line numbers.
    const events = [...rows.map(row => ({ id: row.id, at: row.time_created })), ...parts.filter(part => ['text', 'tool'].includes(part.data.type)).map(part => ({ id: part.id, at: part.data.state?.time?.start ?? part.data.time?.start ?? part.time_created }))].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const order = new Map(events.map((event, index) => [event.id, index + 1]));
    const messages = [];
    for (const row of rows) {
      if (!['user', 'assistant'].includes(row.data.role)) continue;
      const compact = isCompaction(row);
      const textParts = parts.filter(part => part.message_id === row.id && part.data.type === 'text' && !part.data.synthetic && !part.data.ignored && !part.data.metadata?.compaction_continue);
      for (const messageParts of row.data.role === 'assistant' && !compact ? textParts.map(part => [part]) : [textParts]) {
        const text = compact && row.data.role !== 'assistant' ? '' : messageParts.map(part => part.data.text).filter(value => typeof value === 'string').join('\n');
        if (!text && !compact) continue;
        const at = row.data.role === 'assistant' && messageParts.length ? Math.max(...messageParts.map(part => part.data.time?.end ?? part.time_updated)) : row.data.time?.created ?? row.time_created;
        const line = order.get(row.data.role === 'assistant' && !compact ? messageParts[0].id : row.id);
        messages.push({ id: row.id, role: compact ? 'summary' : row.data.role, text, at: new Date(at).toISOString(), line, origin: { store: 'opencode', messageId: row.id, parentId: row.data.parentID, partIds: messageParts.map(part => part.id), order: 'normalized' } });
      }
    }
    messages.sort((left, right) => left.line - right.line);
    const request = messages.find(message => message.role === 'user' && message.id === selected);
    if (!request) throw new Error('OpenCode 找不到定位的非 synthetic/ignored/compaction 真实 user 消息');
    const tools = [], associations = [], calls = new Map();
    for (const part of parts.filter(part => part.data.type === 'tool')) {
      const assistant = byId.get(part.message_id);
      if (!assistant || assistant.data.role !== 'assistant' || isCompaction(assistant)) continue;
      const data = part.data, state = data.state ?? {}, name = ({ read: 'Read', edit: 'Edit', write: 'Write', bash: 'Bash' })[data.tool] ?? data.tool;
      const completed = ['completed', 'error'].includes(state.status) && Number.isFinite(state.time?.end);
      const error = state.status === 'error' || data.tool === 'bash' && (state.status === 'completed' && state.metadata?.exit !== 0);
      const tool = { name, input: { ...(state.input ?? {}), ...(typeof state.input?.filePath === 'string' ? { file_path: state.input.filePath } : {}), ...(typeof state.input?.patchText === 'string' ? { patch: state.input.patchText } : {}) }, output: state.output ?? state.error ?? '', line: order.get(part.id), completed, error,
        startedTime: state.time?.start, completionTime: completed ? state.time.end : undefined,
        origin: { store: 'opencode', sessionId, messageId: part.message_id, parentId: assistant.data.parentID, partId: part.id, callId: data.callID, status: state.status, order: 'normalized', exit: state.metadata?.exit } };
      const prior = calls.get(data.callID);
      if (typeof data.callID !== 'string' || !data.callID || prior) {
        const detail = prior ? `OpenCode callID ${data.callID} 重复关联到 part ${prior.origin.partId}、${part.id}` : `OpenCode tool part ${part.id} 缺少 callID`;
        for (const candidate of prior ? [prior, tool] : [tool]) {
          candidate.error = true;
          associations.push({ line: candidate.line, origin: candidate.origin, detail });
        }
      }
      calls.set(data.callID, tool);
      const display = state.metadata?.display;
      if (name === 'Read' && completed && !error && display?.type === 'file' && typeof display.path === 'string' && typeof display.text === 'string') {
        const complete = display.lineStart === 1 && display.lineEnd === display.totalLines && display.truncated === false;
        tool.read = { path: display.path, content: display.text, complete, exact: false };
        if (complete) {
          const project = db.prepare('SELECT worktree FROM project WHERE id=?').get(session.project_id);
          tool.readExact = () => {
            try {
              const snapshot = snapshotRead(project, session, parts, part, display, database);
              return snapshot ? { path: display.path, content: snapshot.content, complete: true, exact: true, snapshot: snapshot.snapshot, snapshotPartId: snapshot.snapshotPartId } : undefined;
            } catch { return undefined; }
          };
        }
      }
      tools.push(tool);
    }
    tools.sort((left, right) => left.line - right.line);
    return { file: reference(fs.realpathSync(database), sessionId), sessionId, cwd: fs.realpathSync(session.directory), request, messages, tools, associations, origin: { store: 'opencode', order: 'normalized' } };
  }, true);
}
module.exports = { openCodeDatabase, withOpenCodeSession, currentOpenCodeSession, readOpenCodeSession, reference };
