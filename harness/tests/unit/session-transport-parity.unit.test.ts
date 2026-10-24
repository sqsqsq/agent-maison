// 1804ac3b release-only: identical Node inputs, real checkers/ownership/finalizers.
// Only author/verifier models and the explicitly injected native-I/O exception are substitutes.
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { prepareSessionCliProject } from '../utils/session-cli-project';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { facts as requestFacts } from './request-entry.unit.test';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, startCaseTiming, type SelectedUnitCases, type UnitExecutionTiming } from '../utils/unit-case-selection';

const SOURCE = 'src/math/src/main/clamp.ts';
const TEST = 'src/math/src/test/clamp.test.ts';
const BAD = 'export function clamp(value: number, min: number, max: number): number { return min; }\n';
const GOOD = 'export function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }\n';
const TEST_SOURCE = [
  "import { it } from 'node:test';",
  "import { clamp } from '../main/clamp';",
  "import { expect } from './expect';",
  "it('[AC-1] lower', () => { expect(clamp(-2, 0, 10)).toBe(0); expect(clamp(-1, 0, 10)).toBe(0); });",
  "it('[AC-2] upper', () => { expect(clamp(12, 0, 10)).toBe(10); expect(clamp(11, 0, 10)).toBe(10); });",
  "it('[AC-3] within', () => { expect(clamp(4, 0, 10)).toBe(4); expect(clamp(5, 0, 10)).toBe(5); });",
  '',
].join('\n');
const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (root: string, file: string): any => JSON.parse(read(root, file));
function write(root: string, file: string, value: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value);
}
const moduleAt = (root: string, relative: string): any => require(path.join(root, 'framework/harness', relative));
const summary = (root: string, phase: string) => json(root, `doc/features/clamp/${phase}/reports/summary.json`);
const events = (root: string): any[] => read(root, 'doc/features/clamp/goal-runs/session-cli/events.jsonl').split('\n').filter(Boolean).map(line => JSON.parse(line));

function modelIssueVerification(root: string): string {
  const priorRun = process.env.MAISON_GOAL_RUN_ID;
  process.env.MAISON_GOAL_RUN_ID = 'session-cli';
  try {
    const proposal = moduleAt(root, 'scripts/utils/repair-candidates').readPhaseRepairIssues(root, 'clamp', 'ut');
    assert.equal(proposal?.rows.length, 1, JSON.stringify(proposal));
    return '\n```issue-verification\n' + YAML.stringify([{ issue: 'UP-CLAMP', verdict: 'confirmed', repair_owner: 'coding',
      evidence: SOURCE + ' | ' + proposal.rows[0].summary }], { lineWidth: 0 }) + '```\n';
  } finally { if (priorRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = priorRun; }
}

function modelVerifier(root: string, phase: string, current: any, upstreamVerification = ''): void {
  assert(current.verifier_subject_id, 'the verifier model substitute requires a real current request');
  publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: path.join(root, `doc/features/clamp/${phase}/reports`), feature: 'clamp', phase,
    subjectId: current.verifier_subject_id,
    reportText: 'Explicit author/verifier model substitute; script/native outcomes remain authoritative.\n'
      + (phase === 'ut' ? '| id | status | severity | 证据 |\n|---|---|---|---|\n| end_to_end_driving | PASS | BLOCKER | node:test直接调用clamp，源码和测试输入与request相同 |\n| business_assertion_value | PASS | BLOCKER | AC-1/2/3各有两个原生相等断言，失败不被本语义替身改写 |\n' : '') + upstreamVerification,
    skipSummaryPatch: true });
}

