// ============================================================================
// capture-completeness-check.ts — P0-2 捕获完整性（分母=ref-elements.yaml）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact, featureArtifactPath } from '../../../harness/config';
import {
  fidelityRatchetFailOrWarn,
  isPixel1to1,
  refElementsAbsPath,
  resolveRefElementsDenominator,
  type RefElementEntry,
} from '../../../harness/scripts/utils/fidelity-shared';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { stringify: (v: unknown) => string };
import {
  collectAllComponentNodes,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  UI_CHANGE_REQUIRES_UI_SPEC,
  uiSpecAbsPath,
  uiSpecRelPath,
  walkComponentNodes,
  type UiSpecComponentNode,
  type UiSpecDoc,
  type UiSpecScreen,
} from '../../../harness/scripts/utils/ui-spec-shared';
import {
  clusterOcrLines,
  collectAuditableOcrLines as collectAuditableOcrLinesShared,
  extractLikelyRealTextRun,
  fuzzyMatchRatio,
  isOcrAvailable,
  norm,
  ocrImageWords,
  type OcrLine,
} from './ocr-toolkit';
import {
  buildAuthoritativeRefImageIndex,
  resolveRefSourceImage,
} from './authoritative-ref-images';

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.capture_completeness?.description?.trim() ?? 'capture_completeness';
}

function uiSpecCoversElement(
  elementId: string,
  nodeIds: Set<string>,
  mustHave: Set<string>,
): boolean {
  if (nodeIds.has(elementId) || mustHave.has(elementId)) return true;
  const lower = elementId.toLowerCase();
  for (const id of nodeIds) {
    if (id.toLowerCase() === lower) return true;
  }
  for (const id of mustHave) {
    if (id.toLowerCase() === lower) return true;
  }
  return false;
}

function denominatorElements(refElements: RefElementEntry[]): RefElementEntry[] {
  return refElements.filter(e => e.disposition !== 'defer');
}

export function checkCaptureCompleteness(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const uiChange = parseUiChangeFromSpecMarkdown(specMarkdown);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }

  const refRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'ref-elements.yaml');
  const refAbs = refElementsAbsPath(ctx.projectRoot, ctx.feature);
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);
  const desc = ruleDesc(ctx);

  const denomResolved = resolveRefElementsDenominator(ctx, ctx.projectRoot, ctx.feature);
  const hasMemoryManifest = denomResolved.source === 'memory_manifest';

  if (!hasMemoryManifest) {
    if (ctx.fidelityTarget !== 'pixel_1to1') {
      if (!fs.existsSync(refAbs)) {
        return [{
          id: 'capture_completeness',
          category: 'structure',
          description: desc,
          severity: 'MINOR',
          status: 'SKIP',
          details: 'semantic_layout 下 ref-elements.yaml 可选；pixel_1to1 下必填',
          affected_files: [refRel, uiSpecRel],
        }];
      }
    } else if (!fs.existsSync(refAbs)) {
      const { severity, status } = fidelityRatchetFailOrWarn(ctx, false);
      return [{
        id: 'capture_completeness',
        category: 'structure',
        description: desc,
        severity,
        status,
        details: `pixel_1to1 须产出参考图侧独立枚举 ${refRel}（分母不得取自 ui-spec 自身）`,
        suggestion: 'spec 分区扫描模板逐元素 implement|defer，落 spec/ref-elements.yaml；或 lock.structured_bundle 经 structured_ref_elements 注入内存 manifest',
        affected_files: [refRel, uiSpecRel],
      }];
    }
  }

  const refElements = denomResolved.elements;
  if (!refElements) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, ctx.fidelityTarget !== 'pixel_1to1');
    return [{
      id: 'capture_completeness',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: hasMemoryManifest
        ? '内存 manifest 为空'
        : `${refRel} 存在但 YAML 解析失败或缺少 elements[]`,
      affected_files: [refRel],
    }];
  }

  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!uiDoc) {
    return [];
  }

  const nodes = collectAllComponentNodes(uiDoc);
  const nodeIds = new Set(nodes.map(n => n.id).filter((id): id is string => Boolean(id)));
  const mustHave = new Set(
    (uiDoc.screens ?? []).flatMap(s => s.must_have_elements ?? []),
  );

  const denom = denominatorElements(refElements);
  if (denom.length === 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    return [{
      id: 'capture_completeness',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: hasMemoryManifest
        ? '内存 manifest elements 为空；参考图侧枚举不得为空'
        : `${refRel} elements 为空；参考图侧枚举不得为空`,
      affected_files: [refRel],
    }];
  }

  const missing: string[] = [];
  for (const el of denom) {
    if (el.disposition === 'defer') continue;
    if (!uiSpecCoversElement(el.element_id, nodeIds, mustHave)) {
      missing.push(el.element_id);
    }
  }

  const covered = denom.length - missing.length;
  const ratio = covered / denom.length;
  const ratioPct = (ratio * 100).toFixed(0);
  const sourceNote = hasMemoryManifest
    ? `分母=内存 manifest（${denomResolved.detail ?? 'structured 派生'}）`
    : `分母=${refRel}`;

  if (missing.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, ratio >= 0.85);
    return [{
      id: 'capture_completeness',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        sourceNote,
        `参考图枚举覆盖 ${covered}/${denom.length}（${ratioPct}%）`,
        `ui-spec/must_have 未覆盖：${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}`,
        '【边界】依赖 VL 视觉枚举，非 100% 上限；被动漏看由 testing 双向 diff 兜底。',
      ].join('\n'),
      affected_files: [refRel, uiSpecRel],
    }];
  }

  return [{
    id: 'capture_completeness',
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'PASS',
    details: `${sourceNote}；参考图枚举 ${denom.length} 项均已映射到 ui-spec/must_have（${ratioPct}%）`,
    affected_files: [refRel, uiSpecRel],
  }];
}

