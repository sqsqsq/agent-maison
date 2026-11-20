import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath, loadFrameworkConfig, resolveFeatureArtifact } from '../../config';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import { reconcileChangeUnitBlueprintRefs, BLUEPRINT_RECONCILE_LOCK_NAME } from '../../scripts/utils/change-unit-design-preparation';
import { diagnoseBlueprintSkillAuthority, deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { writeBackAdmission, reusableDesignQuestioning, readDesignQuestioningOriginal, recordDesignRepairInvocation, designRepairInvokeLabel, questioningDependencyChanges, runUnattendedDesignRepair, designRepairTarget, type DesignRepairInvokeOutcome } from '../../scripts/utils/design-repair-unattended';
import { GoalPhaseRuntime } from '../../scripts/goal-phase-runtime';
import { ensureRunControl, casAcquireRunOwner } from '../../scripts/utils/goal-run-control';
import { capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots, phaseWriteConflictProblems } from '../../scripts/utils/phase-write-boundary';
import { buildGoalManifestFromInput, buildInitialDesignGoalManifest } from '../../scripts/utils/goal-manifest';
import { parseAdapterModelBinding } from '../../scripts/utils/adapter-model';
import { initialDesignRequestOptions } from '../../scripts/utils/initial-design-delivery';
import { prepareDesignRequest } from '../../scripts/utils/automatic-request';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { tryAcquireLock, releaseLock, FEATURE_LOCK_NAME, isPidAlive } from '../../scripts/utils/goal-run-lock';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, unitCaseGroups, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { fixture as projectionFixture, planContracts } from './blueprint-skill-projection.unit.test';
import { readHandoffMaterial, sessionEvents } from '../../scripts/utils/session-execution-handoff';
import { createBlueprintReviewDesignFixture } from '../fixtures/blueprint-review-design';
import { controlledModelBinding, installControlledCodex } from '../utils/controlled-model-process';
import { preserveRuntimeTestEvidence } from '../utils/runtime-test-control';

type Json = Record<string, any>;
type Group = 'content' | 'runtime';
const FRAMEWORK = path.resolve(__dirname, '../../..'), BLUEPRINT = 'ledger-app-blueprint';
const FEATURE = deriveChangeUnitFeatureId(BLUEPRINT, 'ledger-refresh');
const read = (file: string): Json => YAML.parse(fs.readFileSync(file, 'utf8'));
const write = (file: string, value: unknown): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, YAML.stringify(value)); };
const node = (doc: Json): Json => {
  const find = (value: any): Json | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    if (value.node_id === 'ledger-domain') return value;
    for (const child of Object.values(value)) { const found = find(child); if (found) return found; }
    return undefined;
  };
  const found = find(doc); assert(found, 'valid fixture contains ledger-domain'); return found;
};

async function withProject(run: (root: string, fixture: ReturnType<typeof projectionFixture>) => void | Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-repair-daily-'));
  const fixture = projectionFixture(root); // Approved author input only; no goal result or completion is supplied.
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'design repair boundaries',
    project_profile: { name: 'generic' }, active_workflow: 'obligation-driven', paths: { features_dir: 'doc/features' },
    architecture: { outer_layers: [{ id: 'src', can_depend_on: [] }], module_inner_layers: ['shared', 'data', 'domain', 'presentation'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ts' } }));
  try { clearFrameworkConfigCache(); await run(root, fixture); }
  finally { clearFrameworkConfigCache(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); }
}

function repairInput(root: string, runId: string, requirement?: string) {
  if (!fs.existsSync(path.join(root, '.git'))) {
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git(['init', '-q']); git(['add', '-A']);
    git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'actual repair input']);
  }
  const manifest = buildGoalManifestFromInput({ feature: FEATURE, run_id: runId, adapter: 'claude', requirement: requirement ?? '保留当前设计与原事务。',
    start_phase: 'spec', end_phase: 'spec', unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root });
  const created = createGoalRun({ projectRoot: root, manifest, chain: ['spec'] });
  const runDir = path.join(root, manifest.report_dir), rows: Json[] = [];
  let recording: Array<{ file: string; line: string }> | undefined;
  const input = { projectRoot: root, frameworkRoot: FRAMEWORK, feature: FEATURE, phase: 'spec', runId,
    reportDir: manifest.report_dir, signature: 'a'.repeat(64), brief: { class: 'B1' as const, items: [] },
    ...(requirement ? { requirement } : {}), heldFeatureLock: null, runtimeWrites: [],
    emit: (event: Json) => { rows.push(event); const file = path.join(runDir, 'events.jsonl'), line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
      fs.appendFileSync(file, line); recording?.push({ file, line }); },
    registerLockRelease: (_release: (() => void) | null) => {}, recordEventLines: () => {
      const lines: Array<{ file: string; line: string }> = []; recording = lines;
      return () => { recording = undefined; return lines; };
    } };
  void created;
  return { input, runDir, rows };
}

