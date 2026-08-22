// ============================================================================
// adjudication.ts — 统一裁决内核（plan a5f9c3e2）
// ----------------------------------------------------------------------------
// 立项根因：框架没有把「接受风险」与「通过回退重建可信度」分开。恢复**执行机制**
// 早已建成（失效事务 + 共用回退预算 + roundFingerprint 熔断 + 从 coding 起算的
// invalidatedPhases 切片），缺的是**决策代数里的 recover 动作**——现有出口只有
// advance/retry/halt，无人值守下 halt 即死，于是每个门禁都只能去求人。
//
// 本模块是唯一分叉点：门禁只产事实（IncidentFacts），内核裁决动作。
//
// 三条铁律（单测锁死，见 tests/unit/adjudication.unit.test.ts）：
//   (a) IncidentFacts 不能产生授权——事实类型里没有任何授权字段；
//   (b) AuthorityFacts 不能修改或覆盖事实——decide 不写回 facts；
//   (c) can_prompt_now 只表示当前能否询问，不代表已获得授权——单独翻转它
//       **不改变 decide 的输出**（只影响 L3 话术）。
// 这三条正面回答立项质疑「场外数据凭什么比用户指令优先」：场外锚只是事实证据，
// 本身不具授权优先级；用户可以授权「放弃旧 lineage」，但不能把「失配这一事实」
// 改成不存在——两者不在同一层。
//
// 授权真实性红线（goal-runner.ts:4351 / :3094、mutation-authorization.ts:266）：
// CLI 旗标可被模型拼出、无 key 部署下 manifest + run_start 整链在 agent 可写面，
// 一律**不构成** grant。AuthorityFacts.grants 只装已验证项。
// ============================================================================

// ---------------------------------------------------------------------------
// 执行上下文（动态，不冻结进 manifest）
// ---------------------------------------------------------------------------

export type Orchestration = 'direct' | 'goal';
export type OwnerKind = 'session' | 'process';
export type Invocation = 'fresh' | 'resume';

/**
 * `can_prompt_now` **来自当前 run-control owner，不进 manifest identity**——goal 支持
 * 同一 run 在 session↔detached 间 mailbox handoff（goal-handoff.ts），owner_kind 动态
 * 切换；冻进身份哈希会让合法 handoff 变成 drift。manifest 只冻结「用户授权边界」。
 */
export interface ExecutionContext {
  orchestration: Orchestration;
  owner_kind: OwnerKind;
  can_prompt_now: boolean;
  invocation: Invocation;
}

/** owner 种类 → 当前能否同步询问（唯一产地；禁止各调用点从 env 反推）。 */
export function canPromptNow(ownerKind: OwnerKind): boolean {
  return ownerKind === 'session';
}

// ---------------------------------------------------------------------------
// 事实（环境无关；只陈述发生了什么，不产动作/话术/不读 env）
// ---------------------------------------------------------------------------

/**
 * 源码漂移事实。普通模式与 goal 模式**允许不同采集器**（前者 trace.start_commit，
 * 后者 review closure attestation），但归一到本结构：canonical 部分（added/modified/
 * deleted）必须逐字段相等；`provenance` / `baseline_kind` 是来源标注，**不入等值断言**。
 */
export interface SourceDriftFacts {
  added: string[];
  modified: string[];
  deleted: string[];
  provenance: string;
  baseline_kind: 'review_closure_attestation' | 'trace_start_commit';
}

const normPath = (p: string): string => p.replace(/\\/g, '/').trim();
const canonList = (xs: readonly string[]): string[] =>
  [...new Set(xs.map(normPath).filter(Boolean))].sort();

/** 规范化为 canonical 形态（排序 + 去重 + POSIX 分隔符）。 */
export function canonicalizeSourceDrift(input: SourceDriftFacts): SourceDriftFacts {
  return {
    added: canonList(input.added),
    modified: canonList(input.modified),
    deleted: canonList(input.deleted),
    provenance: input.provenance,
    baseline_kind: input.baseline_kind,
  };
}

/** 等值断言口径：只比 canonical 三元组，来源字段允许不同（t4 契约 (a)）。 */
export function canonicalDriftFields(
  input: SourceDriftFacts,
): Pick<SourceDriftFacts, 'added' | 'modified' | 'deleted'> {
  const c = canonicalizeSourceDrift(input);
  return { added: c.added, modified: c.modified, deleted: c.deleted };
}

