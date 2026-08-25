// ============================================================================
// vision-canary.ts — E1（多模态降级阶梯 plan d4a8f3c6）：视觉能力金丝雀实测
// ============================================================================
//
// 治案A（mx 2.7 纯文本模型套 claude 壳）：image_input 纯 adapter 声明，无模型实测，
// 盲模型会被误判"有视觉"。本模块用一张已知内容的小图让 agent 回答，答案分级判定：
//   - 几何/颜色题全对 → tool_read 实锤（真视觉）
//   - 仅文字题对（疑似 Bash/OCR 代答，非恶意的自然求解路径）→ 不判 tool_read，
//     记 ocr_capable 信号，vision 仍 none
//   - 全错/未作答/声称看不见 → none
// 诚实边界：防"从文件名/文档猜答案"（文件名不含答案，答案存独立 json）与"OCR 工具代答
// 文字题"（几何题非 OCR 能直接回答，需真正的视觉理解）；不防宿主工具链恶意伪造读图
// （那属 gate-integrity 红线域，非本模块职责）。

import * as crypto from 'crypto';
import Jimp from 'jimp';
import { extractClaudeFinalResultText, planUsesClaudeStreamJson } from './claude-envelope';
import { extractCodexAgentMessageText } from './codex-terminal-events';

export type CanaryVerdict = 'tool_read' | 'ocr_capable' | 'none';

/**
 * 探测协议版本(plan c7d2e9a4 rev4,从 2 起)——isVisionCanaryFresh 只采信当前版本缓存;
 * 旧缓存缺字段即 v1/stale(含 2026-07-12 额度耗尽写入的假 none 毒缓存),下一次 UI goal
 * 自动重探原位覆写,用户零操作升级、无需删 framework.local.json。改判卷/严格解析/
 * 缓存语义须递增本值。
 */
export const VISION_CANARY_PROBE_VERSION = 2;

export interface CanaryAnswerKey {
  schema_version: string;
  geometry_questions: Array<{ id: string; expected_color: string }>;
  text_token: string;
}

export interface CanaryClassifyResult {
  verdict: CanaryVerdict;
  geometryCorrect: number;
  geometryTotal: number;
  textTokenMatched: boolean;
  /** 输出转录里疑似调用外部工具的迹象（尽力而为扫描，非确定性判据） */
  externalToolSuspected: boolean;
  reason: string;
}

// b7e4d2a9 Todo4 收尾（review round9）：生产级固定答案层（CANARY_DESIGN_VERSION /
// CANARY_ANSWER_KEY 常量与导出、各 API 的固定默认参）已整体删除——固定卷没有任何
// 运行时用途（preflight/交互式都走随机卷），保留即"随机图+固定答案"漏传形态的温床；
// 测试需要固定 fixture 时在测试侧自定义（tests/utils/canary-fixture-key.ts）。

const CANARY_COLORS_HEX: Record<string, number> = {
  red: 0xff0000ff,
  blue: 0x0000ffff,
  green: 0x00aa00ff,
  yellow: 0xffcc00ff,
};

/** 四个几何题 id 固定，对应固定象限；答案（哪个颜色在哪个象限）由 answerKey 驱动。 */
const CANARY_GEOMETRY_IDS = [
  'TOP_LEFT_COLOR',
  'TOP_RIGHT_COLOR',
  'BOTTOM_LEFT_COLOR',
  'BOTTOM_RIGHT_COLOR',
] as const;
const CANARY_COLOR_NAMES = ['red', 'blue', 'green', 'yellow'] as const;

const CANARY_SIZE = 300;

/** question id → 象限左上角像素坐标（half = CANARY_SIZE/2）。 */
function quadrantOrigin(id: string, half: number): { x: number; y: number } | null {
  switch (id) {
    case 'TOP_LEFT_COLOR':
      return { x: 0, y: 0 };
    case 'TOP_RIGHT_COLOR':
      return { x: half, y: 0 };
    case 'BOTTOM_LEFT_COLOR':
      return { x: 0, y: half };
    case 'BOTTOM_RIGHT_COLOR':
      return { x: half, y: half };
    default:
      return null;
  }
}

// b7e4d2a9 Todo4：固定资产路线（canaryAssetPaths/ensureVisionCanaryAsset——写死
// framework/harness/assets/ + answer-key 落盘）已删除：运行时改发布件 + 答案与题图
// 同目录削弱金丝雀 + 固定卷可被记忆（答案本就在发布源码里）三宗罪；preflight 与
// 交互式探针统一走随机卷（generateRandomCanaryAnswerKey），答案只在调用方内存。

