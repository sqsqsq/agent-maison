import { adapterModelBinding } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import * as YAML from 'yaml';
import crossSpawn from 'cross-spawn';
import { parseEnv } from 'node:util';
import { createHash } from 'crypto';
import { resolveHeadlessBinary } from './headless-binary-resolve';
import type { ProviderRef } from './types';
import { normalizeAdapterModelPin, type AdapterModelPin } from './goal-manifest';

/** Value projection used by dispatch, native sessions, env and capability evidence. */
export { adapterModelBinding } from './types';

export function parseAdapterModelBinding(adapter: string, binding?: string): AdapterModelPin | undefined {
  if (!binding) return undefined;
  return normalizeAdapterModelPin(binding.startsWith('{') ? { ...JSON.parse(binding), adapter } : { adapter, value: binding });
}

export function modelSelectionWait(reason: string): Error {
  return new Error(`模型选择尚未确定或不能准确回放：${reason}。已保留成果；请前台 agent 对照实际模型清单校对正式 ID、provider 及推理设置，再经原授权入口继续；未启动模型请求。`);
}

function readNativeModelMetadata(binary: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, deadline = Infinity): string {
  if (Date.now() >= deadline) throw modelSelectionWait('配置检查的原截止已到');
  const result = crossSpawn.sync(binary, args, { cwd, env, encoding: 'utf8', timeout: Math.max(1, Math.min(30_000, deadline - Date.now())), maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.error && ['ENOENT', 'EACCES', 'ENOEXEC'].includes((result.error as NodeJS.ErrnoException).code ?? '')) {
    throw Object.assign(new Error('原生配置子进程无法启动'), { spawn_error: { code: (result.error as NodeJS.ErrnoException).code, message: result.error.message } });
  }
  if (result.status !== 0 || result.error) throw modelSelectionWait('原生模型配置或清单读取失败/超时');
  return result.stdout;
}

/** Read-only native control protocols; no user message or model prompt is ever submitted. */
export async function verifyNativeModelCatalogue(binary: string, pin: AdapterModelPin, env: NodeJS.ProcessEnv, cwd: string, deadline: number, signal?: AbortSignal): Promise<string | undefined> {
  if (pin.adapter === 'cursor') {
    const raw = readNativeModelMetadata(binary, ['--list-models'], env, cwd, deadline).replace(/\x1b\[[0-9;]*m/g, '');
    const candidates = raw.split(/\r?\n/).map(line => line.trim().split(/\s+/)[0]).filter(Boolean);
    return candidates.includes(pin.value) ? undefined : `正式 ID 未精确匹配；候选：${candidates.join(', ')}。未启动模型请求`;
  }
  const codex = pin.adapter === 'codex';
  const args = codex ? ['-c', `model_provider=${JSON.stringify(pin.provider)}`, 'app-server']
    : ['-p', '--safe-mode', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  const models = await new Promise<any[]>((resolve, reject) => {
    const child = crossSpawn(binary, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const lifecycle = (require('./agent-invoke') as typeof import('./agent-invoke')).createChildSettleWaiter(child);
    let buffer = '', result: any[] | undefined, failure: Error | undefined, settled = false;
    const send = (value: unknown): void => { if (!child.stdin?.destroyed) child.stdin?.write(JSON.stringify(value) + '\n'); };
    const stop = (): void => {
      child.stdin?.end();
      lifecycle.armForceSettleAfterKill();
      if (child.pid) void (require('./agent-invoke') as typeof import('./agent-invoke')).killProcessTree(child.pid);
    };
    const timeout = setTimeout(() => { failure = modelSelectionWait('原生正式模型清单读取超时'); stop(); }, Math.max(1, Math.min(30_000, deadline - Date.now())));
    const abort = (): void => { failure = modelSelectionWait('模型目录读取已取消'); stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    const finish = (): void => {
      if (settled) return; settled = true;
      clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (result && !failure) resolve(result); else reject(failure ?? modelSelectionWait('原生正式模型清单不可读取'));
    };
    child.on('error', error => { failure = error; }); void lifecycle.promise.then(finish);
    child.stderr?.resume(); child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 16 * 1024 * 1024) { failure = modelSelectionWait('原生模型目录输出不可解析'); stop(); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let row: any; try { row = JSON.parse(line); } catch { continue; }
        if (codex && row.id === 0) {
          if (row.error) { failure = modelSelectionWait('原生模型目录初始化失败'); stop(); return; }
          send({ method: 'initialized', params: {} }); send({ id: 1, method: 'model/list', params: { includeHidden: true } });
        } else if (codex && row.id === 1) {
          result = row.result?.data; child.stdin?.end();
        } else if (!codex && row.type === 'control_response' && row.response?.request_id === 'models') {
          result = row.response.response?.models; child.stdin?.end();
        }
      }
    });
    if (codex) send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'maison-model-catalogue', version: '1' } } });
    else send({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } });
    if (signal?.aborted) abort();
  });
  const candidates = [...new Set(models.map(model => codex ? model.model : model.resolvedModel).filter((id): id is string => typeof id === 'string' && !!id))];
  const model = models.find(model => (codex ? model.model : model.resolvedModel) === pin.value);
  if (!model) return `正式 ID 未精确匹配；候选：${candidates.join(', ')}。原生别名或附加上下文标签须由前台先校对，不能移除设置后试发模型请求`;
  const efforts = codex ? model.supportedReasoningEfforts?.map((item: any) => item.reasoningEffort) : model.supportedEffortLevels;
  if (pin.reasoning_effort && Array.isArray(efforts) && !efforts.includes(pin.reasoning_effort)) return `推理设置未精确匹配；候选：${efforts.join(', ')}。未启动模型请求`;
  return undefined;
}