async function replayOriginalDesignAuthorization(mode: 'detach' | 'adopt' | 'fallback' | 'confirmation' | 'explicit'): Promise<void> {
  const host = createBlueprintReviewDesignFixture();
  const root = host.root, frameworkRoot = path.resolve(__dirname, '../../..'), feature = 'ledger-app-blueprint';
  const transcriptRoot = path.join(root, 'native-claude');
  const transcript = path.join(transcriptRoot, 'projects', 'fixture', 'original.jsonl');
  const sessionRef = transcript + '#original';
  const requirement = '完成账目刷新与恢复的原始完整交付，维护已准入蓝图的设计契约。';
  const unattended = mode === 'detach' || mode === 'adopt' || mode === 'fallback';
  const runId = 'design-authority-transport';
  const model = parseAdapterModelBinding('codex', controlledModelBinding('codex', root))!;
  const manifest = buildInitialDesignGoalManifest({ feature, run_id: runId, adapter: 'codex', adapter_model_pin: model, requirement,
    initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: ['plan', 'coding', 'review', 'ut'] },
    unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root });
  const runDir = path.resolve(root, manifest.report_dir), repairDir = path.join(runDir, 'design-repair');
  const ciArgs = ['--feature', feature, '--adapter', 'codex', '--project-root', root, '--framework-root', frameworkRoot];
  const native = path.join(root, 'controlled-design.cjs');
  const preload = path.join(root, 'detach-attempt.cjs'), detachArgs = path.join(root, 'detach-child-argv.json');
  let restoreNative = () => {};
  let backgroundPid: number | undefined;
  let lastOutput = '';
  try {
    const architecture = loadFrameworkConfig(root).architecture;
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: 'Design authorization replay',
      project_profile: { name: 'hmos-app' }, active_workflow: 'obligation-driven', architecture, materialized_adapters: ['codex'] }));
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Design authorization replay\n');
    clearFrameworkConfigCache();
    const unit = loadCanonicalChangeUnit(root, feature, 'ledger-refresh');
    const original = YAML.parse(fs.readFileSync(unit.canonicalPath, 'utf8'));
    const description = original.target_predicates[0].description;
    original.target_predicates[0].description = '';
    fs.writeFileSync(unit.canonicalPath, YAML.stringify(original));
    const items = YAML.parse(fs.readFileSync(host.blueprintFile, 'utf8')).review_summary.questioning.items;
    fs.mkdirSync(path.dirname(model.config_source!), { recursive: true }); fs.writeFileSync(model.config_source!, '[features]\n');
    createGoalRun({ projectRoot: root, frameworkRoot, manifest, chain: [] });
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    const row = (uuid: string, role: string, content: string) => JSON.stringify({ type: role, uuid, sessionId: 'original', cwd: root,
      timestamp: new Date().toISOString(), message: { role, content } });
    fs.writeFileSync(transcript, [row('original', 'user', requirement + (unattended ? '请无人值守，后台继续到验收。' : '请不要后台。')),
      row('assistant', 'assistant', '请无人值守。'),
      row('independent', 'user', '这是另一项独立任务。请无人值守。')].join('\n') + '\n');
    const priorClaude = process.env.CLAUDE_CONFIG_DIR;
    try {
      process.env.CLAUDE_CONFIG_DIR = transcriptRoot;
      if (mode !== 'confirmation') {
        const prepared = prepareDesignRequest({ ...initialDesignRequestOptions(root, frameworkRoot, manifest), sessionRef });
        assert.equal(prepared.intake?.control.transport?.mode, unattended ? 'unattended' : 'attended');
        assert.notEqual(prepared.intake?.user.text, requirement, 'the production carrier must bind the native original independently of the manifest summary');
      }
    } finally {
      if (priorClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = priorClaude;
    }
    fs.writeFileSync(native, `const fs=require('fs'),yaml=require(${JSON.stringify(require.resolve('yaml'))});
process.stdin.resume();process.stdin.on('end',()=>{
  const phase=process.env.MAISON_GOAL_ATTEMPT_PHASE;
  const emit=row=>process.stdout.write(JSON.stringify(row)+'\\n');
  if(phase==='design-repair-author') {
    const draft=${JSON.stringify(path.join(repairDir, 'change-unit.yaml'))};
    const content=yaml.parse(fs.readFileSync(draft,'utf8'));
    content.target_predicates[0].description=${JSON.stringify(description)};
    fs.writeFileSync(draft,yaml.stringify(content));
  } else if(phase!=='design-repair-questioning' && phase!=='initial-design-questioning') {
    process.stderr.write('Error loading config: the controlled model ends after real design publication ('+phase+')\\n');process.exitCode=1;return;
  }
  emit({type:'thread.started',thread_id:phase+'-fixture'});
  emit({type:'item.completed',item:{type:'agent_message',text:phase.endsWith('questioning')?${JSON.stringify(JSON.stringify({ items }))}:'已恢复原批准设计说明。'}});
  emit({type:'turn.completed'});
});`);
    restoreNative = installControlledCodex(root, native);
    fs.writeFileSync(preload, `if (!process.argv.some(arg => /goal-(?:mode-entry|runner)\\.ts$/.test(arg))) return;
const fs=require('fs'),{spawn}=require('child_process');
require(${JSON.stringify(require.resolve('ts-node/register/transpile-only'))});
require(${JSON.stringify(path.join(frameworkRoot, 'harness/scripts/goal-phase-runtime.ts'))}).__testing_setDetachSpawn((file,args,opts)=>{
  fs.writeFileSync(${JSON.stringify(detachArgs)},JSON.stringify(args));
  return spawn(${mode === 'fallback' ? JSON.stringify(path.join(root, 'absent-runner.exe')) : 'file'},args,opts);
});`);
    const env = { ...process.env, CLAUDE_CONFIG_DIR: transcriptRoot, TS_NODE_PROJECT: path.join(frameworkRoot, 'harness/tsconfig.json'),
      NODE_OPTIONS: `--require \"${preload.replace(/\\/g, '/')}\"` };
    const call = (command: string, args: string[]) => {
      const child = spawnSync(command, args, { cwd: path.join(frameworkRoot, 'harness'), encoding: 'utf8', env, timeout: 45_000, windowsHide: true });
      lastOutput = child.stdout + child.stderr;
      assert.equal(child.status, 0, String(child.error ?? lastOutput));
      return JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1)!);
    };
    const cli = (name: string, ...args: string[]) => call(process.execPath, [path.join(frameworkRoot, 'harness/scripts', name), ...ciArgs, ...args]);
    const shellCommand = (command: string) => process.platform === 'win32'
      ? call('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]) : call('/bin/sh', ['-c', command]);
    const publications = () => sessionEvents(runDir).filter(event => event.type === 'design_authority_repair' && 'stage' in event && event.stage === 'published');
    if (mode === 'detach' || mode === 'adopt') {
      const detached = mode === 'detach' ? cli('goal-runner.ts', '--resume', runId, '--detach')
        : cli('goal-mode-entry.ts', '--run-mode', 'attended', '--run-id', runId, '--next');
      backgroundPid = detached.pid;
      assert.equal(detached.detached, true, JSON.stringify(detached));
      assert.equal(detached.run_id, runId);
      assert.equal(detached.transport_fallback, undefined);
      const deadline = Date.now() + 60_000;
      while (!sessionEvents(runDir).some(event => event.type === 'run_end') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      assert(sessionEvents(runDir).some(event => event.type === 'run_end'), fs.readFileSync(path.join(runDir, 'detach.log'), 'utf8'));
    } else {
      let step = cli('goal-mode-entry.ts', '--run-mode', 'attended', '--run-id', runId, '--next',
        ...(mode === 'explicit' ? ['--authorize-autonomy'] : []), ...(mode === 'confirmation' ? ['--session-ref', transcript + '#independent'] : []));
      if (mode === 'confirmation') {
        const repeated = shellCommand(step.next_command);
        for (const waiting of [step, repeated]) {
          assert.equal(waiting.type, 'goal_session_result', JSON.stringify(waiting));
          assert.equal(waiting.result.halt_reason, 'execution_scope_unresolved', JSON.stringify(waiting));
          assert.match(JSON.stringify(waiting), /自动设计修复授权/);
        }
        assert.equal(fs.existsSync(path.resolve(root, initialDesignRequestOptions(root, frameworkRoot, manifest).requestFile)), false);
        assert(!sessionEvents(runDir).some(event => event.type === 'agent_invoke_start' && String(event.phase).startsWith('design-repair-')));
        assert.equal(publications().length, 0);
        assert.equal(fs.existsSync(detachArgs), false);
        return;
      }
      assert.equal(step.phase, 'design-repair-author', JSON.stringify(step));
      if (mode === 'fallback') {
        assert.match(step.transport_fallback, /child spawn failed/);
        assert(!step.execute_command.includes('--authorize-autonomy'));
      } else {
        assert.equal(step.transport_fallback, undefined);
        assert.equal(fs.existsSync(detachArgs), false);
      }
      for (let index = 0; index < 3 && !publications().length; index++) {
        assert.equal(step.type, 'phase_execute_request', JSON.stringify(step));
        const executed = shellCommand(step.execute_command);
        assert.equal(executed.status, 'passed', JSON.stringify(executed));
        if (mode === 'fallback') assert(!executed.next_command.includes('--authorize-autonomy'));
        step = shellCommand(executed.next_command);
      }
    }
    if (mode !== 'explicit') {
      const argv: string[] = JSON.parse(fs.readFileSync(detachArgs, 'utf8'));
      assert(argv.includes('--detached-child') && argv.includes('--authorize-autonomy'), JSON.stringify(argv));
      assert.equal(argv.includes('--adopt-session-transport'), mode !== 'detach');
    }
    assert.equal(publications().length, 1, JSON.stringify(sessionEvents(runDir).slice(-8)));
    assert.equal(YAML.parse(fs.readFileSync(unit.canonicalPath, 'utf8')).target_predicates[0].description, description);
  } catch (error) {
    const evidence = preserveRuntimeTestEvidence([root], String(error), undefined,
      [path.join(runDir, 'detach.log'), path.join(runDir, 'session-control.log'), detachArgs, transcript], { stdout: lastOutput });
    throw new Error(`${mode}: ${(error as Error).stack ?? String(error)}\nReplay evidence: ${evidence}`);
  } finally {
    if (backgroundPid && isPidAlive(backgroundPid)) {
      const deadline = Date.now() + 5_000;
      while (isPidAlive(backgroundPid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      if (isPidAlive(backgroundPid)) try { process.kill(backgroundPid); } catch { /* Background process already exited. */ }
    }
    restoreNative(); clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 8 });
  }
}

