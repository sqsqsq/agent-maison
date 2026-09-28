// ============================================================================
// check-spec-small-scale.unit.test.ts — C4 exploration-scale：spec 阶段
// project_scale=small 术语映射表一次性确认分支直接单测
// ============================================================================
// 覆盖 checkTerminologyMappingTable 的 small 档分支：逐行 [x] 缺失时，
// standard 档仍 FAIL；small 档下有/无「一次性确认」行分别 PASS/FAIL。
// 不构造完整 10 章节 spec.md fixture（那是 required_chapters 等其它一堆无关
// BLOCKER 的组合测试，成本与本测试目标不成比例）——直接调用被导出的检查函数，
// 只喂它需要的最小上下文（术语映射表章节 + module-catalog.yaml + 真实
// spec-rules.yaml 规则文本），更精确地锁定这一个分支。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkTerminologyMappingTable, checkUxReferenceMapping } from '../../scripts/check-spec';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { loadResolvedProfile } from '../../profile-loader';
import { loadFrameworkConfig } from '../../config';
import type { CheckContext } from '../../scripts/utils/types';
import { computeRequirementShaFromText } from '../../scripts/utils/fidelity-shared';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function includesId(results: Array<{ id: string; status: string }>, id: string, status?: string): boolean {
  return results.some((r) => r.id === id && (status === undefined || r.status === status));
}

function mkProject(projectScale: 'small' | 'standard' | undefined): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-small-scale-'));
  fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'doc'), { recursive: true });
  const cfg: Record<string, unknown> = {
    schema_version: '1.0',
    project_name: 'spec-small-scale-fixture',
    project_profile: { name: 'generic' },
    paths: { features_dir: 'doc/features', module_catalog: 'doc/module-catalog.yaml' },
  };
  if (projectScale) cfg.project_scale = projectScale;
  fs.writeFileSync(path.join(dir, 'framework.config.json'), JSON.stringify(cfg, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), YAML_CATALOG, 'utf-8');
  return dir;
}

const YAML_CATALOG = `schema_version: "1.0"
modules:
  - name: "ModA"
    layer: "02-Feature"
    format: "library"
    one_liner: "fixture module"
    responsibilities: ["biz"]
    NOT_responsible_for: []
    typical_business_terms: ["ModA"]
    easily_confused_with: []
    key_exports: ["Entry"]
    entry_file: "02-Feature/ModA/index.ets"
`;

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function buildCtx(projectRoot: string): CheckContext {
  const cfg = loadFrameworkConfig(projectRoot);
  const specLoader = new SpecLoader(projectRoot, undefined, undefined, FRAMEWORK_ROOT);
  const phaseRule = specLoader.loadPhaseRule('spec');
  const resolvedProfile = loadResolvedProfile(projectRoot, cfg);
  return {
    phase: 'spec',
    feature: 'demo',
    projectRoot,
    phaseRule,
    featureSpec: { feature: 'demo' },
    resolvedProfile,
  } as CheckContext;
}

const TABLE_HEADER = '| 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项 | 用户确认 |\n|---|---|---|---|---|---|';

