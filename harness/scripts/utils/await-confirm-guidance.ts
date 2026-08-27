export interface ClosureWallGuidanceOpts {
  feature: string;
  runId: string;
  phase: string;
  /** phase-completion-receipt.md（projectRoot 相对，POSIX） */
  receiptPathRel: string;
  /** consumer='framework/harness'、standalone='harness' */
  harnessPrefixRel: string;
  /** tryValidateReceipt 的最近一次结果（可能为空——只是 script harness 一直 PASS 但没跑过 receipt 校验）。 */
  receiptStatus?: string;
  /** 累计 advance_blocked 次数（含本次），写进话术让人一眼看出"不是第一次了"。 */
  cumulativeBlockedCount: number;
}

/**
 * E4（案B chrys 银行卡实证：8 attempt/4h19m，script 门禁反复 PASS 却关不了环）：
 * 累计出现即进入收敛墙，如实列出 receipt/identity/freshness/closure 故障。质量签名不再是
 * 恢复钥匙；盲重试不能消除同一指纹，只能在修复机器证据/闭环事务或开 successor run 后继续。
 */
export function buildClosureWallGuidance(opts: ClosureWallGuidanceOpts): string[] {
  const { feature, runId, phase, receiptPathRel, harnessPrefixRel, receiptStatus, cumulativeBlockedCount } = opts;
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --force-resume`;
  const verifyCmd = `npm --prefix ${harnessPrefixRel} run check:${phase} -- --feature ${feature}`;
  // t1（plan f3a8c6d2）：**按 receipt 的真实状态给原因，不再统一猜"多为人签"**。
  // 事故（bc-openCard run 20260808T071335Z-4b0136）：receipt 的 verifier_subagent.verdict
  // 其实是 PASS，真因是 claimed_attempt_id 与终局 attempt 失配 + evidence manifest stale，
  // 而本话术开口就说"多为某项只能真人签署的确认"，把人直接引向签字——用户据此以为
  // "只剩视觉验真等我签"。分类复用既有 ReceiptValidation 五态（不新建分类、不加字段）。
  const byStatus: Record<string, string[]> = {
    failed: [
      `  1. 回执**存在但校验未通过**。先看校验输出的 BLOCKER 列表定位真因（不要预设是"人签"）：`,
      `     ${verifyCmd}`,
      '     常见真因：claimed_attempt_id 与本轮 attempt 失配、evidence manifest 非 fresh、',
      '     反假设条款未全勾、verifier 报告缺失/过期。其中 attempt 失配与 stale 都不是人能签掉的。',
      `  2. 若校验输出显示 verifier_subagent.verdict=FAIL，将当前结构化证据回馈责任阶段修复；`,
      `     视觉/裁剪义务只接受 source/hash/tool/provider 机器证据，不得在 ${receiptPathRel} 补签放行。`,
    ],
    missing: [
      `  1. **回执缺失**——agent 没有写出 ${receiptPathRel}。这不是人签问题：`,
      '     让 agent 按阶段完成回执模板补写（含 verifier 调用自证与 attempt 身份），再续跑。',
    ],
    error: [
      '  1. **回执校验探针自身执行失败**（framework/toolchain 问题，非产物问题）。',
      '     不要修改产物或 framework 发布件绕过；修复环境或把完整错误回灌 agent-maison 源仓。',
    ],
    passed: [
      '  1. 回执校验**已通过**却仍未推进——阻塞在 closure 提交侧（phase state / summary closure）。',
      `     跑 ${verifyCmd} 看最终提交环节的报错，不要去补签名。`,
    ],
    not_applicable: [
      '  1. 本 track（lite）**不产生回执**却出现 advance_blocked——runner 状态机不变量违例，',
      '     属框架缺陷，应回灌 agent-maison 源仓核查，不要试图补签或改产物。',
    ],
  };
  const unknownStatus = [
    `  1. 尚无回执校验结果（可能从未跑到该步）。先跑 ${verifyCmd} 取得确定结论，`,
    '     再按其 BLOCKER 列表处置；在拿到结论前不要预设是"只差人签"。',
  ];
  return [
    `【${feature} · run ${runId} · ${phase}】脚本门禁已第 ${cumulativeBlockedCount} 次达到 PASS，但闭环/回执一直未完成` +
      (receiptStatus ? `（receipt_status=${receiptStatus}）` : '') +
      '——同一指纹继续重试只是空转；须先修复机器证据/闭环事务，或在新证据下开 successor run。',
    '',
    '请检查：',
    ...(receiptStatus && byStatus[receiptStatus] ? byStatus[receiptStatus] : unknownStatus),
    '  · 若怀疑是"预算不够、每轮都在做新探索但没收尾"：可提高该 phase 的 phase_timeout_ms 后续跑；',
    '  · 若怀疑是环境/工具链问题（如 OCR 不可用）：先修复环境，问题若随之消失即证实。',
    '',
    `处理完后续跑：${resumeCmd}`,
  ];
}

export interface UnauthorizedMutationGuidanceOpts {
  feature: string;
  runId: string;
  phase: string;
  violations: string[];
  /** 当前 chain 是否同时含 coding 与 review（自动 backtrack 的能力前提）。 */
  chainHasCodingReview: boolean;
  /**
   * plan a5f9c3e2 t3②：保守恢复（失效旧 coding closure 及其后阶段、携未受信 diff 完整
   * 重验）**已是默认路径且不需要人签**。走到本 halt 说明它被结构性前提挡住——
   * 本字段承载具体原因（截断链 / 回退预算耗尽 / 同一 drift 指纹重现）。
   * null=旧调用方或非结构性阻塞。
   */
  conservativeRecoveryBlockedReason?: string | null;
  harnessPrefixRel: string;
}

/**
 * plan e7c2a4d8 T3c：unauthorized_source_mutation 的引导话术——banner/phase_halt 事件/
 * goal-report 单 SSOT。人工 receipt/source authorization 已退役：越权字节只能交 owner
 * 完整重验；当前 run 的结构前提不允许时，新起 coding owner run，不提供签字绕过路径。
 */
export function buildUnauthorizedMutationGuidance(opts: UnauthorizedMutationGuidanceOpts): string[] {
  const {
    feature, runId, phase, violations, chainHasCodingReview, harnessPrefixRel,
    conservativeRecoveryBlockedReason,
  } = opts;
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId}`;
  const lines: string[] = [
    `【${feature} · run ${runId} · ${phase}】检测到非 owner 阶段改写产品源码（旧信任已失效）：`,
    ...violations.map((v) => `  - ${v}`),
    '',
  ];
  if (conservativeRecoveryBlockedReason) {
    // t3②：先讲清「这不是又要签字」——保守恢复本来会自动跑，是结构前提挡住了。
    lines.push(
      '注意：**保守恢复（失效旧 coding closure 及其后阶段、携未受信 diff 完整重验）本是默认',
      '路径且不需要任何人签**——它不跳过验证、也不伪造保证。本次未能自动执行的原因：',
      `  · ${conservativeRecoveryBlockedReason}`,
      '',
    );
  }
  lines.push(
    chainHasCodingReview
      ? `恢复结构具备时 runner 会自动回 coding 全量重验；若本轮已触发预算/指纹熔断，请新起 coding owner run 并 supersede ${runId}。`
      : `当前是截断链，无法在本 run 回到 coding owner；请新起 coding 起点 run 并 supersede ${runId}。`,
    `不要靠签名、approved_by、pre_authorized_mutations 或旧 receipt 接受这些字节；owner 门禁通过后才重新取得信任。`,
    `若只是外部并发写入，停止并发写入后再执行：${resumeCmd}`,
  );
  lines.push(
    '',
    '注意：保留当前工作区字节供 owner 重验；不要为通过门禁而补写人签字段。',
  );
  return lines;
}

