import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { loadFrameworkConfig, resolveFeatureArtifact, featurePhaseReportsDir, featureFilePath } from '../../config';
import { featureRelativePath } from './feature-identity';
import { deviceTestEvidencePath, type DeviceDefectClassification, type DeviceTestEvidenceCase, type DeviceTestEvidenceDoc } from './device-test-evidence-shared';
import { resolveAuthoritativeHylyreTracePath } from './testing-trace-gates';
import { parseTestCaseFlowBlock, triageCascade } from './test-case-flow';
import { loadAuthoritativeEvents, type GoalRunEvent } from './goal-runner-phase';

/** Read the same formal visual disposition used by the current gate, without writing projections. */
export function readCurrentActionableEvidence(projectRoot: string, feature: string, runId: string, frameworkRoot?: string): ActionableCollectResult {
  const reports = featurePhaseReportsDir(projectRoot, feature, 'testing', frameworkRoot);
  const events = loadAuthoritativeEvents(featureFilePath(projectRoot, feature, `goal-runs/${runId}/events.jsonl`));
  const end = [...events].reverse().find(event => event.type === 'harness_end' && event.phase === 'testing' && !event.timed_out);
  const start = end && [...events.slice(0, events.indexOf(end))].reverse().find(event => event.type === 'harness_start'
    && event.phase === 'testing' && event.invoke_id === end.invoke_id);
  const attempt = typeof start?.invoke_id === 'string' ? start.invoke_id.replace(/^testing-/, '') : '';
  const visual = readFreshVisualDisposition(start?.ts && attempt ? path.join(reports, 'summary.json') : null,
    { runId, attemptId: attempt, startedAtMs: start?.ts ? Date.parse(start.ts) : 0 });
  return collectActionableDefects(projectRoot, feature, runId, undefined, visual.downgradedScreens, visual.t8Findings);
}

/** features_dir 相对路径（写入边界判定用） */
function featuresDirRelOf(projectRoot: string): string {
  try {
    return (loadFrameworkConfig(projectRoot).paths.features_dir ?? 'doc/features').split(path.sep).join('/');
  } catch {
    return 'doc/features';
  }
}

/**
 * ============================================================================
 * F1（plan d8c5f3a7 v23）：统一可回修缺陷收集 —— ActionableDefect
 * ----------------------------------------------------------------------------
 * 回修输入**只有两项已存在的可靠事实**（v22 已删通用指标契约——score_floor 系
 * reference_only 被实测证伪、blank_ratio 无区分力，那套只会打回好版本）：
 *   A) visual-diff.json 里**新鲜**的 must_fix（5 条谓词，见下）；
 *   B) 本轮导航**新增** faultlog 的 crash_suspected（F3 集合差归档，含 run_id）。
 *
 * 【actionable 谓词（v23 冻结，5 条同时满足）】
 *   ① verdict ∈ {warn, fail}；② must_fix[] 非空；③ evaluated_screenshot_hash 与
 *   盘上截图一致；④ evaluated_build_fingerprint 与当前 build 一致（可算时）；
 *   ⑤ 未被判 stale / evaluation_invalidated。
 *   ③④⑤ 复用 profile 的 isStaleVisualDiffVerdict（同一判据，不另造）。
 *   **新鲜度由 identity 判定，不看 run_id**：上一 run 但 build+截图完全一致的缺陷
 *   仍是真缺陷（visual-diff 判定本就设计为同一构建下跨轮持久）；污染 invocation 遗留
 *   的产物由 ③④ 自动失效——不需要 quarantine。
 * ============================================================================
 */
export interface ActionableDefect {
  source: 'visual_diff' | 'crash' | 'device_test';
  screen_or_case_id: string;
  /** 修复指令（visual=must_fix 原文；crash=确定性指令），进 coding prompt */
  instructions: string[];
  /** 结构化锚优先（screen|class|element|bbox 桶，复用 computeDefectFingerprint）；
   * 无结构化锚时退回规范化文案哈希 */
  fingerprint: string;
  /** 证据路径——由 runner 按已知目录结构拼接，**不信任产物自报**（防指向任意文件） */
  evidence_path: string;
  /**
   * adjudicated-repair-loop（plan e2b7c4a9）：是否**结构化视觉信号**（来自 visual-diff
   * json 的结构化 defect，identity = sha256(computeDefectFingerprint(screen, defect))）。
   * 仅此类进入 signal@1 身份（累计收敛与 no-op 判定）；crash / device_test / 纯文本 must_fix
   * 兜底保持既有 legacy 契约（不入累计收敛）。
   */
  signal_identity: boolean;
}

export interface UnverifiedDefect {
  screen_or_case_id: string;
  reason: string;
  reason_code: string;
  source: 'visual' | 'device_test';
  fingerprint: string;
}

