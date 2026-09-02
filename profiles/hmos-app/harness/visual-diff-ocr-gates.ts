// ============================================================================
// visual-diff-ocr-gates.ts — OCR 文本信号门禁（T5 越界 / T1 文本-位置背离）
// ----------------------------------------------------------------------------
// 背景：像素统计度量经真机实测分不开"忠实 vs 崩坏"；能确定性分离的是 OCR 文本信号。
// 设计：OCR 函数注入（ocrFn 默认 ocrImageWords），使门禁逻辑可不跑真 OCR 单测。
// ============================================================================

import type { UiSpecGlobalElement } from '../../../harness/scripts/utils/ui-spec-shared';
import type { VisualDiffScreenEntry } from './visual-diff-check';
import { canonicalOverlayBase } from './visual-diff-nav';
import { referenceViewportIncompatible } from './image-toolkit';
import {
  clusterOcrLines,
  fuzzyMatchRatio,
  fuzzyTextInBand,
  fuzzyTextPresent,
  ocrImageWords,
  type OcrLine,
  type OcrResult,
} from './ocr-toolkit';

export type OcrFn = (shotAbs: string) => OcrResult;

const DEFAULT_TAB_BAND_START = 0.85;

export interface OutOfBoundsViolation {
  screen_id: string;
  element_id: string;
  texts: string[];
}

export interface OutOfBoundsResult {
  violations: OutOfBoundsViolation[];
  /**
   * 声明了 global_elements 须检测、但 OCR 不可用/失败的非属主屏 screen_id（去重）。
   * 这些屏"无法确认是否越界"——调用方须降 WARN 复核，**不得静默放过**（OCR 不可用 ≠ 没泄漏）。
   */
  ocrUnavailable: string[];
}

/**
 * T5：声明式全局元素越界——某全局元素（如底部 Tab，texts=['首页','我的']）出现在**非所属屏**的
 * 指定 band（默认底部 0.85–1）内 = 越界。判据＝声明归属（SSOT）+ OCR 文本命中，不靠 root 类型猜。
 *
 * 仅对有截图的非属主屏检测；texts 须**全部**命中于 band 才算该元素出现（避免正文偶含"我的"单字误报）。
 * OCR 不可用/失败的屏不会判越界（不误报），但会进 `ocrUnavailable` 让调用方降 WARN（不静默 SKIP，对齐设计意图）。
 */
export function collectOutOfBoundsGlobalElements(
  globalElements: UiSpecGlobalElement[] | undefined,
  screens: VisualDiffScreenEntry[],
  resolveShotAbs: (rel: string) => string,
  ocrFn: OcrFn = ocrImageWords,
): OutOfBoundsResult {
  if (!Array.isArray(globalElements) || globalElements.length === 0) {
    return { violations: [], ocrUnavailable: [] };
  }
  const violations: OutOfBoundsViolation[] = [];
  const ocrUnavailable = new Set<string>();
  // 缓存每屏 OCR（一屏可能被多个全局元素检测，避免重复 OCR）
  const ocrCache = new Map<string, OcrResult>();

  for (const ge of globalElements) {
    if (!ge || !Array.isArray(ge.texts) || ge.texts.length === 0) continue;
    const ownerSet = new Set(ge.owner_screen_ids ?? []);
    const bandStart = ge.band?.start ?? DEFAULT_TAB_BAND_START;
    const bandEnd = ge.band?.end ?? 1;

    for (const s of screens) {
      if (ownerSet.has(s.screen_id)) continue; // 属主屏，合法
      const shot = s.screenshot_path;
      if (typeof shot !== 'string' || !shot.trim()) continue;
      let res = ocrCache.get(s.screen_id);
      if (!res) {
        res = ocrFn(resolveShotAbs(shot));
        ocrCache.set(s.screen_id, res);
      }
      if (!res.ok || !Array.isArray(res.words)) {
        ocrUnavailable.add(s.screen_id); // OCR 不可用/失败 → 须降级复核，不静默
        continue;
      }
      const allInBand = ge.texts.every(t => fuzzyTextInBand(res!.words!, t, bandStart, bandEnd));
      if (allInBand) {
        violations.push({ screen_id: s.screen_id, element_id: ge.id, texts: ge.texts });
      }
    }
  }
  return { violations, ocrUnavailable: [...ocrUnavailable] };
}

