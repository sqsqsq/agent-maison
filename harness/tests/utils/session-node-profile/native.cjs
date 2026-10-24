// Development CLI fixture: real TypeScript compilation and Node assertions, no verdict stubs.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const harness = path.resolve(__dirname, '../../../harness');
const tsc = path.join(harness, 'node_modules/typescript/bin/tsc');
const walk = dir => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const check = (id, ok, details) => ({ id, category: 'structure', severity: 'BLOCKER', status: ok ? 'PASS' : 'FAIL', description: id, details });
const outputDir = ctx => path.join(ctx.projectRoot, 'doc/features', ctx.feature, 'ut/reports/node-build');
function compile(ctx, files, emit = false) {
  const args = [tsc, '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', '--esModuleInterop', '--strict', '--skipLibCheck', '--typeRoots', path.join(harness, 'node_modules/@types')];
  args.push(...(emit ? ['--outDir', outputDir(ctx), '--rootDir', ctx.projectRoot] : ['--noEmit']), ...files);
  const r = cp.spawnSync(process.execPath, args, { cwd: ctx.projectRoot, encoding: 'utf8', timeout: 60000 });
  return { ok: r.status === 0 && !r.error, details: `exit=${r.status}\n${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
}
function run(ctx, files) {
  const selected = files.map(f => path.join(outputDir(ctx), f.path.replace(/\.ts$/, '.js')));
  if (!selected.length) return { ok: false, details: 'No selected test files; no execution.' };
  const r = cp.spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...selected], { cwd: ctx.projectRoot, encoding: 'utf8', timeout: 60000 });
  const log = `${r.stdout || ''}${r.stderr || ''}${r.error || ''}`;
  const executed = Number(log.match(/^# tests (\d+)$/m)?.[1] || 0);
  const failed = Number(log.match(/^# fail (\d+)$/m)?.[1] || 0);
  const skipped = Number(log.match(/^# skipped (\d+)$/m)?.[1] || 0);
  const expected = files.reduce((n, f) => n + (f.content.match(/\bit\s*\(/g) || []).length, 0);
  const logPath = path.join(ctx.projectRoot, 'doc/features', ctx.feature, 'ut/reports/node-tests.tap');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, log);
  return { ok: r.status === 0 && !r.error && executed > 0 && executed === expected && failed === 0 && skipped === 0,
    details: `node --test exit=${r.status}; selected=${expected}; executed=${executed}; failed=${failed}; skipped=${skipped}; log=${logPath}\n${log}` };
}
module.exports = { walk, check, compile, run };
