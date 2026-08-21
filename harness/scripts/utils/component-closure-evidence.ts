import * as fs from 'fs';
import * as path from 'path';
import { validateProjectRelativePath } from './project-relative-path';
import { sha256Bytes } from './component-blueprint-path';
import { ComponentClosureCoverageRow, ClosureProviderObservation } from './component-closure-model';
import { ResolvedComponentClosureInputs } from './component-closure-inputs';
import {
  loadPhaseEvidenceManifest,
  recomputePhaseEvidenceStaleness,
} from './phase-evidence-manifest';
import { ScriptReport } from './types';

interface ClosureEvidenceIdentityPayload {
  schema: 'component-closure-evidence@1';
  obligation_id: string;
  authority_ref: string;
  source_sha256: string;
  feature_ids: string[];
  provider_id: ClosureProviderObservation['provider_id'];
}

export function providerForEvidenceLevel(
  level: ComponentClosureCoverageRow['evidence_level'],
): ClosureProviderObservation['provider_id'] | null {
  if (level === 'ui_device') return 'ui-device-visual-evidence';
  if (level === 'manual_risk') return 'human-acceptance-risk';
  if (level === 'unit_contract' || level === 'integration_combination') return 'automated-construction-evidence';
  return null;
}

function splitProjectEvidenceRef(rawRef: string): { pathPart: string; symbol: string } | null {
  if (!rawRef || rawRef.startsWith('planned:') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawRef)) return null;
  const hash = rawRef.indexOf('#');
  if (hash < 1 || hash === rawRef.length - 1) return null;
  return { pathPart: rawRef.slice(0, hash), symbol: rawRef.slice(hash + 1) };
}

