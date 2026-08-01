// ============================================================================
// skill-contract.ts — versioned feature-skill contracts (capability model)
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { listWorkflowPhases, loadWorkflowSpec } from '../../workflow-loader';
import type { AxisId } from './quality-axes';

export type FeatureTrackName = 'full' | 'lite';
export type Assurance = 'blocked' | 'degraded' | 'full';
export type MinimumAssurance = Exclude<Assurance, 'blocked'>;

export const ASSURANCE_RANK: Readonly<Record<Assurance, number>> = {
  blocked: 0,
  degraded: 1,
  full: 2,
};

export const DERIVE_PROVIDER_IDS = [
  'derive.codebase',
  'derive.requirement',
  'derive.test-targets',
  'derive.adhoc-cases',
] as const;
export type DeriveProviderId = typeof DERIVE_PROVIDER_IDS[number];

export const APPLICABILITY_PROVIDER_IDS = [
  'applicability.always',
  'applicability.ui',
] as const;
export type ApplicabilityProviderId = typeof APPLICABILITY_PROVIDER_IDS[number];

export type ContractInputSource =
  | { kind: 'artifact'; artifact: string }
  | { kind: 'derive'; provider_id: DeriveProviderId };

/** Input catalog only: it contains sources, never required/optional policy. */
export interface ContractInput {
  id: string;
  sources: ContractInputSource[];
}

export interface ContractCapability {
  /** Bound 1:1 to the synthetic or migrated CheckResult id. */
  id: string;
  axis: AxisId;
  inputs: string[];
  tracks: FeatureTrackName[];
  applicability_provider_id?: ApplicabilityProviderId;
  on_missing: 'prune' | 'fail';
}

export interface ContractOutput {
  artifact?: string;
  kind?: 'source';
  id?: string;
}

export interface PhaseContract {
  tracks: FeatureTrackName[];
  inputs: ContractInput[];
  capabilities: ContractCapability[];
  produces: ContractOutput[];
  verifies: { check: string };
  control_dependencies?: string[];
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

function assertStringArray(value: unknown, label: string, allowEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`[skill-contract] ${label} 必须是${allowEmpty ? '' : '非空'}字符串数组`);
  }
}

function validateTracks(value: unknown, label: string): FeatureTrackName[] {
  assertStringArray(value, label);
  if (value.some((track) => track !== 'full' && track !== 'lite')) {
    throw new Error(`[skill-contract] ${label} 仅支持 full|lite`);
  }
  if (new Set(value).size !== value.length) throw new Error(`[skill-contract] ${label} 不得重复`);
  return [...value] as FeatureTrackName[];
}

function validId(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(value);
}

function validArtifact(value: string): boolean {
  return /^[a-z][a-z0-9-]*@[1-9][0-9]*$/.test(value);
}

function validateInputSource(raw: unknown, label: string): ContractInputSource {
  assertRecord(raw, label);
  if (raw.kind === 'artifact') {
    assertString(raw.artifact, `${label}.artifact`);
    if (!validArtifact(raw.artifact)) throw new Error(`[skill-contract] ${label}.artifact 格式非法`);
    const keys = Object.keys(raw);
    if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('artifact')) {
      throw new Error(`[skill-contract] ${label} artifact source 仅允许 kind/artifact`);
    }
    return { kind: 'artifact', artifact: raw.artifact };
  }
  if (raw.kind === 'derive') {
    assertString(raw.provider_id, `${label}.provider_id`);
    if (!(DERIVE_PROVIDER_IDS as readonly string[]).includes(raw.provider_id)) {
      throw new Error(`[skill-contract] ${label}.provider_id 未注册：${raw.provider_id}`);
    }
    const keys = Object.keys(raw);
    if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('provider_id')) {
      throw new Error(`[skill-contract] ${label} derive source 仅允许 kind/provider_id`);
    }
    return { kind: 'derive', provider_id: raw.provider_id as DeriveProviderId };
  }
  throw new Error(`[skill-contract] ${label}.kind 仅支持 artifact|derive`);
}

function validateInput(raw: unknown, label: string): ContractInput {
  assertRecord(raw, label);
  assertString(raw.id, `${label}.id`);
  if (!validId(raw.id)) throw new Error(`[skill-contract] ${label}.id 格式非法`);
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new Error(`[skill-contract] ${label}.sources 必须为非空数组`);
  }
  const sources = raw.sources.map((source, index) => validateInputSource(source, `${label}.sources[${index}]`));
  return { id: raw.id, sources };
}

