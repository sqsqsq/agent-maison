import { beginUnitCase, discoveryResult } from '../utils/unit-cases';
// phase-evidence-manifest.unit.test.ts — t8 阶段证据快照（goal-fakepass-hardening）
//
// 覆盖面（openspec harness-gates/feature-artifact-layout delta）：
//   - loader 表一致性（inputs 与 spec-loader REQUIRED/OPTIONAL 同源，无第二手写表）
//   - 无环封装：回执/manifest 自身禁入集合；aggregate 不含时间戳
//   - staleness 重算：业务输入/输出与环境变更、回执投影不参与、缺 manifest、下游传染

import assert from 'assert';
import * as crypto from 'node:crypto';
import { receiptPathForPhase, writeReceiptManifestPointer } from '../utils/completion-chain-seed';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, resolveFeatureArtifact, featurePhaseReportsDir } from '../../config';
import { phaseManifestBindsRuntimeArtifacts } from '../../scripts/utils/runtime-step-evidence';
import {
  REQUIRED_FEATURE_FILES_BY_PHASE,
  OPTIONAL_FEATURE_FILES_BY_PHASE,
} from '../../scripts/utils/spec-loader';
import {
  loadPhaseEvidenceManifest,
  phaseEvidenceManifestPath,
  recomputePhaseEvidenceStaleness,
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  verifyPhaseEvidenceManifestWithStagedOutputs,
  sha256File,
  phaseEvidenceBusinessInputs,
  phaseEvidenceManifestCandidatePaths,
  recomputeManifestAggregate,
} from '../../scripts/utils/phase-evidence-manifest';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import { computeRequirementSsotAggregate } from '../../scripts/utils/verify-feature-completion';
import { resolveFactsAbsPath, factsBaselineFingerprint, projectFactsForPhase, type FactsInvocationContext } from '../../scripts/utils/context-facts';
import { buildVerifierMaterialView, verifierMaterialFileMatchesCurrent, verifierMaterialsEquivalent } from '../../scripts/utils/verifier-material';
import { stableStringify } from '../../scripts/utils/phase-evidence-manifest';
import type { Phase } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'ev-manifest-fixture';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-evman-'));
  clearFrameworkConfigCache();
  return root;
}

