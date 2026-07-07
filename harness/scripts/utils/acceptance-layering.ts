// ============================================================================
// acceptance-layering.ts — UT / Device 分层共享工具
// ============================================================================
// 供 check-spec / check-plan / check-ut / check-testing 复用。
// SSOT 文档：framework/docs/concepts/acceptance-layering.md
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { AcceptanceSpec, UtLayer } from './types';
import { featureFilePath, relFeatureFile } from '../../config';

export const VALID_UT_LAYERS: readonly UtLayer[] = ['unit', 'device', 'both'];

export function normalizeUtLayer(layer?: string): UtLayer | undefined {
  if (layer === 'unit' || layer === 'device' || layer === 'both') return layer;
  return undefined;
}

/** UT 覆盖率分母：unit / both；未声明 ut_layer 按 unit 兜底（向后兼容） */
export function isUnitUtLayer(layer?: string): boolean {
  return layer === 'unit' || layer === 'both' || layer === undefined;
}

/** 真机 test-plan 追溯分母：device / both */
export function isDeviceUtLayer(layer?: string): boolean {
  return layer === 'device' || layer === 'both';
}

export function isP0P1Priority(priority: string): boolean {
  return priority === 'P0' || priority === 'P1';
}

export function acceptanceYamlRel(projectRoot: string, feature: string): string {
  return relFeatureFile(projectRoot, feature, 'acceptance.yaml');
}

export function acceptanceYamlPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, 'acceptance.yaml');
}

export function legacyDeviceTestingTodoPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, 'device-testing-todo.md');
}

export function hasNonEmptyFocus(value?: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

type AcLike = {
  id: string;
  priority: string;
  description?: string;
  ut_layer?: UtLayer;
  ut_focus?: string;
  device_focus?: string;
};

export function collectDeviceScopeP0P1(acceptance: AcceptanceSpec): {
  criteria: AcLike[];
  boundaries: AcLike[];
} {
  const criteria = (acceptance.criteria ?? []).filter(
    c => isP0P1Priority(c.priority) && isDeviceUtLayer(c.ut_layer),
  ) as AcLike[];
  const boundaries = (acceptance.boundaries ?? []).filter(b => {
    if (!isDeviceUtLayer(b.ut_layer)) return false;
    if (!b.priority || b.priority.trim() === '') return true;
    return isP0P1Priority(b.priority);
  }) as AcLike[];
  return { criteria, boundaries };
}

export function collectUnitScopeIds(acceptance: AcceptanceSpec): string[] {
  const ids: string[] = [];
  for (const c of acceptance.criteria ?? []) {
    if (isUnitUtLayer(c.ut_layer)) ids.push(c.id);
  }
  for (const b of acceptance.boundaries ?? []) {
    if (isUnitUtLayer(b.ut_layer)) ids.push(b.id);
  }
  return ids;
}

/** AC/BD id（大写）→ priority，供 ui_entry_coverage 等从 linked_acceptance 解析 P0。 */
export function buildAcceptanceIdPriorityMap(acceptance: AcceptanceSpec): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of acceptance.criteria ?? []) {
    if (c.id && c.priority) map.set(c.id.toUpperCase(), c.priority);
  }
  for (const b of acceptance.boundaries ?? []) {
    if (b.id && b.priority) map.set(b.id.toUpperCase(), b.priority);
  }
  return map;
}

export function collectDeviceScopeIds(acceptance: AcceptanceSpec): string[] {
  const ids: string[] = [];
  for (const c of acceptance.criteria ?? []) {
    if (isDeviceUtLayer(c.ut_layer)) ids.push(c.id);
  }
  for (const b of acceptance.boundaries ?? []) {
    if (isDeviceUtLayer(b.ut_layer)) ids.push(b.id);
  }
  return ids;
}

export function acceptanceFileExists(projectRoot: string, feature: string): boolean {
  return fs.existsSync(acceptanceYamlPath(projectRoot, feature));
}

export function legacyTodoFileExists(projectRoot: string, feature: string): boolean {
  return fs.existsSync(legacyDeviceTestingTodoPath(projectRoot, feature));
}
