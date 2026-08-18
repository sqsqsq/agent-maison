// ============================================================================
// product-selection.ts — 带用途的编译形态解析（plan a7c3f9e2 t3/t5）
// ============================================================================
//
// 核心契约：**framework 不替宿主决定编译形态；无可信来源时停止，而非猜测。**
// 08-17 宿主事故：framework 去编了一个未经用户确认的 product（rom），而 rom 在 DevEco
// 自己的 UI 里同样编不过；更糟的是猜错而恰好编译成功时会直接签发 PASS。
//
// source 枚举（按优先级，见 plan t5 ②）：
//   1. explicit_run    —— 本次调用显式参数（如 buildCodingHvigorArgs 的 overrides.product）
//   2. confirmed_env   —— 既有 env 覆盖（HARNESS_DEVICE_TEST_PRODUCT；goal 冻结的 testing
//                          product 走同一入口）
//   3. explicit_config —— config 值 **且** local 确认值逐字相等（t3 的可信判据）
//   4. sole_candidate  —— build-profile.json5 **真实声明**只有一个 product，无歧义
//   5. unresolved      —— 构建形态无法确定：**不猜**，由上游转成既有 halt / 阻断结果。
//                        四种原因（unresolvedCause）：multi_candidate_unconfirmed（多候选
//                        且 config 值未确认）/ no_build_profile（build-profile.json5 缺失）/
//                        empty_products（存在但未声明 app.products）/
//                        unparseable_build_profile（无法解析）——后三者**没有真实候选**，
//                        绝不得用虚构 `default` 冒充 sole_candidate（那会重新引入
//                        "猜 default 后错误 PASS"的核心风险）。
//
// 名称启发式（名为 product / default 的首项优先展示）仅用于 **unresolved 时的候选展示
// 排序**，永不产出选定值（plan t5 ④）。
// ============================================================================

import { loadFrameworkConfig } from '../../../harness/config';
import { loadLocalConfig } from '../../../harness/scripts/utils/framework-local-config';
import { probeDeclaredProducts } from './hvigor-runner';

export type ProductSelectionPurpose = 'coding' | 'ut' | 'device_test';

export type ProductSelectionSource =
  | 'explicit_run'
  | 'confirmed_env'
  | 'explicit_config'
  | 'sole_candidate'
  | 'unresolved';

/** unresolved 的原因（review P1：虚构 default 不得冒充 sole_candidate——需如实报告为何无法确定）。 */
export type ProductSelectionUnresolvedCause = 'multi_candidate_unconfirmed' | 'no_build_profile' | 'empty_products' | 'unparseable_build_profile';

export interface ProductSelection {
  /** 选定值；unresolved 时为 null */
  product: string | null;
  source: ProductSelectionSource;
  /** build-profile.json5 声明的全部真实候选（展示排序：product → default → 其余声明序；无虚构兜底） */
  candidates: string[];
  purpose: ProductSelectionPurpose;
  /** unresolved 时的原因；其余 source 为 undefined */
  unresolvedCause?: ProductSelectionUnresolvedCause;
  /** 解析时刻（ms epoch；用于测试断言"构建期间未发生二次解析"） */
  resolvedAt: number;
}

export interface ResolveProductSelectionInput {
  projectRoot: string;
  purpose: ProductSelectionPurpose;
  /** explicit_run：本次调用显式参数 */
  explicitProduct?: string;
  /** confirmed_env：显式 env 覆盖；未传时 device_test 自动读 process.env.HARNESS_DEVICE_TEST_PRODUCT */
  envProduct?: string;
}

/** 已确认形态（unresolved / sole_candidate 不在内）：失败归因可省略"形态未经确认"声明。 */
export const TRUSTED_PRODUCT_SOURCES: ReadonlySet<ProductSelectionSource> = new Set([
  'explicit_run',
  'confirmed_env',
  'explicit_config',
]);

/**
 * 候选展示排序（名称启发式——仅供展示与说明，不产出选定值）：
 * 名为 `product` 的条目优先、其次 `default`、其余按声明序。
 */
export function sortCandidatesForDisplay(names: string[]): string[] {
  const rest = names.filter(n => n !== 'product' && n !== 'default');
  return [
    ...(names.includes('product') ? ['product'] : []),
    ...(names.includes('default') ? ['default'] : []),
    ...rest,
  ];
}

function readPreferredProduct(projectRoot: string): string | null {
  try {
    const cfg = loadFrameworkConfig(projectRoot);
    const pref = cfg.toolchain?.preferredProduct;
    return typeof pref === 'string' && pref.trim().length > 0 ? pref.trim() : null;
  } catch {
    // config 不可读（非法 JSON / 校验失败）→ 视作无 config 值（fail-safe：不当作可信来源）
    return null;
  }
}

/**
 * 单次解析（t5 ⑤）：每个构建作用域只调一次，result 作为**同一个对象**贯穿
 * 构建参数与分类/详情生成（carrier），不落在 metaExtras 等 best-effort 载体上。
 *
 * sole_candidate 只承认 build-profile.json5 **真实声明**恰好一个 product
 * （review P1）：缺失 / 为空 / 不可解析一律 unresolved（stop），
 * 不得用虚构 `default` 冒充 sole_candidate——那会重新引入"猜 default 后错误 PASS"
 * 的核心风险。
 */
