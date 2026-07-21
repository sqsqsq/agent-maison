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
import { collectClaudeImageReadPaths } from './claude-envelope';
import { featureDir, loadFrameworkConfig } from '../../config';
import {
  capabilityReceiptPath,
  readCapabilityReceipt,
  type CapabilityReceipt,
} from './effective-vision-context';
import { loadSpecMarkdown } from './fidelity-shared';
import { collectAuthoritativeImagePaths } from './multimodal-probe';

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
  // P0-1（plan 7c4f2e9b）：本体收敛到 claude-envelope 共享模块（四类信封消费一份语义），
  // 此处保留薄壳维持既有导出签名与注册表不变。
  return collectClaudeImageReadPaths(eventsJsonl);
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

// ---------------------------------------------------------------------------
// visual-capability-truth S3：spec 期 authoritative refs 验读回执
// （vl_multimodal 终签四条件之二——canary 只证"能看测试图"，不证"读过本需求参考图"）
// ---------------------------------------------------------------------------

export interface SpecRefsReceipt {
  schema_version: '1.0';
  adapter: string;
  goal_run_id: string;
  invoke_id: string;
  produced_at: string;
  refs: Array<{ path: string; hash: string | null; read: boolean }>;
  unread: string[];
  attestation: RunnerAttestation;
}

export function specRefsReceiptPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'vision', 'spec-refs-receipt.json');
}

