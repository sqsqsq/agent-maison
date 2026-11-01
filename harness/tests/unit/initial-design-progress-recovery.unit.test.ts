import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { spawnSync } from 'child_process';
import * as YAML from 'yaml';
import { provisionFrameworkUnder, git, SOURCE_REPO_ROOT } from '../utils/real-chain-host';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { withRuntimeTest } from '../utils/runtime-test-control';

const FIXTURE = path.resolve(__dirname, '../fixtures/host-recovery-history/20261029-a21473');
const REPORT = path.join(SOURCE_REPO_ROOT, 'harness/reports/initial-design-progress-20261029');
const RUN = 'doc/features/bc-openCard-2/goal-runs/20261029T005400Z-a21473';
const BLUEPRINT = 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml';
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const json = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));
const events = (file: string): any[] => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const write = (root: string, file: string, content: Buffer | string): void => {
  const absolute = path.join(root, file); fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, content);
};

async function recoverActualA21473(): Promise<void> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maison-a21473-public-next-')));
  const provenance = json(path.join(FIXTURE, 'provenance.json'));
  const sourceHashes: Record<string, string> = {};
  try {
    for (const record of provenance.files) {
      const stored = fs.readFileSync(path.join(FIXTURE, record.copy));
      assert.equal(sha(stored), record.stored_sha256, record.copy);
      const content = record.encoding === 'gzip' ? gunzipSync(stored) : stored;
      assert.equal(sha(content), record.content_sha256, record.path);
      if (!record.redacted) assert.equal(sha(content), record.sha256, record.path);
      write(root, record.path, content);
    }
    const beforeBlueprint = YAML.parse(fs.readFileSync(path.join(root, BLUEPRINT), 'utf8'));
    assert.equal(sha(fs.readFileSync(path.join(root, BLUEPRINT))), '8e063812cfc8fdd45e8a207d02b01f8c75a0082dc57f89cf486801ae866a454e');
    assert.equal(beforeBlueprint.review_summary.admission.current_slice, undefined);
    assert.deepEqual(beforeBlueprint.decisions_and_gaps.gaps, []);
    assert.equal(beforeBlueprint.review_summary.questioning.items.length, 19);
    assert(beforeBlueprint.review_summary.questioning.items.every((item: any) => item.disposition === 'answered_with_evidence'));
    const manifestBefore = fs.readFileSync(path.join(root, RUN, 'manifest.json'));
    const historicalEvents = fs.readFileSync(path.join(root, RUN, 'events.jsonl'));
    const oldRows = events(path.join(root, RUN, 'events.jsonl'));
    assert.equal(oldRows.filter(row => row.type === 'agent_invoke_start').length, 6);
    assert.equal(oldRows.at(-1).halt_reason, 'content_retry_exhausted');
    assert.equal(oldRows.at(-1).run_disposition, 'TERMINAL');
    assert.equal(JSON.parse(manifestBefore.toString()).budget.max_total_turns, 30);
    const oldQuestioning = json(path.join(root, RUN, 'phases/initial-design-questioning/initial-design-questioning-i6/request-e1.json'));
    const oldSourceHashes = new Map(oldQuestioning.pre_snapshot.entries.map((entry: any) => [entry.path, entry.sha256]));
    for (const record of provenance.files.filter((record: any) => /^(01|02|03|04|05)-/.test(record.path))) {
      assert.equal(oldSourceHashes.get(record.path), record.sha256, 'Captured source must match the actual Q6 request snapshot: ' + record.path);
    }
    // Only the execution environment is projected; original local/signing configuration is never loaded.
    write(root, 'framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: 'codex' }) + '\n');
    write(root, '.gitignore', 'framework/\nframework.local.json\n.trust/\nobservations/\n');
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', '--local', 'core.autocrlf', 'false']);
    git(root, ['config', '--local', 'core.eol', 'lf']);
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=Isolated acceptance', '-c', 'user.email=acceptance@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Preserved a21473 inputs']);
    for (const file of ['harness/scripts/goal-mode-entry.ts', 'harness/scripts/goal-phase-runtime.ts', 'harness/scripts/utils/initial-design-delivery.ts',
      'harness/scripts/utils/blueprint-admission.ts', 'harness/scripts/utils/design-repair-unattended.ts']) {
      sourceHashes[file] = sha(fs.readFileSync(path.join(SOURCE_REPO_ROOT, file)));
    }
    const { frameworkRoot, harnessDir } = provisionFrameworkUnder(root);
    for (const [file, hash] of Object.entries(sourceHashes)) {
      assert.equal(sha(fs.readFileSync(path.join(frameworkRoot, file))), hash, 'Source copy drifted; do not start the runtime');
      assert.equal(sha(fs.readFileSync(path.join(SOURCE_REPO_ROOT, file))), hash, 'Source changed during copying; do not start the runtime');
    }
    const guard = path.join(root, 'observations/forbid-actors.cjs');
    write(root, 'observations/forbid-actors.cjs', `const fs=require('fs'),cp=require('child_process');
const blocked=()=>{fs.appendFileSync(${JSON.stringify(path.join(root, 'observations/forbidden-actor.log'))},'forbidden actor or device invocation\\n');throw Error('Unexpected model/device invocation in session-only acceptance');};
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync']){const original=cp[key];cp[key]=function(file,...args){const command=[String(file),...args.flat(Infinity).filter(value=>typeof value==='string')].join(' ');if(/(?:codex|claude|opencode|hdc|adb|hvigor|hypium|hylyre)(?:\\.exe|\\.cmd|\\.ps1)?(?:$|[\\s"'])/i.test(command))return blocked();return original.call(this,file,...args);};}
const runtime=require(${JSON.stringify(path.join(harnessDir, 'scripts/goal-phase-runtime'))});runtime.__testing_setInvokeAgent(blocked);runtime.__testing_setCanaryProbeInvoke(blocked);
`);
    const environment: NodeJS.ProcessEnv = { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(root, '.trust') };
    for (const key of Object.keys(environment)) if (/^MAISON_GOAL_(?!CHECKPOINT_DIR)/i.test(key)) delete environment[key];
    const execute = (label: string, script: string, args: string[], guarded = false): any => {
      const result = withRuntimeTest({ root: root }, () => spawnSync(process.execPath, [path.join(harnessDir, 'node_modules/ts-node/dist/bin.js'), '--transpile-only',
        ...(guarded ? ['--require', guard] : []), path.join(harnessDir, 'scripts', script + '.ts'), '--project-root', root, ...args],
      { cwd: harnessDir, env: environment, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }));
      write(REPORT, `a21473-${label}.stdout.log`, result.stdout || ''); write(REPORT, `a21473-${label}.stderr.log`, result.stderr || '');
      assert(!result.error, String(result.error));
      return { result, value: JSON.parse(result.stdout.trim()) };
    };
    const priorGate = execute('original-gate', 'check-component-blueprint', ['--blueprint', 'bc-openCard-2', '--json']);
    assert.equal(priorGate.result.status, 1);
    assert.deepEqual(priorGate.value.issues.filter((issue: any) => issue.severity === 'BLOCKER').map((issue: any) => issue.id), ['blueprint_admission_current_slice_not_ready']);
    const next = execute('public-next', 'goal-mode-entry', ['--framework-root', frameworkRoot, '--feature', 'bc-openCard-2',
      '--run-id', '20261029T005400Z-a21473', '--adapter', 'codex', '--run-mode', 'attended', '--authorize-autonomy', '--next'], true);
    assert.equal(next.result.status, 0, next.result.stderr + next.result.stdout);
    assert.equal(next.value.type, 'phase_execute_request', JSON.stringify(next.value));
    assert.equal(next.value.phase, 'initial-design-decomposition', 'Stop immediately on any other requested responsibility');
    assert(!fs.existsSync(path.join(root, 'observations/forbidden-actor.log')), 'No model or device execution is allowed');
    const requestBytes = fs.readFileSync(next.value.request.path), request = JSON.parse(requestBytes.toString());
    assert.equal(sha(requestBytes), next.value.request.sha256);
    assert.equal(request.context.phase, 'initial-design-decomposition');
    assert.equal(request.context.runId, '20261029T005400Z-a21473');
    assert.equal(request.context.feature, 'bc-openCard-2');
    assert.equal(request.context.owner.kind, 'session');
    assert.equal(request.context.projectRoot, root);
    assert.equal(request.context.frameworkRoot, frameworkRoot);
    assert.equal(request.context.runtimeFacts.resume, true);
    const afterGate = execute('normalized-gate', 'check-component-blueprint', ['--blueprint', 'bc-openCard-2', '--json']);
    assert.equal(afterGate.result.status, 0, afterGate.result.stdout + afterGate.result.stderr);
    assert.equal(afterGate.value.status, 'PASS');
    assert(!afterGate.value.issues.some((issue: any) => issue.severity === 'BLOCKER'));
    const normalized = YAML.parse(fs.readFileSync(path.join(root, BLUEPRINT), 'utf8'));
    assert.equal(normalized.review_summary.admission.status, 'pass');
    assert.equal(typeof normalized.review_summary.admission.current_slice.slice_id, 'string');
    assert(normalized.review_summary.admission.current_slice.slice_id.length > 0);
    const businessAfter = structuredClone(normalized), businessBefore = structuredClone(beforeBlueprint);
    delete businessAfter.review_summary.admission; delete businessBefore.review_summary.admission;
    assert.deepEqual(businessAfter, businessBefore, 'Runtime normalization cannot change original business or independent questioning facts');
    assert.deepEqual(fs.readFileSync(path.join(root, RUN, 'manifest.json')), manifestBefore);
    const afterEvents = fs.readFileSync(path.join(root, RUN, 'events.jsonl'));
    assert(afterEvents.subarray(0, historicalEvents.length).equals(historicalEvents), 'All original events must remain byte-identical');
    const added = afterEvents.subarray(historicalEvents.length).toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const newInvocations = added.filter(row => row.type === 'agent_invoke_start');
    assert.equal(newInvocations.length, 1);
    assert.equal(newInvocations[0].phase, 'initial-design-decomposition');
    assert(!added.some(row => row.type === 'agent_invoke_end'), 'The issued decomposition is not executed');
    assert(!added.some(row => row.type === 'agent_process_bound'));
    assert(!added.some(row => row.type === 'run_created' || row.type === 'run_end' && row.status === 'COMPLETED'));
    const inspection = withRuntimeTest({ root: root }, () => spawnSync(process.execPath, ['-r', path.join(harnessDir, 'node_modules/ts-node/register/transpile-only'), '-e',
      `const fs=require('fs');const dir=${JSON.stringify(path.join(root, RUN))};const session=require(${JSON.stringify(path.join(harnessDir, 'scripts/utils/session-execution-handoff'))});const budget=require(${JSON.stringify(path.join(harnessDir, 'scripts/utils/delivery-origin'))}).readOriginalDeliveryBudget(${JSON.stringify(root)},JSON.parse(fs.readFileSync(dir+'/manifest.json','utf8')));const issued=session.readSessionExecution(dir);if(!issued)throw Error('No signed request');console.log(JSON.stringify({signed_request:issued.reference,total_turns:budget.totalTurns,max_total_turns:budget.budget.max_total_turns,active_ms:budget.priorActiveMs}));`],
    { cwd: harnessDir, env: environment, encoding: 'utf8', windowsHide: true, timeout: 30_000 }));
    assert.equal(inspection.status, 0, inspection.stderr + inspection.stdout);
    const actual = JSON.parse(inspection.stdout.trim());
    assert.equal(actual.total_turns, 7); assert.equal(actual.max_total_turns, 30);
    assert.equal(actual.signed_request.sha256, next.value.request.sha256);
    assert(actual.active_ms >= 983058, 'The original approximately 16 minutes must remain charged');
    write(REPORT, 'a21473-issued-request.json.gz', gzipSync(requestBytes));
    write(REPORT, 'a21473-after.events.jsonl', afterEvents);
    write(REPORT, 'a21473-normalized-blueprint.yaml', fs.readFileSync(path.join(root, BLUEPRINT)));
    write(REPORT, 'a21473-replay.json', JSON.stringify({ public_entry: 'goal-mode-entry --next', cli_exit_code: next.result.status,
      requested_phase: next.value.phase, signed_request_sha256: actual.signed_request.sha256, source_hashes: sourceHashes,
      historical_turns: 6, new_author_invocations: 0, new_questioning_invocations: 0, new_decomposition_issued: 1, ...actual,
      complete: false, stopped_before_execution: true, environment_projection: ['temporary host/framework copy of current source', 'minimal codex local adapter', 'isolated trust root', 'temporary Git source baseline'],
      source_freeze_checks: ['before copy', 'copied bytes and source after copy, before runtime', 'source after replay'],
      omitted_inputs: provenance.omitted, redactions: provenance.redactions, unavailable_references: provenance.unavailable_references }, null, 2) + '\n');
  } finally {
    try {
      for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(sha(fs.readFileSync(path.join(SOURCE_REPO_ROOT, file))), hash, 'Production freeze changed during replay: ' + file);
    } finally {
      assert(path.dirname(root) === fs.realpathSync(os.tmpdir()) && path.basename(root).startsWith('maison-a21473-public-next-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

const cases = [{ name: 'a21473 original public next normalizes machine admission and issues decomposition with the old six turns and budget intact', run: recoverActualA21473 }];
export function getCases() { return cases; }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases) {
    if (!matchesUnitCase(test.name, filter)) continue;
    const stop = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { stop(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export const runAll = async () => (await runSelectedCases()).results;
if (require.main === module) void runSelectedCases().then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.results.some(row => !row.ok) ? 1 : 0; });
