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

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Jimp from 'jimp';

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

/** 金丝雀设计版本——改任一几何/文案参数须递增，强制新 contenthash（旧缓存自动失效）。 */
const CANARY_DESIGN_VERSION = 1;

const CANARY_ANSWER_KEY: CanaryAnswerKey = {
  schema_version: '1.0',
  geometry_questions: [
    { id: 'TOP_LEFT_COLOR', expected_color: 'red' },
    { id: 'TOP_RIGHT_COLOR', expected_color: 'blue' },
    { id: 'BOTTOM_LEFT_COLOR', expected_color: 'green' },
    { id: 'BOTTOM_RIGHT_COLOR', expected_color: 'yellow' },
  ],
  text_token: 'MAISON7X3Q',
};

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

function computeCanaryContentHash(): string {
  const material = JSON.stringify({ v: CANARY_DESIGN_VERSION, key: CANARY_ANSWER_KEY });
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 12);
}

/** 文件名不含答案——只含内容哈希，答案独立存 <basename>.answer-key.json。 */
export function canaryAssetPaths(assetsDir: string): { imagePath: string; answerKeyPath: string } {
  const hash = computeCanaryContentHash();
  return {
    imagePath: path.join(assetsDir, `vision-canary-${hash}.png`),
    answerKeyPath: path.join(assetsDir, `vision-canary-${hash}.answer-key.json`),
  };
}

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
 * 渲染金丝雀图：象限颜色与 token 全由 answerKey 驱动（I1a 前重构——原实现颜色/token 硬编码
 * 且函数私有，随机题卷无法复用）。缺省 answerKey=固定卷（goal 模式沿用不变）。
 */
export async function renderCanaryImage(
  outPath: string,
  answerKey: CanaryAnswerKey = CANARY_ANSWER_KEY,
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

/** 幂等：资产已存在（内容哈希未变）则跳过渲染，仅首次/设计变更后重新生成。 */
export async function ensureVisionCanaryAsset(
  assetsDir: string,
): Promise<{ imagePath: string; answerKeyPath: string }> {
  const { imagePath, answerKeyPath } = canaryAssetPaths(assetsDir);
  fs.mkdirSync(assetsDir, { recursive: true });
  if (!fs.existsSync(answerKeyPath)) {
    fs.writeFileSync(answerKeyPath, `${JSON.stringify(CANARY_ANSWER_KEY, null, 2)}\n`, 'utf-8');
  }
  if (!fs.existsSync(imagePath)) {
    await renderCanaryImage(imagePath);
  }
  return { imagePath, answerKeyPath };
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
  answerKey: CanaryAnswerKey = CANARY_ANSWER_KEY,
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
  answerKey: CanaryAnswerKey = CANARY_ANSWER_KEY,
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
 */
export function resolveCanaryCacheDecision(
  invocation: CanaryInvocationFacts,
  answerKey: CanaryAnswerKey = CANARY_ANSWER_KEY,
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

  const raw = invocation.stdout;
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
  if (canonicalAnswer === null) {
    const trimmed = raw.trim();
    return {
      kind: 'invalid_answer',
      cache: false,
      detail: !trimmed
        ? '空输出——非有效答卷（额度耗尽/断流?），不落缓存'
        : `输出非有效答卷（合法答题键 ${finalAnswers.size}/${requiredKeys.length}、无独立行 CANNOT_SEE_IMAGE——错误文本/残卷/回显?），不落缓存`,
    };
  }

  const classify = classifyCanaryResponse(canonicalAnswer, answerKey);
  return {
    kind: 'valid',
    cache: true,
    classify: { ...classify, externalToolSuspected: detectExternalToolSuspected(raw) },
    canonicalAnswer,
  };
}

export { CANARY_ANSWER_KEY };