const customTags: YAML.ScalarTag[] = [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => ({ __jsExpr: value }) }];
/** DSH persistence is a sequence of independent Zstandard frames, not one frame. */
export function decodeDshSession(bytes: Buffer, allowIncompleteTail = false): string {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length;) {
    try {
      const decoded = (zlib as any).zstdDecompressSync(bytes.subarray(offset), { info: true });
      const consumed = decoded.engine.bytesWritten;
      if (!(consumed > 0)) throw new Error('invalid Zstandard frame');
      chunks.push(decoded.buffer); offset += consumed;
    } catch (error) { if (allowIncompleteTail) break; throw error; }
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function parseDshConfiguration(text: string): any[] {
  const value = YAML.parse(text, { customTags });
  if (!Array.isArray(value)) throw modelSelectionWait('DSH 配置不是原生 entry list');
  return value;
}
export function dshEntries(entries: any[]): any[] {
  return entries.flatMap(entry => [entry, ...(entry.group && Array.isArray(entry.config) ? dshEntries(entry.config) : [])]);
}
export function dshModelSource(pin: AdapterModelPin, env: NodeJS.ProcessEnv = process.env): string {
  if (pin.config_source) return pin.config_source;
  if (env.DSH_PROFILE_DIR) return path.join(env.DSH_PROFILE_DIR, 'cordis.patch.yml');
  throw modelSelectionWait('缺少前台实际 DSH_PROFILE_DIR 或明确的原生配置来源');
}
export function dshModelHome(pin: AdapterModelPin): string {
  const file = pin.config_source;
  if (!file || path.basename(file) !== 'cordis.patch.yml' || path.basename(path.dirname(path.dirname(file))) !== 'profiles') {
    throw modelSelectionWait('DSH 来源须指向前台原生 DSH_HOME/profiles/<profile>/cordis.patch.yml，才能保留同一凭据来源');
  }
  return path.dirname(path.dirname(path.dirname(file)));
}
export function openCodeModelHome(pin: AdapterModelPin): string {
  const dir = pin.config_source;
  if (!dir || path.basename(dir) !== 'opencode' || path.basename(path.dirname(dir)) !== '.config') {
    throw modelSelectionWait('OpenCode 来源须为前台原生 <home>/.config/opencode 配置目录；其它来源组合尚不能准确回放');
  }
  return path.dirname(path.dirname(dir));
}

/** Native metadata commands make no inference requests. Never print their complete config. */
export function verifyOpenCodeModelConfig(binary: string, pin: AdapterModelPin, env: NodeJS.ProcessEnv, cwd: string, deadline = Infinity): string | undefined {
  const config = readNativeModelMetadata(binary, ['debug', 'config'], env, cwd, deadline);
  try { JSON.parse(config); } catch { return 'OpenCode 最终配置无法读取；未启动模型请求'; }
  const raw = readNativeModelMetadata(binary, ['models', pin.provider!, '--verbose'], env, cwd, deadline).replace(/\x1b\[[0-9;]*m/g, '');
  const models = (raw.match(/(?:^|\n)\{[\s\S]*?\n\}/g) ?? []).flatMap(text => { try { return [JSON.parse(text)]; } catch { return []; } });
  const candidate = models.find(model => model.providerID === pin.provider && `${model.providerID}/${model.id}` === pin.value);
  if (!candidate) return `OpenCode 正式 ID 未精确匹配；候选：${models.map(model => `${model.providerID}/${model.id}`).join(', ')}。未启动模型请求`;
  if (pin.reasoning_effort && !Object.prototype.hasOwnProperty.call(candidate.variants ?? {}, pin.reasoning_effort)) {
    return `OpenCode variant 未精确匹配；候选：${Object.keys(candidate.variants ?? {}).join(', ')}。未启动模型请求`;
  }
  return undefined;
}

/** Compare only non-secret route metadata; credentials remain native and are never inspected. */
export function assertClaudeModelRoute(pin: AdapterModelPin, cwd: string, env: NodeJS.ProcessEnv): void {
  const routes = new Set<string>();
  const inspect = (values: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(values)) {
      if (/^CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)$/i.test(key) && value && value !== '0' && value !== 'false') {
        throw modelSelectionWait('当前云 provider 的精确回放契约尚未验证');
      }
      if (key.toUpperCase() === 'ANTHROPIC_BASE_URL' && typeof value === 'string' && value) routes.add(value);
    }
  };
  inspect(env);
  for (const file of [pin.config_source!, path.join(cwd, '.claude/settings.json'), path.join(cwd, '.claude/settings.local.json')]) {
    if (fs.existsSync(file)) inspect(JSON.parse(fs.readFileSync(file, 'utf8')).env ?? {});
  }
  if (!routes.size) routes.add('https://api.anthropic.com');
  const expected = pin.provider === 'anthropic' ? 'https://api.anthropic.com' : pin.provider;
  if (routes.size !== 1 || !routes.has(expected!)) throw modelSelectionWait('Claude 前台配置来源与冻结 provider 不一致，不能将现有凭据改投另一 endpoint');
}
export function dshSourceMetadata(file: string, pin: AdapterModelPin): { provider: any; model: any; candidates: string[]; builtin?: boolean; baseURL?: unknown } {
  const entries = dshEntries(parseDshConfiguration(fs.readFileSync(file, 'utf8')));
  const entry = entries.find(row => row.id === 'llm-pi-ai');
  const providers = entry?.config?.providers;
  const provider = providers?.[pin.provider ?? ''];
  const candidates = Object.entries(providers ?? {}).flatMap(([id, value]: [string, any]) =>
    (value.models ?? []).map((model: any) => `${id}: ${model.id}`));
  const model = provider?.models?.find((row: any) => row.id === pin.value);
  if (!Object.prototype.hasOwnProperty.call(providers ?? {}, pin.provider ?? '') && ['deepseek-official', 'deepseek-account'].includes(pin.provider ?? '')) return { provider, model, candidates, builtin: true, baseURL: builtinConfiguredURL(entries, pin) };
  if (!provider || !model) throw modelSelectionWait(`DSH 正式 ID 未精确匹配 ${pin.provider ?? '(缺 provider)'}/${pin.value}；候选：${candidates.join(', ')}`);
  const unresolved = (value: any): boolean => !!value && typeof value === 'object'
    && ('__jsExpr' in value || Object.values(value).some(unresolved));
  if ([provider.api, provider.baseURL, provider.apiKeyEnv, model.contextWindow, model.input].some(unresolved)) {
    throw modelSelectionWait('DSH 模型来源含尚未求值的动态表达式，无法证明最终有效路由和输入声明');
  }
  return { provider, model, candidates };
}

