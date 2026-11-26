import { runUnitCasesAsync } from '../utils/unit-cases';
import { assembleAIPrompt } from '../../scripts/utils/report-generator';
// ============================================================================
// goal-brief.unit.test.ts — 目标简报同源注入（plan 33784ed1 §3，验收 A1/A2/A3/A5）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { assembleGoalBrief, renderGoalBrief, resolvedInputsCarryRequirement } from '../../scripts/utils/goal-brief';
import { collectCurrentRequirementText } from '../../scripts/utils/fidelity-shared';
import { buildGoalManifestFromInput, mergeSuccessorRequirement } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { renderWorkUnitAuthorFeedback } from '../../scripts/goal-phase-runtime';
import type { CurrentDisposition } from '../../scripts/utils/check-disposition';
import { clearFrameworkConfigCache } from '../../config';
import type { ResolvedPhaseInputs } from '../../scripts/utils/capability-resolution';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

const REF_ELEMENTS_EXCLUDED = [
  'schema_version: "1.0"',
  'elements:',
  '  - element_id: result_nfc_card',
  '    disposition: excluded',
  '    requirement_quote: "本次不做 NFC 卡"',
  '  - element_id: bank_count',
  '    disposition: defer',
  '    screen_ref_id: bank_list',
  '    note: 本次保留20家，不扩至100家',
  '  - element_id: result_done',
  '    disposition: implement',
  '',
].join('\n');

const SPEC_WITH_SCOPE = [
  '# spec',
  '',
  '## Scope 声明',
  '',
  '```yaml',
  'in_scope_modules: [demo]',
  'out_of_scope_modules: [payment]',
  'rationale: 只改 demo',
  '```',
  '',
].join('\n');

/** "明确不做"一栏的文本（不含简报总标题）——各注入点必须逐字包含它。 */
function exclusionsSection(root: string, feature: string): string {
  const text = renderGoalBrief(assembleGoalBrief(root, feature), { sections: ['exclusions'] });
  const at = text.indexOf('### 明确不做');
  assert(at >= 0, `构造性前提：工程须有明确不做一栏，实得：${text}`);
  return text.slice(at);
}

