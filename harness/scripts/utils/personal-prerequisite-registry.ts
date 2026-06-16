// ============================================================================
// personal-prerequisite-registry.ts — profile personal_prerequisites 校验 SSOT
// ============================================================================

import { normalizeCapabilityKey } from './capability-alias';
import type { CapabilityKey, PersonalPrerequisiteId } from './types';

export type { PersonalPrerequisiteId } from './types';

/** profile.yaml 可声明的 prerequisite（agent_adapter 由框架隐式追加） */
export const PROFILE_DECLARABLE_PREREQUISITE_IDS: ReadonlySet<PersonalPrerequisiteId> = new Set([
  'deveco_toolchain',
]);

export const KNOWN_CAPABILITY_KEYS: readonly CapabilityKey[] = [
  'coding.compile',
  'coding.lint',
  'ut.compile',
  'ut.run',
  'device_test.run',
  'device_test.build',
  'device_test.install',
  'spec.visual_handoff',
] as const;

const KNOWN_CAPABILITY_KEY_SET = new Set<string>(KNOWN_CAPABILITY_KEYS);

export function isKnownCapabilityKey(key: string): key is CapabilityKey {
  return KNOWN_CAPABILITY_KEY_SET.has(key);
}

export function normalizePersonalPrerequisitesMap(
  raw: unknown,
  profileName: string,
): Partial<Record<CapabilityKey, PersonalPrerequisiteId[]>> {
  if (raw === undefined || raw === null) {
    throw new Error(
      `[profile-loader] profile=${profileName} 缺少 personal_prerequisites（须显式声明，无绑定可写 personal_prerequisites: {}）`,
    );
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `[profile-loader] profile=${profileName} personal_prerequisites 必须是对象`,
    );
  }

  const out: Partial<Record<CapabilityKey, PersonalPrerequisiteId[]>> = {};
  for (const [rawKey, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    const capKey = normalizeCapabilityKey(rawKey);
    if (!isKnownCapabilityKey(capKey)) {
      throw new Error(
        `[profile-loader] profile=${profileName} personal_prerequisites 未知 capability: ${rawKey}`,
      );
    }
    if (!Array.isArray(rawVal)) {
      throw new Error(
        `[profile-loader] profile=${profileName} personal_prerequisites.${rawKey} 必须是数组`,
      );
    }

    const ids: PersonalPrerequisiteId[] = [];
    for (const item of rawVal) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        throw new Error(
          `[profile-loader] profile=${profileName} personal_prerequisites.${rawKey} 含非法项`,
        );
      }
      const id = item.trim() as PersonalPrerequisiteId;
      if (id === 'agent_adapter') {
        throw new Error(
          `[profile-loader] profile=${profileName} personal_prerequisites.${rawKey} 不得声明 agent_adapter（框架隐式追加）`,
        );
      }
      if (!PROFILE_DECLARABLE_PREREQUISITE_IDS.has(id)) {
        throw new Error(
          `[profile-loader] profile=${profileName} personal_prerequisites.${rawKey} 未知 prerequisite: ${item}`,
        );
      }
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length > 0) {
      out[capKey] = ids;
    }
  }
  return out;
}
