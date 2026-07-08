// ============================================================================
// feature-track.ts — feature.yaml 的 track 声明读取（C1 feature-track，plan d4a7c1e8）
// ============================================================================
// feature 级档位声明落盘于 <features_dir>/<feature>/feature.yaml（路径一律经
// paths.features_dir 解析，禁止硬编码 doc/features/——round7 path-governance）。
// 文件缺失 / 解析失败 / 未声明 → null（resolveFeatureTrack 解释为 full，默认零变化）。

import * as fs from 'fs';
import * as YAML from 'yaml';
import { featureArtifactPath } from '../../config';
import type { FeatureTrackDecl } from './runtime-policy';

export const FEATURE_DECL_FILENAME = 'feature.yaml';

export function featureTrackDeclPath(projectRoot: string, feature: string): string {
  return featureArtifactPath(projectRoot, feature, FEATURE_DECL_FILENAME);
}

export function loadFeatureTrackDecl(projectRoot: string, feature: string): FeatureTrackDecl | null {
  try {
    const abs = featureTrackDeclPath(projectRoot, feature);
    if (!fs.existsSync(abs)) return null;
    const raw = YAML.parse(fs.readFileSync(abs, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const track = (raw as { track?: unknown }).track;
    return typeof track === 'string' ? { track } : {};
  } catch {
    // 解析失败按未声明处理（full），不阻断——feature.yaml 语法问题由 change/exit 门禁另行报告
    return null;
  }
}

/** C5-full：修正闭环时 append 到 feature.yaml > history[]（与 track 升档事件共用同一数组）。 */
export interface CorrectionHistoryEntry {
  at: string;
  type: 'correction';
  root_layer: string;
  touched_layers: readonly string[];
}

/**
 * appendFeatureCorrectionHistory：feature.yaml 不存在（no-feature 修正、或 feature 未曾声明 track）时静默跳过——
 * 修正历史是锦上添花的可追溯性记录，不是阻断性契约，文件缺失不应让 --correction-check 收口失败。
 */
export function appendFeatureCorrectionHistory(
  projectRoot: string,
  feature: string,
  entry: CorrectionHistoryEntry,
): void {
  const abs = featureTrackDeclPath(projectRoot, feature);
  if (!fs.existsSync(abs)) return;
  try {
    const raw = YAML.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return;
    const history = Array.isArray(raw.history) ? raw.history : [];
    history.push(entry);
    raw.history = history;
    fs.writeFileSync(abs, YAML.stringify(raw), 'utf-8');
  } catch {
    // 写入失败不阻断修正闭环——历史记录是可追溯性增强，非红线契约
  }
}
