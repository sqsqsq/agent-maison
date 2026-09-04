// ============================================================================
// hylyre-result-protocol.ts — Maison 消费 Hylyre 结果协议的**唯一** parse/dispatch 边界
// ----------------------------------------------------------------------------
// plan a6c4e9f2 T7a / Hylyre 需求文 P0-17。所有 required gate 只消费本模块产出的 typed
// view，**不允许**任何 helper 自行猜 schema——那正是 0.3-p0 时代 12 处字面守卫 + 6 处隐式
// fallback 的来源（见 inventory §一/§二）。
//
// 三类结果，缺一不可：
//   v1                      → typed 消费
//   legacy_unsupported      → 只允许非阻断诊断，绝不闭合 evidence
//   unsupported             → 显式 BLOCKER（未知 / 缺失 / 版本与协议不一致）
// **禁止**第四种"静默不适用"：不返回 []、不 SKIP、不 no-op，也不回退中文 CaseResult.status、
// 0.3 flat 字段、tool_calls、日志或退役 telemetry 去闭合证据。
//
// 本模块只建**最小 typed view**：判别 dispatch 键、收窄到消费所需的形状。它不复制一套平行
// Schema——完整 variant 校验由冻结包 `output-schema.json` + golden fixtures + reference
// reducer 在测试侧承担（fixtures/hylyre-contracts-0.4-p0/）。
// ============================================================================

/** 正式 v1 的两个判别键，必须同时在 trace root 与 environment 出现且一致。 */
export const V1_TRACE_SCHEMA_VERSION = '0.4-p0';
export const V1_RESULT_PROTOCOL = 'hylyre.step-outcome/1';

/** 只读诊断可用、绝不闭合 evidence 的历史 schema。 */
export const LEGACY_UNSUPPORTED_SCHEMA_VERSIONS = ['0.3-p0', '0.2-p4', '0.1-p0'] as const;

// ---------------------------------------------------------------------------
// v1 typed view（字段形状取自冻结包 output-schema.json，tree 623d6c5f…40c4）
// ---------------------------------------------------------------------------

export type FailureDomainV1 =
  | 'contract' | 'selector' | 'assertion' | 'capability' | 'infrastructure' | 'internal';

export interface FailureV1 {
  domain: FailureDomainV1;
  /** namespaced，首段等于 domain */
  code: string;
  facts?: Record<string, unknown>;
}

export type CauseTypeV1 = 'prior_step' | 'capability' | 'infrastructure';

export interface CauseV1 {
  type: CauseTypeV1;
  /** 仅 prior_step */
  step_index?: number;
  /** 仅 capability / infrastructure */
  code?: string;
  capability_id?: string;
  provider_id?: string;
  facts?: Record<string, unknown>;
}

export interface ReasonV1 {
  type: 'policy' | 'not_applicable';
  code: string;
  facts?: Record<string, unknown>;
}

export interface ObservationV1 {
  kind: 'action' | 'assertion';
  operation?: string;
  performed?: boolean;
  assertion_type?: string;
  matched?: boolean;
  facts?: Record<string, unknown>;
}

export type StepOutcomeV1 =
  | { status: 'passed'; observation: ObservationV1 }
  | { status: 'failed'; failure: FailureV1; observation?: ObservationV1 }
  | { status: 'blocked'; cause: CauseV1 }
  | { status: 'skipped'; reason: ReasonV1 };

export type ResolutionStateV1 =
  | 'not_attempted' | 'not_found' | 'unique' | 'ambiguous' | 'unresolvable';

export interface SelectorSelectedV1 {
  id: string | null;
  bounds?: string | null;
}

export interface SelectorResolutionV1 {
  state: ResolutionStateV1;
  candidate_count: number | null;
  selected: SelectorSelectedV1 | null;
  candidates: unknown[];
  /** 仅 unresolvable */
  reason_code?: string;
  facts?: Record<string, unknown>;
}

export interface SelectorRequestV1 {
  kind: string;
  value: string;
  match?: string | null;
  constraints?: Record<string, unknown>;
}