export interface ActionableCollectResult {
  defects: ActionableDefect[];
  /**
   * 身份不可核实的 must_fix（review 第 11 轮 P1）：warn/fail + 非空 must_fix 在场，但
   * 截图/build 身份缺失或不可算——**不可信缺陷不得触发回退**（改码方向可能是错的），
   * 但也**不等于没有缺陷**：调用方在 testing 内按 FAIL/retry 处置（引导重采补身份），
   * 耗尽后 halt。真实生产路径可达：install 成功但 install meta 写失败 → currentFp
   * 算不出 → 已知 must_fix 若静默丢弃，best_effort 下 gate 只 WARN、run 直接 advance。
   */
  unverified: UnverifiedDefect[];
  /**
   * f4b2c8e6 t1：仅在正式 device evidence 通过绑定校验后提供。test_case_flow 可用时只含
   * 根/独立失败；flow 缺失或 triage 失败时保守包含全部 failed case，这只会阻止 all-test_contract
   * 精修，不会造成错误精修。undefined = 无 evidence 或 evidence 不可信。
   */
  trustedDeviceRootClassifications?: DeviceDefectClassification[];
}

/** d9e4b7c1 T2：collector 的 device_test 消费上下文（runner 内存直传，禁从事件反推） */
export interface DeviceTestCollectContext {
  attemptId: string;
  /** 当前 attempt 冻结的设备元组（a7 就绪门 deviceEnv 同源） */
  expectedTarget: { serial: string | null; target_kind: string | null; session_id: string | null };
  /** 本 attempt 的 gate harness 窗口（written_at / run meta 的唯一时间裁决窗口） */
  harnessWindow: { startMs: number; endMs: number };
  /** testing 阶段 reports 目录（evidence 与 run meta 所在） */
  reportsDir: string;
  /** B08 D1（plan 9b2d5e7c）：工程根——复用 doc 的 reused_run_dir 相对它解析 */
  projectRoot: string;
  /**
   * B08 D1：当前盘上 HAP 的完整 sha256（goal 运行时从 device-test-install.meta.json + 盘上 HAP
   * 三核算出，见 resolveCurrentHapSha256Full）；null = 不可核验。只在 doc.install_reused 时消费。
   */
  currentHapSha256Full?: string | null;
}

/**
 * B08 D1（codex 第 2 轮 #3）：装机复用轮的"当前 HAP 完整摘要"——采信端在 harness 之外拿不到
 * holder，改从**既有装机产物**算：读 `reportsDir/device-test-install.meta.json` 的
 * hapPath / hapMtimeMs / hapSizeBytes / hapSha256（12 位短指纹），对盘上文件核 mtime 与 size
 * 一致后算 sha256 全量，并要求短指纹是其前缀；任一不符或 meta 缺失 → null。
 * 不新增身份系统、不与 doc 自身字段比较。
 */
export function resolveCurrentHapSha256Full(projectRoot: string, reportsDir: string): string | null {
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(reportsDir, 'device-test-install.meta.json'), 'utf-8'),
    ) as { hapPath?: unknown; hapMtimeMs?: unknown; hapSizeBytes?: unknown; hapSha256?: unknown };
    if (
      typeof meta.hapPath !== 'string' || !meta.hapPath.trim() ||
      typeof meta.hapMtimeMs !== 'number' || typeof meta.hapSizeBytes !== 'number' ||
      typeof meta.hapSha256 !== 'string' || !meta.hapSha256.trim()
    ) return null;
    const abs = path.isAbsolute(meta.hapPath) ? meta.hapPath : path.join(projectRoot, meta.hapPath);
    const st = fs.statSync(abs);
    if (st.mtimeMs !== meta.hapMtimeMs || st.size !== meta.hapSizeBytes) return null;
    const full = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    return full.startsWith(meta.hapSha256.trim().toLowerCase()) ? full : null;
  } catch {
    return null;
  }
}

/**
 * d9e4b7c1 T2：evidence 绑定校验（纯函数导出供单测）。任一环不满足返回人读原因
 * （调用方把该轮全部失败 case 归 unverified）；全部通过返回 null。
 */
