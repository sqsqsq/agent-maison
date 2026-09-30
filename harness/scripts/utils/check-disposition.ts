// ============================================================================
// check-disposition.ts — 失败检查的处置函数与判定谓词（plan f7045213 §3）
// ----------------------------------------------------------------------------
// 一个失败检查"挡不挡本阶段通过"只在这里决定；读它的地方（结论、计数、质量轴、阻断清单、
// 各阶段聚合状态……）一律调判定谓词，不再各写一份 `status === 'FAIL' && severity === 'BLOCKER'`。
//
// 处置规则按序，**没有第四条**：
//   1. 不是失败，或严重级别不是阻断 → 不阻断；
//   2. 命中去向表 → 按表；
//   3. 其余 → 按检查自己声明的严重级别与状态（阻断）。
// 运行时认不出的 id（动态拼出来的、经包装的、用常量间接定义的）都走第 3 条，保持原处置。
// "新增的阻断检查必须先声明它保护什么"由开发期静态守卫保证（tests/unit/check-disposition），
// 不在运行时按"认不认识这个 id"决定披露。
// ============================================================================

/** 按保护对象四分（§3.1）。 */
export type ProtectedObject = 'product_truth' | 'result_basis' | 'ledger_shape' | 'capability_gap';

/** 结果依据类必填：当前阶段，或 spec / plan / coding 之一（§3.2）。 */
export type DispositionOwner = 'current_phase' | 'spec' | 'plan' | 'coding';

/** 精确 id；或受限的动态族（固定前缀 + 产出它的唯一生产点，仓库相对路径）。 */
export type DispositionMatch = { id: string } | { prefix: string; producer: string };

export interface DispositionEntry {
  match: DispositionMatch;
  protects: ProtectedObject;
  owner?: DispositionOwner;
  /** 依据：事故或清单编号 */
  basis: string;
  /** 放过它的后果：一句话 */
  consequence: string;
}

/**
 * 去向表：只登记去向**发生变化**的检查。表里没有的检查按自身声明处置，行为不变。
 * 首批分类（§6，2026-09-29）：取证见 dist/reliability-baseline/p4-first-classification.md，codex 逐条评审后 7 条。
 * 暂缓：`authoritative_content_aligned`（drift/invalid 两分支责任方不同，检查结果无结构字段可区分），仍按声明阻断，
 * 归因经既有确定性门禁表。
 * 第二批（plan 3abca824 t4，2026-09-29）：探索记录 4 条，取证与 codex 逐条评审见该 plan §12；三条探索方式声明与
 * 必读输入覆盖不登记，`origin_tag_required`、`seed_no_technical_words` 暂缓。
 */