export interface SelectorV1 {
  request: SelectorRequestV1;
  resolution: SelectorResolutionV1;
}

export interface ArtifactRefV1 {
  kind: 'screenshot' | 'ui_dump' | 'visible_elements' | 'log' | string;
  /** 严格相对路径。基准待 Hylyre 确认（inventory §八 Q5）——**在确认前不得解析成文件系统路径**。 */
  path: string;
  sha256: string;
  bytes?: number;
}

export interface StepResultV1 {
  index: number;
  kind: string;
  role: 'action' | 'assertion';
  duration_ms: number;
  device_session: unknown;
  outcome: StepOutcomeV1;
  selector: SelectorV1 | null;
  artifacts: ArtifactRefV1[];
  diagnostic: string | null;
  extensions: Record<string, unknown>;
}

export interface CaseResultV1 {
  id: string;
  name?: string;
  /** legacy 中文兼容投影：**必然在场，但禁止用于任何裁决**（inventory §八 Q4）。 */
  status: '通过' | '失败' | '阻塞' | '跳过';
  priority: string;
  ac_ref: string;
  notes: string;
  execution: 'completed' | 'aborted' | 'infrastructure_failed';
  verification: 'passed' | 'failed' | 'inconclusive';
  evidence: 'complete' | 'incomplete';
  expected_check_mode: 'checked_vlm' | 'disabled_by_flag' | 'unavailable_no_vlm' | 'empty';
  steps: StepResultV1[];
}

export interface TraceV1 {
  schema_version: typeof V1_TRACE_SCHEMA_VERSION;
  result_protocol: typeof V1_RESULT_PROTOCOL;
  feature: string;
  phase: string;
  outcome: 'success' | 'partial' | 'failed' | 'aborted';
  environment: {
    hylyre_version: string;
    hypium_version: string;
    trace_schema_version: typeof V1_TRACE_SCHEMA_VERSION;
    result_protocol: typeof V1_RESULT_PROTOCOL;
    selector_engine: string;
  };
  cases: CaseResultV1[];
  tool_calls: unknown[];
}

import { validateLiteSchema } from './lite-json-schema';
import { loadHylyreOutputSchema } from './hylyre-contract-schema';
import { verifyTraceCrossRow } from './hylyre-crossrow-verifier';

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

