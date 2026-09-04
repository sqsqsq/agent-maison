// ============================================================================
// phase-closure-finalizer.unit.test.ts — summary 1.2 staged closure invariants
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  featurePhaseReportsDir,
  resolveReceiptFilePath,
} from '../../config';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { syncPhaseStateOnReceiptPassStrict } from '../../scripts/utils/phase-state';
import { patchSummarySoftAdvisory } from '../../scripts/check-receipt';
import {
  loadPhaseEvidenceManifest,
  readReceiptManifestPointer,
  resolvePhaseEvidenceManifest,
  sha256File,
} from '../../scripts/utils/phase-evidence-manifest';
import type { HarnessRunSummary } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

interface Case {
  name: string;
  run: () => void;
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const FEATURE = 'demo';
const PHASE = 'spec';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function mkProject(): {
  root: string;
  summaryPath: string;
  receiptPath: string;
  originalSummary: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-finalizer-'));
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.1',
      project_name: 'phase-finalizer-test',
      project_profile: { name: 'generic' },
      agent_adapter: 'generic',
      architecture: {
        outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
        module_inner_layers: ['content'],
        inner_dependency_direction: 'upward',
        cross_module_exports_file: 'index.ts',
      },
      paths: { features_dir: 'doc/features' },
    }),
    'utf8',
  );
  const featureRoot = path.join(root, 'doc', 'features', FEATURE);
  fs.mkdirSync(path.join(featureRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(featureRoot, 'spec', 'spec.md'), '# Demo\n', 'utf8');
  fs.writeFileSync(path.join(featureRoot, 'acceptance.yaml'), 'criteria: []\n', 'utf8');

  const summaryPath = path.join(
    featurePhaseReportsDir(root, FEATURE, PHASE, FRAMEWORK_ROOT),
    'summary.json',
  );
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  const summary = {
    schema_version: '1.2',
    phase: PHASE,
    feature: FEATURE,
    verdict: 'PASS',
    blocker_count: 0,
    fail_count: 0,
    warn_count: 0,
    script_report: 'script-report.json',
    merged_report: 'merged-report.md',
    ai_prompt: 'ai-prompt.md',
    summary_json: 'summary.json',
    run_statuses: [],
    readiness_signals: [],
    blocking_warnings: [],
    blocking_skips: [],
    blockers: [],
    next_action: 'run_receipt',
    closure_status: 'open',
    assurance: 'full',
  } as HarnessRunSummary;
  const originalSummary = JSON.stringify(summary, null, 2);
  fs.writeFileSync(summaryPath, originalSummary, 'utf8');

  const receiptPath = resolveReceiptFilePath(root, FEATURE, PHASE).path;
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, '# receipt\n\nclaimed: true\n', 'utf8');
  return { root, summaryPath, receiptPath, originalSummary };
}

function finalize(
  fixture: ReturnType<typeof mkProject>,
  persistPhaseState: () => void = () => undefined,
  assessAfterCommit?: () => unknown,
  faultAt?: 'after_staged_summary' | 'after_manifest_publish' | 'after_receipt_pointer' | 'after_phase_state' | 'after_summary_rename',
) {
  return finalizePhaseClosure({
    projectRoot: fixture.root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: FEATURE,
    phase: PHASE,
    persistPhaseState,
    prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }),
    now: () => new Date('2026-07-30T00:00:00.000Z'),
    assessAfterCommit,
    faultAt,
  });
}

function finalizeWithProductionEvidence(fixture: ReturnType<typeof mkProject>) {
  return finalizePhaseClosure({
    projectRoot: fixture.root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: FEATURE,
    phase: PHASE,
    persistPhaseState: () => undefined,
    now: () => new Date('2026-07-30T00:00:00.000Z'),
  });
}

