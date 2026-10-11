import * as fs from 'fs';
import * as path from 'path';
import { BlueprintRecord } from './component-blueprint-model';
import { loadCanonicalBlueprint, resolveComponentBlueprintRef, resolveComponentBlueprintRefFromLoaded } from './component-blueprint-path';
import { ChangeUnitArtifact, blueprintRefAddress } from './change-unit-model';
import { LoadedChangeUnit, asChangeUnitArtifact, changeUnitDirectory, createChangeUnitRef, enumerateCanonicalChangeUnitIds, loadCanonicalChangeUnit, resolveChangeUnitRefFromLoaded } from './change-unit-path';
import { currentBlueprintIdentity, ownerBlueprintPointerIsStale } from './change-unit-blueprint-identity';
import { deriveModifiableModules, selectRelevantArchitectureImpactDecisions } from './change-unit-feature-projection';
import { blockerChangeUnitIssues, validateChangeUnit } from './change-unit-validator';
import { inspectRetirement } from './component-closure-inputs';
import { ComponentClosureIssue } from './component-closure-model';
import { identityNeutralDigest, IdentityNeutralDigestReaders } from './identity-neutral-digest';
import { asRecord, asRecords } from './component-blueprint-model';

export interface ReviewChangeUnit {
  id: string;
  canonicalPath: string;
  loaded?: LoadedChangeUnit;
  sourceBytes?: Buffer;
  unit?: ChangeUnitArtifact;
  binding: 'bound' | 'pending' | 'unresolved';
  digest?: string;
  equivalenceUnavailable?: string;
  modules?: string[];
  designAddresses: string[];
  errors: string[];
  retiredBy?: string;
}

export interface BlueprintReviewInputs {
  units: ReviewChangeUnit[];
  sourceGaps: string[];
  closureExists: boolean;
  sourceRootRelative?: string;
}

