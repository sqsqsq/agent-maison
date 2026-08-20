import * as fs from 'fs';
import * as path from 'path';
import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import { stableAddressIndex } from './blueprint-addressing';
import { sha256Bytes } from './component-blueprint-path';
import { validateProjectRelativePath } from './project-relative-path';
import { validateProvenanceRecord } from './blueprint-provenance';

export interface CurrentScopeItem {
  item_id: string;
  kind: 'requirement' | 'goal' | 'invariant' | 'high_risk';
  source_ref: string;
  source_revision?: string;
  source_sha256?: string;
  provenance: BlueprintRecord;
}

export interface RequirementTraceability {
  item_id: string;
  blueprint_refs: string[];
}

export function currentScopeItems(blueprint: BlueprintRecord): CurrentScopeItem[] {
  const discovery = asRecord(blueprint.discovery);
  const inputs = asRecord(discovery?.inputs);
  return asRecords(inputs?.current_scope_items) as unknown as CurrentScopeItem[];
}

export function requirementTraceability(blueprint: BlueprintRecord): RequirementTraceability[] {
  return asRecords(asRecord(blueprint.discovery)?.requirement_traceability)
    .map(record => ({ item_id: String(record.item_id ?? ''), blueprint_refs: asStrings(record.blueprint_refs) }));
}

export function resolveCurrentScopeSource(projectRoot: string, sourceRef: string): { bytes: Buffer; fragment: string; source_sha256: string } {
  const hashAt = sourceRef.indexOf('#');
  const relPath = hashAt >= 0 ? sourceRef.slice(0, hashAt) : sourceRef;
  const fragment = hashAt >= 0 ? sourceRef.slice(hashAt + 1) : '';
  const safePath = validateProjectRelativePath(projectRoot, relPath, 'current_scope_items.source_ref');
  const absolute = path.resolve(projectRoot, safePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`current-scope 来源不存在：${sourceRef}`);
  }
  const bytes = fs.readFileSync(absolute);
  if (hashAt >= 0 && (!nonEmptyString(fragment) || !bytes.toString('utf8').includes(fragment))) {
    throw new Error(`current-scope source fragment 无法解析：${sourceRef}`);
  }
  return { bytes, fragment, source_sha256: sha256Bytes(bytes) };
}

export function validateRequirementTraceability(
  blueprint: BlueprintRecord,
  projectRoot?: string,
): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const items = currentScopeItems(blueprint);
  const mappings = requirementTraceability(blueprint);
  const addresses = stableAddressIndex(blueprint);
  const itemIds = new Set<string>();
  const mappingIds = new Set<string>();

  items.forEach((item, index) => {
    const base = `$.discovery.inputs.current_scope_items[${index}]`;
    if (!nonEmptyString(item.item_id)) return;
    if (itemIds.has(item.item_id)) out.push(issue('blueprint_current_scope_item_duplicate', `${base}.item_id`, `item_id=${item.item_id} 重复。`));
    itemIds.add(item.item_id);
    if (!nonEmptyString(item.source_sha256)) {
      out.push(issue('blueprint_current_scope_source_hash_missing', `${base}.source_sha256`, '项目内 current-scope item 必须绑定实际原始字节的 source_sha256；source_revision 不能替代内容 hash。'));
    }
    out.push(...validateProvenanceRecord(item.provenance, `${base}.provenance`));
    if (asRecord(item.provenance)?.source_ref !== item.source_ref) {
      out.push(issue('blueprint_current_scope_provenance_mismatch', `${base}.provenance.source_ref`, 'provenance.source_ref 必须与 item.source_ref 一致。'));
    }
    if (nonEmptyString(item.source_revision)
      && asRecord(item.provenance)?.source_revision !== item.source_revision) {
      out.push(issue('blueprint_current_scope_provenance_mismatch', `${base}.provenance.source_revision`, 'provenance.source_revision 必须与 item.source_revision 一致。'));
    }
    if (!projectRoot) {
      out.push(issue('blueprint_current_scope_source_context_missing', `${base}.source_ref`, '校验 current-scope 来源需要 projectRoot。'));
      return;
    }
    try {
      const source = resolveCurrentScopeSource(projectRoot, item.source_ref);
      if (nonEmptyString(item.source_sha256) && item.source_sha256 !== source.source_sha256) {
        out.push(issue('blueprint_current_scope_source_hash_mismatch', `${base}.source_sha256`, `source_sha256 与 ${item.source_ref} 原始字节不一致。`));
      }
    } catch (error) {
      out.push(issue('blueprint_current_scope_source_unresolvable', `${base}.source_ref`, (error as Error).message));
    }
  });

  mappings.forEach((mapping, index) => {
    const base = `$.discovery.requirement_traceability[${index}]`;
    if (!nonEmptyString(mapping.item_id)) return;
    if (mappingIds.has(mapping.item_id)) out.push(issue('blueprint_requirement_traceability_duplicate', `${base}.item_id`, `item_id=${mapping.item_id} 重复。`));
    mappingIds.add(mapping.item_id);
    if (!itemIds.has(mapping.item_id)) out.push(issue('blueprint_requirement_traceability_extra', `${base}.item_id`, `traceability 的 ${mapping.item_id} 不在 current_scope_items。`));
    if (mapping.blueprint_refs.length === 0) out.push(issue('blueprint_requirement_traceability_empty', `${base}.blueprint_refs`, '每个 current-scope item 至少映射一个蓝图稳定地址。'));
    for (const address of mapping.blueprint_refs) {
      if (!addresses.has(address)) out.push(issue('blueprint_requirement_traceability_dangling', `${base}.blueprint_refs`, `稳定地址不存在于当前蓝图：${address}`));
    }
  });
  for (const itemId of itemIds) {
    if (!mappingIds.has(itemId)) out.push(issue('blueprint_requirement_traceability_missing', '$.discovery.requirement_traceability', `current-scope item ${itemId} 缺 traceability。`));
  }
  return out;
}
