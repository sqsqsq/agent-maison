// ============================================================================
// layout-oracle-calibrate.ts — t5（plan f7a3d9c2）：布局 oracle 校准自动化核心。
//
// 产出双件套：calibration.json（SSOT，供程序消费）+ layout-oracle-calibration.report.md
// （纯投影）。逐项标注 automated_conclusion vs needs_human（CLI 降摩擦，不替代真机人工
// 结论）。CLI 显式触发、不挂任何阶段链；产出供人做 gate 升档判断，本 CLI 不改档位。
//
// 模式：
// - offline（默认）：分析既有采集产物（device-screenshots/ 的 shot-*.png 与
//   layout-*.json）——覆盖 ①②③④⑤⑦⑧ 与 ledger FP/FN 表；
// - device（--device）：额外执行 ⑥appRoot 多次 dump 稳定性 与 ⑨双拍/双 dump 稳定性
//   实测（t4a 采样器，t4b 定参的前置数据——中期宿主触点）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { featureDir } from '../../../harness/config';
import {
  loadUiSpecFile,
  uiSpecAbsPath,
  collectAllComponentNodes,
  type UiSpecDoc,
  type UiSpecScreen,
} from '../../../harness/scripts/utils/ui-spec-shared';
import {
  collectDeclaredElements,
  collectLayoutOracleForScreen,
  flattenLayoutNodes,
  loadLayoutDumpFile,
  locateElements,
  parseHypiumDump,
  type ParsedLayoutDump,
} from './layout-oracle-check';
import { collectP0VisualTargetIds } from './visual-diff-targets';
import { canonicalOverlayBase } from './visual-diff-nav';
import { deviceScreenshotsDir } from './visual-diff-capture';
import { cropAssetFromBbox, isJimpAvailable } from './image-toolkit';
import {
  sampleQuiescent,
  type QuiescenceSampleFns,
  type QuiescenceSampleResult,
} from './quiescence-sampling';
import {
  readFeedbackLedger,
  aggregateFeedbackLedger,
  reviewFeedbackLedgerPath,
  type FeedbackAggregation,
} from '../../../harness/scripts/utils/review-feedback-ledger';

export const CALIBRATION_SCHEMA_VERSION = '1.0';

export type CalibrationConclusionKind = 'automated_conclusion' | 'needs_human';

export interface CalibrationItemBase {
  id: string;
  title: string;
  kind: CalibrationConclusionKind;
}

export interface CalibrationReport {
  schema_version: string;
  at: string;
  feature: string;
  mode: 'offline' | 'device';
  screens_analyzed: string[];
  screens_missing_dump: string[];
  items: {
    overlay_in_tree: CalibrationItemBase & {
      per_screen: Array<{ screen_id: string; declared_texts: number; found: number; missing: string[] }>;
    };
    locator_coverage: CalibrationItemBase & {
      per_screen: Array<{
        screen_id: string;
        declared: number;
        coverage: number;
        by_confidence: Record<string, number>;
      }>;
    };
    bounds_hygiene: CalibrationItemBase & {
      per_screen: Array<{
        screen_id: string;
        total_nodes: number;
        zero_area: number;
        negative_coord: number;
        out_of_screen: number;
      }>;
    };
    close_rule_dry_run: CalibrationItemBase & {
      hits: Array<{ screen_id: string; finding_id: string; note: string }>;
    };
    c1_gap_distribution: CalibrationItemBase & {
      hits: Array<{ screen_id: string; finding_id: string; note: string }>;
    };
    approot_stability: CalibrationItemBase & {
      per_screen: Array<{
        screen_id: string;
        approot_type: string;
        by_type_root_hit: boolean;
        area_ratio: number;
      }>;
      device_redump?: Array<{ screen_id: string; dumps: number; distinct_identities: number }>;
    };
    bounds_semantics_material: CalibrationItemBase & {
      crops: Array<{ screen_id: string; element: string; crop_path: string }>;
      note: string;
    };
    locator_ambiguity: CalibrationItemBase & {
      per_screen: Array<{ screen_id: string; duplicate_ids: number; duplicate_texts: number }>;
    };
    double_sample_stability: CalibrationItemBase & {
      /** ⑨（t4b 定参前置）：三口径稳定率——device 模式实测；offline 缺省空 */
      per_screen: Array<{
        screen_id: string;
        stable: boolean;
        attempts: number;
        unstable_reason?: string;
        image_criterion: string;
        full_frame_equal: boolean;
        app_crop_equal: boolean | null;
        layout_signature_equal: boolean;
      }>;
      note: string;
    };
    feedback_ledger: CalibrationItemBase & FeedbackAggregation;
  };
}

