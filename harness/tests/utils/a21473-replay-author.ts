import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { researchSnapshotFacts } from '../fixtures/host-snapshot-3.1.0/migrate';
import { publishFixtureVerifierEvidence } from './verifier-evidence-fixture';
import { readDeliveredVerifierRequest } from '../unit/real-chain.unit.test';

export const CARD_CORE = '02-Feature/WalletMain/src/main/ets/domain/flow/BankCardFlow.ts';
export const CARD_TEST = '02-Feature/WalletMain/src/test/BankCardFlow.test.ts';
const FIXTURE = path.resolve(__dirname, '../fixtures/a21473-node-replay');
export function a21473TestReferences(): string[] {
  return [...fs.readFileSync(path.join(FIXTURE, 'BankCardFlow.test.ts'), 'utf8').matchAll(/\bit\('([^']+)'/g)]
    .map(match => `${CARD_TEST}#${match[1]}`);
}
const write = (root: string, file: string, value: string, refreshedInput = false): void => {
  const target = path.join(root, file);
  if (!refreshedInput && fs.existsSync(target) && fs.readFileSync(target, 'utf8') === value) return;
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value);
};
const yaml = (root: string, file: string, value: unknown): void => write(root, file, YAML.stringify(value));
export function writeA21473ReplayReview(root: string, frameworkRoot: string, feature: string): void {
  const rel = require(path.join(frameworkRoot, 'harness/scripts/utils/feature-identity')).featureRelativePath(feature);
  const base = `doc/features/${rel}`;
  const files = [...YAML.parse(fs.readFileSync(path.join(root, base, 'contracts.yaml'), 'utf8')).files, '02-Feature/WalletMain/src/main/ets/domain/flow/LaunchHomeCardMode.ets'];
  write(root, `${base}/review/review-report.md`, '# 审查报告\n\n> **保证等级**: standard\n\n## 1. 审查范围\n' + files.map((file: string) => '- ' + file).join('\n') + '\n\n## 2. 审查维度\n原需求的数据、OTP、路由及失败恢复。Node开发投影不冒称HarmonyOS UI/真机通过。\n\n## 3. 问题清单\n| 编号 | 分类 | 严重程度 | 问题描述 | 涉及文件 | 修复建议 |\n|---|---|---|---|---|---|\n\n## 4. 问题统计\n| 严重程度 | 数量 |\n|---|---|\n| BLOCKER | 0 |\n| MAJOR | 0 |\n| MINOR | 0 |\n\n## 5. 修复建议\n开发编译和真实Node断言由工具判定；原生UI交t5。\n\n## 6. 结论\n**审查结论**: 通过\n');
}
export function writeA21473ReplayAuthor(root: string, frameworkRoot: string, context: any, defective: boolean, inputsOnly = false): void {
  const load = (file: string): any => require(path.join(frameworkRoot, 'harness', file));
  const rel = load('scripts/utils/feature-identity').featureRelativePath(context.feature);
  const base = `doc/features/${rel}`;
  const blueprint = load('scripts/utils/component-blueprint-path').loadCanonicalBlueprint(root, 'bc-openCard-2');
  const acceptance = blueprint.blueprint.design_views.find((v: any) => v.view_id === 'scenarios').nodes[0].acceptance;
  const requested = fs.readFileSync(path.join(root, 'doc/features/原始需求/1-2-银行卡/原始需求.md'), 'utf8');
  assert(context.instruction.includes('当前') || context.instruction.includes('Read'), 'the actor reads its actual current request');
  if (context.chain.includes('spec')) {
    const projected = load('scripts/utils/blueprint-skill-projection').deriveBlueprintSkillInput(root, context.feature, frameworkRoot, 'acceptance');
    assert.equal(projected.state, 'resolved', projected.detail);
    yaml(root, `${base}/acceptance.yaml`, projected.value);
    const sourceDir = path.join(root, 'doc/features/原始需求/1-2-银行卡');
    const images = fs.readdirSync(sourceDir).filter(name => /^[3456]-/.test(name) && /\.(png|jpe?g)$/i.test(name)).sort();
    assert.equal(images.length, 4, 'all four original reference images remain available');
    const intent = load('scripts/utils/fidelity-shared').loadFidelityIntentSsot(root, context.feature);
    assert.equal(intent.selected_fidelity, 'pixel_1to1', 'the original visual obligation must not be lowered');
    write(root, `${base}/spec/spec.md`, '# Bank card developer replay\n\n```yaml\n' + YAML.stringify({ ui_change: 'new_or_changed',
      fidelity_target: intent.selected_fidelity, asset_acquisition_mode: intent.asset_acquisition_mode, acceptance_strictness: intent.acceptance_strictness,
      visual_handoff: { kind: 'repo_assets', authoritative_refs: images.map((image, index) => ({ id: 'original-' + (index + 3), path: `doc/features/原始需求/1-2-银行卡/${image}` })) } }) + '```\n\n' + requested);
    const names = ['type', 'card', 'otp', 'result'];
    const elements = [['bank', 'types', 'hint', 'agreement', 'continue'], ['bank-title', 'hint', 'masked-cards', 'agreement', 'next'], ['phone', 'code', 'countdown', 'next'], ['status', 'message', 'guide', 'complete']];
    yaml(root, `${base}/spec/ui-spec.yaml`, { schema_version: '1.0',
      screens: names.map((id, index) => ({ id, priority: 'P0', ref_id: 'original-' + (index + 3),
        root: { type: id === 'type' || id === 'otp' ? 'overlay_panel' : 'navigation_frame', order: 0, id: id + '-root', children: elements[index].map((name, order) => ({ id: `${id}-${name}`, type: name.includes('next') || name === 'continue' || name === 'complete' ? 'action_button' : 'content_display', order, text: name })) } })),
      tokens: { neutral: { kind: 'color', value: '#808080', placeholder: true, value_source: 'blind_inference_neutral_placeholder' } }, assets: [] });
    const uiFile = path.join(root, base, 'spec/ui-spec.yaml'), ui = YAML.parse(fs.readFileSync(uiFile, 'utf8'));
    for (const [id, ids] of [['entry',['bank']], ['banks',['bank']], ['home',['card','add']]] as Array<[string,string[]]>) ui.screens.push({ id, priority: 'P0',
      root: { id: id + '-root', type: 'navigation_frame', order: 0, children: ids.map((name, order) => ({ id: id + '-' + name, type: 'action_button', order, text: name })) } });
    yaml(root, `${base}/spec/ui-spec.yaml`, ui);
    assert.deepEqual(require(path.join(frameworkRoot, 'profiles/hmos-app/harness/ui-spec-schema-validate')).validateUiSpecSchema(ui), [], 'the author checks its actual UI document schema');
  }
  if (context.chain.includes('plan')) {
    const result = load('scripts/utils/blueprint-skill-projection').deriveBlueprintSkillInput(root, context.feature, frameworkRoot, 'contracts');
    assert.equal(result.state, 'resolved', result.detail);
    const contracts = structuredClone(result.value);
    const cuPaths = load('scripts/utils/change-unit-path'), unit = cuPaths.loadCanonicalChangeUnit(root, 'bc-openCard-2', 'bank-card-opening');
    contracts.modules = ['WalletMain', 'AccountManager', 'Phone'].map(name => ({ name, layer: name === 'WalletMain' ? '02-Feature' : name === 'Phone' ? '01-Product' : '04-BusinessBase',
      package_path: `${name === 'WalletMain' ? '02-Feature' : name === 'Phone' ? '01-Product' : '04-BusinessBase'}/${name}`, format: name === 'Phone' ? 'HAP' : 'HAR', change_type: 'modify' }));
    contracts.files = [...new Set([...contracts.files, CARD_CORE])];
    const implementation_refs = [CARD_CORE], test_refs = a21473TestReferences();
    assert.equal(test_refs.length, 11, 'closure references name actual executable Node test cases');
    for (const state of contracts.state_management ?? []) {
      const originalFlow = blueprint.blueprint.design_views.find((view: any) => view.view_id === 'runtime').runtime_data_flows
        .find((flow: any) => flow.flow_id === state.design_ref?.target?.id);
      if (originalFlow) state.lifecycle_triggers = [...new Set([...(state.lifecycle_triggers ?? []), ...originalFlow.triggers.map((trigger: any) => trigger.kind)])];
    }
    contracts.change_unit = { change_unit_ref: cuPaths.createChangeUnitRef(unit),
      predicate_mappings: unit.changeUnit.target_predicates.map((row: any) => ({ predicate_id: row.predicate_id, implementation_refs, test_refs })),
      provide_mappings: unit.changeUnit.provides.map((row: any) => ({ provide_id: row.provide_id, implementation_refs, test_refs })),
      design_ref_mappings: unit.changeUnit.design_refs.map((design_ref: any) => ({ design_ref, implementation_refs, verification_refs: test_refs })) };
    yaml(root, `${base}/contracts.yaml`, contracts);
    if (result.artifacts?.['use-cases@1']) yaml(root, `${base}/use-cases.yaml`, result.artifacts['use-cases@1']);
    const ui = YAML.parse(fs.readFileSync(path.join(root, base, 'spec/ui-spec.yaml'), 'utf8'));
    const owners: Record<string, string> = { type: 'BankTypeSheet', card: 'BankCardSelectionPage', otp: 'OtpSheet', result: 'AddCardResultPage', entry: 'AddBankCardPage', banks: 'AllBanksPage', home: 'HomeTabPage' };
    yaml(root, `${base}/plan/visual-parity.yaml`, { schema_version: '1.0', feature: context.feature, mappings: {
      tokens: [{ ui_spec_key: 'neutral', contract_resource_key: 'neutral' }], assets: [],
      components: ui.screens.flatMap((screen: any) => [screen.id, screen.root.id, ...screen.root.children.map((node: any) => node.id)]
        .map(ui_spec_node_id => ({ ui_spec_node_id, contract_component: owners[screen.id] }))) } });
  }
  if (!inputsOnly && context.chain.includes('coding')) {
    const original = fs.readFileSync(path.join(FIXTURE, 'BankCardFlow.ts'), 'utf8');
    write(root, CARD_CORE, defective ? original.replace('this.submitting = true;', 'this.submitting = "wrong";') : original);
    const etsRoot = '02-Feature/WalletMain/src/main/ets';
    write(root, `${etsRoot}/domain/flow/OpenCardFlow.ets`, "export { OpenCardFlow } from './BankCardFlow';\n");
    const bridgeFile = `${etsRoot}/shared/HomeLaunchBridge.ets`, moveFile = `${etsRoot}/domain/flow/LaunchHomeCardMode.ets`;
    const prior = fs.readFileSync(path.join(root, bridgeFile), 'utf8');
    if (prior.includes('applyLaunchHomeCardMode')) write(root, moveFile, prior.split("'../data/").join("'../../data/"));
    write(root, bridgeFile, 'export class HomeLaunchBridge {\n  private static pending: string | undefined;\n  private static listeners: Set<() => void> = new Set();\n  static publishAddedCard(value: string): void { HomeLaunchBridge.pending=value; HomeLaunchBridge.listeners.forEach(fn=>fn()); }\n  static consumeAddedCard(): string | undefined { const value=HomeLaunchBridge.pending; HomeLaunchBridge.pending=undefined; return value; }\n  static subscribeAddedCard(fn: () => void): void { HomeLaunchBridge.listeners.add(fn); fn(); }\n  static unsubscribeAddedCard(fn: () => void): void { HomeLaunchBridge.listeners.delete(fn); }\n}\n');
    const indexFile = `${etsRoot}/index.ets`;
    let moduleExports = fs.readFileSync(path.join(root, indexFile), 'utf8').replace("'./shared/HomeLaunchBridge'", "'./domain/flow/LaunchHomeCardMode'");
    for (const [symbol, module] of [['HomeLaunchBridge', './shared/HomeLaunchBridge'], ['buildBankCardSelectionPage', './presentation/pages/BankCardSelectionPage'], ['buildAddCardResultPage', './presentation/pages/AddCardResultPage']]) {
      if (!moduleExports.includes(`{ ${symbol} }`)) moduleExports += `\nexport { ${symbol} } from '${module}';\n`;
    }
    write(root, indexFile, moduleExports);
    const phone = '01-Product/Phone/src/main/ets/pages/index.ets';
    let consumer = fs.readFileSync(path.join(root, phone), 'utf8');
    if (!consumer.includes('buildBankCardSelectionPage')) consumer = consumer.replace('  buildAddBankCardPage,', '  buildBankCardSelectionPage,\n  buildAddCardResultPage,\n  buildAddBankCardPage,')
      .replace("    if (name === 'CardPackPage') {", "    if (name === 'BankCardSelectionPage') { buildBankCardSelectionPage(_param); } else if (name === 'AddCardResultPage') { buildAddCardResultPage(_param); } else if (name === 'CardPackPage') {");
    write(root, phone, consumer);
    const service = '04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets';
    let account = fs.readFileSync(path.join(root, service), 'utf8');
    if (!account.includes('getMockPhone')) { const end = account.lastIndexOf('}'); account = account.slice(0, end) + "  async getMockPhone(): Promise<string> { return '13800138000'; }\n" + account.slice(end); }
    write(root, service, account);
    for (const [name, module, fields] of [['BankCard', 'data/model', blueprint.blueprint.design_views.find((v: any) => v.view_id === 'development').nodes[0].contracts.data_models[0].fields],
      ['SaveResult', 'data/model', [{ name: 'success', type: 'boolean' }]], ['AddCardResultParams', 'data/model', [{ name: 'fullCardNumber', type: 'string' }, { name: 'success', type: 'boolean' }]]] as any[]) {
      write(root, `${etsRoot}/${module}/${name}.ets`, `export interface ${name} {\n` + fields.map((f: any) => `  ${f.name}: ${f.type};\n`).join('') + '}\n');
    }
    // Native UI source is present for integration checks, but explicitly not compiled by this Node environment.
    const nativePages = [['BankTypeSheet', 'presentation/components'], ['OtpSheet', 'presentation/components'], ['BankCardSelectionPage', 'presentation/pages'], ['AddCardResultPage', 'presentation/pages']];
    for (const [name, directory] of nativePages) {
      const accountImport = name === 'OtpSheet' ? "import { AccountService } from '@aspect/AccountManager';\n" : '';
      const accountMethod = name === 'OtpSheet' ? '  async loadPhone(): Promise<string> { return AccountService.getInstance().getMockPhone(); }\n' : '';
      const builder = name.endsWith('Page') ? `\n@Builder\nexport function build${name}(_param: Object) { ${name}() }\n` : '';
      write(root, `${etsRoot}/${directory}/${name}.ets`, accountImport + `@Component\nexport struct ${name} {\n${accountMethod}  build() { Column() { Text('${name}') } }\n}\n` + builder);
    }
  }
  if (!inputsOnly && context.chain.includes('review')) writeA21473ReplayReview(root, frameworkRoot, context.feature);
  if (!inputsOnly && context.chain.includes('ut')) {
    const tests = fs.readFileSync(path.join(FIXTURE, 'BankCardFlow.test.ts'), 'utf8').replace('../main/OpenCardFlow', '../main/ets/domain/flow/BankCardFlow');
    write(root, CARD_TEST, tests);
    const declared = blueprint.blueprint.design_views.find((v: any) => v.view_id === 'development').nodes.find((n: any) => n.node_id === 'implementation').contracts.interfaces;
    yaml(root, `${base}/ut/mock-plan.yaml`, { schema_version: '1.1', feature: context.feature,
      spies: declared.filter((row: any) => ['CardRepository','BankRepository','AccountService'].includes(row.class)).map((row: any) => ({ target_class: row.class,
        target_file: row.file, strategy: 'fake', methods: row.methods.map((method: any) => ({ name: method.name })) })) });
    write(root, `${base}/ut/testability-audit.md`, '```yaml\n' + YAML.stringify({ records: [...acceptance.criteria, ...acceptance.boundaries].map((ac: any) => ({ acceptance_id: ac.id,
      entry_point: { file: CARD_CORE, symbol: 'OpenCardFlow.confirmOtp' }, testability_level: 'L1', dependencies: [{ name: 'CardRepository', kind: 'external' }], verdict: 'testable' })) }) + '```\n');
    write(root, `${base}/ut/reports/coverage-evidence.json`, JSON.stringify({ schema_version: '1.0', feature: context.feature, primary_evidence_source: 'ut_tags', sources: { ut_tags: [CARD_TEST] },
      mappings: [...acceptance.criteria, ...acceptance.boundaries].map((row: any) => ({ scope_id: row.id, scope_kind: row.id.startsWith('BD') ? 'boundary' : 'acceptance_criterion', evidence_source: 'ut_tags' })) }));
    yaml(root, `${base}/ut/reports/flow-dag/bank-card-opening.dag.yaml`, { flow_id: 'bank_card_opening', flow_name: '银行卡开卡', module: 'WalletMain', use_case: 'open_card', branches: ['success', 'save_failure', 'invalid_otp', 'cancel'],
      linked_acceptance: acceptance.criteria.map((ac: any) => ac.id), entry_point: { module: 'WalletMain', file: CARD_CORE, function: 'confirmOtp' }, nodes: [
        { id: 'save', type: 'code_execution', description: '真实存储和结果路由', source: { file: CARD_CORE, class: 'OpenCardFlow', function: 'confirmOtp' }, next: ['result'] },
        { id: 'result', type: 'assertion', description: '完整卡号与结果', linked_acceptance: acceptance.criteria.map((ac: any) => ac.id), assertions: [{ type: 'state_check', target: 'result', expected: 'source card and actual persisted result' }], next: [] }] });
    yaml(root, `${base}/ut/reports/flow-dag/reenter-card.dag.yaml`, { flow_id: 'reenter_card', flow_name: '保留原导航入口', module: 'WalletMain', use_case: 'reenter_card', branches: ['reenter'],
      linked_acceptance: ['AC-6'], entry_point: {module:'WalletMain',file:CARD_CORE,function:'enter'}, nodes: [
        {id:'enter',type:'code_execution',description:'沿同一导航栈进入',source:{file:CARD_CORE,class:'OpenCardFlow',function:'enter'},next:['retained']},
        {id:'retained',type:'assertion',description:'既有页面仍可往返',linked_acceptance:['AC-6'],assertions:[{type:'state_check',target:'stack',expected:'legacy paths remain reachable'}],next:[]}] });
  }
  if (context.chain.includes('testing')) {
    const testCases = acceptance.criteria.map((ac: any, index: number) => ({ id: `TC-${String(index + 1).padStart(3, '0')}`, ac }));
    testCases.push({ id: 'TC-008', ac: acceptance.criteria[0] });
    const actions: Record<string, any[]> = {
      home: [], entry: [{ touch: { by_id: 'home-add' } }], banks: [{ touch: { by_id: 'home-add' } }, { touch: { by_id: 'entry-bank' } }],
      type: [{ touch: { by_id: 'entry-bank' } }], card: [{ touch: { by_id: 'type-continue' } }],
      otp: [{ touch: { by_id: 'card-next' } }], result: [{ touch: { by_id: 'otp-next' } }],
    };
    const ui = YAML.parse(fs.readFileSync(path.join(root, base, 'spec/ui-spec.yaml'), 'utf8'));
    const capture = require(path.join(frameworkRoot, 'profiles/hmos-app/harness/visual-diff-capture'));
    const targets = require(path.join(frameworkRoot, 'profiles/hmos-app/harness/visual-diff-targets'));
    const screens = [...capture.collectP0CaptureTargets(ui).filter((screen: any) => !targets.isOverlayRootScreen(screen)).map((screen: any) => ({ id: screen.id, parentScreenId: screen.id })), ...targets.collectP0OverlayTargetIds(ui)];
    const nav = { schema_version: '2.0', screens: Object.fromEntries(screens.map(({ id, parentScreenId }: any) => [id, {
      steps: actions[parentScreenId], identity: { all_of: [{ id: parentScreenId + '-' + ({ home: 'card', entry: 'bank', banks: 'bank', type: 'bank', card: 'masked-cards', otp: 'phone', result: 'status' } as Record<string,string>)[parentScreenId] }] },
    }])) };
    assert(require(path.join(frameworkRoot, 'profiles/hmos-app/harness/visual-diff-nav')).validateNavConfigV2(nav, screens.map((screen: any) => screen.id), { requireConfirmedIdentity: true }).ok, 'author navigation uses actual canonical capture targets');
    write(root, `${base}/device-testing/visual-diff-nav.json`, JSON.stringify(nav));
    const flow = Object.fromEntries(testCases.map((row: any) => [row.id, { precondition: { kind: 'fresh_app', reset: 'restart' } }]));
    const header = '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |\n|---|---|---|---|---|---|---|---|\n';
    const rows = testCases.map(({id,ac}: any) => `| ${id} | ${ac.description} | 冷启动 | 按原验收操作并核实${ac.id} | ${ac.expected_result} | ${ac.priority} | ${ac.id} | hylyre |`).join('\n');
    write(root, `${base}/testing/test-plan.md`, '# 开发组合回放测试计划\n\n## 1. 测试范围\n原需求的7条AC；本地设备动作为可执行替身，不是真机验收。\n```yaml\n' + YAML.stringify({test_case_flow:flow}) + '```\n## 2. 测试环境\n隔离Node开发环境；未连接设备。\n## 3. 测试策略\nTSC与Node断言真实执行，设备协议只验消费链；不伪造截图。\n## 4. 测试用例清单\n' + header + rows + '\n## 5. 通过标准\nP0通过率100%，总体通过率≥95%，无BLOCKER。原始必选项由生产判定，失败不抹除。\n## 6. 风险与依赖\n像素、布局与原生UI/真机未验证，真实质量由t5核实。\n', inputsOnly);
    const hint = spawnSync(process.execPath, [path.join(frameworkRoot, 'harness/node_modules/ts-node/dist/bin.js'), '--transpile-only',
      path.join(frameworkRoot, 'harness/scripts/derive-hylyre-plan-hint.ts'), '--feature', context.feature, '--project-root', root],
    { cwd: path.join(frameworkRoot, 'harness'), env: { ...process.env, ...context.childEnv }, encoding: 'utf8', windowsHide: true });
    assert.equal(hint.status, 0, hint.stderr + hint.stdout);
    const derivedHeader = '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | entry_ui | calls | linked_flow |\n|---|---|---|---|---|---|---|---|---|---|\n';
    const derived = testCases.map(({id,ac}: any) => {
      const cp = ac.checkpoint;
      const steps = [{touch:{by_id:cp.action.target_element_id}}, ...cp.required_element_ids.map((value: string) => ({wait_for:{by_id:value,timeout:10}}))].map(value=>JSON.stringify(value)).join('; ');
      return `| ${id} | ${ac.description} | 冷启动 | ${steps} | ${ac.expected_result} | ${ac.priority} | ${ac.id} | ${id === 'TC-008' ? 'AllBanksPage' : 'AddBankCardPage'} | flow.selectBank | ${ac.linked_flow} |`;
    }).join('\n');
    write(root, `${base}/testing/reports/20261107-node-replay/hylyre/test-plan.hylyre.md`, '# 开发替身派生计划\n\n## 测试用例清单\n\n' + derivedHeader + derived + '\n', inputsOnly);
  }
  const facts = path.join(root, base, 'context/facts.md');
  assert(context.factsContext, 'research uses the real admitted context');
  const stageContracts = fs.existsSync(path.join(root, base, 'contracts.yaml')) ? YAML.parse(fs.readFileSync(path.join(root, base, 'contracts.yaml'), 'utf8')) : {};
  const inputs = [...new Set<string>([...context.factsContext.source_paths, ...(stageContracts.files ?? []), CARD_CORE, CARD_TEST,
    '02-Feature/WalletMain/src/main/ets/domain/flow/LaunchHomeCardMode.ets', 'build-profile.json5',
    '01-Product/Phone/src/main/module.json5', '02-Feature/WalletMain/src/main/module.json5',
    'doc/architecture.md', 'doc/module-catalog.yaml', 'doc/glossary.yaml'])]
    .filter(file => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile());
  for (const file of inputs) fs.readFileSync(path.join(root, file));
  for (const query of ['CardRepository', 'BankRepository', 'NavPathContext', 'HomeLaunchBridge', 'getMockPhone', 'BankCard']) {
    inputs.filter(file => /\.(md|ets|ts|yaml)$/.test(file)).filter(file => fs.readFileSync(path.join(root, file), 'utf8').includes(query));
  }
  if (!fs.existsSync(facts) || inputsOnly) {
    const code = inputs.filter(file => /\.(ets|ts)$/.test(file));
    write(root, path.relative(root, facts), '---\n' + YAML.stringify({ schema_version: '1.1', feature: context.feature, run_id: context.runId,
      established_by: context.factsContext.first_phase, ready_to_produce: true, has_blocker_coverage_risk: false, exploration_mode: 'sequential',
      key_inputs_read: inputs, source_code_paths: code, files_inspected_count: inputs.length, searches_performed_estimate: 6, subagents_used: 'none',
      decisions_unlocked: ['original bank-card request and current repair'] }) + '---\n## Code Facts\n' + code.slice(0, 10).map(file => `- ${file}: ${fs.readFileSync(path.join(root, file), 'utf8').split('\n')[0]}\n`).join(''));
  }
  for (const phase of context.chain) researchSnapshotFacts(root, facts, phase, context.factsContext);
  // Check construction addresses before expensive tools; this is not execution or completion proof.
  const closureInputs = load('scripts/utils/component-closure-inputs').resolveComponentClosureInputs(root, 'bc-openCard-2');
  const obligations = load('scripts/utils/component-closure-obligations').deriveComponentClosureObligations(root, closureInputs);
  const rows = load('scripts/utils/component-closure-coverage').deriveComponentClosureCoverage(root, closureInputs, obligations);
  const missing = obligations.filter((item: any) => item.required && item.mapping_kind !== 'fact').filter((item: any) => {
    const row = rows.find((value: any) => value.obligation_id === item.obligation_id);
    return !row?.feature_mapping_refs.length || !row?.evidence_identities.length;
  });
  assert.equal(missing.length, 0, 'author construction addresses: ' + JSON.stringify(missing.map((item: any) => item.obligation_id)));
  const runtimeIssues = load('scripts/utils/component-closure-runtime').validateComponentClosureRuntime(root, closureInputs, rows);
  assert.equal(runtimeIssues.length, 0, 'author runtime mappings: ' + JSON.stringify(runtimeIssues));
}