function collectButtonsInNode(node: UiSpecComponentNode | undefined, out: UiSpecComponentNode[]): void {
  if (!node) return;
  if (node.type === 'action_button') out.push(node);
  for (const c of node.children ?? []) collectButtonsInNode(c, out);
}

/**
 * G3 Slice 2 捕获强制：pixel_1to1 下 P0 屏的 action_button 必须声明 variant（捕获保真）。
 * homepage 失败案例：按钮仅标 semantic_role: brand_primary（隐含实心），未捕获其实是浅灰药丸/幽灵，
 * coding 据此填了满屏实心蓝。强制捕获 variant，逼 VL 对照参考图看清按钮填充形态。
 * 布局关系（同行/对齐/占宽）由提示词驱动捕获 + coding parity 校验，不在此处硬造（哪些按钮该同行本身需布局信息）。
 */
export function checkCaptureStyleFields(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const uiChange = parseUiChangeFromSpecMarkdown(specMarkdown);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) return [];
  if (ctx.fidelityTarget !== 'pixel_1to1') return []; // 仅 1:1 下强制；semantic_layout 零噪声
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!uiDoc) return [];

  const checks = ctx.phaseRule.structure_checks as Record<string, { description?: string }>;
  const desc = checks?.capture_style_fields?.description?.trim() ?? 'capture_style_fields';
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);

  const missingVariant: string[] = [];
  for (const screen of uiDoc.screens ?? []) {
    if (screen.priority !== 'P0') continue;
    const buttons: UiSpecComponentNode[] = [];
    collectButtonsInNode(screen.root, buttons);
    for (const b of buttons) {
      if (!b.variant) missingVariant.push(`${screen.id}:${b.id ?? b.text ?? '?'}`);
    }
  }

  if (missingVariant.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, false);
    return [{
      id: 'capture_style_fields',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        `pixel_1to1 下 P0 action_button 须声明 variant（治"实心蓝 vs 浅灰药丸/幽灵按钮"）；` +
        `未声明：${missingVariant.slice(0, 12).join(', ')}${missingVariant.length > 12 ? '…' : ''}`,
      suggestion: '逐按钮对照参考图标 variant: filled/tonal/outlined/ghost/text。',
      affected_files: [uiSpecRel],
    }];
  }

  return [{
    id: 'capture_style_fields',
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'PASS',
    details: 'P0 action_button 的 variant 均已声明（按钮变体捕获保真）。',
    affected_files: [uiSpecRel],
  }];
}

// ============================================================================
// P0-D（plan f2d8c4a6）：spec 完整性**外部对照** —— 分母来自原图 OCR 全文清单，
// 替换"62/62 自我循环"（分母是 agent 自己抽的清单，漏抽=覆盖率虚高）。
// round6 实证：右置副标题×5、"智闪刷卡设置待优化"、¥119.40 连续两轮漏抽而 capture 100% PASS。
// ============================================================================

/** 行被 spec 文本集覆盖的累计字符覆盖率阈值 */
export const EXTERNAL_AUDIT_LINE_COVER_RATIO = 0.5;
// E6②同源化：norm/CJK_RE/EXTERNAL_AUDIT_STATUS_BAR_BAND/collectAuditableOcrLines 已移至
// ocr-toolkit.ts 统一导出——goal-runner 的 OCR 预扫描（agent 上下文）与本门禁现在跑同一份
// 清洗/聚类逻辑。此处保留 collectAuditableOcrLines 的同名再导出，兼容既有调用点。
export const collectAuditableOcrLines = collectAuditableOcrLinesShared;

