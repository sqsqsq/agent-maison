// ============================================================================
// vision-counterevidence.ts — 视觉产出确定性反证扫描器
// （visual-capability-truth S3 / P0-A；openspec vision-capability-truth spec）
// ----------------------------------------------------------------------------
// 扫描面（精确字段，非 must_have_elements——那是 id 列表）：componentNode.text、
// global_elements[].texts、text-bearing 节点 source_ref、ref-elements 文本。
// 三态分立（codex plan 审查三轮 P1，审计语义不得互相冒充）：
//   contradicted   已证明矛盾（U+FFFD/非法代理对；与高置信证据明确冲突）→ BLOCKER
//   evidence_gap   证据不足（text 无 source/reference 映射；低置信 OCR 升 UI）→ 使
//                  vl_multimodal 失效但措辞是"缺证"非"证伪"
//   heuristic      observe-only（单字符碎片率等）——首版只计数落盘不降档
// 置信管线现实边界（实施偏差声明）：当前 ref-elements 无 confidence 字段（OCR 置信
// 未落盘）——「低置信升 UI」形态在置信管线建立前归 heuristic 计数（no_confidence_
// pipeline），不判 evidence_gap（否则无差别误伤全部存量绿链）。
// ============================================================================

import type { UiSpecDoc, UiSpecComponentNode } from './ui-spec-shared';

export interface CounterevidenceFinding {
  kind: 'contradicted' | 'evidence_gap' | 'heuristic';
  code: string;
  where: string;
  detail: string;
}

export interface CounterevidenceScan {
  contradicted: CounterevidenceFinding[];
  evidenceGap: CounterevidenceFinding[];
  heuristics: CounterevidenceFinding[];
  /**
   * codex 实施 review 二轮 P0-2：正向 provenance 成立=OCR 工作流在场（refTexts 非空）
   * 且**全部** UI 文本与参考元素文本正向匹配（exact/substring）。source_ref 解析成功只是
   * "结构性可信的声明"，不计入正向证明。verified attestation 只允许在本标志为 true 时签发；
   * 反证缺席（clean）本身最多得 unverified_clean。
   */
  positive_provenance: boolean;
  /** observe-only 计数（落盘供两轮真实 run 回灌定阈值） */
  counters: {
    texts_total: number;
    single_char_fragments: number;
    unmapped_texts: number;
    dangling_source_refs: number;
    replacement_chars: number;
    no_confidence_pipeline: boolean;
  };
}

