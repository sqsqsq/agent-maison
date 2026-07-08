#!/usr/bin/env npx ts-node
// ============================================================================
// 存量 feature：按阶段回填 context-exploration.md（stub，满足 Context Exploration Gate）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import * as YAML from 'yaml';
import { loadFrameworkConfig, receiptDirPath, resolveFeatureArtifact } from '../config';
import { normalizePhaseId } from './utils/phase-alias';
import { CANONICAL_FEATURE_PHASES } from './utils/phase-alias';
import { LEGACY_EXPLORATION_PHASES } from './utils/runtime-policy';
import {
  CONTEXT_EXPLORATION_PHASE_INPUT_SNIPPETS,
  ContextExplorationPhase,
  checkContextExplorationArtifact,
  parseContextExploration,
} from './utils/context-exploration';
import { resolveFactsAbsPath } from './utils/context-facts';

type Args = {
  feature?: string;
  phases?: string;
  overwrite?: boolean;
  'project-root'?: string;
  'to-facts'?: boolean;
};

const ARTIFACT_REL = [
  'spec.md',
  'plan.md',
  'contracts.yaml',
  'acceptance.yaml',
  'review-report.md',
  'test-plan.md',
  'test-report.md',
  'ut/mock-plan.yaml',
  'ut/testability-audit.md',
];

function usage(): string {
  return [
    '用法：',
    '  ts-node scripts/backfill-context-exploration.ts --feature <name> --phases spec,plan,...',
    '  ts-node scripts/backfill-context-exploration.ts --feature <name> --phases spec,plan,... --to-facts',
    '选项：',
    '  --project-root <path>   实例工程根（默认向上解析到绑定 framework.config.json）',
    '  --dry-run               不写盘，打印将写入的路径',
    '  --overwrite             允许覆盖已存在的 context-exploration.md / facts.md',
    '  --to-facts              C4：把 --phases 中存量的 per-phase context-exploration.md 归并为',
    '                          <features_dir>/<feature>/context/facts.md（幂等，可重跑）；',
    '                          最早存在的 phase（按 spec→plan→coding→review→ut→testing 序）作',
    '                          established_by 全量来源，其余各自的 Code Facts 表内容转为',
    '                          该 phase 的 `## phase_delta: <phase>` 节。',
  ].join('\n');
}

const FACTS_PHASE_ORDER: readonly string[] = CANONICAL_FEATURE_PHASES;

interface LegacyPerPhaseParsed {
  phase: ContextExplorationPhase;
  keyInputsRead: string[];
  sourceCodePaths: string[];
  codeFactsSection: string;
  decisionsUnlocked: string[];
  filesInspectedCount: number;
  searchesPerformedEstimate: number;
}

