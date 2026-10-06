/**
 * plan 4e6fb3b6 §7 / §9：恢复办法首选"补上缺的输入后重新发起同一请求"（接续决策判重新接入、起后继或保持停止），
 * 已填好的完整命令降为备选。首轮评审 R5（调度方裁定）：有人在场的调用不设冷却；无人值守的调用在有正式开始的
 * run 停止后 5 分钟内重发会保持停止（显式续跑同样受冷却约束），须如实写出，不能笼统写"重新发起即可"。
 * 本段刻意不写旗标字面量：调用方把带旗标的完整命令放在其后作备选，测试据此断言先后。
 */
const REREQUEST_LINE =
  '补上缺的输入后，重新发起同一请求（对 agent 说同一句话，或重跑同一条启动命令）：框架会重新接入本 run，'
  + '条件是否解除仍由原来的检查判断，没解除就以原来的原因再停一次、不新建 run。'
  + '有人在场时补好即可立即重发；无人值守时，本 run 停止后 5 分钟内重发会先保持停止（显式续跑命令也一样要等），过了这段冷却再发。';

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
      `  1. 闭环条件校验未通过。先看 BLOCKER 列表定位 summary/verifier/policy 真因：`,
      `     ${verifyCmd}`,
      '     receipt 是 closed 后机器投影，不手填、不构成修复入口。',
      `  2. 若校验输出显示 verifier_subagent.verdict=FAIL，将当前结构化证据回馈责任阶段修复；`,
      `     视觉/裁剪义务只接受 source/hash/tool/provider 机器证据，不得在 ${receiptPathRel} 补签放行。`,
    ],
    missing: [`  1. 兼容状态显示 receipt 缺失；直接运行 ${verifyCmd} 按 summary/verifier/policy 收口，无需手填 ${receiptPathRel}。`],
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
    `影响：${feature} 的 ${phase} 阶段结果未能关环，本 run 已停止，后续阶段未执行。`,
    '谁能修：看下面的校验输出——机器证据或闭环事务的问题由你按 BLOCKER 修；探针自身出错属框架缺陷，回灌 agent-maison。',
    '',
    '请检查：',
    ...(receiptStatus && byStatus[receiptStatus] ? byStatus[receiptStatus] : unknownStatus),
    // 首轮评审 R5 同类修正：原文的 phase_timeout_ms 不是 manifest 字段；超时字段属 manifest 身份字段，续跑须带 --override-manifest。
    `  · 若怀疑是"预算不够、每轮都在做新探索但没收尾"：可调大本 run manifest.json 的 unattended.phase_timeout_seconds.${phase}，`,
    '    续跑命令另加 --override-manifest（对 manifest 身份字段的整体授权，这次只应改超时字段）；',
    '  · 若怀疑是环境/工具链问题（如 OCR 不可用）：先修复环境，问题若随之消失即证实。',
    '',
    // plan 4e6fb3b6 §7（调度方 2026-09-29 裁定）：closure_wall_repeated 是结构终局；只修回执或闭环事务、产品与契约文件没变时，
    // 接续决策不认为有变化，重新发起会保持停止——所以首选显式续跑本 run。
    `处理完后续跑：显式续跑本 run（已填好）${resumeCmd}`,
    '  只修了回执或闭环事务时，重新发起同一请求会保持停止（本 run 已是结构终局，这不算可核验的变化）；',
    '  只有相关产品或契约文件确有改动、或需求有变化时，重新发起才会起后继接着做。',
    `确认已恢复：上面的校验命令不再报 BLOCKER，续跑后 ${phase} 阶段推进到下一阶段。`,
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
      ? `恢复结构具备时 runner 会自动回 coding 全量重验；预算耗尽须由有权者沿既有入口调整额度，已用资源不清零；指纹熔断须有真实新输入或既有合法后继资格，不能仅换 run 买机会。`
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
  // plan 4e6fb3b6 §3.3：删去"复制 manifest、以新 run_id 启动、旧 run 用 --supersede 废弃"一路——
  // 它要求用户自己拼 run 与旗标。§7（调度方 2026-09-29 裁定）：首选显式续跑本 run——"改预算后带 --override-manifest
  // 重新发起同一请求"会起后继，而后继沿用合同来源 run 的预算，只有本 run 就是合同来源时才用得上改过的预算。
  return [
    `【${feature} · run ${runId} · ${phase}】run 预算已耗尽（${kind}，${spent}）。`,
    `影响：${feature} 停在 ${phase} 阶段，本 run 的剩余阶段未执行；已完成的阶段结果保留。`,
    '预算按活跃执行时间累计（停机等待不计入）——本次熔断是真实消耗，不是隔夜钟漂。',
    '谁能修：有权决定预算的人（通常是你）——硬预算框架不会自行增加。',
    '',
    '怎么恢复：调大本 run manifest.json 的 budget.wall_clock_minutes / budget.max_total_turns，然后显式续跑本 run（已填好）：',
    `  npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --override-manifest --force-resume`,
    // plan 4e6fb3b6 返修 3：overrideAuthorizedIdentityFields 对 --override-manifest 返回 'all'——整体授权。
    '  （--override-manifest 是对本 run manifest 身份字段的**整体授权**，会接受 manifest 里的全部改动，',
    '   所以这次对 manifest 的修改只应涉及预算字段；已消耗的预算不会清零。距停止不足 5 分钟时 --force-resume 也要等冷却过去。）',
    '  改完预算后带 --override-manifest 重新发起同一请求也能继续，但只在本 run 就是该任务的合同来源时有效',
    '  （同一 feature 没有更早的完成、范围也没转交给别的 run）；否则起出来的后继沿用来源 run 的旧预算。',
    `确认已恢复：续跑后 ${phase} 阶段重新开始推进，且不再以 ${kind} 停止。`,
  ];
}