function newItem(id: string, title: string, kind: CalibrationConclusionKind): CalibrationItemBase {
  return { id, title, kind };
}

export interface CalibrationDeviceFns {
  /** ⑨/⑥ 用：对指定屏采样（调用方负责先导航到位） */
  sampleScreen: (screenId: string) => QuiescenceSampleResult | { error: string };
  /** ⑥ 用：对指定屏额外 dump 一次（返回 dump 路径或错误） */
  redumpScreen?: (screenId: string, seq: number) => { ok: boolean; dumpAbs?: string; error?: string };
}

export function runLayoutOracleCalibration(opts: {
  projectRoot: string;
  feature: string;
  uiDoc?: UiSpecDoc | null;
  deviceFns?: CalibrationDeviceFns | null;
  now?: () => string;
}): CalibrationReport {
  const uiDoc =
    opts.uiDoc !== undefined
      ? opts.uiDoc
      : loadUiSpecFile(uiSpecAbsPath(opts.projectRoot, opts.feature));
  const reportDir = deviceScreenshotsDir(opts.projectRoot, opts.feature);
  const p0Ids = collectP0VisualTargetIds(uiDoc);
  const uiById = new Map((uiDoc?.screens ?? []).map(s => [s.id, s] as const));

  const screensAnalyzed: string[] = [];
  const screensMissingDump: string[] = [];
  const dumps = new Map<string, ParsedLayoutDump>();
  for (const id of p0Ids) {
    const dumpAbs = path.join(reportDir, `layout-${id}.json`);
    const dump = loadLayoutDumpFile(dumpAbs);
    if (dump) {
      dumps.set(id, dump);
      screensAnalyzed.push(id);
    } else {
      screensMissingDump.push(id);
    }
  }

  // ① overlay 进树（D1/D2）：声明文本节点在 dump 树内检索
  const overlayInTree: CalibrationReport['items']['overlay_in_tree'] = {
    ...newItem('overlay_in_tree', 'overlay 进树检测（sheet 开启态 dump 内检索声明文本，D1/D2）', 'automated_conclusion'),
    per_screen: [],
  };
  for (const [id, dump] of dumps) {
    const uiScreen = uiById.get(id) ?? uiById.get(canonicalOverlayBase(id));
    if (!uiScreen) continue;
    const nodes = collectAllComponentNodes({ screens: [uiScreen], tokens: {}, assets: [] } as UiSpecDoc);
    const declaredTexts = [...new Set(nodes.map(n => n.text).filter((t): t is string => Boolean(t?.trim())))];
    if (declaredTexts.length === 0) continue;
    const dumpTexts = flattenLayoutNodes(dump.appRoot)
      .map(e => e.node.text)
      .filter(t => t.trim());
    const missing = declaredTexts.filter(t => !dumpTexts.some(dt => dt.includes(t)));
    overlayInTree.per_screen.push({
      screen_id: id,
      declared_texts: declaredTexts.length,
      found: declaredTexts.length - missing.length,
      missing: missing.slice(0, 12),
    });
  }

  // ② .id() 覆盖率（D3 半自动——responseRegion 对照留人工）
  const locatorCoverage: CalibrationReport['items']['locator_coverage'] = {
    ...newItem('locator_coverage', '.id() 覆盖率（exact_id/unique_text/structural/unmatched 分布，D3 半自动）', 'automated_conclusion'),
    per_screen: [],
  };
  for (const [id, dump] of dumps) {
    const uiScreen = uiById.get(id) ?? uiById.get(canonicalOverlayBase(id));
    if (!uiScreen) continue;
    const declared = collectDeclaredElements(uiScreen);
    const { located, coverage } = locateElements(declared, dump.appRoot);
    const byConfidence: Record<string, number> = {};
    for (const e of located.values()) {
      byConfidence[e.confidence] = (byConfidence[e.confidence] ?? 0) + 1;
    }
    locatorCoverage.per_screen.push({
      screen_id: id,
      declared: declared.length,
      coverage: Number(coverage.toFixed(3)),
      by_confidence: byConfidence,
    });
  }

  // ③ bounds 卫生（D4 部分）
  const boundsHygiene: CalibrationReport['items']['bounds_hygiene'] = {
    ...newItem('bounds_hygiene', 'bounds 卫生统计（零面积/负坐标/越屏节点计数，D4 部分）', 'automated_conclusion'),
    per_screen: [],
  };
  for (const [id, dump] of dumps) {
    const flat = flattenLayoutNodes(dump.root);
    let zeroArea = 0;
    let negative = 0;
    let outOfScreen = 0;
    for (const { node } of flat) {
      const b = node.bounds;
      if (!b) continue;
      if (b.x2 - b.x1 <= 0 || b.y2 - b.y1 <= 0) zeroArea++;
      if (b.x1 < 0 || b.y1 < 0) negative++;
      if (
        b.x2 > dump.screenRect.x2 || b.y2 > dump.screenRect.y2 ||
        b.x1 < dump.screenRect.x1 || b.y1 < dump.screenRect.y1
      ) {
        outOfScreen++;
      }
    }
    boundsHygiene.per_screen.push({
      screen_id: id,
      total_nodes: flat.length,
      zero_area: zeroArea,
      negative_coord: negative,
      out_of_screen: outOfScreen,
    });
  }

  // ④/⑤ close 干跑与 C1 分布（跑既有 oracle 收集 advisory 素材）
  const closeDryRun: CalibrationReport['items']['close_rule_dry_run'] = {
    ...newItem('close_rule_dry_run', 'close 默认规则干跑（advisory 命中=FP 观察素材，D5）', 'automated_conclusion'),
    hits: [],
  };
  const c1Distribution: CalibrationReport['items']['c1_gap_distribution'] = {
    ...newItem('c1_gap_distribution', 'C1 间距比例偏差分布（D6 素材）', 'automated_conclusion'),
    hits: [],
  };
  for (const [id, dump] of dumps) {
    const uiScreen = uiById.get(id) ?? uiById.get(canonicalOverlayBase(id));
    if (!uiScreen) continue;
    const res = collectLayoutOracleForScreen({ screenId: id, screen: uiScreen, dump });
    for (const f of res.findings) {
      if (f.signal === 'A3_close_overlap_default') {
        closeDryRun.hits.push({ screen_id: id, finding_id: f.finding_id, note: f.note });
      } else if (f.signal === 'C1_gap_ratio_divergent') {
        c1Distribution.hits.push({ screen_id: id, finding_id: f.finding_id, note: f.note });
      }
    }
  }

  // ⑥ appRoot 稳定性（type='root' 首子树假设的验证；device 模式加多次 redump 对比）
  const approotStability: CalibrationReport['items']['approot_stability'] = {
    ...newItem('approot_stability', 'appRoot 选择稳定性（type=root 首子树假设，E9 复验）', 'automated_conclusion'),
    per_screen: [],
  };
  for (const [id, dump] of dumps) {
    const byTypeHit = dump.root.children.some(c => c.type === 'root' && c.bounds);
    const screenArea = Math.max(
      1,
      (dump.screenRect.x2 - dump.screenRect.x1) * (dump.screenRect.y2 - dump.screenRect.y1),
    );
    const appArea = (dump.appRect.x2 - dump.appRect.x1) * (dump.appRect.y2 - dump.appRect.y1);
    approotStability.per_screen.push({
      screen_id: id,
      approot_type: dump.appRoot.type,
      by_type_root_hit: byTypeHit,
      area_ratio: Number((appArea / screenArea).toFixed(3)),
    });
  }
  if (opts.deviceFns?.redumpScreen) {
    approotStability.device_redump = [];
    for (const id of dumps.keys()) {
      const identities = new Set<string>();
      let dumpsDone = 0;
      for (let seq = 0; seq < 3; seq++) {
        const r = opts.deviceFns.redumpScreen(id, seq);
        if (!r.ok || !r.dumpAbs || !fs.existsSync(r.dumpAbs)) continue;
        try {
          const d = parseHypiumDump(JSON.parse(fs.readFileSync(r.dumpAbs, 'utf-8')));
          if (d) {
            dumpsDone++;
            identities.add(`${d.appRoot.type}:${JSON.stringify(d.appRect)}`);
          }
        } catch { /* 跳过坏 dump */ }
      }
      approotStability.device_redump.push({
        screen_id: id,
        dumps: dumpsDone,
        distinct_identities: identities.size,
      });
    }
  }

  // ⑦ bounds 语义抽查素材（needs_human：视觉边界 vs 触控热区须人对照并排图）
  const boundsSemantics: CalibrationReport['items']['bounds_semantics_material'] = {
    ...newItem('bounds_semantics_material', 'bounds 语义抽查素材（可交互元素 bounds 反裁截图，needs_human）', 'needs_human'),
    crops: [],
    note: 'bounds 是视觉边界还是触控热区无法机器判定——逐张对照 crop 与真机观感后在校准决定表记结论',
  };
  if (isJimpAvailable()) {
    const calibDir = path.join(reportDir, '_calibration');
    for (const [id, dump] of dumps) {
      const shotAbs = path.join(reportDir, `shot-${id}.png`);
      if (!fs.existsSync(shotAbs)) continue;
      const clickables = flattenLayoutNodes(dump.appRoot)
        .filter(e => e.node.clickable && e.node.bounds && (e.node.id || e.node.text))
        .slice(0, 4);
      for (const c of clickables) {
        const b = c.node.bounds!;
        const sw = Math.max(1, dump.screenRect.x2 - dump.screenRect.x1);
        const sh = Math.max(1, dump.screenRect.y2 - dump.screenRect.y1);
        const label = (c.node.id || c.node.text).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 24);
        const outAbs = path.join(calibDir, `bounds-${id}-${label}.png`);
        const res = cropAssetFromBbox(
          shotAbs,
          [(b.x1 - dump.screenRect.x1) / sw, (b.y1 - dump.screenRect.y1) / sh, (b.x2 - b.x1) / sw, (b.y2 - b.y1) / sh],
          outAbs,
          0.05,
        );
        if (res.ok) {
          boundsSemantics.crops.push({
            screen_id: id,
            element: c.node.id || c.node.text,
            crop_path: path.relative(opts.projectRoot, outAbs).replace(/\\/g, '/'),
          });
        }
      }
    }
  }

  // ⑧ locator 歧义统计（duplicate id / duplicate text）
  const locatorAmbiguity: CalibrationReport['items']['locator_ambiguity'] = {
    ...newItem('locator_ambiguity', 'locator 歧义统计（同 id/同文本多节点——unmatched 不强猜策略的分母）', 'automated_conclusion'),
    per_screen: [],
  };
  for (const [id, dump] of dumps) {
    const flat = flattenLayoutNodes(dump.appRoot);
    const idCount = new Map<string, number>();
    const textCount = new Map<string, number>();
    for (const { node } of flat) {
      if (node.id.trim()) idCount.set(node.id, (idCount.get(node.id) ?? 0) + 1);
      if (node.text.trim()) textCount.set(node.text, (textCount.get(node.text) ?? 0) + 1);
    }
    locatorAmbiguity.per_screen.push({
      screen_id: id,
      duplicate_ids: [...idCount.values()].filter(n => n >= 2).length,
      duplicate_texts: [...textCount.values()].filter(n => n >= 2).length,
    });
  }

  // ⑨ 双拍/双 dump 稳定性实测（t4b 定参前置——中期宿主触点；offline 空+注记）
  const doubleSample: CalibrationReport['items']['double_sample_stability'] = {
    ...newItem('double_sample_stability', '双拍/双 dump 稳定性实测（全图/app 裁剪/布局签名三口径——t4b 定参前置）', 'automated_conclusion'),
    per_screen: [],
    note: opts.deviceFns
      ? 't4b 完成门槛：以下实测数据回填后方可启用静稳降档'
      : 'offline 模式未实测——须 --device 在真机执行（中期宿主触点，先于 t4b）',
  };
  if (opts.deviceFns) {
    for (const id of p0Ids) {
      const res = opts.deviceFns.sampleScreen(id);
      if ('error' in res) {
        doubleSample.per_screen.push({
          screen_id: id,
          stable: false,
          attempts: 0,
          unstable_reason: `sample_error: ${res.error}`,
          image_criterion: 'n/a',
          full_frame_equal: false,
          app_crop_equal: null,
          layout_signature_equal: false,
        });
        continue;
      }
      const last = res.records[res.records.length - 1];
      doubleSample.per_screen.push({
        screen_id: id,
        stable: res.stable,
        attempts: res.attempts,
        ...(res.unstable_reason ? { unstable_reason: res.unstable_reason } : {}),
        image_criterion: last?.image_criterion ?? 'n/a',
        full_frame_equal: Boolean(last && last.shot1_full_hash && last.shot1_full_hash === last.shot2_full_hash),
        app_crop_equal: last?.shot1_crop_hash != null ? last.shot1_crop_hash === last.shot2_crop_hash : null,
        layout_signature_equal: Boolean(last && last.layout1_signature && last.layout1_signature === last.layout2_signature),
      });
    }
  }

  // ledger FP/FN 表（t6⑤：程序推导，升档评审的数据素材——非机制化升档）
  const ledgerAgg = aggregateFeedbackLedger(
    readFeedbackLedger(reviewFeedbackLedgerPath(opts.projectRoot, opts.feature)).entries,
  );
  const feedbackLedger: CalibrationReport['items']['feedback_ledger'] = {
    ...newItem('feedback_ledger', '终审回灌 FP/FN 表（visual-confirm ledger 程序推导——升档评审数据素材）', 'automated_conclusion'),
    ...ledgerAgg,
  };

  return {
    schema_version: CALIBRATION_SCHEMA_VERSION,
    at: (opts.now ?? (() => new Date().toISOString()))(),
    feature: opts.feature,
    mode: opts.deviceFns ? 'device' : 'offline',
    screens_analyzed: screensAnalyzed,
    screens_missing_dump: screensMissingDump,
    items: {
      overlay_in_tree: overlayInTree,
      locator_coverage: locatorCoverage,
      bounds_hygiene: boundsHygiene,
      close_rule_dry_run: closeDryRun,
      c1_gap_distribution: c1Distribution,
      approot_stability: approotStability,
      bounds_semantics_material: boundsSemantics,
      locator_ambiguity: locatorAmbiguity,
      double_sample_stability: doubleSample,
      feedback_ledger: feedbackLedger,
    },
  };
}

