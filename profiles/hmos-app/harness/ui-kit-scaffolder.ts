// ============================================================================
// ui-kit-scaffolder.ts — 盲档 UI kit 确定性 scaffold（blind-visual-hardening d3 / P0-C）
// ----------------------------------------------------------------------------
// 路线 A 定案（codex 三轮 M1/design）：profile 内维护 ArkUI block 模板，由本 scaffolder
// 生成进宿主工程公共层；宿主不引入 framework runtime 依赖（纯 .ets 拷贝）。
// 目标目录四级解析（勿硬编码 03-CommonBusiness——非所有消费者工程都有该层）：
//   1) framework.config paths.ui_kit_target_dir 显式配置；
//   2) profile 推荐：architecture outer_layers 中 id 含 common 的层内、含 src/main/ets 的
//      唯一模块 → <module>/src/main/ets/maison_ui_kit；
//   3) 按 architecture 推导：唯一 outer_layer 且其下唯一模块 → 同上；
//   4) 无法唯一推导 → halt 问用户（不写猜测路径）。
// 幂等契约：目标文件 hash 一致→skip；缺失→write；漂移→conflict（BLOCKER 语义，
// 不静默覆盖——宿主改过 kit 文件须显式处置）。
// CLI：npx ts-node profiles/hmos-app/harness/ui-kit-scaffolder.ts [--target <relDir>] [--apply]
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig } from '../../../harness/config';
import { validateProjectRelativePath } from '../../../harness/scripts/utils/project-relative-path';

export const UI_KIT_DIR_NAME = 'maison_ui_kit';

export interface UiKitTargetResolution {
  status: 'resolved' | 'halt';
  targetAbs?: string;
  source?: 'config' | 'profile_recommended' | 'architecture_derived';
  haltReason?: string;
  candidates?: string[];
}

function moduleCandidatesInLayer(projectRoot: string, layerId: string): string[] {
  const layerAbs = path.join(projectRoot, layerId);
  if (!fs.existsSync(layerAbs)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(layerAbs, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (fs.existsSync(path.join(layerAbs, ent.name, 'src', 'main', 'ets'))) {
      out.push(path.join(layerId, ent.name).replace(/\\/g, '/'));
    }
  }
  return out;
}

export function resolveUiKitTargetDir(projectRoot: string): UiKitTargetResolution {
  const cfg = loadFrameworkConfig(projectRoot);
  // 1) 显式配置——安全校验收进 resolver 本体（codex 六轮 P1-2：CLI 末端 containment 只挡写入，
  //    conformance 消费 resolver 读外部目录仍可能假 PASS；非法配置一律 halt）。
  const explicit = (cfg.paths as { ui_kit_target_dir?: string } | undefined)?.ui_kit_target_dir;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    try {
      const safeRel = validateProjectRelativePath(projectRoot, explicit.trim(), 'paths.ui_kit_target_dir');
      return { status: 'resolved', targetAbs: path.resolve(projectRoot, safeRel), source: 'config' };
    } catch (e) {
      return {
        status: 'halt',
        haltReason: `paths.ui_kit_target_dir 非法（${(e as Error).message}）——须为宿主根内相对路径`,
      };
    }
  }
  const layers = (cfg.architecture?.outer_layers ?? []).map(l => l.id);
  // 2) profile 推荐：common 语义层内唯一模块
  const commonLayers = layers.filter(id => /common/i.test(id));
  const commonModules = commonLayers.flatMap(id => moduleCandidatesInLayer(projectRoot, id));
  if (commonModules.length === 1) {
    return {
      status: 'resolved',
      targetAbs: path.join(projectRoot, commonModules[0], 'src', 'main', 'ets', UI_KIT_DIR_NAME),
      source: 'profile_recommended',
    };
  }
  if (commonModules.length > 1) {
    return {
      status: 'halt',
      haltReason: `common 层存在多个候选模块，无法唯一推导——请在 framework.config.json paths.ui_kit_target_dir 显式指定`,
      candidates: commonModules,
    };
  }
  // 3) architecture 推导：全工程唯一含 src/main/ets 的模块
  const allModules = layers.flatMap(id => moduleCandidatesInLayer(projectRoot, id));
  if (allModules.length === 1) {
    return {
      status: 'resolved',
      targetAbs: path.join(projectRoot, allModules[0], 'src', 'main', 'ets', UI_KIT_DIR_NAME),
      source: 'architecture_derived',
    };
  }
  // 4) halt
  return {
    status: 'halt',
    haltReason:
      allModules.length === 0
        ? 'architecture outer_layers 下未发现含 src/main/ets 的模块——请显式配置 paths.ui_kit_target_dir'
        : `多候选无法唯一推导（${allModules.length} 个模块）——请显式配置 paths.ui_kit_target_dir`,
    candidates: allModules,
  };
}