/**
 * 随机题卷生成（I1a 交互式金丝雀，plan b7e42d19 分叉2）：随机颜色→象限排列 + 随机 token。
 * 交互式下 agent 与判卷同会话，固定卷答案可被 grep；随机卷答案只存内存（不落盘），
 * agent 拿到的只有图路径。rng 注入便于单测（默认 crypto.randomInt，密码学随机不可预测）。
 */
export function generateRandomCanaryAnswerKey(
  rng: (maxExclusive: number) => number = crypto.randomInt,
): CanaryAnswerKey {
  const colors = [...CANARY_COLOR_NAMES];
  // Fisher-Yates 打乱颜色→象限映射
  for (let i = colors.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  const tokenAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < 8; i += 1) token += tokenAlphabet[rng(tokenAlphabet.length)];
  return {
    schema_version: '1.0',
    geometry_questions: CANARY_GEOMETRY_IDS.map((id, i) => ({ id, expected_color: colors[i] })),
    text_token: token,
  };
}

/**
 * 渲染金丝雀图：象限颜色与 token 全由 answerKey 驱动。
 * b7e4d2a9 Todo4：answerKey **编译期必传**（原默认参=固定卷——"随机图片+固定答案判卷"
 * 的漏传形态由 TS 直接阻止；测试需要固定卷时在测试内自定义）。
 */
export async function renderCanaryImage(
  outPath: string,
  answerKey: CanaryAnswerKey,
): Promise<void> {
  const half = CANARY_SIZE / 2;
  const image = new Jimp(CANARY_SIZE, CANARY_SIZE, 0xffffffff);
  for (const q of answerKey.geometry_questions) {
    const origin = quadrantOrigin(q.id, half);
    const colorHex = CANARY_COLORS_HEX[q.expected_color];
    if (!origin || colorHex === undefined) continue;
    image.composite(new Jimp(half, half, colorHex), origin.x, origin.y);
  }
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
  image.print(
    font,
    0,
    half - 20,
    {
      text: answerKey.text_token,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
      alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
    },
    CANARY_SIZE,
    40,
  );
  await image.writeAsync(outPath);
}

/** 发给 agent 的一次性能力探测 prompt——非正式任务，明确允许诚实答"看不见"。 */
export function buildCanaryPrompt(imagePath: string): string {
  return [
    'This is a ONE-TIME visual capability check for this session — it is NOT the actual task.',
    `There is an image file at: ${imagePath}`,
    '',
    'If you can view/read images, open it now and answer using EXACTLY this format (one line each, no extra text):',
    'TOP_LEFT_COLOR=<color>',
    'TOP_RIGHT_COLOR=<color>',
    'BOTTOM_LEFT_COLOR=<color>',
    'BOTTOM_RIGHT_COLOR=<color>',
    'TEXT_TOKEN=<the short alphanumeric token printed in the image, if any>',
    '',
    'If you do NOT have the ability to view images at all, reply with EXACTLY: CANNOT_SEE_IMAGE',
    'Do not guess colors or invent a token — only answer if you can genuinely see the image content.',
  ].join('\n');
}

/**
 * visual-capability-truth S3（路径 B）：phase prompt 内嵌视觉验证块——runner 出题、
 * 同 invocation 作答、runner 判卷，通过才签发 invocation_bound（vl_multimodal 终签
 * 的能力条件）。随机卷（答案只在 runner 内存），业务产出与答题同 invoke 绑定。
 */
export function buildInlineCanaryBlock(imagePath: string): string {
  return [
    '',
    '## Inline visual verification (runner-issued — REQUIRED before any vl_multimodal signing)',
    '',
    'This run requires proof that THIS invocation can genuinely read images (a session-level probe is',
    'not sufficient for final visual signing). A verification image has been generated at:',
    `${imagePath}`,
    '',
    'Open it and include these answer lines VERBATIM near the END of your final output (one per line):',
    'TOP_LEFT_COLOR=<color>',
    'TOP_RIGHT_COLOR=<color>',
    'BOTTOM_LEFT_COLOR=<color>',
    'BOTTOM_RIGHT_COLOR=<color>',
    'TEXT_TOKEN=<the short alphanumeric token printed in the image>',
    '',
    'If you cannot see images: output exactly CANNOT_SEE_IMAGE instead, work in the blind workflow,',
    'and do NOT set `verified: verified` / `verified_method: vl_multimodal` — that signature will be',
    'rejected without this verification anyway. Do not guess colors.',
    '',
  ].join('\n');
}