/**
 * 事故事实。`incident` 是 canonical id（须在 INCIDENT_REGISTRY 注册，否则元门禁红）。
 * 其余字段是**结构性可恢复性的事实输入**——由采集方填写，裁决层只消费不推断。
 */
export interface IncidentFacts {
  incident: string;
  phase?: string;
  detail?: string;
  /** 当前 chain 是否同时含 coding 与 review（回退重验的结构前提）。 */
  chain_has_coding_review?: boolean;
  /** 剩余回退预算（DEFAULT_MAX_BACKTRACKS - backtracksUsed）。 */
  backtrack_budget_remaining?: number;
  /** 整轮 actionable 集合指纹是否与上次回退完全相同（回退震荡）。 */
  round_fingerprint_repeated?: boolean;
  /** 相关文件（诊断用；不参与裁决）。 */
  files?: string[];
}

// ---------------------------------------------------------------------------
// 授权（只装已验证 grant）
// ---------------------------------------------------------------------------

/**
 * `live_operator`  当场真人应答（同步在场，调用方已取得明确表态）
 * `verified_receipt` 通过 confirmation-receipt 信任链验签的 receipt
 *
 * **没有 `manifest` / `cli_flag` / `natural_language` 源**——它们只是 authority
 * verifier 的输入，不得直接成为 grant（框架明文红线，见文件头）。
 */
export type AuthoritySource = 'live_operator' | 'verified_receipt';

export interface VerifiedAuthorityGrant {
  /** 被授权的动作 id（与 incident 的 requires_grant 对应）。 */
  action: string;
  source: AuthoritySource;
  /** 该授权锚定的对象（如 receipt object_hash）——换皮到更宽授权即失配。 */
  binding: string;
}

export interface AuthorityFacts {
  grants: VerifiedAuthorityGrant[];
}

export const NO_AUTHORITY: AuthorityFacts = { grants: [] };

// ---------------------------------------------------------------------------
// IncidentClass —— canonical 分类维度，SSOT 归本内核
// ---------------------------------------------------------------------------
// 与 BlockerActionability（agent_fixable|human_only|toolchain_blocked）**不是同一
// 维度**：那个回答「谁能修 blocker」，且被回喂过滤/停车/报告广泛消费，不扩展它。
// 观测层 assess.ts 的 'automatic'|'human'|'external'|'unknown' 原由 goal-reconcile-
// observation.ts 的私有正则猜 blocking_class 生成——改为消费本注册表的投影。
// ---------------------------------------------------------------------------

export type IncidentClass =
  | 'recoverable'      // 自动回退 / 重试 / 重建 / 失效即可重建可信度
  | 'operator'         // 需要人的决定（可问则问，不可问则停放）
  | 'external'         // 外部条件未满足（环境/设备/工具链恢复后继续）
  | 'framework_fault'  // 框架自身缺陷或事务失败——人也修不了产物
  | 'unknown';         // fail-safe：未识别，保守停放

/** 观测层兼容投影（assess.ts blockers[].actionability 的既有词汇）。 */
export type ObservedActionability = 'automatic' | 'human' | 'external' | 'unknown';

export function projectToObservedActionability(c: IncidentClass): ObservedActionability {
  switch (c) {
    case 'recoverable': return 'automatic';
    case 'operator': return 'human';
    case 'external': return 'external';
    // 框架缺陷不是「自动可修」，投影到 unknown 与既有正则口径最接近（该族原本
    // 落不进三个正则分支，本就返回 unknown）——保持既有观测行为不变。
    case 'framework_fault': return 'unknown';
    default: return 'unknown';
  }
}

export interface IncidentSpec {
  class: IncidentClass;
  /**
   * 结构上永远无法继续 —— 不存在「明确的、可接受的未来输入或外部状态变化」使**本 run**
   * 能继续。判据不是「有没有人工动作」（设备/环境恢复未必是人工动作）。
   */
  structurally_terminal?: boolean;
  /** operator 类专用：放行所需的 grant action id（缺 grant → waiting('human')）。 */
  requires_grant?: string;
  /**
   * recoverable 类专用：可用的恢复动作。
   * 结构前提不满足（截断链 / 预算耗尽 / 指纹重现）→ terminal。
   */
  recover_action?: RecoverAction;
  /** plan e5d8a2c4 5b：保留 incident 的来源标注，行为由 class/recover_action 决定。 */
  suspected_misclassified?: boolean;
}

