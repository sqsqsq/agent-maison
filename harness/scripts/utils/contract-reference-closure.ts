import * as path from 'path';

import type {
  ContractFileReference,
  ContractFileReferenceIssue,
  ContractFileReferenceKind,
  ContractReferenceClosure,
  ContractsSpec,
} from './types';
import { validateProjectRelativePath } from './project-relative-path';

/**
 * Explicit inventory of file-bearing contracts fields. Tests pin this list so adding a typed
 * field cannot silently fall back to a generic "looks like a path" scan.
 */
export const CONTRACT_FILE_REFERENCE_FIELDS: ReadonlyArray<{
  kind: ContractFileReferenceKind;
  schemaField: string;
}> = [
  { kind: 'modules.har_index', schemaField: 'modules[].har_index' },
  { kind: 'modules.builder', schemaField: 'modules[].builder' },
  { kind: 'modules.export_file', schemaField: 'modules[].export_file' },
  { kind: 'modules.export_files', schemaField: 'modules[].export_files[]' },
  { kind: 'data_models.file', schemaField: 'data_models[].file' },
  { kind: 'interfaces.file', schemaField: 'interfaces[].file' },
  { kind: 'components.file', schemaField: 'components[].file' },
  { kind: 'resource_keys.path', schemaField: 'resource_keys.<module>.<category>[].path' },
  { kind: 'resource_keys.media', schemaField: 'resource_keys.<module>.<category>[].media' },
  { kind: 'navigation.config_files', schemaField: 'navigation.config_files[]' },
  { kind: 'prd_to_code_traceability.key_files', schemaField: 'prd_to_code_traceability[].key_files[]' },
] as const;

export const CONTRACT_FILE_REFERENCE_KINDS: readonly ContractFileReferenceKind[] =
  CONTRACT_FILE_REFERENCE_FIELDS.map(field => field.kind);

export function normalizeContractFilePath(
  projectRoot: string,
  raw: string,
  label: string,
): string {
  const safe = validateProjectRelativePath(projectRoot, raw.trim(), label);
  return path.posix.normalize(safe);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const FILE_LIKE_FIELD_NAME = /(?:^|_)(?:file|files|path|paths|media|builder|index|map|registration|export|exports)(?:$|_)/i;
const FILE_LIKE_VALUE = /(?:[\\/]|\.[a-z0-9]{1,12}$)/i;

/**
 * 值侧的 file-like 判定（review 二轮 P1：与外层扫描同款迭代 + 防环）。
 *
 * 外层拒绝扫描改成工作栈后，这里仍是无环检测的递归——YAML 锚点做出的自引用
 * （`registration_points: &p [ {self: *p}, {file: …} ]`）会在此爆 RangeError；而闭环在
 * SpecLoader 装载期直接执行，异常会打断整个装载，连结构化的 `unconsumed_file_field`
 * 都产不出来。终止必须靠已访问集合收敛，且要覆盖拒绝路径上的**每一段**遍历。
 */
function containsFileLikeValue(value: unknown): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      if (FILE_LIKE_VALUE.test(current.trim())) return true;
      continue;
    }
    if (Array.isArray(current)) {
      if (seen.has(current)) continue;
      seen.add(current);
      for (const item of current) stack.push(item);
      continue;
    }
    if (isRecord(current)) {
      if (seen.has(current)) continue;
      seen.add(current);
      for (const item of Object.values(current)) stack.push(item);
    }
  }
  return false;
}

