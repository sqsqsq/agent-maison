// ============================================================================
// init-task-executor.ts — InitTaskPlan 确定性任务执行（Side effects 仅在此）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { clearFrameworkConfigCache, loadFrameworkConfigWithSources } from '../../config';
import { __testing as checkInitTesting } from '../check-init';
import { detectScan } from '../detect-deveco';
import { prepareConfigWriteForTask } from './config-builder';
import {
  mergeFrameworkConfig,
  detectMissingBackfillFields,
  detectPendingMigrations,
  buildLocalFromProjectLegacy,
  resolveProfileNameFromRaw,
} from './config-field-merger';
import { ensureCanonicalGitignore } from './canonical-gitignore';
import {
  loadLocalConfig,
  writeLocalConfig,
  type FrameworkLocalConfig,
} from './framework-local-config';
import type { InitTask, InitTaskPlan } from './init-task-planner';
import type { TaskDecision } from '../init-orchestrate';
import { applyLegacySkillBridgeCleanup, type BackupSession } from './legacy-skill-bridge-cleanup';
import { resolveMaterializedAdaptersForCleanup } from './materialized-adapters-resolve';
import type { CleanupEffects, CleanupResult } from './init-sync-telemetry';
import { detectRepoLayout } from '../../repo-layout';
import {
  aggregateFileEffects,
  buildOwnedByTaskSet,
  formatBundleSyncMessage,
  normalizeTargetRel,
  type FileEffects,
  type InitTaskExecutionResult,
  type SyncTemplateResult,
} from './init-sync-telemetry';

export type { FileEffects, InitTaskExecutionResult, SyncTemplateResult } from './init-sync-telemetry';
export { buildOwnedByTaskSet } from './init-sync-telemetry';

const {
  loadRawFrameworkConfig,
  loadAdapter,
  buildRenderEnv,
  renderTemplate,
  compareTextArtifact,
  applyDeprecatedArtifactsCleanup,
  applyInitMechanismSync,
  applyGenericAdapterBundle,
  resolveBundleForInitInspect,
} = checkInitTesting;

export interface InitExecutionContext {
  projectRoot: string;
  harnessRoot: string;
  plan: InitTaskPlan;
  /** 项目 init 物化/渲染用的 adapter（非 personal active） */
  adapterName?: string;
  materializedAdapters?: string[];
  /** personal setup */
  activeAdapter?: string;
  devecoInstallPath?: string;
  confirmAnswers?: Record<string, boolean>;
  /** CREATE 模式 ensure-config：整文件 JSON（由 Skill 在 S2 收集后注入） */
  configWritePayload?: Record<string, unknown>;
  /** doc 骨架内容（Skill S2 注入；缺则 doc 任务 failed 而非假 executed） */
  docWritePayload?: {
    architecture_md?: string;
    module_catalog?: string;
    glossary_yaml?: string;
    glossary_seed?: string;
  };
}

function configPath(projectRoot: string): string {
  return path.join(projectRoot, 'framework.config.json');
}

function backupConfig(projectRoot: string): string {
  const src = configPath(projectRoot);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\.\d+Z$/, 'Z');
  const backupRoot = path.join(projectRoot, '.framework-backup', stamp);
  fs.mkdirSync(backupRoot, { recursive: true });
  const dst = path.join(backupRoot, 'framework.config.json');
  fs.copyFileSync(src, dst);
  return path.relative(projectRoot, dst).replace(/\\/g, '/');
}

function resolvePrimaryAdapter(ctx: InitExecutionContext): string {
  if (ctx.adapterName?.trim()) return ctx.adapterName.trim();
  if (ctx.materializedAdapters?.length) return ctx.materializedAdapters[0]!;
  const sources = loadFrameworkConfigWithSources(ctx.projectRoot);
  const fromProject = Array.isArray(sources.projectRaw?.materialized_adapters)
    ? sources.projectRaw!.materialized_adapters.filter(
        (a): a is string => typeof a === 'string' && a.trim().length > 0,
      )
    : [];
  if (fromProject.length > 0) return fromProject[0]!.trim();
  if (ctx.plan.scope === 'project') {
    const legacy =
      typeof sources.projectRaw?.agent_adapter === 'string'
        ? sources.projectRaw.agent_adapter.trim()
        : '';
    return legacy || 'generic';
  }
  return sources.config.agent_adapter ?? 'generic';
}

