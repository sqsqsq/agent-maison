'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function text(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => text(item?.text ?? item?.content ?? '')).join('\n');
  return '';
}
function unquote(value) {
  return value.replace(/```[\s\S]*?```/g, '').split(/\r?\n/).filter(line => !/^\s*>/.test(line)).join('\n');
}
function canonical(file) {
  const value = fs.realpathSync(file.replace(/^\\\\\?\\/, ''));
  return process.platform === 'win32' ? value.toLowerCase() : value;
}
function samePath(left, right) {
  try { return canonical(left) === canonical(right); } catch { return false; }
}
function inside(root, file) {
  try { const relative = path.relative(canonical(root), canonical(file)); return relative === '' || !relative.startsWith('..') && !path.isAbsolute(relative); } catch { return false; }
}
function codexSession(sessionId, env = process.env) {
  const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const index = path.join(home, 'state_5.sqlite');
  if (!fs.existsSync(index)) return { gap: 'Codex当前精确线程索引state_5.sqlite不可用' };
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(index, { readOnly: true });
    const row = db.prepare('SELECT id, rollout_path, cwd FROM threads WHERE id=?').get(sessionId);
    if (!row || typeof row.rollout_path !== 'string' || !row.rollout_path) return { gap: 'Codex当前精确线程没有可读原件定位' };
    return { file: row.rollout_path, sessionId: row.id, cwd: row.cwd };
  } catch { return { gap: '当前Node运行时无法只读消费Codex精确线程索引' }; }
  finally { db?.close(); }
}
function claudeSession(sessionId, env = process.env, projectRoot) {
  if (!/^[\w-]+$/.test(sessionId)) return { gap: 'Claude当前原生session身份无效' };
  const projects = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  try {
    // Exact SID filename only; never choose a recent transcript or decode a project slug.
    const files = fs.readdirSync(projects, { withFileTypes: true }).filter(item => item.isDirectory())
      .map(item => path.join(projects, item.name, sessionId + '.jsonl')).filter(file => fs.existsSync(file) && inside(projects, file));
    if (files.length !== 1) return { gap: 'Claude当前精确session没有唯一可读原件' };
    // The reader verifies the initial project identity once. Later tool-shell cd is legitimate.
    return { file: files[0], sessionId };
  } catch { return { gap: 'Claude当前精确session原件暂不可读' }; }
}
function currentNativeSession(env = process.env, projectRoot) {
  const openCode = Boolean(env.MAISON_OPENCODE_SESSION_ID || env.MAISON_OPENCODE_CALL_ID || env.OPENCODE_PID);
  if ([openCode, Boolean(env.DSH_SESSION_ID), Boolean(env.CLAUDE_CODE_SESSION_ID)].filter(Boolean).length > 1) return { gap: '多个非Codex宿主会话信号并存；请沿已有原请求session_ref，不能猜内外会话' };
  if (env.MAISON_OPENCODE_SESSION_ID || env.MAISON_OPENCODE_CALL_ID) return require('./opencode-native-session.cjs').currentOpenCodeSession(env, projectRoot);
  if (env.DSH_SESSION_ID) return require('./dsh-native-session.cjs').currentDshSession(env, projectRoot);
  if (env.CLAUDE_CODE_SESSION_ID) return claudeSession(env.CLAUDE_CODE_SESSION_ID, env, projectRoot);
  if (env.OPENCODE_PID) return { gap: 'OpenCode当前调用未提供sessionID/callID桥接；不能借用继承的外层线程' };
  // A sole non-Codex host signal takes precedence over inherited CODEX IDs; use Codex only without other host signals.
  const sessionId = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID;
  return sessionId ? codexSession(sessionId, env) : { gap: '当前原生环境没有精确session/thread定位；可传原生--session-ref' };
}
function nativeStore(file, env = process.env) {
  const claude = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const codeagent = env.CODEAGENT3_CONFIG_DIR || path.join(os.homedir(), '.cac');
  const codex = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  if (inside(path.join(claude, 'projects'), file)) return 'claude';
  if (inside(path.join(codeagent, 'projects'), file)) return 'codeagent';
  if ([path.join(codex, 'sessions'), path.join(codex, 'archived_sessions')].some(root => inside(root, file))) return 'codex';
  if (inside(path.join(os.homedir(), '.cursor', 'projects'), file)) return 'cursor';
  if (inside(path.join(env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'sessions'), file)) return 'dsh';
  throw new Error('原件不在已配置客户端的原生存储内；任意JSONL不授用户豁免/覆盖');
}
function toolSucceeded(tool) { return tool.error !== true && (tool.completed === true || Number.isInteger(tool.resultLine) && tool.resultLine > tool.line); }
function toolCompletedBefore(tool, message) {
  if (tool.completed === true && Number.isFinite(tool.completionTime)) {
    const at = typeof message === 'object' ? Date.parse(message.at) : NaN;
    return Number.isFinite(at) && tool.completionTime < at;
  }
  return Number.isInteger(tool.resultLine) && tool.resultLine < (typeof message === 'object' ? message.line : message);
}
function nativeEnvelopes(output) {
  const values = [];
  for (const line of output.split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line);
      const value = parsed?.value ?? parsed;
      if (value && typeof value.output === 'string' && ('chunk_id' in value || 'wall_time_seconds' in value || 'exit_code' in value)) values.push(value);
    } catch { /* A native output can contain plain text alongside its structured calls. */ }
  }
  return values;
}
function plainToolOutput(output) {
  const values = nativeEnvelopes(output);
  return values.length ? values.map(value => value.output).join('\n') : output;
}
function resultFailed(payload) {
  if (payload.is_error === true || payload.error || typeof payload.exit_code === 'number' && payload.exit_code !== 0) return true;
  const output = text(payload.output);
  if (nativeEnvelopes(output).some(value => typeof value.exit_code === 'number' && value.exit_code !== 0)) return true;
  try {
    const parsed = JSON.parse(output);
    if (parsed.isError === true || parsed.error || typeof parsed.exit_code === 'number' && parsed.exit_code !== 0) return true;
  } catch { /* Most native outputs are text envelopes. */ }
  const prelude = output.split(/\nOutput:/, 1)[0].slice(0, 500);
  return /^(?:Script (?:failed|error)|apply_patch (?:verification )?failed|Failed to find expected lines)/i.test(prelude) || /(?:Process exited with code|Exit code:)\s*[1-9]\d*/.test(prelude);
}
function fullRead(row) {
  const file = row.toolUseResult?.file;
  if (!file || typeof file.filePath !== 'string' || typeof file.content !== 'string') return undefined;
  return { path: file.filePath, content: file.content,
    complete: file.startLine === 1 && file.numLines === file.totalLines && file.content.split('\n').length === file.totalLines };
}
function patchText(tool) {
  if (/^(?:apply_patch|functions\.apply_patch)$/.test(tool.name)) return typeof tool.input === 'string' ? tool.input : tool.input?.patch ?? '';
  if (!/^(?:exec|functions\.exec)$/.test(tool.name) || typeof tool.input !== 'string') return '';
  const call = /\btools\.apply_patch\(\s*("(?:\\.|[^"\\])*")\s*\)/.exec(tool.input);
  try { return call ? JSON.parse(call[1]) : ''; } catch { return ''; }
}
function isEditingTool(tool) {
  return toolSucceeded(tool) && (/^(?:Write|Edit|MultiEdit|NotebookEdit|Delete)$/i.test(tool.name) || patchText(tool).startsWith('*** Begin Patch'));
}

