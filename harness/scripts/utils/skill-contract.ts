// ============================================================================
// skill-contract.ts — versioned feature-skill contracts and bounded tier DSL
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { artifactReadCandidatePaths, featureFilePath } from '../../config';
import { listWorkflowPhases, loadWorkflowSpec } from '../../workflow-loader';

export type FeatureTrackName = 'full' | 'lite';

export interface ContractAlternative {
  value: string;
  artifact?: string;
  kind?: 'source' | 'adhoc';
  normalizer?: string;
}

export interface ContractInput {
  id: string;
  artifact?: string;
  kind?: 'source' | 'adhoc';
  alternatives?: ContractAlternative[];
  absent_effect?: string;
  tracks?: FeatureTrackName[];
}

export interface ContractOutput {
  artifact?: string;
  kind?: 'source';
  id?: string;
}

export interface ContractTier {
  when: string;
  satisfies: string[];
}

export interface PhaseContract {
  tracks: FeatureTrackName[];
  inputs: {
    required: ContractInput[];
    optional: ContractInput[];
  };
  produces: ContractOutput[];
  verifies: {
    check: string;
    depth_field: 'summary.depth';
  };
  control_dependencies?: string[];
  tiers: Record<string, ContractTier>;
}

export interface SkillContract {
  schema_version: '1.0';
  skill: string;
  skill_doc: 'SKILL.md';
  phases: Record<string, PhaseContract>;
  source_path: string;
}

export interface ArtifactInventoryEntry {
  id: string;
  schema: string;
  paths: string[];
}

export interface ArtifactInventory {
  schema_version: '1.0';
  artifacts: ArtifactInventoryEntry[];
}

export type TierPredicate =
  | { op: 'present'; id: string }
  | { op: 'alternative'; id: string; value: string }
  | { op: 'all' | 'any'; args: TierPredicate[] }
  | { op: 'not'; arg: TierPredicate };

export interface TierObservation {
  present: Set<string>;
  alternatives: Map<string, string>;
}

export interface TierCombination {
  label: string;
  observation: TierObservation;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[skill-contract] ${label} 必须是 map`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[skill-contract] ${label} 必须是非空字符串`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string')) {
    throw new Error(`[skill-contract] ${label} 必须是非空字符串数组`);
  }
}

function splitArgs(source: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0) throw new Error(`[skill-contract] tier DSL 括号不平衡：${source}`);
    if (ch === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0) throw new Error(`[skill-contract] tier DSL 括号不平衡：${source}`);
  args.push(source.slice(start).trim());
  if (args.some((a) => a === '')) {
    throw new Error(`[skill-contract] tier DSL 含空参数：${source}`);
  }
  return args;
}

/** Parse the finite v1 DSL. `otherwise` is handled by tier selection, not as an expression. */
export function parseTierPredicate(source: string): TierPredicate {
  const text = source.trim();
  const match = /^([a-z]+)\((.*)\)$/.exec(text);
  if (!match) throw new Error(`[skill-contract] 非法 tier predicate：${source}`);
  const op = match[1];
  const args = splitArgs(match[2]);
  if (op === 'present') {
    if (args.length !== 1 || !/^[a-z][a-z0-9_]*$/.test(args[0])) {
      throw new Error(`[skill-contract] present 需要一个 input id：${source}`);
    }
    return { op, id: args[0] };
  }
  if (op === 'alternative') {
    if (
      args.length !== 2 ||
      !/^[a-z][a-z0-9_]*$/.test(args[0]) ||
      !/^[a-z][a-z0-9_-]*$/.test(args[1])
    ) {
      throw new Error(`[skill-contract] alternative 需要 input id 与 value：${source}`);
    }
    return { op, id: args[0], value: args[1] };
  }
  if (op === 'not') {
    if (args.length !== 1) throw new Error(`[skill-contract] not 需要一个表达式：${source}`);
    return { op, arg: parseTierPredicate(args[0]) };
  }
  if (op === 'all' || op === 'any') {
    if (args.length === 0) throw new Error(`[skill-contract] ${op} 至少需要一个表达式：${source}`);
    return { op, args: args.map(parseTierPredicate) };
  }
  throw new Error(`[skill-contract] tier DSL 不支持操作符 "${op}"`);
}

