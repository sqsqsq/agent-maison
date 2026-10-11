import * as crypto from 'crypto';
import * as fs from 'fs';
import { stableStringify } from './phase-evidence-manifest';
import { asRecord } from './component-blueprint-model';
import { componentBlueprintPath, loadCanonicalBlueprint, resolveComponentBlueprintRef, sha256Bytes } from './component-blueprint-path';
import { loadCanonicalChangeUnit, parseChangeUnitFeatureId, resolveChangeUnitRef } from './change-unit-path';
import { deriveModifiableModules, relevantArchitectureImpactDecisions } from './change-unit-feature-projection';
import { ChangeUnitArtifact } from './change-unit-model';
import { BLUEPRINT_PROJECTION_FILES } from './blueprint-skill-projection';
const IDENTITY_KEYS = ['revision', 'source_fingerprint', 'artifact_sha256'] as const;

/** 窄读取接点：展示使用 canonical 快照；默认解析/相关性与摘要字段集合不变。 */
export interface IdentityNeutralDigestReaders {
  blueprint: typeof resolveComponentBlueprintRef;
  changeUnit: typeof resolveChangeUnitRef;
  architecture: typeof relevantArchitectureImpactDecisions;
  unavailable?: (error: unknown) => void;
}

/**
 * plan c4e7a9b2 §3.4 B2：「已证明业务内容相同」的唯一等价判据。登记的引用换成它经精确解析器解析到的
 * 当前权威内容（引用自身去掉身份三键），再对整份值做 stableStringify 哈希：
 *  · change-unit@1：所有权引用 `component_blueprint_ref` 不展开，只中立化为 {blueprint_id, component_id}；
 *    消费目标 `design_refs[]` / `touches[].design_ref` 展开为解析到的 target 内容（含 module）；`supersedes` 经
 *    `resolveChangeUnitRef` 展开为被引 CU 的同一中立视图；顶层 `revision` 中立化；另纳入授权边界——与施工门同一谓词
 *    （`relevantArchitectureImpactDecisions`）选出的、作用于本 CU 可修改模块的 architecture_impact 决策内容。
 *  · acceptance@1 / contracts@1 / use-cases@1：`change_unit.change_unit_ref` 展开为 CU 中立视图，其余
 *    `component-blueprint@1` 精确引用展开为 target 内容；`derive.blueprint-*` 来源戳的两个 sha 须等于当前
 *    canonical CU / 蓝图 sha，中立化为 `derive.blueprint-<kind>`。
 * 无引用无来源戳的值 = 全值哈希（同一 stableStringify 口径）。未登记 artifact、任一引用解析失败 → null
 *（不能证明等价，调用方回落全值 / 字节口径）。
 */
export function identityNeutralDigest(projectRoot: string, artifactId: string, parsed: unknown, readers?: IdentityNeutralDigestReaders): string | null {
  try {
    const view = artifactId === 'change-unit@1' ? neutralChangeUnit(projectRoot, parsed, readers)
      : Object.prototype.hasOwnProperty.call(BLUEPRINT_PROJECTION_FILES, artifactId) ? neutralFeatureArtifact(projectRoot, parsed, readers) : undefined;
    return view === undefined ? null : crypto.createHash('sha256').update(stableStringify(view)).digest('hex');
  } catch (error) {
    readers?.unavailable?.(error);
    return null;
  }
}

const withoutIdentity = (ref: unknown): Record<string, unknown> =>
  Object.fromEntries(Object.entries(asRecord(ref) ?? {}).filter(([key]) => !(IDENTITY_KEYS as readonly string[]).includes(key)));

// ponytail: 进程内按「工程根 + 蓝图字节 + 引用」缓存精确解析结果（不落盘）；蓝图外文件变化不使缓存失效，上限=进程生命周期。
const resolvedBlueprintRefs = new Map<string, ReturnType<typeof resolveComponentBlueprintRef>>();
function resolveBlueprintRefCached(projectRoot: string, ref: unknown): ReturnType<typeof resolveComponentBlueprintRef> {
  const bytes = fs.readFileSync(componentBlueprintPath(projectRoot, String(asRecord(ref)?.blueprint_id)));
  const key = [projectRoot, sha256Bytes(bytes), stableStringify(ref)].join('\0');
  if (!resolvedBlueprintRefs.has(key)) resolvedBlueprintRefs.set(key, resolveComponentBlueprintRef(projectRoot, ref));
  return resolvedBlueprintRefs.get(key)!;
}
function expandBlueprintRef(projectRoot: string, ref: unknown, readers?: IdentityNeutralDigestReaders): unknown {
  return { ref: withoutIdentity(ref), content: (readers?.blueprint ?? resolveBlueprintRefCached)(projectRoot, ref).target };
}

