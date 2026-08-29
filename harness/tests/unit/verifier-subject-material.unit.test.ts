// ============================================================================
// verifier-subject-material.unit.test.ts — subject 输入面的"物质性"契约
// ============================================================================
// review P1-2 的守门套。旧实现对**最终自由文本**叠 ISO 时间戳正则，两头都不准：
//   · 抓不到 `耗时 1234 ms` 这类非 ISO 的 runner telemetry → 零改动重跑也换代 subject
//     → "跑完 verifier 再跑一次 harness 关环"必然失效（自锁，与 plan v2 P1-1 同类）；
//   · 却会抹掉业务正文里真实的 ISO 截止时间 → 该换代时反而不换。
// 现在改为在**格式化之前**从结构化事实里排除 telemetry（canonicalScriptReportDigest）
// + 由装配侧同源产出 prompt 语义摘要。本套直接钉这两个方向。
//
// 契约出处：openspec/changes/verifier-evidence-identity/specs/feature-artifact-layout
// 「无物质变化不换代 / 有物质变化必换代」。
// ============================================================================

import {
  canonicalScriptReportDigest,
  computeVerifierSubjectId,
  type VerifierSubjectInputs,
} from '../../scripts/utils/verifier-subject';
import { renderDetailsWithTelemetry } from '../../scripts/utils/check-telemetry';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * 与生产 ScriptReport 同形的最小骨架。**details 一律经生产 helper 产出**——这正是
 * 生产端纪律（profiles/hmos-app 的编译/UT check 同款）：耗时留给人读，material 拿占位符。
 */
function scriptReport(opts: {
  timestamp: string;
  durationMs: number;
  utStatus?: string;
  projectRoot?: string;
  failureKind?: string;
  actionability?: string;
  affectedFiles?: string[];
  source?: string;
  structured?: unknown;
  /** 语义正文（非遥测）——用来构造"details 真变了"的一档 */
  prose?: string;
}): Record<string, unknown> {
  return {
    phase: 'ut',
    feature: 'demo',
    timestamp: opts.timestamp,
    project_root: opts.projectRoot ?? 'D:/hosts/demo',
    assurance: 'full',
    capability_resolutions: [],
    capability_resolution_contract_fingerprint: 'cap-fp-1',
    checks: [
      {
        id: 'ut_tsc_compiles',
        category: 'structure',
        description: 'UT tsc 编译',
        severity: 'BLOCKER',
        status: opts.utStatus ?? 'PASS',
        // 生产真实形态：profiles/hmos-app/harness/ut-host-impl.ts
        ...renderDetailsWithTelemetry(
          (tel) => `3 个 UT 文件 tsc --noEmit 通过（耗时 ${tel}）。${opts.prose ?? ''}`,
          `${opts.durationMs} ms`,
        ),
        ...(opts.failureKind ? { failure_kind: opts.failureKind } : {}),
        ...(opts.actionability ? { actionability: opts.actionability } : {}),
        ...(opts.affectedFiles ? { affected_files: opts.affectedFiles } : {}),
        ...(opts.source ? { source: opts.source } : {}),
        ...(opts.structured ? { structured: opts.structured } : {}),
      },
      {
        id: 'ut_hvigor_build',
        category: 'structure',
        description: 'ohosTest 模块编译',
        severity: 'BLOCKER',
        status: 'PASS',
        ...renderDetailsWithTelemetry(
          (tel) => `全部 2 个 ohosTest 模块 hvigor 编译通过（累计耗时 ${tel}）。`,
          `${opts.durationMs * 7} ms`,
        ),
      },
    ],
    summary: { total: 2, pass: 2, fail: 0, warn: 0, blockers: 0, verdict: 'PASS' },
  };
}

