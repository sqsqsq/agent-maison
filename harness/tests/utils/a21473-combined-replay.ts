import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import { withRuntimeTest, preserveRuntimeTestEvidence } from './runtime-test-control';
import { CARD_CORE, writeA21473ReplayAuthor, writeA21473ReplayReview, answerA21473Verifier, a21473TestReferences } from './a21473-replay-author';
import type { ExecutionScope } from '../../scripts/utils/execution-scope';

export function assertA21473ExecutedMethods(events: ReadonlyArray<Record<string, unknown>>): string[] {
  const methods = ['spec', 'plan', 'coding', 'ut', 'testing', 'review'];
  for (const phase of methods) {
    const result = events.filter(event => event.type === 'phase_verdict' && event.phase === phase).at(-1);
    assert(result?.verdict === 'PASS', `actual ${phase} method must return PASS`);
    assert(events.some(event => event.type === 'harness_end' && event.phase === phase && event.invoke_id === result.invoke_id), `actual ${phase} method must have its real harness receipt`);
  }
  return methods;
}

export function assertA21473SuccessorScopePreserved(original: ExecutionScope, current: ExecutionScope): void {
  const required = current.obligations.filter(item => item.applicability === 'required');
  const kinds = new Set(required.map(item => item.kind));
  for (const kind of new Set(['device-evidence', 'unit-evidence', ...original.obligations.filter(item => item.applicability === 'required').map(item => item.kind)])) {
    assert(kinds.has(kind), `successor lost required ${kind}`);
  }
  const unitCases = (scope: ExecutionScope): Set<string> => new Set(scope.obligations
    .filter(item => item.applicability === 'required' && item.kind === 'unit-evidence').flatMap(item => item.reason.match(/\b(?:AC|BD)-\d+\b/g) ?? []));
  const currentCases = unitCases(current);
  for (const id of new Set([...unitCases(original), ...Array.from({ length: 7 }, (_, index) => `AC-${index + 1}`)])) {
    assert(currentCases.has(id), `successor lost required unit coverage ${id}`);
  }
  const knownUnknown = new Set(original.obligations.filter(item => item.applicability === 'unknown').map(item => item.id));
  for (const item of current.obligations.filter(item => item.applicability === 'unknown')) assert(knownUnknown.has(item.id), `successor added unknown ${item.id}`);
  const unresolvedKey = (item: ExecutionScope['unresolved'][number]): string => JSON.stringify([item.obligation_id, item.owner, [...item.needed_by].sort()]);
  const knownUnresolved = new Set(original.unresolved.map(unresolvedKey));
  for (const item of current.unresolved) assert(knownUnresolved.has(unresolvedKey(item)), `successor added unresolved ${item.obligation_id}`);
}