export function validateDeviceTestEvidenceBinding(
  doc: DeviceTestEvidenceDoc,
  runId: string,
  ctx: DeviceTestCollectContext,
): string | null {
  if (doc.schema_version !== '1.1') return `evidence schema_version 不受支持：${String(doc.schema_version)}`;
  if (doc.goal_run_id !== runId || doc.attempt_id !== ctx.attemptId) {
    return `evidence 身份不匹配（${String(doc.goal_run_id)}/${String(doc.attempt_id)} vs 当前 ${runId}/${ctx.attemptId}）`;
  }
  const t = doc.device_target ?? { serial: null, target_kind: null, session_id: null };
  const e = ctx.expectedTarget;
  if (
    (t.serial ?? null) !== (e.serial ?? null) ||
    (t.target_kind ?? null) !== (e.target_kind ?? null) ||
    (t.session_id ?? null) !== (e.session_id ?? null)
  ) {
    return 'evidence 设备元组与当前 attempt 冻结元组不一致（比完整三元组，不只比 serial）';
  }
  // B08 D1（plan 9b2d5e7c）：复用态按"记录身份"采信——装机复用核当前 HAP 完整摘要（不要求本轮真装）；
  // 设备复用核被复用 run 的执行键记录（与 decideReuse 同一判据 isExecutionRecordReusable），跳过
  // run meta 时间窗（复用回填的是冻结 meta，时间必在窗外）。非复用 doc 四项检查逐字不变。
  const installReused = doc.install_reused === true;
  const runReused = doc.reused_by_execution_key === true;
  if (installReused) {
    if (!ctx.currentHapSha256Full) return '当前 HAP 完整摘要不可核验（install meta 缺失或与盘上 HAP 不一致）';
    if (doc.hap_sha256_full !== ctx.currentHapSha256Full) return '复用装机的 HAP 摘要与当前不一致';
  } else if (doc.install_executed !== true || doc.install_ok !== true) {
    return 'evidence 无本轮真实安装成功事实（install reuse/失败不作数）';
  }
  if (runReused) {
    const runDirRel = String(doc.reused_run_dir ?? '').trim();
    const runDir = runDirRel ? path.resolve(ctx.projectRoot, runDirRel) : null;
    let identity: { ok: boolean; reason: string };
    try {
      const profileDir = path.join(__dirname, '..', '..', '..', 'profiles', 'hmos-app', 'harness');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ek = require(path.join(profileDir, 'execution-key')) as {
        EXECUTION_KEY_FILE: string;
        isExecutionRecordReusable: (record: unknown, runDir: string, opts: { executionKey: string }) => { ok: boolean; reason: string };
      };
      if (!runDir || !doc.execution_key) {
        identity = { ok: false, reason: 'doc 缺 reused_run_dir / execution_key' };
      } else {
        const record = JSON.parse(fs.readFileSync(path.join(runDir, ek.EXECUTION_KEY_FILE), 'utf-8')) as { execution_key?: unknown };
        identity = ek.isExecutionRecordReusable(record, runDir, { executionKey: doc.execution_key });
      }
    } catch (e) {
      identity = { ok: false, reason: `执行键记录不可读：${(e as Error).message}` };
    }
    if (!identity.ok) return `复用记录身份不匹配（${identity.reason}）`;
  }
  // trace 一致性：writer 直取本轮 holder；collector 以权威 resolver 二次核验两者一致
  const authoritative = resolveAuthoritativeHylyreTracePath(ctx.reportsDir);
  if (!authoritative || path.resolve(authoritative) !== path.resolve(String(doc.trace_path ?? ''))) {
    return 'evidence trace_path 与权威派生计划选择不一致';
  }
  // 时间窗：written_at 是唯一裁决字段（文件 mtime 仅诊断）；run meta 窗口须同落 harness 窗口
  const writtenAt = Date.parse(String(doc.written_at ?? ''));
  if (!Number.isFinite(writtenAt) || writtenAt < ctx.harnessWindow.startMs || writtenAt > ctx.harnessWindow.endMs) {
    return 'evidence written_at 不在本 attempt 的 harness 窗口内';
  }
  if (runReused) return null; // 复用回填的是被复用 run 的冻结 meta，其时间窗由记录身份担保
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(ctx.reportsDir, 'device-test-run.meta.json'), 'utf-8'),
    ) as { run_started_at?: string; run_ended_at?: string };
    const rs = Date.parse(String(meta.run_started_at ?? ''));
    const re = Date.parse(String(meta.run_ended_at ?? ''));
    if (!Number.isFinite(rs) || !Number.isFinite(re) || rs < ctx.harnessWindow.startMs || re > ctx.harnessWindow.endMs) {
      return 'run meta 的 run_started_at/run_ended_at 不在本 attempt 的 harness 窗口内';
    }
  } catch {
    return 'device-test-run.meta.json 缺失或不可读（run 窗口无法核验）';
  }
  return null;
}

/**
 * plan 6644ea45 §4.4：从 fresh summary 同目录的 `script-report.json` 读 gate 物化的
 * `visual_diff.structured.downgraded_screens`（读法同 scope_revision_input）。summary fresh 只在完整
 * 检查链下蕴含报告同轮重写；`--sync-closure` 或报告生成前失败出口会只重写 summary、留下旧报告，
 * 故名单还须来自**本轮 gate 产物**：报告 mtime 不早于本轮 gate 起点，且 payload 既有身份字段
 * goal_run_id / attempt_id 等于本 run / 本 attempt。任一不满足、summary 不 fresh / 缺文件 / 缺字段 /
 * 解析失败 → 空集 = 现状（多回退，方向安全）。
 */