function loadInspectorEnv(ctx: InitExecutionContext, adapterName: string) {
  const rawCfg = loadRawFrameworkConfig(ctx.projectRoot);
  const adapter = loadAdapter(adapterName);
  if (adapter.name === 'generic') {
    const bundle = resolveBundleForInitInspect('generic', rawCfg, ctx.projectRoot);
    if (bundle) applyGenericAdapterBundle(adapter, bundle);
  }
  const renderEnv = buildRenderEnv(rawCfg, adapter, ctx.projectRoot);
  return { rawCfg, adapter, renderEnv };
}

function frameworkRootFromCtx(ctx: InitExecutionContext): string {
  return detectRepoLayout(ctx.harnessRoot).frameworkRoot;
}

function syncResultToMessage(result: SyncTemplateResult): string {
  switch (result.effect) {
    case 'created':
    case 'updated':
      return `已写入 ${result.targetRel}`;
    case 'unchanged':
      return `${result.targetRel} 已对齐，跳过`;
    case 'delegated':
      return `${result.targetRel} 由 per-file 任务管理，跳过`;
    default:
      return result.targetRel;
  }
}

function executionFromSyncResult(result: SyncTemplateResult): InitTaskExecutionResult {
  return {
    message: syncResultToMessage(result),
    file_results: [result],
    file_effects: aggregateFileEffects([result]),
  };
}

function syncTemplateTarget(
  ctx: InitExecutionContext,
  adapter: ReturnType<typeof loadAdapter>,
  renderEnv: ReturnType<typeof buildRenderEnv>,
  targetRel: string,
  options?: { ownedByTask?: Set<string> },
): SyncTemplateResult {
  const norm = normalizeTargetRel(targetRel);
  if (options?.ownedByTask?.has(norm)) {
    return { targetRel: norm, effect: 'delegated' };
  }

  const file = adapter.templateFiles.find(f => normalizeTargetRel(f.targetRel) === norm)
    ?? (adapter.entryFile && normalizeTargetRel(adapter.entryFile.targetRel) === norm
      ? adapter.entryFile
      : null);
  if (!file) {
    throw new Error(`adapter 模板列表中未找到 target: ${targetRel}`);
  }
  const fwRoot = frameworkRootFromCtx(ctx);
  const tplAbs = path.join(fwRoot, file.templateRel);
  const tgAbs = path.join(ctx.projectRoot, file.targetRel);
  if (!fs.existsSync(tplAbs)) {
    throw new Error(`模板缺失: ${file.templateRel}`);
  }
  const tplBuf = fs.readFileSync(tplAbs);
  let payload: Buffer;
  if (file.kind === 'rendered') {
    if (!renderEnv) {
      throw new Error('CREATE 模式缺少 renderEnv，无法渲染模板');
    }
    payload = Buffer.from(renderTemplate(tplBuf.toString('utf-8'), renderEnv), 'utf-8');
  } else if (file.kind === 'materialized' && file.skillDir) {
    const { materializeInlineSkillMarkdown } = require('./materialize-agent-bundle-skills') as {
      materializeInlineSkillMarkdown: (
        fw: string,
        skillDir: string,
        ctx?: { projectRoot: string; stubTargetRelPosix: string },
      ) => string;
    };
    payload = Buffer.from(
      materializeInlineSkillMarkdown(fwRoot, file.skillDir, {
        projectRoot: ctx.projectRoot,
        stubTargetRelPosix: norm,
      }),
      'utf-8',
    );
  } else {
    payload = tplBuf;
  }

  if (!fs.existsSync(tgAbs)) {
    fs.mkdirSync(path.dirname(tgAbs), { recursive: true });
    fs.writeFileSync(tgAbs, payload);
    return { targetRel: norm, effect: 'created' };
  }

  const cmp = compareTextArtifact(payload, fs.readFileSync(tgAbs));
  if (cmp.kind === 'byte_equal' || cmp.kind === 'eol_only') {
    return { targetRel: norm, effect: 'unchanged' };
  }

  fs.mkdirSync(path.dirname(tgAbs), { recursive: true });
  fs.writeFileSync(tgAbs, payload);
  return { targetRel: norm, effect: 'updated' };
}