export function evaluateTierPredicate(predicate: TierPredicate, observed: TierObservation): boolean {
  switch (predicate.op) {
    case 'present':
      return observed.present.has(predicate.id);
    case 'alternative':
      return observed.alternatives.get(predicate.id) === predicate.value;
    case 'not':
      return !evaluateTierPredicate(predicate.arg, observed);
    case 'all':
      return predicate.args.every((p) => evaluateTierPredicate(p, observed));
    case 'any':
      return predicate.args.some((p) => evaluateTierPredicate(p, observed));
  }
}

function inputApplies(input: ContractInput, track: FeatureTrackName): boolean {
  return !input.tracks || input.tracks.includes(track);
}

function copyObservation(observation: TierObservation): TierObservation {
  return {
    present: new Set(observation.present),
    alternatives: new Map(observation.alternatives),
  };
}

function expandInput(
  combinations: TierCombination[],
  input: ContractInput,
  required: boolean,
): TierCombination[] {
  const variants: Array<{ suffix: string; apply: (o: TierObservation) => void }> = [];
  if (!required) {
    variants.push({ suffix: `${input.id}=absent`, apply: () => undefined });
  }
  if (input.alternatives) {
    for (const alt of input.alternatives) {
      variants.push({
        suffix: `${input.id}=${alt.value}`,
        apply: (o) => {
          o.present.add(input.id);
          o.alternatives.set(input.id, alt.value);
        },
      });
    }
  } else {
    variants.push({
      suffix: `${input.id}=present`,
      apply: (o) => o.present.add(input.id),
    });
  }
  return combinations.flatMap((combination) =>
    variants.map((variant) => {
      const observation = copyObservation(combination.observation);
      variant.apply(observation);
      return {
        label: combination.label ? `${combination.label},${variant.suffix}` : variant.suffix,
        observation,
      };
    }),
  );
}

/** Enumerate the finite declared-input state space used to prove tier totality/exclusivity. */
export function enumerateTierCombinations(
  phase: PhaseContract,
  track: FeatureTrackName,
): TierCombination[] {
  let combinations: TierCombination[] = [
    { label: '', observation: { present: new Set(), alternatives: new Map() } },
  ];
  for (const input of phase.inputs.required.filter((i) => inputApplies(i, track))) {
    combinations = expandInput(combinations, input, true);
  }
  for (const input of phase.inputs.optional.filter((i) => inputApplies(i, track))) {
    combinations = expandInput(combinations, input, false);
  }
  return combinations;
}

export function selectTier(
  phase: PhaseContract,
  observation: TierObservation,
): string[] {
  const entries = Object.entries(phase.tiers);
  const explicit = entries.filter(([, tier]) => tier.when !== 'otherwise');
  const matches = explicit
    .filter(([, tier]) => evaluateTierPredicate(parseTierPredicate(tier.when), observation))
    .map(([name]) => name);
  if (matches.length > 0) return matches;
  return entries.filter(([, tier]) => tier.when === 'otherwise').map(([name]) => name);
}

function validateInput(raw: unknown, label: string, optional: boolean): ContractInput {
  assertRecord(raw, label);
  assertString(raw.id, `${label}.id`);
  const alternatives = raw.alternatives;
  const representations = [raw.artifact !== undefined, raw.kind !== undefined, alternatives !== undefined]
    .filter(Boolean).length;
  if (representations !== 1) {
    throw new Error(`[skill-contract] ${label} 须且只能声明 artifact、kind、alternatives 之一`);
  }
  if (raw.artifact !== undefined) assertString(raw.artifact, `${label}.artifact`);
  if (raw.kind !== undefined && raw.kind !== 'source' && raw.kind !== 'adhoc') {
    throw new Error(`[skill-contract] ${label}.kind 仅支持 source|adhoc`);
  }
  let parsedAlternatives: ContractAlternative[] | undefined;
  if (alternatives !== undefined) {
    if (!Array.isArray(alternatives) || alternatives.length < 2) {
      throw new Error(`[skill-contract] ${label}.alternatives 至少两个`);
    }
    parsedAlternatives = alternatives.map((alt, index) => {
      assertRecord(alt, `${label}.alternatives[${index}]`);
      assertString(alt.value, `${label}.alternatives[${index}].value`);
      const count = [alt.artifact !== undefined, alt.kind !== undefined].filter(Boolean).length;
      if (count !== 1) {
        throw new Error(`[skill-contract] ${label}.alternatives[${index}] 须且只能声明 artifact 或 kind`);
      }
      if (alt.artifact !== undefined) assertString(alt.artifact, `${label}.alternatives[${index}].artifact`);
      if (alt.kind !== undefined && alt.kind !== 'source' && alt.kind !== 'adhoc') {
        throw new Error(`[skill-contract] ${label}.alternatives[${index}].kind 非法`);
      }
      return alt as unknown as ContractAlternative;
    });
    const values = parsedAlternatives.map((a) => a.value);
    if (new Set(values).size !== values.length) {
      throw new Error(`[skill-contract] ${label}.alternatives.value 重复`);
    }
  }
  if (optional) assertString(raw.absent_effect, `${label}.absent_effect`);
  if (raw.tracks !== undefined) {
    assertStringArray(raw.tracks, `${label}.tracks`);
    if (raw.tracks.some((track) => track !== 'full' && track !== 'lite')) {
      throw new Error(`[skill-contract] ${label}.tracks 仅支持 full|lite`);
    }
  }
  return {
    id: raw.id,
    artifact: raw.artifact as string | undefined,
    kind: raw.kind as 'source' | 'adhoc' | undefined,
    alternatives: parsedAlternatives,
    absent_effect: raw.absent_effect as string | undefined,
    tracks: raw.tracks as FeatureTrackName[] | undefined,
  };
}