export function readFreshVisualDisposition(
  freshSummaryAbsPath: string | null,
  gate: { runId: string; attemptId: string; startedAtMs: number },
): { downgradedScreens: ReadonlySet<string>; t8Findings: readonly unknown[] } {
  const empty = () => ({ downgradedScreens: new Set<string>(), t8Findings: [] });
  if (!freshSummaryAbsPath) return empty();
  try {
    const reportFile = path.join(path.dirname(freshSummaryAbsPath), 'script-report.json');
    if (!fs.existsSync(reportFile) || fs.statSync(reportFile).mtimeMs < gate.startedAtMs) return empty();
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as {
      checks?: Array<{ structured?: { kind?: unknown; downgraded_screens?: unknown; t8_findings?: unknown; goal_run_id?: unknown; attempt_id?: unknown } }>;
    };
    const current = (report.checks ?? []).filter(check =>
      check.structured?.kind === 'visual_diff' && check.structured.goal_run_id === gate.runId && check.structured.attempt_id === gate.attemptId);
    return { downgradedScreens: new Set(current.flatMap(check =>
      check.structured?.kind === 'visual_diff' && Array.isArray(check.structured.downgraded_screens) &&
      check.structured.goal_run_id === gate.runId && check.structured.attempt_id === gate.attemptId
        ? check.structured.downgraded_screens.filter((s): s is string => typeof s === 'string')
        : [])), t8Findings: current.flatMap(check => Array.isArray(check.structured?.t8_findings)
          ? check.structured.t8_findings.filter(finding => finding && typeof finding.finding_id === 'string'
            && typeof finding.signal === 'string' && typeof finding.tier === 'string') : []) };
  } catch {
    return empty();
  }
}

