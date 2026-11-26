import { beginUnitCase } from '../utils/unit-cases';
import '../utils/transpile-only-env';
import { questioningRecoveryCases } from '../utils/questioning-recovery-cases';
import { questioningRealReplayCases } from '../utils/questioning-real-replay-cases';
import assert from 'assert';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { buildInitialDesignGoalManifest } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { casAcquireRunOwner, ensureRunControl, releaseRunOwner } from '../../scripts/utils/goal-run-control';
import { acceptSessionExecution, executionRequestForInvoke, issueSessionExecution, readSessionExecution } from '../../scripts/utils/session-execution-handoff';
import { capturePhaseInvocationSnapshot, hasSignedPhaseInputDrift, type PhaseWriteBoundaryResolution } from '../../scripts/utils/phase-write-boundary';
import { GoalPhaseRuntime } from '../../scripts/goal-phase-runtime';
import { DetachedGoalPhaseExecutor } from '../../scripts/utils/goal-phase-executor';
import { invokeAgentHeadless } from '../../scripts/utils/agent-invoke';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { designRepairTarget, designRepairSignature, runUnattendedDesignRepair, type DesignRepairBriefLike, type UnattendedDesignRepairInput } from '../../scripts/utils/design-repair-unattended';
import { blueprintSourceRefFiles } from '../../scripts/utils/blueprint-skill-projection';
import { prepareInitialDesignDraft, readInitialDesignDelivery } from '../../scripts/utils/initial-design-delivery';
import { readDesignQuestioningOriginal, recordDesignRepairInvocation, reusableDesignQuestioning } from '../../scripts/utils/design-repair-unattended';
import { fixture } from './blueprint-skill-projection.unit.test';
import { DISPOSITIONS } from '../../scripts/utils/component-blueprint-model';
import { renderQuestioningResultInstructions, validateBlueprintQuestioning } from '../../scripts/utils/blueprint-questioning';
import { validateChangeUnit } from '../../scripts/utils/change-unit-validator';
import { validateChangeUnitDesign } from '../../scripts/utils/change-unit-design-gate';
import { diagnoseBlueprintSkillAuthority } from '../../scripts/utils/blueprint-skill-projection';
import { designWorkSnapshot } from '../../scripts/utils/design-repair-unattended';
import { inspectGeneratedBlueprintGraphs } from '../../scripts/utils/blueprint-graph-generator';
import type { UnitCaseResult } from '../run-unit';
type Document = Record<string, any>;
const requirement = '在已准入账目蓝图的原目标内补齐CU设计引用，再继续账目刷新与恢复的完整交付；不得降低验收或修改框架。';
const read = (file: string): Document => YAML.parse(fs.readFileSync(file, 'utf8'));
const write = (file: string, value: unknown): void => fs.writeFileSync(file, YAML.stringify(value));