function validateCapability(raw: unknown, label: string, phaseTracks: readonly FeatureTrackName[], inputIds: ReadonlySet<string>): ContractCapability {
  assertRecord(raw, label);
  assertString(raw.id, `${label}.id`);
  if (!validId(raw.id)) throw new Error(`[skill-contract] ${label}.id 格式非法`);
  if (raw.axis !== 'functional' && raw.axis !== 'visual' && raw.axis !== 'asset' && raw.axis !== 'evidence') {
    throw new Error(`[skill-contract] ${label}.axis 仅支持 functional|visual|asset|evidence`);
  }
  assertStringArray(raw.inputs, `${label}.inputs`);
  if (new Set(raw.inputs).size !== raw.inputs.length) throw new Error(`[skill-contract] ${label}.inputs 不得重复`);
  for (const inputId of raw.inputs) {
    if (!inputIds.has(inputId)) throw new Error(`[skill-contract] ${label}.inputs 引用未知 input "${inputId}"`);
  }
  const tracks = validateTracks(raw.tracks, `${label}.tracks`);
  if (tracks.some((track) => !phaseTracks.includes(track))) {
    throw new Error(`[skill-contract] ${label}.tracks 必须是 phase tracks 子集`);
  }
  if (raw.applicability_provider_id !== undefined) {
    assertString(raw.applicability_provider_id, `${label}.applicability_provider_id`);
    if (!(APPLICABILITY_PROVIDER_IDS as readonly string[]).includes(raw.applicability_provider_id)) {
      throw new Error(`[skill-contract] ${label}.applicability_provider_id 未注册：${raw.applicability_provider_id}`);
    }
  }
  if (raw.on_missing !== 'prune' && raw.on_missing !== 'fail') {
    throw new Error(`[skill-contract] ${label}.on_missing 仅支持 prune|fail`);
  }
  const keys = new Set(Object.keys(raw));
  for (const key of keys) {
    if (!['id', 'axis', 'inputs', 'tracks', 'applicability_provider_id', 'on_missing'].includes(key)) {
      throw new Error(`[skill-contract] ${label} 含未知字段 ${key}`);
    }
  }
  return {
    id: raw.id,
    axis: raw.axis,
    inputs: [...raw.inputs],
    tracks,
    ...(raw.applicability_provider_id ? { applicability_provider_id: raw.applicability_provider_id as ApplicabilityProviderId } : {}),
    on_missing: raw.on_missing,
  };
}

function validatePhase(raw: unknown, label: string): PhaseContract {
  assertRecord(raw, label);
  const tracks = validateTracks(raw.tracks, `${label}.tracks`);
  if (!Array.isArray(raw.inputs)) throw new Error(`[skill-contract] ${label}.inputs 必须是数组`);
  const inputs = raw.inputs.map((input, index) => validateInput(input, `${label}.inputs[${index}]`));
  const inputIds = inputs.map((input) => input.id);
  if (new Set(inputIds).size !== inputIds.length) throw new Error(`[skill-contract] ${label} input id 重复`);
  if (!Array.isArray(raw.capabilities) || raw.capabilities.length === 0) {
    throw new Error(`[skill-contract] ${label}.capabilities 必须为非空数组`);
  }
  const capabilities = raw.capabilities.map((capability, index) =>
    validateCapability(capability, `${label}.capabilities[${index}]`, tracks, new Set(inputIds)));
  const capabilityIds = capabilities.map((capability) => capability.id);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    throw new Error(`[skill-contract] ${label} capability id 重复`);
  }

  if (!Array.isArray(raw.produces)) throw new Error(`[skill-contract] ${label}.produces 必须是数组`);
  const produces = raw.produces.map((output, i) => {
    assertRecord(output, `${label}.produces[${i}]`);
    const count = [output.artifact !== undefined, output.kind !== undefined].filter(Boolean).length;
    if (count !== 1) throw new Error(`[skill-contract] ${label}.produces[${i}] 形状非法`);
    if (output.artifact !== undefined) {
      assertString(output.artifact, `${label}.produces[${i}].artifact`);
      if (!validArtifact(output.artifact)) throw new Error(`[skill-contract] ${label}.produces[${i}].artifact 格式非法`);
    }
    if (output.kind !== undefined && (output.kind !== 'source' || typeof output.id !== 'string')) {
      throw new Error(`[skill-contract] ${label}.produces[${i}] source output 缺 id`);
    }
    return output as unknown as ContractOutput;
  });

  assertRecord(raw.verifies, `${label}.verifies`);
  assertString(raw.verifies.check, `${label}.verifies.check`);
  if (!/^check-[a-z-]+\.ts$/.test(raw.verifies.check)) {
    throw new Error(`[skill-contract] ${label}.verifies.check 格式非法`);
  }
  const verifyKeys = Object.keys(raw.verifies);
  if (verifyKeys.length !== 1 || verifyKeys[0] !== 'check') {
    throw new Error(`[skill-contract] ${label}.verifies 仅允许 check（depth_field 已移除）`);
  }
  const controlDependencies = raw.control_dependencies;
  if (controlDependencies !== undefined) {
    assertStringArray(controlDependencies, `${label}.control_dependencies`, true);
    if (new Set(controlDependencies).size !== controlDependencies.length) {
      throw new Error(`[skill-contract] ${label}.control_dependencies 不得重复`);
    }
  }
  const allowed = new Set(['tracks', 'inputs', 'capabilities', 'produces', 'verifies', 'control_dependencies']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`[skill-contract] ${label} 含未知字段 ${key}`);
  }
  return {
    tracks,
    inputs,
    capabilities,
    produces,
    verifies: { check: raw.verifies.check },
    control_dependencies: controlDependencies as string[] | undefined,
  };
}

