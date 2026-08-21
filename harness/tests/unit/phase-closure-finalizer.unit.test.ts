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
) {
  return finalizePhaseClosure({
    projectRoot: fixture.root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: FEATURE,
    phase: PHASE,
    receipt: {
      status: 'passed',
      receipt_path: path.relative(fixture.root, fixture.receiptPath).replace(/\\/g, '/'),
    },
    persistPhaseState,
    prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }),
    now: () => new Date('2026-07-30T00:00:00.000Z'),
    assessAfterCommit,
  });
}

function finalizeWithProductionEvidence(fixture: ReturnType<typeof mkProject>) {
  return finalizePhaseClosure({
    projectRoot: fixture.root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: FEATURE,
    phase: PHASE,
    receipt: {
      status: 'passed',
      receipt_path: path.relative(fixture.root, fixture.receiptPath).replace(/\\/g, '/'),
    },
    persistPhaseState: () => undefined,
    now: () => new Date('2026-07-30T00:00:00.000Z'),
  });
}
const cases: Case[] = [
  {
    name: 'production evidence binds the project files that PASS checks actually executed',
    run: () => {
      const fixture = mkProject();
      const outsideRel = `../outside-${path.basename(fixture.root)}.ts`;
      const outsideAbs = path.resolve(fixture.root, outsideRel);
      try {
        // 被执行的证明源码：真实存在的项目文件，由 PASS check 的 affected_files 点名。
        const executed = path.join(fixture.root, 'src', 'demo', 'Executed.ts');
        fs.mkdirSync(path.dirname(executed), { recursive: true });
        fs.writeFileSync(executed, 'export function proven(): boolean { return true; }\n', 'utf8');
        // 两个负例必须单变量：文件都真实存在，被拒的原因只能是「check 非 PASS」和
        // 「路径越出项目根」，而不是被"文件不存在"顺带滤掉。
        const notExecuted = path.join(fixture.root, 'src', 'demo', 'NotExecuted.ts');
        fs.writeFileSync(notExecuted, 'export function unproven(): boolean { return true; }\n', 'utf8');
        fs.writeFileSync(outsideAbs, 'export function outside(): boolean { return true; }\n', 'utf8');
        const reportPath = path.join(
          featurePhaseReportsDir(fixture.root, FEATURE, PHASE, FRAMEWORK_ROOT),
          'script-report.json',
        );
        fs.writeFileSync(reportPath, JSON.stringify({
          feature: FEATURE,
          phase: PHASE,
          summary: { verdict: 'PASS' },
          checks: [
            { id: 'proven', status: 'PASS', affected_files: ['src/demo/Executed.ts'] },
            { id: 'skipped', status: 'FAIL', affected_files: ['src/demo/NotExecuted.ts'] },
            { id: 'ghost', status: 'PASS', affected_files: ['src/demo/DoesNotExist.ts'] },
            { id: 'escape', status: 'PASS', affected_files: [outsideRel] },
          ],
        }, null, 2), 'utf8');
        finalizeWithProductionEvidence(fixture);
        const manifest = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE)!;
        const inputs = manifest.manifest.inputs.map((entry) => entry.path);
        // 没有这条绑定，改动被执行源码不会让任何阶段 stale，旧 PASS 报告会继续为其背书
        // （下游 component-closure-evidence.manifestTracksAuthority 正是消费它）。
        assert(inputs.includes('src/demo/Executed.ts'), `执行过的源码未进 manifest：${inputs.join(', ')}`);
        assert(fs.existsSync(notExecuted), 'NotExecuted.ts 未建出——该负例退化成"文件不存在"');
        assert(!inputs.some((p) => p.includes('NotExecuted')), '非 PASS check 的文件不得入证据链');
        assert(!inputs.some((p) => p.includes('DoesNotExist')), '不存在的文件不得入证据链');
        assert(fs.existsSync(outsideAbs), '越界文件未建出——该负例退化成"文件不存在"');
        assert(!inputs.some((p) => p.includes('outside')), '越出项目根的路径不得入证据链');
        const bound = manifest.manifest.inputs.find((entry) => entry.path === 'src/demo/Executed.ts')!;
        assert(bound.exists === true && typeof bound.sha256 === 'string', '被执行源码未按字节登记');
        fs.writeFileSync(executed, 'export function proven(): boolean { return false; }\n', 'utf8');
        const stale = require('../../scripts/utils/phase-evidence-manifest')
          .recomputePhaseEvidenceStaleness(fixture.root, FEATURE, [PHASE]);
        assert(stale[0].verdict !== 'fresh', '改动被执行源码后该阶段仍判 fresh');
      } finally {
        fs.rmSync(outsideAbs, { force: true });
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
    name: 'strict phase-state failure leaves canonical summary open',
    run: () => {
      const fixture = mkProject();
      try {
        let threw = false;
        try {
          finalize(fixture, () => { throw new Error('state denied'); });
        } catch (error) {
          threw = (error as Error).message.includes('state denied');
        }
        assert(threw, 'expected strict state error');
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === fixture.originalSummary, 'summary changed');
        const staged = fs.readdirSync(path.dirname(fixture.summaryPath))
          .filter((name) => name.includes('.staged-'));
        assert(staged.length === 0, `staged leftovers=${staged.join(',')}`);
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
    name: 'idempotent finalizer rebinds mismatched closed summary bytes without rewriting them',
    run: () => {
      const fixture = mkProject();
      try {
        finalize(fixture);
        const drifted = `${fs.readFileSync(fixture.summaryPath, 'utf8')}\n`;
        fs.writeFileSync(fixture.summaryPath, drifted, 'utf8');
        const rebound = finalize(fixture);
        assert(!rebound.transitioned && rebound.evidence_rebound === true, 'expected evidence rebind');
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === drifted, 'rebind rewrote closed summary');
        const loaded = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE);
        const rel = path.relative(fixture.root, fixture.summaryPath).replace(/\\/g, '/');
        const entry = loaded?.manifest.outputs.find((output) => output.path === rel);
        assert(entry?.sha256 === sha256(drifted), 'rebound manifest does not bind disk bytes');
        const stable = finalize(fixture);
        assert(stable.evidence_rebound === false, 'stable binding should short-circuit');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
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
