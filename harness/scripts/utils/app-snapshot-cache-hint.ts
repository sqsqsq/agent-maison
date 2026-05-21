/**
 * Read doc/app-snapshot-cache for derive hints (no Hylyre runtime).
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveHylyreToolConfig } from '../../config';
import { loadAppBundleName } from '../../../profiles/hmos-app/harness/hdc-runner';

const SNAPSHOT_META_JSON_RE =
  /^(app-meta|index)\.json$/i;

/** Meta / dump artifacts — not page snapshots for derive or warmup skip. */
export function isSnapshotMetaJsonBasename(basename: string): boolean {
  if (!basename.endsWith('.json')) return true;
  if (SNAPSHOT_META_JSON_RE.test(basename)) return true;
  if (/^dump-ui-/i.test(basename)) return true;
  if (/summary/i.test(basename)) return true;
  return false;
}

function bundleDir(appSnapshotCacheAbs: string, bundleName: string): string {
  return path.join(appSnapshotCacheAbs, bundleName);
}

function listJsonSlugsInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.json') && !isSnapshotMetaJsonBasename(f))
      .map(f => f.replace(/\.json$/i, ''));
  } catch {
    return [];
  }
}

export function listPagesDirSnapshotSlugs(appSnapshotCacheAbs: string, bundleName: string): string[] {
  return listJsonSlugsInDir(path.join(bundleDir(appSnapshotCacheAbs, bundleName), 'pages'));
}

export function listRootDirSnapshotSlugs(appSnapshotCacheAbs: string, bundleName: string): string[] {
  return listJsonSlugsInDir(bundleDir(appSnapshotCacheAbs, bundleName));
}

/** Official pages/ slugs merged with legacy flat bundle-root slugs (deduped). */
export function listSnapshotPages(appSnapshotCacheAbs: string, bundleName: string): string[] {
  const pages = listPagesDirSnapshotSlugs(appSnapshotCacheAbs, bundleName);
  const root = listRootDirSnapshotSlugs(appSnapshotCacheAbs, bundleName);
  return [...new Set([...pages, ...root])];
}

export function isSnapshotCacheEmpty(appSnapshotCacheAbs: string, bundleName: string): boolean {
  return listSnapshotPages(appSnapshotCacheAbs, bundleName).length === 0;
}

/** Root has page-like JSON but official pages/ dir is empty — agent Write 误落盘常见信号. */
export function isCacheLayoutMismatch(appSnapshotCacheAbs: string, bundleName: string): boolean {
  const pages = listPagesDirSnapshotSlugs(appSnapshotCacheAbs, bundleName);
  if (pages.length > 0) return false;
  return listRootDirSnapshotSlugs(appSnapshotCacheAbs, bundleName).length > 0;
}

/** Resolve snapshot JSON: prefer pages/<slug>.json, fallback bundle-root/<slug>.json. */
export function resolveSnapshotPageJsonPath(
  appSnapshotCacheAbs: string,
  bundleName: string,
  pageSlug: string,
): string | null {
  const slug = pageSlug.replace(/\.json$/i, '');
  const pagesPath = path.join(bundleDir(appSnapshotCacheAbs, bundleName), 'pages', `${slug}.json`);
  if (fs.existsSync(pagesPath)) return pagesPath;
  const rootPath = path.join(bundleDir(appSnapshotCacheAbs, bundleName), `${slug}.json`);
  if (fs.existsSync(rootPath) && !isSnapshotMetaJsonBasename(path.basename(rootPath))) {
    return rootPath;
  }
  return null;
}

/** Absolute paths to all recognized page snapshot JSON files. */
export function listSnapshotPageJsonPaths(appSnapshotCacheAbs: string, bundleName: string): string[] {
  const slugs = listSnapshotPages(appSnapshotCacheAbs, bundleName);
  const out: string[] = [];
  for (const slug of slugs) {
    const p = resolveSnapshotPageJsonPath(appSnapshotCacheAbs, bundleName, slug);
    if (p) out.push(p);
  }
  return out;
}

/** Collect text/id-like strings from snapshot JSON for fuzzy NL matching. */
export function collectTextsFromSnapshotJson(jsonPath: string, limit = 500): string[] {
  if (!fs.existsSync(jsonPath)) return [];
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const texts = new Set<string>();
    const re = /"(?:text|label|description|contentDescription)"\s*:\s*"([^"\\]{1,80})"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null && texts.size < limit) {
      const t = m[1].trim();
      if (t.length >= 2) texts.add(t);
    }
    return [...texts];
  } catch {
    return [];
  }
}

export function buildSelectorHints(
  appSnapshotCacheAbs: string,
  bundleName: string,
  naturalSteps: string[],
): Array<{ step: string; matched_text?: string; page?: string }> {
  const pages = listSnapshotPages(appSnapshotCacheAbs, bundleName);
  const allTexts: Array<{ page: string; text: string }> = [];
  for (const page of pages) {
    const p = resolveSnapshotPageJsonPath(appSnapshotCacheAbs, bundleName, page);
    if (!p) continue;
    for (const text of collectTextsFromSnapshotJson(p)) {
      allTexts.push({ page, text });
    }
  }
  const hints: Array<{ step: string; matched_text?: string; page?: string }> = [];
  for (const step of naturalSteps) {
    const keywords = step
      .replace(/^(点击|点|触摸|打开|进入|查看|滚动|下滑|上滑)/, '')
      .trim();
    let best: { page: string; text: string } | null = null;
    for (const item of allTexts) {
      if (keywords && (item.text.includes(keywords) || keywords.includes(item.text))) {
        best = item;
        break;
      }
    }
    hints.push(
      best
        ? { step, matched_text: best.text, page: best.page }
        : { step },
    );
  }
  return hints;
}

export function resolveDefaultSnapshotBundle(projectRoot: string, bundleOverride?: string): string {
  const b = (bundleOverride ?? '').trim();
  if (b) return b;
  try {
    return loadAppBundleName(projectRoot);
  } catch {
    return '';
  }
}

export function appSnapshotCacheAbsFor(projectRoot: string): string {
  const cfg = resolveHylyreToolConfig(projectRoot);
  return path.resolve(projectRoot, cfg.app_snapshot_cache_dir);
}

export const CACHE_LAYOUT_EXPECTED = 'pages/<slug>.json';
