// ============================================================================
// context-facts.unit.test.ts — C4 Context Facts Gate 直接单测（codex review 采纳）
// ============================================================================
// 覆盖 checkFactsArtifact 的核心分支：建立阶段全量检查通过/量化不足、
// delta 阶段节缺失/为空/存在、legacy per-phase 回落（WARN）、
// facts.md 与 legacy 均缺失（FAIL）、testing 阶段无 legacy 回落、
// frontmatter 校验（schema_version/feature/established_by/ready_to_produce/blocker_risk）。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { checkFactsArtifact, resolveFactsAbsPath, isFactsEstablishingPhase } from '../../scripts/utils/context-facts';
import { featureTrackDeclPath } from '../../scripts/utils/feature-track';

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
      if (!verifyUt.includes('禁止修改业务源码')) {
        throw new Error('UT 阶段禁改业务源码的纪律必须保留');
      }
    },
  },
  {
    name: 'isFactsEstablishingPhase: 只有 spec/change 为建立阶段',
    run: () => {
      eq(isFactsEstablishingPhase('spec'), true, 'spec');
      eq(isFactsEstablishingPhase('change'), true, 'change');
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
    name: '建立阶段（spec）source_code_paths 重复同一路径凑数 → 去重后不满足阈值仍 FAIL（codex review 采纳）',
    run: () => {
      const dir = mkProject();
      try {
        fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), 'modules: []', 'utf-8');
        // spec 阈值 min_source_code_paths=2；写同一条路径 5 遍，去重后只有 1 条，应仍 FAIL。
        const gamed = passingEstablishingFacts('demo', 'spec').replace(
          'source_code_paths: [doc/module-catalog.yaml, framework.config.json]',
          'source_code_paths: [doc/module-catalog.yaml, doc/module-catalog.yaml, doc/module-catalog.yaml, doc/module-catalog.yaml, doc/module-catalog.yaml]',
        );
        writeFactsFile(dir, 'demo', gamed);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_source_code_paths_min', 'FAIL'), true, '重复路径去重后应仍命中 source_code_paths_min FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: '建立阶段（spec）source_code_paths 用路径变体（a/../a、./a、a//b）凑数 → normalize 后仍去重 FAIL（codex review 补强建议）',
    run: () => {
      const dir = mkProject();
      try {
        fs.mkdirSync(path.join(dir, 'doc', 'a'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'doc', 'a', 'b.ts'), '// b\n', 'utf-8');
        // 同一个 doc/a/b.ts 用 3 种不同写法表达，spec 阈值 min_source_code_paths=2；
        // path.posix.normalize 折叠后应视为同一路径，仍不满足阈值。
        const gamed = passingEstablishingFacts('demo', 'spec').replace(
          'source_code_paths: [doc/module-catalog.yaml, framework.config.json]',
          'source_code_paths: [doc/a/b.ts, doc/a/../a/b.ts, ./doc/a/b.ts]',
        );
        writeFactsFile(dir, 'demo', gamed);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_source_code_paths_min', 'FAIL'), true, '路径变体归一后应仍命中 source_code_paths_min FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: '建立阶段（spec）facts.md 量化不足（files_inspected_count 过低）→ 命中量化 FAIL',
    run: () => {
      const dir = mkProject();
      try {
        fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), 'modules: []', 'utf-8');
        const weak = passingEstablishingFacts('demo', 'spec').replace('files_inspected_count: 4', 'files_inspected_count: 0');
        writeFactsFile(dir, 'demo', weak);
        const results = checkFactsArtifact(dir, 'demo', 'spec');
        eq(includesId(results, 'context_exploration_files_inspected_min', 'FAIL'), true, '应命中 files_inspected_min FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'delta 阶段（plan）phase_delta 节缺失 → FAIL phase_delta_missing',
    run: () => {
      const dir = mkProject();
      try {
        writeFactsFile(dir, 'demo', passingEstablishingFacts('demo', 'spec'));
        const results = checkFactsArtifact(dir, 'demo', 'plan');
        eq(includesId(results, 'context_exploration_facts_phase_delta_missing', 'FAIL'), true, '应命中 phase_delta_missing');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'delta 阶段（plan）phase_delta 节存在但为空 → FAIL phase_delta_empty',
    run: () => {
      const dir = mkProject();
      try {
        const content = `${passingEstablishingFacts('demo', 'spec')}\n## phase_delta: plan\n\n`;
        writeFactsFile(dir, 'demo', content);
        const results = checkFactsArtifact(dir, 'demo', 'plan');
        eq(includesId(results, 'context_exploration_facts_phase_delta_empty', 'FAIL'), true, '应命中 phase_delta_empty');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'delta 阶段（plan）phase_delta 节存在且非空（含 "none"）→ PASS',
    run: () => {
      const dir = mkProject();
      try {
        const content = `${passingEstablishingFacts('demo', 'spec')}\n## phase_delta: plan\n\nnone\n`;
        writeFactsFile(dir, 'demo', content);
        const results = checkFactsArtifact(dir, 'demo', 'plan');
        eq(includesId(results, 'context_exploration_facts_phase_delta_present', 'PASS'), true, '应命中 phase_delta_present PASS');
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
        eq(includesId(results, 'context_exploration_facts_established_by_track_mismatch', 'FAIL'), true, '应命中 track_mismatch FAIL');
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
        eq(includesId(results, 'context_exploration_facts_established_by_track_mismatch'), false, '不应命中 track_mismatch');
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
  },
  {
    name: 'lite 建立阶段（change）facts.md 齐全（阈值比 spec 更轻，同内容天然满足）→ PASS',
    run: () => {
      const dir = mkProject();
      try {
        fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), 'modules: []', 'utf-8');
        writeFeatureTrackDecl(dir, 'demo', 'lite');
        writeFactsFile(dir, 'demo', passingEstablishingFacts('demo', 'change'));
        const results = checkFactsArtifact(dir, 'demo', 'change');
        const fails = results.filter((r) => r.status === 'FAIL');
        eq(fails.length, 0, `不应有 FAIL：${JSON.stringify(fails)}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

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
