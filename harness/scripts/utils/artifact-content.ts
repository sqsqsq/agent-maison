import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { auditSchemaSupport, validateLiteSchema, type LiteSchemaViolation } from './lite-json-schema';

type Row = Record<string, any>;
const row = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

export interface ArtifactContentOptions {
  mode?: 'fragment' | 'complete';
  frameworkRoot?: string;
}
export interface ArtifactContentResult { value: unknown; issues: LiteSchemaViolation[] }

/** A broken framework schema is not an author's malformed artifact. */
export class ArtifactSchemaError extends Error {}

function contentSchema(artifact: string, frameworkRoot: string): Row {
  try {
    const inventory = YAML.parse(fs.readFileSync(path.join(frameworkRoot, 'specs/artifact-schemas/inventory.yaml'), 'utf8'));
    const entry = inventory.artifacts.find((item: Row) => item.id === artifact);
    if (!entry) throw new Error(`unregistered artifact ${artifact}`);
    const schema = artifact === 'ui-spec@1'
      ? JSON.parse(fs.readFileSync(path.join(frameworkRoot, 'harness/schemas/ui-spec.schema.json'), 'utf8'))
      : YAML.parse(fs.readFileSync(path.join(frameworkRoot, 'specs/artifact-schemas', entry.schema), 'utf8'));
    if (!row(schema)) throw new Error('schema root must be an object');
    for (const key of Object.keys(schema)) if (key.startsWith('x-')) delete schema[key];
    const unsupported = auditSchemaSupport(schema);
    if (unsupported.length) throw new Error(JSON.stringify(unsupported));
    const inspectRefs = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (row(node) && typeof node.$ref === 'string' && node.$ref !== '#') {
        const match = node.$ref.match(/^#\/(\$defs|definitions)\/([\w-]+)$/);
        if (!match || !row(schema[match[1]]?.[match[2]])) throw new Error(`unresolved schema $ref: ${node.$ref}`);
      }
      Object.values(node).forEach(inspectRefs);
    };
    inspectRefs(schema);
    return schema;
  } catch (error) { throw new ArtifactSchemaError(`artifact schema ${artifact}: ${String(error)}`); }
}

/** Only the historical branch alias changes names; calls always retain order and duplicates. */
function normalizeUseCases(value: unknown, issues: LiteSchemaViolation[]): void {
  if (!row(value)) return;
  const bindings = (parent: Row, at: string): void => {
    if (!Array.isArray(parent.ui_bindings)) return;
    for (const [i, binding] of parent.ui_bindings.entries()) if (row(binding) && Array.isArray(binding.user_actions)) {
      for (const [j, action] of binding.user_actions.entries()) if (row(action)) {
        if (typeof action.calls === 'string') action.calls = [action.calls.trim()];
        else if (Array.isArray(action.calls)) action.calls = action.calls.map(call => typeof call === 'string' ? call.trim() : call);
        if (!Array.isArray(action.calls) || !action.calls.length || action.calls.some(call => typeof call !== 'string' || !call)) {
          const shape = action.calls === null ? 'null' : Array.isArray(action.calls) ? 'array' : typeof action.calls;
          issues.push({ path: `${at}.ui_bindings[${i}].user_actions[${j}].calls`, message: `calls 必须为非空命名引用或非空字符串列表，实际 ${shape}；最小合法样例：calls: [handleAction]；交 plan/design owner 修订` });
        }
      }
    }
  };
  bindings(value, '$');
  if (!Array.isArray(value.use_cases)) return;
  value.use_cases.forEach((unit: unknown, i: number) => {
    if (!row(unit)) return;
    bindings(unit, `$.use_cases[${i}]`);
    if (!Array.isArray(unit.branches)) return;
    unit.branches.forEach((branch: unknown, j: number) => {
      if (!row(branch) || !Object.prototype.hasOwnProperty.call(branch, 'expected_boundary_calls')) return;
      if (branch.expected_port_calls === undefined) branch.expected_port_calls = branch.expected_boundary_calls;
      else if (JSON.stringify(branch.expected_port_calls) !== JSON.stringify(branch.expected_boundary_calls)) {
        issues.push({ path: `$.use_cases[${i}].branches[${j}]`, message: 'expected_port_calls 与 expected_boundary_calls 冲突；保留原值并交 plan/design owner 修订' });
        return;
      }
      delete branch.expected_boundary_calls;
    });
  });
}

// Invalid values are recorded before this defensive view is produced. Consumers must retain issues.
function safeView(value: unknown, schema: Row, root: Row): unknown {
  if (Array.isArray(schema.anyOf)) {
    const selected = schema.anyOf.find((branch: Row) => validateLiteSchema(value, branch, root).length === 0) ?? schema.anyOf[0];
    return safeView(value, selected, root);
  }
  if (typeof schema.$ref === 'string') {
    const match = schema.$ref.match(/^#\/(\$defs|definitions)\/([\w-]+)$/);
    return match ? safeView(value, root[match[1]][match[2]], root) : value;
  }
  if (Array.isArray(schema.type) && schema.type.includes('array')) {
    return value === null && schema.type.includes('null') ? null : safeView(value, { ...schema, type: 'array' }, root);
  }
  if (schema.type === 'array') return Array.isArray(value)
    ? value.filter(item => schema.items?.type !== 'string' || typeof item === 'string' && (!schema.items.minLength || item.trim().length >= schema.items.minLength))
      .map(item => schema.items ? safeView(item, schema.items, root) : item).filter(item => item !== undefined) : [];
  if (schema.type === 'string' && typeof value !== 'string') return '';
  if (schema.type === 'object') {
    if (!row(value)) return undefined;
    for (const [key, child] of Object.entries(value)) {
      const sub = schema.properties?.[key] ?? (row(schema.additionalProperties) ? schema.additionalProperties : undefined);
      if (sub) value[key] = safeView(child, sub, root);
    }
  }
  return value;
}

/** Shared content boundary. Never writes source bytes or changes identity/authorization. */
export function resolveArtifactContent(artifact: string, raw: unknown, options: ArtifactContentOptions = {}): ArtifactContentResult {
  const schema = contentSchema(artifact, options.frameworkRoot ?? path.resolve(__dirname, '../../..'));
  if (options.mode === 'fragment') {
    delete schema.required;
    for (const sub of Object.values(schema.properties ?? {}) as Row[]) if (sub.type === 'array') sub.type = ['array', 'null'];
  }
  const issues: LiteSchemaViolation[] = [];
  const value = structuredClone(raw);
  if (artifact === 'use-cases@1') normalizeUseCases(value, issues);
  if (artifact === 'ref-elements@1' && row(value) && Array.isArray(value.elements)) {
    for (const element of value.elements) if (row(element) && element.disposition !== 'defer' && element.disposition !== 'excluded') element.disposition = 'implement';
  }
  for (const issue of validateLiteSchema(value, schema)) {
    if (issues.some(existing => existing.path === issue.path)) continue;
    if (/\.(coordinator|ui|trigger)$/.test(issue.path)) issue.message += '；最小合法样例：非空字符串 "name"；交 plan/design owner 修订';
    issues.push(issue);
  }
  return { value: safeView(value, schema, schema), issues };
}