async function candidateWriteContract(): Promise<void> {
  for (const mode of ['cu', 'blueprint', 'legacy', 'canonical', 'other-cu', 'product', 'draft-input'] as const) {
    const host = fixture();
    let release: (() => void) | null = null;
    try {
      const architecture = loadFrameworkConfig(host.root).architecture;
      fs.writeFileSync(path.join(host.root, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: 'CandidateContract',
        project_profile: { name: 'hmos-app' }, active_workflow: 'obligation-driven', features_dir: 'doc/features', architecture }));
      clearFrameworkConfigCache();
      if (mode === 'blueprint' || mode === 'legacy') {
        const missingBusiness = read(host.blueprintFile); missingBusiness.design_views[0].purpose = '';
        write(host.blueprintFile, missingBusiness); host.bind();
      }
      if (mode === 'draft-input') {
        const relative = 'doc/features/ledger-app-blueprint/goal-runs/candidate-draft-input/design-repair/component-blueprint.yaml';
        const draft = path.join(host.root, relative);
        fs.mkdirSync(path.dirname(draft), { recursive: true }); fs.copyFileSync(host.blueprintFile, draft);
        const doc = read(host.blueprintFile); doc.provenance.source_ref = relative;
        write(host.blueprintFile, doc); host.bind();
      }
      const blueprint = loadCanonicalBlueprint(host.root, 'ledger-app-blueprint');
      const current = loadCanonicalChangeUnit(host.root, 'ledger-app-blueprint', 'ledger-refresh');
      const hasCu = !['blueprint', 'legacy'].includes(mode);
      if (hasCu) {
        const changed: Document = YAML.parse(fs.readFileSync(current.canonicalPath, 'utf8'));
        changed.blockers = [{ blocker_id: 'missing-module-owner-nodes', gate: 'design', owner: 'component-design', observation: 'machine',
          reason: '设计候选缺少当前模块归属', unlock_condition: '由原设计owner补齐并重签', source_refs: ['doc/requirement.md'],
          probe: { kind: 'contract', ref: 'doc/requirement.md', expected: '当前设计归属已闭合' } }];
        changed.blockers.push({ ...changed.blockers[0], blocker_id: 'execution-only-item', gate: 'execution' },
          { ...changed.blockers[0], blocker_id: 'different-owner-item', owner: 'external-design' });
        fs.writeFileSync(current.canonicalPath, YAML.stringify(changed));
      }
      const product = path.join(host.root, 'guarded-product.ts');
      fs.writeFileSync(product, 'export const preserved = true;\n');
      const targetFeature = hasCu ? deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh') : 'ledger-app-blueprint';
      const manifest = buildInitialDesignGoalManifest({ feature: 'ledger-app-blueprint', run_id: `candidate-${mode}`, adapter: 'claude', requirement,
        initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: [] },
        budget: { max_total_turns: 30, wall_clock_minutes: 120 }, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: host.root });
      const born = createGoalRun({ projectRoot: host.root, manifest, chain: [] });
      const runDir = path.dirname(born.manifestPath);
      const draftDir = path.join(runDir, 'design-repair');
      const edits: Partial<Record<typeof mode, { file: string; text: string }>> = {
        canonical: { file: current.canonicalPath, text: '\n# unauthorized canonical CU write\n' },
        'other-cu': { file: path.join(path.dirname(path.dirname(current.canonicalPath)), 'foreign-cu/change-unit.yaml'), text: 'unauthorized: true\n' },
        product: { file: product, text: '// unauthorized product write\n' },
        'draft-input': { file: path.join(draftDir, 'component-blueprint.yaml'), text: '\n# authorized draft output also referenced by source_ref\n' },
      };
      const edit = edits[mode];
      let invoked: string | undefined;
      const blueprintBytes = fs.readFileSync(blueprint.canonicalPath);
      const cuBytes = fs.readFileSync(current.canonicalPath);
      if (mode === 'cu') {
        const wrongBlueprint: Document = YAML.parse(cuBytes.toString('utf8'));
        wrongBlueprint.blueprint_id = 'wrong-blueprint';
        assert(validateChangeUnit(wrongBlueprint, { projectRoot: host.root, canonicalPath: current.canonicalPath }).some(issue => issue.severity === 'BLOCKER'));
        const wrongTarget: Document = YAML.parse(cuBytes.toString('utf8'));
        wrongTarget.design_refs[0].target.id = 'missing-real-target';
        assert(validateChangeUnitDesign(host.root, wrongTarget).issues.some(issue => issue.severity === 'BLOCKER'));
        const badContent: Document = YAML.parse(cuBytes.toString('utf8'));
        badContent.target_predicates[0].verification_refs = ['acceptance:AC-999999'];
        fs.writeFileSync(current.canonicalPath, YAML.stringify(badContent));
        assert(diagnoseBlueprintSkillAuthority(host.root, path.resolve(__dirname, '../../..'), targetFeature).findings.some(item => item.codes.includes('authority_acceptance_content_invalid')));
        fs.writeFileSync(current.canonicalPath, cuBytes);
        const badGraph: Document = structuredClone(blueprint.blueprint);
        badGraph.generated_graphs = [{ graph_id: 'bad-relation-graph', format: 'mermaid', source_view_id: 'logical', content: 'flowchart LR\n missing --> absent',
          node_refs: ['view:logical/node:missing'], relation_refs: ['relation:missing'] }];
        assert(inspectGeneratedBlueprintGraphs(badGraph).issues.some(issue => issue.severity === 'BLOCKER'), 'real declared relation-graph errors stay blocking');
      }
      const brief: DesignRepairBriefLike = { class: 'B2', items: [] };
      let recording: Array<{ file: string; line: string }> | undefined;
      const emit = (event: Record<string, unknown>) => {
        const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
        fs.appendFileSync(born.eventsPath, line); recording?.push({ file: born.eventsPath, line });
      };
      const result = await runUnattendedDesignRepair({ projectRoot: host.root, frameworkRoot: path.resolve(__dirname, '../../..'),
        feature: manifest.feature, designTarget: designRepairTarget(host.root, targetFeature), phase: 'initial-design', runId: manifest.run_id,
        reportDir: manifest.report_dir, ...(mode === 'legacy' ? {} : { requirement }), brief,
        signature: designRepairSignature(targetFeature, 'initial-design', brief.items), heldFeatureLock: null, runtimeWrites: [manifest.report_dir], emit,
        registerLockRelease: value => { release = value; }, recordEventLines: () => { const lines: Array<{ file: string; line: string }> = []; recording = lines; return () => { recording = undefined; return lines; }; },
        invoke: async (purpose, prompt, guard) => {
          if (purpose === 'questioning') {
            return { started: false, ok: false, status: 'waiting', detail: 'Independent questioning falls outside this author-write check.' };
          }
          assert(guard);
          const expected = [path.join(draftDir, 'component-blueprint.yaml'), ...(hasCu ? [path.join(draftDir, 'change-unit.yaml')] : []),
            ...(mode === 'legacy' ? [] : [path.join(draftDir, 'change-unit-candidates.json')]),
            ...(mode === 'legacy' ? [] : [path.join(draftDir, 'architecture.json')])];
          const list = prompt.split('本次唯一可写候选集合')[1].split('canonical 蓝图')[0];
          assert.deepEqual(list.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2)), expected);
          for (const file of expected) assert(fs.existsSync(file), 'every advertised candidate must be prepared by the transaction');
          assert(prompt.includes('canonical Change Unit') && prompt.includes('机器运行记录均只读'));
          assert(prompt.includes(`本事务真实基线：blueprint_id=ledger-app-blueprint；revision=${String(blueprint.blueprint.revision)}`));
          assert(prompt.includes(blueprint.artifactSha256) && prompt.includes('不豁免错蓝图、错目标') && prompt.includes('实际内容缺陷'));
          assert.equal(prompt.includes('待质询通过并发布最终蓝图字节后'), hasCu);
          assert(!prompt.includes('除草稿文件外') && !prompt.includes('同时可修改同目录'));
          if (hasCu) {
            assert(prompt.includes('当前CU候选身份：ledger-app-blueprint/ledger-refresh') && prompt.includes('missing-module-owner-nodes'));
            assert(prompt.includes('probe 未执行或不支持；fail-closed 保持 active') && prompt.includes('"active": true'));
            assert(!prompt.includes('execution-only-item') && !prompt.includes('different-owner-item'));
            assert(prompt.includes('可在当前候选中有据修正或移除过时设计阻断') && prompt.includes('不能伪造探针成功、添加active/resolved字段冒充机器结果'));
          }
          assert.deepEqual(fs.readFileSync(blueprint.canonicalPath), blueprintBytes);
          assert.deepEqual(fs.readFileSync(current.canonicalPath), cuBytes);
          if (!edit) return { started: true, ok: false, status: 'waiting', detail: 'Bounded candidate-prompt observation.' };
          const control = ensureRunControl(runDir, manifest.run_id);
          const owner = casAcquireRunOwner(runDir, manifest.run_id, control.current_epoch,
            { kind: 'session', owner_id: 'repair-author-test', lease_ms: 60_000 });
          assert(owner.ok);
          const program = [
            'const fs = require("node:fs"), path = require("node:path");',
            'const [file, text] = process.argv.slice(1);',
            'fs.mkdirSync(path.dirname(file), { recursive: true });',
            'fs.appendFileSync(file, text);',
            'const id = "edit-candidate";',
            'for (const row of [',
            '  { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Edit", input: { file_path: file } }] } },',
            '  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "Applied file edit." }] } },',
            ']) process.stdout.write(JSON.stringify(row) + "\\n");',
          ].join('\n');
          // Use the local model binary with the production invoker and stdout recorder.
          const executor = new DetachedGoalPhaseExecutor(context => {
            const issued = executionRequestForInvoke(runDir, context.attemptId);
            assert(issued, 'the runtime must sign this author before starting the model');
            return {
              plan: { argv: [process.execPath, '-e', program, edit.file, edit.text], label: 'local native author response' },
              cwd: host.root,
              options: { outputLogPath: path.join(runDir, path.dirname(issued.reference.path), 'agent-output.log'), toolEventCapture: 'structured_events' },
            };
          }, (plan, cwd, options) => invokeAgentHeadless({ argv: plan.argv, label: plan.label }, cwd, options));
          try {
            const outcome = await new GoalPhaseRuntime({ executor }).invokeDesignOwner(
              manifest, host.root, path.resolve(__dirname, '../../..'), owner.token, purpose, prompt, guard, emit);
            assert(outcome.ok && outcome.invokeId, JSON.stringify(outcome));
            invoked = outcome.invokeId;
            return outcome;
          } finally { releaseRunOwner(runDir, owner.token); }
        },
      });
      if (edit) {
        assert(invoked, JSON.stringify({ mode, result }));
        const issued = executionRequestForInvoke(runDir, invoked);
        assert(issued && issued.request.purpose === 'author');
        const rawOriginal = path.join(runDir, path.dirname(issued.reference.path), 'agent-events.jsonl');
        assert.match(fs.readFileSync(rawOriginal, 'utf8'), /"type":"tool_result","tool_use_id":"edit-candidate"/);
        const events: Document[] = fs.readFileSync(born.eventsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        assert(events.some(row => row.type === 'agent_invoke_end' && row.invoke_id === invoked && row.status === 'passed'));
        const pathChanged = path.relative(host.root, edit.file).replace(/\\/g, '/');
        const confirmed = events.find(row => row.type === 'phase_write_violation' && row.invoke_id === invoked)?.violations
          .filter((change: Document) => change.authority_confirmed && change.violation === 'outside_authority')
          .map((change: Document) => change.path);
        if (mode === 'draft-input') {
          assert(result.outcome === 'waiting', JSON.stringify({ mode, result }));
          assert.equal(result.step, 'questioning', JSON.stringify(result));
          assert.equal(confirmed, undefined);
        } else {
          assert(result.outcome === 'violation', JSON.stringify({ mode, result }));
          assert.equal(result.step, 'author');
          assert.deepEqual([...new Set(result.changes.map(change => change.path))], [pathChanged]);
          assert.deepEqual(confirmed, [pathChanged]);
          assert(fs.readFileSync(edit.file, 'utf8').endsWith(edit.text), 'transaction must retain the observed write as evidence');
        }
      } else {
        assert.equal(result.outcome, 'waiting', JSON.stringify({ mode, result }));
      }
      const instructions = renderQuestioningResultInstructions(blueprint.blueprint, 'independent');
      assert(instructions.some(line => line.includes(DISPOSITIONS.join(' / '))));
      const questionDoc: Document = structuredClone(blueprint.blueprint);
      const items = questionDoc.review_summary.questioning.items;
      for (const disposition of [...DISPOSITIONS, 'open']) {
        items[0].disposition = disposition;
        const errors = validateBlueprintQuestioning(questionDoc).filter(issue => issue.id === 'blueprint_questioning_disposition_invalid' && issue.path === '$.review_summary.questioning.items[0].disposition');
        assert.equal(errors.length > 0, disposition === 'open');
      }
    } finally {
      if (release) (release as () => void)();
      clearFrameworkConfigCache();
      const directory = fs.realpathSync(host.root);
      assert(directory.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

function actualWorkComparison(): void {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'design-work-')));
  try {
    const files = ['blueprint.yaml', 'cu.yaml', 'architecture.json', 'absent.yaml'].map(name => path.join(directory, name));
    const blueprint: Document = { artifact: 'component-blueprint@1', revision: 1, provenance: { observed_at: 'old' },
      review_summary: { admission: { status: 'blocker' }, questioning: { status: 'complete' } },
      design_views: [{ view_id: 'runtime', nodes: [{ id: 'business', revision: 1, provenance: { observed_at: 'business' } }] }] };
    const cu: Document = { artifact: 'change-unit@1', revision: 1, provenance: { observed_at: 'old' }, component_blueprint_ref: { blueprint_id: 'bp', revision: 1 }, design_refs: [], touches: [], goal: 'first' };
    write(files[0], blueprint); write(files[1], cu); write(files[2], { modules: ['one'] });
    const before = designWorkSnapshot(files);
    blueprint.revision++; blueprint.provenance.observed_at = 'new'; blueprint.review_summary.admission.status = 'pass'; blueprint.review_summary.questioning.status = 'incomplete';
    cu.revision++; cu.provenance.observed_at = 'new'; cu.component_blueprint_ref.revision++;
    write(files[0], blueprint); write(files[1], cu);
    assert.deepEqual(designWorkSnapshot(files), before, 'machine metadata alone cannot become business input progress');
    assert.equal(before[files[3]].exists, false, 'a missing file is a known absence');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function machineAdmissionCompatibility(): void {
  const { currentBlueprintSliceId, deriveBlueprintAdmission } = require('../../scripts/utils/blueprint-admission') as typeof import('../../scripts/utils/blueprint-admission');
  const { writeBackAdmission } = require('../../scripts/utils/design-repair-unattended') as typeof import('../../scripts/utils/design-repair-unattended');
  const base: Document = { artifact: 'component-blueprint@1', blueprint_id: 'legacy', contracts: [{}], decisions_and_gaps: { gaps: [] }, review_summary: { questioning: { status: 'complete' } } };
  assert.equal(currentBlueprintSliceId(base), 'legacy:current');
  const withGap = structuredClone(base);
  withGap.decisions_and_gaps.gaps = [{ gap_id: 'real-gap', status: 'blocker', needed_by: 'old-current', owner: 'design', unlock_condition: 'resolve the real dependency' }];
  const declaredGap = structuredClone(withGap.decisions_and_gaps.gaps[0]);
  writeBackAdmission(withGap, { projectRoot: os.tmpdir(), canonicalPath: path.join(os.tmpdir(), 'not-canonical.yaml') });
  assert.equal(withGap.review_summary.admission.current_slice.slice_id, 'legacy:current');
  assert.equal(withGap.decisions_and_gaps.gaps[0].needed_by, 'old-current');
  assert.deepEqual(withGap.review_summary.questioning, base.review_summary.questioning, 'machine slice preparation must retain old public Q answers');
  assert.equal(withGap.review_summary.admission.root_questions_complete, false, 'the old result cannot authorize the new association');
  assert.deepEqual(withGap.decisions_and_gaps.gaps[0], declaredGap, 'migration does not wash the declared blocker');
  withGap.review_summary.admission.current_slice.slice_id = 'original-number';
  assert.equal(currentBlueprintSliceId(withGap), 'original-number', 'existing associations keep their original ID');
  assert.equal(deriveBlueprintAdmission(withGap).status, 'pass', 'an explicitly future non-asset gap on an existing ID retains the old admission semantics');
}

function initialMachinePreparation(): void {
  const f = fixture();
  try {
    for (const unit of enumerateCanonicalChangeUnits(f.root, 'ledger-app-blueprint')) {
      fs.rmSync(unit.canonicalPath, { force: true });
    }
    const before = fs.readFileSync(f.blueprintFile, 'utf8');
    const original = read(f.blueprintFile);
    const input = { projectRoot: f.root, blueprintId: 'ledger-app-blueprint', sourceRefs: [], observedAt: '2026-10-29T00:00:00Z' };
    prepareInitialDesignDraft(input);
    assert.equal(prepareInitialDesignDraft(input).written, false, 'same machine preparation rewrites unchanged bytes');
    assert.deepEqual(read(f.blueprintFile).review_summary.questioning.items, original.review_summary.questioning.items);
    const preparedBytes = fs.readFileSync(f.blueprintFile, 'utf8');
    prepareInitialDesignDraft({ ...input, sourceRefs: ['framework.config.json'] });
    assert.equal(fs.readFileSync(f.blueprintFile, 'utf8'), preparedBytes, 'a later run request was inserted as an untraced business requirement');
    const manifest = buildInitialDesignGoalManifest({ feature: 'ledger-app-blueprint', run_id: 'machine-preparation', adapter: 'claude', requirement,
      initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: [] } }, { projectRoot: f.root });
    createGoalRun({ projectRoot: f.root, manifest, chain: [] });
    const pending = readInitialDesignDelivery({ projectRoot: f.root, frameworkRoot: path.resolve(__dirname, '../../..'), manifest,
      providerState: 'available', questioningCurrent: false });
    assert.equal(pending.kind, 'questioning', pending.issues.join('\n'));
    assert(pending.blueprintIssues?.some(issue => issue.id === 'blueprint_questioning_provider_missing'));
    assert.equal(fs.readFileSync(f.blueprintFile, 'utf8'), preparedBytes, 'a transient qualification erased original public Q answers');
    const changed = read(f.blueprintFile); changed.design_views[0].purpose += ' current business design';
    changed.component_id = 'author-chosen-id'; changed.blueprint_id = 'author-chosen-workspace'; changed.revision = 999;
    write(f.blueprintFile, changed);
    prepareInitialDesignDraft({ ...input, beforeBlueprint: before });
    const prepared = read(f.blueprintFile);
    assert.equal(prepared.component_id, original.component_id); assert.equal(prepared.blueprint_id, original.blueprint_id); assert.equal(prepared.revision, original.revision);
    assert.equal(prepared.review_summary.questioning.status, 'incomplete');
    assert.deepEqual(prepared.review_summary.questioning.items, original.review_summary.questioning.items, 'invalidating current qualification erased public answers');
    const observation = readInitialDesignDelivery({ projectRoot: f.root, frameworkRoot: path.resolve(__dirname, '../../..'), manifest, providerState: 'available' });
    assert.equal(observation.kind, 'questioning', observation.issues.join('\n'));
    assert(observation.blueprintIssues?.length && !observation.disposition?.completionEligible, 'full original diagnostics disappeared behind machine preparation');
    fs.writeFileSync(f.blueprintFile, 'invalid: [yaml');
    assert.equal(prepareInitialDesignDraft(input).written, false);
    assert.equal(fs.readFileSync(f.blueprintFile, 'utf8'), 'invalid: [yaml', 'bad author original was replaced with an invented blank blueprint');
  } finally { assert(fs.realpathSync(f.root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep)); fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}

function questioningReuseProof(): void {
  const f = fixture();
  try {
    const codeFile = path.join(f.root, 'src/ledger/LedgerRepository.ts');
    fs.mkdirSync(path.dirname(codeFile), { recursive: true });
    fs.writeFileSync(codeFile, 'export class LedgerRepository {}\n');
    const beforeBlueprint = fs.readFileSync(f.blueprintFile, 'utf8'), blueprint = read(f.blueprintFile);
    const previous = structuredClone(blueprint.review_summary.questioning);
    const resolution = { projectRoot: f.root, protectedRoots: fs.readdirSync(f.root), executionRole: 'verifier' as const };
    const preSnapshot = capturePhaseInvocationSnapshot(resolution, { includeFiles: blueprintSourceRefFiles(f.root, blueprint) });
    const postSnapshot = capturePhaseInvocationSnapshot(resolution, { includeFiles: blueprintSourceRefFiles(f.root, blueprint) });
    assert.equal(preSnapshot.failureReason, null);
    const input = { projectRoot: f.root, blueprintPath: f.blueprintFile, blueprint, beforeBlueprint,
      output: JSON.stringify(previous), providerId: 'design-repair-questioning', completed: true, preSnapshot, postSnapshot, previous };
    const runDir = path.join(f.root, 'questioning-original');
    const invoke = { phase: 'design-repair-questioning', invoke_id: 'design-repair-questioning-i1' };
    const phaseDir = path.join(runDir, 'phases', invoke.phase, invoke.invoke_id);
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'blueprint-before.yaml'), beforeBlueprint);
    recordDesignRepairInvocation(runDir, 'questioning', invoke.invoke_id, {
      started: true, ok: true, detail: 'controlled independent answer', output: input.output, preSnapshot, postSnapshot,
    });
    const start = { ...invoke, type: 'agent_invoke_start' };
    const ended = { ...invoke, type: 'agent_invoke_end', exit_code: 0, status: 'passed' };
    const returned = readDesignQuestioningOriginal(runDir, start, [start, ended], f.root);
    assert(returned?.completed && returned.output === input.output);
    const drift = { ...invoke, type: 'phase_write_violation',
      violations: [{ path: path.relative(f.root, f.blueprintFile), violation: 'signed_input_drift', authority_confirmed: false }] };
    const diagnostic = readDesignQuestioningOriginal(runDir, start, [start, ended, drift], f.root);
    assert(diagnostic && !diagnostic.completed && diagnostic.output === input.output, 'unconfirmed drift keeps the raw answer for diagnosis only');
    assert.equal(reusableDesignQuestioning({ ...diagnostic, projectRoot: f.root, blueprintPath: f.blueprintFile, blueprint }), null);
    const forbidden = { ...drift, violations: [{ ...drift.violations[0], violation: 'outside_authority', authority_confirmed: true }] };
    assert.equal(readDesignQuestioningOriginal(runDir, start, [start, ended, forbidden], f.root), null,
      'a confirmed out-of-scope write cannot grant any questioning result');

    const reused = reusableDesignQuestioning(input);
    assert(reused, 'real clean snapshots and the same business input should retain the old result');
    assert.deepEqual(reused.items, previous.items, 'trusted old machine IDs or substantive answers changed');
    const metadata = structuredClone(blueprint); metadata.revision++; metadata.provenance.observed_at = '2030-01-01T00:00:00Z';
    assert(reusableDesignQuestioning({ ...input, blueprint: metadata }), 'machine identity/time changes should not repurchase Q');
    assert.equal(reusableDesignQuestioning({ ...input, completed: false }), null, 'an unfinished invocation became a reusable Q');
    assert.equal(reusableDesignQuestioning({ ...input, preSnapshot: undefined }), null, 'missing input binding invented a reuse proof');
    const changed = structuredClone(blueprint); changed.design_views[0].purpose += ' actual changed scope';
    assert.equal(reusableDesignQuestioning({ ...input, blueprint: changed }), null, 'changed business content reused a prior verdict');
    const narrative = structuredClone(blueprint); narrative.review_summary.summary += ' changed human review narrative';
    assert.equal(reusableDesignQuestioning({ ...input, blueprint: narrative }), null, 'changed Q reading material reused a prior verdict');
    const denied = structuredClone(previous); denied.items[0].disposition = 'blocker';
    denied.items[0].question = '真实否定是否送达？'; denied.items[0].answer = '保留原问题与依据。';
    const fenced = 'I completed the independent review.\n```json\n' + JSON.stringify(denied) + '\n```';
    const realDenial = reusableDesignQuestioning({ ...input, output: fenced, blueprint: changed });
    assert(realDenial && (realDenial.items as Document[])[0].answer === denied.items[0].answer, 'a real denial must reach an author even after author content changes');
    assert.equal(reusableDesignQuestioning({ ...input, output: '我已完成检查' }), null, 'prose without an object is not a result');
    const candidate = path.join(f.root, 'candidate.json'); fs.writeFileSync(candidate, '{"business":"current"}');
    assert.equal(reusableDesignQuestioning({ ...input, additionalInputs: { [candidate]: '{"business":"reviewed"}' } }), null,
      'an unreviewed author candidate cannot publish using the old pass');
    assert(reusableDesignQuestioning({ ...input, output: fenced, additionalInputs: { [candidate]: '{"business":"reviewed"}' } }),
      'candidate freshness must not prevent a denial from reaching the author');
    const dependency = blueprintSourceRefFiles(f.root, blueprint).find(file => file !== f.blueprintFile)!;
    const dependencyBytes = fs.readFileSync(dependency);
    fs.appendFileSync(dependency, '\n');
    assert(reusableDesignQuestioning(input), 'external evidence changes do not change the reviewed author content');
    fs.writeFileSync(dependency, dependencyBytes);
    assert(reusableDesignQuestioning(input));
    fs.unlinkSync(codeFile);
    assert(reusableDesignQuestioning(input), 'a removed external reference does not invalidate unchanged reviewed author content');
  } finally { assert(fs.realpathSync(f.root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep)); fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}

