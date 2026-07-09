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
