/**
 * Resolve Hypium main ability (page name) for a bundle with layered fallback + app-meta cache.
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig, resolveHylyreToolConfig } from '../../../harness/config';
import { loadAppBundleName } from './hdc-runner';
import { discoverEntryMainElement } from './discover-entry-main-element';
import { discoverMainAbilityFromBmDump, runHdcShellBmDump } from './hdc-runner';

export type MainAbilitySource =
  | 'override'
  | 'config_map'
  | 'app_meta_cache'
  | 'project_hypium_config'
  | 'entry_module_scan'
  | 'bm_dump'
  | 'none';

export interface AppMetaJson {
  bundleName: string;
  mainAbility: string;
  source: MainAbilitySource;
  discoveredAt: string;
  deviceSn?: string | null;
}

export interface ResolveMainAbilityResult {
  mainAbility: string | null;
  source: MainAbilitySource;
  appMetaPath: string | null;
  bmDumpExcerpt?: string;
}

function appMetaPathFor(projectRoot: string, bundleName: string, cacheRel: string): string {
  return path.join(projectRoot, cacheRel, bundleName, 'app-meta.json');
}

function appMetaStalePath(metaPath: string): string {
  return metaPath.replace(/app-meta\.json$/i, 'app-meta.stale');
}

function readAppMeta(metaPath: string, bundleName: string): AppMetaJson | null {
  const stalePath = appMetaStalePath(metaPath);
  if (fs.existsSync(stalePath)) {
    try {
      fs.unlinkSync(stalePath);
    } catch {
      /* ignore */
    }
    if (fs.existsSync(metaPath)) {
      try {
        fs.unlinkSync(metaPath);
      } catch {
        /* ignore */
      }
    }
    return null;
  }
  if (!fs.existsSync(metaPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as AppMetaJson;
    if (raw?.bundleName === bundleName && typeof raw.mainAbility === 'string' && raw.mainAbility.trim()) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Invalidate cached app-meta after warmup detects wrong ability / app not foreground. */
export function markAppMetaCacheStale(projectRoot: string, bundleName: string): void {
  const cacheRel = resolveHylyreToolConfig(projectRoot).app_snapshot_cache_dir;
  const metaPath = appMetaPathFor(projectRoot, bundleName, cacheRel);
  const stalePath = appMetaStalePath(metaPath);
  fs.mkdirSync(path.dirname(stalePath), { recursive: true });
  fs.writeFileSync(stalePath, `${new Date().toISOString()}\n`, 'utf-8');
}

export function writeAppMeta(
  projectRoot: string,
  cacheRel: string,
  meta: AppMetaJson,
): string {
  const metaPath = appMetaPathFor(projectRoot, meta.bundleName, cacheRel);
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
  return metaPath;
}

function loadBundleAbilitiesMap(projectRoot: string): Record<string, string> {
  const partial = loadFrameworkConfig(projectRoot).tools?.hylyre as
    | { bundle_abilities?: Record<string, string> }
    | undefined;
  const map = partial?.bundle_abilities;
  if (!map || typeof map !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === 'string' && v.trim()) {
      out[k.trim()] = v.trim();
    }
  }
  return out;
}

function resolveForProjectBundle(projectRoot: string): { ability: string | null; source: MainAbilitySource } {
  const cfg = resolveHylyreToolConfig(projectRoot);
  if (cfg.hypium_page_name.trim()) {
    return { ability: cfg.hypium_page_name.trim(), source: 'project_hypium_config' };
  }
  const fromEntry = discoverEntryMainElement(projectRoot);
  if (fromEntry) {
    return { ability: fromEntry, source: 'entry_module_scan' };
  }
  return { ability: null, source: 'none' };
}

export interface ResolveMainAbilityOptions {
  projectRoot: string;
  bundleName: string;
  override?: string | null;
  deviceSn?: string;
  /** When true and bm_dump succeeds, persist app-meta.json */
  writeCache?: boolean;
}

/**
 * Layered resolution:
 * 1. override 2. config bundle_abilities 3. app-meta cache
 * 4. if bundle === AppScope: hypium_page_name / entry scan
 * 5. bm dump on device
 */
export function resolveMainAbilityForBundle(opts: ResolveMainAbilityOptions): ResolveMainAbilityResult {
  const { projectRoot, bundleName } = opts;
  const hylyreCfg = resolveHylyreToolConfig(projectRoot);
  const cacheRel = hylyreCfg.app_snapshot_cache_dir;
  const metaPath = appMetaPathFor(projectRoot, bundleName, cacheRel);

  const trimmedOverride = (opts.override ?? '').trim();
  if (trimmedOverride) {
    return { mainAbility: trimmedOverride, source: 'override', appMetaPath: metaPath };
  }

  const configMap = loadBundleAbilitiesMap(projectRoot);
  if (configMap[bundleName]) {
    return { mainAbility: configMap[bundleName], source: 'config_map', appMetaPath: metaPath };
  }

  const cached = readAppMeta(metaPath, bundleName);
  if (cached) {
    return { mainAbility: cached.mainAbility.trim(), source: 'app_meta_cache', appMetaPath: metaPath };
  }

  let projectBundle = '';
  try {
    projectBundle = loadAppBundleName(projectRoot);
  } catch {
    projectBundle = '';
  }

  if (projectBundle && bundleName === projectBundle) {
    const local = resolveForProjectBundle(projectRoot);
    if (local.ability) {
      return { mainAbility: local.ability, source: local.source, appMetaPath: metaPath };
    }
  }

  const dump = runHdcShellBmDump(bundleName);
  const discovered = discoverMainAbilityFromBmDump(dump.output);
  if (discovered) {
    if (opts.writeCache !== false) {
      writeAppMeta(projectRoot, cacheRel, {
        bundleName,
        mainAbility: discovered,
        source: 'bm_dump',
        discoveredAt: new Date().toISOString(),
        deviceSn: opts.deviceSn ?? null,
      });
    }
    return {
      mainAbility: discovered,
      source: 'bm_dump',
      appMetaPath: metaPath,
      bmDumpExcerpt: dump.output.slice(0, 2000),
    };
  }

  return {
    mainAbility: null,
    source: 'none',
    appMetaPath: metaPath,
    bmDumpExcerpt: dump.output.slice(0, 2000),
  };
}
