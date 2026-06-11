// ============================================================================
// Instance extension loader — doc/extensions/manifest.yaml
// ============================================================================
//
// 无 manifest / 无目录 → 空 bundle（零副作用）。
// manifest 存在但校验失败 → errors[] 非空且不应用 provides（零污染）。
//
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type {
  HarnessResolvedProfile,
  ProfileCapabilitySpec,
  CapabilitySeverityKeyword,
  ExtensionBundle,
} from './scripts/utils/types';
import { normalizeCapabilityKey, normalizeCapabilitiesMap } from './scripts/utils/capability-alias';
import { normalizePhaseId } from './scripts/utils/phase-alias';

export type { ExtensionBundle } from './scripts/utils/types';

const SEVERITY_SET = new Set<CapabilitySeverityKeyword>(['BLOCKER', 'SKIP', 'WARN', 'MAJOR', 'MINOR']);

function emptyBundle(rootDir: string | null): ExtensionBundle {
  return {
    rootDir,
    manifestPath: null,
    skills: [],
    knowledgePaths: [],
    hooks: {},
    extensionCapabilities: {},
    phaseRuleOverlayPaths: {},
    skillAssetAbsPaths: {},
    errors: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeResolve(extRoot: string, rel: string): string {
  const root = path.resolve(extRoot);
  const cleaned = rel.trim().replace(/^\.\/+/, '');
  const abs = path.resolve(root, cleaned);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) {
    throw new Error(`路径越界：${rel}`);
  }
  return abs;
}

function pushError(bundle: ExtensionBundle, code: string, message: string, p?: string): void {
  bundle.errors.push({ severity: 'MAJOR', code, message, path: p });
}

function wipeProvides(b: ExtensionBundle): void {
  b.skills = [];
  b.knowledgePaths = [];
  b.hooks = {};
  b.extensionCapabilities = {};
  b.phaseRuleOverlayPaths = {};
  b.skillAssetAbsPaths = {};
}

function finalize(bundle: ExtensionBundle): ExtensionBundle {
  if (bundle.errors.length > 0) {
    wipeProvides(bundle);
  }
  return bundle;
}

/**
 * 扫描实例 extension 目录；manifest 缺失时返回空 bundle。
 */
export function loadInstanceExtensions(projectRoot: string, extensionDirRel?: string): ExtensionBundle {
  const rel = (extensionDirRel ?? 'doc/extensions').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const extRoot = path.join(projectRoot, ...rel.split('/').filter(Boolean));

  if (!fs.existsSync(extRoot) || !fs.statSync(extRoot).isDirectory()) {
    return emptyBundle(null);
  }

  const manifestPath = path.join(extRoot, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    const b = emptyBundle(extRoot);
    return finalize(b);
  }

  const bundle = emptyBundle(extRoot);
  bundle.manifestPath = manifestPath;

  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    pushError(bundle, 'manifest_yaml_parse', `无法解析 YAML：${(e as Error).message}`, manifestPath);
    return finalize(bundle);
  }

  if (!isRecord(raw)) {
    pushError(bundle, 'manifest_not_object', 'manifest 根必须是 object', manifestPath);
    return finalize(bundle);
  }

  const sv = raw.schema_version;
  if (typeof sv !== 'string' || !sv.trim()) {
    pushError(bundle, 'manifest_schema_version', '缺少或非法 schema_version（须为非空字符串）', manifestPath);
  } else if (sv.trim() !== '1.0') {
    pushError(
      bundle,
      'manifest_schema_version_unsupported',
      `不支持的 schema_version="${sv.trim()}"（当前仅 1.0）`,
      manifestPath,
    );
  }

  const name = raw.name;
  if (typeof name !== 'string' || !name.trim()) {
    pushError(bundle, 'manifest_name', 'name 必须为非空字符串', manifestPath);
  }

  if (bundle.errors.length > 0) {
    return finalize(bundle);
  }

  const provides = raw.provides;
  if (provides === undefined || provides === null) {
    return finalize(bundle);
  }
  if (!isRecord(provides)) {
    pushError(bundle, 'provides_not_object', 'provides 必须是 object', manifestPath);
    return finalize(bundle);
  }

  const skillsRaw = provides.skills;
  if (skillsRaw !== undefined) {
    if (!Array.isArray(skillsRaw)) {
      pushError(bundle, 'provides_skills', 'provides.skills 必须是字符串数组', manifestPath);
    } else {
      for (const s of skillsRaw) {
        if (typeof s !== 'string' || !s.trim()) {
          pushError(bundle, 'provides_skills_item', `非法 skill id：${String(s)}`, manifestPath);
        } else {
          bundle.skills.push(s.trim());
        }
      }
    }
  }

  const knowRaw = provides.knowledge;
  if (knowRaw !== undefined) {
    if (!Array.isArray(knowRaw)) {
      pushError(bundle, 'provides_knowledge', 'provides.knowledge 必须是字符串数组', manifestPath);
    } else {
      for (const k of knowRaw) {
        if (typeof k !== 'string' || !k.trim()) {
          pushError(bundle, 'provides_knowledge_item', `非法 knowledge 项：${String(k)}`, manifestPath);
          continue;
        }
        try {
          const abs = safeResolve(extRoot, k.trim());
          if (!fs.existsSync(abs)) {
            pushError(bundle, 'knowledge_missing', `knowledge 文件不存在：${k.trim()}`, abs);
          } else {
            bundle.knowledgePaths.push(abs);
          }
        } catch (e) {
          pushError(bundle, 'knowledge_resolve', (e as Error).message, manifestPath);
        }
      }
    }
  }

  const hooksRaw = provides.hooks;
  if (hooksRaw !== undefined) {
    if (!isRecord(hooksRaw)) {
      pushError(bundle, 'provides_hooks', 'provides.hooks 必须是 object', manifestPath);
    } else {
      for (const [ph, evMap] of Object.entries(hooksRaw)) {
        if (!isRecord(evMap)) {
          pushError(bundle, 'provides_hooks_phase', `hooks.${ph} 必须是 event->paths 映射`, manifestPath);
          continue;
        }
        const byEvent: Record<string, string[]> = {};
        for (const [ev, pathsList] of Object.entries(evMap)) {
          if (!Array.isArray(pathsList)) {
            pushError(bundle, 'provides_hooks_event', `hooks.${ph}.${ev} 必须是路径数组`, manifestPath);
            continue;
          }
          const acc: string[] = [];
          for (const hp of pathsList) {
            if (typeof hp !== 'string' || !hp.trim()) {
              pushError(bundle, 'provides_hooks_path', `非法 hook 路径：${String(hp)}`, manifestPath);
              continue;
            }
            try {
              const abs = safeResolve(extRoot, hp.trim());
              if (!fs.existsSync(abs)) {
                pushError(bundle, 'hook_path_missing', `hook 文件不存在：${hp.trim()}`, abs);
              } else {
                acc.push(abs);
              }
            } catch (e) {
              pushError(bundle, 'hook_resolve', (e as Error).message, manifestPath);
            }
          }
          if (acc.length > 0) {
            byEvent[ev] = acc;
          }
        }
        if (Object.keys(byEvent).length > 0) {
          const canon = normalizePhaseId(ph, ph as 'spec');
          if (ph !== canon) {
            // eslint-disable-next-line no-console
            console.warn(
              `[extension-loader] hooks 已弃用 phase key "${ph}"，已规范化为 "${canon}"`,
            );
          }
          bundle.hooks[canon] = { ...(bundle.hooks[canon] ?? {}), ...byEvent };
        }
      }
    }
  }

  const capsRaw = provides.capabilities;
  if (capsRaw !== undefined) {
    if (!isRecord(capsRaw)) {
      pushError(bundle, 'provides_capabilities', 'provides.capabilities 必须是 object', manifestPath);
    } else {
      for (const [capKey, spec] of Object.entries(capsRaw)) {
        if (!capKey.trim()) continue;
        if (!isRecord(spec)) {
          pushError(bundle, 'capability_spec', `capability "${capKey}" 必须是 object`, manifestPath);
          continue;
        }
        const prov = spec.provider;
        const sev = spec.severity;
        if (typeof prov !== 'string' || !prov.trim()) {
          pushError(bundle, 'capability_provider', `capability "${capKey}" 缺少 provider`, manifestPath);
          continue;
        }
        if (typeof sev !== 'string' || !SEVERITY_SET.has(sev as CapabilitySeverityKeyword)) {
          pushError(
            bundle,
            'capability_severity',
            `capability "${capKey}" severity 非法：${String(sev)}`,
            manifestPath,
          );
          continue;
        }
        try {
          const absProv = safeResolve(extRoot, prov.trim());
          if (!fs.existsSync(absProv)) {
            pushError(bundle, 'capability_provider_missing', `provider 文件不存在：${prov.trim()}`, absProv);
            continue;
          }
          const canonKey = normalizeCapabilityKey(capKey.trim());
          bundle.extensionCapabilities[canonKey] = {
            provider: absProv,
            severity: sev as CapabilitySeverityKeyword,
          };
        } catch (e) {
          pushError(bundle, 'capability_resolve', (e as Error).message, manifestPath);
        }
      }
    }
  }

  const skillAssetsRaw = provides.skill_assets;
  if (skillAssetsRaw !== undefined) {
    if (!isRecord(skillAssetsRaw)) {
      pushError(bundle, 'provides_skill_assets', 'provides.skill_assets 必须是 object', manifestPath);
    } else {
      for (const [skillId, bucket] of Object.entries(skillAssetsRaw)) {
        const sid = skillId.trim();
        if (!sid) {
          pushError(bundle, 'skill_assets_skill_id', 'skill_assets skill id 不能为空', manifestPath);
          continue;
        }
        if (!isRecord(bucket)) {
          pushError(bundle, 'skill_assets_bucket', `skill_assets.${sid} 必须是 assetKey→path 映射`, manifestPath);
          continue;
        }
        const acc: Record<string, string> = {};
        for (const [assetKey, rel] of Object.entries(bucket)) {
          const key = assetKey.trim();
          if (!key || typeof rel !== 'string' || !rel.trim()) {
            pushError(bundle, 'skill_assets_entry', `skill_assets.${sid}.${assetKey} 非法`, manifestPath);
            continue;
          }
          try {
            const abs = safeResolve(extRoot, rel.trim());
            if (!fs.existsSync(abs)) {
              pushError(bundle, 'skill_assets_missing', `skill_assets 文件不存在：${rel.trim()}`, abs);
            } else {
              acc[key] = abs;
            }
          } catch (e) {
            pushError(bundle, 'skill_assets_resolve', (e as Error).message, manifestPath);
          }
        }
        if (Object.keys(acc).length > 0) {
          bundle.skillAssetAbsPaths[sid] = { ...(bundle.skillAssetAbsPaths[sid] ?? {}), ...acc };
        }
      }
    }
  }

  const overRaw = provides.phase_rules_overlays;
  if (overRaw !== undefined) {
    if (!isRecord(overRaw)) {
      pushError(bundle, 'provides_overlays', 'provides.phase_rules_overlays 必须是 object', manifestPath);
    } else {
      for (const [ph, p] of Object.entries(overRaw)) {
        if (typeof p !== 'string' || !p.trim()) {
          pushError(bundle, 'overlay_path', `phase "${ph}" overlay 路径非法`, manifestPath);
          continue;
        }
        try {
          const abs = safeResolve(extRoot, p.trim());
          if (!fs.existsSync(abs)) {
            pushError(bundle, 'overlay_missing', `phase_rules_overlay 文件不存在：${p.trim()}`, abs);
          } else {
            const rawPh = ph.trim();
            const canon = normalizePhaseId(rawPh, rawPh as 'spec');
            if (rawPh !== canon) {
              // eslint-disable-next-line no-console
              console.warn(
                `[extension-loader] phase_rules_overlays 已弃用 phase key "${rawPh}"，已规范化为 "${canon}"`,
              );
            }
            bundle.phaseRuleOverlayPaths[canon] = abs;
          }
        } catch (e) {
          pushError(bundle, 'overlay_resolve', (e as Error).message, manifestPath);
        }
      }
    }
  }

  return finalize(bundle);
}

/**
 * 将 extension 合并进已解析的 profile（capabilities：扩展覆盖同名 key；有错则不合并能力）。
 */
export function applyInstanceExtensions(
  resolved: HarnessResolvedProfile,
  projectRoot: string,
  extensionDirRel?: string,
): HarnessResolvedProfile {
  const bundle = loadInstanceExtensions(projectRoot, extensionDirRel);
  const mergedCaps: Record<string, ProfileCapabilitySpec> = {
    ...(resolved.capabilities as Record<string, ProfileCapabilitySpec>),
  };
  if (bundle.errors.length === 0) {
    Object.assign(mergedCaps, bundle.extensionCapabilities);
  }
  return {
    ...resolved,
    capabilities: normalizeCapabilitiesMap(mergedCaps),
    extensionBundle: bundle,
  };
}