function predicateReferences(
  predicate: TierPredicate,
  out: Array<{ op: 'present' | 'alternative'; id: string; value?: string }> = [],
): Array<{ op: 'present' | 'alternative'; id: string; value?: string }> {
  if (predicate.op === 'present') out.push({ op: 'present', id: predicate.id });
  if (predicate.op === 'alternative') {
    out.push({ op: 'alternative', id: predicate.id, value: predicate.value });
  }
  if (predicate.op === 'not') predicateReferences(predicate.arg, out);
  if (predicate.op === 'all' || predicate.op === 'any') {
    predicate.args.forEach((arg) => predicateReferences(arg, out));
  }
  return out;
}

function validatePhase(raw: unknown, label: string): PhaseContract {
  assertRecord(raw, label);
  assertStringArray(raw.tracks, `${label}.tracks`);
  if (raw.tracks.some((track) => track !== 'full' && track !== 'lite')) {
    throw new Error(`[skill-contract] ${label}.tracks 仅支持 full|lite`);
  }
  assertRecord(raw.inputs, `${label}.inputs`);
  if (!Array.isArray(raw.inputs.required) || !Array.isArray(raw.inputs.optional)) {
    throw new Error(`[skill-contract] ${label}.inputs.required/optional 必须是数组`);
  }
  const required = raw.inputs.required.map((input, i) =>
    validateInput(input, `${label}.inputs.required[${i}]`, false),
  );
  const optional = raw.inputs.optional.map((input, i) =>
    validateInput(input, `${label}.inputs.optional[${i}]`, true),
  );
  const ids = [...required, ...optional].map((input) => input.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`[skill-contract] ${label} input id 重复`);
  }

  if (!Array.isArray(raw.produces)) throw new Error(`[skill-contract] ${label}.produces 必须是数组`);
  const produces = raw.produces.map((output, i) => {
    assertRecord(output, `${label}.produces[${i}]`);
    const count = [output.artifact !== undefined, output.kind !== undefined].filter(Boolean).length;
    if (count !== 1) throw new Error(`[skill-contract] ${label}.produces[${i}] 形状非法`);
    if (output.artifact !== undefined) assertString(output.artifact, `${label}.produces[${i}].artifact`);
    if (output.kind !== undefined && (output.kind !== 'source' || typeof output.id !== 'string')) {
      throw new Error(`[skill-contract] ${label}.produces[${i}] source output 缺 id`);
    }
    return output as unknown as ContractOutput;
  });

  assertRecord(raw.verifies, `${label}.verifies`);
  assertString(raw.verifies.check, `${label}.verifies.check`);
  if (raw.verifies.depth_field !== 'summary.depth') {
    throw new Error(`[skill-contract] ${label}.verifies.depth_field 必须为 summary.depth`);
  }
  assertRecord(raw.tiers, `${label}.tiers`);
  const tierEntries = Object.entries(raw.tiers);
  if (tierEntries.length === 0) throw new Error(`[skill-contract] ${label}.tiers 不得为空`);
  const tiers: Record<string, ContractTier> = {};
  let otherwiseCount = 0;
  const inputById = new Map([...required, ...optional].map((input) => [input.id, input]));
  for (const [name, tierRaw] of tierEntries) {
    assertRecord(tierRaw, `${label}.tiers.${name}`);
    assertString(tierRaw.when, `${label}.tiers.${name}.when`);
    assertStringArray(tierRaw.satisfies, `${label}.tiers.${name}.satisfies`);
    if (tierRaw.when === 'otherwise') {
      otherwiseCount += 1;
    } else {
      const predicate = parseTierPredicate(tierRaw.when);
      for (const ref of predicateReferences(predicate)) {
        const input = inputById.get(ref.id);
        if (!input) {
          throw new Error(`[skill-contract] ${label}.tiers.${name} 引用未知 input "${ref.id}"`);
        }
        if (ref.op === 'alternative') {
          if (!input.alternatives?.some((alt) => alt.value === ref.value)) {
            throw new Error(
              `[skill-contract] ${label}.tiers.${name} 引用未知 alternative "${ref.id}:${String(ref.value)}"`,
            );
          }
        }
      }
    }
    tiers[name] = {
      when: tierRaw.when,
      satisfies: [...tierRaw.satisfies],
    };
  }
  if (otherwiseCount !== 1) {
    throw new Error(`[skill-contract] ${label}.tiers 必须且只能有一个 otherwise`);
  }
  for (const [name, tier] of Object.entries(tiers)) {
    if (!tier.satisfies.includes(name)) {
      throw new Error(`[skill-contract] ${label}.tiers.${name}.satisfies 必须包含自身`);
    }
    for (const satisfied of tier.satisfies) {
      if (!(satisfied in tiers)) {
        throw new Error(`[skill-contract] ${label}.tiers.${name}.satisfies 引用未知 tier "${satisfied}"`);
      }
    }
  }
  const controlDependencies = raw.control_dependencies;
  if (
    controlDependencies !== undefined &&
    (!Array.isArray(controlDependencies) || controlDependencies.some((value) => typeof value !== 'string'))
  ) {
    throw new Error(`[skill-contract] ${label}.control_dependencies 必须是字符串数组`);
  }
  const phase: PhaseContract = {
    tracks: [...raw.tracks] as FeatureTrackName[],
    inputs: { required, optional },
    produces,
    verifies: {
      check: raw.verifies.check,
      depth_field: 'summary.depth',
    },
    control_dependencies: controlDependencies as string[] | undefined,
    tiers,
  };
  for (const track of phase.tracks) {
    for (const combination of enumerateTierCombinations(phase, track)) {
      const selected = selectTier(phase, combination.observation);
      if (selected.length !== 1) {
        throw new Error(
          `[skill-contract] ${label} track=${track} tier 非确定（${combination.label || '<empty>'} -> ` +
            `${selected.length === 0 ? 'zero' : selected.join(',')}）`,
        );
      }
    }
  }
  return phase;
}