/** Freeze only non-secret provider/model declarations inside the existing pin. */
function dshRouteIdentity(provider: any, model: any): string {
  return createHash('sha256').update(JSON.stringify({ api: provider?.api, baseURL: provider?.baseURL,
    apiKeyEnv: provider?.apiKeyEnv, contextWindow: model?.contextWindow, input: model?.input })).digest('hex');
}
function builtinConfiguredURL(entries: any[], pin: AdapterModelPin): unknown {
  const id = pin.provider === 'deepseek-account' ? 'llm-deepseek-account' : 'llm-deepseek';
  return entries.filter(row => row.id === id && Object.prototype.hasOwnProperty.call(row.config ?? {}, 'baseURL')).at(-1)?.config.baseURL;
}

function builtinEndpoint(configured: unknown, env: NodeJS.ProcessEnv, cwd: string, home: string): string {
  let value = configured ?? env.DEEPSEEK_BASE_URL;
  for (const dir of [cwd, home]) {
    if (value != null) break;
    const file = path.join(dir, '.env');
    if (fs.existsSync(file)) value = parseEnv(fs.readFileSync(file, 'utf8')).DEEPSEEK_BASE_URL;
  }
  const raw = value ?? 'https://api.deepseek.com/anthropic';
  try {
    if (typeof raw !== 'string') throw new Error();
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    const base = url.href.replace(/\/+$/, '');
    return base.endsWith('/v1') ? base : base + '/v1';
  } catch { throw modelSelectionWait('无法确认 DSH 内置 provider 的非秘密 endpoint'); }
}

function dshBuiltinRouteIdentity(pin: AdapterModelPin, configured: unknown, binary?: string, env = process.env, cwd = process.cwd(), deadline = Infinity): string {
  const executable = binary ?? resolveHeadlessBinary(['dsh'])?.path;
  if (!executable) throw modelSelectionWait('DSH 内置路由缺少可核实的 CLI 版本');
  const version = readNativeModelMetadata(executable, ['--version'], env, cwd, deadline).trim();
  return createHash('sha256').update(JSON.stringify({ version, provider: pin.provider, model: pin.value, endpoint: builtinEndpoint(configured, env, cwd, dshModelHome(pin)) })).digest('hex');
}
export function freezeModelPin(pin: AdapterModelPin | undefined, cwd = process.cwd(), env = process.env, deadline = Infinity): AdapterModelPin | undefined {
  if (!pin || pin.adapter !== 'deepseek-harness' || pin.route_identity) return pin;
  const config_source = dshModelSource(pin);
  const { provider, model, builtin, baseURL } = dshSourceMetadata(config_source, pin);
  const route_identity = builtin ? dshBuiltinRouteIdentity({ ...pin, config_source }, baseURL, undefined, env, cwd, deadline) : dshRouteIdentity(provider, model);
  return { ...pin, config_source, route_identity };
}

function nativeSessionMetadata(record: any): any {
  return record?.data?.header ?? record?.data ?? record?.payload ?? record;
}

