import assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import {
  inspectExtensionActivation, parseExtensionActivation, runExtensionActivation, undoExtensionActivation,
  validateExtensionActivationOwnership, type ExtensionActivationContext,
} from '../../scripts/utils/extension-activation';
import { runUnitCases } from '../utils/unit-cases';

const { createFixtures } = require('../fixtures/extension-activation/create-fixtures.cjs') as {
  createFixtures(dest: string, options?: { includeNpm?: boolean }): { knowledge: string; npm: string; kv: string; log: string };
};
const knowledge = 'activation-knowledge';
const npm = 'activation-npm';
const guide = `knowledge/${knowledge}/guide.md`;
const index = `knowledge/${knowledge}/index.json`;

function activateFixture(
  ability: string, test: (context: ExtensionActivationContext, fixture: ReturnType<typeof createFixtures>) => void,
): void {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-activation-unit-'));
  const projectRoot = path.join(folder, 'host');
  const extensionRoot = path.join(projectRoot, 'doc/extensions', ability);
  const previous = { ...process.env };
  try {
    const fixture = createFixtures(path.join(folder, 'fixtures'), { includeNpm: ability === npm });
    const source = ability === npm ? fixture.npm : fixture.knowledge;
    fs.cpSync(source, extensionRoot, { recursive: true });
    process.env.MAISON_TEST_KV_PATH = fixture.kv;
    process.env.MAISON_TEST_LOG_PATH = fixture.log;
    test({ projectRoot, extensionRoot, ability, version: '1', preview: () => {} }, fixture);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

function readSteps(context: ExtensionActivationContext) {
  const manifest = YAML.parse(fs.readFileSync(path.join(context.extensionRoot, 'manifest.yaml'), 'utf8'));
  return parseExtensionActivation(context.ability, manifest.activation);
}

function stepLog(file: string): string[] {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line).step);
}

