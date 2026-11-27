import assert from 'assert';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import {
  extensionActivationDrift, extensionActivationNeedsCleanup, parseExtensionActivation, parseExtensionActivationResult,
  runExtensionActivation, undoExtensionActivation, validateExtensionActivationOwnership,
  type ExtensionActivationContext, type ExtensionActivationResult, type ExtensionActivationStep,
} from '../../scripts/utils/extension-activation';
import { runUnitCases } from '../utils/unit-cases';

const { createFixtures } = require('../fixtures/extension-activation/create-fixtures.cjs') as {
  createFixtures(dest: string, options?: { includeNpm?: boolean }): { knowledge: string; npm: string; kv: string; log: string };
};
const knowledge = 'activation-knowledge';
const npm = 'activation-npm';
const guide = `knowledge/${knowledge}/guide.md`;
const modules = `skills/${npm}/node_modules`;

function inHost(body: (folder: string, project: string, extensionRoot: string) => void): void {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-activation-unit-'));
  const project = path.join(folder, 'host');
  const extensionRoot = path.join(project, 'doc/extensions');
  fs.mkdirSync(extensionRoot, { recursive: true });
  const previous = { ...process.env };
  try { body(folder, project, extensionRoot); }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

function install(folder: string, extensionRoot: string, ability: string): {
  steps: ExtensionActivationStep[]; kv: string; log: string;
} {
  const fixtures = createFixtures(path.join(folder, 'fixtures'), { includeNpm: ability === npm });
  const source = ability === npm ? fixtures.npm : fixtures.knowledge;
  const skills = path.join(extensionRoot, 'skills', ability);
  fs.cpSync(path.join(source, 'skills', ability), skills, { recursive: true });
  const manifest = YAML.parse(fs.readFileSync(path.join(source, 'manifest.yaml'), 'utf8'));
  process.env.MAISON_TEST_KV_PATH = fixtures.kv;
  process.env.MAISON_TEST_LOG_PATH = fixtures.log;
  return { steps: parseExtensionActivation(ability, manifest.activation[ability]), kv: fixtures.kv, log: fixtures.log };
}

function journal(projectRoot: string, extensionRoot: string, ability: string, steps: ExtensionActivationStep[]) {
  const records: ExtensionActivationResult[] = [];
  const context: ExtensionActivationContext = {
    projectRoot, extensionRoot, ability, version: 'fixture-v1', preview: () => {},
    persist: (result: ExtensionActivationResult) => {
      // Exercise states observable after each durable transition.
      const disk = path.join(extensionRoot, 'manifest.yaml');
      fs.writeFileSync(disk, YAML.stringify(result));
      records.push(parseExtensionActivationResult(ability, YAML.parse(fs.readFileSync(disk, 'utf8')), steps)!);
    },
  };
  return { context, records };
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stepLog(file: string): string[] {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line).step);
}