/** spec 文本集：ui-spec 全 text/subtitle/badge + global_elements texts + ref-elements texts */
export function collectSpecTextUniverse(
  uiDoc: UiSpecDoc,
  refElements: RefElementEntry[] | null,
): string[] {
  const out = new Set<string>();
  for (const n of collectAllComponentNodes(uiDoc)) {
    if (typeof n.text === 'string' && norm(n.text)) out.add(n.text);
    const sub = (n as { subtitle?: string }).subtitle;
    if (typeof sub === 'string' && norm(sub)) out.add(sub);
    if (typeof n.badge === 'string' && norm(n.badge)) out.add(n.badge);
  }
  for (const g of uiDoc.global_elements ?? []) {
    for (const t of g.texts ?? []) if (norm(t)) out.add(t);
  }
  for (const e of refElements ?? []) {
    if (typeof e.text === 'string' && norm(e.text)) out.add(e.text);
  }
  return [...out];
}

/**
 * t6④（plan c6d8f2b4）：单屏本地文本分母——overlay 屏专用。特意**不含** global_elements
 * 与其它屏文本，堵"银行行挂靠主屏分母、overlay 屏整个漏建模"的洞（bc-openCard 实证：
 * card_type_sheet 参考图含银行行，must_have_elements 五项无一银行元素，feature 级分母照过）。
 */
export function collectScreenLocalTexts(
  screen: UiSpecScreen,
  refElements: RefElementEntry[] | null,
): string[] {
  const out = new Set<string>();
  const walk = (n: UiSpecComponentNode): void => {
    if (typeof n.text === 'string' && norm(n.text)) out.add(n.text);
    const sub = (n as { subtitle?: string }).subtitle;
    if (typeof sub === 'string' && norm(sub)) out.add(sub);
    if (typeof n.badge === 'string' && norm(n.badge)) out.add(n.badge);
    for (const c of n.children ?? []) walk(c);
  };
  if (screen.root) walk(screen.root);
  const screenRef = screen.ref_id ?? screen.id;
  for (const e of refElements ?? []) {
    if (e.screen_ref_id === screenRef || e.screen_ref_id === screen.id) {
      if (typeof e.text === 'string' && norm(e.text)) out.add(e.text);
    }
  }
  return [...out];
}

/**
 * 行是否被 spec 文本集覆盖：累计字符覆盖法——OCR 行常把同 y 带多个元素聚成一行
 * （如"集中管理您的卡证票券钥匙"+"添加管理卡片"），单文本最大比率会漏；
 * 改为逐 spec 文本按序命中计覆盖字符数，累计 ≥ 行长 50% 即覆盖。
 */
export function isLineCoveredBySpecTexts(lineText: string, specTexts: string[]): boolean {
  const t = norm(lineText);
  if (!t) return true;
  let covered = 0;
  for (const s of specTexts) {
    const st = norm(s);
    if (!st) continue;
    if (t.includes(st)) covered += st.length;
    else {
      const r = fuzzyMatchRatio(t, st);
      if (r >= 0.6) covered += Math.round(st.length * r);
    }
    if (covered >= t.length * EXTERNAL_AUDIT_LINE_COVER_RATIO) return true;
  }
  // 短行（≤4 字）：也允许"行 ⊆ 某 spec 文本"（OCR 把长句拆行）
  if (t.length <= 4) {
    for (const s of specTexts) {
      if (norm(s).includes(t)) return true;
    }
  }
  return false;
}

/** E3②：blind-review-pending.yaml 单条记录——盲档下无法辨认的 OCR 未覆盖行，交由人一次终审。 */
export interface BlindReviewPendingEntry {
  screen: string;
  text: string;
  /** 归一化 y 坐标（行中心） */
  y: number;
  /** OCR 置信度 0-100（多词取平均） */
  confidence: number;
  auto_disposition: 'unverifiable_blind';
  /**
   * E6③（案B chrys 实证"人《AA招商银行"类噪声前缀+真文本混合行）：从 text 提取的最长连续
   * CJK 游程候选——**建议**而非确定正确，加速人工终审（一眼看出"招商银行"而非阅读整段乱码）。
   * 无法提取候选（纯噪声/非 CJK）时省略此字段。
   */
  candidate_text?: string;
}

export interface BlindReviewPendingDoc {
  schema_version: string;
  feature: string;
  generated_at: string;
  note: string;
  entries: BlindReviewPendingEntry[];
}

export function blindReviewPendingAbsPath(projectRoot: string, feature: string): string {
  return featureArtifactPath(projectRoot, feature, 'spec/reports/blind-review-pending.yaml');
}

/**
 * E3②（案B chrys 银行卡实证：OCR 噪声"人《AA招商银行"——logo 被 OCR 成乱码前缀，盲 agent
 * 无法辨认哪段是噪声哪段是真文本，逐条 implement/defer+人签 对它是无解题）。改为自动批量
 * 登记结构化待复核清单，check 本身降 MAJOR/WARN，收口交由人一次终审（非逐条求盲 agent judge）。
 */
