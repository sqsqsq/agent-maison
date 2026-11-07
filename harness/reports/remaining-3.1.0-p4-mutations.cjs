// Development verification only: mutate production modules in memory, run original assertions.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const repo = path.resolve(__dirname, '../..');
const cases = [
  { id: 'cold-phase-author', file: 'harness/scripts/goal-phase-runtime.ts', suite: 'daily-recovery-journey', selector: 'real TypeScript failure reaches its author',
    from: "const invokeWork = async (label: string, text: string, verifierReport?: string, purpose?: string, explicitlyContinued = false, workInput?: WorkUnitInput) => {",
    to: "const invokeWork = async (label: string, text: string, verifierReport?: string, purpose?: string, explicitlyContinued = false, workInput?: WorkUnitInput) => { if (!verifierReport) label = manifest.execution_scope?.phase_chain[0] ?? manifest.phase_chain?.[0] ?? 'coding';" },
  { id: 'tool-success-is-completion', file: 'harness/scripts/utils/check-disposition.ts', suite: 'check-disposition',
    from: 'completionEligible: completionBlocking.length === 0,', to: 'completionEligible: true,' },
  { id: 'feedback-uses-different-facts', file: 'harness/scripts/utils/check-disposition.ts', suite: 'check-disposition',
    from: 'return disposition.problems.map(problem =>', to: "return disposition.problems.filter(problem => problem.action !== 'repair').map(problem =>" },
  { id: 'file-changes-buy-progress', file: 'harness/scripts/utils/goal-failure-classifier.ts', suite: 'goal-headless-guard', selector: 'changed bytes with unchanged verified obligations',
    from: 'const change = compareRelatedInputSnapshots(previous.inputs, current.inputs);',
    to: "const change = compareRelatedInputSnapshots(previous.inputs, current.inputs); if (change === 'changed') return { evaluation: current, reused: false, halt: false };" },
  { id: 'native-default-quota', file: 'harness/scripts/utils/agent-invoke.ts', suite: 'agent-invoke-settle', selector: 'P1 exact native resume keeps current sandbox/model',
    from: "const argv = [binary, '-p', '--dangerously-skip-permissions'];", to: "const argv = [binary, '-p', '--dangerously-skip-permissions', '--max-turns', '1'];" },
  { id: 'framework-bug-halt', file: 'harness/scripts/goal-phase-runtime.ts', suite: 'goal-headless-guard', selector: 'V10 buildPhasePrompt:',
    from: '记录具体框架问题与影响；不改framework，继续所有不依赖它的授权工作，确无安全工作时等待原条件恢复。',
    to: 'Found a framework bug? HALT and report it upstream.' },
  { id: 'root-run-is-a-feature', file: 'harness/config.ts', suite: 'compile-entry', selector: 'P3 project compile enumerates a blueprint workspace',
    from: "const FEATURE_MARKER_DIRS: ReadonlySet<string> = new Set([", to: "const FEATURE_MARKER_DIRS: ReadonlySet<string> = new Set(['goal-runs'," },
];
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
process.env.TS_NODE_PROJECT = path.join(repo, 'harness/tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');
if (process.argv[2] === '--child') {
  const test = cases.find(row => row.id === process.argv[3]); if (!test) throw Error('unknown mutation');
  const ts = require('typescript'), load = require.extensions['.ts']; let hits = 0;
  require.extensions['.ts'] = (module, file) => {
    if (!file.replace(/\\/g, '/').endsWith('/' + test.file)) return load(module, file);
    const source = fs.readFileSync(file, 'utf8');
    if (source.split(test.from).length !== 2) throw Error('mutation anchor must occur exactly once: ' + test.id);
    hits++;
    module._compile(ts.transpileModule(source.replace(test.from, test.to), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  };
  require('../tests/utils/test-trust-bootstrap');
  // Expected mutants need their assertion, not another full copy of the disposable host.
  require('../tests/utils/runtime-test-control').preserveRuntimeTestEvidence = () => '<expected in-memory mutant; assertion captured>';
  (async () => {
    const module = require(path.join(repo, 'harness/tests/unit', test.suite + '.unit.test.ts'));
    const value = test.selector && module.runSelectedCases ? await module.runSelectedCases(test.selector) : await module.runAll();
    const results = Array.isArray(value) ? value : value.results;
    const failed = results.filter(row => !row.ok);
    console.log('MAISON_MUTATION_RESULT ' + JSON.stringify({ id: test.id, hits, cases: results.length, killed: hits > 0 && failed.length > 0, failures: failed.map(row => ({ name: row.name, error: row.error })) }));
    process.exit(hits > 0 && failed.length > 0 ? 0 : 1);
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
} else if (process.argv[2] === '--run') {
  const { invokeAgentHeadless } = require('../scripts/utils/agent-invoke');
  (async () => {
    const hashes = Object.fromEntries(cases.map(test => [test.file, digest(path.join(repo, test.file))]));
    const results = [];
    for (const test of cases) {
      const result = await invokeAgentHeadless({ argv: [process.execPath, __filename, '--child', test.id], label: 'P4 in-memory mutation ' + test.id }, repo,
        { timeoutMs: 180000, outputLogPath: path.join(__dirname, 'remaining-3.1.0-p4-mutant-' + test.id + '.log') });
      const log = fs.readFileSync(path.join(__dirname, 'remaining-3.1.0-p4-mutant-' + test.id + '.log'), 'utf8');
      const line = log.split(/\r?\n/).findLast(line => line.startsWith('MAISON_MUTATION_RESULT '));
      results.push(line ? { ...JSON.parse(line.slice('MAISON_MUTATION_RESULT '.length)), exitCode: result.exitCode }
        : { id: test.id, killed: false, exitCode: result.exitCode, timedOut: result.timed_out, stderr: result.stderr.slice(-1200) });
    }
    const unchanged = Object.entries(hashes).every(([file, hash]) => digest(path.join(repo, file)) === hash);
    fs.writeFileSync(path.join(__dirname, 'remaining-3.1.0-p4-mutations.json'), JSON.stringify({ sourceHashes: hashes, sourceFilesUnchanged: unchanged, results }, null, 2) + '\n');
    console.log(JSON.stringify({ sourceFilesUnchanged: unchanged, results: results.map(row => ({ id: row.id, killed: row.killed, cases: row.cases })) }));
    if (!unchanged || results.some(row => !row.killed)) process.exitCode = 1;
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
} else console.log('Prepared only. Run --run after prerequisite commits and baseline assertions pass.');