export function resolveContractFileReferences(
  projectRoot: string,
  contracts: ContractsSpec,
): ContractReferenceClosure {
  const references: ContractFileReference[] = [];
  const invalidPaths: ContractFileReferenceIssue[] = [];

  const pushUnconsumed = (source: string, raw: unknown): void => {
    invalidPaths.push({
      kind: 'unconsumed_file_field',
      source,
      raw,
      message:
        `${source} 看起来承载仓库文件路径，但不在 contracts 文件引用清单中；` +
        '请改用受支持字段并在 contracts.files 授权，或先扩展 schema/resolver。',
    });
  };

  /**
   * 未知**嵌套**子项的拒绝扫描（plan c7e2a9d4 T1）。
   *
   * 现拒绝条件要求「字段名本身」命中 file-like 正则；裁撤 navigation.pages[]/routes[] 的
   * 专用遍历后，`navigation.routes[].file` 会因外层 key `routes` 不命中而静默 fail-open。
   * 因此：外层字段名未命中 file-like 且值为 object/array 时，向下递归**只做拒绝检测**——
   * 命中 file-like 子键 + file-like 值即报 `unconsumed_file_field`（source 带完整路径）。
   * 刻意不做正向引用解析：遍历不产生 references，不授权任何路径。
   *
   * **无深度截断**（review P1）：任意深度截断本身就是 fail-open——把 file 埋得够深即可
   * 静默过关。改用显式工作栈迭代（不吃调用栈）+ 已访问集合防环，遍历到自然收敛为止。
   */
  const scanNestedUnknownFileFields = (rootValue: unknown, rootSource: string): void => {
    const seen = new Set<object>();
    const stack: Array<{ value: unknown; source: string }> = [{ value: rootValue, source: rootSource }];
    while (stack.length > 0) {
      const { value, source } = stack.pop()!;
      if (Array.isArray(value)) {
        if (seen.has(value)) continue;
        seen.add(value);
        value.forEach((item, index) => stack.push({ value: item, source: `${source}[${index}]` }));
        continue;
      }
      if (!isRecord(value) || seen.has(value)) continue;
      seen.add(value);
      for (const [field, raw] of Object.entries(value)) {
        if (FILE_LIKE_FIELD_NAME.test(field)) {
          if (containsFileLikeValue(raw)) pushUnconsumed(`${source}.${field}`, raw);
          continue;
        }
        stack.push({ value: raw, source: `${source}.${field}` });
      }
    }
  };

  const rejectUnconsumedFileFields = (
    record: Record<string, unknown>,
    allowedFields: ReadonlySet<string>,
    source: string,
  ): void => {
    for (const [field, raw] of Object.entries(record)) {
      if (allowedFields.has(field)) continue;
      if (FILE_LIKE_FIELD_NAME.test(field)) {
        if (containsFileLikeValue(raw)) pushUnconsumed(`${source}.${field}`, raw);
        continue;
      }
      // 字段名未命中 file-like：结构化值仍可能藏着 file-like 子项（嵌套逃逸），向下扫。
      scanNestedUnknownFileFields(raw, `${source}.${field}`);
    }
  };

  const add = (kind: ContractFileReferenceKind, source: string, raw: unknown): void => {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'string' || !raw.trim()) {
      invalidPaths.push({
        kind,
        source,
        raw,
        message: `${source} 必须是非空的 project-root 相对文件路径`,
      });
      return;
    }
    try {
      references.push({
        path: normalizeContractFilePath(projectRoot, raw, source),
        kind,
        source,
      });
    } catch (error) {
      invalidPaths.push({
        kind,
        source,
        raw,
        message: (error as Error).message,
      });
    }
  };

  const addList = (kind: ContractFileReferenceKind, source: string, raw: unknown): void => {
    if (raw === undefined || raw === null) return;
    if (!Array.isArray(raw)) {
      invalidPaths.push({
        kind,
        source,
        raw,
        message: `${source} 必须是文件路径数组`,
      });
      return;
    }
    raw.forEach((item, index) => add(kind, `${source}[${index}]`, item));
  };

  const authorizedFiles: string[] = [];
  (contracts.files ?? []).forEach((raw, index) => {
    const source = `contracts.files[${index}]`;
    if (typeof raw !== 'string' || !raw.trim()) {
      invalidPaths.push({
        kind: 'contracts.files',
        source,
        raw,
        message: `${source} 必须是非空的 project-root 相对文件路径`,
      });
      return;
    }
    try {
      authorizedFiles.push(normalizeContractFilePath(projectRoot, raw, source));
    } catch (error) {
      invalidPaths.push({
        kind: 'contracts.files',
        source,
        raw,
        message: (error as Error).message,
      });
    }
  });

  (contracts.modules ?? []).forEach((module, index) => {
    const raw = module as unknown as Record<string, unknown>;
    rejectUnconsumedFileFields(
      raw,
      new Set([
        'name', 'layer', 'format', 'change_type', 'package_path',
        'har_index', 'builder', 'export_file', 'export_files',
      ]),
      `modules[${index}]`,
    );
    add('modules.har_index', `modules[${index}].har_index`, raw.har_index);
    add('modules.builder', `modules[${index}].builder`, raw.builder);
    add('modules.export_file', `modules[${index}].export_file`, raw.export_file);
    addList('modules.export_files', `modules[${index}].export_files`, raw.export_files);
  });

  (contracts.data_models ?? []).forEach((model, index) => {
    rejectUnconsumedFileFields(
      model as unknown as Record<string, unknown>,
      new Set(['name', 'module', 'file', 'kind', 'fields', 'computed_properties', 'values']),
      `data_models[${index}]`,
    );
    add('data_models.file', `data_models[${index}].file`, model.file);
  });
  (contracts.interfaces ?? []).forEach((item, index) => {
    rejectUnconsumedFileFields(
      item as unknown as Record<string, unknown>,
      new Set(['module', 'layer', 'file', 'class', 'methods']),
      `interfaces[${index}]`,
    );
    add('interfaces.file', `interfaces[${index}].file`, item.file);
  });
  (contracts.components ?? []).forEach((component, index) => {
    rejectUnconsumedFileFields(
      component as unknown as Record<string, unknown>,
      new Set([
        'name', 'module', 'file', 'kind', 'decorator', 'linked_functions', 'state', 'props',
        'events', 'children', 'nav_destinations', 'nav_destination', 'description',
      ]),
      `components[${index}]`,
    );
    add('components.file', `components[${index}].file`, component.file);
  });

  const resourceKeys = contracts.resource_keys as unknown;
  if (isRecord(resourceKeys)) {
    for (const [moduleName, categories] of Object.entries(resourceKeys)) {
      if (!isRecord(categories)) continue;
      for (const [categoryName, entries] of Object.entries(categories)) {
        if (!Array.isArray(entries)) continue;
        entries.forEach((entry, index) => {
          if (!isRecord(entry)) return;
          const base = `resource_keys.${moduleName}.${categoryName}[${index}]`;
          rejectUnconsumedFileFields(
            entry,
            new Set(['key', 'value', 'description', 'path', 'media']),
            base,
          );
          add('resource_keys.path', `${base}.path`, entry.path);
          if (Array.isArray(entry.media)) {
            addList('resource_keys.media', `${base}.media`, entry.media);
          } else {
            add('resource_keys.media', `${base}.media`, entry.media);
          }
        });
      }
    }
  }

  // 3.0 canonical navigation：唯一字段 config_files（由真实消费者 page_registration 塑形）。
  // 旧的推测性同义字段（*_file / page_files / route_files / pages[] / routes[]）零消费者，
  // 已裁撤——它们连同其嵌套形态一律按未知 file-like 字段 fail-closed。
  const navigation = contracts.navigation as unknown;
  if (isRecord(navigation)) {
    rejectUnconsumedFileFields(navigation, new Set(['config_files']), 'navigation');
    addList('navigation.config_files', 'navigation.config_files', navigation.config_files);
  }

  (contracts.prd_to_code_traceability ?? []).forEach((trace, index) => {
    rejectUnconsumedFileFields(
      trace as unknown as Record<string, unknown>,
      new Set(['prd_id', 'priority', 'key_files']),
      `prd_to_code_traceability[${index}]`,
    );
    addList(
      'prd_to_code_traceability.key_files',
      `prd_to_code_traceability[${index}].key_files`,
      trace.key_files,
    );
  });

  (contracts.integration_points ?? []).forEach((point, index) => {
    rejectUnconsumedFileFields(
      point as unknown as Record<string, unknown>,
      new Set(['consumer_module', 'provider_module', 'requires_modification', 'entry_symbol']),
      `integration_points[${index}]`,
    );
  });
  (contracts.state_management ?? []).forEach((state, index) => {
    rejectUnconsumedFileFields(
      state as unknown as Record<string, unknown>,
      new Set(['data', 'scope', 'decorator', 'holder', 'module']),
      `state_management[${index}]`,
    );
  });
  rejectUnconsumedFileFields(
    contracts as unknown as Record<string, unknown>,
    new Set([
      'schema_version', 'feature', 'source', 'version', 'modules', 'module_dependencies',
      'data_models', 'interfaces', 'components', 'files', 'resource_keys', 'integration_points',
      'prd_to_code_traceability', 'state_management', 'navigation',
    ]),
    'contracts',
  );

  return {
    authorized_files: [...new Set(authorizedFiles)].sort(),
    references: references.sort((a, b) =>
      a.path.localeCompare(b.path) || a.source.localeCompare(b.source) || a.kind.localeCompare(b.kind)),
    invalid_paths: invalidPaths.sort((a, b) => a.source.localeCompare(b.source)),
  };
}