export function loadSkillContract(filePath: string): SkillContract {
  if (!fs.existsSync(filePath)) throw new Error(`[skill-contract] 未找到 contract：${filePath}`);
  const raw = YAML.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  assertRecord(raw, filePath);
  if (raw.schema_version !== '1.0') {
    throw new Error(`[skill-contract] ${filePath} schema_version 仅支持 1.0`);
  }
  assertString(raw.skill, `${filePath}.skill`);
  if (raw.skill_doc !== 'SKILL.md') {
    throw new Error(`[skill-contract] ${filePath}.skill_doc 必须为 SKILL.md`);
  }
  assertRecord(raw.phases, `${filePath}.phases`);
  const phases: Record<string, PhaseContract> = {};
  for (const [phase, value] of Object.entries(raw.phases)) {
    phases[phase] = validatePhase(value, `${raw.skill}.phases.${phase}`);
  }
  if (Object.keys(phases).length === 0) throw new Error(`[skill-contract] ${filePath}.phases 不得为空`);
  return {
    schema_version: '1.0',
    skill: raw.skill,
    skill_doc: 'SKILL.md',
    phases,
    source_path: filePath,
  };
}

export function loadFeatureContracts(frameworkRoot: string): SkillContract[] {
  const featureRoot = path.join(frameworkRoot, 'skills', 'feature');
  const files = fs.readdirSync(featureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(featureRoot, entry.name, 'contract.yaml'))
    .filter((filePath) => fs.existsSync(filePath))
    .sort();
  const contracts = files.map(loadSkillContract);
  // Contract coverage is reconciled against workflow feature phases, not a hardcoded skill count.
  let workflowPhases: string[];
  try {
    workflowPhases = listWorkflowPhases(loadWorkflowSpec(frameworkRoot, 'spec-driven'))
      .filter((phase) => !['extensions', 'init', 'catalog', 'glossary', 'module-graph', 'docs'].includes(phase));
  } catch (error) {
    throw new Error(`[skill-contract] workflow feature phase 对账失败（BLOCKER）：${(error as Error).message}`);
  }
  const declaredPhases = [...new Set(contracts.flatMap((contract) => Object.keys(contract.phases)))].sort();
  const expectedPhases = [...new Set(workflowPhases)].sort();
  const missing = expectedPhases.filter((phase) => !declaredPhases.includes(phase));
  const extra = declaredPhases.filter((phase) => !expectedPhases.includes(phase));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`[skill-contract] workflow feature phase 覆盖不一致（BLOCKER）：missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`);
  }
  const skills = contracts.map((contract) => contract.skill);
  if (new Set(skills).size !== skills.length) throw new Error('[skill-contract] skill 名重复');
  return contracts;
}

