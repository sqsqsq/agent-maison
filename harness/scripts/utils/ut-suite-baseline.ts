// ============================================================================
// ut-suite-baseline.ts — suite 失败基线与棘轮（plan 423e5d0f P1-2 · codex 修正版）
// ============================================================================
// 语义：suite = 真实工具链实际执行的整个测试模块。存量套件可能本来就有失败——
// 不允许它把本 feature 永远拖死，也不允许新增回归被它掩盖。
//
// 基线是**授权工件**，不由本轮执行自动生成——首轮执行发生在 agent 动手之后，
// 用它反推"历史失败"会把本轮新增回归洗进基线（与"基线只认 agent 动手前锚"
// 同一威胁模型）。可信来源只有两个：
//   ① 编排（goal-runner 等）在 agent 动手前真实执行 suite 后写入；
//   ② 用户确认已知历史失败清单后手工放置/维护。
// 裁决：
//   - 无基线 → **不豁免**（全部失败照常 FAIL），suite_health=UNKNOWN，提示建基线的两条正路；
//   - 有基线 → 基线内非 target 失败豁免但报告（DEGRADED）；基线外非 target 失败=回归 FAIL；
//   - **target 用例失败永不豁免**（即使被写进基线）；
//   - 基线只收紧不增长：本轮不再失败的条目自动从基线剔除。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir } from '../../config';

export interface SuiteFailureRecord {
  /** ohosTest 模块名——失败身份的一部分：跨模块同名 suite/test 不得互相豁免 */
  module: string;
  suite: string;
  test: string;
}

export interface SuiteFailureBaseline {
  kind: 'ut_suite_failure_baseline';
  schema_version: '1.0';
  feature: string;
  recorded_at: string;
  /** 基线失败集（记录时已剔除 target 用例） */
  failures: SuiteFailureRecord[];
}

export interface SuiteRatchetVerdict {
  /** UNKNOWN=无可信基线（不豁免任何失败） */
  suiteHealth: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  /** target 用例失败——永不豁免 */
  targetFailures: SuiteFailureRecord[];
  /** 基线内历史失败——豁免但报告 */
  baselineExempt: SuiteFailureRecord[];
  /** 无基线时=全部非 target 失败；有基线时=基线外新增失败——均照常 FAIL */
  newNonTargetFailures: SuiteFailureRecord[];
  baselineAvailable: boolean;
  /** 本轮自动收紧后基线剩余条数（仅在收紧发生时有值） */
  baselineTightenedTo?: number;
}

const BASELINE_FILENAME = 'suite-failure-baseline.json';

function baselinePath(projectRoot: string, feature: string, frameworkRoot?: string): string {
  return path.join(featurePhaseReportsDir(projectRoot, feature, 'ut', frameworkRoot), BASELINE_FILENAME);
}

function failureKey(f: SuiteFailureRecord): string {
  return `${f.module}::${f.suite}::${f.test}`;
}

/** 失败身份 key（module::suite::test）——聚合层与豁免集共用同一口径 */
export function suiteFailureKey(f: SuiteFailureRecord): string {
  return failureKey(f);
}

/**
 * 读授权基线。信任模型（顶层裁定"Stability over total control"）：与 gap-notes
 * approved_src_mutations 同级——普通授权文件 + review 纪律，不做密码学防伪；
 * 结构与 feature 绑定校验只防错拿/错配，不防蓄意伪造。
 * 当前唯一生产来源=用户确认已知历史失败后放置；`writeSuiteFailureBaselineOnce`
 * 供未来编排（agent 动手前真实采样）调用，本轮 checker 不写。
 */
export function readSuiteFailureBaseline(
  projectRoot: string,
  feature: string,
  frameworkRoot?: string,
): SuiteFailureBaseline | null {
  const p = baselinePath(projectRoot, feature, frameworkRoot);
  if (!fs.existsSync(p)) return null;
  try {
    const body = JSON.parse(fs.readFileSync(p, 'utf-8')) as SuiteFailureBaseline;
    if (body.kind !== 'ut_suite_failure_baseline' || !Array.isArray(body.failures)) return null;
    if (body.feature !== feature) return null; // 跨 feature 错配不消费
    if (body.failures.some(f => !f || typeof f.module !== 'string' || typeof f.suite !== 'string' || typeof f.test !== 'string')) {
      return null; // 条目形状不完整（含缺 module 的旧格式）不消费
    }
    return body;
  } catch {
    return null;
  }
}