function writeArtifact(root: string, name: string, content: string): string {
  const p = resolveFeatureArtifact(root, FEATURE, name).canonicalPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

function writeReceipt(root: string, phase: string, body: string): string {
  const p = receiptPathForPhase(root, FEATURE, phase);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf-8');
  return p;
}

function seedSpecPhase(root: string): void {
  writeArtifact(root, 'spec.md', '# spec v1\n');
  writeArtifact(root, 'acceptance.yaml', 'criteria: []\n');
  writeReceipt(root, 'spec', 'feature: "x"\nphase: "spec"\nverdict: PASS\n');
}

const FIXED_NOW = () => new Date('2026-07-13T00:00:00.000Z');

/** 生产 writer 生成 manifest；测试 helper 附历史回执 shape，指针不参与 freshness。 */
function writeManifestWithPointer(root: string, phase: string): void {
  const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: phase as Phase, now: FIXED_NOW }));
  writeReceiptManifestPointer(root, FEATURE, phase, `doc/features/${FEATURE}/${phase}/reports/phase-evidence-manifest.json`, written.sha256);
}

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: 'P4 a21473 testing proposal binds exact future runtime receipt and trace; absence or changed bytes still fails',
    run: () => {
      const root = mkProject();
      try {
        const reports = featurePhaseReportsDir(root, FEATURE, 'testing');
        fs.mkdirSync(reports, { recursive: true });
        const trace = path.join(reports, 'round/hylyre/trace.json');
        fs.mkdirSync(path.dirname(trace), { recursive: true }); fs.writeFileSync(trace, '{"cases":[]}\n');
        const proposal = { trace_path: trace, goal_run_id: 'actual-run', attempt_id: 'actual-attempt' };
        const receipt = path.join(reports, 'device-test-evidence.json');
        const manifest = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'testing', deviceTestEvidence: proposal });
        writePhaseEvidenceManifest(root, manifest);
        assert(phaseManifestBindsRuntimeArtifacts(root, FEATURE, proposal as never)?.includes('device-test-evidence.json'), 'proposal alone does not prove publication');
        fs.writeFileSync(receipt, JSON.stringify(proposal, null, 2) + '\n');
        assert.equal(phaseManifestBindsRuntimeArtifacts(root, FEATURE, proposal as never), null);
        fs.writeFileSync(receipt, JSON.stringify({ ...proposal, attempt_id: 'other-attempt' }, null, 2) + '\n');
        assert(phaseManifestBindsRuntimeArtifacts(root, FEATURE, proposal as never)?.includes('device-test-evidence.json'));
        fs.writeFileSync(receipt, JSON.stringify(proposal, null, 2) + '\n');
        fs.appendFileSync(trace, 'changed');
        assert(phaseManifestBindsRuntimeArtifacts(root, FEATURE, proposal as never)?.includes('trace.json'));
      } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  ...(['canonical-summary', 'environment'] as const).map(identity => ({
    name: `8d4e6a21 C2 new evidence without control inputs detects inline requirement drift through ${identity} in default/staged readers`,
    run: () => {
      const root = mkProject();
      const priorRun = process.env.MAISON_GOAL_RUN_ID;
      try {
        delete process.env.MAISON_GOAL_RUN_ID;
        seedSpecPhase(root);
        const runDir = path.join(root, `doc/features/${FEATURE}/goal-runs/R1`);
        fs.mkdirSync(runDir, { recursive: true });
        const control = path.join(runDir, 'manifest.json');
        const goal = { requirement: 'inline requirement A', visual_provider_pin: { adapter: 'claude', model: 'old' } };
        fs.writeFileSync(control, JSON.stringify(goal));
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{"type":"run_start"}\n');
        if (identity === 'canonical-summary') {
          const summary = path.join(featurePhaseReportsDir(root, FEATURE, 'spec'), 'summary.json');
          fs.mkdirSync(path.dirname(summary), { recursive: true });
          fs.writeFileSync(summary, JSON.stringify({ feature: FEATURE, phase: 'spec', run_id: 'R1' }));
        } else process.env.MAISON_GOAL_RUN_ID = 'R1';
        const evidence = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec',
          requirementSha: computeRunRequirementSha(root, FEATURE, 'R1') });
        assert(!evidence.inputs.some(entry => entry.path.includes('/goal-runs/')), '新证据不含退休控制输入');
        writePhaseEvidenceManifest(root, evidence);
        const normal = (runId?: string) => recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], runId ? { runId } : undefined)[0];
        const staged = (runId?: string) => verifyPhaseEvidenceManifestWithStagedOutputs({ projectRoot: root, feature: FEATURE,
          phase: 'spec', stagedOutputs: [], ...(runId ? { runId } : {}) });
        assert.strictEqual(normal().verdict, 'fresh'); assert.strictEqual(staged().verdict, 'fresh');
        fs.writeFileSync(control, JSON.stringify({ ...goal, visual_provider_pin: { adapter: 'codex', model: 'new' } }));
        assert.strictEqual(normal().verdict, 'fresh', 'provider-only 不改变需求');
        assert.strictEqual(staged().verdict, 'fresh', 'staged 同样不绑定控制字节');
        if (identity === 'canonical-summary') {
          const other = path.join(root, `doc/features/${FEATURE}/goal-runs/R2`);
          fs.mkdirSync(other, { recursive: true });
          fs.writeFileSync(path.join(other, 'manifest.json'), JSON.stringify({ requirement: 'inline requirement B' }));
          fs.writeFileSync(path.join(other, 'events.jsonl'), '{"type":"run_start"}\n');
          process.env.MAISON_GOAL_RUN_ID = 'R2';
          assert.strictEqual(normal().verdict, 'stale', '环境中的真实当前身份优先于产物原身份');
          assert.strictEqual(staged().verdict, 'stale');
          assert.strictEqual(normal('R1').verdict, 'fresh', '显式调用身份优先于环境身份');
          assert.strictEqual(staged('R1').verdict, 'fresh');
          delete process.env.MAISON_GOAL_RUN_ID;
        }
        fs.writeFileSync(control, JSON.stringify({ ...goal, requirement: 'inline requirement B' }));
        for (const result of [normal(), staged(), normal('R1'), staged('R1')]) {
          assert.strictEqual(result.verdict, 'stale');
          assert(result.changed_paths.includes('<environment:requirement>'), JSON.stringify(result));
        }
      } finally {
        if (priorRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = priorRun;
        clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true });
      }
    },
  })),
  {
    name: '8d4e6a21 C2 standalone without actual requirement identity does not borrow an unrelated historical run',
    run: () => {
      const root = mkProject();
      const priorRun = process.env.MAISON_GOAL_RUN_ID;
      try {
        delete process.env.MAISON_GOAL_RUN_ID;
        seedSpecPhase(root);
        const runDir = path.join(root, `doc/features/${FEATURE}/goal-runs/unrelated`);
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ requirement: 'unrelated requirement' }));
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{"type":"run_start"}\n');
        const summary = path.join(featurePhaseReportsDir(root, FEATURE, 'spec'), 'summary.json');
        fs.mkdirSync(path.dirname(summary), { recursive: true });
        fs.writeFileSync(summary, JSON.stringify({ feature: FEATURE, phase: 'spec' }));
        writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec', requirementSha: 'a'.repeat(64) }));
        assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'])[0].verdict, 'fresh');
        assert.strictEqual(verifyPhaseEvidenceManifestWithStagedOutputs({ projectRoot: root, feature: FEATURE, phase: 'spec', stagedOutputs: [] }).verdict, 'fresh');
      } finally {
        if (priorRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = priorRun;
        clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '8d4e6a21 legacy control input retires in freshness, staged closure, facts and writer; business drift remains stale',
    run: () => {
      const root = mkProject();
      try {
        seedSpecPhase(root);
        const run = 'R1';
        const runDir = path.join(root, `doc/features/${FEATURE}/goal-runs/${run}`);
        fs.mkdirSync(runDir, { recursive: true });
        const control = path.join(runDir, 'manifest.json');
        const source = path.join(root, 'doc/requirements/current.md');
        fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, 'business v1');
        const goal = { requirement: '需求见 doc/requirements/current.md', visual_provider_pin: { adapter: 'claude', model: 'old' } };
        fs.writeFileSync(control, JSON.stringify(goal));
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{"type":"run_start"}\n');
        const summary = path.join(featurePhaseReportsDir(root, FEATURE, 'spec'), 'summary.json');
        fs.mkdirSync(path.dirname(summary), { recursive: true });
        fs.writeFileSync(summary, JSON.stringify({ feature: FEATURE, phase: 'spec', run_id: run }));
        const opts = { runId: run, currentRequirementSha: computeRunRequirementSha(root, FEATURE, run)! };
        const old = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec', extraInputs: [control, source], requirementSha: opts.currentRequirementSha });
        writePhaseEvidenceManifest(root, old);
        const evidenceBytes = fs.readFileSync(phaseEvidenceManifestPath(root, FEATURE, 'spec'), 'utf8');
        const context: FactsInvocationContext = { subject: { feature: FEATURE, run_id: run }, first_phase: 'spec', source_paths: [], required_input_snippets: [],
          baseline: { established_by: 'spec', fingerprint: 'original', dependencies: old.inputs.map(entry => ({ path: path.resolve(root, entry.path), exists: entry.exists, sha256: entry.sha256, role: 'derive' })) } };
        const baseline = stableStringify(context);
        fs.writeFileSync(control, JSON.stringify({ ...goal, visual_provider_pin: { adapter: 'codex', model: 'new' } }));
        const business = phaseEvidenceBusinessInputs(root, FEATURE, old, opts);
        assert(!business.some(entry => path.resolve(root, entry.path) === control));
        assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], opts)[0].verdict, 'fresh');
        assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'])[0].verdict, 'fresh', '只读调用从同份产物的确切身份取得同一依据');
        assert.strictEqual(verifyPhaseEvidenceManifestWithStagedOutputs({ projectRoot: root, feature: FEATURE, phase: 'spec', stagedOutputs: [], ...opts }).verdict, 'fresh');
        const next = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec', factsContext: context, requirementSha: opts.currentRequirementSha });
        assert(!next.inputs.some(entry => path.resolve(root, entry.path) === control));
        assert(!phaseEvidenceManifestCandidatePaths({ projectRoot: root, feature: FEATURE, phase: 'spec', factsContext: context }).has(path.relative(root, control).replace(/\\/g, '/')));
        assert.strictEqual(stableStringify(context), baseline);
        assert.strictEqual(fs.readFileSync(phaseEvidenceManifestPath(root, FEATURE, 'spec'), 'utf8'), evidenceBytes);
        fs.writeFileSync(source, 'genuine business change');
        assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], { runId: run })[0].verdict, 'stale');
      } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: '8d4e6a21 retirement excludes explicit canonical manifest, outputs, null authority, missing runs and damaged aggregate',
    run: () => {
      const root = mkProject();
      try {
        seedSpecPhase(root);
        const runDir = path.join(root, `doc/features/${FEATURE}/goal-runs/R1`);
        fs.mkdirSync(runDir, { recursive: true });
        const control = path.join(runDir, 'manifest.json');
        const rel = path.relative(root, control).replace(/\\/g, '/');
        fs.writeFileSync(control, JSON.stringify({ requirement: 'inline' }));
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{"type":"run_start"}\n');
        const opts = { runId: 'R1', currentRequirementSha: computeRunRequirementSha(root, FEATURE, 'R1')! };
        const old = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec', extraInputs: [control], requirementSha: opts.currentRequirementSha });
        writePhaseEvidenceManifest(root, old);
        fs.writeFileSync(control, JSON.stringify({ requirement: 'inline', visual_provider_pin: { adapter: 'codex', model: 'new' }, requirement_source_files: [rel] }));
        assert(phaseEvidenceBusinessInputs(root, FEATURE, old, opts).some(entry => entry.path === rel), '显式规范控制路径也是业务来源');
        fs.writeFileSync(control, JSON.stringify({ requirement: 'inline', visual_provider_pin: { adapter: 'codex', model: 'new' } }));
        assert.strictEqual(phaseEvidenceBusinessInputs(root, FEATURE, old, { ...opts, currentRequirementSha: null }).length, old.inputs.length);
        for (const role of ['output', 'both'] as const) {
          const changed = structuredClone(old); changed.inputs.find(entry => entry.path === rel)!.role = role;
          assert(phaseEvidenceBusinessInputs(root, FEATURE, changed, opts).some(entry => entry.path === rel));
        }
        const damaged = structuredClone(old); damaged.inputs.find(entry => entry.path === rel)!.sha256 = 'tampered';
        writePhaseEvidenceManifest(root, damaged);
        assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], opts)[0].verdict, 'tampered');
        damaged.aggregate_sha256 = recomputeManifestAggregate(damaged);
        fs.rmSync(path.join(runDir, 'events.jsonl'));
        assert(phaseEvidenceBusinessInputs(root, FEATURE, old, opts).some(entry => entry.path === rel), '损坏 run 不属于退休集合');
      } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: '8d4e6a21 legacy no-scope completion retains inline requirement independently of provider',
    run: () => {
      const root = mkProject();
      try {
        const dir = path.join(root, `doc/features/${FEATURE}/goal-runs/R1`);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'manifest.json');
        fs.writeFileSync(file, JSON.stringify({ requirement: 'inline' }));
        fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"run_start"}\n');
        const hash = computeRequirementSsotAggregate(root, FEATURE, 'R1'); assert(hash);
        fs.writeFileSync(file, JSON.stringify({ requirement: 'inline', visual_provider_pin: { adapter: 'codex', model: 'new' } }));
        assert.strictEqual(computeRequirementSsotAggregate(root, FEATURE, 'R1'), hash);
        fs.writeFileSync(file, JSON.stringify({ requirement: 'genuine requirement change' }));
        assert.notStrictEqual(computeRequirementSsotAggregate(root, FEATURE, 'R1'), hash);
      } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: '实际消费同一源码的义务会失效，独立阶段继续可用',
    run: () => {
      const root = mkProject();
      try {
        const source = path.join(root, 'src', 'value.ts');
        const discovery = path.join(root, 'src', 'discovery.ts');
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.writeFileSync(source, 'before');
        fs.writeFileSync(discovery, 'candidate');
        const facts: FactsInvocationContext = { subject: { feature: FEATURE, run_id: 'R1' }, first_phase: 'plan',
          source_paths: ['src/discovery.ts'], required_input_snippets: [], source_owners: { 'src/discovery.ts': 'coding' } };
        for (const phase of ['plan', 'coding', 'ut'] as const) {
          writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase,
            factsContext: facts, extraInputs: phase === 'plan' ? [] : [source] }));
        }
        fs.writeFileSync(discovery, 'parallel request change');
        assert.deepStrictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['plan', 'coding', 'ut']).map(row => row.verdict), ['fresh', 'fresh', 'fresh']);
        fs.writeFileSync(source, 'after');
        const current = recomputePhaseEvidenceStaleness(root, FEATURE, ['plan', 'coding', 'ut'], { pendingOwnerPhase: 'coding' });
        assert.deepStrictEqual(current.map(row => row.verdict), ['fresh', 'stale', 'stale']);
        for (const change of current.slice(1)) assert.deepStrictEqual(change.changed_paths, ['src/value.ts']);
      } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'facts 绑定建立阶段，普通和 staged 新鲜度同判',
    run: () => {
      const root = mkProject();
      const factsContext: FactsInvocationContext = { subject: { feature: FEATURE, run_id: 'run' }, first_phase: 'coding', source_paths: [], required_input_snippets: [] };
      const file = resolveFactsAbsPath(root, FEATURE, factsContext);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const base = '---\nschema_version: "1.1"\nfeature: ' + FEATURE + '\nestablished_by: coding\n---\n## Code Facts\nbase fact\n';
      const coding = '\n## phase_delta: coding\noriginal coding fact\n';
      const review = '\n## phase_delta: review\nnone\n';
      const assertVerdict = (phase: string, verdict: string): void => {
        assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, [phase])[0].verdict, verdict);
        assert.strictEqual(verifyPhaseEvidenceManifestWithStagedOutputs({ projectRoot: root, feature: FEATURE, phase, stagedOutputs: [] }).verdict, verdict);
      };
      fs.writeFileSync(file, base + coding);
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'coding', factsContext }));
      assertVerdict('coding', 'fresh');
      fs.appendFileSync(file, review);
      assertVerdict('coding', 'fresh');
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'review', factsContext: { ...factsContext, baseline: { established_by: 'coding', fingerprint: factsBaselineFingerprint(base), dependencies: [] } } }));
      fs.appendFileSync(file, '\n## phase_delta: testing\nnone\n');
      assertVerdict('coding', 'fresh');
      assertVerdict('review', 'fresh');
      fs.writeFileSync(file, base + coding + review.replace('none', 'changed review fact'));
      assertVerdict('coding', 'fresh');
      assertVerdict('review', 'fresh');
      fs.writeFileSync(file, base + coding.replace('original', 'changed') + review);
      assertVerdict('coding', 'stale');
      fs.writeFileSync(file, base.replace('base fact', 'changed base') + coding + review);
      assertVerdict('coding', 'stale');
      assertVerdict('review', 'fresh');
    },
  },
  {
    name: 'facts 的弃用阅读计数不改变当前证据，保留原件等价与实际业务输入',
    run: () => {
      const root = mkProject();
      try {
        const phase = 'coding';
        const factsContext: FactsInvocationContext = { subject: { feature: FEATURE, run_id: 'run' },
          first_phase: phase, required_input_snippets: [], source_paths: ['src/value.ts'] };
        const file = resolveFactsAbsPath(root, FEATURE, factsContext);
        const relative = path.relative(root, file).replace(/\\/g, '/');
        const source = path.join(root, 'src/value.ts');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.writeFileSync(source, 'export const value = 42;');
        const raw = ['---', 'schema_version: "1.1"', 'feature: ' + FEATURE, 'run_id: run', 'established_by: coding',
          'ready_to_produce: true', 'files_inspected_count: 1', 'source_code_paths: [src/value.ts]', 'decisions_unlocked: [verify value]',
          '---', '## Code Facts', 'The accepted value is 42.', '', '## phase_delta: coding', 'Current implementation verified.', ''].join('\n');
        fs.writeFileSync(file, raw);
        const manifest = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase, factsContext, extraInputs: [source] });
        const material = () => buildVerifierMaterialView({ projectRoot: root, feature: FEATURE, phase, factsContext, gateFingerprint: null,
          phaseRuleText: '', templateText: '', checks: [], contextFiles: [{ label: 'src/value.ts', content: 'Current source' }] });
        const currentView = material();
        const legacy = structuredClone(manifest);
        const oldHash = crypto.createHash('sha256').update(JSON.stringify([factsBaselineFingerprint(raw), projectFactsForPhase(raw, phase).delta])).digest('hex');
        legacy.outputs.find(entry => entry.path === relative)!.sha256 = oldHash;
        legacy.aggregate_sha256 = recomputeManifestAggregate(legacy);
        const oldView = { ...currentView, files: currentView.files.map(entry => entry.path === relative ? { ...entry, sha256: oldHash } : entry) };
        writePhaseEvidenceManifest(root, legacy);
        assert.equal(recomputePhaseEvidenceStaleness(root, FEATURE, [phase])[0].verdict, 'fresh', 'exact old original remains usable');
        assert(verifierMaterialsEquivalent(oldView, currentView, root), 'old verifier view uses the same original content');

        writePhaseEvidenceManifest(root, manifest);
        fs.writeFileSync(file, raw.replace('files_inspected_count: 1', 'files_inspected_count: 9'));
        assert.equal(recomputePhaseEvidenceStaleness(root, FEATURE, [phase])[0].verdict, 'fresh');
        assert.equal(material().material_sha256, currentView.material_sha256);
        assert(verifierMaterialFileMatchesCurrent({ projectRoot: root, feature: FEATURE, material: currentView, file: relative }));

        fs.writeFileSync(source, 'export const value = 99;');
        assert.deepStrictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, [phase])[0].changed_paths, ['src/value.ts']);
        assert.notEqual(material().material_sha256, currentView.material_sha256);
        fs.writeFileSync(source, 'export const value = 42;');
        for (const changed of [
          raw.replace('accepted value is 42', 'accepted value is 99'),
          raw.replace('source_code_paths: [src/value.ts]', 'source_code_paths: [src/another.ts]'),
          raw.replace('run_id: run', 'run_id: other'),
        ]) {
          fs.writeFileSync(file, changed);
          assert.deepStrictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, [phase])[0].changed_paths, [relative]);
          assert(!verifierMaterialFileMatchesCurrent({ projectRoot: root, feature: FEATURE, material: currentView, file: relative }));
        }
      } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: '实际输入在发布前变化时不会被当前字节冒充',
    run: () => {
      const root = mkProject();
      try {
        const source = path.join(root, 'source.ts'); fs.writeFileSync(source, 'before');
        const dep = { path: source, exists: true, sha256: sha256File(source), role: 'derive' as const };
        const binding = { input_id: 'code', source: { kind: 'derive' as const, provider_id: 'derive.codebase' as const },
          content_fingerprint: 'a'.repeat(64), dependencies: [dep], source_refs: ['source.ts'] };
        const context = { schema_version: '1.1' as const, subject: { feature: FEATURE }, obligations: {}, required_outputs: [] };
        const resolvedInputs: import('../../scripts/utils/capability-resolution').ResolvedPhaseInputs = {
          context, phase: 'coding', values: { code: { state: 'resolved', binding, value: [] } }, artifacts: {},
        };
        const opts = { projectRoot: root, feature: FEATURE, phase: 'coding', resolvedInputs };
        const publishers = [() => resolvePhaseEvidenceManifest(opts), () => buildVerifierMaterialView({ ...opts, gateFingerprint: null, phaseRuleText: '', templateText: '', checks: [], contextFiles: [] })];
        for (const publish of publishers) assert.doesNotThrow(publish);
        fs.writeFileSync(source, 'after');
        for (const publish of publishers) assert.throws(publish, /input binding stale/);
      } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'inputs 与 spec-loader 表同源（review：REQUIRED 全入，OPTIONAL 仅存在才入）',
    run: () => {
      const root = mkProject();
      for (const f of REQUIRED_FEATURE_FILES_BY_PHASE.review!) writeArtifact(root, f, `${f} v1\n`);
      // OPTIONAL review=[spec.md] 已存在（REQUIRED plan 集里没写也行——这里显式建）
      const m = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'review' as Phase, now: FIXED_NOW });
      const inputBases = m.inputs.map((e) => path.basename(e.path)).sort();
      const expected = [...new Set([
        ...REQUIRED_FEATURE_FILES_BY_PHASE.review!,
        ...OPTIONAL_FEATURE_FILES_BY_PHASE.review!.filter((f) =>
          resolveFeatureArtifact(root, FEATURE, f).exists),
      ])].sort();
      // review-report.md 是 outputs overlay，不应混进 inputs-only 视图
      assert.deepStrictEqual(inputBases.filter((b) => b !== 'review-report.md'), expected);
      assert.ok(m.inputs.every((e) => e.exists && e.sha256), 'REQUIRED 输入均已落哈希');
    },
  },
  {
    name: 'outputs overlay：spec.md 同为 spec 阶段输入与产出 → role=both 两侧可见',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      const m = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW });
      const specIn = m.inputs.find((e) => path.basename(e.path) === 'spec.md');
      const specOut = m.outputs.find((e) => path.basename(e.path) === 'spec.md');
      assert.ok(specIn && specOut, 'spec.md 在两侧');
      assert.strictEqual(specIn!.role, 'both');
    },
  },
  {
    name: 'role=both stale 诊断按 normalized path 去重',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writeManifestWithPointer(root, 'spec');
      const specPath = resolveFeatureArtifact(root, FEATURE, 'spec.md').actualPath;
      fs.appendFileSync(specPath, '# changed once\n', 'utf-8');
      const result = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'])[0];
      assert.strictEqual(result.verdict, 'stale');
      const specChanges = result.changed_paths.filter((p) => p.endsWith('/spec.md'));
      assert.strictEqual(specChanges.length, 1, `role=both 路径不得重复：${result.changed_paths.join(',')}`);
    },
  },
  {
    name: '自引用环防线：回执/manifest 自身进集合即 throw',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      assert.throws(
        () => resolvePhaseEvidenceManifest({
          projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW,
          extraOutputs: [receiptPathForPhase(root, FEATURE, 'spec')],
        }),
        /自引用环/,
      );
      assert.throws(
        () => resolvePhaseEvidenceManifest({
          projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW,
          extraInputs: [phaseEvidenceManifestPath(root, FEATURE, 'spec')],
        }),
        /自引用环/,
      );
    },
  },
  {
    name: 'aggregate 不含时间戳：不同 now 生成的 aggregate 相同；manifest 文件哈希≠aggregate（不自 hash）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      const m1 = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW });
      const m2 = resolvePhaseEvidenceManifest({
        projectRoot: root, feature: FEATURE, phase: 'spec' as Phase,
        now: () => new Date('2027-01-01T00:00:00.000Z'),
      });
      assert.strictEqual(m1.aggregate_sha256, m2.aggregate_sha256);
      const written = writePhaseEvidenceManifest(root, m1);
      const loaded = loadPhaseEvidenceManifest(root, FEATURE, 'spec');
      assert.ok(loaded, '可回读');
      assert.strictEqual(loaded!.fileSha256, written.sha256);
      assert.notStrictEqual(loaded!.fileSha256, m1.aggregate_sha256);
      assert.strictEqual(loaded!.manifest.aggregate_sha256, m1.aggregate_sha256);
    },
  },
  {
    name: 'staleness：fresh → 改输入文件 → stale 且指名路径',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writeManifestWithPointer(root, 'spec');
      let r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'fresh');
      const acc = resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').actualPath;
      fs.appendFileSync(acc, 'tampered: true\n', 'utf-8');
      r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'stale');
      assert.ok(r[0].changed_paths.some((p2) => p2.endsWith('acceptance.yaml')));
    },
  },
  {
    name: 'tamper（codex 五轮 P0 复现）：改文件+同步改 entry 哈希留旧 aggregate → tampered 不洗白',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writeManifestWithPointer(root, 'spec');
      // 攻击：改 acceptance，再把 manifest 条目 hash 改成新值，保留旧 aggregate
      const acc = resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').actualPath;
      fs.appendFileSync(acc, 'tampered: true\n', 'utf-8');
      const mPath = phaseEvidenceManifestPath(root, FEATURE, 'spec');
      const doc = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
      const crypto = require('crypto') as typeof import('crypto');
      const newHash = crypto.createHash('sha256').update(fs.readFileSync(acc)).digest('hex');
      for (const e of [...doc.inputs, ...doc.outputs]) {
        if (e.path.endsWith('acceptance.yaml')) e.sha256 = newHash;
      }
      fs.writeFileSync(mPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'tampered', 'aggregate 重算必须抓住条目改写');
      assert.ok(r[0].integrity_errors!.some((e) => /aggregate 重算失配/.test(e)));
    },
  },
  {
    name: '需求血缘（codex 八轮 P0-2）：新 run 换需求→上游 closure stale（旧 closure 文件未变）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      // spec 闭环记录 R1 的 requirement sha
      const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
        projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW,
        requirementSha: 'req-A-sha',
      }));
      writeReceiptManifestPointer(root, FEATURE, 'spec', `doc/features/${FEATURE}/spec/reports/phase-evidence-manifest.json`, written.sha256);
      // 当前权威 requirement 仍是 A → fresh
      assert.strictEqual(
        recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], { currentRequirementSha: 'req-A-sha' })[0].verdict,
        'fresh',
      );
      // 新 run 换需求 B（closure 文件一字未改）→ stale
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], { currentRequirementSha: 'req-B-sha' });
      assert.strictEqual(r[0].verdict, 'stale');
      assert.ok(r[0].changed_paths.some((p2) => p2.includes('requirement')));
    },
  },
  {
    name: '需求血缘 fail-closed（codex 九轮 P0 复现）：记录为 null 的旧 closure 遇新需求 → stale（requirement_unbound）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      // 交互态闭环合法产生 requirement_sha256: null（不传 requirementSha）
      const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
        projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW,
      }));
      writeReceiptManifestPointer(root, FEATURE, 'spec', `doc/features/${FEATURE}/spec/reports/phase-evidence-manifest.json`, written.sha256);
      // 交互态消费（不传 current）→ fresh（合法）
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'])[0].verdict, 'fresh');
      // 新 goal 从中间阶段起链（传 current=req-B）→ 未绑定即 stale，不得 fresh
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], { currentRequirementSha: 'req-B-sha' });
      assert.strictEqual(r[0].verdict, 'stale', 'null 记录不得被新需求复用');
      assert.ok(r[0].changed_paths.some((p2) => p2.includes('requirement_unbound')));
    },
  },
  {
    name: '身份校验（codex 七轮 P2-1）：manifest.feature/phase 被重标 → tampered',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writeManifestWithPointer(root, 'spec');
      const mPath = phaseEvidenceManifestPath(root, FEATURE, 'spec');
      const doc = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
      doc.feature = 'other-feature'; // 跨 feature 搬运/重标
      // 重算 aggregate 使其自洽（只改身份，不改条目）
      fs.writeFileSync(mPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'tampered');
      assert.ok(r[0].integrity_errors!.some((e) => /feature 失配|aggregate/.test(e)));
    },
  },
  {
    name: 'plan 07a41ec6（codex review P0）：回执指针退出证据链——manifest 完整且无指针 → fresh；回执被投影重写 → 仍 fresh',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW }));
      // 不写指针
      let r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'fresh', JSON.stringify(r[0]));
      // 回执整文件被 harness 投影重写（无指针、正文变化）——不得使刚闭环的阶段自失效
      fs.writeFileSync(receiptPathForPhase(root, FEATURE, 'spec'), '---\nreceipt_schema: "2.1"\nfeature: "x"\n---\n', 'utf-8');
      r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'fresh', JSON.stringify(r[0]));
      assert.strictEqual(r[0].receipt_changed, false);
    },
  },
  {
    name: 'environment 重算（codex P0-5）：framework.config 变化 → stale',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ project_profile: { name: 'x' } }), 'utf-8');
      const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW }));
      writeReceiptManifestPointer(root, FEATURE, 'spec', 'doc/features/' + FEATURE + '/spec/reports/phase-evidence-manifest.json', written.sha256);
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'])[0].verdict, 'fresh');
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ project_profile: { name: 'y' } }), 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'stale');
      assert.ok(r[0].changed_paths.some((p2) => p2.includes('environment')));
    },
  },
  {
    name: 'reports 产出入保护面：summary.json 闭环后被改 FAIL→PASS → stale（codex 五轮 P1）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      const summaryPath = path.join(root, 'doc/features', FEATURE, 'spec', 'reports', 'summary.json');
      fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
      fs.writeFileSync(summaryPath, JSON.stringify({ verdict: 'FAIL' }), 'utf-8');
      const m = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW });
      assert.ok(m.outputs.some((e) => e.path.endsWith('reports/summary.json')), 'summary 在 outputs 保护面');
      writeManifestWithPointer(root, 'spec');
      fs.writeFileSync(summaryPath, JSON.stringify({ verdict: 'PASS' }), 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'stale');
      assert.ok(r[0].changed_paths.some((p2) => p2.endsWith('summary.json')));
    },
  },
  {
    name: 'staleness：相关依赖变化独立核实',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      for (const f of REQUIRED_FEATURE_FILES_BY_PHASE.plan!) {
        if (!resolveFeatureArtifact(root, FEATURE, f).exists) writeArtifact(root, f, `${f} v1\n`);
      }
      writeReceipt(root, 'plan', 'phase: "plan"\n');
      writeManifestWithPointer(root, 'spec');
      writeManifestWithPointer(root, 'plan');
      // plan 也消费 acceptance.yaml，直接重算同一依赖的字节。
      fs.appendFileSync(resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').actualPath, 'x: 1\n', 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec', 'plan']);
      assert.strictEqual(r[0].verdict, 'stale');
      assert.strictEqual(r[1].verdict, 'stale');
      assert.strictEqual(r[1].propagated_from, undefined);
      fs.rmSync(phaseEvidenceManifestPath(root, FEATURE, 'spec'));
      const r2 = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec', 'plan']);
      assert.strictEqual(r2[0].verdict, 'missing');
      assert.strictEqual(r2[1].verdict, 'stale');
      assert.strictEqual(r2[1].propagated_from, undefined);
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    const endUnitCase = beginUnitCase(`phase-evidence-manifest: ${c.name}`);
    if (!endUnitCase) return discoveryResult(`phase-evidence-manifest: ${c.name}`);
    try {
      c.run();
      return { name: `phase-evidence-manifest: ${c.name}`, ok: true };
    } catch (err) {
      return {
        name: `phase-evidence-manifest: ${c.name}`,
        ok: false,
        error: (err as Error).stack ?? (err as Error).message,
      };
    } finally { endUnitCase(); }
  });
}
