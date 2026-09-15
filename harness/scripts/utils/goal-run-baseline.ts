import { loadFrameworkConfig } from '../../config';
import { loadGoalManifestFromRun } from './goal-manifest';
import { inspectGoalRunCreation } from './goal-run-creation';
import { readCodingBase } from './pass-snapshot';

export type GoalRunBaseline =
  | { available: true; baseSha: string; source: 'run_base_sha' | 'legacy_coding_base_sha' }
  | { available: false; reason: string };

/** Goal-mode diff baseline SSOT. Modern runs never fall back to env or legacy coding-base files. */
export function resolveGoalRunBaseline(
  projectRoot: string,
  feature: string,
  runId: string,
): GoalRunBaseline {
  let manifest;
  try {
    const cfg = loadFrameworkConfig(projectRoot);
    manifest = loadGoalManifestFromRun(projectRoot, runId, {
      feature,
      featuresDir: cfg.paths.features_dir ?? 'doc/features',
    });
  } catch (error) {
    return { available: false, reason: `goal manifest 缺失或损坏：${(error as Error).message}` };
  }

  const creation = inspectGoalRunCreation(projectRoot, manifest);
  if (creation.state === 'complete') {
    // D2 §3 问题 9: a run born as [spec] has no manifest.run_base_sha (birth identity field,
    // write-once), so the first coding/ut-bearing scope_revised carries it instead. Read both
    // through one resolver; legacy/env fallback stays forbidden.
    const { resolveRunBaseline, loadAuthoritativeRunEvents } = require('./goal-run-creation') as typeof import('./goal-run-creation');
    const resolved = resolveRunBaseline(manifest, loadAuthoritativeRunEvents(projectRoot, feature, runId));
    if (!resolved.baseSha) {
      return {
        available: false,
        reason: '现代 run（run_created 在场）既无 manifest.run_base_sha 也无携带基线的 scope_revised；禁止回退 legacy/env 基线',
      };
    }
    return { available: true, baseSha: resolved.baseSha, source: 'run_base_sha' };
  }
  if (creation.state !== 'legacy') {
    return {
      available: false,
      reason:
        creation.state === 'creation_incomplete'
          ? `CREATION_INCOMPLETE：${creation.reason}`
          : 'goal run 出生记录缺失',
    };
  }

  const legacy = readCodingBase(projectRoot, feature, runId);
  if (legacy.status === 'ok' && legacy.body) {
    return { available: true, baseSha: legacy.body.base_sha, source: 'legacy_coding_base_sha' };
  }
  return {
    available: false,
    reason:
      legacy.status === 'invalid'
        ? 'legacy coding-base 记录损坏/上下文不匹配'
        : 'legacy run 无可信 coding-base 记录',
  };
}