export function createClosureEvidenceIdentity(
  projectRoot: string,
  obligationId: string,
  rawRef: string,
  featureIds: string[],
  evidenceLevel: ComponentClosureCoverageRow['evidence_level'],
): string | null {
  const split = splitProjectEvidenceRef(rawRef);
  if (!split) return null;
  let normalized: string;
  try {
    normalized = validateProjectRelativePath(projectRoot, split.pathPart, 'component closure evidence ref');
  } catch {
    return null;
  }
  const absolute = path.resolve(projectRoot, normalized);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  const bytes = fs.readFileSync(absolute);
  if (!bytes.toString('utf8').includes(split.symbol)) return null;
  const providerId = providerForEvidenceLevel(evidenceLevel);
  const normalizedFeatureIds = [...new Set(featureIds)].sort();
  if (!providerId || normalizedFeatureIds.length === 0) return null;
  const payload: ClosureEvidenceIdentityPayload = {
    schema: 'component-closure-evidence@1',
    obligation_id: obligationId,
    authority_ref: `${normalized}#${split.symbol}`,
    source_sha256: sha256Bytes(bytes),
    feature_ids: normalizedFeatureIds,
    provider_id: providerId,
  };
  return `closure-evidence@1:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

export function parseClosureEvidenceIdentity(identity: string): ClosureEvidenceIdentityPayload | null {
  if (!identity.startsWith('closure-evidence@1:')) return null;
  try {
    const payload = JSON.parse(Buffer.from(identity.slice('closure-evidence@1:'.length), 'base64url').toString('utf8')) as ClosureEvidenceIdentityPayload;
    if (payload.schema !== 'component-closure-evidence@1'
      || !payload.obligation_id
      || !payload.authority_ref
      || !/^sha256:[a-f0-9]{64}$/.test(payload.source_sha256)
      || !Array.isArray(payload.feature_ids)
      || payload.feature_ids.length === 0
      || payload.feature_ids.some(id => typeof id !== 'string' || id.length === 0)
      || !['automated-construction-evidence', 'ui-device-visual-evidence', 'human-acceptance-risk'].includes(payload.provider_id)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyClosureEvidenceIdentity(
  projectRoot: string,
  identity: string,
  inputs: ResolvedComponentClosureInputs,
  expectedProviderId: ClosureProviderObservation['provider_id'],
): ClosureProviderObservation['observations'][number] {
  const payload = parseClosureEvidenceIdentity(identity);
  if (!payload) {
    return { evidence_identity: identity, authority_ref: 'invalid', source_sha256: `sha256:${'0'.repeat(64)}`, status: 'invalid' };
  }
  const split = splitProjectEvidenceRef(payload.authority_ref);
  if (!split) return { evidence_identity: identity, authority_ref: payload.authority_ref, source_sha256: payload.source_sha256, status: 'invalid' };
  if (payload.provider_id !== expectedProviderId) {
    return { evidence_identity: identity, authority_ref: payload.authority_ref, source_sha256: payload.source_sha256, status: 'invalid' };
  }
  try {
    const normalized = validateProjectRelativePath(projectRoot, split.pathPart, 'component closure evidence identity');
    const absolute = path.resolve(projectRoot, normalized);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      return { evidence_identity: identity, authority_ref: payload.authority_ref, source_sha256: payload.source_sha256, status: 'invalid' };
    }
    const bytes = fs.readFileSync(absolute);
    if (!bytes.toString('utf8').includes(split.symbol)) {
      return { evidence_identity: identity, authority_ref: payload.authority_ref, source_sha256: payload.source_sha256, status: 'invalid' };
    }
    if (sha256Bytes(bytes) !== payload.source_sha256) {
      return { evidence_identity: identity, authority_ref: payload.authority_ref, source_sha256: payload.source_sha256, status: 'stale' };
    }
    const current = payload.feature_ids.every(featureId => hasCurrentAuthoritativeExecution(
      projectRoot,
      inputs,
      featureId,
      split.pathPart,
      split.symbol,
      expectedProviderId,
      payload.source_sha256,
    ));
    return {
      evidence_identity: identity,
      authority_ref: payload.authority_ref,
      source_sha256: payload.source_sha256,
      status: current ? 'current' : 'invalid',
    };
  } catch {
    return { evidence_identity: identity, authority_ref: payload.authority_ref, source_sha256: payload.source_sha256, status: 'invalid' };
  }
}

function allowedEvidencePhases(providerId: ClosureProviderObservation['provider_id']): Set<string> {
  if (providerId === 'automated-construction-evidence') return new Set(['coding', 'review', 'ut', 'testing']);
  if (providerId === 'ui-device-visual-evidence') return new Set(['ut', 'testing']);
  return new Set();
}

function normalizedReportPath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\.\//, '');
}

function loadScriptReportFromManifest(
  projectRoot: string,
  featureId: string,
  phase: string,
): ScriptReport | null {
  const loaded = loadPhaseEvidenceManifest(projectRoot, featureId, phase);
  if (!loaded?.integrityOk) return null;
  const reportEntry = [...loaded.manifest.inputs, ...loaded.manifest.outputs]
    .find(entry => {
      const normalized = normalizedReportPath(entry.path);
      return path.posix.basename(normalized) === 'script-report.json'
        && path.posix.basename(path.posix.dirname(normalized)) === 'reports'
        && entry.role !== 'input'
        && entry.exists
        && entry.sha256 !== null;
    });
  if (!reportEntry) return null;
  const reportPath = path.resolve(projectRoot, reportEntry.path);
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ScriptReport;
    if (report.feature !== featureId || String(report.phase) !== phase || report.summary?.verdict !== 'PASS') return null;
    return report;
  } catch {
    return null;
  }
}

const featureEvidenceCache = new WeakMap<
  ResolvedComponentClosureInputs,
  Map<string, Map<string, ScriptReport>>
>();

function currentFeatureReports(
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
  featureId: string,
): Map<string, ScriptReport> {
  let byFeature = featureEvidenceCache.get(inputs);
  if (!byFeature) {
    byFeature = new Map();
    featureEvidenceCache.set(inputs, byFeature);
  }
  const cached = byFeature.get(featureId);
  if (cached) return cached;
  const reports = new Map<string, ScriptReport>();
  const owner = inputs.currentUnits.find(unit => unit.input.feature_id === featureId);
  const chain = owner?.completionObservation.expectedChain ?? [];
  if (owner?.input.completion === 'VALID' && chain.length > 0) {
    const freshness = new Map(recomputePhaseEvidenceStaleness(projectRoot, featureId, chain)
      .map(item => [item.phase, item.verdict]));
    for (const phase of chain) {
      if (freshness.get(phase) !== 'fresh') continue;
      const report = loadScriptReportFromManifest(projectRoot, featureId, phase);
      if (report) reports.set(phase, report);
    }
  }
  byFeature.set(featureId, reports);
  return reports;
}

/**
 * 该 phase 的 fresh manifest 是否把 authority 文件按**当次执行的字节**登记为输入。
 *
 * 没有这一条，`freshness` 对 authority 文件就是空门：manifest 里根本没有它，改动它不会让
 * 任何阶段 stale，旧 PASS 报告会继续为改动后的源码背书（MG plan §16 单变量实验实证）。
 */
function manifestTracksAuthority(
  projectRoot: string,
  featureId: string,
  phase: string,
  normalizedAuthorityPath: string,
  expectedSourceSha256: string,
): boolean {
  const loaded = loadPhaseEvidenceManifest(projectRoot, featureId, phase);
  if (!loaded?.integrityOk) return false;
  const expectedHex = expectedSourceSha256.replace(/^sha256:/, '');
  return loaded.manifest.inputs.some(entry =>
    normalizedReportPath(entry.path) === normalizedAuthorityPath
    && entry.exists
    && entry.sha256 === expectedHex);
}

function hasCurrentAuthoritativeExecution(
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
  featureId: string,
  authorityPath: string,
  symbol: string,
  providerId: ClosureProviderObservation['provider_id'],
  expectedSourceSha256: string,
): boolean {
  const allowed = allowedEvidencePhases(providerId);
  const normalizedAuthorityPath = normalizedReportPath(authorityPath);
  return [...currentFeatureReports(projectRoot, inputs, featureId)].some(([phase, report]) => {
    if (!allowed.has(phase)) return false;
    const executed = report.checks.some(check => check.id === symbol
      && check.status === 'PASS'
      && (check.affected_files ?? []).some(file => normalizedReportPath(file) === normalizedAuthorityPath));
    if (!executed) return false;
    return manifestTracksAuthority(projectRoot, featureId, phase, normalizedAuthorityPath, expectedSourceSha256);
  });
}

export function applyEvidenceProviderAvailability(
  rows: ComponentClosureCoverageRow[],
  providers: ClosureProviderObservation[],
): ComponentClosureCoverageRow[] {
  const byId = new Map(providers.map(provider => [provider.provider_id, provider]));
  return rows.map(row => {
    const providerId = providerForEvidenceLevel(row.evidence_level);
    if (!providerId || row.observation !== 'covered') return row;
    const provider = byId.get(providerId);
    if (!provider || provider.status === 'missing' || !provider.available) return { ...row, observation: 'uncovered' };
    const observations = new Map(provider.observations.map(item => [item.evidence_identity, item.status]));
    if (row.evidence_identities.some(identity => !observations.has(identity))) return { ...row, observation: 'uncovered' };
    if (row.evidence_identities.some(identity => observations.get(identity) === 'invalid')) return { ...row, observation: 'invalid' };
    if (row.evidence_identities.some(identity => observations.get(identity) === 'stale')) return { ...row, observation: 'stale' };
    return row;
  });
}
