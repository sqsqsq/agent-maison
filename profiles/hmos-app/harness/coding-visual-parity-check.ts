// ============================================================================
// coding · visual parity 确定性守门（hmos-app / coding.visual_parity capability）
// ============================================================================
// 边界（review#5）：D 查「在不在」非「对不对」——必要不充分。
// unverified ui-spec 下只报结构 presence，报告显式标注「基线未校验，非保真结论」。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureFile, featureDir, featurePhaseReportsDir } from '../../../harness/config';
import { loadVisualDiffNavConfigV2 } from './visual-diff-nav';
import {
  UI_CHANGE_REQUIRES_UI_SPEC,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  structureFailOrWarn,
  type UiSpecAsset,
  type VisualEnforcementMode,
} from '../../../harness/scripts/utils/ui-spec-shared';
import {
  ASSET_SANITY_THRESHOLD_VERSION,
  assessMaterializedFile,
  deriveAssetCriticality,
  deriveAssetRole,
  detectPlaceholderMarker,
} from './asset-integrity';
import { canonicalPkgPath, findModuleMediaFile } from './visual-parity-backstop';
import { computeStaticFidelityScore } from './static-fidelity-score';
import { collectUnverifiedCropLines } from './asset-crop-validation';
import {
  runVisualParityBackstop,
  collectVariantParityIssues,
  collectRenderFaithfulnessIssues,
  collectAssetRenderIssues,
  collectPlaceholderAssetIssues,
  collectBakedTextAssetIssues,
  collectIconSubstitutionIssues,
  collectActionButtonVariantDeclIssues,
  collectVisibleTextIssues,
  collectInvisiblePresenceIssues,
} from './visual-parity-backstop';
import { collectSpecTextUniverse } from './capture-completeness-check';
import { loadRefElementsFile, refElementsAbsPath } from '../../../harness/scripts/utils/fidelity-shared';
import { checkStructureDeclarationLedger } from './structure-ledger';
import { isHardPixelContract, fidelityRatchetFailOrWarn } from '../../../harness/scripts/utils/fidelity-shared';
import { resourceKeyToRef, scanFeatureSourceTree, scanResourceRefModules } from './source-ref-scan';

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