export function loadSkillContract(filePath: string): SkillContract {
  if (!fs.existsSync(filePath)) throw new Error(`[skill-contract] 未找到 contract：${filePath}`);
  const raw = YAML.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  assertRecord(raw, filePath);
  if (raw.schema_version !== '1.0') throw new Error(`[skill-contract] ${filePath} schema_version 仅支持 1.0`);
  assertString(raw.skill, `${filePath}.skill`);
  if (raw.skill_doc !== 'SKILL.md') throw new Error(`[skill-contract] ${filePath}.skill_doc 必须为 SKILL.md`);
  assertRecord(raw.phases, `${filePath}.phases`);
  const phases: Record<string, PhaseContract> = {};
  for (const [phase, value] of Object.entries(raw.phases)) phases[phase] = validatePhase(value, `${raw.skill}.phases.${phase}`);
  if (Object.keys(phases).length === 0) throw new Error(`[skill-contract] ${filePath}.phases 不得为空`);
  return { schema_version: '1.0', skill: raw.skill, skill_doc: 'SKILL.md', phases, source_path: filePath };
}

export function loadFeatureContracts(frameworkRoot: string): SkillContract[] {
  const featureRoot = path.join(frameworkRoot, 'skills', 'feature');
  const files = fs.readdirSync(featureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(featureRoot, entry.name, 'contract.yaml'))
    .filter((filePath) => fs.existsSync(filePath))
    .sort();
  const contracts = files.map(loadSkillContract);
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

export function phaseContractIndex(contracts: readonly SkillContract[]): Map<string, { contract: SkillContract; phase: PhaseContract }> {
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

export function contractFingerprint(contract: SkillContract): string {
  return crypto.createHash('sha256').update(fs.readFileSync(contract.source_path).toString('utf8'), 'utf8').digest('hex');
}

export function assuranceSatisfies(actual: Assurance, minimum: MinimumAssurance): boolean {
  return ASSURANCE_RANK[actual] >= ASSURANCE_RANK[minimum];
}

export function validateMinimumAssurance(
  frameworkRoot: string,
  minimumAssurance: Record<string, MinimumAssurance> | undefined,
  allowedPhaseIds?: ReadonlySet<string>,
): void {
  if (!minimumAssurance) return;
  const index = phaseContractIndex(loadFeatureContracts(frameworkRoot));
  for (const [phaseName, value] of Object.entries(minimumAssurance)) {
    if (allowedPhaseIds && !allowedPhaseIds.has(phaseName)) {
      throw new Error(`[skill-contract] minimum_assurance phase 不在 active workflow：${phaseName}`);
    }
    if (!index.has(phaseName)) throw new Error(`[skill-contract] minimum_assurance phase 无 contract：${phaseName}`);
    if (value !== 'degraded' && value !== 'full') {
      throw new Error(`[skill-contract] minimum_assurance.${phaseName} 仅支持 degraded|full`);
    }
  }
}