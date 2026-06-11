/**
 * Capability key normalization — canonical spec.visual_handoff with legacy prd.visual_handoff alias + WARN.
 */

import type { CapabilityKey, ProfileCapabilitySpec } from './types';

const CAPABILITY_KEY_ALIASES: Readonly<Record<string, CapabilityKey>> = {
  'prd.visual_handoff': 'spec.visual_handoff',
};

const warnedCapabilityKeys = new Set<string>();

export function isLegacyCapabilityKey(key: string): boolean {
  return key === 'prd.visual_handoff';
}

/** Normalize capability key; legacy prd.visual_handoff emits WARN once per process per key. */
export function normalizeCapabilityKey(key: string): CapabilityKey {
  const raw = key.trim();
  const mapped = (CAPABILITY_KEY_ALIASES[raw] ?? raw) as CapabilityKey;
  if (isLegacyCapabilityKey(raw) && !warnedCapabilityKeys.has(raw)) {
    warnedCapabilityKeys.add(raw);
    // eslint-disable-next-line no-console
    console.warn(
      `[capability-alias] 已弃用 capability "${raw}"，请改用 "${mapped}"（alias 将保留 ≥2 个 minor 窗口）`,
    );
  }
  return mapped;
}

/** Collapse legacy + canonical capability entries; canonical wins on conflict. */
export function normalizeCapabilitiesMap(
  raw: Partial<Record<string, ProfileCapabilitySpec>> | undefined,
): Partial<Record<CapabilityKey, ProfileCapabilitySpec>> {
  if (!raw || typeof raw !== 'object') return {};
  const entries = Object.entries(raw).filter(
    ([k, v]) => k.trim().length > 0 && v !== undefined && v !== null && typeof v === 'object',
  );
  const sorted = [...entries].sort(([a], [b]) => {
    const aLegacy = isLegacyCapabilityKey(a.trim()) ? 1 : 0;
    const bLegacy = isLegacyCapabilityKey(b.trim()) ? 1 : 0;
    return aLegacy - bLegacy;
  });
  const out: Partial<Record<CapabilityKey, ProfileCapabilitySpec>> = {};
  for (const [k, v] of sorted) {
    const canon = normalizeCapabilityKey(k);
    if (out[canon] === undefined) {
      out[canon] = v;
    }
  }
  return out;
}

/** Reset warn-once set (unit tests). */
export function resetCapabilityAliasWarnings(): void {
  warnedCapabilityKeys.clear();
}