export function runAll() {
  return runUnitCases([
    { name: 'local output declarations reject overlap, project effects and implicit npm cache', run: () => {
      const step = { id: 'one', cwd: '.', scope: 'local', run: ['node', 'build.cjs'],
        outputs: ['knowledge/demo'], ready: { version_file: 'knowledge/demo/index.json' } };
      assert.throws(() => parseExtensionActivation('demo', { steps: [{ ...step, cwd: '../neighbor' }] }));
      assert.throws(() => parseExtensionActivation('demo', { steps: [{ ...step, project_outputs: ['foo'] }] }));
      assert.throws(() => parseExtensionActivation('demo', { steps: [{ ...step, scope: 'repo' }] }));
      assert.throws(() => parseExtensionActivation('demo', { steps: [step, { ...step, id: 'two', outputs: ['knowledge/demo/a.md'] }] }));
      assert.throws(() => parseExtensionActivation('demo', { steps: [{ ...step, run: ['npm', 'ci'] }] }), /npm/);
      const steps = parseExtensionActivation('demo', { steps: [step] });
      assert.throws(() => validateExtensionActivationOwnership('demo', steps, ['knowledge/demo/other.md']), /重叠/);
    } },
    { name: 'management previews, local preparation observes disk versions and reuses or regenerates the entire step', run: () =>
      activateFixture(knowledge, (context, fixture) => {
        const { extensionRoot } = context;
        const steps = readSteps(context);
        const guidePath = path.join(extensionRoot, guide);
        const indexPath = path.join(extensionRoot, index);
        const previews: string[][] = [];
        context.preview = notice => {
          assert(!fs.existsSync(guidePath));
          previews.push(notice.commands.map(command => command.action));
        };
        assert(inspectExtensionActivation(context, steps).failure);
        const first = runExtensionActivation(context, steps, 'management');
        assert.equal(first.status, 'enabled', first.failure);
        assert.deepEqual(previews, [['run']]);
        assert.match(fs.readFileSync(guidePath, 'utf8'), /Generated host guide v1/);
        assert.equal(runExtensionActivation(context, steps, 'local').steps[0].status, 'ready');
        assert.deepEqual(stepLog(fixture.log), ['build-guide']);
        const custom = [{ ...steps[0], ready: { version_file: index, version_field: 'generatedByVersion' } }];
        fs.writeFileSync(indexPath, '{"generatedByVersion":"1"}');
        assert.equal(runExtensionActivation(context, custom, 'local').steps[0].status, 'ready');
        fs.writeFileSync(guidePath, 'stale manual contents');
        fs.writeFileSync(indexPath, '{"plugin_version":"old"}');
        assert.equal(runExtensionActivation(context, steps, 'local').status, 'enabled');
        assert.match(fs.readFileSync(guidePath, 'utf8'), /Generated host guide v1/);
        fs.unlinkSync(guidePath);
        assert.equal(runExtensionActivation(context, steps, 'local').status, 'enabled');
        assert.deepEqual(stepLog(fixture.log), ['build-guide', 'build-guide', 'build-guide']);
        assert.equal(undoExtensionActivation(context, steps).status, 'disabled');
        assert(!fs.existsSync(guidePath));
        assert(fs.existsSync(path.join(extensionRoot, 'manifest.yaml')));
      }) },
    { name: 'failure cleans the failed local step and reverses previous local writes, preserving unrelated modifications', run: () =>
      activateFixture(knowledge, (context, fixture) => {
        const { extensionRoot, projectRoot } = context;
        const steps = parseExtensionActivation(knowledge, { steps: [{
          id: 'prepare', scope: 'local', cwd: '.', run: ['node', '-e', 'require("fs").writeFileSync("prior.json", JSON.stringify({plugin_version: "1"}))'],
          outputs: ['prior.json'], ready: { version_file: 'prior.json' },
        }, ...readSteps(context)] });
        const neighbor = path.join(projectRoot, 'doc/extensions/neighbor');
        fs.mkdirSync(neighbor, { recursive: true });
        fs.writeFileSync(path.join(neighbor, 'retained.md'), 'older retained');
        fs.writeFileSync(path.join(neighbor, 'removed.md'), 'older removed');
        process.env.MAISON_TEST_NEIGHBOR_DIR = neighbor;
        process.env.MAISON_TEST_FAIL_K = '1';
        const failed = runExtensionActivation(context, steps, 'local');
        assert.match(failed.failure ?? '', /越界写入/);
        assert.deepEqual(failed.residuals?.map(row => [path.posix.basename(row.path), row.how]),
          [['removed.md', 'removed'], ['retained.md', 'modified']]);
        assert(!fs.existsSync(path.join(neighbor, 'added.md')));
        assert.match(fs.readFileSync(path.join(neighbor, 'retained.md'), 'utf8'), /changed outside/);
        assert(!fs.existsSync(path.join(extensionRoot, 'prior.json')));
        assert(!fs.existsSync(path.join(extensionRoot, guide)));
        delete process.env.MAISON_TEST_NEIGHBOR_DIR;
        delete process.env.MAISON_TEST_FAIL_K;
        const retry = runExtensionActivation(context, steps, 'local');
        assert.equal(retry.status, 'enabled', retry.failure);
        assert.deepEqual(stepLog(fixture.log), ['build-guide', 'build-guide']);
      }) },
    { name: 'local readiness refuses cleanup of tracked files and hardlinked generated directories', run: () =>
      activateFixture(knowledge, context => {
        const steps = readSteps(context);
        assert.equal(runExtensionActivation(context, steps, 'local').status, 'enabled');
        const { projectRoot, extensionRoot } = context;
        execFileSync('git', ['init', '-q'], { cwd: projectRoot });
        execFileSync('git', ['add', '--', 'doc/extensions/' + knowledge + '/' + guide], { cwd: projectRoot });
        const generated = path.join(extensionRoot, guide);
        const before = fs.readFileSync(generated);
        assert.match(undoExtensionActivation(context, steps).failure ?? '', /重叠/);
        assert.deepEqual(fs.readFileSync(generated), before);
        execFileSync('git', ['rm', '--cached', '--', 'doc/extensions/' + knowledge + '/' + guide], { cwd: projectRoot });
        const handWritten = path.join(projectRoot, 'hand-written.md');
        fs.linkSync(generated, handWritten);
        assert.match(undoExtensionActivation(context, steps).failure ?? '', /硬链接/);
        assert.deepEqual(fs.readFileSync(handWritten), before);
      }) },
    { name: 'npm uses the locked plugin dependency and automatic readers never run repo effects', run: () =>
      activateFixture(npm, (context, fixture) => {
        const steps = readSteps(context);
        const refused = runExtensionActivation(context, steps, 'local');
        assert.match(refused.failure ?? '', /维护者/);
        assert.deepEqual(JSON.parse(fs.readFileSync(fixture.kv, 'utf8')), { control: 'keep' });
        const started = runExtensionActivation(context, steps, 'management');
        assert.equal(started.status, 'enabled', started.failure);
        assert.deepEqual(stepLog(fixture.log), ['register']);
        assert.equal(runExtensionActivation(context, steps, 'local').status, 'enabled');
        process.env.MAISON_TEST_FAIL_UNDO = '1';
        assert.match(undoExtensionActivation(context, steps).failure ?? '', /退出码 32/);
        delete process.env.MAISON_TEST_FAIL_UNDO;
        assert.equal(undoExtensionActivation(context, steps).status, 'disabled');
        assert.equal(undoExtensionActivation(context, steps).status, 'disabled');
        assert.deepEqual(stepLog(fixture.log), ['register', 'unregister', 'unregister']);
        assert.deepEqual(JSON.parse(fs.readFileSync(fixture.kv, 'utf8')), { control: 'keep' });
        assert(!fs.existsSync(path.join(context.extensionRoot, `skills/${npm}/node_modules`)));
      }) },
  ]);
}
