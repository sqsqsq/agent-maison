import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { clearFrameworkConfigCache, featurePhaseReportsDir, loadFrameworkConfig } from '../../config';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { provisionFrameworkUnder, git } from '../utils/real-chain-host';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { currentFinding, confirm } from './verifier-semantic-handoff.unit.test';
import { compareAuthoritativeContent, deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { loadCanonicalChangeUnit, createChangeUnitRef } from '../../scripts/utils/change-unit-path';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { findPhaseDeltaSection } from '../../scripts/utils/context-facts';
import { parseContextExploration } from '../../scripts/utils/context-exploration';
import { parseVerifierRequest, type VerifierRequest } from '../../scripts/utils/verifier-request';
import { partitionConstructionFiles } from '../../scripts/utils/phase-write-boundary';
import { researchSnapshotFacts } from '../fixtures/host-snapshot-3.1.0/migrate';
import type { DeviceProbeResult, HdcInstallResult } from '../../../profiles/hmos-app/harness/hdc-runner';
import type { HvigorRunResult } from '../../../profiles/hmos-app/harness/hvigor-runner';
import type { HylyreRunResult } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, startCaseTiming, selectedUnitCases, type UnitExecutionTiming } from '../utils/unit-case-selection';

const source = path.join(__dirname, '../fixtures/host-recovery-history/20261023/20261023T044016Z-fe4512/project');
const historicalAuthors = path.join(__dirname, '../fixtures/host-recovery-history/20261024-fe4512-s1');
const baselineContext = path.join(source, '../replay-context-baseline-28394b60');
const visualObservations = path.join(source, '../replay-visual-observations-20261024');
const originalBaseline = '28394b60d2d017c70c18aa01449469e0d04bf107';
const feature = 'cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93';
const featureDir = 'doc/features/bc-openCard-2/bank-card-opening-flow';
const blueprint = 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml';
const runId = '20261023T044016Z-fe4512';
const serviceDir = '02-Feature/WalletMain/src/main/ets/domain/service';
const utFile = '02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets';
const historicalUt = '02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets';
const navigationRegistry = '01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets';
const deviceSerial = 's0-development-physical-substitute';
const deviceObservation = { available: true, hdcPresent: true, targets: [deviceSerial], raw: 'Explicit bounded SDK observation; no real device' } satisfies DeviceProbeResult;
const compileObservation = { executed: true, exitCode: 0, successMarkerFound: true, timedOut: false, durationMs: 1,
  logExcerpt: 'Explicit external hvigor substitute', errors: [], command: 'external-hvigor-substitute' } satisfies HvigorRunResult;
const installObservation = { ok: true, exitCode: 0, durationMs: 1, output: 'Explicit bounded HDC installation; no real device' } satisfies HdcInstallResult;
const write = (root: string, file: string, body: string): void => { const abs = path.join(root, file); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, body); };
const json = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));
const originalModuleFiles = (root: string): string[] => YAML.parse(fs.readFileSync(path.join(root, featureDir, 'contracts.yaml'), 'utf8')).modules
  .map((module: any) => module.package_path + '/src/main/module.json5').filter((file: string) => fs.existsSync(path.join(root, file)));