function subjectOf(over: Partial<VerifierSubjectInputs>): string {
  return computeVerifierSubjectId({
    feature: 'demo',
    phase: 'ut',
    script_report_material: null,
    ai_prompt_material: null,
    gate_fingerprint: '3.0.0:abcdef123456',
    source_commit_sha: 'c0ffee',
    worktree_digest: 'deadbeefdeadbeef',
    ...over,
  });
}

// --------------------------------------------------------------------------
// A. runner telemetry 变化**不得**换代（否则零改动重跑即自锁）
// --------------------------------------------------------------------------
function caseA_telemetryDoesNotRotate(): void {
  const first = canonicalScriptReportDigest(
    scriptReport({ timestamp: '2026-08-29T01:00:00.000Z', durationMs: 1234 }),
  );
  const second = canonicalScriptReportDigest(
    scriptReport({ timestamp: '2026-08-29T02:34:56.789Z', durationMs: 5678 }),
  );
  assert(first !== null && second !== null, '骨架应可投影');
  assert(
    first === second,
    '墙钟时间戳与耗时都属 runner telemetry，零改动重跑不得换代 subject（旧实现在这里换代 → 自锁）',
  );
  assert(subjectOf({ script_report_material: first }) === subjectOf({ script_report_material: second }), 'subject 同样不得换代');

  // 绝对路径同属 telemetry：同一份产物在另一台机器上跑不应换代。
  const elsewhere = canonicalScriptReportDigest(
    scriptReport({ timestamp: '2026-08-29T01:00:00.000Z', durationMs: 1234, projectRoot: '/home/ci/demo' }),
  );
  assert(elsewhere === first, 'project_root 是机器相关 telemetry，不得参与 subject');
}

// --------------------------------------------------------------------------
// B. 真实门禁事实变化**必须**换代
// --------------------------------------------------------------------------
function caseB_materialChangeRotates(): void {
  const base = canonicalScriptReportDigest(
    scriptReport({ timestamp: '2026-08-29T01:00:00.000Z', durationMs: 1234 }),
  );
  const flipped = canonicalScriptReportDigest(
    scriptReport({ timestamp: '2026-08-29T01:00:00.000Z', durationMs: 1234, utStatus: 'FAIL' }),
  );
  assert(base !== flipped, 'check 状态翻转是门禁事实变化，必须换代');
  assert(
    subjectOf({ script_report_material: base }) !== subjectOf({ script_report_material: flipped }),
    'subject 必须随门禁事实换代',
  );
}

// --------------------------------------------------------------------------
// E. 状态不变，但**失败归因 / 文件 / 来源 / 结构化载荷 / 正文**变化 → 必须换代
// --------------------------------------------------------------------------
function caseE_semanticFieldsRotate(): void {
  const base = () =>
    canonicalScriptReportDigest(
      scriptReport({
        timestamp: '2026-08-29T01:00:00.000Z',
        durationMs: 1234,
        utStatus: 'WARN',
        failureKind: 'ut_stub_missing',
        actionability: 'agent_fixable',
        affectedFiles: ['a/A.test.ets'],
        source: 'check-ut.ts',
        structured: { kind: 'ut_probe', hits: 1 },
      }),
    );
  const b = base();

  // 逐个字段消融：每一项都是 verifier 实际会读到、并据此判断的机器事实。
  const variants: Array<[string, Record<string, unknown>]> = [
    ['failure_kind', { failureKind: 'ut_contract_drift' }],
    ['actionability', { actionability: 'human_only' }],
    ['affected_files', { affectedFiles: ['b/B.test.ets'] }],
    ['source', { source: 'profile:hmos-app' }],
    ['structured', { structured: { kind: 'ut_probe', hits: 9 } }],
    ['details 语义正文', { prose: '另有 3 处存量断言需人工确认。' }],
  ];
  for (const [label, over] of variants) {
    const changed = canonicalScriptReportDigest(
      scriptReport({
        timestamp: '2026-08-29T01:00:00.000Z',
        durationMs: 1234,
        utStatus: 'WARN',
        failureKind: 'ut_stub_missing',
        actionability: 'agent_fixable',
        affectedFiles: ['a/A.test.ets'],
        source: 'check-ut.ts',
        structured: { kind: 'ut_probe', hits: 1 },
        ...over,
      }),
    );
    assert(
      changed !== b,
      `${label} 变化必须换代 subject——它是 verifier 实际会读到的机器事实；` +
        '曾经的四字段白名单（id/status/severity/blocking_class）把它整组漏掉了，' +
        '意味着 ai-prompt.md 真变了、subject 却不变，旧 PASS 被错误复用',
    );
  }
}

