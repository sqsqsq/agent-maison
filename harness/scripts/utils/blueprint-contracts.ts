import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  getId,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import { validateProvenanceRecord } from './blueprint-provenance';

export interface BlueprintContractValidationContext {
  projectRoot?: string;
  sourceCache?: Map<string, unknown>;
}

class AuthoritySourceError extends Error {
  constructor(public readonly issueId: string, message: string) {
    super(message);
  }
}

function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return document;
  if (!pointer.startsWith('/')) throw new AuthoritySourceError('blueprint_contract_authority_source_invalid', `fragment 必须是 JSON Pointer：#${pointer}`);
  let current = document;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!asRecord(current) && !Array.isArray(current)) {
      throw new AuthoritySourceError('blueprint_contract_authority_source_invalid', `JSON Pointer 无法继续解析：#${pointer}`);
    }
    current = (current as BlueprintRecord)[key];
    if (current === undefined) {
      throw new AuthoritySourceError('blueprint_contract_authority_source_invalid', `JSON Pointer 不存在：#${pointer}`);
    }
  }
  return current;
}

function loadAuthoritySource(sourceRef: string, context: BlueprintContractValidationContext): unknown {
  if (!context.projectRoot) {
    throw new AuthoritySourceError('blueprint_contract_authority_context_missing', `无法校验权威 source_ref=${sourceRef}：缺 projectRoot。`);
  }
  const hashIndex = sourceRef.indexOf('#');
  const rel = hashIndex >= 0 ? sourceRef.slice(0, hashIndex) : sourceRef;
  const pointer = hashIndex >= 0 ? sourceRef.slice(hashIndex + 1) : '';
  if (!nonEmptyString(rel) || path.isAbsolute(rel) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rel)) {
    throw new AuthoritySourceError('blueprint_contract_authority_source_invalid', `source_ref 必须是项目内相对文件：${sourceRef}`);
  }
  const projectRoot = path.resolve(context.projectRoot);
  const absolute = path.resolve(projectRoot, rel);
  const relative = path.relative(projectRoot, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AuthoritySourceError('blueprint_contract_authority_source_invalid', `source_ref 越出项目根：${sourceRef}`);
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new AuthoritySourceError('blueprint_contract_authority_source_unavailable', `权威来源不存在：${sourceRef}`);
  }
  const cache = context.sourceCache ?? (context.sourceCache = new Map<string, unknown>());
  let document = cache.get(absolute);
  if (document === undefined) {
    try {
      document = YAML.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (error) {
      throw new AuthoritySourceError('blueprint_contract_authority_source_invalid', `权威来源无法解析：${sourceRef}（${(error as Error).message}）`);
    }
    cache.set(absolute, document);
  }
  return resolveJsonPointer(document, pointer);
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  const record = asRecord(value);
  if (!record) return value;
  const ignored = new Set(['source_ref', 'verification_refs', 'provenance', 'needed_by_current_slice']);
  return Object.fromEntries(
    Object.keys(record)
      .filter(key => !ignored.has(key))
      .sort()
      .map(key => [key, comparable(record[key])]),
  );
}

function compareAuthoritySection(
  declared: unknown,
  sourceRef: unknown,
  atPath: string,
  context: BlueprintContractValidationContext,
  out: BlueprintIssue[],
): void {
  if (!nonEmptyString(sourceRef)) return;
  try {
    const authority = loadAuthoritySource(sourceRef, context);
    if (JSON.stringify(comparable(declared)) !== JSON.stringify(comparable(authority))) {
      out.push(issue('blueprint_contract_authority_mismatch', atPath, `蓝图内容与权威来源 ${sourceRef} 不一致。`));
    }
  } catch (error) {
    const sourceError = error as AuthoritySourceError;
    out.push(issue(sourceError.issueId ?? 'blueprint_contract_authority_source_invalid', atPath, sourceError.message));
  }
}

function dtoFields(dto: BlueprintRecord | undefined): Set<string> {
  return new Set(asRecords(dto?.fields).map(field => getId(field, 'field_id', 'name')).filter((id): id is string => Boolean(id)));
}

function validateSourcedSection(section: unknown, atPath: string, label: string): BlueprintIssue[] {
  const record = asRecord(section);
  if (!record || !nonEmptyString(record.source_ref) || asStrings(record.verification_refs).length === 0) {
    return [issue('blueprint_contract_semantics_incomplete', atPath, `${label} 必须有 source_ref 与 verification_refs。`)];
  }
  return [];
}

