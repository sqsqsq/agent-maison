import * as YAML from 'yaml';
import { findPhaseDeltaSection, type FactsInvocationContext } from '../../../scripts/utils/context-facts';
import { parseContextExploration } from '../../../scripts/utils/context-exploration';
import { extractTables } from '../../../scripts/utils/markdown-parser';
import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir } from '../../../config';
import { resolveWorkflowSpec } from '../../../workflow-loader';
import { resolveSuccessorExecutionScope } from '../../../scripts/utils/feature-execution-scope';
import { loadEffectiveExecutionScope } from '../../../scripts/utils/goal-run-creation';
import { computeGateFingerprint } from '../../../scripts/utils/gate-fingerprint';
import { assessFeature } from '../../../scripts/utils/feature-assessment';
import { resolveChangeUnitExpectedExecution } from '../../../scripts/utils/change-unit-completion';
import { EMPTY_LEDGER_TEST, checksDisplayedBankRows, publishRequestedVerifier, readDeliveredVerifierRequest, signedVerifierDraftPath, writeSpecMaterials, writeCuSpecMaterials, writeTestPlan } from '../../unit/real-chain.unit.test';
import { computeMaterialSha256, readVerifierMaterialOrNull, verifierMaterialFileMatchesCurrent } from '../../../scripts/utils/verifier-material';
import { loadVerifierEvidenceForSubject, parseVerifierEvidenceText } from '../../../scripts/utils/verifier-evidence';
import { publishFixtureVerifierEvidence } from '../../utils/verifier-evidence-fixture';
import { runGoalRuntimeChain } from '../../unit/goal-runner-testing-integrity.unit.test';
import { preserveRuntimeTestEvidence } from '../../utils/runtime-test-control';
import { executionRequestForInvoke, stageVerifierHandbacks } from '../../../scripts/utils/session-execution-handoff';
import { resolveCompletionDisposition, type FeatureCompletion } from '../../../scripts/utils/verify-feature-completion';
import { loadPhaseEvidenceManifest } from '../../../scripts/utils/phase-evidence-manifest';
import { codingTestPreservation } from '../../../scripts/utils/repair-responsibility';
import { ensureFakeDeveco } from '../../unit/successor-exit.unit.test';
import { git, provisionFrameworkUnder, synthesizeTestChainProfile } from '../../utils/real-chain-host';
import { copyTree, loadHostSnapshot, SNAPSHOT_CU_FEATURE, SNAPSHOT_FLAT_FEATURE } from './generate';

type Snapshot = ReturnType<typeof loadHostSnapshot>;
const hash = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const cardRepo = '02-Feature/FinancialCard/src/main/ets/BankRepository.ets';
const cardService = '02-Feature/FinancialCard/src/main/ets/BankService.ets';
const cardPage = '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets';
const cardTest = '02-Feature/FinancialCard/src/ohosTest/ets/test/AllBanksPage.test.ets';
const ledgerSource = 'src/ledger/LedgerFeature.ets';
const ledgerTest = 'src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets';
const bankCase = '[AC-2] 银行列表展示真实条目并过滤空值';
const ledgerCase = '[BRANCH-success][AC-1] LedgerFeature.add 刷新消费者并恢复已提交记录';

export function installSnapshotUtProvider(frameworkRoot: string, injectedFailure?: { test: string; source: string }): void {
  const host = path.join(frameworkRoot, 'profiles/test-chain/harness/ut-host-impl.js');
  const modulePath = path.join(__dirname, 'snapshot-ut-provider.cjs');
  assert(fs.existsSync(modulePath), 'the isolated migration must have its runnable UT provider');
  const execute = 'require(' + JSON.stringify(modulePath) + ')';
  const provider = injectedFailure
    ? '(ctx, files, targets) => ' + execute + '(ctx, files, targets, ' + JSON.stringify(injectedFailure) + ')'
    : execute;
  const assignment = 'exports.utHostImpl.checkUtHvigorTest = ' + provider + ';';
  if (!fs.readFileSync(host, 'utf8').includes(assignment)) fs.appendFileSync(host, '\n' + assignment + '\n');
}

