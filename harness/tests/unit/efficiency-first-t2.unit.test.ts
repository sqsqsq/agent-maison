// efficiency-first-t2.unit.test.ts — plan 07a41ec6 T2/T3（openspec efficiency-first-closure）
//
// 钉住：执行通道三态（gap 留分母、不算 PASS、不阻止完成）、P0 五数口径、身份断言注入
// （幂等 / 位置 / 多候选不猜 / UX 谓词断言保留 / scroll 不改 touch / 源行不动）、
// checkpoint.action.type 静态检查、completion_status 的 gap 投影。

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { clearFrameworkConfigCache, resolveFeatureArtifact, featurePhaseReportsDir } from '../../config';
import { uiSpecAbsPath } from '../../scripts/utils/ui-spec-shared';
import {
  evaluateAcceptanceFlowStructure,
  evaluateP0CoverageIntegrity,
  evaluateP0SemanticCoverage,
  findActionStepCandidates,
  isBareIdentityAssertion,
  resolveCheckpointActionWindows,
  type AcceptanceFlowsDoc,
} from '../../scripts/utils/p0-semantic-gates';
import { injectP0IdentityAssertions } from '../../scripts/utils/p0-identity-injection';
import { extractDerivedPlanCases } from '../../scripts/utils/derived-hylyre-plan';
import { extractTopPlanTestCasesForDeriveHint } from '../../scripts/utils/test-plan-derive-hint';
import { derivedPlanStaleByTcTable } from '../../scripts/check-testing';
import { buildCanonicalSelectorIndex, normalizePlannedStep } from '../../scripts/utils/planned-step-normalizer';
import {
  extractCompletionGaps,
  projectCompletionStatus,
  type QualityAxes,
} from '../../scripts/utils/quality-axes';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'eff-fixture';
const REQ_DOC_REL = 'doc/features/原始需求/1-bank/req.md';
const SNIPPET = '点击任意银行拉起添卡选卡半模态。';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-eff-t2-'));
  clearFrameworkConfigCache();
  return root;
}