export const DISPOSITION_TABLE: readonly DispositionEntry[] = [
  {
    // spec 门是排除登记引文约束的执行点；授权判定处另做同源引文核验（visual-diff-check elementScope）。
    match: { id: 'ref_elements_excluded' }, protects: 'result_basis', owner: 'current_phase',
    basis: 'c4e7a9b2 A2-4；取证清单 #34',
    consequence: 'agent 自登记排除，真实视觉缺失在 testing 被当作需求排除剔出返修，"视觉通过"失去依据',
  },
  {
    // 自报估计值，框架无法核实；可核实的探索门（source_code_paths_min/exist、code_facts_min）继续阻断。
    // request 保留原生语义（request-phase 输入检查遇任意 FAIL 即不执行 checker；request 结论任意 FAIL 即失败）。
    match: { id: 'context_exploration_searches_min' }, protects: 'ledger_shape',
    basis: '取证清单 #37（无宿主 FAIL 事故）',
    consequence: '探索记录上的"估计搜索次数"偏低；探索是否真实发生仍由可核实的检查裁决',
  },
  {
    // 自报字符串，且声明 sequential 即可合法绕开；request 限制同上。
    match: { id: 'context_exploration_subagents_used' }, protects: 'ledger_shape',
    basis: '取证清单 #38（无宿主 FAIL 事故）',
    consequence: '探索记录里"用了哪些子 agent"缺失',
  },
  {
    // 版本标签无消费者按其分支，身份由 context_exploration_facts_run_match 独立核。
    // 入口边界：链首建立阶段仍被 capability-resolution-entry-input 以 capability_resolution_contract 拦下（确定性门禁，保留）；
    // request 限制同上。披露只在非链首阶段与无调用上下文的旧路径生效。
    match: { id: 'context_exploration_facts_schema_version' }, protects: 'ledger_shape',
    basis: 'd9b4f7e2 P1-8（宿主 chrys i4/i5 两轮在版本号写混上失败重试）；取证清单 #39',
    consequence: 'facts 的版本标签写错；没有代码按这个版本号走不同解析',
  },
  {
    // feature 阶段披露；独立预校验 CLI（validate-ut-artifact）不读检查结果，仍保留原判定。
    // 真实编译与执行门裁决 UT 代码；MockKit 场景缺 strategy 由 ut_hypium_mockkit_policy 独立阻断。
    match: { id: 'ut_mock_plan_typed' }, protects: 'ledger_shape',
    basis: '取证清单 #45（无宿主 FAIL 分支事故）',
    consequence: 'mock-plan 某些替身预设缺粗类型标注，或完全没有 returns / throws 表达式（doubles 缺 strategy 另由 MockKit 策略门阻断）',
  },
  {
    // "标签在开头"无下游消费（覆盖匹配是包含匹配）；覆盖由 acceptance_coverage / ut_case_per_unit_ac 裁决。
    // 同一 FAIL 里的"需求模式禁止 [REG-*]"限制一并解除，不需要替代门（[REG-*] 本不计入任何 AC 覆盖）。
    match: { id: 'it_name_has_ac_or_branch_tag' }, protects: 'ledger_shape',
    basis: '423e5d0f（本门曾逼存量用例挂 [AC-*] 造成假覆盖与 path-c 死锁）；取证清单 #46',
    consequence: '某些 it() 名不以追溯标签开头；名称中间的有效 AC 标签仍按包含匹配计入覆盖，完全不带标签的只是不计入',
  },
  {
    // 加载器把缺失补成 1.0，只有字面空串才 FAIL；无下游按版本号做决定。
    match: { id: 'schema_version_present' }, protects: 'ledger_shape',
    basis: '取证清单 #55（codex 评审补登：显式空串会触发 catalog 与 glossary 的 BLOCKER）',
    consequence: 'catalog / glossary 的版本标签为空串',
  },
  // ---- 第二批（plan 3abca824 t4）----
  {
    // 自报文件数；checkpoint 恢复只用 readyToProduce、路径、时间与范围，不读它。来源可读性、Code Facts 与真实目标覆盖
    // 另有检查继续阻断。入口：实际运行量化检查且文件数阈值大于零的 feature 入口；有效 baseline 路径通常已把该阈值降为零。
    match: { id: 'context_exploration_files_inspected_min' }, protects: 'ledger_shape',
    basis: '无宿主失败事故；P5 取证清单 #P1 与 codex 评审：与已登记的 searches_min 同形、同一条探索消费链，自报数不参与下游决策',
    consequence: '探索记录的自报文件数低于阈值；不再据此阻断，来源可读性、事实与目标覆盖检查保留',
  },
  {
    // 只查列表非空，检查器与 backfill 之外无读取方。入口：运行量化检查的 feature 路径，包括部分带 baseline 的现代调用。
    match: { id: 'context_exploration_decisions_unlocked' }, protects: 'ledger_shape',
    basis: '无宿主失败事故；P5 取证清单 #P2 与 codex 评审：无决策消费的声明列表，同一条探索消费链',
    consequence: '未列出本次探索解锁的决策；产出本身及其语义审查仍须完成',
  },
  {
    // "无新增"（none）是合法状态；节的在场状态进证据指纹（factsPhaseFingerprint），缺节也可稳定绑定。有调用上下文时
    // 目标覆盖仍由 context_exploration_facts_scope_coverage 裁决，旧路径没有这层额外覆盖保证。
    // 入口：按实际调用上下文判定的非建立阶段；旧路径按 track 判定。
    match: { id: 'context_exploration_facts_phase_delta_missing' }, protects: 'ledger_shape',
    basis: '无宿主失败事故；P5 取证清单 #P11 与 codex 评审："无新增"是合法状态，在场状态进指纹，覆盖与新鲜度另有检查',
    consequence: '本阶段没有增量小节，不能据此声称已记录"无新增"；当前事实覆盖与证据新鲜度仍独立裁决',
  },
  {
    match: { id: 'context_exploration_facts_phase_delta_empty' }, protects: 'ledger_shape',
    basis: '无宿主失败事故；P5 取证清单 #P12 与 codex 评审：同上一条',
    consequence: '本阶段增量小节为空，缺少新增事实或显式"无新增"声明；其它事实与证据检查保留',
  },
];

let activeTable: readonly DispositionEntry[] = DISPOSITION_TABLE;

/**
 * 测试专用：在 fn 执行期间让所有消费者读到注入的去向表，结束即还原。
 * 这样测试可以用非空去向表走真实消费链，而不往生产去向表里加测试条目。
 */