export function collectActionableDefects(
  projectRoot: string,
  feature: string,
  runId: string,
  deviceTest?: DeviceTestCollectContext,
  /** 本轮gate物化结论，身份与窗口由readFreshVisualDisposition核验。 */
  downgradedVisualScreens?: ReadonlySet<string>,
  currentT8Findings?: readonly unknown[],
): ActionableCollectResult {
  const out: ActionableDefect[] = [];
  const unverified: UnverifiedDefect[] = [];
  const pushVisualUnverified = (id: string, reasonCode: string, reason: string): void => {
    unverified.push({
      screen_or_case_id: id,
      reason,
      reason_code: reasonCode,
      source: 'visual',
      fingerprint: `visual|${id}|${reasonCode}`,
    });
  };
  let trustedDeviceRootClassifications: DeviceDefectClassification[] | undefined;

  // ---- A) visual_diff：新鲜 must_fix ----
  try {
    const profileDir = path.join(__dirname, '..', '..', '..', 'profiles', 'hmos-app', 'harness');
    // 动态 require：core 不静态依赖 profile（层级边界；仓内既有先例）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vd = require(path.join(profileDir, 'visual-diff-check')) as {
      isStaleVisualDiffVerdict: (sc: unknown, root: string, o: { currentBuildFingerprint?: string | null }) => boolean;
      computeDefectFingerprint: (screenId: string, d: unknown) => string;
      hashScreenshotFile: (p: string) => string | null;
      loadRepairAuthorityScope: (root: string, feature: string, runId?: string) => unknown;
      defectRepairAuthority: (d: unknown, scope: unknown) => 'authorized' | 'excluded' | 'scope_unclear' | 'incomplete';
      effectiveScreens: (rep: { screens: unknown[] }, scope: unknown, currentFindings?: readonly unknown[]) => {
        screens: unknown[];
        excluded: Array<{ screen_id: string; ref_element: string; requirement_quote?: string }>;
        scopeUnclear: Array<{ screen_id: string; ref_element: string }>;
      };
      visualResidualDisposition: (screen: unknown) => 'minor' | 'provider_major' | null;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bf = require(path.join(profileDir, 'build-fingerprint')) as {
      resolveCurrentBuildFingerprint: (root: string, feature: string, phase?: string) => string | null;
    };
    const diffRel = path.posix.join(
      featuresDirRelOf(projectRoot), featureRelativePath(feature), 'device-testing', 'device-screenshots', 'visual-diff.json',
    );
    const diffAbs = path.join(projectRoot, ...diffRel.split('/'));
    if (fs.existsSync(diffAbs)) {
      const doc = JSON.parse(fs.readFileSync(diffAbs, 'utf-8')) as {
        screens?: Array<{
          screen_id?: string; verdict?: string; must_fix?: unknown[];
          evaluation_invalidated?: boolean; defects?: unknown[];
        }>;
      };
      const currentFp = bf.resolveCurrentBuildFingerprint(projectRoot, feature, 'testing');
      // plan c4e7a9b2 A2：候选只读授权过滤后的有效视图（与 gate 同一函数）——需求排除项与
      // 范围不明（参考图元素未登记，gate 已 WARN 交 spec 澄清）都不产候选、不回退。
      const authorityScope = vd.loadRepairAuthorityScope(projectRoot, feature, runId);
      const authorityView = vd.effectiveScreens({ screens: doc.screens ?? [] }, authorityScope, currentT8Findings);
      for (const e of authorityView.excluded) {
        console.warn(`[actionable] ${e.screen_id}: 需求排除项 ${e.ref_element}（引文「${e.requirement_quote ?? ''}」）不返修`);
      }
      for (const u of authorityView.scopeUnclear) {
        console.warn(`[actionable] ${u.screen_id}: 元素 ${u.ref_element} 未在 ui-spec / ref-elements 登记，不作返修依据（待 spec 澄清）`);
      }
      for (const sc of authorityView.screens as NonNullable<typeof doc.screens>) {
        const id = typeof sc.screen_id === 'string' ? sc.screen_id.trim() : '';
        if (!id) continue;
        // ⑤ 前置（review 第 13 轮）：evaluation_invalidated 的语义是"该屏评估整体不可信、
        // 待 critic 重评"——与 verdict/must_fix 无关。放在 ①② 之后的话，verdict=pass 的
        // 失效屏会在 ① 就被跳过，评估不可采信却照样完成。命中即进 unverified 通路
        //（不回退、retry 重评、耗尽 halt），无新状态机。
        if (sc.evaluation_invalidated === true) {
          pushVisualUnverified(id, 'evaluation_invalidated', '评估已被判无效（evaluation_invalidated，待 critic 重评）——该屏视觉评估尚不可采信');
          continue;
        }
        if (vd.visualResidualDisposition(sc) === 'minor') {
          console.warn(`[actionable] ${id}: ${(sc.defects ?? []).length} 条 minor 视觉信号不产回修候选（报告 WARN，仅披露）`);
          continue;
        }
        if (sc.verdict !== 'warn' && sc.verdict !== 'fail') continue;               // ①
        const mustFix = (sc.must_fix ?? []).filter((m): m is string => typeof m === 'string' && m.trim().length > 0);
        if (mustFix.length === 0) continue;                                          // ②
        if (downgradedVisualScreens?.has(id)) {
          // soft 档自报残差：gate 已记视觉债务（仍阻断发布），runtime 不自己推导档位、只消费物化结论。
          console.warn(`[actionable] ${id}: 按档位降级（自报样式残差记视觉债务），不产回修候选`);
          continue;
        }
        // ③④ 显式判定（review 第 10 轮：isStaleVisualDiffVerdict 对**缺** evaluated hash
        // 返回"不 stale"、currentFp 算不出时跳过 build 校验——缺身份的旧结论会触发错误
        // 回退。actionable 要求**身份齐备且匹配**，缺=不 actionable（fail-closed）：
        //   · evaluated_screenshot_hash 非空且等于盘上截图当前 hash；
        //   · 当前 build fingerprint 可算（无 HAP 身份 → 一律不回退）；
        //   · evaluated_build_fingerprint 非空且等于当前 build fingerprint。
        const evalShot = typeof (sc as { evaluated_screenshot_hash?: string }).evaluated_screenshot_hash === 'string'
          ? String((sc as { evaluated_screenshot_hash?: string }).evaluated_screenshot_hash).trim() : '';
        // 身份不可核实 ≠ 没缺陷：must_fix 在场时记 unverified（调用方 FAIL/retry，不静默丢）
        if (!evalShot) { pushVisualUnverified(id, 'evaluated_screenshot_hash_missing', '缺 evaluated_screenshot_hash（截图身份未绑定）'); continue; }   // ③
        const shotRel = typeof (sc as { screenshot_path?: string }).screenshot_path === 'string'
          ? String((sc as { screenshot_path?: string }).screenshot_path).trim() : '';
        if (!shotRel) { pushVisualUnverified(id, 'screenshot_path_missing', '缺 screenshot_path'); continue; }
        const shotNow = vd.hashScreenshotFile(
          path.isAbsolute(shotRel) ? shotRel : path.join(projectRoot, ...shotRel.split('/')),
        );
        // ③④ **一切身份失败统一进 unverified**（review 第 12 轮：此前把"明确不匹配"当
        // 正常代谢静默跳过——但"代谢"的前提是重评真的会发生；best_effort 下 stale gate
        // 只 WARN，若重评没发生，已知 must_fix 就假绿完成。持续 mismatch = 尚无当前身份
        // 的新判定 → 不驱动回退、也不允许完成，retry 引导重评，耗尽 halt。）
        if (!shotNow) { pushVisualUnverified(id, 'screenshot_unreadable', '绑定截图文件不可读（无法核验截图身份）'); continue; }
        if (shotNow !== evalShot) { pushVisualUnverified(id, 'screenshot_identity_mismatch', '截图身份不匹配（盘上截图已变但该屏尚未按当前截图重评）'); continue; }
        if (!currentFp) { pushVisualUnverified(id, 'current_build_fingerprint_unavailable', '当前 build fingerprint 不可算（install meta 缺失/损坏——install ok 但 meta 写失败的生产路径可达）'); continue; } // ④
        const evalFp = typeof (sc as { evaluated_build_fingerprint?: string }).evaluated_build_fingerprint === 'string'
          ? String((sc as { evaluated_build_fingerprint?: string }).evaluated_build_fingerprint).trim() : '';
        if (!evalFp) { pushVisualUnverified(id, 'evaluated_build_fingerprint_missing', '缺 evaluated_build_fingerprint（build 身份未绑定）'); continue; }
        if (evalFp !== currentFp) { pushVisualUnverified(id, 'build_identity_mismatch', 'build 身份不匹配（改码重装后该屏尚未按当前 HAP 重评）'); continue; } // ④
        if (vd.isStaleVisualDiffVerdict(sc, projectRoot, { currentBuildFingerprint: currentFp })) continue; // ⑤ stale
        // ---- adjudicated-repair-loop M1（plan e2b7c4a9 t1）：信号级候选 ----
        // 从「每屏一条聚合候选」改为「每结构化 defect 一条候选」：
        //   · identity = sha256(computeDefectFingerprint(screen, defect))——复用既有单条
        //     稳定指纹（screen|class|element|bbox_bucket[|producer#finding_id]），屏级集合
        //     拼接 hash 随缺陷集合/build 漂移、复发不可见，已废弃；
        //   · 指令=该 defect 的 note + 经既有 `defect.must_fix_refs` 反向解析出的 must_fix
        //     原文（门禁强制 must_fix 须被 refs 引用，refs 缺失由既有 BLOCKER 兜底）；
        //   · 纯文本 must_fix（无结构化 defect 锚）→ 保留既有整屏文案 hash 兜底（legacy
        //     语义，不入 signal@1 收敛判定——见 repair-candidates.ts identity_schema）。
        const scDefects = Array.isArray(sc.defects) ? sc.defects : [];
        const structural = scDefects
          .map((d) => {
            const fp = vd.computeDefectFingerprint(id, d);
            return fp ? { d, fp } : null;
          })
          .filter((x): x is { d: unknown; fp: string } => x !== null);
        if (structural.length > 0) {
          // 每信号一条候选；defect.must_fix_refs 反向解析到该屏 must_fix 原文作指令
          // B07 D1（plan 6e4a2c8b）：结构化 defect 按 severity 分流——minor 不产回修候选
          //（留视觉债务台账 / 报告 WARN），major/blocker 照旧；provider 源同规则。
          // 宿主 i13：12 条 minor 声明差以 coding 候选身份吃掉最后一次回退。零文本解析。
          let minorSkipped = 0;
          let anchorMissing = 0;
          for (const { d, fp } of structural) {
            if ((d as { severity?: unknown }).severity === 'minor') { minorSkipped++; continue; }
            // plan c4e7a9b2 A2：missing_render 缺 ref_element / 其余类缺 element → 不说改的是
            // 哪个元素，授权无从判定，走既有 unverified 通路（不回退、testing 重评补标识）。
            if (vd.defectRepairAuthority(d, authorityScope) === 'incomplete') { anchorMissing++; continue; }
            // plan ab072691 t5⑤：**provider 评审缺陷是独立的 critic candidate 源**，
            // 不是 producer 感知信号：provider 后于 primary 运行，**盲的** primary 无从核对视觉缺陷。
            // 故合法 provider 证据直接物化
            // 驱动回修（legacy 语义：可回退、不入 signal@1 收敛），
            // 收敛兜底交既有 no_progress_fuse。T8 信号一字不改。
            const fromVisualProvider =
              (d as { source?: { producer?: unknown } }).source?.producer === 'visual_provider';
            const refs = Array.isArray((d as { must_fix_refs?: unknown }).must_fix_refs)
              ? ((d as { must_fix_refs?: number[] }).must_fix_refs ?? [])
                .filter((i): i is number => Number.isInteger(i) && i >= 0 && i < mustFix.length)
              : [];
            const linked = refs.map((i) => mustFix[i]).filter(Boolean);
            const note = typeof (d as { note?: unknown }).note === 'string'
              ? String((d as { note?: unknown }).note).trim() : '';
            const instructions: string[] = [];
            if (note) instructions.push(note);
            instructions.push(...linked.slice(0, 8));
            if (instructions.length === 0) instructions.push(...mustFix.slice(0, 8));
            out.push({
              source: 'visual_diff',
              screen_or_case_id: id,
              instructions: instructions.slice(0, 8),
              // 单条稳定指纹（screen|class|element|bbox_bucket[|producer#finding_id]）
              // ——不变拼接序、不排序聚合；identity=sha256 由 repair-candidates 层计算
              fingerprint: fp,
              evidence_path: `${diffRel}#${id}`,
              // 结构化视觉信号：进入 signal@1 身份。
              // provider 源例外（见上）：直接物化回修，不入 signal@1。
              signal_identity: !fromVisualProvider,
            });
          }
          if (minorSkipped > 0) {
            console.warn(`[actionable] ${id}: ${minorSkipped} 条 minor 视觉信号不产回修候选（留视觉债务台账 / 报告 WARN）`);
          }
          if (anchorMissing > 0) {
            pushVisualUnverified(id, 'ref_element_missing',
              `${anchorMissing} 条缺陷未指明元素（missing_render 缺 ref_element / 其余类缺 element），返修授权无从判定——重评时补标识`);
          }
        } else {
          // 纯文本 must_fix 保底：整屏文案 hash（legacy；信号级收敛不作用于其后代候选）
          const fingerprint = `${id}|text:${createHash('sha256')
            .update(mustFix.map(m => m.trim().replace(/\s+/g, ' ')).slice().sort().join('\n'), 'utf-8')
            .digest('hex').slice(0, 16)}`;
          out.push({
            source: 'visual_diff',
            screen_or_case_id: id,
            instructions: mustFix.slice(0, 8),
            fingerprint,
            evidence_path: `${diffRel}#${id}`,
            // 纯文本兜底 = legacy：不入 signal@1 收敛
            signal_identity: false,
          });
        }
      }
    }
  } catch (e) {
    // 读不出 visual-diff ≠ 干净——但"没有有效判定/P0 缺屏"由既有 visual_diff 门禁负责
    // 拦在 harness 侧（v22 已删 deterministic_signal_unavailable 人工阻断，不重造）。
    console.warn(`[actionable] visual-diff 读取失败（${(e as Error).message}）——本轮无 visual 回修信号`);
  }

  // ---- B) crash：本 run 的集合差归档 ----
  try {
    const diagRel = path.posix.join(
      featuresDirRelOf(projectRoot), featureRelativePath(feature), 'device-testing', 'reports', 'crash-diagnostics',
    );
    const diagAbs = path.join(projectRoot, ...diagRel.split('/'));
    if (fs.existsSync(diagAbs)) {
      for (const n of fs.readdirSync(diagAbs)) {
        if (!n.endsWith('.json')) continue;
        try {
          const doc = JSON.parse(fs.readFileSync(path.join(diagAbs, n), 'utf-8')) as {
            screen_or_case?: string; run_id?: string | null;
            diagnosis?: { kind?: string; faultFiles?: string[] };
          };
          // 归档路径 feature 共享、跨 run 残留——只认本 run（F3 归档必写 run_id；无 run_id=过期）
          if (!doc.run_id || doc.run_id !== runId) continue;
          if (doc.diagnosis?.kind !== 'crash_suspected') continue;
          const id = String(doc.screen_or_case ?? n.replace(/\.json$/, ''));
          const faults = (doc.diagnosis.faultFiles ?? []).slice(0, 3).join(', ');
          out.push({
            source: 'crash',
            screen_or_case_id: id,
            instructions: [
              `进入「${id}」即崩溃（本轮 faultlog 新增：${faults || 'n/a'}）——修复崩溃本身而非导航/选择器；诊断摘要见 evidence_path`,
            ],
            // 同屏崩溃视为同一缺陷（faultlog 文件名含时间戳，入纹会让熔断永不命中）
            fingerprint: `crash|${id}`,
            evidence_path: `${diagRel}/${n}`,
            // crash 非结构化视觉：保持 legacy 契约（不入 signal@1 收敛、不需复核）
            signal_identity: false,
          });
        } catch { /* 单份诊断损坏 → 该文件不产信号（不拖垮整批） */ }
      }
    }
  } catch { /* 目录不可枚举 → 无 crash 信号 */ }

  // ---- C) device_test：正式 gate evidence（d9e4b7c1 T2）----
  // 只消费 runner pre-delete 后由 gate harness 写出的当前轮 evidence。缺文件 = 本轮无
  // device_test 信号（正式 gate 未达写入门槛时 run 门禁本身已 FAIL，重试路径接管），
  // 不制造 unverified 噪音；文件在场但任一身份/绑定校验不满足 → 该轮全部失败 case 进
  // unverified（不可信不得驱动改码，也不得装干净）。
  if (deviceTest) {
    try {
      const evPath = deviceTestEvidencePath(deviceTest.reportsDir);
      if (fs.existsSync(evPath)) {
        const pushUnverified = (
          id: string,
          reasonCode: string,
          reason: string,
          evidenceCase?: DeviceTestEvidenceCase,
        ): void => {
          const step = evidenceCase?.failing_step;
          unverified.push({
            screen_or_case_id: id,
            reason,
            reason_code: reasonCode,
            source: 'device_test',
            fingerprint: [
              'device_test',
              id,
              evidenceCase?.classification ?? 'evidence',
              step ? `step:${step.index}` : 'step:none',
              step ? `${step.selector_kind}:${step.selector}` : 'selector:none',
              reasonCode,
            ].join('|'),
          });
        };
        let doc: DeviceTestEvidenceDoc | null = null;
        try {
          doc = JSON.parse(fs.readFileSync(evPath, 'utf-8')) as DeviceTestEvidenceDoc;
        } catch (e) {
          pushUnverified('device-test-evidence', 'evidence_parse_failed', `evidence 不可解析：${(e as Error).message}`);
        }
        if (doc) {
          const failedCases = (doc.cases ?? []).filter(c => c && typeof c.case_id === 'string');
          const bindFailure = validateDeviceTestEvidenceBinding(doc, runId, deviceTest);
          if (bindFailure) {
            if (failedCases.length === 0) pushUnverified('device-test-evidence', 'evidence_binding_invalid', bindFailure);
            for (const c of failedCases) pushUnverified(c.case_id, 'evidence_binding_invalid', bindFailure, c);
          } else {
            // 根/级联三分复用 test_case_flow SSOT（级联 case 不产缺陷也不产 unverified——
            // 与既有 run gate 的 triage 语义一致）；无 flow 块 → 不归类，全部按根处理。
            const failedIds = failedCases.map(c => c.case_id);
            let rootSet: Set<string> | null = null;
            try {
              const planResolved = resolveFeatureArtifact(projectRoot, feature, 'test-plan.md');
              const planMd = fs.existsSync(planResolved.actualPath)
                ? fs.readFileSync(planResolved.actualPath, 'utf-8')
                : null;
              const parsedFlow = planMd ? parseTestCaseFlowBlock(planMd) : { flow: null };
              if (parsedFlow.flow) {
                const triage = triageCascade(parsedFlow.flow, failedIds);
                rootSet = new Set([...triage.rootFails, ...triage.independentFails]);
              }
            } catch {
              rootSet = null;
            }
            const rootCases = rootSet
              ? failedCases.filter((c) => rootSet!.has(c.case_id))
              : failedCases;
            trustedDeviceRootClassifications = rootCases.map((c) => c.classification);
            for (const c of failedCases) {
              if (rootSet && !rootSet.has(c.case_id)) continue; // 级联：根修好自然消失
              // plan e6b3f8d2 t3：锚点漂移分类已删除——它的回修指令要求产品注入已撤销的
              // framework 侧 canonical anchor（侵入宿主源码形态），随强制 UI kit 一并清除。
              const actionableClassification =
                c.classification === 'product_actionable' ||
                c.classification === 'product_state';
              if (
                actionableClassification &&
                doc.device_target?.target_kind === 'physical' &&
                c.failing_step
              ) {
                const evidenceLine = c.evidence?.ui_dump
                  ? `UI dump evidence: ${c.evidence.ui_dump}` +
                    (c.evidence.screenshot ? `; screenshot: ${c.evidence.screenshot}` : '')
                  : null;
                const instructions =
                  c.classification === 'product_state'
                    ? [
                        `On-device test case ${c.case_id} failed at step ${c.failing_step.index} ` +
                          `(${c.failing_step.action}): the element exists but its observable state ` +
                          `does not satisfy the retained predicate. ${c.reason ?? ''}`.trim(),
                        `Fix product state/binding logic; expected vs actual node observations are in device evidence.`,
                      ]
                    : [
                        `On-device test case ${c.case_id} failed at step ${c.failing_step.index} ` +
                          `(${c.failing_step.action}): ui-spec requires ` +
                          `${c.failing_step.selector_kind}=${c.failing_step.selector} on screen ` +
                          `${c.expected_screen ?? '(unknown)'}, but the whole attempt evidence pool has no exact hit.`,
                        `Implement the ui-spec-declared element id/text in product code for that screen.`,
                      ];
                if (evidenceLine) instructions.push(evidenceLine);
                if (c.diagnostics?.length) {
                  instructions.push(`Additional diagnostics: ${c.diagnostics.map(d => `${d.code}: ${d.message}`).join('; ')}`);
                }
                if (c.error_excerpt) instructions.push(`Machine error: ${c.error_excerpt.slice(0, 200)}`);
                out.push({
                  source: 'device_test',
                  screen_or_case_id: c.case_id,
                  instructions,
                  fingerprint:
                    `${c.classification}|${c.case_id}|step:${c.failing_step.index}|` +
                    `${c.failing_step.selector_kind}:${c.failing_step.selector}`,
                  evidence_path: `${path.relative(projectRoot, evPath).split(path.sep).join('/')}#${c.case_id}`,
                  // device_test 非结构化视觉：保持 legacy 契约（不入 signal@1 收敛、不需复核）
                  signal_identity: false,
                });
              } else if (actionableClassification) {
                pushUnverified(
                  c.case_id,
                  'actionable_requires_physical',
                  `${c.classification} 但 target_kind=${doc.device_target?.target_kind ?? 'null'} 非 physical——非真机结果不驱动回修`,
                  c,
                );
              } else {
                const availableNodes = c.classification === 'test_contract'
                  ? `；请改用该屏 ui-spec 声明的精确 node/text`
                  : '';
                pushUnverified(
                  c.case_id,
                  c.reason_code ?? `classification_${c.classification}`,
                  `${c.classification}${c.reason ? `（${c.reason}）` : ''}${availableNodes}——不属可回修产品缺陷`,
                  c,
                );
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[actionable] device-test-evidence 消费失败（${(e as Error).message}）——本轮无 device 回修信号`);
    }
  }

  return {
    defects: out,
    unverified,
    ...(trustedDeviceRootClassifications !== undefined
      ? { trustedDeviceRootClassifications }
      : {}),
  };
}