export type RecoverAction = 'backtrack_to_coding' | 'retry_transaction';

/**
 * canonical incident 注册表（唯一产地）。
 * **新增 incident 未在此注册 → t4 元门禁单测红**，写不出第二套分类。
 */
export const INCIDENT_REGISTRY: Readonly<Record<string, IncidentSpec>> = Object.freeze({
  // --- 本 plan 打通的两条恢复路 -------------------------------------------
  /** ut/testing 期产品源码漂移：保守恢复=失效旧 coding closure 及其后阶段、回退重验。 */
  unauthorized_source_mutation: { class: 'recoverable', recover_action: 'backtrack_to_coding' },

  // --- 结构上无法在本 run 继续 ---------------------------------------------
  authorized_mutation_requires_full_chain: { class: 'operator', structurally_terminal: true },
  backtrack_limit: { class: 'recoverable', structurally_terminal: true },
  backtrack_fingerprint_repeat: { class: 'recoverable', structurally_terminal: true },
  backtrack_target_absent: { class: 'recoverable', structurally_terminal: true },
  testing_write_violation: { class: 'operator', structurally_terminal: true },
  visual_ledger_integrity: { class: 'operator', structurally_terminal: true },

  // --- 需要人的决定（可问则问，不可问则停放） -------------------------------
  await_human_visual_confirm: { class: 'operator', requires_grant: 'human_visual_acceptance' },
  /**
   * adjudicated-repair-loop（plan e2b7c4a9）：信号级候选累计 one-shot 收敛——
   * open 中全部 signal@1 身份均已 attempted（eligible 空），或回退目标 phase 零改动
   * no-op（修复无效）——不再自动回退，停等人工裁决。恢复=既有人工通道
   * （manual driver 确认流 / visual-confirm 人签路径），不新增 receipt 体系。
   */
  repair_not_converging: { class: 'operator' },
  /**
   * adjudicated-repair-loop（plan e2b7c4a9）：物化前两态裁决受阻——producer 判
   * actionable 的信号被 agent 反对/未复核，或 producer 直接归 uncertain（OCR 混淆 /
   * 口径缺口）。**不物化候选、不自动回退、无自动 refuted**——原样呈证据停等人工。
   * 恢复=既有 manual driver / visual-confirm / confirmation-receipts 通道（后者仅
   * 真正豁免硬门禁时），guidance 写明入口与 resume 命令（WAITING 可接受未来输入）。
   */
  repair_adjudication_pending: { class: 'operator' },
  await_human_verification_evidence: { class: 'operator', requires_grant: 'runtime_fidelity_attestation' },
  capability_tightened_hard_pixel: { class: 'operator', requires_grant: 'fidelity_downgrade' },
  declared_product_layer_missing: { class: 'operator' },
  unverifiable_must_fix: { class: 'operator' },
  headless_interaction_required: { class: 'operator' },
  operator_interrupt: { class: 'operator' },
  /** c7e4a2d9：**只读兼容**——历史 3.0.0 前 events.jsonl 可能含
   * `halt_reason=await_human_p0_skip`，本映射供状态读取/归档工具解释旧事件；
   * 新 run 不再写该 halt（P0 未豁免 explicit skip 默认回 coding，见 p0-semantic-gates/
   * repair-candidates），本条目**不是**新 run 的写入口，不参与 driver 决策。 */
  await_human_p0_skip: { class: 'operator', requires_grant: 'p0_skip_waiver' },
  /** 闭环墙：脚本门禁反复 PASS 但回执关不了环（多为只能真人签的确认项）。 */
  closure_open: { class: 'operator' },
  /**
   * assess 侧 halt 的**通用**兜底（运行时带 `assess_halt:<reason>` 后缀——normalizeIncidentId 归一）。
   * f9c2e6b4 t3 起，产生端对"重试耗尽"改发下面两个带责任类别的 id；本条只留给未分类的
   * 其余 assess halt，**不再是所有 assess halt 的唯一出口**。
   */
  assess_halt: { class: 'operator' },

  /**
   * f9c2e6b4 t3：重试耗尽 · **内容失败**。反复做不对内容，重启同一个 run 只会在同一处再死，
   * 故结构上终局——supervisor 不得拉起（人工 --resume 仍是人的选择，不由框架自动做）。
   */
  content_retry_exhausted: { class: 'operator', structurally_terminal: true },

  /**
   * f9c2e6b4 t3：重试耗尽 · **外部条件**（工具链/设备/网络/断流）。环境恢复后可继续，
   * 不是"需要人做决定"，故 waiting(external) 而非 waiting(human)。
   * 注意：这**不等于**会被自动重试——a4 的 supervisor 对 `stale × WAITING` 一律 no_op；
   * 本条的收益是责任归属正确（据此决定找谁、是否值得重启），不是自动恢复。
   */
  external_retry_exhausted: { class: 'external' },

  /**
   * plan b3e8d4c7 t2：上游阶段闭环缺口——assess 推荐 `complete_closure:<上游>`，
   * runner 已尝试过一次确定性关环（不启 agent、不烧内容预算）仍不成立。
   * 需要人看上游那一环，但**不是**内容失败、也不是重试耗尽——不得再被洗成
   * content_retry_exhausted（那正是宿主 run 20260804T033834Z-99c0a1 的错误标签）。
   */
  upstream_closure_gap: { class: 'operator' },

  // --- 外部条件未满足 -------------------------------------------------------
  await_human_capability_gap: { class: 'external' },
  managed_device_session_conflict: { class: 'external' },
  transient_api_error_exhausted: { class: 'external' },
  agent_no_output: { class: 'external' },
  agent_timeout_repeated: { class: 'external' },
  closure_timeout: { class: 'external' },
  /**
   * plan d7f3a9c4 t4：金丝雀 CLI 硬失败（child spawn race / CLI·config 参数不兼容）——
   * CLI/adapter 兼容性问题、**非需求代码**。修复 adapter 版本/配置/环境后可重跑
   * （--refresh-vision-probe 触发重探）；不是内容失败（agent 做不对），也不是框架缺陷。
   */
  canary_cli_hard_failure: { class: 'external' },
  /**
   * plan a7c3f9e2 t4/t5：编译形态无法确定（多候选未确认 / build-profile 缺失 /
   * products 为空 / build-profile 不可解析——后三者无真实候选，不得虚构 default）——
   * 工程配置侧问题，需用户经 init.product_selection / record-product-selection / env
   * 显式确认；不是内容失败（agent 改代码无意义），确认后 --resume 重检即放行。
   */
  product_selection_unresolved: { class: 'external' },
  /**
   * plan a7c3f9e2 review P1（第二轮）：编译形态解析器执行失败（profile 模块存在但
   * require/解析抛错）——build-profile 缺失/空/不可解析及普通配置读取错误已被解析器
   * 正常收敛为判别结果，能逃到这里的是 **profile 模块加载或运行时异常 = framework
   * fault**；按 external 会给出"等待外部环境恢复"的不合理结论。归类 framework_fault，
   * 修复框架侧后 --resume 重检。
   */
  product_selection_probe_failed: { class: 'framework_fault' },

  // --- 预算熔断（本 run 内无从调整——DEFAULT_MAX_BACKTRACKS 是硬常量、
  //     budget 字段已入 manifest identity 冻结） ------------------------------
  budget_wall_clock: { class: 'operator', structurally_terminal: true },
  no_progress_fuse: { class: 'operator', structurally_terminal: true },
  closure_wall_repeated: { class: 'operator', structurally_terminal: true },

  // --- 框架自身缺陷 ---------------------------------------------------------
  framework_bug: { class: 'framework_fault' },
  framework_integrity_block: { class: 'framework_fault' },
  framework_internal: { class: 'framework_fault' },
  /** closure 探针子进程异常 / 状态不变式被破坏——框架侧缺陷，人也修不了产物。 */
  closure_probe_error: { class: 'framework_fault' },
  closure_state_invariant: { class: 'framework_fault' },
  /** session 内 phase 执行抛异常（driver 侧）——按框架缺陷处置，不诱导 agent 改产物。 */
  in_session_phase_exception: { class: 'framework_fault' },

  // --- 元门禁扫描域扩展补登（codex 七轮 P1：原扫描只覆盖 goal-runner.ts，
  //     session driver / delegated producer 的 halt_reason 从未入册，「全覆盖」是虚的）。
  //     一律按**保持现行行为**的类登记（这些今天都是停下求人/等外部），
  //     绝不落 recoverable —— 映射完整 ≠ 行为改动。
  /** 仅剩需真人签字/确认项，内容重试无意义（actionability 聚合层出口）。 */
  await_human_gate_deferral: { class: 'operator' },
  /** 存在 toolchain 阻塞项——环境修好后继续。 */
  await_operator_toolchain: { class: 'external' },
  /** in-session 调和熔断（goal-mode-entry）。codex 七轮 P1：`fuse_reason` **持久化在
   *  会话状态里**，下一次进入立即再次 fused，同一 run 没有清除或恢复入口——按
   *  structurally_terminal 的既定定义（不存在使本 run 能继续的未来输入）应判 terminal，
   *  而不是「等人一下就能续」的 WAITING(human)。 */
  in_session_reconcile_fused: { class: 'operator', structurally_terminal: true },
  /** no-progress 家族：签名重复 / 超时无进展——盲重试只烧预算，停下求人。 */
  no_progress_guard: { class: 'operator' },
  /** codex 八轮 P1：产生端把 agent_timeout 与 toolchain/capture 同归「基建/环境问题」
   *  （goal-runner driverGuard 分支注释原文），且既有 `agent_timeout_repeated` 也是
   *  external——判 operator 会错报成「等人决策」。 */
  no_progress_agent_timeout: { class: 'external' },
  /** 视觉门禁无改善熔断（与基建类分流，见 goal-runner driverGuard 分支注释）。 */
  no_progress_visual_gap: { class: 'operator' },
  /** 基建类无进展：工具链 / 采集失败——环境修好后继续。 */
  no_progress_toolchain: { class: 'external' },
  no_progress_capture: { class: 'external' },
  /** CUMULATIVE 家族（原按 failureKind 模板生成 id，已收敛为稳定 literal）。
   *  codex 八轮 P1：**必须拆两个**——CUMULATIVE_HALT_FAMILY 同时含 `toolchain`（等环境）
   *  与 `await_human_confirm`（等人；c7e4a2d9 已把 await_human_p0_skip 移出家族），
   *  压成一个会让 wait_kind 真值永久丢失，而下游被禁止读 failure_kind_classified 自行纠正。 */
  no_progress_cumulative_external: { class: 'external' },
  no_progress_cumulative_human: { class: 'operator' },
  /** 设备就绪门（delegated producer：device-readiness-gate）。 */
  device_not_ready: { class: 'external' },
  /** codex 七轮 P1：AMBIGUOUS 的原契约是「多设备无法唯一确定 → HALT 求人，须用户配置
   *  target_serial」——登记成 external 会产出 WAITING(external) 的错误报告（等环境自愈，
   *  可这环境不会自愈）。它等的是**人做一次配置决定**。 */
  device_target_ambiguous: { class: 'operator' },

  // --- harness 侧 blocking_class（与上面的 halt_reason 同为 incident 形态；
  //     观测层按同一注册表投影，见 projectToObservedActionability） --------------
  /** unauthorized_source_mutation 的 harness 侧孪生：同样走保守回退重验。 */
  goal_post_review_source_mutation_unresolved: {
    class: 'recoverable', recover_action: 'backtrack_to_coding',
  },
  await_human_fidelity_tier: { class: 'operator', requires_grant: 'fidelity_downgrade' },
  needs_human: { class: 'operator' },
  /** codex 第九批 P1：--supersede 参数校验失败的启动期优雅收口（改参数重跑即可） */
  supersede_target_invalid: { class: 'operator' },
  device_toolchain: { class: 'external' },

  // --- 5b：快照/事务故障的行为映射 -----------------------------------------
  // 证据缓存只负责让责任阶段重新取得 PASS；它不产生人工授权，也不把旧字节写回宿主。
  // pre-invoke 的失败点在写保护边界，可能是磁盘/权限等外部条件，因此保留 external
  // 等 probe；其余纯缓存/事务故障走可重复的责任阶段恢复。
  pass_snapshot_unavailable: {
    class: 'recoverable', recover_action: 'retry_transaction', suspected_misclassified: true,
  },
  pass_snapshot_restore_refused: {
    class: 'recoverable', recover_action: 'retry_transaction', suspected_misclassified: true,
  },
  pass_snapshot_journal_unverifiable: {
    class: 'recoverable', recover_action: 'retry_transaction', suspected_misclassified: true,
  },
  pre_invoke_snapshot_failed: { class: 'external', suspected_misclassified: true },
  /** runner-owned-machine-facts：invoke 前回执骨架写失败（目录只读/模板缺失/文件占用）。
   *  不启动 agent、不烧 attempt——静默吞会让旧身份回执存活，receipt_attempt_identity
   *  死结复发；外部存储条件恢复后 probe 续跑。 */
  receipt_scaffold_unwritable: { class: 'external' },
  /** plan c6a9e4d2 P0-2：Windows containment 绑定失败且 guardian 未证明消失——
   *  旧 agent 无 Job 契约仍在野（kill 失败/复验仍活），halt 阻断续跑求人（真冲突
   *  勿自动覆盖）；人工清理后 --resume（接管对账再拦/放行）。 */
  agent_containment_unresolved: { class: 'external' },
  /** 责任阶段统一路由（plan b6e4c9f2）：可信缺陷候选写不回 summary（唯一真源）——
   *  assess 因此看不见缺陷、回退链断裂。存储条件问题，修好后 probe 续跑。 */
  repair_candidates_unwritable: { class: 'external' },
  closure_finalization_failed: {
    class: 'recoverable', recover_action: 'retry_transaction', suspected_misclassified: true,
  },
  goal_review_closure_baseline_unavailable: {
    class: 'recoverable', recover_action: 'backtrack_to_coding', suspected_misclassified: true,
  },
} as const satisfies Record<string, IncidentSpec>);

