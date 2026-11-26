'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

function canonical(file) {
  const value = fs.realpathSync(file.replace(/^\\\\\?\\/, ''));
  return process.platform === 'win32' ? value.toLowerCase() : value;
}
function samePath(left, right) { try { return canonical(left) === canonical(right); } catch { return false; } }
function sessionRoot(env) { return path.join(env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'sessions'); }

// RFC 8878 frame boundaries only; native zlib still validates and decompresses each frame.
// Node's zstd decoder can return partial output without throwing on a truncated frame.
class IncompleteDshFrameError extends Error {}
function frameEnd(bytes, start) {
  const requireBytes = end => { if (end > bytes.length) throw new IncompleteDshFrameError('incomplete Zstandard frame'); return end; };
  if (start + 4 > bytes.length) {
    const prefix = bytes.subarray(start);
    if (!prefix.every((byte, index) => byte === [0x28, 0xb5, 0x2f, 0xfd][index])
      && !prefix.every((byte, index) => index === 0 ? byte >= 0x50 && byte <= 0x5f : byte === [0x50, 0x2a, 0x4d, 0x18][index])) throw new Error('invalid Zstandard frame');
  }
  requireBytes(start + 4);
  const magic = bytes.readUInt32LE(start);
  if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
    requireBytes(start + 8);
    return requireBytes(start + 8 + bytes.readUInt32LE(start + 4));
  }
  if (magic !== 0xfd2fb528) throw new Error('invalid Zstandard frame');
  requireBytes(start + 5);
  const descriptor = bytes[start + 4], single = (descriptor & 32) !== 0, sizeFlag = descriptor >>> 6;
  if (descriptor & 8) throw new Error('reserved Zstandard frame bit');
  let offset = requireBytes(start + 5 + (single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3]
    + (sizeFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][sizeFlag]));
  for (;;) {
    requireBytes(offset + 3);
    const block = bytes.readUIntLE(offset, 3), type = (block >>> 1) & 3;
    if (type === 3) throw new Error('reserved Zstandard block type');
    if ((block >>> 3) > 128 * 1024) throw new Error('invalid Zstandard block size');
    offset = requireBytes(offset + 3 + (type === 1 ? 1 : block >>> 3));
    if (block & 1) return requireBytes(offset + ((descriptor & 4) ? 4 : 0));
  }
}

