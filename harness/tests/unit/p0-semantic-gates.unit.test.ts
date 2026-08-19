// p0-semantic-gates.unit.test.ts — t4/t5（goal-fakepass-hardening）
//
// 事故 fixture 全剧本：fast path 三连（TC-006 动作不指向 checkpoint 目标/TC-007 纯 wait）、
// bank_list→add_success 跳边、10 P0 skip + 结论「达标」、requirement_ref 引文伪造。

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, resolveFeatureArtifact } from '../../config';
import { canonicalReceiptPayload, defaultTrustRegistryPath } from '../../scripts/utils/confirmation-receipt';
import {
  evaluateAcceptanceFlowStructure,
  evaluateFlowContract,
  evaluateP0CoverageIntegrity,
  evaluateP0SemanticCoverage,
  p0SkipObjectHash,
  parsePlanTcEntries,
  skipWaiversPath,
} from '../../scripts/utils/p0-semantic-gates';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'p0-fixture';
const REQ_DOC_REL = 'doc/features/原始需求/1-bank/req.md';
const SNIPPET = '页面布局完全参考\'3-点击任意银行拉起添卡选卡半模态.jpg\'。';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-p0gate-'));
  clearFrameworkConfigCache();
  return root;
}

function writeFile(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function writeAcceptance(root: string, over?: { jumpEdge?: boolean; badSnippet?: boolean; noCheckpoint?: boolean }): void {
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
    `      snippet: "${over?.badSnippet ? '需求里不存在的句子' : SNIPPET}"`,
    // 存量遗留字段（与 snippet 必然失配）——runner-owned-machine-facts 后被忽略，
    // 默认 PASS 用例即钉住「存量 snippet_sha256 不参与判定、无需迁移」。
    `      snippet_sha256: ${'0'.repeat(64)}`,
    ...(over?.noCheckpoint
      ? []
      : [
          '    checkpoint:',
          '      pre_screen: bank_list',
          '      action: { type: touch, target_element_id: bank_row_cmb }',
          `      post_screen: ${over?.jumpEdge ? 'add_success' : 'card_type_sheet'}`,
          '      required_element_ids: [card_type_agree_btn]',
        ]),
    '  - id: AC-9',
    '    priority: P0',
    '    ut_layer: device',
    '    linked_flow: main_add_card',
    '    requirement_ref:',
    `      source_path: ${REQ_DOC_REL}`,
    `      snippet: "${SNIPPET}"`,
    '    checkpoint:',
    '      pre_screen: card_type_sheet',
    '      action: { type: touch, target_element_id: card_type_agree_btn }',
    '      post_screen: add_success',
    '      required_element_ids: [add_result_done]',
  ].join('\n');
  const p = resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').canonicalPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, yaml, 'utf-8');
}

function seedReqDoc(root: string): void {
  writeFile(root, REQ_DOC_REL, `# 原始需求\n\n- 3）选择卡类型半模态：${SNIPPET}\n`);
}

const PLAN_MD = [
  '# 测试计划',
  '',
  '## 测试用例',
  '',
  '| 用例编号 | 用例名称 | 优先级 | 关联 AC |',
  '|---------|---------|--------|---------|',
  '| TC-006 | 选卡类型 | P0 | AC-5 |',
  '| TC-009 | 结果页 | P0 | AC-9 |',
  '| TC-011 | 卡包展示 | P0 | AC-8 |',
  '| TC-012 | 列表半模态 | P1 | AC-10 |',
].join('\n');

// e9d4b7a3 t2：AC-G* 泛化编号回归夹具（bc-openCard test-plan.md 实况：TC-024→AC-G1、
// TC-026→AC-G3、TC-027→AC-G4）——旧 /AC-\d+/gi 解析吃不下 AC-G* → 恒报零覆盖。
// 含数字 AC 行（TC-006→AC-5 / TC-009→AC-9）保持双词法同表。
const PLAN_MD_ACG = [
  '# 测试计划',
  '',
  '## 测试用例',
  '',
  '| 用例编号 | 用例名称 | 优先级 | 关联 AC |',
  '|---------|---------|--------|---------|',
  '| TC-024 | 卡片列表刷新 | P0 | AC-G1 |',
  '| TC-026 | 全局视觉规范 | P0 | AC-G3 |',
  '| TC-027 | 全局可访问性 | P0 | AC-G4 |',
  '| TC-006 | 选卡类型 | P0 | AC-5 |',
  '| TC-009 | 结果页 | P0 | AC-9 |',
].join('\n');

