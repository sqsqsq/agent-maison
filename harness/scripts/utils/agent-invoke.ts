/**
 * Agent headless invoke — structured spawn for claude -p / codex exec / cursor-agent -p.
 */

import * as path from 'path';
import { spawnSync } from 'child_process';
import crossSpawn from 'cross-spawn';
import type { UnattendedContract } from './goal-manifest';
import type { GoalCapabilitySpec } from './goal-adapter-capability';
import {
  formatHeadlessBinaryIssue,
  headlessBinarySpawnable,
  resolveHeadlessBinary,
  shouldUseCrossSpawn,
  type ResolvedHeadlessBinary,
} from './headless-binary-resolve';

export interface InvokeTemplateVars {
  PROMPT_FILE: string;
  PROMPT: string;
  SKILL_PATH: string;
  PROJECT_ROOT: string;
  FRAMEWORK_ROOT: string;
  FEATURE: string;
  PHASE: string;
}

/** Tokenize templates with this sentinel, then swap for real prompt as a single argv element. */
export const PROMPT_ARGV_SENTINEL = '__MAISON_GOAL_PROMPT_ARGV__';

const KNOWN_STRUCTURED_ADAPTERS = new Set(['claude', 'codex', 'cursor']);

/** Cursor headless CLI candidates (official name first). */
export const CURSOR_HEADLESS_BINARY_CANDIDATES = ['cursor-agent', 'agent'] as const;
export const CLAUDE_HEADLESS_BINARY_CANDIDATES = ['claude'] as const;
export const CODEX_HEADLESS_BINARY_CANDIDATES = ['codex'] as const;

const STRUCTURED_BINARY_CANDIDATES: Record<string, readonly string[]> = {
  cursor: CURSOR_HEADLESS_BINARY_CANDIDATES,
  claude: CLAUDE_HEADLESS_BINARY_CANDIDATES,
  codex: CODEX_HEADLESS_BINARY_CANDIDATES,
};

export function renderInvokeTemplate(template: string, vars: InvokeTemplateVars): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

/** Normalize legacy bash $(cat {{PROMPT_FILE}}) templates to {{PROMPT}}. */
export function normalizeHeadlessTemplate(template: string): string {
  return template
    .replace(/"\$\(cat\s+\{\{PROMPT_FILE\}\}\)"/g, '{{PROMPT}}')
    .replace(/\$\(cat\s+\{\{PROMPT_FILE\}\}\)/g, '{{PROMPT}}')
    .replace(/"\$\(cat\s+[^"]+\)"/g, '{{PROMPT}}');
}

export interface HeadlessInvokePlan {
  argv: string[];
  /** Pass prompt via stdin (generic pipe adapters only). */
  useStdin?: boolean;
  stdin?: string;
  /** Resolved binary metadata for preflight / spawn. */
  resolvedBinary?: ResolvedHeadlessBinary | null;
  /** Windows .cmd shim — use cross-spawn instead of spawnSync. */
  useCrossSpawn?: boolean;
  /** Human-readable label for logs / dry-run. */
  label: string;
}

function attachResolvedBinary(
  argv: string[],
  candidates: readonly string[],
  label: string,
): HeadlessInvokePlan {
  const resolved = resolveHeadlessBinary([...candidates]);
  const cmd = resolved?.path ?? argv[0];
  const finalArgv = [cmd, ...argv.slice(1)];
  return {
    argv: finalArgv,
    resolvedBinary: resolved,
    useCrossSpawn: shouldUseCrossSpawn(resolved),
    label,
  };
}

function claudeArgv(prompt: string, unattended: UnattendedContract): string[] {
  const tools = unattended.allowed_tools?.length
    ? unattended.allowed_tools
    : ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
  const argv = ['claude', '-p', prompt, '--allowedTools', tools.join(',')];
  if (unattended.approval_mode === 'never') {
    argv.push('--permission-mode', 'dontAsk');
  } else {
    argv.push('--permission-mode', 'acceptEdits');
  }
  return argv;
}