function supplyBaselineContext(root: string): void {
  for (const entry of json(path.join(baselineContext, 'sources.json')).files) {
    assert(!fs.existsSync(path.join(source, entry.file)), 'Context must never replace preserved S0 inputs: ' + entry.file);
    const bytes = fs.readFileSync(path.join(baselineContext, entry.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const file = path.join(root, entry.file);
    if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
  }
}

/** Diagnostic copies use the original pre-author commit, never the current modified worktree. */
export function repairIsolatedS0Baseline(root: string): void {
  assert(path.basename(root).startsWith('fe4512-owner-runtime-') && !fs.lstatSync(root).isSymbolicLink());
  supplyBaselineContext(root);
  const invoke = (args: string[], env?: NodeJS.ProcessEnv): string => {
    const result = spawnSync('git', args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const initial = invoke(['rev-list', '--max-parents=0', 'HEAD']);
  const indexFile = path.join(root, '.git', 's0-context.index');
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    invoke(['read-tree', initial], env);
    for (const entry of json(path.join(baselineContext, 'sources.json')).files) {
      if (invoke(['ls-tree', initial, '--', entry.file])) continue;
      const object = invoke(['hash-object', '-w', path.join(baselineContext, entry.file)]);
      invoke(['update-index', '--add', '--cacheinfo', '100644', object, entry.file], env);
    }
    const tree = invoke(['write-tree'], env);
    const commit = invoke(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit-tree', tree,
      '-m', 'Original S0 pre-author snapshot plus exact missing baseline context']);
    git(root, ['update-ref', 'refs/replace/' + originalBaseline, commit]);
    write(root, 's0-baseline-adaptation.json', JSON.stringify({ original_baseline: originalBaseline, local_pre_author_commit: initial,
      isolated_baseline: commit, source_manifest: path.join(baselineContext, 'sources.json'), current_worktree_used: false }, null, 2));
  } finally { if (fs.existsSync(indexFile)) fs.unlinkSync(indexFile); }
}

export function repairHistoricalPrivateBridge(root: string): string[] {
  const oldPath = '02-Feature/WalletMain/src/main/ets/shared/HomeLaunchBridge.ets';
  const newPath = '02-Feature/WalletMain/src/main/ets/data/HomeLaunchBridge.ets';
  if (!fs.existsSync(path.join(root, oldPath)) && !fs.existsSync(path.join(root, newPath))) return [];
  if (fs.existsSync(path.join(root, oldPath))) {
    write(root, newPath, fs.readFileSync(path.join(root, oldPath), 'utf8').replace(/from '\.\.\/data\//g, "from './"));
    fs.unlinkSync(path.join(root, oldPath));
  }
  const index = '02-Feature/WalletMain/src/main/ets/index.ets';
  write(root, index, fs.readFileSync(path.join(root, index), 'utf8').replace('./shared/HomeLaunchBridge', './data/HomeLaunchBridge'));
  return [newPath, index];
}

export function assertVerifiedS0OwnerBoundary(issues: import('../../scripts/utils/repair-candidates').PhaseRepairIssues | null | undefined, actualReport: string) {
  const reader = require('../../scripts/utils/repair-candidates') as typeof import('../../scripts/utils/repair-candidates');
  const findings = reader.verifiedPhaseDesignFindings({ phaseIssues: issues, verifierReportText: actualReport });
  assert(findings.some(finding => finding.check === 'plan:reference_crosscheck'), 'The live current finding must reach its original design owner');
  assert.equal(reader.verifiedPhaseDesignFindings({ phaseIssues: issues ? { ...issues, rows: [] } : null, verifierReportText: actualReport }).length, 0,
    'Direct negative: losing the concrete finding cannot create owner work');
  assert.equal(reader.verifiedPhaseDesignFindings({ phaseIssues: issues, verifierReportText: actualReport.replace('repair_owner: external', 'repair_owner: coding') }).length, 0,
    'Direct negative: a coding label cannot authorize the design owner publication');
  return findings;
}

export function assertOwnerCompletion(root: string, frameworkRoot: string): Record<string, unknown> {
  const creation = require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation');
  const scope = creation.resolveEffectiveScopeSource(root, feature, runId)!.scope;
  const chain = (require('../../scripts/utils/execution-scope') as typeof import('../../scripts/utils/execution-scope')).executionCompletionPhases(scope);
  const completion = (require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion')).inspectCompletionRecord({
    projectRoot: root, frameworkRoot, feature, expectedChain: chain, expectedTrack: 'full' });
  assert.equal(completion.verdict, 'VALID', completion.reasons.join('; '));
  const assessment = (require('../../scripts/utils/feature-assessment') as typeof import('../../scripts/utils/feature-assessment')).assessFeature(root, feature, { frameworkRoot, expectedChain: chain, expectedTrack: 'full' });
  assert.equal(assessment.complete, true, JSON.stringify(assessment));
  const cuPath = require('../../scripts/utils/change-unit-path') as typeof import('../../scripts/utils/change-unit-path');
  const loaded = cuPath.loadCanonicalChangeUnit(root, 'bc-openCard-2', 'bank-card-opening-flow');
  const cu = (require('../../scripts/utils/change-unit-completion') as typeof import('../../scripts/utils/change-unit-completion')).observeChangeUnitCompletion(root, cuPath.asChangeUnitArtifact(loaded.changeUnit));
  assert.equal(cu.state, 'VALID', cu.reasons.join('; '));
  const driver = require('../../scripts/utils/assess') as typeof import('../../scripts/utils/assess');
  const next = driver.assessFeature({ projectRoot: root, frameworkRoot, feature, authorization: { mode: 'batch_authorized' } });
  assert.equal(next.recommendation.action, 'feature_completed', JSON.stringify(next.recommendation));
  const testing = json(path.join(root, featureDir, 'testing/reports/summary.json'));
  assert.equal(testing.release_readiness, 'BLOCKED', 'Existing visual limitations remain disclosed');
  const toolFile = path.join(root, 'external-tool-events.jsonl');
  const actual = fs.readFileSync(toolFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.kind === 'actual_business_ut');
  assert(actual.length > 0 && actual.every(row => row.tests > 0 && row.assertions > 0 && row.failures.length === 0), 'Actual authored business assertions must run and pass');
  return { completion: completion.verdict, feature_complete: assessment.complete, cu: cu.state, next_action: next.recommendation.action,
    completion_chain: chain, release: testing.release_readiness, visual: testing.quality_axes?.visual?.verdict, native_business_runs: actual };
}

async function actualBusinessTests(root: string, frameworkRoot: string, testFile: string): Promise<any> {
  const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
  const ts = require(path.join(frameworkRoot, 'harness/node_modules/typescript'));
  const tests: any[] = [], before: Array<() => void> = [], cache = new Map<string, any>();
  let assertions = 0;
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    assert(file.startsWith(root + path.sep), 'Test source escaped disposable project');
    const module = { exports: {} }; cache.set(file, module.exports);
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(output, { module, exports: module.exports, Date, console, $r: (name: string) => ({ id: name }), require: (name: string) => {
      if (name === '@ohos/hypium') return { describe: (_name: string, run: () => void) => run(), it: (name: string, _timeout: number, run: () => void) => tests.push({ name, run }),
        beforeEach: (run: () => void) => before.push(run), expect: (actual: unknown) => ({ assertEqual: (expected: unknown) => { assert.deepStrictEqual(actual, expected); assertions++; },
          assertTrue: () => { assert.strictEqual(actual, true); assertions++; }, assertFalse: () => { assert.strictEqual(actual, false); assertions++; },
          assertUndefined: () => { assert.strictEqual(actual, undefined); assertions++; },
          assertDeepEquals: (expected: unknown) => { assert.deepStrictEqual(structuredClone(actual), structuredClone(expected)); assertions++; } }) };
      if (name === '@kit.ArkData') return { relationalStore: { SecurityLevel: { S1: 1 }, getRdbStore: async () => {
        throw new Error('Physical SDK RDB is outside this replay; the authored BankCardStore double must be injected');
      } } };
      return load(path.resolve(path.dirname(file), name + '.ets'));
    } }, { filename: file });
    cache.set(file, module.exports); return module.exports;
  };
  load(testFile).default();
  const failures: any[] = [];
  for (const test of tests) try { for (const setup of before) setup(); await test.run(); }
  catch (error) { failures.push({ suite: 'S0 actual business', test: test.name, message: (error as Error).message }); }
  return { tests: tests.length, assertions, failures };
}

export async function executeHistoricalAuthorAssertions(root: string, frameworkRoot: string): Promise<any[]> {
  return [await actualBusinessTests(root, frameworkRoot, path.join(root, historicalUt)),
    await actualBusinessTests(root, frameworkRoot, path.join(root, '01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets'))];
}

export function replayNativeSdk(opts: any, snapshotRoot: string): HylyreRunResult {
  const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
  const framework = opts.frameworkRoot ?? path.join(opts.projectRoot, 'framework'), harness = path.join(framework, 'harness');
  const config = require(path.join(harness, 'config'));
  const relative = 'doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T194450Z-003/hylyre';
  const sourceDir = path.join(snapshotRoot, relative), sourceTrace = path.join(sourceDir, 'trace.json');
  const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
  const ui: any[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(path.join(snapshotRoot, dir), { withFileTypes: true })) {
      const file = dir + '/' + entry.name;
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.ets')) {
        const bytes = fs.readFileSync(path.join(snapshotRoot, file));
        if (!/@(?:Component|Entry|Builder)\b/.test(bytes.toString('utf8'))) continue;
        assert(bytes.equals(fs.readFileSync(path.join(opts.projectRoot, file))), 'SDK corpus UI differs: ' + file);
        ui.push({ file, sha256: hash(bytes) });
      }
    }
  };
  for (const dir of ['01-Product/Phone/src/main/ets', '02-Feature/WalletMain/src/main/ets']) walk(dir);
  const derived = require(path.join(harness, 'scripts/utils/derived-hylyre-plan'));
  const normalizer = require(path.join(harness, 'scripts/utils/planned-step-normalizer'));
  const semantics = (file: string) => derived.extractDerivedPlanCases(fs.readFileSync(file, 'utf8')).map((row: any) => {
    const parsed = derived.parsePlannedStepsFromCell(derived.normalizePlannedStepsCell(row.steps_raw));
    assert(parsed.ok, parsed.error);
    return { id: row.tc_id, priority: row.priority, ac: row.ac_ref,
      steps: parsed.steps.map((step: any, index: number) => normalizer.normalizePlannedStep(step, index)) };
  });
  assert.deepStrictEqual(semantics(opts.derivedPlanPath), semantics(path.join(sourceDir, 'test-plan.hylyre.md')), 'SDK replay requires the identical case/action/assertion semantics');
  const started = new Date(), bytes = fs.readFileSync(sourceTrace), trace = JSON.parse(bytes.toString('utf8'));
  const originalPlan = trace.artifacts.plan;
  trace.artifacts.plan = path.resolve(opts.derivedPlanPath);
  fs.mkdirSync(path.dirname(opts.traceOutPath), { recursive: true });
  fs.writeFileSync(opts.traceOutPath, JSON.stringify(trace, null, 2) + '\n');
  fs.writeFileSync(opts.reportOutPath, '# Development SDK replay\nPreserved whole native observation corpus; no current physical-device execution.\n');
  const logPath = path.join(path.dirname(opts.traceOutPath), 'device-test-run.log');
  fs.writeFileSync(logPath, 'Development SDK replay of preserved S1 native steps; cases, observations, failures, non-execution and durations are unchanged.\n');
  const parsed = require(path.join(framework, 'profiles/hmos-app/harness/providers/device-test-run.ts')).parseHylyreTrace(opts.traceOutPath);
  const top = config.resolveFeatureArtifact(opts.projectRoot, opts.feature, 'test-plan.md').actualPath;
  const bound = require(path.join(harness, 'scripts/utils/native-trace-binding')).validateNativeTraceArtifactBinding({ trace: parsed,
    expectedFeature: opts.feature, tracePath: opts.traceOutPath, testPlanPath: top, derivedPlanPath: opts.derivedPlanPath });
  assert(bound.ok, bound.reasons.join('; '));
  const sourceMeta = JSON.parse(fs.readFileSync(path.join(sourceDir, 'frozen.device-test-run.meta.json'), 'utf8'));
  const ended = new Date(), reports = config.featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, framework);
  fs.writeFileSync(path.join(reports, 'device-test-run.meta.json'), JSON.stringify({ ...sourceMeta, ok: sourceMeta.ok, exit_code: sourceMeta.exit_code,
    command: 'development-sdk-native-corpus-replay', trace_path: opts.traceOutPath, report_path: opts.reportOutPath, log_path: logPath,
    run_started_at: started.toISOString(), run_ended_at: ended.toISOString(), ran_at: ended.toISOString(), run_duration_ms: ended.getTime() - started.getTime(),
    artifact_binding: bound.binding, hylyre_page_save: { attempted: false, exit_code: null, duration_ms: 0, names: [] } }));
  fs.writeFileSync(path.join(opts.projectRoot, 'sdk-replay-provenance.json'), JSON.stringify({ source_trace: sourceTrace, source_sha256: hash(bytes),
    ui, complete_cases: trace.cases.length, observations_changed: false, path_adaptation: { from: originalPlan, to: trace.artifacts.plan },
    current_device_execution: false, historical_step_durations_preserved: true, current_replay_window_recorded: true,
    visual_residuals: 'Current original visual debt remains; no visual PASS is supplied by this SDK replay' }, null, 2));
  return { executed: true, exitCode: sourceMeta.exit_code, ok: sourceMeta.ok, command: 'development-sdk-native-corpus-replay',
    tracePath: opts.traceOutPath, reportPath: opts.reportOutPath, trace: parsed, logPath, errors: sourceMeta.errors ?? [] };
}