// ---- T1（窄）：声明的关键锚点文本整块缺失 = missing-render ----
// 经两次真机实测：像素统计 与 OCR 文本-位置 都分不开"忠实 vs 崩坏"（device≠mockup 使忠实屏位置也大偏移）。
// 唯一对 device≠mockup 鲁棒的 OCR 信号是**文本存在性**。故 T1 只保留高置信窄门禁：屏声明的关键锚点文本
// **整块缺失**（OCR 全文都找不到）= 该区域没渲染出文字。**只在缺失比例高（gross）时触发**，吸收 OCR 掉字噪声、不误伤。

export interface GrossMissingViolation {
  screen_id: string;
  declared: number;
  missing: string[];
}
export interface GrossMissingResult {
  violations: GrossMissingViolation[];
  ocrUnavailable: string[];
}

/** 锚点文本最短长度（单字易与正文/OCR 噪声混淆，只取 ≥2 字的稳定锚点） */
const MIN_ANCHOR_LEN = 2;
/** 触发 gross-missing 的最少声明锚点数（太少不足以判"整块缺失" vs OCR 偶失） */
const MIN_ANCHORS_FOR_GATE = 3;
/** 缺失比例阈值——只在过半锚点缺失（整区域没渲染文字）才判，吸收 OCR 掉字 FP */
const DEFAULT_MISSING_FRACTION = 0.5;

/**
 * T1（窄）：声明锚点文本整块缺失。screenAnchors：screen_id → 该屏 ui-spec 声明的关键文本（调用方从 text 节点收集）。
 * 仅当该屏声明锚点 ≥MIN_ANCHORS_FOR_GATE 且缺失比例 ≥missingFraction 才判 violation（gross missing-render）。
 * OCR 不可用/失败 → 不误判、进 ocrUnavailable 降级。
 */
// ============================================================================
// P1-C（plan f2d8c4a6）：文本块二部匹配观测——参考图与设备截图各 OCR 行聚类后按 spec 文本配对，
// 产 per-element 可执行 must_fix 喂回 loop（Design2Code Text/Block-Match 思路的鲁棒子集）。
// ----------------------------------------------------------------------------
// 度量选型（承接本文件 T1 的硬教训）：绝对位置/中心偏移已被两次真机实测证伪
// （device≠mockup 使忠实屏位置也大偏移）——故**不做**绝对偏移（plan P1-C 原文含"中心偏移"，
// 实现取鲁棒子集并在 plan §八 记录偏离）。本观测只用对整体缩放/平移不变的信号：
//   1) 存在性（唯一实测鲁棒的 OCR 信号）→ per-element must_fix（advisory）；
//   2) 同行分组（图内相对关系）：参考图同一行的文本对在截图中分居两行 = 副标题右置被排成题下
//      （round6 卡包/添加卡片副标题的确定性信号）→ FAIL 级；
//   3) 纵向顺序（缩放不变量）：匹配文本对在参考图与截图中的 y 序颠倒 ≥2 对 = 布局乱序
//      （round6"卡包文字排到页首"式崩坏）→ FAIL 级。
// FAIL 级信号是确定性证据，VL verdict=pass 不可推翻（a3f1c920"独立背靠可否决 VL"原则）。
// ============================================================================

/** 同行判定：两行中心 y 距 < 行高均值 × 此系数（吸收聚类边界抖动） */
const SAME_LINE_CY_FACTOR = 0.8;
/** 截图侧"明确分行"判定：中心 y 距 > 行高均值 × 此系数（介于两者之间不判，防误报） */
const SPLIT_LINE_CY_FACTOR = 1.5;
/** 参考图侧"明确不同行"（顺序比较的分母对）：y 距 > 行高均值 × 此系数 */
const ORDER_GAP_FACTOR = 1.5;
/** 触发乱序 FAIL 的最少逆序对数（1 对留作 advisory，吸收 OCR 行聚类偶发） */
const ORDER_INVERSION_FAIL_MIN = 2;
/**
 * 文本→行匹配的模糊命中率下限。取 0.75 而非 toolkit 缺省 0.6：实测同后缀兄弟文本会交叉误命中
 * （「暂无非本机卡片」的字符按序出现在「管理非本机卡片」行中，5/7≈0.71——0.6 阈值下缺失文本被判存在=漏报）；
 * 0.75 仍容忍 OCR 掉 1-2 字（"添加卡片"→"添卡片" 3/4=0.75）。
 */
