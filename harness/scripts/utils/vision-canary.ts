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

const CANARY_SIZE = 300;

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

async function renderCanaryImage(outPath: string): Promise<void> {
  const half = CANARY_SIZE / 2;
  const image = new Jimp(CANARY_SIZE, CANARY_SIZE, 0xffffffff);
  const tl = new Jimp(half, half, CANARY_COLORS_HEX.red);
  const tr = new Jimp(half, half, CANARY_COLORS_HEX.blue);
  const bl = new Jimp(half, half, CANARY_COLORS_HEX.green);
  const br = new Jimp(half, half, CANARY_COLORS_HEX.yellow);
  image.composite(tl, 0, 0).composite(tr, half, 0).composite(bl, 0, half).composite(br, half, half);
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
  image.print(
    font,
    0,
    half - 20,
    {
      text: CANARY_ANSWER_KEY.text_token,
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

export { CANARY_ANSWER_KEY };