function codexArgv(prompt: string, unattended: UnattendedContract): string[] {
  const argv = ['codex', 'exec'];
  argv.push(
    '--sandbox',
    unattended.write_mode === 'full-access' ? 'danger-full-access' : 'workspace-write',
  );
  argv.push(
    '--ask-for-approval',
    unattended.approval_mode === 'never' ? 'never' : 'on-request',
  );
  argv.push(prompt);
  return argv;
}

/**
 * Cursor headless — positional prompt per CLI help; -p includes write/shell.
 * approval_mode=never → --force --trust (unattended workspace trust).
 */
export function cursorHeadlessPlan(
  unattended: UnattendedContract,
  prompt: string,
  resolved: ResolvedHeadlessBinary | null,
): HeadlessInvokePlan {
  const binary = resolved?.path ?? 'cursor-agent';
  const argv = [binary, '-p'];
  if (unattended.approval_mode === 'never') {
    argv.push('--force', '--trust');
  }
  argv.push(prompt);
  const base = path.basename(binary);
  return {
    argv,
    resolvedBinary: resolved,
    useCrossSpawn: shouldUseCrossSpawn(resolved),
    label: `${base} -p …`,
  };
}

function genericStdinPlan(prompt: string): HeadlessInvokePlan {
  return {
    argv: ['agent-cli', '-'],
    useStdin: true,
    stdin: prompt,
    label: 'agent-cli - (stdin)',
  };
}

/** Tokenize a simple command line; respects double-quoted segments. */
export function tokenizeInvokeCommand(command: string): string[] {
  const args: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(c)) {
      if (cur.length > 0) {
        args.push(cur);
        cur = '';
      }
      continue;
    }
    cur += c;
  }
  if (cur.length > 0) args.push(cur);
  return args;
}

/** Replace sentinel tokens in argv with the full prompt string (single element). */
export function injectPromptIntoArgv(argv: string[], promptContent: string): string[] {
  return argv.map((a) => (a === PROMPT_ARGV_SENTINEL ? promptContent : a));
}

function planFromTemplate(
  template: string,
  promptContent: string,
  vars: Omit<InvokeTemplateVars, 'PROMPT'>,
): HeadlessInvokePlan {
  const normalized = normalizeHeadlessTemplate(template);
  const shellPreview = renderInvokeTemplate(normalized, {
    ...vars,
    PROMPT: promptContent,
  });
  if (shellPreview.includes('| agent-cli -') || shellPreview.trim().endsWith('| agent-cli -')) {
    return genericStdinPlan(promptContent);
  }
  const tokenized = renderInvokeTemplate(normalized, {
    ...vars,
    PROMPT: PROMPT_ARGV_SENTINEL,
  });
  const argv = injectPromptIntoArgv(tokenizeInvokeCommand(tokenized), promptContent);
  const label =
    argv[0] === 'claude' ||
    argv[0] === 'codex' ||
    argv[0] === 'cursor' ||
    argv[0] === 'cursor-agent' ||
    argv[0] === 'agent'
      ? `${argv.slice(0, 3).join(' ')} …`
      : `${argv[0]} …`;
  return { argv, label };
}

/** Built-in hardened plans when adapter omits headless_invoke. */
export function defaultHeadlessInvokePlan(
  adapterName: string,
  unattended: UnattendedContract,
  promptContent: string,
): HeadlessInvokePlan {
  if (adapterName === 'claude') {
    const argv = claudeArgv(promptContent, unattended);
    return attachResolvedBinary(argv, CLAUDE_HEADLESS_BINARY_CANDIDATES, argv.slice(0, 3).join(' ') + ' …');
  }
  if (adapterName === 'codex') {
    const argv = codexArgv(promptContent, unattended);
    return attachResolvedBinary(argv, CODEX_HEADLESS_BINARY_CANDIDATES, argv.slice(0, 2).join(' ') + ' …');
  }
  if (adapterName === 'cursor') {
    const resolved = resolveHeadlessBinary([...CURSOR_HEADLESS_BINARY_CANDIDATES]);
    return cursorHeadlessPlan(unattended, promptContent, resolved);
  }
  return genericStdinPlan(promptContent);
}