/**
 * incident id 归一：runner 有若干 halt_reason 携带运行时明细后缀
 * （如 `assess_halt:<reason>`）——注册表按**基名**索引，明细不进键空间。
 */
export function normalizeIncidentId(incident: string): string {
  const i = incident.indexOf(':');
  return (i > 0 ? incident.slice(0, i) : incident).trim();
}

export function lookupIncident(incident: string): IncidentSpec | undefined {
  const key = normalizeIncidentId(incident);
  return Object.prototype.hasOwnProperty.call(INCIDENT_REGISTRY, key)
    ? INCIDENT_REGISTRY[key]
    : undefined;
}

export function incidentClassOf(incident: string): IncidentClass {
  return lookupIncident(incident)?.class ?? 'unknown';
}

// ---------------------------------------------------------------------------
// 决策代数
// ---------------------------------------------------------------------------

export type WaitKind = 'human' | 'external';

export type Decision =
  | { kind: 'continue'; reason: string }
  | { kind: 'recover'; action: RecoverAction; reason: string }
  | { kind: 'waiting'; wait_kind: WaitKind; reason: string }
  | { kind: 'terminal'; reason: string };

/** 统一投影（report / monitor / supervisor 的共同消费面；本 plan 只定义与发布）。 */
export type Disposition = 'RESUME_READY' | 'RECOVERY_PENDING' | 'WAITING' | 'TERMINAL';

