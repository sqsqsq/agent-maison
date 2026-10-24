const fs = require('fs');
const path = require('path');
const { walk, compile, run, check } = require('./native.cjs');
const checks = (id, ok, detail) => [check(id, ok, detail)];
exports.utHostImpl = {
  loadUtFiles: ctx => ctx.featureSpec.contracts.modules.flatMap(m => walk(path.join(ctx.projectRoot, m.package_path, 'src/test')))
    .filter(f => /\.test\.ts$/.test(f)).map(f => ({ path: path.relative(ctx.projectRoot, f).replace(/\\/g, '/'), content: fs.readFileSync(f, 'utf8') })),
  partitionUtFiles: (_ctx, all) => ({ all, scoped: all, scopeSources: ['fixture-node-test-root'] }),
  checkUtFileNaming: (_ctx, files) => checks('ut_file_naming', files.length > 0 && files.every(f => /\.test\.ts$/.test(f.path)), 'Node tests use *.test.ts'),
  checkUtFrameworkImport: (_ctx, files) => checks('ut_framework_import', files.length > 0 && files.every(f => /from ['"]node:test['"]/.test(f.content)), 'Each selected test imports the real node:test runner'),
  checkUtTscCompiles: (ctx, files) => { const r = compile(ctx, files.map(f => f.path)); return checks('ut_tsc_compiles', r.ok, r.details); },
  checkUtHvigorBuild: (ctx, files) => { const r = compile(ctx, files.map(f => f.path), true); return checks('ut_hvigor_build', r.ok, r.details); },
  checkUtHvigorTest: (ctx, files) => { const r = run(ctx, files); return [check('ut_hvigor_test', r.ok, r.details), check('ut_run', r.ok, r.details)]; },
  checkTestRegistration: (_ctx, files) => checks('test_registration', files.length > 0 && files.every(f => /\bit\s*\(/.test(f.content)), 'Each test file registers at least one real Node it()'),
  isSuiteEntryShim: () => false,
};