function writeFile(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function acceptanceDoc(over?: { actionType?: string; forbidden?: string[] }): AcceptanceFlowsDoc {
  return {
    flows: { main_add_card: ['bank_list', 'card_type_sheet', 'add_success'] },
    criteria: [
      {
        id: 'AC-5',
        priority: 'P0',
        ut_layer: 'device',
        linked_flow: 'main_add_card',
        checkpoint: {
          pre_screen: 'bank_list',
          action: { type: over?.actionType ?? 'touch', target_element_id: 'bank_row_cmb' },
          post_screen: 'card_type_sheet',
          required_element_ids: ['card_type_agree_btn'],
          ...(over?.forbidden ? { forbidden_element_ids: over.forbidden } : {}),
        },
      },
      {
        id: 'AC-9',
        priority: 'P0',
        ut_layer: 'device',
        linked_flow: 'main_add_card',
        checkpoint: {
          pre_screen: 'card_type_sheet',
          action: { type: 'scroll', target_element_id: 'card_type_agree_btn' },
          post_screen: 'add_success',
          required_element_ids: ['add_result_done'],
        },
      },
    ],
  };
}

function writeAcceptanceYaml(root: string, actionType = 'touch'): void {
  const yaml = [
    'schema_version: "1.0"',
    `feature: ${FEATURE}`,
    'flows:',
    '  main_add_card:',
    '    screens: [bank_list, card_type_sheet, add_success]',
    'criteria:',
    '  - id: AC-5',
    '    priority: P0',
    '    ut_layer: device',
    '    linked_flow: main_add_card',
    '    requirement_ref:',
    `      source_path: ${REQ_DOC_REL}`,
    `      snippet: "${SNIPPET}"`,
    '    checkpoint:',
    '      pre_screen: bank_list',
    `      action: { type: ${actionType}, target_element_id: bank_row_cmb }`,
    '      post_screen: card_type_sheet',
    '      required_element_ids: [card_type_agree_btn]',
    '  - id: AC-9',
    '    priority: P0',
    '    ut_layer: device',
    '    linked_flow: main_add_card',
    '    requirement_ref:',
    `      source_path: ${REQ_DOC_REL}`,
    `      snippet: "${SNIPPET}"`,
    '    checkpoint:',
    '      pre_screen: card_type_sheet',
    '      action: { type: scroll, target_element_id: card_type_agree_btn }',
    '      post_screen: add_success',
    '      required_element_ids: [add_result_done]',
  ].join('\n');
  const p = resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').canonicalPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, yaml, 'utf-8');
  writeFile(root, REQ_DOC_REL, `# 需求\n\n${SNIPPET}\n`);
  const uiSpec = uiSpecAbsPath(root, FEATURE);
  fs.mkdirSync(path.dirname(uiSpec), { recursive: true });
  fs.writeFileSync(uiSpec, 'schema_version: "1.0"\nscreens: []\nassets: []\n', 'utf-8');
}

const PLAN_MD = [
  '# 测试计划',
  '',
  '## 三、测试用例清单',
  '',
  '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| TC-006 | 选卡类型 | 首页 | 点银行 | 拉起半模态 | P0 | AC-5 | hylyre |',
  '| TC-009 | 结果页 | 半模态 | 滚动同意 | 结果页 | P0 | AC-9 | manual:external_precondition |',
  '',
].join('\n');

const DERIVED_HEADER = [
  '---',
  'explicit_skip_tc_ids: []',
  '---',
  '',
  '# 派生 Hylyre 计划',
  '',
  '## 测试用例清单',
  '',
  '| 用例编号 | 用例名称 | 测试步骤 | 优先级 | 关联 AC |',
  '|---------|---------|---------|--------|---------|',
];

function derivedMd(steps006: string, steps009 = '{"scroll":{"by_id":"card_type_agree_btn","direction":"down"}} ; {"wait_for":{"by_id":"add_result_done","timeout":10}}'): string {
  return [...DERIVED_HEADER, `| TC-006 | 选卡类型 | ${steps006} | P0 | AC-5 |`, `| TC-009 | 结果页 | ${steps009} | P0 | AC-9 |`].join('\n') + '\n';
}

const STEPS_006_WITH_UX =
  '{"touch":{"by_id":"bank_row_cmb"}} ; {"wait_for":{"by_id":"card_type_agree_btn","visible":true,"timeout":10}} ; {"wait_for":{"by_text":"同意","match":"exact","timeout":10}}';

function stepsOf(md: string, tc: string): Array<Record<string, unknown>> {
  const row = extractDerivedPlanCases(md).find(r => r.tc_id === tc)!;
  return row.steps_raw.split(' ; ').map(s => JSON.parse(s) as Record<string, unknown>);
}

function passedAction(index: number, kind: string, id: string) {
  return {
    index, kind, role: 'action', duration_ms: 10, device_session: null, artifacts: [], diagnostic: null, extensions: {},
    outcome: { status: 'passed' },
    selector: { request: { kind: 'by_id', value: id }, resolution: { state: 'unique', candidate_count: 1, selected: { id }, candidates: [] } },
  };
}

function passedPresence(index: number, id: string) {
  return {
    index, kind: 'wait_for', role: 'assertion', duration_ms: 10, device_session: null, artifacts: [], diagnostic: null, extensions: {},
    outcome: { status: 'passed', observation: { kind: 'assertion', assertion_type: 'presence', facts: { observed_present: true, candidate_count: 1 } } },
    selector: { request: { kind: 'by_id', value: id }, resolution: { state: 'unique', candidate_count: 1, selected: { id }, candidates: [] } },
  };
}

function nativeTrace(cases: unknown[]) {
  return {
    schema_version: '0.4-p0', result_protocol: 'hylyre.step-outcome/1', feature: FEATURE, phase: 'testing', outcome: 'success', cases,
  } as unknown as import('../../../profiles/hmos-app/harness/providers/device-test-run').HylyreTrace;
}

const NATIVE_GATE = {
  mode: 'native', native: true, legacy: false, minimumVersion: '0.5.0', installedVersion: '0.5.0',
  manifestVersion: '0.5.0', traceVersion: '0.4-p0', traceSchemaVersion: '0.4-p0', reasons: [],
} as unknown as import('../../../profiles/hmos-app/harness/providers/device-test-run').HylyreEvidenceGateResult;

function axes(over?: Partial<Record<keyof QualityAxes, Partial<QualityAxes[keyof QualityAxes]>>>): QualityAxes {
  const base = (): QualityAxes[keyof QualityAxes] => ({
    applicable: true, required_for_release: true, verdict: 'PASS', blocking_class: null, source_checks: [], resolution: null,
  });
  const out = { functional: base(), visual: base(), asset: base(), evidence: base() } as QualityAxes;
  for (const [k, v] of Object.entries(over ?? {})) Object.assign(out[k as keyof QualityAxes], v);
  return out;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '身份断言=精确形状：多任何键（visible 等）都不是身份、kind 不同不是身份',
    run: () => {
      assert.strictEqual(isBareIdentityAssertion({ wait_for: { by_id: 'x', timeout: 10 } }, 'wait_for', 'x'), true);
      assert.strictEqual(isBareIdentityAssertion({ wait_for: { by_id: 'x' } }, 'wait_for', 'x'), true);
      assert.strictEqual(isBareIdentityAssertion({ wait_for: { by_id: 'x', visible: true, timeout: 10 } }, 'wait_for', 'x'), false, 'visible 谓词是 UX 断言不是身份');
      assert.strictEqual(isBareIdentityAssertion({ wait_gone: { by_id: 'x', timeout: 10 } }, 'wait_for', 'x'), false);
      assert.strictEqual(isBareIdentityAssertion({ wait_for: { by_text: 'x', timeout: 10 } }, 'wait_for', 'x'), false);
    },
  },
  {
    name: 'action 候选：by_id 字面绑定，scroll 算动作；多候选如实返回；canonical 缺席时 by_text 不映射',
    run: () => {
      const steps = [
        { touch: { by_id: 'bank_row_cmb' } },
        { wait_for: { by_id: 'card_type_agree_btn', timeout: 10 } },
        { scroll: { by_id: 'bank_row_cmb', direction: 'down' } },
        { touch: { by_text: '招商银行', match: 'exact' } },
      ];
      assert.deepStrictEqual(findActionStepCandidates(steps, 'bank_row_cmb', null, 'bank_list'), [0, 2]);
      assert.deepStrictEqual(findActionStepCandidates(steps, 'card_type_agree_btn', null), []);
    },
  },
  {
    name: '注入：紧跟 action、先于 UX 谓词与 by_text；forbidden 注入 wait_gone；scroll 保留；幂等；源行不动',
    run: () => {
      const md = derivedMd(STEPS_006_WITH_UX);
      const first = injectP0IdentityAssertions({ derivedMd: md, topPlanMd: PLAN_MD, acceptance: acceptanceDoc({ forbidden: ['bank_search_placeholder'] }), canonical: null });
      assert.strictEqual(first.changed, true);
      assert.deepStrictEqual(first.gaps, []);
      assert.deepStrictEqual(first.injected.map(r => `${r.tc_id}:${r.kind}:${r.element_id}@${r.index}`), [
        'TC-006:wait_for:card_type_agree_btn@1',
        'TC-006:wait_gone:bank_search_placeholder@2',
      ]);
      const steps = stepsOf(first.content, 'TC-006');
      assert.deepStrictEqual(steps[0], { touch: { by_id: 'bank_row_cmb' } });
      assert.deepStrictEqual(steps[1], { wait_for: { by_id: 'card_type_agree_btn', timeout: 10 } });
      assert.deepStrictEqual(steps[2], { wait_gone: { by_id: 'bank_search_placeholder', timeout: 10 } });
      assert.deepStrictEqual(steps[3], { wait_for: { by_id: 'card_type_agree_btn', visible: true, timeout: 10 } }, 'UX 谓词断言原样保留');
      assert.deepStrictEqual(steps[4], { wait_for: { by_text: '同意', match: 'exact', timeout: 10 } });
      // TC-009：scroll 是合法动作且已有裸身份断言 → 不注入、行字节不变
      const line009 = (s: string) => s.split('\n').find(l => l.startsWith('| TC-009 |'));
      assert.strictEqual(line009(first.content), line009(md), 'TC-009 行逐字不变（scroll 不改 touch，已有身份断言不重复）');
      assert.ok(first.content.includes('|---------|---------|---------|--------|---------|'), '表头分隔行不变');
      const second = injectP0IdentityAssertions({ derivedMd: first.content, topPlanMd: PLAN_MD, acceptance: acceptanceDoc({ forbidden: ['bank_search_placeholder'] }), canonical: null });
      assert.strictEqual(second.changed, false, '幂等：第二次装载不再注入');
      assert.deepStrictEqual(second.injected, []);
    },
  },
  {
    name: '注入：目标本身多映射才是真歧义；重复触发不删动作；无绑定动作给改法',
    run: () => {
      const canonical = buildCanonicalSelectorIndex({ screens: [{ id: 'bank_list', root: {
        type: 'column', children: [
          { id: 'bank_row_cmb', type: 'button', text: '添加' },
          { id: 'other_row', type: 'button', text: '添加' },
        ],
      } }] } as any);
      const ambiguous = injectP0IdentityAssertions({
        derivedMd: derivedMd('{"touch":{"by_text":"添加","match":"exact"}} ; {"wait_for":{"by_text":"x","match":"exact","timeout":10}} ; {"touch":{"by_text":"添加","match":"exact"}}'),
        topPlanMd: PLAN_MD, acceptance: acceptanceDoc(), canonical,
      });
      assert.strictEqual(ambiguous.changed, false);
      assert.strictEqual(ambiguous.gaps.length, 1);
      assert.strictEqual(ambiguous.gaps[0].rule_id, 'STEP-P0-IDENTITY');
      assert.deepStrictEqual(ambiguous.gaps[0].candidates, [0, 2]);
      assert.ok(/step 0, 2/.test(ambiguous.gaps[0].message) && /不猜/.test(ambiguous.gaps[0].message));
      assert.ok(/缺唯一 selector/.test(ambiguous.gaps[0].message));
      assert.ok(!/只保留一次|拆到不同 case/.test(ambiguous.gaps[0].message));

      const none = injectP0IdentityAssertions({
        derivedMd: derivedMd('{"touch":{"by_id":"other_row"}} ; {"wait_for":{"by_id":"card_type_agree_btn","timeout":10}}'),
        topPlanMd: PLAN_MD, acceptance: acceptanceDoc(), canonical: null,
      });
      assert.strictEqual(none.gaps.length, 1);
      assert.ok(/没有任何 action 步骤绑定 AC-5 的 checkpoint 元素 bank_row_cmb/.test(none.gaps[0].message));
      assert.ok(/改法/.test(none.gaps[0].message));
    },
  },
  {
    name: 'TC-012 重复 checkpoint：完整导航保留、逐次取证、失败不 PASS、区间隔离、裸断言复用与 UX/源文件不变',
    run: () => {
      const root = mkProject();
      try {
        const target = 'card_pack_add_card_row';
        const title = 'add_card_title';
        const absent = 'card_pack_empty_hint';
        const ac: AcceptanceFlowsDoc = { flows: { repeat_entry: ['card_pack', 'add_card'] }, criteria: [{
          id: 'AC-12', priority: 'P0', ut_layer: 'device', linked_flow: 'repeat_entry',
          checkpoint: { pre_screen: 'card_pack', action: { type: 'touch', target_element_id: target }, post_screen: 'add_card',
            required_element_ids: [title], forbidden_element_ids: [absent] },
        }] };
        writeFile(root, path.relative(root, resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').canonicalPath), JSON.stringify(ac));
        writeFile(root, path.relative(root, uiSpecAbsPath(root, FEATURE)), JSON.stringify({ screens: [], assets: [] }));
        const md = (steps: Array<Record<string, unknown>>) => [...DERIVED_HEADER,
          `| TC-012 | 进入→返回→再次进入 | ${steps.map(s => JSON.stringify(s)).join(' ; ')} | P0 | AC-12 |`,
        ].join('\n');
        const enter = { touch: { by_id: target } };
        const bare = [{ wait_for: { by_id: title, timeout: 10 } }, { wait_gone: { by_id: absent, timeout: 10 } }];
        const uxVisible = { wait_for: { by_id: title, visible: true, timeout: 10 } };
        const uxEnabled = { wait_for: { by_id: title, enabled: true, timeout: 10 } };
        const original = [enter, uxVisible, { back: {} }, { wait_for: { by_id: target, timeout: 10 } }, enter, uxEnabled];
        const originalMd = md(original);
        const sourcePath = path.join(root, 'source/test-plan.hylyre.md');
        const runPath = path.join(root, 'run/test-plan.hylyre.md');
        writeFile(root, path.relative(root, sourcePath), originalMd);
        const inject = (steps: Array<Record<string, unknown>>) => injectP0IdentityAssertions({
          derivedMd: md(steps), topPlanMd: originalMd, acceptance: ac, canonical: null,
        });
        const verify = (planned: Array<Record<string, unknown>>, mutate?: (steps: any[]) => void) => {
          writeFile(root, path.relative(root, runPath), md(planned));
          const native: any[] = planned.map((step, i) => {
            const info = normalizePlannedStep(step, i);
            const id = info.selector?.value ?? '';
            if (info.kind === 'wait_gone') return {
              ...passedPresence(i, id), kind: 'wait_gone',
              outcome: { status: 'passed', observation: { kind: 'assertion', assertion_type: 'absence', facts: { observed_present: false, candidate_count: 0 } } },
              selector: { request: { kind: 'by_id', value: id }, resolution: { state: 'not_found', candidate_count: 0, selected: null, candidates: [] } },
            };
            if (info.kind === 'wait_for') {
              const result = passedPresence(i, id);
              if (!isBareIdentityAssertion(step, 'wait_for', id)) result.selector.request.kind = 'composite';
              return result;
            }
            return { ...passedAction(i, info.kind, id), ...(['back', 'scroll', 'swipe'].includes(info.kind) ? { selector: null } : {}) };
          });
          mutate?.(native);
          const trace = nativeTrace([{ id: 'TC-012', status: '通过', execution: 'completed', verification: 'passed', evidence: 'complete', expected_check_mode: 'empty', steps: native }]);
          const input = { projectRoot: root, feature: FEATURE, planMd: originalMd, reportMd: '', trace, evidenceGate: NATIVE_GATE, derivedPlanPath: runPath, reportConclusion: null };
          return [evaluateP0CoverageIntegrity(input)[0], evaluateP0SemanticCoverage(input)[0]];
        };
        const assertVerdict = (results: ReturnType<typeof verify>, verdict: 'PASS' | 'FAIL') => {
          for (const result of results) assert.strictEqual(result.status, verdict, result.details);
        };

        const first = inject(original);
        assert.deepStrictEqual(first.gaps, []);
        assert.strictEqual(first.injected.length, 4, '两次触发各补 required/forbidden');
        const planned = stepsOf(first.content, 'TC-012');
        const injectedIndices = new Set(first.injected.map(r => r.index));
        assert.deepStrictEqual(planned.filter((_, i) => !injectedIndices.has(i)), original, '全部动作、返回和 UX 谓词须原样保留');
        for (const record of first.injected) assert.ok(isBareIdentityAssertion(planned[record.index], record.kind, record.element_id), '注入清单必须使用最终 step index');
        assert.strictEqual(fs.readFileSync(sourcePath, 'utf8'), originalMd, '源派生文件不可写');
        const again = inject(planned);
        assert.strictEqual(again.changed, false);
        assert.deepStrictEqual(again.injected, []);
        assert.strictEqual(again.content, first.content, '重复装载逐字幂等');
        assertVerdict(verify(planned), 'PASS');

        const windows = resolveCheckpointActionWindows(planned, target, null).windows;
        assert.strictEqual(windows.length, 2);
        for (const failAt of [...windows.map(w => w.actionIndex), ...injectedIndices]) {
          assertVerdict(verify(planned, native => {
            native[failAt].outcome = { status: 'failed', failure: { domain: 'assertion', code: 'assertion.mismatch', facts: {} } };
          }), 'FAIL'); // 即使 CaseResult 自报 passed，也不能漏掉第二次动作/断言失败
        }
        assertVerdict(verify(planned, native => { native[windows[1].actionIndex].kind = 'input'; }), 'FAIL');

        for (const incomplete of [
          [enter, { back: {} }, enter, ...bare], // 第二次的断言不能证明第一次
          [enter, ...bare, { back: {} }, enter], // 只验第一次不能代表重复流程
          [enter, enter, ...bare], // 不靠 back 也必须在下次触发前截止
          [enter, { back: {} }, ...bare, enter, ...bare], // 返回后的断言不能倒借给前一次进入
          [enter, bare[0], { back: {} }, enter, ...bare], // forbidden 同样不得跨区间
        ]) assertVerdict(verify(incomplete), 'FAIL');

        const existing = [enter, uxVisible, ...bare, { back: {} }, enter, uxEnabled, ...bare];
        assert.deepStrictEqual(inject(existing).injected, [], '区间内已有裸断言继续复用，UX 谓词不占身份断言位置');
        assertVerdict(verify(existing), 'PASS');
        assert.strictEqual(inject([enter, uxVisible, { back: {} }, enter, ...bare]).injected.length, 2, '仅补第一次，不借第二次已有断言');
        assertVerdict(verify([enter, ...bare]), 'PASS');
        for (const kind of ['scroll', 'swipe']) {
          const action = { [kind]: { by_id: target, direction: 'down' } };
          const repeated = inject([action, uxVisible, action, uxEnabled]);
          const result = stepsOf(repeated.content, 'TC-012');
          assert.deepStrictEqual(result.filter(step => kind in step), [action, action], '重复 scroll/swipe 不改 touch');
          assertVerdict(verify(result), 'PASS');
        }

        const selectorDoc = { screens: [{ id: 'card_pack', root: { type: 'column', children: [
          { id: target, type: 'button', text: '添加' }, { id: 'other_add', type: 'button', text: '添加' },
        ] } }], assets: [] };
        writeFile(root, path.relative(root, uiSpecAbsPath(root, FEATURE)), JSON.stringify(selectorDoc));
        const ambiguous = [{ touch: { by_text: '添加', match: 'exact' } }, ...bare];
        const blocked = injectP0IdentityAssertions({ derivedMd: md(ambiguous), topPlanMd: originalMd, acceptance: ac, canonical: buildCanonicalSelectorIndex(selectorDoc as any) });
        assert.deepStrictEqual(blocked.gaps[0].candidates, [0]);
        assertVerdict(verify(ambiguous), 'FAIL');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'checkpoint.action.type=assert_visible 在 spec 期判 FAIL 并给改法（scroll/tap 合法）',
    run: () => {
      const root = mkProject();
      try {
        writeAcceptanceYaml(root, 'assert_visible');
        const bad = evaluateAcceptanceFlowStructure(root, FEATURE);
        assert.strictEqual(bad[0].status, 'FAIL', bad[0].details);
        assert.ok(/AC-5：checkpoint\.action\.type=assert_visible 不是可绑定动作/.test(bad[0].details), bad[0].details);
        assert.ok(/required_element_ids/.test(bad[0].details));
        writeAcceptanceYaml(root, 'tap');
        const good = evaluateAcceptanceFlowStructure(root, FEATURE);
        assert.strictEqual(good[0].status, 'PASS', good[0].details);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P0 五数口径：unsupported_gap 留分母、不算 PASS/FAIL；未声明 gap 时同一 TC 判 failed',
    run: () => {
      const root = mkProject();
      try {
        writeAcceptanceYaml(root);
        const derivedRel = `doc/features/${FEATURE}/testing/reports/20260713-010000/hylyre/test-plan.hylyre.md`;
        writeFile(root, derivedRel, derivedMd('{"touch":{"by_id":"bank_row_cmb"}} ; {"wait_for":{"by_id":"card_type_agree_btn","timeout":10}}'));
        const trace = nativeTrace([{
          id: 'TC-006', status: '通过', priority: 'P0', ac_ref: 'AC-5', notes: '',
          execution: 'completed', verification: 'passed', evidence: 'complete', expected_check_mode: 'empty',
          steps: [passedAction(0, 'touch', 'bank_row_cmb'), passedPresence(1, 'card_type_agree_btn')],
        }]);
        const base = {
          projectRoot: root, feature: FEATURE, planMd: PLAN_MD, reportMd: '', trace, evidenceGate: NATIVE_GATE,
          derivedPlanPath: path.join(root, derivedRel), reportConclusion: null as string | null,
        };
        const withGap = evaluateP0CoverageIntegrity({ ...base, unsupportedGapTcIds: ['TC-009'] });
        assert.strictEqual(withGap[0].status, 'PASS', withGap[0].details);
        assert.deepStrictEqual(
          (withGap[0].structured as Record<string, unknown>),
          { p0_total: 2, verified_pass: 1, unsupported_gap: 1, failed: 0, verified_coverage: 50, gap_case_ids: ['TC-009'], gap_ac_ids: ['AC-9'] },
        );
        assert.ok(/P0 total 2 \/ verified_pass 1 \/ unsupported_gap 1 \/ failed 0 \/ verified_coverage 50%/.test(withGap[0].details), withGap[0].details);
        assert.ok(/COMPLETE_WITH_P0_GAPS/.test(withGap[0].details), 'gap 必须显著披露');
        assert.strictEqual(withGap[1].id, 'p0_pass_rate_dual_metrics');
        assert.strictEqual(withGap[1].status, 'PASS');
        const semantic = evaluateP0SemanticCoverage({ ...base, unsupportedGapTcIds: ['TC-009'] });
        assert.strictEqual(semantic[0].status, 'PASS', semantic[0].details);
        assert.ok(/AC-9/.test(semantic[0].details), 'gap 覆盖的 AC 必须披露');

        const noGap = evaluateP0CoverageIntegrity(base);
        assert.strictEqual(noGap[0].status, 'FAIL');
        assert.strictEqual((noGap[0].structured as Record<string, unknown>).failed, 1, '未声明 gap 的未执行 P0 仍是 failed');
        assert.ok(/TC-009/.test(noGap[0].details));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'TC 行为新鲜度：步骤/预期/前置/AC/通道变化 stale；表外标题说明 fresh；关键列缺失 stale',
    run: () => {
      const top = [
        '# 测试计划 v1', '', '## 三、测试用例清单', '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |',
        '|---|---|---|---|---|---|---|---|',
        '| TC-001 | 打开卡包 | 已启动 | 点击卡包 | 卡包可见 | P0 | AC-1 | hylyre |',
      ].join('\n');
      const derived = [
        '# 派生计划', '', '## 测试用例清单', '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
        '|---|---|---|---|---|---|---|',
        '| TC-001 | 打开卡包 | 已启动 | {"touch":{"by_id":"pack"}} | 卡包可见 | P0 | AC-1 |',
      ].join('\n');
      const baseline = { test_cases: extractTopPlanTestCasesForDeriveHint(top) };
      assert.strictEqual(derivedPlanStaleByTcTable(top, derived, baseline), false);
      for (const [from, to] of [
        ['点击卡包', '点击添加'], ['卡包可见', '添加页可见'], ['已启动', '已登录'],
        ['AC-1', 'AC-2'], ['hylyre', 'visual'],
      ]) {
        assert.strictEqual(derivedPlanStaleByTcTable(top.replace(from, to), derived, baseline), true, `${from} → ${to}`);
      }
      assert.strictEqual(derivedPlanStaleByTcTable(top.replace('测试计划 v1', '测试计划 v2\n\n说明文字变更'), derived, baseline), false);
      assert.strictEqual(derivedPlanStaleByTcTable(top, derived.replace(' | 关联 AC |', ' |'), baseline), true);
      assert.strictEqual(derivedPlanStaleByTcTable(top, derived, null), true, '缺源 TC 快照须 stale');
      assert.strictEqual(
        derivedPlanStaleByTcTable(top, derived, baseline, false),
        true,
        '刷新 hint 但未重新派生不得洗绿',
      );
    },
  },
  {
    name: '正常首次派生：hint CLI 先写 canonical 基线，再写派生计划，首次新鲜度检查无需先失败一轮',
    run: () => {
      const root = mkProject();
      try {
        writeFile(root, 'framework.config.json', JSON.stringify({
          schema_version: '1.1', project_name: 'first-derive', project_profile: { name: 'generic' },
          paths: { features_dir: 'requirements/features', reports_dir_pattern: 'evidence/<feature>/<phase>' },
        }));
        const top = [
          '# 测试计划', '', '## 测试用例清单', '',
          '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |',
          '|---|---|---|---|---|---|---|---|',
          '| TC-001 | 打开卡包 | 已启动 | 点击卡包 | 卡包可见 | P0 | AC-1 | hylyre |',
        ].join('\n');
        const planPath = resolveFeatureArtifact(root, FEATURE, 'test-plan.md').canonicalPath;
        writeFile(root, path.relative(root, planPath), top);
        const reports = featurePhaseReportsDir(root, FEATURE, 'testing');
        const hintPath = path.join(reports, 'derive-hint-from-plan.json');
        assert.strictEqual(fs.existsSync(hintPath), false);
        const cli = spawnSync(process.execPath, [
          '-r', require.resolve('ts-node/register/transpile-only'),
          path.resolve(__dirname, '../../scripts/derive-hylyre-plan-hint.ts'),
          '--project-root', root, '--feature', FEATURE,
        ], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
        assert.strictEqual(cli.status, 0, cli.stderr);
        assert.strictEqual(fs.readFileSync(hintPath, 'utf8'), cli.stdout, 'stdout 与 canonical 基线须为同一份 JSON');
        const derived = top.replace(' | 执行通道 |', ' |').replace('|---|---|---|---|---|---|---|---|', '|---|---|---|---|---|---|---|')
          .replace('点击卡包', '{"touch":{"by_id":"pack"}}').replace(' | hylyre |', ' |');
        const derivedPath = path.join(reports, 'first/hylyre/test-plan.hylyre.md');
        writeFile(root, path.relative(root, derivedPath), derived);
        assert.strictEqual(derivedPlanStaleByTcTable(
          top, derived, JSON.parse(fs.readFileSync(hintPath, 'utf8')),
          fs.statSync(derivedPath).mtimeMs >= fs.statSync(hintPath).mtimeMs,
        ), false, '正常首次派生必须 fresh，无需先跑 harness 失败生成 hint');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'completion_status：P0 gap → COMPLETE_WITH_P0_GAPS（视觉 pending 也让位）；非 P0 gap → COMPLETE_WITH_GAPS；无 gap 不变',
    run: () => {
      assert.strictEqual(projectCompletionStatus(axes()), 'COMPLETE');
      assert.strictEqual(projectCompletionStatus(axes(), { p0: 0, total: 0 }), 'COMPLETE');
      assert.strictEqual(projectCompletionStatus(axes(), { p0: 2, total: 2 }), 'COMPLETE_WITH_P0_GAPS');
      assert.strictEqual(projectCompletionStatus(axes(), { p0: 0, total: 3 }), 'COMPLETE_WITH_GAPS');
      assert.strictEqual(projectCompletionStatus(axes({ visual: { verdict: 'UNVERIFIED' } }), { p0: 1, total: 1 }), 'COMPLETE_WITH_P0_GAPS');
      assert.strictEqual(projectCompletionStatus(axes({ visual: { verdict: 'UNVERIFIED' } }), { p0: 0, total: 1 }), 'FUNCTIONALLY_COMPLETE_VISUAL_PENDING');
      assert.strictEqual(projectCompletionStatus(axes({ functional: { verdict: 'FAIL' } }), { p0: 1, total: 1 }), 'INCOMPLETE', 'FAIL 优先于 gap');
      const gaps = extractCompletionGaps([
        { id: 'p0_coverage_integrity', status: 'PASS', severity: 'BLOCKER', structured: { unsupported_gap: 1 } },
        { id: 'testing_channel_evidence_obligation', status: 'PASS', severity: 'BLOCKER', structured: { unsupported_gap_count: 3 } },
        { id: 'other', status: 'PASS', severity: 'MINOR', structured: { unsupported_gap: 9 } },
      ]);
      assert.deepStrictEqual(gaps, { p0: 1, total: 3 });
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}