/** 输出转录里疑似调用外部读图/OCR 工具的迹象——尽力而为，非确定性判据（仅供诊断参考）。 */
const EXTERNAL_TOOL_HINT_PATTERNS: readonly RegExp[] = [
  /tesseract/i,
  /\bocr\b/i,
  /python[\s3]*.*(pillow|PIL|cv2|opencv)/i,
  /\bconvert\b.*\.(png|jpg|jpeg)/i,
  /identify\s+-format/i,
];

function detectExternalToolSuspected(rawOutput: string): boolean {
  return EXTERNAL_TOOL_HINT_PATTERNS.some(re => re.test(rawOutput));
}

function parseAnswerLine(rawOutput: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'im');
  const m = rawOutput.match(re);
  return m ? m[1].trim() : null;
}

/**
 * 答卷是否**写完整**（收卷判据，非判卷）——防半写入竞态（codex P2 二轮）：非原子写工具
 * 可能先落盘 `TOP_LEFT_COLOR=red\n` 再续写余下键，此刻内容非空但不完整，若立即判卷会误判
 * 低档/none 并写错缓存。完整 = 声明 CANNOT_SEE_IMAGE，或**全部** 4 个几何题键 + TEXT_TOKEN
 * 键都已出现（值不论——只判"写完了"）。不完整则调用方继续轮询到完整或超时 fail-safe。
 */
export function isCanaryAnswerComplete(
  rawOutput: string,
  answerKey: CanaryAnswerKey,
): boolean {
  const trimmed = rawOutput.trim();
  if (!trimmed) return false;
  if (/CANNOT_SEE_IMAGE/i.test(trimmed)) return true;
  const requiredKeys = [...answerKey.geometry_questions.map(q => q.id), 'TEXT_TOKEN'];
  return requiredKeys.every(k => new RegExp(`^\\s*${k}\\s*=`, 'im').test(rawOutput));
}

/**
 * 判定分级（纯函数，可单测，不依赖真实 agent 调用）：
 *   - 全部几何题正确 → tool_read（真视觉实锤，严格要求全对避免猜色蒙对）
 *   - 几何题未全对但 TEXT_TOKEN 命中 → ocr_capable（vision 仍 none，但携带文字提取信号）
 *   - 都不中 / 声明 CANNOT_SEE_IMAGE / 空输出 → none
 */
export function classifyCanaryResponse(
  rawOutput: string,
  answerKey: CanaryAnswerKey,
): CanaryClassifyResult {
  const externalToolSuspected = detectExternalToolSuspected(rawOutput);
  const trimmed = rawOutput.trim();
  if (!trimmed || /CANNOT_SEE_IMAGE/i.test(trimmed)) {
    return {
      verdict: 'none',
      geometryCorrect: 0,
      geometryTotal: answerKey.geometry_questions.length,
      textTokenMatched: false,
      externalToolSuspected,
      reason: !trimmed ? '空输出' : 'agent 明确声明看不见图片',
    };
  }

  let geometryCorrect = 0;
  for (const q of answerKey.geometry_questions) {
    const answer = parseAnswerLine(rawOutput, q.id);
    if (answer && answer.toLowerCase() === q.expected_color.toLowerCase()) geometryCorrect++;
  }
  const geometryTotal = answerKey.geometry_questions.length;
  const textAnswer = parseAnswerLine(rawOutput, 'TEXT_TOKEN');
  const textTokenMatched = Boolean(
    textAnswer && textAnswer.toUpperCase() === answerKey.text_token.toUpperCase(),
  );

  if (geometryCorrect === geometryTotal) {
    return {
      verdict: 'tool_read',
      geometryCorrect,
      geometryTotal,
      textTokenMatched,
      externalToolSuspected,
      reason: `几何/颜色题 ${geometryCorrect}/${geometryTotal} 全对——真视觉实锤`,
    };
  }
  if (textTokenMatched) {
    return {
      verdict: 'ocr_capable',
      geometryCorrect,
      geometryTotal,
      textTokenMatched,
      externalToolSuspected,
      reason:
        `几何题仅 ${geometryCorrect}/${geometryTotal} 对，但 TEXT_TOKEN 命中——` +
        `疑似 Bash/OCR 代答（非恶意自然求解路径），记 ocr_capable，vision 仍判 none`,
    };
  }
  return {
    verdict: 'none',
    geometryCorrect,
    geometryTotal,
    textTokenMatched,
    externalToolSuspected,
    reason: `几何题 ${geometryCorrect}/${geometryTotal} 对、TEXT_TOKEN 未命中——判无视觉能力`,
  };
}

