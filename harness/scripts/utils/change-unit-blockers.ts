import * as fs from 'fs';
import * as path from 'path';
import { ChangeUnitArtifact, ChangeUnitBlocker } from './change-unit-model';
import { validateProjectRelativePath } from './project-relative-path';

export interface ChangeUnitBlockerObservation {
  blockerId: string;
  active: boolean;
  reason: string;
  owner: string;
  unlockCondition: string;
  legal: boolean;
}

export interface ChangeUnitBlockerProbeContext {
  projectRoot: string;
  evaluate?: (blocker: ChangeUnitBlocker) => { cleared: boolean; evidence: string };
}

export function deriveChangeUnitBlockers(
  changeUnit: ChangeUnitArtifact,
  context: ChangeUnitBlockerProbeContext,
): ChangeUnitBlockerObservation[] {
  return changeUnit.blockers.map(blocker => {
    if (blocker.observation === 'human') {
      const observed = context.evaluate?.(blocker);
      return {
        blockerId: blocker.blocker_id,
        active: !observed?.cleared,
        reason: observed?.evidence ?? blocker.reason,
        owner: blocker.owner,
        unlockCondition: blocker.unlock_condition,
        legal: Boolean(blocker.authority_ref && blocker.source_revision),
      };
    }
    const observed = context.evaluate?.(blocker);
    if (observed) {
      return {
        blockerId: blocker.blocker_id,
        active: !observed.cleared,
        reason: observed.evidence,
        owner: blocker.owner,
        unlockCondition: blocker.unlock_condition,
        legal: Boolean(blocker.probe),
      };
    }
    let cleared = false;
    let evidence = 'probe 未执行或不支持；fail-closed 保持 active';
    let legal = Boolean(blocker.probe);
    if (blocker.probe?.kind === 'file_exists') {
      try {
        const safeRef = validateProjectRelativePath(context.projectRoot, blocker.probe.ref, `blocker:${blocker.blocker_id}.probe.ref`);
        const probePath = path.resolve(context.projectRoot, safeRef);
        const exists = fs.existsSync(probePath);
        cleared = blocker.probe.expected === 'present' ? exists : blocker.probe.expected === 'absent' ? !exists : false;
        evidence = `${safeRef} exists=${exists}, expected=${blocker.probe.expected}`;
      } catch (error) {
        legal = false;
        evidence = (error as Error).message;
      }
    }
    return {
      blockerId: blocker.blocker_id,
      active: !cleared,
      reason: evidence,
      owner: blocker.owner,
      unlockCondition: blocker.unlock_condition,
      legal,
    };
  });
}
