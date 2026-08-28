// ============================================================================
// ut-target-resolver.ts — 统一 UT 责任域（target）解析器（plan 423e5d0f P1-1）
// ============================================================================
// 核心模型（codex 简化版）：
//   target = 本次明确负责的测试文件/用例；suite = 真实工具链会编译执行的整个模块。
//   需求房规只检查 target；真实编译/执行检查 suite。
//
// 责任域判定（文件级默认 + 用例级升格）：
//   - targetFiles     ：scoped 中**基线不存在**的文件（本 feature 新建）。
//   - legacyNewCases  ：scoped 中基线已存在（legacy）的文件里，相对基线版**新增的 it()**
//                       （用例级升格——堵"在存量文件里加需求用例被整体豁免"的假绿窗口）。
//   - 其余 legacy 内容：不受需求房规问责，由真实编译/执行（suite）覆盖。
//
// 基线只认 agent 动手前锚（与 P0 computeUtFileBaseline 一致）：
//   HARNESS_DIFF_BASE_REF（用户显式）→ goal run coding_base_sha → 无锚 fail-closed。
//   无锚时 targetFiles = scoped 全量（等于改造前行为，不放水），legacyNewCases 为空。
//
// Git diff / context 提及只是发现候选的线索，不决定责任；用户明确目标与工作模式声明
// （P2 薄入口）通过 explicitTargets 参数注入，优先级最高。
// ============================================================================

import type { CheckContext } from './types';
import { listFilesAtRef, readFileAtRef } from './git-diff';
import { resolveGoalRunBaseline } from './goal-run-baseline';
import { extractUtItBlocks } from './ut-it-blocks';
import { hasGoalExecutionSignal, resolveHarnessDiffBaseRef } from './phase-state';

export interface UtFileEntryLike {
  path: string;
  content: string;
}

export interface UtFileBaseline {
  available: boolean;
  ref?: string;
  existing: Set<string>;
  note: string;
}

export interface UtLegacyIncrement {
  path: string;
  content: string;
  /** 基线版内容（用于 mockkit 用法差集等增量治理） */
  baselineContent: string;
  /** 相对基线新增的 it() 名 */
  newCases: Set<string>;
}

/** 三种工作方式（plan 423e5d0f）：只改变 target 来源，共用同一引擎 */
export type UtWorkMode = 'cover_feature_change' | 'repair_existing_ut' | 'cover_existing_code';

export const UT_MODE_ENV = 'MAISON_UT_MODE';
export const UT_TARGETS_ENV = 'MAISON_UT_TARGETS';

export function readUtWorkMode(): UtWorkMode {
  const raw = (process.env[UT_MODE_ENV] ?? '').trim();
  if (raw === 'repair_existing_ut' || raw === 'cover_existing_code') return raw;
  return 'cover_feature_change';
}

