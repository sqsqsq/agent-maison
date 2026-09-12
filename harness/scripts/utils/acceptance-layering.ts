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

/** UT 覆盖率分母：显式 unit / both；缺失层级交原分层校验处理。 */
export function isUnitUtLayer(layer?: string): boolean {
  return layer === 'unit' || layer === 'both';
}

/** 真机 test-plan 追溯分母：device / both */
export function isDeviceUtLayer(layer?: string): boolean {
  return layer === 'device' || layer === 'both';
}

export function isP0P1Priority(priority: string): boolean {
  const normalized = priority.trim().toUpperCase();
  return normalized === 'P0' || normalized === 'P1';
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
  criteria.push(...(acceptance.performance ?? []).filter(item => isDeviceUtLayer(item.ut_layer)).map(item => ({ ...item, priority: 'P1' })));
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
  for (const item of acceptance.performance ?? []) if (isUnitUtLayer(item.ut_layer)) ids.push(item.id);
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
  for (const item of acceptance.performance ?? []) if (isDeviceUtLayer(item.ut_layer)) ids.push(item.id);
  return ids;
}

export function hasUnknownPerformanceLayer(acceptance: AcceptanceSpec): boolean {
  return (acceptance.performance ?? []).some(item => !normalizeUtLayer(item.ut_layer)
    || ![item.id, item.metric, item.threshold, item.unit, item.description].every(hasNonEmptyFocus)
    || (isDeviceUtLayer(item.ut_layer) && !hasNonEmptyFocus(item.device_focus)));
}

export function acceptanceFileExists(projectRoot: string, feature: string): boolean {
  return fs.existsSync(acceptanceYamlPath(projectRoot, feature));
}

export function legacyTodoFileExists(projectRoot: string, feature: string): boolean {
  return fs.existsSync(legacyDeviceTestingTodoPath(projectRoot, feature));
}