/** 读取并解析既有 per-phase context-exploration.md（不存在/解析失败 → null）。 */
function readLegacyPerPhase(
  projectRoot: string,
  feature: string,
  phase: ContextExplorationPhase,
): LegacyPerPhaseParsed | null {
  const abs = path.join(receiptDirPath(projectRoot, feature, phase), 'context-exploration.md');
  if (!fs.existsSync(abs)) return null;
  const raw = fs.readFileSync(abs, 'utf-8');
  const { fm, body, error } = parseContextExploration(raw);
  if (error) return null;
  const keyInputsRead = Array.isArray(fm.key_inputs_read)
    ? fm.key_inputs_read.map(x => String(x))
    : typeof fm.key_inputs_read === 'string'
      ? [fm.key_inputs_read]
      : [];
  const sourceCodePaths = Array.isArray(fm.source_code_paths)
    ? fm.source_code_paths.map(x => String(x))
    : typeof fm.source_code_paths === 'string'
      ? [fm.source_code_paths]
      : [];
  const decisionsUnlocked = Array.isArray(fm.decisions_unlocked)
    ? fm.decisions_unlocked.map(x => String(x))
    : typeof fm.decisions_unlocked === 'string'
      ? [fm.decisions_unlocked]
      : [];
  const sectionMatch = /##\s*Code Facts[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i.exec(body);
  const codeFactsSection = sectionMatch ? sectionMatch[1].trim() : '';
  return {
    phase,
    keyInputsRead,
    sourceCodePaths,
    codeFactsSection,
    decisionsUnlocked,
    filesInspectedCount: typeof fm.files_inspected_count === 'number' ? fm.files_inspected_count : 0,
    searchesPerformedEstimate:
      typeof fm.searches_performed_estimate === 'number' ? fm.searches_performed_estimate : 0,
  };
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * 归并 --phases 中存量的 per-phase context-exploration.md 为 facts.md。
 * 幂等：facts.md 已存在且未 --overwrite 时跳过（返回 skipped=true）。
 */
function mergeToFacts(
  projectRoot: string,
  feature: string,
  requestedPhases: ContextExplorationPhase[],
  opts: { dryRun: boolean; overwrite: boolean },
): { skipped: boolean; written?: string; establishedBy?: string; mergedPhases: string[] } {
  const factsAbs = resolveFactsAbsPath(projectRoot, feature);
  const factsRel = path.relative(projectRoot, factsAbs).replace(/\\/g, '/');

  if (fs.existsSync(factsAbs) && !opts.overwrite) {
    console.log(`SKIP（facts.md 已存在，未指定 --overwrite）：${factsRel}`);
    return { skipped: true, mergedPhases: [] };
  }

  const ordered = FACTS_PHASE_ORDER.filter(p => requestedPhases.includes(p as ContextExplorationPhase));
  const parsed = ordered
    .map(p => readLegacyPerPhase(projectRoot, feature, p as ContextExplorationPhase))
    .filter((x): x is LegacyPerPhaseParsed => x !== null);

  if (parsed.length === 0) {
    console.error(`未在 --phases（${requestedPhases.join(',')}）中找到任何存量 context-exploration.md，无可归并内容。`);
    return { skipped: true, mergedPhases: [] };
  }

  const establishing = parsed[0];
  const establishedBy = establishing.phase === 'change' ? 'change' : 'spec';
  if (establishing.phase !== 'spec' && establishing.phase !== 'change') {
    console.warn(
      `[backfill --to-facts] 警告：--phases 中最早存量的 context-exploration.md 属于 "${establishing.phase}"（非 spec/change）；` +
        `已将其 Code Facts 内容合成为 established_by="${establishedBy}"。若 spec/change 阶段本应有独立探索产物，请先补齐再归并。`,
    );
  }
  const rest = parsed.slice(1);

  const keyInputsRead = dedupe(parsed.flatMap(p => p.keyInputsRead));
  const sourceCodePaths = dedupe(parsed.flatMap(p => p.sourceCodePaths));
  const decisionsUnlocked = dedupe(parsed.flatMap(p => p.decisionsUnlocked));
  // 量化计数取全部归并 phase 的最大值（而非仅建立阶段自身）：这些历史文件在旧契约下
  // 各自独立做过全量探索，取 max 更贴近"这批工作量确实发生过"，比单独一个 phase 自身值更公允，
  // 也避免 established_by 落在探索最浅的那个 phase 上时把 facts.md 判定得过于保守。
  const filesInspectedCount = Math.max(...parsed.map(p => p.filesInspectedCount));
  const searchesPerformedEstimate = Math.max(...parsed.map(p => p.searchesPerformedEstimate));

  const fm = {
    schema_version: '1.0',
    feature,
    established_by: establishedBy,
    key_inputs_read: keyInputsRead,
    source_code_paths: sourceCodePaths,
    files_inspected_count: filesInspectedCount,
    searches_performed_estimate: searchesPerformedEstimate,
    decisions_unlocked: decisionsUnlocked.length > 0 ? decisionsUnlocked : ['见归并前各阶段 context-exploration.md（backfill 历史迁移）'],
    ready_to_produce: true,
    has_blocker_coverage_risk: false,
  };
  const fmYaml = YAML.stringify(fm).trimEnd();

  const codeFactsBody = establishing.codeFactsSection || '| ... | ... | ... |';
  const deltaSections = rest
    .map(p => {
      const content = p.codeFactsSection
        ? `（backfill 自旧版 ${p.phase} 阶段 context-exploration.md 的 Code Facts 表）\n\n${p.codeFactsSection}`
        : 'none';
      return `## phase_delta: ${p.phase}\n\n${content}`;
    })
    .join('\n\n');

  const fileContent =
    `---\n${fmYaml}\n---\n\n` +
    `## Code Facts\n\n${codeFactsBody}\n` +
    (deltaSections ? `\n${deltaSections}\n` : '');

  console.log(`${opts.dryRun ? '[dry-run] ' : ''}WRITE ${factsRel}（established_by=${establishedBy}, 归并 ${parsed.length} 个 phase：${parsed.map(p => p.phase).join(',')}）`);

  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(factsAbs), { recursive: true });
    fs.writeFileSync(factsAbs, fileContent, 'utf-8');
  }

  return { skipped: false, written: factsRel, establishedBy, mergedPhases: parsed.map(p => p.phase) };
}

function defaultProjectRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function mkdirForFile(absFile: string): void {
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
}

function stripTemplateBody(templateRaw: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(templateRaw.replace(/^\uFEFF/, ''));
  return (m ? m[1] : templateRaw).trimEnd() + '\n';
}

function buildKeyInputs(projectRoot: string, featureAbs: string, phase: ContextExplorationPhase): string[] {
  const cfg = loadFrameworkConfig(projectRoot);
  const uniq: string[] = [];
  const seen = new Set<string>();

  function push(line: string): void {
    const t = line.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    uniq.push(t);
  }

  push(`${cfg.paths.module_catalog} — module-catalog（paths.module_catalog）`);
  push(`${cfg.paths.glossary} — glossary`);
  push(`${cfg.paths.architecture_md} — architecture`);
  push(`framework.config.json — framework.config`);

  const featAbs = featureAbs;

  const featureDirRel = path.relative(projectRoot, featAbs).replace(/\\/g, '/');

  const featureName = path.basename(featAbs);
  for (const rel of ARTIFACT_REL) {
    const resolved = resolveFeatureArtifact(projectRoot, featureName, rel);
    if (resolved.exists) {
      push(`${path.relative(projectRoot, resolved.actualPath).replace(/\\/g, '/')} — 已扫描存在`);
    }
  }

  const codingStd = path.join(
    projectRoot,
    'framework',
    'profiles',
    'hmos-app',
    'skills',
    'coding',
    'templates',
    'coding-standards.md',
  );
  if (fs.existsSync(codingStd)) {
    push(`${path.relative(projectRoot, codingStd).replace(/\\/g, '/')} — coding-rule`);
  } else {
    push('framework/profiles/<project_profile.name>/skills/coding/templates/coding-standards.md — coding-rule（按 profile）');
  }

  const hay = uniq.join('\n').toLowerCase();
  for (const sub of CONTEXT_EXPLORATION_PHASE_INPUT_SNIPPETS[phase]) {
    if (hay.includes(sub.toLowerCase())) continue;
    if (sub === 'spec')
      push(`${path.posix.join(featureDirRel.replace(/\\/g, '/'), 'spec.md')} — spec（强制覆盖关键词）`);
    else if (sub === 'acceptance')
      push(`${path.posix.join(featureDirRel.replace(/\\/g, '/'), 'acceptance.yaml')} — acceptance`);
    else if (sub === 'plan')
      push(`${path.posix.join(featureDirRel.replace(/\\/g, '/'), 'plan.md')} — plan`);
    else if (sub === 'contract')
      push(`${path.posix.join(featureDirRel.replace(/\\/g, '/'), 'contracts.yaml')} — contract`);
    else if (sub === 'module-catalog') push(`${cfg.paths.module_catalog} — module-catalog`);
    else if (sub === 'glossary') push(`${cfg.paths.glossary} — glossary`);
    else if (sub === 'architecture') push(`${cfg.paths.architecture_md} — architecture`);
    else if (sub === 'framework.config') push(`framework.config.json — framework.config`);
    else if (sub === 'coding-rule')
      push(
        'coding-rule — 见 framework/profiles/<project_profile.name>/skills/coding/templates/coding-standards.md',
      );
    else push(sub);
  }

  return uniq;
}

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    string: ['feature', 'phases', 'project-root'],
    boolean: ['dry-run', 'overwrite'],
    alias: { f: 'feature', p: 'phases' },
  }) as Args;

  const projectRootArg = argv['project-root'];
  const projectRoot = path.resolve(projectRootArg && projectRootArg.length > 0 ? projectRootArg : defaultProjectRoot());
  const feature = argv.feature?.trim();
  const phasesCsv = argv.phases?.trim();
  const argvRecord = argv as Record<string, unknown>;
  const dryRun = Boolean(argvRecord['dry-run']);
  const overwrite = Boolean(argv.overwrite);

  if (!feature || !phasesCsv) {
    console.error(usage());
    console.error('--feature 与 --phases 为必填');
    process.exit(2);
  }

  const cfg = loadFrameworkConfig(projectRoot);
  const featureAbs = path.join(projectRoot, cfg.paths.features_dir, feature);
  const featureDirRel = path.relative(projectRoot, featureAbs).replace(/\\/g, '/');

  if (!fs.existsSync(featureAbs)) {
    console.error(`错误：feature 目录不存在：${featureDirRel}`);
    process.exit(2);
  }

  const ALLOWED = new Set<ContextExplorationPhase>(
    LEGACY_EXPLORATION_PHASES as readonly ContextExplorationPhase[],
  );
  const phases = phasesCsv
    .split(',')
    .map(s => normalizePhaseId(s.trim()) as ContextExplorationPhase)
    .filter(Boolean);

  for (const ph of phases) {
    if (!ALLOWED.has(ph)) {
      console.error(`非法 phase：${ph}（只允许 spec/plan/coding/review/ut；prd/design 为 alias）`);
      process.exit(2);
    }
  }

  if (Boolean(argvRecord['to-facts'])) {
    const result = mergeToFacts(projectRoot, feature, phases, { dryRun, overwrite });
    if (result.skipped) {
      process.exit(result.mergedPhases.length === 0 && !fs.existsSync(resolveFactsAbsPath(projectRoot, feature)) ? 2 : 3);
    }
    console.log(
      `\n归并完成：established_by=${result.establishedBy}，共 ${result.mergedPhases.length} 个 phase（${result.mergedPhases.join(',')}）→ ${result.written}`,
    );
    process.exit(0);
  }

  const templatePath = path.join(__dirname, '..', 'templates', 'context-exploration.md');
  if (!fs.existsSync(templatePath)) {
    console.error(`模板缺失：${templatePath}`);
    process.exit(2);
  }
  const body = stripTemplateBody(fs.readFileSync(templatePath, 'utf-8'));

  const tplHarnessPath = templatePath.replace(/\\/g, '/');

  let exitCode = 0;
  const skipped: string[] = [];

  for (const phase of phases) {
    const outAbs = path.join(receiptDirPath(projectRoot, feature, phase), 'context-exploration.md');

    const key_inputs_read = buildKeyInputs(projectRoot, featureAbs, phase);

    const fm: Record<string, unknown> = {
      schema_version: '1.1.0',
      feature,
      phase,
      ready_to_produce: false,
      has_blocker_coverage_risk: false,
      key_inputs_read,
      source_code_paths: [],
      exploration_mode: 'minimal',
      change_intent: 'feature',
      estimated_loc_delta: 0,
      touches_layers: [],
      adds_new_exports: false,
      single_function_scope: false,
      decisions_unlocked: [],
      subagents_used: 'not_available',
      searches_performed_estimate: 0,
      files_inspected_count: 0,
      legacy_backfill: true,
      legacy_backfill_at: new Date().toISOString(),
      _template_hint: tplHarnessPath,
    };

    const fmYaml = YAML.stringify(fm).trimEnd();
    const fileContent = `---\n${fmYaml}\n---\n\n${body}`;

    const relOut = path.relative(projectRoot, outAbs).replace(/\\/g, '/');

    if (fs.existsSync(outAbs) && !overwrite) {
      skipped.push(relOut);
      exitCode = 3;
      console.log(`SKIP（已存在，未指定 --overwrite）：${relOut}`);
      continue;
    }

    console.log(`${dryRun ? '[dry-run] ' : ''}WRITE ${relOut}`);

    if (!dryRun) {
      mkdirForFile(outAbs);
      fs.writeFileSync(outAbs, fileContent, 'utf-8');

      const fails = checkContextExplorationArtifact(projectRoot, feature, phase).filter(r => r.status === 'FAIL');
      if (fails.length > 0) {
        console.warn(
          `[backfill] 骨架已写入但未通过完整门禁（预期）：${relOut} — 须补齐 Research Sub-Phase 后再设 ready_to_produce=true`,
        );
      }
    }
  }

  if (skipped.length > 0) {
    exitCode = 3;
    console.log(`退出码 ${exitCode}：存在跳过项 ${skipped.join(', ')}`);
  }

  console.log(
    '\n回填完成（stub：ready_to_produce=false，须人工补齐 Research Sub-Phase / Code Facts 后再置 true）。'
      + ' 若曾使用 compat.yaml 做临时豁免，请考虑删除 '
      + `'${path.posix.join(featureDirRel.replace(/\\/g, '/'), 'compat.yaml')}' 以恢复严格门禁。`,
  );

  process.exit(exitCode);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
