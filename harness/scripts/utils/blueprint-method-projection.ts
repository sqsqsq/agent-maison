import { stableAddressIndex } from './blueprint-addressing';
import { asRecord, asRecords, issue, nonEmptyString, type BlueprintIssue, type BlueprintRecord } from './component-blueprint-model';
import { stableJson } from './blueprint-discovery';
import type { DesignAuthorityLocation } from './blueprint-skill-projection';

interface BlueprintMethod {
  ref: string;
  owner: string;
  file: unknown;
  method: BlueprintRecord;
  authoritative: boolean;
  location: DesignAuthorityLocation;
}

export interface BlueprintMethodIssue {
  message: string;
  locations: DesignAuthorityLocation[];
}

/** Existing interface address followed by the method symbol. Old prose steps remain readable. */
export function isBlueprintMethodRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('interface:') && value.includes('#');
}

export function blueprintMethodRef(address: string, owner: string, method: string): string {
  return `interface:${address}/${owner}#${method}`;
}

export function blueprintMethodProjection(blueprint: BlueprintRecord) {
  const index = stableAddressIndex(blueprint);
  const blueprintId = String(blueprint.blueprint_id ?? '');
  const location = (address: string, field: string): DesignAuthorityLocation => {
    const view = /^view:([^/]+)\/(node|flow):(.+)$/.exec(address);
    const [kind, ...id] = address.split(':');
    return { blueprint_id: blueprintId, target: view ? { kind: view[2], view_id: view[1], id: view[3] } : { kind, id: id.join(':') }, field };
  };
  const declared: BlueprintMethod[] = [...index].flatMap(([address, target]) =>
    asRecords(asRecord(target.contracts)?.interfaces).flatMap((api, apiIndex) => !nonEmptyString(api.class) ? [] :
      asRecords(api.methods).flatMap((method, methodIndex) => !nonEmptyString(method.name) ? [] : [{
        ref: blueprintMethodRef(address, String(api.class), method.name),
        owner: String(api.class),
        file: api.file,
        method,
        authoritative: asRecord(target.provenance)?.evidence_strength === 'authoritative',
        location: location(address, `contracts.interfaces[${apiIndex}].methods[${methodIndex}]`),
      }])));
  const methods = declared.filter(method => method.authoritative && nonEmptyString(method.method.return));
  const owners = new Set(methods.map(method => method.owner));

  const resolve = (ref: string, at: DesignAuthorityLocation, report: (issue: BlueprintMethodIssue) => void, owner?: unknown): BlueprintMethod | undefined => {
    const exact = isBlueprintMethodRef(ref);
    const matches = methods.filter(candidate => exact ? candidate.ref === ref : candidate.owner === owner && candidate.method.name === ref);
    const distinct = new Set(matches.map(candidate => stableJson([candidate.owner, candidate.file, candidate.method.name,
      candidate.method.params, candidate.method.return, candidate.method.async])));
    if (matches.length === 1 || !exact && distinct.size === 1) return matches[0];
    if (!exact && !matches.length) return;
    const sources = matches.length ? matches : declared.filter(candidate => candidate.ref === ref);
    const reason = matches.length ? '存在多个定义，请给出唯一节点/接口/方法引用'
      : !sources.length ? '不存在'
      : sources.some(source => source.authoritative) ? '缺少 typed 返回类型' : '已有声明，缺少获准来源';
    report({ message: `方法 ${ref} ${reason}`, locations: [at, ...sources.map(candidate => candidate.location)] });
  };

  const expand = (target: BlueprintRecord, address: string, report: (issue: BlueprintMethodIssue) => void): void => {
    const steps = (value: BlueprintRecord, field: string): void => {
      if (!Array.isArray(value.ordered_steps)) return;
      value.ordered_steps = value.ordered_steps.map((step: unknown, i) => {
        if (!isBlueprintMethodRef(step)) return step;
        const definition = resolve(step, location(address, `${field}ordered_steps[${i}]`), report);
        if (!definition) return step;
        const params = asRecords(definition.method.params).map(param => `${String(param.name)}: ${String(param.type)}`);
        return `${definition.owner}.${String(definition.method.name)}(${params.join(', ')}): ${String(definition.method.return)}`;
      });
    };
    steps(target, '');
    for (const [index, state] of asRecords(asRecord(target.contracts)?.state_management).entries()) steps(state, `contracts.state_management[${index}].`);
    for (const [useCaseIndex, useCase] of asRecords(asRecord(target.use_cases)?.use_cases).entries()) {
      for (const [boundaryIndex, boundary] of asRecords(useCase.data_boundaries).entries()) {
        if (!Array.isArray(boundary.methods)) continue;
        const owner = owners.has(String(boundary.type)) ? boundary.type : boundary.name;
        boundary.methods = boundary.methods.map((row: unknown, methodIndex) => {
          const old = asRecord(row);
          const ref = typeof row === 'string' ? row : old?.name;
          if (!nonEmptyString(ref)) return row;
          const field = `use_cases.use_cases[${useCaseIndex}].data_boundaries[${boundaryIndex}].methods[${methodIndex}]`;
          const definition = resolve(ref, location(address, field), report, owner);
          if (!definition) return row;
          const projected: BlueprintRecord = { ...old, name: definition.method.name };
          for (const [output, source] of [['params', 'params'], ['returns', 'return'], ['async', 'async']] as const) {
            const expected = definition.method[source];
            if (expected === undefined) continue;
            const authored = old?.[output];
            if (output === 'params' && Array.isArray(authored) && Array.isArray(expected)
              && stableJson(authored) === stableJson(asRecords(expected).map(param => param.type))) continue;
            // Older use cases name the resolved value of an explicitly async method.
            if (output === 'returns' && old?.async === true && definition.method.async === true
              && nonEmptyString(authored) && !/^Promise\s*</.test(authored.trim()) && typeof expected === 'string'
              && /^Promise\s*<\s*([\s\S]+?)\s*>$/.exec(expected.trim())?.[1] === authored.trim()) continue;
            if (old?.[output] !== undefined && stableJson(old[output]) !== stableJson(expected)) {
              report({ message: `${definition.ref}: ${output} 显式声明 ${JSON.stringify(old[output])} 与接口定义 ${JSON.stringify(expected)} 冲突`,
                locations: [location(address, `${field}.${output}`), { ...definition.location, field: `${definition.location.field}.${source}` }] });
            } else projected[output] = structuredClone(expected);
          }
          return projected;
        });
      }
    }
  };
  return { index, expand };
}

export function validateBlueprintMethodProjection(blueprint: BlueprintRecord): BlueprintIssue[] {
  let projection: ReturnType<typeof blueprintMethodProjection>;
  try { projection = blueprintMethodProjection(blueprint); }
  catch { return []; } // Existing stable-address validation reports the ambiguous declaration.
  const issues: BlueprintIssue[] = [];
  for (const [address, source] of projection.index) {
    if (source.ordered_steps === undefined && source.use_cases === undefined && asRecord(source.contracts)?.state_management === undefined) continue;
    projection.expand(structuredClone(source), address, finding => {
      const locations = finding.locations.map(({ target, field }) =>
        `${target.view_id ? `view:${target.view_id}/` : ''}${target.kind}:${target.id}.${field}`);
      issues.push(issue('blueprint_content_incomplete', locations[0], `${finding.message}（${locations.join(' ↔ ')}）`));
    });
  }
  return issues;
}
