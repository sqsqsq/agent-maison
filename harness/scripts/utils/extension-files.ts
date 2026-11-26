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
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx');
  try {
    try { fs.writeFileSync(fd, bytes); }
    finally { fs.closeSync(fd); }
    if (createOnly) fs.linkSync(temp, target);
    else fs.renameSync(temp, target);
    if (observe) {
      const after = createHash('sha256').update(bytes).digest('hex');
      if (before !== after) observe({ path: target, pre_sha256: before, post_sha256: after });
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function removeExtensionFile(target: string, observe?: ObserveExtensionWrite): void {
  const before = observe ? currentDigest(target) : null;
  fs.unlinkSync(target);
  if (observe && before !== null) observe({ path: target, pre_sha256: before, post_sha256: null });
}