/** 用户明确指定的目标文件（分号/逗号分隔的相对路径）——repair/cover_existing 入口的机器化通道 */
export function readExplicitUtTargets(): string[] {
  return (process.env[UT_TARGETS_ENV] ?? '')
    .split(/[;,]/)
    .map(s => s.trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

export interface UtTargetResolution {
  mode: UtWorkMode;
  /** 本 feature 责任域文件（基线新增文件全责） */
  targetFiles: UtFileEntryLike[];
  /** legacy 文件的用例级升格：仅新增 it 及其基线内容进入问责 */
  legacyIncrements: UtLegacyIncrement[];
  /**
   * 统一 target-case 视图（P1 消费面）：targetFiles 原样 + legacy 增量合成条目
   * （新增 import 行 + 新增 it 块重构文本）——需求房规统一消费它，
   * 使存量文件内新增用例受与新文件同等的问责。
   */
  targetCaseView: UtFileEntryLike[];
  /**
   * 用户显式指定的目标文件（MAISON_UT_TARGETS 命中项）。显式指定=强制纳入执行责任域
   * （模块必须编译执行、其用例进棘轮"永不豁免"名单），**不改变身份问责**：
   * 基线已存在的显式目标仍是存量身份（其存量 it 不被标签/mockkit 房规问责——
   * repair 修的就是存量用例，不得逼其挂 feature 标签）。
   */
  explicitTargetFiles: UtFileEntryLike[];
  /** 显式请求的目标路径数与命中数（repair/cover_existing 模式 fail-closed 用） */
  explicitRequested: number;
  explicitMatched: number;
  /** 责任域外文件（用于豁免披露） */
  exemptFiles: UtFileEntryLike[];
  baseline: UtFileBaseline;
  /** 每项选择的可读原因（诊断透明） */
  selectionReasons: string[];
}

/**
 * UT 文件基线身份（plan 423e5d0f P0 · codex 三修版）：
 * 基线 ref 下已存在的文件 = 存量（legacy）；其余 = 本 feature 新增。
 * ref 只认**agent 动手之前锚定**的可信起点：
 *   ① HARNESS_DIFF_BASE_REF（用户显式，与 ut_no_src_mutation 同信任模型）；
 *   ② goal run（MAISON_GOAL_RUN_ID 在场）下 runner 在首次 coding invoke 前锚定的
 *      coding_base_sha（write-once + 跨 project/feature/run 重放校验）。
 * **绝不消费 trace.start_commit**：它是本次 harness 启动时才记录的当前 HEAD——
 * "新增 UT → commit → 首跑 ut harness" 时该 HEAD 已含新 UT，会把本轮新文件洗成存量
 * （与 ui-scope-gate 同款纪律："其记录时点在 agent 之后"）。也不回退裸 HEAD（同理）。
 * 无可信前置锚 → available=false，按 scoped 全量问责（fail-closed）。
 */
export function computeUtFileBaseline(ctx: CheckContext): UtFileBaseline {
  const runId = (process.env.MAISON_GOAL_RUN_ID ?? '').trim();
  const goalSignal = hasGoalExecutionSignal();
  const envBaseRef = resolveHarnessDiffBaseRef() ?? '';
  let baseRef: string | undefined;
  let anchorSource = '';
  if (goalSignal && !runId) {
    return {
      available: false,
      existing: new Set(),
      note: 'goal execution signal 在场但 MAISON_GOAL_RUN_ID 缺失——禁止读取 HARNESS_DIFF_BASE_REF，按 scoped 全量问责。',
    };
  }
  if (goalSignal) {
    const baseline = resolveGoalRunBaseline(ctx.projectRoot, ctx.feature, runId);
    if (baseline.available) {
      baseRef = baseline.baseSha;
      anchorSource = baseline.source;
    } else {
      return {
        available: false,
        existing: new Set(),
        note: `${baseline.reason}——goal run 不读取 HARNESS_DIFF_BASE_REF，按 scoped 全量问责。`,
      };
    }
  } else if (envBaseRef && envBaseRef !== 'working') {
    baseRef = envBaseRef;
    anchorSource = 'HARNESS_DIFF_BASE_REF';
  }
  if (!baseRef) {
    return {
      available: false,
      existing: new Set(),
      note:
        '无可信前置基线锚：按 scoped 全量问责。goal run 在出生时冻结 manifest.run_base_sha；' +
        '手动重跑请设 HARNESS_DIFF_BASE_REF=<feature 开始前的 commit> 以启用存量豁免' +
        '（不消费 trace.start_commit——其记录时点在 agent 之后，会把已提交的本轮新 UT 洗成存量）。',
    };
  }
  const listed = listFilesAtRef(ctx.projectRoot, baseRef);
  if (!listed.executed) {
    return {
      available: false,
      existing: new Set(),
      note: `基线身份不可判定（${listed.error ?? 'git 不可用'}）：按 scoped 全量问责。`,
    };
  }
  return {
    available: true,
    ref: baseRef,
    existing: listed.files,
    note: `基线=${baseRef}（锚=${anchorSource}）`,
  };
}

function itNames(content: string): Set<string> {
  return new Set(extractUtItBlocks(content).map(b => b.name));
}

/** legacy 增量的合成视图内容：新增 import 行 + 新增 it 块重构文本（供需求房规统一消费） */
function buildIncrementViewContent(inc: UtLegacyIncrement): string {
  const baseLines = new Set(inc.baselineContent.split(/\r?\n/).map(l => l.trim()));
  const newImportLines = inc.content
    .split(/\r?\n/)
    .filter(l => /^\s*import\s/.test(l) && !baseLines.has(l.trim()));
  const newBlocks = extractUtItBlocks(inc.content)
    .filter(b => inc.newCases.has(b.name))
    .map(b => `it('${b.name.replace(/'/g, "\\'")}', 0, () => {${b.body}})`);
  return [...newImportLines, ...newBlocks].join('\n');
}

/**
 * 统一 target 解析（P1-1）。优先级：
 *   explicitTargets（用户明确目标；工作模式经 MAISON_UT_MODE / MAISON_UT_TARGETS 注入）
 *   > feature 声明与 Git/context 线索形成的 scoped（由 partitionUtFiles 提供）
 * 显式目标可指向**任意**已发现 UT 文件（不限 scoped——用户点名的就是 target，
 * 即使是未被触碰/提及的存量文件，repair 模式正需要这种指定）。
 * scoped 内再按基线分：新建文件 = target 全责；legacy 文件 = 仅新增 it 用例级升格。
 */
export function resolveUtTargets(
  ctx: CheckContext,
  allUtFiles: UtFileEntryLike[],
  scopedUtFiles: UtFileEntryLike[],
  opts?: {
    /** 用户明确指定的目标文件路径（相对项目根，正斜杠）——直接升格 target；缺省读 env */
    explicitTargets?: string[];
    mode?: UtWorkMode;
  },
): UtTargetResolution {
  const reasons: string[] = [];
  const mode = opts?.mode ?? readUtWorkMode();
  const baseline = computeUtFileBaseline(ctx);
  const explicit = new Set((opts?.explicitTargets ?? readExplicitUtTargets()).map(p => p.replace(/\\/g, '/')));

  const targetFiles: UtFileEntryLike[] = [];
  const legacyIncrements: UtLegacyIncrement[] = [];
  const explicitTargetFiles: UtFileEntryLike[] = [];
  const targetPaths = new Set<string>();

  if (mode !== 'cover_feature_change') {
    reasons.push(`工作模式：${mode}（${UT_MODE_ENV}）`);
  }

  // 显式目标最高优先：在全部已发现文件中匹配（不限 scoped——repair 正需要点名
  // 未触碰的存量文件）。显式指定只**强制纳入执行责任域**（编译/执行/棘轮不豁免），
  // 身份问责照常走下方基线判定：存量身份的显式目标其存量 it 不进需求房规。
  const matchedExplicit = new Set<string>();
  if (explicit.size > 0) {
    for (const f of allUtFiles) {
      const norm = f.path.replace(/\\/g, '/');
      if (explicit.has(norm)) {
        explicitTargetFiles.push(f);
        matchedExplicit.add(norm);
        reasons.push(`${f.path}: 显式执行目标（${UT_TARGETS_ENV}——强制编译执行+棘轮不豁免；身份问责按基线判定）`);
      }
    }
    for (const p of explicit) {
      if (!matchedExplicit.has(p)) reasons.push(`${p}: 明确指定但未在已发现 UT 文件中命中（核对路径）`);
    }
  }

  // 身份判定候选 = scoped ∪ 显式命中（显式文件不在 scoped 时也须判定身份）
  const candidateMap = new Map<string, UtFileEntryLike>();
  for (const f of scopedUtFiles) candidateMap.set(f.path, f);
  for (const f of explicitTargetFiles) if (!candidateMap.has(f.path)) candidateMap.set(f.path, f);

  for (const f of candidateMap.values()) {
    const norm = f.path.replace(/\\/g, '/');
    if (!baseline.available) {
      targetFiles.push(f);
      targetPaths.add(f.path);
      reasons.push(`${f.path}: target（无基线锚，scoped 全量问责）`);
      continue;
    }
    if (!baseline.existing.has(norm)) {
      targetFiles.push(f);
      targetPaths.add(f.path);
      reasons.push(`${f.path}: target（基线不存在，本 feature 新建）`);
      continue;
    }
    // legacy（基线已存在）：读基线版内容做用例级升格
    const baseBuf = baseline.ref ? readFileAtRef(ctx.projectRoot, baseline.ref, norm) : null;
    if (!baseBuf) {
      // 基线树声明存在但读取失败（git 异常，罕见）：保守不升格，透明记录
      reasons.push(`${f.path}: legacy（基线内容读取失败，未做用例级升格）`);
      continue;
    }
    const baselineContent = baseBuf.toString('utf-8');
    const baseNames = itNames(baselineContent);
    const newCases = new Set([...itNames(f.content)].filter(n => !baseNames.has(n)));
    if (newCases.size > 0) {
      legacyIncrements.push({ path: f.path, content: f.content, baselineContent, newCases });
      targetPaths.add(f.path);
      reasons.push(
        `${f.path}: legacy+increment（存量文件内新增 ${newCases.size} 个 it 升格为 feature 责任）`,
      );
    } else {
      reasons.push(`${f.path}: legacy（基线已存在且无新增用例，责任域外）`);
    }
  }

  const exemptFiles = allUtFiles.filter(f => !targetPaths.has(f.path));
  const targetCaseView: UtFileEntryLike[] = [
    ...targetFiles,
    ...legacyIncrements.map(inc => ({ path: inc.path, content: buildIncrementViewContent(inc) })),
  ];

  return {
    mode,
    targetFiles,
    legacyIncrements,
    targetCaseView,
    explicitTargetFiles,
    explicitRequested: explicit.size,
    explicitMatched: matchedExplicit.size,
    exemptFiles,
    baseline,
    selectionReasons: reasons,
  };
}
