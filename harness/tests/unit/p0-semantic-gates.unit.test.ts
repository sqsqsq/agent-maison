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
import {
  evaluateAcceptanceFlowStructure,
  evaluateFlowContract,
  evaluateP0CoverageIntegrity,
  evaluateP0SemanticCoverage,
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
  const sha = crypto.createHash('sha256').update(SNIPPET, 'utf-8').digest('hex');
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
    `      snippet_sha256: ${over?.badSnippet ? crypto.createHash('sha256').update('需求里不存在的句子', 'utf-8').digest('hex') : sha}`,
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
    `      snippet_sha256: ${sha}`,
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

function writePlan(root: string): void {
  const p = resolveFeatureArtifact(root, FEATURE, 'test-plan.md').canonicalPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, PLAN_MD, 'utf-8');
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

function inputs(root: string, statuses: Record<string, string>, conclusion: string | null) {
  const report = `# 测试报告\n\n## 五、结论\n\n**测试结论**: ${conclusion ?? ''}\n`;
  return {
    projectRoot: root,
    feature: FEATURE,
    planMd: PLAN_MD,
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
    name: 't4a：合法模型 PASS；缺 checkpoint FAIL；跳边（bank_list→add_success）FAIL；引文伪造 FAIL',
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
    name: 't4b flow_contract：适用+无 receipt → WARN（封顶语义）；无 P0 flow → SKIP',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptance(root);
      const r = evaluateFlowContract(root, FEATURE, 'req text');
      assert.strictEqual(r[0].status, 'WARN');
      assert.ok(r[0].details.includes('AWAITING_HUMAN_REVIEW'));
      const empty = mkProject();
      assert.strictEqual(evaluateFlowContract(empty, FEATURE, 'x')[0].status, 'SKIP');
    },
  },
  {
    name: 't5：P0 skip 无 waiver → FAIL(await_human_p0_skip)；结论「达标」→ 双口径 FAIL（事故 10-skip 形态）',
    run: () => {
      const root = mkProject();
      seedReqDoc(root);
      writeAcceptance(root);
      writePlan(root);
      writeDerived(root, 'good', ['TC-011']);
      const r = evaluateP0CoverageIntegrity(inputs(root, { 'TC-006': '通过', 'TC-009': '通过' }, '达标'));
      const cov = r.find((x) => x.id === 'p0_coverage_integrity')!;
      assert.strictEqual(cov.status, 'FAIL');
      assert.strictEqual(cov.failure_kind, 'await_human_p0_skip');
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
    name: 't5 waiver 路径：skip-waivers.yaml 无 receipt 不生效（仍 FAIL）',
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
