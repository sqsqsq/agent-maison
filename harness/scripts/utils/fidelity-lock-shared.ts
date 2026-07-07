// ============================================================================
// fidelity-lock-shared.ts — 在线高保真快照 lock 格式与 visual_handoff 在线字段解析
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import {
  parseVisualHandoffYamlRoot,
  loadUiSpecFile,
  uiSpecAbsPath,
  UI_CHANGE_REQUIRES_UI_SPEC,
  type UiChangeValue,
} from './ui-spec-shared';
import { featureFilePath } from '../../config';

const requireHarness = createRequire(path.resolve(__dirname, '../../harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown; stringify: (v: unknown) => string };

export const FIDELITY_LOCK_SCHEMA_VERSION = '1.0';
export const FIDELITY_SNAPSHOT_KIND = 'fidelity_snapshot';

export interface FidelityLockScreen {
  id: string;
  png: string;
  state?: string;
  node_ref?: string;
}

export interface FidelityLockViewport {
  w: number;
  h: number;
  dpr?: number;
}

export interface FidelityLockDoc {
  schema_version: string;
  source_link?: string;
  delivery_code?: string;
  fetched_at?: string;
  version_id?: string;
  content_hash?: string;
  viewport?: FidelityLockViewport;
  structured_bundle?: string;
  screens: FidelityLockScreen[];
}

export interface OnlineVisualHandoffFields {
  source_link: string;
  delivery_code?: string;
  snapshot?: string;
}

/** `_fidelity-cache/` 相对 feature ux-reference 目录 */
export function fidelityCacheRelDir(): string {
  return path.join('ux-reference', '_fidelity-cache');
}

export function fidelityCacheAbsPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, fidelityCacheRelDir());
}

export function fidelityLockAbsPath(projectRoot: string, feature: string): string {
  return path.join(fidelityCacheAbsPath(projectRoot, feature), 'fidelity.lock.yaml');
}

export function resolveSnapshotDirFromHandoff(
  snapshot: string | undefined,
  projectRoot: string,
  feature: string,
): string {
  const trimmed = snapshot?.trim();
  if (trimmed) {
    return path.isAbsolute(trimmed)
      ? path.normalize(trimmed)
      : path.resolve(projectRoot, trimmed);
  }
  return fidelityCacheAbsPath(projectRoot, feature);
}

export function parseOnlineVisualHandoff(vh: Record<string, unknown> | null | undefined): OnlineVisualHandoffFields | null {
  if (!vh || typeof vh !== 'object') return null;
  const link = vh.source_link;
  if (typeof link !== 'string' || !link.trim()) return null;
  const delivery = vh.delivery_code;
  const snapshot = vh.snapshot;
  return {
    source_link: link.trim(),
    ...(typeof delivery === 'string' && delivery.trim() ? { delivery_code: delivery.trim() } : {}),
    ...(typeof snapshot === 'string' && snapshot.trim() ? { snapshot: snapshot.trim() } : {}),
  };
}

export function hasFidelitySnapshotPromise(specMd: string): boolean {
  const doc = parseVisualHandoffYamlRoot(specMd);
  if (!doc) return false;
  const uiChange = doc.ui_change;
  if (typeof uiChange !== 'string' || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange.trim() as UiChangeValue)) {
    return false;
  }
  const vh = doc.visual_handoff;
  if (!vh || typeof vh !== 'object' || Array.isArray(vh)) return false;
  const online = parseOnlineVisualHandoff(vh as Record<string, unknown>);
  return online !== null;
}