// 【已删除 · T2 5a 收口刀（codex P2）】`LineageMismatchGuidanceOpts` / `buildLineageMismatchGuidance`
// ——head 失配已由 decide() 统一 recover（自动 discontinuity 重建，见 goal-runner
// lineageIncidentPresent），失配不再产生任何求人拦截，引导话术无调用方。

export interface BudgetExhaustedGuidanceOpts {
  feature: string;
  runId: string;
  phase: string;
  kind: 'budget_wall_clock' | 'budget_turns';
  /** 已消费活跃时长（ms，wall 口径）——写进话术让人知道预算真用光了而非钟漂。 */
  activeElapsedMs: number;
  /** 预算上限（wall=ms；turns=次数）。 */
  limit: number;
  /** consumer='framework/harness'、standalone='harness' */
  harnessPrefixRel: string;
}

/**
 * plan e7c2a4d8 T2(c)（4035d4 事故：resume→budget_wall_clock→9ms 裸 HALTED，死因
 * 不可见）：budget 熔断的引导话术。措辞铁律（codex 三轮 P1-F）：预算按**活跃时间**
 * 累计、隔夜 resume 不再误伤；真耗尽的出路只有两条真路——不得出现裸「重启」（同 run
 * budget 已入 identity hash 冻结，裸重启不加预算；改 manifest 触发 identity drift）。
 */
