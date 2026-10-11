import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { asRecord } from './component-blueprint-model';
import { componentBlueprintPath, loadCanonicalBlueprint } from './component-blueprint-path';
import { collectBlueprintReviewInputs, reviewChangeUnitBindings } from './blueprint-review-inputs';
import { BLUEPRINT_REVIEW_FORMAT, renderBlueprintReviewMarkdown } from './blueprint-review-projection';
import { stableStringify } from './phase-evidence-manifest';
import { enumerateCanonicalChangeUnitIds } from './change-unit-path';

export interface BlueprintReviewResult {
  path: string;
  status: 'current' | 'refreshed' | 'failed';
  writtenPaths: string[];
  sourceGaps: string[];
  reason?: string;
  rebuildCommand: string;
}
export function blueprintReviewPath(projectRoot: string, blueprintId: string): string {
  return path.join(path.dirname(componentBlueprintPath(projectRoot, blueprintId)), 'component-blueprint.review.md');
}
export function blueprintReviewRebuildCommand(blueprintId: string): string {
  return `npm run check:component-blueprint -- --project-root <host-root> --blueprint ${blueprintId} --write-review`;
}
export function loadBlueprintReviewSource(projectRoot: string, blueprintId: string) {
  const loaded = loadCanonicalBlueprint(projectRoot, blueprintId);
  const inputs = collectBlueprintReviewInputs(projectRoot, loaded);
  return { loaded, inputs, markdown: renderBlueprintReviewMarkdown(loaded.blueprint, loaded.artifactSha256, inputs) };
}

/** 最后一次结果决定最终状态，内部曾写出的路径不会因外层同字节或失败而丢失。 */
export function summarizeBlueprintReviewResults(...results: Array<BlueprintReviewResult | undefined>): BlueprintReviewResult | undefined {
  const attempts = results.filter((result): result is BlueprintReviewResult => !!result);
  const final = attempts[attempts.length - 1];
  if (!final) return undefined;
  const writtenPaths = [...new Set(attempts.flatMap(result => result.writtenPaths))];
  return { ...final, writtenPaths, status: final.status === 'failed' ? 'failed' : writtenPaths.length ? 'refreshed' : 'current' };
}

/** 展示写入独立于设计/施工判定：任何失败均返回诊断，不抛入原事务。 */
export function materializeBlueprintReview(projectRoot: string, blueprintId: string): BlueprintReviewResult {
  const target = blueprintReviewPath(projectRoot, blueprintId);
  const result: BlueprintReviewResult = { path: target, status: 'failed', writtenPaths: [], sourceGaps: [], rebuildCommand: blueprintReviewRebuildCommand(blueprintId) };
  const temporary = `${target}.tmp-${process.pid}-review`;
  try {
    const source = loadBlueprintReviewSource(projectRoot, blueprintId);
    result.sourceGaps = source.inputs.sourceGaps;
    const readableBytes = (file: string): Buffer | null => { try { return fs.readFileSync(file); } catch { return null; } };
    const bytes = source.inputs.units.map(item => item.sourceBytes ?? null);
    // 包括坏 CU 的原始字节与集合；不能只用有效摘要比较来忽略待绑定/历史内容的变化。
    const stillCurrent = (): boolean => {
      const ids = enumerateCanonicalChangeUnitIds(projectRoot, blueprintId);
      return source.loaded.bytes.equals(fs.readFileSync(source.loaded.canonicalPath))
        && source.inputs.units.length === ids.length
        && source.inputs.units.every((item, index) => {
          const next = readableBytes(item.canonicalPath);
          return item.id === ids[index] && (bytes[index] === null ? next === null : !!next && bytes[index]!.equals(next));
        });
    };
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === source.markdown) {
      if (!stillCurrent()) throw new Error('来源在生成期间改变，请重试重建。');
      return { ...result, status: 'current' };
    }
    fs.writeFileSync(temporary, source.markdown, { encoding: 'utf8', flag: 'wx' });
    if (!stillCurrent()) throw new Error('来源在生成期间改变，请重试重建。');
    fs.renameSync(temporary, target);
    return { ...result, status: 'refreshed', writtenPaths: [target] };
  } catch (error) {
    result.reason = (error as Error).message;
    return result;
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* 清理失败不遮盖实际生成结果。 */ }
  }
}

/** 可同时报告多个可重建原因；同来源正文差异不推断为新增事实。 */
export function blueprintReviewDifferences(projection: string, source: ReturnType<typeof loadBlueprintReviewSource>): Array<{ id: string; message: string }> {
  if (projection === source.markdown) return [];
  let header: Record<string, unknown> = {};
  try { header = asRecord(YAML.parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(projection)?.[1] ?? '')) ?? {}; } catch { /* 诊断来源缺失，不接受畸形头。 */ }
  const derived = asRecord(header.derived_from);
  const reasons: Array<{ id: string; message: string }> = [];
  if (derived?.artifact_sha256 !== source.loaded.artifactSha256 || derived?.revision !== source.loaded.blueprint.revision
    || derived?.component_id !== source.loaded.blueprint.component_id || derived?.blueprint_id !== source.loaded.blueprint.blueprint_id
    || derived?.source_fingerprint !== source.loaded.blueprint.source_fingerprint) {
    reasons.push({ id: 'publication_derived_from_mismatch', message: '蓝图来源变化或绑定不完整，重建即可。' });
  }
  if (header.projection !== BLUEPRINT_REVIEW_FORMAT || !Array.isArray(derived?.change_units)) reasons.push({ id: 'publication_projection_format_stale', message: '渲染格式升级，按当前格式重建即可；无需修改 canonical revision。' });
  if (Array.isArray(derived?.change_units) && stableStringify(derived.change_units) !== stableStringify(reviewChangeUnitBindings(source.inputs))) reasons.push({ id: 'publication_change_units_mismatch', message: 'CU 集合或内容绑定变化，重建即可。' });
  if (!reasons.length) reasons.push({ id: 'publication_projection_content_mismatch', message: '相同来源/格式的投影正文不一致（含已替代 CU 内容），重建即可。' });
  return reasons;
}

export function inspectBlueprintReview(projectRoot: string, blueprintId: string) {
  const target = blueprintReviewPath(projectRoot, blueprintId);
  try {
    const source = loadBlueprintReviewSource(projectRoot, blueprintId);
    const differences = fs.existsSync(target) ? blueprintReviewDifferences(fs.readFileSync(target, 'utf8'), source) : [];
    return { path: target, status: fs.existsSync(target) ? differences.length ? 'stale' : 'current' : 'missing', sourceGaps: source.inputs.sourceGaps,
      reasons: differences, rebuildCommand: blueprintReviewRebuildCommand(blueprintId) };
  } catch (error) { return { path: target, status: 'unavailable', reason: (error as Error).message, rebuildCommand: blueprintReviewRebuildCommand(blueprintId) }; }
}
