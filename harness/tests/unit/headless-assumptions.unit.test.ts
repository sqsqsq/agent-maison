// headless-assumptions.unit.test.ts — t1 决议账本（goal-fakepass-hardening）
//
// fixtures 直接取自 bc-openCard 事故现场的两种真实表格式：
//   spec 表（有 must-review 列，值 是/否）与 testing 表（无该列）——洞⑤回归。

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  collectAutoDecisions,
  countPendingMustReview,
  crossCheckLedgerAgainstRegistry,
  headlessLedgerPath,
  parseHeadlessAssumptionsJsonl,
  parseLegacyAssumptionsMd,
  registryGateIdsForPhase,
} from '../../scripts/utils/headless-assumptions';
import { featureFilePath, clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'ledger-fixture';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-ledger-'));
  clearFrameworkConfigCache();
  return root;
}

function writeFeatureFile(root: string, rel: string, content: string): void {
  const p = featureFilePath(root, FEATURE, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

const VALID_LINE = JSON.stringify({
  decision_id: 'd1', run_id: 'r1', phase: 'spec', gate_id: 'spec.freeze', class: 'enum',
  decision: '冻结可进 plan', must_review: true, source: 'agent', ts: '2026-07-13T00:00:00Z',
});

/** 事故 spec 表（有 must-review 列） */
const INCIDENT_SPEC_MD = `# Headless 自动决策留痕（bc-openCard · spec）

> provenance: \`auto-approved (goal-mode), pending human review\`

| 闸门 id | class | 自动选择 | must-review | 说明 |
|---------|-------|----------|-------------|------|
| \`spec.terminology\` | artifact_checkbox | 术语映射表全部 \`[x]\` | 是 | glossary 命中 |
| \`vision.blind_tier\` | enum | 接受 semantic_layout | 否 | goal-runner 注入 |
| \`ui-spec DSL gate\` | artifact_checkbox | verified | 是 | VL 对照 |
`;

/** 事故 testing 表（无 must-review 列） */
const INCIDENT_TESTING_MD = `# bc-openCard · testing · headless assumptions

| # | Gate / 决策点 | 自动决议 | 依据 |
|---|--------------|---------|------|
| 1 | \`testing.module_name\` | 确认模块名 | §9 |
| 14 | DEVICE_TEST_FAST_PATH | \`BankAddConstants.DEVICE_TEST_FAST_PATH=true\` | 规避误触 |
| 15 | fast path 自动推进 | 点银行后直写卡并 \`pushResult\` | Hylyre 仅 wait |
`;

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: 'JSONL：合法行入账；缺字段/类型错/坏 JSON 逐行报错不吞',
    run: () => {
      const bad1 = JSON.stringify({ decision_id: 'd2', run_id: 'r', phase: 'spec' });
      const bad2 = VALID_LINE.replace('true', '"yes"');
      const r = parseHeadlessAssumptionsJsonl([VALID_LINE, '', bad1, '{oops', bad2].join('\n'));
      assert.strictEqual(r.entries.length, 1);
      assert.strictEqual(r.entries[0].gate_id, 'spec.freeze');
      assert.strictEqual(r.errors.length, 3);
      assert.ok(r.errors.some((e) => /缺字段/.test(e.error)));
      assert.ok(r.errors.some((e) => /boolean/.test(e.error)));
      assert.ok(r.errors.some((e) => /JSON 解析失败/.test(e.error)));
    },
  },
  {
    name: 'JSONL 强校验：source 枚举/ts 格式/decision_id 重复/phase-run 失配（codex 五轮 P1）',
    run: () => {
      const mk = (over: Record<string, unknown>) => JSON.stringify({
        decision_id: 'dx', run_id: 'r1', phase: 'spec', gate_id: 'g', class: 'enum',
        decision: 'ok', must_review: false, source: 'agent', ts: '2026-07-13T00:00:00Z', ...over,
      });
      let r = parseHeadlessAssumptionsJsonl(mk({ source: 'human' }));
      assert.ok(r.errors.some((e) => /source 非法/.test(e.error)));
      r = parseHeadlessAssumptionsJsonl(mk({ ts: 'yesterday' }));
      assert.ok(r.errors.some((e) => /ts 非法/.test(e.error)));
      r = parseHeadlessAssumptionsJsonl([mk({}), mk({ gate_id: 'g2' })].join('\n'));
      assert.strictEqual(r.entries.length, 1);
      assert.ok(r.errors.some((e) => /decision_id 重复/.test(e.error)));
      r = parseHeadlessAssumptionsJsonl(mk({}), { expectedPhase: 'testing' });
      assert.ok(r.errors.some((e) => /phase 失配/.test(e.error)));
      r = parseHeadlessAssumptionsJsonl(mk({}), { expectedRunId: 'r2' });
      assert.ok(r.errors.some((e) => /run_id 失配/.test(e.error)));
    },
  },
  {
    name: 'registry 交叉核验：phase 前缀过滤 + missing 判定 + n/a 行算覆盖',
    run: () => {
      const root = mkProject();
      const reg = path.join(root, 'confirmation-registry.yaml');
      fs.writeFileSync(reg, [
        'schema_version: "2.0"',
        'entries:',
        '  - id: spec.terminology',
        '    skill: spec',
        '  - id: spec.freeze',
        '    skill: spec',
        '  - id: testing.plan_confirm',
        '    skill: device-testing',
        '  - id: phase.next_step',
        '    skill: _cross_phase',
      ].join('\n'), 'utf-8');
      const regRes = registryGateIdsForPhase(reg, 'spec');
      assert.strictEqual(regRes.readable, true);
      const ids = regRes.ids;
      assert.deepStrictEqual(ids, ['spec.freeze', 'spec.terminology']);
      // fail-closed：文件缺失/YAML 坏 → readable=false（消费方必须 FAIL，不得静默零 gate）
      assert.strictEqual(registryGateIdsForPhase(path.join(root, 'nope.yaml'), 'spec').readable, false);
      const badReg = path.join(root, 'bad.yaml');
      fs.writeFileSync(badReg, 'entries: [unclosed', 'utf-8');
      assert.strictEqual(registryGateIdsForPhase(badReg, 'spec').readable, false);
      const { entries } = parseHeadlessAssumptionsJsonl([
        VALID_LINE,
        JSON.stringify({
          decision_id: 'd3', run_id: 'r1', phase: 'spec', gate_id: 'spec.terminology', class: 'artifact_checkbox',
          decision: 'n/a: 无新术语', must_review: false, source: 'agent', ts: '2026-07-13T00:00:00Z',
        }),
      ].join('\n'));
      assert.strictEqual(crossCheckLedgerAgainstRegistry(entries, ids).ok, true);
      const partial = crossCheckLedgerAgainstRegistry([entries[0]], ids);
      assert.strictEqual(partial.ok, false);
      assert.deepStrictEqual(partial.missing_gate_ids, ['spec.terminology']);
    },
  },
  {
    name: 'legacy 事故 spec 表：must-review 列按值过滤（否 排除、是 计入）',
    run: () => {
      const items = parseLegacyAssumptionsMd(INCIDENT_SPEC_MD, 'spec');
      assert.strictEqual(items.length, 2, '"否" 行（vision.blind_tier）被排除');
      assert.ok(items.every((i) => i.must_review));
      assert.ok(items.some((i) => i.summary.includes('spec.terminology')));
      assert.ok(!items.some((i) => i.summary.includes('vision.blind_tier')));
    },
  },
  {
    name: 'legacy 事故 testing 表：无 must-review 列 → 保守全量计入（含 fast path 两行）',
    run: () => {
      const items = parseLegacyAssumptionsMd(INCIDENT_TESTING_MD, 'testing');
      assert.strictEqual(items.length, 3);
      assert.ok(items.every((i) => i.must_review));
      assert.ok(items.some((i) => i.summary.includes('DEVICE_TEST_FAST_PATH')));
    },
  },
  {
    name: 'legacy 行内格式 + 0 条解析兜底',
    run: () => {
      const inline = parseLegacyAssumptionsMd('- spec.freeze 自动放行 must-review: 是\n', 'spec');
      assert.strictEqual(inline.length, 1);
      const fallback = parseLegacyAssumptionsMd('自由文本，无表格无行内标记。\n', 'spec');
      assert.strictEqual(fallback.length, 1);
      assert.ok(/未解析/.test(fallback[0].summary));
      assert.strictEqual(parseLegacyAssumptionsMd('', 'spec').length, 0, '空文件不合成');
    },
  },
  {
    name: 'collectAutoDecisions：JSONL 优先不双计；非法行折为待复核条目；md 回退',
    run: () => {
      const root = mkProject();
      writeFeatureFile(root, 'spec/headless-assumptions.jsonl', `${VALID_LINE}\n{broken\n`);
      writeFeatureFile(root, 'spec/headless-assumptions.md', INCIDENT_SPEC_MD);
      writeFeatureFile(root, 'testing/headless-assumptions.md', INCIDENT_TESTING_MD);
      const items = collectAutoDecisions(root, FEATURE, ['spec', 'testing']);
      const specItems = items.filter((i) => i.phase === 'spec');
      assert.strictEqual(specItems.length, 2, 'JSONL 1 条 + 非法行折 1 条；md 不再读');
      assert.ok(specItems.every((i) => i.source === 'jsonl'));
      const testingItems = items.filter((i) => i.phase === 'testing');
      assert.strictEqual(testingItems.length, 3);
      assert.ok(testingItems.every((i) => i.source === 'legacy_md'));
      assert.strictEqual(countPendingMustReview(items), 5);
      assert.ok(fs.existsSync(headlessLedgerPath(root, FEATURE, 'spec')));
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `headless-assumptions: ${c.name}`, ok: true };
    } catch (err) {
      return {
        name: `headless-assumptions: ${c.name}`,
        ok: false,
        error: (err as Error).stack ?? (err as Error).message,
      };
    }
  });
}