export function phaseContractIndex(contracts: readonly SkillContract[]): Map<string, {
  contract: SkillContract;
  phase: PhaseContract;
}> {
  const index = new Map<string, { contract: SkillContract; phase: PhaseContract }>();
  for (const contract of contracts) {
    for (const [phaseName, phase] of Object.entries(contract.phases)) {
      if (index.has(phaseName)) throw new Error(`[skill-contract] phase "${phaseName}" 被多个 contract 声明`);
      index.set(phaseName, { contract, phase });
    }
  }
  return index;
}

export function loadArtifactInventory(frameworkRoot: string): ArtifactInventory {
  const inventoryPath = path.join(frameworkRoot, 'specs', 'artifact-schemas', 'inventory.yaml');
  const raw = YAML.parse(fs.readFileSync(inventoryPath, 'utf8')) as unknown;
  assertRecord(raw, inventoryPath);
  if (raw.schema_version !== '1.0' || !Array.isArray(raw.artifacts)) {
    throw new Error('[skill-contract] artifact inventory 形状非法');
  }
  const artifacts = raw.artifacts.map((entry, index) => {
    assertRecord(entry, `inventory.artifacts[${index}]`);
    assertString(entry.id, `inventory.artifacts[${index}].id`);
    assertString(entry.schema, `inventory.artifacts[${index}].schema`);
    if (!Array.isArray(entry.paths) || entry.paths.some((value) => typeof value !== 'string')) {
      throw new Error(`[skill-contract] inventory.artifacts[${index}].paths 非法`);
    }
    const schemaPath = path.join(path.dirname(inventoryPath), entry.schema);
    if (!fs.existsSync(schemaPath)) throw new Error(`[skill-contract] artifact schema 不存在：${schemaPath}`);
    const schemaRaw = YAML.parse(fs.readFileSync(schemaPath, 'utf8')) as unknown;
    assertRecord(schemaRaw, schemaPath);
    if (schemaRaw['x-artifact-id'] !== entry.id) {
      throw new Error(`[skill-contract] ${entry.schema} x-artifact-id 与 inventory 不一致`);
    }
    return { id: entry.id, schema: entry.schema, paths: [...entry.paths] } as ArtifactInventoryEntry;
  });
  const ids = artifacts.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('[skill-contract] artifact inventory id 重复');
  return { schema_version: '1.0', artifacts };
}

export function tierSatisfies(
  phase: PhaseContract,
  actual: string,
  required: string,
): boolean {
  const actualTier = phase.tiers[actual];
  if (!actualTier || !phase.tiers[required]) return false;
  return actualTier.satisfies.includes(required);
}

function registeredArtifactExists(
  frameworkRoot: string,
  projectRoot: string,
  feature: string,
  artifactId: string,
): boolean {
  const inventory = loadArtifactInventory(frameworkRoot);
  const registered = inventory.artifacts.find((artifact) => artifact.id === artifactId);
  if (!registered) return false;
  return registered.paths.some((relativePath) => {
    const candidates = artifactReadCandidatePaths(projectRoot, feature, relativePath);
    candidates.push(featureFilePath(projectRoot, feature, relativePath));
    return [...new Set(candidates)].some((candidate) => fs.existsSync(candidate));
  });
}