// ---------------------------------------------------------------------------
// t2/t3（plan c7d2e9a4）：goal 路径写盘决策——区分 invoke 失败 / 无效答卷 / 有效作答
// ---------------------------------------------------------------------------

/** goal headless 调用事实（AgentInvokeResult 子集——探测有效性须消费完整调用状态） */
export interface CanaryInvocationFacts {
  stdout: string;
  exitCode: number;
  timed_out?: boolean;
  silent_killed?: boolean;
  skipped?: boolean;
  /**
   * P0-1（plan 7c4f2e9b / visual-capability-truth 3.10）：stdout 是**结构化信封流**而非
   * 纯文本。true 时判卷前先做信封投影——行锚 ^KEY=value$ 在信封上恒空，直接扫原始 stdout
   * 会把真视觉宿主判成永久盲档。
   */
  structured_stdout?: boolean;
  /**
   * plan e6b3f8d2 t1：信封**方言**。缺省 `claude_stream_json`（既有语义不变）；
   * codex 自 `exec --json` 接入后 stdout 亦为 JSONL（`codex_turn_jsonl`），
   * 投影规则见 codex-terminal-events.extractCodexAgentMessageText。
   */
  structured_stdout_format?: CanaryStdoutEnvelope;
}

/** 判卷前需要投影的 stdout 信封方言（plan e6b3f8d2 t1）。 */
export type CanaryStdoutEnvelope = 'claude_stream_json' | 'codex_turn_jsonl';

/**
 * adapter → 判卷 stdout 信封方言（'none' = 纯文本，直接扫）。
 * 与各自的 argv 注入条件**严格同构**：
 *   · claude 家族：`--output-format stream-json` 仅在 tool_event_provenance=structured_events 时注入；
 *   · codex：`--json` 由 codexArgv **无条件**追加（plan e6b3f8d2 t1），故恒为 JSONL。
 */
export function resolveCanaryStdoutEnvelope(
  adapterName: string,
  toolEventProvenance?: string,
): 'none' | CanaryStdoutEnvelope {
  if (adapterName === 'codex') return 'codex_turn_jsonl';
  return planUsesClaudeStreamJson(adapterName, toolEventProvenance as never) ? 'claude_stream_json' : 'none';
}

export type CanaryCacheDecision =
  | { kind: 'invoke_failed'; cache: false; detail: string }
  | { kind: 'invalid_answer'; cache: false; detail: string }
  | { kind: 'valid'; cache: true; classify: CanaryClassifyResult; canonicalAnswer: string };

/**
 * 逐键提取**最后一次合法赋值**（echo 在前、真答卷在后；占位符 `<color>` 等含 <> 的
 * 回显行与空值不算合法赋值）。返回 null=该键无合法赋值。
 */
function lastLegalAssignment(rawOutput: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'gim');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawOutput)) !== null) {
    const value = m[1].trim();
    if (value && !value.includes('<') && !value.includes('>')) last = value;
  }
  return last;
}

/**
 * 答卷解析 SSOT（plan d7f3a9c4 t4 review：硬失败分类与写盘判卷**同源**判定"stdout 是否有效"——
 * CLI banner/升级提示/stream 前导不是有效答卷，不能压掉明确的参数错误签名）。
 * 返回：
 *  - `canonicalAnswer`：有效答卷（全键合法赋值 / 独立行 CANNOT_SEE_IMAGE）；缺失=无有效答卷；
 *  - `externalToolSuspected`：从**原始 stdout** 提取（结构化时 tool_use 在信封里，不在投影文本）；
 *  - `structuredProjectedNull`：structured envelope 存在但无终态 success result（区别于普通空输出）。
 */
export interface CanaryAnswerParseResult {
  canonicalAnswer: string | null;
  externalToolSuspected: boolean;
  structuredProjectedNull: boolean;
}

