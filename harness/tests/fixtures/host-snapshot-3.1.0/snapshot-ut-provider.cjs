const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

/** Execute the fixture's small ArkTS business modules and Hypium-style assertions under Node. */
module.exports = async function runSnapshotUt(ctx, files, targetCases) {
  const { projectRoot, frameworkRoot, feature } = ctx;
  const { featurePhaseReportsDir } = require(path.join(frameworkRoot, 'harness/config'));
  const { executedUtChecks } = require(path.join(frameworkRoot, 'harness/scripts/utils/ut-execution-evidence'));
  const declared = [];
  const results = [];
  const modules = new Map();
  const sources = new Map();
  const load = (file, harness) => {
    if (modules.has(file)) return modules.get(file).exports;
    const mod = { exports: {} };
    modules.set(file, mod);
    const bytes = fs.readFileSync(file);
    sources.set(path.relative(projectRoot, file).replace(/\\/g, '/'), createHash('sha256').update(bytes).digest('hex'));
    const { outputText } = ts.transpileModule(bytes.toString('utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    Function('require', 'exports', 'module', outputText)(name => {
      if (name === '@ohos/hypium') return harness;
      assert(name.startsWith('.'), `unexpected snapshot UT module ${name}`);
      const source = path.resolve(path.dirname(file), name + '.ets');
      assert(source.startsWith(projectRoot + path.sep), `UT module outside the isolated fixture ${name}`);
      return load(source, harness);
    }, mod.exports, mod);
    return mod.exports;
  };
  for (const file of files ?? []) {
    const cases = [];
    let suite = '';
    const hypium = {
      describe: (name, body) => { suite = name; body(); },
      it: (test, _timeout, body) => cases.push({ suite, test, body }),
      expect: actual => ({
        assertEqual: expected => assert.deepEqual(actual, expected),
        assertTrue: () => assert.equal(actual, true),
        assertFalse: () => assert.equal(actual, false),
        not: () => ({ assertNull: () => assert.notEqual(actual, null) }),
      }),
    };
    load(path.resolve(projectRoot, file.path), hypium);
    for (const { suite, test, body } of cases) {
      if (targetCases?.length && !targetCases.some(target => target.path === file.path && target.test === test)) continue;
      declared.push({ path: file.path, test });
      try { await body(); results.push({ suite, test, status: 'PASS' }); }
      catch (error) { results.push({ suite, test, status: 'FAIL', message: String(error) }); }
    }
  }
  const original = path.join(featurePhaseReportsDir(projectRoot, feature, 'ut', frameworkRoot), 'snapshot-ut-execution.json');
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.writeFileSync(original, JSON.stringify(results, null, 2) + '\n');
  const input_sha256 = createHash('sha256').update(JSON.stringify({
    sources: [...sources].sort(),
    targets: declared.map(({ path, test }) => [path, test]).sort(),
    acceptance: ctx.featureSpec?.acceptance ?? null,
  })).digest('hex');
  fs.appendFileSync(path.join(path.dirname(original), 'snapshot-ut-invocations.jsonl'),
    JSON.stringify({ run_id: process.env.MAISON_GOAL_RUN_ID ?? null, input_sha256, cases: results }) + '\n');
  const success = results.length > 0 && results.every(row => row.status === 'PASS');
  return [{ id: 'ut_hvigor_test', category: 'structure', severity: 'BLOCKER', status: success ? 'PASS' : 'FAIL',
    description: 'Migration fixture UT execution', details: success ? 'Isolated business cases ran to completion under Node.' : 'See actual fixture execution failures.',
    ...(!success ? { failure_kind: 'code_regression' } : {}) },
  ...executedUtChecks(projectRoot, declared, results.filter(row => row.status === 'PASS'), [original])];
};
