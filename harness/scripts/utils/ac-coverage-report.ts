// ============================================================================
// ac-coverage-report.ts — UT 阶段机器回执（非 acceptance SSOT）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { AcceptanceSpec } from './types';
import { isUnitUtLayer } from './acceptance-layering';
import { featureFilePath } from '../../config';

export interface AcCoverageEntry {
  id: string;
  kind: 'criterion' | 'boundary';
  ut_layer?: string;
  priority?: string;
  ut_covered: boolean;
  it_tags: string[];
}

export interface AcCoverageReport {
  schema_version: '1.0';
  feature: string;
  generated_at: string;
  harness_phase: 'ut';
  criteria: AcCoverageEntry[];
  boundaries: AcCoverageEntry[];
  summary: {
    unit_scope_total: number;
    unit_covered: number;
    device_delegated: number;
  };
}

function normalizeId(id: string): string {
  return id.toUpperCase().replace(/\s/g, '');
}

function collectItTagsForAc(
  acId: string,
  itNames: string[],
): string[] {
  const norm = normalizeId(acId);
  const tags: string[] = [];
  const direct = new RegExp(`\\[${acId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i');
  const acNum = acId.replace(/^(AC|BD)-/, '');
  const loose = new RegExp(`\\[(AC|BD)-${acNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i');
  for (const name of itNames) {
    if (direct.test(name) || loose.test(name)) tags.push(name);
  }
  return tags;
}

export function buildAcCoverageReport(
  feature: string,
  acceptance: AcceptanceSpec,
  itNames: string[],
): AcCoverageReport {
  const criteria: AcCoverageEntry[] = [];
  const boundaries: AcCoverageEntry[] = [];

  for (const c of acceptance.criteria ?? []) {
    if (!isUnitUtLayer(c.ut_layer)) continue;
    const it_tags = collectItTagsForAc(c.id, itNames);
    criteria.push({
      id: c.id,
      kind: 'criterion',
      ut_layer: c.ut_layer,
      priority: c.priority,
      ut_covered: it_tags.length > 0,
      it_tags,
    });
  }
  for (const b of acceptance.boundaries ?? []) {
    if (!isUnitUtLayer(b.ut_layer)) continue;
    const it_tags = collectItTagsForAc(b.id, itNames);
    boundaries.push({
      id: b.id,
      kind: 'boundary',
      ut_layer: b.ut_layer,
      priority: b.priority,
      ut_covered: it_tags.length > 0,
      it_tags,
    });
  }

  const unitEntries = [...criteria, ...boundaries];
  const deviceDelegated =
    (acceptance.criteria ?? []).filter(c => c.ut_layer === 'device').length +
    (acceptance.boundaries ?? []).filter(b => b.ut_layer === 'device').length;

  return {
    schema_version: '1.0',
    feature,
    generated_at: new Date().toISOString(),
    harness_phase: 'ut',
    criteria,
    boundaries,
    summary: {
      unit_scope_total: unitEntries.length,
      unit_covered: unitEntries.filter(e => e.ut_covered).length,
      device_delegated: deviceDelegated,
    },
  };
}

export function acCoverageReportPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('ut', 'reports', 'ac-coverage.json'));
}

export function loadAcCoverageReport(
  projectRoot: string,
  feature: string,
): AcCoverageReport | null {
  const abs = acCoverageReportPath(projectRoot, feature);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8').replace(/^\uFEFF/, '')) as AcCoverageReport;
  } catch {
    return null;
  }
}

/** True when ac-coverage.json lists the scope id with ut_covered: true. */
export function acCoverageCoversScope(
  projectRoot: string,
  feature: string,
  scopeId: string,
  reportOverride?: AcCoverageReport | null,
): boolean {
  const report = reportOverride ?? loadAcCoverageReport(projectRoot, feature);
  if (!report) return false;
  const hit = [...(report.criteria ?? []), ...(report.boundaries ?? [])].find(
    e => e.id === scopeId,
  );
  return hit?.ut_covered === true;
}

export function writeAcCoverageReport(
  projectRoot: string,
  feature: string,
  report: AcCoverageReport,
): string {
  const outDir = featureFilePath(projectRoot, feature, path.join('ut', 'reports'));
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'ac-coverage.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  return outPath;
}