export function parseCanaryAnswer(
  invocation: Pick<CanaryInvocationFacts, 'stdout' | 'structured_stdout' | 'structured_stdout_format'>,
  answerKey: CanaryAnswerKey,
): CanaryAnswerParseResult {
  // P0-1 归一（plan 7c4f2e9b）：structured stdout 先投影为可判卷文本。
  // plan e6b3f8d2 t1：按信封方言分派（缺省仍是 claude stream-json，既有行为不变）。
  let raw = invocation.stdout;
  let structuredProjectedNull = false;
  if (invocation.structured_stdout) {
    const projected =
      invocation.structured_stdout_format === 'codex_turn_jsonl'
        ? extractCodexAgentMessageText(invocation.stdout)
        : extractClaudeFinalResultText(invocation.stdout);
    if (projected === null) {
      structuredProjectedNull = true;
      raw = '';
    } else {
      raw = projected;
    }
  }
  const requiredKeys = [...answerKey.geometry_questions.map(q => q.id), 'TEXT_TOKEN'];
  const finalAnswers = new Map<string, string>();
  for (const k of requiredKeys) {
    const v = lastLegalAssignment(raw, k);
    if (v !== null) finalAnswers.set(k, v);
  }
  let canonicalAnswer: string | null = null;
  if (finalAnswers.size === requiredKeys.length) {
    canonicalAnswer = requiredKeys.map(k => `${k}=${finalAnswers.get(k)!}`).join('\n');
  } else if (/^\s*CANNOT_SEE_IMAGE\s*$/im.test(raw)) {
    canonicalAnswer = 'CANNOT_SEE_IMAGE';
  }
  return {
    canonicalAnswer,
    externalToolSuspected: detectExternalToolSuspected(invocation.stdout),
    structuredProjectedNull,
  };
}

/**
 * goal 路径唯一写盘判据（plan c7d2e9a4 t2/t3，codex 三轮收敛）：
 * ① invoke 事实先行——skipped/timed_out/silent_killed/非零退出 = 调用没成，与答卷无关；
 * ② 严格答卷解析（防 prompt echo 双杀——canary prompt 自身含全部答题键行与
 *    CANNOT_SEE_IMAGE 字面，isCanaryAnswerComplete 的 `KEY=` 在场判据会被回显骗过，
 *    classifyCanaryResponse 的 CANNOT_SEE 全文子串判会直接误判 none）：
 *    - 全部答题键都有最后一次合法赋值 → 有效作答（对错交给 classify）；
 *    - 否则 CANNOT_SEE_IMAGE **独立成行**（echo 行有前缀文字不整行匹配）→ 真盲声明；
 *    - 两者皆无 → invalid_answer（空输出/额度错误文本/残卷——没作答，不落缓存）；
 * ③ valid 时重组 canonical answer 交 classify——**不得回传原始 stdout**（旧 classifier
 *    是首中解析 + CANNOT_SEE 子串判，echo+尾部真答卷会被二次污染判 none）；
 *    externalToolSuspected 仍从原始 stdout 提取（规范化不丢诊断信号）。
 * 答卷解析本体统一走 parseCanaryAnswer（t4 硬失败分类同源复用）。
 */
export function resolveCanaryCacheDecision(
  invocation: CanaryInvocationFacts,
  // b7e4d2a9 Todo4：编译期必传（原默认参=固定卷，随机图+固定答案的漏传形态 TS 直接阻止）
  answerKey: CanaryAnswerKey,
): CanaryCacheDecision {
  if (invocation.skipped) {
    return { kind: 'invoke_failed', cache: false, detail: 'invoke 被跳过（dry-run/skipped）' };
  }
  if (invocation.timed_out || invocation.silent_killed) {
    return {
      kind: 'invoke_failed',
      cache: false,
      detail: invocation.timed_out ? 'invoke 超时被杀' : 'invoke 静默无输出被杀（silent watchdog）',
    };
  }
  if (invocation.exitCode !== 0) {
    return { kind: 'invoke_failed', cache: false, detail: `invoke 非零退出（exitCode=${invocation.exitCode}）` };
  }

  const parsed = parseCanaryAnswer(invocation, answerKey);
  if (parsed.canonicalAnswer === null) {
    if (parsed.structuredProjectedNull) {
      return {
        kind: 'invalid_answer',
        cache: false,
        detail: 'structured envelope 无终态 success result（残卷/错误 result/断流）——不判卷，不落缓存',
      };
    }
    const trimmed = invocation.stdout.trim();
    return {
      kind: 'invalid_answer',
      cache: false,
      detail: !trimmed
        ? '空输出——非有效答卷（额度耗尽/断流?），不落缓存'
        : `输出非有效答卷（合法答题键缺失、无独立行 CANNOT_SEE_IMAGE——错误文本/残卷/回显?），不落缓存`,
    };
  }

  const classify = classifyCanaryResponse(parsed.canonicalAnswer, answerKey);
  return {
    kind: 'valid',
    cache: true,
    classify: { ...classify, externalToolSuspected: parsed.externalToolSuspected },
    canonicalAnswer: parsed.canonicalAnswer,
  };
}