export function writeBlindReviewPending(
  projectRoot: string,
  feature: string,
  entries: BlindReviewPendingEntry[],
): string {
  const abs = blindReviewPendingAbsPath(projectRoot, feature);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const doc: BlindReviewPendingDoc = {
    schema_version: '1.0',
    feature,
    generated_at: new Date().toISOString(),
    note:
      '盲档（无视觉能力）下自动登记的原图 OCR 未覆盖文本清单——agent 无法辨认其中哪些是' +
      '噪声（如 logo 被 OCR 误识别的乱码前缀）哪些是需要建模的真文案，须真人逐条终审后' +
      '手动处置（implement 建模 或 defer 签字），而非要求盲 agent 逐条判断。',
    entries,
  };
  fs.writeFileSync(abs, YAML.stringify(doc), 'utf-8');
  return abs;
}

/**
 * P0-D 主检查（新 check：capture_completeness_external）。
 * 诚实边界：本门禁只回答"原图上的文本是否都被 spec 收进分母"，不回答"收进去的建模对不对"
 * （位置/分组正确性归 ui_spec_bbox_semantic / structure lint / review 视觉维度 / device 回环）。
 */
export function checkCaptureExternalAudit(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const uiChange = parseUiChangeFromSpecMarkdown(specMarkdown);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) return [];
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!uiDoc) return [];
  const checks = ctx.phaseRule.structure_checks as Record<string, { description?: string }>;
  const desc = checks?.capture_completeness_external?.description?.trim() ?? 'capture_completeness_external';
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);
  const refRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'ref-elements.yaml');
  const pixel = isPixel1to1(ctx);

  if (!isOcrAvailable()) {
    return [{
      id: 'capture_completeness_external_ocr_unavailable',
      category: 'structure',
      description: desc,
      severity: pixel ? 'BLOCKER' : 'MAJOR',
      status: pixel ? 'FAIL' : 'WARN',
      details:
        '【P0-D OCR 承重不可用】tesseract.js 未装或 chi_sim 未物化——外部完整性分母无法建立，' +
        'pixel_1to1 下不得以自我清单分母放行（RC4 自循环即由此而来）。',
      suggestion: '修复 OCR 环境后重跑（此 id 归 toolchain，signature 重复即 halt 求人）。',
      affected_files: [uiSpecRel],
    }];
  }

  const refIndex = buildAuthoritativeRefImageIndex(ctx, specMarkdown);
  const denomResolved = resolveRefElementsDenominator(ctx, ctx.projectRoot, ctx.feature);
  const specTexts = collectSpecTextUniverse(uiDoc, denomResolved.elements);

  const uncovered: string[] = [];
  // t6④：overlay P0 屏"本屏未建模但被 feature 分母覆盖"的行（ratchet=sheet 区域内可框定；advisory=区域不可定）
  const overlayLocalRatchet: string[] = [];
  const overlayLocalAdvisory: string[] = [];
  // E3②（多模态降级阶梯 plan d4a8f3c6）：盲档下 uncovered 改批量登记 blind-review-pending.yaml，
  // 需要结构化字段（非仅展示用字符串）——screen/text/y/confidence。
  const uncoveredEntries: BlindReviewPendingEntry[] = [];
  const ghostTexts: string[] = [];
  let totalLines = 0;
  let coveredLines = 0;
  const ocrErrors: string[] = [];
  let screensAudited = 0;

  const p0Unaudited: string[] = [];
  for (const s of uiDoc.screens ?? []) {
    const refId = s.ref_id ?? s.id;
    const srcPick = resolveRefSourceImage(refIndex, refId);
    if (!srcPick.path) {
      ocrErrors.push(`${s.id}: 无参考原图（${srcPick.note ?? 'authoritative_ref 缺失'}）`);
      if (s.priority === 'P0') p0Unaudited.push(s.id);
      continue;
    }
    const ocr = ocrImageWords(srcPick.path);
    if (!ocr.ok || !ocr.words) {
      ocrErrors.push(`${s.id}: OCR 失败（${ocr.error ?? 'unknown'}）`);
      if (s.priority === 'P0') p0Unaudited.push(s.id);
      continue;
    }
    screensAudited++;
    const lines = collectAuditableOcrLines(
      clusterOcrLines(ocr.words.filter(w => norm(w.text).length > 0)),
    );
    // t6④：overlay P0 屏本地分母——被 feature 级分母覆盖但**本屏自身未建模**的行。
    // 参考图会透出被压暗的基屏背景文本（合法归属基屏），FP 风险真实存在：
    // overlay root 有 bbox 时以 bbox 框定 sheet 区域内的行 → ratchet；无 bbox → 仅 advisory 复核清单
    //（校准铁律：拦不下的子信号降 advisory，不硬上 gate）。
    const isOverlayP0 = pixel && s.priority === 'P0' && s.root?.type === 'overlay_panel';
    const localTexts = isOverlayP0 ? collectScreenLocalTexts(s, denomResolved.elements) : null;
    const overlayRootBBox =
      isOverlayP0 && Array.isArray(s.root?.bbox) && s.root!.bbox!.length === 4 ? s.root!.bbox! : null;
    for (const line of lines) {
      totalLines++;
      if (isLineCoveredBySpecTexts(line.text, specTexts)) {
        coveredLines++;
        if (localTexts && !isLineCoveredBySpecTexts(line.text, localTexts)) {
          const yCenter = line.box[1] + line.box[3] / 2;
          const inSheet =
            overlayRootBBox !== null &&
            yCenter >= overlayRootBBox[1] &&
            yCenter <= overlayRootBBox[1] + overlayRootBBox[3];
          const entry = `${s.id}: "${line.text.slice(0, 24)}" @y≈${yCenter.toFixed(2)}（由其它屏声明覆盖，本屏未建模）`;
          if (inSheet) overlayLocalRatchet.push(entry);
          else overlayLocalAdvisory.push(entry);
        }
      } else {
        const yCenter = line.box[1] + line.box[3] / 2;
        uncovered.push(`${s.id}: "${line.text.slice(0, 24)}" @y≈${yCenter.toFixed(2)}`);
        const confs = line.words.map(w => w.conf).filter(c => typeof c === 'number');
        const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
        const likelyReal = extractLikelyRealTextRun(line.text);
        uncoveredEntries.push({
          screen: s.id,
          text: line.text,
          y: Number(yCenter.toFixed(4)),
          confidence: Math.round(avgConf),
          auto_disposition: 'unverifiable_blind',
          ...(likelyReal ? { candidate_text: likelyReal.candidate } : {}),
        });
      }
    }
    // 反向 diff（幻觉文本，低置信注记）：该屏 spec 文本在 OCR 全文中几乎无踪影
    const screenNodes: UiSpecComponentNode[] = [];
    if (s.root) walkComponentNodes(s.root, screenNodes);
    const hay = lines.map(l => l.text).join('');
    for (const n of screenNodes) {
      const t = typeof n.text === 'string' ? n.text : '';
      if (norm(t).length >= 4 && fuzzyMatchRatio(hay, t) < 0.3) {
        ghostTexts.push(`${s.id}/${n.id ?? '?'}: "${t.slice(0, 16)}"`);
      }
    }
  }

  if (screensAudited === 0) {
    return [{
      id: 'capture_completeness_external_ocr_unavailable',
      category: 'structure',
      description: desc,
      severity: pixel ? 'BLOCKER' : 'MAJOR',
      status: pixel ? 'FAIL' : 'WARN',
      details: `【P0-D 外部分母无法建立】全部屏 OCR/原图解析失败：${ocrErrors.join('；') || '无可达参考原图'}`,
      suggestion: '核对 visual_handoff.authoritative_refs 可达性与 OCR 环境后重跑（toolchain 归因）。',
      affected_files: [uiSpecRel],
    }];
  }

  // codex 二轮采纳：P0 屏部分未审计 ≠ 可放行——该屏外部分母完全没建立，pixel_1to1 不得 PASS
  //（"一屏成一屏败仍阻断"）；P1+ 屏未审计降为注记（plan 覆盖定义：P0 全覆盖、P1 可宽）。
  if (pixel && p0Unaudited.length > 0) {
    return [{
      id: 'capture_completeness_external_ocr_unavailable',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `【P0-D P0 屏外部分母缺失】${p0Unaudited.length} 个 P0 屏无法建立 OCR 外部分母（${p0Unaudited.join(', ')}）——` +
        `其余 ${screensAudited} 屏审计通过不豁免：未审计屏上的漏抽完全不可见。明细：${ocrErrors.join('；')}`,
      suggestion: '核对该屏 authoritative_ref 原图可达性/图像可读性后重跑；P0 屏缺参考原图本身即 spec 输入缺陷。',
      affected_files: [uiSpecRel],
    }];
  }

  const coveragePct = totalLines > 0 ? ((coveredLines / totalLines) * 100).toFixed(0) : '100';
  const boundaryNote =
    '【诚实边界】本门禁只保证"原图文本都进了 spec 分母"（真分母=OCR 全文），不保证建模位置/分组正确' +
    '（归 structure lint / review 视觉维度 / device 回环）；单字符角标/纯符号行已剔除（误报面>收益，known-miss）。';

  if (uncovered.length > 0) {
    // E3②：盲档（adapterImageInput=none，与 pixel/semantic/reference_only 具体档位无关——
    // 是"看不看得见图"而非"追不追求像素级"）下，逐条 implement/defer+人签是对盲 agent 的
    // 无解题（案B chrys 银行卡实证：OCR 噪声"人《AA招商银行"，agent 无法辨认哪段是 logo
    // 误识别噪声哪段是真文案）。改为自动批量登记结构化清单，降 MAJOR/WARN，人一次终审。
    // pixel_1to1（仅真视觉档可达——盲档已被 E2 钳到 semantic_layout/reference_only）语义
    // 不变：门禁强度没有全局放水，只是与能力档位对齐。
    if (ctx.adapterImageInput === 'none') {
      writeBlindReviewPending(ctx.projectRoot, ctx.feature, uncoveredEntries);
      const pendingRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec/reports/blind-review-pending.yaml');
      return [{
        id: 'capture_completeness_external',
        category: 'structure',
        description: desc,
        severity: 'MAJOR',
        status: 'WARN',
        details: [
          `【P0-D 盲档降级】原图 OCR 文本 ${uncovered.length}/${totalLines} 行未被 spec 捕获（真分母覆盖率 ${coveragePct}%）——` +
            `当前 adapter 无视觉能力（adapterImageInput=none），无法逐条辨认噪声/真文本，已自动登记待复核清单：`,
          `  ${pendingRel}`,
          boundaryNote,
        ].join('\n'),
        suggestion:
          `已写入 ${pendingRel}（${uncoveredEntries.length} 条，auto_disposition: unverifiable_blind）；` +
          '收口阶段真人一次终审：确需实现→补 ref-elements + ui-spec 建模；确不实现→ref-elements defer + 签字。' +
          '盲档下不要求 agent 逐条判断（那是无解题），不得靠删分母放行——分母是原图 OCR，删不掉。',
        affected_files: [pendingRel, refRel, uiSpecRel],
      }];
    }
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    return [{
      id: 'capture_completeness_external',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        `【P0-D 外部完整性缺口】原图 OCR 文本 ${uncovered.length}/${totalLines} 行未被 spec 捕获（真分母覆盖率 ${coveragePct}%）：`,
        ...uncovered.slice(0, 15).map(l => `  ${l}`),
        uncovered.length > 15 ? `  …共 ${uncovered.length} 行` : '',
        boundaryNote,
      ].filter(Boolean).join('\n'),
      suggestion:
        '逐条处置：确需实现→补 ref-elements（disposition: implement）并在 ui-spec 建模（text/subtitle）；' +
        '确不实现→ref-elements 记 disposition: defer + fidelity_deferrals 真人签字。' +
        '不得靠删分母放行——分母是原图 OCR，删不掉。',
      affected_files: [refRel, uiSpecRel],
    }];
  }

  // t6④：overlay 屏本地分母缺口报告（uncovered 早退不掩盖——本组行属"feature 级已覆盖"，与 uncovered 正交）
  if (overlayLocalRatchet.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    return [{
      id: 'capture_completeness_overlay_local',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        `【t6④ overlay 本屏建模缺口】${overlayLocalRatchet.length} 行位于 overlay root bbox 区域内、` +
          `由其它屏声明覆盖但本 overlay 屏未建模（bc-openCard"银行行挂靠主屏分母"同型洞）：`,
        ...overlayLocalRatchet.slice(0, 10).map(l => `  ${l}`),
        overlayLocalAdvisory.length > 0
          ? `另有 ${overlayLocalAdvisory.length} 行区域不可定（root 无 bbox），advisory 复核：${overlayLocalAdvisory.slice(0, 5).join('；')}`
          : '',
      ].filter(Boolean).join('\n'),
      suggestion:
        '确属 overlay 内元素 → 在该 overlay 屏组件树补建模（text/subtitle）；确属背景透出 → ' +
        'ref-elements 以 screen_ref_id 归属基屏，或 defer+真人签（沿用既有出口，不另造白名单）。',
      affected_files: [refRel, uiSpecRel],
    }];
  }
  if (overlayLocalAdvisory.length > 0) {
    return [{
      id: 'capture_completeness_overlay_local',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'WARN',
      details: [
        `【t6④ overlay 本屏建模复核（advisory，root 无 bbox 无法框定 sheet 区域）】` +
          `${overlayLocalAdvisory.length} 行由其它屏声明覆盖、本 overlay 屏未建模——可能是 overlay 内漏建模，也可能是背景透出：`,
        ...overlayLocalAdvisory.slice(0, 10).map(l => `  ${l}`),
        '给 overlay root 声明 bbox 后本检查可升为确定性拦截。',
      ].join('\n'),
      affected_files: [refRel, uiSpecRel],
    }];
  }

  return [{
    id: 'capture_completeness_external',
    category: 'structure',
    description: desc,
    severity: 'MAJOR',
    status: 'PASS',
    details:
      `外部完整性对照通过：${screensAudited} 屏 OCR ${totalLines} 行文本全部被 spec 捕获（真分母覆盖率 ${coveragePct}%）` +
      (ghostTexts.length ? `；疑似幻觉文本（spec 有而原图 OCR 无，低置信注记，可能 OCR 掉字）：${ghostTexts.slice(0, 5).join('；')}` : '') +
      (ocrErrors.length ? `；部分屏未审计：${ocrErrors.join('；')}` : '') +
      `\n${boundaryNote}`,
    affected_files: [refRel, uiSpecRel],
  }];
}

