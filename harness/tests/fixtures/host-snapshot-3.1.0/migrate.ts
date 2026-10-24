import * as YAML from 'yaml';
import { loadFactsInvocationContext } from '../../../scripts/utils/capability-resolution-entry-input';
import { findPhaseDeltaSection, type FactsInvocationContext } from '../../../scripts/utils/context-facts';
import { parseContextExploration } from '../../../scripts/utils/context-exploration';
import { extractTables } from '../../../scripts/utils/markdown-parser';
import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { clearFrameworkConfigCache, featureFilePath } from '../../../config';
import { assessFeature } from '../../../scripts/utils/feature-assessment';
import { resolveChangeUnitExpectedExecution } from '../../../scripts/utils/change-unit-completion';
import { publishVerifier, writeSpecMaterials, writeCuSpecMaterials } from '../../unit/real-chain.unit.test';
import { runGoalRuntimeChain } from '../../unit/goal-runner-testing-integrity.unit.test';
import { ensureFakeDeveco } from '../../unit/successor-exit.unit.test';
import { git, provisionFrameworkUnder, synthesizeTestChainProfile } from '../../utils/real-chain-host';
import { copyTree, loadHostSnapshot, SNAPSHOT_CU_FEATURE, SNAPSHOT_FLAT_FEATURE } from './generate';