/** U+FFFD 或孤立代理对（编码损坏的确定性证据） */
export function hasInvalidUnicode(s: string): boolean {
  if (s.includes('�')) return true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (n < 0xdc00 || n > 0xdfff) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

interface TextSite {
  text: string;
  where: string;
  sourceRef: string | null;
}

function collectTextSites(doc: UiSpecDoc): TextSite[] {
  const sites: TextSite[] = [];
  for (const s of doc.screens ?? []) {
    const walk = (n: UiSpecComponentNode, trail: string): void => {
      const rec = n as { text?: unknown; source_ref?: unknown; id?: unknown };
      if (typeof rec.text === 'string' && rec.text.trim()) {
        sites.push({
          text: rec.text.trim(),
          where: `${s.id}/${typeof rec.id === 'string' ? rec.id : trail}`,
          sourceRef: typeof rec.source_ref === 'string' && rec.source_ref.trim() ? rec.source_ref.trim() : null,
        });
      }
      (n.children ?? []).forEach((c, i) => walk(c, `${trail}.${i}`));
    };
    if (s.root) walk(s.root, 'root');
  }
  for (const g of doc.global_elements ?? []) {
    const gr = g as { id?: unknown; texts?: unknown };
    for (const t of Array.isArray(gr.texts) ? gr.texts : []) {
      if (typeof t === 'string' && t.trim()) {
        sites.push({
          text: t.trim(),
          where: `global/${typeof gr.id === 'string' ? gr.id : '?'}`,
          sourceRef: null,
        });
      }
    }
  }
  return sites;
}

export interface RefElementLite {
  text?: string;
  confidence?: number;
  /** ref-elements 条目 id（source_ref 合法解析目标之一） */
  element_id?: string;
  /** 条目所属参考屏 id（source_ref 合法解析目标之一） */
  screen_ref_id?: string;
}

/**
 * 扫描 ui-spec 的视觉产出反证。refElements=ref-elements.yaml 的 elements（可 null）。
 * lowConfidenceThreshold 仅在置信管线在场（任一元素带 confidence）时生效。
 */
export function scanUiSpecCounterevidence(
  doc: UiSpecDoc,
  refElements: RefElementLite[] | null,
  opts?: { lowConfidenceThreshold?: number },
): CounterevidenceScan {
  const contradicted: CounterevidenceFinding[] = [];
  const evidenceGap: CounterevidenceFinding[] = [];
  const heuristics: CounterevidenceFinding[] = [];
  const threshold = opts?.lowConfidenceThreshold ?? 60;

  const refTexts = new Set(
    (refElements ?? []).map(e => (typeof e.text === 'string' ? e.text.trim() : '')).filter(Boolean),
  );
  const confidencePipeline = (refElements ?? []).some(e => typeof e.confidence === 'number');
  const lowConfTexts = new Set(
    confidencePipeline
      ? (refElements ?? [])
          .filter(e => typeof e.confidence === 'number' && e.confidence < threshold && typeof e.text === 'string')
          .map(e => (e.text as string).trim())
      : [],
  );

  // codex 实施 review 二轮 P0-2：source_ref 是**声明**不是证明——任意非空字符串即视为
  // "有映射"曾是自签通道（补 source_ref: x 即可消 evidence_gap → 换取 verified → 自动
  // 解除 blind-safe 降级）。source_ref 至少须解析到已知 reference id（ref-elements 的
  // element_id / screen_ref_id 或 ui-spec 屏的 ref_id）；悬空引用按 evidence_gap 记。
  const knownRefIds = new Set<string>();
  for (const e of refElements ?? []) {
    if (typeof e.element_id === 'string' && e.element_id.trim()) knownRefIds.add(e.element_id.trim());
    if (typeof e.screen_ref_id === 'string' && e.screen_ref_id.trim()) knownRefIds.add(e.screen_ref_id.trim());
  }
  for (const s of doc.screens ?? []) {
    const rid = (s as { ref_id?: unknown }).ref_id;
    if (typeof rid === 'string' && rid.trim()) knownRefIds.add(rid.trim());
  }

  const sites = collectTextSites(doc);
  let singleCharFragments = 0;
  let unmapped = 0;
  let danglingSourceRefs = 0;
  let replacementChars = 0;
  let allTextMatched = true;

  // ref-elements 自身的编码损坏同为强证据（OCR 产物即视觉链路产出）
  for (const rt of refTexts) {
    if (hasInvalidUnicode(rt)) {
      contradicted.push({
        kind: 'contradicted',
        code: 'invalid_unicode',
        where: 'ref-elements',
        detail: `参考元素文本含 U+FFFD/非法代理对：「${rt.slice(0, 30)}」`,
      });
    }
  }

  for (const site of sites) {
    if (hasInvalidUnicode(site.text)) {
      replacementChars++;
      contradicted.push({
        kind: 'contradicted',
        code: 'invalid_unicode',
        where: site.where,
        detail: `UI 文本含 U+FFFD/非法代理对：「${site.text.slice(0, 30)}」`,
      });
      continue;
    }
    if (confidencePipeline && lowConfTexts.has(site.text)) {
      evidenceGap.push({
        kind: 'evidence_gap',
        code: 'low_confidence_ocr_promoted',
        where: site.where,
        detail: `低置信 OCR 文本被原样升为 UI 文本（<${threshold}）：「${site.text.slice(0, 30)}」——OCR 自己不确定 ≠ 已证伪，须人工核对或重采`,
      });
      continue;
    }
    const textMatched =
      refTexts.has(site.text) ||
      [...refTexts].some(rt => rt.includes(site.text) || site.text.includes(rt));
    if (!textMatched) allTextMatched = false;
    if (refTexts.size === 0) {
      // 无 ref-elements（非 OCR 工作流）——映射维度不适用（positive_provenance 亦不成立）
    } else if (site.sourceRef !== null && !knownRefIds.has(site.sourceRef) && !textMatched) {
      danglingSourceRefs++;
      evidenceGap.push({
        kind: 'evidence_gap',
        code: 'dangling_source_ref',
        where: site.where,
        detail:
          `source_ref=「${site.sourceRef.slice(0, 40)}」解析不到任何已知 reference id（element_id/screen_ref_id/屏 ref_id）` +
          `且文本「${site.text.slice(0, 30)}」无参考文本匹配——悬空引用不构成映射证据`,
      });
    } else {
      const mapped = textMatched || (site.sourceRef !== null && knownRefIds.has(site.sourceRef));
      if (!mapped) {
        unmapped++;
        evidenceGap.push({
          kind: 'evidence_gap',
          code: 'no_source_mapping',
          where: site.where,
          detail: `UI 文本无 reference/source 映射：「${site.text.slice(0, 30)}」——缺证明 ≠ 已证明错误，须补可解析 source_ref 或核对参考图`,
        });
      }
    }
    if ([...site.text].length === 1) singleCharFragments++;
  }

  if (!confidencePipeline && refTexts.size > 0) {
    heuristics.push({
      kind: 'heuristic',
      code: 'no_confidence_pipeline',
      where: 'ref-elements',
      detail: 'OCR 置信度未随产物落盘——「低置信升 UI」形态不可判（置信管线建立后自动生效）',
    });
  }
  if (sites.length > 0 && singleCharFragments / sites.length > 0.2) {
    heuristics.push({
      kind: 'heuristic',
      code: 'single_char_fragment_ratio',
      where: 'ui-spec',
      detail: `单字符碎片占比 ${(singleCharFragments / sites.length * 100).toFixed(0)}%（observe-only 计数，阈值待两轮真实 run 回灌）`,
    });
  }

  return {
    contradicted,
    evidenceGap,
    heuristics,
    positive_provenance:
      refTexts.size > 0 && sites.length > 0 && allTextMatched && contradicted.length === 0,
    counters: {
      texts_total: sites.length,
      single_char_fragments: singleCharFragments,
      unmapped_texts: unmapped,
      dangling_source_refs: danglingSourceRefs,
      replacement_chars: replacementChars,
      no_confidence_pipeline: !confidencePipeline,
    },
  };
}
