/**
 * Read doc/app-snapshot-cache for derive hints (no Hylyre runtime).
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveHylyreToolConfig } from '../../config';
import { loadAppBundleName } from '../../../profiles/hmos-app/harness/hdc-runner';

export function listSnapshotPages(appSnapshotCacheAbs: string, bundleName: string): string[] {
  const pagesDir = path.join(appSnapshotCacheAbs, bundleName, 'pages');
  if (!fs.existsSync(pagesDir)) return [];
  try {
    return fs
      .readdirSync(pagesDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/i, ''));
  } catch {
    return [];
  }
}

export function isSnapshotCacheEmpty(appSnapshotCacheAbs: string, bundleName: string): boolean {
  return listSnapshotPages(appSnapshotCacheAbs, bundleName).length === 0;
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
    const p = path.join(appSnapshotCacheAbs, bundleName, 'pages', `${page}.json`);
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
