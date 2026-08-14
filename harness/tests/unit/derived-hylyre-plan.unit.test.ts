// ============================================================================
// derived-hylyre-plan.unit.test.ts — SSOT 覆盖 / 占位 / mtime 选派生回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isPlaceholderDerivedPlan,
  evaluateDerivedCoverage,
  selectBestNonPlaceholderDerivedPlan,
  loadExplicitSkipTcIds,
  extractTcIdsFromPlanTable,
  lintDerivedHylyrePlanSteps,
  lintHylyrePlanStepRules,
  lintHylyrePlanMarkdown,
  normalizePlannedStepsCell,
  isFullscreenHorizontalSwipeStep,
  hylyreRunTimestamp,
  prepareFreshHylyreRunDir,
} from '../../scripts/utils/derived-hylyre-plan';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}
function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}
function assertIncludes(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: expected to include ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`);
  }
}

const minimalTable = (rows: string) =>
  [
    '## 测试用例清单',
    '',
    '| 用例编号 | 名称 |',
    '|----------|------|',
    rows,
  ].join('\n');

interface Case {
  name: string;
  run: () => void;
}

const cases: Case[] = [
  {
    name: 'isPlaceholderDerivedPlan: 烟测占位 → true',
    run: () => {
      const md = `## x\n> 烟测占位：x\n${minimalTable('| TC-001 | a |')}`;
      assertTrue(isPlaceholderDerivedPlan(md), 'expected placeholder');
    },
  },
  {
    name: 'isPlaceholderDerivedPlan: 正常派生 → false',
    run: () => {
      const md = `# 派生\n${minimalTable('| TC-001 | a |')}`;
      assertTrue(!isPlaceholderDerivedPlan(md), 'expected non-placeholder');
    },
  },
  {
    name: 'evaluateDerivedCoverage: 顶层 3 派生 1 → missing 2',
    run: () => {
      const r = evaluateDerivedCoverage({
        topTcIds: ['TC-001', 'TC-002', 'TC-003'],
        derivedTcIds: ['TC-001'],
        explicitSkipTcIds: [],
      });
      assertEq(r.missing, ['TC-002', 'TC-003'], 'missing');
      assertEq(r.extra, [], 'extra');
      assertTrue(!r.ok, 'ok');
    },
  },
  {
    name: 'evaluateDerivedCoverage: explicit_skip 扣减后无 missing',
    run: () => {
      const r = evaluateDerivedCoverage({
        topTcIds: ['TC-001', 'TC-002'],
        derivedTcIds: ['TC-001'],
        explicitSkipTcIds: ['TC-002'],
      });
      assertEq(r.missing, [], 'missing');
      assertEq(r.extra, [], 'extra');
      assertTrue(r.ok, 'ok');
    },
  },
  {
    name: 'evaluateDerivedCoverage: 派生多出行 → extra',
    run: () => {
      const r = evaluateDerivedCoverage({
        topTcIds: ['TC-001'],
        derivedTcIds: ['TC-001', 'TC-999'],
        explicitSkipTcIds: [],
      });
      assertEq(r.missing, [], 'missing');
      assertEq(r.extra, ['TC-999'], 'extra');
      assertTrue(!r.ok, 'ok');
    },
  },
  {
    name: 'extractTcIdsFromPlanTable + loadExplicitSkip: frontmatter + derive-manifest.json',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-ssot-'));
      const hylyreDir = path.join(dir, 'run1', 'hylyre');
      fs.mkdirSync(hylyreDir, { recursive: true });
      const planPath = path.join(hylyreDir, 'test-plan.hylyre.md');
      const md = [
        '---',
        'explicit_skip_tc_ids: [TC-002]',
        '---',
        '',
        minimalTable('| TC-001 | a |'),
      ].join('\n');
      fs.writeFileSync(planPath, md, 'utf-8');
      fs.writeFileSync(
        path.join(hylyreDir, 'derive-manifest.json'),
        JSON.stringify({ explicit_skip_tc_ids: ['TC-003', 'tc-003'] }),
        'utf-8',
      );
      const skips = loadExplicitSkipTcIds(planPath, md);
      assertEq(skips.sort(), ['TC-002', 'TC-003'], 'merged skips');
      const ids = extractTcIdsFromPlanTable(md);
      assertEq(ids, ['TC-001'], 'derived ids');
    },
  },
  {
    name: 'isFullscreenHorizontalSwipeStep: swipe RIGHT 无 area → true',
    run: () => {
      assertTrue(
        isFullscreenHorizontalSwipeStep({ swipe: { direction: 'RIGHT', distance: 60 } }),
        'horizontal swipe',
      );
      assertTrue(
        !isFullscreenHorizontalSwipeStep({
          swipe: { direction: 'RIGHT', distance: 60, area: { by_type: 'Scroll' } },
        }),
        'scoped swipe',
      );
    },
  },
  {
    name: 'lintDerivedHylyrePlanSteps: v7 风格末段 TC-005/003 含 NAV-001 与 NAV-003',
    run: () => {
      const md = [
        '## 测试用例清单',
        '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
        '|----------|---------|---------|---------|---------|--------|---------|',
        '| TC-004 | 进卡包 | 已在「首页」Tab | {"touch":{"by_text":"添加管理卡片"}} | 进入卡包页 | P0 | AC-4 |',
        '| TC-005 | 加号 | 已在「首页」Tab | {"swipe":{"direction":"RIGHT","distance":60}} ; {"touch":{"by_text":"首页"}} ; {"touch":{"by_text":"+"}} | 进入添卡页 | P0 | AC-5 |',
        '| TC-003 | 卡面 | 已在「首页」Tab | {"swipe":{"direction":"RIGHT","distance":60}} ; {"touch":{"by_text":"首页"}} | 进入卡包页 | P0 | AC-3 |',
      ].join('\n');
      const r = lintDerivedHylyrePlanSteps(md);
      assertTrue(!r.ok, 'v7-like plan must fail lint');
      const rules = new Set(r.violations.map(v => v.rule_id));
      assertTrue(rules.has('NAV-001'), 'NAV-001');
      assertTrue(rules.has('NAV-003'), 'NAV-003');
    },
  },
  {
    // t7b（plan e6a3c9f4）：check-testing 标准路径接入的 STEP 级门禁所消费的判定——
    // 非法根键 / 禁用 CLI 键 / wait 误用 timeout 均须 BLOCKER。
    name: 'lintHylyrePlanStepRules: 非法根键/禁用 CLI 键/wait timeout → BLOCKER（t7b 接线判定）',
    run: () => {
      const md = [
        '## 测试用例清单',
        '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
        '|----------|---------|---------|---------|---------|--------|---------|',
        '| TC-001 | 未知键 | - | {"tap":{"by_text":"确定"}} | x | P0 | AC-1 |',
        '| TC-002 | 禁用 CLI 键 | - | {"dump_ui":{}} | x | P0 | AC-2 |',
        '| TC-003 | wait 误用 | - | {"wait":{"timeout":3}} | x | P1 | AC-3 |',
        '| TC-004 | 冷启越权 | - | {"start_app":{}} | x | P1 | AC-4 |',
      ].join('\n');
      const r = lintHylyrePlanStepRules(md);
      assertTrue(!r.ok, 'illegal steps must fail');
      const blockers = r.violations.filter(v => v.severity === 'BLOCKER');
      const byTc = (tc: string) => blockers.filter(v => v.tc_id === tc);
      assertTrue(byTc('TC-001').length > 0, 'TC-001 未知根键须 BLOCKER');
      assertTrue(byTc('TC-002').some(v => v.rule_id === 'STEP-002'), 'TC-002 dump_ui 须 STEP-002');
      assertTrue(byTc('TC-003').some(v => /timeout|seconds/i.test(v.message)), 'TC-003 wait timeout 须拦');
      assertTrue(byTc('TC-004').length > 0, 'TC-004 start_app 须拦（派生计划冷启由 harness 负责）');
    },
  },
  {
    name: 'lintHylyrePlanStepRules: 合法计划零违规（t7b 好态）',
    run: () => {
      const md = [
        '## 测试用例清单',
        '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
        '|----------|---------|---------|---------|---------|--------|---------|',
        '| TC-001 | 触控 | 已在「首页」Tab | {"touch":{"by_text":"添加"}} ; {"wait":{"seconds":1}} ; {"wait_for":{"by_text":"完成"}} | x | P0 | AC-1 |',
      ].join('\n');
      const r = lintHylyrePlanStepRules(md);
      assertTrue(r.ok, `legal plan must pass: ${JSON.stringify(r.violations)}`);
    },
  },
  {
    name: 'lintDerivedHylyrePlanSteps: 合规 back 前缀 → ok',
    run: () => {
      const md = [
        '## 测试用例清单',
        '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
        '|----------|---------|---------|---------|---------|--------|---------|',
        '| TC-004 | 进卡包 | 已在「首页」Tab | {"touch":{"by_text":"添加管理卡片"}} | 进入卡包页 | P0 | AC-4 |',
        '| TC-005 | 加号 | 已在「首页」Tab | {"back":{}} ; {"touch":{"by_text":"首页"}} ; {"touch":{"by_text":"+"}} | 进入添卡页 | P0 | AC-5 |',
      ].join('\n');
      const r = lintDerivedHylyrePlanSteps(md);
      assertTrue(r.ok, `expected pass, got ${JSON.stringify(r.violations)}`);
    },
  },
  {
    name: 'normalizePlannedStepsCell: strips backticks per fragment',
    run: () => {
      const raw = '`{"touch":{"by_text":"首页"}}` ; `{"start_app":{}}`';
      const out = normalizePlannedStepsCell(raw);
      assertIncludes(out, '{"touch":{"by_text":"首页"}}', 'touch canonical');
      assertIncludes(out, '{"start_app":{}}', 'start_app direct');
      assertTrue(!out.includes('`'), 'no backticks');
    },
  },
  {
    name: 'lintHylyrePlanMarkdown: STEP-005 backticks → violation',
    run: () => {
      const md = [
        '## 测试用例清单',
        '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
        '|----------|---------|---------|---------|---------|--------|---------|',
        '| TC-001 | x | y | `{"touch":{"by_text":"首页"}}` | z | P0 | AC-1 |',
      ].join('\n');
      const r = lintHylyrePlanMarkdown(md);
      assertTrue(!r.ok, 'should fail');
      assertTrue(
        r.violations.some(v => v.rule_id === 'STEP-005'),
        `expected STEP-005, got ${JSON.stringify(r.violations)}`,
      );
    },
  },
  {
    name: 'lintHylyrePlanMarkdown: STEP-006 action wrapper → WARN violation',
    run: () => {
      const md = [
        '## 测试用例清单',
        '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
        '|----------|---------|---------|---------|---------|--------|---------|',
        '| TC-001 | x | y | {"action":{"type":"touch","by_text":"首页"}} | z | P0 | AC-1 |',
      ].join('\n');
      const r = lintHylyrePlanMarkdown(md);
      assertTrue(
        r.violations.some(v => v.rule_id === 'STEP-006'),
        `expected STEP-006, got ${JSON.stringify(r.violations)}`,
      );
    },
  },
  {
    name: 'lintHylyrePlanMarkdown: STEP-WAIT-SECONDS wait+timeout → BLOCKER',
    run: () => {
      const md = [
        '## 测试用例清单',
        '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
        '|----------|---------|---------|---------|---------|--------|---------|',
        '| TC-001 | x | y | {"wait":{"timeout":3}} | z | P0 | AC-1 |',
      ].join('\n');
      const r = lintHylyrePlanMarkdown(md);
      assertTrue(!r.ok, 'should fail');
      assertTrue(
        r.violations.some(v => v.rule_id === 'STEP-WAIT-SECONDS'),
        `expected STEP-WAIT-SECONDS, got ${JSON.stringify(r.violations)}`,
      );
    },
  },
  {
    name: 'selectBestNonPlaceholderDerivedPlan: 占位目录 mtime 更新时先被剔除，再选有效派生',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-mtime-'));
      const oldDir = path.join(base, 'smoke-9999', 'hylyre');
      const newDir = path.join(base, '20260519-a', 'hylyre');
      fs.mkdirSync(oldDir, { recursive: true });
      fs.mkdirSync(newDir, { recursive: true });
      const smokePath = path.join(oldDir, 'test-plan.hylyre.md');
      const goodPath = path.join(newDir, 'test-plan.hylyre.md');
      fs.writeFileSync(
        smokePath,
        `> 烟测占位\n${minimalTable('| TC-001 |')}`,
        'utf-8',
      );
      fs.writeFileSync(goodPath, `${minimalTable('| TC-001 |')}`, 'utf-8');
      const older = Date.now() / 1000 - 4000;
      const newer = Date.now() / 1000 - 1000;
      // 占位目录名字典序常晚于时间戳目录，但若占位 mtime 更「新」会先被读到并剔除
      fs.utimesSync(goodPath, older, older);
      fs.utimesSync(smokePath, newer, newer);
      const pick = selectBestNonPlaceholderDerivedPlan(base);
      assertTrue(pick.selected !== null, 'selected');
      assertEq(path.normalize(pick.selected!.hylyrePath), path.normalize(goodPath), 'path');
      assertEq(pick.rejectedPlaceholders.length, 1, 'placeholder rejected then valid picked');
    },
  },
  // ==========================================================================
  // run-directory-freshness（plan 420a5005）——验收四例
  // ==========================================================================
  {
    name: 'hylyreRunTimestamp: UTC ISO 压缩形态 <YYYYMMDD>T<HHMMSS>Z-<ms>，保留毫秒精度（review P1）',
    run: () => {
      const iso = Date.parse('2026-08-12T04:47:08.123Z');
      assertEq(hylyreRunTimestamp(iso), '20260812T044708Z-123', 'stamp');
      // 同秒不同毫秒 → 互异戳（连续执行互斥）
      const isoB = Date.parse('2026-08-12T04:47:08.456Z');
      assertTrue(hylyreRunTimestamp(iso) !== hylyreRunTimestamp(isoB), '同秒不同毫秒须互异');
    },
  },
  {
    name: 'run-directory-freshness ①: 同一源计划连续执行两次 → 两个不同目录（含同秒不同毫秒）',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-fresh-'));
      const srcDir = path.join(base, '20260810T184000-codex-testing', 'hylyre');
      fs.mkdirSync(srcDir, { recursive: true });
      const srcPath = path.join(srcDir, 'test-plan.hylyre.md');
      fs.writeFileSync(srcPath, `${minimalTable('| TC-001 | a |')}`, 'utf-8');
      const t1 = Date.parse('2026-08-12T04:47:08.000Z');
      const t2 = Date.parse('2026-08-12T04:48:09.000Z');
      // 源派生为旧执行产物：mtime 早于两轮执行时点（只读输入角色）
      const srcOld = Date.parse('2026-08-10T18:40:00.000Z');
      fs.utimesSync(srcPath, srcOld / 1000, srcOld / 1000);
      const r1 = prepareFreshHylyreRunDir({ reportsBase: base, sourceHylyrePlanAbsPath: srcPath, nowMs: t1 });
      const r2 = prepareFreshHylyreRunDir({ reportsBase: base, sourceHylyrePlanAbsPath: srcPath, nowMs: t2 });
      assertTrue(r1.ok && r2.ok, 'both ok');
      if (!r1.ok || !r2.ok) return;
      assertTrue(r1.runDir !== r2.runDir, 'two distinct run dirs');
      assertTrue(r1.runDir.endsWith(path.join('20260812T044708Z-000', 'hylyre')), `r1 dir: ${r1.runDir}`);
      assertTrue(r2.runDir.endsWith(path.join('20260812T044809Z-000', 'hylyre')), `r2 dir: ${r2.runDir}`);
      // 同秒连续两次（毫秒不同）→ 仍互异
      const tSameSec1 = Date.parse('2026-08-12T04:50:00.100Z');
      const tSameSec2 = Date.parse('2026-08-12T04:50:00.900Z');
      const rs1 = prepareFreshHylyreRunDir({ reportsBase: base, sourceHylyrePlanAbsPath: srcPath, nowMs: tSameSec1 });
      const rs2 = prepareFreshHylyreRunDir({ reportsBase: base, sourceHylyrePlanAbsPath: srcPath, nowMs: tSameSec2 });
      assertTrue(rs1.ok && rs2.ok, 'same-second both ok');
      if (!rs1.ok || !rs2.ok) return;
      assertTrue(rs1.runDir !== rs2.runDir, '同秒不同毫秒 → 两独立目录');
      // 每次执行都产生独立新目录：最后一次选中 mtime 最新 → 新目录被选中（选择器回归）
      const pick = selectBestNonPlaceholderDerivedPlan(base);
      assertTrue(pick.selected !== null, 'selected');
      assertEq(path.normalize(pick.selected!.hylyrePath), path.normalize(rs2.hylyrePlanAbsPath), 'latest picked');
    },
  },
  {
    name: 'run-directory-freshness ②: 原输入目录字节不变（只读输入）',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-fresh-ro-'));
      const srcDir = path.join(base, '20260810T184000-codex-testing', 'hylyre');
      fs.mkdirSync(srcDir, { recursive: true });
      const srcPath = path.join(srcDir, 'test-plan.hylyre.md');
      const manifestSrc = path.join(srcDir, 'derive-manifest.json');
      const planBody = `---\nexplicit_skip_tc_ids: [TC-002]\n---\n${minimalTable('| TC-001 | a |')}`;
      fs.writeFileSync(srcPath, planBody, 'utf-8');
      fs.writeFileSync(manifestSrc, JSON.stringify({ explicit_skip_tc_ids: ['TC-002'] }), 'utf-8');
      const srcBefore = fs.readFileSync(srcPath, 'utf-8');
      const manBefore = fs.readFileSync(manifestSrc, 'utf-8');
      const r = prepareFreshHylyreRunDir({
        reportsBase: base,
        sourceHylyrePlanAbsPath: srcPath,
        nowMs: Date.parse('2026-08-12T04:47:08.000Z'),
      });
      assertTrue(r.ok, `ok: ${r.ok === false ? r.error : ''}`);
      if (!r.ok) return;
      assertEq(fs.readFileSync(srcPath, 'utf-8'), srcBefore, 'src plan unchanged');
      assertEq(fs.readFileSync(manifestSrc, 'utf-8'), manBefore, 'src manifest unchanged');
      // 复制件字节一致 + manifest 一并复制
      assertEq(fs.readFileSync(r.hylyrePlanAbsPath, 'utf-8'), srcBefore, 'copied plan identical');
      assertEq(r.copiedManifest, true, 'manifest copied along');
      assertEq(
        fs.readFileSync(path.join(r.runDir, 'derive-manifest.json'), 'utf-8'),
        manBefore,
        'copied manifest identical',
      );
    },
  },
  {
    name: 'run-directory-freshness ③: 第二轮无 trace 时 resolver 返回无有效 trace，不回退第一轮',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-fresh-res-'));
      const srcDir = path.join(base, '20260810T184000-codex-testing', 'hylyre');
      fs.mkdirSync(srcDir, { recursive: true });
      const srcPath = path.join(srcDir, 'test-plan.hylyre.md');
      fs.writeFileSync(srcPath, `${minimalTable('| TC-001 | a |')}`, 'utf-8');
      // 第一轮：新目录已写 trace；第二轮：新目录无 trace（resolver 应返回 null，不回退第一轮）
      const r1 = prepareFreshHylyreRunDir({
        reportsBase: base,
        sourceHylyrePlanAbsPath: srcPath,
        nowMs: Date.parse('2026-08-12T04:47:08.000Z'),
      });
      assertTrue(r1.ok, 'r1 ok');
      if (!r1.ok) return;
      fs.writeFileSync(path.join(r1.runDir, 'trace.json'), JSON.stringify({ outcome: 'success' }), 'utf-8');
      const r2 = prepareFreshHylyreRunDir({
        reportsBase: base,
        sourceHylyrePlanAbsPath: srcPath,
        nowMs: Date.parse('2026-08-12T04:48:09.000Z'),
      });
      assertTrue(r2.ok, 'r2 ok');
      if (!r2.ok) return;
      // 第二轮目录存在、无 trace——resolver 从选中（最新=第二轮）目录取 trace，得 null
      assertTrue(!fs.existsSync(path.join(r2.runDir, 'trace.json')), 'r2 has no trace');
      const { resolveAuthoritativeHylyreTracePath } = require('../../scripts/utils/testing-trace-gates') as typeof import('../../scripts/utils/testing-trace-gates');
      const trace = resolveAuthoritativeHylyreTracePath(base);
      assertEq(trace, null, 'no fallback to first round（不回退第一轮）');
    },
  },
  {
    name: 'run-directory-freshness ④: 目录冲突 → fail-closed，零写入、不覆盖不复用',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-fresh-cl-'));
      const srcDir = path.join(base, '20260810T184000-codex-testing', 'hylyre');
      fs.mkdirSync(srcDir, { recursive: true });
      const srcPath = path.join(srcDir, 'test-plan.hylyre.md');
      fs.writeFileSync(srcPath, `${minimalTable('| TC-001 | a |')}`, 'utf-8');
      const t = Date.parse('2026-08-12T04:47:08.000Z');
      const r1 = prepareFreshHylyreRunDir({ reportsBase: base, sourceHylyrePlanAbsPath: srcPath, nowMs: t });
      assertTrue(r1.ok, 'r1 ok');
      if (!r1.ok) return;
      const planBefore = fs.readFileSync(path.join(r1.runDir, 'test-plan.hylyre.md'), 'utf-8');
      // 同秒再次准备 → fail-closed：覆盖/复用被拒
      const r2 = prepareFreshHylyreRunDir({ reportsBase: base, sourceHylyrePlanAbsPath: srcPath, nowMs: t });
      assertTrue(!r2.ok, 'conflict must fail-closed');
      assertIncludes(r2.ok === false ? r2.error : '', '已存在', 'error mentions exists');
      // 零写入：原复制内容未被改动、未新增多余文件
      assertEq(fs.readFileSync(path.join(r1.runDir, 'test-plan.hylyre.md'), 'utf-8'), planBefore, 'no rewrite');
      const entries = fs.readdirSync(r1.runDir).filter(n => !n.startsWith('.'));
      assertEq(entries.length, 1, `zero extra writes, got ${entries.join(',')}`);
    },
  },
  {
    name: 'run-directory-freshness: 源不存在 → fail-closed',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-fresh-miss-'));
      const r = prepareFreshHylyreRunDir({
        reportsBase: base,
        sourceHylyrePlanAbsPath: path.join(base, 'nope', 'test-plan.hylyre.md'),
        nowMs: Date.parse('2026-08-12T04:47:08.000Z'),
      });
      assertTrue(!r.ok, 'missing source fail-closed');
    },
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return Promise.resolve(runSync());
}

function runSync(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({
        name: c.name,
        ok: false,
        error: (e as Error).message,
      });
    }
  }
  return results;
}