/** Explicitly located session only; no newest-session search or cross-session index. */
function readNativeSession(reference, projectRoot, context = {}) {
  if (reference.startsWith('opencode:')) return require('./opencode-native-session.cjs').readOpenCodeSession(reference, projectRoot);
  const split = reference.lastIndexOf('#');
  const file = split < 0 ? reference : reference.slice(0, split);
  const selected = split < 0 ? undefined : reference.slice(split + 1);
  const store = nativeStore(file);
  if (store === 'dsh') return require('./dsh-native-session.cjs').readDshRequestSession(reference, projectRoot, { resultFailed });
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const meta = rows.find(row => row.type === 'session_meta' || row.type === 'session/header' || row.type === 'session');
  const header = meta?.payload ?? meta?.data?.header ?? meta?.data ?? meta;
  const sessionId = header?.id ?? header?.sessionId ?? header?.session_id ?? rows.find(row => row.sessionId || row.session_id)?.sessionId ?? rows.find(row => row.session_id)?.session_id ?? (store === 'cursor' ? context.sessionId : undefined);
  const cwd = header?.cwd ?? rows.find(row => row.cwd)?.cwd ?? (store === 'cursor' ? context.cwd : undefined);
  if (typeof sessionId !== 'string' || !cwd || !samePath(cwd, projectRoot)) throw new Error('原生会话缺少准确 session/项目身份');
  if (!path.basename(file).includes(sessionId)) throw new Error('原生文件名与session身份不一致');
  if (store !== 'codex' && rows.some(row => row.isSidechain === true || row.agentId)) throw new Error('子代理原件不能冒充根用户原请求或授权');
  if (store === 'codex') {
    const located = codexSession(sessionId);
    if (!located.file || !samePath(located.file, file)) throw new Error(located.gap || 'Codex索引已指向其它历史页，当前分页原件未完整覆盖');
    if (header?.parent_thread_id || header?.thread_source === 'subagent' || header?.source?.subagent) throw new Error('子代理原件不能冒充根用户原请求或授权');
    if (header?.history_base || rows.some(row => row.type === 'history_base')) throw new Error('Codex history_base前段未可靠覆盖；仅可执行局部能力，不签完整请求通过');
  }
  const messages = [];
  const tools = [];
  const pending = new Map();
  let turn;
  let seq = 0;
  for (const row of rows) {
    seq += 1;
    if ((row.sessionId || row.session_id) && (row.sessionId ?? row.session_id) !== sessionId) throw new Error('原件混入其它 session');
    const payload = row.payload ?? row.data ?? row;
    if (row.type === 'turn_context') turn = payload.turn_id;
    const message = ['user', 'assistant'].includes(row.type) || store === 'cursor' && ['user', 'assistant'].includes(row.role) ? row.message : row.type === 'response_item' && payload.type === 'message' ? payload : undefined;
    const role = row.isCompactSummary ? 'summary' : row.isMeta ? undefined : message?.role ?? (store === 'cursor' ? row.role : undefined) ?? (['user', 'assistant'].includes(row.type) ? row.type : undefined);
    const at = row.timestamp ?? row.created_at ?? payload.timestamp;
    const id = row.uuid ?? row.id ?? payload.id ?? (role === 'user' ? turn : undefined) ?? `line:${seq}`;
    if (role === 'user' || role === 'assistant' || role === 'summary') {
      const parts = message?.content ?? payload.content ?? payload.message;
      let content = text(Array.isArray(parts) ? parts.filter(item => ['text', 'input_text', 'output_text'].includes(item.type)) : parts);
      if (store === 'cursor' && role === 'user') {
        const wrapper = /^\s*<user_query>([\s\S]*?)<\/user_query>\s*$/.exec(content);
        if (wrapper && !/<\/?user_query>/.test(wrapper[1])) content = wrapper[1];
      }
      const injected = store === 'codex' && role === 'user' && /^(?:# AGENTS\.md instructions(?: for(?:\s|$)|\r?\n|$)|<environment_context>)/.test(content.trim());
      if (content && !injected) messages.push({ id, role, text: content, at, line: seq, prompt_id: row.promptId });
      for (const item of Array.isArray(message?.content) ? message.content : []) {
        if (item.type === 'tool_use') pending.set(item.id, { name: item.name, input: item.input, line: seq, at });
        if (item.type === 'tool_result' && pending.has(item.tool_use_id)) {
          tools.push({ ...pending.get(item.tool_use_id), output: typeof row.toolUseResult?.stdout === 'string' ? row.toolUseResult.stdout : text(item.content), error: item.is_error === true, read: fullRead(row), resultLine: seq }); pending.delete(item.tool_use_id);
        }
      }
    }
    if (row.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(payload.type)) {
      let input = payload.arguments ?? payload.input;
      try { input = JSON.parse(input); } catch { /* Native custom calls contain source text. */ }
      pending.set(payload.call_id, { name: payload.name, input, line: seq, at });
    }
    if (row.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(payload.type) && pending.has(payload.call_id)) {
      tools.push({ ...pending.get(payload.call_id), output: plainToolOutput(text(payload.output)), error: resultFailed(payload), resultLine: seq }); pending.delete(payload.call_id);
    }
  }
  // Claude tool-result envelopes carry role=user but grant no new user instruction.
  const users = messages.filter(message => message.role === 'user');
  let request = selected ? users.find(message => message.id === selected || message.prompt_id === selected) : users.at(-1);
  if (!selected && request) {
    const boundary = [...messages].reverse().find(message => message.role === 'assistant' && message.line > request.line
      && /继续原任务|本请求.{0,12}续作/.test(message.text) && !/新独立请求/.test(message.text));
    const originals = boundary ? users.filter(message => message.line < request.line && boundary.text.includes(message.id)) : [];
    if (originals.length === 1) request = originals[0];
  }
  if (!request) throw new Error('找不到定位的真实 user 消息');
  return { file: fs.realpathSync(file), sessionId, cwd: fs.realpathSync(cwd), request, messages, tools,
    ...(store === 'cursor' ? { userControlVerified: false, gaps: ['Cursor历史格式已核；原生包装授权及线上hook对应未验，不授用户豁免或固定档位'] } : {}) };
}

function userControl(message) {
  const value = unquote(message).replace(/“[^”]*”|「[^」]*」|"[^"]*"|(?<!\w)'[^']*'(?!\w)/g, '');
  // Discussion, quoted phrases and negated opt-outs do not grant an exemption.
  const discussing = clause => /(?:讨论|举例|如果|假如|是否|能否|什么叫|不要说|不代表|不能|并非|不是|不要不走|别不走|不要不用|不要(?:按|使用|采用)|不(?:按|使用|采用))/.test(clause);
  const clauses = value.split(/[，,；;。\n]/).filter(clause => !discussing(clause));
  const revoke = clauses.some(clause => /(?:恢复|重新|继续)(?:使用|走)\s*Maison(?:流程)?(?:\s|$)|恢复\s*Maison(?:流程)?(?:\s|$)|(?:恢复|重新|继续)(?:使用|走)?\s*框架流程(?:\s|$)|撤销\s*(?:本请求|本会话)?\s*(?:Maison)?豁免(?:\s|$)/i.test(clause));
  const exempt = !revoke && clauses.some(clause => /(?:不走|不用|跳过|绕过)\s*Maison|(?:do not|don't) use Maison/i.test(clause));
  const fixed = clauses.map(clause => /(?:按|使用|采用|指定(?:为)?)\s*(特别简单|小型|中型|复杂)(?:(?:流程|档|来做|执行|处理)|\s*$)/.exec(clause)?.[1]).filter(Boolean).at(-1);
  const excluded = clauses.flatMap(clause => [...clause.matchAll(/(?:不跑|跳过|不要运行|仅不执行)\s*(review|UT|单测|测试|真机|编译|架构检查)(?=\s*$|验证|检查)/gi)]).map(match => ({ review: 'review', ut: 'ut', 单测: 'ut', 测试: 'testing', 真机: 'testing', 编译: 'compile', 架构检查: 'architecture' })[match[1].toLowerCase()] ?? match[1]);
  const included = clauses.flatMap(clause => [...clause.trim().matchAll(/^(?:(?:本请求|本轮|本次|这次)\s*)?(?:(?:现在|请)\s*){0,2}(?:(?:恢复|重新)\s*(?:(?:运行|执行|跑)\s*)?|(?:运行|执行|跑)\s*)(review|UT|单测|测试|真机|编译|架构检查)(?:测试|验证|检查)?\s*$/gi)]).map(match => ({ review: 'review', ut: 'ut', 单测: 'ut', 测试: 'testing', 真机: 'testing', 编译: 'compile', 架构检查: 'architecture' })[match[1].toLowerCase()] ?? match[1]);
  const transport = resolveTransportIntent(message);
  return { exempt, session: exempt && /(?:本|整个|这次)会话|(?:this|whole) session/i.test(value), revoke, fixed, excluded, included,
    ...(transport ? { transport } : {}) };
}

function resolveTransportIntent(message) {
  const value = unquote(message).replace(/(`{3,}|~{3,})[\s\S]*?(?:\1|$)|`[^`\r\n]*`|“[^”]*”|‘[^’]*’|「[^」]*」|"[^"]*"|(?<!\w)'[^']*'(?!\w)/g, '');
  const sentences = (value.match(/[^。！？!?；;\n]+[！？!?]?/g) ?? []).filter(sentence =>
    !/(?:讨论|举例|假如|如果(?!\s*(?:遇到|出现|有)(?:问题|异常|故障))|是否|能否|什么叫|不要说|不代表|并非|不是|[?？]|\b(?:if|example|whether|what is)\b)/i.test(sentence));
  const clauses = sentences.flatMap(sentence => sentence.split(/[，,]/).map(clause => clause.trim()));
  const askOnProblem = /(?:遇到|出现|有)(?:问题|异常|故障)[^。！？!?]*问我/;
  const withoutAsking = /(?:不|别|无需|不用|不要)\s*(?:先)?问我/;
  const backgroundDirective = /^(?:(?:请|现在|这次|本轮)\s*)*(?:(?:你|(?:本次|当前)?任务|本请求|交付流程)\s*)?(?:(?:在|转入|切到|切换到|放到|改为)\s*)?后台(?:\s*(?:继续|持续)?\s*(?:推进|执行|运行|跑完?|完成|交付|继续)?\s*(?:工作|本次任务|原请求|该任务|这项任务|全部|剩余工作|到(?:验收|结果|完成|正式终点))?)?$/;
  const unattendedMode = /^(?:(?:请|现在|这次|本次|本轮|全程)\s*)*(?:(?:你|(?:本次|当前)?任务|本请求|交付流程)\s*)?(?:(?:改为|转入|切到|切换到|采用|使用|保持)\s*)?无人值守(?:\s*模式)?[！!]?$/;
  const unattendedManner = /^(?:(?:请|你|帮我|替我|现在|这次|本次|本轮|全程|本请求|当前任务|任务|交付流程)\s*)*(?:(?:以|按|用)\s*无人值守\s*(?:方式|模式)|无人值守\s*(?:方式|地))\s*(?:(?:继续|持续|自主)\s*)*(?:完成|执行|交付|推进|开发|测试|验收|运行|处理|做|跑)(?!\s*的)/;
  const unattendedTask = /^(?:请\s*)?(?:你\s*)?(?:全程\s*)?无人值守\s*(?:(?:继续|持续|自主)\s*)*(?:完成|执行|交付|推进)\s*(?:(?:本次|这次|当前|该|全部|整个|剩余)|(?:(?:开发|测试|验收|任务|工作)(?:\s*(?:[、和及与]|以及)\s*(?:开发|测试|验收|任务|工作))*)?[！!]?$)/;
  const attended = sentences.some(sentence => askOnProblem.test(sentence) && !withoutAsking.test(sentence))
    || clauses.some(clause => /(?:有人在场|我(?:会|一直|在旁边)看着|我(?:会|现在)在场|(?:请)?(?:不要|别|禁止|不用)\s*(?:转(?:入)?|使用|启动|走|切到)?\s*(?:后台|无人值守)|^(?:请\s*)?(?:在)?前台(?:继续|执行|运行|推进)|需要[^，,。]*停下来|\b(?:do not|don't|no)\s+(?:run\s+in\s+the\s+)?background\b|\b(?:keep|stay)\b.*\bforeground\b)/i.test(clause)
      && !/(?:不需要|不用|无需|不必|别|不要)\s*停下来|无人在场|没有人在场|不在场|不会看着/.test(clause));
  const unattended = clauses.some(clause => /(?:不用|不必|无需)\s*(?:等|等待)\s*我/.test(clause)
    || !/(?:不(?:要|用|许|能)|别|禁止|取消|停止|\b(?:no|not|never|stop)\b)/i.test(clause)
      && !/^(?:请\s*)?(?:实现|添加|提供|支持|测试|验证|说明|比较|调研|配置|复现)\s*(?:无人值守|后台|--detach)/.test(clause)
      && (backgroundDirective.test(clause) || unattendedMode.test(clause) || unattendedManner.test(clause) || unattendedTask.test(clause)
        || /(?:^(?:请\s*)?--detach\s*$|\bunattended\b|^(?:please\s+)?(?:you\s+|this task\s+)?(?:run|continue) in the background\b)/i.test(clause)))
    || sentences.some(sentence => /我(?:会|先|要|暂时)?(?:离开|走了|不在)[^。！？!?]*(?:[，,]\s*(?:请|你|仍然|照常|也要)?\s*|(?:仍|也要|照常)\s*)继续(?:跑|运行|执行|推进|做|完成|交付)/.test(sentence));
  return attended === unattended ? null : attended ? 'attended' : 'unattended';
}

function toolInput(tool) {
  return typeof tool.input === 'string' ? tool.input : typeof tool.input?.cmd === 'string' ? tool.input.cmd : typeof tool.input?.command === 'string' ? tool.input.command : JSON.stringify(tool.input ?? {});
}
function editedPaths(tools) {
  const files = new Set();
  for (const tool of tools.filter(isEditingTool)) {
    const input = tool.input ?? {};
    if (/^(?:Write|Edit|MultiEdit|NotebookEdit|Delete)$/i.test(tool.name)) {
      const file = input.file_path ?? input.path ?? input.target_file ?? input.notebook_path;
      if (typeof file === 'string') files.add(file);
    }
    for (const match of patchText(tool).matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) files.add(match[1].trim());
  }
  return [...files];
}

function frontDoorLoaded(session, projectRoot, frameworkRoot) {
  const entry = path.join(frameworkRoot, 'docs/operations/project-entry.md');
  const after = [...session.messages].reverse().find(message => message.role === 'summary');
  const retained = after && /(?:project-entry\.md|统一前门).{0,80}(?:已(?:读|加载)|loaded|read)|(?:已(?:读|加载)|loaded|read).{0,80}project-entry\.md/i.test(after.text);
  let body, unseen;
  return Boolean(retained || session.tools.some(tool => {
    if (after && tool.line < after.line) return false;
    const input = toolInput(tool).replace(/\\\\/g, '/').replace(/\\/g, '/');
    if (!toolSucceeded(tool) || !/(?:Read|read_file|exec|shell|command|functions|pwsh|bash)/i.test(tool.name) || !input.includes('project-entry.md')) return false;
    if (!(input.includes(entry.replace(/\\/g, '/')) || input.includes('framework/docs/operations/project-entry.md') || (samePath(projectRoot, frameworkRoot) && input.includes('docs/operations/project-entry.md')))) return false;
    if (tool.read) return tool.read.complete === true && typeof tool.read.path === 'string' && samePath(path.resolve(projectRoot, tool.read.path), entry);
    // A successful path lookup is not a rule read. Native preludes and display-only final LF loss are harmless.
    try { body ??= fs.readFileSync(entry, 'utf8').replace(/\r\n/g, '\n').trimEnd(); } catch { return false; }
    if (!body) return false;
    const output = tool.output.replace(/\r\n/g, '\n');
    if (output.includes(body)) return true;
    // Existing split reads and native line prefixes still expose the same rule lines.
    unseen ??= new Set(body.split('\n').filter(line => line.trim()));
    for (const line of unseen) if (output.includes(line)) unseen.delete(line);
    return unseen.size === 0;
  }));
}

function productTarget(projectRoot, frameworkRoot, filePath, roots = [], explicit = false) {
  const abs = path.resolve(projectRoot, filePath);
  const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
  const framework = path.relative(projectRoot, frameworkRoot).replace(/\\/g, '/');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'framework.config.json'), 'utf8')); } catch { /* Missing config gives a weaker path domain. */ }
  const featureRoot = config.paths?.features_dir ?? 'doc/features';
  if (rel.startsWith('../') || path.isAbsolute(rel) || rel === framework || rel.startsWith(framework + '/')
    || rel === featureRoot || rel.startsWith(featureRoot + '/') || /^(?:\.git|\.cursor|\.codex|\.claude|\.cac|\.opencode)\//.test(rel)) return false;
  if (/^(?:doc\/reports|doc\/runs)\//.test(rel)) return false;
  if (explicit) return true;
  const configured = (config.architecture?.outer_layers ?? []).map(layer => layer.id);
  return [...configured, ...roots].some(root => rel === root || rel.startsWith(root.replace(/\/$/, '') + '/'))
    || /(?:^|\/)(?:src|res|resources|assets)\//.test(rel)
    || /(?:^|\/)(?:package|oh-package|module|build-profile|app)\.json5?$/.test(rel);
}

module.exports = { samePath, claudeSession, codexSession, currentNativeSession, nativeStore, toolSucceeded, toolCompletedBefore, isEditingTool, readNativeSession, userControl, resolveTransportIntent, editedPaths, frontDoorLoaded, toolInput, unquote, productTarget };
