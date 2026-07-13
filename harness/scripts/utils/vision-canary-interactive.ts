// ============================================================================
// vision-canary-interactive.ts — I1a 交互式金丝雀判卷（plan b7e42d19）
// ============================================================================
// 交互式路径（IDE 里 agent 即会话）没有 goal 编排器 spawn headless invoke 的能力，
// 改走「自测卷」：SKILL 指令 agent 后台启动本判卷 CLI → CLI 出随机题卷并输出机读 JSON →
// agent 读图写答卷 → CLI 同进程判卷+无感写盘。三段拆成可单测纯逻辑，CLI 只做装配。
//
// 反作弊（分叉2）：交互式下 agent 与判卷同会话，固定卷答案（源码/answer-key.json）易被
// grep；故随机题卷答案**只存进程内存、绝不落盘**，agent 拿到的只有图路径。
// fail-safe（分叉1）：等待超时不写盘（超时≠盲，误写 none 会把有视觉的会话错钳）。

import * as fs from 'fs';
import * as path from 'path';
import {
  classifyCanaryResponse,
  generateRandomCanaryAnswerKey,
  renderCanaryImage,
  VISION_CANARY_PROBE_VERSION,
  type CanaryAnswerKey,
  type CanaryVerdict,
} from './vision-canary';
import {
  loadLocalConfig,
  writeLocalConfig,
  LOCAL_SCHEMA_VERSION,
  type FrameworkLocalConfig,
} from './framework-local-config';

/** 发给 agent 的机读握手（CLI 首行 flush 输出，agent 据此取图路径/答卷路径/超时点）。 */
export interface InteractiveCanaryChallenge {
  challenge_id: string;
  image_path: string;
  answer_path: string;
  expires_at: string;
}

export interface StartedChallenge {
  challenge: InteractiveCanaryChallenge;
  /** 答案只在内存，绝不落盘——判卷时传回 finalizeInteractiveCanary。 */
  answerKey: CanaryAnswerKey;
}

/** challenge_id 短随机串（仅用于日志/文件名区分，非安全用途）。 */
function shortId(rng: (maxExclusive: number) => number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i += 1) s += alphabet[rng(alphabet.length)];
  return s;
}

/**
 * 出题：生成随机题卷（内存）、渲染图到 workDir、返回机读 challenge + answerKey。
 * answer key 不落盘；只有图落盘。answer_path 是 agent 将要写答卷的目标路径（此刻不存在）。
 */
export async function startInteractiveCanaryChallenge(input: {
  workDir: string;
  ttlMs: number;
  now?: () => number;
  rng?: (maxExclusive: number) => number;
}): Promise<StartedChallenge> {
  const now = input.now ?? Date.now;
  const rng = input.rng ?? ((max: number) => Math.floor(secureUnit() * max));
  const answerKey = generateRandomCanaryAnswerKey(rng);
  const id = shortId(rng);
  fs.mkdirSync(input.workDir, { recursive: true });
  const imagePath = path.join(input.workDir, `vision-canary-challenge-${id}.png`);
  const answerPath = path.join(input.workDir, `vision-canary-answer-${id}.txt`);
  await renderCanaryImage(imagePath, answerKey);
  return {
    challenge: {
      challenge_id: id,
      image_path: imagePath,
      answer_path: answerPath,
      expires_at: new Date(now() + input.ttlMs).toISOString(),
    },
    answerKey,
  };
}

/** crypto.randomInt 的单位随机（[0,1)）——rng 默认实现用；注入 rng 时不走此路径。 */
function secureUnit(): number {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.randomInt(0, 1_000_000) / 1_000_000;
}

export type WaitAnswerResult =
  | { answered: true; content: string }
  | { answered: false; reason: 'timeout' };

/**
 * 轮询答卷文件直到**写完整**或超过 expiresAtMs。CLI 在自己进程内前台等待——agent 侧须
 * **后台非阻塞**启动本 CLI（前台跑即死锁：agent 阻塞等命令返回、CLI 阻塞等答卷），编排见 SKILL。
 * isComplete 注入收卷完整性判据（codex P2 二轮）：默认非空即收；CLI 传入 canary 完整性判据
 * （全部答题键齐或 CANNOT_SEE_IMAGE），堵"半写入非空内容被立即误判"的竞态。
 * sleep/now 注入便于单测用短超时不真实阻塞。
 */
export async function waitForAnswerFile(input: {
  answerPath: string;
  expiresAtMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isComplete?: (content: string) => boolean;
}): Promise<WaitAnswerResult> {
  const now = input.now ?? Date.now;
  const pollMs = input.pollMs ?? 500;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const isComplete = input.isComplete ?? ((content: string) => content.trim().length > 0);
  for (;;) {
    if (fs.existsSync(input.answerPath)) {
      try {
        const content = fs.readFileSync(input.answerPath, 'utf-8');
        // 半写入竞态防护（codex P2 二轮）：空 / 半截非空内容一律视作"尚未写完"，继续轮询
        //（宁可等到超时 fail-safe 不写盘，也不对不完整答卷判卷写错缓存）。
        if (isComplete(content)) return { answered: true, content };
      } catch {
        // 文件刚创建还没写完 → 下一轮重读
      }
    }
    if (now() >= input.expiresAtMs) {
      return { answered: false, reason: 'timeout' };
    }
    await sleep(pollMs);
  }
}

export interface FinalizeResult {
  verdict: CanaryVerdict;
  reason: string;
  wrote: boolean;
}

/**
 * 判卷 + 无感写盘 vision.canary（probed_via: 'interactive'）。保留既有 vision 其它字段
 * （image_input_override 等）与顶层 agent_adapter/toolchain——与 goal-preflight 同款 spread。
 * 只有真拿到答卷才走此路径；超时由调用方 fail-safe 不写盘。
 */
export function finalizeInteractiveCanary(input: {
  projectRoot: string;
  adapter: string;
  answerKey: CanaryAnswerKey;
  answerContent: string;
  now?: () => number;
}): FinalizeResult {
  const now = input.now ?? Date.now;
  const classify = classifyCanaryResponse(input.answerContent, input.answerKey);
  const existing: FrameworkLocalConfig =
    loadLocalConfig(input.projectRoot) ?? { schema_version: LOCAL_SCHEMA_VERSION };
  writeLocalConfig(input.projectRoot, {
    ...existing,
    vision: {
      ...(existing.vision ?? {}),
      canary: {
        adapter: input.adapter,
        verdict: classify.verdict,
        probed_at: new Date(now()).toISOString(),
        reason: classify.reason,
        probed_via: 'interactive',
        // plan c7d2e9a4 t1：探测协议版本——两写盘点一致，旧缓存缺字段自动 stale
        probe_version: VISION_CANARY_PROBE_VERSION,
      },
    },
  });
  return { verdict: classify.verdict, reason: classify.reason, wrote: true };
}