export function answerA21473Verifier(root: string, frameworkRoot: string, context: any): void {
  const harnessDir = path.join(frameworkRoot, 'harness'), load = (file: string): any => require(path.join(harnessDir, file));
  const phase = context.phase.replace(/-verifier-format-repair$/, '');
  const reportsDir = load('config').featurePhaseReportsDir(root, context.feature, phase, frameworkRoot);
  const summary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8'));
  const script = JSON.parse(fs.readFileSync(path.join(reportsDir, 'script-report.json'), 'utf8'));
  const request = readDeliveredVerifierRequest({ root, frameworkRoot, harnessDir, feature: context.feature, module: 'WalletMain', modulePath: '02-Feature/WalletMain' },
    { phase: context.phase, prompt: context.instruction, runId: context.runId });
  assert(request && request.subject_id === summary.verifier_subject_id);
  const material = load('scripts/utils/verifier-material').readVerifierMaterialOrNull(reportsDir, request.subject_id);
  assert(material && material.material_sha256 === request.material_sha256);
  for (const file of material.files) if (file.sha256 !== null) {
    const relative = path.relative(root, path.resolve(root, file.path)); assert(!relative.startsWith('..') && !path.isAbsolute(relative));
    fs.readFileSync(path.resolve(root, file.path));
  }
  let text = '已读当前真实request及material中的原件，核对原需求、canonical设计及当前Node开发投影。机器FAIL全部保留，不把框架/能力缺口称为产品通过；Native UI、布局和像素没有被本替身核实。\n';
  const strength = script.checks.find((check: any) => check.id === 'coding_existing_test_preserved' && check.affected_files?.includes(CARD_TEST));
  if (strength) {
    const before = spawnSync('git', ['cat-file','-e',`HEAD:${CARD_TEST}`], {cwd:root,encoding:'utf8',windowsHide:true});
    assert.notEqual(before.status, 0, 'this specific developer Node test path is absent from the actual isolated Git baseline');
    const expected = fs.readFileSync(path.join(FIXTURE,'BankCardFlow.test.ts'),'utf8').replace('../main/OpenCardFlow','../main/ets/domain/flow/BankCardFlow');
    assert.equal(fs.readFileSync(path.join(root,CARD_TEST),'utf8'),expected,'new assertions are unchanged');
    text += '\n```issue-verification\n' + YAML.stringify([{issue:strength.id,verdict:'refuted',evidence:[CARD_TEST,'真实隔离Git基线没有此新Node路径；当前新增断言未被删弱，不声称原宿主无其它UT。',strength.details].join(' | ')}]) + '```\n';
  }
  if (phase === 'ut') {
    const file=path.join(reportsDir,'node-tests.tap');
    if (fs.existsSync(file)) {
      const tap=fs.readFileSync(file,'utf8');
      const count=Number(tap.match(/^# tests (\d+)$/m)?.[1]??0);
      if (count>0 && /# fail 0\b/.test(tap) && /# skipped 0\b/.test(tap)) text += '| id | status | severity | 证据 |\n|---|---|---|---|\n| end_to_end_driving | PASS | BLOCKER | Node TAP '+count+'/'+count+'，直接执行OpenCardFlow与真实SQLite、OTP和路由断言 |\n| business_assertion_value | PASS | BLOCKER | 原AC/BD的实际返回值与持久化结果逐条断言，Native范围仍未验证 |\n';
    }
  }
  publishFixtureVerifierEvidence({projectRoot:root,feature:context.feature,phase,reportsDir,subjectId:request.subject_id,reportText:text,skipSummaryPatch:true});
}