function authorFacts(root: string, phase: string): void {
  const file = 'doc/features/clamp/context/facts.md';
  const files = ['src/math/src/main/clamp.ts', 'src/math/src/main/limits.ts', 'src/math/src/main/index.ts',
    'doc/features/clamp/acceptance.yaml', 'doc/features/clamp/contracts.yaml', 'doc/module-catalog.yaml', 'doc/glossary.yaml', 'doc/architecture.md', 'framework.config.json'];
  if (fs.existsSync(path.join(root, TEST))) files.push(TEST);
  const rows = files.map(p => `| ${p} | 已读原件：${read(root, p).split('\n').find(Boolean)?.replace(/\|/g, '/') ?? 'empty'} | 按原批准契约核验 |`);
  if (!fs.existsSync(path.join(root, file))) write(root, file, '---\n' + YAML.stringify({ schema_version: '1.1', feature: 'clamp', run_id: 'session-cli', established_by: 'coding',
    ready_to_produce: true, has_blocker_coverage_risk: false, exploration_mode: 'sequential',
    key_inputs_read: files, source_code_paths: files.filter(p => p.startsWith('src/math/src/main/')), files_inspected_count: files.length, searches_performed_estimate: 6,
    decisions_unlocked: ['restore approved clamp'], change_intent: 'modify', estimated_loc_delta: 3, single_function_scope: true,
  }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n' + rows.join('\n') + '\n');
  const old = read(root, file);
  const sections = old.split(/(?=^## phase_delta:)/m).filter(part => !new RegExp(`^## phase_delta: ${phase}\\b`).test(part));
  write(root, file, sections.join('').trimEnd() + `\n\n## phase_delta: ${phase}\n| 路径 | 事实 | 影响 |\n|---|---|---|\n` + rows.join('\n') + '\n');
}

function authorReview(root: string): void {
  const files = YAML.parse(read(root, 'doc/features/clamp/contracts.yaml')).files;
  write(root, 'doc/features/clamp/review/review-report.md', '# 审查报告\n\n## 1. 审查范围\n' + files.map((f: string) => '- ' + f).join('\n')
    + '\n\n## 2. 审查维度\n契约、边界、源码及可测性。模型替身不证明语义无缺陷；真实断言仍由UT执行。\n\n## 3. 问题清单\n| 编号 | 分类 | 严重程度 | 问题描述 | 涉及文件 | 修复建议 |\n|---|---|---|---|---|---|\n\n## 4. 问题统计\n| 严重程度 | 数量 |\n|---|---|\n| BLOCKER | 0 |\n| MAJOR | 0 |\n| MINOR | 0 |\n\n## 5. 修复建议\n无新增建议。\n\n## 6. 结论\n**审查结论**: 通过\n');
}

function authorUt(root: string): void {
  write(root, TEST, TEST_SOURCE);
  write(root, 'doc/features/clamp/ut/testability-audit.md', '```yaml\n' + YAML.stringify({ records: [1, 2, 3].map(n => ({ acceptance_id: `AC-${n}`,
    entry_point: { file: SOURCE, symbol: 'clamp' }, testability_level: 'L1', dependencies: [{ name: 'Math', kind: 'pure' }], verdict: 'testable' })) }) + '```\n');
  write(root, 'doc/features/clamp/ut/mock-plan.yaml', YAML.stringify({ schema_version: '1.0', feature: 'clamp', spies: [] }));
  write(root, 'doc/features/clamp/ut/reports/coverage-evidence.json', JSON.stringify({ schema_version: '1.0', feature: 'clamp', primary_evidence_source: 'ut_tags',
    sources: { ut_tags: [TEST] }, mappings: [1, 2, 3].map(n => ({ scope_id: `AC-${n}`, scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' })) }));
}

/** Profile-native boundary adaptation only; real assertion status is never replaced. */
function adaptNative(root: string): void {
  fs.appendFileSync(path.join(root, 'framework/profiles/generic/harness/ut-host-impl.js'), `
const originalRun = exports.utHostImpl.checkUtHvigorTest;
exports.utHostImpl.checkUtHvigorTest = (ctx, ...args) => {
  if (require('fs').existsSync(require('path').join(ctx.projectRoot, 'native-gap'))) throw new TypeError('1804 native I/O unavailable');
  return originalRun(ctx, ...args).filter(check => check.id !== 'ut_run').map(check => check.status === 'FAIL' ? { ...check, classification: 'code_regression', failure_kind: 'code_regression', repair_owner: 'coding', affected_files: [${JSON.stringify(SOURCE)}] } : check);
};
`);
}

interface GoalResult { root: string; failedInputs: string[]; invocations: string[]; rawGap: boolean }
export async function runGoal(root: string, mode: 'detached' | 'session', scenario: 'repair' | 'gap', resume = false): Promise<GoalResult> {
  const runtime = moduleAt(root, 'scripts/goal-phase-runtime');
  const entry = moduleAt(root, 'scripts/goal-mode-entry');
  const invocations: string[] = [], failedInputs: string[] = [];
  let codingCalls = 0, rawGap = false;
  const selfCheck = (phase: string, fence?: any, extraEnv?: Record<string, string>): number => {
    const args = [path.join(root, 'framework/harness/node_modules/ts-node/dist/bin.js'), '--project', path.join(root, 'framework/harness/tsconfig.json'),
      path.join(root, 'framework/harness/harness-runner.ts'), '--project-root', root, '--phase', phase, '--feature', 'clamp'];
    if (fence) args.push('--goal-run-id', 'session-cli', '--goal-attempt-id', fence.attemptId, '--goal-owner-id', fence.owner.owner_id, '--goal-owner-epoch', String(fence.owner.epoch));
    const env = { ...process.env }; for (const key of Object.keys(env)) if (/^MAISON_(GOAL_|FEATURE)/i.test(key)) delete env[key];
    Object.assign(env, extraEnv ?? {}, { MAISON_GOAL_CHECKPOINT_DIR: path.join(root, '.trust') });
    const invoke = (tail: string) => spawnSync(process.execPath, [...args, tail], { cwd: path.join(root, 'framework/harness'), env, encoding: 'utf8', timeout: 60000, windowsHide: true });
    let checked = invoke('--summary');
    let current = summary(root, phase);
    let upstreamVerification = '';
    if (phase === 'ut' && current.verdict === 'FAIL') {
      const nativeLog = 'doc/features/clamp/ut/native-failure.tap';
      const tap = read(root, 'doc/features/clamp/ut/reports/node-tests.tap');
      assert.match(tap, /# fail [1-9]/, 'upstream diagnosis must originate in actual native assertions');
      write(root, nativeLog, tap); // Retain the actual failed tool output; later real gate runs have their own timings.
      const line = tap.split('\n').findIndex(value => /^not ok /.test(value)) + 1;
      assert(line > 0);
      fs.appendFileSync(path.join(root, 'doc/features/clamp/ut/testability-audit.md'), `\n## 问题清单\n| ID | 严重程度 | 分类 | 涉及文件 | 问题描述 | 修复建议 | 状态 |\n|---|---|---|---|---|---|---|\n| UP-CLAMP | MAJOR | 产品实现 | ${SOURCE} | \`${nativeLog}:${line}\` 与 \`${SOURCE}:1\` 表明实际clamp违反已批准AC-2/3；UT不拥有产品源码 | coding恢复既有夹取规格，保留当前测试和验收 | 未关闭 |\n`);
      // Existing authored upstream issues admit diagnosis without inventing DAG/interfaces or changing old SKIPs.
      checked = invoke('--summary'); current = summary(root, phase);
      upstreamVerification = modelIssueVerification(root);
      assert(current.blocking_skips?.some((check: any) => check.id === 'dag_files_parseable'), 'simple no-DAG path must preserve its old SKIP');
      assert.equal(current.next_action, 'run_verifier_for_repair');
    }
    rawGap ||= current.verdict === 'INCOMPLETE';
    if (phase === 'ut' && current.verdict === 'FAIL') failedInputs.push(sha(read(root, SOURCE)) + ':' + sha(read(root, TEST)));
    if (current.verifier_subject_id) {
      modelVerifier(root, phase, current, upstreamVerification);
      if (current.verdict === 'PASS') invoke('--sync-closure');
    }
    return checked.status ?? 1;
  };
  const work = (phase: string, fence?: any, extraEnv?: Record<string, string>): number => {
    invocations.push(phase);
    if (phase === 'ut-verifier-format-repair') {
      modelVerifier(root, 'ut', summary(root, 'ut'), modelIssueVerification(root));
      return 0; // Chain-external model repair writes only its requested report, never a phase harness/receipt.
    }
    if (phase === 'coding') { codingCalls++; write(root, SOURCE, scenario === 'repair' && codingCalls === 1 && !resume ? BAD : GOOD); }
    if (phase === 'review') authorReview(root);
    if (phase === 'ut') authorUt(root);
    authorFacts(root, phase);
    return selfCheck(phase, fence, extraEnv);
  };
  const priorTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, '.trust');
  try {
    if (mode === 'session') {
      const options = { projectRoot: root, frameworkRoot: path.join(root, 'framework'), feature: 'clamp', runId: 'session-cli', adapter: 'claude', runMode: 'attended', authorization: { mode: 'goal_mode', autonomyAuthorized: true } };
      let step = await entry.runGoalModeSessionStep(options);
      for (let round = 0; step.type === 'phase_execute_request' && round < 14; round++) {
        const requestPath = step.request.path;
        const original = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
        const code = work(original.context.phase, original.context, original.context.childEnv);
        step = await entry.runGoalModeSessionStep({ ...options, requestPath, report: { phase: original.context.phase, status: code === 0 ? 'passed' : 'failed',
          details: `${original.context.phase}: author selfcheck exit ${code}; actual script/native outcomes remain in the original phase reports.` } });
      }
      assert.notEqual(step.type, 'phase_execute_request', 'bounded fixture cannot hide a non-convergent runtime');
    } else {
      runtime.__testing_setInvokeAgent(async (_plan: unknown, _cwd: string, options: any) => {
        const phase = options.extraEnv.MAISON_GOAL_PHASE ?? /\/phases\/([a-z-]+)\//.exec(String(options.outputLogPath).replace(/\\/g, '/'))?.[1];
        assert(phase, 'actual transport must identify its phase');
        const started = Date.now();
        const output = `Explicit author model substitute executing ${phase}; actual checkers and native tests run below.\n`;
        write(root, path.relative(root, options.outputLogPath), output);
        const code = work(phase, undefined, options.extraEnv);
        fs.appendFileSync(options.outputLogPath, `Author selfcheck exited ${code}; script/native outcomes are unchanged.\n`);
        return { exitCode: code, stdout: output, stderr: '', duration_ms: Date.now() - started, command: 'test-model-substitute' };
      });
      try {
        await new runtime.GoalPhaseRuntime({ args: ['--feature', 'clamp', resume ? '--resume' : '--attach-created', 'session-cli', '--adapter', 'claude', '--foreground-ok', '--project-root', root, '--framework-root', path.join(root, 'framework')],
          layout: { kind: 'consumer', projectRoot: root, frameworkRoot: path.join(root, 'framework'), frameworkRel: 'framework' } }).run();
      } finally { runtime.__testing_setInvokeAgent(null); }
    }
    return { root, failedInputs, invocations, rawGap };
  } finally { if (priorTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = priorTrust; }
}

function requestProject(from: string, root: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(from, 'framework'), path.join(root, 'framework'), { recursive: true });
  for (const rel of ['src', 'framework.config.json', 'framework.local.json', 'doc/module-catalog.yaml', 'doc/glossary.yaml', 'doc/architecture.md', 'doc/features/clamp/acceptance.yaml', 'doc/features/clamp/contracts.yaml']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.cpSync(path.join(from, rel), path.join(root, rel), { recursive: true });
  }
  write(root, TEST, TEST_SOURCE);
  write(root, 'framework/profiles/generic/harness/providers/node_test.js', `
const fs=require('fs'),path=require('path'),cp=require('child_process');
exports.provider={id:'node_test',capability:'ut.run',exports:['runRequestTests']};
exports.runRequestTests=ctx=>{
 if(ctx.subject!=='request'||'feature' in ctx||'featureSpec' in ctx) throw new Error('request must remain request-scoped');
 if(Object.keys(process.env).some(k=>/^MAISON_(GOAL_|FEATURE)/i.test(k))) throw new Error('ambient Goal identity leaked into request');
 if(fs.existsSync(path.join(ctx.projectRoot,'native-gap'))) throw new TypeError('1804 native I/O unavailable');
 const harness=path.resolve(__dirname,'../../../../harness'),out=path.join(ctx.reportDir,'node-build');
 const compiled=cp.spawnSync(process.execPath,[path.join(harness,'node_modules/typescript/bin/tsc'),'--outDir',out,'--rootDir',ctx.projectRoot,'--target','ES2022','--module','commonjs','--moduleResolution','node','--esModuleInterop','--skipLibCheck','--typeRoots',path.join(harness,'node_modules/@types'),...ctx.request.targets.tests],{cwd:ctx.projectRoot,encoding:'utf8'});
 if(compiled.status!==0) throw new Error(compiled.stdout+compiled.stderr);
 const run=cp.spawnSync(process.execPath,['--test','--test-reporter=tap',...ctx.request.targets.tests.map(f=>path.join(out,f.replace(/\\.ts$/,'.js')))],{cwd:ctx.projectRoot,encoding:'utf8'});
 const text=run.stdout+run.stderr;fs.writeFileSync(path.join(ctx.reportDir,'native-test.log'),text);
 const number=key=>Number(new RegExp('^# '+key+' (\\\\d+)$','m').exec(text)?.[1]||0);
 return {executed:run.status!==null,total:number('tests'),failed:number('fail'),skipped:number('skipped'),checks:[],evidence_paths:['native-test.log']};
};\n`);
}

async function runRequest(root: string, name: string): Promise<any> {
  write(root, 'doc/requests/ut.json', JSON.stringify({ schema_version: '1.0', phase: 'ut', requested_result: 'verify the approved clamp contract',
    targets: { files: [SOURCE], tests: [TEST] }, baseline: { head: 'WORKTREE' }, inputs: { acceptance: 'doc/features/clamp/acceptance.yaml' }, allowed_test_writes: [] }));
  const options = { projectRoot: root, frameworkRoot: path.join(root, 'framework'), phase: 'ut', requestFile: 'doc/requests/ut.json', reportDir: `doc/reports/${name}` };
  const prepared = moduleAt(root, 'scripts/utils/capability-resolution-entry-input').prepareExplicitRequest(options);
  requestFacts(prepared, root);
  await moduleAt(root, 'scripts/utils/request-phase').runExplicitRequest({ projectRoot: root, frameworkRoot: path.join(root, 'framework'), args: { phase: 'ut', 'request-file': options.requestFile, 'report-dir': options.reportDir } });
  const report = json(root, `${options.reportDir}/script-report.json`);
  assert.equal(report.subject, 'request');
  assert(!fs.existsSync(path.join(root, 'doc/features/clamp/goal-runs')), 'request cannot create a Goal run');
  assert(!fs.existsSync(path.join(root, 'doc/features/clamp/feature-completion.json')), 'request cannot sign Feature completion');
  return report;
}

const cases: Array<{ name: string; run(): Promise<void> }> = [{
  name: '1804 same Node assertion inputs fail and recover through detached session and request with real finalizers',
  async run() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-transport-parity-'));
    const priorTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    try {
      const detached = path.join(temp, 'detached'), session = path.join(temp, 'session'), request = path.join(temp, 'request');
      prepareSessionCliProject(detached, 'claude', true); adaptNative(detached);
      prepareSessionCliProject(session, 'claude', false); adaptNative(session);
      requestProject(detached, request);
      const expected = sha(BAD) + ':' + sha(TEST_SOURCE);
      for (const [mode, root] of [['detached', detached], ['session', session]] as const) {
        const observed = await runGoal(root, mode, 'repair');
        assert(observed.failedInputs.includes(expected), `${mode}: the same real assertion failure must be observed`);
        assert(!fs.existsSync(path.join(root, 'src/math/test/dag')), 'simple transport case cannot be made green by hand-feeding a DAG');
        assert(events(root).some(e => e.type === 'phase_backtrack_requested' && e.to_phase === 'coding'), 'only the real owner route may repair product code');
        for (const phase of ['coding', 'review', 'ut']) { const s = summary(root, phase); assert.equal(s.verdict, 'PASS', `${mode}/${phase}`); assert.equal(s.closure_status, 'closed'); }
        assert(events(root).some(e => e.type === 'run_end' && e.status === 'CHAIN_SLICE_COMPLETED'));
        if (mode === 'session') {
          assert(!events(root).some(e => e.invoke_id === 'legacy-close'));
          assert(!events(root).some(e => e.type === 'agent_process_settled' && e.process_role !== 'harness'), 'session completion must come from accepted reports, never simulated agent settlement');
        }
        assert(events(root).some(e => e.type === 'phase_write_observed' && e.phase === 'ut' && e.owned?.some((w: any) => w.path === TEST)), 'real UT ownership must be recorded');
        assert.equal(moduleAt(root, 'scripts/utils/feature-assessment').assessFeature(root, 'clamp', { expectedChain: ['coding', 'review', 'ut'], expectedTrack: 'full', frameworkRoot: path.join(root, 'framework') }).complete, true);
      }
      write(request, SOURCE, BAD);
      assert.equal(sha(read(request, SOURCE)) + ':' + sha(read(request, TEST)), expected);
      const failed = await runRequest(request, 'failed'); assert.equal(failed.summary.verdict, 'FAIL');
      // A separately authorized maintenance actor repairs the product; the UT request provider never writes source.
      write(request, SOURCE, GOOD);
      const repaired = await runRequest(request, 'repaired'); assert.equal(repaired.summary.verdict, 'PASS');
      assert.equal(read(detached, SOURCE), read(session, SOURCE)); assert.equal(read(session, SOURCE), read(request, SOURCE));
      assert.equal(read(detached, TEST), read(request, TEST));
      // Accepted session reports are immutable queries: no model or formal gate is run again.
      const last = [...events(session)].reverse().find(e => e.type === 'agent_invoke_end' && e.handoff_report);
      assert(last); const report = json(session, `doc/features/clamp/goal-runs/session-cli/${last.handoff_report.path}`);
      const current = moduleAt(session, 'scripts/utils/session-execution-handoff').readSessionExecution(path.join(session, 'doc/features/clamp/goal-runs/session-cli'));
      const before = read(session, 'doc/features/clamp/goal-runs/session-cli/events.jsonl');
      const duplicate = await moduleAt(session, 'scripts/goal-mode-entry').runGoalModeSessionStep({ projectRoot: session, frameworkRoot: path.join(session, 'framework'), feature: 'clamp', runId: 'session-cli', adapter: 'claude', runMode: 'attended',
        requestPath: path.resolve(session, 'doc/features/clamp/goal-runs/session-cli', current.reference.path), report: report.report });
      assert.equal(duplicate.duplicate, true); assert.equal(read(session, 'doc/features/clamp/goal-runs/session-cli/events.jsonl'), before);
    } finally {
      if (priorTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = priorTrust;
      assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
      if (process.env.KEEP_PARITY_ROOT !== '1') fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); else console.log('kept parity root', temp);
    }
  },
}, {
  name: '1804 the same native I/O gap remains INCOMPLETE in all transports and the unchanged authorized task resumes after recovery',
  async run() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-transport-gap-'));
    const priorTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    try {
      const detached = path.join(temp, 'detached'), session = path.join(temp, 'session'), request = path.join(temp, 'request');
      prepareSessionCliProject(detached, 'claude', true); adaptNative(detached);
      prepareSessionCliProject(session, 'claude', false); adaptNative(session);
      requestProject(detached, request);
      for (const [mode, root] of [['detached', detached], ['session', session]] as const) {
        write(root, 'native-gap', 'the same native producer cannot return an assertion result\n');
        const blocked = await runGoal(root, mode, 'gap');
        assert(blocked.rawGap, `${mode}: native producer failure must be visible as a real gap`);
        const incomplete = summary(root, 'ut'); assert.equal(incomplete.verdict, 'INCOMPLETE'); assert.notEqual(incomplete.closure_status, 'closed');
        assert.equal(moduleAt(root, 'scripts/utils/feature-assessment').assessFeature(root, 'clamp', { expectedChain: ['coding', 'review', 'ut'], expectedTrack: 'full', frameworkRoot: path.join(root, 'framework') }).complete, false);
        assert.equal(read(root, SOURCE), GOOD); assert.equal(read(root, TEST), TEST_SOURCE);
        fs.unlinkSync(path.join(root, 'native-gap'));
        const continued = await runGoal(root, mode, 'gap', true);
        if (mode === 'session') {
          assert(!events(root).some(e => e.invoke_id === 'legacy-close'));
          assert(!events(root).some(e => e.type === 'agent_process_settled' && e.process_role !== 'harness'), 'session resume cannot borrow a detached completion fact');
        }
        assert(!continued.invocations.includes('coding'), 'clearing a native-I/O gap cannot repeat already-valid implementation');
        assert.equal(summary(root, 'ut').verdict, 'PASS'); assert.equal(summary(root, 'ut').closure_status, 'closed');
        assert.equal(moduleAt(root, 'scripts/utils/feature-assessment').assessFeature(root, 'clamp', { expectedChain: ['coding', 'review', 'ut'], expectedTrack: 'full', frameworkRoot: path.join(root, 'framework') }).complete, true);
      }
      write(request, SOURCE, GOOD); write(request, 'native-gap', 'the same native producer cannot return an assertion result\n');
      const gap = await runRequest(request, 'native-gap'); assert.equal(gap.summary.verdict, 'INCOMPLETE');
      assert(gap.checks.some((check: any) => check.status === 'SKIP' && check.failure_kind === 'framework_bug'));
      fs.unlinkSync(path.join(request, 'native-gap'));
      const recovered = await runRequest(request, 'native-gap'); assert.equal(recovered.summary.verdict, 'PASS');
      assert.match(read(request, 'doc/reports/native-gap/native-test.log'), /# tests 3/);
    } finally {
      if (priorTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = priorTrust;
      assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
      if (process.env.KEEP_PARITY_ROOT !== '1') fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); else console.log('kept gap root', temp);
    }
  },
}, {
  name: '1804 historical 179a73 original inputs retain observed ownership and spec admission through the existing production baseline replay',
  async run() {
    // This is the preserved real host input contract, distinct from the self-contained Node transport exercise.
    const original = await (require('./responsibility-host-replay.unit.test') as typeof import('./responsibility-host-replay.unit.test'))
      .runSelectedCases('179a73 before i6 keeps observed coding source hashes and the original spec admission');
    assert.equal(original.matchedCaseCount, 1, 'reuse the exact historical case, not a synthetic replacement');
    assert(original.results.every(result => result.ok), original.results.map(result => result.error).filter(Boolean).join('\n'));
  },
}];

export function getCases() { return cases; }
export async function runSelectedCases(selector?: string): Promise<SelectedUnitCases> {
  const selected = cases.filter(c => matchesUnitCase(c.name, selector)), results: UnitCaseResult[] = [], executionTimings: UnitExecutionTiming[] = [];
  for (const c of selected) { const stop = startCaseTiming([c.name], executionTimings); try { await c.run(); results.push({ name: c.name, ok: true }); } catch (error) { results.push({ name: c.name, ok: false, error: (error as Error).stack }); } finally { stop(); } }
  return { results, matchedCaseCount: selected.length, executionTimings };
}
export const runAll = async () => (await runSelectedCases()).results;