function writeConfigMerge(
  projectRoot: string,
  confirmAnswers: Record<string, boolean>,
  passes: { backfill?: boolean; migration?: boolean; confirm?: boolean },
): string {
  const cfgP = configPath(projectRoot);
  if (!fs.existsSync(cfgP)) {
    throw new Error('framework.config.json 不存在，无法 merge');
  }
  const raw = JSON.parse(fs.readFileSync(cfgP, 'utf-8'));
  const profileName = resolveProfileNameFromRaw(raw);
  const { merged, backfillReport, migrationReport, confirmReport } = mergeFrameworkConfig(
    raw,
    confirmAnswers,
    profileName,
  );
  const mergedText = `${JSON.stringify(merged, null, 2)}\n`;
  const onDisk = fs.readFileSync(cfgP, 'utf-8');
  if (onDisk === mergedText) {
    return 'config 已与 merge 结果一致，跳过写入';
  }
  const parts: string[] = [];
  if (passes.backfill) parts.push(`backfill=${backfillReport.appliedFields.length}`);
  if (passes.migration) parts.push(`migration=${migrationReport.appliedMigrations.length}`);
  if (passes.confirm) parts.push(`confirm=${confirmReport.appliedFields.length}`);
  const backupRel = backupConfig(projectRoot);
  fs.writeFileSync(cfgP, mergedText, 'utf-8');
  clearFrameworkConfigCache();
  return `已 merge 写回 framework.config.json（${parts.join(', ')}；备份 ${backupRel}）`;
}

function runHarnessInstall(harnessRoot: string): string {
  const r = spawnSync('npm', ['install'], {
    cwd: harnessRoot,
    shell: true,
    encoding: 'utf-8',
  });
  if (r.status !== 0) {
    throw new Error(`npm install 失败（exit ${r.status}）: ${r.stderr || r.stdout}`);
  }
  return 'framework/harness npm install 完成';
}

function runGlobalPhases(harnessRoot: string, projectRoot: string): string {
  const phases = ['catalog', 'glossary', 'docs'];
  const notes: string[] = [];
  for (const phase of phases) {
    const r = spawnSync(
      'npx',
      ['ts-node', 'harness-runner.ts', '--phase', phase, '--feature', '_global'],
      {
        cwd: harnessRoot,
        shell: true,
        encoding: 'utf-8',
        env: { ...process.env, HARNESS_INIT_INTERNAL_GLOBAL_RUN: '1' },
      },
    );
    if (r.status !== 0) {
      throw new Error(`全局 phase ${phase} 失败（exit ${r.status}）`);
    }
    notes.push(phase);
  }
  return `全局 phase 完成: ${notes.join(', ')}（projectRoot=${projectRoot}）`;
}

function mergeLocal(
  projectRoot: string,
  patch: Partial<FrameworkLocalConfig>,
): FrameworkLocalConfig {
  const existing = loadLocalConfig(projectRoot);
  const base: FrameworkLocalConfig = existing ?? { schema_version: '1.0' };
  const next: FrameworkLocalConfig = {
    schema_version: '1.0',
    ...(base.agent_adapter ? { agent_adapter: base.agent_adapter } : {}),
    ...(base.toolchain ? { toolchain: { ...base.toolchain } } : {}),
  };
  if (patch.agent_adapter) next.agent_adapter = patch.agent_adapter;
  if (patch.toolchain?.devEcoStudio) {
    next.toolchain = {
      ...(next.toolchain ?? {}),
      devEcoStudio: {
        ...(next.toolchain?.devEcoStudio ?? {}),
        ...patch.toolchain.devEcoStudio,
      },
    };
  }
  return next;
}