const cases: Array<{ name: string; group: Group; run: () => Promise<void> }> = [{
  name: '3ec91fa7 design authorization parity across public detach, verified session fallback, and confirmation boundaries', group: 'runtime',
  async run() {
    for (const mode of ['detach', 'adopt', 'fallback', 'confirmation', 'explicit'] as const) await replayOriginalDesignAuthorization(mode);
  },
}, {
  name: 'daily design content: mapping-only primary handback retains the newly published blueprint identity', group: 'content',
  run: () => withProject(async (root, fixture) => {
    const approved = loadCanonicalBlueprint(root, BLUEPRINT);
    const authored = planContracts(fixture), { change_unit_ref: _identity, ...construction_mapping } = authored.change_unit;
    const defective = structuredClone(approved.blueprint) as Json; node(defective).acceptance = '需要原作者恢复的机器结构'; write(approved.canonicalPath, defective);
    reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
    const beforeCu = loadCanonicalChangeUnit(root, BLUEPRINT, 'ledger-refresh'), beforeArtifact = asChangeUnitArtifact(beforeCu.changeUnit);
    construction_mapping.design_ref_mappings = construction_mapping.design_ref_mappings.map((row, index) => ({ ...row, design_ref: beforeArtifact.design_refs[index] }));
    const { input, runDir } = repairInput(root, 'daily-mapping-only-primary', '校正当前设计标题并明确本CU既有施工映射，保留所有业务承诺和验收。');
    let calls = 0;
    const result = await runUnattendedDesignRepair({ ...input,
      invoke: async (purpose, _prompt, guard) => {
        assert(guard); const phase = designRepairInvokeLabel(purpose), invokeId = `${phase}-${++calls}`;
        fs.mkdirSync(path.join(runDir, 'phases', phase, invokeId), { recursive: true });
        input.emit({ type: 'agent_invoke_start', phase, invoke_id: invokeId, command: 'controlled design author or independent Q' });
        const draft = path.join(runDir, 'design-repair/component-blueprint.yaml');
        if (purpose === 'author') {
          const doc = read(draft); node(doc).acceptance = node(approved.blueprint as Json).acceptance;
          doc.title = String(doc.title ?? 'Ledger') + ' — current source binding'; write(draft, doc);
          fs.writeFileSync(path.join(runDir, 'design-repair/change-unit-candidates.json'), JSON.stringify([{
            providerId: beforeArtifact.provenance.extraction_method, artifact: beforeArtifact, construction_mapping }]));
        }
        input.emit({ type: 'agent_invoke_end', phase, invoke_id: invokeId, exit_code: 0 });
        const outcome: DesignRepairInvokeOutcome = { started: true, invokeId, ok: true, detail: 'controlled design handback',
          ...(purpose === 'questioning' ? { output: JSON.stringify({ items: (approved.blueprint as Json).review_summary.questioning.items }) } : {}),
          preSnapshot: guard.pre, postSnapshot: capturePhaseInvocationSnapshot(guard.resolution, guard.options) };
        recordDesignRepairInvocation(runDir, purpose, invokeId, outcome); return outcome;
      } });
    assert.equal(result.outcome, 'published', JSON.stringify(result));
    assert.equal(calls, 2, 'the real defective input must execute the controlled author and independent Q before publication');
    const published = loadCanonicalBlueprint(root, BLUEPRINT), current = loadCanonicalChangeUnit(root, BLUEPRINT, 'ledger-refresh');
    const currentArtifact = asChangeUnitArtifact(current.changeUnit);
    assert.equal(published.blueprint.revision, Number(approved.blueprint.revision) + 1);
    assert.equal(currentArtifact.component_blueprint_ref.revision, published.blueprint.revision);
    assert.equal(currentArtifact.component_blueprint_ref.artifact_sha256, published.artifactSha256);
    assert.equal(currentArtifact.revision, beforeArtifact.revision + 1, 'mapping publication bumped the same pointer twice');
    assert.deepEqual(currentArtifact.provenance, beforeArtifact.provenance, 'pointer-only publication rewrote the original CU provenance');
    const location = resolveFeatureArtifact(root, FEATURE, 'contracts.yaml');
    assert(location.exists, JSON.stringify({ result, location }));
    const stage = read(location.actualPath);
    assert.equal(stage.change_unit.change_unit_ref.artifact_sha256, current.artifactSha256);
    assert(stage.change_unit.design_ref_mappings.every((row: Json) => row.design_ref.revision === published.blueprint.revision));
  }),
}, {
  name: 'daily design content: original requirement dispatch ignores the retired personal B1 switch and preserves authority', group: 'content',
  run: () => withProject(async root => {
    fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', design_repair: { unattended_b1: 'true' } }));
    const original = loadCanonicalBlueprint(root, BLUEPRINT);
    const defective = read(original.canonicalPath); node(defective).acceptance = '当前批准验收误写成一段文字'; write(original.canonicalPath, defective);
    const defectiveBytes = fs.readFileSync(original.canonicalPath);
    const requirement = '在原范围内修复当前设计，不改变产品承诺。';
    const { input, runDir, rows } = repairInput(root, 'daily-authorized-repair', requirement); let calls = 0;
    const result = await runUnattendedDesignRepair({ ...input, invoke: async (purpose, prompt) => {
      calls++; assert.equal(purpose, 'author'); assert(prompt.includes(requirement));
      return { started: false, ok: false, status: 'waiting', detail: 'controlled model boundary is waiting' };
    } });
    assert.equal(calls, 1); assert.equal(result.outcome, 'waiting');
    assert(fs.readFileSync(original.canonicalPath).equals(defectiveBytes));
    assert(!rows.some(row => row.stage === 'published'));
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.requirement, requirement); assert.equal(manifest.unattended.write_mode, 'full-access');
  }),
}, {
  name: 'daily design content: actual malformed authority is diagnosed and the owner repair restores projection', group: 'content',
  run: () => withProject(root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), original = fs.readFileSync(loaded.canonicalPath);
    const before = deriveBlueprintSkillInput(root, FEATURE, FRAMEWORK, 'acceptance');
    assert.equal(before.state, 'resolved', JSON.stringify(before));
    const doc = read(loaded.canonicalPath); node(doc).acceptance = '当前验收误写成一段文字';
    write(loaded.canonicalPath, doc); reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
    const broken = diagnoseBlueprintSkillAuthority(root, FRAMEWORK, FEATURE);
    assert(broken.findings.some(finding => finding.codes.includes('authority_content_not_machine_structure')), JSON.stringify(broken));
    fs.writeFileSync(loaded.canonicalPath, original); reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
    assert.equal(deriveBlueprintSkillInput(root, FEATURE, FRAMEWORK, 'acceptance').state, 'resolved');
  }),
}, {
  name: 'daily design content: author self-reported admission cannot hide missing required design evidence', group: 'content',
  run: () => withProject(root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = structuredClone(loaded.blueprint) as Json;
    doc.review_summary.questioning.items = [];
    doc.review_summary.admission = { status: 'pass', root_questions_complete: true, current_slice: { contracts_ready: true, design_refs_ready: true }, blocker_refs: [] };
    const derived = writeBackAdmission(doc, { projectRoot: root, canonicalPath: loaded.canonicalPath });
    assert.equal(derived.status, 'blocker'); assert.equal(doc.review_summary.admission.status, 'blocker');
    assert(doc.review_summary.admission.blocker_refs.length > 0);
  }),
}, {
  name: 'daily design content: independent Q reuse requires a completed read-only original and retains a real blocker', group: 'content',
  run: () => withProject(root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = loaded.blueprint as Json;
    const pre = capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'contracts'] });
    const input = { projectRoot: root, blueprintPath: loaded.canonicalPath, blueprint: doc, beforeBlueprint: fs.readFileSync(loaded.canonicalPath, 'utf8'),
      output: JSON.stringify(doc.review_summary.questioning), providerId: 'independent-design-questioning', completed: true, preSnapshot: pre, postSnapshot: pre };
    assert(reusableDesignQuestioning(input), 'current independent fixture Q has a usable read-only original');
    assert.equal(reusableDesignQuestioning({ ...input, completed: false }), null);
    assert.equal(reusableDesignQuestioning({ ...input, preSnapshot: undefined }), null);
    const changed = structuredClone(doc); changed.title = 'actual design change';
    assert.equal(reusableDesignQuestioning({ ...input, blueprint: changed }), null);
    const denial = structuredClone(doc.review_summary.questioning); denial.items[0].disposition = 'blocker';
    denial.items[0].answer = '当前必需设计仍缺原批准职责的依据，不允许降级验收。';
    const retained = reusableDesignQuestioning({ ...input, output: JSON.stringify(denial) }) as Json;
    assert(retained?.items.some((item: Json) => item.disposition === 'blocker' && item.answer === denial.items[0].answer));
  }),
}, {
  name: 'daily design content: changing only a knowledge asset invalidates positive Q while retaining real denial', group: 'content',
  run: () => withProject(root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = loaded.blueprint as Json;
    const relative = 'doc/glossary.yaml', file = path.join(root, relative);
    fs.writeFileSync(file, 'terms: []\n');
    doc.discovery.inputs.knowledge_assets.push(relative); write(loaded.canonicalPath, doc);
    const generated = path.join(root, 'doc/component-index.yaml'); fs.writeFileSync(generated, 'generated: before\n');
    doc.discovery.inputs.knowledge_assets.push('doc/component-index.yaml'); write(loaded.canonicalPath, doc);
    const pre = capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'contracts'] });
    const input = { projectRoot: root, blueprintPath: loaded.canonicalPath, blueprint: doc,
      beforeBlueprint: fs.readFileSync(loaded.canonicalPath, 'utf8'), output: JSON.stringify(doc.review_summary.questioning),
      providerId: 'independent-design-questioning', completed: true, preSnapshot: pre, postSnapshot: pre };
    assert(reusableDesignQuestioning(input));
    fs.writeFileSync(generated, 'generated: after construction\n');
    assert(reusableDesignQuestioning(input), 'machine index refresh is not a business knowledge writer change');
    fs.appendFileSync(file, '# actual writer change without any blueprint change\n');
    assert.equal(reusableDesignQuestioning(input), null);
    assert(questioningDependencyChanges(root, doc, pre, loaded.canonicalPath).some(entry => path.resolve(entry.path) === file));
    const denial = structuredClone(doc.review_summary.questioning); denial.items[0].disposition = 'blocker';
    assert(reusableDesignQuestioning({ ...input, output: JSON.stringify(denial) }), 'effective denial still goes directly to the author');
  }),
}, {
  name: 'daily design runtime: failed unpublished non-knowledge transaction ends before same-run knowledge repair archives fresh originals', group: 'runtime',
  run: () => withProject(async root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = loaded.blueprint as Json;
    const relative = 'doc/glossary.yaml', asset = 'terms: []\n';
    fs.writeFileSync(path.join(root, relative), asset); doc.discovery.inputs.knowledge_assets.push(relative);
    delete doc.decisions_and_gaps.decisions.find((row: Json) => row.decision_id === 'seam-shape').knowledge_refs;
    write(loaded.canonicalPath, doc); reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
    const canonical = fs.readFileSync(loaded.canonicalPath);
    const { input, runDir, rows } = repairInput(root, 'daily-ended-then-knowledge', '在原确认范围归位 LedgerDataSource，不改变批准结论。');
    const first = await runUnattendedDesignRepair({ ...input, designTarget: designRepairTarget(root, BLUEPRINT),
      invoke: async () => ({ started: false, ok: false, detail: 'controlled first non-knowledge author failure' }) });
    assert.equal(first.outcome, 'failed'); assert(rows.some(row => row.stage === 'failed'));
    const original = JSON.parse(fs.readFileSync(path.join(runDir, 'design-repair/original-context.json'), 'utf8'));
    assert.deepEqual(original.knowledgeOriginals, {});
    let invoked = false;
    const next = await runUnattendedDesignRepair({ ...input, signature: 'b'.repeat(64), designTarget: designRepairTarget(root, BLUEPRINT),
      brief: { class: 'B1', items: [{ check: 'component-closure', codes: ['component_closure_knowledge_conclusion_unplaced'], class: 'B1', artifacts: [loaded.canonicalPath], basis: 'decision:seam-shape', needs: [] }] },
      invoke: async (purpose, prompt, guard) => {
        invoked = true; assert.equal(purpose, 'author'); assert(prompt.includes('P1 owner reconciliation'));
        assert(guard?.options?.ownedPrefixes?.some(prefix => path.resolve(root, prefix) === path.join(root, relative)));
        return { started: false, ok: false, detail: 'controlled new knowledge writer reached' };
      } });
    assert(invoked, JSON.stringify(next)); assert.equal(next.outcome, 'failed');
    assert('reason' in next && next.reason.includes('controlled new knowledge writer reached') && !next.reason.includes('原件缺失'));
    const attempts = rows.filter(row => row.stage === 'attempted'); assert.equal(attempts.length, 2);
    assert.notEqual(attempts[0].handoff_context.path, attempts[1].handoff_context.path);
    const fresh = JSON.parse(fs.readFileSync(path.join(runDir, attempts[1].handoff_context.path), 'utf8'));
    assert.equal(Buffer.from(fresh.knowledgeOriginals[relative], 'base64').toString(), asset);
    assert(fs.readFileSync(loaded.canonicalPath).equals(canonical)); assert(!rows.some(row => row.stage === 'published'));
  }),
}, ...(['questioner-blueprint', 'questioner-cu', 'unscoped-decline', 'questioner-missing-preimage'] as const).map(mode => ({
  name: `daily design runtime: rejected ${mode} work cannot cross a fresh transaction boundary`, group: 'runtime' as const,
  run: () => withProject(async root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), approved = structuredClone(loaded.blueprint) as Json;
    const defective = structuredClone(approved), candidateId = 'repair_candidate:' + 'c'.repeat(64);
    node(defective).acceptance = '原验收需要作者恢复机器结构';
    if (mode === 'unscoped-decline') defective.decisions_and_gaps.decisions[0].decision_id = candidateId;
    write(loaded.canonicalPath, defective); reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
    const canonical = fs.readFileSync(loaded.canonicalPath);
    const { input, runDir, rows } = repairInput(root, `daily-rejected-${mode}`, mode === 'unscoped-decline' ? undefined : '恢复原验收，保留批准范围。');
    const brief = { class: 'B1' as const, items: [{ check: 'design', class: 'B1' as const, codes: [], artifacts: [], basis: candidateId, needs: [] }] };
    let questionCalls = 0, calls = 0;
    const draft = path.join(runDir, 'design-repair/component-blueprint.yaml');
    const affected = mode === 'questioner-cu' ? path.join(runDir, 'design-repair/change-unit.yaml') : draft;
    let beforeQuestioning: Buffer | undefined;
    const invoke: Parameters<typeof runUnattendedDesignRepair>[0]['invoke'] = async (purpose, _prompt, guard) => {
      assert(guard);
      const phase = designRepairInvokeLabel(purpose), invokeId = `${phase}-${++calls}`;
      fs.mkdirSync(path.join(runDir, 'phases', phase, invokeId), { recursive: true });
      input.emit({ type: 'agent_invoke_start', phase, invoke_id: invokeId, command: 'isolated author or Q substitute' });
      const doc = read(draft);
      let output: string | undefined;
      if (purpose === 'author') {
        node(doc).acceptance = node(approved).acceptance;
        if (mode === 'unscoped-decline') {
          doc.title = 'unauthorized author title';
          doc.decisions_and_gaps.decisions[0].rationale = 'declined: 无可核实依据的拒修';
        }
        write(draft, doc);
      } else {
        questionCalls++;
        beforeQuestioning = fs.readFileSync(affected);
        if (mode === 'questioner-blueprint' || mode === 'questioner-missing-preimage') { doc.title = 'unauthorized Q title'; write(draft, doc); }
        if (mode === 'questioner-cu') {
          const cu = path.join(runDir, 'design-repair/change-unit.yaml'), value = read(cu);
          value.description = 'unauthorized Q CU description'; write(cu, value);
        }
        const items = structuredClone(approved.review_summary.questioning.items);
        Object.assign(items.find((item: Json) => item.scope_ref === 'view:logical'), { disposition: 'blocker', answer: '当前原验收未满足，保留否定，不认可拒修。' });
        output = JSON.stringify({ items });
      }
      input.emit({ type: 'agent_invoke_end', phase, invoke_id: invokeId, exit_code: 0 });
      const preSnapshot = mode === 'questioner-missing-preimage' && purpose === 'questioning'
        ? { ...guard.pre, entries: guard.pre.entries.map(entry => entry.path.endsWith('/design-repair/component-blueprint.yaml')
          ? { ...entry, sha256: 'f'.repeat(64) } : entry) } : guard.pre;
      const outcome: DesignRepairInvokeOutcome = { started: true, invokeId, ok: true, detail: 'isolated author or Q completed', output,
        preSnapshot, postSnapshot: capturePhaseInvocationSnapshot(guard.resolution, guard.options) };
      recordDesignRepairInvocation(runDir, purpose, invokeId, outcome);
      return outcome;
    };
    const first = await runUnattendedDesignRepair({ ...input, brief, invoke });
    assert(first.outcome === (mode === 'unscoped-decline' ? 'failed' : 'violation') && first.step === 'questioning', JSON.stringify(first)); assert.equal(questionCalls, 1);
    assert(first.reason.includes(mode === 'unscoped-decline' ? '拒修理由未被独立质询' : '设计交回不能采信'), first.reason);
    const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const question = events.find(event => event.type === 'agent_invoke_start' && event.phase === 'design-repair-questioning');
    const saved = readDesignQuestioningOriginal(runDir, question, events);
    const original = JSON.parse(fs.readFileSync(path.join(runDir, 'phases', question.phase, question.invoke_id, 'design-result.json'), 'utf8')).outcome;
    assert(original.started && original.ok && original.output.includes('当前原验收未满足')
      && events.some(event => event.type === 'agent_invoke_end' && event.invoke_id === question.invoke_id && event.exit_code === 0),
      'the regression must retain the actual completed Q response even when its writes invalidate reuse');
    if (mode === 'unscoped-decline') {
      assert(saved?.completed);
      assert(reusableDesignQuestioning({ ...saved, projectRoot: root, blueprintPath: draft, blueprint: read(draft) }),
        'the scope counter must contain an otherwise usable completed denial');
    } else {
      assert.equal(diffPhaseInvocationSnapshots(original.preSnapshot, original.postSnapshot).kind, 'changed');
      assert(events.some(event => event.type === 'phase_write_violation' && event.invoke_id === question.invoke_id));
      assert.equal(saved, null, 'the actual violation invalidates Q reuse before any later transaction');
    }
    const conflictPaths = phaseWriteConflictProblems(root, events).flatMap(problem => problem.files ?? []);
    const affectedDraft = path.relative(root, affected).replace(/\\/g, '/');
    assert.equal(conflictPaths.includes(affectedDraft), mode !== 'unscoped-decline', 'the callback supplies no bound execution window');
    if (mode === 'questioner-blueprint' || mode === 'questioner-cu') {
      assert(beforeQuestioning);
      fs.writeFileSync(affected, beforeQuestioning);
    }
    let received: { purpose: string; blueprint: Json; cu?: Json } | undefined;
    const second = await runUnattendedDesignRepair({ ...input, brief, invoke: async purpose => {
      received = { purpose, blueprint: read(draft), ...(mode === 'questioner-cu' ? { cu: read(path.join(runDir, 'design-repair/change-unit.yaml')) } : {}) };
      return { started: false, ok: false, detail: 'fresh author receives only authorized baseline' };
    } });
    if (mode === 'questioner-missing-preimage') {
      assert.equal(second.outcome, 'waiting'); assert.equal(received, undefined);
      assert.equal(read(draft).title, 'unauthorized Q title');
      assert.equal(rows.filter(row => row.stage === 'attempted').length, 1);
      assert(fs.readFileSync(loaded.canonicalPath).equals(canonical));
      return;
    }
    assert(received, JSON.stringify(second)); assert.equal(received.purpose, 'author');
    assert.equal(received.blueprint.title, defective.title, 'unreviewed or unscoped work must not become the next author baseline');
    assert.deepEqual(node(received.blueprint).acceptance, node(defective).acceptance, 'rebuild the candidate from the actual canonical baseline');
    if (mode === 'questioner-cu') assert.notEqual(received.cu!.description, 'unauthorized Q CU description');
    assert(second.outcome === 'failed' && second.reason.includes('fresh author receives only authorized baseline'), JSON.stringify(second));
    assert.equal(rows.filter(row => row.stage === 'attempted').length, 2); assert(!rows.some(row => row.stage === 'published'));
    assert(fs.readFileSync(loaded.canonicalPath).equals(canonical));
  }),
})), ...(['allowed', 'outside', 'canonical', 'questioning'] as const).map(mode => ({
  name: `daily design runtime: executor knowledge writer ${mode} preserves the exact author and Q boundary`, group: 'runtime' as const,
  run: () => withProject(async root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = loaded.blueprint as Json;
    const relative = 'doc/glossary.yaml', file = path.join(root, relative), before = 'terms: []\n';
    fs.writeFileSync(file, before); doc.discovery.inputs.knowledge_assets.push(relative);
    const decision = doc.decisions_and_gaps.decisions.find((row: Json) => row.decision_id === 'seam-shape');
    delete decision.knowledge_refs; write(loaded.canonicalPath, doc); reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
    const { input, runDir, rows } = repairInput(root, `daily-knowledge-${mode}`, '只归位已批准的 LedgerDataSource 结论，保留原范围与验收。');
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
    const control = ensureRunControl(runDir, input.runId);
    const acquired = casAcquireRunOwner(runDir, input.runId, control.current_epoch, { kind: 'session', owner_id: 'actual-executor-test', lease_ms: 60_000 });
    assert(acquired.ok); let questionCalls = 0;
    const runtime = new GoalPhaseRuntime({ executor: { execute: async context => {
      const draftFile = path.join(runDir, 'design-repair/component-blueprint.yaml');
      if (context.phase === 'design-repair-author') {
        assert(context.instruction?.includes('原资产writer') || context.instruction?.includes('原资产 writer'));
        const candidate = read(draftFile);
        candidate.decisions_and_gaps.decisions.find((row: Json) => row.decision_id === 'seam-shape').knowledge_refs = [`${relative}#decision:seam-shape`];
        const writes = [[draftFile, YAML.stringify(candidate)], [file, YAML.stringify({ terms: [{ term: 'LedgerDataSource', aliases: ['decision:seam-shape'], definition: decision.stable_contract }] })]];
        if (mode === 'outside') writes.push([path.join(root, 'requirements/ledger.md'), 'unauthorized replacement\n']);
        if (mode === 'canonical') writes.push([loaded.canonicalPath, YAML.stringify(candidate)]);
        execFileSync(process.execPath, ['-e', 'const fs=require("fs");for(const [p,s] of JSON.parse(fs.readFileSync(0,"utf8")))fs.writeFileSync(p,s)'], { input: JSON.stringify(writes) });
        return { status: 'passed', phase: context.phase, exitCode: 0, stdout: '', stderr: '', command: 'real node asset writer' };
      }
      questionCalls++;
      assert(context.instruction?.includes('本事务知识资产的实际改动'));
      const attempt = [...rows].reverse().find(row => row.type === 'design_authority_repair' && row.stage === 'attempted')!;
      const reference = attempt.handoff_context;
      assert(context.instruction?.includes(`${path.resolve(runDir, reference.path)}#/knowledgeOriginals`));
      assert(context.instruction?.includes(`原件SHA256=${reference.sha256}`));
      const baseline = readHandoffMaterial<{ knowledgeOriginals: Record<string, string> }>(runDir, reference);
      const originalBytes = Buffer.from(baseline.knowledgeOriginals[relative], 'base64');
      assert.equal(originalBytes.toString('utf8'), before, '独立方能沿提示定位并读出准确的原字节');
      const section = context.instruction!.split('## 本事务知识资产的实际改动')[1]?.split('\n逐条独立核对资产')[0];
      const arrayStart = section?.indexOf('\n[') ?? -1;
      assert(section && arrayStart >= 0, '独立提示保留逐项当前路径及前后hash');
      const change = JSON.parse(section.slice(arrayStart + 1).trim()).find((item: Json) => item.path === relative);
      const currentBytes = fs.readFileSync(file);
      assert.equal(change.before_sha256, createHash('sha256').update(originalBytes).digest('hex'));
      assert.equal(change.current_sha256, createHash('sha256').update(currentBytes).digest('hex'));
      const terms = YAML.parse(currentBytes.toString('utf8')).terms;
      assert.equal(terms.find((item: Json) => item.term === 'LedgerDataSource').definition, decision.stable_contract,
        '沿当前path能核到原批准结论的准确落盘值');
      assert(context.instruction?.includes('未涉及条目未被改写'));
      if (mode === 'questioning') execFileSync(process.execPath, ['-e', 'require("fs").appendFileSync(process.argv[1],"# forbidden Q write\\n")', file]);
      return { status: 'passed', phase: context.phase, exitCode: 0, stdout: '', stderr: '', command: 'independent Q transport', details: JSON.stringify(doc.review_summary.questioning) };
    } } });
    const result = await runUnattendedDesignRepair({ ...input, designTarget: designRepairTarget(root, BLUEPRINT),
      brief: { class: 'B1', items: [{ check: 'component-closure', codes: ['component_closure_knowledge_conclusion_unplaced'], class: 'B1', artifacts: [loaded.canonicalPath], basis: 'decision:seam-shape', needs: [] }] },
      invoke: (purpose, prompt, guard) => runtime.invokeDesignOwner(manifest, root, FRAMEWORK, acquired.token, purpose, prompt, guard, input.emit) });
    if (mode === 'allowed') {
      assert.equal(result.outcome, 'published', JSON.stringify(result)); assert.equal(questionCalls, 1);
      assert(rows.some(row => row.stage === 'published'));
      const published = loadCanonicalBlueprint(root, BLUEPRINT);
      assert.equal(published.blueprint.revision, Number(doc.revision) + 1);
      assert.equal(deriveBlueprintSkillInput(root, FEATURE, FRAMEWORK, 'acceptance').state, 'resolved', 'normal reconciliation repoints the CU');
    } else {
      assert.equal(result.outcome, 'violation', JSON.stringify(result));
      assert.equal(questionCalls, mode === 'questioning' ? 1 : 0);
      assert(!rows.some(row => row.stage === 'published'));
      const protectedPath = mode === 'outside' ? 'requirements/ledger.md'
        : mode === 'canonical' ? path.relative(root, loaded.canonicalPath).replace(/\\/g, '/') : relative;
      assert(phaseWriteConflictProblems(root, rows).some(problem => problem.files?.includes(protectedPath)), 'non-draft conflicts remain completion blockers');
    }
  }),
})), {
  name: 'daily design runtime: snapshot distinguishes authorized draft and own heartbeat from protected input writes', group: 'runtime',
  run: () => withProject(root => {
    const draft = 'doc/features/repair/goal-runs/current/design-repair/draft.yaml', own = 'doc/features/repair/goal-runs/current/liveness.json';
    for (const file of [draft, own]) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'before'); }
    const resolution = { projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'framework.config.json'], executionRole: 'author' as const };
    const options = { ownedPrefixes: [path.dirname(draft)], runtimeExcluded: [own] };
    const before = capturePhaseInvocationSnapshot(resolution, options);
    fs.writeFileSync(path.join(root, draft), 'actual draft'); fs.writeFileSync(path.join(root, own), 'actual heartbeat');
    assert.equal(diffPhaseInvocationSnapshots(before, capturePhaseInvocationSnapshot(resolution, options)).kind, 'clean');
    const requirement = path.join(root, 'requirements/ledger.md'); fs.appendFileSync(requirement, '\nunauthorized requirement change\n');
    const change = diffPhaseInvocationSnapshots(before, capturePhaseInvocationSnapshot(resolution, options));
    assert(change.kind === 'changed' && change.changes.some(row => row.path === 'requirements/ledger.md'));
  }),
}, {
  name: 'daily design runtime: unreadable protected input is unverifiable rather than clean', group: 'runtime',
  run: () => withProject(root => {
    const target = path.join(root, 'requirements/ledger.md');
    const resolution = { projectRoot: root, protectedRoots: ['requirements'] };
    const before = capturePhaseInvocationSnapshot(resolution), nativeFs = require('fs') as typeof fs, readFile = fs.readFileSync;
    try {
      nativeFs.readFileSync = ((file: fs.PathOrFileDescriptor, ...args: any[]) => {
        if (typeof file !== 'number' && path.resolve(String(file)) === target) throw Object.assign(new Error('controlled EACCES'), { code: 'EACCES' });
        return (readFile as any)(file, ...args);
      }) as typeof fs.readFileSync;
      const after = capturePhaseInvocationSnapshot(resolution);
      assert(after.failureReason); assert.equal(diffPhaseInvocationSnapshots(before, after).kind, 'unverifiable');
    } finally { nativeFs.readFileSync = readFile; }
  }),
}, {
  name: 'daily design runtime: a newly referenced normally excluded input remains an unknown original', group: 'runtime',
  run: () => withProject(root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), before = capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'contracts'] });
    const file = path.join(root, 'context/new-contract.yaml'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'newly referenced original\n');
    const doc = structuredClone(loaded.blueprint) as Json; node(doc).contracts.source_ref = 'context/new-contract.yaml';
    const changed = questioningDependencyChanges(root, doc, before, loaded.canonicalPath);
    assert(changed.some(entry => path.resolve(entry.path) === file && entry.exists), JSON.stringify(changed));
  }),
}, {
  name: 'daily design runtime: unresolved containment cannot publish or start questioning', group: 'runtime',
  run: () => withProject(async root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), defective = read(loaded.canonicalPath);
    node(defective).acceptance = '当前批准验收需要设计owner恢复机器结构'; write(loaded.canonicalPath, defective);
    const { input, rows } = repairInput(root, 'daily-containment'); const calls: string[] = [];
    const result = await runUnattendedDesignRepair({ ...input, invoke: async purpose => {
      calls.push(purpose); return { started: true, ok: false, detail: 'controlled external containment is unresolved', containmentUnresolved: true };
    } });
    assert.equal(result.outcome, 'containment_unresolved'); assert.deepEqual(calls, ['author']);
    assert(!rows.some(row => row.stage === 'published'));
  }),
}, {
  name: 'daily design runtime: failed second lock releases owned locks and retains the borrowed feature lock', group: 'runtime',
  run: () => withProject(root => {
    const doc = loadCanonicalBlueprint(root, BLUEPRINT); const changed = structuredClone(doc.blueprint) as Json; changed.revision++;
    for (const result of changed.derived_results ?? []) result.input_revision = changed.revision;
    write(doc.canonicalPath, changed);
    const lockPath = (id: string) => featureFilePath(root, deriveChangeUnitFeatureId(BLUEPRINT, id), path.join('goal-runs', FEATURE_LOCK_NAME));
    const lent = tryAcquireLock(lockPath('ledger-refresh'), { run_id: 'actual-caller' }); assert(lent);
    const nativeFs = require('fs') as typeof fs, open = fs.openSync; let injected = false;
    try {
      nativeFs.openSync = ((file: fs.PathLike, ...args: any[]) => {
        if (!injected && path.resolve(String(file)) === path.resolve(lockPath('ledger-recovery'))) {
          injected = true; throw Object.assign(new Error('controlled lock EACCES'), { code: 'EACCES' });
        }
        return (open as any)(file, ...args);
      }) as typeof fs.openSync;
      assert.throws(() => reconcileChangeUnitBlueprintRefs(root, BLUEPRINT, { heldFeatureLocks: [{ path: lockPath('ledger-refresh'), ownerId: lent.ownerId }] }), /EACCES/);
    } finally { nativeFs.openSync = open; }
    try {
      assert(injected); assert(fs.existsSync(lockPath('ledger-refresh')));
      assert(!fs.existsSync(path.join(featureFilePath(root, BLUEPRINT, ''), BLUEPRINT_RECONCILE_LOCK_NAME)));
      for (const id of ['ledger-consumer', 'ledger-recovery', 'ledger-summary']) assert(!fs.existsSync(lockPath(id)));
      const retry = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT, { heldFeatureLocks: [{ path: lockPath('ledger-refresh'), ownerId: lent.ownerId }] });
      assert(!retry.busy && retry.bumped.length === 4, JSON.stringify(retry));
    } finally { releaseLock(lockPath('ledger-refresh'), lent.ownerId); }
  }),
}, {
  name: 'daily design runtime: copied canonical bytes cannot invent a publication transaction', group: 'runtime',
  run: () => withProject(async root => {
    const { input, runDir, rows } = repairInput(root, 'daily-no-transaction');
    const first = await runUnattendedDesignRepair({ ...input, invoke: async () => ({ started: true, ok: false, detail: 'request yielded', handoff: true }) });
    assert.equal(first.outcome, 'handoff');
    const draftFile = path.join(runDir, 'design-repair/component-blueprint.yaml'), draft = read(draftFile); draft.revision++;
    const bytes = YAML.stringify(draft); fs.writeFileSync(draftFile, bytes); fs.writeFileSync(loadCanonicalBlueprint(root, BLUEPRINT).canonicalPath, bytes);
    const result = await runUnattendedDesignRepair({ ...input, invoke: async () => ({ started: false, ok: false, detail: 'original report unreadable' }) });
    assert(result.outcome === 'failed' && result.step === 'author' && result.reason.includes('original report unreadable'), JSON.stringify(result));
    assert(fs.existsSync(draftFile)); assert(!rows.some(row => row.stage === 'published'));
  }),
}];

export const getCases = (group?: Group) => cases.filter(test => !group || test.group === group);
export const listCaseGroups = (group?: Group) => unitCaseGroups(getCases(group).map(test => test.name)).map(group => ({ ...group, releaseOnly: false }));
export async function runSelectedCases(selector?: string, group?: Group) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of getCases(group)) {
    if (!matchesUnitCase(test.name, selector)) continue;
    const stop = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
    finally { stop(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export const runAll = async () => (await runSelectedCases()).results;
if (require.main === module) void runSelectedCases().then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.results.some(row => !row.ok) ? 1 : 0; });
