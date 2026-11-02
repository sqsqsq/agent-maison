import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { DEFAULT_STATE_MACHINE, loadStateMachineConfig } from '../../config';
import { resolveCurrentDisposition, type CurrentDispositionInput } from '../../scripts/utils/check-disposition';
import type { UnitCaseResult } from '../run-unit';

const REPO = path.resolve(__dirname, '../../..');
const HOOK = path.join(REPO, 'agents/claude/templates/hooks/check-phase-completion.mjs');
const HARNESS = path.join(REPO, 'harness');
const dynamicImport = new Function('file', 'return import(file)') as (file: string) => Promise<any>;

function current(action?: 'repair' | 'verify' | 'wait') {
  return resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [], additionalProblems: action ? [{
    phase: 'testing', id: 'required_check_conclusion', action, affects: 'completion', severity: 'BLOCKER',
    detail: action === 'wait' ? '实际设备仍不可用，保留未完成。' : '原作者交回后仍须真实工具和独立核验。',
  }] : [] } as CurrentDispositionInput);
}

function fixture(view?: unknown, realReader = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-hook-current-'));
  const framework = path.join(root, 'framework'), harness = path.join(framework, 'harness');
  fs.mkdirSync(framework, { recursive: true });
  if (realReader) {
    fs.symlinkSync(HARNESS, harness, process.platform === 'win32' ? 'junction' : 'dir');
    for (const directory of ['workflows', 'profiles', 'skills', 'specs', 'agents', 'docs'])
      fs.symlinkSync(path.join(REPO, directory), path.join(framework, directory), process.platform === 'win32' ? 'junction' : 'dir');
    fs.copyFileSync(path.join(REPO, 'package.json'), path.join(framework, 'package.json'));
  } else {
    fs.mkdirSync(path.join(harness, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(harness, 'package.json'), '{}');
    fs.copyFileSync(path.join(HARNESS, 'tsconfig.json'), path.join(harness, 'tsconfig.json'));
    fs.symlinkSync(path.join(HARNESS, 'node_modules'), path.join(harness, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(path.join(harness, 'scripts/assess.ts'), 'console.log(' + JSON.stringify(JSON.stringify(view)) + ');');
  }
  // Real state is outside the source-runtime junction: the hook must obey its configured path.
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'HookCurrent',
    project_profile: { name: 'generic' }, active_workflow: 'obligation-driven', paths: { state_file: '.maison-current.json', features_dir: 'doc/features' },
    state_machine: { grace_period_minutes: 5, ttl_hours: 12, max_consecutive_blocks: 1 } }));
  const state = { feature: 'demo', phase: 'coding', session_id: 'same', updated_at: new Date().toISOString(), run_id: 'original', adapter: 'claude',
    status: 'harness_finished', verdict: 'PASS', closure_status: 'closed', consecutive_block_count: 999, block_signature: 'old-history' };
  fs.writeFileSync(path.join(root, '.maison-current.json'), JSON.stringify(state));
  return { root, state, stateFile: path.join(root, '.maison-current.json') };
}
function invoke(root: string, payload: Record<string, unknown> = {}, extraEnv: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [HOOK], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 40_000,
    env: { ...process.env, NODE_OPTIONS: '', MAISON_GOAL_HEADLESS: '', CLAUDE_PROJECT_DIR: root, ...extraEnv },
    input: JSON.stringify({ session_id: 'same', cwd: root, ...payload }) });
  assert(!result.error, result.error?.message);
  return result;
}
async function withFixture(view: unknown, run: (f: ReturnType<typeof fixture>) => void, realReader = false) {
  const f = fixture(view, realReader);
  try { run(f); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
}
const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  { name: 'D8 hook uses shared real completion rather than historical PASS or closed state', run: () => withFixture({ feature_assessment: { complete: true, current_disposition: current() } }, f => {
    const before = fs.readFileSync(f.stateFile); assert.equal(invoke(f.root).status, 0); assert.deepEqual(fs.readFileSync(f.stateFile), before);
  }) },
  { name: 'D8 pending tools and independent verification remain blocked after repeated stops and stop_hook_active', run: () => withFixture({ feature_assessment: { complete: false, current_disposition: current('verify') } }, f => {
    const before = fs.readFileSync(f.stateFile);
    for (let repeat = 0; repeat < 4; repeat++) {
      const result = invoke(f.root, { stop_hook_active: repeat > 0 }); assert.equal(result.status, 2);
      const response = JSON.parse(result.stdout); assert.equal(response.decision, 'block');
      assert(response.reason.includes('goal-mode-entry.ts') && response.reason.includes('--next'));
      assert(!response.reason.includes('--clear-state')); assert.deepEqual(fs.readFileSync(f.stateFile), before);
    }
  }) },
  { name: 'D8 shared repair facts continue through the original coordinator', run: () => withFixture({ current_disposition: current('repair'), complete: false }, f => {
    const result = invoke(f.root); assert.equal(result.status, 2); assert(result.stderr.includes('原作者交回'));
  }) },
  { name: 'D8 real condition wait ends the author turn truthfully without claiming delivery completion', run: () => withFixture({ current_disposition: current('wait'), complete: false }, f => {
    const result = invoke(f.root); assert.equal(result.status, 0); assert(result.stderr.includes('仍未完成'));
  }) },
  { name: 'D8 eligible check facts without the actual original completion remain unfinished', run: () => withFixture({ current_disposition: current(), complete: false }, f => {
    assert.equal(invoke(f.root).status, 2);
  }) },
  { name: 'D8 unreadable public completion facts never become completed', run: () => withFixture({ error: 'actual original unavailable' }, f => {
    const result = invoke(f.root); assert.equal(result.status, 2); assert(result.stderr.includes('actual original unavailable'));
  }) },
  { name: 'D8 historical cross-session state stays byte-identical without invoking a new workflow', run: () => withFixture({ error: 'not consumed' }, f => {
    const before = fs.readFileSync(f.stateFile); const result = invoke(f.root, { session_id: 'unrelated' }); assert.equal(result.status, 0);
    assert(result.stderr.includes('历史会话记录只读')); assert.deepEqual(fs.readFileSync(f.stateFile), before);
  }) },
  { name: 'D8 dedicated native Stop returns to its original outer coordinator without another phase judgment', run: () => withFixture({ error: 'not consumed' }, f => {
    const result = invoke(f.root, {}, { MAISON_GOAL_HEADLESS: '1' }); assert.equal(result.status, 0); assert.equal(result.stdout, '');
  }) },
  { name: 'D8 actual public assess consumer keeps missing business evidence unfinished despite old state PASS', run: () => withFixture(null, f => {
    const before = fs.readFileSync(f.stateFile); const result = invoke(f.root); assert.equal(result.status, 2, result.stdout + result.stderr);
    assert(result.stderr.includes('未完成')); assert.deepEqual(fs.readFileSync(f.stateFile), before);
    assert(!fs.existsSync(path.join(f.root, 'doc/features/demo/next.json')), 'read-only assess cannot write a competing next projection');
  }, true) },
  { name: 'D8 actual public reader rejects an invalid CU identity without creating an encoded shadow directory', run: () => withFixture(null, f => {
    fs.writeFileSync(f.stateFile, JSON.stringify({ ...f.state, feature: 'cu-invalid' }));
    const result = invoke(f.root); assert.equal(result.status, 2); assert(result.stderr.includes('cu-'));
    assert(!fs.existsSync(path.join(f.root, 'doc/features/cu-invalid')));
  }, true) },
  { name: 'D8 session routing still uses existing grace and TTL while retired counter defaults disappear', async run() {
    const hook = await dynamicImport(pathToFileURL(HOOK).href);
    assert.equal(hook.HOOK_DEFAULT_GRACE_MS, DEFAULT_STATE_MACHINE.grace_period_minutes * 60_000);
    assert.equal(hook.HOOK_DEFAULT_TTL_MS, DEFAULT_STATE_MACHINE.ttl_hours * 3_600_000);
    const now = Date.now(), state = { session_id: 'same', updated_at: new Date(now - 60_000).toISOString() };
    assert.equal(hook.evaluateSessionStaleness(state, 'same', 300_000, 43_200_000, now).isStale, false);
    assert.equal(hook.evaluateSessionStaleness(state, 'other', 300_000, 43_200_000, now).isStale, true);
    assert.equal(hook.evaluateSessionStaleness({ updated_at: new Date(now - 600_000).toISOString() }, 'same', 300_000, 43_200_000, now).isStale, true);
    assert.equal(hook.evaluateSessionStaleness(state, null, 300_000, 30_000, now).isStale, true);
    const f = fixture(null);
    try { assert(!('max_consecutive_blocks' in loadStateMachineConfig(f.root))); }
    finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  } },
];
export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
  }
  return results;
}