function assertAdapterMaterialized(projectRoot: string, adapterName: string): string {
  const { adapter } = loadInspectorEnv({ projectRoot, harnessRoot: '', plan: {} as InitTaskPlan }, adapterName);
  if (!adapter.entryFile) {
    throw new Error(`adapter ${adapterName} 无 entryFile 定义`);
  }
  const entryAbs = path.join(projectRoot, adapter.entryFile.targetRel);
  if (!fs.existsSync(entryAbs)) {
    throw new Error(
      `adapter ${adapterName} 入口产物未物化（缺 ${adapter.entryFile.targetRel}）；请先跑项目级 framework-init`,
    );
  }
  return `只读校验通过：${adapter.entryFile.targetRel} 存在`;
}

/** 执行单个任务；action 已由 orchestrate resolve */
export function executeInitTask(
  task: InitTask,
  action: TaskDecision['action'],
  ctx: InitExecutionContext,
): InitTaskExecutionResult {
  const adapterName = resolvePrimaryAdapter(ctx);

  switch (task.id) {
    case 'ensure-gitignore': {
      const r = ensureCanonicalGitignore(ctx.projectRoot);
      return {
        message: r.created
          ? `创建 .gitignore，追加 ${r.added.length} 条`
          : r.added.length
            ? `追加 ${r.added.length} 条 patterns`
            : 'canonical 已齐备',
      };
    }
    case 'ensure-config': {
      if (!ctx.configWritePayload) {
        throw new Error(
          'ensure-config：context.configWritePayload 缺失；须由 Skill S2 注入 JSON，或在 S2 决策 skip/keep',
        );
      }
      const cfgP = configPath(ctx.projectRoot);
      if (fs.existsSync(cfgP) && action !== 'overwrite') {
        return { message: 'framework.config.json 已存在，未 overwrite' };
      }
      let toWrite: Record<string, unknown>;
      try {
        toWrite = prepareConfigWriteForTask(
          { projectRoot: ctx.projectRoot, configWritePayload: ctx.configWritePayload },
          action,
        );
      } catch (e) {
        throw new Error(`ensure-config：config 校验失败：${(e as Error).message}`);
      }
      if (fs.existsSync(cfgP)) backupConfig(ctx.projectRoot);
      fs.writeFileSync(cfgP, `${JSON.stringify(toWrite, null, 2)}\n`, 'utf-8');
      clearFrameworkConfigCache();
      return { message: '已写入 framework.config.json' };
    }
    case 'backfill-config': {
      const raw = JSON.parse(fs.readFileSync(configPath(ctx.projectRoot), 'utf-8'));
      const profileName = resolveProfileNameFromRaw(raw);
      if (detectMissingBackfillFields(raw, profileName).length === 0) {
        return { message: '无 backfill 字段缺失' };
      }
      return {
        message: writeConfigMerge(ctx.projectRoot, ctx.confirmAnswers ?? {}, {
          backfill: true,
          migration: false,
          confirm: false,
        }),
      };
    }
    case 'migrate-config': {
      const raw = JSON.parse(fs.readFileSync(configPath(ctx.projectRoot), 'utf-8'));
      if (detectPendingMigrations(raw).length === 0) {
        return { message: '无 pending migration' };
      }
      const legacyLocal = buildLocalFromProjectLegacy(raw);
      const mergeMsg = writeConfigMerge(ctx.projectRoot, ctx.confirmAnswers ?? {}, {
        backfill: true,
        migration: true,
        confirm: false,
      });
      if (legacyLocal) {
        writeLocalConfig(ctx.projectRoot, mergeLocal(ctx.projectRoot, legacyLocal));
        clearFrameworkConfigCache();
        return { message: `${mergeMsg}；已外迁 personal 字段到 framework.local.json` };
      }
      return { message: mergeMsg };
    }
    case 'confirm-fields':
      return {
        message: writeConfigMerge(ctx.projectRoot, ctx.confirmAnswers ?? {}, {
          backfill: false,
          migration: false,
          confirm: true,
        }),
      };
    case 'cleanup-deprecated': {
      const mode = ctx.plan.mode;
      if (mode !== 'update') {
        return { message: 'CREATE 跳过遗留跳板清理' };
      }

      const sources = loadFrameworkConfigWithSources(ctx.projectRoot);
      const config = sources.config;
      const adapters = resolveMaterializedAdaptersForCleanup(ctx, config, sources);
      const backupSession: BackupSession = {
        stamp: new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
      };

      const cleanupResults: CleanupResult[] = [];

      for (const name of adapters) {
        const adapter = loadAdapter(name);
        const { cleaned } = applyDeprecatedArtifactsCleanup(
          ctx.projectRoot,
          adapter,
          mode,
          { backupSession },
        );
        for (const item of cleaned) {
          cleanupResults.push({
            path: item.path,
            backup_path: item.backup_path ?? undefined,
            kind: 'deprecated_artifact',
            adapter: name,
          });
        }
      }

      const legacy = applyLegacySkillBridgeCleanup({
        projectRoot: ctx.projectRoot,
        materializedAdapters: adapters,
        mode,
        config,
        backupSession,
      });
      cleanupResults.push(...legacy.cleaned);

      const backupRelDir = backupSession.backupRelDir ?? null;
      const total = cleanupResults.length;
      const cleanupEffects: CleanupEffects = { backup_deleted: total };

      return {
        message: total
          ? `cleanup backup_delete ${total} 项${backupRelDir ? `（备份 ${backupRelDir}）` : ''}`
          : '无 deprecated / 遗留跳板需清理',
        ...(total > 0 ? { cleanup_results: cleanupResults, cleanup_effects: cleanupEffects } : {}),
      };
    }
    case 'harness-install':
      return { message: runHarnessInstall(ctx.harnessRoot) };
    case 'run-global-phases':
      return { message: runGlobalPhases(ctx.harnessRoot, ctx.projectRoot) };
    case 'materialize-entry-file': {
      const { adapter, renderEnv } = loadInspectorEnv(ctx, adapterName);
      if (!adapter.entryFile) throw new Error('无 entryFile');
      return executionFromSyncResult(
        syncTemplateTarget(ctx, adapter, renderEnv, adapter.entryFile.targetRel),
      );
    }
    case 'assert-active-adapter-materialized': {
      const active = ctx.activeAdapter?.trim();
      if (!active) throw new Error('assert-active-adapter-materialized 需要 executionContext.activeAdapter');
      const materialized =
        ctx.materializedAdapters ??
        loadFrameworkConfigWithSources(ctx.projectRoot).config.materialized_adapters ??
        [];
      if (materialized.length > 0 && !materialized.includes(active)) {
        throw new Error(
          `active adapter "${active}" 不在 materialized_adapters [${materialized.join(', ')}]`,
        );
      }
      return { message: assertAdapterMaterialized(ctx.projectRoot, active) };
    }
    case 'record-adapter': {
      const active = ctx.activeAdapter?.trim();
      if (!active) throw new Error('record-adapter 需要 executionContext.activeAdapter');
      writeLocalConfig(ctx.projectRoot, mergeLocal(ctx.projectRoot, { agent_adapter: active }));
      clearFrameworkConfigCache();
      return { message: `已写入 framework.local.json agent_adapter=${active}` };
    }
    case 'detect-deveco': {
      const report = detectScan();
      if (report.recommended?.status === 'ok' && report.recommended.installPath) {
        return {
          message: `探测候选 ok: ${report.recommended.installPath}（${report.candidates.length} 个候选）`,
        };
      }
      return {
        message: `未找到完整安装（${report.candidates.length} 个候选）；setup 可选跳过或修正本机安装后重跑`,
      };
    }
    case 'record-deveco-path': {
      if (!ctx.devecoInstallPath?.trim()) {
        return { message: '未提供 devecoInstallPath，跳过写入 local' };
      }
      writeLocalConfig(
        ctx.projectRoot,
        mergeLocal(ctx.projectRoot, {
          toolchain: { devEcoStudio: { installPath: ctx.devecoInstallPath.trim() } },
        }),
      );
      clearFrameworkConfigCache();
      return { message: '已写入 framework.local.json toolchain.devEcoStudio.installPath' };
    }
    default:
      break;
  }

  if (task.id.startsWith('sync-auto-overwrite:')) {
    const targetRel = normalizeTargetRel(task.id.slice('sync-auto-overwrite:'.length));
    const { adapter } = loadInspectorEnv(ctx, adapterName);
    const { results, syncedFiles, backupRelDir } = applyInitMechanismSync(ctx.projectRoot, adapter, {
      includeTargets: new Set([targetRel]),
    });
    return {
      message: syncedFiles
        ? `mechanism sync ${syncedFiles} 个 auto_overwrite 文件${backupRelDir ? `（备份 ${backupRelDir}）` : ''}`
        : 'auto_overwrite 模板已对齐',
      file_results: results,
      file_effects: aggregateFileEffects(results),
    };
  }

  if (task.id.startsWith('materialize-adapter-file:')) {
    const targetRel = task.id.slice('materialize-adapter-file:'.length);
    const { adapter, renderEnv } = loadInspectorEnv(ctx, adapterName);
    return executionFromSyncResult(syncTemplateTarget(ctx, adapter, renderEnv, targetRel));
  }

  if (task.id.startsWith('materialize-adapter:')) {
    const name = task.id.slice('materialize-adapter:'.length);
    const { adapter, renderEnv } = loadInspectorEnv(ctx, name);
    const ownedByTask = buildOwnedByTaskSet(ctx.plan);
    const fileResults: SyncTemplateResult[] = [];

    if (adapter.entryFile) {
      fileResults.push(
        syncTemplateTarget(ctx, adapter, renderEnv, adapter.entryFile.targetRel, { ownedByTask }),
      );
    }
    for (const f of adapter.templateFiles) {
      fileResults.push(syncTemplateTarget(ctx, adapter, renderEnv, f.targetRel, { ownedByTask }));
    }

    const fileEffects = aggregateFileEffects(fileResults);
    return {
      message: formatBundleSyncMessage(name, fileEffects),
      file_effects: fileEffects,
      file_results: fileResults,
    };
  }

  if (
    task.id === 'write-architecture' ||
    task.id === 'ensure-catalog' ||
    task.id === 'ensure-glossary' ||
    task.id === 'ensure-glossary-seed' ||
    task.id === 'ensure-features-dir'
  ) {
    const payloadKeyMap: Record<string, keyof NonNullable<InitExecutionContext['docWritePayload']>> = {
      'write-architecture': 'architecture_md',
      'ensure-catalog': 'module_catalog',
      'ensure-glossary': 'glossary_yaml',
      'ensure-glossary-seed': 'glossary_seed',
    };
    if (task.id === 'ensure-features-dir') {
      const cfg = loadRawFrameworkConfig(ctx.projectRoot);
      const featuresRel =
        typeof cfg.raw?.paths === 'object' &&
        cfg.raw.paths &&
        typeof (cfg.raw.paths as Record<string, unknown>).features_dir === 'string'
          ? ((cfg.raw.paths as Record<string, unknown>).features_dir as string)
          : 'doc/features';
      const featuresAbs = path.join(ctx.projectRoot, featuresRel);
      if (!fs.existsSync(featuresAbs)) {
        fs.mkdirSync(featuresAbs, { recursive: true });
        return { message: `已创建 ${featuresRel}/` };
      }
      return { message: `${featuresRel}/ 已存在，跳过` };
    }
    const key = payloadKeyMap[task.id]!;
    const content = ctx.docWritePayload?.[key]?.trim();
    if (!content) {
      throw new Error(
        `${task.id}：context.docWritePayload.${key} 缺失；须由 Skill S2 注入内容，或在 S2 决策 skip`,
      );
    }
    const rel =
      task.target_path ??
      (task.id === 'write-architecture'
        ? 'doc/architecture.md'
        : task.id === 'ensure-catalog'
          ? 'doc/module-catalog.yaml'
          : task.id === 'ensure-glossary'
            ? 'doc/glossary.yaml'
            : 'doc/glossary-seed.txt');
    const abs = path.join(ctx.projectRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content.endsWith('\n') ? content : `${content}\n`, 'utf-8');
    return { message: `已写入 ${rel}` };
  }

  return { message: `任务已登记（无 executor 实现：${task.title}）` };
}
