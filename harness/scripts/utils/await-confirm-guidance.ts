/**
 * P0-10a（plan b6d3e9a2）：await_human_visual_confirm 引导话术**机器生成**。
 *
 * P0-9b 把"设计内求人时刻"正确分类为 await_human_visual_confirm，但把裸 JSON 手改怼给了人。
 * 本 builder 按 run 上下文生成三入口引导，全部参数化（feature/run_id/路径/layout 命令注入）：
 *  ①【推荐·对话式，软契约】把内嵌确认协议的话术原样发给交互 agent，真人只需逐屏看图表态；
 *  ②【命令式·高保真】visual-confirm CLI，真人在终端直签（无 agent 中介，最可信）；
 *  ③【附录】手改 JSON 字段说明。
 *
 * 铁律：**模板零人名、零需求特定内容**——署名一律"由你当场提供"；headless 永不适用此协议
 * （agent 唯一正确动作是 halt 等真人，此话术是给 halt 之后的操作者读的）。
 */

export interface AwaitConfirmGuidanceOpts {
  feature: string;
  runId: string;
  /** 截图目录（projectRoot 相对，POSIX） */
  screenshotsDirRel: string;
  /** visual-diff.json（projectRoot 相对，POSIX） */
  visualDiffJsonRel: string;
  /** testing 阶段 id（一般 'testing'） */
  phase: string;
  /**
   * projectRoot → framework harness 的相对前缀：consumer='framework/harness'、standalone='harness'。
   * 用于生成宿主根目录可直接复制的 npm --prefix 命令。
   */
  harnessPrefixRel: string;
}

/** 逐屏展示三级降级措辞（交互 agent 按能力选一，纯 CLI 型不卡死）。 */
const DISPLAY_FALLBACK_LINES: readonly string[] = [
  '   - 逐屏展示：能内联显示图片就内联；不能则调系统查看器打开截图；再不能则给出截图与参考图的**绝对路径**请我自行打开，等我回复看完再问表态。',
];

/**
 * 生成 await_human_visual_confirm 引导话术（多行；调用侧 join('\n') 写入 halt_guidance / md / console）。
 */
export function buildAwaitHumanConfirmGuidance(opts: AwaitConfirmGuidanceOpts): string[] {
  const { feature, runId, screenshotsDirRel, visualDiffJsonRel, phase, harnessPrefixRel } = opts;
  const cliCmd = `npm --prefix ${harnessPrefixRel} run visual-confirm -- --feature ${feature}`;
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --force-resume`;
  return [
    `【${feature} · run ${runId}】全部 P0 屏均为 pass 候选、确定性信号已干净——唯一剩余步骤是**真人逐屏过目确认**（T2 设计，agent 不能替你签，headless 只能 HALT 等你）。三种方式任选：`,
    '',
    '——方式 A（推荐·最省事，软契约）：把下面这段原样发给你的交互 agent（cursor/claude/codex 等），你只需逐屏看图后回复认可/不认可——',
    '  ┌─────────────────────────────────────────',
    `  │ 带我逐屏完成 ${feature} 的 visual 真人确认：`,
    `  │ 1. 依次展示 ${screenshotsDirRel}/ 下每张 shot-*.png 与其 spec 参考原图，附差异要点，一屏一屏等我明确回复「认可」或「不认可+原因」；`,
    ...DISPLAY_FALLBACK_LINES.map(l => `  │ ${l.trim()}`),
    `  │ 2. 我认可的屏：在 ${visualDiffJsonRel} 对应 screens[].confirmed_by 填我**当场告诉你的署名**（不得自拟/沿用历史；user_requirement、goal-mode-auto 等自动化身份无效）；`,
    '  │ 3. 我不认可的屏：verdict 改为 "fail"，把我说的原因原话写进 must_fix；',
    '  │ 4. 不得改动 evaluated_screenshot_hash / evaluated_build_fingerprint / screenshot_hash；保存为无 BOM 的 UTF-8；',
    '  │ 5. 没有我对某屏的明确表态前，绝不代填该屏 confirmed_by；',
    `  │ 6. 全部处理完后续跑本 run：${resumeCmd}`,
    '  └─────────────────────────────────────────',
    '',
    '——方式 B（高保真·最可信，无 agent 中介）：在终端直接跑（真人自己按 y=认可 / f=打回 / s=跳过，并当场输入署名）——',
    `  ${cliCmd}`,
    '',
    '——方式 C（附录·手改 JSON）：编辑 ' + visualDiffJsonRel + ' —— 认可的屏加 "confirmed_by": "<你的署名>"（字符串；非 user_requirement/自动化身份）；不认可的屏 "verdict": "fail" 且 "must_fix": ["<差异>"]；绑定三字段（evaluated_screenshot_hash / evaluated_build_fingerprint / screenshot_hash）不动；UTF-8 无 BOM 保存。',
    '',
    `处理完后续跑：${resumeCmd}`,
    '注：方式 A 经 agent 转录属软契约（agent 理论上仍可编造署名）；要最稳走方式 B（真人在终端直签）。你的签名与判定按 build 指纹持久，同一构建下不会被重采清掉。',
  ];
}

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
 * E4（案B chrys 银行卡实证：8 attempt/4h19m，script 门禁反复 PASS 却关不了环——非视觉确认场景，
 * 不可复用 buildAwaitHumanConfirmGuidance，那个是 testing 阶段截图/visual-diff.json 专用）。
 * 累计出现即 halt：脚本门禁已多次 PASS 但闭环/回执一直未完成，agent 重试无法自证突破——
 * 要么是只能人签的确认项（headless 无人可签），要么每轮又做了新探索/修改反复横跳，
 * 都需要人看一眼再决定，盲重试只会继续空转。
 */
export function buildClosureWallGuidance(opts: ClosureWallGuidanceOpts): string[] {
  const { feature, runId, phase, receiptPathRel, harnessPrefixRel, receiptStatus, cumulativeBlockedCount } = opts;
  const resumeCmd = `npm --prefix ${harnessPrefixRel} run goal -- --feature ${feature} --resume ${runId} --force-resume`;
  return [
    `【${feature} · run ${runId} · ${phase}】脚本门禁已第 ${cumulativeBlockedCount} 次达到 PASS，但闭环/回执一直未完成` +
      (receiptStatus ? `（receipt_status=${receiptStatus}）` : '') +
      '——agent 无法自证突破，继续重试只是空转，需要你看一眼再决定。',
    '',
    '请检查：',
    `  1. ${receiptPathRel} 的 verifier_subagent.verdict 与具体原因（多为某项只能真人签署的确认，`,
    '     如视觉保真/裁剪授权类——headless 下没有人可签，agent 每次都会诚实报告 FAIL，重试不会变）；',
    '  2. 若确认是"只差人签"：人工审阅相应产物后手动补全该签名字段，再续跑；',
    '  3. 若怀疑是"预算不够、每轮都在做新探索但没收尾"：可提高该 phase 的 phase_timeout_ms 后续跑；',
    '  4. 若怀疑是环境/工具链问题（如 OCR 不可用）：先修复环境，问题若随之消失即证实。',
    '',
    `处理完后续跑：${resumeCmd}`,
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