// --------------------------------------------------------------------------
// F. 只有 telemetry 变化（且生产端已按纪律拆分）→ 不得换代
// --------------------------------------------------------------------------
function caseF_telemetryOnlyDoesNotRotate(): void {
  const common = {
    utStatus: 'WARN' as const,
    failureKind: 'ut_stub_missing',
    actionability: 'agent_fixable',
    affectedFiles: ['a/A.test.ets'],
    source: 'check-ut.ts',
    structured: { kind: 'ut_probe', hits: 1 },
  };
  const a = canonicalScriptReportDigest(
    scriptReport({ timestamp: '2026-08-29T01:00:00.000Z', durationMs: 11, ...common }),
  );
  const b = canonicalScriptReportDigest(
    scriptReport({ timestamp: '2026-08-29T09:59:59.999Z', durationMs: 987654, ...common }),
  );
  assert(
    a === b,
    '语义字段全同、只有耗时与墙钟不同 → 不得换代（否则零改动重跑即自锁）；' +
      '这依赖生产端经 renderDetailsWithTelemetry 把遥测拆进 details_material',
  );
}

// --------------------------------------------------------------------------
// G. 生产端**漏用** helper 时的诚实行为：遥测直接入 details → 会换代
// --------------------------------------------------------------------------
function caseG_unsplitTelemetryRotatesHonestly(): void {
  const mk = (ms: number) => ({
    phase: 'ut',
    feature: 'demo',
    checks: [{ id: 'x', status: 'PASS', severity: 'MINOR', details: `跑了 ${ms} ms` }],
    summary: { total: 1, pass: 1 },
  });
  assert(
    canonicalScriptReportDigest(mk(1)) !== canonicalScriptReportDigest(mk(2)),
    '未经 renderDetailsWithTelemetry 拆分的遥测会照常入 subject —— 这是刻意的诚实行为：' +
      '消费端不再猜正则，代价是生产端必须守纪律。本用例把该代价钉成可见契约，' +
      '任何新 check 内嵌易变量却漏用 helper，都会在其所在阶段表现为"每跑必换代"',
  );
}

// --------------------------------------------------------------------------
// H. **顶层**同样是排除式：现在与将来的顶层字段变化都必须换代
// --------------------------------------------------------------------------
function caseH_topLevelIsExclusionBased(): void {
  // check 层修好之后，顶层一度仍是手写白名单（phase/feature/assurance/契约指纹/
  // summary/checks），于是 `capability_resolutions`、`compat_applied`、`compat_expired`
  // 这些真实存在的顶层字段整组不绑定——ai-prompt.md 里的脚本报告已经变了，subject 却不变。
  // 白名单的失败模式是静默的：它对"没听说过的字段"一律不绑定。
  const base = () => ({
    ...scriptReport({ timestamp: '2026-08-29T01:00:00.000Z', durationMs: 1234 }),
    capability_resolutions: [{ id: 'cap_a', state: 'resolved' }],
    compat_applied: [],
    compat_expired: [],
  });
  const b = canonicalScriptReportDigest(base());

  const rotates: Array<[string, Record<string, unknown>]> = [
    ['capability_resolutions', { capability_resolutions: [{ id: 'cap_a', state: 'blocked' }] }],
    ['compat_applied', { compat_applied: ['legacy_prd_alias'] }],
    ['compat_expired', { compat_expired: ['retired_rule_x'] }],
    // 代码尚未认识的顶层字段：排除式的意义正在于此——将来新增字段默认就绑定，
    // 不需要有人记得回来改白名单。
    ['future_semantic（代码尚未认识的新字段）', { future_semantic: { verdict_hint: 'needs_review' } }],
  ];
  for (const [label, over] of rotates) {
    assert(
      canonicalScriptReportDigest({ ...base(), ...over }) !== b,
      `${label} 变化必须换代 subject——它在 ai-prompt.md 的脚本报告里，verifier 实际看得到；` +
        '顶层白名单会静默漏掉它，导致旧 verifier PASS 被沿用',
    );
  }

  // 反向：只有明确 telemetry 变化 → 不得换代。
  assert(
    canonicalScriptReportDigest({
      ...base(),
      timestamp: '2026-08-29T23:59:59.999Z',
      project_root: '/somewhere/else',
    }) === b,
    '顶层 telemetry（timestamp / project_root）是唯一排除面，只有它们变不得换代',
  );
}