/** ui-spec 屏级 ref_id（= authoritative_refs[].id = lock screen id） */
export function collectUiSpecScreenRefIds(projectRoot: string, feature: string): string[] {
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(projectRoot, feature));
  if (!uiDoc?.screens?.length) return [];
  const ids: string[] = [];
  for (const s of uiDoc.screens) {
    const ref = (s.ref_id ?? s.id)?.trim();
    if (ref) ids.push(ref);
  }
  return ids;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function validateFidelityLockDoc(raw: unknown): { doc: FidelityLockDoc | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { doc: null, errors: ['lock 根须为 object'] };
  }
  const sv = raw.schema_version;
  if (typeof sv !== 'string' || !sv.trim()) {
    errors.push('缺少 schema_version');
  } else if (sv.trim() !== FIDELITY_LOCK_SCHEMA_VERSION) {
    errors.push(`不支持的 schema_version=${sv.trim()}（当前 ${FIDELITY_LOCK_SCHEMA_VERSION}）`);
  }
  const screensRaw = raw.screens;
  if (!Array.isArray(screensRaw) || screensRaw.length === 0) {
    errors.push('screens 须为非空数组');
    return { doc: null, errors };
  }
  const screens: FidelityLockScreen[] = [];
  for (let i = 0; i < screensRaw.length; i++) {
    const item = screensRaw[i];
    if (!isRecord(item)) {
      errors.push(`screens[${i}] 须为 object`);
      continue;
    }
    const id = item.id;
    const png = item.png;
    if (typeof id !== 'string' || !id.trim()) {
      errors.push(`screens[${i}].id 须为非空字符串`);
      continue;
    }
    if (typeof png !== 'string' || !png.trim()) {
      errors.push(`screens[${i}].png 须为非空字符串`);
      continue;
    }
    screens.push({
      id: id.trim(),
      png: png.trim(),
      ...(typeof item.state === 'string' && item.state.trim() ? { state: item.state.trim() } : {}),
      ...(typeof item.node_ref === 'string' && item.node_ref.trim() ? { node_ref: item.node_ref.trim() } : {}),
    });
  }
  if (errors.length > 0) {
    return { doc: null, errors };
  }
  let viewport: FidelityLockViewport | undefined;
  if (raw.viewport !== undefined) {
    if (!isRecord(raw.viewport)) {
      errors.push('viewport 须为 object');
    } else {
      const w = raw.viewport.w;
      const h = raw.viewport.h;
      if (typeof w !== 'number' || typeof h !== 'number') {
        errors.push('viewport.w / viewport.h 须为 number');
      } else {
        viewport = {
          w,
          h,
          ...(typeof raw.viewport.dpr === 'number' ? { dpr: raw.viewport.dpr } : {}),
        };
      }
    }
  }
  if (errors.length > 0) {
    return { doc: null, errors };
  }
  const doc: FidelityLockDoc = {
    schema_version: (sv as string).trim(),
    screens,
    ...(typeof raw.source_link === 'string' && raw.source_link.trim() ? { source_link: raw.source_link.trim() } : {}),
    ...(typeof raw.delivery_code === 'string' && raw.delivery_code.trim() ? { delivery_code: raw.delivery_code.trim() } : {}),
    ...(typeof raw.fetched_at === 'string' && raw.fetched_at.trim() ? { fetched_at: raw.fetched_at.trim() } : {}),
    ...(typeof raw.version_id === 'string' && raw.version_id.trim() ? { version_id: raw.version_id.trim() } : {}),
    ...(typeof raw.content_hash === 'string' && raw.content_hash.trim() ? { content_hash: raw.content_hash.trim() } : {}),
    ...(viewport ? { viewport } : {}),
    ...(typeof raw.structured_bundle === 'string' && raw.structured_bundle.trim()
      ? { structured_bundle: raw.structured_bundle.trim() }
      : {}),
  };
  return { doc, errors: [] };
}

export function loadFidelityLock(absPath: string): { doc: FidelityLockDoc | null; errors: string[] } {
  if (!fs.existsSync(absPath)) {
    return { doc: null, errors: ['lock 文件不存在'] };
  }
  try {
    const raw = YAML.parse(fs.readFileSync(absPath, 'utf-8'));
    return validateFidelityLockDoc(raw);
  } catch (e) {
    return { doc: null, errors: [`lock YAML 解析失败：${(e as Error).message}`] };
  }
}

export function resolveLockScreenPngAbs(cacheDir: string, screen: FidelityLockScreen): string | null {
  const cacheResolved = path.resolve(cacheDir);
  const abs = path.isAbsolute(screen.png)
    ? path.normalize(screen.png)
    : path.resolve(cacheDir, screen.png);
  const rel = path.relative(cacheResolved, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return abs;
}

/** 将 lock 中每屏 id→png 写入 byId；返回 lock 胜出的 id 冲突列表 */
export function mergeLockScreensIntoById(
  byId: Map<string, string>,
  cacheDir: string,
  lock: FidelityLockDoc,
): { conflicts: string[]; merged: number } {
  const conflicts: string[] = [];
  let merged = 0;
  for (const s of lock.screens) {
    const abs = resolveLockScreenPngAbs(cacheDir, s);
    if (!abs || !fs.existsSync(abs)) continue;
    if (byId.has(s.id) && byId.get(s.id) !== abs) {
      conflicts.push(s.id);
    }
    byId.set(s.id, abs);
    merged++;
  }
  return { conflicts, merged };
}

export function writeFidelityLock(absPath: string, doc: FidelityLockDoc): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, YAML.stringify(doc), 'utf-8');
}