function writePlan(root: string): void {
  const p = resolveFeatureArtifact(root, FEATURE, 'test-plan.md').canonicalPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, PLAN_MD, 'utf-8');
}

/**
 * e9d4b7a3 t2：AC-G 夹具——acceptance 含 AC-G1（P0 device 交互，完整 checkpoint +
 * requirement_ref；与 AC-5/AC-9 同形），test-plan 用 PLAN_MD_ACG。
 */
function writePlanAcG(root: string): void {
  const p = resolveFeatureArtifact(root, FEATURE, 'test-plan.md').canonicalPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, PLAN_MD_ACG, 'utf-8');
}

function writeAcceptanceWithAcG(root: string, variant: 'good' | 'fastpath' = 'good'): void {
  const acG1Checkpoint = [
    '  - id: AC-G1',
    '    priority: P0',
    '    ut_layer: device',
    '    linked_flow: main_add_card',
    '    requirement_ref:',
    `      source_path: ${REQ_DOC_REL}`,
    `      snippet: "${SNIPPET}"`,
    '    checkpoint:',
    '      pre_screen: bank_list',
    '      action: { type: touch, target_element_id: bank_row_cmb }',
    '      post_screen: card_type_sheet',
    '      required_element_ids: [card_type_agree_btn]',
  ].join('\n');
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
    '      action: { type: touch, target_element_id: bank_row_cmb }',
    '      post_screen: card_type_sheet',
    '      required_element_ids: [card_type_agree_btn]',
    acG1Checkpoint,
    '  - id: AC-9',
    '    priority: P0',
    '    ut_layer: device',
    '    linked_flow: main_add_card',
    '    requirement_ref:',
    `      source_path: ${REQ_DOC_REL}`,
    `      snippet: "${SNIPPET}"`,
    '    checkpoint:',
    '      pre_screen: card_type_sheet',
    '      action: { type: touch, target_element_id: card_type_agree_btn }',
    '      post_screen: add_success',
    '      required_element_ids: [add_result_done]',
  ].join('\n');
  const p = resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').canonicalPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, yaml, 'utf-8');
}

/** e9d4b7a3 t2：AC-G 派生计划——TC-024 走合规步序（good）或事故形态（fastpath）。 */
function writeDerivedAcG(root: string, variant: 'good' | 'fastpath', skips: string[] = []): void {
  const steps024 =
    variant === 'good'
      ? '{"touch":{"by_id":"bank_row_cmb"}}; {"wait_for":{"by_id":"card_type_agree_btn","timeout":10}}'
      : '{"wait_for":{"by_text":"添加成功","timeout":10}}';
  const steps009 =
    variant === 'good'
      ? '{"touch":{"by_id":"card_type_agree_btn"}}; {"wait_for":{"by_id":"add_result_done","timeout":10}}'
      : '{"wait_for":{"by_text":"添加成功","timeout":10}}';
  const steps006 = '{"touch":{"by_id":"bank_row_cmb"}}; {"wait_for":{"by_id":"card_type_agree_btn","timeout":10}}';
  const md = [
    '---',
    `explicit_skip_tc_ids: [${skips.join(', ')}]`,
    '---',
    '',
    '# 派生 Hylyre 计划',
    '',
    '## 测试用例清单',
    '',
    '| 用例编号 | 用例名称 | 测试步骤 | 优先级 | 关联 AC |',
    '|---------|---------|---------|--------|---------|',
    `| TC-024 | 卡片列表刷新 | ${steps024} | P0 | AC-G1 |`,
    `| TC-006 | 选卡类型 | ${steps006} | P0 | AC-5 |`,
    `| TC-009 | 结果页 | ${steps009} | P0 | AC-9 |`,
  ].join('\n');
  writeFile(root, `doc/features/${FEATURE}/testing/reports/20260713-010000/hylyre/test-plan.hylyre.md`, md);
}