/**
 * 纯 selector（plan c7e2a9d4 T2）：从既有 `references[]` 即时筛选指定 kind 的规范化路径。
 *
 * 下游消费者（如 profiles/hmos-app 的 `page_registration`）**只能**经此消费统一解析产出，
 * 不得裸读 `contracts.navigation` 原始字段。函数无状态、不做 I/O，也不在
 * `ContractReferenceClosure` 内额外存第二份路径投影。
 */
export function selectContractReferencePaths(
  closure: ContractReferenceClosure | undefined,
  kind: ContractFileReferenceKind,
): string[] {
  if (!closure) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const reference of closure.references) {
    if (reference.kind !== kind || seen.has(reference.path)) continue;
    seen.add(reference.path);
    out.push(reference.path);
  }
  return out;
}

export interface ContractReferenceClosureViolation {
  path: string;
  sources: Array<{ kind: ContractFileReferenceKind; source: string }>;
}

export function findUnauthorizedContractFileReferences(
  closure: ContractReferenceClosure,
): ContractReferenceClosureViolation[] {
  const authorized = new Set(closure.authorized_files);
  const byPath = new Map<string, ContractReferenceClosureViolation>();
  for (const reference of closure.references) {
    if (authorized.has(reference.path)) continue;
    const current = byPath.get(reference.path) ?? { path: reference.path, sources: [] };
    current.sources.push({ kind: reference.kind, source: reference.source });
    byPath.set(reference.path, current);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