function seedOldClosureBinding(fixture: ReturnType<typeof mkProject>): {
  manifestSha: string;
  pointerSha: string;
} {
  finalize(fixture);
  const oldManifest = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE);
  assert(Boolean(oldManifest), 'old manifest missing');
  const oldPointer = oldManifest!.fileSha256; // plan 07a41ec6：回执指针已退出证据链，形状保留

  const reopened = JSON.parse(fixture.originalSummary) as HarnessRunSummary;
  reopened.warn_count = 1;
  fs.writeFileSync(fixture.summaryPath, JSON.stringify(reopened, null, 2), 'utf8');
  return { manifestSha: oldManifest!.fileSha256, pointerSha: oldPointer! };
}
const cases: Case[] = [
  {
    name: 'plan 07a41ec6 T7：summaryPatch 把 verifier_closure 写进闭环 summary（沿用既往 PASS 的诚实标注）',
    run: () => {
      const fixture = mkProject();
      try {
        const record = {
          mode: 'completed_with_prior_review',
          reviewed_subject_id: 'a'.repeat(64),
          current_subject_id: 'b'.repeat(64),
          current_material_not_reverified: ['doc/features/x/spec/spec.md'],
        };
        finalizePhaseClosure({
          projectRoot: fixture.root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: FEATURE,
          phase: PHASE,
          persistPhaseState: () => undefined,
          prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }),
          now: () => new Date('2026-07-30T00:00:00.000Z'),
          summaryPatch: { verifier_closure: record },
        });
        const closed = JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')) as Record<string, unknown>;
        assert(closed.closure_status === 'closed', 'summary 应闭环');
        assert(JSON.stringify(closed.verifier_closure) === JSON.stringify(record), `summaryPatch 应进入闭环 summary：${JSON.stringify(closed.verifier_closure)}`);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'production evidence binds project fallback attempts but never framework contracts',
    run: () => {
      const fixture = mkProject();
      try {
        const preferred = path.join(fixture.root, 'doc', 'features', FEATURE, 'spec', 'preferred-input.md');
        const summary = JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')) as Record<string, unknown>;
        summary.capability_resolutions = [{
          id: 'capability_spec_requirement', axis: 'functional', active: true, state: 'resolved',
          applicability_dependencies: [],
          inputs: [{
            id: 'requirement', state: 'resolved', selected_source: 'derive.requirement',
            selected_source_fingerprint: 'a'.repeat(64),
            attempts: [
              { kind: 'artifact', source: 'preferred@1', state: 'absent', dependencies: [{ path: preferred, exists: false, sha256: null, role: 'artifact' }] },
              { kind: 'derive', source: 'derive.requirement', state: 'resolved', dependencies: [] },
            ],
          }],
        }];
        summary.capability_resolution_contract_fingerprint = 'b'.repeat(64);
        fs.writeFileSync(fixture.summaryPath, JSON.stringify(summary, null, 2), 'utf8');
        finalizeWithProductionEvidence(fixture);
        const manifest = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE)!;
        assert(manifest.manifest.inputs.some((entry) => entry.path.endsWith('preferred-input.md') && entry.exists === false), 'absent attempt not bound');
        assert(
          !manifest.manifest.inputs.some((entry) => entry.path.endsWith('skills/feature/spec/contract.yaml')),
          'framework contract must bind through contract_fingerprint, not feature evidence input',
        );
        fs.writeFileSync(preferred, 'now preferred\n', 'utf8');
        const stale = require('../../scripts/utils/phase-evidence-manifest').recomputePhaseEvidenceStaleness(fixture.root, FEATURE, [PHASE]);
        assert(stale[0].verdict === 'stale', JSON.stringify(stale[0]));
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'staged output hash is recorded under canonical summary path',
    run: () => {
      const fixture = mkProject();
      try {
        const finalBytes = '{"schema_version":"1.2","closure_status":"closed"}';
        const manifest = resolvePhaseEvidenceManifest({
          projectRoot: fixture.root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: FEATURE,
          phase: PHASE,
          stagedOutputs: [{
            canonicalPath: fixture.summaryPath,
            sha256: sha256(finalBytes),
          }],
        });
        const rel = path.relative(fixture.root, fixture.summaryPath).replace(/\\/g, '/');
        const entry = manifest.outputs.find((output) => output.path === rel);
        assert(Boolean(entry), 'canonical summary entry missing');
        assert(entry!.sha256 === sha256(finalBytes), 'manifest did not use staged hash');
        assert(entry!.sha256 !== sha256File(fixture.summaryPath), 'manifest used current open summary');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'successful finalization publishes manifest-bound final summary last',
    run: () => {
      const fixture = mkProject();
      let persisted = 0;
      try {
        const result = finalize(fixture, () => { persisted += 1; });
        assert(result.transitioned, 'expected transition');
        assert(persisted === 1, `persist count=${persisted}`);
        const publishedRaw = fs.readFileSync(fixture.summaryPath, 'utf8');
        const published = JSON.parse(publishedRaw) as HarnessRunSummary;
        assert(published.closure_status === 'closed', 'summary not closed');
        assert(published.closure_commit?.schema_version === '1.0', 'closure_commit missing');
        assert(
          !Object.prototype.hasOwnProperty.call(published.closure_commit ?? {}, 'evidence_manifest_sha256'),
          'closure_commit must not contain manifest hash',
        );
        assert(result.closure_fingerprint === sha256(publishedRaw), 'closure fingerprint mismatch');
        const loaded = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE);
        assert(Boolean(loaded), 'manifest missing');
        const rel = path.relative(fixture.root, fixture.summaryPath).replace(/\\/g, '/');
        const entry = loaded!.manifest.outputs.find((output) => output.path === rel);
        assert(entry?.sha256 === sha256(publishedRaw), 'manifest does not bind published summary');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'phase-state failure occurs after canonical summary commit; retry only resyncs compatibility state',
    run: () => {
      const fixture = mkProject();
      try {
        const result = finalize(fixture, () => { throw new Error('state denied'); });
        assert(result.phase_state_error === 'state denied', 'expected state sync warning');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed', 'summary must commit before state sync');
        const staged = fs.readdirSync(path.dirname(fixture.summaryPath))
          .filter((name) => name.includes('.staged-'));
        assert(staged.length === 0, `committed summary must not leave staged witness=${staged.join(',')}`);
        let resynced = 0;
        const recovered = finalize(fixture, () => { resynced += 1; });
        assert(recovered.transitioned === false, 'retry should observe already committed summary');
        assert(resynced === 1, 'retry must resync compatibility state');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed', 'summary not closed');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'legacy closed summary remains legacy_unverified until harness rerun',
    run: () => {
      const fixture = mkProject();
      try {
        const legacy = JSON.parse(fixture.originalSummary) as Record<string, unknown>;
        legacy.schema_version = '1.1';
        legacy.closure_status = 'closed';
        delete legacy.assurance;
        const legacyRaw = JSON.stringify(legacy, null, 2);
        fs.writeFileSync(fixture.summaryPath, legacyRaw, 'utf8');
        let message = '';
        try {
          finalize(fixture);
        } catch (error) {
          message = (error as Error).message;
        }
        assert(message.includes('legacy_unverified'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === legacyRaw, 'legacy summary changed');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'blocked assurance cannot be finalized even if a malformed summary claims PASS',
    run: () => {
      const fixture = mkProject();
      try {
        const summary = JSON.parse(fixture.originalSummary) as HarnessRunSummary;
        summary.assurance = 'blocked';
        const raw = JSON.stringify(summary, null, 2);
        fs.writeFileSync(fixture.summaryPath, raw, 'utf8');
        let message = '';
        try { finalize(fixture); } catch (error) { message = (error as Error).message; }
        assert(message.includes('blocked capability assurance'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === raw, 'blocked summary must stay open');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'missing assurance cannot be finalized',
    run: () => {
      const fixture = mkProject();
      try {
        const summary = JSON.parse(fixture.originalSummary) as HarnessRunSummary;
        delete summary.assurance;
        const unknownRaw = JSON.stringify(summary, null, 2);
        fs.writeFileSync(fixture.summaryPath, unknownRaw, 'utf8');
        let message = '';
        try {
          finalize(fixture);
        } catch (error) {
          message = (error as Error).message;
        }
        assert(message.includes('assurance'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === unknownRaw, 'missing-assurance summary changed');
        const staged = fs.readdirSync(path.dirname(fixture.summaryPath))
          .filter((name) => name.includes('.staged-'));
        assert(staged.length === 0, `staged leftovers=${staged.join(',')}`);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'repeated finalization is idempotent after commit',
    run: () => {
      const fixture = mkProject();
      try {
        const first = finalize(fixture);
        const second = finalize(fixture);
        assert(first.transitioned, 'first should transition');
        assert(!second.transitioned, 'second should be no-op');
        assert(first.closure_fingerprint === second.closure_fingerprint, 'fingerprint changed');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'direct receipt and sync-closure callers converge on identical commit bytes',
    run: () => {
      const direct = mkProject();
      const sync = mkProject();
      try {
        const directResult = finalize(direct);
        const syncResult = finalize(sync, () => syncPhaseStateOnReceiptPassStrict(
          sync.root, FEATURE, PHASE, {
            status: 'passed',
            receipt_path: path.relative(sync.root, sync.receiptPath).replace(/\\\\/g, '/'),
          },
          { frameworkRoot: FRAMEWORK_ROOT },
        ));
        const directBytes = fs.readFileSync(direct.summaryPath, 'utf8');
        const syncBytes = fs.readFileSync(sync.summaryPath, 'utf8');
        assert(directBytes === syncBytes, 'entry routes published different summary bytes');
        assert(
          directResult.closure_fingerprint === syncResult.closure_fingerprint,
          'entry routes produced different closure fingerprints',
        );
        const directManifest = loadPhaseEvidenceManifest(direct.root, FEATURE, PHASE);
        const syncManifest = loadPhaseEvidenceManifest(sync.root, FEATURE, PHASE);
        assert(
          directManifest?.manifest.aggregate_sha256 === syncManifest?.manifest.aggregate_sha256,
          'entry routes produced different evidence aggregate',
        );
        assert(fs.existsSync(path.join(sync.root, 'framework', 'harness', 'state', '.current-phase.json'))
          || fs.existsSync(path.join(sync.root, '.current-phase.json')), 'sync route did not persist phase state');
        const phaseStateSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/utils/phase-state.ts'), 'utf8');
        const syncCallback = phaseStateSource.indexOf('persistPhaseState: () =>');
        const strictPersist = phaseStateSource.indexOf('syncPhaseStateOnReceiptPassStrict', syncCallback);
        assert(syncCallback >= 0 && strictPersist > syncCallback, 'sync route lost strict finalizer wiring');
      } finally {
        fs.rmSync(direct.root, { recursive: true, force: true });
        fs.rmSync(sync.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'post-commit assess result is returned after closure is durable',
    run: () => {
      const fixture = mkProject();
      try {
        const result = finalize(fixture, () => undefined, () => ({ recommendation: 'plan' }));
        assert(result.transitioned, 'closure did not commit');
        assert((result.assess as { recommendation?: string })?.recommendation === 'plan', 'assess result');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed', 'not closed');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'post-commit assess failure does not roll back a verified closure',
    run: () => {
      const fixture = mkProject();
      try {
        const result = finalize(fixture, () => undefined, () => { throw new Error('assess failed'); });
        assert(result.assess_error === 'assess failed', 'assess error not preserved');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed', 'closure rolled back');
        assert(!finalize(fixture).transitioned, 'committed closure was not idempotent');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'closed summary advisory is byte-preserving',
    run: () => {
      const fixture = mkProject();
      try {
        finalize(fixture);
        const before = fs.readFileSync(fixture.summaryPath, 'utf8');
        patchSummarySoftAdvisory(
          fixture.root,
          path.relative(fixture.root, path.dirname(fixture.summaryPath)).replace(/\\/g, '/'),
          { id: 'visual_multimodal_parity', status: 'SKIP', details: 'test advisory' },
        );
        const after = fs.readFileSync(fixture.summaryPath, 'utf8');
        assert(after === before, 'closed summary advisory changed manifest-bound bytes');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'idempotent finalizer rejects mismatched closed summary bytes without rebinding them',
    run: () => {
      const fixture = mkProject();
      try {
        finalize(fixture);
        const manifestBefore = fs.readFileSync(
          path.join(path.dirname(fixture.summaryPath), 'phase-evidence-manifest.json'),
          'utf8',
        );
        const drifted = `${fs.readFileSync(fixture.summaryPath, 'utf8')}\n`;
        fs.writeFileSync(fixture.summaryPath, drifted, 'utf8');
        let message = '';
        try { finalize(fixture); } catch (error) { message = (error as Error).message; }
        assert(message.includes('禁止按当前字节重新绑定'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === drifted, 'drifted user bytes changed');
        assert(
          fs.readFileSync(path.join(path.dirname(fixture.summaryPath), 'phase-evidence-manifest.json'), 'utf8') === manifestBefore,
          'mismatched closed summary rewrote evidence manifest',
        );
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'old manifest plus staged-only crash cleans the unprovable runner temp and requires owner backtrack',
    run: () => {
      const fixture = mkProject();
      try {
        const old = seedOldClosureBinding(fixture);
        let crashed = false;
        try { finalize(fixture, () => undefined, undefined, 'after_staged_summary'); }
        catch (error) { crashed = (error as Error).message.includes('after_staged_summary'); }
        assert(crashed, 'staged-only crash was not injected');

        let message = '';
        try { finalize(fixture); } catch (error) { message = (error as Error).message; }
        assert(message.includes('无法证明'), `unexpected recovery result: ${message}`);
        const staged = fs.readdirSync(path.dirname(fixture.summaryPath))
          .filter((name) => name.includes('.staged-'));
        assert(staged.length === 0, `unprovable staged temp was not cleaned: ${staged.join(',')}`);
        assert(loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE)?.fileSha256 === old.manifestSha,
          'old manifest should remain untouched for owner invalidation');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'new manifest proves the staged closure and recovery resumes it（plan 07a41ec6：回执指针已退出证据链）',
    run: () => {
      const fixture = mkProject();
      try {
        const old = seedOldClosureBinding(fixture);
        let crashed = false;
        try { finalize(fixture, () => undefined, undefined, 'after_manifest_publish'); }
        catch (error) { crashed = (error as Error).message.includes('after_manifest_publish'); }
        assert(crashed, 'manifest crash was not injected');

        const published = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE);
        assert(Boolean(published), 'new manifest missing');
        assert(published!.fileSha256 !== old.manifestSha, 'new manifest did not replace the old binding');

        const recovered = finalize(fixture);
        assert(recovered.recovered_partial === true, 'new manifest transaction was not resumed');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed',
          'recovery did not publish the canonical summary');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'every closure publication cut is idempotently recoverable without stale rebinding',
    run: () => {
      const cuts = [
        'after_staged_summary',
        'after_manifest_publish',
        'after_receipt_pointer',
        'after_phase_state',
        'after_summary_rename',
      ] as const;
      for (const cut of cuts) {
        const fixture = mkProject();
        try {
          let crashed = false;
          try { finalize(fixture, () => undefined, undefined, cut); }
          catch (error) { crashed = (error as Error).message.includes(`simulated closure crash at ${cut}`); }
          assert(crashed, `${cut} did not inject crash`);
          const recovered = finalize(fixture);
          const publishedRaw = fs.readFileSync(fixture.summaryPath, 'utf8');
          assert(JSON.parse(publishedRaw).closure_status === 'closed', `${cut} did not close summary`);
          const loaded = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE);
          const rel = path.relative(fixture.root, fixture.summaryPath).replace(/\\/g, '/');
          assert(
            loaded?.manifest.outputs.find((output) => output.path === rel)?.sha256 === sha256(publishedRaw),
            `${cut} manifest does not bind canonical summary`,
          );
          assert(!finalize(fixture).transitioned, `${cut} repeat was not idempotent`);
          if (cut === 'after_manifest_publish' || cut === 'after_receipt_pointer') {
            assert(recovered.recovered_partial === true, `${cut} did not resume the published transaction`);
          }
        } finally {
          fs.rmSync(fixture.root, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: 'receipt is absent before closure and projected only after summary closes; projection failure is WARN-only',
    run: () => {
      const absent = mkProject();
      try {
        fs.unlinkSync(absent.receiptPath);
        const result = finalize(absent);
        assert(result.summary.closure_status === 'closed', 'summary should close without receipt input');
        assert(fs.existsSync(absent.receiptPath), 'closed summary should best-effort project receipt');
        assert(/receipt_schema:\s*"2\.1"/.test(fs.readFileSync(absent.receiptPath, 'utf8')), 'expected 2.1 projection');
      } finally {
        fs.rmSync(absent.root, { recursive: true, force: true });
      }

      const unwritable = mkProject();
      try {
        fs.unlinkSync(unwritable.receiptPath);
        fs.mkdirSync(unwritable.receiptPath);
        const result = finalize(unwritable);
        assert(result.summary.closure_status === 'closed', 'receipt projection failure must not roll back closure');
        assert(Boolean(result.receipt_projection_error), 'projection failure must be returned as warning detail');
        assert(JSON.parse(fs.readFileSync(unwritable.summaryPath, 'utf8')).closure_status === 'closed', 'closed summary must remain durable');
      } finally {
        fs.rmSync(unwritable.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'live closure mutex rejects a concurrent finalizer',
    run: () => {
      const fixture = mkProject();
      try {
        const lockPath = `${fixture.summaryPath}.finalize.lock`;
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
        let message = '';
        try { finalize(fixture); } catch (error) { message = (error as Error).message; }
        assert(message.includes('closure finalization busy'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === fixture.originalSummary, 'busy finalizer mutated summary');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'stale closure mutex is recovered before finalization',
    run: () => {
      const fixture = mkProject();
      try {
        const lockPath = `${fixture.summaryPath}.finalize.lock`;
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, created_at: '2000-01-01T00:00:00.000Z' }));
        const result = finalize(fixture);
        assert(result.transitioned, 'stale lock was not recovered');
        assert(!fs.existsSync(lockPath), 'closure mutex leaked after finalization');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
