// ============================================================================
// context-facts.unit.test.ts — C4 Context Facts Gate 直接单测（codex review 采纳）
// ============================================================================
// 覆盖 checkFactsArtifact 的核心分支：建立阶段全量检查通过/量化不足、
// delta 阶段节缺失/为空/存在、legacy per-phase 回落（WARN）、
// facts.md 与 legacy 均缺失（FAIL）、testing 阶段无 legacy 回落、
// frontmatter 校验（schema_version/feature/established_by/ready_to_produce/blocker_risk）。

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import type { ResolvedPhaseInputs } from '../../scripts/utils/capability-resolution';
import { checkFactsArtifact, resolveFactsAbsPath, isFactsEstablishingPhase, factsBaselineFingerprint, type FactsInvocationContext } from '../../scripts/utils/context-facts';
import { featureTrackDeclPath } from '../../scripts/utils/feature-track';
import { parseContextExploration, runQuantitativeChecks } from '../../scripts/utils/context-exploration';
import { resolveCheckDisposition } from '../../scripts/utils/check-disposition';
import { SpecLoader } from '../../scripts/utils/spec-loader';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function includesId(results: Array<{ id: string; status: string }>, id: string, status?: string): boolean {
  return results.some((r) => r.id === id && (status === undefined || r.status === status));
}

function mkProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-facts-'));
  fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'doc'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0',
    project_name: 'context-facts-fixture',
    project_profile: { name: 'generic' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features' },
  }, null, 2), 'utf-8');
  return dir;
}

function writeFactsFile(dir: string, feature: string, content: string): void {
  const abs = resolveFactsAbsPath(dir, feature);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function writeFeatureTrackDecl(dir: string, feature: string, track: 'lite' | 'full'): void {
  const abs = featureTrackDeclPath(dir, feature);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, YAML.stringify({ schema_version: '1.0', track }), 'utf-8');
}

