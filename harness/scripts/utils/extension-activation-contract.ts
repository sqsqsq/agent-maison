import * as path from 'path';
import type { PhaseInvocationChange } from './phase-write-boundary';

export interface ExtensionActivationStep {
  id: string;
  cwd: string;
  run: string[];
  outputs: string[];
  undo?: string[];
}

export interface ExtensionActivationOutput {
  path: string;
  kind: 'file' | 'directory';
  sha256: string;
  members?: Record<string, string>;
}

export interface ExtensionActivationStepResult {
  id: string;
  declaration_sha256: string;
  status: 'running' | 'applied' | 'undoing' | 'undone';
  outputs: ExtensionActivationOutput[];
  undo_done?: true;
  failure?: string;
}

export interface ExtensionActivationResult {
  instance_id: string;
  input_sha256: string;
  status: 'running' | 'enabled' | 'failed' | 'disabled';
  steps: ExtensionActivationStepResult[];
  failure?: string;
  residuals?: PhaseInvocationChange[];
}

const abilityId = /^[a-zA-Z0-9_-]+$/;
const stepId = /^[a-z][a-z0-9_-]*$/;
const sha256 = /^[a-f0-9]{64}$/;
const instanceId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function mapping(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.split('/').every(part =>
    part.length > 0 && !/[\\:<>|?*"\x00-\x1f]|[. ]$|^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}

export function extensionActivationPathWithin(value: string, parent: string): boolean {
  if (process.platform === 'win32') {
    value = value.toLowerCase();
    parent = parent.toLowerCase();
  }
  return value === parent || value.startsWith(parent + '/');
}

function overlaps(first: string, second: string): boolean {
  return extensionActivationPathWithin(first, second) || extensionActivationPathWithin(second, first);
}

function command(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(arg => typeof arg === 'string' && !arg.includes('\0'))
    && value[0].trim().length > 0;
}

export function isExtensionNpmCommand(argv: readonly string[]): boolean {
  return /^npm(?:\.cmd|\.exe)?$/i.test(path.win32.basename(argv[0]));
}

function checkNpm(step: ExtensionActivationStep): void {
  for (const argv of [step.run, step.undo]) {
    if (!argv || !isExtensionNpmCommand(argv)) continue;
    const cache = argv.filter(arg => /^--cache(?:=|$)/.test(arg));
    if (cache.length !== 1 || argv[argv.indexOf('--cache') + 1] !== './.npm-cache'
      || !step.outputs.includes(step.cwd + '/.npm-cache')
      || argv[1] === 'ci' && !step.outputs.includes(step.cwd + '/node_modules')) {
      throw new Error(`步骤 ${step.id} 的 npm 命令须显式使用 --cache ./.npm-cache 并声明对应输出；npm ci 同时须声明 node_modules`);
    }
  }
}

export function parseExtensionActivation(ability: string, raw: unknown): ExtensionActivationStep[] {
  const invalid = () => new Error(`activation.${ability} 的步骤、命令或能力私有路径无效`);
  if (!abilityId.test(ability) || !mapping(raw) || !hasOnly(raw, ['steps'])
    || !Array.isArray(raw.steps) || raw.steps.length === 0) throw invalid();
  const privateCwd = `skills/${ability}`;
  const knowledge = `knowledge/${ability}`;
  const ids = new Set<string>();
  const outputs: string[] = [];
  return raw.steps.map((row: unknown) => {
    if (!mapping(row) || !hasOnly(row, ['id', 'cwd', 'run', 'outputs', 'undo'])
      || typeof row.id !== 'string' || !stepId.test(row.id) || ids.has(row.id)
      || !safePath(row.cwd) || !extensionActivationPathWithin(row.cwd, privateCwd)
      || !command(row.run) || row.undo !== undefined && !command(row.undo) || !Array.isArray(row.outputs)) throw invalid();
    ids.add(row.id);
    for (const out of row.outputs) {
      if (!safePath(out) || !(extensionActivationPathWithin(out, knowledge) || out.startsWith(privateCwd + '/'))
        || outputs.some(existing => overlaps(out, existing))) throw invalid();
      outputs.push(out);
    }
    const step = { id: row.id, cwd: row.cwd, run: row.run, outputs: row.outputs, ...(row.undo ? { undo: row.undo } : {}) };
    checkNpm(step);
    return step;
  });
}

export function isExtensionActivationOutput(steps: readonly ExtensionActivationStep[], relative: string): boolean {
  return steps.some(step => step.outputs.some(output => extensionActivationPathWithin(relative, output)));
}

export function validateExtensionActivationOwnership(
  ability: string, steps: readonly ExtensionActivationStep[], protectedFiles: Iterable<string>,
): void {
  const outputs = steps.flatMap(step => step.outputs);
  for (const file of protectedFiles) {
    const output = outputs.find(candidate => overlaps(file, candidate));
    if (output) throw new Error(`activation.${ability} 的输出 ${output} 与已安装源/共享资源 ${file} 重叠`);
  }
  const cwd = steps.find(step => outputs.some(out => extensionActivationPathWithin(step.cwd, out)));
  if (cwd) throw new Error(`activation.${ability} 的工作目录 ${cwd.cwd} 不能是启用输出`);
}

export function parseExtensionActivationResult(
  ability: string, raw: unknown, steps?: readonly ExtensionActivationStep[],
): ExtensionActivationResult | undefined {
  if (raw === undefined) return undefined;
  const invalid = () => new Error(`installations.${ability}.activation_result 格式无效`);
  if (!abilityId.test(ability) || !mapping(raw) || !hasOnly(raw, ['status', 'instance_id', 'input_sha256', 'steps', 'failure', 'residuals'])
    || typeof raw.instance_id !== 'string' || !instanceId.test(raw.instance_id)
    || typeof raw.input_sha256 !== 'string' || !sha256.test(raw.input_sha256) || typeof raw.status !== 'string'
    || !['running', 'enabled', 'failed', 'disabled'].includes(raw.status) || !Array.isArray(raw.steps)
    || raw.failure !== undefined && typeof raw.failure !== 'string') throw invalid();
  const ids = new Set<string>();
  for (const [index, row] of raw.steps.entries()) {
    if (!mapping(row) || !hasOnly(row, ['id', 'declaration_sha256', 'status', 'outputs', 'undo_done', 'failure'])
      || typeof row.id !== 'string' || !stepId.test(row.id) || ids.has(row.id)
      || typeof row.declaration_sha256 !== 'string' || !sha256.test(row.declaration_sha256)
      || typeof row.status !== 'string' || !['running', 'applied', 'undoing', 'undone'].includes(row.status)
      || row.undo_done !== undefined && row.undo_done !== true || row.failure !== undefined && typeof row.failure !== 'string'
      || !Array.isArray(row.outputs) || steps && row.status !== 'undone' && steps[index]?.id !== row.id) throw invalid();
    ids.add(row.id);
    const outputs = new Set<string>();
    for (const out of row.outputs) {
      if (!mapping(out) || !hasOnly(out, ['path', 'kind', 'sha256', 'members']) || !safePath(out.path)
        || !(out.path.startsWith(`skills/${ability}/`) || extensionActivationPathWithin(out.path, `knowledge/${ability}`))
        || out.kind !== 'file' && out.kind !== 'directory' || typeof out.sha256 !== 'string' || !sha256.test(out.sha256)
        || out.members !== undefined && (out.kind !== 'directory' || !mapping(out.members)
          || Object.entries(out.members).some(([key, hash]) => !safePath(key) || key.includes('/')
            || typeof hash !== 'string' || !sha256.test(hash)))
        || outputs.has(out.path) || steps && row.status !== 'undone' && !steps[index]?.outputs.includes(out.path)) throw invalid();
      outputs.add(out.path);
    }
    if (raw.status === 'enabled' && (row.status !== 'applied' || row.failure !== undefined
      || steps && steps[index].outputs.length !== row.outputs.length)) throw invalid();
    if (raw.status === 'disabled' && row.status !== 'undone') throw invalid();
  }
  if (raw.status === 'enabled' && steps && raw.steps.length !== steps.length) throw invalid();
  if (raw.residuals !== undefined && (!Array.isArray(raw.residuals) || raw.residuals.some(row =>
    !mapping(row) || !hasOnly(row, ['path', 'how', 'preSha256', 'postSha256']) || !safePath(row.path)
    || !['added', 'removed', 'modified', 'type-changed'].includes(String(row.how))
    || ![row.preSha256, row.postSha256].every(value => value === null || typeof value === 'string' && sha256.test(value))))) {
    throw invalid();
  }
  return raw as unknown as ExtensionActivationResult;
}
