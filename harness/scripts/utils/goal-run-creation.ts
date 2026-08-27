/**
 * Fresh goal-run birth contract.
 *
 * Persistent SSOT remains manifest.json + events.jsonl. This module deliberately does not add
 * a transaction marker: manifest-only residue is classified CREATION_INCOMPLETE by inspection.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  computeManifestIdentityFields,
  computeManifestIdentityFieldsHash,
  manifestIdentityFieldDigest,
  writeGoalManifest,
  type GoalManifest,
} from './goal-manifest';
import { loadEventsJsonlStrict, type GoalRunEvent } from './goal-runner-phase';

export interface RunCreatedEvent extends Record<string, unknown> {
  type: 'run_created';
  schema_version: '1.0';
  ts: string;
  run_id: string;
  event_index: number;
  event_hash: string;
  manifest_identity_fields: Record<string, string>;
  manifest_identity_hash: string;
  run_base_sha_digest: string | null;
  dry_run?: boolean;
  rebaseline_from_run_id?: string;
}

export interface GoalRunCreationResult {
  manifestPath: string;
  eventsPath: string;
  runCreated: RunCreatedEvent;
}

export function buildSupersedeAuditEvent(input: {
  targetRunId: string;
  supersedingRunId: string;
  rebaselineTo?: string;
  creation?: GoalRunCreationResult | null;
}): Record<string, unknown> {
  return {
    type: 'supersede',
    target_run_id: input.targetRunId,
    superseding_run_id: input.supersedingRunId,
    ...(input.rebaselineTo
      ? {
          rebaseline_to: input.rebaselineTo,
          run_created_event_index: input.creation?.runCreated.event_index,
          run_created_event_hash: input.creation?.runCreated.event_hash,
        }
      : {}),
  };
}

export type GoalRunCreationInspection =
  | { state: 'absent' }
  | { state: 'complete'; event: RunCreatedEvent }
  | { state: 'legacy'; firstRunStart: GoalRunEvent }
  | { state: 'creation_incomplete'; reason: string };

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) return item.map(normalize);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(item as Record<string, unknown>).sort()) {
      out[key] = normalize((item as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(normalize(value));
}

function runCreatedHash(input: Omit<RunCreatedEvent, 'event_hash' | 'ts'>): string {
  return crypto.createHash('sha256').update(stableJson(input), 'utf8').digest('hex');
}

export function resolveGoalRunHeadSha(projectRoot: string): string {
  const value = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`[goal-run-creation] Git HEAD 非 exact 40-hex：${JSON.stringify(value)}`);
  }
  return value;
}

function chainRequiresRunBase(chain: readonly string[]): boolean {
  return chain.some(phase => phase === 'coding' || phase === 'ut');
}

function validateExactSha(value: string | undefined, label: string): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`[goal-run-creation] ${label} 必须为 exact 40-hex Git SHA`);
  }
  return normalized;
}

export function validateRebaselineRequest(input: {
  supersedeTargets: readonly string[];
  rebaselineTo?: string;
  resume: boolean;
  dryRun: boolean;
  hasGoalExecutionSignal: boolean;
  currentHead: string;
}): { sourceRunId: string; baseSha: string } | null {
  if (input.rebaselineTo === undefined) return null;
  const requested = input.rebaselineTo.trim().toLowerCase();
  if (input.resume || input.dryRun) {
    throw new Error('--rebaseline-to 只允许创建新的 authoritative run');
  }
  if (input.hasGoalExecutionSignal) {
    throw new Error('--rebaseline-to 必须在 goal runtime 之外由操作者执行');
  }
  if (input.supersedeTargets.length !== 1) {
    throw new Error('--rebaseline-to 必须与且仅与一个 --supersede <old-run-id> 同时提供');
  }
  const baseSha = validateExactSha(requested, '--rebaseline-to');
  if (input.currentHead.toLowerCase() !== baseSha) {
    throw new Error(
      `--rebaseline-to 与当前 Git HEAD 不一致（requested=${baseSha}, HEAD=${input.currentHead}）`,
    );
  }
  return { sourceRunId: input.supersedeTargets[0], baseSha };
}

export function createGoalRun(options: {
  projectRoot: string;
  manifest: GoalManifest;
  chain: readonly string[];
  rebaselineFromRunId?: string;
  /** Tests only: deterministic HEAD resolver. */
  resolveHead?: () => string;
}): GoalRunCreationResult {
  const manifestPath = path.join(options.projectRoot, options.manifest.report_dir, 'manifest.json');
  const eventsPath = path.join(options.projectRoot, options.manifest.report_dir, 'events.jsonl');
  if (fs.existsSync(manifestPath)) {
    throw new Error(`[goal-run-creation] fresh run manifest 已存在：${manifestPath}`);
  }
  if (fs.existsSync(eventsPath) && fs.readFileSync(eventsPath, 'utf8').trim()) {
    throw new Error(`[goal-run-creation] fresh run events 已存在：${eventsPath}`);
  }

  if (chainRequiresRunBase(options.chain)) {
    if (options.manifest.successor_of) {
      if (!options.manifest.run_base_sha) {
        throw new Error(
          '[goal-run-creation] successor 缺少可信 lineage run_base_sha；须人工 rebaseline supersede',
        );
      }
      options.manifest.run_base_sha = validateExactSha(
        options.manifest.run_base_sha,
        'successor run_base_sha',
      );
    } else {
      options.manifest.run_base_sha = validateExactSha(
        (options.resolveHead ?? (() => resolveGoalRunHeadSha(options.projectRoot)))(),
        'Git HEAD',
      );
    }
  } else if (options.manifest.run_base_sha !== undefined) {
    options.manifest.run_base_sha = validateExactSha(options.manifest.run_base_sha, 'run_base_sha');
  }

  const fields = computeManifestIdentityFields(options.manifest);
  const baseDigest = fields.run_base_sha ?? null;
  const withoutHash = {
    type: 'run_created' as const,
    schema_version: '1.0' as const,
    run_id: options.manifest.run_id,
    event_index: 0,
    manifest_identity_fields: fields,
    manifest_identity_hash: computeManifestIdentityFieldsHash(fields),
    run_base_sha_digest: baseDigest,
    ...(options.manifest.report_dir.split('/').includes('.dry') ? { dry_run: true } : {}),
    ...(options.rebaselineFromRunId
      ? { rebaseline_from_run_id: options.rebaselineFromRunId }
      : {}),
  };
  const event: RunCreatedEvent = {
    ...withoutHash,
    ts: new Date().toISOString(),
    event_hash: runCreatedHash(withoutHash),
  };

  writeGoalManifest(options.manifest, options.projectRoot);
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  return { manifestPath, eventsPath, runCreated: event };
}

