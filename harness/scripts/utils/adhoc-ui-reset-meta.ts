/**
 * Ad-hoc UI reset hints (Nav stack pollution / rerun discipline).
 */
import * as fs from 'fs';
import { V1_RESULT_PROTOCOL } from './hylyre-result-protocol';

export type StepsBatchResult = {
  result_protocol?: string;
  total?: number;
  executed?: number;
  results: Array<{ index?: number; status?: string; error?: string; step_result?: unknown }>;
};

type StepsRunResult = { batch: StepsBatchResult } | { rejection: { code: string; summary: string } };

export function parseStepsRunOut(runOut: string, { native = false }: { native?: boolean } = {}): StepsRunResult | null {
  // Consume whole containers, including arrays, so a nested object cannot become a batch.
  const start = /\{(?=\s*["}])|\[(?=\s*(?:[\[\]{"\d-]|true\b|false\b|null\b))/g;
  let batch: StepsBatchResult | null = null;
  let ambiguous = false;
  for (let match = start.exec(runOut); match; match = start.exec(runOut)) {
    let depth = 1;
    let quoted = false;
    let end = match.index + 1;
    for (; depth && end < runOut.length; end++) {
      const char = runOut[end];
      if (quoted && char === '\\') end++;
      else if (char === '"') quoted = !quoted;
      else if (!quoted && (char === '{' || char === '[')) depth++;
      else if (!quoted && (char === '}' || char === ']')) depth--;
    }
    if (depth) return null;
    start.lastIndex = end;
    if (match[0] !== '{') continue;
    if (native) {
      const lineStart = runOut.lastIndexOf('\n', match.index - 1) + 1;
      const lineEnd = runOut.indexOf('\n', end);
      if (runOut.slice(lineStart, match.index).trim() || runOut.slice(end, lineEnd < 0 ? runOut.length : lineEnd).trim()) continue;
    }
    try {
      const candidate = JSON.parse(runOut.slice(match.index, end)) as StepsBatchResult & {
        command_status?: string; phase?: string; rejection?: { domain?: string; code?: string; summary?: string };
      };
      const rejection = candidate.rejection;
      if (candidate.result_protocol === V1_RESULT_PROTOCOL && candidate.command_status === 'rejected' && candidate.phase === 'pre_run_validation'
        && rejection?.domain === 'contract' && typeof rejection.code === 'string' && typeof rejection.summary === 'string') return { rejection: { code: rejection.code, summary: rejection.summary } };
      if ((native && candidate.result_protocol !== V1_RESULT_PROTOCOL) || !Array.isArray(candidate.results)
        || !candidate.results.every(row => row && typeof row === 'object' && !Array.isArray(row))) continue;
      if (batch) ambiguous = true;
      batch = candidate;
    } catch { /* A balanced logging fragment need not be JSON. */ }
  }
  return batch && !ambiguous ? { batch } : null;
}

export function parseStepsBatchFromRunOut(runOut: string): StepsBatchResult | null {
  const parsed = parseStepsRunOut(runOut);
  return parsed && 'batch' in parsed ? parsed.batch : null;
}

/** Index of first non-ok step; null if all ok or no batch. */
export function computeLastFailedStepIndex(batch: StepsBatchResult | null): number | null {
  const results = batch?.results ?? [];
  for (const r of results) {
    if (r.status !== 'ok' && typeof r.index === 'number') {
      return r.index;
    }
  }
  return null;
}

export function readPreviousTraceOutcome(tracePath: string): string | null {
  if (!fs.existsSync(tracePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(tracePath, 'utf-8')) as { outcome?: string };
    return typeof raw.outcome === 'string' ? raw.outcome : null;
  } catch {
    return null;
  }
}

/**
 * Read prior run outcome from fixed reports/device-test-run.meta.json (not new timestamp trace).
 */
export function readPreviousRunOutcome(runMetaPath: string): string | null {
  if (!fs.existsSync(runMetaPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(runMetaPath, 'utf-8')) as {
      trace_summary?: { outcome?: string };
      trace_path?: string;
    };
    const fromSummary = raw.trace_summary?.outcome;
    if (typeof fromSummary === 'string' && fromSummary.trim().length > 0) {
      return fromSummary;
    }
    const tracePath = raw.trace_path;
    if (typeof tracePath === 'string' && tracePath.trim().length > 0) {
      return readPreviousTraceOutcome(tracePath);
    }
    return null;
  } catch {
    return null;
  }
}

/** stderr ADHOC_UI_RESET_RECOMMENDED=1 when continuing session after non-success run. */
export function shouldEmitUiResetRecommended(
  previousOutcome: string | null,
  continueSession: boolean,
): boolean {
  if (!continueSession || !previousOutcome) return false;
  return previousOutcome !== 'success';
}

export function uiResetHintForOutcome(outcome: string, lastStepIndex: number | null): string | null {
  if (outcome === 'success') return null;
  if (lastStepIndex != null) {
    return `rerun_with_cold_restart_after_step_${lastStepIndex}`;
  }
  return 'rerun_with_cold_restart';
}