export function validateBlueprintContracts(
  blueprint: BlueprintRecord,
  context: BlueprintContractValidationContext = {},
): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const seen = new Set<string>();
  asRecords(blueprint.contracts).forEach((contract, index) => {
    const base = `$.contracts[${index}]`;
    const contractId = getId(contract, 'contract_id');
    if (!contractId) out.push(issue('blueprint_contract_id_missing', `${base}.contract_id`, '外部契约必须有稳定 contract_id。'));
    else if (seen.has(contractId)) out.push(issue('blueprint_contract_id_duplicate', `${base}.contract_id`, `contract_id=${contractId} 重复。`));
    else seen.add(contractId);

    const operation = asRecord(contract.operation);
    for (const field of ['operation_id', 'direction', 'version', 'source_ref']) {
      if (!nonEmptyString(operation?.[field])) out.push(issue('blueprint_contract_operation_incomplete', `${base}.operation.${field}`, `operation.${field} 必填。`));
    }
    if (asStrings(operation?.verification_refs).length === 0) {
      out.push(issue('blueprint_contract_verification_missing', `${base}.operation.verification_refs`, 'operation 必须有 verification_refs。'));
    }
    compareAuthoritySection(operation, operation?.source_ref, `${base}.operation`, context, out);

    const request = asRecord(contract.request_dto);
    const response = asRecord(contract.response_dto);
    for (const [name, dto] of [['request_dto', request], ['response_dto', response]] as const) {
      if (!dto || !nonEmptyString(dto.dto_id) || !nonEmptyString(dto.source_ref) || asStrings(dto.verification_refs).length === 0) {
        out.push(issue('blueprint_contract_dto_incomplete', `${base}.${name}`, `${name} 必须包含 dto_id/source_ref/verification_refs。`));
      }
      asRecords(dto?.fields).forEach((field, fieldIndex) => {
        for (const key of ['field_id', 'type', 'semantics', 'source_ref']) {
          if (!nonEmptyString(field[key])) out.push(issue('blueprint_contract_field_incomplete', `${base}.${name}.fields[${fieldIndex}].${key}`, `权威 DTO 字段缺 ${key}。`));
        }
        out.push(...validateProvenanceRecord(field.provenance, `${base}.${name}.fields[${fieldIndex}].provenance`));
        compareAuthoritySection(field, field.source_ref, `${base}.${name}.fields[${fieldIndex}]`, context, out);
      });
      compareAuthoritySection(dto, dto?.source_ref, `${base}.${name}`, context, out);
    }

    const requestFields = dtoFields(request);
    const responseFields = dtoFields(response);
    const wireFields = new Set([...requestFields, ...responseFields]);
    const fieldRecords = new Map<string, BlueprintRecord>();
    for (const field of [...asRecords(request?.fields), ...asRecords(response?.fields)]) {
      const id = getId(field, 'field_id', 'name');
      if (id) fieldRecords.set(id, field);
    }
    const mappings = asRecords(contract.mappings);
    if (mappings.length === 0) {
      out.push(issue('blueprint_contract_mapping_missing', `${base}.mappings`, 'operation 存在不代表 mapping 闭合。'));
    }
    mappings.forEach((mapping, mappingIndex) => {
      const mappingBase = `${base}.mappings[${mappingIndex}]`;
      for (const field of ['mapping_id', 'target_field', 'rule', 'source_ref']) {
        if (!nonEmptyString(mapping[field])) out.push(issue('blueprint_contract_mapping_incomplete', `${mappingBase}.${field}`, `mapping.${field} 必填。`));
      }
      const kind = String(mapping.kind ?? 'direct');
      const sourceFields = asStrings(mapping.source_fields);
      if (!['direct', 'derivation', 'default', 'drop'].includes(kind)) {
        out.push(issue('blueprint_contract_mapping_kind_invalid', `${mappingBase}.kind`, 'mapping kind 非法。'));
      }
      if ((kind === 'direct' || kind === 'derivation') && sourceFields.length === 0) {
        out.push(issue('blueprint_contract_mapping_source_missing', `${mappingBase}.source_fields`, `${kind} mapping 必须列出 source_fields。`));
      }
      for (const sourceField of sourceFields) {
        if (!wireFields.has(sourceField)) {
          out.push(issue('blueprint_contract_field_fabricated', `${mappingBase}.source_fields`, `${sourceField} 不在权威 wire DTO；内部派生字段必须是 target_field 而非伪造 wire 来源。`));
        }
        if (mapping.assumes_non_null === true && fieldRecords.get(sourceField)?.nullable === true) {
          out.push(issue('blueprint_contract_mapping_conflict', mappingBase, `mapping 把 nullable wire 字段 ${sourceField} 当作必有值。`));
        }
      }
      out.push(...validateProvenanceRecord(mapping.provenance, `${mappingBase}.provenance`));
      if (asStrings(mapping.verification_refs).length === 0) {
        out.push(issue('blueprint_contract_verification_missing', `${mappingBase}.verification_refs`, 'mapping 必须有 verification_refs。'));
      }
      compareAuthoritySection(mapping, mapping.source_ref, mappingBase, context, out);
    });
    const mappedWireFields = new Set(mappings.flatMap(mapping => asStrings(mapping.source_fields)));
    for (const [fieldId, field] of fieldRecords) {
      if (field.needed_by_current_slice !== false && !mappedWireFields.has(fieldId)) {
        out.push(issue('blueprint_contract_mapping_missing', `${base}.mappings`, `当前切片需要的 wire 字段 ${fieldId} 没有显式 mapping/drop。`));
      }
    }
    out.push(...validateSourcedSection(contract.errors, `${base}.errors`, 'error semantics'));
    out.push(...validateSourcedSection(contract.idempotency, `${base}.idempotency`, 'idempotency'));
    out.push(...validateSourcedSection(contract.nfr, `${base}.nfr`, 'NFR'));
    compareAuthoritySection(contract.errors, asRecord(contract.errors)?.source_ref, `${base}.errors`, context, out);
    compareAuthoritySection(contract.idempotency, asRecord(contract.idempotency)?.source_ref, `${base}.idempotency`, context, out);
    compareAuthoritySection(contract.nfr, asRecord(contract.nfr)?.source_ref, `${base}.nfr`, context, out);
    for (const field of ['owner', 'needed_by']) {
      if (!nonEmptyString(contract[field])) out.push(issue('blueprint_contract_semantics_incomplete', `${base}.${field}`, `契约链缺 ${field}。`));
    }
    if (contract.validation_mode === 'wire_domain_same_shape_diff') {
      out.push(issue('blueprint_contract_same_shape_diff_forbidden', `${base}.validation_mode`, '禁止 wire DTO 与领域模型逐字段同形 diff；只能校验显式 mapping/derivation。'));
    }
  });
  return out;
}
