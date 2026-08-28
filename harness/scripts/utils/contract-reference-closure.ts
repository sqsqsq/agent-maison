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
  { kind: 'navigation.main_pages_file', schemaField: 'navigation.main_pages_file' },
  { kind: 'navigation.route_map_file', schemaField: 'navigation.route_map_file' },
  { kind: 'navigation.page_registration_file', schemaField: 'navigation.page_registration_file' },
  { kind: 'navigation.route_registration_file', schemaField: 'navigation.route_registration_file' },
  { kind: 'navigation.page_files', schemaField: 'navigation.page_files[]' },
  { kind: 'navigation.route_files', schemaField: 'navigation.route_files[]' },
  { kind: 'navigation.pages.file', schemaField: 'navigation.pages[].file' },
  { kind: 'navigation.pages.page_file', schemaField: 'navigation.pages[].page_file' },
  { kind: 'navigation.pages.route_file', schemaField: 'navigation.pages[].route_file' },
  { kind: 'navigation.pages.registration_file', schemaField: 'navigation.pages[].registration_file' },
  { kind: 'navigation.routes.file', schemaField: 'navigation.routes[].file' },
  { kind: 'navigation.routes.page_file', schemaField: 'navigation.routes[].page_file' },
  { kind: 'navigation.routes.route_file', schemaField: 'navigation.routes[].route_file' },
  { kind: 'navigation.routes.registration_file', schemaField: 'navigation.routes[].registration_file' },
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

function containsFileLikeValue(value: unknown): boolean {
  if (typeof value === 'string') return FILE_LIKE_VALUE.test(value.trim());
  if (Array.isArray(value)) return value.some(containsFileLikeValue);
  if (isRecord(value)) return Object.values(value).some(containsFileLikeValue);
  return false;
}

export function resolveContractFileReferences(
  projectRoot: string,
  contracts: ContractsSpec,
): ContractReferenceClosure {
  const references: ContractFileReference[] = [];
  const invalidPaths: ContractFileReferenceIssue[] = [];

  const rejectUnconsumedFileFields = (
    record: Record<string, unknown>,
    allowedFields: ReadonlySet<string>,
    source: string,
  ): void => {
    for (const [field, raw] of Object.entries(record)) {
      if (allowedFields.has(field) || !FILE_LIKE_FIELD_NAME.test(field) || !containsFileLikeValue(raw)) {
        continue;
      }
      invalidPaths.push({
        kind: 'unconsumed_file_field',
        source: `${source}.${field}`,
        raw,
        message:
          `${source}.${field} 看起来承载仓库文件路径，但不在 contracts 文件引用清单中；` +
          '请改用受支持字段并在 contracts.files 授权，或先扩展 schema/resolver。',
      });
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

  const navigation = contracts.navigation as unknown;
  if (isRecord(navigation)) {
    rejectUnconsumedFileFields(
      navigation,
      new Set([
        'main_pages_file', 'route_map_file', 'page_registration_file',
        'route_registration_file', 'page_files', 'route_files', 'pages', 'routes',
      ]),
      'navigation',
    );
    add('navigation.main_pages_file', 'navigation.main_pages_file', navigation.main_pages_file);
    add('navigation.route_map_file', 'navigation.route_map_file', navigation.route_map_file);
    add('navigation.page_registration_file', 'navigation.page_registration_file', navigation.page_registration_file);
    add('navigation.route_registration_file', 'navigation.route_registration_file', navigation.route_registration_file);
    addList('navigation.page_files', 'navigation.page_files', navigation.page_files);
    addList('navigation.route_files', 'navigation.route_files', navigation.route_files);
    for (const collection of ['pages', 'routes'] as const) {
      const entries = navigation[collection];
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, index) => {
        if (!isRecord(entry)) return;
        rejectUnconsumedFileFields(
          entry,
          new Set(['name', 'file', 'page_file', 'route_file', 'registration_file']),
          `navigation.${collection}[${index}]`,
        );
        for (const field of ['file', 'page_file', 'route_file', 'registration_file'] as const) {
          add(
            `navigation.${collection}.${field}`,
            `navigation.${collection}[${index}].${field}`,
            entry[field],
          );
        }
      });
    }
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