export function installVisualSdkBoundary(root: string, frameworkRoot: string): void {
  const provider = path.join(frameworkRoot, 'profiles/hmos-app/harness/visual-diff-hylyre-screenshot.js');
  fs.writeFileSync(provider, `const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const real=require('./visual-diff-hylyre-screenshot.ts'),capture=require('./visual-diff-capture.ts'),root=${JSON.stringify(root)},corpus=${JSON.stringify(visualObservations)};
const manifest=JSON.parse(fs.readFileSync(path.join(corpus,'sources.json'))),nav=JSON.parse(fs.readFileSync(path.join(corpus,'visual-diff-nav.json')));
function guard(){const proof=JSON.parse(fs.readFileSync(path.join(root,'sdk-replay-provenance.json')));for(const row of proof.ui)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,row.file))).digest('hex'),row.sha256,'Visual SDK corpus UI changed: '+row.file);}
function copy(args,kind){guard();const slug=capture.sanitizeVisualDiffScreenSlug(args.screenId),base=path.join(root,'doc/features/bc-openCard-2/bank-card-opening-flow/device-testing/device-screenshots'),relative=path.relative(base,args.destAbs);assert(!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(relative).includes(slug),'Unknown visual SDK capture role');const file='device-screenshots/'+relative.split(path.sep).join('/'),entry=manifest.files.find(row=>row.file===file);assert(entry,'Unknown visual SDK observation '+file);let bytes=fs.readFileSync(path.join(corpus,file));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);if(entry.normalization==='CRLF->LF only')bytes=Buffer.from(bytes.toString('utf8').split(String.fromCharCode(10)).join(String.fromCharCode(13,10)));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.source_sha256);fs.mkdirSync(path.dirname(args.destAbs),{recursive:true});fs.writeFileSync(args.destAbs,bytes);return {ok:true};}
module.exports={readDeviceTestRunHylyreNavOpts:real.readDeviceTestRunHylyreNavOpts,buildHylyreVisualDiffScreenshotFn:()=>args=>copy(args,'shot'),buildHylyreLayoutDumpFn:()=>args=>copy(args,'layout'),buildHylyreNavExecutorFn:()=>args=>{guard();const screen=nav.screens[args.screenId];assert(screen,'Unknown visual SDK screen '+args.screenId);assert.deepStrictEqual(args.steps,screen.steps,'Visual SDK navigation differs');return {ok:true};}};
`);
}

function testingVisualModel(root: string, frameworkRoot: string, attemptId: string): boolean {
  const visual = require(path.join(frameworkRoot, 'profiles/hmos-app/harness/visual-provider-review.ts')) as typeof import('../../../profiles/hmos-app/harness/visual-provider-review');
  const file = visual.visualDiffJsonPathFor(root, feature), script = path.join(root, featureDir, 'testing/reports/script-report.json');
  if (!fs.existsSync(file) || !fs.existsSync(script) || !fs.existsSync(path.join(root, 'sdk-replay-provenance.json'))) return false;
  const doc = json(file), raw = json(script), capture = raw.checks.find((check: any) => check.id === 'visual_diff_capture');
  if (capture?.status === 'FAIL') return false;
  const targets = visual.collectReviewTargets({ projectRoot: root, feature }, doc.screens);
  const source = json(path.join(visualObservations, 'visual-author-observations.json'));
  const hashes = targets.flatMap(target => [target.refHash, target.shotHash]);
  assert.deepEqual([...hashes].sort(), [...source.image_hashes].sort(), 'Historical visual observations require identical entire image inputs');
  const body = { ...source, run_id: runId, attempt_id: attemptId, image_hashes: hashes };
  const valid = visual.validateVisualProviderReviewPayload(JSON.stringify(body), { targets, runId, attemptId, requireRegionAttest: false });
  assert(valid.ok, valid.ok ? '' : valid.reason);
  const findings = raw.checks.find((check: any) => check.id === 'visual_diff')?.structured?.t8_findings ?? [];
  const history = path.resolve(__dirname, '../../reports/6fd6c8c1', `s0-visual-before-${attemptId}.json`);
  if (!fs.existsSync(history)) fs.copyFileSync(file, history);
  for (const entry of doc.screens) {
    entry.must_fix = []; entry.defects = [];
    for (const finding of findings.filter((row: any) => row.screen_id === entry.screen_id && row.tier !== 'advisory')) {
      const index = entry.must_fix.length;
      entry.must_fix.push(`Review current raw T8 ${finding.signal} evidence ${finding.finding_id}; original tier=${finding.tier}`);
      entry.defects.push({ class: finding.signal === 'A1_protected_region' ? 'overlap' : 'other', severity: finding.tier === 'hard' ? 'major' : 'minor',
        element: finding.elements[0], bbox: finding.bbox, must_fix_refs: [index], note: `Current raw ${finding.tier} ${finding.signal}; qualification remains with the production oracle`,
        source: { producer: 'T8', finding_id: finding.finding_id, signal: finding.signal } });
    }
    visual.applyProviderReviewToScreen(entry, valid.screens.find(row => row.screen_id === entry.screen_id)!, {
      invokeId: 'development-model-reuse-original-visual-observations', provider: { adapter: 'codex', model: 'deterministic-historical-visual-observation-model' },
      evaluatedScreenshotHash: targets.find(target => target.screen_id === entry.screen_id)!.shotHash, hardPixel: false });
  }
  visual.writeVisualDiffJsonAtomic(file, doc);
  return true;
}