function hash(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function runAll() {
  return runUnitCases([
  { name: 'declarations reserve non-overlapping private outputs and an explicit npm cache', run: () => {
    const step = { id: 'one', cwd: 'skills/demo', run: ['node', 'step.cjs'], outputs: ['knowledge/demo'] };
    assert.throws(() => parseExtensionActivation('demo', { steps: [{ ...step, cwd: 'skills/neighbor' }] }));
    assert.throws(() => parseExtensionActivation('demo', { steps: [step, { ...step, id: 'two', outputs: ['knowledge/demo/a.md'] }] }));
    assert.throws(() => parseExtensionActivation('demo', { steps: [{ ...step, run: ['npm', 'ci'] }] }), /npm/);
    const steps = parseExtensionActivation('demo', { steps: [step] });
    assert.throws(() => validateExtensionActivationOwnership('demo', steps, ['knowledge/demo/other.md']), /重叠/);
  } },
  { name: 'announces and records an invocation before enabling generated knowledge and reuses its result', run: () =>
    inHost((folder, project, extensionRoot) => {
      const { steps, log } = install(folder, extensionRoot, knowledge);
      const { context, records } = journal(project, extensionRoot, knowledge, steps);
      const guidePath = path.join(extensionRoot, guide);
      context.preview = notice => {
        assert(!fs.existsSync(guidePath));
        assert.deepEqual(notice.commands.map(command => [command.id, command.action, command.argv]),
          [['build-guide', 'run', ['node', 'scripts/build.cjs']]]);
      };
      const active = runExtensionActivation(context, steps);
      assert.equal(active.status, 'enabled', active.failure);
      assert.equal(records[0].steps[0].status, 'running');
      assert.match(fs.readFileSync(guidePath, 'utf8'), /Generated host guide v1/);
      assert.equal(runExtensionActivation(context, steps, active), active);
      assert.deepEqual(stepLog(log), ['build-guide']);
      assert.equal(undoExtensionActivation(context, steps, active).status, 'disabled');
      assert(!fs.existsSync(guidePath));
      assert(fs.existsSync(path.join(extensionRoot, 'skills', knowledge, 'scripts/build.cjs')));
    }) },
  { name: 'rolls back a failed generating step and only deletes an attributable out-of-range addition', run: () =>
    inHost((folder, project, extensionRoot) => {
      const fixture = install(folder, extensionRoot, knowledge);
      const priorOutput = `skills/${knowledge}/prior.txt`;
      const steps = parseExtensionActivation(knowledge, { steps: [{
        id: 'prepare', cwd: `skills/${knowledge}`,
        run: ['node', '-e', "require('fs').writeFileSync('prior.txt','created')"], outputs: [priorOutput],
      }, ...fixture.steps] });
      const { context } = journal(project, extensionRoot, knowledge, steps);
      const neighbor = path.join(extensionRoot, 'skills/neighbor');
      fs.mkdirSync(neighbor, { recursive: true });
      const seed = () => {
        fs.writeFileSync(path.join(neighbor, 'retained.md'), 'older retained');
        fs.writeFileSync(path.join(neighbor, 'removed.md'), 'older removed');
      };
      seed();
      process.env.MAISON_TEST_NEIGHBOR_DIR = neighbor;
      process.env.MAISON_TEST_FAIL_K = '1';
      const failed = runExtensionActivation(context, steps);
      assert.equal(failed.status, 'failed');
      assert.match(failed.failure ?? '', /31.*越界写入/);
      assert(!extensionActivationNeedsCleanup(failed));
      assert(!fs.existsSync(path.join(neighbor, 'added.md')));
      assert(!fs.existsSync(path.join(neighbor, 'removed.md')));
      assert.match(fs.readFileSync(path.join(neighbor, 'retained.md'), 'utf8'), /changed outside/);
      assert(!fs.existsSync(path.join(extensionRoot, guide)));
      assert(!fs.existsSync(path.join(extensionRoot, priorOutput)));
      assert.deepEqual(failed.steps.map(row => row.status), ['undone', 'undone']);
      assert.deepEqual(failed.residuals!.map(row => [path.basename(row.path), row.how, row.preSha256]), [
        ['removed.md', 'removed', hash('older removed')], ['retained.md', 'modified', hash('older retained')],
      ]);
      seed();
      process.env.MAISON_TEST_UNATTESTED = '1';
      const retry = runExtensionActivation(context, steps, failed);
      assert(fs.existsSync(path.join(neighbor, 'added.md')));
      assert(retry.residuals!.some(row => row.path.endsWith('/added.md') && row.how === 'added'));
    }) },
  { name: 'real npm installs from a local tarball and repairs a missing module without treating a rewrite as missing', run: () =>
    inHost((folder, project, extensionRoot) => {
      const { steps, kv, log } = install(folder, extensionRoot, npm);
      const { context } = journal(project, extensionRoot, npm, steps);
      const active = runExtensionActivation(context, steps);
      assert.equal(active.status, 'enabled', active.failure);
      assert.deepEqual(readJson(kv), { control: 'keep', [active.instance_id]: 'test-v1' });
      assert.deepEqual(stepLog(log), ['register', 'verify']);
      assert.equal(runExtensionActivation(context, steps, active), active);
      const dependency = path.join(extensionRoot, modules, 'maison-activation-fixture');
      fs.renameSync(dependency, path.join(folder, 'removed-dependency'));
      assert.deepEqual(extensionActivationDrift(extensionRoot, active), [{ path: modules, kind: 'missing' }]);
      const repaired = runExtensionActivation(context, steps, active);
      assert.equal(repaired.status, 'enabled', repaired.failure);
      assert(fs.existsSync(dependency));
      assert.deepEqual(readJson(kv), { control: 'keep', [repaired.instance_id]: 'test-v1' });
      assert.deepEqual(stepLog(log), ['register', 'verify', 'unregister', 'register', 'verify']);
      const changedFile = path.join(dependency, 'index.cjs');
      fs.appendFileSync(changedFile, '// host edit');
      assert.deepEqual(extensionActivationDrift(extensionRoot, repaired), [{ path: modules, kind: 'changed' }]);
      const disabled = undoExtensionActivation(context, steps, repaired);
      assert.equal(disabled.status, 'disabled', disabled.failure);
      assert.match(fs.readFileSync(changedFile, 'utf8'), /host edit/);
      assert(disabled.residuals!.some(row => row.path.endsWith('/node_modules') && row.how === 'modified'));
      assert.deepEqual(readJson(kv), { control: 'keep' });
    }) },
  { name: 'failed npm verification compensates in reverse and interrupted compensation retries once', run: () =>
    inHost((folder, project, extensionRoot) => {
      const { steps, kv, log } = install(folder, extensionRoot, npm);
      const { context, records } = journal(project, extensionRoot, npm, steps);
      process.env.MAISON_TEST_FAIL_N = '1';
      process.env.MAISON_TEST_FAIL_UNDO = '1';
      const failed = runExtensionActivation(context, steps);
      assert.equal(failed.status, 'failed');
      assert.match(failed.failure ?? '', /33.*32/);
      assert.equal(records.at(-1)!.steps[1].status, 'undoing');
      assert.equal(records.at(-1)!.steps[2].status, 'undone');
      assert.deepEqual(readJson(kv), { control: 'keep', [failed.instance_id]: 'test-v1' });
      assert(fs.existsSync(path.join(extensionRoot, modules)));
      delete process.env.MAISON_TEST_FAIL_UNDO;
      const edited = steps.map(step => step.id === 'register' ? { ...step, undo: ['node', '-e', 'process.exit(47)'] } : step);
      const blocked = undoExtensionActivation(context, edited, records.at(-1)!);
      assert.match(blocked.failure ?? '', /声明已改动/);
      assert.deepEqual(stepLog(log), ['register', 'verify', 'unregister']);
      const disabled = undoExtensionActivation(context, steps, records.at(-1)!);
      assert.equal(disabled.status, 'disabled', disabled.failure);
      assert.deepEqual(stepLog(log), ['register', 'verify', 'unregister', 'unregister']);
      assert.deepEqual(readJson(kv), { control: 'keep' });
      assert(!fs.existsSync(path.join(extensionRoot, modules)));
      assert(!fs.existsSync(path.join(extensionRoot, 'skills', npm, '.npm-cache')));
    }) },
  { name: 'a persisted running step can recover its partial output before retrying', run: () =>
    inHost((folder, project, extensionRoot) => {
      const { steps } = install(folder, extensionRoot, knowledge);
      const { context, records } = journal(project, extensionRoot, knowledge, steps);
      const active = runExtensionActivation(context, steps);
      assert.equal(active.status, 'enabled', active.failure);
      const interrupted = records[0];
      assert.equal(interrupted.steps[0].status, 'running');
      assert(fs.existsSync(path.join(extensionRoot, guide)));
      const recovered = undoExtensionActivation(context, steps, interrupted);
      assert.equal(recovered.status, 'disabled', recovered.failure);
      assert(!fs.existsSync(path.join(extensionRoot, guide)));
    }) },
  { name: 'cleans generated output after detecting a conflicting write to the host journal', run: () =>
    inHost((folder, project, extensionRoot) => {
      const { steps } = install(folder, extensionRoot, knowledge);
      const { context } = journal(project, extensionRoot, knowledge, steps);
      const persist = context.persist;
      const manifest = path.join(extensionRoot, 'manifest.yaml');
      context.persist = result => {
        if (result.steps[0]?.status === 'applied') {
          fs.writeFileSync(manifest, '# preserved editor contents\n');
          throw new Error('manifest conflict');
        }
        persist(result);
      };
      assert.throws(() => runExtensionActivation(context, steps), /manifest conflict.*undone/);
      assert(!fs.existsSync(path.join(extensionRoot, guide)));
      assert.equal(fs.readFileSync(manifest, 'utf8'), '# preserved editor contents\n');
    }) },
  ]);
}