/** 展示逐项容错；严格枚举消费者继续使用 enumerateCanonicalChangeUnits。 */
export function collectBlueprintReviewInputs(projectRoot: string, loaded: ReturnType<typeof loadCanonicalBlueprint>): BlueprintReviewInputs {
  const blueprintId = String(loaded.blueprint.blueprint_id);
  const identity = currentBlueprintIdentity(loaded);
  const units: ReviewChangeUnit[] = [];
  const sourceGaps: string[] = [];
  const resolveReviewRef: typeof resolveComponentBlueprintRef = (_root, ref) => {
    return resolveComponentBlueprintRefFromLoaded(loaded, ref);
  };
  class LayerAttributionUnavailable extends Error {}
  const readers: IdentityNeutralDigestReaders = {
    blueprint: resolveReviewRef,
    changeUnit: (_root, ref) => {
      const value = asRecord(ref);
      const canonical = loadCanonicalChangeUnit(projectRoot, String(value?.blueprint_id), String(value?.change_unit_id));
      const bound = resolveChangeUnitRefFromLoaded(canonical, ref);
      const issues = blockerChangeUnitIssues(validateChangeUnit(canonical.changeUnit, { projectRoot, canonicalPath: canonical.canonicalPath, resolveBlueprintRef: resolveReviewRef }));
      if (issues.length) throw new Error(issues.map(i => i.message).join('; '));
      return bound;
    },
    architecture: (_root, blueprint, modifiable, designDecisionIds = []) => {
      const candidates = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions).filter(d => d.kind === 'architecture_impact' && ['add_module', 'move_module', 'dependency_edge'].includes(String(d.change)));
      const selected = selectRelevantArchitectureImpactDecisions(blueprint, new Set(modifiable), designDecisionIds);
      if (selected.length !== candidates.length) throw new LayerAttributionUnavailable('canonical 无法确定剩余架构决策与可修改模块所在层的相关性；无中立等价证明。');
      return selected;
    },
  };
  const relativeMessage = (message: string): string => [path.resolve(projectRoot), path.resolve(projectRoot).replace(/\\/g, '/')]
    .reduce((value, prefix) => value.split(prefix).join('.'), message);
  for (const id of enumerateCanonicalChangeUnitIds(projectRoot, blueprintId)) {
    const item: ReviewChangeUnit = { id, canonicalPath: path.join(changeUnitDirectory(projectRoot, blueprintId), id, 'change-unit.yaml'), binding: 'unresolved', designAddresses: [], errors: [] };
    units.push(item);
    try {
      item.sourceBytes = fs.readFileSync(item.canonicalPath);
      item.loaded = loadCanonicalChangeUnit(projectRoot, blueprintId, id, item.sourceBytes);
      item.unit = asChangeUnitArtifact(item.loaded.changeUnit);
      const pending = ownerBlueprintPointerIsStale(item.loaded.changeUnit, identity);
      item.binding = pending ? 'pending' : 'unresolved';
      item.errors.push(...blockerChangeUnitIssues(validateChangeUnit(item.unit, { projectRoot, canonicalPath: item.canonicalPath, resolveBlueprintRef: resolveReviewRef }))
        .filter(issue => !(pending && ['change_unit_blueprint_ref_stale', 'change_unit_provenance_owner_unresolvable'].includes(issue.id)))
        .map(issue => `${issue.id}@${issue.path}: ${issue.message}`));
      if (!pending) {
        for (const ref of item.unit.design_refs ?? []) {
          try {
            const resolved = resolveReviewRef(projectRoot, ref);
            item.designAddresses.push(blueprintRefAddress(resolved.ref));
          } catch (error) { item.errors.push((error as Error).message); }
        }
        try { item.modules = deriveModifiableModules(projectRoot, item.unit, resolveReviewRef); }
        catch (error) { item.errors.push((error as Error).message); }
        let limited = false;
        const digest = identityNeutralDigest(projectRoot, 'change-unit@1', item.unit, { ...readers, unavailable: error => { if (error instanceof LayerAttributionUnavailable) { limited = true; item.equivalenceUnavailable = error.message; } } });
        if (item.errors.length === 0) {
          if (digest) item.digest = digest;
          else if (!limited) item.equivalenceUnavailable = '无法证明中立等价；当前精确来源绑定仍有效。';
          item.binding = 'bound';
        }
      }
    } catch (error) { item.errors.push((error as Error).message); }
  }
  const retirementIssues: ComponentClosureIssue[] = [];
  const retirementUnits = units.flatMap(item => {
    try { return item.loaded && item.unit ? [{ ref: createChangeUnitRef(item.loaded), changeUnit: item.unit }] : []; }
    catch (error) { item.errors.push((error as Error).message); return []; }
  });
  const retiredBy = inspectRetirement(retirementUnits, retirementIssues);
  const disputed = new Set(retirementIssues.map(issue => issue.path));
  // 与 retiredChangeUnitIds 同口径：任一项不能加载时不声称退役集合完整。
  if (units.every(item => item.loaded)) {
    for (const item of units) if (!disputed.has(`change-unit:${item.id}`)) item.retiredBy = retiredBy.get(item.id);
  }
  sourceGaps.push(...retirementIssues.map(issue => `${issue.id}: ${relativeMessage(issue.message)}`));
  for (const item of units) {
    if (retirementIssues.some(issue => issue.path.startsWith(`change-unit:${item.id}.`))) item.binding = 'unresolved';
    if (item.binding === 'pending' && !item.retiredBy) sourceGaps.push(`${item.id}：owner 指针待升版；不承诺可以 carry-forward。`);
    sourceGaps.push(...item.errors.map(error => `${item.id} (${path.relative(projectRoot, item.canonicalPath).replace(/\\/g, '/')})：${relativeMessage(error)}`));
  }
  return { units, sourceGaps, closureExists: fs.existsSync(loaded.canonicalPath.replace('component-blueprint.yaml', 'component-closure.md')),
    sourceRootRelative: path.relative(path.dirname(loaded.canonicalPath), projectRoot).replace(/\\/g, '/') };
}

/** 当前有效集合；null 摘要不充当稳定身份。历史 CU 的内容仍由全文比对覆盖。 */
export function reviewChangeUnitBindings(inputs: BlueprintReviewInputs): BlueprintRecord[] {
  return inputs.units.filter(item => !item.retiredBy).map(item => ({
    change_unit_id: item.id,
    binding: item.binding,
    ...(item.digest ? { identity_neutral_digest: item.digest } : {}),
  }));
}