/** 派生计划：good=完整状态迁移步序；fastpath=事故形态（动作不指向目标/纯 wait） */
function writeDerived(root: string, variant: 'good' | 'fastpath', skips: string[] = []): void {
  const steps006 =
    variant === 'good'
      ? '{"touch":{"by_id":"bank_row_cmb"}}; {"wait_for":{"by_id":"card_type_agree_btn","timeout":10}}'
      : '{"touch":{"by_id":"bank_row_generic"}}; {"wait_for":{"by_text":"添加成功","timeout":10}}';
  const steps009 =
    variant === 'good'
      ? '{"touch":{"by_id":"card_type_agree_btn"}}; {"wait_for":{"by_id":"add_result_done","timeout":10}}'
      : '{"wait_for":{"by_text":"添加成功","timeout":10}}';
  const md = [
    '---',
    `explicit_skip_tc_ids: [${skips.join(', ')}]`,
    '---',
    '',
    '# 派生 Hylyre 计划',
    '',
    '## 测试用例清单',
    '',
    '| 用例编号 | 用例名称 | 测试步骤 | 优先级 | 关联 AC |',
    '|---------|---------|---------|--------|---------|',
    `| TC-006 | 选卡类型 | ${steps006} | P0 | AC-5 |`,
    `| TC-009 | 结果页 | ${steps009} | P0 | AC-9 |`,
  ].join('\n');
  writeFile(root, `doc/features/${FEATURE}/testing/reports/20260713-010000/hylyre/test-plan.hylyre.md`, md);
}

