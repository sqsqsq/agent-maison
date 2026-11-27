import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { ExtensionWriteBusyError, extensionLocation, withExtensionWrite } from './extension-lifecycle';
import { realProjectPath } from './project-relative-path';

interface ExtensionAuthorSelection {
  projectRoot: string;
  frameworkRoot: string;
  manifest: string;
  revision: string | null;
}

function manifestRevision(file: string): string | null {
  if (!fs.lstatSync(file, { throwIfNoEntry: false })) return null;
  let fd: number;
  try { fd = fs.openSync(realProjectPath(path.dirname(file), path.basename(file), 'extension manifest'), 'r'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const { ino, dev, ctimeNs, mtimeNs } = fs.fstatSync(fd, { bigint: true });
    const digest = createHash('sha256').update(fs.readFileSync(fd)).digest('hex');
    return `${dev}:${ino}:${ctimeNs}:${mtimeNs}:${digest}`;
  } finally { fs.closeSync(fd); }
}

export function captureExtensionAuthorSelection(projectRoot: string, frameworkRoot: string): ExtensionAuthorSelection | undefined {
  try {
    const manifest = path.join(extensionLocation(projectRoot, frameworkRoot).root, 'manifest.yaml');
    return { projectRoot, frameworkRoot, manifest, revision: manifestRevision(manifest) };
  } catch {
    // The loader reports absent or unreadable extension input separately from native author work.
    return undefined;
  }
}

export type ExtensionAuthorPublication<T> = { kind: 'issued'; value: T } | { kind: 'changed' | 'busy' };

/** Only freshness and the original request + event append belong inside the management mutex. */
export async function publishExtensionAuthorRequest<T>(
  selection: ExtensionAuthorSelection | undefined, publish: () => T,
): Promise<ExtensionAuthorPublication<T>> {
  if (!selection || selection.revision === null && !fs.existsSync(selection.manifest)) {
    return { kind: 'issued', value: publish() };
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return withExtensionWrite(selection.projectRoot, selection.frameworkRoot, () => {
        if (manifestRevision(selection.manifest) !== selection.revision) return { kind: 'changed' };
        return { kind: 'issued', value: publish() };
      });
    } catch (error) {
      if (!(error instanceof ExtensionWriteBusyError)) throw error;
      if (attempt >= 2) return { kind: 'busy' };
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

export const EXTENSION_AUTHOR_ISSUANCE_WAIT =
  '宿主扩展选择正在更新，尚未签发新的作者请求。扩展管理操作稳定后可沿原请求继续。';
