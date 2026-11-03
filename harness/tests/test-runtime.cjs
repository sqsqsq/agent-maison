const path = require('path');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const started = performance.now();
process.env.MAISON_TEST_RUN_STARTED_NS = process.hrtime.bigint().toString();
process.env.MAISON_TEST_POLL_MS ??= '10';
const harness = path.resolve(__dirname, '..');
const built = spawnSync(process.execPath, [path.join(__dirname, 'build-test-runtime.cjs')], { cwd: harness, stdio: 'inherit', shell: false });
if (built.error || built.status !== 0) { process.exitCode = built.status || 1; }
else {
  process.env.MAISON_TEST_BUILD_MS = String(performance.now() - started);
  const [entry, ...args] = process.argv.slice(2);
  if (!entry) throw new Error('test runtime needs an entry');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'compiled-entry.cjs'), path.resolve(harness, entry), ...args], { cwd: harness, stdio: 'inherit', shell: false });
  process.exitCode = result.status ?? 1;
  console.log(`[TEST-RUNTIME] total wall including build/load/execution/collection/cleanup=${((performance.now() - started) / 1000).toFixed(3)}s`);
}