export function resolveProductSelection(input: ResolveProductSelectionInput): ProductSelection {
  const purpose = input.purpose;
  const probe = probeDeclaredProducts(input.projectRoot);
  const declaredNames = probe.status === 'ok' ? probe.names : [];
  const candidates = sortCandidatesForDisplay(declaredNames);

  const explicit = input.explicitProduct?.trim();
  if (explicit) {
    return { product: explicit, source: 'explicit_run', candidates, purpose, resolvedAt: Date.now() };
  }

  const env =
    input.envProduct?.trim() ??
    (purpose === 'device_test' ? process.env.HARNESS_DEVICE_TEST_PRODUCT?.trim() : undefined);
  if (env) {
    return { product: env, source: 'confirmed_env', candidates, purpose, resolvedAt: Date.now() };
  }

  // explicit_config：config 值 **且** local 确认值逐字相等（t3 ③）；
  // config 有值但无 local 记录 / 值不等 → legacy_unverified_config，不作为可信来源。
  const pref = readPreferredProduct(input.projectRoot);
  if (pref) {
    try {
      const confirmed = loadLocalConfig(input.projectRoot)?.toolchain?.productSelection?.confirmed;
      if (confirmed && confirmed.value === pref) {
        return { product: pref, source: 'explicit_config', candidates, purpose, resolvedAt: Date.now() };
      }
    } catch {
      // local 损坏/不可读 → 按未确认处理（fail-safe）
    }
  }

  // sole_candidate：**真实声明**恰好一个 product（无歧义）。
  // probe 非 ok（缺失/为空/不可解析）→ unresolved，如实报告原因，绝不用虚构值选定。
  if (probe.status === 'ok' && candidates.length === 1) {
    return { product: candidates[0]!, source: 'sole_candidate', candidates, purpose, resolvedAt: Date.now() };
  }

  const unresolvedCause: ProductSelectionUnresolvedCause =
    probe.status === 'missing'
      ? 'no_build_profile'
      : probe.status === 'unparseable'
        ? 'unparseable_build_profile'
        : candidates.length > 1
          ? 'multi_candidate_unconfirmed'
          : 'empty_products';

  return {
    product: null,
    source: 'unresolved',
    candidates,
    purpose,
    unresolvedCause,
    resolvedAt: Date.now(),
  };
}

/** 报告行（plan t5 ⑦）：`编译形态：product=<X>（来源：<source>）；工程可选：<candidates>` */
export function describeProductSelection(sel: ProductSelection): string {
  const value = sel.product ?? '(unresolved)';
  const available = sel.candidates.length > 0 ? sel.candidates.join(', ') : '(无——build-profile 未声明真实 product)';
  return `编译形态：product=${value}（来源：${sel.source}）；工程可选：${available}`;
}

const UNRESOLVED_CAUSE_TEXT: Record<ProductSelectionUnresolvedCause, string> = {
  multi_candidate_unconfirmed:
    '工程声明了多个 product，且 toolchain.preferredProduct 未经本机确认（framework.local.json 无匹配确认记录）。',
  no_build_profile:
    '工程缺少 build-profile.json5，无法枚举任何真实 product 候选。',
  empty_products:
    'build-profile.json5 存在但未声明任何 product（app.products 缺失或为空）。',
  unparseable_build_profile:
    'build-profile.json5 无法解析，无法枚举真实 product 候选。',
};

/**
 * unresolved 的**一行原因摘要**（失败条目 message / 阻断首句用；完整引导见
 * buildProductSelectionUnresolvedGuidance）。四种原因逐字对 UNRESOLVED_CAUSE_TEXT。
 */
export function summarizeUnresolvedCause(sel: ProductSelection): string {
  const cause = sel.unresolvedCause
    ? UNRESOLVED_CAUSE_TEXT[sel.unresolvedCause]
    : UNRESOLVED_CAUSE_TEXT.multi_candidate_unconfirmed;
  const candidates =
    sel.candidates.length > 0 ? `（候选：${sel.candidates.join(', ')}）` : '（build-profile 无真实候选）';
  return `编译形态无法确定：${cause}${candidates}`;
}

/** unresolved 的统一引导文案（goal halt / harness 阻断 / detectProduct 抛错共用，防三处漂移）。 */
export function buildProductSelectionUnresolvedGuidance(sel: ProductSelection): string {
  const causeLine = sel.unresolvedCause
    ? UNRESOLVED_CAUSE_TEXT[sel.unresolvedCause]
    : UNRESOLVED_CAUSE_TEXT.multi_candidate_unconfirmed;
  const candidateLine =
    sel.candidates.length > 0
      ? `本次可用候选：${sel.candidates.join(', ')}。`
      : '请先修复构建配置（build-profile.json5 声明 app.products），或使用显式来源指定 product。';
  return [
    causeLine,
    'framework 不替宿主猜测编译形态——请显式确认一次：',
    '  1. 交互式：在 framework-init 的 registry `init.product_selection` 选择；',
    `  2. 机器写入：npx ts-node framework/harness/scripts/record-product-selection.ts --project-root <repo-root> --product <候选值>；`,
    '  3. 无人值守（testing 阶段）：HARNESS_DEVICE_TEST_PRODUCT=<候选值>（env 属显式确认，同一入口）。',
    candidateLine,
  ].join('\n');
}