/**
 * **统一投影的唯一出口**（codex 七轮 P1-③）：事件字段用 `run_disposition` /
 * `run_wait_kind`，**不复用 `disposition`**——该字段名在 events 里已被占用且值空间不同
 * （run-control 的 `'recovered'`、visual round receipt 的 `'appended'|'duplicate'|
 * 'append_failed'`，且 GoalRunEvent.disposition 类型是宽泛 string）。下游 reducer 按名
 * 取值会撞车，靠 event type 消歧则等于要求每个消费方各记一份对应关系。
 *
 * 下游（report / monitor / supervisor）只读这两个字段，**不得回读原始事故原因补算**。
 */
export function runDispositionFields(decision: Decision): {
  run_disposition: Disposition;
  run_wait_kind?: WaitKind;
} {
  const run_disposition = dispositionOf(decision);
  return decision.kind === 'waiting'
    ? { run_disposition, run_wait_kind: decision.wait_kind }
    : { run_disposition };
}

/** 通用投影所用的中性上下文：铁律(c) 保证 can_prompt_now/orchestration 不影响裁决，
 *  真正影响结果的 `invocation` 只对 lineage 家族有意义，而那条路已显式传自己的裁决。 */
const NEUTRAL_PROJECTION_CONTEXT: ExecutionContext = {
  orchestration: 'goal',
  owner_kind: 'process',
  can_prompt_now: false,
  invocation: 'fresh',
};

