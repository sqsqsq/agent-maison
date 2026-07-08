// ============================================================================
// usage-capture.ts — headless agent 用量采集（C-ab-eval 基建，plan d4a7c1e8）
// ============================================================================
// 契约（OpenSpec ab-eval design）：
//   - capture_method 由 adapter goal_capability.usage_capture 声明（缺省 none）；
//   - none / 采集失败 → confidence: proxy：token 字段一律 null，**不新增 proxy
//     专用字段**——代理指标复用 trace 顶层 tool_calls 与 started_at/ended_at 推导
//     wall-time，报告只允许基于该口径表述；
//   - model identity 机器固化：resolved provider/model 取自响应元数据 / 调用配置，
//     非 agent 文本自报。
//   - sidecar / api 两法在本批仅声明位（无实现 → 按采集失败降 proxy，诚实标注）。

import * as fs from 'fs';

export type UsageCaptureMethod = 'none' | 'stdout_json' | 'stderr_regex' | 'sidecar' | 'api';

export const USAGE_CAPTURE_METHODS: readonly UsageCaptureMethod[] = [
  'none',
  'stdout_json',
  'stderr_regex',
  'sidecar',
  'api',
];

export interface UsageModelIdentity {
  provider?: string;
  model?: string;
  /** 事实来源：response_metadata（响应元数据）> cli_config > invoke_args；unknown=未能固化 */
  source: 'response_metadata' | 'cli_config' | 'invoke_args' | 'unknown';
}

export interface AgentInvokeUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  tool_tokens: number | null;
  requests: number | null;
  cost_estimate: number | null;
  capture_method: UsageCaptureMethod;
  confidence: 'measured' | 'proxy';
  model_identity?: UsageModelIdentity;
}

function proxyUsage(method: UsageCaptureMethod): AgentInvokeUsage {
  return {
    input_tokens: null,
    output_tokens: null,
    tool_tokens: null,
    requests: null,
    cost_estimate: null,
    capture_method: method,
    confidence: 'proxy',
  };
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 从 stdout 末尾起找最后一个可解析的顶层 JSON 对象（claude/codex headless 的 result 信封形态）。 */
export function extractTrailingJsonObject(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 50; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* keep scanning upward */
    }
  }
  // 整段 stdout 本身就是一个 JSON 对象（pretty-print 多行形态）
  const trimmed = stdout.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fallthrough */
    }
  }
  return null;
}

function fromStdoutJson(stdout: string): AgentInvokeUsage {
  const doc = extractTrailingJsonObject(stdout);
  if (!doc) return proxyUsage('stdout_json');

  const usageObj =
    doc.usage && typeof doc.usage === 'object' ? (doc.usage as Record<string, unknown>) : doc;
  const input = asFiniteNumber(usageObj.input_tokens);
  const output = asFiniteNumber(usageObj.output_tokens);
  const cost = asFiniteNumber(doc.total_cost_usd) ?? asFiniteNumber(usageObj.cost_estimate);
  const requests = asFiniteNumber(doc.num_turns) ?? asFiniteNumber(usageObj.requests);

  if (input === null && output === null && cost === null) {
    // 信封在但没有任何用量事实 → 采集失败，降 proxy
    return proxyUsage('stdout_json');
  }

  const modelRaw =
    typeof doc.model === 'string'
      ? doc.model
      : doc.modelUsage && typeof doc.modelUsage === 'object'
        ? Object.keys(doc.modelUsage as object)[0]
        : undefined;

  return {
    input_tokens: input,
    output_tokens: output,
    tool_tokens: asFiniteNumber(usageObj.tool_tokens),
    requests,
    cost_estimate: cost,
    capture_method: 'stdout_json',
    confidence: 'measured',
    ...(modelRaw
      ? { model_identity: { model: modelRaw, source: 'response_metadata' as const } }
      : {}),
  };
}

const STDERR_TOKEN_PATTERNS: Array<{ key: 'input_tokens' | 'output_tokens'; re: RegExp }> = [
  { key: 'input_tokens', re: /input[_ ]tokens?\D{0,5}(\d[\d,]*)/i },
  { key: 'output_tokens', re: /output[_ ]tokens?\D{0,5}(\d[\d,]*)/i },
];

function fromStderrRegex(stderr: string): AgentInvokeUsage {
  const out = proxyUsage('stderr_regex');
  let hit = false;
  for (const { key, re } of STDERR_TOKEN_PATTERNS) {
    const m = stderr.match(re);
    if (m) {
      out[key] = Number(m[1].replace(/,/g, ''));
      hit = true;
    }
  }
  if (!hit) return out;
  return { ...out, confidence: 'measured' };
}

/**
 * 按声明的 capture_method 从 invoke 产出解析 usage。
 * 任何解析失败一律降 confidence: proxy（不抛错——usage 是旁路事实，不得影响 invoke 主流程）。
 */
export function deriveInvokeUsage(
  method: UsageCaptureMethod | undefined,
  stdout: string,
  stderr: string,
): AgentInvokeUsage {
  switch (method) {
    case 'stdout_json':
      return fromStdoutJson(stdout);
    case 'stderr_regex':
      return fromStderrRegex(stderr);
    case 'sidecar':
    case 'api':
      // 声明位：本批未实现读取 → 按采集失败降 proxy（capture_method 保真，报告可见缺口）
      return proxyUsage(method);
    case 'none':
    case undefined:
      return proxyUsage('none');
    default:
      return proxyUsage('none');
  }
}

/**
 * 把 usage 合并进已存在的 trace.json（agent 产出后由 goal-runner 落盘）。
 * best-effort：trace 缺失/损坏/已有 usage → 不动（返回 false）；不抛错。
 */
export function mergeUsageIntoTraceFile(traceAbs: string, usage: AgentInvokeUsage): boolean {
  try {
    if (!fs.existsSync(traceAbs)) return false;
    const doc = JSON.parse(fs.readFileSync(traceAbs, 'utf-8')) as Record<string, unknown>;
    if (!doc || typeof doc !== 'object') return false;
    if (doc.usage !== undefined) return false;
    doc.usage = usage;
    fs.writeFileSync(traceAbs, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}
