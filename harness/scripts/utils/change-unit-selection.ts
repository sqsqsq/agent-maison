import { ChangeUnitArtifact } from './change-unit-model';

export function selectNextChangeUnit(ready: ChangeUnitArtifact[]): ChangeUnitArtifact | undefined {
  return [...ready].sort((a, b) => a.priority - b.priority
    || (a.change_unit_id < b.change_unit_id ? -1 : a.change_unit_id > b.change_unit_id ? 1 : 0))[0];
}