function inputs(root: string, statuses: Record<string, string>, conclusion: string | null, planMd = PLAN_MD) {
  const report = `# 测试报告\n\n## 五、结论\n\n**测试结论**: ${conclusion ?? ''}\n`;
  return {
    projectRoot: root,
    feature: FEATURE,
    planMd,
    reportMd: report,
    traceCaseStatus: new Map(Object.entries(statuses)),
    reportConclusion: conclusion,
    now: () => new Date('2026-07-13T12:00:00.000Z'),
  };
}

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: 'parsePlanTcEntries：id/优先级/AC 引用提取',
    run: () => {
      const entries = parsePlanTcEntries(PLAN_MD);
      assert.strictEqual(entries.length, 4);
      assert.deepStrictEqual(entries.find((e) => e.id === 'TC-006')!.acRefs, ['AC-5']);
      assert.strictEqual(entries.filter((e) => e.priority === 'P0').length, 3);
    },
  },
  {
    name: 'e9d4b7a3 t2：AC-G* 行内引用解析（TC-024/026/027 → AC-G1/G3/G4），纯数字 AC 行为不变',
    run: () => {
      const entries = parsePlanTcEntries(PLAN_MD_ACG);
      assert.strictEqual(entries.length, 5);
      assert.deepStrictEqual(entries.find((e) => e.id === 'TC-024')!.acRefs, ['AC-G1'],
        'AC-G1 须被识别（旧 /AC-\\d+/gi 吃不下）');
      assert.deepStrictEqual(entries.find((e) => e.id === 'TC-026')!.acRefs, ['AC-G3']);
      assert.deepStrictEqual(entries.find((e) => e.id === 'TC-027')!.acRefs, ['AC-G4']);
      assert.deepStrictEqual(entries.find((e) => e.id === 'TC-009')!.acRefs, ['AC-9'],
        '纯数字 AC 解析行为不得改变');
      const numericAgain = parsePlanTcEntries(PLAN_MD);
      assert.deepStrictEqual(numericAgain.map((e) => [e.id, e.acRefs.join(',')]),
        [['TC-006', 'AC-5'], ['TC-009', 'AC-9'], ['TC-011', 'AC-8'], ['TC-012', 'AC-10']],
        '数字 AC 全集解析结果逐条不变');
    },
  },
  {
    name: 'e9d4b7a3 t2：AC-G1 语义覆盖闭环——合规步序 PASS（此前零覆盖恒 FAIL）；fastpath 仍 FAIL',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptanceWithAcG(root);
      writePlanAcG(root);
      writeDerivedAcG(root, 'good');
      const ok = evaluateP0SemanticCoverage(inputs(root, { 'TC-024': '通过', 'TC-006': '通过', 'TC-009': '通过' }, '达标', PLAN_MD_ACG));
      assert.strictEqual(ok[0].status, 'PASS', ok[0].details);
      const boundary = ok.find((r) => r.id === 'p0_runtime_step_evidence_boundary');
      assert.ok(boundary && boundary.status === 'WARN', 'AC-G 场景同款运行时证据边界 WARN');

      writeDerivedAcG(root, 'fastpath');
      const bad = evaluateP0SemanticCoverage(inputs(root, { 'TC-024': '通过', 'TC-006': '通过', 'TC-009': '通过' }, '达标', PLAN_MD_ACG));
      assert.strictEqual(bad[0].status, 'FAIL', bad[0].details);
      assert.ok(bad[0].details.includes('纯 wait'), bad[0].details);
    },
  },
  {
    name: 't4a：合法模型 PASS（存量失配 snippet_sha256 被忽略/无该字段同 PASS）；缺 checkpoint FAIL；跳边 FAIL；引文伪造 FAIL',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptance(root);
      let r = evaluateAcceptanceFlowStructure(root, FEATURE);
      assert.strictEqual(r[0].status, 'PASS', r[0].details);

      writeAcceptance(root, { noCheckpoint: true });
      r = evaluateAcceptanceFlowStructure(root, FEATURE);
      assert.strictEqual(r[0].status, 'FAIL');
      assert.ok(r[0].details.includes('缺完整结构化 checkpoint'));

      writeAcceptance(root, { jumpEdge: true });
      r = evaluateAcceptanceFlowStructure(root, FEATURE);
      assert.strictEqual(r[0].status, 'FAIL');
      assert.ok(r[0].details.includes('跳边'), r[0].details);

      writeAcceptance(root, { badSnippet: true });
      r = evaluateAcceptanceFlowStructure(root, FEATURE);
      assert.strictEqual(r[0].status, 'FAIL');
      assert.ok(r[0].details.includes('不存在'), r[0].details);
    },
  },
  {
    name: 't4b flow_contract：适用+无 receipt → 仅 advisory WARN（不再宣称封顶）；无 P0 flow → SKIP',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptance(root);
      const r = evaluateFlowContract(root, FEATURE, 'req text');
      assert.strictEqual(r[0].status, 'WARN');
      // codex 方案二文案返修：WARN 必须自述 advisory，不得再谎报封顶/不得完成
      //（生产已取消 clean_pass 拒绝，文案与行为不得两张皮）
      assert.ok(r[0].details.includes('advisory'), r[0].details);
      assert.ok(!r[0].details.includes('AWAITING_HUMAN_REVIEW'), '不得再宣称 run 封顶');
      assert.ok(!/不得 FEATURE_COMPLETED|clean_pass 拒绝/.test(r[0].details), '不得再宣称阻断完成');
      const empty = mkProject();
      assert.strictEqual(evaluateFlowContract(empty, FEATURE, 'x')[0].status, 'SKIP');
    },
  },
  {
    name: 't5→c7e4a2d9：P0 explicit skip 无 waiver → FAIL(code_regression/agent_fixable)；结论「达标」→ 双口径 FAIL（事故 10-skip 形态）',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptance(root);
      writePlan(root);
      writeDerived(root, 'good', ['TC-011']);
      const r = evaluateP0CoverageIntegrity(inputs(root, { 'TC-006': '通过', 'TC-009': '通过' }, '达标'));
      const cov = r.find((x) => x.id === 'p0_coverage_integrity')!;
      assert.strictEqual(cov.status, 'FAIL');
      // c7e4a2d9：全部未豁免缺口 ∈ explicit_skip_tc_ids → 复用 code_regression + agent_fixable
      assert.strictEqual(cov.failure_kind, 'code_regression');
      assert.strictEqual(cov.actionability, 'agent_fixable');
      assert.ok(cov.details.includes('TC-011'));
      const dual = r.find((x) => x.id === 'p0_pass_rate_dual_metrics')!;
      assert.strictEqual(dual.status, 'FAIL', '已执行子集冒充全量达标');
      // 全量执行通过 → 双 PASS
      writeDerived(root, 'good');
      const ok = evaluateP0CoverageIntegrity(inputs(root, { 'TC-006': '通过', 'TC-009': '通过', 'TC-011': '通过' }, '达标'));
      assert.ok(ok.every((x) => x.status === 'PASS'), JSON.stringify(ok.map((x) => [x.id, x.status])));
    },
  },
  {
    name: 'c7e4a2d9：缺口含 status 为空/未经登记的 trace skip → FAIL 且**不**写 code_regression（留 testing），explicit-only 才产 coding 归因',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptance(root);
      // 计划含第五条 P0 TC-014（不入 explicit_skip，trace 标「跳过」= 未经登记 skip）
      const planWith014 = '# 测试计划\n\n## 测试用例\n\n| 用例编号 | 用例名称 | 优先级 | 关联 AC |\n|---------|---------|--------|---------|\n' +
        '| TC-006 | 选卡类型 | P0 | AC-5 |\n| TC-009 | 结果页 | P0 | AC-9 |\n' +
        '| TC-011 | 卡包展示 | P0 | AC-8 |\n| TC-014 | 新增用例 | P0 | AC-9 |\n';
      writeFile(root, 'doc/features/p0-fixture/test-plan.md', planWith014);
      // explicit_skip 只登记 TC-011；TC-014 仅 trace「跳过」且未登记
      writeDerived(root, 'good', ['TC-011']);
      const mixed = evaluateP0CoverageIntegrity(inputs(root, {
        'TC-006': '通过', 'TC-009': '通过', 'TC-014': '跳过',
      }, '不达标', planWith014));
      const mixedCov = mixed.find((x) => x.id === 'p0_coverage_integrity')!;
      assert.strictEqual(mixedCov.status, 'FAIL');
      assert.ok(mixedCov.failure_kind === undefined, `未经登记的 trace skip 不得冒充 coding 缺陷：${String(mixedCov.failure_kind)}`);
      assert.ok(mixedCov.actionability === undefined, '不得自报 agent_fixable');
      assert.ok(mixedCov.details.includes('TC-014'), mixedCov.details);
      // 仅 explicit 缺口（TC-011）且 TC-014 已执行通过 → code_regression（对照臂）
      const explicitOnly = evaluateP0CoverageIntegrity(inputs(root, {
        'TC-006': '通过', 'TC-009': '通过', 'TC-014': '通过',
      }, '不达标', planWith014));
      const expCov = explicitOnly.find((x) => x.id === 'p0_coverage_integrity')!;
      assert.strictEqual(expCov.failure_kind, 'code_regression', 'explicit-only 合取必须产 coding 归因');
      // 反例：完全不登记（无 explicit_skip）、不执行（status 为空）的 P0 → 无 coding 归因
      writeDerived(root, 'good', []);
      const unregistered = evaluateP0CoverageIntegrity(inputs(root, {
        'TC-006': '通过', 'TC-009': '通过', 'TC-014': '通过',
      }, '不达标', planWith014));
      const unregCov = unregistered.find((x) => x.id === 'p0_coverage_integrity')!;
      assert.ok(unregCov.failure_kind === undefined, `status 为空且未登记不得写 code_regression：${String(unregCov.failure_kind)}`);
    },
  },
  {
    name: 't4b 语义（事故死刑条款）：fast path 派生步序 → 动作不指向目标/纯 wait/缺中间屏边全部 FAIL；合规步序 PASS',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptance(root);
      writePlan(root);
      writeDerived(root, 'fastpath');
      const r = evaluateP0SemanticCoverage(inputs(root, { 'TC-006': '通过', 'TC-009': '通过' }, '达标'));
      assert.strictEqual(r[0].status, 'FAIL');
      assert.ok(r[0].details.includes('未指向 checkpoint 目标元素'), r[0].details);
      assert.ok(r[0].details.includes('纯 wait'), r[0].details);
      assert.ok(r[0].details.includes('bank_list→card_type_sheet') || r[0].details.includes('card_type_sheet'), '中间屏边无证据');

      writeDerived(root, 'good');
      const ok = evaluateP0SemanticCoverage(inputs(root, { 'TC-006': '通过', 'TC-009': '通过' }, '达标'));
      assert.strictEqual(ok[0].status, 'PASS', ok[0].details);
      // codex 六轮 P0-3：PASS 附带运行时证据边界 WARN——绿灯不得被读成完整运行时证明
      const boundary = ok.find((r) => r.id === 'p0_runtime_step_evidence_boundary');
      assert.ok(boundary && boundary.status === 'WARN', '须附运行时证据边界 WARN');
      assert.ok(boundary!.details.includes('运行时'));
      // 合规步序但 trace 非通过 → 仍 FAIL（证据须"已执行且通过"）
      const notPassed = evaluateP0SemanticCoverage(inputs(root, { 'TC-006': '失败', 'TC-009': '通过' }, '达标'));
      assert.strictEqual(notPassed[0].status, 'FAIL');
    },
  },
  {
    name: 'c7e4a2d9：有效 p0_skip_waiver → WARN（不产 coding 归因、不洗白）；结论「达标」仍双口径 FAIL',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptance(root);
      writePlan(root);
      writeDerived(root, 'good', ['TC-011']);
      // 与 confirmation-receipt 套件同构：ed25519 签名 + trust registry 落盘（生产校验入口）
      const kp = crypto.generateKeyPairSync('ed25519');
      const payload = {
        action: 'p0_skip_waiver' as const,
        feature: FEATURE,
        object_hash: p0SkipObjectHash(FEATURE, 'TC-011'),
        issued_at: '2026-07-13T11:00:00.000Z',
        expiry: '2026-07-20T00:00:00.000Z',
      };
      const receipt = {
        schema_version: '1.0', receipt_id: 'r-p0-1', issuer_id: 'ops-team', key_id: 'k1',
        alg: 'ed25519', payload_schema_version: '1.0', payload,
        signature: crypto.sign(null, canonicalReceiptPayload(payload), kp.privateKey).toString('base64'),
      };
      const regPath = defaultTrustRegistryPath(root);
      fs.mkdirSync(path.dirname(regPath), { recursive: true });
      fs.writeFileSync(regPath, JSON.stringify({
        schema_version: '1.0',
        issuers: [{
          issuer_id: 'ops-team',
          keys: [{ key_id: 'k1', alg: 'ed25519', public_key_pem: kp.publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
        }],
      }, null, 2), 'utf-8');
      const wp = skipWaiversPath(root, FEATURE);
      fs.mkdirSync(path.dirname(wp), { recursive: true });
      fs.writeFileSync(wp, [
        'waivers:',
        '  - tc_id: TC-011',
        '    receipt_path: doc/features/p0-fixture/testing/p0-waiver-TC-011.receipt.json',
      ].join('\n'), 'utf-8');
      fs.mkdirSync(path.join(root, 'doc/features/p0-fixture/testing'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'doc/features/p0-fixture/testing/p0-waiver-TC-011.receipt.json'),
        JSON.stringify(receipt, null, 2), 'utf-8',
      );
      const r = evaluateP0CoverageIntegrity(inputs(root, { 'TC-006': '通过', 'TC-009': '通过' }, '达标'));
      const cov = r.find((x) => x.id === 'p0_coverage_integrity')!;
      assert.strictEqual(cov.status, 'WARN', cov.details);
      assert.ok(cov.failure_kind === undefined, `waived 不得产 coding 归因：${String(cov.failure_kind)}`);
      assert.ok(cov.details.includes('AWAITING_HUMAN_REVIEW'), 'waiver 只降级不洗白（run 封顶人工复核）');
      const dual = r.find((x) => x.id === 'p0_pass_rate_dual_metrics')!;
      assert.strictEqual(dual.status, 'FAIL', '存在 P0 skip 时结论不得无条件「达标」');
    },
  },
  {
    name: 't5 waiver 路径：skip-waivers.yaml 无 receipt 不生效（仍 FAIL + explicit-only code_regression）',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptance(root);
      writePlan(root);
      writeDerived(root, 'good', ['TC-011']);
      const wp = skipWaiversPath(root, FEATURE);
      fs.mkdirSync(path.dirname(wp), { recursive: true });
      fs.writeFileSync(wp, 'waivers:\n  - tc_id: TC-011\n    reason: 人工回归\n', 'utf-8');
      const r = evaluateP0CoverageIntegrity(inputs(root, { 'TC-006': '通过', 'TC-009': '通过' }, '有条件达标'));
      const cov = r.find((x) => x.id === 'p0_coverage_integrity')!;
      assert.strictEqual(cov.status, 'FAIL', '无 receipt 的 waiver 不生效');
      assert.strictEqual(cov.failure_kind, 'code_regression', '无效 waiver = 未豁免 explicit skip → 默认修复');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `p0-semantic-gates: ${c.name}`, ok: true };
    } catch (err) {
      return { name: `p0-semantic-gates: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