/**
 * **结构敏感 incident**（e5d8a2c4 T1⑤）：`decide()` 的输出依赖 incident id **之外**
 * 的结构 facts（backtrackBlocked 读回退预算/截断链/指纹）。这类事件的投影**必须在事故生产点**用完整
 * facts 计算——写盘层兜底只有 halt_reason，会把 TERMINAL 化妆成 RECOVERY_PENDING
 * （d6b1a8e3 t5④ 的原始反例）。集合由注册表**派生**，不手写第二份清单：
 * `class==='recoverable' && !structurally_terminal`（structurally_terminal 在
 * decide 最前直接 terminal、零 facts——其余家族的兜底与生产点计算**数学等价**：
 * 纯函数、同输入。operator 类兜底 NO_AUTHORITY 亦等价——生产点若有 grant 就不会
 * emit halt）。
 */
export function isStructuralFactsIncident(incident: string): boolean {
  const spec = lookupIncident(incident);
  return Boolean(spec && spec.class === 'recoverable' && !spec.structurally_terminal);
}

/**
 * **投影注入点（d6 t5⓪；T1⑤ 收敛）**：带 `halt_reason` 的事件在**写盘那一层**补
 * `run_disposition` / `run_wait_kind`——这**不是第二裁决**，而是**等价延迟投影**：
 * 对非结构敏感 incident，`decide({incident})` 与生产点计算是纯函数同输入，结果
 * 逐字段一致（该等价性由 adjudication 单测钉为契约）。
 *
 * 为什么不在 29 个 emit 点各写一遍：那等于要求每个新增 halt 的作者都记得补投影，
 * 漏一个 supervisor 就无判据——与「新增 incident 不注册即红」是同一类问题。
 *
 * **已显式携带 `run_disposition` 的事件原样放行**——调用方投影了真实 `decide()`
 * 结果（含结构性事实），不得覆盖。
 *
 * **结构敏感 incident 缺投影 = 开发错误**（T1⑤）：**拒绝化妆**——原样放行
 * （宁缺判据，不给错误判据；下游对缺投影按 `halted` 原样显示），并打日志。
 * **如实边界（codex 第九批 P3）**：本守卫当前只是"拒化妆+日志"，不是"测试直接
 * 失败"级 fail-loud——被测保护是 t5⓪ 元门禁的 disguised 断言（写盘层不化妆）与
 * 集合派生断言；"生产 emit 点缺投影会红"的生产路径断言随 T2 5b（六条改行为，
 * 会重排 halt 生产面）一并收口，不在此提前建出口注册表。
 */
