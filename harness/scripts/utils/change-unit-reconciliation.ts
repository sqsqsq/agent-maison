import { asRecord } from './component-blueprint-model';
import { loadCanonicalBlueprint, resolveComponentBlueprintRefFromLoaded } from './component-blueprint-path';
import { blockerIssues, validateComponentBlueprint } from './component-blueprint-validator';
import { ChangeUnitArtifact } from './change-unit-model';

export interface ChangeUnitCarryForwardVerdict {
  allowed: boolean;
  reasons: string[];
}

function unresolved(target: unknown): boolean {
  const record = asRecord(target);
  if (!record) return false;
  return record.status === 'open_decision'
    || record.status === 'blocker'
    || record.disposition === 'open_decision'
    || record.disposition === 'blocker'
    || record.knowledge_state === 'unknown';
}

export function evaluateChangeUnitCarryForward(
  projectRoot: string,
  historical: ChangeUnitArtifact,
): ChangeUnitCarryForwardVerdict {
  const reasons: string[] = [];
  let current;
  try {
    // M5A §5.5/§8.5：carry-forward 仅在历史 CU 的 blueprint_id 工作区内跨 revision 生效；
    // 跨工作区（含同 component_id 早期演进）的 provides 不参与依赖满足（proof 4）。
    current = loadCanonicalBlueprint(projectRoot, historical.blueprint_id);
  } catch (error) {
    return { allowed: false, reasons: [(error as Error).message] };
  }
  const blueprint = current.blueprint;
  reasons.push(...blockerIssues(validateComponentBlueprint(blueprint, { projectRoot, canonicalPath: current.canonicalPath }))
    .map(issue => `当前 blueprint 未完整准入：${issue.id}@${issue.path}：${issue.message}`));
  if (reasons.length) return { allowed: false, reasons };
  for (const historicRef of historical.design_refs) {
    const currentRef = {
      ...historicRef,
      revision: Number(blueprint.revision),
      source_fingerprint: String(blueprint.source_fingerprint),
      artifact_sha256: current.artifactSha256,
      target: { ...historicRef.target },
    };
    try {
      const resolved = resolveComponentBlueprintRefFromLoaded(current, currentRef);
      if (unresolved(resolved.target)) reasons.push(`${historicRef.target.kind}:${historicRef.target.id} 当前未决。`);
    } catch (error) {
      reasons.push(`${historicRef.target.kind}:${historicRef.target.id} 当前不可解析：${(error as Error).message}`);
    }
  }
  return { allowed: reasons.length === 0, reasons };
}
