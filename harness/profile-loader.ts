// ============================================================================
// Project profile loader（framework/profiles/<name>/）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { FrameworkConfig } from './config';
import type {
  Phase,
  PhaseRuleSpec,
  ProfileYamlStub,
  HarnessResolvedProfile,
  ProfileCapabilitySpec,
  CapabilityKey,
} from './scripts/utils/types';
import { applyInstanceExtensions } from './extension-loader';
import { normalizeCapabilitiesMap } from './scripts/utils/capability-alias';
import { normalizePersonalPrerequisitesMap } from './scripts/utils/personal-prerequisite-registry';
import { normalizeCheckId, normalizePhaseId } from './scripts/utils/phase-alias';

export type { CapabilityKey, ProfileCapabilitySpec } from './scripts/utils/types';

const FRAMEWORK_DIR = path.resolve(__dirname, '..');

function profileDir(name: string): string {
  return path.join(FRAMEWORK_DIR, 'profiles', name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function applyDefaults<T>(raw: T, defaults: unknown): T {
  if (raw === undefined || raw === null) {
    return defaults as T;
  }
  if (!isRecord(raw) || !isRecord(defaults)) {
    return raw;
  }
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(raw)) {
    out[key] = applyDefaults(value, defaults[key]);
  }
  return out as T;
}

export function loadProfileConfigDefaults(profileName: string): Record<string, unknown> {
  const name = profileName.trim() || 'hmos-app';
  const filePath = path.join(profileDir(name), 'config-defaults.json');
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (err) {
    throw new Error(`[profile-loader] config-defaults.json 解析失败 (${filePath}): ${(err as Error).message}`);
  }
}

function normalizeCheckIdMap<T extends Record<string, unknown>>(
  map: T | undefined,
): T | undefined {
  if (!map) return map;
  const out = {} as T;
  for (const [key, value] of Object.entries(map)) {
    (out as Record<string, unknown>)[normalizeCheckId(key)] = value;
  }
  return out;
}

export function mergePhaseRuleSpec(base: PhaseRuleSpec, overlay: Partial<PhaseRuleSpec>): PhaseRuleSpec {
  const overlayNorm: Partial<PhaseRuleSpec> = {
    ...overlay,
    structure_checks: normalizeCheckIdMap(overlay.structure_checks),
    semantic_checks: normalizeCheckIdMap(overlay.semantic_checks),
    traceability_checks: normalizeCheckIdMap(overlay.traceability_checks),
  };
  const merged: PhaseRuleSpec = {
    ...base,
    ...overlayNorm,
    phase: normalizePhaseId(String(overlayNorm.phase ?? base.phase)),
    applies_to: overlay.applies_to !== undefined ? overlay.applies_to : base.applies_to,
    structure_checks: {
      ...(base.structure_checks ?? {}),
      ...(overlayNorm.structure_checks ?? {}),
    },
    semantic_checks: {
      ...(base.semantic_checks ?? {}),
      ...(overlayNorm.semantic_checks ?? {}),
    },
    traceability_checks: {
      ...(base.traceability_checks ?? {}),
      ...(overlayNorm.traceability_checks ?? {}),
    },
    exploration_thresholds: {
      ...(base.exploration_thresholds ?? {}),
      ...(overlay.exploration_thresholds ?? {}),
    },
    exploration_strategy: overlay.exploration_strategy ?? base.exploration_strategy,
  };
  return merged;
}

function readProfileYaml(name: string): ProfileYamlStub {
  const dir = profileDir(name);
  const filePath = path.join(dir, 'profile.yaml');
  if (!fs.existsSync(filePath)) {
    throw new Error(`[profile-loader] 缺少 ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = YAML.parse(raw) as ProfileYamlStub;
  if (!parsed?.name || parsed.name !== name) {
    throw new Error(`[profile-loader] profile.yaml name 与目录不一致: ${filePath}`);
  }
  return parsed;
}

function normalizePhaseDisabled(raw: string[] | undefined): Set<Phase> {
  const set = new Set<Phase>();
  const allow = new Set<Phase>([
    'spec', 'plan',
    'coding',
    'review',
    'ut',
    'testing',
    'catalog',
    'glossary',
    'docs',
    'init',
    'extensions',
    'module-graph',
  ]);
  for (const p of raw ?? []) {
    const canon = normalizePhaseId(p) as Phase;
    if (allow.has(canon)) {
      set.add(canon);
    }
  }
  return set;
}

/**
 * 合并 overlay：主 profile 目录 + 可选 `sub-variants/<subVariant>/phase-rules-overlays/`
 */
export function loadPhaseRuleWithOverlays(
  phase: Phase,
  base: PhaseRuleSpec,
  resolved: HarnessResolvedProfile,
): PhaseRuleSpec {
  const overlayFile = `${phase}-rules.overlay.yaml`;

  const primaryOverlaysDir =
    resolved.yaml.phase_rules_overlays_dir !== undefined
      ? path.join(resolved.profileDir, String(resolved.yaml.phase_rules_overlays_dir))
      : path.join(resolved.profileDir, 'phase-rules-overlays');

  let merged = base;
  merged = mergeOverlayFromDir(merged, path.join(primaryOverlaysDir, overlayFile));

  const sub = resolved.subVariant?.trim();
  if (sub) {
    const subOverlaysPath = path.join(
      resolved.profileDir,
      'sub-variants',
      sub,
      'phase-rules-overlays',
      overlayFile,
    );
    merged = mergeOverlayFromDir(merged, subOverlaysPath);
  }

  const extOverlay = resolved.extensionBundle?.phaseRuleOverlayPaths?.[phase];
  if (extOverlay) {
    merged = mergeOverlayFromDir(merged, extOverlay);
  }

  return merged;
}

function mergeOverlayFromDir(current: PhaseRuleSpec, overlayPath: string): PhaseRuleSpec {
  if (!fs.existsSync(overlayPath)) {
    return current;
  }
  try {
    const overlayRaw = fs.readFileSync(overlayPath, 'utf-8');
    const overlay = YAML.parse(overlayRaw) as Partial<PhaseRuleSpec>;
    return mergePhaseRuleSpec(current, overlay);
  } catch {
    return current;
  }
}

export function loadResolvedProfile(projectRoot: string, cfg: FrameworkConfig): HarnessResolvedProfile {
  const name = cfg.project_profile.name;
  const sub = cfg.project_profile.sub_variant?.trim();

  let yaml: ProfileYamlStub;
  try {
    yaml = readProfileYaml(name);
  } catch {
    console.warn(`[profile-loader] 无法加载 profile "${name}"，回退 hmos-app`);
    yaml = readProfileYaml('hmos-app');
  }

  const profileDirPath = profileDir(yaml.name);

  const capabilities = normalizeCapabilitiesMap(
    yaml.capabilities as Partial<Record<string, ProfileCapabilitySpec>>,
  );

  const personalPrerequisites = normalizePersonalPrerequisitesMap(
    yaml.personal_prerequisites,
    yaml.name,
  );

  // C4 exploration-scale：实例级 config.phases_disabled 与 profile 声明取并集（任一侧禁用即禁用）。
  const mergedPhasesDisabled = [...(yaml.phases_disabled ?? []), ...(cfg.phases_disabled ?? [])];

  const base: HarnessResolvedProfile = {
    name: yaml.name,
    subVariant: sub,
    profileDir: profileDirPath,
    yaml,
    phasesDisabled: normalizePhaseDisabled(mergedPhasesDisabled),
    capabilities,
    personalPrerequisites,
  };

  return applyInstanceExtensions(base, projectRoot, cfg.paths?.extension_dir);
}

export function isPhaseDisabledByProfile(phase: Phase, resolved: HarnessResolvedProfile): boolean {
  return resolved.phasesDisabled.has(phase);
}

/** catalog `format_value_valid` 缺省枚举；宿主 profile 应显式声明自己的合法取值。 */
export const DEFAULT_CATALOG_ALLOWED_MODULE_FORMATS = ['application', 'library', 'service', 'document'] as const;

export function getCatalogAllowedModuleFormats(resolved: HarnessResolvedProfile): string[] {
  const raw = resolved.yaml.catalog_allowed_module_formats;
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((x): x is string => typeof x === 'string' && x.trim().length > 0)
  ) {
    return raw.map((x) => x.trim());
  }
  return [...DEFAULT_CATALOG_ALLOWED_MODULE_FORMATS];
}
