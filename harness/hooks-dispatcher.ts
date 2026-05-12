// ============================================================================
// Lifecycle hooks dispatcher — framework → profile → extension
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { HarnessResolvedProfile } from './scripts/utils/types';
import type { CheckResult, Severity } from './scripts/utils/types';

export type HookEventName =
  | 'pre_phase'
  | 'post_phase'
  | 'pre_check'
  | 'post_check'
  | 'pre_verifier'
  | 'post_verifier'
  | 'on_context_load'
  | 'on_violation';

export type HookLayerSource = 'framework' | 'profile' | 'extension';

export interface HookDispatchPayload {
  projectRoot: string;
  phase: string;
  feature: string;
  resolvedProfileName: string;
  hookEvent: HookEventName;
  checkScript?: string;
  violation?: { ruleId: string; severity: string; details: string };
}

export interface DispatchLifecycleHooksOptions {
  enabled?: boolean;
  timeoutMs?: number;
}

export interface DispatchLifecycleHooksResult {
  promptFragments: string[];
  hookCheckResults: CheckResult[];
}

interface HookSlot {
  source: HookLayerSource;
  absPath: string;
}

function severityForFailure(source: HookLayerSource): Severity {
  return source === 'extension' ? 'MAJOR' : 'BLOCKER';
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function frameworkSlots(harnessRoot: string, phase: string, event: HookEventName): HookSlot[] {
  const base = path.join(harnessRoot, 'hooks', phase);
  const out: HookSlot[] = [];
  for (const ext of ['mjs', 'md']) {
    const p = path.join(base, `${event}.${ext}`);
    if (exists(p)) {
      out.push({ source: 'framework', absPath: p });
    }
  }
  return out;
}

function profileSlots(profileDir: string, phase: string, event: HookEventName): HookSlot[] {
  const base = path.join(profileDir, 'hooks', phase);
  const out: HookSlot[] = [];
  for (const ext of ['mjs', 'md']) {
    const p = path.join(base, `${event}.${ext}`);
    if (exists(p)) {
      out.push({ source: 'profile', absPath: p });
    }
  }
  return out;
}

function extensionSlots(resolved: HarnessResolvedProfile, phase: string, event: HookEventName): HookSlot[] {
  const bundle = resolved.extensionBundle;
  const paths = bundle?.hooks[phase]?.[event] ?? [];
  return paths.map(absPath => ({ source: 'extension' as const, absPath }));
}

export function collectHookSlots(
  harnessRoot: string,
  phase: string,
  event: HookEventName,
  resolved: HarnessResolvedProfile,
): HookSlot[] {
  return [
    ...frameworkSlots(harnessRoot, phase, event),
    ...profileSlots(resolved.profileDir, phase, event),
    ...extensionSlots(resolved, phase, event),
  ];
}

function runMarkdownHook(absPath: string): string {
  return fs.readFileSync(absPath, 'utf-8');
}

function runMjsHook(absPath: string, payload: Record<string, unknown>, timeoutMs: number): Record<string, unknown> {
  const runner = path.join(__dirname, 'scripts', 'hook-runner.mjs');
  const r = spawnSync(process.execPath, [runner, absPath], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 12 * 1024 * 1024,
  });
  if (r.error) {
    throw r.error;
  }
  if (r.signal === 'SIGTERM' || r.stderr?.includes('TIMOUT')) {
    throw new Error(`hook timeout（>${timeoutMs}ms）`);
  }
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim() || `exit=${r.status}`;
    throw new Error(msg);
  }
  const raw = (r.stdout ?? '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`hook stdout 非法 JSON：${raw.slice(0, 200)}`);
  }
}

export async function dispatchLifecycleHooks(
  harnessRoot: string,
  event: HookEventName,
  payload: HookDispatchPayload,
  resolved: HarnessResolvedProfile,
  opts?: DispatchLifecycleHooksOptions,
): Promise<DispatchLifecycleHooksResult> {
  const promptFragments: string[] = [];
  const hookCheckResults: CheckResult[] = [];

  if (opts?.enabled === false) {
    return { promptFragments, hookCheckResults };
  }

  const timeoutMs = opts?.timeoutMs ?? 30000;
  const slots = collectHookSlots(harnessRoot, payload.phase, event, resolved);

  for (const slot of slots) {
    const ctxPayload: Record<string, unknown> = {
      ...payload,
      source: slot.source,
      hookPath: slot.absPath,
      promptFragments: [...promptFragments],
    };

    try {
      const lower = slot.absPath.toLowerCase();
      if (lower.endsWith('.md')) {
        const body = runMarkdownHook(slot.absPath);
        if (body.trim().length > 0) {
          promptFragments.push(`<!-- hook:${event}:${slot.source}:${path.basename(slot.absPath)} -->\n${body}`);
        }
      } else if (lower.endsWith('.mjs')) {
        const result = runMjsHook(slot.absPath, ctxPayload, timeoutMs);
        const frags = result.promptFragments;
        if (Array.isArray(frags)) {
          for (const f of frags) {
            if (typeof f === 'string' && f.trim()) {
              promptFragments.push(f);
            }
          }
        }
        if (result.ok === false) {
          const sevRaw = typeof result.severityOverride === 'string' ? result.severityOverride : severityForFailure(slot.source);
          const sev = (['BLOCKER', 'MAJOR', 'MINOR'].includes(sevRaw) ? sevRaw : severityForFailure(slot.source)) as Severity;
          hookCheckResults.push({
            id: `lifecycle_hook_${event}_${slot.source}`,
            category: 'structure',
            description: `lifecycle hook 声明失败（${path.basename(slot.absPath)}）`,
            severity: sev,
            status: 'FAIL',
            details: typeof result.message === 'string' ? result.message : 'hook returned ok:false',
          });
        }
      }
    } catch (e) {
      const sev = severityForFailure(slot.source);
      hookCheckResults.push({
        id: `lifecycle_hook_${event}_${slot.source}_error`,
        category: 'structure',
        description: `lifecycle hook 执行异常（${path.basename(slot.absPath)}）`,
        severity: sev,
        status: 'FAIL',
        details: (e as Error).message,
      });
    }
  }

  return { promptFragments, hookCheckResults };
}