function specWithTerminologyTable(rowConfirmCell: string, extraLine?: string): string {
  return [
    '## 0. 术语映射表',
    '',
    TABLE_HEADER,
    `| ModA术语 | ModA | 02-Feature | high | — | ${rowConfirmCell} |`,
    ...(extraLine ? ['', extraLine] : []),
    '',
    '## 1. 功能概述',
    '占位',
  ].join('\n');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'standard 档：逐行未确认（[ ]）→ FAIL，即便节末有一次性确认行也不放行',
    run: () => {
      const dir = mkProject('standard');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[ ]', '- [x] 已对照 architecture.md 模块清单一次性确认全部术语映射');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), true, 'standard 档逐行未确认应 FAIL（一次性确认对 standard 档不生效）');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'small 档：逐行未确认（[ ]）+ 无一次性确认行 → 仍 FAIL',
    run: () => {
      const dir = mkProject('small');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[ ]');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), true, 'small 档缺一次性确认行仍应 FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'small 档：逐行未确认（[ ]）+ 有一次性确认行 → PASS（整体放行）',
    run: () => {
      const dir = mkProject('small');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[ ]', '- [x] 已对照 architecture.md 模块清单一次性确认全部术语映射');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), false, 'small 档有一次性确认行不应 FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'small 档：一次性确认行未勾选（- [ ]）→ 仍 FAIL（不是"存在该行"就放行，须真的勾选）',
    run: () => {
      const dir = mkProject('small');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[ ]', '- [ ] 已对照 architecture.md 模块清单一次性确认全部术语映射');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), true, '一次性确认行未勾选应仍 FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'standard 档：逐行已确认（[x]）→ 正常 PASS（既有行为零回归）',
    run: () => {
      const dir = mkProject('standard');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[x]');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), false, 'standard 档逐行确认应 PASS');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

// ---- plan c4e7a9b2 t2（A2-4）：ref-elements `excluded` 必带逐字需求引文、且不得被 ui-spec 覆盖 ----
// 需求原文按**当前执行身份**读取（codex 批一返修 #1/#4）：goal 模式=MAISON_GOAL_RUN_ID 那一 run 的
// manifest；无 run=身份匹配的 explicit_cli fidelity-intent SSOT 所记 requirement_source_files。
const A2_QUOTE = '再往下的激活nfc部分本次先不需要';
const A2_DOC = 'doc/features/原始需求/1-2-银行卡/原始需求.md';
const A2_DOC_TEXT = `# 开卡\n\n添加成功页展示结果与完成按钮。${A2_QUOTE}。`;
interface ExcludedFixture {
  /** runId → manifest.requirement（缺省=R1 解引用含排除句的原始需求文档） */
  runs?: Record<string, string>;
  /** 当前 goal run（注入 MAISON_GOAL_RUN_ID）；null=无 run 执行身份 */
  currentRun?: string | null;
  /** 无 run：写 explicit_cli SSOT（requirement_source_files=[A2_DOC]），tamper=签发后改原文 */
  ssot?: { tamper?: boolean };
  specMd?: string;
}
function w(dir: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
}
function mkExcludedProject(refElements: Array<Record<string, unknown>>, fx: ExcludedFixture): string {
  const dir = mkProject('standard');
  w(dir, A2_DOC, `${A2_DOC_TEXT}\n`);
  for (const [runId, requirement] of Object.entries(fx.runs ?? {})) {
    w(dir, `doc/features/demo/goal-runs/${runId}/manifest.json`, JSON.stringify({ run_id: runId, requirement }));
    w(dir, `doc/features/demo/goal-runs/${runId}/events.jsonl`, `${JSON.stringify({ type: 'run_start' })}\n`);
  }
  if (fx.ssot) {
    w(dir, 'doc/features/demo/spec/reports/fidelity-intent.json', JSON.stringify({
      schema_version: '2.0', inferred_fidelity: 'pixel_1to1', selected_fidelity: 'pixel_1to1', effective_fidelity: 'pixel_1to1',
      acceptance_strictness: 'hard', asset_acquisition_mode: 'approximate', clamped: false,
      decision: { source: 'explicit_cli', rationale: 'fixture', decision_id: '0123456789abcdef' },
      execution_identity: 'phase:demo:spec',
      requirement_sha256: computeRequirementShaFromText(dir, 'demo', A2_DOC_TEXT, 'doc/features'),
      requirement_provenance: 'explicit_cli',
      requirement_source_files: [A2_DOC],
    }));
    if (fx.ssot.tamper) w(dir, A2_DOC, `# 开卡\n\n另一段话：${A2_QUOTE}。\n`);
  }
  if (fx.specMd) w(dir, 'doc/features/demo/spec/spec.md', fx.specMd);
  w(dir, 'doc/features/demo/spec/ui-spec.yaml', [
    "schema_version: '1.0'", 'screens:', '- id: add_card_result', '  priority: P0', '  must_have_elements:',
    '  - result_status', '  - result_done', '',
  ].join('\n'));
  w(dir, 'doc/features/demo/spec/ref-elements.yaml', JSON.stringify({ schema_version: '1.0', elements: refElements }));
  return dir;
}
const R1_WITH_QUOTE = { R1: `开卡流程 v2，见 ${A2_DOC}` };
function excludedResult(
  refElements: Array<Record<string, unknown>>,
  fx: ExcludedFixture = { runs: R1_WITH_QUOTE, currentRun: 'R1' },
): { id: string; status: string; details?: string } | undefined {
  const dir = mkExcludedProject(refElements, fx);
  const prev = process.env.MAISON_GOAL_RUN_ID;
  if (fx.currentRun) process.env.MAISON_GOAL_RUN_ID = fx.currentRun;
  else delete process.env.MAISON_GOAL_RUN_ID;
  try {
    return checkUxReferenceMapping(buildCtx(dir)).find((r) => r.id === 'ref_elements_excluded');
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOAL_RUN_ID;
    else process.env.MAISON_GOAL_RUN_ID = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const NFC_EXCLUDED = { element_id: 'result_nfc_card', disposition: 'excluded', requirement_quote: A2_QUOTE };
cases.push(
  {
    name: 'c4e7a9b2 A2-4 excluded：引文逐字在需求原文、元素不在 ui-spec → 不 FAIL',
    run: () => {
      const r = excludedResult([NFC_EXCLUDED]);
      eq(r?.status, 'PASS', `合法 excluded 应 PASS：${JSON.stringify(r)}`);
    },
  },
  {
    name: 'c4e7a9b2 A2-4 excluded：引文不在需求原文 → BLOCKER FAIL',
    run: () => {
      const r = excludedResult([{ element_id: 'result_nfc_card', disposition: 'excluded', requirement_quote: 'NFC 激活本期不做' }]);
      eq(r?.status, 'FAIL', `引文不在需求原文须 FAIL：${JSON.stringify(r)}`);
      eq((r?.details ?? '').includes('result_nfc_card'), true, '详情须点名元素');
    },
  },
  {
    name: 'c4e7a9b2 A2-4 excluded：缺 requirement_quote → BLOCKER FAIL',
    run: () => {
      const r = excludedResult([{ element_id: 'result_nfc_card', disposition: 'excluded' }]);
      eq(r?.status, 'FAIL', `缺引文须 FAIL：${JSON.stringify(r)}`);
    },
  },
  {
    name: 'c4e7a9b2 A2-4 excluded：元素被 ui-spec 覆盖 → BLOCKER FAIL',
    run: () => {
      const r = excludedResult([{ element_id: 'result_done', disposition: 'excluded', requirement_quote: A2_QUOTE }]);
      eq(r?.status, 'FAIL', `被 ui-spec 覆盖的元素不得 excluded：${JSON.stringify(r)}`);
    },
  },
  {
    name: 'c4e7a9b2 A2-4 无 excluded 条目 → 不产该检查（既有结果集零变化）',
    run: () => {
      eq(excludedResult([{ element_id: 'result_done', disposition: 'implement' }]), undefined, '无 excluded 不产噪音');
    },
  },
  {
    name: 'c4e7a9b2 返修#1 引文仅存在于历史 run R1、当前 R2 要求实现 NFC → FAIL（历史需求不得替当前 run 授权）',
    run: () => {
      const runs = { ...R1_WITH_QUOTE, R2: '开卡流程 v3：添加成功页必须实现 NFC 激活卡。' };
      eq(excludedResult([NFC_EXCLUDED], { runs, currentRun: 'R2' })?.status, 'FAIL', '当前 run 需求无排除句须 FAIL');
      eq(excludedResult([NFC_EXCLUDED], { runs, currentRun: 'R1' })?.status, 'PASS', '对照：当前 run 即含排除句的 R1 → PASS');
    },
  },
  {
    name: 'c4e7a9b2 返修#4 无 run：身份匹配的 explicit_cli SSOT 原文含引文 → PASS；错误引文 → FAIL',
    run: () => {
      const fx = { currentRun: null, ssot: {} };
      eq(excludedResult([NFC_EXCLUDED], fx)?.status, 'PASS', '无 run + --requirement-file 原文含排除句应 PASS');
      eq(excludedResult([{ ...NFC_EXCLUDED, requirement_quote: 'NFC 激活本期不做' }], fx)?.status, 'FAIL', '错误引文须 FAIL');
    },
  },
  {
    name: 'c4e7a9b2 返修#4 无 run：签发后原文被改（requirement_sha256 不符）/ 只有 spec.md 自证 → FAIL',
    run: () => {
      eq(excludedResult([NFC_EXCLUDED], { currentRun: null, ssot: { tamper: true } })?.status, 'FAIL', '原文与 SSOT 身份不符不得授权');
      eq(excludedResult([NFC_EXCLUDED], { currentRun: null, specMd: `# spec\n\n${A2_QUOTE}\n` })?.status, 'FAIL', 'spec.md 不得自证排除');
    },
  },
);

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