/** calibration.json（SSOT）+ report.md（纯投影）落盘 */
export function writeCalibrationArtifacts(
  projectRoot: string,
  feature: string,
  report: CalibrationReport,
): { jsonPath: string; mdPath: string } {
  const outDir = path.join(featureDir(projectRoot, feature), 'device-testing', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'calibration.json');
  const mdPath = path.join(outDir, 'layout-oracle-calibration.report.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(mdPath, renderCalibrationMd(report), 'utf-8');
  return { jsonPath, mdPath };
}

export function renderCalibrationMd(r: CalibrationReport): string {
  const lines: string[] = [
    `# 布局 oracle 校准报告（${r.feature}）`,
    '',
    `> 本文件是 \`calibration.json\`（SSOT）的**纯投影**，程序消费以 JSON 为准。`,
    `> 生成于 ${r.at}，模式=${r.mode}；本报告供人做 gate 升档判断，CLI 不改档位。`,
    '',
    `- 已分析屏（有 dump）：${r.screens_analyzed.join(', ') || '无'}`,
    `- 缺 dump 屏：${r.screens_missing_dump.join(', ') || '无'}`,
    '',
  ];
  const items = Object.values(r.items) as unknown as Array<CalibrationItemBase & Record<string, unknown>>;
  for (const item of items) {
    lines.push(`## ${item.title}`, '', `- 结论性质：\`${item.kind}\``);
    const rows =
      (item.per_screen as unknown[] | undefined) ??
      (item.hits as unknown[] | undefined) ??
      (item.crops as unknown[] | undefined);
    if (Array.isArray(rows)) {
      lines.push(`- 条目数：${rows.length}`);
      for (const row of rows.slice(0, 20)) {
        lines.push(`  - \`${JSON.stringify(row)}\``);
      }
      if (rows.length > 20) lines.push(`  - …共 ${rows.length} 条（余见 calibration.json）`);
    }
    if (typeof item.note === 'string') lines.push(`- 注：${item.note}`);
    if (item.id === 'feedback_ledger') {
      const agg = item as unknown as FeedbackAggregation;
      lines.push(
        `- FP（按 signal）：${JSON.stringify(agg.fp_by_signal)}`,
        `- FN：unattributed=${agg.fn_unattributed}，按 detector family（issue_kind 映射估计）=${JSON.stringify(agg.fn_by_family)}`,
        `- 样本失效标注：oracle_version 变更样本 ${agg.stale_oracle_version_entries} 条`,
        `- 升档规则参数（样本量 N/跨屏跨设备覆盖/FN 上限）待数据累积后由人定——本表是数据素材，非升档判定`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