export interface FrameworkIntegrityGuidanceOpts {
  feature: string;
  runId: string;
  phase: string;
  /**
   * 历史 summary 里的 integrity classification（可空）。六 subtype 矩阵已退役：
   * 这里只作 provenance 原样带出，不再驱动任何处置分支。
   */
  subtypes: string[];
  /** consumer='framework/harness'、standalone='harness' */
  harnessPrefixRel: string;
}

/** 当前机器 integrity halt 的 source-sensitive 引导；退役 framework subtype 仅作历史 provenance。 */
export function buildFrameworkIntegrityGuidance(opts: FrameworkIntegrityGuidanceOpts): string[] {
  const { feature, runId, phase, subtypes, harnessPrefixRel } = opts;
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --force-resume`;
  if (subtypes.includes('process_injection')) {
    return [
      `【${feature} · run ${runId} · ${phase}】检测到进程预加载注入（process_injection）——当前门禁进程不可信，已停止。`,
      '',
      '处置：清除 NODE_OPTIONS / execArgv 预加载参数，删除无合法用途的 .node-options，移除 .npmrc node-options 旁路；',
      '然后从未注入的干净进程重新运行。不得用注入修改 summary、回执或任何门禁产物。',
      '',
      `处置完后续跑：${REREQUEST_LINE}`,
      `  也可以显式执行（已填好）：${resumeCmd}`,
    ];
  }
  const legacy = subtypes.length > 0 ? subtypes.join(' + ') : 'unknown';
  return [
    `【${feature} · run ${runId} · ${phase}】读取到 integrity 分类：${legacy}。`,
    '',
    '若这些值来自旧 framework_integrity / manifest / foreign / drift summary，它们已退役，仅作历史 provenance；',
    '当前版本不会根据宿主 Git dirty/HEAD 生产替代结果，也不要求提交、回滚或填写 allowlist。',
    '请用当前发布件与当前环境重跑本 phase；若仍有当前机器 integrity blocker，按新报告的真实来源处置。',
    '',
    `重跑：${REREQUEST_LINE}`,
    `  也可以显式执行（已填好）：${resumeCmd}`,
  ];
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
    // 首轮评审 R5：unattended 是 manifest 身份字段（computeManifestIdentityFields），改了不带 --override-manifest
    // 会被身份漂移检查拒绝；--override-manifest 在 overrideAuthorizedIdentityFields 里返回 'all'——整体授权。
    `  1. 预算不足（时长都贴着预算被杀）：调大本 run manifest.json 的 unattended.phase_timeout_seconds.${phase}，然后显式续跑（已填好）：`,
    `     ${resumeCmd} --override-manifest`,
    '     unattended 是 manifest 身份字段，不带 --override-manifest 会被身份漂移检查拒绝；--override-manifest 是对本 run',
    '     manifest 身份字段的整体授权，会接受 manifest 里的全部改动，所以这次只应改超时字段。停止不足 5 分钟时同样要等冷却过去。',
    '  2. 需求过大（单 phase 工作量超出单 attempt 能力）：把需求拆小（页面/模块分批）再跑；',
    '  3. adapter/环境异常（时长离预算很远就死、或输出恒空）：检查 agent CLI 环境与 agent-output.log。',
    '',
    `出路 3 处理完后续跑：${REREQUEST_LINE}`,
    `  也可以显式执行（已填好）：${resumeCmd}`,
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
  /** plan 4e6fb3b6 §4：与框架阻断并存的内容 blocker——仍在清单里，框架解除后仍须修复。 */
  pendingContentBlockerIds?: string[];
  harnessPrefixRel: string;
}

/**
 * P0-3（plan d9b4f7e2）：门禁脚本自身程序员错误首触 halt 的引导话术。案发现场：spec 前
 * 5 轮 agent 反复"修"自己的产物试图安抚一个会崩溃的 checker——框架 bug 只能人修，
 * 重试纯烧预算。
 */
export function buildFrameworkBugGuidance(opts: FrameworkBugGuidanceOpts): string[] {
  const { feature, runId, phase, checkerIds, stackHead, pendingContentBlockerIds, harnessPrefixRel } = opts;
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --force-resume`;
  return [
    `【${feature} · run ${runId} · ${phase}】门禁脚本自身异常（[Harness 内部错误]，checker: ${checkerIds.join(', ') || '<unknown>'}）` +
      '——这是 framework 缺陷，**不是 agent 产物的问题**。',
    ...(stackHead ? [`  首行栈：${stackHead}`] : []),
    ...(pendingContentBlockerIds?.length
      ? [`  同轮还有内容 blocker（仍在清单里，框架问题解除后仍须修复，本轮未消耗内容重试）：${pendingContentBlockerIds.join(', ')}`]
      : []),
    '',
    '处置：',
    '  1. 把该缺陷回灌 agent-maison 源仓修复并重新发布（附 harness 报告里的完整栈）；',
    '  2. 等不及发布需本地热修的：这是**真人/updater 的操作**。先停 run，由用户/CI 明确集成',
    '     已修复的发布件或在有权限的维护环境处理；宿主 Git add/stage/commit 不是 Maison 放行条件；',
    '  3. **不要**让 agent 继续修改自己的产物来绕过——崩溃发生在 checker 内部，产物怎么改都可能复现；',
    '     agent 也不得修改 framework 发布件。',
    '',
    `处置完后续跑：${REREQUEST_LINE}`,
    `  也可以显式执行（已填好）：${resumeCmd}`,
  ];
}