/** @deprecated Use defaultHeadlessInvokePlan; kept for unit tests comparing flags. */
export function defaultHeadlessInvoke(adapterName: string, unattended: UnattendedContract): string {
  const plan = defaultHeadlessInvokePlan(adapterName, unattended, '{{PROMPT}}');
  return plan.label;
}

export function resolveHeadlessInvokePlan(
  adapterName: string,
  capability: GoalCapabilitySpec,
  unattended: UnattendedContract,
  promptContent: string,
  vars: InvokeTemplateVars,
): HeadlessInvokePlan {
  if (KNOWN_STRUCTURED_ADAPTERS.has(adapterName)) {
    return defaultHeadlessInvokePlan(adapterName, unattended, promptContent);
  }
  const custom = capability.external_runner?.headless_invoke?.trim();
  if (custom) {
    const { PROMPT: _drop, ...rest } = vars;
    return planFromTemplate(custom, promptContent, rest);
  }
  return defaultHeadlessInvokePlan(adapterName, unattended, promptContent);
}

/** Preflight: same resolution semantics as invokeAgentHeadless. */
export function validateHeadlessBinaryForPlan(
  adapterName: string,
  plan: HeadlessInvokePlan,
): { ok: true } | { ok: false; message: string } {
  const candidates = STRUCTURED_BINARY_CANDIDATES[adapterName];
  if (!candidates) return { ok: true };

  const resolved = plan.resolvedBinary ?? resolveHeadlessBinary([...candidates]);
  const issue = formatHeadlessBinaryIssue(adapterName, [...candidates], resolved);
  if (issue) return { ok: false, message: issue };
  if (!headlessBinarySpawnable(resolved)) {
    return { ok: false, message: issue || `${adapterName} 无头 CLI 不可 spawn` };
  }
  return { ok: true };
}

/** @deprecated Use resolveHeadlessInvokePlan */
export function resolveHeadlessCommand(
  adapterName: string,
  capability: GoalCapabilitySpec,
  unattended: UnattendedContract,
  vars: InvokeTemplateVars,
): string {
  const plan = resolveHeadlessInvokePlan(
    adapterName,
    capability,
    unattended,
    vars.PROMPT || '',
    vars,
  );
  return plan.label;
}

export interface AgentInvokeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  skipped?: boolean;
}

function spawnHeadless(
  plan: HeadlessInvokePlan,
  cwd: string,
  timeoutMs?: number,
): ReturnType<typeof spawnSync> {
  const opts = {
    cwd,
    encoding: 'utf-8' as const,
    input: plan.useStdin ? plan.stdin : undefined,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  };
  if (plan.useCrossSpawn) {
    return crossSpawn.sync(plan.argv[0], plan.argv.slice(1), opts);
  }
  return spawnSync(plan.argv[0], plan.argv.slice(1), { ...opts, shell: false });
}

export function invokeAgentHeadless(
  plan: HeadlessInvokePlan,
  cwd: string,
  opts?: { dryRun?: boolean; timeoutMs?: number },
): AgentInvokeResult {
  const command = plan.label;
  if (opts?.dryRun) {
    return { exitCode: 0, stdout: '[dry-run] agent invoke skipped', stderr: '', command, skipped: true };
  }

  if (plan.resolvedBinary && !headlessBinarySpawnable(plan.resolvedBinary)) {
    const adapterGuess =
      plan.argv[0]?.includes('claude') ? 'claude'
      : plan.argv[0]?.includes('codex') ? 'codex'
      : 'cursor';
    const candidates = STRUCTURED_BINARY_CANDIDATES[adapterGuess] ?? [...CURSOR_HEADLESS_BINARY_CANDIDATES];
    return {
      exitCode: 1,
      stdout: '',
      stderr: formatHeadlessBinaryIssue(adapterGuess, [...candidates], plan.resolvedBinary),
      command,
    };
  }

  const result = spawnHeadless(plan, cwd, opts?.timeoutMs);
  return {
    exitCode: result.status ?? 1,
    stdout: (result.stdout as string) ?? '',
    stderr: (result.stderr as string) ?? '',
    command,
  };
}