/** 建立阶段（spec）全量合格的 facts.md：满足 DEFAULT_EXPLORATION_THRESHOLDS.spec 全部阈值。 */
function passingEstablishingFacts(feature: string, establishedBy: string): string {
  return `---
schema_version: "1.0"
feature: ${feature}
established_by: ${establishedBy}
key_inputs_read: [glossary, module-catalog, architecture]
source_code_paths: [doc/module-catalog.yaml, framework.config.json]
files_inspected_count: 4
searches_performed_estimate: 3
decisions_unlocked: ["scope 已确认"]
ready_to_produce: true
has_blocker_coverage_risk: false
exploration_mode: sequential
---

## Code Facts

| 路径 | 事实 | 影响 |
|------|------|------|
| doc/module-catalog.yaml | 模块已登记 | scope 可确认 |
| framework.config.json | 架构层允许该模块 | 无跨层风险 |
`;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    // V8（plan 3a7f9c12 D6）：过时硬文案与已实现行为对齐。
    // 实现事实（本文件其余用例已钉死）：量化阈值与 subagent 强制**只在建立阶段**
    // （full=spec / lite=change）和旧 context-exploration.md 兼容路径生效；delta 阶段
    // 只要求 `## phase_delta: <phase>` 节存在且非空。Skill 若仍写"默认 MUST subagent /
    // source_code_paths ≥N"，弱模型就会去补一份门禁根本不查的东西，或误以为漏了必修项。
    name: 'V8 D6 文案对齐：delta 阶段不再要求 MUST subagent / 源码数量下限，建立阶段与安全约束仍在',
    run: () => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..');
      const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf-8');
      const deltaSkills: Array<[string, string]> = [
        ['skills/feature/plan/SKILL.md', 'plan'],
        ['skills/feature/coding/SKILL.md', 'coding'],
      ];
      for (const [rel, phase] of deltaSkills) {
        const text = read(rel);
        if (/默认\s*\*?\*?MUST\*?\*?\s*subagent/.test(text)) {
          throw new Error(`${rel} 仍写「默认 MUST subagent」——delta 阶段门禁不作此要求`);
        }
        if (/source_code_paths\s*[≥>]=?\s*\d/.test(text)) {
          throw new Error(`${rel} 仍写 source_code_paths 数量下限——delta 阶段门禁不查数量`);
        }
        if (!text.includes(`## phase_delta: ${phase}`)) {
          throw new Error(`${rel} 必须仍要求追加 phase_delta 节（实际生效的门禁）`);
        }
        if (!/建立阶段/.test(text)) {
          throw new Error(`${rel} 须说明量化阈值/subagent 强制只在建立阶段生效`);
        }
      }
      // 行为规约：同一口径；建立阶段与"必要实际阅读"仍须保留（不是把要求整体删掉）。
      const principles = read('skills/reference/agent-behavioral-principles.md');
      if (/plan\/coding\s*\*\*默认\s*subagent\*\*（仅\s*L1\s*trivial\s*可豁免）/.test(principles)) {
        throw new Error('agent-behavioral-principles 仍写「仅 L1 trivial 可豁免」——L2 复合评分低于阈值同样豁免');
      }
      if (!principles.includes('建立阶段') || !principles.includes('phase_delta')) {
        throw new Error('agent-behavioral-principles 须说明建立阶段/delta 阶段的分工');
      }
      // goal runtime 的 attestation 提示：与 review_closure_attestation 的实际分级（MAJOR WARN）一致。
      const runtime = read('harness/scripts/goal-phase-runtime.ts');
      if (/attestation-locked/.test(runtime)) {
        throw new Error('goal runtime 仍称产品源码 attestation-locked——实际是分级 WARN + owner 责任');
      }
      if (!/`\*_FAST_PATH`-style switch/.test(runtime)) {
        throw new Error('测试捷径红线（FAST_PATH 开关）必须保留');
      }
      // 无 provider 时不得硬要 region_attest / critic 回执（07a41ec6 T10 已实现的豁免）。
      const deviceDetail = read('skills/reference/device-testing-workflow-detail.md');
      if (!/无\s*delegated\s*视觉\s*provider/.test(deviceDetail)) {
        throw new Error('device-testing-workflow-detail 须限定 region_attest/critic 的适用条件');
      }
      // verify-ut 的 ut_no_src_mutation：对齐 MAJOR WARN 分级，纪律不变。
      const verifyUt = read('harness/prompts/verify-ut.md');
      if (/`ut_no_src_mutation`\s*BLOCKER/.test(verifyUt)) {
        throw new Error('verify-ut.md 仍把 ut_no_src_mutation 写成 BLOCKER（代码已是 MAJOR WARN）');
      }
      if (!verifyUt.includes('实际UT工具和独立审查员不写产品源码或正式结果')
        || !verifyUt.includes('同unit专用作者可在原授权内修实现与测试输入')) {
        throw new Error('UT工具/独核只读与授权单元作者可修实现的职责必须保留');
      }

      // ====================================================================
      // V5（plan 7b3e9a15 D3/D4）：本批的五条文案守卫，逐条读**真实文件**。
      // ====================================================================
      // ① verify-ut.md：数量不再是判据，但流程类用例的中间态/终态与异常 path 要求仍在。
      if (/每个\s*it\s*只有\s*1\s*个\s*expect/.test(verifyUt)) {
        throw new Error('verify-ut.md 仍按 expect 数量硬判 FAIL（D3 已改为"错误实现会不会让该 it 失败"）');
      }
      if (!verifyUt.includes('覆盖**中间态与终态**')) {
        throw new Error('verify-ut.md 必须保留检查 4 对**流程类用例**的中间态/终态要求');
      }
      if (!verifyUt.includes('回滚行为或 `not_called`')) {
        throw new Error('verify-ut.md 必须保留 4B 第 3 条的异常 path 要求');
      }
      if (!/纯函数\s*\/\s*单规则用例/.test(verifyUt)) {
        throw new Error('verify-ut.md 必须写明纯函数/单规则用例的适用范围限定（否则单断言用例仍被别的条款判 FAIL）');
      }
      // ② business-ut-workflow-detail.md：同一条退出路径的相邻两句一起对齐（:121 与 :122）。
      const businessUt = read('skills/reference/business-ut-workflow-detail.md');
      if (/`ut_no_src_mutation`[^\n]*保持\s*BLOCKER/.test(businessUt)) {
        throw new Error('business-ut-workflow-detail 仍写 ut_no_src_mutation「保持 BLOCKER」（check-ut.ts 已是 MAJOR WARN）');
      }
      if (/完整重走\s*review\s*→\s*ut\s*→\s*testing/.test(businessUt)) {
        throw new Error('business-ut-workflow-detail 仍写「完整重走 review→ut→testing」（代码给的是分级复核）');
      }
      if (!businessUt.includes('不得要求用户提交 coding 产物来过门禁')) {
        throw new Error('禁止提交换基线的纪律必须保留');
      }
      // ③ device-testing-workflow-detail.md：分级复核，且 FAST_PATH 真红线一字不动。
      if (/拦下，须回跑\s*review\s*重审/.test(deviceDetail)) {
        throw new Error('device-testing-workflow-detail 仍写「拦下，须回跑 review 重审」（四个出口无一 BLOCKER）');
      }
      if (!/`\*_FAST_PATH`/.test(deviceDetail)) {
        throw new Error('测试接缝红线（*_FAST_PATH）必须保留');
      }
      // ④ check-testing.ts:6095 的 JSDoc 末句与同函数 :6107–6108 的纠偏注释自洽。
      const checkTesting = read('harness/scripts/check-testing.ts');
      if (/任何差异\/缺\s*attestation\s*→\s*\*{0,2}BLOCKER\*{0,2}/.test(checkTesting)) {
        throw new Error('check-testing.ts 的 JSDoc 仍写「任何差异/缺 attestation → BLOCKER」，与同函数体的分级 WARN 自相矛盾');
      }
      if (!checkTesting.includes('不再一刀 BLOCKER')) {
        throw new Error('check-testing.ts 的分级说明注释必须保留');
      }
      // ⑤ goal-mode-runbook.md:148：report-only 不再以「agent 已写好 test-report.md」为前置。
      const runbook = read('docs/operations/goal-mode-runbook.md');
      if (/agent\s*已基于最终\s*trace\/timing\s*写好顶层\s*`test-report\.md`\s*后/.test(runbook)) {
        throw new Error('goal-mode-runbook 仍把「agent 已写好 test-report.md」当 --report-reconcile-only 前置（B03 后由 harness 生成）');
      }
      if (!runbook.includes('--report-reconcile-only')) {
        throw new Error('runbook 必须仍说明 --report-reconcile-only 的用法');
      }
    },
  },
  {
    name: 'isFactsEstablishingPhase: 旧出生协议只有 spec 为建立阶段',
    run: () => {
      eq(isFactsEstablishingPhase('spec'), true, 'spec');
      eq(isFactsEstablishingPhase('change'), false, 'retired change');
      eq(isFactsEstablishingPhase('plan'), false, 'plan');
      eq(isFactsEstablishingPhase('coding'), false, 'coding');
      eq(isFactsEstablishingPhase('testing'), false, 'testing');
      eq(isFactsEstablishingPhase('exit'), false, 'exit');
    },
  },
  {
    name: '建立阶段（spec）facts.md 齐全 → PASS，无 FAIL',
    run: () => {
      const dir = mkProject();
      try {
        fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), 'modules: []', 'utf-8');
        writeFactsFile(dir, 'demo', passingEstablishingFacts('demo', 'spec'));
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        const fails = results.filter((r) => r.status === 'FAIL');
        eq(fails.length, 0, `不应有 FAIL：${JSON.stringify(fails)}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: '同一可读来源重复出现时仍能使用事实',
    run: () => {
      const dir = mkProject();
      try {
        fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), 'modules: []', 'utf-8');
        const gamed = passingEstablishingFacts('demo', 'spec').replace(
          'source_code_paths: [doc/module-catalog.yaml, framework.config.json]',
          'source_code_paths: [doc/module-catalog.yaml, doc/module-catalog.yaml, doc/module-catalog.yaml, doc/module-catalog.yaml, doc/module-catalog.yaml]',
        );
        writeFactsFile(dir, 'demo', gamed);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(results.filter(r => r.status === 'FAIL'), [], '当前可读事实足以支撑决定');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: '不同写法引用同一真实来源，仍核实当前文件',
    run: () => {
      const dir = mkProject();
      try {
        fs.mkdirSync(path.join(dir, 'doc', 'a'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'doc', 'a', 'b.ts'), '// b\n', 'utf-8');

        const gamed = passingEstablishingFacts('demo', 'spec').replace(
          'source_code_paths: [doc/module-catalog.yaml, framework.config.json]',
          'source_code_paths: [doc/a/b.ts, doc/a/../a/b.ts, ./doc/a/b.ts]',
        );
        writeFactsFile(dir, 'demo', gamed);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(results.filter(r => r.status === 'FAIL'), [], '当前可读事实足以支撑决定');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: '当前事实不依赖此前读取次数',
    run: () => {
      const dir = mkProject();
      try {
        fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), 'modules: []', 'utf-8');
        const weak = passingEstablishingFacts('demo', 'spec').replace('files_inspected_count: 4', 'files_inspected_count: 0');
        writeFactsFile(dir, 'demo', weak);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(results.filter(r => r.status === 'FAIL'), [], '当前可读事实足以支撑决定');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: '当前事实足够时省略 phase_delta',
    run: () => {
      const dir = mkProject();
      try {
        writeFactsFile(dir, 'demo', passingEstablishingFacts('demo', 'spec'));
        const results = checkFactsArtifact(dir, 'demo', 'plan');
        eq(results.filter(r => r.status === 'FAIL'), [], '仅登记形式不影响事实判断');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: '空的 phase_delta 不改变实际决定',
    run: () => {
      const dir = mkProject();
      try {
        const content = `${passingEstablishingFacts('demo', 'spec')}\n## phase_delta: plan\n\n`;
        writeFactsFile(dir, 'demo', content);
        const results = checkFactsArtifact(dir, 'demo', 'plan');
        eq(results.filter(r => r.status === 'FAIL'), [], '仅登记形式不影响事实判断');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: '旧 phase_delta 填 none 的 facts 仍可读',
    run: () => {
      const dir = mkProject();
      try {
        const content = `${passingEstablishingFacts('demo', 'spec')}\n## phase_delta: plan\n\nnone\n`;
        writeFactsFile(dir, 'demo', content);
        const results = checkFactsArtifact(dir, 'demo', 'plan');
        eq(results.filter(r => r.status === 'FAIL'), [], '仅登记形式不影响事实判断');
        eq(results.some((r) => r.status === 'FAIL'), false, '不应有 FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'testing 阶段：facts.md 与 legacy 均缺失 → FAIL（testing 从未有 legacy 回落）',
    run: () => {
      const dir = mkProject();
      try {
        const results = checkFactsArtifact(dir, 'demo', 'testing');
        eq(includesId(results, 'context_exploration_facts_present', 'FAIL'), true, '应 FAIL 指向 facts.md');
        eq(results.some((r) => r.id === 'context_exploration_facts_legacy_fallback'), false, 'testing 不应有 legacy fallback WARN');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'plan 阶段：facts.md 缺失但 legacy per-phase 文件存在 → WARN legacy_fallback（回落旧契约）',
    run: () => {
      const dir = mkProject();
      try {
        for (let i = 1; i <= 5; i += 1) {
          fs.writeFileSync(path.join(dir, `src-${i}.ts`), `// file ${i}\n`, 'utf-8');
        }
        const legacyAbs = path.join(dir, 'doc', 'features', 'demo', 'plan', 'context-exploration.md');
        fs.mkdirSync(path.dirname(legacyAbs), { recursive: true });
        fs.writeFileSync(legacyAbs, `---
schema_version: "1.1.0"
feature: demo
phase: plan
key_inputs_read: [spec, acceptance, architecture, module-catalog, framework.config]
source_code_paths: [src-1.ts, src-2.ts, src-3.ts, src-4.ts, src-5.ts]
files_inspected_count: 8
searches_performed_estimate: 5
decisions_unlocked: ["done"]
ready_to_produce: true
has_blocker_coverage_risk: false
exploration_mode: sequential
---

## Code Facts

| 路径 | 事实 | 影响 |
|------|------|------|
| src-1.ts | a | b |
| src-2.ts | c | d |
| src-3.ts | e | f |
| src-4.ts | g | h |
| src-5.ts | i | j |
`, 'utf-8');
        const results = checkFactsArtifact(dir, 'demo', 'plan');
        eq(includesId(results, 'context_exploration_facts_legacy_fallback', 'WARN'), true, '应回落 legacy 并 WARN');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'frontmatter 校验：schema_version 错误 → FAIL',
    run: () => {
      const dir = mkProject();
      try {
        const content = passingEstablishingFacts('demo', 'spec').replace('schema_version: "1.0"', 'schema_version: "2.0"');
        writeFactsFile(dir, 'demo', content);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_facts_schema_version', 'FAIL'), true, '应命中 schema_version FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'frontmatter 校验：feature 不匹配 → FAIL',
    run: () => {
      const dir = mkProject();
      try {
        writeFactsFile(dir, 'demo', passingEstablishingFacts('other-feature', 'spec'));
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_facts_feature_match', 'FAIL'), true, '应命中 feature_match FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'frontmatter 校验：established_by 非法值 → FAIL',
    run: () => {
      const dir = mkProject();
      try {
        const content = passingEstablishingFacts('demo', 'spec').replace('established_by: spec', 'established_by: coding');
        writeFactsFile(dir, 'demo', content);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_facts_established_by_invalid', 'FAIL'), true, '应命中 established_by_invalid FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'established_by 与 track 一致性（codex review 采纳）：full track 沿用 lite 建立的 facts.md（established_by=change）→ FAIL track_mismatch',
    run: () => {
      const dir = mkProject();
      try {
        fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), 'modules: []', 'utf-8');
        writeFeatureTrackDecl(dir, 'demo', 'full');
        writeFactsFile(dir, 'demo', passingEstablishingFacts('demo', 'change'));
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_facts_established_by_invalid', 'FAIL'), true, '应命中 track_mismatch FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'established_by 与 track 一致性：未声明 feature.yaml（缺省 full）+ established_by=spec → 无 track_mismatch',
    run: () => {
      const dir = mkProject();
      try {
        fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), 'modules: []', 'utf-8');
        writeFactsFile(dir, 'demo', passingEstablishingFacts('demo', 'spec'));
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_facts_established_by_invalid'), false, '不应命中 track_mismatch');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'frontmatter 校验：ready_to_produce=false → FAIL',
    run: () => {
      const dir = mkProject();
      try {
        const content = passingEstablishingFacts('demo', 'spec').replace('ready_to_produce: true', 'ready_to_produce: false');
        writeFactsFile(dir, 'demo', content);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_facts_ready', 'FAIL'), true, '应命中 ready FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'frontmatter 校验：has_blocker_coverage_risk=true → FAIL',
    run: () => {
      const dir = mkProject();
      try {
        const content = passingEstablishingFacts('demo', 'spec').replace('has_blocker_coverage_risk: false', 'has_blocker_coverage_risk: true');
        writeFactsFile(dir, 'demo', content);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_facts_blocker_risk', 'FAIL'), true, '应命中 blocker_risk FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },];


function modernFactsCase(request: boolean, sourceCount = 6, phase = request ? 'review' : 'coding'): void {
  const dir = mkProject();
  try {
    const sourcePaths = Array.from({ length: sourceCount }, (_, i) => 'src/file' + i + '.ts');
    for (const source of sourcePaths) {
      const file = path.join(dir, source); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'export const value = 1;\n');
    }
    const subject = request ? { request_sha256: 'a'.repeat(64), report_dir: 'reports/review-request' } : { feature: 'demo', run_id: 'real-run' };
    const context: FactsInvocationContext = { subject, first_phase: phase, source_paths: sourcePaths, required_input_snippets: ['src/file0.ts'] };
    const inputContext = { schema_version: '1.1' as const, subject: request ? { request_sha256: 'a'.repeat(64) } : { feature: 'demo' }, obligations: {}, required_outputs: [] };
    const resolvedInputs: ResolvedPhaseInputs = { context: inputContext, phase, values: {}, artifacts: {} };
    const fm = {
      schema_version: '1.1',
      ...(request ? { request_sha256: 'a'.repeat(64) } : { feature: 'demo', run_id: 'real-run' }),
      established_by: phase, ready_to_produce: true, has_blocker_coverage_risk: false,
      source_code_paths: sourcePaths, key_inputs_read: sourcePaths, files_inspected_count: sourceCount,
      searches_performed_estimate: sourceCount, decisions_unlocked: ['verified target implementation'],
      exploration_mode: 'sequential', change_intent: 'typo_fix', estimated_loc_delta: 1, single_function_scope: true,
    };
    const body = '\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n' + sourcePaths.map(p => '| ' + p + ' | exports current value | review existing behavior |').join('\n');
    const raw = '---\n' + YAML.stringify(fm) + '---\n' + body;
    const file = resolveFactsAbsPath(dir, request ? '' : 'demo', context);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, raw);
    const options = { factsContext: context, resolvedInputs, profileName: 'generic' };
    const initial = checkFactsArtifact(dir, request ? '' : 'demo', phase, options);
    eq(initial.filter(r => r.status === 'FAIL'), [], 'first real phase facts');
    eq(isFactsEstablishingPhase(phase, context), true, 'actual first phase');
    if (!request && sourceCount === 1 && phase === 'plan') {
      fs.writeFileSync(path.join(dir, 'src/created.test.ts'), 'export const tested = true;\n');
      const expanded = { ...context, source_paths: [...sourcePaths, 'src/created.test.ts'] };
      const parsed = parseContextExploration(raw);
      const original = runQuantitativeChecks(dir, 'demo', 'plan', parsed.fm, parsed.body, 'context/facts.md', { ...options, factsContext: expanded });
      eq(includesId(original, 'context_exploration_source_code_paths_min', 'FAIL'), false, 'current inputs need no duplicate declaration in the research ledger');
      for (const downstream of ['coding', 'review', 'ut'] as const) {
        const check = (factsBody: string) => runQuantitativeChecks(dir, 'demo', downstream, parsed.fm, factsBody, 'context/facts.md',
          { ...options, factsContext: expanded, resolvedInputs: { ...resolvedInputs, phase: downstream } });
        eq(includesId(check(parsed.body), 'context_exploration_source_code_paths_min', 'FAIL'), false, 'construction writes do not enlarge original research');
        eq(includesId(check(parsed.body), 'context_exploration_code_facts_min', 'FAIL'), false, 'original researched fact remains sufficient downstream');
        eq(includesId(check('## Code Facts\n'), 'context_exploration_code_facts_min', 'FAIL'), true, 'an empty downstream fact record still fails');
      }
    }
    if (request) {
      eq(fs.existsSync(path.join(dir, 'doc/features')), false, 'request must not create Feature paths');
      fs.writeFileSync(file, raw.replace('request_sha256:', 'feature: demo\nrequest_sha256:'));
      eq(includesId(checkFactsArtifact(dir, '', phase, options), 'context_exploration_facts_request_match', 'FAIL'), true, 'mixed subject rejected');
    } else {
      const inherited: FactsInvocationContext = { ...context, first_phase: 'testing', subject: { feature: 'demo', run_id: 'successor-run' }, baseline: { established_by: phase, fingerprint: factsBaselineFingerprint(raw), dependencies: sourcePaths.map(source => ({ path: path.join(dir, source), exists: true, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, source))).digest('hex'), role: 'derive' as const })) } };
      fs.writeFileSync(file, raw + '\n## phase_delta: testing\nnone\n');
      const successor = checkFactsArtifact(dir, 'demo', 'testing', { ...options, factsContext: inherited, resolvedInputs: { ...resolvedInputs, phase: 'testing' } });
      eq(successor.filter(r => r.status === 'FAIL'), [], 'successor retains real establishing phase');
      fs.writeFileSync(path.join(dir, 'src/new.ts'), 'export const newValue = 2;');
      fs.writeFileSync(file, raw + '\n## phase_delta: testing\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| src/new.ts | new target exists | validate new branch |\n');
      const extended = checkFactsArtifact(dir, 'demo', 'testing', { ...options, factsContext: { ...inherited, source_paths: [...sourcePaths, 'src/new.ts'] }, resolvedInputs: { ...resolvedInputs, phase: 'testing' } });
      eq(extended.filter(r => r.status === 'FAIL'), [], 'new facts extend delta without mutating baseline');
      fs.writeFileSync(file, raw.replace('ready_to_produce: true', 'ready_to_produce: false') + '\n## phase_delta: testing\nnone\n');
      eq(includesId(checkFactsArtifact(dir, 'demo', 'testing', { ...options, factsContext: inherited, resolvedInputs: { ...resolvedInputs, phase: 'testing' } }), 'context_exploration_facts_ready', 'FAIL'), true, 'the current facts are not ready');
      fs.writeFileSync(file, raw);
      eq(includesId(checkFactsArtifact(dir, 'demo', 'coding'), 'context_exploration_facts_schema_version', 'FAIL'), true, 'new record cannot silently enter legacy');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * plan e7a2c4f1 §3.4（G01）：「基线未绑定原有来源」是**账本类**缺口——声明的来源没进阶段
 * 证据登记，事后追溯弱一级，产品不受影响。可补登记的已由入口（`resolveCapabilityResolutionEntryInput`
 * 组装 facts baseline 时）补齐；补不了的在这里**以 WARN 如实披露、不单独阻断阶段**。
 * 同时钉住：来源字节真变了（基线绑定的 sha256 对不上）仍然是 BLOCKER——降的只有"没登记"，
 * 不是"登记了但变了"。
 */
function unboundDeclaredSourceIsLedgerWarn(): void {
  const dir = mkProject();
  try {
    const sourcePaths = Array.from({ length: 6 }, (_, i) => 'src/file' + i + '.ts');
    for (const source of sourcePaths) {
      const file = path.join(dir, source);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'export const value = 1;\n');
    }
    const fm = {
      schema_version: '1.1', feature: 'demo', run_id: 'real-run', established_by: 'coding',
      ready_to_produce: true, has_blocker_coverage_risk: false,
      source_code_paths: sourcePaths, key_inputs_read: sourcePaths, files_inspected_count: 12,
      searches_performed_estimate: 10, decisions_unlocked: ['verified target implementation'],
      exploration_mode: 'sequential', change_intent: 'typo_fix', estimated_loc_delta: 1, single_function_scope: true,
    };
    const body = '\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n'
      + sourcePaths.map(p => '| ' + p + ' | exports current value | review existing behavior |').join('\n');
    const raw = '---\n' + YAML.stringify(fm) + '---\n' + body + '\n## phase_delta: testing\nnone\n';
    const context: FactsInvocationContext = { subject: { feature: 'demo', run_id: 'real-run' }, first_phase: 'coding', source_paths: sourcePaths, required_input_snippets: [] };
    const file = resolveFactsAbsPath(dir, 'demo', context);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, raw);
    const shaOf = (source: string): string => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, source))).digest('hex');
    const dependenciesFor = (sources: string[]) => sources.map(source => ({ path: path.join(dir, source), exists: true, sha256: shaOf(source), role: 'derive' as const }));
    const inputContext = { schema_version: '1.1' as const, subject: { feature: 'demo' }, obligations: {}, required_outputs: [] };
    const resolvedInputs: ResolvedPhaseInputs = { context: inputContext, phase: 'testing', values: {}, artifacts: {} };
    const run = (dependencies: ReturnType<typeof dependenciesFor>) => checkFactsArtifact(dir, 'demo', 'testing', {
      factsContext: { ...context, first_phase: 'testing', subject: { feature: 'demo', run_id: 'successor-run' }, baseline: { established_by: 'coding', fingerprint: factsBaselineFingerprint(raw), dependencies } },
      resolvedInputs, profileName: 'generic',
    });
    eq(run(dependenciesFor(sourcePaths)).filter(r => r.status === 'FAIL'), [], '全部来源已登记时不得有 FAIL');
    // 基线少登记了一条声明来源（补不了的那种）→ WARN，不 FAIL。
    const partial = run(dependenciesFor(sourcePaths.slice(1)));
    eq(partial.filter(r => r.status === 'FAIL'), [], '未登记的声明来源不得再阻断阶段');
    fs.writeFileSync(path.join(dir, sourcePaths[0]), 'new bytes; current source still readable');
    eq(run(dependenciesFor(sourcePaths.slice(1))).filter(r => r.status === 'FAIL'), [], 'current source can be reconsidered from its bytes');
    fs.unlinkSync(path.join(dir, sourcePaths[0]));
    eq(includesId(run(dependenciesFor(sourcePaths.slice(1))), 'context_exploration_facts_scope_coverage', 'FAIL'), true, 'missing actual reference is reported');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

cases.push(
  { name: '38e5a7c2 host facts: HMOS consumes plan delta, preserves baseline and substantive failures', run() {
    const dir = mkProject();
    try {
      const original = fs.readFileSync(path.join(__dirname, '../fixtures/facts-plan-handoff/facts.md'), 'utf8');
      const { fm } = parseContextExploration(original);
      const feature = String(fm.feature);
      const sources = fm.source_code_paths as string[];
      for (const source of sources) {
        const abs = path.join(dir, source); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, 'fixture source\n');
      }
      const dependencies = sources.map(source => ({ path: path.join(dir, source), exists: true,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, source))).digest('hex'), role: 'derive' as const }));
      const frameworkRoot = path.resolve(__dirname, '../../..');
      const phaseRule = new SpecLoader(dir, undefined, undefined, frameworkRoot).loadPhaseRule('plan');
      const run = (raw: string, baseline = original, phase = 'plan') => {
        writeFactsFile(dir, feature, raw);
        const subject = { feature, run_id: String((fm as Record<string, unknown>).run_id) };
        const factsContext: FactsInvocationContext = { subject, first_phase: 'plan', source_paths: sources, required_input_snippets: [],
          baseline: { established_by: 'spec', fingerprint: factsBaselineFingerprint(baseline), dependencies } };
        const resolvedInputs: ResolvedPhaseInputs = { context: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] }, phase, values: {}, artifacts: {} };
        return checkFactsArtifact(dir, feature, phase, { frameworkRoot, phaseRule, profileName: 'hmos-app', factsContext, resolvedInputs });
      };
      eq(run(original).filter(c => c.status === 'FAIL'), [], 'actual host delta satisfies HMOS without rewriting the header');
      const minimal = original.replace('exploration_mode: "sequential"', 'exploration_mode: "minimal"');
      for (const phase of ['plan', 'coding']) {
        const checks = run(minimal + (phase === 'coding' ? '\n## phase_delta: coding\nnone\n' : ''), minimal, phase);
        eq(checks.filter(c => /context_exploration_(mode_|subagent_required)/.test(c.id)), [], 'downstream must not rejudge spec mode');
      }
      const baselineOnly = original.split('## phase_delta: plan')[0];
      const otherPhase = baselineOnly + '\n## phase_delta: ut\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| module.json5 | read | test |\n';
      eq(run(otherPhase).filter(check => check.status === 'FAIL'), [], 'current facts work without a stage-specific read ledger');
      eq(includesId(run(original.replace('ready_to_produce: true', 'ready_to_produce: false')), 'context_exploration_facts_ready', 'FAIL'), true, 'current facts must be ready');
      fs.unlinkSync(path.join(dir, sources[0]));
      eq(run(original).some(c => c.status === 'FAIL' && /source_stale|scope_coverage|sources_exist/.test(c.id)), true, 'unreadable source still fails');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } },
  { name: 'facts 1.1: coding establishes real baseline and successor preserves provenance', run: () => modernFactsCase(false) },
  { name: 'facts 1.1: a one-source plan run uses its admitted source budget and keeps baseline checks', run: () => modernFactsCase(false, 1, 'plan') },
  { name: 'facts 1.1: request review uses explicit report directory and exclusive subject', run: () => modernFactsCase(true) },
  { name: 'P3-T9 current readable sources need no write or read ledger; a missing source remains visible', run: unboundDeclaredSourceIsLedgerWarn },
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