function withTmp(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-brief-'));
  clearFrameworkConfigCache();
  try { fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'e9d49418 延后展示兼容宿主 ref_id 并携带元素原文，screen_ref_id 优先',
    run: () => withTmp(root => {
      put(root, 'doc/features/demo/spec/ref-elements.yaml', [
        'elements:',
        '  - element_id: bank_count',
        '    ref_id: card_type_sheet',
        '    text: 支持100家银行',
        '    disposition: defer',
        '    note: 本次保留20家',
        '  - element_id: bank_search',
        '    screen_ref_id: bank_list',
        '    ref_id: ignored_alias',
        '    text: 搜索银行',
        '    disposition: defer',
        '    note: 本次不新增搜索',
      ].join('\n'));
      const text = renderGoalBrief(assembleGoalBrief(root, 'demo', { runId: '' }), { sections: ['deferrals'] });
      assert(text.includes('bank_count（card_type_sheet）「支持100家银行」：本次保留20家'), `宿主字段与原文须展示：${text}`);
      assert(text.includes('bank_search（bank_list）「搜索银行」：本次不新增搜索') && !text.includes('ignored_alias'), `标准屏名字段优先：${text}`);
      assert(text.includes('来源 doc/features/demo/spec/ref-elements.yaml'), '保留既有来源');
    }),
  },
  {
    name: 'e9d49418 coding 实际提示只展开一次完整脚本报告',
    run: () => withTmp(root => {
      const marker = 'coding-report-unique-e9d49418';
      const prompt = assembleAIPrompt(path.join(FRAMEWORK_ROOT, 'harness'), root, 'coding', 'demo', [], JSON.stringify({ evidence: marker }), '', undefined, undefined, FRAMEWORK_ROOT);
      assert(prompt.split(marker).length === 2, '报告只展开一次');
      assert(prompt.includes('coding_compile_gate') && prompt.includes('真实编译'), '当前真实编译义务须进入完整材料');
      const reportPath = 'doc/features/demo/coding/reports/script-report.json';
      const check = { id: 'coding_compile', category: 'compilation', severity: 'BLOCKER', status: 'FAIL',
        details: 'exit_code=1, durationMs=5\nraw tool metadata and original log', failure_kind: 'code_regression',
        affected_files: ['src/a.ts'], structured: { compiler_diagnostics: [{ file: 'src/a.ts', line: 1, code: 'TS2322', message: 'actual type mismatch' }],
          performance: { p95_ms: 10 } } };
      const feedback = (): string => {
        put(root, reportPath, JSON.stringify({ checks: [check] }));
        put(root, 'doc/features/demo/coding/reports/summary.json', JSON.stringify({ verdict: 'FAIL', script_report: reportPath }));
        const original = fs.readFileSync(path.join(root, reportPath), 'utf8');
        const problem: CurrentDisposition['problems'][number] = { phase: 'coding', id: check.id, action: 'repair',
          owner: 'coding', affects: 'completion', severity: 'BLOCKER', detail: check.details, files: check.affected_files };
        const disposition: CurrentDisposition = { problems: [problem], completionBlocking: [problem], releaseBlocking: [], disclosed: [],
          completionEligible: false, releaseReady: false, reasons: [problem.detail] };
        const rendered = renderWorkUnitAuthorFeedback({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', disposition });
        assert(fs.readFileSync(path.join(root, reportPath), 'utf8') === original, '语义工作材料不得改写完整原报告');
        return rendered;
      };
      const before = feedback();
      check.details = 'exit_code=1, durationMs=2\nupdated tool metadata; complete original log remains readable';
      assert(feedback() === before, '原生编译展示遥测变化不是新的作者工作');
      assert(before.includes('TS2322') && before.includes(reportPath), '完整真实诊断与原始报告路径必须交付');
      check.structured.compiler_diagnostics[0].message = 'a different actual type mismatch';
      const changedDiagnostic = feedback();
      assert(changedDiagnostic !== before, '真实编译诊断变化必须改变工作材料');
      check.structured.performance.p95_ms = 20;
      assert(feedback() !== changedDiagnostic, '真实结构化业务性能指标不能被展示归一化吞掉');
      check.id = 'frame_p95_latency';
      check.details = '真实业务p95=120ms；用户新指令：durationMs=2必须保留';
      const measured = feedback();
      assert(measured.includes(check.details), '非编译业务指标与用户原文不能按duration字符串删除');
      check.details = '真实业务p95=150ms；用户新指令：durationMs=3必须保留';
      assert(feedback() !== measured, '真实业务数值及用户指令变化必须改变材料');
      const visualReport = 'doc/features/demo/testing/reports/script-report.json';
      const visual = { id: 'visual_diff', category: 'structure', severity: 'BLOCKER', status: 'FAIL', details: '当前真实残差原文',
        suggestion: '完整修复建议原文', failure_kind: undefined as string | undefined,
        structured: { kind: 'visual_diff', loop_id: 'old-loop', attempt_id: 'i1', goal_run_id: 'old-run',
          round: { disposition: 'appended', decision: { fused: false } }, defect_fingerprints: ['real-defect'],
          screens_hash: 'real-screens', build_fingerprint: 'real-build', channel_evidence_usable: false,
          user_facts: { round: '用户业务原文', suggestion: '真实建议事实', p95_ms: 10 } } };
      const visualFeedback = (): string => {
        put(root, visualReport, JSON.stringify({ checks: [visual] }));
        put(root, 'doc/features/demo/testing/reports/summary.json', JSON.stringify({ verdict: 'FAIL', script_report: visualReport }));
        const original = fs.readFileSync(path.join(root, visualReport), 'utf8');
        const problem: CurrentDisposition['problems'][number] = { phase: 'testing', id: 'visual_diff', action: 'repair',
          owner: 'coding', affects: 'completion', severity: 'BLOCKER', detail: visual.details };
        const rendered = renderWorkUnitAuthorFeedback({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo',
          disposition: { problems: [problem], completionBlocking: [problem], releaseBlocking: [], disclosed: [],
            completionEligible: false, releaseReady: false, reasons: [problem.detail] } });
        assert(fs.readFileSync(path.join(root, visualReport), 'utf8') === original && original.includes(visual.suggestion), '视觉原报告及完整建议不得被改写或丢弃');
        return rendered;
      };
      const visualBefore = visualFeedback();
      visual.failure_kind = 'no_progress_fuse'; visual.details += '\n机器停机控制说明：no_fix_attempt';
      visual.structured.round.disposition = 'duplicate'; visual.structured.round.decision.fused = true;
      visual.structured.loop_id = 'new-loop'; visual.structured.attempt_id = 'i2'; visual.structured.goal_run_id = 'new-run';
      assert(visualFeedback() === visualBefore, '相同视觉业务事实不能因已消费执行控制说明成为新的作者工作');
      assert(visualBefore.includes(visualReport) && visualBefore.includes('suggestion') && visualBefore.includes('用户业务原文'), '完整原文必须可达，未知业务字段不能递归按名删掉');
      visual.structured.defect_fingerprints = ['genuine-new-defect'];
      const visualChanged = visualFeedback();
      assert(visualChanged !== visualBefore, '真实缺陷对象变化必须改变反馈');
      visual.structured.user_facts.p95_ms = 20;
      assert(visualFeedback() !== visualChanged, '未知业务指标变化必须保留');
    }),
  },
  {
    name: 'A2 需求原文不可得：简报如实写明，明确不做/判定办法照常；无 run 不出权限栏',
    run: () => withTmp(root => {
      put(root, 'doc/features/demo/spec/ref-elements.yaml', REF_ELEMENTS_EXCLUDED);
      put(root, 'doc/features/demo/spec/spec.md', SPEC_WITH_SCOPE);
      const brief = assembleGoalBrief(root, 'demo', { runId: '' });
      assert(brief.requirement === null, `无 run、无 SSOT 时需求须不可得，实得 ${JSON.stringify(brief.requirement)}`);
      const text = renderGoalBrief(brief);
      assert(text.includes('需求原文不可得'), `须如实写明需求不可得：${text}`);
      assert(text.includes('参考图元素 result_nfc_card：「本次不做 NFC 卡」'), `排除项须带引文：${text}`);
      assert(!text.includes('result_done'), 'implement 元素不是排除项');
      assert(text.includes('### 本次延后') && text.includes('本次保留20家，不扩至100家') && text.includes('spec/ref-elements.yaml'), '延后必须携带真实理由与来源');
      assert(!exclusionsSection(root, 'demo').includes('bank_count'), 'defer 不能冒充原文排除');
      assert(!text.includes('出范围模块：payment'), '模型预测不能在原需求缺席时冒充明确用户禁止');
      assert(text.includes('即使尚未登记'), '明确不做须提示需求原文里的排除同样有效');
      assert(text.includes('### 判定办法') && text.includes('权威判定'), '判定办法恒有');
      assert(!text.includes('### 已授予的权限'), '无 run 时省略权限栏');
      assert(!text.includes('### 已裁决的冲突'), '批一无拒修记录，省略该栏');
      // 两栏都没有 → 控制台两栏渲染为空串（不打印）
      assert(renderGoalBrief({ requirement: null, resolved_conflicts: [] }, { sections: ['exclusions', 'resolved_conflicts'] }) === '',
        '明确不做与已裁决的冲突都为空时控制台两栏不打印');
    }),
  },
  {
    name: 'goal run：需求取本 run 冻结文本（含本轮修复增量）、不重读源文件；权限栏来自 effectiveHeadlessUnattended；既有需求收集不变',
    run: () => withTmp(root => {
      put(root, 'framework.config.json', JSON.stringify({ schema_version: '1.1', project_name: 'brief', paths: { features_dir: 'doc/features' } }));
      put(root, 'req/source.md', 'SOURCE_FILE_BODY_ONLY_IN_FILE\n');
      const requirement = mergeSuccessorRequirement('首页展示余额', '修复：余额位数');
      const manifest = buildGoalManifestFromInput({
        feature: 'demo', run_id: 'brief-run', requirement, requirement_source_files: ['req/source.md'],
        unattended: { write_mode: 'workspace-write', approval_mode: 'on-request' },
      }, { projectRoot: root });
      createGoalRun({ projectRoot: root, manifest, chain: ['spec'] });
      const brief = assembleGoalBrief(root, 'demo', { runId: 'brief-run' });
      assert(brief.requirement === requirement.trim(), `须取冻结的 manifest.requirement，实得 ${JSON.stringify(brief.requirement)}`);
      assert(brief.requirement.includes('本轮修复增量'), '后继增量随冻结文本进入简报');
      assert(!renderGoalBrief(brief).includes('SOURCE_FILE_BODY_ONLY_IN_FILE'), '简报不重读需求源文件');
      assert(brief.permissions?.write_mode === 'full-access' && brief.permissions.approval_mode === 'never',
        `权限栏取 effectiveHeadlessUnattended，实得 ${JSON.stringify(brief.permissions)}`);
      // 共用身份解析后，既有函数行为不变：run 分支仍拼 requirement_source_files 原文
      const prev = process.env.MAISON_GOAL_RUN_ID;
      process.env.MAISON_GOAL_RUN_ID = 'brief-run';
      try {
        const collected = collectCurrentRequirementText(root, 'demo');
        assert(collected.includes('首页展示余额') && collected.includes('SOURCE_FILE_BODY_ONLY_IN_FILE'), `既有收集须仍拼源文件：${collected}`);
        assert(assembleGoalBrief(root, 'demo').requirement === requirement.trim(), '缺省取 MAISON_GOAL_RUN_ID');
        process.env.MAISON_GOAL_RUN_ID = 'not-authoritative';
        assert(collectCurrentRequirementText(root, 'demo') === '', '非权威 run 仍返回空串，不回落无 run 分支');
        assert(assembleGoalBrief(root, 'demo').requirement === null, '非权威 run 的简报如实不可得');
      } finally {
        if (prev === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = prev;
      }
    }),
  },
  {
    name: 'A3 装配去重：verifier 已解析输入里已有需求正文时，简报不重复需求正文',
    run: () => {
      const brief = { requirement: 'REQUIREMENT_BODY_7f3', resolved_conflicts: [] };
      const binding = (provider: string) => ({ input_id: 'requirement', source: { kind: 'derive', provider_id: provider }, dependencies: [], source_refs: [], content_fingerprint: 'x' });
      const inputs = (value: unknown, provider = 'derive.requirement') => ({
        context: {}, phase: 'spec', artifacts: {},
        values: { requirement: { state: 'resolved', value, binding: binding(provider) } },
      }) as unknown as ResolvedPhaseInputs;
      assert(resolvedInputsCarryRequirement(inputs('REQUIREMENT_BODY_7f3')), '已解析输入带需求正文 → true');
      assert(!resolvedInputsCarryRequirement(inputs(undefined)), 'goal 分支 derive.requirement 无正文 → false');
      assert(!resolvedInputsCarryRequirement(inputs('x', 'derive.codebase')), '其它 provider 不算需求');
      assert(!resolvedInputsCarryRequirement(undefined), '无已解析输入 → false');
      const dedup = renderGoalBrief(brief, { requirementInContext: true });
      assert(!dedup.includes('REQUIREMENT_BODY_7f3'), `已在上下文时不得重复需求正文：${dedup}`);
      assert(dedup.includes('### 需求原文'), '栏目保留并指明正文所在');
      assert(renderGoalBrief(brief).includes('REQUIREMENT_BODY_7f3'), '未在上下文时照常给需求正文');
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  return runUnitCasesAsync(cases);
}
