import { asRecord } from './component-blueprint-model';
import { ChangeUnitRecord, changeUnitRecords } from './change-unit-model';
import { loadCanonicalBlueprint } from './component-blueprint-path';

/** CU 内全部蓝图身份指针：component_blueprint_ref、design_refs[]、touches[].design_ref。 */
export function blueprintIdentityPointers(cu: ChangeUnitRecord): Array<Record<string, unknown> | undefined> {
  return [
    asRecord(cu.component_blueprint_ref),
    ...(Array.isArray(cu.design_refs) ? cu.design_refs.map(ref => asRecord(ref)) : []),
    ...changeUnitRecords(cu.touches).map(touch => asRecord(touch.design_ref)),
  ];
}

const IDENTITY_KEYS = ['revision', 'source_fingerprint', 'artifact_sha256'] as const;
export const currentBlueprintIdentity = (current: ReturnType<typeof loadCanonicalBlueprint>) => ({
  revision: Number(current.blueprint.revision),
  source_fingerprint: String(current.blueprint.source_fingerprint),
  artifact_sha256: current.artifactSha256,
});

function identityKey(ref: Record<string, unknown> | undefined): string {
  return JSON.stringify(IDENTITY_KEYS.map(key => ref?.[key]));
}

export function ownerBlueprintPointerIsStale(cu: ChangeUnitRecord, identity: ReturnType<typeof currentBlueprintIdentity>): boolean {
  return identityKey(blueprintIdentityPointers(cu)[0]) !== identityKey(identity);
}
