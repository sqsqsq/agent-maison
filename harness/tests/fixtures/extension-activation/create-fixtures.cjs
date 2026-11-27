const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const spawn = require('cross-spawn');

const k = 'activation-knowledge';
const n = 'activation-npm';
const dependency = 'maison-activation-fixture';
const guide = `knowledge/${k}/guide.md`;
const packageRoot = id => `skills/${id}`;
const at = 'component-design.before_discovery@1';

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
}

const logging = `
const fs = require('node:fs');
const path = require('node:path');
const { MAISON_EXTENSION_INSTANCE_ID: instance, MAISON_TEST_LOG_PATH: log } = process.env;
const record = step => { if (log) fs.appendFileSync(log, JSON.stringify({ step, instance }) + '\\n'); };
`;

function createFixtures(dest, { version = '1', includeNpm = true } = {}) {
  dest = path.resolve(dest);
  const knowledge = path.join(dest, 'knowledge-source');
  const npm = path.join(dest, 'npm-source');
  const kv = path.join(dest, 'kv.json');
  const log = path.join(dest, 'steps.jsonl');
  if (!fs.existsSync(kv)) write(dest, 'kv.json', { control: 'keep' });
  write(knowledge, 'manifest.yaml', {
    schema_version: '2.1', name: k, provides: { skills: [k] },
    bindings: { [k]: { guide: { at: 'feature.before_phase_work@1', phase: 'coding',
      kind: 'knowledge', ref: guide, enabled_by_default: true } } },
    activation: { [k]: { steps: [{ id: 'build-guide', cwd: packageRoot(k),
      run: ['node', 'scripts/build.cjs'], outputs: [guide] }] } },
  });
  write(knowledge, `${packageRoot(k)}/SKILL.md`, `---\nname: ${k}\ndescription: Verify generated host knowledge.\n---\nUse the generated guide.\n`);
  write(knowledge, `${packageRoot(k)}/material.md`, `# Generated host guide v${version}\n\nConfirm wallet history before approving changes.\n`);
  write(knowledge, `${packageRoot(k)}/scripts/build.cjs`, logging + `
const out = path.join(process.env.MAISON_EXTENSION_ROOT, ${JSON.stringify(guide)});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync('material.md', out);
record('build-guide');
const neighbor = process.env.MAISON_TEST_NEIGHBOR_DIR;
if (neighbor) {
  const added = path.join(neighbor, 'added.md');
  const bytes = 'outside addition';
  fs.writeFileSync(added, bytes, { flag: 'wx' });
  if (process.env.MAISON_TEST_UNATTESTED !== '1') {
    const project = process.env.MAISON_EXTENSION_PROJECT_ROOT;
    const postSha256 = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    console.log('extension-created: ' + JSON.stringify({ path: path.relative(project, added).split(path.sep).join('/'),
      postSha256, instance_id: instance }));
  }
  fs.appendFileSync(path.join(neighbor, 'retained.md'), '\\nchanged outside');
  fs.unlinkSync(path.join(neighbor, 'removed.md'));
}
if (process.env.MAISON_TEST_FAIL_K === '1') process.exitCode = 31;
`);
  if (!includeNpm) return { knowledge, npm, kv, log };

  const depSource = path.join(dest, 'dependency-source');
  const depVersion = `${version}.0.0`;
  const tarball = `deps/${dependency}-${depVersion}.tgz`;
  write(depSource, 'package.json', { name: dependency, version: depVersion, main: 'index.cjs' });
  write(depSource, 'index.cjs', `module.exports = value => 'wallet-v${version}:' + value;\n`);
  const pkg = path.join(npm, packageRoot(n));
  fs.mkdirSync(path.join(pkg, 'deps'), { recursive: true });
  const pack = spawn.sync('npm', ['pack', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--cache', path.join(dest, 'pack-cache'),
    '--pack-destination', path.join(pkg, 'deps')], { cwd: depSource, encoding: 'utf8', windowsHide: true });
  assert.equal(pack.status, 0, pack.error?.message ?? pack.stderr);
  const dependencySpecifier = `file:${tarball}`;
  const packageJson = { name: n, version: depVersion, private: true, dependencies: { [dependency]: dependencySpecifier } };
  write(pkg, 'package.json', packageJson);
  const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(path.join(pkg, tarball))).digest('base64');
  write(pkg, 'package-lock.json', {
    name: n, version: depVersion, lockfileVersion: 3, requires: true,
    packages: { '': packageJson, [`node_modules/${dependency}`]: { version: depVersion, resolved: dependencySpecifier, integrity } },
  });
  write(npm, 'manifest.yaml', {
    schema_version: '2.1', name: n, provides: { skills: [n] },
    bindings: { [n]: { action: { at, kind: 'action', ref: n, enabled_by_default: true } } },
    activation: { [n]: { steps: [
      { id: 'install-dependencies', cwd: packageRoot(n), run: ['npm', 'ci', '--cache', './.npm-cache', '--offline', '--no-audit', '--no-fund'],
        outputs: [`${packageRoot(n)}/node_modules`, `${packageRoot(n)}/.npm-cache`] },
      { id: 'register', cwd: packageRoot(n), run: ['node', 'scripts/kv.cjs', 'register'],
        undo: ['node', 'scripts/kv.cjs', 'unregister'], outputs: [] },
      { id: 'verify', cwd: packageRoot(n), run: ['node', 'scripts/use.cjs'], outputs: [] },
    ] } },
  });
  write(pkg, 'SKILL.md', `---\nname: ${n}\ndescription: Run the installed npm test action.\n---\nRun node scripts/use.cjs and report the wallet result.\n`);
  write(pkg, 'scripts/kv.cjs', logging + `
const file = process.env.MAISON_TEST_KV_PATH;
if (!file || !instance) throw new Error('Missing test registration context');
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const mode = process.argv[2];
record(mode);
if (mode === 'register') rows[instance] = 'test-v${version}';
else if (mode === 'unregister') {
  if (process.env.MAISON_TEST_FAIL_UNDO === '1') process.exit(32);
  delete rows[instance];
} else throw new Error('Unrecognized registration action');
fs.writeFileSync(file, JSON.stringify(rows, null, 2) + '\\n');
`);
  write(pkg, 'scripts/use.cjs', logging + `
const assert = require('node:assert/strict');
const moduleId = ${JSON.stringify(dependency)};
const local = path.join(__dirname, '..', 'node_modules', moduleId, 'index.cjs');
assert.equal(require.resolve(moduleId), local);
const answer = require(moduleId)('check');
assert.equal(answer, 'wallet-v${version}:check');
console.log(JSON.stringify({ answer, modulePath: local }));
if (instance) record('verify');
if (process.env.MAISON_TEST_FAIL_N === '1') process.exitCode = 33;
`);
  return { knowledge, npm, kv, log };
}

module.exports = { createFixtures };

if (require.main === module) {
  assert(process.argv[2], 'Usage: node create-fixtures.cjs <directory> [version]');
  process.stdout.write(JSON.stringify(createFixtures(process.argv[2], { version: process.argv[3] })) + '\n');
}
