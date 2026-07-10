// ============================================================================
// init-task-executor.ts — InitTaskPlan 确定性任务执行（Side effects 仅在此）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { clearFrameworkConfigCache, loadFrameworkConfigWithSources } from '../../config';
import { __testing as checkInitTesting } from '../check-init';
import { detectScan } from '../detect-deveco';
import { ensurePersonalSetup } from './personal-setup-gate';
import { resolveAllPersonalPrerequisites } from './phase-personal-prerequisites';
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
import { computeHooksConfigUpsert } from './hooks-config-upsert';
import { resolveMaterializedAdaptersForCleanup } from './materialized-adapters-resolve';
import type { CleanupEffects, CleanupResult } from './init-sync-telemetry';
import { detectRepoLayout } from '../../repo-layout';
import { renderBridgeSkillStubMarkdown } from './materialize-agent-bundle-skills';
import { resolveSkillPath } from './resolve-skill-path';
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

/**
 * S3 preflight 用只读校验（第九轮 codex P1：executor throw 只能保证"hooks 任务自身失败"，
 * 完整 plan 里 commands/rules 等前置任务可能已先写盘——不兼容必须在 preflight 拦下，
 * 保证整个工程零写盘；executor throw 保留为第二道防线）。
 * 纯读：加载 adapter 描述符 + 对每个 structured_upsert 目标 dry-run upsert；返回问题清单
 * （空=可安全执行）。adapter/配置解析失败按"无问题"返回——preflight 保持宽容，缺上下文
 * 时由执行器兜底，不额外造阻断面。
 */