function expandChangeUnitRef(projectRoot: string, ref: unknown, readers?: IdentityNeutralDigestReaders): unknown {
  return { ref: withoutIdentity(ref), content: neutralChangeUnit(projectRoot, (readers?.changeUnit ?? resolveChangeUnitRef)(projectRoot, ref).changeUnit, readers) };
}

function neutralChangeUnit(projectRoot: string, parsed: unknown, readers?: IdentityNeutralDigestReaders): Record<string, unknown> {
  const cu = asRecord(parsed);
  if (!cu) throw new Error('change-unit@1 须为 map');
  const { revision: _revision, ...view } = cu;
  const owner = asRecord(cu.component_blueprint_ref);
  view.component_blueprint_ref = { blueprint_id: owner?.blueprint_id, component_id: owner?.component_id };
  if (Array.isArray(cu.design_refs)) view.design_refs = cu.design_refs.map(ref => expandBlueprintRef(projectRoot, ref, readers));
  if (Array.isArray(cu.touches)) {
    view.touches = cu.touches.map(touch => {
      const record = asRecord(touch);
      return record?.design_ref === undefined ? touch : { ...record, design_ref: expandBlueprintRef(projectRoot, record.design_ref, readers) };
    });
  }
  if (cu.supersedes !== undefined) view.supersedes = expandChangeUnitRef(projectRoot, cu.supersedes, readers);
  // 授权边界：作用于本 CU 可修改模块的 architecture_impact 决策（与施工门同一相关性谓词），即使不在 design_refs 里。
  const artifact = cu as unknown as ChangeUnitArtifact;
  const designDecisionIds = (Array.isArray(cu.design_refs) ? cu.design_refs : []).map(ref => asRecord(asRecord(ref)?.target))
    .filter(target => target?.kind === 'decision').map(target => String(target!.id));
  const resolveBlueprint = readers?.blueprint ?? resolveBlueprintRefCached;
  view.relevant_architecture_impact = (readers?.architecture ?? relevantArchitectureImpactDecisions)(projectRoot, resolveBlueprint(projectRoot, cu.component_blueprint_ref).blueprint,
    deriveModifiableModules(projectRoot, artifact, readers?.blueprint), designDecisionIds).map(withoutIdentity);  return view;
}

const PROJECTION_STAMP = /^derive\.blueprint-(acceptance|contracts):(sha256:[0-9a-f]{64}):(sha256:[0-9a-f]{64})$/;
function neutralFeatureArtifact(projectRoot: string, parsed: unknown, readers?: IdentityNeutralDigestReaders): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    const record = asRecord(node);
    if (!record) return node;
    if (record.artifact === 'component-blueprint@1') return expandBlueprintRef(projectRoot, record, readers);
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, walk(child)]));
  };
  const view = asRecord(walk(parsed));
  if (!view) return parsed;
  const cuRef = asRecord(asRecord(parsed)?.change_unit)?.change_unit_ref;
  if (cuRef !== undefined) view.change_unit = { ...asRecord(view.change_unit), change_unit_ref: expandChangeUnitRef(projectRoot, cuRef, readers) };
  if (typeof view.source === 'string' && view.source.startsWith('derive.blueprint-')) {
    const stamp = PROJECTION_STAMP.exec(view.source);
    const identity = parseChangeUnitFeatureId(String(view.feature));
    if (!stamp
      || loadCanonicalChangeUnit(projectRoot, identity.blueprintId, identity.changeUnitId).artifactSha256 !== stamp[2]
      || loadCanonicalBlueprint(projectRoot, identity.blueprintId).artifactSha256 !== stamp[3]) {
      throw new Error('派生投影来源戳不指向当前 canonical CU / 蓝图');
    }
    view.source = `derive.blueprint-${stamp[1]}`;
  }
  return view;
}