export function withRunDisposition<T extends Record<string, unknown>>(
  event: T,
  context?: Partial<ExecutionContext>,
): T & { run_disposition?: Disposition; run_wait_kind?: WaitKind } {
  if (event.run_disposition !== undefined) return event;
  const incident = typeof event.halt_reason === 'string' ? event.halt_reason.trim() : '';
  if (!incident) return event;
  if (isStructuralFactsIncident(incident)) {
    console.error(
      `[adjudication] 开发错误：结构敏感 incident（${incident}）的 halt 事件缺少生产点投影`
      + '——写盘层拒绝用兜底 facts 化妆（会把 TERMINAL 算成 RECOVERY_PENDING）。'
      + '请在 emit 点用完整 facts 调 decide() 并 runDispositionFields() 显式投影。',
    );
    return event;
  }
  const decision = decide({ incident }, NO_AUTHORITY, { ...NEUTRAL_PROJECTION_CONTEXT, ...context });
  return { ...event, ...runDispositionFields(decision) };
}

export function dispositionOf(decision: Decision): Disposition {
  switch (decision.kind) {
    case 'continue': return 'RESUME_READY';
    case 'recover': return 'RECOVERY_PENDING';
    case 'waiting': return 'WAITING';
    default: return 'TERMINAL';
  }
}