export function buildBudgetExhaustedGuidance(opts: BudgetExhaustedGuidanceOpts): string[] {
  const { feature, runId, phase, kind, activeElapsedMs, limit, harnessPrefixRel } = opts;
  const spent =
    kind === 'budget_wall_clock'
      ? `已累计活跃 ${Math.round(activeElapsedMs / 60000)}m / 预算 ${Math.round(limit / 60000)}m`
      : `已消耗 agent 轮次达上限 ${limit}`;
  return [
    `【${feature} · run ${runId} · ${phase}】run 预算已耗尽（${kind}，${spent}）。`,
    '预算按活跃执行时间累计（停机等待不计入）——本次熔断是真实消耗，不是隔夜钟漂。',
    '',
    '两条出路（任选其一）：',
    `  1. 新 manifest 新起 run：复制原 manifest、调大 budget.wall_clock_minutes /`,
    '     budget.max_total_turns 后以新 run_id 启动（旧 run 可用 --supersede 废弃）；',
    `  2. 授权续跑本 run：修改该 run manifest.json 的 budget 字段后，以`,
    `     npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --override-manifest`,
    '     显式授权 identity rebase 续跑（--override-manifest=字段级授权，防未授权漂移）。',
  ];
}

export interface FrameworkIntegrityGuidanceOpts {
  feature: string;
  runId: string;
  phase: string;
  /** extractIntegritySubtypes 收集的多值 subtype（可空——blocker 无 classification 时）。 */
  subtypes: string[];
  /** consumer='framework/harness'、standalone='harness' */
  harnessPrefixRel: string;
}

/**
 * P0-5（plan d9b4f7e2，07-13 chrys bc-openCard 拉锯实证）：framework 完整性家族首触 halt
 * 的引导话术。铁律：**不给 agent 任何"修复"指引**——本 halt 的全部出路都在真人侧；
 * goal agent 对 framework 发布件的自动写操作（含"回滚可疑漂移"）一律禁止（案发现场
 * goal agent 依 code_regression 通用话术回滚了宿主经用户批准的真修复）。
 * 多 subtype 共存时按修复顺序列出（manifest 锚点层先于 per-file 层——manifest 不可信时
 * per-file 比对无意义）。
 */
const INTEGRITY_SUBTYPE_REMEDIATION: ReadonlyArray<{ subtype: string; lines: string[] }> = [
  {
    subtype: 'framework_manifest_tampered',
    lines: [
      'manifest/sidecar 被本地改动或顶替——从发布包恢复 framework/RELEASE-MANIFEST.json 与 sidecar，',
      '或经 framework-init UPDATE 重铺发布件。**禁止手工重算 manifest**（manifest 失锚时 drift allowlist 不适用）。',
    ],
  },
  {
    subtype: 'framework_manifest_sidecar_missing',
    lines: [
      'sidecar 缺失——经 framework-init UPDATE 重铺发布件恢复。**请勿手工补写**（手写完整性锚点无效且被写守卫拦截）。',
    ],
  },
  {
    subtype: 'framework_manifest_corrupt',
    lines: ['manifest 损坏——重装或从发布包恢复 framework/RELEASE-MANIFEST.json（allowlist 对 manifest 层无效）。'],
  },
  {
    subtype: 'framework_manifest_empty',
    lines: ['manifest 为空——重装或从发布包恢复 framework/RELEASE-MANIFEST.json（allowlist 对 manifest 层无效）。'],
  },
  {
    subtype: 'framework_drift',
    lines: [
      '发布源码漂移——三选一：①确属有意本地 fork：由**真人**在 framework.config.json',
      '  integrity.drift_allowlist 添加 {path, rationale, approved_by} 具名审批（agent 自加无效）；',
      '  ②还原漂移文件到发布件原状后重跑；③上游缺陷修复：回灌 agent-maison 源仓重新发布。',
      '  注意：漂移可能是宿主/真人**有意热修**（本机制的立项事故正是 goal agent 回滚了真修复）——',
      '  不确定来源时先问改动者，不要默认还原。goal run 进行中要热修 framework 的，请先停 run。',
    ],
  },
  {
    subtype: 'framework_foreign_file',
    lines: ['framework/ 树上有外来文件——清理（临时脚本/宿主产物移出），或确属有意 → 真人 allowlist 具名审批。'],
  },
];

