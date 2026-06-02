import * as path from 'path';
import {
  normalizeArtifactFileName,
  relFeatureArtifact,
  resolveFeatureArtifact,
  type ResolvedFeatureArtifact,
} from '../../config';
import type { CheckResult } from './types';

function relPosix(projectRoot: string, absPath: string): string {
  return path.relative(projectRoot, absPath).replace(/\\/g, '/');
}

/** 仅 legacy 路径命中时的说明（写入 check details） */
export function formatLegacyReadHint(
  projectRoot: string,
  feature: string,
  fileName: string,
  resolved?: ResolvedFeatureArtifact,
): string {
  const r = resolved ?? resolveFeatureArtifact(projectRoot, feature, fileName);
  if (!r.usedLegacy || r.legacyDuplicate || !r.exists) return '';
  const relLegacy = relPosix(projectRoot, r.legacyPath);
  const relCanon = relFeatureArtifact(projectRoot, feature, fileName);
  return `当前从兼容旧路径 \`${relLegacy}\` 读取；建议迁移至 canonical \`${relCanon}\`。`;
}

function layoutWarn(
  id: string,
  description: string,
  details: string,
  affected: string[],
  suggestion: string,
): CheckResult {
  return {
    id,
    category: 'structure',
    description,
    severity: 'MAJOR',
    status: 'WARN',
    details,
    affected_files: affected,
    suggestion,
  };
}

/**
 * 阶段产物路径布局 WARN：新旧双份（legacyDuplicate）或仅命中扁平 legacy（usedLegacy）。
 */
export function featureArtifactLayoutWarnings(
  projectRoot: string,
  feature: string,
  fileNames: string[],
): CheckResult[] {
  const out: CheckResult[] = [];
  for (const raw of fileNames) {
    const base = normalizeArtifactFileName(raw);
    const resolved = resolveFeatureArtifact(projectRoot, feature, base);
    const relCanon = relFeatureArtifact(projectRoot, feature, base);
    const relLegacy = relPosix(projectRoot, resolved.legacyPath);

    if (resolved.legacyDuplicate) {
      out.push(
        layoutWarn(
          `legacy_duplicate_${base.replace(/[^a-zA-Z0-9]+/g, '_')}`,
          `产物存在新旧双份：canonical \`${relCanon}\` 与 legacy \`${relLegacy}\` 同时存在，可能导致路径漂移。`,
          `请删除或迁移扁平 legacy 副本，仅保留阶段目录下的 canonical 文件。\n` +
            `canonical: ${resolved.canonicalPath}\n` +
            `legacy: ${resolved.legacyPath}`,
          [relCanon, relLegacy],
          `删除 legacy 文件 \`${relLegacy}\` 或将内容合并到 \`${relCanon}\` 后删除旧路径。`,
        ),
      );
      continue;
    }

    if (resolved.exists && resolved.usedLegacy) {
      out.push(
        layoutWarn(
          `legacy_read_${base.replace(/[^a-zA-Z0-9]+/g, '_')}`,
          `阶段产物 \`${base}\` 仍使用扁平 legacy 路径（建议迁移至 \`${relCanon}\`）。`,
          formatLegacyReadHint(projectRoot, feature, base, resolved),
          [relLegacy, relCanon],
          `将内容迁至 \`${relCanon}\` 并删除 \`${relLegacy}\`。`,
        ),
      );
    }
  }
  return out;
}

/** @deprecated 使用 featureArtifactLayoutWarnings */
export function legacyDuplicateArtifactWarnings(
  projectRoot: string,
  feature: string,
  fileNames: string[],
): CheckResult[] {
  return featureArtifactLayoutWarnings(projectRoot, feature, fileNames).filter((r) =>
    r.id.startsWith('legacy_duplicate_'),
  );
}
