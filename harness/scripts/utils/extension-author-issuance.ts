import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { setTimeout as delay } from 'node:timers/promises';

import { ExtensionWriteBusyError, extensionLocation, pendingExtensionUpgrades, withExtensionWrite } from './extension-lifecycle';
import type { ExtensionBundle } from './types';
import { loadInstanceExtensions } from '../../extension-loader';
import { realProjectPath } from './project-relative-path';

interface ExtensionAuthorSelection {
  projectRoot: string;
  frameworkRoot: string;
  manifest: string;
  revision: string | null;
  view: ExtensionBundle;
  packageRevisions: Map<string, string | null>;
  materials?: Map<string, { revision: string | null; sha256?: string }>;
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
    const location = extensionLocation(projectRoot, frameworkRoot);
    const manifest = path.join(location.root, 'manifest.yaml');
    const revision = manifestRevision(manifest);
    const view = loadInstanceExtensions(projectRoot, location.relative, { frameworkRoot });
    if (!view.manifestUsable) return undefined;
    return { projectRoot, frameworkRoot, manifest, revision, view,
      packageRevisions: new Map(Object.values(view.plugins).map(plugin => [plugin.manifestPath, manifestRevision(plugin.manifestPath)])) };
  } catch {
    // The loader reports absent or unreadable extension input separately from native author work.
    return undefined;
  }
}

export function bindExtensionAuthorMaterials(
  selection: ExtensionAuthorSelection | undefined, paths: readonly string[], segments: readonly unknown[],
): void {
  if (!selection) return;
  const materials: NonNullable<ExtensionAuthorSelection['materials']> = new Map();
  selection.materials = materials;
  for (const file of paths) {
    const absolute = path.resolve(selection.projectRoot, file);
    const revision = selection.packageRevisions.has(absolute) ? selection.packageRevisions.get(absolute)! : manifestRevision(absolute);
    materials.set(absolute, { revision });
  }
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue;
    const data = segment as { extension_feature_bindings?: unknown[]; extension_preparation?: { bindings?: unknown[] } };
    for (const raw of data.extension_feature_bindings ?? data.extension_preparation?.bindings ?? []) {
      const item = raw as { path?: string; resource_sha256?: string };
      if (!item.path || !item.resource_sha256) continue;
      const material = materials.get(path.resolve(selection.projectRoot, item.path));
      if (material) material.sha256 = item.resource_sha256;
    }
  }
}

interface ExtensionAuthorControls {
  signal?: AbortSignal;
  deadline?: string;
  assertOwner: () => void;
  selectionChanges: number;
}

type StoppedPublication = { kind: 'stopped'; detail: string };
type ExtensionAuthorPublication<T> = { kind: 'issued'; value: T } | { kind: 'changed' } | StoppedPublication;

/** Only freshness and the original request + event append belong inside the management mutex. */
export async function publishExtensionAuthorRequest<T>(
  selection: ExtensionAuthorSelection, publish: () => T, controls: ExtensionAuthorControls,
): Promise<ExtensionAuthorPublication<T>> {
  if (selection.revision === null && !fs.existsSync(selection.manifest)) {
    return { kind: 'issued', value: publish() };
  }

  const deadline = controls.deadline ? Date.parse(controls.deadline) : Infinity;
  const stopped = (): StoppedPublication | undefined => {
    controls.assertOwner();
    if (Date.now() >= deadline) return { kind: 'stopped', detail: '用户明示时限已到；成果与未完项保留，时限未重置。' };
    if (controls.signal?.aborted) return { kind: 'stopped', detail: '当前请求已取消；成果与未完项保留。' };
  };
  const pause = async (interval: number): Promise<void> => {
    try { await delay(Math.min(interval, Math.max(0, deadline - Date.now())), undefined, { signal: controls.signal }); }
    catch (error) { if (!controls.signal?.aborted) throw error; }
  };
  const backoffLimit = 500; // Polling interval only. The run's own authority and deadline govern the total wait.
  let interval = 50;
  for (;;) {
    const boundary = stopped();
    if (boundary) return boundary;
    let entered = false;
    try {
      const publication = withExtensionWrite(selection.projectRoot, selection.frameworkRoot, (): ExtensionAuthorPublication<T> => {
        entered = true;
        const revision = manifestRevision(selection.manifest);
        const boundary = stopped();
        if (boundary) return boundary;
        if (revision !== selection.revision || [...(selection.materials ?? [])].some(([file, frozen]) => {
          const current = manifestRevision(file);
          return current === null || current !== frozen.revision || frozen.sha256 !== undefined && !current?.endsWith(':' + frozen.sha256);
        })) return { kind: 'changed' };
        const pending = pendingExtensionUpgrades(selection.view);
        if ([...pending.keys()].some(id => selection.materials?.has(selection.view.plugins[id].manifestPath))) return { kind: 'changed' };
        return { kind: 'issued', value: publish() };
      });
      if (publication.kind === 'changed' && controls.selectionChanges > 0) {
        await pause(Math.min(50 * 2 ** controls.selectionChanges, backoffLimit));
        return stopped() ?? publication;
      }
      return publication;
    } catch (error) {
      if (entered || !(error instanceof ExtensionWriteBusyError)) throw error;
      await pause(interval);
      interval = Math.min(interval * 2, backoffLimit);
    }
  }
}
