/**
 * Agent headless invoke — structured spawn for claude -p / codex exec (no shell cat).
 */

import { spawnSync } from 'child_process';
import type { UnattendedContract } from './goal-manifest';
import type { GoalCapabilitySpec } from './goal-adapter-capability';

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
  /** Pass prompt via stdin instead of argv (generic pipe adapters). */
  useStdin?: boolean;
  stdin?: string;
  /** Human-readable label for logs / dry-run. */
  label: string;
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

function cursorArgv(prompt: string): string[] {
  return ['cursor', 'agent', '--print', prompt];
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
    argv[0] === 'claude' || argv[0] === 'codex' || argv[0] === 'cursor'
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
    return { argv, label: argv.slice(0, 3).join(' ') + ' …' };
  }
  if (adapterName === 'codex') {
    const argv = codexArgv(promptContent, unattended);
    return { argv, label: argv.slice(0, 2).join(' ') + ' …' };
  }
  if (adapterName === 'cursor') {
    const argv = cursorArgv(promptContent);
    return { argv, label: argv.slice(0, 3).join(' ') + ' …' };
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

export function invokeAgentHeadless(
  plan: HeadlessInvokePlan,
  cwd: string,
  opts?: { dryRun?: boolean; timeoutMs?: number },
): AgentInvokeResult {
  const command = plan.label;
  if (opts?.dryRun) {
    return { exitCode: 0, stdout: '[dry-run] agent invoke skipped', stderr: '', command, skipped: true };
  }
  const result = spawnSync(plan.argv[0], plan.argv.slice(1), {
    cwd,
    shell: false,
    encoding: 'utf-8',
    input: plan.useStdin ? plan.stdin : undefined,
    timeout: opts?.timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    command,
  };
}