export interface ScaffoldEntry {
  file: string;
  action: 'written' | 'skipped_identical' | 'conflict';
  detail?: string;
}

export interface ScaffoldResult {
  targetAbs: string;
  entries: ScaffoldEntry[];
  conflicts: ScaffoldEntry[];
}

export function uiKitTemplatesDir(): string {
  return path.resolve(__dirname, '..', 'ui-kit');
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 幂等 scaffold：identical→skip；missing→write；drift→conflict（不覆盖） */
export function scaffoldUiKit(targetAbs: string, opts?: { dryRun?: boolean }): ScaffoldResult {
  const srcDir = uiKitTemplatesDir();
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ets'));
  const entries: ScaffoldEntry[] = [];
  for (const f of files) {
    const srcBuf = fs.readFileSync(path.join(srcDir, f));
    const destAbs = path.join(targetAbs, f);
    if (!fs.existsSync(destAbs)) {
      if (!opts?.dryRun) {
        fs.mkdirSync(targetAbs, { recursive: true });
        fs.writeFileSync(destAbs, srcBuf);
      }
      entries.push({ file: f, action: 'written' });
      continue;
    }
    const destBuf = fs.readFileSync(destAbs);
    if (sha256(srcBuf) === sha256(destBuf)) {
      entries.push({ file: f, action: 'skipped_identical' });
    } else {
      entries.push({
        file: f,
        action: 'conflict',
        detail: '目标文件与模板 hash 漂移——宿主改过 kit 文件；不静默覆盖，请显式处置（还原/升级模板/改配置指向新目录）',
      });
    }
  }
  return { targetAbs, entries, conflicts: entries.filter(e => e.action === 'conflict') };
}

// ---------------------------------------------------------------------------
// CLI（codex 四轮 P1-3：从 framework/harness 经 npm script 执行时 cwd≠宿主根——
// 相对 --target 曾解析进 framework 内；--project-root 显式指定宿主根，target 相对其解析）
// ---------------------------------------------------------------------------

export interface ScaffolderCliResult {
  exitCode: number;
  targetAbs?: string;
}

/** 可测入口：argv 装配 + 相对路径基准=projectRoot（绝不落 framework 内）。
 * codex 五轮 P0：--target/配置值须过 validateProjectRelativePath（拒绝绝对路径/盘符/`..`）
 * + 终态 containment——写入 CLI 不得在宿主根外落文件。 */
export function scaffolderCliMain(argv: string[], cwd: string): ScaffolderCliResult {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const apply = argv.includes('--apply');
  const projectRoot = path.resolve(cwd, get('--project-root') ?? '.');
  const targetArg = get('--target');
  let targetAbs: string;
  if (targetArg) {
    try {
      const safeRel = validateProjectRelativePath(projectRoot, targetArg, '--target');
      targetAbs = path.resolve(projectRoot, safeRel);
    } catch (e) {
      console.error(`[ui-kit] ${(e as Error).message}`);
      return { exitCode: 2 };
    }
  } else {
    const res = resolveUiKitTargetDir(projectRoot);
    if (res.status === 'halt') {
      console.error(`[ui-kit] HALT：${res.haltReason}`);
      if (res.candidates?.length) console.error(`候选：\n${res.candidates.map(c => `  - ${c}`).join('\n')}`);
      return { exitCode: 2 };
    }
    targetAbs = res.targetAbs!;
    console.log(`[ui-kit] 目标目录（${res.source}）：${targetAbs}`);
  }
  // 终态 containment（配置来源同样受约束——config 写绝对/越界路径不得放行）
  const relCheck = path.relative(path.resolve(projectRoot), path.resolve(targetAbs));
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    console.error(`[ui-kit] 目标目录越出宿主根（${targetAbs}）——拒绝写入`);
    return { exitCode: 2 };
  }
  const result = scaffoldUiKit(targetAbs, { dryRun: !apply });
  for (const e of result.entries) {
    console.log(`  ${e.action.padEnd(18)} ${e.file}${e.detail ? ` — ${e.detail}` : ''}`);
  }
  if (!apply) console.log('[ui-kit] dry-run（加 --apply 落盘）');
  return { exitCode: result.conflicts.length > 0 ? 1 : 0, targetAbs };
}

if (require.main === module) {
  process.exit(scaffolderCliMain(process.argv.slice(2), process.cwd()).exitCode);
}
