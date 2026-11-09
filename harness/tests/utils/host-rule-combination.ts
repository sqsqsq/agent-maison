import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache } from '../../config';
import { synthesizeTestChainProfile, type RealChainProject } from './real-chain-host';
import { withProject } from '../unit/rule-convergence.unit.test';
import { runGoalRuntimeChain } from '../unit/goal-runner-testing-integrity.unit.test';
import { publishRequestedVerifier, readDeliveredVerifierRequest, readSummary, assertCurrentPhaseDutiesSatisfied, assertCurrentOwnerEvidence, preserveChainFailure } from '../unit/real-chain.unit.test';
import { blueprintAuthorContent, asRecord } from '../../scripts/utils/component-blueprint-model';
import { refreshBlueprintFingerprints } from '../../scripts/utils/design-repair-unattended';
import { createIndependentQuestioningResult, validateBlueprintQuestioning } from '../../scripts/utils/blueprint-questioning';
import { executionRequestForInvoke, observeSessionExecution } from '../../scripts/utils/session-execution-handoff';
import { parseContextExploration } from '../../scripts/utils/context-exploration';
import { findPhaseDeltaSection } from '../../scripts/utils/context-facts';
import { readVerifierMaterialOrNull, verifierMaterialFileMatchesCurrent } from '../../scripts/utils/verifier-material';
import { workUnitMayWritePath } from '../../scripts/utils/repair-responsibility';
import { sendTestControl, TEST_CASE_TIMEOUT_MS } from './runtime-test-control';
import type { WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { prepareFeatureScopeCandidate, featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { loadCanonicalChangeUnit, createChangeUnitRef } from '../../scripts/utils/change-unit-path';
import { blueprintIdentityPointers, currentBlueprintIdentity } from '../../scripts/utils/change-unit-blueprint-identity';
import { deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { partitionConstructionFiles, resolvePhasePathOwnership } from '../../scripts/utils/phase-write-boundary';
import { recomputePhaseEvidenceStaleness, loadPhaseEvidenceManifest, sha256File } from '../../scripts/utils/phase-evidence-manifest';
import { loadAuthoritativeEvents, readSupersededAncestorRuns, readExecutionActivity, type GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import { loadLineageRunEvents } from '../../scripts/utils/goal-run-creation';
import { publishFixtureVerifierEvidence } from './verifier-evidence-fixture';
import { itemFingerprintOf, readRepairDeclineOriginals, readPhaseRepairIssues, phaseIssuesForVerifierSubject } from '../../scripts/utils/repair-candidates';
import { featurePhaseReportsDir } from '../../config';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { projectGoalProgress } from '../../scripts/utils/goal-progress';
import { resolveCompletionDisposition } from '../../scripts/utils/verify-feature-completion';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { checkArkuiSingletonFlowMultiSubscriber } from '../../../profiles/hmos-app/harness/arkui-static-rules';
import type { CheckContext } from '../../scripts/utils/types';
import type { FileAnalysis } from '../../scripts/utils/ast-analyzer';

const feature = 'cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw';
const rel = 'doc/features/bc-openCard-2/open-card-flow';
const history = path.resolve(__dirname, '../fixtures/host-recovery-history/20261019');
const handoff = 'TEST_UT_HANDOFF_OBSERVED';
const resourceFiles = ['element/color.json', 'element/string.json', 'profile/route_map.json']
  .map(file => `02-Feature/WalletMain/src/main/resources/base/${file}`);

/** Draft serialization preserves recorded observation times; semantic projections deliberately omit them. */
function recordedBlueprintDraft(source: Record<string, unknown>): Record<string, unknown> {
  const draft = blueprintAuthorContent(source);
  const restore = (original: unknown, target: unknown): void => {
    if (Array.isArray(original) && Array.isArray(target)) { target.forEach((value, index) => restore(original[index], value)); return; }
    const from = asRecord(original), to = asRecord(target);
    if (!from || !to) return;
    const recorded = asRecord(from.provenance), provenance = asRecord(to.provenance);
    if (recorded && provenance && Object.prototype.hasOwnProperty.call(recorded, 'observed_at')) {
      provenance.observed_at = structuredClone(recorded.observed_at);
    }
    for (const [key, value] of Object.entries(to)) restore(from[key], value);
  };
  restore(source, draft);
  return draft;
}

/**
 * Author response to the production lint's name-only match: each named page must really own its sheet flag
 * as local state (no shared singleton). Only then use the rule's own allow marker; a real shared flow stays a finding.
 */
export function exemptLocalSheetStateMatches(root: string): string[] {
  const id = 'arkui_singleton_flow_multi_subscriber';
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['framework', 'doc', 'node_modules', '.git'].includes(entry.name) || entry.name === 'ohosTest') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.ets')) files.push(path.relative(root, file).split(path.sep).join('/'));
    }
  };
  walk(root);
  const [check] = checkArkuiSingletonFlowMultiSubscriber({ projectRoot: root, phaseRule: { structure_checks: {} } } as unknown as CheckContext,
    files.map(filePath => ({ filePath }) as FileAnalysis));
  if (check?.status !== 'FAIL') return [];
  const exempted: string[] = [];
  for (const [, name, list] of String(check.details).matchAll(/^(\w+): \d+ 个文件监听同一 Sheet 状态 \((.+)\)$/gm)) {
    for (const file of list.split(', ')) {
      const target = path.join(root, file), text = fs.readFileSync(target, 'utf8');
      assert(new RegExp(`@(?:State|Local)\\s+${name}\\s*:`).test(text) && !new RegExp(`import[^;]*\\b${name}\\b`).test(text),
        `${file}: ${name} is not page-local state; a shared sheet flow is a real finding`);
      fs.writeFileSync(target, `// arkui-lint:allow ${id} — ${name} 是本页 @State 局部状态，各页只展示自己的 Sheet，非共享 singleton Flow\n` + text);
      exempted.push(file);
    }
  }
  assert(exempted.length, 'unparsed lint finding cannot be exempted: ' + check.details);
  return exempted;
}

/** Fixture material only; the actual onAuthor boundary still owns authorization and write observation. */
export function writeUpstreamFixtureProposal(input: {root: string; featureRel: string; file: string; authority: string; id: string; fix: string; okay: boolean}): void {
  const target = path.join(input.root, input.file);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, `const diagnosticValue: ${input.okay ? 'string' : 'never'} = 'current value';\n`);
  const proposal = path.join(input.root, input.featureRel, 'coding/upstream-issues.md');
  if (input.okay) fs.rmSync(proposal, {force: true});
  else {
    fs.mkdirSync(path.dirname(proposal), {recursive: true});
    fs.writeFileSync(proposal, ['# Derived upstream counterexample', '## 问题清单',
      '| ID | 严重程度 | 分类 | 涉及文件 | 问题描述 | 修复建议 | 状态 |', '|---|---|---|---|---|---|---|',
      `| ${input.id} | MAJOR | 契约冲突 | ${input.authority} | \`${input.featureRel}/coding/reports/upstream-compile.log:1\` 与 \`${input.file}:1\` 显示当前类型冲突 | ${input.fix} | 未关闭 |`, ''].join('\n'));
  }
}