function validateRunCreatedEvent(event: GoalRunEvent, manifest: GoalManifest): string | null {
  const raw = event as unknown as Partial<RunCreatedEvent>;
  if (raw.schema_version !== '1.0' || raw.run_id !== manifest.run_id || raw.event_index !== 0) {
    return 'run_created 基本身份不匹配';
  }
  if (!raw.manifest_identity_fields || typeof raw.manifest_identity_fields !== 'object') {
    return 'run_created.manifest_identity_fields 缺失/非法';
  }
  const fields = raw.manifest_identity_fields as Record<string, string>;
  if (raw.manifest_identity_hash !== computeManifestIdentityFieldsHash(fields)) {
    return 'run_created.manifest_identity_hash 不匹配';
  }
  const expectedBaseDigest = fields.run_base_sha ?? null;
  if (raw.run_base_sha_digest !== expectedBaseDigest) {
    return 'run_created.run_base_sha_digest 不匹配';
  }
  const withoutHash = {
    type: 'run_created' as const,
    schema_version: '1.0' as const,
    run_id: raw.run_id,
    event_index: raw.event_index,
    manifest_identity_fields: fields,
    manifest_identity_hash: raw.manifest_identity_hash,
    run_base_sha_digest: raw.run_base_sha_digest ?? null,
    ...(raw.dry_run === true ? { dry_run: true } : {}),
    ...(raw.rebaseline_from_run_id
      ? { rebaseline_from_run_id: raw.rebaseline_from_run_id }
      : {}),
  };
  if (raw.event_hash !== runCreatedHash(withoutHash)) {
    return 'run_created.event_hash 不匹配';
  }
  if (fields.run_base_sha && fields.run_base_sha !== manifestIdentityFieldDigest(manifest.run_base_sha)) {
    // Current manifest may legitimately rebase other identity fields, but run_base_sha is write-once.
    return 'manifest.run_base_sha 与出生摘要不匹配';
  }
  return null;
}

export function inspectGoalRunCreation(
  projectRoot: string,
  manifest: GoalManifest,
): GoalRunCreationInspection {
  const manifestPath = path.join(projectRoot, manifest.report_dir, 'manifest.json');
  const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');
  return inspectGoalRunCreationFiles(manifestPath, eventsPath, manifest);
}

export function inspectGoalRunCreationFiles(
  manifestPath: string,
  eventsPath: string,
  knownManifest?: GoalManifest,
): GoalRunCreationInspection {
  if (!fs.existsSync(manifestPath)) return { state: 'absent' };
  let manifest = knownManifest;
  if (!manifest) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as GoalManifest;
    } catch (error) {
      return { state: 'creation_incomplete', reason: `manifest 无法解析：${(error as Error).message}` };
    }
  }
  const loaded = loadEventsJsonlStrict(eventsPath);
  if (loaded.corruptLines.length > 0) {
    return { state: 'creation_incomplete', reason: 'events.jsonl 含损坏行' };
  }
  const created = loaded.events.filter(event => event.type === 'run_created');
  if (created.length > 1) {
    return { state: 'creation_incomplete', reason: `run_created 数量非法：${created.length}` };
  }
  if (created.length === 1) {
    const issue = validateRunCreatedEvent(created[0], manifest);
    return issue
      ? { state: 'creation_incomplete', reason: issue }
      : { state: 'complete', event: created[0] as unknown as RunCreatedEvent };
  }
  const firstRunStart = loaded.events.find(event => event.type === 'run_start');
  if (firstRunStart) return { state: 'legacy', firstRunStart };
  return { state: 'creation_incomplete', reason: 'manifest 已存在但缺少 run_created/run_start 出生事件' };
}

export function assertGoalRunAttachable(projectRoot: string, manifest: GoalManifest): void {
  const inspection = inspectGoalRunCreation(projectRoot, manifest);
  if (inspection.state === 'creation_incomplete') {
    throw new Error(`[goal-run-creation] CREATION_INCOMPLETE: ${inspection.reason}`);
  }
}
