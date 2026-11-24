// 1804ac3b release-only: identical Node inputs, real checkers/ownership/finalizers.
// Authors/verifiers are deterministic program substitutes, never actual Claude/Codex CLI calls.
// Real model acceptance uses tests/utils/session-cli-project.ts and session-cli-interruption.cjs.
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import { execFile, spawnSync } from 'child_process';
import { prepareSessionCliProject } from '../utils/session-cli-project';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { facts as requestFacts } from './request-entry.unit.test';
import { readDeliveredVerifierRequest } from './real-chain.unit.test';
import { designRepairCompletionTransport } from './design-authority-repair.unit.test';
import { researchSnapshotFacts } from '../fixtures/host-snapshot-3.1.0/migrate';
import { parseContextExploration } from '../../scripts/utils/context-exploration';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, startCaseTiming, type SelectedUnitCases, type UnitExecutionTiming } from '../utils/unit-case-selection';
import { preserveRuntimeTestEvidence, withRuntimeTest } from '../utils/runtime-test-control';

const SOURCE = 'src/math/src/main/clamp.ts';
const TEST = 'src/math/src/test/clamp.test.ts';
const BAD = 'export function clamp(value: number, min: number, max: number): number { return min; }\n';
const COMPILE_BAD = 'export function clamp(value: number, min: number, max: number): number { return "wrong type"; }\n';
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

function assertFeatureCompleted(root: string, mode: string): void {
  const assessment = moduleAt(root, 'scripts/utils/feature-assessment').assessFeature(root, 'clamp', {
    expectedChain: ['coding', 'review', 'ut'], expectedTrack: 'full', frameworkRoot: path.join(root, 'framework') });
  const ends = events(root).filter(event => event.type === 'run_end');
  if (!assessment.complete || !ends.some(event => event.status === 'CHAIN_SLICE_COMPLETED')) {
    const originals = require('../utils/runtime-test-control').preserveRuntimeTestEvidence([root], `${mode}: actual Node completion failed`);
    fs.cpSync(path.join(root, 'doc/features/clamp'), path.join(originals, 'feature'), { recursive: true });
    fs.writeFileSync(path.join(originals, 'assessment.json'), JSON.stringify(assessment, null, 2));
    assert.fail(`${mode}: ${JSON.stringify({ ends, assessment })}\noriginals: ${originals}`);
  }
}