const PLACEMENT_MATCH_MIN_RATIO = 0.75;

export interface TextPlacementScreenSignals {
  screen_id: string;
  /** 确定性结构违规（同行拆分/纵向乱序）——pixel_1to1 P0 FAIL 级，不可被 VL pass 推翻 */
  fail_signals: string[];
  /** per-element 可执行回修信号（存在性缺失/单对逆序 advisory）——喂 loop 的 must_fix */
  must_fix: string[];
  /**
   * adjudicated-repair-loop M2（plan e2b7c4a9 t2.1）：该屏的**不确定信号**（producer 归
   * uncertain——两源冲突/口径缺口，**不自动裁定谁对**）。上传给检查器后走
   * uncertain_signals[] 载体（checks[].structured → script-report.json → runner 停等）。
   */
  uncertain?: string[];
}

export interface TextPlacementResult {
  perScreen: TextPlacementScreenSignals[];
  /** 截图 OCR 不可用/失败的屏（降级复核，不静默） */
  ocrUnavailable: string[];
  /** 参考原图缺失/OCR 失败的屏（无 ground truth，可比性缺失） */
  refUnavailable: string[];
  /**
   * adjudicated-repair-loop M2：producer 归类的 uncertain 信号（逐条 target + 原因）。
   * 消费方（visual-diff-check）将其物化为 `VisualDiffStructuredPayload.uncertain_signals[]`
   * 随 script-report.json 落盘——不回写 visual-diff.json。
   */
  uncertainSignals: Array<{ screen_id: string; target: string; reason: string }>;
}

/**
 * adjudicated-repair-loop M2（plan e2b7c4a9 t2.1）：OCR 混淆判定——两串规整后
 * 编辑距离 ≤1（如「中信银行」vs「中国银行」）。**冲突只证明两源不一致，不证明哪一源错**
 * ——归 uncertain 交由上层按义务强度投影：required 失败回修，optional 保留 advisory；不由人签改写。
 */