// ---------------------------------------------------------------------------
// plan d7f3a9c4 t4：金丝雀 CLI 硬失败分类（仅 action==='probe' 的真实调用路径消费）
// ---------------------------------------------------------------------------

/** 硬失败分类所需的最小 invoke 事实（AgentInvokeResult 子集 + spawn_error）。 */
export interface CanaryHardCliFailureFacts {
  exitCode: number;
  timed_out?: boolean;
  silent_killed?: boolean;
  skipped?: boolean;
  stdout: string;
  stderr: string;
  spawn_error?: { code?: string; message: string };
}

/**
 * CLI/config 参数不兼容的 stderr 显式枚举签名（plan ④ 正则纪律）：
 *  - 行首锚定（`^`）——`^error:` / `^Usage:` 单独出现会误判认证/额度/模型服务错误；
 *  - 只认签名关键字本身，`Usage:` 仅作辅助特征、**不能单独触发**；
 *  - 逐行限长（防 10KB 长行回溯灾难），禁 `[^\n]*` 前缀，禁全文 stringify。
 */
const HARD_CLI_STDERR_SIGNATURES: ReadonlyArray<RegExp> = [
  // error: unknown argument '--foo' / error: unexpected argument '--foo' found / error: unrecognized option '--foo'
  // `^[ \t]*` 只放行行首空白缩进（仍锚定行首，不是任意前缀——禁 `[^\n]*`）。
  /^[ \t]*(?:error:\s*)?(?:unknown argument|unexpected argument|unrecognized option)/i,
  // error: Error loading config ... / Error loading config: ...
  /^[ \t]*(?:error:\s*)?Error loading config/i,
];

/** stderr 单行参与签名匹配的最大长度（超过即截断——只保留行首签名区）。 */
const HARD_CLI_LINE_CAP = 1024;

/**
 * plan c4e8a1f7 T1a：已恢复的 Codex 结构化模型兼容 400 信封精确签名（脱敏 fixture）：
 *   {"type":"error","status":400,"error":{"type":"invalid_request_error",
 *    "message":"The 'gpt-5.6-luna' model requires a newer version of Codex. ..."}}
 * 判据=签名键值同时在场（stdout/stderr 皆扫）。生产判据**不维护 model→CLI 版本静态表**；
 * 只对实际调用返回的精确结构化永久错误 fail-fast，普通非零退出仍走原行为。
 */
const CODEX_400_REQUIRES_NEWER_SIGNATURES: ReadonlyArray<RegExp> = [
  /"type"\s*:\s*"error"/,
  /"status"\s*:\s*400/,
  /"type"\s*:\s*"invalid_request_error"/,
  /requires a newer version of Codex/i,
];

function matchesCodex400RequiresNewer(allOutput: string): boolean {
  // 防御：只扫前 64KB（真实 400 信封体很小，签名在头部）。
  const bounded = allOutput.length > HARD_CLI_LINE_CAP * 64
    ? allOutput.slice(0, HARD_CLI_LINE_CAP * 64)
    : allOutput;
  return CODEX_400_REQUIRES_NEWER_SIGNATURES.every((re) => re.test(bounded));
}

/**
 * plan c4e8a1f7 T1a：正式 phase invoke 与金丝雀探测共用的**硬失败共享分类**（SSOT）。
 * 分类三源（任一命中即硬失败）：
 *   ① child spawn race / guardian 建立失败：`spawn_error` 结构化事实在场
 *      （resolvedBinary 短路、真实 child error 与 guardian 投影同一种 shape）；
 *   ② CLI/config 参数不兼容：nonzero exit + 非 timeout/silent + 无有效答卷 +
 *      stderr 逐行命中显式枚举签名；
 *   ③ Codex 结构化模型兼容 400 信封（status=400 + invalid_request_error +
 *      requires a newer version of Codex，stdout/stderr 皆扫）。
 * 未命中返回 null（维持现状语义：普通内容失败走既有 harness/retry）。
 */