function modelIssueVerification(root: string, required = true): string {
  const priorRun = process.env.MAISON_GOAL_RUN_ID;
  process.env.MAISON_GOAL_RUN_ID = 'session-cli';
  try {
    const proposal = moduleAt(root, 'scripts/utils/repair-candidates').readPhaseRepairIssues(root, 'clamp', 'ut');
    if (!required && !proposal?.rows.length) return '';
    assert.equal(proposal?.rows.length, 1, JSON.stringify(proposal));
    return '\n```issue-verification\n' + YAML.stringify([{ issue: 'UP-CLAMP', verdict: 'confirmed', repair_owner: 'coding',
      evidence: SOURCE + ' | ' + proposal.rows[0].summary }], { lineWidth: 0 }) + '```\n';
  } finally { if (priorRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = priorRun; }
}

export function sessionNodeTestStrengthReply(root: string, phase: string, expectedText: string): string {
  let strengthReply = '';
  if (phase === 'coding') {
    const checks = json(root, 'doc/features/clamp/coding/reports/script-report.json').checks;
    const strength = checks.find((check: any) => check.id === 'coding_existing_test_preserved' && check.affected_files?.length);
    if (strength) {
      assert(strength.affected_files.every((file: string) => file === TEST));
      assert.equal(read(root, TEST), expectedText, 'the Node tests must keep their real boundary assertions');
      const original = moduleAt(root, 'scripts/utils/repair-responsibility').codingTestPreservation({ projectRoot: root, feature: 'clamp', runId: 'session-cli', file: TEST });
      if (original.beforeText !== undefined) assert.equal(original.beforeText, expectedText, 'existing assertions cannot be deleted or weakened');
      else {
        const author = events(root).find(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
        const issued = author && moduleAt(root, 'scripts/utils/session-execution-handoff').executionRequestForInvoke(path.join(root, 'doc/features/clamp/goal-runs/session-cli'), author.invoke_id);
        assert(issued?.request.pre_snapshot, 'test strength requires the actual first unit preimage');
        const before = issued.request.pre_snapshot.entries.find((entry: any) => entry.path === TEST);
        assert(!before || before.kind === 'file' && before.sha256 === sha(expectedText), 'the test must be new or byte-identical to its actual signed preimage');
      }
      strengthReply = '\n```issue-verification\n' + YAML.stringify([{ issue: strength.id, verdict: 'refuted',
        evidence: [TEST, strength.details, '已核真实前像及当前正文；已批准的clamp边界断言全部保留，新断言实际驱动clamp。'].join(' | ') }]) + '```\n';
    }
  }
  return strengthReply;
}

export function researchSessionUnit(root: string, context: { factsContext?: import('../../scripts/utils/context-facts').FactsInvocationContext }): void {
  const admitted = context.factsContext;
  assert(admitted, 'research must consume the actual unit admission');
  if (admitted.baseline) return;
  const file = path.join(root, 'doc/features/clamp/context/facts.md');
  const raw = fs.readFileSync(file, 'utf8'), facts = parseContextExploration(raw);
  assert(!facts.error);
  const declared = Array.isArray(facts.fm.source_code_paths) ? facts.fm.source_code_paths : [];
  const sources = [...new Set([...declared, ...[TEST, 'src/math/src/test/expect.ts'].filter(file => fs.existsSync(path.join(root, file)))])];
  for (const source of sources) fs.readFileSync(path.join(root, source));
  const deltas = raw.match(/^##\s*phase_delta:[\s\S]*/m)?.[0] ?? '';
  fs.writeFileSync(file, '---\n' + YAML.stringify({ ...facts.fm, source_code_paths: sources }) + '---\n' + facts.body);
  researchSnapshotFacts(root, file, admitted.first_phase, admitted);
  if (deltas) fs.appendFileSync(file, '\n' + deltas);
}

function modelVerifier(root: string, phase: string, current: any, draftPath: string, upstreamVerification = ''): void {
  assert(current.verifier_subject_id, 'the verifier model substitute requires a real current request');
  publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: path.join(root, `doc/features/clamp/${phase}/reports`), feature: 'clamp', phase,
    subjectId: current.verifier_subject_id, draftPath,
    reportText: 'Explicit author/verifier model substitute; script/native outcomes remain authoritative.\n'
      + (phase === 'ut' ? '| id | status | severity | 证据 |\n|---|---|---|---|\n| end_to_end_driving | PASS | BLOCKER | node:test直接调用clamp，源码和测试输入与request相同 |\n| business_assertion_value | PASS | BLOCKER | AC-1/2/3各有两个原生相等断言，失败不被本语义替身改写 |\n' : '') + upstreamVerification + sessionNodeTestStrengthReply(root, phase, TEST_SOURCE),
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
export function adaptNative(root: string): void {
  const manifest = moduleAt(root, 'scripts/utils/goal-manifest').loadGoalRunManifestFromRun(root, 'session-cli', { feature: 'clamp' });
  moduleAt(root, 'scripts/utils/adapter-model').rebindTaskModel(manifest, { adapter: 'claude', value: 'claude-opus-5-5', provider: 'anthropic',
    config_source: path.join(root, 'controlled-model-home', 'settings.json') }, root, true);
  fs.appendFileSync(path.join(root, 'framework/profiles/generic/harness/ut-host-impl.js'), `
const originalRun = exports.utHostImpl.checkUtHvigorTest;
exports.utHostImpl.checkUtHvigorTest = (ctx, ...args) => {
  if (require('fs').existsSync(require('path').join(ctx.projectRoot, 'native-gap'))) throw new TypeError('1804 native I/O unavailable');
  return originalRun(ctx, ...args).filter(check => check.id !== 'ut_run').map(check => check.status === 'FAIL' ? { ...check, classification: 'code_regression', failure_kind: 'code_regression', repair_owner: 'coding', affected_files: [${JSON.stringify(SOURCE)}] } : check);
};
`);
}

interface GoalResult { root: string; failedInputs: string[]; invocations: string[]; rawGap: boolean }
export async function runGoal(root: string, mode: 'detached' | 'session', scenario: 'repair' | 'gap' | 'transient' | 'daily-repair' | 'daily-compile-repair' | 'normal' | 'author-tools' | 'author-tools-stale' | 'author-tools-race' | 'author-tools-gap', resume = false): Promise<GoalResult> {
  const runtime = moduleAt(root, 'scripts/goal-phase-runtime');
  const entry = moduleAt(root, 'scripts/goal-mode-entry');
  const invocations: string[] = [], failedInputs: string[] = [];
  let codingCalls = 0, rawGap = false;
  let transientReturned = false;
  const repairsProduct = scenario === 'repair' || scenario === 'daily-repair';
  let authorToolsRan = false;
  const selfCheck = async (phase: string, fence?: any, extraEnv?: Record<string, string>, authorTool = false): Promise<number> => {
    const args = [path.join(root, 'framework/harness/node_modules/ts-node/dist/bin.js'), '--project', path.join(root, 'framework/harness/tsconfig.json'),
      path.join(root, 'framework/harness/harness-runner.ts'), '--project-root', root, '--phase', phase, '--feature', 'clamp'];
    if (fence) args.push('--goal-run-id', 'session-cli', '--goal-attempt-id', fence.attemptId, '--goal-owner-id', fence.owner.owner_id, '--goal-owner-epoch', String(fence.owner.epoch));
    if (authorTool) args.push('--author-tool');
    const env = { ...process.env }; for (const key of Object.keys(env)) if (/^MAISON_(GOAL_|FEATURE)/i.test(key)) delete env[key];
    Object.assign(env, extraEnv ?? {}, { MAISON_GOAL_CHECKPOINT_DIR: path.join(root, '.trust') });
    const invoke = async (tail: string) => {
      const renew = () => { if (fence) moduleAt(root, 'scripts/utils/goal-run-control').renewSessionLease(fence.runDir, fence.owner, 60_000); };
      renew();
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      try {
        return await new Promise<{ status: number; error?: Error; stdout: string; stderr: string }>((resolve, reject) => {
          const child = execFile(process.execPath, [...args, tail], { cwd: path.join(root, 'framework/harness'), env, encoding: 'utf8', timeout: 60000, windowsHide: true },
            (error, stdout, stderr) => resolve({ status: error ? typeof error.code === 'number' ? error.code : 1 : 0, error: error ?? undefined, stdout, stderr }));
          if (fence) heartbeat = setInterval(() => { try { renew(); } catch (error) { child.kill(); reject(error); } }, 20_000);
        });
      } finally { if (heartbeat) clearInterval(heartbeat); }
    };
    let checked = await invoke('--summary');
    assert(fs.existsSync(path.join(root, `doc/features/clamp/${phase}/reports/summary.json`)),
      `${phase} self-check did not publish its result: ${checked.error?.message ?? ''}\n${checked.stdout}\n${checked.stderr}`);
    let current = summary(root, phase);
    const tapFile = path.join(root, 'doc/features/clamp/ut/reports/node-tests.tap');
    const tap = phase === 'ut' && fs.existsSync(tapFile) ? fs.readFileSync(tapFile, 'utf8') : '';
    const nativeFailed = /# fail [1-9]/.test(tap);
    if (!authorTool && phase === 'ut' && current.verdict === 'FAIL' && nativeFailed) {
      const nativeLog = 'doc/features/clamp/ut/reports/native-failure.tap';
      assert.match(tap, /# fail [1-9]/, 'upstream diagnosis must originate in actual native assertions');
      write(root, nativeLog, tap); // Retain the actual failed tool output; later real gate runs have their own timings.
      const line = tap.split('\n').findIndex(value => /^not ok /.test(value)) + 1;
      assert(line > 0);
      fs.appendFileSync(path.join(root, 'doc/features/clamp/ut/testability-audit.md'), `\n## 问题清单\n| ID | 严重程度 | 分类 | 涉及文件 | 问题描述 | 修复建议 | 状态 |\n|---|---|---|---|---|---|---|\n| UP-CLAMP | MAJOR | 产品实现 | ${SOURCE} | \`${nativeLog}:${line}\` 与 \`${SOURCE}:1\` 表明实际clamp违反已批准AC-2/3；UT不拥有产品源码 | coding恢复既有夹取规格，保留当前测试和验收 | 未关闭 |\n`);
      // Existing authored upstream issues admit diagnosis without inventing DAG/interfaces or changing old SKIPs.
      checked = await invoke('--summary'); current = summary(root, phase);
      assert.equal(current.next_action, 'run_verifier_for_repair');
    }
    rawGap ||= current.verdict === 'INCOMPLETE';
    if (phase === 'ut' && nativeFailed) failedInputs.push(sha(read(root, SOURCE)) + ':' + sha(read(root, TEST)));
    return checked.status ?? 1;
  };
  const work = async (phase: string, fence?: any, extraEnv?: Record<string, string>, instruction?: string): Promise<number> => {
    invocations.push(phase);
    if (phase.endsWith('-verifier-format-repair')) {
      const method = phase.replace(/-verifier-format-repair$/, '');
      assert(['coding', 'review', 'ut'].includes(method));
      const current = summary(root, method);
      assert(readDeliveredVerifierRequest({ root, feature: 'clamp', frameworkRoot: path.join(root, 'framework'),
        harnessDir: path.join(root, 'framework/harness'), module: 'math', modulePath: 'src/math' },
      { phase, prompt: instruction ?? '', runId: 'session-cli' }));
      const issued = moduleAt(root, 'scripts/utils/session-execution-handoff')
        .executionRequestForInvoke(path.join(root, 'doc/features/clamp/goal-runs/session-cli'));
      assert.equal(issued?.request.context.phase, phase);
      const draft = issued?.request.write_boundary?.verifierResultPath;
      assert(draft, 'The independent model substitute must use the signed result path');
      modelVerifier(root, method, current, path.resolve(root, draft), method === 'ut' ? modelIssueVerification(root, false) : '');
      return 0; // Chain-external model repair writes only its requested report, never a phase harness/receipt.
    }
    if (phase === 'review') {
      authorReview(root);
      if (scenario === 'author-tools' || scenario === 'author-tools-stale' || scenario === 'author-tools-race' || scenario === 'author-tools-gap') {
        const rows = Object.keys(fence?.workInput?.material.acceptanceReview ?? {}).flatMap(issue => {
          const ac = /^acceptance_test_strength_(AC-\d+)$/.exec(issue)?.[1];
          if (!ac) return [];
          const lines = read(root, TEST).split('\n');
          const position = lines.findIndex(line => line.includes(`it('[${ac}]`) && line.includes('expect(clamp('));
          assert(position >= 0 && read(root, SOURCE).includes('export function clamp('));
          const name = /it\('([^']+)'/.exec(lines[position])![1];
          return [{ issue, verdict: 'refuted', evidence: `\`${TEST}:${position + 1}\` ${name} 调用 \`${SOURCE}:1\` 的生产 clamp，与独立预期值比较。`,
            production_paths: [SOURCE] }];
        });
        if (rows.length) fs.appendFileSync(path.join(root, 'doc/features/clamp/review/review-report.md'),
          '\n```issue-verification\n' + YAML.stringify(rows) + '```\n');
      }
      return 0; // The independent report writer does not run tools or rewrite author research.
    }
    if (phase === 'work-unit-author') {
      const native = path.join(root, 'doc/features/clamp/ut/reports/node-tests.tap');
      const priorNativeFailure = fs.existsSync(native) && /# fail [1-9]/.test(fs.readFileSync(native, 'utf8'));
      if (priorNativeFailure)
        failedInputs.push(sha(read(root, SOURCE)) + ':' + sha(read(root, TEST)));
      if (scenario === 'daily-compile-repair') {
        const report = 'doc/features/clamp/coding/reports/script-report.json';
        if (fs.existsSync(path.join(root, report))) {
          const compile = json(root, report).checks.find((check: any) => check.id === 'coding_compile' && check.status === 'FAIL' && /TS2322/.test(check.details));
          if (compile) {
            assert.equal(read(root, SOURCE), COMPILE_BAD, 'repair must consume the actual failing implementation');
            write(root, 'doc/features/clamp/coding/reports/native-compile-failure.json', read(root, report));
            failedInputs.push(sha(read(root, SOURCE)));
          }
        }
      }
      const issued = moduleAt(root, 'scripts/utils/session-execution-handoff').executionRequestForInvoke(
        path.join(root, 'doc/features/clamp/goal-runs/session-cli'));
      const context = fence ?? issued?.request.context;
      assert(context && context.phase === phase && context.runId === 'session-cli', 'the author must consume its actual unit request');
      const methods = context.chain.filter((method: string) => ['coding', 'review', 'ut'].includes(method));
      for (const method of methods) {
        if (method === 'coding' && !(scenario === 'author-tools-stale' && authorToolsRan)) { codingCalls++; write(root, SOURCE, scenario === 'daily-compile-repair' ? (failedInputs.length ? GOOD : COMPILE_BAD) : repairsProduct && !resume && !failedInputs.includes(sha(BAD) + ':' + sha(TEST_SOURCE)) ? BAD : GOOD); }
        if (method === 'review') authorReview(root);
        if (method === 'ut') authorUt(root);
        authorFacts(root, method);
      }
      researchSessionUnit(root, context);
      if (scenario === 'author-tools-gap') {
        if (!authorToolsRan && !resume) {
          await selfCheck('ut', mode === 'session' ? context : undefined, extraEnv ?? context.childEnv, true);
          assert.equal(summary(root, 'ut').verdict, 'INCOMPLETE');
          const report = json(root, 'doc/features/clamp/ut/reports/script-report.json');
          assert(report.checks.some((check: any) => check.failure_kind === 'framework_bug' && check.details.includes('native I/O unavailable')));
          authorToolsRan = true;
        }
        return 0;
      }
      if (scenario === 'author-tools-race') {
        if (!authorToolsRan) {
          await selfCheck('ut', mode === 'session' ? context : undefined, extraEnv ?? context.childEnv, true);
          assert.match(fs.readFileSync(native, 'utf8'), /# fail 0/, 'the first real native UT passed before the intervening edit');
          assert(read(root, TEST).includes('.toBe(9999)'), 'the test source changed after the native result');
          const reports = path.join(root, 'doc/features/clamp/ut/reports');
          assert(!fs.existsSync(path.join(reports, 'phase-evidence-manifest.json')), 'stale PASS must not publish a phase evidence manifest');
          assert(!events(root).some(event => event.type === 'harness_end' && event.phase === 'ut' && event.author_tool_evidence_sha256));
          write(root, TEST, TEST_SOURCE);
          authorToolsRan = true;
        }
        return 0;
      }
      if (scenario === 'author-tools' || scenario === 'author-tools-stale') {
        const owner = mode === 'session' ? context : undefined;
        const env = extraEnv ?? context.childEnv;
        if (!authorToolsRan) {
          write(root, SOURCE, BAD);
          await selfCheck('ut', owner, env, true);
          assert.match(fs.readFileSync(native, 'utf8'), /# fail [1-9]/, 'the author must see the actual native assertion failure before repairing');
          failedInputs.push(sha(read(root, SOURCE)) + ':' + sha(read(root, TEST)));
          write(root, SOURCE, GOOD);
          await selfCheck('coding', owner, env, true);
          await selfCheck('ut', owner, env, true);
          assert.notEqual(summary(root, 'ut').closure_status, 'closed', 'the author tool must not close the independent UT obligation');
          assert(!fs.existsSync(path.join(root, 'doc/features/clamp/feature-completion.json')), 'author tool cannot sign Feature completion');
          if (scenario === 'author-tools-stale') write(root, SOURCE, GOOD + '// edited after the managed check\n');
        }
        authorToolsRan = true;
        return 0;
      }
      for (const method of methods) if (!['transient', 'daily-compile-repair', 'daily-repair'].includes(scenario) || scenario === 'daily-repair' && method === 'ut' && !priorNativeFailure)
        await selfCheck(method, mode === 'session' ? context : undefined, extraEnv ?? context.childEnv);
      return 0; // The model returned its artifacts; actual native failures remain formal tool evidence.
    }
    if (phase === 'coding') { codingCalls++; write(root, SOURCE, repairsProduct && codingCalls === 1 && !resume ? BAD : GOOD); }
    if (phase === 'ut') authorUt(root);
    authorFacts(root, phase);
    return selfCheck(phase, fence, extraEnv);
  };
  const priorTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, '.trust');
  try {
    if (mode === 'session') {
      const options = { projectRoot: root, frameworkRoot: path.join(root, 'framework'), feature: 'clamp', runId: 'session-cli', adapter: 'claude', runMode: 'attended', authorization: { mode: 'goal_mode', autonomyAuthorized: true } };
      let step = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, ...(resume ? { forceTakeover: true } : {}) }));
      for (let round = 0; step.type === 'phase_execute_request' && round < 14; round++) {
        const requestPath = step.request.path;
        const original = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
        const code = await work(original.context.phase, original.context, original.context.childEnv, original.context.instruction);
        step = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath, report: { phase: original.context.phase, status: code === 0 ? 'passed' : 'failed',
          details: `${original.context.phase}: author selfcheck exit ${code}; actual script/native outcomes remain in the original phase reports.` } }));
      }
      assert.notEqual(step.type, 'phase_execute_request', 'bounded fixture cannot hide a non-convergent runtime');
    } else {
      runtime.__testing_setInvokeAgent(async (_plan: unknown, _cwd: string, options: any) => {
        const phase = options.extraEnv.MAISON_GOAL_PHASE ?? /\/phases\/([a-z-]+)\//.exec(String(options.outputLogPath).replace(/\\/g, '/'))?.[1];
        assert(phase, 'actual transport must identify its phase');
        if (scenario === 'transient' && !transientReturned && phase === 'work-unit-author') {
          transientReturned = true;
          const error = JSON.stringify({type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: 429, result: 'API Error: 429 finite test transport rate limit'});
          write(root, path.relative(root, options.outputLogPath), error + '\n');
          return { exitCode: 1, stdout: '', stderr: error, duration_ms: 0, command: 'controlled-external-model-transport',
            terminal_failure_observed: true, terminal_error_excerpt: error };
        }
        const started = Date.now();
        const output = `Explicit author model substitute executing ${phase}; actual checkers and native tests run below.\n`;
        write(root, path.relative(root, options.outputLogPath), output);
        const instruction = phase.endsWith('-verifier-format-repair') ? fs.readFileSync(path.join(path.dirname(options.outputLogPath), 'prompt.md'), 'utf8') : undefined;
        const code = await work(phase, undefined, options.extraEnv, instruction);
        fs.appendFileSync(options.outputLogPath, `Author selfcheck exited ${code}; script/native outcomes are unchanged.\n`);
        return { exitCode: code, stdout: output, stderr: '', duration_ms: Date.now() - started, command: 'test-model-substitute' };
      });
      try {
        await withRuntimeTest({ root: root }, () => new runtime.GoalPhaseRuntime({ args: ['--feature', 'clamp', resume ? '--resume' : '--attach-created', 'session-cli', ...(resume ? ['--force-resume'] : []), ...(scenario === 'transient' ? ['--authorize-autonomy'] : []), '--adapter', 'claude', '--foreground-ok', '--project-root', root, '--framework-root', path.join(root, 'framework')],
          layout: { kind: 'consumer', projectRoot: root, frameworkRoot: path.join(root, 'framework'), frameworkRel: 'framework' } }).run());
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
  name: 'a7b615ff completed exit1 and accepted session passed perform identical checked design publication rebinding and continuation',
  async run() {
    const detached = await designRepairCompletionTransport('detached');
    const session = await designRepairCompletionTransport('session');
    assert.deepStrictEqual(detached, session, 'the same approved inputs and authorization must produce the same business outcome and total calls');
  },
}, {
  name: 'a7b615ff waiting with exit0 cannot enter design questioning or publish in either transport',
  async run() {
    const detached = await designRepairCompletionTransport('detached', true);
    const session = await designRepairCompletionTransport('session', true);
    assert.deepStrictEqual(detached, session);
  },
}, {
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
        assert(events(root).filter(e => e.type === 'agent_invoke_start' && e.phase === 'work-unit-author').length > 1,
        'the real work-unit request must deliver the product repair');
        assertFeatureCompleted(root, mode);
        for (const phase of ['coding', 'review', 'ut']) {
          const s = summary(root, phase);
          const script = json(root, `doc/features/clamp/${phase}/reports/script-report.json`);
          if (phase === 'coding') {
            assert(script.checks.some((check: any) => check.id === 'coding_compile' && check.status === 'PASS'), 'the real compiler must pass');
          } else {
            assert.equal(s.verdict, 'PASS', `${mode}/${phase}: ${JSON.stringify({ verdict: s.verdict, next: s.next_action,
              blockers: s.blockers, failures: script.checks.filter((check: any) => check.status === 'FAIL') })}`);
            // The actual formal Feature completion above owns the endpoint;
            // a live author's self-check does not sign old phase receipts.
          }
        }
        assert(events(root).some(e => e.type === 'run_end' && e.status === 'CHAIN_SLICE_COMPLETED'), JSON.stringify(events(root).filter(e => e.type === 'run_end')));
        if (mode === 'session') {
          assert(!events(root).some(e => e.invoke_id === 'legacy-close'));
          assert(!events(root).some(e => e.type === 'agent_process_settled' && e.process_role !== 'harness'), 'session completion must come from accepted reports, never simulated agent settlement');
        }
        const unit = events(root).find(e => e.type === 'agent_invoke_start' && e.phase === 'work-unit-author');
        const original = unit && moduleAt(root, 'scripts/utils/session-execution-handoff').executionRequestForInvoke(
          path.join(root, 'doc/features/clamp/goal-runs/session-cli'), unit.invoke_id);
        const before = original?.request.pre_snapshot?.entries.find((entry: any) => entry.path === TEST);
        const testWrites = events(root).filter(e => e.type === 'phase_write_observed' && e.phase === 'work-unit-author')
          .flatMap(e => e.owned ?? []).filter((write: any) => write.path === TEST);
        assert(testWrites.some((write: any) => write.post_sha256 === sha(TEST_SOURCE) && write.roles?.some((role: any) => role.kind === 'source'))
          || before?.sha256 === sha(TEST_SOURCE), '原生测试须来自真实单元的授权写入或字节未变的签发前像，不能补造阶段owner');
        assertFeatureCompleted(root, mode);
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
      const duplicate = await withRuntimeTest({ root: session }, () => moduleAt(session, 'scripts/goal-mode-entry').runGoalModeSessionStep({ projectRoot: session, frameworkRoot: path.join(session, 'framework'), feature: 'clamp', runId: 'session-cli', adapter: 'claude', runMode: 'attended',
        requestPath: path.resolve(session, 'doc/features/clamp/goal-runs/session-cli', current.reference.path), report: report.report }));
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
        assert(continued.invocations.every(phase => phase === 'ut-verifier-format-repair'), 'native-I/O recovery must reuse all settled phase authors');
        assert(!events(root).some(e => e.type === 'budget_turns' || e.type === 'budget_wall_clock'), 'verification recovery stays within the original budget');
        assert.equal(json(root, 'doc/features/clamp/goal-runs/session-cli/manifest.json').run_id, 'session-cli', 'recovery keeps the original run identity');
        assert.equal(summary(root, 'ut').verdict, 'PASS');
        assertFeatureCompleted(root, `${mode}/I-O recovery`);
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
  name: '77105c47 active author runs native check failure and repair in one unit before independent closure',
  async run() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), '77105-author-tools-'));
    const root = path.join(temp, 'session');
    try {
      prepareSessionCliProject(root, 'claude', false); adaptNative(root);
      const result = await runGoal(root, 'session', 'author-tools');
      assert(result.failedInputs.includes(sha(BAD) + ':' + sha(TEST_SOURCE)));
      const history = events(root);
      const toolEnds = history.filter(event => event.type === 'harness_end' && event.author_tool_evidence_sha256);
      const failed = toolEnds.find(event => event.phase === 'ut' && event.verdict === 'FAIL');
      const passed = toolEnds.find(event => event.phase === 'ut' && event.verdict === 'PASS' && event.author_tool_invoke_id === failed?.author_tool_invoke_id);
      assert(failed && passed && failed.author_tool_invoke_id, 'tool must record both real outcomes under one author request');
      assert(history.some(event => event.type === 'phase_verdict' && event.invoke_id === passed.invoke_id), 'coordinator did not consume the real author tool result');
      assert(history.some(event => event.type === 'agent_invoke_start' && event.phase === 'ut-verifier-format-repair'),
        'closed UT result must still have a separate independent verifier');
      for (const start of history.filter(event => event.type === 'harness_start' && event.phase === 'ut' && !event.author_tool_invoke_id)) {
        const log = read(root, `doc/features/clamp/goal-runs/session-cli/phases/ut/${start.invoke_id}/harness-output.log`);
        assert.match(log, /CHECK_RESULT retained_author_tool=ut/, 'coordinator reassembly must reuse identical native UT input');
      }
      assertFeatureCompleted(root, 'qualified author tools');
    } catch (error) {
      const runDir = path.join(root, 'doc/features/clamp/goal-runs/session-cli');
      const files = [path.join(runDir, 'events.jsonl'), ...['coding', 'review', 'ut'].flatMap(phase =>
        ['summary.json', 'script-report.json', 'phase-evidence-manifest.json'].map(file => path.join(root, 'doc/features/clamp', phase, 'reports', file))),
        path.join(runDir, 'phases/ut/ut-i1/harness-output.log')];
      console.log('AUTHOR_TOOL_ORIGINALS ' + preserveRuntimeTestEvidence([root], String(error), [], files));
      throw error;
    } finally {
      if (process.env.KEEP_PARITY_ROOT !== '1') fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      else console.log('kept author-tool root', root);
    }
  },
}, {
  name: '77105c47 first formal UT runs after the author native environment recovers with the same inputs',
  async run() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), '77105-author-tools-gap-'));
    const root = path.join(temp, 'session');
    try {
      prepareSessionCliProject(root, 'claude', false); adaptNative(root);
      write(root, 'native-gap', 'temporary native provider I/O fault');
      const blocked = await runGoal(root, 'session', 'author-tools-gap');
      assert(blocked.rawGap && summary(root, 'ut').verdict === 'INCOMPLETE');
      fs.unlinkSync(path.join(root, 'native-gap'));
      const continued = await runGoal(root, 'session', 'author-tools-gap', true);
      assert(!continued.invocations.includes('work-unit-author'), 'recovery must resume the existing author assignment');
      const history = events(root);
      const gap = history.find(event => event.type === 'harness_end' && event.phase === 'ut' && event.author_tool_evidence_sha256);
      assert(gap && gap.verdict === 'INCOMPLETE', 'the real author INCOMPLETE stays in the journal');
      const start = history.find(event => event.type === 'harness_start' && event.phase === 'ut' && !event.author_tool_invoke_id);
      assert(start, 'the first formal UT check must start');
      const log = read(root, `doc/features/clamp/goal-runs/session-cli/phases/ut/${start.invoke_id}/harness-output.log`);
      assert.doesNotMatch(log, /CHECK_RESULT retained_author_tool=ut/, 'the first formal check must execute native UT rather than retain INCOMPLETE');
      assert(history.some(event => event.type === 'phase_verdict' && event.invoke_id === start.invoke_id && event.verdict === 'PASS'));
      for (const [file, text] of [[SOURCE, GOOD], [TEST, TEST_SOURCE]]) {
        assert.equal(gap.related_input_snapshot?.[file]?.contentHash, sha(text));
        assert.equal(start.related_input_snapshot?.[file]?.contentHash, sha(text));
      }
      assert.match(read(root, 'doc/features/clamp/ut/reports/node-tests.tap'), /# fail 0/);
      assertFeatureCompleted(root, 'recovered native author tool');
    } finally {
      if (process.env.KEEP_PARITY_ROOT !== '1') fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      else console.log('kept author-tool gap root', root);
    }
  },
}, {
  name: '77105c47 author tool result is discarded after its checked source changes',
  async run() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), '77105-author-tools-stale-'));
    const root = path.join(temp, 'session');
    try {
      prepareSessionCliProject(root, 'claude', false); adaptNative(root);
      await runGoal(root, 'session', 'author-tools-stale');
      const history = events(root);
      const proof = history.find(event => event.type === 'harness_end' && event.phase === 'ut'
        && event.verdict === 'PASS' && event.author_tool_evidence_sha256);
      assert(proof, 'fixture did not publish a real historical author tool PASS');
      assert(!history.some(event => event.type === 'phase_verdict' && event.invoke_id === proof.invoke_id),
        'old author result was consumed after the code changed');
      const changed = sha(GOOD + '// edited after the managed check\n');
      assert(history.some(event => event.type === 'harness_end' && event.phase === 'ut' && !event.author_tool_invoke_id
        && event.related_input_snapshot?.[SOURCE]?.contentHash === changed),
        'changed production input was not run by the formal gate');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
}, {
  name: '77105c47 first managed UT cannot bind a PASS to test bytes changed during the check',
  async run() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), '77105-author-tools-race-'));
    const root = path.join(temp, 'session');
    try {
      prepareSessionCliProject(root, 'claude', false); adaptNative(root);
      fs.appendFileSync(path.join(root, 'framework/profiles/generic/harness/ut-host-impl.js'), `
const runBeforeRace = exports.utHostImpl.checkUtHvigorTest;
exports.utHostImpl.checkUtHvigorTest = (ctx, ...args) => {
  const result = runBeforeRace(ctx, ...args);
  const marker = require('path').join(ctx.projectRoot, 'doc/features/clamp/ut/reports/first-ut-race-applied');
  if (!require('fs').existsSync(marker) && result.some(row => row.id === 'ut_hvigor_test' && row.status === 'PASS')) {
    const file = require('path').join(ctx.projectRoot, ${JSON.stringify(TEST)});
    const previous = require('fs').readFileSync(file, 'utf8');
    const changed = previous.replace('.toBe(0)', '.toBe(9999)');
    require('assert/strict').notEqual(previous, changed);
    require('fs').writeFileSync(file, changed);
    require('fs').writeFileSync(marker, '');
  }
  return result;
};
`);
      await runGoal(root, 'session', 'author-tools-race');
      const history = events(root);
      assert(history.some(event => event.type === 'harness_end' && event.phase === 'ut' && !event.author_tool_invoke_id),
        'the coordinator must verify the current source after the stale check');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