/** The saved test-only legacy coverage required real repairs under the current semantic UT rules. */
export function repairSnapshotUtProduct(root: string, feature: string, phase?: 'coding' | 'ut'): void {
  const replace = (file: string, before: string, after: string): void => {
    const full = path.join(root, file);
    const text = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
    if (text.includes(after)) return;
    assert(text.includes(before), 'migration must recognize the actual repair object: ' + file);
    fs.writeFileSync(full, text.replace(before, after));
  };
  if (feature === SNAPSHOT_FLAT_FEATURE) {
    if (phase !== 'ut') {
      replace(cardRepo, 'return [];', "return ['cmb', ''];");
      replace(cardService, 'export class BankService {', "import { BankRepository } from './BankRepository';\n\nexport class BankService {\n  listBankRows(): string[] { return new BankRepository().list().filter(id => id.length > 0); }");
      replace(cardPage, "import { BankRepository } from './BankRepository';", "import { BankService } from './BankService';");
      replace(cardPage, 'new BankRepository().list()', 'new BankService().listBankRows()');
    }
    if (phase !== 'coding') {
      replace(cardTest, "it('[AC-2] 银行列表展示',", `it('${bankCase}',`);
      replace(cardTest,
        "    const repo: BankRepository = new BankRepository();\n    const banks: string[] = repo.list();\n    expect(banks).not().assertNull();\n    expect(banks.length).assertEqual(0);",
        "    const banks: string[] = new BankService().listBankRows();\n    expect(banks.length).assertEqual(1);\n    expect(banks[0]).assertEqual('cmb');");
      replace(`doc/features/${feature}/ut/testability-audit.md`, `file: ${cardService}, symbol: openCard`, `file: ${cardService}, symbol: listBankRows`);
      replace(`doc/features/${feature}/ut/testability-audit.md`, `file: ${cardRepo}, symbol: list`, `file: ${cardService}, symbol: openCard`);
    }
  } else {
    replace(ledgerSource, 'export class LedgerFeature {\n  private entries: number[] = [];\n  add(amount: number): number { this.entries.push(amount); return this.balance(); }\n  balance(): number { return this.entries.reduce((a, b) => a + b, 0); }', [
      'export interface LedgerStore { read(): number[]; commit(entries: number[]): void; }',
      'export class LedgerFeature {',
      '  private entries: number[] = [];',
      "  phase: string = 'start';",
      '  constructor(private store?: LedgerStore) {}',
      '  add(amount: number): number {',
      '    this.entries = [...(this.store?.read() ?? this.entries), amount];',
      '    this.store?.commit(this.entries);',
      "    this.phase = 'done';",
      '    return this.balance();',
      '  }',
      '  balance(): number { return (this.store?.read() ?? this.entries).reduce((a, b) => a + b, 0); }',
    ].join('\n'));
    replace(ledgerTest, "import { LedgerFeature } from '../../../../LedgerFeature';", [
      "import { LedgerFeature, LedgerStore } from '../../../../LedgerFeature';",
      'class RecordingStore implements LedgerStore {',
      '  private entries: number[] = [45, 55];',
      '  commitCount: number = 0;',
      '  read(): number[] { return [...this.entries]; }',
      '  commit(entries: number[]): void { this.entries = [...entries]; this.commitCount++; }',
      '}',
    ].join('\n'));
    replace(ledgerTest, "it('[BRANCH-success][AC-1] LedgerFeature.add 刷新余额并可恢复',", `it('${ledgerCase}',`);
    replace(ledgerTest,
      '    const ledger: LedgerFeature = new LedgerFeature();\n    expect(ledger.add(120)).assertEqual(120);\n    expect(ledger.restore([45, 55])).assertEqual(100);',
      [
        '    const store: RecordingStore = new RecordingStore();',
        '    const ledger: LedgerFeature = new LedgerFeature(store);',
        '    const consumer: LedgerFeature = new LedgerFeature(store);',
        "    expect(ledger.phase).assertEqual('start');",
        '    expect(consumer.balance()).assertEqual(100);',
        '    expect(ledger.add(120)).assertEqual(220);',
        "    expect(ledger.phase).assertEqual('done');",
        '    expect(store.commitCount).assertEqual(1);',
        '    expect(consumer.balance()).assertEqual(220);',
        '    expect(new LedgerFeature(store).balance()).assertEqual(220);',
      ].join('\n'));
  }
}

