import { spawnSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { validateProjectRelativePath } from './project-relative-path';

export function relativeExtensionPath(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, '/');
}

/** Keep ownership attached to an actual file in the selected directory, never to a link or alias. */
export function ordinaryPath(root: string, relative: string, label: string): string {
  const safe = validateProjectRelativePath(root, relative, label);
  let current = root;
  const parts = safe.split('/').filter(part => part && part !== '.');
  if (parts.length === 0 || parts.some(part => part.includes(':') || /[. ]$/.test(part))) {
    throw new Error(`${label}: 非法路径 ${relative}`);
  }
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const entry = fs.lstatSync(current, { throwIfNoEntry: false });
    if (entry?.isSymbolicLink()) throw new Error(`${label}: 不支持符号链接或 junction ${relative}`);
    if (entry && index < parts.length - 1 && !entry.isDirectory()) {
      throw new Error(`${label}: 父路径不是目录 ${relative}`);
    }
  }
  return current;
}

export function ordinaryFile(root: string, relative: string): string {
  const target = ordinaryPath(root, relative, 'extension 文件');
  const entry = fs.lstatSync(target, { throwIfNoEntry: false });
  if (entry && !entry.isFile()) throw new Error(`extension 路径不是普通文件：${relative}`);
  return target;
}

export interface ExtensionFileChange {
  path: string;
  pre_sha256: string | null;
  post_sha256: string | null;
}

export type ObserveExtensionWrite = (change: ExtensionFileChange) => void;

function currentDigest(file: string): string | null {
  return fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
}

export function writeExtensionFileAtomic(
  target: string, bytes: string | Buffer, createOnly = false, observe?: ObserveExtensionWrite,
): void {
  const before = observe && !createOnly ? currentDigest(target) : null;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const destination = createOnly ? target : path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const fd = fs.openSync(destination, 'wx');
  try {
    try { fs.writeFileSync(fd, bytes); }
    finally { fs.closeSync(fd); }
    if (!createOnly) fs.renameSync(destination, target);
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  }
  if (observe) {
    const after = createHash('sha256').update(bytes).digest('hex');
    if (before !== after) observe({ path: target, pre_sha256: before, post_sha256: after });
  }
}

export function removeExtensionFile(target: string, observe?: ObserveExtensionWrite): void {
  const before = observe ? currentDigest(target) : null;
  fs.unlinkSync(target);
  if (observe && before !== null) observe({ path: target, pre_sha256: before, post_sha256: null });
}