/**
 * 写基线（授权动作）：仅供 agent 动手前的编排（如 goal-runner 未来的 pre-agent suite 采样）
 * 或用户确认后调用；本轮 checker 内**绝不**调用它（首轮执行在 agent 之后，反推即洗白）。
 * 已存在时不覆盖。
 */
export function writeSuiteFailureBaselineOnce(
  projectRoot: string,
  feature: string,
  failures: SuiteFailureRecord[],
  frameworkRoot?: string,
): boolean {
  const p = baselinePath(projectRoot, feature, frameworkRoot);
  if (fs.existsSync(p)) return false;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const body: SuiteFailureBaseline = {
      kind: 'ut_suite_failure_baseline',
      schema_version: '1.0',
      feature,
      recorded_at: new Date().toISOString(),
      failures,
    };
    fs.writeFileSync(p, JSON.stringify(body, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** 收紧基线（只缩不涨）：本轮不再失败的条目从基线剔除。失败静默（尽力）。 */
function tightenBaseline(
  projectRoot: string,
  feature: string,
  baseline: SuiteFailureBaseline,
  stillFailingKeys: Set<string>,
  frameworkRoot?: string,
): number | undefined {
  const remaining = baseline.failures.filter(f => stillFailingKeys.has(failureKey(f)));
  if (remaining.length >= baseline.failures.length) return undefined;
  try {
    const p = baselinePath(projectRoot, feature, frameworkRoot);
    fs.writeFileSync(
      p,
      JSON.stringify({ ...baseline, failures: remaining, recorded_at: baseline.recorded_at }, null, 2),
      'utf-8',
    );
    return remaining.length;
  } catch {
    return undefined;
  }
}

/** target 用例身份 key（module::test）——与失败身份同口径，跨模块同名不互相误判 */
export function targetCaseKey(moduleName: string, testName: string): string {
  return `${moduleName}::${testName}`;
}

/**
 * 棘轮裁决。**不生成基线**——无可信基线时不豁免任何失败（fail-closed）。
 * @param failures 本轮真实执行的失败用例
 * @param targetKeys 本 feature 责任域用例的 `module::test` 集合——其失败永不豁免
 * @param modulesWithValidResults 本轮**真实跑出用例结果**（total>0）的模块名集合。
 *        收紧基线的唯一条件：基线涉及的**每个**模块都在该集合内——否则"本轮未复现"
 *        可能只是该模块没被选中/没跑到/零用例，删条目=永久丢失历史失败记录。
 */
export function evaluateSuiteRatchet(opts: {
  projectRoot: string;
  feature: string;
  frameworkRoot?: string;
  failures: SuiteFailureRecord[];
  targetKeys: Set<string>;
  modulesWithValidResults: Set<string>;
}): SuiteRatchetVerdict {
  const { projectRoot, feature, frameworkRoot, failures, targetKeys, modulesWithValidResults } = opts;
  const isTarget = (f: SuiteFailureRecord): boolean => targetKeys.has(targetCaseKey(f.module, f.test));
  const targetFailures = failures.filter(isTarget);
  const nonTarget = failures.filter(f => !isTarget(f));

  const baseline = readSuiteFailureBaseline(projectRoot, feature, frameworkRoot);
  if (!baseline) {
    return {
      suiteHealth: 'UNKNOWN',
      targetFailures,
      baselineExempt: [],
      newNonTargetFailures: nonTarget,
      baselineAvailable: false,
    };
  }

  const baseKeys = new Set(baseline.failures.map(failureKey));
  const baselineExempt = nonTarget.filter(f => baseKeys.has(failureKey(f)));
  const newNonTargetFailures = nonTarget.filter(f => !baseKeys.has(failureKey(f)));
  // 收紧的充分条件：基线里出现的每个模块本轮都真实跑出了用例结果。
  // 只要有一个模块没跑到（未选中/链路失败/零用例），整份基线都不收紧——
  // tightenBaseline 过滤的是**整份**基线，误删的是永久丢失的历史记录。
  const baselineModules = new Set(baseline.failures.map(f => f.module));
  const canTighten = [...baselineModules].every(m => modulesWithValidResults.has(m));
  const baselineTightenedTo = canTighten
    ? tightenBaseline(
        projectRoot,
        feature,
        baseline,
        new Set(baselineExempt.map(failureKey)),
        frameworkRoot,
      )
    : undefined;

  return {
    suiteHealth: baselineExempt.length > 0 ? 'DEGRADED' : 'HEALTHY',
    targetFailures,
    baselineExempt,
    newNonTargetFailures,
    baselineAvailable: true,
    baselineTightenedTo,
  };
}