export interface NoRelevantTargetGuidanceOpts {
  feature: string;
  runId: string;
  phase: string;
  /** 本轮 blocker id（人一眼看出卡在哪些门上）。 */
  blockerIds: string[];
  harnessPrefixRel: string;
}

/**
 * plan e7a2c4f1 §3.6（G27）：同签名重复 + **相关集合未知或为空** 的停止话术。
 *
 * 相关集合来自 `extractContentRelatedFiles` = `repair_candidates[].files` ∪
 * `blockers[].affected_files`。空集只说明**没解析出可修目标**——不是"证明了没做修复尝试"，
 * 措辞必须守住这条线（宿主 `a70eb7` i12/i13/i14 与 `f829b8` 各烧满重试后以
 * `content_retry_exhausted` 收场，把账本问题说成了内容问题）。
 * 沿既有 `no_progress_guard` 停止，不新增 halt reason。
 */
export function buildNoRelevantTargetGuidance(opts: NoRelevantTargetGuidanceOpts): string[] {
  const { feature, runId, phase, blockerIds, harnessPrefixRel } = opts;
  // plan 4e6fb3b6 §7：首选"补齐之后重新发起同一请求"（重新接入不要求 --force-resume）；带 --force-resume 的
  // 完整命令只作备选、仍放在"补齐之后"（e7a2c4f1 §3.6"不在没有新事实时强推"的本意保留）。
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --force-resume`;
  return [
    `【${feature} · run ${runId} · ${phase}】同一 blocker_signature 重复出现，且本轮机器证据`
      + '**没有解析出任何相关目标**：repair_candidates[].files 与 blockers[].affected_files 都为空。',
    `  本轮 blocker：${blockerIds.join(', ') || '（无记录）'}`,
    `影响：${feature} 的 ${phase} 阶段未通过，本 run 已停止，后续阶段未执行。`,
    '',
    '这是「相关目标未知」，**不是**「已证明没做修复尝试」——框架没能指出该改哪里，',
    '继续重试不会获得新结果（报告时间、追加 notes、重写散文都不算新事实）。',
    '谁能修：能判断上面 blocker 该落到哪个产物的人（通常是你，或写该 checker 的维护者）。',
    '',
    '处置：按 blocker details 指出责任产物，或走既有 correction / 范围修订补齐来源；**补齐之后**再续跑',
    '（没补齐来源就续跑只会以同一签名再停）：',
    `  ${REREQUEST_LINE}`,
    `  也可以显式执行（已填好）：${resumeCmd}`,
    '确认已恢复：续跑后同一阶段的 blocker 集合发生变化或消失，不再以同一签名停下。',
  ];
}

/**
 * plan c4e8a1f7 T1a 的正式 invoke 硬失败说明（原在 goal-phase-runtime 内联），plan 4e6fb3b6 §3.3
 * 补齐"影响 / 谁能修 / 怎么恢复 / 确认已恢复"。首行保持原样：报告阶段行取 guidance 首行，
 * 须带 CLI 原文。
 */
export function buildAdapterCliHardFailureGuidance(opts: {
  feature: string;
  phase: string;
  detail: string;
  /** plan 4e6fb3b6 §6.2：模型不受支持时为什么没有换型号（describeModelAlternativeRefusal 的一行） */
  modelAlternative?: string;
}): string[] {
  const { feature, phase, detail } = opts;
  return [
    `正式 phase invoke 遇 CLI/guardian 硬失败（非需求代码，agent 未执行任务）：${detail}`,
    `影响：${feature} 的 ${phase} 阶段未执行，本 run 已停止；不进入 gate harness、不消耗内容重试。`,
    '谁能修：你——这是本机 adapter CLI 的版本/兼容性、配置、参数、模型或 Windows containment 建立问题，agent 与需求代码修不了它。',
    ...(opts.modelAlternative ? [opts.modelAlternative] : []),
    '怎么恢复：按上面的原文核对 adapter 版本/配置/模型/环境（模型不可用时换成本账号可用的模型）后重跑。',
    `确认已恢复：重跑后 ${phase} 阶段出现正常的 agent 执行记录，不再以 adapter_cli_hard_failure 停止。`,
  ];
}

/**
 * plan 4e6fb3b6 §6.2：模型不受支持而框架没有换型号时的说明行——写明是型号被用户钉死，
 * 还是获准替代清单为空 / 已全部试过 / 预算已尽，并列出试过的型号。
 */
export function describeModelAlternativeRefusal(opts: {
  adapter: string;
  reason: 'user_pinned' | 'adapter_unsupported' | 'not_configured' | 'budget_exhausted' | 'exhausted';
  tried: readonly string[];
  pinned?: string;
}): string {
  const tried = opts.tried.length > 0 ? opts.tried.join('、') : '（无）';
  const configKey = `framework.local.json → adapters.${opts.adapter}.approved_models`;
  switch (opts.reason) {
    case 'user_pinned':
      return `未换型号：型号由用户用 --adapter-model 钉死（${opts.pinned ?? tried}），框架不替换用户钉死的型号；换成可用型号需要你重新指定。`;
    case 'adapter_unsupported':
      return `未换型号：adapter ${opts.adapter} 没有模型回放旗标，框架无法替换型号。试过的型号：${tried}。`;
    case 'not_configured':
      return `未换型号：没有配置获准替代型号（${configKey}）。试过的型号：${tried}。`;
    case 'budget_exhausted':
      return `未换型号：本交付周期的墙钟预算已尽，不再尝试下一个获准替代型号。试过的型号：${tried}。`;
    case 'exhausted':
    default:
      return `未换型号：获准替代清单（${configKey}）里的型号已全部试过。试过的型号：${tried}。`;
  }
}

/**
 * plan a7c3f9e2 t4/t5 编译形态未确定的说明（原在 goal-phase-runtime 内联），plan 4e6fb3b6 §3.3
 * 补齐四件事。缺的输入是"选哪个 product"——这是产品决定，框架不替宿主猜。
 */
export function buildProductSelectionUnresolvedGuidance(opts: {
  feature: string;
  phase: string;
  candidates: string[];
  projectRoot: string;
}): string[] {
  const { feature, phase, candidates, projectRoot } = opts;
  const list = candidates.join(', ');
  return [
    candidates.length > 0
      ? `编译形态无法确定：工程声明了多个 product（${list}），` +
        '且 toolchain.preferredProduct 未经本机确认（framework.local.json 无匹配确认记录）。'
      : '编译形态无法确定：build-profile.json5 未声明任何真实 product（缺失/为空/不可解析）。',
    `影响：${feature} 从 ${phase} 起的整条链未启动（没有消耗任何预算）；选错 product 会让错误产物也能编译通过，所以必须先确认。`,
    '谁能修：你——选哪个 product 是产品决定，framework 不替宿主猜测编译形态。',
    '怎么恢复：先确认一次（任选其一）：',
    `  1. 机器写入：npx ts-node framework/harness/scripts/record-product-selection.ts --project-root ${projectRoot} --product <候选值>；`,
    '  2. 交互式：framework-init 的 registry `init.product_selection`；',
    '  3. testing 无人值守：HARNESS_DEVICE_TEST_PRODUCT=<候选值>（仅 testing 起点链路生效，env 属显式确认）。',
    candidates.length > 0
      ? `本次可用候选：${list}。`
      : '请先修复构建配置（build-profile.json5 声明 app.products）或使用显式来源指定 product。',
    // plan 4e6fb3b6 返修 2(a) + §7.2 + 二轮评审：该检查在新开与恢复时都会执行。从未正式开始过的 run 没有 run_start，
    // 显式恢复会被拒、重发走附着；曾正式开始过的 run 恢复时停在这里，修好后显式恢复也可以——所以统一写"由框架选择恢复方式"。
    '确认后重新发起同一请求，由框架选择恢复方式（本 run 从未正式开始过时走附着，曾正式开始过时走恢复），不需要自己拼旗标。',
    '确认已恢复：本 run 不再出现 product_selection_unresolved，链路继续执行。',
  ];
}