function testingSelfCheck(root: string, frameworkRoot: string, attemptId: string): number {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^MAISON_(GOAL_|DEVICE_)/.test(key)) delete env[key];
  Object.assign(env, { MAISON_GOAL_RUN_ID: runId, MAISON_GOAL_ATTEMPT: attemptId, MAISON_GOAL_ATTEMPT_PHASE: 'testing', MAISON_GOAL_RUNNER: '1',
    HARNESS_HDC_TARGET: deviceSerial, MAISON_DEVICE_TARGET_KIND: 'physical', MAISON_DEVICE_SESSION_ID: `testing-${attemptId}`, MAISON_DEVICE_ATTEMPT_FROZEN: '1',
    MAISON_GOAL_CHECKPOINT_DIR: path.join(root, 'trust-cp'), HARNESS_HDC_EXE: path.join(root, 'no-device.cmd') });
  const result = spawnSync(process.execPath, [path.join(frameworkRoot, 'harness/node_modules/ts-node/dist/bin.js'), '--transpile-only',
    path.join(frameworkRoot, 'harness/harness-runner.ts'), '--project-root', root, '--phase', 'testing', '--feature', feature, '--summary'], {
    cwd: path.join(frameworkRoot, 'harness'), env, encoding: 'utf8', windowsHide: true, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(path.resolve(__dirname, '../../reports/6fd6c8c1', `s0-testing-model-selfcheck-${attemptId}.log`), `${result.stdout}\n${result.stderr}`);
  assert(!result.error, result.error?.message);
  return result.status ?? 1;
}

function externalToolBoundaries(root: string, frameworkRoot: string): void {
  const localFile = path.join(root, 'framework.local.json');
  const local = fs.existsSync(localFile) ? json(localFile) : { schema_version: '1.0', agent_adapter: 'codex', toolchain: { devEcoStudio: {} } };
  const deveco = path.join(root, 'external-deveco');
  write(root, 'external-deveco/tools/hvigor/bin/hvigorw.bat', '@echo off\nexit /b 97\n');
  local.toolchain.devEcoStudio.installPath = deveco.replace(/\\/g, '/');
  fs.writeFileSync(localFile, JSON.stringify(local, null, 2));
  // S0 excludes build-system setup. This isolated external-tool environment contains no credentials.
  const modules = YAML.parse(fs.readFileSync(path.join(source, featureDir, 'contracts.yaml'), 'utf8')).modules;
  write(root, 'build-profile.json5', JSON.stringify({ app: { products: [{ name: 'default' }] },
    modules: modules.map((module: any) => ({ name: module.name, srcPath: './' + module.package_path })) }, null, 2));
  if (!fs.existsSync(path.join(root, 'AppScope/app.json5'))) {
    fs.mkdirSync(path.join(root, 'AppScope'), { recursive: true });
    fs.copyFileSync(path.join(historicalAuthors, 'AppScope/app.json5'), path.join(root, 'AppScope/app.json5'));
  }
  for (const module of modules) write(root, module.package_path + '/build-profile.json5', JSON.stringify({ targets: [{ name: 'default' }, { name: 'ohosTest' }] }));
  const dir = path.join(frameworkRoot, 'profiles/hmos-app/harness/providers');
  installVisualSdkBoundary(root, frameworkRoot);
  for (const base of ['device-test-build', 'device-test-install', 'device-test-run']) fs.copyFileSync(path.join(__dirname, '../utils/real-chain-providers', base + '.js'), path.join(dir, base + '.js'));
  fs.appendFileSync(path.join(dir, 'device-test-build.js'), `\nconst buildSdk=exports.runDeviceTestAppBuild;exports.runDeviceTestAppBuild=opts=>{const started=Date.now(),result=buildSdk(opts),hvigor={...${JSON.stringify(compileObservation)},durationMs:Date.now()-started},stat=fs.statSync(result.hapPath),hapBuiltAt=new Date(stat.mtimeMs).toISOString();const reportDir=require(${JSON.stringify(path.join(frameworkRoot, 'harness/config'))}).featurePhaseReportsDir(opts.projectRoot,opts.feature,opts.phase,opts.frameworkRoot);fs.mkdirSync(reportDir,{recursive:true});fs.writeFileSync(path.join(reportDir,'device-test-build.result.json'),JSON.stringify({reused:false,resolvedProduct:result.resolvedProduct,resolvedBuildMode:result.resolvedBuildMode,hapPath:result.hapPath,hapMtimeMs:stat.mtimeMs,hapBuiltAt,hvigorExecuted:hvigor.executed,hvigorExitCode:hvigor.exitCode,hvigorDurationMs:hvigor.durationMs,timestamp:new Date().toISOString()}));return {...result,hvigor,hapMtimeMs:stat.mtimeMs,hapBuiltAt};};\n`);
  fs.appendFileSync(path.join(dir, 'device-test-install.js'), `\nconst installSdk=exports.installDeviceTestApp;exports.installDeviceTestApp=opts=>{const started=Date.now(),result=installSdk(opts),install={...${JSON.stringify(installObservation)},durationMs:Date.now()-started};const reportDir=featurePhaseReportsDir(opts.projectRoot,opts.feature,opts.phase,opts.frameworkRoot),file=path.join(reportDir,'device-test-install.meta.json'),meta=JSON.parse(fs.readFileSync(file));fs.writeFileSync(file,JSON.stringify({...meta,exitCode:install.exitCode,durationMs:install.durationMs}));return {...result,probe:${JSON.stringify(deviceObservation)},install};};\n`);
  fs.appendFileSync(path.join(dir, 'device-test-run.js'), `\nexports.observeSetupForUnexecutedTrace=(trace,serial)=>{if(!['passed','success'].includes(trace?.outcome))throw Error('SDK replay refuses an unknown device-observation branch');return real.observeSetupForUnexecutedTrace(trace,serial);};exports.runHylyreDeviceTest=opts=>(${replayNativeSdk.toString()})(opts,${JSON.stringify(historicalAuthors)});\n`);
  write(root, 's0-external-tools.cjs', `const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=__dirname,harness=path.join(root,'framework/harness'),ts=require(path.join(harness,'node_modules/typescript'));
exports.compile=opts=>{const p=path.join(root,'external-tool-events.jsonl');fs.appendFileSync(p,JSON.stringify({kind:'external_compile',phase:opts.phase,module:opts.moduleName})+'\\n');return ${JSON.stringify(compileObservation)};};
exports.ut=opts=>{const result=require('child_process').spawnSync(process.execPath,[path.join(root,'s0-actual-business-ut.cjs'),String(opts.moduleName||'WalletMain')],{cwd:root,encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stdout+result.stderr);const actual=JSON.parse(result.stdout);fs.appendFileSync(path.join(root,'external-tool-events.jsonl'),JSON.stringify({kind:'actual_business_ut',...actual})+'\\n');const text=actual.failures.map(f=>'OHOS_REPORT_STATUS: class='+f.suite+'\\nOHOS_REPORT_STATUS: test='+f.test+'\\nOHOS_REPORT_STATUS: stack='+f.message).join('\\n')+'\\nOHOS_REPORT_RESULT: stream=Tests run: '+actual.tests+', Failure: '+actual.failures.length+', Error: 0, Pass: '+(actual.tests-actual.failures.length)+', Ignore: 0';const testResult=require(path.join(root,'framework/profiles/hmos-app/harness/hdc-runner.ts')).parseHypiumStdout(text);return {...exports.compile(opts),testResult};};
`);
  write(root, 's0-actual-business-ut.cjs', `const path=require('path'),files=${JSON.stringify({ WalletMain: utFile, Phone: '01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets' })};const selected=files[process.argv[2]];if(!selected)throw Error('No authored business test boundary for module '+process.argv[2]);(${actualBusinessTests.toString()})(__dirname,path.join(__dirname,'framework'),path.join(__dirname,selected)).then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{console.error(error.stack);process.exitCode=1});\n`);
  const bridge = path.join(root, 's0-external-tools.cjs');
  for (const [base, name] of [['coding-compile', 'runHvigorAssembleApp'], ['ut-compile', 'runHvigorBuild'], ['ut-run', 'runHvigorTest']]) {
    fs.writeFileSync(path.join(dir, base + '.js'), `const real=require('./${base}.ts'),tools=require(${JSON.stringify(bridge)});module.exports={...real,${name}:tools.${base === 'ut-run' ? 'ut' : 'compile'}${base === 'ut-run' ? ',probeDevices:()=>(' + JSON.stringify(deviceObservation) + ')' : ''}};\n`);
  }
}

/** Deterministic author/verifier models; the production gates, closure, ownership and finalizer remain unchanged. */
async function ownerRepairRuntime(resumeRoot?: string): Promise<void> {
  const temporaryRoot = process.env.FE4512_OWNER_KEEP_ROOT === '1' ? path.join(process.env.LOCALAPPDATA!, 'Temp') : os.tmpdir();
  const root = path.resolve(resumeRoot ?? fs.mkdtempSync(path.join(temporaryRoot, 'fe4512-owner-runtime-')));
  assert(path.basename(root).startsWith('fe4512-owner-runtime-')
    && [os.tmpdir(), path.join(process.env.LOCALAPPDATA!, 'Temp')].some(base => root.startsWith(path.resolve(base) + path.sep))
    && !fs.lstatSync(root).isSymbolicLink(), 'Replay root must be its own ordinary temporary directory');
  const originalEvents = fs.readFileSync(path.join(source, featureDir, 'goal-runs', runId, 'events.jsonl'));
  const savedHdc = process.env.HARNESS_HDC_EXE;
  let frameworkRoot = '', probe: Awaited<ReturnType<typeof runGoalRuntimeChain>> | undefined;
  const modelOutputs: Array<{ phase: string; file: string; source: string; sha256: string }> = [];
  const copyAuthor = (phase: string, file: string): void => {
    const original = path.join(historicalAuthors, file);
    assert(fs.existsSync(original), 'Historical author output is missing: ' + file);
    const bytes = fs.readFileSync(original);
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), bytes);
    modelOutputs.push({ phase, file, source: original, sha256: createHash('sha256').update(bytes).digest('hex') });
  };
  try {
    if (!resumeRoot) fs.cpSync(source, root, { recursive: true, filter: file => !fs.lstatSync(file).isSymbolicLink()
      && !/^framework(?:[\\/]|$)/.test(path.relative(source, file)) });
    if (!resumeRoot) supplyBaselineContext(root);
    ({ frameworkRoot } = provisionFrameworkUnder(root));
    externalToolBoundaries(root, frameworkRoot);
    const sourceSnapshot = ['harness/scripts/goal-phase-runtime.ts', 'harness/scripts/utils/verify-feature-completion.ts',
      'harness/scripts/utils/check-disposition.ts',
      'harness/scripts/utils/capability-resolution-entry-input.ts', 'harness/scripts/utils/repair-candidates.ts', 'harness/scripts/utils/goal-runner-phase.ts',
      'profiles/hmos-app/harness/layout-oracle-check.ts', 'profiles/hmos-app/harness/visual-diff-check.ts',
      'harness/harness-runner.ts', 'harness/scripts/check-plan.ts', 'harness/scripts/check-coding.ts', 'harness/scripts/check-ut.ts', 'harness/scripts/check-testing.ts'];
    const snapshotDir = path.resolve(__dirname, '../../reports/6fd6c8c1');
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(path.join(snapshotDir, 's0-startup-source.json'), JSON.stringify({ root, run_id: runId,
      captured_before_runtime: new Date().toISOString(), diagnostic_resume: !!resumeRoot,
      model_source_sha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
      original_s0_events_sha256: createHash('sha256').update(originalEvents).digest('hex'),
      production_sources: Object.fromEntries(sourceSnapshot.map(file => [file, {
        copied_sha256: createHash('sha256').update(fs.readFileSync(path.join(frameworkRoot, file))).digest('hex'),
        current_sha256: createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../../..', file))).digest('hex'),
      }])),
    }, null, 2));
    write(root, 'AGENTS.md', '# S0 isolated production-runtime recovery replay\n');
    write(root, '.gitignore', 'framework/\ntrust-cp/\nbuild/\n');
    write(root, 'no-device.cmd', '@echo off\necho unexpected>>"%~dp0device-operations.log"\nexit /b 97\n');
    process.env.HARNESS_HDC_EXE = path.join(root, 'no-device.cmd');
    for (const layer of loadFrameworkConfig(root).architecture.outer_layers) fs.mkdirSync(path.join(root, layer.id), { recursive: true });
    if (!resumeRoot) {
      git(root, ['init', '-q']); git(root, ['config', '--local', 'core.autocrlf', 'false']); git(root, ['config', '--local', 'core.eol', 'lf']);
      git(root, ['add', '-A']); git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Original S0 business and recovery inputs']);
      git(root, ['update-ref', 'refs/replace/' + originalBaseline, spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()]);
    }
    const reports = (phase: string) => featurePhaseReportsDir(root, feature, phase, frameworkRoot);
    const events = (): any[] => fs.readFileSync(path.join(root, featureDir, 'goal-runs', runId, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const published = (): boolean => events().some(event => event.type === 'design_authority_repair' && event.stage === 'published');
    const facts = (ctx: { phase: string; runId: string; goalAttemptId?: string }): void => {
      const admitted = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: ctx.phase,
        featuresDir: 'doc/features', goalRunId: ctx.runId, goalAttemptId: ctx.goalAttemptId }).factsContext;
      assert(admitted, 'The model must read the actual harness entry context before preparing facts');
      for (const file of admitted.source_paths) assert(path.resolve(root, file).startsWith(root + path.sep), 'Facts input must be relocated before reading: ' + file);
      const file = path.join(root, featureDir, 'context/facts.md');
      if (!fs.existsSync(file)) {
        const sources = admitted.source_paths.filter(file => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile());
        const inputPaths = [blueprint, featureDir + '/contracts.yaml', 'doc/features/原始需求/1-2-银行卡/原始需求.md', 'build-profile.json5',
          ...originalModuleFiles(root)];
        for (const file of inputPaths) fs.readFileSync(path.join(root, file));
        const sourceTexts = sources.map(file => fs.readFileSync(path.join(root, file)).toString('utf8'));
        const queries = ['OtpService', 'NavPathStack', 'getCards', 'BankCardOpeningService'];
        const searchResults = queries.map(query => sourceTexts.filter(text => text.includes(query)).length);
        write(root, featureDir + '/context/facts.md', '---\n' + YAML.stringify({ schema_version: '1.1', feature, run_id: ctx.runId,
          established_by: ctx.phase, ready_to_produce: true, has_blocker_coverage_risk: false, source_code_paths: sources,
          key_inputs_read: inputPaths, files_inspected_count: sources.length + inputPaths.length,
          searches_performed_estimate: queries.length, decisions_unlocked: ['Read current countdown and navigation contracts before producing phase materials'],
          search_log: queries.map((query, index) => ({ query, matching_files: searchResults[index] })) })
          + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n'
          + sources.map(file => '| ' + file + ' | 当前原文：' + fs.readFileSync(path.join(root, file), 'utf8').split('\n').find(line => line.trim())?.replace(/\|/g, '/') + ' | 本阶段调查当前输入 |').join('\n') + '\n');
      }
      researchSnapshotFacts(root, file, ctx.phase, admitted);
      const parsed = parseContextExploration(fs.readFileSync(file, 'utf8'));
      const delta = findPhaseDeltaSection(parsed.body, ctx.phase, true).content;
      const declared = [parsed.fm.key_inputs_read, parsed.fm.source_code_paths].flatMap(value => Array.isArray(value) ? value : []);
      const minimum = [blueprint, featureDir + '/contracts.yaml', 'doc/features/原始需求/1-2-银行卡/原始需求.md', 'build-profile.json5', ...originalModuleFiles(root)];
      const rows = minimum.flatMap(input => {
        const bytes = fs.readFileSync(path.join(root, input));
        return declared.includes(input) || delta.includes(input) ? [] : ['| ' + input + ' | 当前原文：'
          + bytes.toString('utf8').split(/\r?\n/).slice(0, 6).join(' ').replace(/\|/g, '/').slice(0, 180) + ' | 核对本阶段最低输入 |'];
      });
      for (const input of admitted.source_paths) if (!fs.existsSync(path.join(root, input)) && !declared.includes(input) && !delta.includes(input)) {
        rows.push('| ' + input + ' | 当前文件不存在，未声称已读取实现 | 按当前已发布契约交原源码责任方实现 |');
      }
      if (rows.length) fs.appendFileSync(file, '\n## phase_delta: ' + ctx.phase + '\n| 路径 | 事实 | 影响 |\n|---|---|---|\n' + rows.join('\n') + '\n');
    };
    const verifier = (phase: string, request: VerifierRequest): void => {
      const current = json(path.join(reports(phase), 'summary.json'));
      assert.equal(current.verifier_subject_id, request.subject_id, '模型必须核实实际收到的当前 request，不选历史路径或悄悄换 subject');
      assert.equal(request.feature, feature);
      assert.equal(request.phase, phase);
      const owned = phase === 'spec' ? ['acceptance.yaml', 'spec/spec.md', 'spec/ui-spec.yaml']
        : phase === 'plan' ? ['contracts.yaml', 'use-cases.yaml', 'plan/plan.md']
          : phase === 'review' ? ['contracts.yaml', 'review/review-report.md']
            : phase === 'ut' ? ['contracts.yaml', 'ut/testability-audit.md', 'ut/mock-plan.yaml']
              : phase === 'testing' ? ['contracts.yaml', 'testing/test-plan.md'] : ['contracts.yaml'];
      for (const file of owned) fs.readFileSync(path.join(root, featureDir, file));
      const promptFile = path.join(reports(phase), 'ai-prompt.md');
      if (fs.existsSync(promptFile)) fs.readFileSync(promptFile, 'utf8');
      if (phase === 'spec') {
        const expected = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'acceptance');
        const actual = YAML.parse(fs.readFileSync(path.join(root, featureDir, 'acceptance.yaml'), 'utf8'));
        assert(expected.state === 'resolved' && compareAuthoritativeContent(expected.value, actual).state === 'aligned', 'Independent spec model cannot approve drifted current acceptance');
      }
      let body = '# Explicit independent verifier model substitute\n\n';
      if (phase === 'plan' && !published()) {
        const finding = currentFinding(root);
        body += confirm(root, finding.report).text.replace(/<!-- maison-verifier-result:v1 -->[\s\S]*?<!-- \/maison-verifier-result:v1 -->/g, '');
      } else {
        body += 'Current authored files and machine checks were read; this model response never modifies their outcomes.\n';
        if (phase === 'plan') {
          const contracts = YAML.parse(fs.readFileSync(path.join(root, featureDir, 'contracts.yaml'), 'utf8'));
          const state = contracts.interfaces.find((entry: any) => entry.class === 'OtpVerificationState');
          assert(state?.methods.some((method: any) => method.name === 'resend') && state.methods.some((method: any) => method.name === 'tick'));
          body += '```yaml\nverification_result:\n  checks:\n    - id: reference_crosscheck\n      status: PASS\n      severity: MAJOR\n      evidence: Published OtpVerificationState exposes the actual countdown and resend controls. The unchanged AC-5 device layer retains real navigation; optional pure navigation is not an added requirement.\n  summary: { pass: 1, fail: 0 }\n```\n';
          body += '```issue-verification\n- issue: reference_crosscheck\n  verdict: refuted\n  evidence: Published OtpVerificationState.start/resend/tick/cancel resolves the original AC-3 unit gap; AC-5 remains device, with the original NavPathStack contract retained.\n```\n';
        }
        if (phase === 'ut') {
          const file = path.join(root, 'external-tool-events.jsonl');
          const executed = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.kind === 'actual_business_ut') : [];
          assert(executed.length > 0 && executed.every(row => row.tests > 0 && row.assertions > 0 && row.failures.length === 0), 'Verifier cannot approve absent or failed actual business assertions');
          body += '```yaml\nverification_result:\n  checks:\n    - id: end_to_end_driving\n      status: PASS\n      severity: MAJOR\n      evidence: Current historical authored UT drives the actual BankCardOpeningService state transitions through injected repositories and OTP; actual async bodies were awaited.\n    - id: business_assertion_value\n      status: PASS\n      severity: MAJOR\n      evidence: Current executed assertions check acceptance gates, resend/cancel, persistence rollback, completion context and existing destination names; raw counts and failures are retained in external-tool-events.jsonl.\n  summary: { pass: 2, fail: 0 }\n```\n';
        }
        if (phase === 'testing') {
          const script = json(path.join(reports(phase), 'script-report.json'));
          assert.equal(current.verdict, 'PASS');
          assert(!script.checks.some((check: any) => check.status === 'FAIL'));
          assert.equal(current.quality_axes.asset.verdict, 'PASS');
          assert(!current.readiness_signals?.some((signal: any) => signal.id === 'post_review_source_drift_unreviewed'));
          assert.equal(current.release_readiness, 'BLOCKED');
          const executed = fs.readFileSync(path.join(root, 'external-tool-events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.kind === 'actual_business_ut');
          assert(executed.reduce((n, row) => n + row.tests, 0) >= 14 && executed.every(row => row.failures.length === 0));
          for (const file of ['test-report.md', 'device-testing/device-screenshots/visual-diff.json']) fs.readFileSync(path.join(root, featureDir, file.startsWith('device-testing/') ? file : 'testing/' + file));
          const checks = [
            ['device_test_run_consumption', 'PASS', 'The whole nine-case SDK native corpus is consumed by current real parsers and bindings; this is not current physical-device certification.'],
            ['test_case_completeness', 'WARN', 'All eleven cases remain; the two known manual data/performance gaps are disclosed, never N/A or passed.'],
            ['test_steps_reproducible', 'PASS', 'Current normalized actions/assertions and all corresponding UI source bytes match the complete observation corpus.'],
            ['expected_result_specific', 'PASS', 'Current native assertions and acceptance checkpoints passed the production P0 checks.'],
            ['nfr_test_coverage', 'WARN', 'Manual/performance and visual limitations remain; actual business UT assertions ran without failures.'],
            ['defect_severity_consistency', 'PASS', 'Current oracle signals are transcribed without lowering hard tiers; old interpretations remain in developer history.'],
            ['pass_criteria_met', 'PASS', 'Functional checks are separated from visual UNVERIFIED and release BLOCKED; no clean pixel or real-device completion is claimed.'],
            ['visual_diff_bidirectional', 'WARN', 'Strict same-image original visual observations are reused and residuals retained; current production qualification controls every hard signal.'],
            ['reference_crosscheck', 'PASS', 'Current contracts, source inventory and real script report agree, with no post-review source drift.'],
          ];
          body += '\n```yaml\n' + YAML.stringify({ verification_result: { phase, feature,
            checks: checks.map(([id, status, evidence]) => ({ id, status, severity: 'MAJOR', evidence })), summary: { verdict: 'PASS', blocker_count: 0 } } }) + '```\n';
        }
        if (phase === 'review') {
          const report = fs.readFileSync(path.join(root, featureDir, 'review/review-report.md'), 'utf8');
          const rows = (require('../../scripts/utils/repair-candidates') as typeof import('../../scripts/utils/repair-candidates')).parseReviewIssueRows(report).filter(row => !/已关闭|已修复|closed|fixed/i.test(row.state));
          if (rows.length) body += '\n```issue-verification\n' + rows.map(row => '- issue: ' + row.id + '\n  verdict: confirmed\n  repair_owner: coding\n  evidence: ' + row.files.join(', ') + ' | ' + row.summary.replace(/\n/g, ' ') + '\n').join('') + '```\n';
        }

      }
      publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: reports(phase), feature, phase,
        subjectId: request.subject_id, skipSummaryPatch: true, reportText: body });
      if (phase === 'plan' && !published()) {
        const reader = require('../../scripts/utils/repair-candidates') as typeof import('../../scripts/utils/repair-candidates');
        const issues = reader.phaseIssuesForVerifierSubject(root, feature, phase, current.verifier_subject_id, frameworkRoot);
        const actualReport = fs.readFileSync(path.join(reports(phase), `verifier.report.${current.verifier_subject_id}.md`), 'utf8');
        const modelIssues = reader.readVerifierSemanticIssues(root, feature, phase, actualReport, '(current verifier model report)', frameworkRoot);
        const findings = assertVerifiedS0OwnerBoundary(modelIssues, actualReport);
        fs.writeFileSync(path.join(snapshotDir, 's0-live-owner-counterexamples.json'), JSON.stringify({ subject: current.verifier_subject_id,
          positive: findings.map(finding => finding.check), missing_finding_owner_work: 0, wrong_owner_design_work: 0,
          reader: 'production raw semantic reader and verifiedPhaseDesignFindings; the formal gate still owns material binding and publication',
          model_report: 'Deterministic independent verifier response based on current original materials' }, null, 2));
        console.log('[S0 current plan independent issue]', JSON.stringify({ subject: current.verifier_subject_id,
          rows: issues?.rows.map(row => row.id), diagnostics: issues?.diagnostics }));
      }
    };
    // Authors prepare owned materials only; the runtime's unchanged formal gate issues the verifier request.
    const prepareAuthorFacts = (ctx: { phase: string; runId: string; goalAttemptId?: string }): void => { facts(ctx); };
    const originalContracts = YAML.parse(fs.readFileSync(path.join(source, featureDir, 'contracts.yaml'), 'utf8'));
    (require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime')).__testing_setCanaryProbeInvoke(async () => ({
      exitCode: 1, stdout: '', stderr: 'Explicit unavailable visual model substitute; no real CLI invocation or visual PASS.', command: 'test-model-substitute',
    }));
    probe = await runGoalRuntimeChain(root, { frameworkRoot, featureId: feature, adapter: 'codex', resume: runId,
      realHarness: true, viaRuntimeClass: true, noAutoForce: true, skipLegacySeal: true, forceResume: true,
      deviceGate: (options: Parameters<typeof import('../../scripts/utils/device-readiness-gate').runDeviceReadinessGate>[0]) =>
        (require('../../scripts/utils/device-readiness-gate') as typeof import('../../scripts/utils/device-readiness-gate')).runDeviceReadinessGate({
          ...options, input: { ...options.input, configuredSerial: deviceSerial, emulatorFallback: 'disabled', deps: {
            listTargets: () => [deviceSerial], isLocked: () => false, wake: () => {},
            knownEmulatorSerials: () => [], attestPhysical: () => true,
          } },
        }),
      onSpec: prepareAuthorFacts,
      onPlan: ctx => {
        const projection = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'contracts');
        assert.equal(projection.state, 'resolved', projection.detail);
        const contracts = structuredClone(projection.value) as any;
        contracts.modules = structuredClone(originalContracts.modules);
        contracts.components = structuredClone(originalContracts.components);
        contracts.change_unit = structuredClone(originalContracts.change_unit);
        const loaded = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'bank-card-opening-flow');
        contracts.change_unit.change_unit_ref = createChangeUnitRef(loaded);
        for (const mapping of contracts.change_unit.design_ref_mappings) {
          mapping.design_ref = structuredClone((loaded.changeUnit.design_refs as any[]).find(ref => JSON.stringify(ref.target) === JSON.stringify(mapping.design_ref.target)));
          mapping.verification_refs = mapping.verification_refs.map((ref: string) => ref.replace(featureDir + '/acceptance.yaml', blueprint));
        }
        write(root, featureDir + '/contracts.yaml', YAML.stringify(contracts));
        write(root, featureDir + '/use-cases.yaml', YAML.stringify(projection.artifacts!['use-cases@1']));
        if (published()) {
          const file = path.join(root, featureDir, 'plan/plan.md');
          const prior = fs.readFileSync(file, 'utf8');
          fs.writeFileSync(file, prior
            .replace('| mobile、otp、countdown、sending、saving | OTP Sheet 实例 | `@State` + `setInterval` | OtpVerificationSheet | 出现即发送；关闭/aboutToDisappear 取消 Timer 并清空。 |',
              '| mobile、otp、sending、saving | OTP Sheet 实例 | `@State` | OtpVerificationSheet | 关闭/aboutToDisappear 取消 Timer 并清空。 |\n| 倒计时与重发资格 | 开卡业务会话 | OtpVerificationState.start/resend/tick/cancel | OtpVerificationState | UT 与页面时钟显式驱动同一业务状态；UI Timer 仅负责刷新显示。 |')
            + (prior.includes('### 独立核实后的实现职责') ? '' : '\n\n### 独立核实后的实现职责\n\nOtpVerificationState 是倒计时与重发状态的唯一业务持有者，BankCardOpeningService 调用它；UI 调用服务入口并负责 Timer 清理。AC-5 已明确为 device，真实 NavPathStack 和手势保持在 device 测试；不把可选纯导航函数升级为验收。\n'));
        }
        prepareAuthorFacts(ctx);
      },
      onCoding: ctx => {
        if (!published()) return;
        const contracts = YAML.parse(fs.readFileSync(path.join(root, featureDir, 'contracts.yaml'), 'utf8'));
        const files = partitionConstructionFiles(root, path.join(frameworkRoot, 'profiles/hmos-app'), contracts).implementation;
        for (const file of [...new Set<string>([...files, navigationRegistry])]) copyAuthor('coding', file);
        for (const file of repairHistoricalPrivateBridge(root)) modelOutputs.push({ phase: 'coding', file,
          source: 'Original baseline HomeLaunchBridge public API retained; private bridge moved shared -> data to satisfy the actual layer gate',
          sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') });
        for (const file of ['structure-conformance.yaml', 'upstream-issues.md']) {
          const prior = path.join(historicalAuthors, featureDir, 'coding', file);
          if (fs.existsSync(prior)) copyAuthor('coding', featureDir + '/coding/' + file);
        }
        prepareAuthorFacts(ctx);
      },
      onReview: ctx => {
        if (!published()) return;
        copyAuthor('review', featureDir + '/review/review-report.md');
        const file = path.join(root, featureDir, 'review/review-report.md');
        const bridge = '02-Feature/WalletMain/src/main/ets/data/HomeLaunchBridge.ets';
        const bridgeSource = fs.readFileSync(path.join(root, bridge), 'utf8');
        const publicIndex = fs.readFileSync(path.join(root, '02-Feature/WalletMain/src/main/ets/index.ets'), 'utf8');
        assert(bridgeSource.includes('export function applyLaunchHomeCardMode(raw: string | undefined): void'));
        assert(publicIndex.includes("export { applyLaunchHomeCardMode } from './data/HomeLaunchBridge'"));
        assert(!bridgeSource.includes("../data/"), 'The current bridge must depend on its own data layer');
        write(root, featureDir + '/review/review-report.md', fs.readFileSync(file, 'utf8')
          .replace(/> \*\*审查人\*\*:[^\n]*/, '> **审查人**: 确定性作者模型；复用保全 S1 审查材料并核对当前源码，无本轮真实模型 CLI 检视')
          .replace(/> \*\*能力解析说明\*\*:[^\n]*/, '> **能力解析说明**: 读取当前契约、验收与源码，消费本 run 真实生产 coding 检查；历史设备材料不作为本轮真机或 CLI 验收。')
          .replace(/(##[^\n]*审查范围[^\n]*\n)/, '$1\n当前实现增量：已读取 `' + bridge + '` 与 `02-Feature/WalletMain/src/main/ets/index.ets`。私有桥从 shared 移入 data，applyLaunchHomeCardMode 的公开签名、分支与导出名称保留；核对新相对 import 与现行分层一致，无新增公共需求或契约。\n')
          .replace(/最新 coding 阶段真实编译结果[\s\S]*?(?=\n\n)/,
            '当前生产 coding 检查原件由本 run 生成；本作者模型读取当前报告与当前源码。下列历史审查材料中的设备观察仅说明来源，不作为本轮真机或真实 CLI 验收。'));
        modelOutputs.push({ phase: 'review', file: featureDir + '/review/review-report.md',
          source: 'Preserved S1 authored review material, with historical CLI/build claims replaced by the explicit current model boundary',
          sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
        prepareAuthorFacts(ctx);
      },
      onUt: ctx => {
        if (!published()) return;
        for (const relative of ['02-Feature/WalletMain/src/ohosTest', '01-Product/Phone/src/ohosTest']) {
          const copy = (dir: string): void => { for (const entry of fs.readdirSync(path.join(historicalAuthors, dir), { withFileTypes: true })) {
            const file = dir + '/' + entry.name; if (entry.isDirectory()) copy(file); else copyAuthor('ut', file);
          } };
          copy(relative);
        }
        for (const file of ['testability-audit.md', 'mock-plan.yaml', 'context-exploration.md']) {
          const prior = path.join(historicalAuthors, featureDir, 'ut', file);
          if (fs.existsSync(prior)) copyAuthor('ut', featureDir + '/ut/' + file);
        }
        for (const file of ['02-Feature/WalletMain/src/main/ets/data/HomeLaunchBridge.ets', '02-Feature/WalletMain/src/main/ets/index.ets']) fs.readFileSync(path.join(root, file));
        fs.appendFileSync(path.join(root, featureDir, 'ut/testability-audit.md'), '\n## 当前私有实现增量调查\n\n已读取 `02-Feature/WalletMain/src/main/ets/data/HomeLaunchBridge.ets` 与当前 WalletMain/index.ets；迁移只修正私有依赖分层，公开 applyLaunchHomeCardMode 签名与调用行为保留，没有新增业务验收义务。当前 OTP 状态/业务会话/目的地注册表仍由实际作者 UT 执行断言；真机导航仍按 AC-5 的 device 职责验证。\n');
        // These are authored coverage/DAG inputs, never S1 script-report/summary/verifier/closure outputs.
        for (const file of ['coverage-evidence.json', 'flow-dag']) {
          const prior = path.join(historicalAuthors, featureDir, 'ut/reports', file);
          if (fs.existsSync(prior)) { fs.mkdirSync(reports('ut'), { recursive: true }); fs.cpSync(prior, path.join(reports('ut'), file), { recursive: true }); }
        }
        prepareAuthorFacts(ctx);
      },
      onTesting: ctx => {
        if (!published()) return;
        copyAuthor('testing', featureDir + '/testing/test-plan.md');
        write(root, featureDir + '/device-testing/visual-diff-nav.json', fs.readFileSync(path.join(visualObservations, 'visual-diff-nav.json'), 'utf8'));
        for (const file of ['02-Feature/WalletMain/src/main/ets/data/HomeLaunchBridge.ets', '02-Feature/WalletMain/src/main/ets/index.ets']) fs.readFileSync(path.join(root, file));
        fs.appendFileSync(path.join(root, featureDir, 'testing/test-plan.md'), '\n## 当前实现增量的设备影响\n\n已读取 `02-Feature/WalletMain/src/main/ets/data/HomeLaunchBridge.ets` 与当前 WalletMain/index.ets；仅私有文件分层位置改变，公开导出及冷启动行为保持。既有 TC-001 等 stop_app/start_app 流程继续覆盖当前产品入口，本步骤不预签设备结果；执行、原生解析和发布状态均由当前正式 gate 决定。\n');
        const hint = require('../../scripts/utils/test-plan-derive-hint') as typeof import('../../scripts/utils/test-plan-derive-hint');
        hint.writeCanonicalDeriveHint(path.join(reports('testing'), 'derive-hint-from-plan.json'), hint.buildCanonicalDeriveHintPayload(root, feature));
        const derived = path.join(historicalAuthors, featureDir, 'testing/reports/20261024T194450Z-003/hylyre/test-plan.hylyre.md');
        write(root, featureDir + '/testing/reports/20261025T000000Z-model/hylyre/test-plan.hylyre.md', fs.readFileSync(derived, 'utf8')
          .replace('本轮按 2026-10-24T19:43:50.839Z derive hint 更新 P0 AC 追溯与 checkpoint 注入输入。', '本轮使用当前真实 derive hint；历史作者模板只提供相同业务用例的执行步骤。'));
        prepareAuthorFacts(ctx);
        assert(ctx.goalAttemptId);
        let checkedStatus = testingSelfCheck(root, frameworkRoot, ctx.goalAttemptId);
        if (testingVisualModel(root, frameworkRoot, ctx.goalAttemptId)) checkedStatus = testingSelfCheck(root, frameworkRoot, ctx.goalAttemptId);
        const current = json(path.join(reports('testing'), 'summary.json'));
        if (checkedStatus === 0 && current.verdict === 'PASS' && typeof current.verifier_request === 'string') {
          const request = parseVerifierRequest(fs.readFileSync(path.resolve(root, current.verifier_request), 'utf8'));
          assert(request && request.phase === 'testing' && request.subject_id === current.verifier_subject_id, 'Testing model must use its actual current independent request');
          verifier('testing', request);
        }
      },
      onOutOfChain: ctx => {
        if (ctx.phase.endsWith('-verifier-format-repair')) {
          const request = parseVerifierRequest(ctx.prompt.slice(ctx.prompt.lastIndexOf('\n{') + 1));
          assert(request, '原验证方必须收到实际当前 request，模型不创建或猜请求');
          verifier(ctx.phase.replace(/-verifier-format-repair$/, ''), request);
          return;
        }
        const file = /草稿文件[^：\n]*：(.+)$/m.exec(ctx.prompt)?.[1]?.trim();
        assert(file, ctx.prompt);
        const draft = YAML.parse(fs.readFileSync(file, 'utf8'));
        if (ctx.phase === 'design-repair-author') {
          assert(ctx.prompt.includes('reference_crosscheck'), 'The actual historical finding must reach its design owner');
          const walk = (value: any): void => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value.interfaces) && value.interfaces.some((entry: any) => entry.class === 'OtpService')
              && !value.interfaces.some((entry: any) => entry.class === 'OtpVerificationState')) value.interfaces.push({
              layer: 'domain', class: 'OtpVerificationState', file: serviceDir + '/OtpService.ets', methods: [
                { name: 'start', params: [{ name: 'mobile', type: 'string' }], return: 'Promise<boolean>', async: true },
                { name: 'resend', params: [], return: 'Promise<boolean>', async: true }, { name: 'tick', params: [], return: 'number' },
                { name: 'cancel', params: [], return: 'void' }, { name: 'reset', params: [], return: 'void' },
                { name: 'updateOtp', params: [{ name: 'value', type: 'string' }, { name: 'maxLength', type: 'number' }], return: 'string' },
                { name: 'canSubmit', params: [{ name: 'expectedLength', type: 'number' }], return: 'boolean' },
              ],
            });
            if (Array.isArray(value.files) && value.files.includes('01-Product/Phone/src/main/ets/pages/index.ets') && !value.files.includes(navigationRegistry)) value.files.push(navigationRegistry);
            if (Array.isArray(value.ordered_steps)) value.ordered_steps = value.ordered_steps.map((text: string) => text.replace('并启动 60 秒倒计时', '并由 OtpVerificationState.start/resend/tick/cancel 持有和驱动 60 秒倒计时与重发状态，UI 经 BankCardOpeningService 共用此对象').replace('OpeningNavigationService.finish(stack, result)', 'OpeningNavigationService.finish(stack, result)（真实 NavPathStack 与手势依 AC-5 仅由 device 验证）'));
            for (const child of Object.values(value)) walk(child);
          };
          walk(draft);
        } else {
          draft.review_summary.questioning = { ...structuredClone(YAML.parse(fs.readFileSync(path.join(root, blueprint), 'utf8')).review_summary.questioning), provider_id: 'design-repair-questioning' };
        }
        fs.writeFileSync(file, YAML.stringify(draft));
      },
    });
    const terminal = [...probe.events].reverse().find(event => event.type === 'run_end');
    const failures = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'].flatMap(phase => {
      const file = path.join(reports(phase), 'script-report.json');
      return fs.existsSync(file) ? json(file).checks.filter((check: any) => check.status === 'FAIL' && check.severity === 'BLOCKER').map((check: any) => ({ phase, id: check.id, details: check.details?.slice(0, 1400) })) : [];
    });
    assert(['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(terminal?.status)), JSON.stringify({ terminal,
      events: probe.events.slice(originalEvents.toString('utf8').split('\n').filter(Boolean).length).slice(-10), failures }));
    assert(fs.existsSync(path.join(root, featureDir, 'goal-runs', runId, 'feature-completion.json')), 'Real finalizer must produce the completion original');
    assert(published(), 'Real design publication must occur');
    const verified = assertOwnerCompletion(root, frameworkRoot);
    fs.writeFileSync(path.resolve(__dirname, '../../reports/6fd6c8c1/s0-owner-runtime-completion.json'), JSON.stringify(verified, null, 2));
    assert(fs.readFileSync(path.join(source, featureDir, 'goal-runs', runId, 'events.jsonl')).equals(originalEvents), 'Historical S0 evidence must remain unchanged');
  } finally {
    const reportDir = path.resolve(__dirname, '../../reports/6fd6c8c1/s0-owner-runtime');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'model-outputs.json'), JSON.stringify({ initial_input: source, historical_author_outputs: modelOutputs,
      copied_machine_verdicts: false, model_boundary: 'Deterministic historical author/verifier responses; no real model generation (adapter version probes may run)',
      source_adaptation: ['S0 excludes build-system/personal setup; an isolated credential-free external tool setup is provided',
        'Missing public context is read from original Git baseline 28394b60 with per-file source hashes; CRLF-only normalization is recorded in its sources.json',
        'The original baseRef maps to a local pre-author snapshot, never a commit of repaired implementation; no historical binding is rewritten',
        'S0 business files and historical outcomes remain original until their legal current author phase'],
      external_tools: 'Production device readiness gate over bounded observations; bounded SDK/device execution providers; actual current UT code runs in Node VM and production Hypium parser' }, null, 2));
    const run = path.join(root, featureDir, 'goal-runs', runId);
    for (const name of ['events.jsonl', 'goal-report.json', 'feature-completion.json']) if (fs.existsSync(path.join(run, name))) fs.copyFileSync(path.join(run, name), path.join(reportDir, name));
    for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) for (const name of ['summary.json', 'script-report.json']) {
      const file = path.join(root, featureDir, phase, 'reports', name);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(reportDir, `${phase}.${name}`));
    }
    const planReports = path.join(root, featureDir, 'plan/reports');
    if (fs.existsSync(planReports)) for (const name of fs.readdirSync(planReports).filter(name => /^verifier\.(report|material)\./.test(name))) fs.copyFileSync(path.join(planReports, name), path.join(reportDir, name));
    if (savedHdc === undefined) delete process.env.HARNESS_HDC_EXE; else process.env.HARNESS_HDC_EXE = savedHdc;
    clearFrameworkConfigCache();
    if (process.env.FE4512_OWNER_KEEP_ROOT === '1') console.log('[S0 owner runtime retained]', root);
    else fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  const cases = [{ name: '6fd S0 historical owner finding repairs design and reaches production Feature and CU completion', run: ownerRepairRuntime }];
  for (const entry of cases.filter(entry => matchesUnitCase(entry.name, selector))) {
    const finish = startCaseTiming([entry.name], timings);
    try { await entry.run(); results.push({ name: entry.name, ok: true }); }
    catch (error) { results.push({ name: entry.name, ok: false, error: (error as Error).stack }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export const runAll = async () => (await runSelectedCases()).results;
export const resumeOwnerRepairRuntime = (root: string) => ownerRepairRuntime(root);