// ============================================================================
// P0-D 结构 lint（新 check：ui_spec_structure_lint）——pixel_1to1 P0 屏结构声明必填。
// round6 实证：副标题右置无声明→coding 惯用题下；5 行卡种平铺→coding 全做独卡；浮动 tab 容器未建模。
// ============================================================================

/**
 * 连续同型 list_selection 兄弟 ≥ 此数且无分组语义 → 须建分组容器。
 * t6①（plan c6d8f2b4）3→2：bc-openCard card_type_sheet 实证 2 行（储蓄卡/信用卡）低于旧阈值
 * 静默放行，而"须与银行行同白卡"正是人工抓出的核心结构缺陷。范围本就限 pixel_1to1+P0 屏；
 * 合法独立双卡结构的既有出口=各行声明各自 layout_group 或各建 bg_color 容器（提示文案已注明）。
 */
export const STRUCTURE_LINT_FLAT_LIST_MIN = 2;

interface LintHit {
  screen: string;
  detail: string;
}

function lintNodeTree(
  screenId: string,
  parent: UiSpecComponentNode,
  isRoot: boolean,
  hits: LintHit[],
): void {
  const children = parent.children ?? [];
  // 1) subtitle 声明位置必填
  for (const c of children) {
    const sub = (c as { subtitle?: string; subtitle_position?: string }).subtitle;
    const pos = (c as { subtitle?: string; subtitle_position?: string }).subtitle_position;
    if (typeof sub === 'string' && sub.trim() && pos !== 'trailing' && pos !== 'below') {
      hits.push({
        screen: screenId,
        detail: `${c.id ?? c.type} 声明 subtitle 但缺 subtitle_position（trailing|below）——副标题右置 vs 题下必须显式声明，coding 不得猜`,
      });
    }
  }
  // 2) 连续 ≥N 个 list_selection 平铺（均无 layout_group 且父无 bg_color 容器语义）→ 须分组容器
  let run: UiSpecComponentNode[] = [];
  const flush = (): void => {
    if (
      run.length >= STRUCTURE_LINT_FLAT_LIST_MIN &&
      run.every(n => !n.layout_group?.trim()) &&
      !(parent.bg_color?.trim() && !isRoot)
    ) {
      hits.push({
        screen: screenId,
        detail:
          `${run.map(n => n.id ?? n.type).join('/')} 连续 ${run.length} 个 list_selection 平铺` +
          `${isRoot ? '在 root 下' : `在 ${parent.id ?? parent.type} 下（无 bg_color 容器语义）`}` +
          `——原图同卡多行须建分组容器（含 bg_color/圆角的父节点包裹 children）或逐节点声明 layout_group；` +
          `确属独立卡片结构 → 各行声明各自 layout_group 或各建 bg_color 容器即豁免（既有出口，非新限制）`,
      });
    }
    run = [];
  };
  for (const c of children) {
    if (c.type === 'list_selection') run.push(c);
    else flush();
  }
  flush();
  for (const c of children) lintNodeTree(screenId, c, false, hits);
}