export function loadSpecRefsReceipt(projectRoot: string, feature: string): SpecRefsReceipt | null {
  const p = specRefsReceiptPath(projectRoot, feature);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as SpecRefsReceipt;
    return parsed?.schema_version === '1.0' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * runner 从纯净结构化事件审计 spec 期参考图验读并签发回执。
 * 无解析器 adapter → produced:false（结构性不可签 vl_multimodal，诚实降级——
 * 20260718 事故的 cursor 自签正是本回执要堵的洞）。
 * 匹配语义：Read 事件 file_path 与 ref 绝对路径 resolve 相等，或尾段（basename）一致。
 */
export function produceSpecRefsReceipt(input: {
  projectRoot: string;
  feature: string;
  adapter: string;
  goalRunId: string;
  invokeId: string;
  eventsLogAbsPath: string;
  refAbsPaths: string[];
}): { produced: boolean; unread?: string[]; reason?: string } {
  const parser = IMAGE_READ_PARSERS[input.adapter];
  if (!parser) {
    return { produced: false, reason: `adapter=${input.adapter} 无注册的结构化事件解析器——vl_multimodal 结构性不可签` };
  }
  if (!fs.existsSync(input.eventsLogAbsPath)) {
    return { produced: false, reason: 'agent-events.jsonl 不存在（structured_events 分流未产出）' };
  }
  const readPaths = parser(fs.readFileSync(input.eventsLogAbsPath, 'utf-8'));
  const readResolved = readPaths.map(p => ({
    abs: path.resolve(input.projectRoot, p),
    base: path.basename(p),
  }));
  const refs: SpecRefsReceipt['refs'] = [];
  const unread: string[] = [];
  for (const refAbs of input.refAbsPaths) {
    const abs = path.resolve(refAbs);
    const base = path.basename(abs);
    const read = readResolved.some(r => r.abs === abs || r.base === base);
    let hash: string | null = null;
    try {
      hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    } catch {
      hash = null;
    }
    refs.push({ path: abs, hash, read });
    if (!read) unread.push(abs);
  }
  const receipt: SpecRefsReceipt = {
    schema_version: '1.0',
    adapter: input.adapter,
    goal_run_id: input.goalRunId,
    invoke_id: input.invokeId,
    produced_at: new Date().toISOString(),
    refs,
    unread,
    attestation: {
      goal_run_id: input.goalRunId,
      evidence_log_path: path.relative(input.projectRoot, input.eventsLogAbsPath).replace(/\\/g, '/'),
      evidence_log_hash: sha256File16(input.eventsLogAbsPath) ?? '',
      source: 'runner_transcript_audit',
    },
  };
  const outPath = specRefsReceiptPath(input.projectRoot, input.feature);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8');
  return { produced: true, unread };
}

// ===========================================================================
// visual-capability-truth 三轮 review P0-1/P0-2/P0-3：vl_multimodal 终签链统一验证器
// ---------------------------------------------------------------------------
// "runner-owned receipt" 不再是命名约定：runner 在 agent invocation 结束后统一清理+
// 重签发两张回执，并把回执文件 sha256 写入 goal-run events（capability_receipt /
// spec_refs_receipt_produced 事件）。本验证器要求：
//   ① run/attempt 身份在场（goal 态专属；交互态无 runner 链路，链恒不成立）；
//   ② 两张回执 invoke_id **精确等于** `spec-<attempt>`（endsWith 后缀旁路封死）、
//     run 匹配、adapter 与 run manifest 一致；
//   ③ 事件绑定：events.jsonl 中该 invoke 的**最后一条** runner 事件必须是签发态且
//     receipt_sha256 与盘上文件一致——agent 在 invocation 内伪造的文件/事件行必然被
//     runner 在 invoke 结束后追加的权威事件与清理动作压尾（顺序信任：runner 恒最后写）；
//   ④ refs 内容核对：重算当前 spec 的 authoritative refs，逐张要求回执含
//     read=true + hash 与当前文件一致；当前无 authoritative refs → 无验证对象，不可签。
// 消费方：check-spec verified 铸造（P0-3：文本互证不再单独铸 verified）与
// ui_spec_fidelity_gate 终签（P0-1）。
// ===========================================================================

export function sha256FileFull(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

export interface VlSigningChainResult {
  ok: boolean;
  failures: string[];
  capReceipt: CapabilityReceipt | null;
  refsReceipt: SpecRefsReceipt | null;
  /** 当前 authoritative refs（abs path + sha256）——verified attestation 绑定字段源 */
  currentRefs: Array<{ path: string; sha256: string }>;
  runId: string | null;
  expectedInvoke: string | null;
}

interface GoalRunEventLite {
  type?: string;
  invoke_id?: string;
  status?: string;
  receipt_sha256?: string;
}

export function verifyVlSigningChain(args: {
  projectRoot: string;
  feature: string;
}): VlSigningChainResult {
  const failures: string[] = [];
  const runId = (process.env.MAISON_GOAL_RUN_ID ?? '').trim() || null;
  const attempt = (process.env.MAISON_GOAL_ATTEMPT ?? '').trim() || null;
  const expectedInvoke = attempt ? `spec-${attempt}` : null;
  const fail = (msg: string): VlSigningChainResult => ({
    ok: false,
    failures: [...failures, msg],
    capReceipt: null,
    refsReceipt: null,
    currentRefs: [],
    runId,
    expectedInvoke,
  });
  if (!runId || !expectedInvoke) {
    return fail('无 goal run/attempt 身份（vl_multimodal 终签链仅 runner 编排链路可成立——交互态走 human_confirmed/盲档）');
  }

  // manifest.adapter=运行身份（goal 语境不以 config 为准——一轮 review 硬学习）
  let runAdapter = '';
  try {
    const manifestPath = path.join(featureDir(args.projectRoot, args.feature), 'goal-runs', runId, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { adapter?: string };
    runAdapter = (manifest.adapter ?? '').trim();
  } catch {
    /* manifest 不可读 → 回退 config */
  }
  if (!runAdapter) {
    try {
      runAdapter = (loadFrameworkConfig(args.projectRoot).agent_adapter ?? '').trim();
    } catch {
      runAdapter = '';
    }
  }
  if (!runAdapter) return fail('运行 adapter 身份不可得（manifest/config 均无）——链不可校验');

  const capReceipt = readCapabilityReceipt(args.projectRoot, args.feature);
  if (!capReceipt) {
    return fail('无 runner 签发的 invocation_bound capability receipt——模型路由未绑定或 inline canary 未通过，不可终签');
  }
  if (capReceipt.verdict === 'none') failures.push('capability receipt verdict=none——签发时模型无视觉能力');
  if (capReceipt.run_id !== runId) failures.push(`capability receipt 属旧 run（${capReceipt.run_id} ≠ 当前 ${runId}）`);
  if (capReceipt.invoke_id !== expectedInvoke) {
    failures.push(`capability receipt 属旧 invocation（${capReceipt.invoke_id} ≠ 当前 ${expectedInvoke}，精确等值）`);
  }
  if (capReceipt.adapter !== runAdapter) {
    failures.push(`capability receipt adapter 失配（${capReceipt.adapter} ≠ 运行身份 ${runAdapter}）`);
  }

  const refsReceipt = loadSpecRefsReceipt(args.projectRoot, args.feature);
  if (!refsReceipt) {
    return {
      ok: false,
      failures: [...failures, '无参考图验读回执（vision/spec-refs-receipt.json）——adapter 无结构化事件解析器时结构性不可签'],
      capReceipt, refsReceipt: null, currentRefs: [], runId, expectedInvoke,
    };
  }
  if (refsReceipt.goal_run_id !== runId) failures.push(`refs 回执属旧 run（${refsReceipt.goal_run_id} ≠ ${runId}）`);
  if (refsReceipt.invoke_id !== expectedInvoke) {
    failures.push(`refs 回执属旧 invocation（${refsReceipt.invoke_id} ≠ 当前 ${expectedInvoke}，精确等值）`);
  }
  if (refsReceipt.adapter !== runAdapter) failures.push(`refs 回执 adapter 失配（${refsReceipt.adapter} ≠ ${runAdapter}）`);
  if (refsReceipt.unread.length > 0) {
    failures.push(`参考图验读不完整：${refsReceipt.unread.length} 张无验读工具事件`);
  }

  // ③ runner 事件绑定（顺序信任：runner 在 invoke 结束后恒为该 invoke 的最后写入者）
  const eventsAbs = path.join(featureDir(args.projectRoot, args.feature), 'goal-runs', runId, 'events.jsonl');
  let events: GoalRunEventLite[] = [];
  try {
    events = fs.readFileSync(eventsAbs, 'utf-8')
      .split(/\r?\n/)
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as GoalRunEventLite; } catch { return {}; } });
  } catch {
    return { ok: false, failures: [...failures, `goal-run events 不可读（${eventsAbs}）——receipt 无 runner 事件锚，不可采信`], capReceipt, refsReceipt, currentRefs: [], runId, expectedInvoke };
  }
  const lastFor = (type: string): GoalRunEventLite | null => {
    const hits = events.filter(e => e.type === type && e.invoke_id === expectedInvoke);
    return hits.length > 0 ? hits[hits.length - 1] : null;
  };
  const capEvent = lastFor('capability_receipt');
  const capFileHash = sha256FileFull(capabilityReceiptPath(args.projectRoot, args.feature));
  if (!capEvent || capEvent.status !== 'issued_inline_canary' || !capEvent.receipt_sha256 || capEvent.receipt_sha256 !== capFileHash) {
    failures.push('capability receipt 无匹配的 runner 签发事件锚（事件缺失/非签发态/文件 hash 与事件不符）——非 runner 签发不可采信');
  }
  const refsEvent = lastFor('spec_refs_receipt_produced');
  const refsFileHash = sha256FileFull(specRefsReceiptPath(args.projectRoot, args.feature));
  if (!refsEvent || refsEvent.status !== 'complete' || !refsEvent.receipt_sha256 || refsEvent.receipt_sha256 !== refsFileHash) {
    failures.push('refs 回执无匹配的 runner 签发事件锚（事件缺失/非 complete/文件 hash 与事件不符）——非 runner 签发不可采信');
  }

  // ④ refs 内容核对：回执必须覆盖**当前** authoritative refs（路径+hash+read=true）
  const specMd = loadSpecMarkdown(args.projectRoot, args.feature);
  const currentRefPaths = specMd
    ? collectAuthoritativeImagePaths(args.projectRoot, specMd, p =>
        path.isAbsolute(p) ? p : path.resolve(args.projectRoot, p))
    : [];
  const currentRefs: Array<{ path: string; sha256: string }> = [];
  if (currentRefPaths.length === 0) {
    failures.push('当前 spec 无 authoritative 参考图——vl_multimodal 无验证对象，不可终签（空 refs 回执不构成证明）');
  }
  for (const refAbs of currentRefPaths) {
    const abs = path.resolve(refAbs);
    const hash = sha256FileFull(abs);
    if (!hash) {
      failures.push(`参考图不可读/不可 hash（${path.basename(abs)}）——不可终签`);
      continue;
    }
    currentRefs.push({ path: abs, sha256: hash });
    const entry = refsReceipt.refs.find(r => path.resolve(r.path) === abs);
    if (!entry) failures.push(`refs 回执未覆盖当前参考图 ${path.basename(abs)}（回执与当前 spec 的 refs 集不一致）`);
    else if (entry.read !== true) failures.push(`参考图 ${path.basename(abs)} 无验读事件（read=false）`);
    else if (entry.hash !== hash) failures.push(`参考图 ${path.basename(abs)} hash 失配（签发后文件已变/回执伪造）`);
  }

  return { ok: failures.length === 0, failures, capReceipt, refsReceipt, currentRefs, runId, expectedInvoke };
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