async function rebindQuestioningAfterSignedDrift(): Promise<void> {
  const f = fixture();
  let release: (() => void) | null = null;
  try {
    const blueprintId = 'ledger-app-blueprint';
    const frameworkRoot = path.resolve(__dirname, '../../..');
    const architecture = loadFrameworkConfig(f.root).architecture;
    fs.writeFileSync(path.join(f.root, 'framework.config.json'), JSON.stringify({ schema_version: '1.0',
      project_name: 'QuestioningRebind', project_profile: { name: 'hmos-app' }, active_workflow: 'obligation-driven',
      features_dir: 'doc/features', architecture }));
    clearFrameworkConfigCache();
    const relativeSource = 'src/ledger/LedgerRepository.ts';
    const source = path.join(f.root, relativeSource);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'export class LedgerRepository {}\n');
    const manifest = buildInitialDesignGoalManifest({ feature: blueprintId, run_id: 'questioning-rebind', adapter: 'claude', requirement,
      initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: [] } }, { projectRoot: f.root });
    const born = createGoalRun({ projectRoot: f.root, manifest, chain: [] });
    const runDir = path.dirname(born.manifestPath);
    const control = ensureRunControl(runDir, manifest.run_id);
    const owner = casAcquireRunOwner(runDir, manifest.run_id, control.current_epoch, { kind: 'session', owner_id: 'questioning-owner', lease_ms: 60_000 });
    assert(owner.ok);
    const brief: DesignRepairBriefLike = { class: 'B2', items: [] };
    const issued: Array<ReturnType<typeof issueSessionExecution>> = [];
    let recorded: Array<{ file: string; line: string }> | undefined;
    const emit = (event: Record<string, unknown>) => {
      const line = JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n';
      fs.appendFileSync(born.eventsPath, line);
      recorded?.push({ file: born.eventsPath, line });
    };
    const sha = () => createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const input: UnattendedDesignRepairInput = {
      projectRoot: f.root, frameworkRoot, feature: blueprintId, designTarget: designRepairTarget(f.root, blueprintId),
      phase: 'initial-design', runId: manifest.run_id, reportDir: manifest.report_dir, requirement, brief,
      signature: designRepairSignature(blueprintId, 'initial-design', brief.items),
      heldFeatureLock: null, runtimeWrites: [manifest.report_dir], emit,
      registerLockRelease: value => { release = value; },
      recordEventLines: () => {
        const lines: Array<{ file: string; line: string }> = [];
        recorded = lines;
        return () => { recorded = undefined; return lines; };
      },
      async invoke(purpose, prompt, guard) {
        if (purpose === 'author') {
          assert.equal(issued.length, 0, 'the signed questioning retry cannot dispatch an author');
          const phase = 'design-repair-author', invokeId = phase + '-i1';
          fs.mkdirSync(path.join(runDir, 'phases', phase, invokeId), { recursive: true });
          emit({ type: 'agent_invoke_start', phase, invoke_id: invokeId });
          emit({ type: 'agent_invoke_end', phase, invoke_id: invokeId, status: 'passed', exit_code: 0 });
          return { started: true, ok: true, detail: 'Controlled author returned the current candidate unchanged.', invokeId };
        }
        assert(guard);
        const phase = 'design-repair-questioning', attemptId = 'i' + (issued.length + 1), invokeId = phase + '-' + attemptId;
        emit({ type: 'agent_invoke_start', phase, invoke_id: invokeId, owner_id: owner.token.owner_id, owner_epoch: owner.token.epoch });
        issued.push(issueSessionExecution({ context: {
          runId: manifest.run_id, feature: blueprintId, workflowId: 'obligation-driven', track: 'full',
          chain: [], phase, attemptId, owner: { ...owner.token, kind: 'session' }, projectRoot: f.root, frameworkRoot,
          runDir, reportDir: manifest.report_dir, adapter: 'claude', authority: manifest.unattended, instruction: prompt,
          runtimeFacts: { receiptRequired: false, resume: false, successor: false }, childEnv: {},
        }, invokeId, purpose: 'questioning', gateTimeoutMs: 30_000, cleanupReserveMs: 0,
        preSnapshot: guard.pre, writeBoundary: guard.resolution as PhaseWriteBoundaryResolution, snapshotOptions: guard.options, emit }));
        assert.equal(guard.pre.entries.find(row => row.path === relativeSource)?.sha256, sha(), 'the signed questioning input is the current actual source');
        return { started: true, ok: true, detail: 'production session request issued', handoff: true, invokeId };
      },
    };
    const first = await runUnattendedDesignRepair(input);
    assert.equal(first.outcome, 'handoff', JSON.stringify(first));
    const initial = issued[0], original = fs.readFileSync(path.join(runDir, initial.reference.path));
    fs.appendFileSync(source, '// the signed source changed\n');
    acceptSessionExecution({ runDir, issued: initial,
      report: { phase: 'design-repair-questioning', status: 'passed', details: 'Old signed inputs do not prove the current design.' }, emit });
    const events = () => fs.readFileSync(born.eventsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert(hasSignedPhaseInputDrift(events(), initial.request.invoke_id), 'the original return recorded signed-input drift');
    const retried = await runUnattendedDesignRepair(input);
    assert.equal(retried.outcome, 'handoff', JSON.stringify(retried));
    assert.equal(issued.length, 2);
    const rebound = readSessionExecution(runDir)!;
    assert.equal(rebound.reference.sha256, issued[1].reference.sha256);
    assert.notEqual(rebound.reference.sha256, initial.reference.sha256);
    assert.deepEqual(rebound.request.context.owner, initial.request.context.owner);
    assert.equal(rebound.request.pre_snapshot?.entries.find(row => row.path === relativeSource)?.sha256, sha());
    assert.deepEqual(fs.readFileSync(path.join(runDir, initial.reference.path)), original);
    const rows = events(), firstQuestioning = rows.findIndex(row => row.type === 'agent_invoke_start' && row.invoke_id === initial.request.invoke_id);
    assert(firstQuestioning >= 0);
    assert(!rows.slice(firstQuestioning + 1).some(row => row.type === 'agent_invoke_start' && row.phase === 'design-repair-author'));
  } finally {
    const unlock = release as (() => void) | null;
    unlock?.();
    clearFrameworkConfigCache();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
}

export function getCases() { return [
  ...questioningRecoveryCases(),
  ...questioningRealReplayCases(),
  { name: 'a18 questioning rebinds changed signed source in the same repair session without dispatching an author', run: rebindQuestioningAfterSignedDrift },
  { name: 'P2 initial design machine preparation preserves original Q and reports current full disposition', run: initialMachinePreparation },
  { name: 'e2a4145e Q admission requires completed clean originals and unchanged author candidates', run: questioningReuseProof },
  { name: '9f6c2e41 repair candidate sets use actual transaction authority and reject canonical foreign CU and product writes', run: candidateWriteContract },
  { name: 'd18f6c42 machine admission preserves old IDs real gaps and public Q without false admission', run: machineAdmissionCompatibility },
  { name: 'd18f6c42 actual candidate comparison ignores machine metadata and preserves known missing files', run: actualWorkComparison },
]; }
export async function runAll() {
  const results: UnitCaseResult[] = [];
  for (const test of getCases()) {
    const endUnitCase = beginUnitCase(test.name);
    if (!endUnitCase) continue;
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally {  endUnitCase(); }
  }
  return results;
}
