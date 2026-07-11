/**
 * critic-receipt-producer.ts — t3b（plan f7a3d9c2）：goal 态 verified 回执生产者。
 *
 * 信任链：goal-runner（信任根，宿主 framework 完整性由 e8f5a2c7 守护）读**纯净结构化
 * 事件文件 agent-events.jsonl**（t3a 三文件分流，stderr 不污染 NDJSON）→ 提取图片读取
 * 工具事件 → 生成 critic-receipt.json 并附 **runner attestation**（goal_run_id + 事件
 * 文件 hash 的完整性绑定，非密码学签名）。
 *
 * verified 最低输入集（与 check 侧校验范围同一口径，rev4 统一）：visual-diff.json 全部
 * finalized 屏的被评截图 +（有 paired attest 时）全部 crops 均有验读记录——本生产者取
 * "全部 finalized 屏"超集（profile 无关，不在 generic 层解析 ui-spec P0）。
 * 部分缺失 → 如实 unverified + unread_screenshots[]/unread_crops[]。
 *
 * 解析器契约（t3a codex 红线）：只接受 CLI 产生的结构化事件，禁止从普通文本正则猜测
 * Read。当前实装解析器：claude（stream-json NDJSON 的 tool_use/Read 事件）。其余 adapter
 * 在 docs/operations/adapter-tool-event-provenance.md 盘点合格并配真实 fixture 后再注册
 * ——无解析器=生产者不产出（保持 agent 侧 unverified 回执），如实降级。
 *
 * 证明力边界：验读记录=「工具调用发生过且输入被注入」，≠「模型看懂了图」。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { featureDir } from '../../config';

export interface RunnerAttestation {
  goal_run_id: string;
  /** 相对 projectRoot 的证据日志路径（=agent-events.jsonl，非混合人读日志） */
  evidence_log_path: string;
  /** 证据日志 sha256 前 16 hex——check 重算比对，日志被改/回执伪造即拒 */
  evidence_log_hash: string;
  source: 'runner_transcript_audit';
}