export function preflightValidateHooksConfigTargets(
  projectRoot: string,
  ctxLike?: { adapterName?: string; materializedAdapters?: string[] },
): Array<{ adapterName: string; targetRel: string; note: string }> {
  try {
    const pseudoCtx = {
      projectRoot,
      harnessRoot: '',
      plan: { schema_version: '1.0', scope: 'project', mode: 'update', generated_at: '', tasks: [] },
      adapterName: ctxLike?.adapterName,
      materializedAdapters: ctxLike?.materializedAdapters,
    } as InitExecutionContext;
    // 第十轮 codex P1：只查 primary 会漏 secondary adapter（如 ["claude","cursor"] 时
    // materialize-adapter:cursor 仍会写 cursor 的 hooks_config 目标）——取
    // 上下文 + config materialized_adapters 的并集，全部 dry-run。
    const names = new Set<string>();
    const add = (n?: string | null) => {
      const t = (n ?? '').trim();
      if (t) names.add(t);
    };
    add(ctxLike?.adapterName);
    for (const n of ctxLike?.materializedAdapters ?? []) add(n);
    const sources = loadFrameworkConfigWithSources(projectRoot);
    if (Array.isArray(sources.projectRaw?.materialized_adapters)) {
      for (const n of sources.projectRaw!.materialized_adapters) {
        if (typeof n === 'string') add(n);
      }
    }
    if (names.size === 0) add(resolvePrimaryAdapter(pseudoCtx));

    const problems: Array<{ adapterName: string; targetRel: string; note: string }> = [];
    const seenTargets = new Set<string>();
    const frameworkRoot = detectRepoLayout(__dirname).frameworkRoot;
    for (const adapterName of names) {
      let adapter: ReturnType<typeof loadAdapter>;
      try {
        ({ adapter } = loadInspectorEnv(pseudoCtx, adapterName));
      } catch {
        continue; // 单个 adapter 装载失败不影响其余 adapter 的校验（宽容口径不变）
      }
      for (const f of adapter.templateFiles) {
        if (f.kind !== 'structured_upsert') continue;
        const tplAbs = path.join(frameworkRoot, f.templateRel);
        if (!fs.existsSync(tplAbs)) continue; // 模板缺失归 template_files_resolvable
        const targetRel = f.targetRel.replace(/\\/g, '/');
        if (seenTargets.has(targetRel)) continue;
        const tgAbs = path.join(projectRoot, f.targetRel);
        const upsert = computeHooksConfigUpsert(
          fs.existsSync(tgAbs) ? fs.readFileSync(tgAbs, 'utf-8') : null,
          fs.readFileSync(tplAbs, 'utf-8'),
        );
        if (upsert.status === 'invalid_json' || upsert.status === 'invalid_schema') {
          seenTargets.add(targetRel);
          problems.push({ adapterName, targetRel, note: upsert.note ?? upsert.status });
        }
      }
    }
    return problems;
  } catch {
    return [];
  }
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

/** structured_upsert 目标非法时任务必须 failed（第八轮 P1-1），三条写盘路径共用同一防线 */
function throwIfBlocked(results: SyncTemplateResult[]): void {
  const blocked = results.filter(r => r.effect === 'blocked');
  if (blocked.length > 0) {
    throw new Error(
      `hooks_config 目标不可安全合并（framework 不整文件覆盖宿主共享配置），守卫未安装：` +
      blocked.map(b => b.targetRel).join('、') +
      '——请人工修复目标文件（JSON 合法、hooks 为对象、受管 event 为数组）后重跑 init。',
    );
  }
}

/**
 * 第十一轮 codex P2：第二道防线也须整任务零写盘——materialize 批量写盘前先只读
 * dry-run 全部 structured_upsert 目标，有 blocked 直接 fail，不让同任务内 commands/
 * rules 等文件先落盘（preflight 被绕过/直调 executeInitTask 时的兜底）。
 */
function assertStructuredUpsertTargetsMergeable(
  ctx: InitExecutionContext,
  adapter: ReturnType<typeof loadAdapter>,
): void {
  const fwRoot = frameworkRootFromCtx(ctx);
  const blocked: SyncTemplateResult[] = [];
  for (const f of adapter.templateFiles) {
    if (f.kind !== 'structured_upsert') continue;
    const tplAbs = path.join(fwRoot, f.templateRel);
    if (!fs.existsSync(tplAbs)) continue; // 模板缺失由 syncTemplateTarget 报错口径处理
    const tgAbs = path.join(ctx.projectRoot, f.targetRel);
    const upsert = computeHooksConfigUpsert(
      fs.existsSync(tgAbs) ? fs.readFileSync(tgAbs, 'utf-8') : null,
      fs.readFileSync(tplAbs, 'utf-8'),
    );
    if (upsert.status === 'invalid_json' || upsert.status === 'invalid_schema') {
      blocked.push({ targetRel: normalizeTargetRel(f.targetRel), effect: 'blocked' });
    }
  }
  throwIfBlocked(blocked);
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
    case 'blocked':
      return `${result.targetRel} 目标不可安全合并，已拒绝改写`;
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

  // 第十轮 codex P1：materialize-adapter(-file) 任务也经本函数写盘——structured_upsert
  // 目标必须走结构化合并（与 applyInitMechanismSync 同语义），否则 secondary adapter
  // 物化时宿主共享 hooks.json 会被当普通字节整文件覆盖。
  if (file.kind === 'structured_upsert') {
    const upsert = computeHooksConfigUpsert(
      fs.existsSync(tgAbs) ? fs.readFileSync(tgAbs, 'utf-8') : null,
      tplBuf.toString('utf-8'),
    );
    if (upsert.status === 'invalid_json' || upsert.status === 'invalid_schema') {
      return { targetRel: norm, effect: 'blocked' };
    }
    if (upsert.status === 'unchanged') {
      return { targetRel: norm, effect: 'unchanged' };
    }
    fs.mkdirSync(path.dirname(tgAbs), { recursive: true });
    fs.writeFileSync(tgAbs, upsert.nextText!, 'utf-8');
    return { targetRel: norm, effect: upsert.status === 'created' ? 'created' : 'updated' };
  }

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
  } else if (
    file.origin.includes('skill_bridge') &&
    norm.replace(/\\/g, '/').endsWith('goal-mode/SKILL.md')
  ) {
    const resolved = resolveSkillPath(fwRoot, 'goal-mode');
    payload = Buffer.from(
      renderBridgeSkillStubMarkdown(
        'goal-mode',
        norm,
        resolved.skillMdRepoRel,
        adapter.name,
      ),
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

      const prereqs = resolveAllPersonalPrerequisites(ctx.projectRoot);
      const ensureResult = ensurePersonalSetup(ctx.projectRoot, { requiredPrerequisites: prereqs });

      let message = `已写入 framework.local.json agent_adapter=${active}`;
      if (ensureResult.ok) {
        if (
          ensureResult.ensured === 'auto_detect_deveco'
          || ensureResult.ensured === 'auto_single_adapter_and_deveco'
        ) {
          message += '；已自动补写 DevEco installPath';
        }
      } else if (ensureResult.code === 'deveco_toolchain_missing') {
        message += '；DevEco 工具链未自动探测到（best-effort；阶段入口仍会校验 DevEco）';
      } else {
        throw new Error(`record-adapter 后 personal setup 未就绪：${ensureResult.message}`);
      }

      return { message };
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
    // 第八轮 codex P1-1：blocked（structured_upsert 目标非法，拒绝改写）必须让任务 failed
    // ——原实现返回"已对齐"成功文案，init 假宣成功而守卫实际未安装。
    throwIfBlocked(results);
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
    const result = syncTemplateTarget(ctx, adapter, renderEnv, targetRel);
    throwIfBlocked([result]);
    return executionFromSyncResult(result);
  }

  if (task.id.startsWith('materialize-adapter:')) {
    const name = task.id.slice('materialize-adapter:'.length);
    const { adapter, renderEnv } = loadInspectorEnv(ctx, name);
    // 批量写盘前先验 structured_upsert 目标可合并——blocked 时整任务零写盘（第十一轮 P2）
    assertStructuredUpsertTargetsMergeable(ctx, adapter);
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
    throwIfBlocked(fileResults);

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