/** Reads one explicitly located native request, never lastUsed or a recent session. */
export function readFrontendModelRequest(input: { adapter: string; projectRoot: string; file: string; sessionId: string; requestId?: string; configSource?: string }): AdapterModelPin {
  const bytes = fs.readFileSync(input.file);
  if (input.adapter === 'opencode') {
    const native = JSON.parse(bytes.toString('utf8'));
    if (native.info?.id !== input.sessionId || typeof native.info.directory !== 'string' || path.resolve(native.info.directory) !== path.resolve(input.projectRoot)) throw modelSelectionWait('前台原件不属于准确 session / 项目');
    const message = native.messages?.find((row: any) => row.info?.id === input.requestId)?.info;
    const provider = message?.providerID ?? message?.model?.providerID, model = message?.modelID ?? message?.model?.modelID;
    if (!provider || !model || !input.configSource) throw modelSelectionWait('OpenCode 准确消息的模型身份或前台原生配置目录缺失');
    return normalizeAdapterModelPin({ adapter: input.adapter, provider, value: `${provider}/${model}`, source: 'frontend',
      config_source: path.resolve(input.projectRoot, input.configSource), ...((message.model?.variant ?? message.variant) ? { reasoning_effort: message.model?.variant ?? message.variant } : {}) })!;
  }
  const text: string = input.file.endsWith('.zstd') ? decodeDshSession(bytes) : bytes.toString('utf8');
  const rows = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const header = rows.find(row => row.type === 'session' || row.type === 'session/header' || row.type === 'session_meta');
  const meta = nativeSessionMetadata(header);
  if ((meta?.id ?? meta?.sessionId ?? meta?.session_id) !== input.sessionId || typeof meta?.cwd !== 'string' || !meta.cwd
    || path.resolve(meta.cwd) !== path.resolve(input.projectRoot)) {
    throw modelSelectionWait('前台原件不属于准确 session / 项目');
  }
  let config: any;
  if (input.adapter === 'deepseek-harness') {
    const headers = rows.filter(row => row.type === 'request/header' && Number.isInteger(row.seq) && row.seq >= 0);
    const request = input.requestId === undefined ? headers.at(-1) : headers.find(row => String(row.seq) === input.requestId);
    config = request?.data?.header?.config;
  } else if (input.adapter === 'codex') {
    config = rows.find(row => row.type === 'turn_context' && row.payload?.turn_id === input.requestId)?.payload;
  } else throw modelSelectionWait(`${input.adapter} 尚无可核实的启动轮原生请求读取契约，请明确指定模型`);
  if (!config?.model || !(config.provider ?? config.model_provider)) throw modelSelectionWait('准确启动轮缺少完整模型路由');
  return normalizeAdapterModelPin({ adapter: input.adapter, value: config.model, provider: config.provider ?? config.model_provider,
    ...((config.reasoningEffort ?? config.effort ?? config.reasoning_effort) ? { reasoning_effort: config.reasoningEffort ?? config.effort ?? config.reasoning_effort } : {}),
    ...(input.configSource ? { config_source: path.resolve(input.projectRoot, input.configSource) }
      : input.adapter === 'deepseek-harness' ? { config_source: dshModelSource({ adapter: input.adapter, value: config.model }) }
      : input.adapter === 'codex' ? { config_source: path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'config.toml') } : {}), source: 'frontend' })!;
}

