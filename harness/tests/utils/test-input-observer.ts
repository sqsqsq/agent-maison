import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { REPO_ROOT } from './test-dependency-graph';

export interface ObservedNodeLaunch { entry?: string; eval?: boolean; pid?: number; exited: boolean; code?: number | null; signal?: string | null }
export interface TestInputReads { files: string[]; directories: string[]; complete: boolean; reasons: string[]; expectedPids?: number[]; nodeLaunches?: ObservedNodeLaunch[]; coverageUnknown?: string[]; aliases?: Array<[string, string]>; generatedFiles?: string[] }
export function observeTestInputs(): { finish(): TestInputReads } {
  const files = new Set<string>(), directories = new Set<string>();
  const restores: Array<() => void> = [];
  let complete = true;
  const expectedPids = new Set<number>(), coverageUnknown = new Set<string>();
  const aliases: Array<[string, string]> = [];
  const generatedFiles = new Set<string>();
  const nodeLaunches: ObservedNodeLaunch[] = [];
  const record = (value: unknown, directory: boolean): void => {
    try {
      const file = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;
      if (typeof file !== 'string') return;
      if (path.resolve(file).split(/[\\/]/).includes('node_modules')) return;
      (directory ? directories : files).add(path.resolve(file));
    } catch { complete = false; }
  };
  const instrument = (target: object, names: string[], directory = false): void => {
    for (const name of names) {
      const object = target as Record<string, unknown>;
      const original = object[name];
      if (typeof original !== 'function') { complete = false; continue; }
      const descriptor = Object.getOwnPropertyDescriptor(object, name)!;
      try {
        const wrapped = function(this: unknown, ...args: unknown[]) {
          record(args[0], directory); return original.apply(this, args);
        };
        Object.assign(wrapped, original);
        if ('native' in original) (wrapped as unknown as { native: Function }).native = function(this: unknown, ...args: unknown[]) { record(args[0], directory); return (original as unknown as { native: Function }).native.apply(this, args); };
        Object.defineProperty(object, name, { ...descriptor, value: wrapped });
        restores.push(() => Object.defineProperty(object, name, descriptor));
      } catch { complete = false; }
    }
  };
  const nativeFs = require('fs') as typeof fs;
  instrument(nativeFs, ['readFile', 'readFileSync', 'open', 'openSync', 'exists', 'existsSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync', 'realpath', 'realpathSync', 'createReadStream']);
  instrument(nativeFs, ['readdir', 'readdirSync', 'opendir', 'opendirSync'], true);
  instrument(nativeFs.promises, ['readFile', 'open', 'stat', 'lstat', 'access', 'realpath']);
  instrument(nativeFs.promises, ['readdir', 'opendir'], true);
  for (const name of ['copyFileSync', 'copyFile', 'cpSync', 'cp', 'symlinkSync', 'symlink']) {
    const object = nativeFs as unknown as Record<string, Function>;
    const original = object[name];
    object[name] = function(this: unknown, ...args: unknown[]) {
      if (typeof args[0] === 'string' && typeof args[1] === 'string' && !args[0].split(/[\\/]/).includes('node_modules')) {
        if (name.startsWith('copyFile')) record(args[0], false);
        if (name === 'cp' || name === 'cpSync') record(args[0], true);
        const source = name.startsWith('symlink') && !path.isAbsolute(args[0]) ? path.resolve(path.dirname(args[1]), args[0]) : path.resolve(args[0]);
        aliases.push([path.resolve(args[1]), source]);
      }
      return original.apply(this, args);
    };
    restores.push(() => { object[name] = original; });
  }
  for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream']) {
    const object = nativeFs as unknown as Record<string, Function>, original = object[name];
    object[name] = function(this: unknown, ...args: unknown[]) { if (typeof args[0] === 'string') generatedFiles.add(path.resolve(args[0])); return original.apply(this, args); };
    restores.push(() => { object[name] = original; });
  }
  const cp = require('child_process') as Record<string, Function>;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec', 'execSync']) {
    const original = cp[name];
    cp[name] = function(this: unknown, ...args: unknown[]) {
      const command = [args[0], ...(Array.isArray(args[1]) ? args[1] : [])].join(' ');
      const guardian = /agent-guardian\.ps1/.test(command);
      let argv: string[] | undefined;
      if (guardian) {
        try {
          const cli = args[1] as string[], index = cli.indexOf('-AgentJson');
          const agent = JSON.parse(Buffer.from(cli[index + 1], 'base64').toString('utf16le')) as { argv: string[]; appName?: string };
          if (/node(?:\.exe)?$/i.test(agent.appName ?? agent.argv[0])) argv = agent.argv.slice(1);
        } catch { coverageUnknown.add('unreadable guardian Node command'); }
      } else if (/node(?:\.exe)?$/i.test(String(args[0])) || name === 'fork') argv = name === 'fork' ? [String(args[0]), ...(Array.isArray(args[1]) ? args[1] : [])] : Array.isArray(args[1]) ? args[1] : undefined;
      const launch: ObservedNodeLaunch | undefined = argv && { exited: false, eval: argv.includes('-e') || argv.includes('--eval'), entry: argv.find(value => /\.[cm]?[jt]s$/.test(value) && !value.split(/[\\/]/).includes('node_modules')) };
      if (launch) nodeLaunches.push(launch);
      let result;
      try { result = original.apply(this, args); }
      catch (error) { if (launch) coverageUnknown.add('Node spawn failed'); throw error; }
      if (launch) {
        if (!guardian && typeof result?.pid === 'number') { launch.pid = result.pid; expectedPids.add(result.pid); }
        if (name.endsWith('Sync')) { launch.exited = true; launch.code = result?.status ?? null; launch.signal = result?.signal; }
        else result?.once?.('close', (code: number | null, signal: string | null) => Object.assign(launch, { exited: true, code, signal }));
        if (!guardian && !launch.pid) coverageUnknown.add(`unobserved ${name} node PID`);
      }
      return result;
    };
    restores.push(() => { cp[name] = original; });
  }
  return { finish() { for (const restore of restores.reverse()) restore(); return { files: [...files].sort(), directories: [...directories].sort(), complete, reasons: complete ? [] : ['test fs observation incomplete'], expectedPids: [...expectedPids], nodeLaunches, coverageUnknown: [...coverageUnknown], aliases, generatedFiles: [...generatedFiles] }; } };
}

export function guardFunctionProcesses(): (() => void) & { violations: string[] } {
  const cp = require('child_process') as Record<string, unknown>;
  const restores: Array<() => void> = [];
  const violations: string[] = [];
  const Module = require('module') as { _load: Function; _resolveFilename: Function };
  const load = Module._load;
  Module._load = function(this: unknown, ...args: unknown[]) {
    const resolved = String(Module._resolveFilename.apply(Module, args));
    if (/(?:^|[\\/])goal-(?:runner|phase-runtime|loop)\.ts$/.test(resolved)) { const error = `function suite cannot load goal entry: ${resolved}`; violations.push(error); throw new Error(error); }
    return load.apply(this, args);
  };
  restores.push(() => { Module._load = load; });
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    const original = cp[name];
    cp[name] = () => { const error = `function suite cannot call child_process.${name}`; violations.push(error); throw new Error(error); };
    restores.push(() => { cp[name] = original; });
  }
  return Object.assign(() => { for (const restore of restores) restore(); }, { violations });
}