export type HylyreResultDispatch =
  | { kind: 'v1'; trace: TraceV1 }
  | { kind: 'legacy_unsupported'; schemaVersion: string; detail: string }
  | { kind: 'unsupported'; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 判别一份 trace 属于哪一类。**只判 dispatch 键**，不在此做 variant 结构校验——
 * 结构与跨行校验由 `requireV1ForGate` 在本函数之后执行（生产期，不只是测试期）。
 * 直接用本函数的调用方只拿到"信封属于哪一类"，**不得据此闭合任何 required gate**。
 *
 * v1 必须**同时**满足四点，任一不符即 `unsupported`——版本与协议不一致比未知更危险，
 * 它意味着产出方自己就不自洽。
 */
export function dispatchHylyreResult(raw: unknown): HylyreResultDispatch {
  if (!isRecord(raw)) {
    return { kind: 'unsupported', detail: 'trace 不是 JSON object，无法判别 schema/protocol' };
  }
  const schemaVersion = str(raw.schema_version);
  if (!schemaVersion) {
    return { kind: 'unsupported', detail: 'trace 缺 schema_version，无法判别结果协议' };
  }
  const env = isRecord(raw.environment) ? raw.environment : null;
  const rootProtocol = str(raw.result_protocol);
  const envSchema = env ? str(env.trace_schema_version) : null;
  const envProtocol = env ? str(env.result_protocol) : null;

  if (schemaVersion === V1_TRACE_SCHEMA_VERSION) {
    const mismatches: string[] = [];
    if (rootProtocol !== V1_RESULT_PROTOCOL) {
      mismatches.push(`root.result_protocol=${rootProtocol ?? '(缺失)'}，期望 ${V1_RESULT_PROTOCOL}`);
    }
    if (envSchema !== V1_TRACE_SCHEMA_VERSION) {
      mismatches.push(`environment.trace_schema_version=${envSchema ?? '(缺失)'}，期望 ${V1_TRACE_SCHEMA_VERSION}`);
    }
    if (envProtocol !== V1_RESULT_PROTOCOL) {
      mismatches.push(`environment.result_protocol=${envProtocol ?? '(缺失)'}，期望 ${V1_RESULT_PROTOCOL}`);
    }
    if (!Array.isArray(raw.cases)) mismatches.push('缺 cases[]');
    if (mismatches.length > 0) {
      return {
        kind: 'unsupported',
        detail: `schema_version=${V1_TRACE_SCHEMA_VERSION} 但协议声明不自洽：${mismatches.join('；')}`,
      };
    }
    return { kind: 'v1', trace: raw as unknown as TraceV1 };
  }

  if ((LEGACY_UNSUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(schemaVersion)) {
    // 冻结契约要求 legacy 不得携带 v1 协议声明；带了说明产出方混装，比单纯 legacy 更危险。
    if (rootProtocol !== null || envProtocol !== null) {
      return {
        kind: 'unsupported',
        detail: `legacy schema_version=${schemaVersion} 却声明了 result_protocol——混装产物，拒绝消费`,
      };
    }
    return {
      kind: 'legacy_unsupported',
      schemaVersion,
      detail: `schema_version=${schemaVersion} 属 legacy，unsupported-for-evidence：只允许非阻断诊断，不得闭合任何 required gate`,
    };
  }

  return {
    kind: 'unsupported',
    detail: `未知 trace schema_version=${schemaVersion}（正式协议为 ${V1_TRACE_SCHEMA_VERSION} + ${V1_RESULT_PROTOCOL}）`,
  };
}

// ---------------------------------------------------------------------------
// required gate 的统一裁决入口
// ---------------------------------------------------------------------------

export interface RequiredGateVerdict {
  /** 只有 true 时才允许消费 typed view 闭合证据 */
  ok: boolean;
  trace: TraceV1 | null;
  /** ok=false 时的 BLOCKER 文案（已含处置方向） */
  detail: string;
  suggestion: string;
}

/**
 * **所有 required testing gate 的唯一入口。**
 *
 * 这是 inventory §一/§二 那 12 处字面守卫 + 6 处隐式 fallback 的替代品：它们各自
 * `if (schema !== '0.3-p0') return []` 的写法，等于让门禁在 schema 不匹配时静默消失——
 * 0.3-p0 时代真实发生过（`testing_case_execution_completeness` 与 selector runtime gate
 * 都会 fail-open）。这里把三态收敛成一个 boolean + 一段可直接上报的文案，
 * **不存在"静默不适用"的返回形态**。
 *
 * 诊断类 helper 不要用它——它们应在本函数已判 ok=false 后自行选择不适用，
 * 而不是自己去判 schema。
 *
 * 三层判据，逐层 fail-closed（T4 返修新增后两层）：
 *   1. dispatch 键（schema_version / result_protocol / environment 一致性）；
 *   2. **冻结 `output-schema.json` 运行期校验**，schema 取自随发布件下发的 vendored contracts；
 *   3. **跨行不变量**（prior_step 根引用、CaseResult 三轴反推、run outcome、
 *      candidate_count 复算、tool_calls 投影），判据移植自冻结包 reference_reducer。
 * 只做第 1 层等于类型断言：实测 `cases:[{}]` 能过，0.3 flat 步骤套 v1 信封也能过。
 */
export interface RequireV1Options {
  /**
   * 发布件/仓库根，用于定位 `profiles/<profile>/vendor/hylyre/.../output-schema.json`。
   * 省略时从本模块位置向上推断。
   */
  frameworkRoot?: string | null;
}

/** 单条错误列表截断上限——BLOCKER 文案要能读，不是把 54 条全糊上去。 */
const MAX_REPORTED_VIOLATIONS = 8;

function summarize(items: string[]): string {
  const head = items.slice(0, MAX_REPORTED_VIOLATIONS).join('；');
  return items.length > MAX_REPORTED_VIOLATIONS
    ? `${head}；……（共 ${items.length} 条）`
    : head;
}

export function requireV1ForGate(raw: unknown, options: RequireV1Options = {}): RequiredGateVerdict {
  const dispatched = dispatchHylyreResult(raw);
  if (dispatched.kind === 'v1') {
    // ── 信封对了不等于内容对。以下两层缺一层，required gate 就是假的：
    //    实测 `{schema_version,result_protocol,environment,cases:[{}]}` 曾直接 ok=true，
    //    而 0.3 flat 步骤套 v1 信封同样能过——那正是必须被拒的形态。
    const schemaLoad = loadHylyreOutputSchema(options.frameworkRoot);
    if (!schemaLoad.ok) {
      return { ok: false, trace: null, detail: schemaLoad.detail, suggestion: schemaLoad.suggestion };
    }
    const schemaViolations = validateLiteSchema(raw, schemaLoad.schema);
    if (schemaViolations.length > 0) {
      return {
        ok: false,
        trace: null,
        detail:
          `trace 声明了 ${V1_TRACE_SCHEMA_VERSION} + ${V1_RESULT_PROTOCOL}，但不符冻结 output-schema.json：` +
          summarize(schemaViolations.map(v => `${v.path} ${v.message}`)),
        suggestion:
          '这是产出方与冻结契约不一致，不是消费侧口径问题。用同一 native run 重新产出合契约的 trace；' +
          '不得手工补字段、不得把 0.3 flat 步骤套进 v1 信封。',
      };
    }
    // 跨行不变量：schema 表达不了，但冻结包自带可执行 oracle。
    // 实测 golden/trace/invalid-crossrow 13 条全部能过 schema——只做 schema 就等于给这 13 类放行。
    const crossRow = verifyTraceCrossRow(dispatched.trace);
    if (crossRow.length > 0) {
      return {
        ok: false,
        trace: null,
        detail: `trace 合 schema 但违反 Step Outcome v1 跨行不变量：${summarize(crossRow)}`,
        suggestion:
          'CaseResult 三轴/run outcome/tool_calls 都是 steps[] 的派生投影，prior_step 必须指向真实根。' +
          '请修产出方的 reducer（判据见 vendor contracts/reference_reducer.py），不要改消费侧门禁。',
      };
    }
    return { ok: true, trace: dispatched.trace, detail: '', suggestion: '' };
  }
  if (dispatched.kind === 'legacy_unsupported') {
    return {
      ok: false,
      trace: null,
      detail:
        `authoritative trace 是 legacy schema（${dispatched.schemaVersion}），` +
        'unsupported-for-evidence：它不能闭合任何 required testing gate。',
      suggestion:
        `升级 Hylyre 到产出 ${V1_TRACE_SCHEMA_VERSION} + ${V1_RESULT_PROTOCOL} 的版本后重跑 testing；` +
        '不得用旧 case status、flat 字段、tool_calls、日志或退役 telemetry 顶替。',
    };
  }
  return {
    ok: false,
    trace: null,
    detail: `authoritative trace 的结果协议无法消费：${dispatched.detail}`,
    suggestion:
      `required gate 对未知/错配协议一律 fail-closed。请用同一 native run 重新产出 ` +
      `${V1_TRACE_SCHEMA_VERSION} + ${V1_RESULT_PROTOCOL} 的 trace；不得从 telemetry/log 合成。`,
  };
}

// ---------------------------------------------------------------------------
// D1：selector 身份事实的消费判据
// ---------------------------------------------------------------------------

export type SelectorIdentityVerdict =
  /** resolution 证明了一次真实的唯一命中，可作为 selected-target identity 证据 */
  | { kind: 'proven'; identity: SelectorSelectedV1 }
  /** 没有身份证据：既不判失败，也不给 identity credit */
  | { kind: 'unproven'; detail: string }
  /** resolution 自身违反冻结不变量 */
  | { kind: 'invalid'; detail: string };

/**
 * 只回答「这条 resolution 是否证明了实际选中的 target 身份」，**不回答步骤成败**。
 * 成败由 `outcome` 裁决（plan D1）——本函数绝不能被用来把一个 passed 改判失败。
 *
 * 冻结不变量（Phase 0 §6，tree 623d6c5f…40c4）：
 *   not_attempted → null/null；not_found → 0/null；unique → 1/selected；
 *   ambiguous → >=2/null；unresolvable → int|null/null + reason_code + facts。
 * `unique` 另需 `id`/`bounds` 至少一个非空，且禁止把 request.value 回填成 selected.id。
 */
export function evaluateSelectorIdentity(selector: SelectorV1 | null): SelectorIdentityVerdict {
  if (!selector) return { kind: 'unproven', detail: '该步骤没有 selector（无 selector 的 operation）' };
  const { request, resolution } = selector;
  if (!resolution) return { kind: 'invalid', detail: 'selector 缺 resolution' };

  switch (resolution.state) {
    case 'not_attempted':
      if (resolution.candidate_count !== null || resolution.selected !== null) {
        return { kind: 'invalid', detail: 'not_attempted 必须 candidate_count=null 且 selected=null' };
      }
      // native provider 侧解析时，身份对执行器不可见是**合法**的（Phase 0 §6.1）。
      return { kind: 'unproven', detail: 'resolution=not_attempted：执行器未取得 selector 身份事实' };

    case 'not_found':
      if (resolution.candidate_count !== 0 || resolution.selected !== null) {
        return { kind: 'invalid', detail: 'not_found 必须 candidate_count=0 且 selected=null' };
      }
      // 零候选是事实，不是身份证明；通过的 absence 断言正是这个形态。
      return { kind: 'unproven', detail: 'resolution=not_found：resolver 确认零候选，无身份可证' };

    case 'unique': {
      if (resolution.candidate_count !== 1) {
        return { kind: 'invalid', detail: `unique 必须 candidate_count=1，实际 ${String(resolution.candidate_count)}` };
      }
      const selected = resolution.selected;
      if (!selected) return { kind: 'invalid', detail: 'unique 必须携带非空 selected' };
      const id = str(selected.id);
      const bounds = str(selected.bounds ?? null);
      if (!id && !bounds) {
        return { kind: 'invalid', detail: 'unique 的 selected 必须至少有一个非空 id 或 bounds（禁止 contentless selected）' };
      }
      if (id && request && id === request.value && request.kind !== 'by_id' && request.kind !== 'by_key') {
        // 反回填：0.4.1 的病就是把请求值回显成 selected_id 冒充身份。
        return {
          kind: 'invalid',
          detail:
            `selected.id 回显了 request.value=${id}，但 request.kind=${request.kind} 不是 by_id/by_key：` +
            '这是计划步骤的形状问题（by_text 或带 visible/enabled/index 等谓词的复合选择器不构成 id 身份证据）。' +
            `改法：身份断言用裸 {"wait_for":{"by_id":"${id}","timeout":N}}（harness 按 acceptance checkpoint 自动注入），UX 谓词断言另写一步。`,
        };
      }
      return { kind: 'proven', identity: selected };
    }

    case 'ambiguous':
      if ((resolution.candidate_count ?? 0) < 2 || resolution.selected !== null) {
        return { kind: 'invalid', detail: 'ambiguous 必须 candidate_count>=2 且 selected=null' };
      }
      return { kind: 'unproven', detail: 'resolution=ambiguous：多候选未消歧，无唯一身份' };

    case 'unresolvable':
      if (resolution.selected !== null) {
        return { kind: 'invalid', detail: 'unresolvable 必须 selected=null' };
      }
      if (!str(resolution.reason_code) || !resolution.facts) {
        return { kind: 'invalid', detail: 'unresolvable 必须携带 namespaced reason_code 与结构化 facts' };
      }
      return { kind: 'unproven', detail: `resolution=unresolvable（${resolution.reason_code}）` };

    default:
      return { kind: 'invalid', detail: `未知 resolution.state=${String((resolution as { state?: unknown }).state)}` };
  }
}