/** Reuse the manifest conversion and existing request/report lifecycle for task-authorized changes. */
export function rebindTaskModel<T extends import('./goal-manifest').GoalRunManifest>(manifest: T, pin: AdapterModelPin | undefined,
  projectRoot: string, override: boolean, visualPin?: ProviderRef): T {
  const choose = (current: T) => {
    const model = pin && !(pin.source === 'frontend' && current.adapter_model_pin) ? pin : current.adapter_model_pin;
    const visual = (require('./goal-manifest-cli') as typeof import('./goal-manifest-cli')).resolveFinalVisualProviderPin({
      cliRef: visualPin, manifestPin: current.visual_provider_pin, isResume: true, hasManifestFlag: false, isSuccessor: false, overrideManifest: override });
    if (!visual.ok) throw modelSelectionWait(visual.message);
    const fields: string[] = [];
    if (adapterModelBinding(model) !== adapterModelBinding(current.adapter_model_pin)) {
      if (current.adapter_model_pin && !override) throw modelSelectionWait('任务模型改选需要 --override-manifest 授权');
      if (model?.adapter !== current.adapter) throw modelSelectionWait('模型绑定 adapter 与原任务不同');
      fields.push('adapter_model_pin');
    }
    if (visual.pin?.adapter !== current.visual_provider_pin?.adapter
      || adapterModelBinding(visual.pin && { ...visual.pin, value: visual.pin.model }) !== adapterModelBinding(current.visual_provider_pin && { ...current.visual_provider_pin, value: current.visual_provider_pin.model })) fields.push('visual_provider_pin');
    return { model, visual: visual.pin, fields };
  };
  if (!choose(manifest).fields.length) return manifest;
  const runDir = path.resolve(projectRoot, manifest.report_dir);
  const lock = require('./goal-run-lock') as typeof import('./goal-run-lock');
  const record = lock.readLockRecord(path.join(runDir, '.runner.lock'));
  if (record && !lock.isLockStale(record)) throw modelSelectionWait('原调用仍受现有 owner 控制，先观察或结清原调用');
  const acquired = lock.tryAcquireLock(path.join(runDir, '.runner.lock'), { run_id: manifest.run_id, run_mode: 'authoritative', report_dir: manifest.report_dir });
  if (!acquired) throw modelSelectionWait('原任务正在转换模型绑定，稍后沿原入口继续');
  try {
  const contract = require('./goal-manifest') as typeof import('./goal-manifest');
  const current = contract.loadGoalRunManifestFromRun(projectRoot, manifest.run_id, { feature: manifest.feature });
  const priorEvents = (require('./goal-runner-phase') as typeof import('./goal-runner-phase')).loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
  const baseline = (require('../goal-phase-runtime') as typeof import('../goal-phase-runtime')).resolveManifestIdentityBaseline(priorEvents);
  const drift = baseline ? contract.diffManifestIdentityFields(baseline, contract.computeManifestIdentityFields(current)) : [];
  if (drift.length) throw modelSelectionWait(`原 manifest 存在尚未处理的身份漂移 ${drift.join(', ')}；模型补绑不能授权其它字段`);
  manifest = current as T;
  const selected = choose(manifest);
  if (!selected.fields.length) return manifest;
  const model = selected.fields.includes('adapter_model_pin') ? freezeModelPin(selected.model, projectRoot) : manifest.adapter_model_pin;
  const handoff = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
  let issued = handoff.readSessionExecution(runDir);
  const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n');
  if (issued && !handoff.acceptedSessionReport(runDir, issued)) {
    const directory = path.resolve(runDir, path.dirname(issued.reference.path));
    const events = handoff.sessionEvents(runDir);
    const oldInvokeId = issued.request.invoke_id;
    if (events.some(event => event.type === 'agent_process_bound' && event.invoke_id === oldInvokeId)
      || ['agent-events.jsonl', 'agent-output.log'].some(name => fs.existsSync(path.join(directory, name)))) {
      throw modelSelectionWait('旧绑定调用已经启动，先按现有 owner 观察或结清，保留其真实结果');
    }
    const owners = require('./goal-run-control') as typeof import('./goal-run-control');
    const control = owners.readRunControl(runDir, manifest.run_id);
    if (control?.owner?.state === 'released') {
      const acquired = owners.casAcquireRunOwner(runDir, manifest.run_id, control.current_epoch,
        { kind: 'session', owner_id: require('crypto').randomUUID(), lease_ms: 60_000 });
      if (!acquired.ok) throw modelSelectionWait('原请求 owner 已改变，先观察当前窗口');
      issued = handoff.resignSessionExecution(runDir, issued, acquired.token, emit);
    } else owners.resumeIssuedSessionOwner(runDir, issued.request.context.owner);
    handoff.acceptSessionExecution({ runDir, issued, report: { status: 'waiting', phase: issued.request.context.phase,
      details: '任务模型已授权变更；此旧绑定请求尚未执行，保留事实后按新绑定重新签发。' }, emit });
    owners.releaseRunOwner(runDir, issued.request.context.owner);
  }
  const result = { ...manifest, ...(selected.fields.includes('adapter_model_pin') ? { adapter_model_pin: model } : {}),
    ...(selected.fields.includes('visual_provider_pin') ? { visual_provider_pin: selected.visual } : {}) };
  contract.writeGoalManifest(result, projectRoot);
  emit({ type: 'manifest_identity_rebase', to_fields: contract.computeManifestIdentityFields(result), changed_fields: selected.fields, authorized_by: override ? '--override-manifest' : 'task_model_selection' });
  return result;
  } finally { lock.releaseLock(path.join(runDir, '.runner.lock'), acquired.ownerId); }
}