function readSnapshotUtDecision(root: string, feature: string) {
  const flat = feature === SNAPSHOT_FLAT_FEATURE;
  const issue = flat ? 'acceptance_test_strength_AC-2' : 'acceptance_test_strength_AC-1';
  const name = flat ? bankCase : ledgerCase;
  const sourceFiles = flat ? [cardService, cardRepo, cardPage] : [ledgerSource];
  const testFile = flat ? cardTest : ledgerTest;
  const reads = [testFile, ...sourceFiles].map(file => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
  const [test, source, repo, page] = reads.map(read => read.text.replace(/\r\n/g, '\n'));
  const verified = flat ? checksDisplayedBankRows(test) && source.includes(".filter(id => id.length > 0)")
    && repo.includes("return ['cmb', ''];") && page.includes('new BankService().listBankRows()') && page.includes('ForEach(this.banks')
    : test.includes("expect(ledger.phase).assertEqual('start')") && test.includes("expect(ledger.phase).assertEqual('done')")
      && test.includes('expect(ledger.add(120)).assertEqual(220)') && test.includes('expect(store.commitCount).assertEqual(1)')
      && test.includes('expect(consumer.balance()).assertEqual(220)') && test.includes('expect(new LedgerFeature(store).balance()).assertEqual(220)')
      && source.includes('this.store?.commit(this.entries)') && source.includes('this.store?.read() ?? this.entries');
  // A new independent review binds the source it actually saw, including edits that keep line numbers stable.
  const evidence = reads.map(({ file, text }) => {
    const digest = crypto.createHash('sha256').update(text).digest('hex');
    return `\`${file}:1-${text.trimEnd().split(/\r?\n/).length}\`（SHA-256 ${digest}）`;
  }).join('、') + `。${name}。` + (flat
    ? verified ? '用例驱动页面同用的列表入口，验证真实源中的 cmb 被保留、无效条目被剔除。' : '现有用例未证明页面驱动的银行列表含可展示条目。'
    : verified ? '用例观察提交序列、既有消费者刷新和重新创建后的余额，三者读取同一保存原件。' : '现有用例未证明提交后消费者刷新与重新创建。');
  return { issue, verified, evidence, sourceFiles, testFile };
}

function snapshotProject(s: Snapshot, feature: string) {
  return { ...s, feature, module: feature === SNAPSHOT_CU_FEATURE ? 'ledger' : 'FinancialCard', modulePath: feature === SNAPSHOT_CU_FEATURE ? 'src/ledger' : '02-Feature/FinancialCard' };
}

type ReturnedDrafts = Map<string, { phase: string; sha256: string }>;

export function snapshotVerifierHooks(s: Snapshot, feature: string, evidenceFiles: string[] = [], returned?: ReturnedDrafts):
  Pick<NonNullable<Parameters<typeof runGoalRuntimeChain>[1]>, 'onOutOfChain' | 'onReview'> {
  const p = snapshotProject(s, feature);
  return {
    onOutOfChain: ctx => {
      const current = { ...p, runId: ctx.runId }, request = readDeliveredVerifierRequest(current, ctx);
      assert(request, `unexpected snapshot model request: ${ctx.phase}`);
      const draftPath = signedVerifierDraftPath(current, ctx.runId, request);
      const reports = featurePhaseReportsDir(s.root, feature, request.phase, s.frameworkRoot);
      const material = readVerifierMaterialOrNull(reports, request.subject_id);
      assert(material && material.material_sha256 === request.material_sha256 && computeMaterialSha256(material) === request.material_sha256,
        'the delivered request must bind the actual current material original');
      const diagnosis = loadVerifierEvidenceForSubject(s.root, feature, request.phase, request.subject_id, { frameworkRoot: s.frameworkRoot });
      console.log('SNAPSHOT_VERIFIER_REQUEST ' + JSON.stringify({ phase: request.phase, subject: request.subject_id,
        diagnostic: diagnosis.ok ? diagnosis.evidence.verdict : diagnosis.code }));
      if (request.phase === 'ut') {
        const decision = readSnapshotUtDecision(s.root, feature);
        for (const file of [decision.testFile, ...decision.sourceFiles]) assert(verifierMaterialFileMatchesCurrent({
          projectRoot: s.root, feature, material, file,
        }), 'UT verifier must read actual currently bound source: ' + file);
        const status = decision.verified ? 'PASS' : 'FAIL';
        const reportText = ['| id | status | severity | 证据 |', '|---|---|---|---|',
          ...['end_to_end_driving', 'business_assertion_value'].map(id => `| ${id} | ${status} | BLOCKER | ${decision.evidence} |`), '',
        ].join('\n');
        publishFixtureVerifierEvidence({ projectRoot: s.root, reportsDir: reports, feature, phase: request.phase, subjectId: request.subject_id,
          draftPath, skipSummaryPatch: true, verdict: decision.verified ? 'PASS' : 'FAIL', blockerCount: decision.verified ? 0 : 2, reportText });
      } else if (request.phase === 'coding' && !diagnosis.ok) {
        const raw = JSON.parse(fs.readFileSync(path.join(reports, 'script-report.json'), 'utf8'));
        const check = raw.checks.find((item: { id: string }) => item.id === 'coding_existing_test_preserved');
        if (!check || !check.affected_files?.length) {
          assert(publishRequestedVerifier(current, ctx));
        } else {
          const decision = readSnapshotUtDecision(s.root, feature);
          assert(check.affected_files.length === 1 && check.affected_files[0] === decision.testFile, 'unexpected migration assertion target');
          const original = codingTestPreservation({ projectRoot: s.root, feature, runId: ctx.runId, file: decision.testFile });
          assert(original.beforeText, 'the independent reviewer must compare against the captured original test bytes');
          assert(feature === SNAPSHOT_FLAT_FEATURE ? original.beforeText.includes('expect(banks.length).assertEqual(0)')
            : original.beforeText === EMPTY_LEDGER_TEST || original.beforeText.includes('expect(ledger.restore([45, 55])).assertEqual(100)'),
          'the captured pre-image must be the original empty ledger scaffold or its known prior assertions');
          const reportText = '```issue-verification\n' + YAML.stringify([{
            issue: check.id, verdict: decision.verified ? 'refuted' : 'confirmed', repair_owner: 'ut',
            evidence: `${check.details}\n${decision.evidence}`, production_paths: decision.sourceFiles,
          }]) + '```\n';
          publishFixtureVerifierEvidence({ projectRoot: s.root, reportsDir: reports, feature, phase: request.phase,
            subjectId: request.subject_id, draftPath, skipSummaryPatch: true, reportText });
        }
      } else {
        assert(publishRequestedVerifier(current, ctx), 'only the actually delivered independent request may publish its reply');
      }
      const draft = parseVerifierEvidenceText({ feature, phase: request.phase, currentSubject: request.subject_id,
        text: fs.readFileSync(draftPath, 'utf8'), mdAbs: draftPath, mdRel: path.relative(s.root, draftPath) });
      assert(draft.ok, JSON.stringify(draft));
      returned?.set(request.subject_id, { phase: request.phase, sha256: hash(draftPath) });
    },
    onReview: ctx => {
      const runDir = featureFilePath(s.root, feature, `goal-runs/${ctx.runId}`);
      const issued = executionRequestForInvoke(runDir);
      const signed = issued?.request.context.workInput?.material.acceptanceReview;
      if (!signed || issued?.request.context.phase !== 'review') return;
      const decision = readSnapshotUtDecision(s.root, feature);
      assert(Object.keys(signed).every(issue => issue === decision.issue), 'missing fixture decision for the actual issued acceptance question');
      const report = featureFilePath(s.root, feature, 'review/review-report.md');
      const signedReport = issued.request.write_boundary?.verifierResultPath;
      assert(signedReport && path.resolve(s.root, signedReport) === report, 'the actual reviewer request must authorize the report path');
      const requestFile = path.resolve(runDir, issued.reference.path);
      evidenceFiles.push(requestFile, path.join(path.dirname(requestFile), 'independent-review-report.md'));
      const inputHashes = new Map(issued.request.pre_snapshot?.entries.filter(entry => entry.kind === 'file')
        .map(entry => [path.resolve(s.root, entry.path), entry.sha256]));
      const bound = (file: string): boolean => inputHashes.get(path.resolve(s.root, file)) === hash(path.resolve(s.root, file));
      const missing = [decision.testFile, ...decision.sourceFiles].filter(file => !bound(file));
      const verdict = missing.length ? 'unclear' : decision.verified ? 'refuted' : 'confirmed';
      const evidence = missing.length ? decision.evidence + ' 尚缺签发材料中的当前绑定：' + missing.join('、') + '。' : decision.evidence;
      console.log('SNAPSHOT_ACCEPTANCE_REVIEW ' + JSON.stringify({ feature, issue: decision.issue,
        invoke: issued.request.invoke_id, material: signed[decision.issue], missing, verdict }));
      const body = fs.readFileSync(report, 'utf8').replace(/\n?```issue-verification\s*\r?\n[\s\S]*?```/g, '').trimEnd();
      fs.writeFileSync(report, body + '\n\n```issue-verification\n' + YAML.stringify([{
        issue: decision.issue, verdict, repair_owner: 'ut', evidence, production_paths: decision.sourceFiles,
      }]) + '```\n');
    },
  };
}

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

/** 显式升级旧快照副本：只替代 agent/verifier 传输，harness、范围和完成核验都走生产。 */
export async function migrateHostSnapshot(s: Snapshot, feature: string, deviceGate?: unknown) {
  clearFrameworkConfigCache();
  const before = assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot });
  assert(before.record.state === 'ok' && before.record.run_id, '旧完成原件必须仍可信并有 run 身份');
  const sourceRun = before.record.run_id;
  assert(!before.complete && before.obligations.some(o => o.owner_phase === 'review' && o.status === 'uncovered'), '必须真实识别旧 review gate 失效');
  const projection = JSON.parse(fs.readFileSync(featureFilePath(s.root, feature, 'feature-completion.json'), 'utf8'));
  const original = path.join(s.root, projection.original_path);
  const originalHash = hash(original);
  const manifest = JSON.parse(fs.readFileSync(featureFilePath(s.root, feature, `goal-runs/${sourceRun}/manifest.json`), 'utf8'));
  assert(!readSnapshotUtDecision(s.root, feature).verified, 'the old snapshot cannot provide a current semantic PASS');
  // 快照按契约排除了 .git；只在副本补测试仓库，不改旧 manifest/完成原件。
  if (!fs.existsSync(path.join(s.root, '.git'))) {
    git(s.root, ['init', '-q']);
    fs.writeFileSync(path.join(s.root, '.gitignore'), 'framework/\nfake-deveco/\nbuild/\n');
    git(s.root, ['add', '-A']);
    // The new migration's honest pre-image is the captured current snapshot, including old weak UT cases.
    git(s.root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'captured sources before migration repairs']);
  }
  let rebaselineTo: string | undefined;
  try { execFileSync('git', ['cat-file', '-e', `${manifest.run_base_sha}^{commit}`], { cwd: s.root, stdio: 'ignore' }); }
  catch { rebaselineTo = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: s.root, encoding: 'utf8' }).trim(); }
  const owners = new Set(before.obligations.filter(o => o.applicability === 'required' && o.status === 'uncovered' && o.kind !== 'phase-result').map(o => o.owner_phase));
  ensureFakeDeveco(s);
  installSnapshotUtProvider(s.frameworkRoot);
  const successorScope = resolveSuccessorExecutionScope(s.root, feature, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }),
    s.frameworkRoot, manifest.requirement, sourceRun, manifest.fidelity);
  assert(successorScope?.phase_chain.length, 'the actual original request must have a nonempty current successor scope');
  const chain = successorScope.phase_chain;
  const staleGates = chain.flatMap(phase => {
    const file = path.join(featurePhaseReportsDir(s.root, feature, phase, s.frameworkRoot), 'summary.json');
    if (!fs.existsSync(file)) return [];
    const old = JSON.parse(fs.readFileSync(file, 'utf8')).gate_fingerprint;
    const current = computeGateFingerprint(s.frameworkRoot, phase);
    assert(current, `迁移须能计算当前门禁指纹：${phase}`);
    return old && old !== current ? [{ phase, file, old, current }] : [];
  });
  assert(staleGates.some(gate => gate.phase === 'review'), 'the preserved snapshot must exercise a changed gate fingerprint');
  const p = snapshotProject(s, feature);
  const evidenceFiles = ['context/facts.md', 'acceptance.yaml', 'contracts.yaml', 'spec/spec.md'].map(file => featureFilePath(s.root, feature, file));
  const returned: ReturnedDrafts = new Map();
  const probe = await runGoalRuntimeChain(s.root, {
    frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex', realHarness: true, deviceGate,
    testControl: { timeoutMs: 20 * 60_000, evidenceFiles },
    supersede: [sourceRun], freshRequirement: manifest.requirement, rebaselineTo,
    freshStartPhase: chain[0] as 'review', freshEndPhase: chain.at(-1), skipLegacySeal: true,
    ...snapshotVerifierHooks(s, feature, evidenceFiles, returned),
    onAuthor: (ctx, context) => {
      const current = { ...p, runId: ctx.runId };
      const facts = featureFilePath(s.root, feature, 'context/facts.md');
      const admitted = context.factsContext;
      assert(admitted, 'the dedicated author must consume the facts admission from its actual signed request');
      const originalRequest = executionRequestForInvoke(context.runDir);
      assert(originalRequest, 'research must locate its actual saved request');
      evidenceFiles.push(path.resolve(context.runDir, originalRequest.reference.path));
      for (const family of context.chain) for (const file of ['script-report.json', 'summary.json', 'phase-evidence-manifest.json'])
        evidenceFiles.push(path.join(featurePhaseReportsDir(s.root, feature, family, s.frameworkRoot), file));
      console.log('SNAPSHOT_AUTHOR_INPUT ' + JSON.stringify({ run: ctx.runId, invoke: originalRequest.request.invoke_id,
        original: originalRequest.reference, facts: admitted,
        entry_source_sha256: hash(path.resolve(__dirname, '../../../scripts/utils/capability-resolution-entry-input.ts')),
        copied_entry_sha256: hash(path.join(s.frameworkRoot, 'harness/scripts/utils/capability-resolution-entry-input.ts')) }));
      const baseline = admitted?.baseline && fs.existsSync(facts) ? fs.readFileSync(facts) : undefined;
      const disposition = resolveCompletionDisposition({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, runId: ctx.runId, chain: [...context.chain] });
      if (context.chain.includes('coding') && context.chain.includes('ut')) repairSnapshotUtProduct(s.root, feature);
      if (owners.has('spec') || disposition.completionBlocking.some(problem => problem.action === 'repair' && (problem.owner === 'spec' || problem.phase === 'spec'))) {
        if (feature === SNAPSHOT_CU_FEATURE) writeCuSpecMaterials(current); else writeSpecMaterials(current, undefined, { preserveUnchanged: true });
      }
      // Re-author the stale plan/hint through the current writer; the real gate must generate fresh native evidence.
      if (feature === SNAPSHOT_FLAT_FEATURE && context.chain.includes('testing')
        && disposition.completionBlocking.some(problem => (problem.source_phase ?? problem.phase) === 'testing'
          && (problem.action === 'repair' || problem.action === 'verify'))) writeTestPlan(current);
      if (baseline) fs.writeFileSync(facts, baseline);
      researchSnapshotFacts(s.root, facts, admitted.first_phase, admitted);
      for (const family of context.chain) if (family !== admitted.first_phase) researchSnapshotFacts(s.root, facts, family, admitted);
      const researched = parseContextExploration(fs.readFileSync(facts, 'utf8'));
      console.log('SNAPSHOT_AUTHOR_RESEARCH ' + JSON.stringify({ run: ctx.runId, sha256: hash(facts),
        declared: researched.fm.source_code_paths, ut_delta: findPhaseDeltaSection(researched.body, 'ut', true).content }));
    },
  });
  clearFrameworkConfigCache();
  for (const [subject_id, { phase, sha256 }] of returned) {
    const accepted = loadVerifierEvidenceForSubject(s.root, feature, phase, subject_id, { frameworkRoot: s.frameworkRoot });
    assert(accepted.ok, JSON.stringify(accepted));
    const publicReport = accepted.evidence.md_path_abs;
    assert.equal(hash(publicReport), sha256);
    assert([...stageVerifierHandbacks(probe.reportDir, { feature, phase, subject_id }, publicReport)]
      .some(reply => crypto.createHash('sha256').update(reply.bytes).digest('hex') === sha256), 'public report needs the actual accepted handback');
  }
  const after = assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot });
  assert.equal(hash(original), originalHash, '迁移不得改写旧 completion 原件');
  const failedPhase = [...probe.events].reverse().find(event => event.type === 'phase_verdict' && event.verdict !== 'PASS')?.phase;
  const failedReport = failedPhase ? featureFilePath(s.root, feature, `${failedPhase}/reports/script-report.json`) : '';
  const failureChecks = failedReport && fs.existsSync(failedReport)
    ? JSON.parse(fs.readFileSync(failedReport, 'utf8')).checks.filter((check: { status: string; severity: string }) => check.status === 'FAIL' || check.status === 'SKIP' && check.severity === 'BLOCKER') : [];
  if (probe.exitCode !== 0 || !after.complete) console.log('SNAPSHOT_MIGRATION_ORIGINALS ' + preserveRuntimeTestEvidence([s.root],
    'current formal migration remains incomplete', [], evidenceFiles));
  assert.equal(probe.exitCode, 0, JSON.stringify({ events: probe.events.slice(-5), checks: failureChecks }));
  assert(after.complete, JSON.stringify({ record: after.record, obligations: after.obligations.filter(o => o.status === 'uncovered') }));
  assert(after.record.state === 'ok' && after.record.run_id, '新完成必须仍可信并有 run 身份');
  const completion = JSON.parse(fs.readFileSync(featureFilePath(s.root, feature, `goal-runs/${after.record.run_id}/feature-completion.json`), 'utf8')) as FeatureCompletion;
  for (const gate of staleGates) {
    const currentReport = JSON.parse(fs.readFileSync(gate.file, 'utf8'));
    assert.equal(currentReport.run_id, after.record.run_id, `阶段报告须来自真实重核的后继：${gate.phase}`);
    assert.equal(currentReport.verdict, 'PASS', `阶段检查须实际通过：${gate.phase}`);
    assert.equal(currentReport.gate_fingerprint, gate.current, `阶段报告须使用当前发布件门禁：${gate.phase}`);
    const evidence = loadPhaseEvidenceManifest(s.root, feature, gate.phase);
    assert(evidence?.integrityOk && evidence.manifest.environment.gate_fingerprint === gate.current, `后继须有当前阶段证据：${gate.phase}`);
    const accepted = completion.phases.find(phase => phase.phase === gate.phase);
    assert(accepted?.run_id === after.record.run_id && accepted.gate_fingerprint === gate.current
      && accepted.evidence_manifest_aggregate === evidence.manifest.aggregate_sha256, `完成原件须接受同一份当前阶段证据：${gate.phase}`);
    for (const file of [gate.file, path.join(path.dirname(gate.file), 'script-report.json')]) {
      assert(evidence.manifest.outputs.some(entry => path.resolve(s.root, entry.path) === file && entry.sha256 === hash(file)),
        `阶段证据须绑定实际报告原件：${file}`);
    }
    const verified = typeof currentReport.verifier_subject_id === 'string' ? loadVerifierEvidenceForSubject(
      s.root, feature, gate.phase, currentReport.verifier_subject_id, { frameworkRoot: s.frameworkRoot }) : undefined;
    const verifier = verified?.ok && verified.evidence.verdict === 'PASS' || currentReport.verifier_closure?.mode === 'completed_with_prior_review';
    const passed = probe.events.some((start, startIndex) => {
      if (start.type !== 'harness_start' || start.phase !== gate.phase || !start.invoke_id) return false;
      const sameInvocation = (event: typeof start) => event.phase === gate.phase && event.invoke_id === start.invoke_id;
      const endIndex = probe.events.findIndex((event, index) => index > startIndex && event.type === 'harness_end' && sameInvocation(event));
      const end = probe.events[endIndex];
      // A raw PASS awaiting independent review returns 1 until the verifier evidence is accepted.
      if (!end || end.timed_out !== false || (end.exit_code !== 0 && !(end.exit_code === 1 && verifier))) return false;
      return probe.events.slice(endIndex + 1).some(event => event.type === 'phase_verdict' && sameInvocation(event)
        && event.stale_summary === false && event.verdict === 'PASS' && event.harness_exit === end.exit_code);
    });
    assert(passed, `失效的阶段门禁必须走实际阶段重核：${gate.phase} ${gate.old}`);
  }
  if (feature === SNAPSHOT_CU_FEATURE) {
    const deviceDuty = (scope: typeof successorScope | null | undefined) =>
      scope?.obligations.find(fact => fact.kind === 'device-evidence')?.applicability;
    assert.equal(deviceDuty(successorScope), 'not_applicable', 'the migrated domain CU keeps its grounded device exemption at birth');
    assert.equal(deviceDuty(loadEffectiveExecutionScope(s.root, feature, after.record.run_id, s.frameworkRoot)), 'not_applicable');
    assert(!probe.events.some(event => event.type === 'harness_start' && event.phase === 'testing'), 'migrating this domain CU must not dispatch Testing');
  }
  if (owners.has('spec')) assert(probe.invokedPhases.includes('work-unit-author'), 'the actual dedicated author must repair invalid definitions before the real checks can qualify them');
  const successorRun = after.record.run_id;
  assert.notEqual(successorRun, sourceRun, '已完成后必须用新 run 生成新 completion');
  assert(probe.events.some(event => event.type === 'supersede' && event.target_run_id === sourceRun), '须有正式承接审计');
  assert.equal(probe.events.filter(event => event.type === 'agent_invoke_start').length, probe.invokedPhases.length, '所有真实迁移调用必须保留原事件');
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
  const superset = [...prepared].find(([existing]) => features.every(feature => existing.split(',').includes(feature)));
  if (!prepared.has(key) && superset) {
    const source = await superset[1];
    if (features.every(feature => assessFeature(source.root, feature, {
      ...resolveChangeUnitExpectedExecution(source.root, feature), frameworkRoot: source.frameworkRoot,
    }).complete)) prepared.set(key, superset[1]);
  }
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