// --------------------------------------------------------------------------
// C. prompt 语义内容里的业务时间**必须**换代（旧的 ISO 归一会把它抹掉）
// --------------------------------------------------------------------------
function caseC_businessTimestampRotates(): void {
  // 装配侧交回的是"规范化后的 prompt 语义内容"摘要——业务正文原样在内。
  // 这里直接以两段只差业务截止时间的语义内容做输入，钉住"必须换代"。
  const a = subjectOf({ ai_prompt_material: 'acceptance: 订单在 2026-09-30T23:59:59 后失效' });
  const b = subjectOf({ ai_prompt_material: 'acceptance: 订单在 2026-12-31T23:59:59 后失效' });
  assert(
    a !== b,
    '业务正文里的真实截止时间变化必须换代 subject（旧的"对最终文本叠 ISO 正则"会把它一并抹掉，' +
      '于是需求真变了 subject 却不变——错误地复用了上一轮的 verifier 结论）',
  );
}

// --------------------------------------------------------------------------
// D. 结构畸形输入不崩栈（fail-closed 到 null）
// --------------------------------------------------------------------------
function caseD_malformedInputIsNull(): void {
  assert(canonicalScriptReportDigest(null) === null, 'null → null');
  assert(canonicalScriptReportDigest('nope') === null, '非对象 → null');
  const noChecks = canonicalScriptReportDigest({ phase: 'ut', feature: 'demo' });
  assert(typeof noChecks === 'string', '缺 checks 仍应产出确定性摘要，而不是抛栈');
}

const CASES: Array<{ name: string; fn: () => void }> = [
  { name: 'A runner telemetry（时间戳/耗时/绝对路径）变化不得换代 subject', fn: caseA_telemetryDoesNotRotate },
  { name: 'B 门禁事实（check 状态）变化必须换代 subject', fn: caseB_materialChangeRotates },
  { name: 'E 状态不变但失败归因/文件/来源/结构化载荷/正文变化 → 必须换代', fn: caseE_semanticFieldsRotate },
  { name: 'F 只有 telemetry 变化（生产端已拆分）→ 不得换代', fn: caseF_telemetryOnlyDoesNotRotate },
  { name: 'G 生产端漏用 telemetry helper 时诚实换代（纪律可见化）', fn: caseG_unsplitTelemetryRotatesHonestly },
  { name: 'H 顶层排除式：capability_resolutions/compat_*/未知新字段必换代，仅 telemetry 不换代', fn: caseH_topLevelIsExclusionBased },
  { name: 'C prompt 语义内容里的业务时间变化必须换代 subject', fn: caseC_businessTimestampRotates },
  { name: 'D 结构畸形的 script-report 投影为 null，不崩栈', fn: caseD_malformedInputIsNull },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      c.fn();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