/** Explicit input is already proofread by the foreground agent. No fuzzy matching here. */
export function launchModelPin(argv: Record<string, any>, adapter: string, projectRoot: string, frozen?: AdapterModelPin): AdapterModelPin | undefined {
  if (argv['captured-model-pin'] !== undefined) {
    const captured = normalizeAdapterModelPin(JSON.parse(argv['captured-model-pin']));
    if (!captured || captured.adapter !== adapter) throw modelSelectionWait('捕获的模型绑定与执行 adapter 不一致');
    return captured;
  }
  const explicit = ['adapter-model', 'adapter-provider', 'adapter-reasoning'].some(key => argv[key] !== undefined);
  if (explicit && argv['adapter-model'] === undefined && !frozen) throw modelSelectionWait('显式路由或推理改选须提供正式模型 ID，不能借前台 UI 选择替换任务模型');
  let foreground: AdapterModelPin | undefined;
  if (argv['frontend-request-file']) {
    if (!argv['frontend-session-id'] || !argv['frontend-request-id']) throw modelSelectionWait('缺少启动轮 session/request ID');
    foreground = readFrontendModelRequest({ adapter, projectRoot, file: path.resolve(projectRoot, argv['frontend-request-file']),
      sessionId: argv['frontend-session-id'], requestId: argv['frontend-request-id'], configSource: argv['adapter-model-config'] });
  } else if (adapter === 'deepseek-harness' && !frozen && process.env.DSH_SESSION_ID) {
    try {
    const sessionId = process.env.DSH_SESSION_ID;
    if (!/^session-[a-zA-Z0-9-]+$/.test(sessionId) || !process.env.DSH_HOME || !process.env.DSH_PROFILE_DIR) throw modelSelectionWait('DSH 前台 shell 的 session/home/profile 环境不完整');
    const sessions = path.join(process.env.DSH_HOME, 'sessions');
    const files = fs.existsSync(sessions) ? fs.readdirSync(sessions, { withFileTypes: true }).filter(row => row.isDirectory())
      .map(row => path.join(sessions, row.name, sessionId, 'session.v4.jsonl.zstd')).filter(file => fs.existsSync(file)) : [];
    if (files.length !== 1) throw modelSelectionWait('DSH_SESSION_ID 未定位到唯一原生会话');
    foreground = readFrontendModelRequest({ adapter, projectRoot, file: files[0], sessionId,
      configSource: path.join(process.env.DSH_PROFILE_DIR, 'cordis.patch.yml') });
    } catch (error) {
      if (!(argv['adapter-model'] !== undefined && argv['adapter-provider'] !== undefined && argv['adapter-model-config'] !== undefined)) throw error;
    }
  }
  if (!explicit) return foreground;
  const base = frozen?.adapter === adapter ? { ...foreground, ...frozen } : foreground;
  const value = argv['adapter-model'] ?? base?.value;
  if (!value) throw modelSelectionWait('显式路由或推理改选缺少可沿用的正式模型 ID');
  const config = argv['adapter-model-config'] !== undefined ? path.resolve(projectRoot, argv['adapter-model-config']) : base?.config_source
    ?? (adapter === 'deepseek-harness' ? dshModelSource({ adapter, value: argv['adapter-model'] })
      : adapter === 'codex' ? path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'config.toml')
      : adapter === 'opencode' ? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'opencode')
      : ['claude', 'codeagent'].includes(adapter) ? path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'settings.json') : undefined);
  return freezeModelPin(normalizeAdapterModelPin({ ...base, source: undefined, route_identity: undefined, adapter, value,
    provider: argv['adapter-provider'] ?? base?.provider ?? (adapter === 'cursor' ? 'cursor' : adapter === 'opencode' && String(argv['adapter-model']).includes('/') ? String(argv['adapter-model']).split('/')[0] : undefined), reasoning_effort: argv['adapter-reasoning'] ?? base?.reasoning_effort,
    ...(config ? { config_source: config } : {}) }), projectRoot);
}