export function withDispositionTableForTest<T>(table: readonly DispositionEntry[], fn: () => T): T {
  const previous = activeTable;
  activeTable = table;
  let result: T;
  try {
    result = fn();
  } catch (error) {
    activeTable = previous;
    throw error;
  }
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    return (result as unknown as Promise<unknown>).finally(() => {
      activeTable = previous;
    }) as unknown as T;
  }
  activeTable = previous;
  return result;
}

/** 处置函数与谓词只读这三个字段；CheckResult、summary blocker、verifier 资格输入都满足。 */
export interface DispositionCheck {
  id: string;
  status: string;
  severity?: string;
}

export type CheckDisposition =
  | { action: 'none' }
  | { action: 'block'; entry: DispositionEntry | null }
  | { action: 'disclose'; entry: DispositionEntry };

const NONE: CheckDisposition = { action: 'none' };

export function findDispositionEntry(
  id: string,
  table: readonly DispositionEntry[] = activeTable,
): DispositionEntry | null {
  for (const entry of table) {
    const m = entry.match;
    if ('id' in m ? m.id === id : id.startsWith(m.prefix)) return entry;
  }
  return null;
}

/** 处置函数（§3.3）。 */
export function resolveCheckDisposition(
  check: DispositionCheck,
  table: readonly DispositionEntry[] = activeTable,
): CheckDisposition {
  if (check.status !== 'FAIL' || check.severity !== 'BLOCKER') return NONE;
  const entry = findDispositionEntry(check.id, table);
  if (!entry) return { action: 'block', entry: null };
  // 账本与形状：对不齐的披露、不阻断；能力缺口沿用既有通道（外部阻塞投影由结论函数负责）。
  return entry.protects === 'ledger_shape' ? { action: 'disclose', entry } : { action: 'block', entry };
}

/**
 * §7：结果依据类的责任方——归因、责任方、受影响文件提取消费同一份有效映射的去向表一半
 * （登记了的读这里，没登记的由调用方读既有的确定性门禁表与责任归属注册表）。非结果依据类返回 null。
 */
export function resultBasisOwner(id: string, table: readonly DispositionEntry[] = activeTable): DispositionOwner | null {
  const entry = findDispositionEntry(id, table);
  return entry?.protects === 'result_basis' ? (entry.owner ?? null) : null;
}

/** 判定谓词：它是否阻断本阶段通过。只是处置函数的布尔投影。 */
export function isBlockingCheck(
  check: DispositionCheck,
  table: readonly DispositionEntry[] = activeTable,
): boolean {
  return resolveCheckDisposition(check, table).action === 'block';
}

/** summary 的被披露失败清单一条（§4.3）。 */
export interface DisclosedFailure {
  id: string;
  protects: ProtectedObject;
  severity: string;
  details_excerpt: string;
}

export function collectDisclosedFailures(
  checks: ReadonlyArray<DispositionCheck & { details?: string }>,
  table: readonly DispositionEntry[] = activeTable,
): DisclosedFailure[] {
  const out: DisclosedFailure[] = [];
  for (const check of checks) {
    const d = resolveCheckDisposition(check, table);
    if (d.action !== 'disclose') continue;
    const details = (check.details ?? '').replace(/\r/g, '');
    out.push({
      id: check.id,
      protects: d.entry.protects,
      severity: String(check.severity),
      details_excerpt: details.length > 500 ? `${details.slice(0, 500)}…` : details,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// §4.4 聚合的运行状态检查
// ---------------------------------------------------------------------------

/**
 * coding / testing 的运行状态检查是聚合：除源检查的阻断失败，还消费关键的阻断跳过与文档在场性。
 * 聚合照常产出、照常参与结论；只有当同一失败已由源 blocker 表达时，才不进阻断清单、签名与计数。
 */
export const AGGREGATE_RUN_STATUS_CHECK_IDS: ReadonlySet<string> = new Set(['coding_run_status', 'testing_run_status']);

/** 聚合项 details 的 `blocker_fail_ids:` 行（两个聚合构造器同一写法，与 runner 读 can_claim_done 同一做法）。 */
function aggregateSourceBlockerIds(details: string | undefined): string[] {
  const m = /^blocker_fail_ids:\s*(.+)$/m.exec(details ?? '');
  return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
}

/**
 * 输入：已按谓词筛出的阻断检查。去掉"源失败已在清单里"的聚合项；
 * 聚合失败而没有任何源 blocker（只由关键跳过或文档缺失引起）时保留，运行时归因与签名因此总有输入。
 */
export function dropRedundantAggregates<T extends { id: string; details?: string }>(blocking: readonly T[]): T[] {
  const ids = new Set(blocking.map(c => c.id));
  return blocking.filter(
    c => !(AGGREGATE_RUN_STATUS_CHECK_IDS.has(c.id) && aggregateSourceBlockerIds(c.details).some(id => ids.has(id))),
  );
}
