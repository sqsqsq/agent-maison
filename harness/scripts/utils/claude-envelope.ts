// ============================================================================
// claude-envelope.ts — claude structured_events（stream-json NDJSON）信封共享语义
// （plan 7c4f2e9b P0-1 / visual-capability-truth 任务 3.10）
// ============================================================================
// 事故根因：claude adapter 声明 structured_events 后恒注入 --output-format stream-json，
// 而 canary 判卷用行锚定 ^KEY=value$ 扫原始输出——答卷在 NDJSON 信封字符串里永不成独立行，
// 判卷恒失败 → fail-closed → 真 Claude 宿主被 adapter_declared 保守盲档永久锁死。
// 本模块是全库 claude 信封消费的唯一语义源：最终 assistant result 文本投影 / init model /
// 图片 Read 事件 / （API error 信封仍在 goal-headless-sentinel，行解析共用本模块）。
// 契约（codex 四轮 must-fix#4）：
//   - 文本投影只接受终态 result 白名单：type=result && subtype=success &&
//     is_error!==true && typeof result==='string'；多 result 取末次合法者；
//     错误 result 即使含答题键也不得投影；残卷/无信封 → null（调用方维持 fail-closed）。
//   - preflight 判卷消费 invoke.stdout（纯 stdout）；inline 判卷消费 agent-events.jsonl
//     （三文件分流的纯 events 文件），禁读混合 agent-output.log（stderr 可插进 JSON 行中间）。
// ============================================================================

/** 单行信封解析：非 JSON 行（stderr 插行/人读投影）返回 null，绝不 throw。 */
export function parseEnvelopeLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 终态 assistant result 文本投影（判卷/文本消费唯一入口）。
 * 白名单：type=result && subtype='success' && is_error!==true && typeof result==='string'。
 * 多个 result → 最后一个合法者胜出；无合法终态 → null（fail-closed 交调用方）。
 */
export function extractClaudeFinalResultText(raw: string): string | null {
  let last: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const obj = parseEnvelopeLine(line);
    if (!obj) continue;
    if (obj.type !== 'result') continue;
    if (obj.subtype !== 'success') continue;
    if (obj.is_error === true) continue;
    if (typeof obj.result !== 'string') continue;
    last = obj.result;
  }
  return last;
}

/** 首个 init 事件的 model 字段（telemetry 用；无/非法 → null，不 throw）。 */
export function parseClaudeInitModel(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const obj = parseEnvelopeLine(line);
    if (!obj) continue;
    if (obj.type === 'system' && obj.subtype === 'init') {
      return typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : null;
    }
  }
  return null;
}

/**
 * 图片 Read 事件路径收集（原 critic-receipt-producer.parseClaudeImageReadEvents 本体，
 * 收敛至此；原导出保留为薄壳）。assistant 消息 content 内 type=tool_use、name=Read、
 * input.file_path 以图片扩展名结尾。只认结构化字段。
 */
export function collectClaudeImageReadPaths(eventsJsonl: string): string[] {
  const out = new Set<string>();
  for (const line of eventsJsonl.split(/\r?\n/)) {
    const obj = parseEnvelopeLine(line);
    if (!obj) continue;
    if (obj.type !== 'assistant') continue;
    const message = obj.message as { content?: unknown } | undefined;
    if (!message || !Array.isArray(message.content)) continue;
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (!block || block.type !== 'tool_use' || block.name !== 'Read') continue;
      const input = block.input as { file_path?: unknown } | undefined;
      const fp = typeof input?.file_path === 'string' ? input.file_path.trim() : '';
      if (fp && /\.(png|jpe?g|webp)$/i.test(fp)) out.add(fp);
    }
  }
  return [...out];
}

/**
 * 该 adapter 的本次 invoke stdout 是否为 claude stream-json 信封流。
 * 与 agent-invoke.claudeArgv 的注入条件严格同构（adapter=claude 且声明 structured_events
 * 才加 --output-format stream-json）——判卷侧据此决定是否先归一投影。
 */
export function planUsesClaudeStreamJson(
  adapterName: string,
  toolEventProvenance?: 'none' | 'structured_events' | 'session_transcript' | null,
): boolean {
  return adapterName === 'claude' && toolEventProvenance === 'structured_events';
}
