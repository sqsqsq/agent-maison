/** Read the signed request issued by the copied CLI through a real project-root junction. */
import { testCliArgs } from './test-cli-args';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { withRuntimeTest } from './runtime-test-control';
import { prepareSessionCliProject } from './session-cli-project';
import { readSessionExecution, sessionEvents } from '../../scripts/utils/session-execution-handoff';

function args(root: string): string[] {
  const harness = path.join(root, 'framework/harness');
  return [...testCliArgs(path.join(harness, 'scripts/goal-mode-entry.ts'), [path.join(harness, 'node_modules/ts-node/dist/bin.js'), '--project', path.join(harness, 'tsconfig.json')]), '--project-root', root, '--framework-root', path.join(root, 'framework'),
    '--feature', 'clamp', '--run-id', 'session-cli', '--adapter', 'claude', '--run-mode', 'attended'];
}
function environment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(root, '.trust') };
  for (const key of Object.keys(env)) if (/^MAISON_GOAL_(?!CHECKPOINT_DIR)/i.test(key)) delete env[key];
  return env;
}
function next(root: string): { status: number | null; value: any; output: string } {
  const result = withRuntimeTest({ root }, () => spawnSync(process.execPath, [...args(root), '--next'],
    { cwd: path.join(root, 'framework/harness'), env: environment(root), encoding: 'utf8', timeout: 60_000, windowsHide: true }));
  if (result.error) throw result.error;
  const line = result.stdout.trim().split(/\r?\n/).reverse().find(value => value.startsWith('{'));
  return { status: result.status, value: line ? JSON.parse(line) : null, output: result.stderr + result.stdout };
}

export async function junctionSessionCli(): Promise<void> {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-junction-cli-'));
  const root = path.join(container, 'actual project'), alias = path.join(container, 'alias project');
  const previousTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  try {
    prepareSessionCliProject(root, 'claude', false, 'coding', { linkDependencies: true });
    fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const runRelative = 'doc/features/clamp/goal-runs/session-cli';
    const runDir = path.join(root, runRelative), aliasRun = path.join(alias, runRelative);
    assert.notEqual(alias, root); assert.equal(fs.realpathSync(alias), fs.realpathSync(root));
    const first = next(alias);
    assert.equal(first.status, 0, first.output);
    assert.equal(first.value?.type, 'phase_execute_request', first.output);

    const ledger = path.join(runDir, 'events.jsonl');
    const signedBytes = fs.readFileSync(ledger);
    const canonical = readSessionExecution(runDir, first.value.request.path);
    assert(canonical);
    const canonicalPath = path.resolve(runDir, canonical.reference.path);
    const aliasPath = path.resolve(aliasRun, canonical.reference.path);
    const aliased = readSessionExecution(aliasRun, aliasPath);
    assert(aliased);
    assert.equal(canonical.reference.sha256, first.value.request.sha256);
    assert.deepEqual(aliased.reference, canonical.reference);
    assert.equal(fs.realpathSync(first.value.request.path), fs.realpathSync(canonicalPath));
    assert(fs.readFileSync(aliasPath).equals(fs.readFileSync(canonicalPath)));
    assert.equal(fs.realpathSync(canonical.request.context.projectRoot), fs.realpathSync(root));
    assert(fs.readFileSync(ledger).equals(signedBytes), 'reading either path must not write the event ledger');
    const events = sessionEvents(runDir);
    assert.equal(events.filter(event => event.type === 'agent_invoke_start').length, 1);
    assert.equal(events.filter(event => event.type === 'phase_start' && event.handoff_request).length, 1);
    assert(!events.some(event => event.type === 'agent_invoke_end' || event.type === 'harness_start'));
  } finally {
    if (fs.existsSync(alias)) fs.unlinkSync(alias);
    const dependencies = path.join(root, 'framework/harness/node_modules');
    if (fs.existsSync(dependencies) && fs.lstatSync(dependencies).isSymbolicLink()) fs.unlinkSync(dependencies);
    if (previousTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = previousTrust;
    fs.rmSync(container, { recursive: true, force: true });
  }
}