export function buildFrameworkIntegrityGuidance(opts: FrameworkIntegrityGuidanceOpts): string[] {
  const { feature, runId, phase, subtypes, harnessPrefixRel } = opts;
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --force-resume`;
  const known = INTEGRITY_SUBTYPE_REMEDIATION.filter((r) => subtypes.includes(r.subtype));
  const unknown = subtypes.filter((s) => !INTEGRITY_SUBTYPE_REMEDIATION.some((r) => r.subtype === s));
  const out: string[] = [
    `【${feature} · run ${runId} · ${phase}】framework 完整性门禁拦截` +
      (subtypes.length ? `（${subtypes.join(' + ')}）` : '') +
      '——此类问题 agent 修不了也不许修（包括"回滚可疑改动"），须真人处置后续跑。',
    '',
    '按顺序处置（涉及文件清单见 harness 报告的 framework_integrity/framework_foreign_file blocker details）：',
  ];
  let n = 0;
  for (const r of known) {
    n += 1;
    out.push(`  ${n}. [${r.subtype}]`);
    for (const l of r.lines) out.push(`     ${l}`);
  }
  for (const s of unknown) {
    n += 1;
    out.push(`  ${n}. [${s}] 未内置处置建议——人工对照 framework/RELEASE-MANIFEST.json 核查 framework/ 完整性。`);
  }
  if (n === 0) {
    out.push('  1. blocker 未携带 subtype——人工对照 framework/RELEASE-MANIFEST.json 核查 framework/ 完整性。');
  }
  out.push('', `处置完后续跑：${resumeCmd}`);
  return out;
}

export interface AgentTimeoutRepeatedGuidanceOpts {
  feature: string;
  runId: string;
  phase: string;
  /** 各 attempt 实际时长（ms，按时间序）——让人一眼看出是"差一点"还是"根本跑不完"。 */
  attemptDurationsMs: number[];
  /** 当前有效超时（升档后，ms）。 */
  effectiveTimeoutMs: number;
  harnessPrefixRel: string;
}

/**
 * P0-4（plan d9b4f7e2）：连续超时熔断（升档后仍超时）求人话术。前提：P0-1 已让超时
 * 重试真续作、P0-2 已让门禁不再自崩——到这里还连续超时，说明预算/需求规模/adapter
 * 环境有结构性问题，盲重试只烧 wall。
 */
export function buildAgentTimeoutRepeatedGuidance(opts: AgentTimeoutRepeatedGuidanceOpts): string[] {
  const { feature, runId, phase, attemptDurationsMs, effectiveTimeoutMs, harnessPrefixRel } = opts;
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --force-resume`;
  const fmt = (ms: number): string => `${Math.round(ms / 60000)}m`;
  return [
    `【${feature} · run ${runId} · ${phase}】连续多次 attempt 超时（含升档 ×1.5 后仍超时，当前有效预算 ${fmt(effectiveTimeoutMs)}）` +
      '——续作与升档都救不回来，属结构性瓶颈，盲重试只烧 wall，需要你拍板。',
    '',
    `各 attempt 实际时长：${attemptDurationsMs.map(fmt).join(' → ') || '（无记录）'}`,
    '',
    '三条出路（按嫌疑排查）：',
    `  1. 预算不足（时长都贴着预算被杀）：调大 manifest 的 unattended.phase_timeout_seconds.${phase} 后续跑；`,
    '  2. 需求过大（单 phase 工作量超出单 attempt 能力）：把需求拆小（页面/模块分批）再跑；',
    '  3. adapter/环境异常（时长离预算很远就死、或输出恒空）：检查 agent CLI 环境与 agent-output.log。',
    '',
    `处理完后续跑：${resumeCmd}`,
  ];
}

export interface FrameworkBugGuidanceOpts {
  feature: string;
  runId: string;
  phase: string;
  /** 崩溃的 checker id 列表（blocker id）。 */
  checkerIds: string[];
  /** 首个异常的栈首行摘录（可空）。 */
  stackHead?: string;
  harnessPrefixRel: string;
}

/**
 * P0-3（plan d9b4f7e2）：门禁脚本自身程序员错误首触 halt 的引导话术。案发现场：spec 前
 * 5 轮 agent 反复"修"自己的产物试图安抚一个会崩溃的 checker——框架 bug 只能人修，
 * 重试纯烧预算。
 */
export function buildFrameworkBugGuidance(opts: FrameworkBugGuidanceOpts): string[] {
  const { feature, runId, phase, checkerIds, stackHead, harnessPrefixRel } = opts;
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --force-resume`;
  return [
    `【${feature} · run ${runId} · ${phase}】门禁脚本自身异常（[Harness 内部错误]，checker: ${checkerIds.join(', ') || '<unknown>'}）` +
      '——这是 framework 缺陷，**不是 agent 产物的问题**。',
    ...(stackHead ? [`  首行栈：${stackHead}`] : []),
    '',
    '处置：',
    '  1. 把该缺陷回灌 agent-maison 源仓修复并重新发布（附 harness 报告里的完整栈）；',
    '  2. 等不及发布需本地热修的：由**真人**修改并在 framework.config.json integrity.drift_allowlist',
    '     添加 {path, rationale, approved_by} 具名审批（否则下一轮被 framework_integrity 拦截）；',
    '  3. **不要**让 agent 继续修改自己的产物来绕过——崩溃发生在 checker 内部，产物怎么改都可能复现；',
    '     agent 也不得修改 framework 发布件。',
    '',
    `处置完后续跑：${resumeCmd}`,
  ];
}
