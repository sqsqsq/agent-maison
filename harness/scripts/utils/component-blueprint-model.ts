import * as fs from 'fs';
import * as path from 'path';

export const BLUEPRINT_SCHEMA = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../schemas/app-component-blueprint.schema.json'), 'utf8')) as Record<string, any>;

export type BlueprintSeverity = 'BLOCKER' | 'WARN';

export interface BlueprintIssue {
  id: string;
  severity: BlueprintSeverity;
  path: string;
  message: string;
}

export type BlueprintRecord = Record<string, unknown>;

export const BLUEPRINT_ARTIFACT = 'component-blueprint@1' as const;
export const VIEW_IDS = ['logical', 'runtime', 'development', 'deployment', 'scenarios'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const DISPOSITIONS = [
  'answered_with_evidence',
  'decided_with_authority',
  'open_decision',
  'blocker',
  'not_applicable',
] as const;

export const BLUEPRINT_TARGET_KINDS = [
  'blueprint',
  'view',
  'node',
  'relation',
  'flow',
  'decision',
  'contract',
] as const;
export type BlueprintTargetKind = (typeof BLUEPRINT_TARGET_KINDS)[number];

export interface ComponentBlueprintRef {
  artifact: typeof BLUEPRINT_ARTIFACT;
  component_id: string;
  blueprint_id: string;
  revision: number;
  source_fingerprint: string;
  artifact_sha256: string;
  target: {
    kind: BlueprintTargetKind;
    id: string;
    view_id?: string;
  };
}

export interface ResolvedBlueprintTarget {
  canonicalPath: string;
  blueprint: BlueprintRecord;
  target: unknown;
  ref: ComponentBlueprintRef;
}

export class ComponentBlueprintResolutionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ComponentBlueprintResolutionError';
  }
}

export function isRecord(value: unknown): value is BlueprintRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asRecord(value: unknown): BlueprintRecord | undefined {
  return isRecord(value) ? value : undefined;
}

export function asRecords(value: unknown): BlueprintRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function issue(id: string, path: string, message: string, severity: BlueprintSeverity = 'BLOCKER'): BlueprintIssue {
  return { id, severity, path, message };
}

export function getId(record: BlueprintRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (nonEmptyString(record[key])) return record[key].trim();
  }
  return undefined;
}

export function findById(items: unknown, id: string, ...keys: string[]): BlueprintRecord | undefined {
  return asRecords(items).find(item => getId(item, ...keys) === id);
}

export function hasOwn(record: BlueprintRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

/** Schema-owned machine fields are excluded; business provenance remains part of the design. */
export function blueprintAuthorContent(blueprint: BlueprintRecord, includeQuestioning = false, progressOnly = false): BlueprintRecord {
  const copy = structuredClone(blueprint);
  const strip = (record: BlueprintRecord | undefined, properties: Record<string, any>): void => {
    if (!record) return;
    for (const [key, field] of Object.entries(properties)) {
      if (field.readOnly === true || progressOnly && field['x-progress'] === false) delete record[key];
    }
  };
  strip(copy, BLUEPRINT_SCHEMA.properties);
  strip(asRecord(copy.discovery), BLUEPRINT_SCHEMA.properties.discovery.properties);
  const review = asRecord(copy.review_summary);
  strip(review, BLUEPRINT_SCHEMA.properties.review_summary.properties);
  if (review) {
    if (!includeQuestioning) delete review.questioning;
    else {
      const questioning = asRecord(review.questioning);
      strip(questioning, BLUEPRINT_SCHEMA.$defs.questioning.properties);
      for (const item of asRecords(questioning?.items)) strip(item, BLUEPRINT_SCHEMA.$defs.questioningItem.properties);
    }
    if (!Object.keys(review).length) delete copy.review_summary;
  }
  {
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const record = asRecord(value);
      if (!record) return;
      const provenance = asRecord(record.provenance);
      if (provenance) for (const [key, field] of Object.entries(BLUEPRINT_SCHEMA.$defs.provenance.properties) as Array<[string, Record<string, unknown>]>) {
        if (field['x-progress'] === false) delete provenance[key];
      }
      Object.values(record).forEach(visit);
    };
    visit(copy);
  }
  return copy;
}

export function renderBlueprintFieldResponsibilities(): string {
  const fields = BLUEPRINT_SCHEMA.properties;
  return `机器维护技术编号、${Object.keys(fields).filter(key => fields[key].readOnly).join('、')}、discovery.source_fingerprint、review_summary.admission整块及质询身份外壳/question_id。作者负责适用性、业务scope/gap、契约、设计取舍、验收和业务provenance；Q只交实质items，不自报调用事实。`;
}