function sha256File16(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * claude structured_events 解析器：`claude -p --output-format stream-json --verbose` 的
 * NDJSON 事件流。图片读取事件=assistant 消息 content 内 type=tool_use、name=Read、
 * input.file_path 以 .png/.jpg/.jpeg/.webp 结尾。只认结构化字段，非 JSON 行直接跳过。
 */
export function parseClaudeImageReadEvents(eventsJsonl: string): string[] {
  const out = new Set<string>();
  for (const line of eventsJsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const rec = evt as { type?: string; message?: { content?: unknown } };
    if (rec.type !== 'assistant' || !rec.message || !Array.isArray(rec.message.content)) continue;
    for (const block of rec.message.content as Array<Record<string, unknown>>) {
      if (!block || block.type !== 'tool_use' || block.name !== 'Read') continue;
      const input = block.input as { file_path?: unknown } | undefined;
      const fp = typeof input?.file_path === 'string' ? input.file_path.trim() : '';
      if (fp && /\.(png|jpe?g|webp)$/i.test(fp)) out.add(fp);
    }
  }
  return [...out];
}

/** adapter → 结构化事件解析器注册表（盘点合格 + fixture 后方可入册） */
const IMAGE_READ_PARSERS: Record<string, (eventsJsonl: string) => string[]> = {
  claude: parseClaudeImageReadEvents,
};

export function hasImageReadParser(adapter: string): boolean {
  return Object.prototype.hasOwnProperty.call(IMAGE_READ_PARSERS, adapter);
}

/** review-fix（codex P1-4）：check 侧复核用——按 adapter 解析验读事件；无解析器 → null */
export function parseImageReadEventsFor(adapter: string, eventsJsonl: string): string[] | null {
  const parser = IMAGE_READ_PARSERS[adapter];
  return parser ? parser(eventsJsonl) : null;
}

export interface ProduceCriticReceiptInput {
  projectRoot: string;
  feature: string;
  adapter: string;
  goalRunId: string;
  attemptId: string;
  /** agent-events.jsonl 绝对路径（t3a 分流产物） */
  eventsLogAbsPath: string;
  /** prompt sha256 前 16 hex（runner 现算，非 agent 自报） */
  promptHash: string;
  /** critic 输出（agent-output.log）hash——verified 档 output_hash */
  outputHash: string | null;
}

export interface ProduceCriticReceiptResult {
  produced: boolean;
  provenance?: 'verified' | 'unverified';
  reason?: string;
  unreadScreenshots?: string[];
  unreadCrops?: string[];
}

interface VisualDiffScreenLite {
  screen_id?: string;
  verdict?: string;
  screenshot_path?: string;
  region_attest?: Array<{ method?: string; evidence?: string }>;
}

/**
 * 生产/覆盖 critic-receipt.json。仅在①adapter 有注册解析器 ②事件日志存在 ③visual-diff.json
 * 可读且有 finalized 屏时产出；否则 produced=false（保持 agent 侧回执，unverified 档照旧）。
 */
export function produceCriticReceipt(input: ProduceCriticReceiptInput): ProduceCriticReceiptResult {
  const parser = IMAGE_READ_PARSERS[input.adapter];
  if (!parser) {
    return { produced: false, reason: `adapter=${input.adapter} 无注册的结构化事件解析器（盘点未合格），保持 unverified` };
  }
  if (!fs.existsSync(input.eventsLogAbsPath)) {
    return { produced: false, reason: 'agent-events.jsonl 不存在（structured_events 分流未产出）' };
  }
  const vdPath = path.join(
    featureDir(input.projectRoot, input.feature),
    'device-testing',
    'device-screenshots',
    'visual-diff.json',
  );
  if (!fs.existsSync(vdPath)) {
    return { produced: false, reason: 'visual-diff.json 不存在（无被评对象）' };
  }
  let screens: VisualDiffScreenLite[];
  try {
    const parsed = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens?: VisualDiffScreenLite[] };
    screens = Array.isArray(parsed.screens) ? parsed.screens : [];
  } catch (e) {
    return { produced: false, reason: `visual-diff.json 解析失败：${(e as Error).message}` };
  }
  const finalized = screens.filter(
    s => s.verdict === 'pass' || s.verdict === 'warn' || s.verdict === 'fail',
  );
  if (finalized.length === 0) {
    return { produced: false, reason: '无 finalized 屏（全 pending/skipped），本轮无 critic 评审对象' };
  }

  const eventsRaw = fs.readFileSync(input.eventsLogAbsPath, 'utf-8');
  const readPaths = parser(eventsRaw);
  const readAbsSet = new Set(readPaths.map(p => path.resolve(input.projectRoot, p)));

  const requiredShots: string[] = [];
  const requiredCrops: string[] = [];
  for (const s of finalized) {
    if (typeof s.screenshot_path === 'string' && s.screenshot_path.trim()) {
      requiredShots.push(s.screenshot_path.trim());
    }
    for (const a of s.region_attest ?? []) {
      if (a.method === 'paired_crop_compare' && typeof a.evidence === 'string' && a.evidence.trim()) {
        requiredCrops.push(a.evidence.trim());
      }
    }
  }
  const unreadScreenshots = requiredShots.filter(
    rel => !readAbsSet.has(path.resolve(input.projectRoot, rel)),
  );
  const unreadCrops = requiredCrops.filter(
    rel => !readAbsSet.has(path.resolve(input.projectRoot, rel)),
  );
  const covered = unreadScreenshots.length === 0 && unreadCrops.length === 0;
  const provenance: 'verified' | 'unverified' = covered ? 'verified' : 'unverified';

  const evidenceHash = sha256File16(input.eventsLogAbsPath);
  if (!evidenceHash) {
    return { produced: false, reason: '证据日志 hash 计算失败' };
  }
  const attestation: RunnerAttestation = {
    goal_run_id: input.goalRunId,
    evidence_log_path: path.relative(input.projectRoot, input.eventsLogAbsPath).replace(/\\/g, '/'),
    evidence_log_hash: evidenceHash,
    source: 'runner_transcript_audit',
  };

  // image_inputs=实际验读的图片（读取事件的并集，逐项现算 hash——verified 契约要求逐项带 hash）
  const imageInputs = readPaths
    .map(rel => {
      const abs = path.resolve(input.projectRoot, rel);
      const hash = sha256File16(abs);
      return hash ? { path: path.relative(input.projectRoot, abs).replace(/\\/g, '/'), hash } : null;
    })
    .filter((x): x is { path: string; hash: string } => x !== null);
  if (imageInputs.length === 0) {
    return { produced: false, reason: '事件日志中无可解析的图片验读记录（image_inputs 空回执任何档位拒绝，不产出）' };
  }

  const receipt = {
    schema_version: '1.1',
    critic_run_id: `${input.goalRunId}-${input.attemptId}`,
    adapter: input.adapter,
    prompt_hash: input.promptHash,
    input_provenance: provenance,
    image_inputs: imageInputs,
    ...(input.outputHash ? { output_hash: input.outputHash } : {}),
    ...(unreadScreenshots.length > 0 ? { unread_screenshots: unreadScreenshots } : {}),
    ...(unreadCrops.length > 0 ? { unread_crops: unreadCrops } : {}),
    runner_attestation: attestation,
  };
  const receiptAbs = path.join(
    featureDir(input.projectRoot, input.feature),
    'device-testing',
    'reports',
    'critic-receipt.json',
  );
  fs.mkdirSync(path.dirname(receiptAbs), { recursive: true });
  fs.writeFileSync(receiptAbs, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8');
  return {
    produced: true,
    provenance,
    ...(unreadScreenshots.length > 0 ? { unreadScreenshots } : {}),
    ...(unreadCrops.length > 0 ? { unreadCrops } : {}),
  };
}