export function assertModelReplay(pin?: AdapterModelPin, cwd = process.cwd(), env = process.env, deadline = Infinity): asserts pin is AdapterModelPin {
  if (!pin || /^(auto|default)$/i.test(pin.value) || pin.source === 'approved_alternative') throw modelSelectionWait('缺少任务授权的明确模型绑定');
  if (['codex', 'claude', 'codeagent'].includes(pin.adapter) && !pin.provider) throw modelSelectionWait(`${pin.adapter} 缺少 provider 路由；旧 pin 需要先补齐路由`);
  if (['claude', 'codeagent'].includes(pin.adapter) && pin.provider !== 'anthropic' && !/^https?:\/\//.test(pin.provider!)) throw modelSelectionWait('Claude provider 须为 anthropic 或前台配置中的准确 API endpoint');
  if (pin.adapter === 'cursor' && pin.reasoning_effort) throw modelSelectionWait('当前 Cursor CLI 没有已验证的独立推理设置回放参数');
  if (pin.adapter === 'cursor' && pin.provider && pin.provider !== 'cursor') throw modelSelectionWait('Cursor 只支持其原生托管路由，不能单独改选 provider');
  if (pin.config_source && !['deepseek-harness', 'codex', 'claude', 'codeagent', 'opencode'].includes(pin.adapter)) throw modelSelectionWait(`${pin.adapter} 尚无额外模型配置文件回放契约`);
  if (pin.adapter === 'codex' && pin.config_source && path.basename(pin.config_source) !== 'config.toml') throw modelSelectionWait('Codex 模型来源须为原生 CODEX_HOME/config.toml');
  if (['codex', 'claude', 'codeagent'].includes(pin.adapter) && !pin.config_source) throw modelSelectionWait('旧 pin 缺少前台原生配置来源，需要先补齐');
  if (['claude', 'codeagent'].includes(pin.adapter) && path.basename(pin.config_source!) !== 'settings.json') throw modelSelectionWait('Claude 模型来源须为原生 CLAUDE_CONFIG_DIR/settings.json');
  if (['chrys', 'generic'].includes(pin.adapter)) throw modelSelectionWait(`${pin.adapter} 尚无精确模型回放契约`);
  if (pin.adapter === 'deepseek-harness') {
    if (!pin.provider) throw modelSelectionWait('DSH provider 缺失，完整模型 ID 不可拆分');
    if (!pin.config_source) throw modelSelectionWait('DSH 前台模型来源配置层缺失');
    dshModelHome(pin);
    if (!pin.route_identity || freezeModelPin({ ...pin, route_identity: undefined }, cwd, env, deadline)!.route_identity !== pin.route_identity) throw modelSelectionWait('DSH 模型来源路由未冻结或已变化，需要按原授权入口明确补齐/改选');
  }
  if (pin.adapter === 'opencode' && (!pin.provider || !pin.value.startsWith(`${pin.provider}/`))) throw modelSelectionWait('OpenCode 需要 provider/model 原生完整 ID 与对应 provider');
  if (pin.adapter === 'opencode') openCodeModelHome(pin);
}

/** Only native main-request/config fields are comparable; auxiliary response models are excluded. */
export function observedMainModel(adapter: string, record: any): { value?: string; provider?: string; reasoning_effort?: string } | undefined {
  if (record.parent_tool_use_id) return undefined;
  if (['claude', 'codeagent', 'cursor'].includes(adapter) && record.type === 'system' && record.subtype === 'init' && typeof record.model === 'string') return { value: record.model };
  const event = record.type === 'session_event' ? record.event : record;
  const config = adapter === 'deepseek-harness' && event?.type === 'request/header' ? event.data?.header?.config
    : adapter === 'deepseek-harness' && event?.type === 'request/context' ? event.data
    : adapter === 'codex' && record.type === 'turn_context' ? record.payload : undefined;
  if (typeof config?.model !== 'string') return undefined;
  const effort = config.reasoningEffort ?? config.effort ?? config.reasoning_effort;
  return { value: config.model, ...((config.provider ?? config.model_provider) ? { provider: config.provider ?? config.model_provider } : {}),
    ...(effort !== undefined ? { reasoning_effort: effort } : {}) };
}

/** Exact SID lookup; no unrelated session contents or 'latest session' heuristic. */
export function nativeDshModelMismatch(pin: AdapterModelPin, sessionId: string, cwd: string, env: NodeJS.ProcessEnv, turn?: unknown, seen = new Map<string, string>()): string | undefined {
  const root = path.join(env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'sessions');
  if (!fs.existsSync(root) || !/^session-[a-zA-Z0-9-]+$/.test(sessionId) || turn === undefined) return undefined;
  const files = seen.has('file') ? [seen.get('file')!] : fs.readdirSync(root, { withFileTypes: true }).filter(row => row.isDirectory())
    .map(directory => path.join(root, directory.name, sessionId, 'session.v4.jsonl.zstd'));
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const stat = fs.statSync(file), version = `${stat.size}:${stat.mtimeMs}:${String(turn)}`;
    if (seen.get(file) === version) return undefined;
    seen.set(file, version);
    const raw = decodeDshSession(fs.readFileSync(file), true);
    const rows = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const header = nativeSessionMetadata(rows[0]);
    if (header?.id !== sessionId || typeof header?.cwd !== 'string' || !header.cwd || path.resolve(header.cwd) !== path.resolve(cwd)) continue;
    seen.set('file', file);
    const start = rows.findIndex(row => row.type === 'turn/start' && row.data?.turn === turn);
    if (start < 0) return undefined;
    for (const row of rows.slice(start)) {
      const mismatch = modelMismatch(pin, observedMainModel('deepseek-harness', row));
      if (mismatch) return mismatch;
    }
  }
  return undefined;
}

export function nativeCodexSessionFile(sessionId: string, env: NodeJS.ProcessEnv): string | undefined {
  const root = path.join(env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions');
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId) || !fs.existsSync(root)) return undefined;
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith(`${sessionId}.jsonl`)) files.push(file);
    }
  };
  visit(root);
  return files.length === 1 ? files[0] : undefined;
}

export function nativeCodexModelMismatch(pin: AdapterModelPin, sessionId: string, cwd: string, env: NodeJS.ProcessEnv, afterBytes: number, seen: Map<string, string>): string | undefined {
  const file = seen.get('file') ?? nativeCodexSessionFile(sessionId, env);
  if (!file) return undefined;
  const stat = fs.statSync(file), version = `${stat.size}:${stat.mtimeMs}`;
  if (seen.get(file) === version) return undefined;
  seen.set(file, version);
  const bytes = fs.readFileSync(file);
  const header = JSON.parse(bytes.toString('utf8').split('\n')[0]).payload;
  if (header?.id !== sessionId || typeof header.cwd !== 'string' || path.resolve(header.cwd) !== path.resolve(cwd)) return undefined;
  seen.set('file', file);
  const providerMismatch = typeof header.model_provider === 'string' ? modelMismatch(pin, { provider: header.model_provider }) : undefined;
  return providerMismatch ?? modelMismatchInEvents('codex', adapterModelBinding(pin), bytes.subarray(afterBytes).toString('utf8'));
}

