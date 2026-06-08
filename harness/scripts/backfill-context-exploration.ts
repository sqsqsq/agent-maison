#!/usr/bin/env npx ts-node
// ============================================================================
// 存量 feature：按阶段回填 context-exploration.md（stub，满足 Context Exploration Gate）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import * as YAML from 'yaml';
import { loadFrameworkConfig, receiptDirPath, resolveFeatureArtifact } from '../config';
import {
  CONTEXT_EXPLORATION_PHASE_INPUT_SNIPPETS,
  ContextExplorationPhase,
  checkContextExplorationArtifact,
} from './utils/context-exploration';

type Args = {
  feature?: string;
  phases?: string;
  overwrite?: boolean;
  'project-root'?: string;
};

const ARTIFACT_REL = [
  'PRD.md',
  'design.md',
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
    '  ts-node scripts/backfill-context-exploration.ts --feature <name> --phases prd,design,...',
    '选项：',
    '  --project-root <path>   实例工程根（默认向上解析到绑定 framework.config.json）',
    '  --dry-run               不写盘，打印将写入的路径',
    '  --overwrite             允许覆盖已存在的 context-exploration.md',
  ].join('\n');
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
    if (sub === 'prd')
      push(`${path.posix.join(featureDirRel.replace(/\\/g, '/'), 'PRD.md')} — prd（强制覆盖关键词）`);
    else if (sub === 'acceptance')
      push(`${path.posix.join(featureDirRel.replace(/\\/g, '/'), 'acceptance.yaml')} — acceptance`);
    else if (sub === 'design')
      push(`${path.posix.join(featureDirRel.replace(/\\/g, '/'), 'design.md')} — design`);
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

  const ALLOWED = new Set<ContextExplorationPhase>(['prd', 'design', 'coding', 'review', 'ut']);
  const phases = phasesCsv
    .split(',')
    .map(s => s.trim())
    .filter(Boolean) as ContextExplorationPhase[];

  for (const ph of phases) {
    if (!ALLOWED.has(ph)) {
      console.error(`非法 phase：${ph}（只允许 prd/design/coding/review/ut）`);
      process.exit(2);
    }
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