/** ut drift 走保守恢复时的决策原因——**不复用授权语义**（不产 matched_receipts）。 */
export const UNTRUSTED_DRIFT_REASON = 'untrusted_source_drift_revalidation';

function hasGrant(authority: AuthorityFacts, action: string): boolean {
  return authority.grants.some((g) => g.action === action && Boolean(g.binding));
}

/** 回退的结构前提（任一不满足 → 结构上无法在本 run 恢复）。 */
function backtrackBlocked(facts: IncidentFacts): string | null {
  if (facts.chain_has_coding_review === false) {
    return '截断链（chain 不含 coding/review）无法回退重验，须新起 coding 起点 run';
  }
  if (typeof facts.backtrack_budget_remaining === 'number' && facts.backtrack_budget_remaining <= 0) {
    return '回退预算已耗尽（DEFAULT_MAX_BACKTRACKS 为硬常量，run 内无从调整）';
  }
  if (facts.round_fingerprint_repeated === true) {
    return '整轮 actionable 集合指纹与上次回退完全相同——继续回退只会空转';
  }
  return null;
}

/**
 * 唯一裁决点。
 *
 * 契约：
 *  - 纯函数：不读 env、不做 I/O、**不修改入参**（铁律 b）；
 *  - `context.can_prompt_now` **不改变输出**（铁律 c）——它只供 L3 话术选择同步提问
 *    还是停放措辞。单测 `can_prompt_now 翻转不改判` 锁死该性质。
 *  - 相同 facts + authority + context → 相同决定（t4 契约 (b)）。
 */
export function decide(
  facts: IncidentFacts,
  authority: AuthorityFacts,
  context: ExecutionContext,
): Decision {
  const spec = lookupIncident(facts.incident);
  if (!spec) {
    // fail-safe：未注册 incident 一律保守停放，绝不自动恢复也不自动放行。
    return {
      kind: 'waiting',
      wait_kind: 'human',
      reason: `未注册 incident（${facts.incident}）——保守停放（fail-safe）`,
    };
  }

  if (spec.structurally_terminal) {
    return { kind: 'terminal', reason: spec.recover_action
      ? `${facts.incident}：结构上无法在本 run 恢复`
      : `${facts.incident}：本 run 结构上无法继续` };
  }

  switch (spec.class) {
    case 'recoverable': {
      const action = spec.recover_action;
      if (!action) {
        return { kind: 'waiting', wait_kind: 'human', reason: `${facts.incident}：可恢复但未声明恢复动作` };
      }
      // retry_transaction 只重跑当前责任阶段，不消费回退预算，也不依赖 coding/review
      // 链；预算/截断/指纹只约束真正跨阶段的 backtrack_to_coding。
      const blocked = action === 'backtrack_to_coding' ? backtrackBlocked(facts) : null;
      if (blocked) return { kind: 'terminal', reason: blocked };
      return {
        kind: 'recover',
        action,
        reason: action === 'backtrack_to_coding'
          ? `${UNTRUSTED_DRIFT_REASON}：失效旧 coding closure 及其后阶段，携未受信 diff 完整重验`
          : `${facts.incident}：重试可恢复事务`,
      };
    }
    case 'operator': {
      if (spec.requires_grant && hasGrant(authority, spec.requires_grant)) {
        return { kind: 'continue', reason: `已验证授权（${spec.requires_grant}）放行` };
      }
      return {
        kind: 'waiting',
        wait_kind: 'human',
        reason: spec.requires_grant
          ? `${facts.incident}：缺已验证授权（${spec.requires_grant}）——停放等人`
          : `${facts.incident}：需要人的决定——停放等人`,
      };
    }
    case 'external':
      return { kind: 'waiting', wait_kind: 'external', reason: `${facts.incident}：外部条件未满足——环境恢复后继续` };
    case 'framework_fault':
      return { kind: 'waiting', wait_kind: 'external', reason: `${facts.incident}：框架缺陷——修复并重新发布后继续（agent 不得改自己产物绕过）` };
    default:
      return { kind: 'waiting', wait_kind: 'human', reason: `${facts.incident}：分类未知——保守停放` };
  }
}
