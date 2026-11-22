import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { gunzipSync } from 'zlib';
import { createHash } from 'crypto';
import { BlueprintRecord, asRecord, asRecords } from '../../scripts/utils/component-blueprint-model';
import { requiredQuestioningScopes, validateBlueprintQuestioning, independentQuestioningBlockers, normalizeQuestioningItems,
  parseIndependentQuestioningOutput, mergeIndependentQuestioningResult, selectQuestioningScopes, questioningEvidencePath,
  readSignedQuestioningScopes, renderQuestioningResultInstructions } from '../../scripts/utils/blueprint-questioning';
import { questioningDependencyChanges } from '../../scripts/utils/design-repair-unattended';
import { readCurrentDispositionInput } from '../../scripts/utils/verify-feature-completion';
import { resolveCurrentDisposition } from '../../scripts/utils/check-disposition';
import { capturePhaseInvocationSnapshot } from '../../scripts/utils/phase-write-boundary';
import { clearFrameworkConfigCache } from '../../config';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/component-blueprint');
const validBlueprint = (): BlueprintRecord => YAML.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'valid/doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml'), 'utf8'));
const clone = <T>(value: T): T => structuredClone(value);
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const test = (name: string, run: () => void) => ({ name, run });

export function questioningRecoveryCases() {
  const results: Array<{ name: string; run(): void }> = [];
  results.push(test('3ec91fa7 reads exactly one complete independent JSON fence, including arrays', () => {
    const items = [{ scope_kind: 'view', scope_ref: 'view:runtime', disposition: 'blocker', answer: '原否定' }];
    const fenced = '独立结论\r\n```json\r\n' + JSON.stringify(items) + '\r\n```\r\n';
    assert(JSON.stringify(parseIndependentQuestioningOutput(fenced).items) === JSON.stringify(items), '围栏改变了原条目');
    assert(JSON.stringify(parseIndependentQuestioningOutput(JSON.stringify(items)).items) === JSON.stringify(items), '裸数组旧输入不应变化');
    const shell = '```sh\r\n{ echo diagnostics; }\r\n```\r\n';
    const text = '~~~text\nread the source and report exact evidence\n~~~\n';
    const legacy = '原独立回执\n' + JSON.stringify({ review_summary: { questioning: { items } } }) + '\n';
    const object = '```json\r\n' + JSON.stringify({ items }) + '\r\n```\r\n';
    for (const valid of [shell + object + text, text + fenced + shell, shell + legacy + text]) {
      assert(JSON.stringify(parseIndependentQuestioningOutput(valid).items) === JSON.stringify(items), '无关文本与代码围栏不应触发格式返修');
    }
    const truncated = fenced.replace(/```\r\n$/, '');
    const invalidJson = '~~~json\n{"items":\n~~~\n';
    const extraResult = '```text\n' + JSON.stringify({ items }) + '\n```\n';
    for (const malformed of [fenced + fenced, fenced + extraResult, fenced + legacy, fenced + truncated, truncated + fenced,
      fenced + invalidJson, invalidJson + fenced, truncated, fenced.replace(']', ''), '仅以散文称通过']) {
      let rejected = false;
      try { parseIndependentQuestioningOutput(malformed); } catch { rejected = true; }
      assert(rejected, '歧义、截断或无结构的回执没有交原独立方补格式');
    }
  }));
  results.push(test('a920 questioning dependency changes distinguish internal pointers and derived review bytes from actual source changes', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'questioning-inputs-')));
    try {
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: 'QuestioningInputs',
        project_profile: { name: 'hmos-app' }, paths: { features_dir: 'doc/features' } }));
      clearFrameworkConfigCache();
      const own = path.join(root, 'doc/features/example/blueprint/component-blueprint.yaml');
      const review = path.join(path.dirname(own), 'component-blueprint.review.md');
      fs.mkdirSync(path.dirname(own), { recursive: true }); fs.writeFileSync(own, 'unchanged design input\n');
      const blueprint: BlueprintRecord = { artifact: 'component-blueprint@1', blueprint_id: 'example', component_id: 'component',
        design_views: [{ view_id: 'runtime', runtime_data_flows: [{ flow_id: 'example-flow', initial_load: { source: 'existing contract' } }] }],
        provenance: { source_ref: 'design_views/0/runtime_data_flows/0/initial_load' },
        discovery: { facts: [{ provenance: { source_ref: path.relative(root, review).replace(/\\/g, '/') } }] } };
      const header = '---\nprojection: component-blueprint-review@13\nderived_from:\n  artifact: component-blueprint@1\n  blueprint_id: example\n  component_id: component\n---\n';
      fs.writeFileSync(review, header + 'previous review display\n');
      const pre = capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: ['doc'], executionRole: 'verifier' });
      fs.writeFileSync(review, header + 'refreshed questioning display\n');
      assert(questioningDependencyChanges(root, blueprint, pre, own).length === 0, '派生展示或内部位置被当作未知业务文件');
      const missing = clone(blueprint); delete asRecord(asRecords(asRecords(missing.design_views)[0].runtime_data_flows)[0])!.initial_load;
      assert(questioningDependencyChanges(root, missing, pre, own).length === 1, '无法解析的内部位置被无依据忽略');
      fs.writeFileSync(review, '# actual unrelated source document\n');
      assert(questioningDependencyChanges(root, blueprint, pre, own).some(item => item.path === review), '非同源投影的新输入被忽略');
      const external = path.join(path.dirname(root), 'declared-sdk.d.ts');
      const previous = { items: [{ scope_ref: 'view:runtime', evidence_refs: [external + '#method'] }] };
      const unknown = questioningDependencyChanges(root, { ...blueprint, discovery: {} }, pre, own, undefined, previous);
      assert(unknown.length === 1 && questioningEvidencePath(unknown[0].path) === questioningEvidencePath(external)
        && unknown[0].exists === undefined && unknown[0].state === 'unknown' && unknown[0].sha256 === null, '仓外证据必须保留未知，不能擅自读取或声称不存在');
      const outside = questioningDependencyChanges(root, { ...blueprint, discovery: {} }, pre, own, undefined,
        { items: [{ scope_ref: 'view:runtime', evidence_refs: ['../declared-sdk.d.ts#method'] }] });
      assert(outside.length === 1 && outside[0].state === 'unknown', '仓外相对引用不能静默丢失');
      const internalRef = '/design_views/0/runtime_data_flows/0/initial_load';
      assert(questioningDependencyChanges(root, { ...blueprint, discovery: {} }, pre, own, undefined,
        { items: [{ scope_ref: 'view:runtime', evidence_refs: [internalRef] }] }).length === 0,
      '合法 JSON Pointer 被当作 Windows 盘根或 POSIX 绝对文件');
      const sameName = path.join(root, internalRef);
      fs.mkdirSync(path.dirname(sameName), { recursive: true }); fs.writeFileSync(sameName, 'an actual separate dependency');
      const actualPath = path.relative(root, sameName).replace(/\\/g, '/');
      assert(questioningDependencyChanges(root, { ...blueprint, discovery: {} }, pre, own, undefined,
        { items: [{ scope_ref: 'view:runtime', evidence_refs: [internalRef, actualPath + '#content'] }] })
        .some(item => item.path === sameName && item.exists === true), '同名真实文件依赖被内部引用吞掉');
      const posix = questioningDependencyChanges(root, { ...blueprint, discovery: {}, provenance: {} }, pre, own, undefined,
        { items: [{ scope_ref: 'view:runtime', evidence_refs: ['/external/sdk/read-only.md'] }] });
      assert(posix.length === 1 && posix[0].state === 'unknown', '外部 POSIX 绝对引用被当作蓝图指针');
      assert(questioningEvidencePath('D:\\sdk\\api.d.ts:12#method') === 'd:/sdk/api.d.ts', 'Windows盘符被当成协议或行号');
      const canonical = 'doc/features/example/blueprint/component-blueprint.yaml';
      const self = { ...blueprint, discovery: {}, provenance: { source_ref: canonical + '#/design_views/0' } };
      assert(questioningDependencyChanges(root, self, pre, path.join(root, 'candidate.yaml')).length === 0, '同一蓝图的canonical引用被当作整文件变动');
      assert(questioningDependencyChanges(root, { ...self, provenance: { source_ref: path.join(root, canonical) + '#/design_views/0' } }, pre,
        path.join(root, 'candidate.yaml')).length === 0, 'canonical绝对引用的盘符大小写不能改变对象身份');
    } finally { assert(root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep), '临时根越界'); fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  }));
  results.push(test('a920 independent questioning replays exact i2 alias and i5 placeholder without losing five blockers', () => {
    const root = path.join(FIXTURE_ROOT, '../host-recovery-history/20261115-design-recovery');
    const source = JSON.parse(fs.readFileSync(path.join(root, 'questioning-sources.json'), 'utf8'));
    for (const number of [2, 5]) {
      const bytes = gunzipSync(fs.readFileSync(path.join(root, `questioning-i${number}.json.gz`)));
      const expected = source.files.find((file: BlueprintRecord) => file.stored === `questioning-i${number}.json.gz`);
      assert(createHash('sha256').update(bytes).digest('hex') === expected.sha256, '宿主原返回字节被改写');
      const blueprint = JSON.parse(fs.readFileSync(path.join(root, `questioning-i${number}-scopes.json`), 'utf8'));
      const original = parseIndependentQuestioningOutput(bytes.toString('utf8'));
      const normalized = mergeIndependentQuestioningResult(blueprint, original, 'actual-independent');
      const errors = validateBlueprintQuestioning({ ...blueprint, review_summary: { ...blueprint.review_summary, questioning: normalized } });
      assert(errors.every(error => error.id === 'blueprint_admission_false_pass'), JSON.stringify(errors));
      assert(asRecords(normalized.items).length === requiredQuestioningScopes(blueprint).size, '未恢复完整唯一覆盖');
      if (number === 2) assert(asRecords(normalized.items).some(item => item.scope_ref === 'flow:flow-card-open-run'), '唯一flow地址未归一');
      if (number === 5) {
        const denied = independentQuestioningBlockers({ review_summary: { questioning: normalized } }).map(item => item.scope_ref).sort();
        assert(JSON.stringify(denied) === JSON.stringify(['app_lens:feature_flags', 'app_lens:initialization', 'flow:flow-card-open-run', 'view:development', 'view:scenarios'].sort()), '真实五条否定丢失');
        const conflict = clone(original);
        const placeholder = asRecords(conflict.items).find(item => item.owner === item.question && asRecord(item.provenance)?.evidence_strength === 'unknown')!;
        placeholder.answer = '有实际证据的独立异议'; placeholder.verification_refs = ['src/real-consumer.ts'];
        assert(normalizeQuestioningItems(blueprint, asRecords(conflict.items)).length === asRecords(original.items).length, '双有效冲突被占位裁剪');
      }
    }
  }));

  results.push(test('7d2c49e8 questioning attaches unique signed bare scopes and sends unattached denials back to verification', () => {
    const blueprint = validBlueprint();
    const prior = asRecord(asRecord(blueprint.review_summary)?.questioning)!;
    const ref = 'view:logical', flow = 'flow:ledger-refresh-flow';
    const signed = readSignedQuestioningScopes(renderQuestioningResultInstructions(blueprint, 'independent-q', [ref]));
    assert(signed?.size === 1 && signed.get(ref)?.kind === 'view', 'scope must come from the frozen request lines');
    const answer: BlueprintRecord = { ...asRecords(prior.items).find(item => item.scope_ref === ref), scope_ref: 'logical', disposition: 'blocker' };
    delete answer.question_id;
    const bytes = JSON.stringify(answer);
    const attached = normalizeQuestioningItems(blueprint, [answer], signed);
    assert(attached[0].scope_ref === ref && attached[0].disposition === 'blocker' && JSON.stringify(answer) === bytes,
      'signed attachment must retain independent denial and raw bytes');
    const forged = { ...answer, question_id: 'q:forged' };
    const unsigned = { ...answer, scope_kind: 'flow', scope_ref: 'ledger-refresh-flow' };
    const invalid = normalizeQuestioningItems(blueprint, [forged, unsigned], signed);
    assert(invalid[0].scope_ref === 'logical' && invalid[1].scope_ref !== flow, 'forged and unsigned answers must stay unattached');
    const conflict = normalizeQuestioningItems(blueprint, [answer, { ...answer, scope_ref: ref, disposition: 'answered_with_evidence' }], signed);
    assert(conflict.length === 2 && conflict[0].scope_ref === 'logical', 'conflicting claims must retain their original attachment');
    const report = mergeIndependentQuestioningResult(blueprint, { items: [forged] }, 'independent-q', undefined, undefined, undefined, signed);
    const current = { ...blueprint, review_summary: { ...asRecord(blueprint.review_summary), questioning: report } };
    const disposition = resolveCurrentDisposition(readCurrentDispositionInput({ endpoint: 'design', projectRoot: FIXTURE_ROOT,
      blueprintPath: path.join(FIXTURE_ROOT, 'component-blueprint.yaml'), blueprint: current, blueprintIssues: validateBlueprintQuestioning(current),
      questioningFindings: independentQuestioningBlockers(current) }));
    assert(disposition.completionBlocking.some(problem => problem.id.includes('blueprint_questioning_scope_invalid'))
      && disposition.completionBlocking.every(problem => problem.action === 'verify'), 'unattached denial must keep the verification gap without becoming author work');
  }));

  results.push(test('a920 independent questioning scopes follow structural dependencies and retain item original references', () => {
    const before = validBlueprint(), current = clone(before);
    const previous = asRecord(asRecord(before.review_summary)?.questioning)!;
    for (const item of asRecords(previous.items)) item.review_original = { path: 'original-q.json', sha256: 'old-source' };
    const view = asRecords(current.design_views).find(item => item.view_id === 'scenarios')!;
    view.purpose = '仅场景视图内的真实变更';
    const selected = selectQuestioningScopes(before, current, previous);
    assert(selected.includes('view:scenarios') && selected.length < requiredQuestioningScopes(current).size, JSON.stringify(selected));
    const guideBefore = clone(before), guideAfter = clone(before);
    asRecord(guideBefore.review_summary)!.reader_guide = { source_digest: 'old', sections: [] };
    asRecord(guideAfter.review_summary)!.reader_guide = { source_digest: 'new', sections: [] };
    assert(selectQuestioningScopes(guideBefore, guideAfter, previous).length === 0, '说明摘要刷新冒充全设计变更');
    asRecord(guideAfter.review_summary)!.reader_guide = { source_digest: 'new', sections: [{ prose: '只改运行时说明', source_refs: ['/design_views/1'] }] };
    const guideScopes = selectQuestioningScopes(guideBefore, guideAfter, previous);
    assert(guideScopes.length === 1 && guideScopes[0] === 'view:runtime', '说明改动未沿实际来源定位');
    const fresh = asRecords(previous.items).filter(item => selected.includes(String(item.scope_ref))).map(item => ({ ...item, answer: '已独立复核改动', review_original: { path: 'forged', sha256: 'forged' } }));
    const result = mergeIndependentQuestioningResult(current, { items: fresh }, 'independent-q', previous, selected, { path: 'next-q.json', sha256: 'new-source' });
    assert(validateBlueprintQuestioning({ ...current, review_summary: { ...asRecord(current.review_summary), questioning: result } }).length === 0, '局部交回未合并完整清单');
    for (const item of asRecords(result.items)) assert(asRecord(item.review_original)?.path === (selected.includes(String(item.scope_ref)) ? 'next-q.json' : 'original-q.json'), '把复用项冒充本轮新评');
    const missing = mergeIndependentQuestioningResult(current, { items: [] }, 'independent-q', previous, selected);
    assert(validateBlueprintQuestioning({ ...current, review_summary: { ...asRecord(current.review_summary), questioning: missing } }).some(error => error.id === 'blueprint_questioning_coverage_missing'), '缺少本轮复核仍放行');
    const reopened = clone(previous); asRecords(reopened.items)[0].disposition = 'open_decision';
    assert(selectQuestioningScopes(before, before, reopened).includes(String(asRecords(reopened.items)[0].scope_ref)), '未决项被复用');
    const source = String(asRecord(asRecords(previous.items)[0].provenance)?.source_ref);
    assert(selectQuestioningScopes(before, before, previous, [source]).includes(String(asRecords(previous.items)[0].scope_ref)), '证据变更未重开');
    assert(selectQuestioningScopes(before, before, previous, ['new-unmapped-evidence.ts']).length === requiredQuestioningScopes(before).size, '依赖不可证明未变却被复用');
    const dependencyBefore = clone(before), dependencyAfter = clone(before);
    const runtime = asRecords(dependencyAfter.design_views).find(item => item.view_id === 'runtime')!;
    const flow = asRecords(runtime.runtime_data_flows)[0];
    const app = asRecord(dependencyBefore.app_lens)!;
    app.ui_refresh = { ...asRecord(app.ui_refresh), flow_ref: `flow:${flow.flow_id}` };
    dependencyAfter.app_lens = clone(app); flow.description = '实际发布/消费行为改变';
    const consumers = selectQuestioningScopes(dependencyBefore, dependencyAfter, previous);
    assert(consumers.includes(`flow:${flow.flow_id}`) && consumers.includes('view:runtime') && consumers.includes('app_lens:ui_refresh'), '显式关联消费者没有纳入复核');
    const extra = asRecords(previous.items).find(item => !selected.includes(String(item.scope_ref)))!;
    const withNewEvidence = mergeIndependentQuestioningResult(current, { items: [...fresh, { ...extra, disposition: 'blocker', answer: '本轮具体新证据', verification_refs: ['src/new-evidence.ts'] }] }, 'independent-q', previous, selected);
    assert(independentQuestioningBlockers({ review_summary: { questioning: withNewEvidence } }).length === 1, '新独立异议没有重开');
  }));

  results.push(test('a920 global authority changes follow typed identities, old and new consumers and transitive scope references', () => {
    const sample = (): { before: Record<string, any>; previous: BlueprintRecord } => {
      const before: Record<string, any> = {
        design_views: [
          { view_id: 'logical', applicability: 'applicable', evolution_impact: 'changed', nodes: [{ node_id: 'logical-object' }] },
          { view_id: 'runtime', applicability: 'applicable', evolution_impact: 'changed', runtime_data_flows: [{ flow_id: 'target-flow' }] },
          { view_id: 'development', applicability: 'applicable', evolution_impact: 'changed', nodes: [] },
          { view_id: 'scenarios', applicability: 'applicable', evolution_impact: 'changed', nodes: [] },
        ],
        decisions_and_gaps: { decisions: [], gaps: [] }, contracts: [], discovery: { facts: [] },
        quality_attributes: [], data_domains: [], app_lens: { ui_refresh: { flow_ref: 'flow:target-flow' } },
      };
      const provenance = clone(validBlueprint().provenance);
      const previous: BlueprintRecord = { status: 'complete', provider_id: 'independent', isolated_context: true, writes_ssot: false,
        items: [...requiredQuestioningScopes(before)].map(([ref, kind]) => ({ question_id: `q-${ref}`, scope_ref: ref, scope_kind: kind,
          question: '核实该范围', owner: 'independent', disposition: 'answered_with_evidence', answer: '已核实',
          evidence_refs: ['src/original.ts'], verification_refs: ['verify:scope'], provenance })) };
      assert(validateBlueprintQuestioning({ ...before, review_summary: { questioning: previous } }).length === 0, '测试前轮质询无效');
      return { before, previous };
    };
    const expect = (actual: string[], expected: string[], why: string): void => {
      assert(JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), `${why}: ${JSON.stringify(actual)}`);
    };
    {
      const { before, previous } = sample();
      const finding = asRecords(previous.items).find(item => item.scope_ref === 'flow:target-flow')!;
      for (const disposition of ['blocker', 'open_decision']) {
        finding.disposition = disposition;
        expect(selectQuestioningScopes(before, before, previous), ['flow:target-flow'], '旧问题仍复核，只有事实变化传播给消费者');
      }
      const current = clone(before);
      current.design_views[1].runtime_data_flows[0].description = '本轮修改实际分发触发条件';
      expect(selectQuestioningScopes(before, current, previous), ['view:runtime', 'flow:target-flow', 'app_lens:ui_refresh'], '生产事实变化仍沿显式引用传播');
    }
    const entries = [
      { section: 'decisions_and_gaps', key: 'decisions', id: 'decision_id', kind: 'decision' },
      { section: 'decisions_and_gaps', key: 'gaps', id: 'gap_id', kind: 'gap' },
      { key: 'contracts', id: 'contract_id', kind: 'contract' },
      { section: 'discovery', key: 'facts', id: 'fact_id', kind: 'fact' },
      { key: 'quality_attributes', id: 'qa_id', kind: 'qa' },
      { key: 'data_domains', id: 'data_domain_id', kind: 'data-domain' },
    ];
    for (const entry of entries) {
      const { before, previous } = sample();
      const container = entry.section ? asRecord(before[entry.section])! : before;
      container[entry.key] = [{ [entry.id]: 'changed-object', value: 'old' }];
      asRecords(asRecords(before.design_views)[1].runtime_data_flows)[0].authority_refs = [`${entry.kind}:changed-object`];
      const current = clone(before);
      const rows = entry.section ? asRecord(current[entry.section])! : current;
      asRecords(rows[entry.key])[0].value = 'new';
      expect(selectQuestioningScopes(before, current, previous), ['view:runtime', 'flow:target-flow', 'app_lens:ui_refresh'], entry.kind);
      const missingId = clone(current); delete asRecords((entry.section ? asRecord(missingId[entry.section])! : missingId)[entry.key])[0][entry.id];
      expect(selectQuestioningScopes(before, missingId, previous), [...requiredQuestioningScopes(current).keys()], '缺少稳定ID保守全量');
      const duplicate = clone(current), duplicateRows = (entry.section ? asRecord(duplicate[entry.section])! : duplicate)[entry.key] as BlueprintRecord[];
      duplicateRows.push({ ...duplicateRows[0], value: 'conflicting' });
      expect(selectQuestioningScopes(before, duplicate, previous), [...requiredQuestioningScopes(current).keys()], '重复权威ID保守全量');
      const unlocatedBefore = clone(before), unlocatedAfter = clone(current);
      delete asRecords(asRecords(unlocatedBefore.design_views)[1].runtime_data_flows)[0].authority_refs;
      delete asRecords(asRecords(unlocatedAfter.design_views)[1].runtime_data_flows)[0].authority_refs;
      expect(selectQuestioningScopes(unlocatedBefore, unlocatedAfter, previous), [...requiredQuestioningScopes(current).keys()], '变动权威无消费者保守全量');
    }
    {
      const { before, previous } = sample();
      before.contracts = [{ contract_id: 'external', value: 'old', source_ref: 'contracts/authority.yaml' }];
      asRecords(asRecords(before.design_views)[1].runtime_data_flows)[0].contract_refs = ['contract:external'];
      const current = clone(before); asRecords(current.contracts)[0].value = 'new';
      expect(selectQuestioningScopes(before, current, previous), ['view:runtime', 'flow:target-flow', 'app_lens:ui_refresh'], 'contracts目录的真实文件不能误判成内部指针');
      const addedBefore = clone(before), addedAfter = clone(before);
      delete addedBefore.decisions_and_gaps; addedAfter.decisions_and_gaps.decisions = [{ decision_id: 'new-choice', landing: 'view:logical' }];
      expect(selectQuestioningScopes(addedBefore, addedAfter, previous), ['view:logical'], '首次加入可定位权威集合无需全量');
    }
    {
      const { before, previous } = sample();
      before.contracts = [{ contract_id: 'store', value: 'old' }];
      before.decisions_and_gaps.decisions = [{ decision_id: 'choice', contract_refs: ['contract:store'], landing: 'view:logical/node:logical-object' }];
      const current = clone(before); asRecords(current.contracts)[0].value = 'new';
      expect(selectQuestioningScopes(before, current, previous), ['view:logical'], '权威到权威到scope的传递消费者');
      asRecords(current.contracts)[0].value = 'old';
      before.decisions_and_gaps.decisions[0].landing = 'view:runtime/flow:target-flow';
      expect(selectQuestioningScopes(before, current, previous), ['view:logical', 'view:runtime', 'flow:target-flow', 'app_lens:ui_refresh'], '保留变动权威前后落点');
    }
    {
      const { before, previous } = sample();
      before.decisions_and_gaps.decisions = [{ decision_id: 'feature-choice', landing: 'app_lens:feature_flags', value: 'old' }];
      const current = clone(before); current.decisions_and_gaps.decisions[0].value = 'new';
      expect(selectQuestioningScopes(before, current, previous), ['app_lens:feature_flags'], '无内嵌ID的lens仍可由稳定scope地址定位');
    }
    {
      const { before, previous } = sample();
      before.discovery.facts = [{ fact_id: 'source-fact', value: 'old', provenance: { source_ref: 'src/authority.ts' } }];
      asRecords(before.design_views)[0].evidence_refs = ['src/authority.ts#object'];
      asRecords(before.design_views)[3].summary = '正文碰巧提及 src/authority.ts';
      const current = clone(before); current.discovery.facts[0].value = 'new';
      expect(selectQuestioningScopes(before, current, previous), ['view:logical'], '结构化证据文件边，不读正文提及');
      delete asRecords(current.design_views)[0].evidence_refs;
      delete asRecords(before.design_views)[0].evidence_refs;
      asRecords(previous.items).find(item => item.scope_ref === 'view:development')!.evidence_refs = ['src/authority.ts:12'];
      expect(selectQuestioningScopes(before, current, previous), ['view:development'], '原质询独立证据文件边');
      asRecords(previous.items).find(item => item.scope_ref === 'view:development')!.evidence_refs = ['other/authority.ts'];
      expect(selectQuestioningScopes(before, current, previous), [...requiredQuestioningScopes(current).keys()], '另一目录同名文件或正文提及不能证明来源消费');
      before.discovery.facts[0].provenance.source_ref = 'authority.yaml'; current.discovery.facts[0].provenance.source_ref = 'authority.yaml';
      asRecords(previous.items).find(item => item.scope_ref === 'view:development')!.evidence_refs = ['authority.yaml'];
      expect(selectQuestioningScopes(before, current, previous), ['view:development'], '根目录合法来源文件仍可定位');
    }
    {
      const { before, previous } = sample();
      before.quality_attributes = [{ qa_id: 'latency', source_ref: 'design_views/1/runtime_data_flows/0', requirement: 'old' }];
      const current = clone(before); asRecords(current.quality_attributes)[0].requirement = 'new';
      expect(selectQuestioningScopes(before, current, previous), ['view:runtime', 'flow:target-flow', 'app_lens:ui_refresh'], 'JSON指针沿实际拥有者定位');
      asRecords(current.quality_attributes)[0].source_ref = 'design_views/99/runtime_data_flows/0';
      expect(selectQuestioningScopes(before, current, previous), [...requiredQuestioningScopes(current).keys()], '当前引用不可解析即使旧落点可定位仍保守全量');
      asRecords(before.quality_attributes)[0].source_ref = 'design_views/99/runtime_data_flows/0';
      expect(selectQuestioningScopes(before, current, previous), [...requiredQuestioningScopes(current).keys()], '无法解析的内部来源保守全量');
    }
    {
      const { before, previous } = sample();
      before.contracts = [{ contract_id: 'shared', value: 'old' }];
      before.decisions_and_gaps.decisions = [{ decision_id: 'shared' }];
      asRecords(before.design_views)[0].contract_refs = ['contract:shared'];
      asRecords(before.design_views)[2].decision_refs = ['decision:shared'];
      const current = clone(before); asRecords(current.contracts)[0].value = 'new';
      expect(selectQuestioningScopes(before, current, previous), ['view:logical'], '有类型ID不与同名其它种类串线');
      asRecords(before.design_views)[0].contract_refs = ['shared']; asRecords(current.design_views)[0].contract_refs = ['shared'];
      expect(selectQuestioningScopes(before, current, previous), ['view:logical'], '裸ID优先消费字段的类型');
      asRecords(before.design_views)[0].authority_refs = ['shared']; asRecords(current.design_views)[0].authority_refs = ['shared'];
      expect(selectQuestioningScopes(before, current, previous), ['view:logical'], '无类型歧义保留实际候选消费者而不全量');
      asRecords(current.contracts)[0].value = 'old';
      asRecords(current.design_views)[3].summary = 'only scenario changed';
      expect(selectQuestioningScopes(before, current, previous), ['view:scenarios'], '无关同名引用不能扩大局部scope变更');
    }
    {
      const { before, previous } = sample();
      before.quality_attributes = [{ qa_id: 'a11y', requirement: 'old', landing: '首页刷新提示与资源颜色', source_ref: 'doc/req.md' }];
      asRecords(before.design_views)[0].evidence_refs = ['doc/req.md'];
      const current = clone(before); current.quality_attributes[0].requirement = 'new';
      expect(selectQuestioningScopes(before, current, previous), [...requiredQuestioningScopes(current).keys()], 'M1自由文字落点不能借另一个scope的同源弱边签局部');
      before.quality_attributes[0].landing = 'view:logical/node:missing'; current.quality_attributes[0].landing = 'view:logical/node:missing';
      expect(selectQuestioningScopes(before, current, previous), [...requiredQuestioningScopes(current).keys()], 'M1已知父view不能替代不存在的精确落点');
      before.quality_attributes[0].landing = 'app_lens:ui_refresh'; current.quality_attributes[0].landing = 'app_lens:ui_refresh';
      before.quality_attributes[0].note = '不作为落点解析的说明'; current.quality_attributes[0].note = '不作为落点解析的说明';
      before.quality_attributes[0].needed_by = 'example:current'; current.quality_attributes[0].needed_by = 'example:current';
      before.quality_attributes[0].component_ref = 'asset:shared-widget'; current.quality_attributes[0].component_ref = 'asset:shared-widget';
      expect(selectQuestioningScopes(before, current, previous), ['app_lens:ui_refresh'], '已定位落点不借同一未变来源扩大；切片归属、资产来源和备注不影响落点');
      for (const field of ['landing', 'target_ref']) {
        delete before.quality_attributes[0].landing; delete current.quality_attributes[0].landing;
        before.quality_attributes[0][field] = '/app_lens/ui_refresh'; current.quality_attributes[0][field] = '/app_lens/ui_refresh';
        expect(selectQuestioningScopes(before, current, previous), ['app_lens:ui_refresh'], `M1无内嵌ID的lens指针${field}绑定已有scope`);
        before.app_lens.unscoped_note = {}; current.app_lens.unscoped_note = {};
        before.quality_attributes[0][field] = '/app_lens/unscoped_note'; current.quality_attributes[0][field] = '/app_lens/unscoped_note';
        expect(selectQuestioningScopes(before, current, previous), [...requiredQuestioningScopes(current).keys()], 'M1可解析但没有实际scope的指针不能借同源弱边');
        delete before.quality_attributes[0][field]; delete current.quality_attributes[0][field];
      }
      before.quality_attributes[0].source_ref = '/app_lens/ui_refresh'; current.quality_attributes[0].source_ref = '/app_lens/ui_refresh';
      expect(selectQuestioningScopes(before, current, previous), ['app_lens:ui_refresh'], 'M1无ID的lens来源指针绑定实际scope');
    }
    {
      const { before, previous } = sample();
      before.discovery.inputs = { current_scope_items: [{ item_id: 'input-item' }] };
      before.quality_attributes = [{ qa_id: 'input-quality', requirement: 'old', source_ref: '/discovery/inputs', evidence_refs: ['doc/req.md'] }];
      asRecords(before.design_views)[0].evidence_refs = ['doc/req.md'];
      (previous.items as BlueprintRecord[]).push({ ...asRecords(previous.items)[0], question_id: 'q-terminology', scope_kind: 'terminology', scope_ref: 'terminology:current_scope_items' });
      const current = clone(before); current.quality_attributes[0].requirement = 'new';
      expect(selectQuestioningScopes(before, current, previous), ['terminology:current_scope_items'], 'M1无ID的inputs来源指针绑定实际术语scope');
      before.discovery.inputs.current_scope_items = []; current.discovery.inputs.current_scope_items = [];
      expect(selectQuestioningScopes(before, current, previous), [...requiredQuestioningScopes(current).keys()], 'M1inputs可解析但没有已存在术语scope则保守全量');
    }
    for (const shape of [
      { key: 'data_domains', id: 'data_domain_id', value: 'card_records', ref: 'data_domain:card_records' },
      { key: 'facts', id: 'fact_id', value: 'term:银行卡开卡', ref: 'fact:term:银行卡开卡' },
    ]) {
      const { before, previous } = sample();
      const container = shape.key === 'facts' ? before.discovery : before;
      container[shape.key] = [{ [shape.id]: shape.value, value: 'old', source_ref: 'doc/req.md' }];
      asRecords(before.design_views)[0].evidence_refs = ['doc/req.md'];
      asRecords(asRecords(before.design_views)[1].runtime_data_flows)[0].authority_refs = [shape.ref];
      const current = clone(before), nextContainer = shape.key === 'facts' ? current.discovery : current;
      nextContainer[shape.key][0].value = 'new';
      expect(selectQuestioningScopes(before, current, previous), ['view:runtime', 'flow:target-flow', 'app_lens:ui_refresh'], '真实有类型引用不能因下划线类型/中文ID丢失强消费边');
    }
    {
      const { before, previous } = sample();
      before.blueprint_id = 'ledger-app-blueprint';
      before.design_views[0].nodes.push({ node_id: 'sibling' });
      before.decisions_and_gaps.decisions = [{ decision_id: 'route', resolution: 'previous', target_ref: 'view:logical/node:logical-object', source_ref: 'doc/requirement.md' }];
      before.design_views[1].runtime_data_flows[0].target_ref = 'view:logical/node:logical-object';
      before.design_views[2].target_ref = 'view:logical/node:sibling';
      before.app_lens.module_boundaries = { evidence_refs: ['doc/requirement.md'] };
      const byScope = (ref: string) => asRecords(previous.items).find(item => item.scope_ref === ref)!;
      byScope('app_lens:module_boundaries').evidence_refs = ['doc/requirement.md'];
      byScope('view:scenarios').evidence_refs = ['/decisions_and_gaps/decisions/0/resolution'];
      byScope('app_lens:feature_flags').evidence_refs = ['/decisions_and_gaps/decisions/0/target_ref'];
      const current = clone(before);
      current.decisions_and_gaps.decisions[0].resolution = 'revised';
      const needed = ['view:logical', 'view:runtime', 'flow:target-flow', 'view:scenarios', 'app_lens:ui_refresh'];
      expect(selectQuestioningScopes(before, current, previous), needed, '同视图未变兄弟节点、未变指针字段和共用文档可以复用');
      expect(selectQuestioningScopes(before, current, previous, ['doc/requirement.md']), [...needed, 'app_lens:module_boundaries'],
        '实际需求文件变化仍重开引用该文件的原答');
      byScope('app_lens:lifecycle_triggers').evidence_refs = [
        'doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml#/decisions_and_gaps/decisions/0/resolution',
      ];
      expect(selectQuestioningScopes(before, current, previous, [], path.join(FIXTURE_ROOT, 'valid')),
        [...needed, 'app_lens:lifecycle_triggers'], '项目内蓝图文件引用的精确成员变化仍重开');
      byScope('view:development').disposition = 'blocker';
      expect(selectQuestioningScopes(before, current, previous), [...needed, 'view:development'], '独立实质质询仍重开');
    }
    {
      const { before, previous } = sample();
      before.quality_attributes = [{ qa_id: 'unchanged-quality', source_ref: 'design_views/1/runtime_data_flows/0', landing: 'view:logical' }];
      before.app_lens.module_boundaries = { source_ref: 'design_views/1/runtime_data_flows/0' };
      asRecords(previous.items).find(item => item.scope_ref === 'view:development')!.evidence_refs = ['flow:target-flow', 'design_views/1/runtime_data_flows/0'];
      const current = clone(before); asRecords(asRecords(current.design_views)[1].runtime_data_flows)[0].description = 'only flow changed';
      expect(selectQuestioningScopes(before, current, previous), ['view:runtime', 'flow:target-flow', 'app_lens:ui_refresh'], '普通scope改动不借未变authority/原答案路径扩大原闭包');
    }
    {
      const { before, previous } = sample(), current = clone(before);
      current.generated_graphs = [{ graph_id: 'new-projection', content: 'flowchart LR; a-->b' }];
      expect(selectQuestioningScopes(before, current, previous), [], '派生图更新不冒充权威变动');
      asRecords(previous.items).find(item => item.scope_ref === 'view:scenarios')!.disposition = 'blocker';
      expect(selectQuestioningScopes(before, current, previous), ['view:scenarios'], '派生图变化不能切断真实阻断');
    }
    {
      const { before, previous } = sample();
      before.revision = 1; before.source_fingerprint = 'source'; before.decision_fingerprint = 'decision';
      before.generated_graphs = [{ graph_id: 'sequence', format: 'mermaid', content: 'sequenceDiagram\nparticipant A\nA->>A: before',
        node_refs: ['view:runtime/flow:target-flow'], relation_refs: [] }];
      before.derived_results = [{ result_id: 'sequence', kind: 'generated_graph', status: 'current', input_revision: 1,
        source_fingerprint: 'source', decision_fingerprint: 'decision' }];
      const current = clone(before); current.generated_graphs[0].content = 'sequenceDiagram\nparticipant A\nA->>A: changed return';
      expect(selectQuestioningScopes(before, current, previous), ['view:runtime', 'flow:target-flow', 'app_lens:ui_refresh'], '已展示手写时序图改动沿真实flow闭包重开');
      const external = path.resolve('outside-evidence.d.ts'), projectRoot = path.join(path.dirname(external), 'project');
      asRecords(previous.items).find(item => item.scope_ref === 'view:development')!.evidence_refs = ['../outside-evidence.d.ts'];
      expect(selectQuestioningScopes(before, before, previous, [external], projectRoot), ['view:development'], '仓外相对引用与绝对依赖比较同一对象');
    }
  }));

  return results;
}