/** DSH writes independent Zstandard frames; an active writer may leave a partial last frame. */
function decodeDshSession(bytes, allowIncompleteTail = false) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length;) {
    try {
      const end = frameEnd(bytes, offset);
      const decoded = zlib.zstdDecompressSync(bytes.subarray(offset, end), { info: true });
      const consumed = decoded.engine.bytesWritten;
      if (!(consumed > 0)) throw new Error('invalid Zstandard frame');
      chunks.push(decoded.buffer); offset += consumed;
    } catch (error) { if (allowIncompleteTail && error instanceof IncompleteDshFrameError) break; throw error; }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Low-level model and intake consumers share decoding and identity, not authorization policy. */
function readDshSession(file, { sessionId, projectRoot, allowIncompleteTail = false } = {}) {
  const bytes = fs.readFileSync(file);
  const raw = file.endsWith('.zstd') ? decodeDshSession(bytes, allowIncompleteTail) : bytes.toString('utf8');
  const rows = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const record = rows.find(row => row.type === 'session' || row.type === 'session/header' || row.type === 'session_meta');
  const header = record?.data?.header ?? record?.data ?? record?.payload ?? record;
  const id = header?.id ?? header?.sessionId ?? header?.session_id;
  if (typeof id !== 'string' || !id || typeof header.cwd !== 'string' || !header.cwd
    || sessionId && id !== sessionId || projectRoot && !samePath(header.cwd, projectRoot)) {
    throw new Error('DSH 前台原件不属于准确 session / 项目');
  }
  return { file: fs.realpathSync(file), sessionId: id, cwd: fs.realpathSync(header.cwd), header, rows };
}

function isDshSessionFile(file, env = process.env) {
  try {
    const relative = path.relative(canonical(sessionRoot(env)), canonical(file));
    const parts = relative.split(path.sep);
    return parts.length === 3 && parts[0] !== '..' && /^session-[a-zA-Z0-9-]+$/.test(parts[1]) && parts[2] === 'session.v4.jsonl.zstd';
  } catch { return false; }
}

/** Exact SID only. Never select a recent session, and never read unrelated session bodies. */
function locateDshSession(sessionId, env = process.env, file) {
  if (!/^session-[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error('DSH_SESSION_ID 不是准确原生 session ID');
  const root = sessionRoot(env);
  const files = file ? [file] : fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter(row => row.isDirectory())
    .map(row => path.join(root, row.name, sessionId, 'session.v4.jsonl.zstd')).filter(value => fs.existsSync(value)) : [];
  if (files.length !== 1 || !isDshSessionFile(files[0], env) || path.basename(path.dirname(files[0])) !== sessionId) {
    throw new Error('DSH_SESSION_ID 未定位到唯一原生会话');
  }
  return { file: fs.realpathSync(files[0]), sessionId };
}

function currentDshSession(env = process.env) {
  if (!env.DSH_SESSION_ID || !env.DSH_HOME) return { gap: 'DSH 前台 shell 的 session/home 环境不完整' };
  try { return locateDshSession(env.DSH_SESSION_ID, env); }
  catch (error) { return { gap: error.message }; }
}

function contentText(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n') : '';
}

function readDshRequestSession(reference, projectRoot, { resultFailed = () => false, env = process.env } = {}) {
  const split = reference.lastIndexOf('#');
  const file = split < 0 ? reference : reference.slice(0, split);
  const selected = split < 0 ? undefined : reference.slice(split + 1);
  if (!isDshSessionFile(file, env)) throw new Error('DSH 原件不在已配置客户端的原生存储内');
  const session = readDshSession(file, { sessionId: path.basename(path.dirname(file)), projectRoot, allowIncompleteTail: true });
  const { header, rows } = session;
  if (header.parentSession || header.origin === 'subagent' || header.delegationDepth > 0 || header.isSeeded === true) {
    throw new Error('DSH 子代理或继承 seed 原件不能冒充根用户原请求或授权');
  }
  const messages = [], tools = [], associations = [], pending = new Map(), jobs = new Map();
  for (const row of rows) if (row.type === 'job/settled' && typeof row.data?.toolCall?.callId === 'string') {
    const callId = row.data.toolCall.callId;
    jobs.set(callId, [...(jobs.get(callId) ?? []), row.data]);
  }
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], data = row.data, line = index + 1;
    const at = typeof row.time === 'number' ? new Date(row.time).toISOString() : undefined;
    const role = row.type === 'user/message' && data?.role === 'user' && data.source?.kind === 'user' ? 'user'
      : row.type === 'assistant/message' ? 'assistant' : row.type === 'compaction/summary' ? 'summary' : undefined;
    const message = row.type === 'assistant/message' ? data?.message : row.type === 'compaction/summary'
      ? { id: data?.compactionId, content: data?.summary } : data;
    if (role && typeof message?.id === 'string') {
      const text = contentText(message.content);
      if (text) messages.push({ id: message.id, role, text, at, line });
    }
    if (row.type === 'tool/call' && typeof data?.callId === 'string' && Number.isInteger(row.seq)) {
      let input = data.arguments;
      try { input = JSON.parse(input); } catch { /* Preserve the native argument text when decoding fails. */ }
      pending.set(row.seq, { name: data.name, input, line, at, output: '', completed: false,
        origin: { store: 'dsh', callId: data.callId, callSeq: row.seq } });
    }
    if (row.type !== 'tool/result') continue;
    const callSeqs = [...new Set((row.sourceEventSeqs ?? []).filter(seq => pending.has(seq)))];
    const call = callSeqs.length === 1 ? pending.get(callSeqs[0]) : undefined, result = data?.message;
    if (!call || result?.toolCallId !== call.origin.callId || result?.source?.callId !== call.origin.callId || result.source.kind !== 'tool') {
      const candidates = [...pending.values()].filter(tool => callSeqs.includes(tool.origin.callSeq)
        || tool.origin.callId === result?.toolCallId || tool.origin.callId === result?.source?.callId);
      const detail = `DSH 工具结果 seq=${row.seq} 关联错配（引用 seq=${(row.sourceEventSeqs ?? []).join(',') || '缺失'}，result ID=${result?.toolCallId ?? '缺失'}，source ID=${result?.source?.callId ?? '缺失'}）`;
      for (const candidate of candidates.length ? candidates : [{ line }]) associations.push({ ...candidate, detail: candidate.origin
        ? `${detail}，调用 seq=${candidate.origin.callSeq} ID=${candidate.origin.callId}` : detail });
      continue;
    }
    const output = contentText(result.content), meta = data.meta;
    const settledFailure = (jobs.get(call.origin.callId) ?? []).some(job => job.status === 'failed' || job.status === 'cancelled'
      || /^exit code:\s*(-?\d+)$/i.test(job.detail ?? '') && Number(/^exit code:\s*(-?\d+)$/i.exec(job.detail)[1]) !== 0);
    const error = result.isError === true || resultFailed({ output, is_error: result.isError }) || settledFailure
      || /^(?:pwsh|bash|shell|exec)$/i.test(call.name) && /\[exit code:\s*-?[1-9]\d*\]/i.test(output);
    // meta.lines can cover every line but omits the original last newline.
    const read = /^read$/i.test(call.name) ? { path: meta?.path ?? call.input?.file_path ?? call.input?.path,
      content: Array.isArray(meta?.lines) ? meta.lines.map(value => value.text).join('\n') : output,
      complete: meta?.offset === 1 && Array.isArray(meta.lines) && meta.lines.length === meta.totalLines
        && meta.lines.every((value, index) => value.number === index + 1 && typeof value.text === 'string'), exact: false } : undefined;
    tools.push({ ...call, output, error, completed: true, resultLine: line, origin: { ...call.origin, resultSeq: row.seq }, ...(read ? { read } : {}) });
    pending.delete(callSeqs[0]);
  }
  const users = messages.filter(message => message.role === 'user');
  const request = selected ? users.find(message => message.id === selected) : users.at(-1);
  if (!request) throw new Error('DSH 找不到定位的真实 user 消息；原件可能尚未落盘');
  tools.push(...pending.values());
  tools.sort((left, right) => left.line - right.line);
  return { file: session.file, sessionId: session.sessionId, cwd: session.cwd, request, messages, tools, associations };
}

module.exports = { decodeDshSession, readDshSession, locateDshSession, currentDshSession, isDshSessionFile, readDshRequestSession };