function loadSpecMarkdown(ctx: CheckContext): string | null {
  // codex 三轮 P1：生产入口路径走 featureDir（尊重 paths.features_dir）——否则自定义目录宿主
  // 在这里读不到 spec.md 提前退出，checkVisualParity 全链（含台账门禁）静默失效。
  const p = path.join(featureDir(ctx.projectRoot, ctx.feature), 'spec', 'spec.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

/** S6（P1-H calibrate）：locator-required 分母七类——identity 锚点 id 成员 / bbox 几何断言
 * 目标 / forbidden-overlap 参与元素 / must_have_elements / region attest 元素 /
 * 交互目标（测试步骤触达）/ UI kit block 实例锚点。动态列表行、纯装饰/OCR 噪声节点不
 * 进分母（全量分母会海量误报 + 反向激励：spec 越细覆盖率越低、B 类越易 SKIP）。
 * 交互节点类型启发式仅作 nav 配置缺失时的透明回退（新分母优先测步骤 by_id 触达）。 */
const LOCATOR_INTERACTIVE_TYPES = new Set([
  'primary_button', 'selector_group', 'sms_code_field', 'list_selection', 'nav_bar',
  'sheet_scaffold', 'list_row', 'tab_bar', 'input_field', 'action_button',
]);

export function collectLocatorRequiredElements(
  screen: import('../../../harness/scripts/utils/ui-spec-shared').UiSpecScreen,
  identityIds: ReadonlySet<string>,
  opts?: {
    /** 测试步骤触达（仅本屏 by_id 集合；递归提取 selector 内 by_id）；缺省空 */
    navStepIds?: ReadonlySet<string>;
    /** region attest 元素（仅本屏 visual-diff.json region_attest[].region）；缺省空 */
    attestRegions?: ReadonlySet<string>;
    /**
     * 显式区分「nav 配置不存在」与「nav 存在但本屏无触达」（review P1）：
     * - nav 配置**不存在**（feature 级）→ true：交互节点类型启发式作为透明回退；
     * - nav 配置**存在** → false：交互类型启发式**不得**无条件进分母
     *   （触达语义以步骤 by_id 为准；本屏无触达=无交互目标，而非"全部交互"）。
     * 缺省 false（nav 存在语义，安全侧）。
     */
    interactiveFallbackEnabled?: boolean;
  },
): Array<{ elementId: string; reason: string }> {
  const out: Array<{ elementId: string; reason: string }> = [];
  const seen = new Set<string>();
  const add = (id: string, reason: string): void => {
    const t = id.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push({ elementId: t, reason });
  };
  const walk = (n: import('../../../harness/scripts/utils/ui-spec-shared').UiSpecComponentNode): void => {
    const rec = n as { id?: unknown; type?: unknown; block?: unknown; bbox?: unknown };
    if (typeof rec.id === 'string' && rec.id.trim()) {
      if (identityIds.has(rec.id.trim())) add(rec.id, 'identity_anchor');
      // plan e6b3f8d2 t3：原有一条「`node.block`（UI kit block 实例声明）→ locator-required」
      // 分支，随 `block` 字段与强制 kit 一并**删除**。刻意**不**平移到通用 `type`：那会把
      // S6 特意收窄过的分母重新放宽（结构语义类型恒入分母，nav 在场时也拿交互类型凑分母），
      // 属于用新约束替换旧约束——本轮只删错误约束。这些节点照常经 identity / nav 触达 /
      // bbox / 交互回退四条既有规则参与判定。
      else if (opts?.navStepIds?.has(rec.id.trim())) add(rec.id, 'nav_step_target');
      else if (Array.isArray(rec.bbox) && rec.bbox.length >= 4) add(rec.id, 'bbox_geometry_target');
      else if (opts?.interactiveFallbackEnabled && typeof rec.type === 'string' && LOCATOR_INTERACTIVE_TYPES.has(rec.type)) {
        add(rec.id, 'interactive');
      }
    }
    for (const c of n.children ?? []) walk(c);
  };
  if (screen.root) walk(screen.root);
  // forbidden-overlap / protected_region 参与元素（A1 断言对/保护区——缺 locator 则声明永不生效）
  for (const pair of screen.forbidden_overlap ?? []) {
    if (Array.isArray(pair)) for (const id of pair) if (typeof id === 'string') add(id, 'forbidden_overlap_participant');
  }
  for (const id of screen.protected_region ?? []) {
    if (typeof id === 'string') add(id, 'forbidden_overlap_participant');
  }
  for (const mh of screen.must_have_elements ?? []) add(mh, 'must_have');
  for (const r of opts?.attestRegions ?? []) add(r, 'region_attest_element');
  return out;
}

/** nav 2.0 identity 的 id 成员集合（locator-required 分母输入；nav 缺失 → 空集） */
export function collectNavIdentityIdMembers(projectRoot: string, feature: string): Set<string> {
  const out = new Set<string>();
  try {
    const v2 = loadVisualDiffNavConfigV2(projectRoot, feature);
    for (const entry of Object.values(v2?.screens ?? {})) {
      for (const group of [entry.identity?.all_of, entry.identity?.any_of, entry.identity?.none_of]) {
        for (const m of group ?? []) {
          if (typeof m.id === 'string' && m.id.trim()) out.add(m.id.trim());
        }
      }
    }
  } catch { /* nav 不可读 → 空集 */ }
  return out;
}

/** nav 2.0 存在性（feature 级）——决定交互类型启发式是否可作回退（review P1：
 * nav 已存在时不得无条件用交互类型凑分母）。 */
export function navConfigExists(projectRoot: string, feature: string): boolean {
  try {
    return loadVisualDiffNavConfigV2(projectRoot, feature) !== null;
  } catch {
    return false;
  }
}

/** 递归提取任意 nav 步骤对象内的 `by_id`（含 within.by_id / scroll_to.in.by_id 等嵌套形态）。 */
function collectByIdsDeep(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectByIdsDeep(v, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const rec = value as Record<string, unknown>;
  const byId = rec['by_id'];
  if (typeof byId === 'string' && byId.trim()) out.add(byId.trim());
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'by_id') continue;
    collectByIdsDeep(v, out);
  }
}

/**
 * nav 2.0 **各屏**测试步骤中 by_id 触达的交互目标（locator-required「测试步骤触达」分母，
 * **按 screen_id 隔离**——A 屏的步骤不得进 B 屏分母）。
 * 语义=该屏步骤真正要 touch/wait 的元素；导航配置缺失 → 空 Map。
 */
export function collectNavStepTargetIdsByScreen(
  projectRoot: string,
  feature: string,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  try {
    const v2 = loadVisualDiffNavConfigV2(projectRoot, feature);
    for (const [screenId, entry] of Object.entries(v2?.screens ?? {})) {
      const ids = new Set<string>();
      for (const step of entry.steps) collectByIdsDeep(step, ids);
      if (ids.size > 0) out.set(screenId, ids);
    }
  } catch { /* nav 不可读 → 空 Map */ }
  return out;
}

/**
 * 既有 visual-diff.json 中 region_attest[].region 的集合（locator-required「region attest
 * 元素」分母；critic 承诺逐区域举证的对象须可 locator）。**按 screen_id 隔离**——A 屏的
 * attest 区域不得进 B 屏分母；无报告/不可解析 → 空 Map。
 */
export function collectRegionAttestElementIdsByScreen(
  projectRoot: string,
  feature: string,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  try {
    const jsonPath = path.join(
      featureDir(projectRoot, feature),
      'device-testing',
      'device-screenshots',
      'visual-diff.json',
    );
    if (!fs.existsSync(jsonPath)) return out;
    const rep = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as {
      screens?: Array<{ screen_id?: unknown; region_attest?: Array<{ region?: unknown; method?: unknown }> }>;
    };
    for (const s of rep.screens ?? []) {
      if (typeof s.screen_id !== 'string' || !s.screen_id.trim()) continue;
      const regions = new Set<string>();
      for (const a of s.region_attest ?? []) {
        if (a.method === 'human') continue;
        if (typeof a.region === 'string' && a.region.trim()) regions.add(a.region.trim());
      }
      if (regions.size > 0) out.set(s.screen_id.trim(), regions);
    }
  } catch { /* 报告不可读 → 空 Map（calibrate 数据面不阻断） */ }
  return out;
}

/** 五轮 P1-3：逐模块收集某 key 的全部 media 匹配（去 first-match——A 模块真素材不豁免 B 模块占位/坏图）；
 * 六轮 P1-3：restrictPkgPaths=按 $r 实际引用模块限定（未引用模块的同名残留不入债务分母）。 */
export function findAllModuleMediaFiles(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
  key: string,
  restrictPkgPaths?: ReadonlySet<string>,
): string[] {
  const canonRestrict = restrictPkgPaths ? new Set([...restrictPkgPaths].map(canonicalPkgPath)) : null;
  const out: string[] = [];
  for (const mod of contracts.modules ?? []) {
    if (canonRestrict && !canonRestrict.has(canonicalPkgPath(mod.package_path))) continue;
    const hit = findModuleMediaFile(projectRoot, contracts, key, new Set([mod.package_path]));
    if (hit) out.push(hit);
  }
  return [...new Set(out)];
}

/** 供 harness / 白盒单测调用 */
export function checkVisualParity(ctx: CheckContext): CheckResult[] {
  const enforcement = ctx.visualParityEnforcement as VisualEnforcementMode | undefined;
  const desc = ruleDesc(ctx, 'structure_checks', 'visual_parity');
  const uiSpecRel = relFeatureFile(ctx.projectRoot, ctx.feature, 'spec/ui-spec.yaml');

  if (ctx.skipVisualParity) {
    return [{
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: '已跳过 visual parity（--skip-visual-parity）',
      affected_files: [uiSpecRel],
    }];
  }

  if (enforcement === 'off') {
    return [{
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: 'framework.config.json 中 coding.visual_parity_enforcement=off',
      affected_files: [uiSpecRel],
    }];
  }

  const specMd = loadSpecMarkdown(ctx);
  const uiChange = specMd ? parseUiChangeFromSpecMarkdown(specMd) : null;
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }

  const doc = loadUiSpecFile(path.join(featureDir(ctx.projectRoot, ctx.feature), 'spec', 'ui-spec.yaml'));
  if (!doc) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `${uiSpecRel} 不存在，无法做 parity 核对。`,
      affected_files: [uiSpecRel],
    }];
  }

  const baselineUnverified = (doc.verified ?? 'unverified') === 'unverified';
  const backstopIssues = runVisualParityBackstop(ctx, doc, baselineUnverified);
  const issues = backstopIssues.map(i => i.detail);

  const boundaryNote =
    '【背板】visual_parity 仅保留 C2 语义色绑定 + C3 must_have_elements presence；保真信号见 static_fidelity_score 与 device visual_diff。';
  const baselineNote = baselineUnverified
    ? '【基线未校验】ui-spec verified=unverified：以下仅为结构 presence，非保真结论。'
    : '';

  const results: CheckResult[] = [];

  if (issues.length > 0) {
    const soft = !isHardPixelContract(ctx) && (enforcement === 'warn' || enforcement === 'reachable');
    const ratchet = isHardPixelContract(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : structureFailOrWarn(enforcement);
    const { severity, status } = soft
      ? { severity: 'MAJOR' as const, status: 'WARN' as const }
      : ratchet;
    results.push({
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [baselineNote, boundaryNote, issues.join('；')].filter(Boolean).join('\n'),
      affected_files: [uiSpecRel, relFeatureFile(ctx.projectRoot, ctx.feature, 'contracts.yaml')],
    });
  } else {
    results.push({
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: [baselineNote, boundaryNote, 'C2 语义色绑定 + C3 must_have 均已通过'].filter(Boolean).join('\n'),
      affected_files: [uiSpecRel],
    });
  }

  // G3 Slice 3：variant 静态轻启发式（WARN/低置信，仅早警；可靠核对走 device visual-diff）
  const variantIssues = collectVariantParityIssues(ctx, doc, baselineUnverified);
  if (variantIssues.length > 0) {
    results.push({
      id: 'visual_parity_variant',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: ['【启发式·低置信，以 device visual-diff 为准】', ...variantIssues.map(i => i.detail)].join('\n'),
      suggestion: '核对按钮填充与 variant 是否一致；最终以真机 visual-diff 像素核对为准。',
      affected_files: [uiSpecRel],
    });
  }

  // v3 渲染忠实度：声明 width_ratio/align 几何 + tonal 填充 vs 源码渲染。
  // P1-A（f2d8c4a6）升级：这些是**源码静态可判**项（定位不到 Button/色值时收集器已保守跳过，
  // 产出的 issue 均为确定性命中）——pixel_1to1 P0 从"低置信 WARN 以 device 为准"升 BLOCKER。
  // round6 实证：按钮声明 width_ratio=0.28 却源码 .width('100%')，本门禁抓到了却只 WARN，正确信号被降级丢失。
  const renderIssues = collectRenderFaithfulnessIssues(ctx, doc, baselineUnverified);
  if (renderIssues.length > 0) {
    const { severity, status } = isHardPixelContract(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'visual_parity_render',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        isHardPixelContract(ctx)
          ? '【渲染忠实度·pixel_1to1 阻断：spec 声明的静态可判几何/填充未按声明渲染】'
          : '【渲染忠实度·低置信，以 device visual-diff 为准】',
        ...renderIssues.map(i => i.detail),
      ].join('\n'),
      suggestion:
        '按 spec 声明渲染：width_ratio≤0.6/align=end 的按钮不得 .width(\'100%\')/layoutWeight(1)；' +
        'variant=tonal 不得高饱和实心 backgroundColor。真正静态不可判的场景收集器已跳过、由 device 兜。',
      affected_files: [uiSpecRel],
    });
  }

  // t1（plan c6d8f2b4）：pixel_1to1 P0 屏声明元素须在源码设 `.id('<element_id>')`——
  // T8 布局 locator 的主方案锚（t0③ 实证 ArkUI .id() 透传 hypium dump id/key）。
  // 终态诊断 WARN：缺 .id 不产生产品错误判定、只降 locator 覆盖率（device 侧 B 类 SKIP+WARN 另有兜底）。
  if (isHardPixelContract(ctx)) {
    const contracts = ctx.featureSpec?.contracts;
    if (contracts) {
      const scan = scanFeatureSourceTree(ctx.projectRoot, contracts);
      const sourceText = scan.etsFiles.map(f => {
        try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; }
      }).join('\n');
      // S6（visual-capability-truth P1-H calibrate，e9c4a7f3 s6-locator-calibrate 重开）：
      // 分母=locator-required 七类集（identity 锚点 id 成员 / bbox 几何断言目标 /
      // forbidden-overlap 参与元素 / must_have_elements / region attest 元素 /
      // 交互目标（测试步骤触达）/ UI kit block 实例锚点）——动态列表行、纯装饰/OCR
      // 噪声节点不进分母（全量分母会海量误报 + 反向激励：spec 越细覆盖率越低）。
      // 终态诊断：WARN + 覆盖率落盘（locator-coverage.json）；宿主两 run 只回灌分母/夹具，
      // 不预留 <80% 自动升 BLOCKER。定位覆盖率是断言能力量测，不直接表达产品质量或 visual-debt。
      const identityIds = collectNavIdentityIdMembers(ctx.projectRoot, ctx.feature);
      // nav 触达 / region attest **按屏隔离**；interactive 类型启发式仅 nav 缺失时回退
      const navStepIdsByScreen = collectNavStepTargetIdsByScreen(ctx.projectRoot, ctx.feature);
      const attestByScreen = collectRegionAttestElementIdsByScreen(ctx.projectRoot, ctx.feature);
      const interactiveFallbackEnabled = !navConfigExists(ctx.projectRoot, ctx.feature);
      const missingIds: string[] = [];
      let requiredTotal = 0;
      let requiredCovered = 0;
      for (const s of doc.screens ?? []) {
        if (s.priority !== 'P0') continue;
        for (const el of collectLocatorRequiredElements(s, identityIds, {
          navStepIds: navStepIdsByScreen.get(s.id),
          attestRegions: attestByScreen.get(s.id),
          interactiveFallbackEnabled,
        })) {
          requiredTotal++;
          const idRe = new RegExp(`\\.id\\(\\s*['"\`]${el.elementId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]\\s*\\)`);
          if (idRe.test(sourceText)) requiredCovered++;
          else missingIds.push(`${s.id}/${el.elementId}`);
        }
      }
      const coverage = requiredTotal > 0 ? requiredCovered / requiredTotal : 1;
      try {
        const covPath = path.join(featurePhaseReportsDir(ctx.projectRoot, ctx.feature, 'coding', ctx.frameworkRoot), 'locator-coverage.json');
        fs.mkdirSync(path.dirname(covPath), { recursive: true });
        fs.writeFileSync(covPath, `${JSON.stringify({
          schema_version: '1.0',
          denominator: 'locator_required_v1',
          required_total: requiredTotal,
          required_covered: requiredCovered,
          coverage: Number(coverage.toFixed(4)),
          missing: missingIds,
          at: new Date().toISOString(),
        }, null, 2)}\n`, 'utf-8');
      } catch { /* 覆盖率落盘失败不阻断（calibrate 数据面） */ }
      if (missingIds.length > 0) {
        results.push({
          id: 'visual_parity_element_id_lint',
          category: 'structure',
          description: desc,
          severity: 'MAJOR',
          status: 'WARN',
          details:
            `【t1 locator 锚缺失（终态诊断 WARN；分母=locator-required 集）】` +
            `P0 屏 locator-required 覆盖率 ${(coverage * 100).toFixed(0)}%（${requiredCovered}/${requiredTotal}）；缺 .id：` +
            `${missingIds.slice(0, 12).join(', ')}${missingIds.length > 12 ? ` …共 ${missingIds.length} 处` : ''}\n` +
            `缺 .id 时 T8 布局断言退化到文本锚/结构匹配（歧义即 SKIP）；宿主两 run 仅回灌分母与夹具，不设自动 BLOCKER 升级。`,
          suggestion: '在对应 ArkUI 组件链上加 .id(\'<element_id>\')（与 ui-spec 元素 id 一致）；identity 锚点/交互目标/must_have 优先。',
          affected_files: [uiSpecRel],
        });
      }
    }
  }

  // P1-A（f2d8c4a6）：可见文案白名单——源码/string.json 渲染文本 ⊆ spec 文本集 ∪ 豁免表（须 rationale）。
  {
    const refDoc = loadRefElementsFile(refElementsAbsPath(ctx.projectRoot, ctx.feature));
    const specTexts = collectSpecTextUniverse(doc, refDoc?.elements ?? null);
    const visibleTextIssues = collectVisibleTextIssues(ctx, specTexts, baselineUnverified);
    if (visibleTextIssues.length > 0) {
      const { severity, status } = isHardPixelContract(ctx)
        ? fidelityRatchetFailOrWarn(ctx, false)
        : { severity: 'MAJOR' as const, status: 'WARN' as const };
      results.push({
        id: 'visible_text_whitelist',
        category: 'structure',
        description: desc,
        severity,
        status,
        details: [
          '【可见文案白名单·P1-A】源码渲染的用户可见文本不在 spec 文本集——原图没有的文案不得无中生有：',
          ...visibleTextIssues.map(i => i.detail),
          '【边界】动态拼接/变量文本静态不可判（漏报归 device 回环）；无 CJK 技术字符串不查。',
        ].join('\n'),
        suggestion:
          '逐条处置：文本确在原图 → 回 spec 补 ref-elements/ui-spec（走 capture_completeness_external）；' +
          `确属功能必需的非原图文案（toast/错误提示等）→ 登记 ${relFeatureFile(ctx.projectRoot, ctx.feature, 'coding/visible-text-exemptions.yaml')}` +
          '（entries[].text/rationale，无 rationale 不生效，review 视觉维度会复核）；纯脑补 → 删除。',
        affected_files: [uiSpecRel],
      });
    }
  }

  // s1 asset 真渲染：声明 asset_ref 却未 $r 引用 media（catches #6 tab 仅文字）
  // v23 F4 收窄：静态"没找到渲染引用"本就低置信（动态渲染/间接引用会漏判）——**一律 WARN**，
  // 不再按档位升 BLOCKER。刚删掉不可靠指标（score_floor/blank_ratio），不再引入另一个
  // 不可靠硬门禁；"实际页面未渲染"交给**新鲜的** visual-diff must_fix（回修环消费）。
  const assetIssues = collectAssetRenderIssues(ctx, doc, baselineUnverified);
  if (assetIssues.length > 0) {
    const severity = 'MAJOR' as const;
    const status = 'WARN' as const;
    results.push({
      id: 'visual_parity_asset_render',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        '【asset 真渲染·低置信，以 device visual-diff 为准】',
        ...assetIssues.map(i => i.detail),
      ].join('\n'),
      suggestion: '声明 asset_ref 的元素须在对应组件 $r 引用并渲染该 media（如 tab 图标）；动态渲染/显式 placeholder 可豁免。',
      affected_files: [uiSpecRel],
    });
  }

  // B s1.5 asset 物化真图校验：被 $r('app.media.*') 引用的【模块实际】media 必须是真图，禁 1×1/退化占位冒充。
  // v23 F4：**档位无关 FAIL**——"被引用的非占位素材物化缺失/损坏/空白/纯色"是确定性事实
  //（collectPlaceholderAssetIssues 已豁免显式 placeholder 声明），best_effort 档同样有害：
  // 2026-07-24 事故正是 best_effort 下删真素材换占位、一路漏到用户眼前。
  const materializeIssues = collectPlaceholderAssetIssues(ctx, doc, baselineUnverified);
  if (materializeIssues.length > 0) {
    const severity = 'BLOCKER' as const;
    const status = 'FAIL' as const;
    results.push({
      id: 'visual_parity_asset_materialized',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        '【asset 物化真图校验】被 $r 引用的模块 media 须为真图（非 1×1/退化占位）；以 <module>/src/main/resources/base/media 为准，不信 contracts/根 media path。',
        ...materializeIssues.map(i => i.detail),
      ].join('\n'),
      suggestion: '把 ui-spec assets[].resolved_path 的真裁图复制进引用模块 <module>/src/main/resources/base/media/<key>.<ext>；缺真图须显式 placeholder + 用户知情，禁占位冒充。',
      affected_files: [uiSpecRel],
    });
  }

  // P0-B（f2d8c4a6）：物化前置依赖裁剪验真——spec 的 asset-crop-validation.json 里未 verified 的 crop
  // 资产不得被源码消费/物化进模块 media（废图 204×2938 竖条正是这样进的 media）。报告缺失=spec 未跑新门禁。
  {
    const unverified = collectUnverifiedCropLines(ctx.projectRoot, ctx.feature, doc, {
      contracts: ctx.featureSpec.contracts ?? undefined,
    });
    if (unverified.length === 0) {
      // cursor 深度 review P2（债务闭账）同 bug 类：violation-only → 债务永不闭账；零违例落 PASS
      results.push({
        id: 'visual_parity_unverified_crop',
        category: 'structure',
        description: desc,
        severity: 'MAJOR',
        status: 'PASS',
        details: '物化前置裁剪验真扫描已执行：无未 verified 的 crop 资产被消费/物化。',
      });
    }
    if (unverified.length > 0) {
      const { severity, status } = isHardPixelContract(ctx)
        ? fidelityRatchetFailOrWarn(ctx, false)
        : { severity: 'MAJOR' as const, status: 'WARN' as const };
      results.push({
        id: 'visual_parity_unverified_crop',
        category: 'structure',
        description: desc,
        severity,
        status,
        details: [
          '【P0-B 物化前置】crop 资产须先过 spec 阶段 asset_crop_validation（source/hash/bbox/tool/output 绑定 + sanity/VL 机器复验）才可物化进模块 media：',
          ...unverified.map(l => `  ${l}`),
        ].join('\n'),
        suggestion:
          '回 spec 阶段：修 bbox（过 ui_spec_bbox_semantic）→ 重裁 → 过 asset_crop_validation（verified）后再物化；' +
          '不得绕过验真直接把 crop 复制进 resources/base/media。',
        affected_files: [uiSpecRel],
      });
    }
  }


  // blind-visual-hardening d2（P0-B②）：物化 sanity——进入模块 media 的素材按 role 分档跑
  // 内容检测；brand-critical 空白/纯色/损坏 → BLOCKER **档位无关**（bc-openCard 二轮：
  // 23 张渲染不可见 placeholder 仅 WARN 放行的直接解药——档位管"像不像"，本检查管"有没有"）。
  {
    const contracts = ctx.featureSpec.contracts;
    if (contracts) {
      const sanityViolations: Array<{ line: string; critical: boolean; key: string }> = [];
      // 六轮 P1-3：按 $r 实际引用模块限定（未引用模块的同名残留占位/坏图不入债务，
      // brand-critical 不被无关残留误阻发布）；无引用记录的 key 回退全模块（兜未扫到的引用形态）。
      const refModulesByKey = scanResourceRefModules(ctx.projectRoot, contracts);
      for (const a of (doc.assets ?? []) as UiSpecAsset[]) {
        if (!a?.key) continue;
        const refs = refModulesByKey.get(resourceKeyToRef(a.key, 'media'));
        const matches = findAllModuleMediaFiles(ctx.projectRoot, contracts, a.key, refs && refs.size > 0 ? refs : undefined);
        if (matches.length === 0) continue; // 未物化——物化存在性归 visual_parity_asset_materialized
        const derived = deriveAssetRole(a, doc);
        const criticality = deriveAssetCriticality(derived.role, doc);
        if (derived.declaredMismatch) {
          sanityViolations.push({ key: a.key, line: `  - ${a.key}：${derived.declaredMismatch}`, critical: false });
        }
        for (const mediaAbs of matches) {
          const assess = assessMaterializedFile(mediaAbs, derived.role);
          const rel = path.relative(ctx.projectRoot, mediaAbs).replace(/\\/g, '/');
          if (assess.status !== 'pass') {
            // 三态处置（codex 实施 review P1-5 fail-closed）：fail=确定性违例；
            // unverified（jimp 缺失/统计失败）brand-critical 同样 BLOCKER——统计没跑≠已验。
            sanityViolations.push({
              key: a.key,
              line: `  - ${a.key}（role=${derived.role}/${criticality}，${assess.status}，${rel}）：${assess.reasons.join('；')}`,
              critical: criticality === 'brand_critical',
            });
          }
        }
      }
      if (sanityViolations.length === 0) {
        // cursor 深度 review P2（债务闭账）：violation-only 产出会让 deriveVisualDebt 恒走
        // "本轮缺席→单调保留"分支——修好后债务永不 closed。扫描已执行且零违例=明确 PASS，
        // 必须落结果供账本闭账（annotateAssetTriState 三态同理消费）。
        results.push({
          id: 'asset_materialization_sanity',
          category: 'structure',
          description: desc,
          severity: 'MAJOR',
          status: 'PASS',
          details: `物化 sanity 扫描已执行，零违例（阈值版本 ${ASSET_SANITY_THRESHOLD_VERSION}）。`,
        });
      } else {
        const anyCritical = sanityViolations.some(v => v.critical);
        results.push({
          id: 'asset_materialization_sanity',
          category: 'structure',
          description: desc,
          // brand-critical 命中（fail 或 unverified）→ BLOCKER/FAIL 不分档位；仅普通素材/role 失配 → MAJOR/WARN
          severity: anyCritical ? 'BLOCKER' : 'MAJOR',
          status: anyCritical ? 'FAIL' : 'WARN',
          details: [
            `【P0-B 物化 sanity·role 分档（阈值版本 ${ASSET_SANITY_THRESHOLD_VERSION}）】空白/纯色/损坏素材在任何保真档位都不是合法交付物；内容统计未执行（unverified）不作已验放行：`,
            ...sanityViolations.map(v => v.line),
            '【边界】近纯色仅判 brand_logo/illustration（单色 icon/mask 合法）；role/criticality 为机器派生，agent 声明失配不作数。',
          ].join('\n'),
          suggestion:
            '用真实素材替换，或在 harness 目录执行占位生成 CLI（正式入口）：' +
            `npm run asset:placeholders -- --project-root <宿主根> --feature ${ctx.feature} --apply` +
            '（brand_logo→文字头像 SVG / illustration→中性插画框 / decoration→中性块；禁空白 PNG）；' +
            'unverified=修复 jimp 环境（npm install）后重跑；brand-critical 素材仍为占位时 release 保持 BLOCKED。',
          affected_files: [uiSpecRel],
          // 债务逐素材粒度消费面（visual-debt scopesOf）
          structured: { kind: 'asset_sanity', assets: [...new Set(sanityViolations.map(v => v.key))] },
        });
      }
    }
  }

  // blind-visual-hardening 四轮 P0-1：占位在场检测——maison 占位 SVG（provenance marker）
  // 可见、sanity 会 PASS，但**占位≠素材已供给**：逐素材 WARN 入视觉债务（needs_fix），
  // brand-critical 占位 → release 经债务链保持 BLOCKED（直至真素材替换或人工验收 receipt）。
  // 五轮 P1-3：**全模块匹配**（first-match 会漏掉"A 模块真素材、B 模块占位"的实际引用模块）。
  {
    const contracts = ctx.featureSpec.contracts;
    if (contracts) {
      const placeholderHits: Array<{ key: string; kind: string; critical: boolean }> = [];
      const refModulesByKey = scanResourceRefModules(ctx.projectRoot, contracts);
      for (const a of (doc.assets ?? []) as UiSpecAsset[]) {
        if (!a?.key) continue;
        const refs = refModulesByKey.get(resourceKeyToRef(a.key, 'media'));
        const matches = findAllModuleMediaFiles(ctx.projectRoot, contracts, a.key, refs && refs.size > 0 ? refs : undefined);
        const marked = matches.map(m => detectPlaceholderMarker(m)).find(m => m !== null);
        if (!marked) continue;
        const derived = deriveAssetRole(a, doc);
        placeholderHits.push({
          key: a.key,
          kind: marked.kind,
          critical: deriveAssetCriticality(derived.role, doc) === 'brand_critical',
        });
      }
      if (placeholderHits.length === 0) {
        // cursor 深度 review P2（债务闭账）：同 asset_materialization_sanity——零占位=明确 PASS 落结果
        results.push({
          id: 'asset_placeholder_present',
          category: 'structure',
          description: desc,
          severity: 'MAJOR',
          status: 'PASS',
          details: '占位在场扫描已执行：未检出 maison 占位素材。',
        });
      } else {
        results.push({
          id: 'asset_placeholder_present',
          category: 'structure',
          description: desc,
          severity: 'MAJOR',
          status: 'WARN',
          details: [
            `【占位在场】${placeholderHits.length} 项素材当前为 maison 占位（可见但≠真素材）：`,
            ...placeholderHits.map(h => `  - ${h.key}（${h.kind}${h.critical ? '，brand-critical' : ''}）`),
            '占位入视觉债务；brand-critical 占位 release 保持 BLOCKED，只有真素材替换并经责任阶段机器重验才可清偿。',
          ].join('\n'),
          suggestion:
            '真素材到位后放置到对应 resolved_path/media 路径重跑，机器重验通过后自动闭账；人工验收不能清偿占位债务。',
          affected_files: [uiSpecRel],
          structured: { kind: 'asset_sanity', assets: placeholderHits.map(h => h.key) },
        });
      }
    }
  }

  // S7（visual-capability-truth P2-J.3）：资产实例绑定四段链（静态三段）——
  // node.asset_ref → assets[key] → 物化文件；不同 asset_ref 解析到同一文件 = 实例复用
  // 冲突（bc-openCard 多银行同 logo 形态——业务字段不入规格，此处纯通用链判定）。
  {
    const contracts = ctx.featureSpec.contracts;
    if (contracts) {
      const byFile = new Map<string, Set<string>>();
      const walkRefs = (n: import('../../../harness/scripts/utils/ui-spec-shared').UiSpecComponentNode): void => {
        const ref = (n as { asset_ref?: unknown }).asset_ref;
        if (typeof ref === 'string' && ref.trim()) {
          const file = findModuleMediaFile(ctx.projectRoot, contracts, ref.trim());
          if (file) {
            const set = byFile.get(file) ?? new Set<string>();
            set.add(ref.trim());
            byFile.set(file, set);
          }
        }
        for (const c of n.children ?? []) walkRefs(c);
      };
      for (const s of doc.screens ?? []) if (s.root) walkRefs(s.root);
      const collisions = [...byFile.entries()].filter(([, refs]) => refs.size > 1);
      if (collisions.length > 0) {
        results.push({
          id: 'asset_instance_binding',
          category: 'structure',
          description: desc,
          severity: 'MAJOR',
          status: 'WARN',
          details: [
            '【资产实例绑定冲突】不同 asset_ref 解析到同一物化文件（声明了不同实例、渲染同一素材）：',
            ...collisions.slice(0, 6).map(([file, refs]) =>
              `  - ${path.relative(ctx.projectRoot, file).replace(/\\/g, '/')} ← {${[...refs].join(', ')}}`,
            ),
          ].join('\n'),
          suggestion: '为各实例落各自素材文件（key 与文件一一对应），或收敛声明为同一 asset_ref（确属同素材时）。',
          affected_files: [uiSpecRel],
        });
      }
    }
  }

  // plan e6b3f8d2 t3：三段闭环·源码段随强制 Maison UI kit 一并撤销——framework 不再
  // 规定宿主源码形态（组件实现/vendoring 落点/锚点注入）。源码结构证据继续由本文件
  // 既有的 presence/结构相似度检查与 plan 侧所有权硬地板承接。

  // 透明节点假 presence 拦截（codex 发现的对抗模式，2026-07-03）：spec 文本/资产/符号引用挂在
  // 字面硬不可见节点（opacity(0)/visibility None|Hidden/双零尺寸/fontSize(0)）＝骗静态 presence 扫描。
  // 不 gate baselineUnverified（纯源码形态作弊，与 spec 校验状态无关）。
  {
    const invisibleIssues = collectInvisiblePresenceIssues(ctx);
    if (invisibleIssues.length > 0) {
      const { severity, status } = isHardPixelContract(ctx)
        ? fidelityRatchetFailOrWarn(ctx, false)
        : { severity: 'MAJOR' as const, status: 'WARN' as const };
      results.push({
        id: 'visual_parity_invisible_presence',
        category: 'structure',
        description: desc,
        severity,
        status,
        details: [
          '【透明节点假 presence】spec 语义引用挂在硬不可见节点上——引用在、渲染无，属对抗静态门禁的作弊：',
          ...invisibleIssues.map(i => i.detail),
          '【边界】仅判字面硬不可见（变量/动画绑定不判，漏报归 device OCR 存在性观测兜）。',
        ].join('\n'),
        suggestion:
          '删除透明占位节点：元素该渲染就真实可见渲染（真图标/真文本）；实现不了就走 ui-spec 显式' +
          ' placeholder / best_effort 债务——strict pixel contract 不接受人签 defer；透明冒充比缺失更恶劣（掩盖问题且污染结构/无障碍语义）。',
        affected_files: [uiSpecRel],
      });
    }
  }

  // round5 P0-A：素材原子化——被 $r 引用的非 placeholder 素材图不得烤入 ui-spec 声明文本（整段大图 → 双渲染/烤字）。
  const bakedText = collectBakedTextAssetIssues(ctx, doc, baselineUnverified);
  if (bakedText.issues.length > 0) {
    const { severity, status } = isHardPixelContract(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'visual_parity_asset_baked_text',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        '【素材原子化·P0-A】素材图内烤入 ui-spec 声明文本＝整段界面当背景大图，会与真实组件双渲染/烤字：',
        ...bakedText.issues.map(i => i.detail),
      ].join('\n'),
      suggestion:
        '把整段大图重裁为原子插画（仅图形、无声明文本）；文字/交互控件/底部 tab 用真实组件渲染。装饰文本不得同时登记为 UI text 节点。',
      affected_files: [uiSpecRel],
    });
  }
  // round5 P0-A/X4：OCR 是烤字门禁唯一承重探测；pixel_1to1 下不可用不得 WARN 放行 → toolchain BLOCKER（指向"修 OCR 环境"，见 goal-failure-classifier）。
  if (bakedText.ocrUnavailable) {
    const { severity, status } = isHardPixelContract(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'visual_parity_ocr_unavailable',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        '【P0-A OCR 不可用】烤字门禁的 OCR 承重探测不可用/失败（tesseract.js 未装或 chi_sim 未物化，或素材图 OCR 失败）——pixel_1to1 下无法核验素材是否烤字，不得放行。',
      suggestion:
        '修复 OCR 环境：确认 harness 已装 tesseract.js 且 profiles/hmos-app/vendor/tessdata/chi_sim.traineddata 已物化；恢复后重跑（此 id 归 toolchain，signature 重复则按工具链阻塞终止本 run）。',
      affected_files: [uiSpecRel],
    });
  }

  // round5 P0-B（Q5 采纳）：声明 required 品牌图标却用 sys.symbol 系统单色图标静默替代 → pixel_1to1 BLOCKER（含全局底 tab 图标）。
  const iconSubIssues = collectIconSubstitutionIssues(ctx, doc, baselineUnverified);
  if (iconSubIssues.length > 0) {
    const { severity, status } = isHardPixelContract(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'visual_parity_icon_substitution',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        '【图标替代·P0-B】ui-spec 声明 required 品牌图标(icon.kind=brand_logo/illustration)，源码却用 sys.symbol 系统单色图标替代：',
        ...iconSubIssues.map(i => i.detail),
      ].join('\n'),
      suggestion:
        '有品牌识别度的图标（app logo/银行 logo/营销图）使用机器可验证 source/hash 的原子素材并 $r(app.media.<key>) 渲染；标准语义图标按 P0-E 分型规则声明 system_symbol；仅允许的 placeholder 需保留 debt，release-required 项不得靠署名放行。',
      affected_files: [uiSpecRel],
    });
  }

  // a2 通用 spec 质量：pixel_1to1 P0 action_button 须声明 variant（低优先 WARN，非本案修复路径）
  const variantDeclIssues = collectActionButtonVariantDeclIssues(ctx, doc, baselineUnverified);
  if (variantDeclIssues.length > 0) {
    results.push({
      id: 'visual_parity_variant_decl',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: ['【通用 spec 质量·低置信】', ...variantDeclIssues.map(i => i.detail)].join('\n'),
      suggestion: 'pixel_1to1 P0 屏 action_button 须声明 variant（filled|tonal|outlined|ghost|text）以承载形态保真。',
      affected_files: [uiSpecRel],
    });
  }

  // static fidelity score (K)
  results.push(...computeStaticFidelityScore(ctx, doc, baselineUnverified));

  // P1-4①（c9e2a7f4 子批B）：结构声明台账——消灭"spec 声明被 coding 静默无视"
  results.push(...checkStructureDeclarationLedger(ctx));

  return results;
}