export function resolveInvokeHardCliFailure(
  facts: CanaryHardCliFailureFacts,
  opts?: {
    answerKey?: CanaryAnswerKey;
    structuredStdout?: boolean;
    /** plan e6b3f8d2 t1：信封方言（缺省 claude stream-json）。 */
    structuredStdoutFormat?: CanaryStdoutEnvelope;
    /**
     * plan c4e8a1f7 T1a（评审 P1 修复）：正式 phase invoke 无"答卷"概念——
     * stdout 非空（banner/进度行）**不得**充当"有效答卷"压掉明确的参数错误签名；
     * 金丝雀探测（answerKey 在场或默认）保持"banner 不压签名"的既有语义：
     * 有可解析答卷时视为 agent 作答过、不是参数错误。
     */
    formalInvoke?: boolean;
  },
): string | null {
  if (facts.skipped) return null;
  if (facts.timed_out || facts.silent_killed) return null;
  // ① child spawn race / guardian 建立失败：结构化事实在场即硬失败（不靠 stderr 猜）。
  if (facts.spawn_error) {
    const isGuardian =
      facts.spawn_error.code === 'maison_guardian_containment_failed' ||
      (facts.stderr || '').includes('[maison-guardian]');
    return isGuardian
      ? `guardian containment 建立失败（${facts.spawn_error.message}）`
      : `child spawn error（${facts.spawn_error.code ?? 'spawn'}）：${facts.spawn_error.message}`;
  }
  // ③ Codex 结构化模型兼容 400（先于②判——它是 CLI 兼容类硬错误，run 必停机）。
  if (facts.exitCode !== 0) {
    const combined = `${facts.stderr}\n${facts.stdout}`;
    if (matchesCodex400RequiresNewer(combined)) {
      return 'Codex 模型兼容硬错误：当前 Codex CLI 版本过低，模型要求更新版本（status=400 + invalid_request_error + requires a newer version of Codex）——升级 Codex CLI 后重跑，非内容失败。';
    }
  }
  // ② CLI/config 参数不兼容——必要条件缺一不可。
  if (facts.exitCode === 0) return null;
  // 有"有效答卷"不是参数错误：
  //  · canary 路径（answerKey 在场）：可解析金丝雀答卷才视为作答；banner 不算；
  //  · 无 answerKey 的 canary 直调（旧语义）：任意非空 stdout 算有效答卷；
  //  · **formal invoke（formalInvoke=true）**：不存在答卷概念——banner/任意 stdout
  //    都不压签名（评审 P1 最小复现：exit1 + banner stdout + unknown argument → 必须停机）。
  const hasValidAnswer = opts?.formalInvoke
    ? false
    : opts?.answerKey
      ? parseCanaryAnswer(
          {
            stdout: facts.stdout,
            ...(opts.structuredStdout ? { structured_stdout: true } : {}),
            ...(opts.structuredStdoutFormat ? { structured_stdout_format: opts.structuredStdoutFormat } : {}),
          },
          opts.answerKey,
        ).canonicalAnswer !== null
      : Boolean(facts.stdout && facts.stdout.trim()); // 无 answerKey 时保守沿用旧语义
  if (hasValidAnswer) return null; // 有有效答卷不是参数错误
  const lines = facts.stderr.split(/\r?\n/);
  for (const line of lines) {
    const capped = line.slice(0, HARD_CLI_LINE_CAP);
    for (const sig of HARD_CLI_STDERR_SIGNATURES) {
      if (sig.test(capped)) {
        return `CLI/config 参数不兼容：${capped.trim().slice(0, 300)}`;
      }
    }
  }
  return null;
}

/**
 * plan d7f3a9c4 t4：金丝雀探测是否命中**硬失败**——薄委托共享分类
 * （c4e8a1f7 T1a：与正式 phase invoke 同一 SSOT）。
 * 本函数不写盘、不 spawn、不分类 cache——只做"是否硬失败"的判别。
 */
export function resolveCanaryHardCliFailure(
  facts: CanaryHardCliFailureFacts,
  opts?: {
    answerKey?: CanaryAnswerKey;
    structuredStdout?: boolean;
    structuredStdoutFormat?: CanaryStdoutEnvelope;
  },
): string | null {
  return resolveInvokeHardCliFailure(facts, opts);
}