/**
 * P0-D 结构 lint 主检查。诚实边界：只保证"结构有声明"，不保证"声明对"
 * （填声明的仍是会犯错的 VL；正确性归 review 视觉维度 + device 回环）。
 */
export function checkUiSpecStructureLint(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const uiChange = parseUiChangeFromSpecMarkdown(specMarkdown);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) return [];
  if (!isPixel1to1(ctx)) return []; // 仅 pixel_1to1 强制；semantic_layout 零噪声
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!uiDoc) return [];
  const checks = ctx.phaseRule.structure_checks as Record<string, { description?: string }>;
  const desc = checks?.ui_spec_structure_lint?.description?.trim() ?? 'ui_spec_structure_lint';
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);

  const hits: LintHit[] = [];
  const overlayAdvisories: LintHit[] = [];
  for (const s of uiDoc.screens ?? []) {
    if (s.priority !== 'P0' || !s.root) continue;
    lintNodeTree(s.id, s.root, true, hits);
    // t6②（plan c6d8f2b4）overlay 屏几何合同：root=overlay_panel 的 P0 屏，直系
    // list_selection/action_button 子节点须有 bbox 或 layout_group 至少其一
    // （bc-openCard card_type_sheet 零几何声明照过的洞）。
    if (s.root.type === 'overlay_panel') {
      const bare = (s.root.children ?? []).filter(
        c =>
          (c.type === 'list_selection' || c.type === 'action_button') &&
          !(Array.isArray(c.bbox) && c.bbox.length === 4) &&
          !c.layout_group?.trim(),
      );
      if (bare.length > 0) {
        hits.push({
          screen: s.id,
          detail:
            `overlay 屏直系 ${bare.map(n => n.id ?? n.type).join('/')} 共 ${bare.length} 个节点既无 bbox 也无 layout_group` +
            `——overlay P0 屏几何合同要求至少其一（t6②），否则 T8 布局断言与 coding 布局均无锚`,
        });
      }
      // t6③ advisory：overlay 屏出现 ≥2 个 bg_color surface 类兄弟容器 → 提示复核
      // （参考图为同一张白卡时须建同一分组容器；两块独立底色块正是 bc-openCard (a) 缺陷形态）。
      const surfaceSiblings = (s.root.children ?? []).filter(
        c => c.bg_color?.trim() && (c.children?.length ?? 0) > 0,
      );
      if (surfaceSiblings.length >= 2) {
        overlayAdvisories.push({
          screen: s.id,
          detail:
            `overlay 屏声明了 ${surfaceSiblings.length} 个 bg_color 兄弟容器（${surfaceSiblings.map(n => n.id ?? n.type).join('/')}）` +
            `——请对照参考原图复核：若原图为同一张白底卡片，须合并为同一分组容器（advisory，不阻断）`,
        });
      }
    }
  }
  // 3) 全局 bottom_tab 声明了却无容器建模（原图浮动胶囊 tab：bg+圆角）。
  // codex 二轮采纳：组件树里**根本没有**对应容器节点同样必拦——"只有首页/我的文本声明、无胶囊容器建模"
  // 正是 round6 tab 崩坏形态之一，漏拦=放过最坏情况。
  const globalTabIds = new Set((uiDoc.global_elements ?? []).map(g => g.id));
  if (globalTabIds.size > 0) {
    const nodes = collectAllComponentNodes(uiDoc);
    for (const gid of globalTabIds) {
      const node = nodes.find(n => n.id === gid || n.layout_group === gid);
      if (!node) {
        hits.push({
          screen: '(global)',
          detail: `全局元素 ${gid} 已声明（global_elements）但组件树无对应容器节点（id/layout_group=${gid}）——须建模浮动容器节点（bg_color+bbox），否则 coding 无从渲染胶囊 tab`,
        });
      } else if (!node.bg_color?.trim()) {
        hits.push({
          screen: '(global)',
          detail: `全局元素 ${gid} 的容器节点未声明 bg_color——原图浮动胶囊 tab 须建模容器（bg+圆角），否则 coding 易搭成裸文字行`,
        });
      }
    }
  }

  const boundaryNote =
    '【诚实边界】结构 lint 只保证"有声明"不保证"声明对"——门禁绿≠结构对，正确性归 review 视觉维度 + device 回环。';

  if (hits.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    return [{
      id: 'ui_spec_structure_lint',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        `【P0-D 结构声明缺失】${hits.length} 处 pixel_1to1 P0 屏结构未显式声明：`,
        ...hits.slice(0, 10).map(h => `  [${h.screen}] ${h.detail}`),
        hits.length > 10 ? `  …共 ${hits.length} 处` : '',
        boundaryNote,
      ].filter(Boolean).join('\n'),
      suggestion:
        '对照参考原图逐处补声明：副标题 subtitle+subtitle_position；同卡多行包分组容器节点（bg_color+children）' +
        '或声明 layout_group；浮动 tab 容器补 bg_color。见 reference/ui-spec.md「结构声明」。',
      affected_files: [uiSpecRel],
    }];
  }

  if (overlayAdvisories.length > 0) {
    return [{
      id: 'ui_spec_structure_lint',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'WARN',
      details: [
        '【t6③ overlay surface advisory（不阻断）】',
        ...overlayAdvisories.map(h => `  [${h.screen}] ${h.detail}`),
        boundaryNote,
      ].join('\n'),
      affected_files: [uiSpecRel],
    }];
  }

  return [{
    id: 'ui_spec_structure_lint',
    category: 'structure',
    description: desc,
    severity: 'MAJOR',
    status: 'PASS',
    details: `P0 屏结构声明齐全（subtitle 位置/分组容器/全局容器/overlay 几何合同）。\n${boundaryNote}`,
    affected_files: [uiSpecRel],
  }];
}