const BLUEPRINT = 'bc-openCard-2';
const UNIT = 'bank-card-opening';
const canonical = `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`;
const FRAMEWORK_FAULT = " require('fs').readFileSync(require('path').join(__dirname, 'p4-missing-native-driver.cjs')); ";
const write = (root: string, file: string, value: string): void => {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value);
};
function assertOriginalCriteria(actual: any[], original: any[]): void {
  assert.equal(actual.length, original.length);
  for (const item of original) {
    const current = actual.find(row => row.id === item.id); assert(current);
    for (const [key, value] of Object.entries(item)) assert.deepEqual(current[key], value, `${item.id}: original ${key}`);
  }
}
export function prepareA21473ReplayEnvironment(root: string, frameworkRoot: string): void {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
    for (const layer of config.architecture.outer_layers) fs.mkdirSync(path.join(root, layer.id), { recursive: true });
    const profileDir = path.join(frameworkRoot, 'profiles/hmos-app');
    const profileFile = path.join(profileDir, 'profile.yaml');
    const profile = YAML.parse(fs.readFileSync(profileFile, 'utf8'));
    profile.capabilities['coding.compile'] = { provider: 'node_compile', severity: 'BLOCKER' };
    profile.capabilities['coding.deps_install'] = { provider: 'none', severity: 'SKIP' };
    profile.capabilities['coding.lint'] = { provider: 'none', severity: 'SKIP' };
    profile.capabilities['ut.compile'] = { provider: 'node_compile', severity: 'BLOCKER' };
    profile.capabilities['ut.run'] = { provider: 'node_test', severity: 'BLOCKER' };
    // These external actions use the existing executable device fixture, not a physical device.
    profile.device_capabilities = [];
    for (const key of ['coding.compile', 'ut.compile', 'ut.run', 'device_test.build', 'device_test.install', 'device_test.run']) delete profile.personal_prerequisites[key];
    fs.writeFileSync(profileFile, YAML.stringify(profile));
    for (const name of ['native.cjs', 'ut-host-impl.js']) fs.copyFileSync(path.join(__dirname, 'session-node-profile', name), path.join(profileDir, 'harness', name));
    fs.writeFileSync(path.join(profileDir, 'harness/coding-host-rules.js'), "const base=require('./coding-host-rules.ts').profileCodingHost; const {compile,check}=require('./native.cjs'); exports.profileCodingHost={...base,sourceFileSuffixes:['.ets','.ts'],checkCodingCompile:ctx=>{const checked=ctx.featureSpec.contracts.files.filter(p=>p.endsWith('.ts')),omitted=ctx.featureSpec.contracts.files.filter(p=>p.endsWith('.ets')); const r=compile(ctx,checked);return [check('coding_compile',r.ok,'Development Node compilation: '+checked.join(', ')+'; native .ets NOT compiled: '+omitted.join(', ')+'\\n'+r.details)];}};\n");
    const nativeFile = path.join(profileDir, 'harness/coding-host-rules.js');
    fs.writeFileSync(nativeFile, fs.readFileSync(nativeFile, 'utf8').replace('checkCodingCompile:ctx=>{', 'checkCodingCompile:ctx=>{' + FRAMEWORK_FAULT));
    for (const name of ['device-test-build', 'device-test-install', 'device-test-run']) {
      let source = fs.readFileSync(path.join(__dirname, 'real-chain-providers', name + '.js'), 'utf8');
      if (name === 'device-test-build') source = source.replace('/\\.ets$/', '/\\.(ets|ts)$/');
      if (name === 'device-test-install') source = source.replace("kind: 'physical'", "kind: 'emulator'");
      if (name === 'device-test-run') {
        source += '\nexports.observeSetupForUnexecutedTrace = real.observeSetupForUnexecutedTrace;\n';
        const start = source.indexOf('function renderedIds(projectRoot) {'), end = source.indexOf('\nfunction ', start + 1);
        assert(start >= 0 && end > start, 'owned device fixture has a replaceable element reader');
        source = source.slice(0, start) + `function renderedIds(projectRoot, feature) {
  const reports=featurePhaseReportsDir(projectRoot,feature,'ut',FRAMEWORK_ROOT);
  const compiled=path.join(reports,'node-build',${JSON.stringify(CARD_CORE.replace(/\.ts$/, '.js'))});
  const {OpenCardFlow,HomeLaunchBridge}=require(compiled);
  const model=new OpenCardFlow({saveCard:async()=>({success:false}),listCards:async()=>[]},{pushPath:()=>{},popToIndex:()=>{},getAllPathName:()=>[]},new HomeLaunchBridge(),()=>0,async()=>'');
  return new Set(['entry','banks','home','type','card','otp','result'].flatMap(kind=>model.screen(kind).elements.map(id=>kind+'-'+id)));
}
` + source.slice(end);
        source = source.replace('renderedIds(opts.projectRoot)', 'renderedIds(opts.projectRoot, opts.feature)');
      }
      write(root, path.relative(root, path.join(profileDir, 'harness/providers', name + '.js')), source);
    }
    write(root, 'AppScope/app.json5', JSON.stringify({ app: { bundleName: 'org.maison.a21473.node', vendor: 'isolated-development-replay', versionCode: 1, versionName: '1.0' } }));
    write(root, 'build-profile.json5', JSON.stringify({ app: { products: [{ name: 'node-replay' }] }, modules: [] }));
    write(root, 'AGENTS.md', '# Isolated development replay\n\nRead the preserved original requirement and the current signed request. Do not access the real host or devices.\n');
    fs.mkdirSync(path.join(root, "observations"), {recursive:true});
    fs.copyFileSync(path.join(__dirname, "../fixtures/a21473-node-replay/no-real-tools.cjs"), path.join(root, "observations/no-real-tools.cjs"));
    fs.mkdirSync(path.join(root, '.codex/agents'), { recursive: true });
    for (const name of ['phase-executor.toml', 'verifier.toml']) {
      const file = path.join(frameworkRoot, 'agents/codex/templates/agents', name);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(root, '.codex/agents', name));
    }
}
export async function continueA21473CombinedReplay(input: { root: string; frameworkRoot: string; harnessDir: string; initialStep: any; historicalEvents: Buffer; reportRoot: string; sourceHashes: Record<string, string> }): Promise<void> {
  const { root, frameworkRoot, harnessDir } = input;
  const load = (file: string): any => require(path.join(harnessDir, file));
  const runId = '20261029T005400Z-a21473';
  const runDir = path.join(root, `doc/features/${BLUEPRINT}/goal-runs/${runId}`);
  const blueprintBefore = YAML.parse(fs.readFileSync(path.join(root, canonical), 'utf8'));
  const sourceRequirement = fs.readFileSync(path.join(root, 'doc/features/原始需求/1-2-银行卡/原始需求.md'), 'utf8');
  const manifestBefore = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(manifestBefore.requirement, sourceRequirement);
  const observations: any[] = [];
  const priorOptions = process.env.NODE_OPTIONS;
  const guardPath = path.join(root, 'observations/no-real-tools.cjs');
  process.env.NODE_OPTIONS = `${priorOptions ?? ''} --require ${JSON.stringify(guardPath)}`.trim();
  const guard = require(guardPath);
  try {
    let entry = load('scripts/goal-mode-entry');
    const options = { projectRoot: root, frameworkRoot, feature: BLUEPRINT, runId, adapter: 'codex', runMode: 'attended' as const,
      authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
    let step = input.initialStep, authors = 0, restored = false, observedMixed = false, childRunDir = '', knowledgeHandbacks = 0;
    const productBoundary = { projectRoot: root, protectedRoots: ['01-Product', '02-Feature', '03-Core', '04-BusinessBase', '05-SystemBase'].filter(dir => fs.existsSync(path.join(root, dir))) };
    let successor: { runId: string; runDir: string; successorOf: string; productSha256: string } | undefined;
    let successorScopes: { original: ExecutionScope; final?: ExecutionScope } | undefined;
    let mixedEvidence: any, waitingBeforeRestore: any;
    const nativeFile = path.join(frameworkRoot, 'profiles/hmos-app/harness/coding-host-rules.js');
    const broken = fs.readFileSync(nativeFile, 'utf8');
    for (let turn = 0; turn < 36; turn++) {
      if (step.type !== 'phase_execute_request') {
        if (restored) break;
        assert.equal(step.result?.status, 'waiting', JSON.stringify(step));
        waitingBeforeRestore = step;
        assert(observedMixed && authors === 2, 'business repair must proceed while the actual framework fault remains');
        assert.equal(fs.readFileSync(nativeFile, 'utf8'), broken, 'no actor edits framework');
        const handoff = load('scripts/utils/session-execution-handoff');
        const last = handoff.readSessionExecution(childRunDir);
        assert(last && handoff.acceptedSessionReport(childRunDir, last), 'restore only after the last actual actor report was accepted');
        const tap = fs.readFileSync(path.join(path.dirname(path.dirname(childRunDir)), 'ut/reports/node-tests.tap'), 'utf8');
        assert.match(tap, /# fail 0\b/); assert.match(tap, /# tests 11\b/);
        fs.writeFileSync(nativeFile, broken.replace(FRAMEWORK_FAULT, ''));
        for (const file of Object.keys(require.cache)) if (file.startsWith(frameworkRoot + path.sep)) delete require.cache[file];
        entry = load('scripts/goal-mode-entry'); restored = true;
        step = await withRuntimeTest({ root }, () => entry.runGoalModeSessionStep({ ...options, forceTakeover: true }));
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(step.request.path, 'utf8'));
      const issued = load('scripts/utils/session-execution-handoff').readSessionExecution(raw.context.runDir, step.request.path);
      assert(issued, 'only an actual signed request may be answered');
      const context = issued.request.context;
      observations.push({ phase: step.phase, feature: context.feature, runId: context.runId, chain: context.chain, requestSha256: issued.reference.sha256, instruction: context.instruction });
      write(input.reportRoot, 'combination-progress.json', JSON.stringify(observations, null, 2));
      let output = 'Read the original requirement and approved blueprint; submitted the requested author artifact for the real consumer.';
      if (step.phase === 'initial-design-decomposition') {
        const loaded = load('scripts/utils/component-blueprint-path').loadCanonicalBlueprint(root, BLUEPRINT);
        const ref = { artifact: 'component-blueprint@1', component_id: loaded.blueprint.component_id, blueprint_id: BLUEPRINT,
          revision: loaded.blueprint.revision, source_fingerprint: loaded.blueprint.source_fingerprint, artifact_sha256: loaded.artifactSha256 };
        const addresses = load('scripts/utils/blueprint-addressing').stableAddressIndex(loaded.blueprint);
        const ownerRef = { ...ref, target: { kind: 'blueprint', id: BLUEPRINT } };
        const refs: any[] = [...addresses.keys()].filter(address => !String(address).startsWith('blueprint:')).map(address => load('scripts/utils/change-unit-design-gate')
          .componentBlueprintRefForAddress(ref, address));
        const artifact = { artifact: 'change-unit@1', blueprint_id: BLUEPRINT, component_id: loaded.blueprint.component_id, change_unit_id: UNIT, revision: 1, priority: 10,
          component_blueprint_ref: ownerRef, provenance: { source_kind: 'component-blueprint', source_ref: canonical, source_revision: `revision-${loaded.blueprint.revision}`,
            observed_at: '2026-11-07', evidence_strength: 'authoritative', extraction_method: 'builtin-vertical-slice-decomposition: actual-approved-a21473-input-reading' },
          purpose: sourceRequirement, preconditions: [], requires: [], provides: [{ provide_id: 'bank-card-opening', description: sourceRequirement }], design_refs: refs,
          touches: refs.filter(r => r.target.kind === 'node' && r.target.view_id === 'development').map(design_ref => ({ owner: design_ref.target.id, design_ref, write_refs: ['planned:02-Feature/WalletMain', 'planned:04-BusinessBase/AccountManager'] })),
          target_predicates: loaded.blueprint.discovery.inputs.current_scope_items.map((item: any, index: number) => ({ predicate_id: item.item_id,
            role: item.item_id === 'storage' ? 'owner' : item.item_id === 'navigation' ? 'consumer' : item.item_id === 'compatibility' ? 'recovery' : 'behavior', description: item.description,
            provide_ids: ['bank-card-opening'], verification_refs: [item.source_ref, `${canonical}#AC-${index + 1}`] })),
          preserved_invariants: [{ invariant_id: 'existing-navigation', description: '原有路由与账号公开接口保持兼容', evidence_refs: a21473TestReferences() }], verification_refs: a21473TestReferences(),
          safe_intermediate_state: { description: 'The complete original request remains one constructable slice', build_validation_refs: a21473TestReferences(), compatibility_refs: a21473TestReferences(), recovery_refs: a21473TestReferences() }, blockers: [] };
        const candidate = { providerId: 'builtin-vertical-slice-decomposition', artifact };
        load('scripts/utils/change-unit-provider-boundary').validateChangeUnitCandidate(root, candidate);
        write(root, `doc/features/${BLUEPRINT}/blueprint/change-unit-candidates.json`, JSON.stringify([candidate]));
      } else if (step.phase === 'design-repair-author') {
        const file = path.join(runDir, 'design-repair/component-blueprint.yaml');
        const draft = YAML.parse(fs.readFileSync(file, 'utf8'));
        if (context.instruction.includes('component_closure_knowledge_')) {
          assert(context.instruction.includes('原资产 writer') && context.instruction.includes('P1 owner reconciliation'), 'actual closure gap dispatches both original responsibilities');
          const glossaryFile = path.join(root, 'doc/glossary.yaml');
          assert(issued.request.snapshot_options?.ownedPrefixes?.some((prefix: string) => path.resolve(root, prefix) === glossaryFile), 'asset writes must be present in the actual signed boundary');
          const glossary = YAML.parse(fs.readFileSync(glossaryFile, 'utf8'));
          const beforeTerms = structuredClone(glossary.terms);
          const terms: Record<string, [string, string]> = { 'result-destination': ['开卡结果回流', '02-Feature'],
            'mock-phone': ['账号 mock 手机号', '04-BusinessBase'], 'wallet-pages': ['钱包页面复用', '02-Feature'] };
          for (const decision of draft.decisions_and_gaps.decisions) if (decision.status === 'decided_with_authority') {
            const [term, owner_layer] = terms[decision.decision_id];
            if (!glossary.terms.some((item: any) => item.aliases?.includes(decision.decision_id))) glossary.terms.push({
              term, canonical_module: decision.owner, owner_layer, aliases: [decision.decision_id], easily_confused_with: [],
              definition: '已批准设计结论：' + (decision.conclusion ?? decision.rationale),
            });
          }
          assert.deepEqual(glossary.terms.slice(0, beforeTerms.length), beforeTerms, 'original asset writer preserves existing terms');
          fs.writeFileSync(glossaryFile, YAML.stringify(glossary));
          for (const decision of draft.decisions_and_gaps.decisions) if (decision.status === 'decided_with_authority') {
            decision.knowledge_refs = [...new Set([...(decision.knowledge_refs ?? []), `doc/glossary.yaml#${decision.decision_id}`])];
          }
          knowledgeHandbacks++;
        }
        const development = draft.design_views.find((view: any) => view.view_id === 'development');
        const implementation = development.nodes.find((node: any) => node.node_id === 'implementation');
        implementation.contracts.integration_points = implementation.contracts.integration_points.flatMap((point: any) =>
          point.entry_symbol.split(' / ').map((entry_symbol: string) => ({ ...point, entry_symbol: entry_symbol === 'AccountService.getMockPhone' ? 'getMockPhone' : entry_symbol })));
        if (!development.nodes.some((node: any) => node.node_id === 'host-routing')) {
          development.nodes.push({ node_id: 'host-routing', module: 'Phone', owner: 'Phone', current_state: '保全入口已有NavPathContext和navDestinationMap',
            target_state: '在同一根栈分发原需求新增选卡与结果页，保留既有页面入口', provenance: structuredClone(implementation.provenance),
            verification_refs: [manifestBefore.requirement_source_files[0], '01-Product/Phone/src/main/ets/pages/index.ets'],
            design_basis_refs: ['view:development/node:implementation'] });
          const cuFile = path.join(runDir, 'design-repair/change-unit.yaml');
          const hasPrimary = fs.existsSync(cuFile);
          const cu = hasPrimary ? YAML.parse(fs.readFileSync(cuFile, 'utf8'))
            : structuredClone(load('scripts/utils/change-unit-path').loadCanonicalChangeUnit(root, BLUEPRINT, UNIT).changeUnit);
          const ref = { ...cu.component_blueprint_ref, target: { kind: 'node', view_id: 'development', id: 'host-routing' } };
          cu.design_refs.push(ref); cu.touches.push({ owner: 'Phone', design_ref: ref, write_refs: ['planned:01-Product/Phone'] });
          if (hasPrimary) fs.writeFileSync(cuFile, YAML.stringify(cu));
          else write(root, path.relative(root, path.join(runDir, 'design-repair/change-unit-candidates.json')),
            JSON.stringify([{ providerId: 'builtin-vertical-slice-decomposition', artifact: cu }]));
        }
        const acceptance = draft.design_views.find((view: any) => view.view_id === 'scenarios').nodes[0].acceptance;
        assertOriginalCriteria(acceptance.criteria, blueprintBefore.design_views.find((view: any) => view.view_id === 'scenarios').nodes[0].acceptance.criteria);
        const transitions = [['entry','entry-bank','type',['type-bank','type-types']], ['type','type-continue','card',['card-masked-cards','card-next']],
          ['card','card-next','otp',['otp-phone','otp-code']], ['otp','otp-next','result',['result-status','result-message']],
          ['result','result-complete','home',['home-card']], ['home','home-add','entry',['entry-bank']], ['type','type-continue','card',['card-masked-cards']]];
        acceptance.flows = { open_card: ['entry','type','card','otp','result','home'], reenter_card: ['home','entry'] };
        const quote = (from: string, until?: string): string => {
          const start = sourceRequirement.indexOf(from), end = until ? sourceRequirement.indexOf(until, start + from.length) : sourceRequirement.length;
          assert(start >= 0 && end > start, 'checkpoint evidence must be an actual original requirement passage');
          return sourceRequirement.slice(start, end).trim();
        };
        const evidence = [quote('1.用户进入', '4.银行的'), quote('4.银行的', '5.输入验证码'), quote('5.输入验证码', '6.添加结果页'),
          quote('5.输入验证码', '6.添加结果页'), quote('6.添加结果页', '#### 页面说明'), quote('#### 路由规格'), quote('#### 页面说明', '#### 路由规格')];
        acceptance.criteria.forEach((ac: any, index: number) => {
          const [pre_screen, target_element_id, post_screen, required_element_ids] = transitions[index];
          ac.linked_flow = index === 5 ? 'reenter_card' : 'open_card'; ac.checkpoint = { pre_screen, action: { type: 'touch', target_element_id }, post_screen, required_element_ids };
          ac.requirement_ref = { source_path: manifestBefore.requirement_source_files[0], snippet: evidence[index] };
        });
        for (const boundary of acceptance.boundaries) Object.assign(boundary, { ut_layer: 'both', ut_focus: boundary.expected_behavior, device_focus: boundary.expected_behavior });
        const owner = draft.design_views.find((view: any) => view.view_id === 'runtime').nodes[0];
        const flow = draft.design_views.find((view: any) => view.view_id === 'runtime').runtime_data_flows[0];
        const testReferences = a21473TestReferences();
        for (const decision of draft.decisions_and_gaps.decisions) {
          decision.verification_refs = [...new Set([...(decision.verification_refs ?? []), ...testReferences])];
        }
        flow.verification_refs = [...new Set([...(flow.verification_refs ?? []), ...testReferences])];
        for (const lifecycle of Object.values(flow.lifecycle_coverage) as any[]) if (lifecycle.status === 'covered') {
          lifecycle.evidence_refs = [...new Set([...(lifecycle.evidence_refs ?? []), ...testReferences])];
        }
        if (!flow.use_cases.use_cases.some((uc: any) => uc.id === 'reenter_card')) flow.use_cases.use_cases.push({ id: 'reenter_card', description: '原需求要求新旧页面往返不破坏既有入口',
          coordinator: 'OpenCardFlow', coordinator_file: '02-Feature/WalletMain/src/main/ets/domain/flow/OpenCardFlow.ets',
          ui_bindings: [{ ui: 'HomeTabPage', role: 'entry', subscribes: [], user_actions: [{ trigger: '再次添加卡片', calls: ['flow.reenter'] }] }], data_boundaries: [],
          state_model: { phases: ['Idle'] }, branches: [{ id: 'reenter', scenario: '从原首页再次进入添加卡片', expected_phase_seq: ['Idle'], linked_acceptance: ['AC-6'] }] });
        for (const state of owner.contracts.state_management) Object.assign(state, { owner_ref: flow.state_owner.ref, contract_refs: structuredClone(flow.logical_contract_refs),
          mutations: structuredClone(flow.mutations), publications: structuredClone(flow.publications), subscriptions: structuredClone(flow.subscriptions), consumers: structuredClone(flow.consumers),
          initial_load: structuredClone(flow.initial_load), failure_recovery: structuredClone(flow.failure_recovery),
          lifecycle_triggers: Object.entries(flow.lifecycle_coverage).filter(([, value]: [string, any]) => value.status === 'covered').map(([key]) => key) });
        fs.writeFileSync(file, YAML.stringify(draft));
      } else if (step.phase === 'design-repair-questioning') {
        const draft = YAML.parse(fs.readFileSync(path.join(runDir, 'design-repair/component-blueprint.yaml'), 'utf8'));
        const acceptance = draft.design_views.find((view: any) => view.view_id === 'scenarios').nodes[0].acceptance;
        assert(acceptance.boundaries.every((item: any) => item.ut_layer === 'both' && item.ut_focus === item.expected_behavior));
        assertOriginalCriteria(acceptance.criteria, blueprintBefore.design_views.find((view: any) => view.view_id === 'scenarios').nodes[0].acceptance.criteria);
        assert.equal(fs.readFileSync(path.join(root, manifestBefore.requirement_source_files[0]), 'utf8'), sourceRequirement);
        output = JSON.stringify({ items: blueprintBefore.review_summary.questioning.items });
      } else if (step.phase === 'vision-canary') {
        output = 'CANNOT_SEE_IMAGE';
      } else if (step.phase === 'work-unit-author') {
        if (childRunDir && context.runDir !== childRunDir) {
          assert(!successor, 'only one actual post-publication successor author request is expected');
          assert(restored && observedMixed && authors === 2 && knowledgeHandbacks === 1, 'a framework wait cannot buy a successor author');
          const current = JSON.parse(fs.readFileSync(path.join(context.runDir, 'manifest.json'), 'utf8'));
          const original = JSON.parse(fs.readFileSync(path.join(childRunDir, 'manifest.json'), 'utf8'));
          assert.equal(current.successor_of, original.run_id);
          assert.equal(current.feature, original.feature); assert.equal(current.requirement, sourceRequirement);
          assert.deepEqual(current.delivery_origin, { feature: BLUEPRINT, run_id: runId });
          assert(context.instruction.includes('lineage_fresh') && context.instruction.includes('doc/glossary.yaml'), 'the actual request identifies changed design and knowledge bindings');
          const disposition = load('scripts/utils/verify-feature-completion').resolveCompletionDisposition({ projectRoot: root, frameworkRoot,
            feature: context.feature, runId: context.runId, chain: context.chain, endpoint: 'request' });
          assert(disposition.completionBlocking.length && disposition.completionBlocking.every((item: any) => item.action === 'verify'), JSON.stringify(disposition));
          const originalScope = load('scripts/utils/goal-run-creation').loadEffectiveExecutionScope(root, context.feature, original.run_id, frameworkRoot);
          assert(originalScope, 'original CU has an effective obligation scope');
          successorScopes = { original: originalScope };
          const snapshot = load('scripts/utils/phase-write-boundary').capturePhaseInvocationSnapshot(productBoundary);
          assert.equal(snapshot.failureReason, null);
          successor = { runId: context.runId, runDir: context.runDir, successorOf: original.run_id, productSha256: snapshot.sha256 };
          writeA21473ReplayAuthor(root, frameworkRoot, context, false, true);
          const afterInputs = load('scripts/utils/phase-write-boundary').capturePhaseInvocationSnapshot(productBoundary);
          assert.equal(afterInputs.failureReason, null); assert.equal(afterInputs.sha256, snapshot.sha256, 'refreshing actual successor construction inputs never edits product or tests');
          output = 'Read current canonical design and actual source inputs; refreshed local construction mappings, real research facts and test-plan inputs derived from current acceptance. Implementation and tests remain byte-identical. Run the real checks and independent verification for current bindings.';
        } else {
          authors++; childRunDir = context.runDir;
          assert(authors <= 2, 'a framework wait cannot buy unchanged author retries');
          if (authors === 2) {
            const disposition = load('scripts/utils/verify-feature-completion').resolveCompletionDisposition({ projectRoot: root, frameworkRoot,
              feature: context.feature, runId: context.runId, chain: context.chain, endpoint: 'request' });
            assert(disposition.completionBlocking.some((item: any) => item.owner === 'framework' && item.action === 'wait'), 'actual framework failure remains waiting');
            assert(disposition.completionBlocking.some((item: any) => item.phase === 'ut' && item.action === 'repair' && context.instruction.includes(item.id)), 'actual independently repairable UT deficit reaches its author');
            const script = JSON.parse(fs.readFileSync(path.join(load('config').featurePhaseReportsDir(root, context.feature, 'ut', frameworkRoot), 'script-report.json'), 'utf8'));
            assert(script.checks.some((item: any) => item.status === 'FAIL' && item.details.includes('TS2322')), 'real TSC reports the deliberately invalid assignment');
            mixedEvidence = { disposition, compilerFailures: script.checks.filter((item: any) => item.status === 'FAIL') };
            observedMixed = true;
          }
          writeA21473ReplayAuthor(root, frameworkRoot, context, authors === 1);
        }
      } else if (step.phase === 'review') {
        assert.equal(context.executionRole, 'verifier');
        writeA21473ReplayReview(root, frameworkRoot, context.feature);
      } else if (step.phase.endsWith('-verifier-format-repair')) {
        answerA21473Verifier(root, frameworkRoot, context);
      } else if (step.phase.startsWith('initial-design-scope-')) {
        const feature = load('scripts/utils/change-unit-path').deriveChangeUnitFeatureId(BLUEPRINT, UNIT);
        load('scripts/utils/feature-track').prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature,
          completionTarget: 'feature', requestedResults: [sourceRequirement], requestedPhases: ['plan', 'coding', 'ut'], requirement: sourceRequirement,
          requirementSourceFiles: manifestBefore.requirement_source_files, impact: { userVisibleBehaviorChange: true,
            reason: 'Original bank-card UI and behavior request; Node replay is an explicitly limited development environment',
            basisPaths: ['02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets'] }, overwrite: true });
      } else throw new Error('Actual next responsibility: ' + step.phase + '\n' + (context.instruction.split('## 修复简报')[1] ?? context.instruction.slice(-4500)));
      step = await withRuntimeTest({ root }, () => entry.runGoalModeSessionStep({ ...options, requestPath: step.request.path,
        report: { status: 'passed', phase: step.phase, details: output } }));
    }
    assert.equal(step.type, 'goal_session_result', JSON.stringify(step));
    assert.equal(step.run_id, runId);
    assert.equal(step.result.status, 'completed', JSON.stringify(step));
    assert(restored && observedMixed && authors === 2, 'framework restoration requires no third implementation repair');
    const paths = load('scripts/utils/change-unit-path');
    const feature = paths.deriveChangeUnitFeatureId(BLUEPRINT, UNIT);
    assert.equal(paths.enumerateCanonicalChangeUnits(root, BLUEPRINT).length, 1);
    const childManifest = JSON.parse(fs.readFileSync(path.join(successor?.runDir ?? childRunDir, 'manifest.json'), 'utf8'));
    assert.equal(childManifest.requirement, sourceRequirement);
    assert.deepEqual(childManifest.delivery_origin, { feature: BLUEPRINT, run_id: runId });
    const childIds = new Set(observations.filter(row => row.feature === feature).map(row => row.runId));
    const initialChildRun = JSON.parse(fs.readFileSync(path.join(childRunDir, 'manifest.json'), 'utf8')).run_id;
    assert.deepEqual([...childIds], [initialChildRun, ...(successor ? [successor.runId] : [])], 'one CU stays in the original request with at most one linked design-publication successor');
    if (successor) {
      const snapshot = load('scripts/utils/phase-write-boundary').capturePhaseInvocationSnapshot(productBoundary);
      assert.equal(snapshot.failureReason, null); assert.equal(snapshot.sha256, successor.productSha256, 'successor revalidation never edits implementation or tests');
      const finalScope = load('scripts/utils/goal-run-creation').loadEffectiveExecutionScope(root, feature, childManifest.run_id, frameworkRoot);
      assert(finalScope && successorScopes, 'final successor and original scopes are both real');
      assertA21473SuccessorScopePreserved(successorScopes.original, finalScope);
      successorScopes.final = finalScope;
    }
    const expected = load('scripts/utils/change-unit-completion').resolveChangeUnitExpectedExecution(root, feature, false, frameworkRoot);
    const chain: string[] = expected.expectedChain;
    const executedMethods = assertA21473ExecutedMethods(fs.readFileSync(path.join(successor?.runDir ?? childRunDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
    const assessment = load('scripts/utils/feature-assessment').assessFeature(root, feature, { frameworkRoot, ...expected });
    assert(assessment.complete && assessment.record.state === 'ok', JSON.stringify(assessment));
    assert(load('scripts/utils/change-unit-completion').hasSuccessfulTerminalChangeUnitRun(root, feature));
    const delivery = load('scripts/utils/initial-design-delivery').projectInitialDesignDelivery({ projectRoot: root, frameworkRoot,
      manifest: JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8')) });
    assert(delivery.complete, JSON.stringify(delivery));
    const disposition = load('scripts/utils/verify-feature-completion').resolveCompletionDisposition({ projectRoot: root, frameworkRoot,
      feature, runId: childManifest.run_id, chain, endpoint: 'request' });
    assert(disposition.completionEligible && !disposition.releaseReady, JSON.stringify(disposition));
    const phases = executedMethods.map((phase: string) => {
      const reports = load('config').featurePhaseReportsDir(root, feature, phase, frameworkRoot);
      return { phase, summary: JSON.parse(fs.readFileSync(path.join(reports, 'summary.json'), 'utf8')),
        script: JSON.parse(fs.readFileSync(path.join(reports, 'script-report.json'), 'utf8')) };
    });
    assert(phases.some((row: any) => row.phase === 'testing' && row.script.checks.some((check: any) => check.id === 'device_test_run' && check.status === 'PASS')));
    assert(phases.some((row: any) => row.phase === 'coding' && row.script.checks.some((check: any) => check.id === 'coding_compile' && check.status === 'PASS' && check.details.includes('native .ets NOT compiled:'))));
    const tap = fs.readFileSync(path.join(load('config').featurePhaseReportsDir(root, feature, 'ut', frameworkRoot), 'node-tests.tap'), 'utf8');
    assert.match(tap, /# tests 11\b/); assert.match(tap, /# fail 0\b/); assert.match(tap, /# skipped 0\b/);
    const finalBlueprint = YAML.parse(fs.readFileSync(path.join(root, canonical), 'utf8'));
    assertOriginalCriteria(finalBlueprint.design_views.find((view: any) => view.view_id === 'scenarios').nodes[0].acceptance.criteria,
      blueprintBefore.design_views.find((view: any) => view.view_id === 'scenarios').nodes[0].acceptance.criteria);
    assert.deepEqual(finalBlueprint.review_summary.questioning.items, blueprintBefore.review_summary.questioning.items);
    assert.equal(fs.readFileSync(path.join(root, manifestBefore.requirement_source_files[0]), 'utf8'), sourceRequirement);
    const rootEvents = fs.readFileSync(path.join(runDir, 'events.jsonl'));
    assert(rootEvents.subarray(0, input.historicalEvents.length).equals(input.historicalEvents));
    const publications = rootEvents.toString().trim().split('\n').map(line => JSON.parse(line))
      .filter(event => event.type === 'design_authority_repair' && event.stage === 'published');
    assert.equal(publications.length, 2); assert(publications.every(event => event.outcome === 'recovered'));
    assert.equal(knowledgeHandbacks, 1, 'knowledge is written only after the actual closure dispatch');
    const fidelity = load('scripts/utils/fidelity-shared').loadFidelityIntentSsot(root, feature);
    assert.equal(fidelity.selected_fidelity, 'pixel_1to1');
    assert(!guard.attempts.some((name: string) => ['codex','claude','opencode','dsh'].includes(name) || name.startsWith('host-fs:')));
    const evidence = { schema_version: '1.0', scope: 'development mechanism replay; not HMOS or real model delivery',
      originalRun: runId, childRun: childManifest.run_id, feature, complete: true, publicEndpoint: step, sourceHashes: input.sourceHashes, designPublications: publications,
      sameChildRun: !successor, initialChildRun, successor, originalRequirementSha256: createHash('sha256').update(sourceRequirement).digest('hex'),
      originalQuestioningItems: 19, originalAcceptanceCriteria: 7, immutableHistoryPrefix: true,
      authors, successorAuthorRequests: successor ? 1 : 0, successorScopes, observedMixed, restored, knowledgeHandbacks, birthChain: childManifest.phase_chain, effectiveCompletionChain: chain, executedMethods,
      mixedEvidence, waitingBeforeRestore, assessment, disposition, fidelity, phases, nodeTap: tap,
      environment: ['preserved input files only; isolated Git baseline and trust root', 'minimal declared layer/app/build/adapter setup; original catalog and glossary preserved before real writer dispatch',
        'Node TSC and 11 node:test/SQLite cases run for real; native .ets explicitly not compiled',
        'existing executable device build/install/run fixtures; production parsers, gates and completion unchanged',
        'device prerequisites removed for this declared non-device environment; native tools denied before launch',
        'original pixel_1to1 preserved; unavailable capture follows production disclosure, release remains blocked'],
      nativeToolAttemptsBlockedBeforeLaunch: guard.attempts, unverified: ['HarmonyOS compilation and native UI', 'real devices, layout and pixels', 'real author/model quality', 'shared coding/UT producer restoration'] };
    write(path.dirname(input.reportRoot), 'remaining-3.1.0-p4-a21473-combination.json', JSON.stringify(evidence, null, 2) + '\n');
  } catch (error) {
    write(input.reportRoot, 'combination-progress.json', JSON.stringify(observations, null, 2));
    const child = path.join(root, 'doc/features/bc-openCard-2/bank-card-opening');
    const diagnostics = ['spec','plan','coding','ut','testing','review'].flatMap(phase => ['summary.json','script-report.json','phase-evidence-manifest.json','device-test-evidence.json','node-tests.tap'].map(name => path.join(child, phase, 'reports', name)));
    const preserved = preserveRuntimeTestEvidence([root], String(error), [], [path.join(root, canonical), ...diagnostics]);
    throw new Error(`${error instanceof Error ? error.stack : String(error)}\noriginals: ${preserved}`);
  } finally {
    guard.restore();
    if (priorOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = priorOptions;
    for (const file of Object.keys(require.cache)) if (file.startsWith(root + path.sep)) delete require.cache[file];
  }
}
