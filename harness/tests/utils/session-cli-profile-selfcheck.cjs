// Run after provisioning: node tests/utils/session-cli-profile-selfcheck.cjs <consumer-root>.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const consumer = path.resolve(process.argv[2]);
const harness = path.join(consumer, 'framework/harness');
require(path.join(harness, 'node_modules/ts-node')).register({ project: path.join(harness, 'tsconfig.json'), transpileOnly: true });
const YAML = require(path.join(harness, 'node_modules/yaml'));
const inventoryReader = require(path.join(harness, 'scripts/utils/closure-attestation.ts'));
const contracts = YAML.parse(fs.readFileSync(path.join(consumer, 'doc/features/clamp/contracts.yaml'), 'utf8'));
const inventory = inventoryReader.buildSourceInventory(consumer, { expectProductSources: true });
for (const file of contracts.files) assert(inventory.files.some(entry => entry.path === file), `Product missing from real closure inventory: ${file}`);
assert(inventory.files.length > 0);
assert(!inventory.files.some(entry => /\/src\/test\//.test(entry.path)), 'Test sources must stay outside product inventory');
const coding = require(path.join(consumer, 'framework/profiles/generic/harness/coding-host-rules.js')).profileCodingHost;
const ut = require(path.join(consumer, 'framework/profiles/generic/harness/ut-host-impl.js')).utHostImpl;
const native = require(path.join(consumer, 'framework/profiles/generic/harness/native.cjs'));
assert(coding.checkCodingCompile({ projectRoot: consumer, feature: 'clamp', featureSpec: { contracts } }).every(check => check.status === 'PASS'), 'Fixture product must really compile through its profile host');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-node-profile-selfcheck-'));
const source = 'src/math/src/main/value.ts';
const test = 'src/math/src/test/value.test.ts';
const ctx = { projectRoot: root, feature: 'smoke', featureSpec: { contracts: { modules: [{ name: 'math', package_path: 'src/math' }] } } };
const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); };
try {
  write(source, 'export const value: number = "wrong";\n');
  assert.equal(native.compile(ctx, [source]).ok, false, 'Type errors must fail');
  write(source, 'export const value: number = 42;\n');
  write(test, "import {it} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../main/value';\nit('[AC-1] value',()=>{assert.equal(value,42);});\n");
  const files = ut.loadUtFiles(ctx);
  assert.equal(files.length, 1, 'Profile must discover the actual src/test carrier');
  assert(ut.checkUtTscCompiles(ctx, files).every(check => check.status === 'PASS'));
  assert(ut.checkUtHvigorBuild(ctx, files).every(check => check.status === 'PASS'));
  assert(ut.checkUtHvigorTest(ctx, files).every(check => check.status === 'PASS'), 'Real Node assertion must pass');
  write(source, 'export const value: number = 7;\n');
  assert(ut.checkUtHvigorBuild(ctx, files).every(check => check.status === 'PASS'));
  assert(ut.checkUtHvigorTest(ctx, files).every(check => check.status === 'FAIL'), 'Real assertion failure must fail');
  assert.equal(native.run(ctx, []).ok, false, 'Zero tests must not pass');
  process.stdout.write(`native profile self-check: real inventory=${inventory.file_count}, fixture compilation, type error, test discovery, Node success/failure and zero tests verified; no phase verdict written\n`);
} finally {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('maison-node-profile-selfcheck-')) throw new Error('Unsafe self-check cleanup target');
  fs.rmSync(root, { recursive: true, force: true });
}