export interface PhaseQualityResolution {
  depth: string;
  missing_optional_inputs: string[];
  selected_alternatives: Record<string, string>;
}

/**
 * Observe only declared inputs and resolve one contract-local depth. Required input
 * truth is still enforced by phase checkers; this function never converts a missing
 * required artifact into PASS.
 */
export function resolvePhaseQuality(
  frameworkRoot: string,
  projectRoot: string,
  feature: string,
  phaseName: string,
  track: FeatureTrackName,
  adhocAlternatives: ReadonlyMap<string, string> = new Map(),
): PhaseQualityResolution {
  const indexed = phaseContractIndex(loadFeatureContracts(frameworkRoot)).get(phaseName);
  if (!indexed || !indexed.phase.tracks.includes(track)) {
    return { depth: 'not_applicable', missing_optional_inputs: [], selected_alternatives: {} };
  }
  const phase = indexed.phase;
  const observation: TierObservation = { present: new Set(), alternatives: new Map() };
  const optionalIds = new Set(phase.inputs.optional.map((input) => input.id));
  const missingOptionalInputs: string[] = [];
  for (const input of [...phase.inputs.required, ...phase.inputs.optional]) {
    if (!inputApplies(input, track)) continue;
    let present = false;
    if (input.artifact && registeredArtifactExists(frameworkRoot, projectRoot, feature, input.artifact)) {
      observation.present.add(input.id);
      present = true;
    } else if (input.kind === 'source') {
      observation.present.add(input.id);
      present = true;
    } else if (input.kind === 'adhoc') {
      observation.present.add(input.id);
      present = true;
    } else if (input.alternatives) {
      const artifactAlternative = input.alternatives.find(
        (alternative) =>
          alternative.artifact &&
          registeredArtifactExists(frameworkRoot, projectRoot, feature, alternative.artifact),
      );
      const selected =
        artifactAlternative?.value ??
        adhocAlternatives.get(input.id) ??
        (feature === '_adhoc'
          ? input.alternatives.find((alternative) => alternative.kind === 'adhoc')?.value
          : undefined);
      if (selected) {
        observation.present.add(input.id);
        observation.alternatives.set(input.id, selected);
        present = true;
      }
    }
    if (!present && optionalIds.has(input.id)) missingOptionalInputs.push(input.id);
  }
  const selected = selectTier(phase, observation);
  if (selected.length !== 1) {
    throw new Error(
      `[skill-contract] ${phaseName} runtime tier 非确定：${selected.join(',') || 'zero'}`,
    );
  }
  return {
    depth: selected[0],
    missing_optional_inputs: missingOptionalInputs.sort(),
    selected_alternatives: Object.fromEntries(
      [...observation.alternatives.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

export function validateMinimumDepthByPhase(
  frameworkRoot: string,
  minimumDepthByPhase: Record<string, string> | undefined,
  allowedPhaseIds?: ReadonlySet<string>,
): void {
  if (!minimumDepthByPhase) return;
  const index = phaseContractIndex(loadFeatureContracts(frameworkRoot));
  for (const [phaseName, requiredTier] of Object.entries(minimumDepthByPhase)) {
    if (allowedPhaseIds && !allowedPhaseIds.has(phaseName)) {
      throw new Error(`[skill-contract] minimum_depth_by_phase phase 不在 active workflow：${phaseName}`);
    }
    const phase = index.get(phaseName)?.phase;
    if (!phase) {
      throw new Error(`[skill-contract] minimum_depth_by_phase phase 无 contract：${phaseName}`);
    }
    if (!phase.tiers[requiredTier]) {
      throw new Error(
        `[skill-contract] minimum_depth_by_phase.${phaseName} tier 非法：${requiredTier}；` +
        `允许值=[${Object.keys(phase.tiers).sort().join(',')}]`,
      );
    }
  }
}
export function resolvePhaseDepth(
  frameworkRoot: string,
  projectRoot: string,
  feature: string,
  phaseName: string,
  track: FeatureTrackName,
  adhocAlternatives: ReadonlyMap<string, string> = new Map(),
): string {
  return resolvePhaseQuality(
    frameworkRoot, projectRoot, feature, phaseName, track, adhocAlternatives,
  ).depth;
}