type Snapshot = ReturnType<typeof loadHostSnapshot>;
const hash = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** 模拟 Agent 的调查动作；基线资格仍由生产入口给出。 */
export function researchSnapshotFacts(root: string, file: string, phase: string, admitted: FactsInvocationContext): void {
  const prior = fs.readFileSync(file, 'utf8');
  const { fm, body, error } = parseContextExploration(prior);
  assert(!error, error);
  const header: Record<string, unknown> = { ...fm };
  const declared = Array.isArray(header.source_code_paths) ? header.source_code_paths.filter((source): source is string => typeof source === 'string') : [];
  const row = (source: string, impact: string): string => {
    const bytes = fs.readFileSync(path.join(root, source));
    const text = bytes.includes(0) ? '二进制资源，按路径和内容哈希核对' : bytes.toString('utf8').split(/\r?\n/).find(line => line.trim()) ?? '(empty)';
    return '| ' + source + ' | 当前原文：' + text.replace(/\|/g, '/') + ' | ' + impact + ' |';
  };
  if (admitted.baseline || admitted.first_phase !== phase) {
    const delta = findPhaseDeltaSection(body, phase, true);
    const registered = new Set([
      ...declared,
      ...extractTables(delta.content).filter(table => table.headers.some(title => /事实/.test(title))).flatMap(table => {
        const column = table.headers.findIndex(title => /路径/.test(title));
        return column < 0 ? [] : table.rows.map(cells => (cells[column] ?? '').replace(/`/g, '').trim());
      }),
    ].map(source => path.relative(root, path.resolve(root, source.replace(/\\/g, '/'))).replace(/\\/g, '/')));
    const additional = admitted.source_paths.filter(source => !registered.has(source));
    const rows = additional.filter(source => fs.existsSync(path.join(root, source)) && fs.statSync(path.join(root, source)).isFile())
      .map(source => row(source, '核对本阶段新增输入'));
    // 其它阶段的同路径不能代替当前阶段的调查；同阶段多节则按生产解析合并。
    if (rows.length || !delta.content) fs.appendFileSync(file, '\n## phase_delta: ' + phase + '\n' + (rows.length
      ? '| 路径 | 事实 | 影响 |\n|---|---|---|\n' + rows.join('\n') : 'none') + '\n');
    return;
  }
  const sources = [...new Set([...declared, ...admitted.source_paths])]
    .filter(source => { const abs = path.resolve(root, source); return abs.startsWith(root + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile(); });
  assert('feature' in admitted.subject && 'run_id' in admitted.subject, '快照迁移调查必须绑定实际 run');
  Object.assign(header, { schema_version: '1.1', feature: admitted.subject.feature, run_id: admitted.subject.run_id, established_by: phase, source_code_paths: sources });
  delete header.frozen_scope_fingerprint; delete header.request_sha256;
  fs.writeFileSync(file, '---\n' + YAML.stringify(header) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n'
    + sources.map(source => row(source, '核对当前实现输入')).join('\n') + '\n');
}

/** 显式升级旧快照副本：只替代 agent/verifier 传输，harness、范围、预算和完成核验都走生产。 */
export async function migrateHostSnapshot(s: Snapshot, feature: string) {
  clearFrameworkConfigCache();
  const before = assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot });
  assert(before.record.state === 'ok' && before.record.run_id, '旧完成原件必须仍可信并有 run 身份');
  const sourceRun = before.record.run_id;
  assert(!before.complete && before.obligations.some(o => o.owner_phase === 'review' && o.status === 'uncovered'), '必须真实识别旧 review gate 失效');
  const projection = JSON.parse(fs.readFileSync(featureFilePath(s.root, feature, 'feature-completion.json'), 'utf8'));
  const original = path.join(s.root, projection.original_path);
  const originalHash = hash(original);
  const manifest = JSON.parse(fs.readFileSync(featureFilePath(s.root, feature, `goal-runs/${sourceRun}/manifest.json`), 'utf8'));
  // 快照按契约排除了 .git；只在副本补测试仓库，不改旧 manifest/完成原件。
  if (!fs.existsSync(path.join(s.root, '.git'))) {
    git(s.root, ['init', '-q']);
    fs.writeFileSync(path.join(s.root, '.gitignore'), 'framework/\nfake-deveco/\nbuild/\n');
    git(s.root, ['add', '-A']);
    // Both files are authored by the fixture's UT stages, not its seed. Keep their captured bytes
    // in the working tree while reconstructing the portable pre-UT ownership baseline.
    git(s.root, ['rm', '--cached', '--', '02-Feature/FinancialCard/src/ohosTest/ets/test/AllBanksPage.test.ets',
      'src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets']);
    git(s.root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'snapshot sources before authored UT']);
  }
  let rebaselineTo: string | undefined;
  try { execFileSync('git', ['cat-file', '-e', `${manifest.run_base_sha}^{commit}`], { cwd: s.root, stdio: 'ignore' }); }
  catch { rebaselineTo = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: s.root, encoding: 'utf8' }).trim(); }
  const owners = new Set(before.obligations.filter(o => o.applicability === 'required' && o.status === 'uncovered' && o.kind !== 'phase-result').map(o => o.owner_phase));
  const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'].filter(phase => owners.has(phase));
  ensureFakeDeveco(s);
  const p = { ...s, feature, module: feature === SNAPSHOT_CU_FEATURE ? 'ledger' : 'FinancialCard', modulePath: feature === SNAPSHOT_CU_FEATURE ? 'src/ledger' : '02-Feature/FinancialCard' };
  const researchIfRequested = (ctx: { runId: string; phase: string; goalAttemptId?: string }): void => {
    const admitted = loadFactsInvocationContext({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase: ctx.phase, runId: ctx.runId, attemptId: ctx.goalAttemptId });
    if (!admitted) return;
    researchSnapshotFacts(s.root, featureFilePath(s.root, feature, 'context/facts.md'), ctx.phase, admitted);
  };
  const probe = await runGoalRuntimeChain(s.root, {
    frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex', realHarness: true,
    supersede: [sourceRun], freshRequirement: manifest.requirement, rebaselineTo,
    freshStartPhase: chain[0] as 'review', freshEndPhase: chain.at(-1), skipLegacySeal: true,
    onSpec: ctx => {
      const current = { ...p, runId: ctx.runId };
      const facts = featureFilePath(s.root, feature, 'context/facts.md');
      const admitted = loadFactsInvocationContext({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase: ctx.phase, runId: ctx.runId, attemptId: ctx.goalAttemptId });
      const baseline = admitted?.baseline && fs.existsSync(facts) ? fs.readFileSync(facts) : undefined;
      if (feature === SNAPSHOT_CU_FEATURE) writeCuSpecMaterials(current); else writeSpecMaterials(current, undefined, { preserveUnchanged: true });
      if (baseline) fs.writeFileSync(facts, baseline);
      researchIfRequested(ctx);
      if (ctx.attempt > 1) publishVerifier(current, 'spec');
    },
    onPlan: ctx => { researchIfRequested(ctx); if (ctx.attempt > 1) publishVerifier({ ...p, runId: ctx.runId }, 'plan'); },
    onCoding: ctx => { researchIfRequested(ctx); if (ctx.attempt > 1) publishVerifier({ ...p, runId: ctx.runId }, 'coding'); },
    onUt: ctx => { researchIfRequested(ctx); if (ctx.attempt > 1) publishVerifier({ ...p, runId: ctx.runId }, 'ut'); },
    onReview: ctx => { researchIfRequested(ctx); if (ctx.attempt > 1) publishVerifier(p, 'review'); },
    onTesting: researchIfRequested,
  });
  clearFrameworkConfigCache();
  const after = assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot });
  assert.equal(hash(original), originalHash, '迁移不得改写旧 completion 原件');
  const failedPhase = [...probe.events].reverse().find(event => event.type === 'phase_verdict' && event.verdict !== 'PASS')?.phase;
  const failedReport = failedPhase ? featureFilePath(s.root, feature, `${failedPhase}/reports/script-report.json`) : '';
  const failureChecks = failedReport && fs.existsSync(failedReport)
    ? JSON.parse(fs.readFileSync(failedReport, 'utf8')).checks.filter((check: { status: string; severity: string }) => check.status === 'FAIL' || check.status === 'SKIP' && check.severity === 'BLOCKER') : [];
  assert.equal(probe.exitCode, 0, JSON.stringify({ events: probe.events.slice(-5), checks: failureChecks }));
  assert(after.complete, JSON.stringify({ record: after.record, obligations: after.obligations.filter(o => o.status === 'uncovered') }));
  assert(after.record.state === 'ok' && after.record.run_id, '新完成必须仍可信并有 run 身份');
  if (owners.has('spec')) assert(probe.invokedPhases.includes('spec'), 'invalid spec proof must be replaced by a real spec execution, without requiring an extra scope write');
  const successorRun = after.record.run_id;
  assert.notEqual(successorRun, sourceRun, '已完成后必须用新 run 生成新 completion');
  assert(probe.events.some(event => event.type === 'supersede' && event.target_run_id === sourceRun), '须有正式承接审计');
  assert.equal(probe.events.filter(event => event.type === 'agent_invoke_start').length, probe.invokedPhases.length, '迁移调用必须照计预算');
  const summary = JSON.parse(fs.readFileSync(featureFilePath(s.root, feature, 'review/reports/summary.json'), 'utf8'));
  console.log(`SNAPSHOT_MIGRATED feature=${feature} source=${sourceRun} successor=${successorRun} chain=${chain.join(',')} invokes=${probe.invokedPhases.length}`);
  return { feature, source_run: sourceRun, successor_run: successorRun, originalHash, chain, invoked_phases: probe.invokedPhases, gate_fingerprint: summary.gate_fingerprint, verifier_closure: summary.verifier_closure, events: probe.events };
}

// 每个测试 worker/所需 Feature 集合只做一次正式迁移；各用例仍拿隔离副本，不共享可变产物。
const prepared = new Map<string, Promise<Snapshot>>();
const roots: string[] = [];
process.once('exit', () => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

export async function loadMigratedHostSnapshot(features: readonly string[] = [SNAPSHOT_FLAT_FEATURE, SNAPSHOT_CU_FEATURE]): Promise<Snapshot> {
  const key = [...features].sort().join(',');
  if (!prepared.has(key)) prepared.set(key, (async () => {
    const s = loadHostSnapshot(); roots.push(s.root);
    for (const feature of features) await migrateHostSnapshot(s, feature);
    return s;
  })());
  const source = await prepared.get(key)!;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migrated-snapshot-')));
  copyTree(source.root, root, true);
  // 此 Git 由上面的临时准备生成，保留它才能核验新的正式 run_base_sha；原快照依旧不含 Git。
  fs.cpSync(path.join(source.root, '.git'), path.join(root, '.git'), { recursive: true });
  const framework = provisionFrameworkUnder(root);
  synthesizeTestChainProfile(framework.frameworkRoot);
  return { root, ...framework };
}