/** Preserved inputs, current test-only external providers, real runner/checkers/publication/ownership. */
export async function rc10HostRuleCombination(record: '20261019' | '20261020' = '20261019', upstream?: 'plan-repair' | 'goal-decline' | 'fact-decline' | 'design-repair' | 'design-decline'): Promise<void> {
  await withProject(async ({ root, frameworkRoot }) => {
    const project: RealChainProject = { root, frameworkRoot, harnessDir: path.join(frameworkRoot, 'harness'), feature, module: 'WalletMain', modulePath: '02-Feature/WalletMain' };
    const extraEvidence = [...resourceFiles];
    try {
    const later = record === '20261020';
    const preserved = path.resolve(history, '../20261020/20261020T093340Z-1a0796');
    const original = JSON.parse(fs.readFileSync(later ? path.join(preserved, 'manifest.json') : path.join(history, '20261019T024808Z-4131b6/manifest.json'), 'utf8'));
    const feature = original.feature;
    const rel = later ? 'doc/features/bc-openCard-2/complete-bank-card-opening' : 'doc/features/bc-openCard-2/open-card-flow';
    const unitId = later ? 'complete-bank-card-opening' : 'open-card-flow';
    const handoff = later ? 'TEST_REVIEW_HANDOFF_OBSERVED' : 'TEST_UT_HANDOFF_OBSERVED';
    const counterexample = '02-Feature/WalletMain/src/main/ets/UpstreamTypeCounterexample.ets';
    const design = upstream?.startsWith('design-');
    const authority = design ? 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml' : `${rel}/plan/plan.md`;
    project.feature = feature;
    extraEvidence.push(authority, counterexample, `${rel}/coding/reports/upstream-compile.log`, 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml');
    const upstreamId = 'UP-8A-001';
    const upstreamFix = upstream === 'goal-decline' ? '增加本次激活nfc需求' : '修正派生类型定义为 string';
    let upstreamFp = itemFingerprintOf(upstreamId, [authority], upstreamFix);
    const goalQuote = '再往下的激活nfc部分本次先不需要';
    let refusal = upstream === 'goal-decline' ? `declined: 目标明确「${goalQuote}」，本次不增加NFC`
      : `declined: 当前 \`${authority}:1\` 已有合法 string 定义；编译日志来自本阶段错误标注，按现有契约改实现即可`;
    let ownerReceived = false; let originalReceived = false;
    let handoffFactsChecked = false;
    if (later) {
      // Environment-only support comes from the earlier preserved project; incident artifacts stay byte-identical.
      fs.cpSync(path.join(root, 'doc/features/bc-openCard-2/open-card-flow'), path.join(root, rel), { recursive: true });
      for (const file of ['contracts.yaml', 'change-unit.yaml']) fs.copyFileSync(path.join(preserved, file), path.join(root, rel, file));
      fs.copyFileSync(path.join(preserved, 'facts.md'), path.join(root, rel, 'context/facts.md'));
      fs.copyFileSync(path.join(preserved, 'plan.md'), path.join(root, rel, 'plan/plan.md'));
      fs.copyFileSync(path.join(preserved, 'component-blueprint.yaml'), path.join(root, 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml'));
    }
    const acceptance = YAML.parse(fs.readFileSync(path.join(root, rel, 'acceptance.yaml'), 'utf8'));
    const contracts = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
    const remove = (relative: string): void => {
      const target = path.resolve(root, relative);
      assert(target.startsWith(root + path.sep));
      fs.rmSync(target, { recursive: true, force: true });
    };
    for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
      remove(`${rel}/${phase}/reports`); remove(`${rel}/${phase}/phase-completion-receipt.md`);
    }
    for (const file of ['goal-runs', 'execution-scope.json', 'phase-state.json']) remove(`${rel}/${file}`);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
    config.project_profile = { name: 'test-chain' };
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify(config));
    for (const layer of config.architecture.outer_layers) fs.mkdirSync(path.join(root, layer.id), { recursive: true });
    synthesizeTestChainProfile(frameworkRoot);
    // The older project snapshot omitted this environment file. This is labelled support, not a reconstructed incident original.
    const pages = path.join(root, '01-Product/Phone/src/main/resources/base/profile/main_pages.json');
    if (!fs.existsSync(pages)) { fs.mkdirSync(path.dirname(pages), { recursive: true }); fs.writeFileSync(pages, JSON.stringify({ src: ['pages/index'] })); }
    const buildProfile = path.join(root, 'build-profile.json5');
    if (upstream === 'design-repair' && !fs.existsSync(buildProfile)) {
      // The snapshot omitted its build environment. Use the existing real-chain single-product fixture shape for CLI re-entry.
      fs.writeFileSync(buildProfile, JSON.stringify({ app: { products: [{ name: 'default' }] },
        modules: contracts.modules.map((module: { name: string; package_path: string }) => ({ name: module.name, srcPath: `./${module.package_path}` })) }, null, 2) + '\n');
    }
    if (later) {
      const names = [...new Set(fs.readFileSync(path.join(preserved, 'hvigor-build.log'), 'utf8').match(/opening_[a-z0-9_]+/g) ?? [])];
      const resourcePath = path.join(root, resourceFiles[1]);
      const initial = JSON.parse(fs.readFileSync(resourcePath, 'utf8')); initial.string = (initial.string ?? []).filter((row: any) => !names.includes(row.name));
      fs.writeFileSync(resourcePath, JSON.stringify(initial, null, 2));
      // Bounded external compiler substitute: the recorded missing-key fault cannot pass until the real file is repaired.
      fs.appendFileSync(path.join(frameworkRoot, 'profiles/test-chain/harness/coding-host-rules.js'),
        '\nexports.profileCodingHost.checkCodingCompile = ctx => { const fs=require("fs"), path=require("path"); const value=JSON.parse(fs.readFileSync(path.join(ctx.projectRoot,' + JSON.stringify(resourceFiles[1]) + '),"utf8")); const missing=' + JSON.stringify(names) + '.filter(name=>!value.string.some(row=>row.name===name)); return [{id:"coding_compile",category:"structure",severity:"BLOCKER",status:missing.length?"FAIL":"PASS",description:"1a0796 recorded resource fault replay (external compiler substitute)",details:missing.length?"missing recorded resource keys: "+missing.join(","):"recorded missing keys now exist; real HAP compilation remains joint host validation"}]; };\n');
    }
    // Keep the host's real syntax extractor; only executable device/build providers are replaced in this test profile.
    fs.writeFileSync(path.join(frameworkRoot, 'profiles/test-chain/harness/component-extractor.js'),
      `module.exports = require(${JSON.stringify(path.join(frameworkRoot, 'profiles/hmos-app/harness/component-extractor.ts'))});\n`);
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Test adapter entry\n');
    fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', agent_adapter: 'codex',
      vision: { canary: { adapter: 'codex', verdict: 'tool_read', probed_at: new Date().toISOString(), probed_via: 'interactive', probe_version: 2 } } }));
    clearFrameworkConfigCache();

    const blueprintPath = path.join(root, 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml');
    if (upstream) {
      // Explicit derived counterexample; the preserved incident and ordinary resource repair remain unchanged.
      if (design) {
        const doc = YAML.parse(fs.readFileSync(blueprintPath, 'utf8'));
        const flow = resolveBlueprintTarget(doc, { kind: 'flow', view_id: 'runtime', id: 'flow-open-card' }) as any;
        flow.contracts.state_management[0].scope += `；DERIVED_COUNTEREXAMPLE_TYPE=${upstream === 'design-repair' ? 'never' : 'string'}`;
        fs.writeFileSync(blueprintPath, YAML.stringify(doc));
      } else fs.appendFileSync(path.join(root, authority), `\nDERIVED_COUNTEREXAMPLE_TYPE=${upstream === 'plan-repair' ? 'never' : 'string'}\n`);
      if (upstream !== 'goal-decline') refusal = refusal.replace(`${authority}:1`, `${authority}:${fs.readFileSync(path.join(root, authority), 'utf8').split(/\r?\n/).findIndex(line => line.includes('DERIVED_COUNTEREXAMPLE_TYPE=')) + 1}`);
      const provider = path.join(frameworkRoot, 'profiles/test-chain/harness/coding-host-rules.js');
      fs.appendFileSync(provider, '\nconst priorCompile=exports.profileCodingHost.checkCodingCompile; exports.profileCodingHost.checkCodingCompile=ctx=>{'
        + 'const fs=require("fs"),path=require("path"),ts=require("../../../harness/node_modules/typescript");'
        + 'const file=path.join(ctx.projectRoot,' + JSON.stringify(counterexample) + ');const diagnostics=fs.existsSync(file)?ts.createProgram([file],{noEmit:true,noLib:true,allowNonTsExtensions:true}).getSemanticDiagnostics().filter(d=>d.file&&path.resolve(d.file.fileName)===path.resolve(file)):[];'
        + 'const log=diagnostics.map(d=>"TS"+d.code+": "+ts.flattenDiagnosticMessageText(d.messageText," ")).join("\\n")||"current counterexample source typechecks";'
        + 'const logPath=path.join(ctx.projectRoot,' + JSON.stringify(`${rel}/coding/reports/upstream-compile.log`) + ');fs.mkdirSync(path.dirname(logPath),{recursive:true});fs.writeFileSync(logPath,log+"\\n");'
        + 'return priorCompile(ctx).map(check=>check.id==="coding_compile"&&diagnostics.length?{...check,status:"FAIL",details:log}:check);};\n');
    }
    const repairedBlueprint = YAML.parse(fs.readFileSync(blueprintPath, 'utf8'));
    if (!later) fs.copyFileSync(path.join(history, '4131b6-blueprint-rev4.yaml'), blueprintPath);
    // Only the disposable replay input receives the renamed enum; historical bytes and Q stay unchanged.
    const historical = YAML.parse(fs.readFileSync(blueprintPath, 'utf8'));
    let enumChanged = false;
    for (const document of [repairedBlueprint, historical]) for (const decision of document.decisions_and_gaps?.decisions ?? []) {
      if (decision.kind !== 'component_selection' || decision.asset_resolution === undefined) continue;
      decision.kind = 'component_asset_selection';
      if (document === historical) enumChanged = true;
    }
    if (enumChanged) {
      const questioning = JSON.stringify(historical.review_summary?.questioning);
      refreshBlueprintFingerprints(historical);
      assert.equal(JSON.stringify(historical.review_summary?.questioning), questioning, 'enum compatibility cannot re-sign historical Q');
      fs.writeFileSync(blueprintPath, YAML.stringify(historical));
    }
    const blueprint = loadCanonicalBlueprint(root, 'bc-openCard-2');
    const loaded = loadCanonicalChangeUnit(root, 'bc-openCard-2', unitId);
    // The original rev4 CU is unavailable. This controlled legacy binding is labelled, not presented as recovered history.
    for (const ref of blueprintIdentityPointers(loaded.changeUnit)) if (ref) Object.assign(ref, currentBlueprintIdentity(blueprint));
    const authoredDeliveryTargets = (loaded.changeUnit.design_refs as any[]).map(ref => structuredClone(ref.target));
    if (!later) loaded.changeUnit.design_refs = (loaded.changeUnit.design_refs as any[]).filter(ref => !String(ref.target.id).startsWith('ui_'));
    fs.writeFileSync(loaded.canonicalPath, YAML.stringify(loaded.changeUnit));
    // Support environment, before the baseline commit/freeze: the shared support pages trip a name-only lint whose basis is checked here.
    exemptLocalSheetStateMatches(root);
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework/\n');
    const git =(...args: string[]): void => { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); };
    git('init'); git('add', '-A'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Preserved host inputs for controlled replay');
    const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'feature',
      requestedResults: [original.requirement], requestedPhases: ['plan', 'coding', 'review', 'ut', 'testing'], requirement: original.requirement, overwrite: true });
    freezeFeatureExecutionScope({ projectRoot: root, feature, scope: prepared.scope, candidateFingerprint: featureScopeCandidateFingerprint(root, feature) });
    const { authorHooks } = await import('../unit/lifecycle-evolution.unit.test');
    const registerEvidence = (runDir: string, reference?: {path: string}, verifier?: {phase: string; subject_id: string}): void => {
      const files = [...extraEvidence.map(file => path.resolve(root, file)), path.join(runDir, 'goal-report.json'),
        path.join(root, rel, 'context/facts.md'), path.join(root, rel, 'coding/upstream-issues.md')];
      if (reference) files.push(path.resolve(runDir, reference.path));
      for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
        const reports = featurePhaseReportsDir(root, feature, phase, frameworkRoot);
        files.push(path.join(reports, 'summary.json'), path.join(reports, 'script-report.json'), path.join(reports, 'phase-evidence-manifest.json'));
      }
      if (verifier) {
        const reports = featurePhaseReportsDir(root, feature, verifier.phase, frameworkRoot);
        files.push(...['request', 'report', 'material'].map(kind => path.join(reports,
          `verifier.${kind}.${verifier.subject_id}.${kind === 'report' ? 'md' : 'json'}`)));
      }
      files.push(path.join(root, rel, 'plan/headless-assumptions.jsonl'));
      sendTestControl({root, evidenceFiles: files}); // Existing evidence fields only; does not arm/end a control scope.
    };
    let handedOff = false;
    let handoffBlocked: { phase: string; detail: string } | undefined;
    let resourceWrites = 0;
    const authorRequests: Array<{ invokeId: string; context: WorkUnitExecutionContext; request: NonNullable<ReturnType<typeof executionRequestForInvoke>>['request'] }> = [];
    const assertHandoffReady = assertCurrentPhaseDutiesSatisfied;
    const isClosed = (phase: string, runId: string): boolean => {
      try { assertHandoffReady(project, phase, runId); return true; } catch (error) {
        handoffBlocked = { phase, detail: error instanceof Error ? error.message : String(error) };
        console.log('HOST_HANDOFF_BLOCKED=' + JSON.stringify({ runId, ...handoffBlocked }));
        return false;
      }
    };
    const tryHandoff = (family: 'review' | 'ut', author: typeof authorRequests[number], runId: string): void => {
      console.log('HOST_HANDOFF_CHECK=' + JSON.stringify({ runId, invokeId: author.invokeId, family }));
      if (!isClosed('coding', runId) || !later && !isClosed('review', runId)) return;
      if (upstream && (!ownerReceived || upstream.includes('decline') && !originalReceived)) return;
      assertHandoffReady(project, 'coding', runId);
      // Verifier order varies; upstream evidence is a handoff precondition, so a later verifier call retries it.
      for (const owner of ['spec', 'plan']) try { assertCurrentOwnerEvidence(project, owner, runId); } catch (error) {
        handoffBlocked = { phase: owner, detail: error instanceof Error ? error.message : String(error) };
        console.log('HOST_HANDOFF_BLOCKED=' + JSON.stringify({ runId, ...handoffBlocked }));
        return;
      }
      assert(author.context.chain.includes(family), 'handoff needs a real current method duty in the actual signed request');
      if (family === 'ut') {
        const current = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
        const missing = partitionConstructionFiles(root, path.join(frameworkRoot, 'profiles/hmos-app'), current).tests.filter(file => !fs.existsSync(path.join(root, file)));
        assert(missing.length && author.request.write_boundary && missing.every(file => resolvePhasePathOwnership(author.request.write_boundary!, file).owner === 'ut'
          && workUnitMayWritePath(author.request.write_boundary!, file)), 'the actual unit must own every missing UT source; method names alone grant nothing');
      }
      handedOff = true; throw new Error(handoff);
    };
    const actualVerifier = (ctx: Parameters<typeof readDeliveredVerifierRequest>[1]): boolean => {
      const request = readDeliveredVerifierRequest(project, ctx);
      if (!request) return false;
      const compilePassed = request.phase === 'coding' && JSON.parse(fs.readFileSync(path.join(
        featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), 'script-report.json'), 'utf8')).checks
        .some((check: { id: string; status: string }) => check.id === 'coding_compile' && check.status === 'PASS');
      project.runId = ctx.runId;
      const currentRunDir = path.join(root, rel, 'goal-runs', ctx.runId);
      const currentStart = [...loadAuthoritativeEvents(path.join(currentRunDir, 'events.jsonl'))].reverse()
        .find(event => event.type === 'agent_invoke_start' && event.phase === ctx.phase);
      const currentOriginal = currentStart?.invoke_id ? executionRequestForInvoke(currentRunDir, String(currentStart.invoke_id)) : null;
      registerEvidence(currentRunDir, currentOriginal?.reference, request);
      if (upstream === 'fact-decline' && ownerReceived && (request.phase === 'plan' || request.phase === 'coding')) {
        const originals = readRepairDeclineOriginals(root, feature, ctx.runId, frameworkRoot);
        const originalDecline = originals.flatMap(value => value.entries).find(entry => entry.gate_id === 'repair_candidate:' + upstreamFp);
        if (originalDecline) {
          assert(originalDecline.decision === refusal && fs.readFileSync(path.join(root, authority), 'utf8').includes('DERIVED_COUNTEREXAMPLE_TYPE=string'),
            'factual refusal must be independently supported by the actual owner declaration and full original reason');
          const material = readVerifierMaterialOrNull(featurePhaseReportsDir(root, feature, request.phase, frameworkRoot), request.subject_id);
          const ledger = originals.find(value => value.entries.includes(originalDecline))!;
          for (const file of [authority, ledger.path]) assert(material?.files.some(entry => entry.path === file)
            && verifierMaterialFileMatchesCurrent({ projectRoot: root, feature, material: material!, file }), 'the factual-decline decision must bind its actual evidence: ' + file);
          const responses: Array<{issue: string; verdict: 'confirmed' | 'refuted'; evidence: string}> = [{
            issue: 'repair_candidate:' + upstreamFp, verdict: 'confirmed',
            evidence: [authority, ledger.path, refusal.slice('declined: '.length)].join(' | '),
          }];
          if (request.phase === 'coding') {
            const current = phaseIssuesForVerifierSubject(root, feature, 'coding', request.subject_id, frameworkRoot, undefined, ctx.runId);
            const originalIssue = current?.rows.find(row => row.id === upstreamId);
            const source = fs.readFileSync(path.join(root, counterexample), 'utf8');
            const logFile = path.join(root, rel, 'coding/reports/upstream-compile.log');
            const log = fs.readFileSync(logFile, 'utf8');
            for (const file of [counterexample, authority, ...(originalIssue ? [path.relative(root, logFile).split(path.sep).join('/')] : [])]) assert(material?.files.some(entry => entry.path === file)
              && verifierMaterialFileMatchesCurrent({projectRoot: root, feature, material: material!, file}), 'the current response must bind the actual source/authority/typecheck: ' + file);
            if (originalIssue) {
              assert(originalIssue.files.includes(authority) && /diagnosticValue:\s*never/.test(source) && /TS2322/.test(log),
                'refuting the upstream attribution must retain the real implementation type error and its current authority target');
              responses.unshift({issue: upstreamId, verdict: 'refuted', evidence: [authority, ledger.path, counterexample,
                path.relative(root, logFile), originalIssue.summary, refusal.slice('declined: '.length), log,
                '实际责任声明已经要求 string；反证拒修成立，当前 never 实现仍须由原 coding 作者修复。'].join(' | ')});
            } else {
              assert(/diagnosticValue:\s*string/.test(source) && /current counterexample source typechecks/.test(log) && ownerReceived && originalReceived,
                'a cleared upstream proposal still requires actual owner feedback and the real successful typecheck');
              assert(compilePassed,
                'the current formal compile must also pass after clearing the proposal');
            }
          }
          publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: featurePhaseReportsDir(root, feature, request.phase, frameworkRoot),
            feature, phase: request.phase, subjectId: request.subject_id, skipSummaryPatch: true,
            reportText: '\x60\x60\x60issue-verification\n' + YAML.stringify(responses) + '\x60\x60\x60\n' });
          return true;
        }
      }
      if (upstream && request.phase === 'coding') {
        const issues = phaseIssuesForVerifierSubject(root, feature, 'coding', request.subject_id, frameworkRoot, undefined, ctx.runId);
        const issue = issues?.rows.find(row => row.id === upstreamId);
        // Resource diagnostics can precede this scenario's coding writer; they are not this upstream finding.
        if (!issue && !ownerReceived) return publishRequestedVerifier(project, ctx);
        const source = fs.readFileSync(path.join(root, counterexample), 'utf8');
        const logFile = path.join(root, rel, 'coding/reports/upstream-compile.log');
        const log = fs.readFileSync(logFile, 'utf8');
        const ownerText = fs.readFileSync(path.join(root, authority), 'utf8');
        const repaired = ownerText.includes('DERIVED_COUNTEREXAMPLE_TYPE=string');
        const typechecks = /diagnosticValue:\s*string/.test(source) && /current counterexample source typechecks/.test(log);
        let verdict: 'confirmed' | 'refuted';
        let evidence: string;
        if (issue) {
          assert(/diagnosticValue:\s*never/.test(source) && /TS2322/.test(log), 'independent diagnosis must read the real current type error');
          assert(issue.files.includes(authority), 'the verified proposal must name the actual responsibility artifact');
          if (upstream === 'goal-decline') assert(original.requirement.includes(goalQuote), 'the original explicit NFC exclusion must remain visible');
          verdict = 'confirmed';
          evidence = [authority, counterexample, path.relative(root, logFile), issue.summary, log,
            '当前编译类型矛盾确实存在；建议不是扩大目标的授权，责任单元仍须对原目标和当前声明作真实判断。'].join(' | ');
        } else {
          assert(typechecks && ownerReceived && (upstream.endsWith('repair') ? repaired : originalReceived),
            'a cleared proposal requires actual owner handling and real current compile/source evidence');
          assert(compilePassed,
            'the current formal compile must also pass after clearing the proposal');
          verdict = 'refuted';
          evidence = [authority, counterexample, '当前正式 coding_compile 已通过；原生类型检查日志已实测通过',
            upstream.includes('decline') ? refusal : '已读取实际修复后的责任产物；当前实现按真实 string 约束复验。'].join(' | ');
        }
        const material = readVerifierMaterialOrNull(featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), request.subject_id);
        for (const file of [counterexample, authority, ...(issue ? [path.relative(root, logFile).replace(/\\/g, '/')] : [])]) {
          assert(material?.files.some(entry => entry.path === file) && verifierMaterialFileMatchesCurrent({ projectRoot: root, feature, material: material!, file }),
            'the independent result must bind the actual source/authority/diagnostic it judges: ' + file);
        }
        publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: featurePhaseReportsDir(root, feature, 'coding', frameworkRoot),
          feature, phase: 'coding', subjectId: request.subject_id, skipSummaryPatch: true,
          reportText: '\x60\x60\x60issue-verification\n' + YAML.stringify([{ issue: upstreamId, verdict, evidence }]) + '\x60\x60\x60\n' });
        return true;
      }
      return publishRequestedVerifier(project, ctx);
    };
    const designReply = (ctx: Parameters<typeof readDeliveredVerifierRequest>[1]) => {
      assert(ctx.phase.startsWith('design-repair-'), 'unexpected model purpose: ' + ctx.phase);
      const draft = /草稿文件[^：\n]*：(.+)$/m.exec(ctx.prompt)?.[1]?.trim(); assert(draft);
      const runDir = path.join(root, rel, 'goal-runs', ctx.runId);
      const started = [...loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'))].reverse()
        .find(event => event.type === 'agent_invoke_start' && event.phase === ctx.phase);
      const issued = started?.invoke_id ? executionRequestForInvoke(runDir, started.invoke_id) : null;
      registerEvidence(runDir, issued?.reference);
      const phaseDir = issued ? path.dirname(path.resolve(runDir, issued.reference.path)) : path.join(runDir, 'phases', ctx.phase, started?.invoke_id ?? '');
      const designFiles = [draft!, ...['blueprint-before.yaml', 'draft-output.yaml', 'design-result.json', 'questioning-output.json'].map(name => path.join(phaseDir, name))];
      if (issued) designFiles.push(...['result', 'execution-report'].map(name => path.join(phaseDir, `${name}-e${issued.request.context.owner.epoch}.json`)));
      try {
        designFiles.push(...fs.readdirSync(path.dirname(draft!)).filter(name => /\.(?:json|ya?ml)$/.test(name)).map(name => path.join(path.dirname(draft!), name)));
      } catch { /* Evidence inventory adds no new draft-availability gate. */ }
      sendTestControl({root, evidenceFiles: designFiles});
      const before = fs.readFileSync(draft!), doc = YAML.parse(before.toString('utf8'));
      if (ctx.phase === 'design-repair-author') {
        if (design) {
          assert(ctx.prompt.includes(upstreamId), 'the actual design owner must receive the verified item');
          const delivered = /repair_candidate:([a-f0-9]{64})/.exec(ctx.prompt); assert(delivered);
          upstreamFp = delivered![1]; ownerReceived = true;
          if (upstream === 'design-decline') doc.decisions_and_gaps.decisions.push({ decision_id: 'repair_candidate:' + upstreamFp, rationale: refusal });
          else {
            const flow = resolveBlueprintTarget(doc, { kind: 'flow', view_id: 'runtime', id: 'flow-open-card' }) as any;
            flow.contracts.state_management[0].scope = flow.contracts.state_management[0].scope.replace('DERIVED_COUNTEREXAMPLE_TYPE=never', 'DERIVED_COUNTEREXAMPLE_TYPE=string');
          }
        } else {
          const authored = recordedBlueprintDraft(repairedBlueprint), machineReview = doc.review_summary;
          const authoredReview = asRecord(authored.review_summary);
          Object.assign(doc, authored);
          if (authoredReview) doc.review_summary = { ...machineReview, ...authoredReview };
        }
        if (!later) {
          if (!authoredDeliveryTargets.some(target => target.kind === 'decision' && target.id === 'full-card-number')) {
            assert(ctx.prompt.includes('decision:full-card-number'), 'the actual design author must receive the missing ownership address');
            const target = { kind: 'decision' as const, id: 'full-card-number' };
            assert(resolveBlueprintTarget(doc, target), 'the author claims the preserved full-card-number decision');
            authoredDeliveryTargets.push(target);
          }
          const candidateFile = path.join(path.dirname(draft!), 'change-unit.yaml');
          const candidate = YAML.parse(fs.readFileSync(candidateFile, 'utf8'));
          candidate.design_refs = authoredDeliveryTargets.map(target => ({ ...candidate.component_blueprint_ref, target }));
          fs.writeFileSync(candidateFile, YAML.stringify(candidate));
        }
        fs.writeFileSync(draft!, YAML.stringify(doc));
        return;
      }
      assert(ctx.phase === 'design-repair-questioning', 'only the independent questioning result may be returned here');
      if (!later) {
        const candidate = YAML.parse(fs.readFileSync(path.join(path.dirname(draft!), 'change-unit.yaml'), 'utf8'));
        assert.deepStrictEqual(candidate.design_refs.map((ref: any) => ref.target), authoredDeliveryTargets,
          'independent Q must verify the actual author selection before publication');
      }
      const expected = structuredClone(repairedBlueprint);
      if (design && upstream === 'design-repair') {
        const flow = resolveBlueprintTarget(expected, { kind: 'flow', view_id: 'runtime', id: 'flow-open-card' }) as any;
        flow.contracts.state_management[0].scope = flow.contracts.state_management[0].scope.replace('DERIVED_COUNTEREXAMPLE_TYPE=never', 'DERIVED_COUNTEREXAMPLE_TYPE=string');
      }
      if (upstream === 'design-decline') expected.decisions_and_gaps.decisions.push({ decision_id: 'repair_candidate:' + upstreamFp, rationale: refusal });
      assert.deepStrictEqual(blueprintAuthorContent(doc), blueprintAuthorContent(expected), 'independent Q must inspect the actual repaired/declined business content');
      const template = structuredClone(repairedBlueprint.review_summary.questioning);
      assert(template?.items?.length, 'preserved independent question scopes must be available');
      const relativeDraft = path.relative(root, draft!).replace(/\\/g, '/');
      const questioning = createIndependentQuestioningResult({ providerId: ctx.phase, authoredBy: String(doc.review_summary.authored_by),
        previous: doc.review_summary.questioning, items: template.items.map((item: any) => ({ ...item,
          answer: String(item.answer ?? '') + '；已逐项读取当前草稿业务字段：' + relativeDraft + (upstream === 'design-decline' ? '；' + refusal : ''),
          evidence_refs: [...new Set([...(item.evidence_refs ?? []), relativeDraft])] })) });
      assert.deepStrictEqual(validateBlueprintQuestioning({ ...doc, review_summary: { ...doc.review_summary, questioning } }), [], 'actual current Q coverage must remain valid');
      assert(fs.readFileSync(draft!).equals(before), 'questioning must not edit its read-only draft');
      const output = JSON.stringify(questioning);
      return { stdout: output, details: output };
    };
    const result = await runGoalRuntimeChain(root, {
      testControl: { expectedInterruption: handoff,
        // r5 reached a new bound material/Q publication before 45 minutes; keep cleanup inside the existing case budget.
        ...((!later && !upstream) || upstream === 'fact-decline' || upstream === 'design-repair'
          ? { timeoutMs: TEST_CASE_TIMEOUT_MS - 5 * 60_000 } : {}) },
      frameworkRoot, featureId: feature, realHarness: true, adapter: 'codex', freshRequirement: original.requirement,
      ...(upstream ? { viaRuntimeClass: true, noAutoForce: true } : {}),
      freshStartPhase: prepared.scope.phase_chain[0] as 'spec', freshEndPhase: prepared.scope.phase_chain.at(-1),
      onReview: ctx => {
        project.runId = ctx.runId;
        const latest = authorRequests.at(-1);
        if (later) { assert(latest); tryHandoff('review', latest, ctx.runId); return; }
        const current = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
        const files = partitionConstructionFiles(root, path.join(frameworkRoot, 'profiles/hmos-app'), current).implementation;
        const report = ['# 审查报告', '', '> **模块标识**: WalletMain', '> **审查日期**: 2026-10-19', '> **审查版本**: 1.0', '> **保证等级**: standard', '',
          '## 1. 审查范围', '', ...files.map(file => `- ${file}`), '', '## 2. 审查维度', '', '| 维度 | 结论 |', '|---|---|', '| 契约一致性 | 通过 |', '| 视觉保真 | 通过 |', '',
          '## 3. 问题清单', '', '| 编号 | 分类 | 严重程度 | 问题描述 | 涉及文件 | 修复建议 |', '|---|---|---|---|---|---|', '', '本轮无问题。', '',
          '## 4. 问题统计', '', '| 严重程度 | 数量 |', '|---|---|', '| BLOCKER | 0 |', '| MAJOR | 0 |', '| MINOR | 0 |', '| INFO | 0 |', '',
          '## 5. 修复建议', '', '无。', '', '## 6. 结论', '', '**审查结论**: 通过', ''].join('\n');
        fs.mkdirSync(path.join(root, rel, 'review'), { recursive: true });
        fs.writeFileSync(path.join(root, rel, 'review/review-report.md'), report);
      },
      onOutOfChain: ctx => {
        // P3 verifies after the author's handback, so the next verifier call is the first point where earlier closures are settled.
        const latest = authorRequests.at(-1);
        const verifierCall = !!latest && ctx.phase.endsWith('-verifier-format-repair');
        if (verifierCall) tryHandoff(later ? 'review' : 'ut', latest!, ctx.runId);
        if (!actualVerifier(ctx)) return designReply(ctx);
        // The last verifier settles its own owner evidence only after publishing; retry the handoff then.
        if (verifierCall) tryHandoff(later ? 'review' : 'ut', latest!, ctx.runId);
        return undefined;
      },
      onAuthor: (ctx, context) => {
        project.runId = ctx.runId;
        const start = [...loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'))].reverse()
          .find(event => event.type === 'agent_invoke_start' && event.phase === context.phase);
        assert(start?.invoke_id, 'the host writer needs its actual signed author invocation');
        const issued = executionRequestForInvoke(context.runDir, start!.invoke_id!);
        assert(issued && issued.request.context.phase === 'work-unit-author' && issued.request.context.attemptId === context.attemptId
          && issued.request.context.owner.owner_id === context.owner.owner_id && issued.request.context.owner.epoch === context.owner.epoch,
          'the host fixture must use the actual unit request, never a synthetic legacy actor');
        assert(!observeSessionExecution(context.runDir, issued!).settled, 'an outstanding actual request must not be mistaken for a completed owner');
        authorRequests.push({ invokeId: issued!.request.invoke_id, context, request: issued!.request });
        registerEvidence(context.runDir, issued!.reference);
        // Read this actual assignment before any writer can legitimately change its bound material.
        const assignedUpstreamRepair = upstream && !design ? resolveCompletionDisposition({ projectRoot: root, frameworkRoot, feature,
          runId: ctx.runId, chain: [...context.chain] }).completionBlocking.find(problem =>
          problem.id === 'open_finding:' + upstreamId && problem.source_phase === 'coding'
          && problem.action === 'repair' && problem.owner === 'plan' && problem.files?.includes(authority)
          && typeof problem.item_fingerprint === 'string') : undefined;
        if (assignedUpstreamRepair) assert(context.instruction?.includes(assignedUpstreamRepair.item_fingerprint!)
          && ctx.prompt.includes(assignedUpstreamRepair.item_fingerprint!), 'the signed author request must deliver this current confirmed repair fingerprint');
        const admitted = context.factsContext; assert(admitted, 'host research needs the real signed facts admission');
        if (!admitted!.baseline) {
          const file = path.join(root, rel, 'context/facts.md');
          const parsed = parseContextExploration(fs.readFileSync(file, 'utf8')); assert(!parsed.error);
          const declared = [...new Set([...(Array.isArray(parsed.fm.source_code_paths) ? parsed.fm.source_code_paths : []), ...admitted!.source_paths, ...resourceFiles])]
            .filter((source): source is string => typeof source === 'string' && fs.existsSync(path.resolve(root, source)) && fs.statSync(path.resolve(root, source)).isFile());
          for (const source of declared) { const file = path.resolve(root, source); assert(file.startsWith(root + path.sep)); fs.readFileSync(file); }
          const keyInputs = Array.isArray(parsed.fm.key_inputs_read) ? parsed.fm.key_inputs_read.filter(source => typeof source === 'string' && fs.existsSync(path.resolve(root, source))) : parsed.fm.key_inputs_read;
          fs.writeFileSync(file, '---\n' + YAML.stringify({ ...parsed.fm, source_code_paths: declared, key_inputs_read: keyInputs }) + '---\n' + parsed.body, 'utf8');
        }
        const recordFacts = (family: string): void => {
          const files = upstream && fs.existsSync(path.join(root, counterexample)) ? [counterexample] : [];
          for (const file of files) fs.readFileSync(path.join(root, file));
          if (files.length) {
            const file = path.join(root, rel, 'context/facts.md');
            const rows = files.map(source => '| ' + source + ' | 已读当前类型声明与真实诊断 | 对照当前责任产物复验 |');
            const parsed = parseContextExploration(fs.readFileSync(file, 'utf8'));
            const recorded = new Set(findPhaseDeltaSection(parsed.body, family, true).content.split(/\r?\n/).map(line => line.trim()));
            const additional = rows.filter(row => !recorded.has(row));
            if (additional.length) fs.appendFileSync(file, '\n## phase_delta: ' + family
              + '\n| 路径 | 事实 | 对本阶段影响 |\n|---|---|---|\n' + additional.join('\n') + '\n');
          }
        };
        const attemptHandoff = (family: 'review' | 'ut'): void => tryHandoff(family, authorRequests.at(-1)!, ctx.runId);
        const canonicalBefore = fs.readFileSync(blueprintPath);
        const hooks = authorHooks(project, {
          spec: () => {
        project.runId = ctx.runId;
        const projected = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'acceptance');
        if (projected.state === 'resolved') {
          const base = projected.value as any;
          fs.writeFileSync(path.join(root, rel, 'acceptance.yaml'), YAML.stringify({ ...structuredClone(acceptance), ...base,
            criteria: base.criteria.map((criterion: any) => {
              const merged = { ...acceptance.criteria.find((row: any) => row.id === criterion.id), ...criterion };
              if (later && merged.ut_layer === 'unit') delete merged.device_focus;
              return merged;
            }) }));
        }
        if (later) {
          const specFile = path.join(root, rel, 'spec/spec.md');
          // The bounded author relocates the support document's existing handoff references, not the recorded incident artifacts.
          fs.writeFileSync(specFile, fs.readFileSync(specFile, 'utf8').split('doc/features/bc-openCard-2/open-card-flow/').join(rel + '/'));
        }
        recordFacts('spec');
          },
          plan: () => {
        project.runId = ctx.runId;
        if (assignedUpstreamRepair) {
          const issue = readPhaseRepairIssues(root, feature, 'coding', { frameworkRoot, runId: ctx.runId })?.rows.find(row => row.id === upstreamId);
          assert(issue && issue.files.includes(authority), 'the current repair must retain this proposal and its actual authority target');
          upstreamFp = assignedUpstreamRepair.item_fingerprint!;
          ownerReceived = true;
          if (upstream === 'plan-repair') fs.writeFileSync(path.join(root, authority), fs.readFileSync(path.join(root, authority), 'utf8').replace('DERIVED_COUNTEREXAMPLE_TYPE=never', 'DERIVED_COUNTEREXAMPLE_TYPE=string'));
          else if (!design) {
            const ledger = path.join(root, rel, 'plan/headless-assumptions.jsonl');
            const prior = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
            if (!prior.some(row => row.run_id === ctx.runId && row.gate_id === 'repair_candidate:' + upstreamFp && row.decision === refusal)) {
              fs.appendFileSync(ledger, JSON.stringify({ decision_id: 'decline-' + context.attemptId, run_id: ctx.runId, phase: 'plan', gate_id: 'repair_candidate:' + upstreamFp,
                class: upstream === 'goal-decline' ? 'goal_conflict' : 'factual_error', decision: refusal, must_review: true, source: 'agent', ts: new Date().toISOString() }) + '\n');
            }
          }
        }
        const projected = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'contracts');
        // An unavailable design belongs to its actual authority owner; do not invent its projection or abort before the real tool can route it.
        if (projected.state !== 'resolved') { recordFacts('plan'); return; }
        const value = later ? { ...(projected.value as any), ...structuredClone(contracts), change_unit: structuredClone(contracts.change_unit) }
          : { ...structuredClone(contracts), ...(projected.value as any), change_unit: structuredClone(contracts.change_unit) };
        if (design) {
          value.source = (projected.value as any).source;
          value.state_management = structuredClone((projected.value as any).state_management);
        }
        const current = loadCanonicalChangeUnit(root, 'bc-openCard-2', unitId);
        value.change_unit.change_unit_ref = createChangeUnitRef(current);
        value.change_unit.design_ref_mappings = value.change_unit.design_ref_mappings.map((mapping: any) => ({ ...mapping,
          design_ref: (current.changeUnit.design_refs as any[]).find(ref => ref.target.kind === mapping.design_ref.target.kind && ref.target.id === mapping.design_ref.target.id && ref.target.view_id === mapping.design_ref.target.view_id) ?? mapping.design_ref }));
        const fullCard = !later && (current.changeUnit.design_refs as any[]).find(ref => ref.target.kind === 'decision' && ref.target.id === 'full-card-number');
        if (fullCard && !value.change_unit.design_ref_mappings.some((mapping: any) => mapping.design_ref.target.id === 'full-card-number')) {
          const mask = '02-Feature/WalletMain/src/main/ets/domain/service/BankCardMaskService.ets';
          const repository = '02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets';
          assert(fs.readFileSync(path.join(root, mask), 'utf8').includes('maskCardNumber'));
          assert(fs.readFileSync(path.join(root, repository), 'utf8').includes('full_card_number'));
          value.change_unit.design_ref_mappings.push({ design_ref: structuredClone(fullCard),
            implementation_refs: [mask + '#BankCardMaskService', repository + '#BankCardRepository'],
            verification_refs: ['planned:02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_2_ut.test.ets', rel + '/acceptance.yaml'] });
        }
        if (design) for (const state of value.state_management ?? []) if (state.design_ref) {
          Object.assign(state.design_ref, currentBlueprintIdentity(loadCanonicalBlueprint(root, 'bc-openCard-2')));
        }
        // First expose the actual legacy omission, then let the responsible author supplement real consumer symbols.
        if (!later && /integration_scope_consistency|entry_symbol/.test(ctx.prompt)) value.integration_points = value.integration_points.map((point: any) => ({ ...point,
          entry_symbol: point.consumer_module === 'Phone' ? 'buildBankCardSelectionPage' : point.provider_module === 'AccountManager' ? 'AccountService' : 'BankRepository' }));
        fs.writeFileSync(path.join(root, rel, 'contracts.yaml'), YAML.stringify(value));
        if (projected.artifacts?.['use-cases@1']) fs.writeFileSync(path.join(root, rel, 'use-cases.yaml'), YAML.stringify(projected.artifacts['use-cases@1']));
        recordFacts('plan');

          },
          coding: () => {
        project.runId = ctx.runId;
        if (later) {
          const resource = resourceFiles[1];
          assert(!contracts.files.includes(resource), 'incident resource must remain absent from the prediction');
          const value = JSON.parse(fs.readFileSync(path.join(root, resource), 'utf8'));
          const log = fs.readFileSync(path.join(preserved, 'hvigor-build.log'), 'utf8');
          const names = [...new Set(log.match(/opening_[a-z0-9_]+/g) ?? [])]; assert(names.length > 0);
          value.string ??= []; for (const name of names) if (!value.string.some((row: any) => row.name === name)) value.string.push({ name, value: name });
          fs.writeFileSync(path.join(root, resource), JSON.stringify(value, null, 2));
        } else if (resourceWrites === 0) for (const resource of resourceFiles) fs.appendFileSync(path.join(root, resource), '\n');
        resourceWrites++;
        if (upstream) {
          const repaired = fs.readFileSync(path.join(root, authority), 'utf8').includes('DERIVED_COUNTEREXAMPLE_TYPE=string');
          const declined = ctx.prompt.includes('本阶段错误标注') || ctx.prompt.includes(goalQuote) && ctx.prompt.includes('本次不增加NFC');
          originalReceived ||= declined;
          const okay = upstream.endsWith('repair') ? repaired : declined;
          writeUpstreamFixtureProposal({root, featureRel: rel, file: counterexample, authority, id: upstreamId, fix: upstreamFix, okay});
          recordFacts('coding');
        } else recordFacts('coding');

          },
          review: () => { /* The actual independent review invocation owns its report. */ },
          ut: () => attemptHandoff('ut'),
        });
        try { hooks.onAuthor(ctx, context); }
        finally {
          project.runId = ctx.runId;
          assert(fs.readFileSync(blueprintPath).equals(canonicalBefore), 'a unit author must not publish or mutate shared canonical design');
        }
      },
    });
    assert(handedOff, JSON.stringify({ phases: result.invokedPhases, end: result.events.filter(event => event.type === 'run_end').at(-1), handoffBlocked }));
    const lineage = loadLineageRunEvents(root, feature, project.runId!) as Array<GoalRunEvent & { stage?: string }>;
    const actualWrites = lineage.filter(event => event.type === 'phase_write_observed' && event.phase === 'work-unit-author')
      .flatMap(event => (event as { owned?: Array<{ path: string; owner?: string; pre_sha256?: string | null; post_sha256?: string | null }> }).owned ?? []);
    if (later || upstream === 'plan-repair') {
      const observer = ['coding', 'plan', 'spec'].flatMap(phase => {
        const loaded = loadPhaseEvidenceManifest(root, feature, phase);
        return loaded?.integrityOk && recomputePhaseEvidenceStaleness(root, feature, [phase], { frameworkRoot, runId: project.runId })[0]?.verdict === 'fresh'
          ? [{ phase, loaded }] : [];
      }).find(row => row.loaded.manifest.inputs.some(entry => entry.path === resourceFiles[1]));
      assert(observer, 'the resource needs a real machine input observation, not a vacuous freshness assertion');
      assert(actualWrites.some(row => row.path === resourceFiles[1] && row.owner === 'coding' && row.pre_sha256 !== row.post_sha256
        && row.post_sha256 === sha256File(path.join(root, row.path))), 'unpredicted resource changes need actual coding-owned pre/post bytes');
      const input = observer!.loaded.manifest.inputs.find(entry => entry.path === resourceFiles[1])!;
      const unowned = observer!.loaded.manifest.inputs.find(entry => entry.exists && entry.sha256 !== null && entry.path.endsWith('.ets')
        && !actualWrites.some(write => write.path === entry.path) && entry.sha256 === sha256File(path.join(root, entry.path)));
      assert(unowned, 'the unchanged, unowned source negative needs an actual observed input');
      const subject = readSummary(project, observer!.phase)?.verifier_subject_id;
      const material = subject ? readVerifierMaterialOrNull(featurePhaseReportsDir(root, feature, observer!.phase, frameworkRoot), subject) : null;
      for (const entry of [input, unowned!]) {
        const file = path.join(root, entry.path), bytes = fs.readFileSync(file);
        const materialConsumes = material?.files.some(row => row.path === entry.path) === true;
        assert.equal(recomputePhaseEvidenceStaleness(root, feature, [observer!.phase], { frameworkRoot, runId: project.runId })[0].verdict, 'fresh', 'the byte-drift negative needs a genuinely current consumer');
        if (materialConsumes) assert(verifierMaterialFileMatchesCurrent({ projectRoot: root, feature, material: material!, file: entry.path }));
        try {
          fs.appendFileSync(file, '\n ');
          const state = recomputePhaseEvidenceStaleness(root, feature, [observer!.phase], { frameworkRoot, runId: project.runId })[0];
          assert(state.verdict === 'stale' && state.changed_paths.includes(entry.path), 'an external write after the actual author handback must invalidate its real consumer');
          if (materialConsumes) assert(!verifierMaterialFileMatchesCurrent({ projectRoot: root, feature, material: material!, file: entry.path }), 'actual independent material cannot bless unobserved changed bytes');
        } finally { fs.writeFileSync(file, bytes); }
        if (materialConsumes) assert(verifierMaterialFileMatchesCurrent({ projectRoot: root, feature, material: material!, file: entry.path }));
      }
      assert.equal(recomputePhaseEvidenceStaleness(root, feature, [observer!.phase], { frameworkRoot, runId: project.runId })[0].verdict, 'fresh');
      const currentRequest = authorRequests.at(-1)!;
      assert(currentRequest?.context.factsContext, 'handoff needs an original signed facts context');
      assert.equal(executionRequestForInvoke(currentRequest.context.runDir, 'self-check-label'), null, 'a free label cannot borrow the actual request');
      const firstBaseline = authorRequests.find(row => row.context.runId === currentRequest.context.runId && row.context.factsContext?.baseline)?.context.factsContext?.baseline;
      if (upstream === 'plan-repair') assert(firstBaseline, 'the baseline-preservation negative needs an actual admitted baseline');
      if (firstBaseline) assert(authorRequests.filter(row => row.context.runId === currentRequest.context.runId && row.context.factsContext?.baseline)
        .every(row => row.context.factsContext!.baseline!.fingerprint === firstBaseline.fingerprint
          && row.context.factsContext!.baseline!.established_by === firstBaseline.established_by), 'the actual first admitted baseline must survive method repair');
      handoffFactsChecked = true;
    }
    if (upstream) {
      const events = loadLineageRunEvents(root, feature, project.runId!) as Array<GoalRunEvent & { stage?: string; failed_step?: string }>;
      if (upstream === 'design-repair') {
        const manifestFile = path.join(root, rel, 'goal-runs', project.runId!, 'manifest.json');
        const currentManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        const ancestors = readSupersededAncestorRuns({ projectRoot: root, featuresDir: 'doc/features', feature, currentEvents: result.events as GoalRunEvent[] });
        assert(ancestors.length, 'the CLI must let the normal continuation decision replace stale birth bindings');
        if (ancestors.length) {
          const originalManifest = JSON.parse(fs.readFileSync(path.join(root, rel, 'goal-runs', ancestors[0].run_id, 'manifest.json'), 'utf8'));
          assert.equal(currentManifest.requirement, originalManifest.requirement, 'automatic continuation must not create a requirement increment');
          assert.equal(currentManifest.budget, undefined, 'new continuation manifest cannot create a quota');
          const own = readExecutionActivity(result.events as GoalRunEvent[]).calls;
          const cumulative = readExecutionActivity([...ancestors.flatMap(run => run.events), ...result.events] as GoalRunEvent[]).calls;
          assert(cumulative > own, 'existing lineage reducer must include earlier design/phase calls');
          // The intentional review handoff throws before the next disk snapshot; read that same event boundary live.
          const progress = projectGoalProgress({ projectRoot: root, manifest: currentManifest, events: result.events as GoalRunEvent[],
            frameworkRoot, workflow: resolveWorkflowSpec(root, { frameworkRoot }), featuresDir: 'doc/features' });
          assert.equal(progress.activity!.calls, cumulative);
        }
        const publishedAt = lineage.map(event => event.type === 'design_authority_repair' && event.stage === 'published').lastIndexOf(true);
        assert(publishedAt >= 0 && !lineage.slice(publishedAt + 1).some(event => event.type === 'agent_invoke_start' && event.phase?.startsWith('design-repair-')),
          'automatic continuation must not redispatch the completed actual owner repair');
      }
      assert(ownerReceived, 'verified proposal never reached its actual owner');
      if (upstream === 'plan-repair') assert(handoffFactsChecked, 'real handoff must exercise the original baseline and rejection counterexamples');
      assert(events.some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'FAIL'), 'diagnosis washed away the original compile FAIL');
      assertHandoffReady(project, 'coding');
      if (upstream.includes('decline')) assert(originalReceived, 'original stage never received the refusal reason');
      if (design) assert(events.some(event => event.type === 'design_authority_repair'
        && (upstream === 'design-decline' ? event.stage === 'failed' && event.failed_step === 'declined' : event.stage === 'published')));
      else {
        assert(authorRequests.some(row => row.context.instruction?.includes(upstreamId) && row.context.instruction.includes(upstreamFp)),
          'the actual unit request must retain the verified original candidate identity');
        if (upstream.includes('decline')) {
          const originals = readRepairDeclineOriginals(root, feature, project.runId, frameworkRoot).flatMap(value => value.entries)
            .filter(entry => entry.gate_id === 'repair_candidate:' + upstreamFp);
          assert.equal(originals.length, 1, 'the refusal must have one actual signed request attribution, not a retired backtrack round');
          assert.equal(originals[0].decision, refusal, 'the full original refusal must be preserved');
        }
      }
      return;
    }
    if (later) {
      // This case stops at the actual review handoff, not Feature completion or a physical receipt projection.
      assertHandoffReady(project, 'coding');
      assert(!result.events.some(event => event.type === 'design_authority_repair'), 'ordinary resource repair must not request design expansion');
      const writes = actualWrites;
      assert(writes.some((row: any) => row.path === resourceFiles[1] && row.pre_sha256 !== row.post_sha256));
      assert(String(result.events.at(-1)?.error).includes(handoff)); return;
    }
    assert(result.events.some(event => event.type === 'design_authority_repair' && event.stage === 'published' && event.outcome === 'recovered'));
    assert(result.events.some(event => event.type === 'phase_verdict' && event.phase === 'plan' && event.verdict === 'FAIL' && String(event.blocker_signature).includes('integration_scope_consistency')));
    assert(authorRequests.some(row => /integration_scope_consistency|entry_symbol/.test(row.context.instruction ?? '')),
      'the actual signed author must receive the real definition failure before supplementing it');
    assertHandoffReady(project, 'coding');
    // P3 runs every check each round; before the published design reaches the author, contracts are still empty by construction.
    const publishedAt = result.events.map(event => event.type === 'design_authority_repair' && event.stage === 'published').lastIndexOf(true);
    const followUp = result.events.findIndex((event, index) => index > publishedAt && event.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
    assert(publishedAt >= 0 && followUp > publishedAt, 'the actual author must follow the published design before resource ownership is judged');
    assert(!result.events.slice(followUp).some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'FAIL'
      && /diff_within_scope|phase_write_violation|context_exploration_facts_(?:source|baseline)_stale/.test(String(event.blocker_signature))),
      'normal resource ownership must not create a source/authority regression; raw independently refuted comparison FAIL is retained');
    // P3 re-runs every check each round; the coding method must not regress the already-settled spec result.
    assert(!result.events.slice(followUp).some(event => event.type === 'phase_verdict' && event.phase === 'spec' && event.verdict === 'FAIL'),
      'the actual coding method must not regress an unrelated spec result');
    const written = actualWrites.filter(row => row.owner === 'coding');
    assert(resourceFiles.every(file => written.some((row: any) => row.path === file && row.pre_sha256 !== row.post_sha256)), '三项资源写入必须经过真实归属记录');
    assert(String(result.events.at(-1)?.error).includes(handoff), '只在 UT 交接边界结束，不伪称业务验收完成');
    } catch (error) { preserveChainFailure(project, error, extraEvidence); throw error; }
  });
}
