import * as path from 'path';

export type ExtensionActivationReady = { version_file: string; version_field?: string } | { check: string[] };

export interface ExtensionActivationStep {
  id: string;
  cwd: string;
  scope: 'local' | 'repo';
  run: string[];
  outputs: string[];
  ready: ExtensionActivationReady;
  undo?: string[];
  project_outputs?: string[];
}

const token = /^[a-zA-Z0-9_-]+$/;
const stepId = /^[a-z][a-z0-9_-]*$/;

function mapping(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.split('/').every(part =>
    part.length > 0 && !/[\\:<>|?*"\[\]#\x00-\x1f]|[. ]$|^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}

export function extensionActivationPathWithin(value: string, parent: string): boolean {
  if (process.platform === 'win32') {
    value = value.toLowerCase();
    parent = parent.toLowerCase();
  }
  return value === parent || value.startsWith(parent + '/');
}

export function extensionActivationPathsOverlap(first: string, second: string): boolean {
  return extensionActivationPathWithin(first, second) || extensionActivationPathWithin(second, first);
}

function command(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(arg => typeof arg === 'string' && !arg.includes('\0'))
    && (value[0] as string).trim().length > 0;
}

export function isExtensionNpmCommand(argv: readonly string[]): boolean {
  return /^npm(?:\.cmd|\.exe)?$/i.test(path.win32.basename(argv[0]));
}

function npmOutput(step: ExtensionActivationStep, output: string): string {
  return step.cwd === '.' ? output : step.cwd + '/' + output;
}

export function parseExtensionActivation(plugin: string, raw: unknown): ExtensionActivationStep[] {
  const invalid = () => new Error(`插件 ${plugin} 的 activation.steps、命令、就绪条件或私有路径无效`);
  if (!token.test(plugin) || !mapping(raw) || !hasOnly(raw, ['steps'])
    || !Array.isArray(raw.steps) || raw.steps.length === 0) throw invalid();
  const ids = new Set<string>();
  const paths: string[] = [];
  const projectPaths: string[] = [];
  return raw.steps.map((row: unknown) => {
    if (!mapping(row) || !hasOnly(row, ['id', 'cwd', 'scope', 'run', 'outputs', 'ready', 'undo', 'project_outputs'])
      || typeof row.id !== 'string' || !stepId.test(row.id) || ids.has(row.id)
      || row.cwd !== '.' && !safePath(row.cwd) || !command(row.run) || !Array.isArray(row.outputs)
      || !mapping(row.ready)
      || row.scope !== 'local' && row.scope !== 'repo'
      || row.scope === 'local' && (!row.outputs.length || row.undo !== undefined || row.project_outputs !== undefined)
      || row.scope === 'repo' && (!command(row.undo) || row.project_outputs !== undefined && !Array.isArray(row.project_outputs))) throw invalid();
    const outputs: string[] = [];
    for (const out of row.outputs) {
      if (!safePath(out) || out.toLowerCase() === 'manifest.yaml' || paths.some(existing => extensionActivationPathsOverlap(out, existing))) throw invalid();
      paths.push(out);
      outputs.push(out);
    }
    const projectOutputs: string[] = [];
    for (const out of Array.isArray(row.project_outputs) ? row.project_outputs : []) {
      if (!safePath(out) || projectPaths.some(existing => extensionActivationPathsOverlap(out, existing))) throw invalid();
      projectPaths.push(out);
      projectOutputs.push(out);
    }
    let ready: ExtensionActivationReady;
    if (safePath(row.ready.version_file) && hasOnly(row.ready, ['version_file', 'version_field'])
      && (row.ready.version_field === undefined || typeof row.ready.version_field === 'string' && row.ready.version_field.trim())) {
      const versionFile = row.ready.version_file;
      if (row.scope === 'local' && !outputs.some(output => extensionActivationPathWithin(versionFile, output))) throw invalid();
      ready = { version_file: versionFile,
        ...(typeof row.ready.version_field === 'string' ? { version_field: row.ready.version_field } : {}) };
    } else if (command(row.ready.check) && hasOnly(row.ready, ['check'])) {
      ready = { check: row.ready.check };
    } else throw invalid();
    ids.add(row.id);
    const step: ExtensionActivationStep = { id: row.id, cwd: row.cwd, scope: row.scope, run: row.run, outputs, ready,
      ...(command(row.undo) ? { undo: row.undo } : {}), ...(projectOutputs.length ? { project_outputs: projectOutputs } : {}) };
    for (const argv of [step.run, step.undo]) {
      if (!argv || !isExtensionNpmCommand(argv)) continue;
      const cache = argv.filter(arg => /^--cache(?:=|$)/.test(arg));
      if (cache.length !== 1 || argv[argv.indexOf('--cache') + 1] !== './.npm-cache'
        || !outputs.includes(npmOutput(step, '.npm-cache'))
        || argv[1] === 'ci' && !outputs.includes(npmOutput(step, 'node_modules'))) {
        throw new Error(`步骤 ${step.id} 的 npm 命令须显式使用 --cache ./.npm-cache 并声明对应输出；npm ci 同时须声明 node_modules`);
      }
    }
    return step;
  });
}

export function isExtensionActivationOutput(steps: readonly ExtensionActivationStep[], relative: string): boolean {
  return steps.some(step => step.outputs.some(output => extensionActivationPathWithin(relative, output)));
}

export function validateExtensionActivationOwnership(
  plugin: string, steps: readonly ExtensionActivationStep[], protectedFiles: Iterable<string>,
): void {
  const outputs = steps.flatMap(step => step.outputs);
  for (const file of protectedFiles) {
    const output = outputs.find(candidate => extensionActivationPathsOverlap(file, candidate));
    if (output) throw new Error(`插件 ${plugin} 的输出 ${output} 与已安装源/共享资源 ${file} 重叠`);
  }
  const cwd = steps.find(step => outputs.some(out => extensionActivationPathWithin(step.cwd, out)));
  if (cwd) throw new Error(`插件 ${plugin} 的工作目录 ${cwd.cwd} 不能是启用输出`);
}
