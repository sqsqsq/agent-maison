import { asRecord } from './component-blueprint-model';
import { loadCanonicalBlueprint, resolveComponentBlueprintRef } from './component-blueprint-path';
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
  const admission = asRecord(asRecord(blueprint.review_summary)?.admission);
  if (admission?.status !== 'pass') reasons.push('当前 blueprint admission 不是 pass。');
  for (const historicRef of historical.design_refs) {
    const currentRef = {
      ...historicRef,
      revision: Number(blueprint.revision),
      source_fingerprint: String(blueprint.source_fingerprint),
      artifact_sha256: current.artifactSha256,
      target: { ...historicRef.target },
    };
    try {
      const resolved = resolveComponentBlueprintRef(projectRoot, currentRef);
      if (unresolved(resolved.target)) reasons.push(`${historicRef.target.kind}:${historicRef.target.id} 当前未决。`);
    } catch (error) {
      reasons.push(`${historicRef.target.kind}:${historicRef.target.id} 当前不可解析：${(error as Error).message}`);
    }
  }
  return { allowed: reasons.length === 0, reasons };
}
