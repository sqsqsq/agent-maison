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
