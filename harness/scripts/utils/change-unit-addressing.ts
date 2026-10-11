import { ChangeUnitArtifact, blueprintRefAddress } from './change-unit-model';

/** 只判登记地址的直接引用；不消费完成证据、不作覆盖裁决。 */
export function ownersForAddress(units: readonly ChangeUnitArtifact[], address: string): string[] {
  return [...new Set(units.filter(unit => unit.design_refs.some(ref => blueprintRefAddress(ref) === address))
    .map(unit => unit.change_unit_id))].sort();
}