export function levenshteinDistance(a: string, b: string): number {
  const sa = normPlacement(a);
  const sb = normPlacement(b);
  if (sa === sb) return 0;
  if (sa.length === 0) return sb.length;
  if (sb.length === 0) return sa.length;
  let prev = Array.from({ length: sb.length + 1 }, (_, j) => j);
  for (let i = 1; i <= sa.length; i++) {
    const cur = [i];
    for (let j = 1; j <= sb.length; j++) {
      const cost = sa[i - 1] === sb[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[sb.length];
}

interface MatchedText {
  text: string;
  refCy: number;
  refH: number;
  shotCy: number;
  shotH: number;
  refLineIdx: number;
  shotLineIdx: number;
}

interface LineMatch {
  idx: number;
  cy: number;
  h: number;
}

function bestLineMatch(
  lines: OcrLine[],
  text: string,
  excludeIdx?: ReadonlySet<number>,
  admissible?: (line: OcrLine) => boolean,
): LineMatch | null {
  let best = -1;
  let bestRatio = 0;
  for (let i = 0; i < lines.length; i++) {
    if (excludeIdx?.has(i)) continue;
    if (admissible && !admissible(lines[i])) continue;
    const r = fuzzyMatchRatio(lines[i].text, text);
    if (r > bestRatio) { bestRatio = r; best = i; }
  }
  if (best < 0 || bestRatio < PLACEMENT_MATCH_MIN_RATIO) return null;
  const b = lines[best].box;
  return { idx: best, cy: b[1] + b[3] / 2, h: b[3] };
}

/** 残余覆盖判据：行归属校验的"行主体是否可被 spec 世界解释"阈值 */
const RESIDUAL_COVER_RATIO = 0.5;

/**
 * 第三 FP 模式（round6 终局 run 实锤复现）：**未建模小字行**——mine 参考图横幅副文案
 * "刷卡设置存在优化空间，设置后可提升刷卡体验"含「设置」二字但整行未建模进 spec；
 * 「设置」被子串冲突消解从横幅标题行踢出后，次优落进该行 → 4-5 对假乱序。
 * 判据：行文本去掉目标命中字符后的**残余**若显著（> 目标长度）且不能被**其它 spec 文本**
 * 累计覆盖 ≥50% → 行主体是未建模文本，该行不可归此目标（弃行找次优）。
 * 不误伤：聚合行成员（残余=同行邻居 spec 文本，覆盖 100%）；「钱包」模式（残余被超串
 * spec 文本覆盖——admissible 通过后仍由同行冲突消解让位，两层正交）。
 * 前两模式回顾：碎行（超串目标 OCR 掉字致消解失灵→消解内已兜）、聚合行（长度比判据被弃用的原因）。
 */
export function lineAdmissibleForTarget(lineText: string, target: string, allTexts: string[]): boolean {
  const line = normPlacement(lineText);
  const t = normPlacement(target);
  if (!line || !t) return false;
  const hit = Math.round(fuzzyMatchRatio(line, t) * t.length);
  const residual = line.length - hit;
  if (residual <= t.length) return true; // 残余不显著：行主体就是目标（或近似）
  let covered = 0;
  for (const other of allTexts) {
    const o = normPlacement(other);
    if (!o || o === t) continue;
    if (line.includes(o)) covered += o.length;
    else {
      const r = fuzzyMatchRatio(line, o);
      if (r >= PLACEMENT_MATCH_MIN_RATIO) covered += Math.round(o.length * r);
    }
    if (covered >= residual * RESIDUAL_COVER_RATIO) return true;
  }
  return false;
}

const normPlacement = (s: string): string => s.replace(/\s+/g, '');

/**
 * 单侧（ref 或 shot）目标→行匹配 + **子串冲突消解**。
 * Checkpoint-2 实测校准（宿主 20260703T040107Z 首战 FP）：顶栏加粗大字「钱包」设备 OCR 整行漏识别，
 * 短目标「钱包」被子串匹配到「欢迎使用钱包消息中心!」行——而该行已被其**超串目标**（消息中心文本本身）
 * 认领。规则：目标 A 的规整文本是目标 B 的真子串、且两者命中同一行 → 该行归 B（更长=更特异），
 * A 排除该行重找次优；无次优 → A 该侧视为未识别（走存在性 advisory，不产假位置信号）。
 * 注意不能用"行长/目标长比"判据替代——聚合行（同行两元素并成一行）会让短成员必然超长比，
 * 误伤同行拆分检测本身（实测打红 split 用例后弃用）。
 */
function matchSideWithConflictResolution(
  lines: OcrLine[],
  texts: string[],
): Map<string, LineMatch> {
  const claims = new Map<string, LineMatch>();
  // 第三 FP 模式防线：行主体=未建模文本的行，任何目标都不可认领（残余覆盖判据，per-target 闭包）
  const admissibleFor = (t: string) => (line: OcrLine): boolean =>
    lineAdmissibleForTarget(line.text, t, texts);
  for (const t of texts) {
    const m = bestLineMatch(lines, t, undefined, admissibleFor(t));
    if (m) claims.set(t, m);
  }
  for (const t of texts) {
    let m: LineMatch | null = claims.get(t) ?? null;
    if (!m) continue;
    const tn = normPlacement(t);
    const excluded = new Set<number>();
    let conflicted = true;
    while (m && conflicted) {
      conflicted = false;
      for (const b of texts) {
        if (b === t) continue;
        const bn = normPlacement(b);
        if (bn === tn || !bn.includes(tn)) continue; // 仅"t 是 b 的真子串"构成冲突
        const mb = claims.get(b);
        if (mb && mb.idx === m.idx) {
          excluded.add(m.idx);
          m = bestLineMatch(lines, t, excluded, admissibleFor(t));
          conflicted = true;
          break;
        }
      }
    }
    if (m) claims.set(t, m);
    else claims.delete(t);
  }
  return claims;
}

function sameLine(cyA: number, cyB: number, hA: number, hB: number, factor: number): boolean {
  return Math.abs(cyA - cyB) < ((hA + hB) / 2) * factor;
}

/**
 * P1-C 主收集器。screenTexts：screen_id → 该屏 ui-spec 声明文本（text+subtitle，len≥2）。
 * resolveRefAbs：屏 → 参考原图绝对路径（authoritative_refs 解析，缺→refUnavailable）。
 */
export function collectTextPlacementSignals(
  screenTexts: Map<string, string[]>,
  screens: VisualDiffScreenEntry[],
  resolveShotAbs: (rel: string) => string,
  resolveRefAbs: (screen: VisualDiffScreenEntry) => string | null,
  ocrFn: OcrFn = ocrImageWords,
): TextPlacementResult {
  const perScreen: TextPlacementScreenSignals[] = [];
  const perScreenTargets = new Map<string, string[]>(); // screen_id → uncertain 稳定候选锚
  const ocrUnavailable = new Set<string>();
  const refUnavailable = new Set<string>();
  const refOcrCache = new Map<string, OcrResult>();

  for (const s of screens) {
    // codex 三轮 P1：overlay 屏 id（manage_non_local__overlay__0 等）须归一化回落到基屏文本——
    // 裸 id 查不到就 continue 会让半模态/overlay 的同行拆分/乱序/缺失**静默漏检**（连 degraded 都不报）。
    const textsRaw =
      screenTexts.get(s.screen_id) ??
      screenTexts.get(canonicalOverlayBase(s.screen_id)) ??
      (s.ref_id ? screenTexts.get(s.ref_id) : undefined);
    if (!textsRaw) continue;
    const texts = [...new Set(textsRaw.map(t => t.trim()).filter(t => t.replace(/\s+/g, '').length >= MIN_ANCHOR_LEN))];
    if (texts.length < 2) continue; // 相对信号至少需要两个文本
    const shot = s.screenshot_path;
    if (typeof shot !== 'string' || !shot.trim()) continue;

    const refAbs = resolveRefAbs(s);
    if (!refAbs) { refUnavailable.add(s.screen_id); continue; }
    let refRes = refOcrCache.get(refAbs);
    if (!refRes) {
      refRes = ocrFn(refAbs);
      refOcrCache.set(refAbs, refRes);
    }
    if (!refRes.ok || !Array.isArray(refRes.words)) { refUnavailable.add(s.screen_id); continue; }
    const shotRes = ocrFn(resolveShotAbs(shot));
    if (!shotRes.ok || !Array.isArray(shotRes.words)) { ocrUnavailable.add(s.screen_id); continue; }

    const refLines = clusterOcrLines(refRes.words.filter(w => w.text.replace(/\s+/g, '').length > 0));
    const shotLines = clusterOcrLines(shotRes.words.filter(w => w.text.replace(/\s+/g, '').length > 0));

    const mustFix: string[] = [];
    const failSignals: string[] = [];
    const uncertain: string[] = [];
    const uncertainTargets: string[] = []; // 每条 uncertain 的稳定候选锚（用于 defect-review 恢复绑定）
    const matched: MatchedText[] = [];
    const refClaims = matchSideWithConflictResolution(refLines, texts);
    const shotClaims = matchSideWithConflictResolution(shotLines, texts);

    // adjudicated-repair-loop M2（plan e2b7c4a9 t2.1，review 修复）：整页拼接参考图 vs
    // 单视口截图的**口径缺口**——用**归一化宽高比**判定（同宽、显著更高 = 整页；纯分辨率
    // 不同的同比例图不得误判）：refAspect > shotAspect × 1.15 时纵向顺序比较参照系不完整，
    // 自动降级 uncertain 并注明缺口（不自动判乱序）。
    const refW = typeof refRes.width === 'number' ? refRes.width : 0;
    const refH = typeof refRes.height === 'number' ? refRes.height : 0;
    const shotW = typeof shotRes.width === 'number' ? shotRes.width : 0;
    const shotH = typeof shotRes.height === 'number' ? shotRes.height : 0;
    const refAspect = refW > 0 && refH > 0 ? refH / refW : 0;
    const shotAspect = shotW > 0 && shotH > 0 ? shotH / shotW : 0;
    // plan b3d7e5a1 T5：阈值迁为共享常量（前置门已在内容比对前把不兼容屏剔除；此分支保留为防御性诊断）。
    const refIsFullPage = referenceViewportIncompatible({ w: refW, h: refH }, { w: shotW, h: shotH });

    // 集合级混淆（review 修复：60bcd1 真实机理——候选集合**同时含**近似对，如
    // 「中信银行」与「中国银行」）：候选串集合内存在编辑距离 ≤1 的近似对，且 OCR 行命中
    // 其中任一（精确或近似）→ **近似对双方原子地归 uncertain**（不自动判定 OCR 读的是
    // 哪个、也不把「未命中」当作存在性缺失——0.75 模糊匹配对两字差异不可靠）。
    // 判定在「未命中→must_fix」**之前**：未命中的候选若属混淆组且组内其它成员被识别 →
    // 必不产 must_fix（短串 dd1 也覆盖）。
    const confusionNeighbors = new Map<string, string[]>(); // t → 近似（d≤1 且 ≠t）候选列表
    for (const t of texts) {
      const neighbors = texts.filter((t2) => t2 !== t && levenshteinDistance(t2, t) <= 1);
      if (neighbors.length > 0) confusionNeighbors.set(t, neighbors);
    }
    // 截图侧实际识别到的行文本（用于直接规则：行文本 vs 候选 d≤1）
    const shotLineTexts = shotLines.map((l) => l.text);
    // 原子组判定：先收集每条候选的混淆状态，再统一决定（不得逐条边遍历边改）
    const confusedSet = new Set<string>(); // 最终 uncertain 的候选（原子：组内成员一起进）
    const confusedReasons = new Map<string, string>(); // 候选 → uncertain 文案
    // 直接规则（含未命中候选）：候选未完整出现且 OCR 行与它编辑距离 ≤1 → uncertain。
    // 精确包含优先：如「《添加银行卡」只是 OCR 把返回箭头并入标题行，候选文本本身没有冲突。
    // 未命中仍须检测：「中信」vs「中国」距离 1，不得落为存在性 must_fix。
    for (const t of texts) {
      const ref = refClaims.get(t);
      if (!ref || confusedSet.has(t)) continue; // 参考图都读不到该文本——不构成对照
      for (const shotText of shotLineTexts) {
        const shotNorm = normPlacement(shotText);
        const targetNorm = normPlacement(t);
        if (shotNorm.includes(targetNorm)) continue;
        if (levenshteinDistance(shotNorm, targetNorm) <= 1) {
          confusedSet.add(t);
          confusedReasons.set(
            t,
            `OCR 识别文本「${shotText.slice(0, 16)}」与候选串「${t.slice(0, 16)}」编辑距离 ≤1` +
              '（两源冲突，不自动裁定谁对——由上层按义务强度触发机器重采/回修）',
          );
          break;
        }
      }
    }
    // 组级规则（组原子传播）：t 未命中但其近似对 t2 在截图侧有命中（或 t2 已 confused）→
    // 整组一起 uncertain——判在 must_fix 之前，未命中成员不得落存在性 must_fix。
    for (const t of texts) {
      const ref = refClaims.get(t);
      if (!ref || confusedSet.has(t)) continue;
      const neighbors = confusionNeighbors.get(t) ?? [];
      const neighborHit = neighbors.find((t2) => shotClaims.has(t2) || confusedSet.has(t2));
      if (neighborHit) {
        confusedSet.add(t);
        confusedReasons.set(
          t,
          `候选「${t.slice(0, 16)}」与其近似「${neighborHit.slice(0, 16)}」（编辑距离 ≤1）同时在场，` +
            `截图侧识别到「${neighborHit.slice(0, 16)}」——集合级混淆，不自动裁定存在性缺失（两源冲突，需机器重采/回修）`,
        );
      }
    }
    // 组内命中侧的模糊归属：t 命中但其近似对 t2 未识别（且 t2 属会被混淆的组）——
    // OCR 可能把 t2 读成 t（读错归属）→ t 也归 uncertain（原子：组内任一成员被识别即全组存疑）。
    for (const [t, neighbors] of confusionNeighbors) {
      if (confusedSet.has(t)) continue;
      const shotsHit = neighbors.filter((t2) => shotClaims.has(t2));
      if (shotsHit.length > 0 && !confusedSet.has(t)) {
        // t 本身命中与否都存疑：行文本可能属于组内其它成员
        const t2 = shotsHit[0];
        confusedSet.add(t);
        confusedReasons.set(
          t,
          `候选「${t.slice(0, 16)}」与截图侧识别到的近似候选「${t2.slice(0, 16)}」` +
            '（编辑距离 ≤1）同组——命中归属存疑，不参与同行/纵序比较（需机器重采/回修）',
        );
      }
    }
    // 未命中且不属于任何混淆组 → 存在性 must_fix（advisory 回修指令）
    for (const t of texts) {
      const ref = refClaims.get(t);
      if (!ref) continue;
      if (confusedSet.has(t)) continue;
      if (shotClaims.has(t)) continue;
      mustFix.push(`「${t.slice(0, 16)}」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）`);
    }
    // 可靠匹配（filter 重建：非 confused 且命中的候选）→ 参与同行/纵序比较
    for (const t of texts) {
      const ref = refClaims.get(t);
      if (!ref) continue;
      if (confusedSet.has(t)) continue;
      const shotHit = shotClaims.get(t);
      if (!shotHit) continue;
      matched.push({
        text: t,
        refCy: ref.cy, refH: ref.h, refLineIdx: ref.idx,
        shotCy: shotHit.cy, shotH: shotHit.h, shotLineIdx: shotHit.idx,
      });
    }
    // 收集 uncertain 文案（顺序稳定）
    for (const t of texts) {
      const reason = confusedReasons.get(t);
      if (!reason) continue;
      uncertain.push(reason);
      uncertainTargets.push(t);
    }

    // 2) 同行分组：参考图同一行的文本对，截图中明确分居两行 → FAIL 级
    for (let i = 0; i < matched.length; i++) {
      for (let j = i + 1; j < matched.length; j++) {
        const a = matched[i];
        const b = matched[j];
        const sameRef =
          a.refLineIdx === b.refLineIdx || sameLine(a.refCy, b.refCy, a.refH, b.refH, SAME_LINE_CY_FACTOR);
        if (!sameRef) continue;
        const clearlySplitShot =
          a.shotLineIdx !== b.shotLineIdx &&
          !sameLine(a.shotCy, b.shotCy, a.shotH, b.shotH, SPLIT_LINE_CY_FACTOR);
        if (clearlySplitShot) {
          failSignals.push(
            `「${a.text.slice(0, 12)}」与「${b.text.slice(0, 12)}」参考图同一行（右置/同行关系），实测分居两行` +
            `（疑似题下堆叠）——按 spec subtitle_position/layout_group 恢复同行布局`,
          );
        }
      }
    }

    // 3) 纵向顺序（缩放不变量）：参考图中明确分行的文本对，截图中 y 序颠倒
    const inversions: string[] = [];
    for (let i = 0; i < matched.length; i++) {
      for (let j = 0; j < matched.length; j++) {
        if (i === j) continue;
        const upper = matched[i];
        const lower = matched[j];
        const clearlyOrderedRef = lower.refCy - upper.refCy > ((upper.refH + lower.refH) / 2) * ORDER_GAP_FACTOR;
        if (!clearlyOrderedRef) continue;
        const invertedShot = upper.shotCy - lower.shotCy > ((upper.shotH + lower.shotH) / 2) * 0.5;
        if (invertedShot) {
          inversions.push(`「${upper.text.slice(0, 12)}」应在「${lower.text.slice(0, 12)}」上方（参考图），实测顺序颠倒`);
        }
      }
    }
    // M2：整页参考图 vs 单视口 → 纵向顺序比较口径缺口，自动降级 uncertain（注明缺口）。
    if (refIsFullPage && inversions.length > 0) {
      uncertain.push(
        `整页参考图（${refW}×${refH}）高于单视口截图（${shotW}×${shotH}，宽高比 ${(shotAspect * 100).toFixed(0)}% 于参考图）——` +
          `纵向顺序比较口径缺口，以下 ${inversions.length} 对疑似乱序降级为 uncertain，需机器重采/回修：${inversions.slice(0, 3).join('；')}`,
      );
      uncertainTargets.push('whole-page');
    } else if (inversions.length >= ORDER_INVERSION_FAIL_MIN) {
      failSignals.push(`纵向乱序 ${inversions.length} 对（布局结构性错位）：${inversions.slice(0, 4).join('；')}`);
    } else if (inversions.length === 1) {
      mustFix.push(`${inversions[0]}（单对逆序，advisory——OCR 行聚类偶发的缓冲档）`);
    }

    if (mustFix.length > 0 || failSignals.length > 0 || uncertain.length > 0) {
      perScreen.push({
        screen_id: s.screen_id,
        fail_signals: failSignals,
        must_fix: mustFix,
        ...(uncertain.length > 0 ? { uncertain } : {}),
      });
      perScreenTargets.set(s.screen_id, uncertainTargets);
    }
  }
  return {
    perScreen,
    ocrUnavailable: [...ocrUnavailable],
    refUnavailable: [...refUnavailable],
    // uncertainSignals 的 target = 稳定候选锚（回修与机器重验可精确引用）：
    // 混淆场景=候选文本 t；整页缺口='whole-page'（屏级缺口）。
    uncertainSignals: perScreen.flatMap((p) => {
      const targets = perScreenTargets.get(p.screen_id) ?? [];
      return (p.uncertain ?? []).map((reason, i) => ({
        screen_id: p.screen_id,
        target: targets[i] ?? reason.slice(0, 32),
        reason,
      }));
    }),
  };
}

// ============================================================================
// P0-2（round6 收尾批）：确定性 FAIL 弃判检测——终局 run 实锤：agent 以"headless 无法闭环"为由
// 把 fail_signals 在手的屏也留 pending（must_fix=0），白烧 3 次 testing 重试。确定性 FAIL 在手
// 就不许 pending：不以 must_fix 有无为附加条件（codex 意见：否则塞几条 must_fix 仍 pending 即绕过）。
// ============================================================================

export interface VerdictAbandonment {
  screen_id: string;
  /** 合并 fail_signals 与该屏既有 must_fix，直接作为回修指令输出 */
  lines: string[];
}

export function collectVerdictAbandonment(
  perScreen: TextPlacementScreenSignals[],
  screens: VisualDiffScreenEntry[],
): VerdictAbandonment[] {
  const byId = new Map(screens.map(s => [s.screen_id, s]));
  const out: VerdictAbandonment[] = [];
  for (const p of perScreen) {
    if (p.fail_signals.length === 0) continue;
    const s = byId.get(p.screen_id);
    if (!s || s.verdict !== 'pending') continue;
    const mustFix = (s.must_fix ?? []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    out.push({ screen_id: p.screen_id, lines: [...p.fail_signals, ...mustFix] });
  }
  return out;
}

export function collectGrossMissingAnchorText(
  screenAnchors: Map<string, string[]>,
  screens: VisualDiffScreenEntry[],
  resolveShotAbs: (rel: string) => string,
  ocrFn: OcrFn = ocrImageWords,
  missingFraction: number = DEFAULT_MISSING_FRACTION,
): GrossMissingResult {
  const violations: GrossMissingViolation[] = [];
  const ocrUnavailable = new Set<string>();
  for (const s of screens) {
    // codex 四轮 P1：overlay 屏 id 归一化回落基屏 anchors（与 collectTextPlacementSignals 对称）——
    // 否则半模态屏的整块文本缺失静默跳过。
    const anchorsRaw = screenAnchors.get(s.screen_id) ?? screenAnchors.get(canonicalOverlayBase(s.screen_id));
    if (!anchorsRaw) continue;
    const anchors = [...new Set(anchorsRaw.map(a => a.trim()).filter(a => a.length >= MIN_ANCHOR_LEN))];
    if (anchors.length < MIN_ANCHORS_FOR_GATE) continue; // 锚点太少，不足以判整块缺失
    const shot = s.screenshot_path;
    if (typeof shot !== 'string' || !shot.trim()) continue;
    const res = ocrFn(resolveShotAbs(shot));
    if (!res.ok || !Array.isArray(res.words)) { ocrUnavailable.add(s.screen_id); continue; }
    const missing = anchors.filter(a => !fuzzyTextPresent(res.words!, a));
    if (missing.length / anchors.length >= missingFraction) {
      violations.push({ screen_id: s.screen_id, declared: anchors.length, missing });
    }
  }
  return { violations, ocrUnavailable: [...ocrUnavailable] };
}
