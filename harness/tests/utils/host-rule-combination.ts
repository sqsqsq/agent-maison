import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache } from '../../config';
import { synthesizeTestChainProfile, type RealChainProject } from './real-chain-host';
import { withProject } from '../unit/rule-convergence.unit.test';
import { runGoalRuntimeChain } from '../unit/goal-runner-testing-integrity.unit.test';
import { publishVerifier } from '../unit/real-chain.unit.test';
import { prepareFeatureScopeCandidate, featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { loadCanonicalChangeUnit, createChangeUnitRef } from '../../scripts/utils/change-unit-path';
import { blueprintIdentityPointers, currentBlueprintIdentity } from '../../scripts/utils/change-unit-blueprint-identity';
import { deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { partitionConstructionFiles } from '../../scripts/utils/phase-write-boundary';
import { recomputePhaseEvidenceStaleness, loadPhaseEvidenceManifest, createObservedSourceHashReader, sha256File } from '../../scripts/utils/phase-evidence-manifest';
import { loadAuthoritativeEvents, foldBudgetLineage, resolveResumedBudget, type GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import { loadLineageRunEvents } from '../../scripts/utils/goal-run-creation';
import type { FactsInvocationContext } from '../../scripts/utils/context-facts';
import { runGateHarness } from '../unit/real-chain-seams.unit.test';
import { publishFixtureVerifierEvidence } from './verifier-evidence-fixture';
import { itemFingerprintOf, loadRepairDeclineState, readPhaseRepairIssues } from '../../scripts/utils/repair-candidates';
import { featurePhaseReportsDir } from '../../config';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { projectGoalProgress } from '../../scripts/utils/goal-progress';
import { resolveWorkflowSpec } from '../../workflow-loader';

const feature = 'cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw';
const rel = 'doc/features/bc-openCard-2/open-card-flow';
const history = path.resolve(__dirname, '../fixtures/host-recovery-history/20261019');
const handoff = 'TEST_UT_HANDOFF_OBSERVED';
const resourceFiles = ['element/color.json', 'element/string.json', 'profile/route_map.json']
  .map(file => `02-Feature/WalletMain/src/main/resources/base/${file}`);

/** Preserved inputs, current test-only external providers, real runner/checkers/publication/ownership. */
export async function rc10HostRuleCombination(record: '20261019' | '20261020' = '20261019', upstream?: 'plan-repair' | 'goal-decline' | 'fact-decline' | 'design-repair' | 'design-decline'): Promise<void> {
  await withProject(async ({ root, frameworkRoot }) => {
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
    const upstreamId = 'UP-8A-001';
    const upstreamFix = upstream === 'goal-decline' ? '增加本次激活nfc需求' : '修正派生类型定义为 string';
    let upstreamFp = itemFingerprintOf(upstreamId, [authority], upstreamFix);
    const goalQuote = '再往下的激活nfc部分本次先不需要';
    let refusal = upstream === 'goal-decline' ? `declined: 目标明确「${goalQuote}」，本次不增加NFC`
      : `declined: 当前 \`${authority}:1\` 已有合法 string 定义；编译日志来自本阶段错误标注，按现有契约改实现即可`;
    let ownerReceived = false; let originalReceived = false;
    let handoffFactsChecked = false;
    let sourceHandoffVerified = false;
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
    const blueprint = loadCanonicalBlueprint(root, 'bc-openCard-2');
    const loaded = loadCanonicalChangeUnit(root, 'bc-openCard-2', unitId);
    // The original rev4 CU is unavailable. This controlled legacy binding is labelled, not presented as recovered history.
    for (const ref of blueprintIdentityPointers(loaded.changeUnit)) if (ref) Object.assign(ref, currentBlueprintIdentity(blueprint));
    if (!later) loaded.changeUnit.design_refs = (loaded.changeUnit.design_refs as any[]).filter(ref => !String(ref.target.id).startsWith('ui_'));
    fs.writeFileSync(loaded.canonicalPath, YAML.stringify(loaded.changeUnit));
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework/\n');
    const git = (...args: string[]): void => { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); };
    git('init'); git('add', '-A'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Preserved host inputs for controlled replay');
    const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'feature',
      requestedResults: [original.requirement], requestedPhases: ['plan', 'coding', 'review', 'ut', 'testing'], requirement: original.requirement, overwrite: true });
    freezeFeatureExecutionScope({ projectRoot: root, feature, scope: prepared.scope, candidateFingerprint: featureScopeCandidateFingerprint(root, feature) });
    const project: RealChainProject = { root, frameworkRoot, harnessDir: path.join(frameworkRoot, 'harness'), feature, module: 'WalletMain', modulePath: '02-Feature/WalletMain' };
    let handedOff = false;
    const facts = (ctx: { runId: string; phase: string }): void => {
      const file = path.join(root, rel, 'context/facts.md');
      let text = fs.readFileSync(file, 'utf8');
      const start = loadAuthoritativeEvents(path.join(root, rel, 'goal-runs', ctx.runId, 'events.jsonl')).slice().reverse()
        .find(event => event.type === 'agent_invoke_start' && event.phase === ctx.phase);
      const admitted = start?.facts_context as FactsInvocationContext | undefined;
      if (ctx.phase === 'spec') {
        const end = text.indexOf('\n---', 4);
        const header = YAML.parse(text.slice(4, end));
        header.run_id = ctx.runId; header.established_by = ctx.phase; delete header.frozen_scope_fingerprint;
        const actual = later ? [...new Set([...(header.source_code_paths ?? []), ...(admitted?.source_paths ?? []), resourceFiles[1]])] : header.source_code_paths;
        header.source_code_paths = actual.filter((source: string) => {
          const file = path.resolve(root, source); assert(file.startsWith(root + path.sep), 'fixture read escaped the disposable project');
          if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
          fs.readFileSync(file); return true;
        });
        header.key_inputs_read = header.key_inputs_read.filter((source: string) => fs.existsSync(path.resolve(root, source)));
        text = '---\n' + YAML.stringify(header) + '---\n' + text.slice(end + 5);
      } else if (ctx.phase === 'review') {
        const current = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
        const files = partitionConstructionFiles(root, path.join(frameworkRoot, 'profiles/hmos-app'), current).implementation
          .filter(file => fs.existsSync(path.join(root, file)));
        for (const file of files) fs.readFileSync(path.join(root, file));
        const delta = ['## phase_delta: review', '', '| 路径 | 事实 | 对本阶段影响 |', '|---|---|---|',
          ...files.map(file => `| ${file} | 已读取本次施工产物 | 核对实现与契约 |`), ''].join('\n');
        const section = /##\s*phase_delta:\s*review\b[\s\S]*?(?=\n##\s|$)/;
        text = section.test(text) ? text.replace(section, delta) : text + '\n' + delta;
      } else if (!text.includes(`## phase_delta: ${ctx.phase}`)) text += `\n## phase_delta: ${ctx.phase}\n本阶段按保全材料核对产物。\n`;
      if (upstream && fs.existsSync(path.join(root, counterexample))) {
        fs.readFileSync(path.join(root, counterexample), 'utf8');
        text += `\n## phase_delta: ${ctx.phase}\n\n| 路径 | 事实 | 对本阶段影响 |\n|---|---|---|\n| ${counterexample} | 已读当前类型声明与真实编译诊断 | 对照责任产物核实并复验 |\n`;
      }
      fs.writeFileSync(file, text);
    };
    const proof = (ctx: { runId: string; phase: string }): void => { project.runId = ctx.runId; publishVerifier(project, ctx.phase); };
    const result = await runGoalRuntimeChain(root, {
      frameworkRoot, featureId: feature, realHarness: true, adapter: 'codex', freshRequirement: original.requirement,
      ...(upstream ? { viaRuntimeClass: true, noAutoForce: true } : {}),
      freshStartPhase: prepared.scope.phase_chain[0] as 'spec', freshEndPhase: prepared.scope.phase_chain.at(-1),
      onSpec: ctx => {
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
        facts(ctx); proof(ctx);
      },
      onOutOfChain: ctx => {
        const draft = /草稿文件[^：\n]*：(.+)$/m.exec(ctx.prompt)?.[1]?.trim(); assert(draft);
        if (design) {
          ownerReceived ||= ctx.prompt.includes(upstreamId);
          if (ctx.phase === 'design-repair-author') {
            const delivered = /repair_candidate:([a-f0-9]{64})/.exec(ctx.prompt); assert(delivered);
            upstreamFp = delivered[1];
          }
          const doc = YAML.parse(fs.readFileSync(draft, 'utf8'));
          if (ctx.phase === 'design-repair-author') {
            if (upstream === 'design-decline') doc.decisions_and_gaps.decisions.push({ decision_id: `repair_candidate:${upstreamFp}`, rationale: refusal });
            else {
              const flow = resolveBlueprintTarget(doc, { kind: 'flow', view_id: 'runtime', id: 'flow-open-card' }) as any;
              flow.contracts.state_management[0].scope = flow.contracts.state_management[0].scope.replace('DERIVED_COUNTEREXAMPLE_TYPE=never', 'DERIVED_COUNTEREXAMPLE_TYPE=string');
            }
          } else if (upstream === 'design-decline') {
            doc.review_summary.questioning = { ...structuredClone(repairedBlueprint.review_summary.questioning), provider_id: 'design-repair-questioning' };
            for (const item of doc.review_summary.questioning.items) if (item.disposition === 'answered_with_evidence') item.answer += `；${refusal}`;
          } else doc.review_summary.questioning = { ...structuredClone(repairedBlueprint.review_summary.questioning), provider_id: 'design-repair-questioning' };
          fs.writeFileSync(draft, YAML.stringify(doc)); return;
        }
        if (ctx.phase === 'design-repair-author') fs.writeFileSync(draft, YAML.stringify(repairedBlueprint));
        else {
          const doc = YAML.parse(fs.readFileSync(draft, 'utf8'));
          doc.review_summary.questioning = { ...structuredClone(repairedBlueprint.review_summary.questioning), provider_id: 'design-repair-questioning' };
          fs.writeFileSync(draft, YAML.stringify(doc));
        }
      },
      onPlan: ctx => {
        project.runId = ctx.runId;
        const repair = !!upstream && ctx.prompt.includes(upstreamId);
        if (repair) {
          ownerReceived = true;
          const delivered = /item_fingerprint: ([a-f0-9]{64})/.exec(ctx.prompt); assert(delivered);
          upstreamFp = delivered[1];
          if (!sourceHandoffVerified) {
            const invocation = loadAuthoritativeEvents(path.join(root, rel, 'goal-runs', ctx.runId, 'events.jsonl')).slice().reverse()
              .find(event => event.type === 'agent_invoke_start' && event.phase === 'plan');
            assert.equal(invocation?.facts_context?.baseline?.established_by, 'spec', 'failed coding writes must preserve the real spec baseline for plan admission');
            const manifest = loadPhaseEvidenceManifest(root, feature, 'spec')!.manifest;
            const observed = manifest.inputs.find(entry => entry.path === resourceFiles[1])!;
            const reader = createObservedSourceHashReader(root, feature, { frameworkRoot, runId: ctx.runId });
            assert.equal(reader(observed, 'spec')?.sha256, sha256File(path.join(root, observed.path)), 'real owned resource bytes were not admitted');
            const unowned = manifest.inputs.find(entry => entry.path.endsWith('.ets') && reader(entry, 'spec') === null
              && entry.sha256 === sha256File(path.join(root, entry.path)))!;
            assert(unowned, 'unobserved-source counterexample missing');
            for (const entry of [observed, unowned]) {
              const file = path.join(root, entry.path), bytes = fs.readFileSync(file);
              try {
                fs.appendFileSync(file, '\n// external write after observation\n');
                assert.equal(reader(entry, 'spec'), null, 'unobserved/current-byte drift was accepted');
                assert.equal(recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot, runId: ctx.runId })[0].verdict, 'stale');
              } finally { fs.writeFileSync(file, bytes); }
            }
            assert.equal(recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot, runId: ctx.runId })[0].verdict, 'fresh');
            sourceHandoffVerified = true;
          }
          if (upstream === 'plan-repair') fs.writeFileSync(path.join(root, authority), fs.readFileSync(path.join(root, authority), 'utf8').replace('DERIVED_COUNTEREXAMPLE_TYPE=never', 'DERIVED_COUNTEREXAMPLE_TYPE=string'));
          else if (!design) {
            const ledger = path.join(root, rel, 'plan/headless-assumptions.jsonl');
            fs.appendFileSync(ledger, JSON.stringify({ decision_id: `decline-${ctx.attempt}`, run_id: ctx.runId, phase: 'plan', gate_id: `repair_candidate:${upstreamFp}`,
              class: upstream === 'goal-decline' ? 'goal_conflict' : 'factual_error', decision: refusal, must_review: true, source: 'agent', ts: new Date().toISOString() }) + '\n');
          }
        }
        const projected = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'contracts'); assert.equal(projected.state, 'resolved', projected.detail);
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
        if (design) for (const state of value.state_management ?? []) if (state.design_ref) {
          Object.assign(state.design_ref, currentBlueprintIdentity(loadCanonicalBlueprint(root, 'bc-openCard-2')));
        }
        // First expose the actual legacy omission, then let the responsible author supplement real consumer symbols.
        if (!later && ctx.attempt > 1) value.integration_points = value.integration_points.map((point: any) => ({ ...point,
          entry_symbol: point.consumer_module === 'Phone' ? 'buildBankCardSelectionPage' : point.provider_module === 'AccountManager' ? 'AccountService' : 'BankRepository' }));
        fs.writeFileSync(path.join(root, rel, 'contracts.yaml'), YAML.stringify(value));
        if (projected.artifacts?.['use-cases@1']) fs.writeFileSync(path.join(root, rel, 'use-cases.yaml'), YAML.stringify(projected.artifacts['use-cases@1']));
        facts(ctx); proof(ctx);
        if (repair && upstream === 'fact-decline') {
          runGateHarness(project, 'plan', undefined, ctx.goalAttemptId ?? '', {}, 'agent');
          const reportsDir = featurePhaseReportsDir(root, feature, 'plan', frameworkRoot);
          const summary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8'));
          publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature, phase: 'plan', subjectId: summary.verifier_subject_id, skipSummaryPatch: true,
            reportText: ['```issue-verification', `- issue: repair_candidate:${upstreamFp}`, '  verdict: confirmed', `  evidence: ${refusal.slice('declined: '.length)}`, '```'].join('\n') });
        }
      },
      onCoding: ctx => {
        project.runId = ctx.runId;
        if (upstream === 'plan-repair' && ownerReceived && !handoffFactsChecked) {
          assert(ctx.goalAttemptId);
          const eventsPath = path.join(root, rel, 'goal-runs', ctx.runId, 'events.jsonl');
          const bytes = fs.readFileSync(eventsPath);
          const events = String(bytes).trim().split('\n').map(line => JSON.parse(line));
          const start = events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === `coding-${ctx.goalAttemptId}`);
          assert(start > 0);
          const admitted = events[start].facts_context as FactsInvocationContext;
          const prefix = events.slice(0, start);
          const handoff = prefix.slice().reverse().find(event => event.type === 'phase_backtrack_requested' && event.from_phase === 'coding' && event.to_phase === 'plan');
          const owner = prefix.slice().reverse().find(event => event.type === 'agent_invoke_start' && event.phase === 'plan');
          assert(handoff && owner?.facts_context?.baseline);
          const put = (rows: typeof events) => fs.writeFileSync(eventsPath, rows.map(event => JSON.stringify(event)).join('\n') + '\n');
          const read = (attempt: string) => resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature,
            phase: 'coding', featuresDir: 'doc/features', goalRunId: ctx.runId, goalAttemptId: attempt });
          const denied = (attempt: string): boolean => { try { return !read(attempt).factsContext?.baseline; } catch { return true; } };
          try {
            // Re-read the actual pre-entry checkpoint; no candidate or successful verdict is synthesized.
            put(prefix);
            assert.deepStrictEqual(read(ctx.goalAttemptId).factsContext?.baseline, owner.facts_context.baseline);
            assert.deepStrictEqual(admitted.baseline, owner.facts_context.baseline);
            assert.equal(admitted.baseline?.established_by, 'spec');
            assert(denied('self-check-label'), 'a label cannot borrow the owner admission');
            put(prefix.filter(event => !(event.type === 'phase_verdict' && event.invoke_id === owner.invoke_id)));
            assert(denied(ctx.goalAttemptId), 'an unfinished owner cannot hand back its baseline');
            put(prefix.map(event => event === owner ? { ...event, facts_context: undefined } : event));
            assert(denied(ctx.goalAttemptId), 'an owner without its original invocation context cannot grant admission');
            put([...prefix, { type: 'phase_invalidated', phase: 'coding', ts: new Date().toISOString() }]);
            assert(denied(ctx.goalAttemptId), 'a later revocation cannot reuse the old handoff window');
            put(prefix);
            const resource = path.join(root, resourceFiles[1]), current = fs.readFileSync(resource);
            try { fs.appendFileSync(resource, '\n'); assert(denied(ctx.goalAttemptId), 'bytes changed after observation cannot be borrowed'); }
            finally { fs.writeFileSync(resource, current); }
            handoffFactsChecked = true;
          } finally { fs.writeFileSync(eventsPath, bytes); }
        }
        if (later) {
          const resource = resourceFiles[1];
          assert(!contracts.files.includes(resource), 'incident resource must remain absent from the prediction');
          const value = JSON.parse(fs.readFileSync(path.join(root, resource), 'utf8'));
          const log = fs.readFileSync(path.join(preserved, 'hvigor-build.log'), 'utf8');
          const names = [...new Set(log.match(/opening_[a-z0-9_]+/g) ?? [])]; assert(names.length > 0);
          value.string ??= []; for (const name of names) if (!value.string.some((row: any) => row.name === name)) value.string.push({ name, value: name });
          fs.writeFileSync(path.join(root, resource), JSON.stringify(value, null, 2));
        } else if (ctx.attempt === 1) for (const resource of resourceFiles) fs.appendFileSync(path.join(root, resource), '\n');
        if (upstream) {
          const repaired = fs.readFileSync(path.join(root, authority), 'utf8').includes('DERIVED_COUNTEREXAMPLE_TYPE=string');
          const declined = ctx.prompt.includes('本阶段错误标注') || ctx.prompt.includes(goalQuote) && ctx.prompt.includes('本次不增加NFC');
          originalReceived ||= declined;
          const okay = upstream.endsWith('repair') ? repaired : declined;
          fs.writeFileSync(path.join(root, counterexample), `const diagnosticValue: ${okay ? 'string' : 'never'} = 'current value';\n`);
          const proposal = path.join(root, rel, 'coding/upstream-issues.md');
          if (okay) fs.rmSync(proposal, { force: true });
          else fs.writeFileSync(proposal, ['# Derived upstream counterexample', '## 问题清单',
            '| ID | 严重程度 | 分类 | 涉及文件 | 问题描述 | 修复建议 | 状态 |', '|---|---|---|---|---|---|---|',
            `| ${upstreamId} | MAJOR | 契约冲突 | ${authority} | \`${rel}/coding/reports/upstream-compile.log:1\` 与 \`${counterexample}:1\` 显示当前类型冲突 | ${upstreamFix} | 未关闭 |`, ''].join('\n'));
          facts(ctx);
          const selfcheck = runGateHarness(project, 'coding', undefined, ctx.goalAttemptId ?? '', {}, 'agent');
          const reportsDir = featurePhaseReportsDir(root, feature, 'coding', frameworkRoot);
          const summary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8'));
          if (!okay) assert.equal(summary.next_action, 'run_verifier_for_repair', JSON.stringify({ summary, selfcheck }));
          publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature, phase: 'coding', subjectId: summary.verifier_subject_id, skipSummaryPatch: true,
            reportText: okay ? 'Current implementation typechecks and follows the owner reason.' : ['```issue-verification', `- issue: ${upstreamId}`, '  verdict: confirmed', `  evidence: ${path.basename(authority)} | ${readPhaseRepairIssues(root, feature, 'coding')!.rows[0].summary}`, '```'].join('\n') });
        } else { facts(ctx); proof(ctx); }
      },
      onReview: ctx => {
        if (later) {
          const options = { frameworkRoot, runId: ctx.runId };
          const observers = ['spec', 'plan'].map(phase => loadPhaseEvidenceManifest(root, feature, phase));
          assert(observers.some(value => value?.manifest.inputs.some(input => input.path === resourceFiles[1])), 'resource must have a real upstream observation, not a vacuous freshness check');
          assert(recomputePhaseEvidenceStaleness(root, feature, ['spec', 'plan'], options).every(row => row.verdict === 'fresh'), 'normal unpredicted coding output must not roll upstream back');
          const resource = path.join(root, resourceFiles[1]); const bytes = fs.readFileSync(resource);
          try {
            fs.appendFileSync(resource, '\n ');
            assert(recomputePhaseEvidenceStaleness(root, feature, ['spec', 'plan'], options).some(row => row.changed_paths.includes(resourceFiles[1])), 'an unobserved external write must remain stale');
          } finally { fs.writeFileSync(resource, bytes); }
          handedOff = true; throw new Error(handoff);
        }
        project.runId = ctx.runId; facts(ctx);
        const current = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
        const files = partitionConstructionFiles(root, path.join(frameworkRoot, 'profiles/hmos-app'), current).implementation;
        const report = ['# 审查报告', '', '> **模块标识**: WalletMain', '> **审查日期**: 2026-10-19', '> **审查版本**: 1.0', '> **保证等级**: standard', '',
          '## 1. 审查范围', '', ...files.map(file => `- ${file}`), '', '## 2. 审查维度', '', '| 维度 | 结论 |', '|---|---|', '| 契约一致性 | 通过 |', '| 视觉保真 | 通过 |', '',
          '## 3. 问题清单', '', '| 编号 | 分类 | 严重程度 | 问题描述 | 涉及文件 | 修复建议 |', '|---|---|---|---|---|---|', '', '本轮无问题。', '',
          '## 4. 问题统计', '', '| 严重程度 | 数量 |', '|---|---|', '| BLOCKER | 0 |', '| MAJOR | 0 |', '| MINOR | 0 |', '| INFO | 0 |', '',
          '## 5. 修复建议', '', '无。', '', '## 6. 结论', '', '**审查结论**: 通过', ''].join('\n');
        fs.mkdirSync(path.join(root, rel, 'review'), { recursive: true }); fs.writeFileSync(path.join(root, rel, 'review/review-report.md'), report); proof(ctx);
      },
      onUt: ctx => {
        const current = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
        const missing = partitionConstructionFiles(root, path.join(frameworkRoot, 'profiles/hmos-app'), current).tests.filter(file => !fs.existsSync(path.join(root, file)));
        assert(ctx.goalAttemptId, 'UT actor 必须收到本次签发的 attempt 身份');
        const admitted = loadAuthoritativeEvents(path.join(root, rel, 'goal-runs', ctx.runId, 'events.jsonl'))
          .slice().reverse().find(event => event.type === 'agent_invoke_start' && event.phase === 'ut' && event.invoke_id === `${ctx.phase}-${ctx.goalAttemptId}`);
        const factsContext = admitted?.facts_context as FactsInvocationContext | undefined;
        assert(missing.length && missing.every(file => factsContext?.source_owners?.[file] === 'ut'),
          '本次真实 UT 入场上下文必须拥有全部待产出的测试文件；不能用提示词是否内联文件名代替责任判定');
        assert(recomputePhaseEvidenceStaleness(root, feature, ['spec', 'plan'], { frameworkRoot, runId: ctx.runId }).every(row => row.verdict === 'fresh'), '正常资源写入不能反向推翻上游');
        handedOff = true; throw new Error(handoff);
      },
    });
    assert(handedOff, JSON.stringify({ phases: result.invokedPhases, end: result.events.filter(event => event.type === 'run_end').at(-1) }));
    if (upstream) {
      const events = loadLineageRunEvents(root, feature, project.runId!) as Array<GoalRunEvent & { stage?: string; failed_step?: string }>;
      if (upstream === 'design-repair') {
        const manifestFile = path.join(root, rel, 'goal-runs', project.runId!, 'manifest.json');
        const currentManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        const folded = foldBudgetLineage({ projectRoot: root, featuresDir: 'doc/features', feature, currentEvents: result.events as GoalRunEvent[] });
        assert(folded.ancestorRuns.length, 'the CLI must let the normal continuation decision replace stale birth bindings');
        if (folded.ancestorRuns.length) {
          const originalManifest = JSON.parse(fs.readFileSync(path.join(root, rel, 'goal-runs', folded.ancestorRuns[0].run_id, 'manifest.json'), 'utf8'));
          assert.equal(currentManifest.requirement, originalManifest.requirement, 'automatic continuation must not create a requirement increment');
          assert.deepStrictEqual(currentManifest.budget, originalManifest.budget, 'automatic continuation must retain the hard budget');
          const own = resolveResumedBudget(result.events as GoalRunEvent[]).totalTurns;
          const cumulative = resolveResumedBudget(folded.budgetFoldEvents).totalTurns;
          assert(cumulative > own, 'existing lineage reducer must include earlier design/phase calls');
          // The intentional review handoff throws before the next disk snapshot; read that same event boundary live.
          const progress = projectGoalProgress({ projectRoot: root, manifest: currentManifest, events: result.events as GoalRunEvent[],
            workflow: resolveWorkflowSpec(root, { frameworkRoot }), featuresDir: 'doc/features' });
          assert.equal(progress.budget.turns_used, cumulative);
        }
        assert(!result.invokedPhases.slice(result.invokedPhases.indexOf('design-repair-questioning') + 1).some(phase => phase.startsWith('design-repair-')), 'automatic continuation must not redispatch the completed owner repair');
      }
      assert(ownerReceived, 'verified proposal never reached its actual owner');
      if (upstream === 'plan-repair') assert(handoffFactsChecked, 'real handoff must exercise the original baseline and rejection counterexamples');
      assert(events.some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'FAIL'), 'diagnosis washed away the original compile FAIL');
      assert(result.events.some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'PASS'), 'original stage did not re-verify after owner handling');
      if (upstream.includes('decline')) assert(originalReceived, 'original stage never received the refusal reason');
      if (design) assert(events.some(event => event.type === 'design_authority_repair'
        && (upstream === 'design-decline' ? event.stage === 'failed' && event.failed_step === 'declined' : event.stage === 'published')));
      else {
        assert(events.some(event => event.type === 'phase_backtrack_requested' && (event as any).candidates?.some((candidate: any) => candidate.id === upstreamId)), 'scope revision must retain the real candidate repair transaction');
        if (upstream.includes('decline')) assert.equal(loadRepairDeclineState(root, feature, project.runId!).get(upstreamFp)?.declined_rounds, 1);
      }
      return;
    }
    if (later) {
      assert(result.events.some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'PASS'));
      assert(!result.events.some(event => event.type === 'design_authority_repair'), 'ordinary resource repair must not request design expansion');
      const writes = result.events.filter(event => event.type === 'phase_write_observed' && event.phase === 'coding').flatMap(event => (event as any).owned ?? []);
      assert(writes.some((row: any) => row.path === resourceFiles[1] && row.pre_sha256 !== row.post_sha256));
      assert(String(result.events.at(-1)?.error).includes(handoff)); return;
    }
    assert(result.events.some(event => event.type === 'design_authority_repair' && event.stage === 'published' && event.outcome === 'recovered'));
    assert(result.events.some(event => event.type === 'phase_verdict' && event.phase === 'plan' && event.verdict === 'FAIL' && String(event.blocker_signature).includes('integration_scope_consistency')));
    assert(/integration_scope_consistency|entry_symbol/.test(result.planPrompts[1] ?? ''), '定义失败必须实际送回 plan，不能由替身无条件猜修复');
    assert(result.events.some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'PASS'));
    assert(!result.events.some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'FAIL'), '正常资源写入和框架索引刷新不应触发 coding 失败重跑');
    const coding = result.invokedPhases.indexOf('coding'); assert(coding >= 0 && !result.invokedPhases.slice(coding + 1).includes('spec'));
    const written = result.events.filter(event => event.type === 'phase_write_observed' && event.phase === 'coding').flatMap(event => (event as any).owned ?? []);
    assert(resourceFiles.every(file => written.some((row: any) => row.path === file && row.pre_sha256 !== row.post_sha256)), '三项资源写入必须经过真实归属记录');
    assert(String(result.events.at(-1)?.error).includes(handoff), '只在 UT 交接边界结束，不伪称业务验收完成');
  });
}