export function extensionGitPaths(projectRoot: string, args: readonly string[]): string[] | undefined {
  const opts = { cwd: projectRoot, encoding: 'utf8' as const, windowsHide: true, maxBuffer: 16 * 1024 * 1024 };
  const repository = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], opts);
  if (repository.error || repository.status !== 0) {
    if (!repository.error && /not a git repository/i.test(repository.stderr)) return undefined;
    throw new Error(`无法核对扩展路径的 Git 归属：${repository.error?.message ?? repository.stderr.trim()}`);
  }
  const result = spawnSync('git', ['--literal-pathspecs', ...args], opts);
  if (result.error || result.status !== 0) {
    throw new Error(`无法核对扩展路径的 Git 归属：${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.split('\0').filter(Boolean);
}

type CheckoutText = { object: string; workingEol: string; attr: string };

function extensionCheckout(root: string) {
  let index: Map<string, CheckoutText> | undefined;
  let config: Map<string, string> | undefined;

  function lookup(relative: string): CheckoutText | undefined {
    if (!index) {
      index = new Map();
      const entries = extensionGitPaths(root, ['ls-files', '--stage', '--eol', '-z', '--', '.']) ?? [];
      for (const row of entries) {
        const data = /^100(?:644|755) ([a-f0-9]{40}|[a-f0-9]{64}) 0\ti\/lf +w\/(lf|crlf|mixed) +attr\/([^\t]*)\t([\s\S]+)$/.exec(row);
        if (data) index.set(data[4], { object: data[1], workingEol: data[2], attr: data[3].trim() });
      }
    }
    const entry = index.get(relative);
    return entry?.attr === '-text' ? undefined : entry;
  }

  function expectedEol(entry: CheckoutText): 'lf' | 'crlf' | undefined {
    const explicitEol = /(?:^| )eol=(lf|crlf)(?: |$)/.exec(entry.attr)?.[1];
    if (explicitEol === 'lf' || explicitEol === 'crlf') return explicitEol;
    if (!config) {
      const result = spawnSync('git', ['config', '--get-regexp', '^core\\.(autocrlf|eol)$'],
        { cwd: root, encoding: 'utf8', windowsHide: true });
      if (result.error || result.status !== 0 && result.status !== 1) return undefined;
      config = new Map(result.stdout.trim().split(/\r?\n/).map(row => {
        const space = row.indexOf(' ');
        return [row.slice(0, space), row.slice(space + 1).toLowerCase()];
      }));
    }
    const auto = config.get('core.autocrlf');
    const eol = config.get('core.eol') ?? 'native';
    const usesCrlf = auto === '' || ['true', 'yes', 'on', '1'].includes(auto ?? 'false')
      || auto !== 'input' && /(?:^| )text(?: |$|=auto)/.test(entry.attr)
        && (eol === 'crlf' || eol === 'native' && process.platform === 'win32');
    return usesCrlf ? 'crlf' : 'lf';
  }

  return { lookup, expectedEol };
}

export function extensionTrackedTextEol(root: string): (relative: string) => 'lf' | 'crlf' | undefined {
  const checkout = extensionCheckout(root);
  return relative => {
    const entry = checkout.lookup(relative);
    return entry && checkout.expectedEol(entry);
  };
}

/** Stored ownership is byte-exact, with an exception for Git's verified text checkout. */
export function extensionFingerprintMatcher(root: string) {
  const checkout = extensionCheckout(root);
  return (relative: string, bytes: Buffer, expected: string, observed = createHash('sha256').update(bytes).digest('hex')): boolean => {
    if (observed === expected) return true;
    const content = bytes.toString('latin1');
    if (!content.includes('\n')) return false;
    const normalized = content.replace(/\r\n/g, '\n');
    const plain = Buffer.from(normalized, 'latin1');
    const hasCrlf = content !== normalized;
    const alternate = hasCrlf ? plain : Buffer.from(normalized.replace(/\n/g, '\r\n'), 'latin1');
    if (createHash('sha256').update(alternate).digest('hex') !== expected) return false;

    const entry = checkout.lookup(relative);
    const observedEol = hasCrlf ? 'crlf' : 'lf';
    if (!entry || entry.workingEol !== observedEol) return false;
    const object = createHash(entry.object.length === 40 ? 'sha1' : 'sha256')
      .update(`blob ${plain.length}\0`).update(plain).digest('hex');
    if (object !== entry.object) return false;

    return checkout.expectedEol(entry) === observedEol;
  };
}

export function assertUnlinkedExtensionTree(target: string, allowInternalLinks = false): void {
  const walk = (entry: string): void => {
    const stat = fs.lstatSync(entry, { throwIfNoEntry: false });
    if (!stat) return;
    if (path.basename(entry).toLowerCase() === '.git') throw new Error(`扩展输出含 Git 管理资料：${entry}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entry)) walk(path.join(entry, name));
      return;
    }
    if (stat.isFile() && stat.nlink === 1) return;
    if (allowInternalLinks && stat.isSymbolicLink()) {
      const link = path.relative(target, fs.realpathSync(entry));
      if (link && !path.isAbsolute(link) && link !== '..' && !link.startsWith('..' + path.sep)) return;
    }
    throw new Error(`扩展路径含其他文件类型、硬链接或跨目录链接：${entry}`);
  };
  walk(target);
}