export function nativeOpenCodeModelMismatch(pin: AdapterModelPin, sessionId: string, cwd: string, startedAt: number, seen: Map<string, string>): string | undefined {
  const file = path.join(openCodeModelHome(pin), '.local/share/opencode/opencode.db');
  if (!fs.existsSync(file)) return undefined;
  const wal = fs.existsSync(`${file}-wal`) ? `${file}-wal` : file;
  const stat = fs.statSync(wal), version = `${stat.size}:${stat.mtimeMs}`;
  if (seen.get(wal) === version) return undefined;
  seen.set(wal, version); seen.set('file', wal);
  const { DatabaseSync } = require('node:sqlite') as any;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const session = db.prepare('SELECT directory FROM session WHERE id=?').get(sessionId);
    if (typeof session?.directory !== 'string' || path.resolve(session.directory) !== path.resolve(cwd)) return undefined;
    const rows = db.prepare(`SELECT coalesce(json_extract(data,'$.providerID'),json_extract(data,'$.model.providerID')) AS provider,
      coalesce(json_extract(data,'$.modelID'),json_extract(data,'$.model.modelID')) AS model,
      CASE WHEN json_extract(data,'$.role')='user' THEN coalesce(json_extract(data,'$.model.variant'),json_extract(data,'$.variant')) ELSE json_extract(data,'$.variant') END AS variant
      FROM message WHERE session_id=? AND time_created>=? AND coalesce(json_extract(data,'$.summary'),0)=0
      AND json_extract(data,'$.role') IN ('user','assistant') ORDER BY time_created`).all(sessionId, startedAt);
    for (const row of rows) {
      if (typeof row.provider !== 'string' || typeof row.model !== 'string') continue;
      const mismatch = modelMismatch(pin, { provider: row.provider, value: `${row.provider}/${row.model}`,
        ...(typeof row.variant === 'string' ? { reasoning_effort: row.variant } : {}) });
      if (mismatch) return mismatch;
    }
  } finally { db.close(); }
  return undefined;
}
export function modelMismatch(pin: AdapterModelPin, observed: ReturnType<typeof observedMainModel>): string | undefined {
  if (!observed) return undefined;
  const keys = ['value', 'provider', 'reasoning_effort'] as const;
  if (!keys.some(key => Object.prototype.hasOwnProperty.call(observed, key) && observed[key] !== pin[key])) return undefined;
  return `model_binding_mismatch: expected=${adapterModelBinding(pin)} observed=${JSON.stringify(observed)}`;
}
export function modelMismatchInEvents(adapter: string, binding: string | undefined, raw: string): string | undefined {
  const pin = parseAdapterModelBinding(adapter, binding);
  if (!pin) return undefined;
  for (const line of raw.split(/\r?\n/)) {
    let record: any; try { record = JSON.parse(line); } catch { continue; }
    const mismatch = modelMismatch(pin, observedMainModel(adapter, record));
    if (mismatch) return mismatch;
  }
  return undefined;
}

/** Final native composition, after authorization/resume transforms; never a credential precheck. */
export function verifyDshModelConfig(argv: string[], pin: AdapterModelPin, env: NodeJS.ProcessEnv, cwd: string, deadline = Infinity, readonlyInvocation = false): string | undefined {
  assertModelReplay(pin, cwd, env, deadline);
  const args = argv.slice(1).filter(arg => arg !== '--json');
  const sid = args.indexOf('--session-id'); if (sid >= 0) args.splice(sid, 2);
  const config = readNativeModelMetadata(argv[0], [...args, '--dump-config'], env, cwd, deadline);
  try {
    const entries = dshEntries(parseDshConfiguration(config));
    const selection = entries.find(row => row.id === 'agent-default-model')?.config;
    const expected = { provider: pin.provider, model: pin.value, reasoningEffort: pin.reasoning_effort };
    const expr = (key: string) => `JSON.parse(process.env.MAISON_GOAL_MODEL_PIN).${key}`;
    for (const [key, value] of Object.entries(expected)) {
      const configKey = key === 'model' ? 'value' : key === 'reasoningEffort' ? 'reasoning_effort' : key;
      if (selection?.[key]?.__jsExpr !== expr(configKey) && selection?.[key] !== value) return `DSH 最终模型配置 ${key} 与冻结绑定不同`;
    }
    const source = dshSourceMetadata(dshModelSource(pin, env), pin);
    const provider = entries.find(row => row.id === 'llm-pi-ai')?.config?.providers?.[pin.provider!];
    const model = provider?.models?.find((row: any) => row.id === pin.value);
    if (source.builtin) {
      if (dshBuiltinRouteIdentity(pin, builtinConfiguredURL(entries, pin), argv[0], env, cwd, deadline) !== pin.route_identity) return 'DSH 内置路由版本或 endpoint 与冻结身份不同';
    } else {
      if (dshRouteIdentity(provider, model) !== pin.route_identity) return 'DSH 最终有效来源与冻结路由身份不同';
      for (const key of ['api', 'baseURL', 'apiKeyEnv']) if (JSON.stringify(provider?.[key]) !== JSON.stringify(source.provider[key])) return `DSH 来源 ${key} 不一致`;
      for (const key of ['contextWindow', 'input']) if (JSON.stringify(model?.[key]) !== JSON.stringify(source.model[key])) return `DSH 模型来源 ${key} 不一致`;
      if (!model) return 'DSH 模型来源未生效';
    }
    const permission = entries.find(row => row.id === 'permission')?.config;
    if (readonlyInvocation) {
      const preset = permission?.presets?.['read-only'];
      if (permission?.defaultPreset !== 'read-only' || preset?.sandbox !== 'read-only' || preset?.approval !== 'never') return 'DSH 视觉只读权限补丁未生效';
    } else if (permission?.defaultPreset !== 'danger-full-access') return 'DSH 框架权限补丁未生效';
  } catch { return 'DSH 最终配置无法与前台模型来源精确核对'; }
  return undefined;
}
