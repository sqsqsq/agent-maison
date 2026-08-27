// ============================================================================
// visual-provider-invoke.ts — 只读视觉 provider 执行器（plan ab072691 t3）
// ============================================================================
// **物理只读是首期唯一硬边界之一。**
//
// 现行普通 headless argv 恒全权限（bypass / danger-full-access / --force --trust /
// skip-permissions）——复用给 provider 就是「名义只读、实际全权限」。因此本模块**独立**
// 构造只读 `HeadlessInvokePlan`，绝不调用 claudeArgv / codexArgv / cursorHeadlessPlan /
// opencodeHeadlessPlan 任何一个。
//
// 但**生命周期不重造**：所有真实调用统一进入既有 `invokeAgentHeadless(plan, cwd, opts)`。
// 本模块**不得**自建 child spawn、timeout 计时器、tree-kill、terminal failure 优先仲裁、
// stdout/stderr 汇集或 usage 回填，也不得直接调用 deriveInvokeUsage：
//   · 分钟级 timeout → 既有 `AgentInvokeOptions.timeoutMs`；
//   · terminal 终态  → 既有 `resolveTerminalEventParser(plan.adapterName)`（codex JSONL）；
//   · usage         → 只读 `AgentInvokeResult.usage`。
// 第二套 spawn/timer/parser 就是第二套超时语义与第二套失败仲裁——历史事故的形状。
//
//   adapter.yaml.visual_provider  →  resolveVisualProviderInvokePlan()  →  只读 plan
//                                                                              │
//                                    既有 invokeAgentHeadless(plan, cwd, opts) ←┘
//                                              │  （spawn/timeout/kill/terminal/usage）
//                                              ▼
//                                    AgentInvokeResult
//                                              │  stdout_envelope 选既有投影
//                                              ▼      正文 → 调用方做统一载荷校验
//
// 结果 fail-closed × 循环 fail-open：任何一步不成立 → outcome=unavailable|invalid，
// provider 写盘产物一律不采信；**不 halt、不 revert、不停等**，开发循环按 blind 继续。
// ============================================================================

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  invokeAgentHeadless,
  STRUCTURED_BINARY_CANDIDATES,
  type AgentInvokeResult,
  type HeadlessInvokePlan,
} from './agent-invoke';
import {
  loadVisualProviderDeclaration,
  type VisualProviderDeclaration,
  type VisualProviderStdoutEnvelope,
} from './adapter-catalog';
import { extractClaudeFinalResultText } from './claude-envelope';
import { extractCodexAgentMessageText } from './codex-terminal-events';
import { hasImageReadParser, parseImageReadEventsFor } from './critic-receipt-producer';
import { resolveHeadlessBinary, shouldUseCrossSpawn } from './headless-binary-resolve';
import type { AgentInvokeUsage } from './usage-capture';
import type { ProviderRef } from './types';

// ---------------------------------------------------------------------------
// 预算（t3⑥）：**不占** max_total_turns / max_retries_per_phase；占 wall clock。
// ---------------------------------------------------------------------------

/** 单次 provider 调用的分钟级独立 timeout（经既有 AgentInvokeOptions.timeoutMs 注入）。 */
export const VISUAL_PROVIDER_DEFAULT_TIMEOUT_MS = 5 * 60_000;

// review 的批次契约是「**一批覆盖全部目标屏**，不按屏散发」——它由 runVisualProviderReview
// 的结构保证（逐屏合并进一次 invoke），并由单测「N 屏只发一次 invoke」钉死。
//
// 这里**刻意不放**「每 attempt 至多 N 次调用」的计数常量：gate 在同一 attempt 内的合法重跑
// 是既有契约的一部分（缺陷清零 → 重采/重评 → 当前 hash-bound 机器证据 →
// **重跑 gate 方 PASS**），硬计数会把必要重验判成超预算并落入错误降级。

/** spec 观察：单 run 封顶（另受参考图数量约束，见 resolveSpecObservationBudget）。 */
export const VISUAL_PROVIDER_SPEC_OBSERVATION_MAX_PER_RUN = 12;

/** spec 观察的本轮批次上限 = min(参考图数, 单 run 封顶)。 */
export function resolveSpecObservationBudget(referenceImageCount: number): number {
  const n = Number.isFinite(referenceImageCount) ? Math.max(0, Math.floor(referenceImageCount)) : 0;
  return Math.min(n, VISUAL_PROVIDER_SPEC_OBSERVATION_MAX_PER_RUN);
}

export type VisualProviderPurpose = 'spec_observation' | 'review';

/** 与 visual-diff 侧的 hash 口径一致（sha256 前 16 hex），避免两套截断规则。 */
export function hashImageFile(absPath: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ① 只读 plan 构造（**唯一** argv SSOT；adapter.yaml 是声明面）
// ---------------------------------------------------------------------------

export interface VisualProviderPlanInput {
  provider: ProviderRef;
  declaration: VisualProviderDeclaration;
  /** 工程内**真实**图片路径（绝对）。无暂存复制——物理只读由 argv 承担。 */
  imagePaths: string[];
  /** prompt 正文。**恒走 stdin**：Windows 的 .cmd shim 会在首个换行处截断 argv prompt。 */
  prompt: string;
  projectRoot: string;
}

export interface VisualProviderPlan {
  plan: HeadlessInvokePlan;
  /** 只读机制需要的额外子进程 env（如 OpenCode 的结构化权限声明） */
  extraEnv?: Record<string, string>;
}

/**
 * OpenCode 只读权限声明：**只放行读取类工具**，edit/bash 等一律 deny。
 * 与 `--pure` 配合——后者屏蔽用户级配置，前者收敛工具面。
 */
const OPENCODE_READONLY_PERMISSION = JSON.stringify({
  edit: 'deny',
  bash: 'deny',
  webfetch: 'deny',
  write: 'deny',
  patch: 'deny',
  read: 'allow',
  glob: 'allow',
  grep: 'allow',
});

function resolveBinary(adapterName: string): { bin: string; resolved: ReturnType<typeof resolveHeadlessBinary> } {
  // 复用既有候选表（agent-invoke 的同一份），未登记的 adapter 直接用其名字当 token：
  // 这是**诊断/解析**用的映射，不是支持白名单——支持资格仍只看 visual_provider 声明。
  const candidates = STRUCTURED_BINARY_CANDIDATES[adapterName] ?? [adapterName];
  const resolved = resolveHeadlessBinary([...candidates]);
  return { bin: resolved?.path ?? candidates[0], resolved };
}

/**
 * 按 `readonly_invoke` 机制 id 构造只读 argv。机制 adapter 通用——同一 CLI 家族的多个
 * adapter 可共用同一机制；具体旗标形态是运行时 SSOT，adapter.yaml 只声明选哪一种。
 *
 * **绝对禁止**在这里出现任何全权限旗标（bypass / danger-full-access / force / trust /
 * skip-permissions）——那正是本模块存在的理由。
 */
export function resolveVisualProviderInvokePlan(input: VisualProviderPlanInput): VisualProviderPlan {
  const { provider, declaration, imagePaths, prompt } = input;
  const { bin, resolved } = resolveBinary(provider.adapter);
  const base = {
    useStdin: true as const,
    stdin: prompt,
    resolvedBinary: resolved,
    useCrossSpawn: shouldUseCrossSpawn(resolved),
    adapterName: provider.adapter,
  };
  const modelFlag = declaration.model_replay;

  switch (declaration.readonly_invoke) {
    case 'safe_mode_read_only_tools': {
      // 两个控制面**都要关**：`--safe-mode` 隔离工程定制（settings.json / hooks /
      // 入口文件 / skills / plugins / MCP / 自定义命令与子 agent），`--tools Read` 把模型
      // 上下文里的内建工具收敛到只读读取，`--disallowedTools mcp__*` 再显式拒 MCP。
      // 只关其一都不够：工程 hook 会在 provider 进程里跑，工具面也会漏。
      const argv = [
        bin, '-p',
        '--safe-mode',
        '--tools', 'Read',
        '--allowedTools', 'Read',
        '--disallowedTools', 'mcp__*',
        modelFlag, provider.model,
        // 复用既有 stream-json 信封与其投影函数，不新建 parser。
        '--output-format', 'stream-json', '--verbose',
      ];
      return { plan: { ...base, argv, label: `${path.basename(bin)} -p --safe-mode --tools Read …` } };
    }
    case 'read_only_sandbox': {
      // 顶层 approval 必须在 `exec` **之前**（既有实证：`exec -a never` 直接报未知参数）；
      // `exec [--model <v>] --sandbox <mode>` 的顺序沿用 e6 已验证形态。
      // 这里的 sandbox 档是 **read-only**——绝不是普通 headless 的 danger-full-access。
      const argv = [bin, '--ask-for-approval', 'never', 'exec', modelFlag, provider.model, '--sandbox', 'read-only'];
      for (const img of imagePaths) argv.push('--image', img);
      argv.push('--json');
      return { plan: { ...base, argv, label: `${path.basename(bin)} exec --sandbox read-only …` } };
    }
    case 'ask_mode': {
      // 只问不改：**禁止** --force / --trust（那是全权限契约）。图片走 prompt 内真实路径，
      // 由 ask 模式的只读读取工具打开。
      const argv = [bin, '-p', '--mode', 'ask', modelFlag, provider.model, '--output-format', 'json'];
      return { plan: { ...base, argv, label: `${path.basename(bin)} -p --mode ask …` } };
    }
    case 'permission_deny_non_read': {
      // 结构化权限声明把非只读工具置 deny；`--pure` 同时屏蔽用户级配置。
      const argv = [bin, 'run', '--pure', modelFlag, provider.model];
      for (const img of imagePaths) argv.push('--file', img);
      argv.push('--format', 'json');
      return {
        plan: { ...base, argv, label: `${path.basename(bin)} run --pure …` },
        extraEnv: { OPENCODE_PERMISSION: OPENCODE_READONLY_PERMISSION },
      };
    }
    default: {
      // 机制 id 由 schema 枚举把关；走到这里说明 schema 与本表脱节——fail-closed。
      const never: never = declaration.readonly_invoke;
      throw new Error(`[visual-provider] 未接线的 readonly_invoke 机制: ${String(never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// ③ stdout 信封投影（**只选既有能力**，不新建第二套 parser）
// ---------------------------------------------------------------------------

/**
 * 确定性 final result 投影：只接受**终态 result 事件**，绝不把增量/工具事件当正文。
 *
 * 接受两种承载形态（`--output-format json` / `--format json` 的常见两态）：
 *  · 整段 stdout 是一个 JSON 对象；
 *  · stdout 是 JSONL，逐行取**最后一个**合法终态 result。
 * 任何不匹配 → null（调用方按 invalid 处理 → 本轮丢弃 → blind 继续）。
 *
 * 形态以锁定版本 CLI 的真实 smoke 固定（plan ab072691 t6）：猜错的代价是本轮降级为
 * blind，**不会**制造假 PASS——这正是 fail-closed 结果 × fail-open 循环的设计意图。
 */
export function extractJsonFinalResultText(raw: string): string | null {
  const pick = (doc: unknown): string | null => {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    const obj = doc as Record<string, unknown>;
    if (obj.is_error === true) return null;
    if (typeof obj.type === 'string' && obj.type !== 'result') return null;
    for (const key of ['result', 'text', 'output']) {
      const v = obj[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
  };
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const direct = pick(JSON.parse(trimmed));
      if (direct !== null) return direct;
    } catch {
      /* 落到逐行扫描 */
    }
  }
  let last: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(s);
    } catch {
      continue;
    }
    const v = pick(doc);
    if (v !== null) last = v;
  }
  return last;
}

/**
 * `events_json` 方言（OpenCode `run --format json`）——形状以宿主锁定版 1.18.14 真实
 * 样本钉死（plan ab072691 tasks 7.7 回填）：NDJSON，每行 `{type, timestamp, sessionID, part}`，
 * 正文在 `type==='text'` 行的 `part.text`，终止锚点是 `type==='step_finish'`。
 *
 * 确定性锚点（缺一即 null，不做「尽力凑一段正文」）：
 *  · 出现任何 `type==='error'` 行 → null（API 401/403 等在这里被挡住）；
 *  · 终态必须**绑定最后一段正文**——`step_finish` 只封它自己那条 message 的稿；
 *  · `part.reason` 必须是 `stop`；`tool-calls` 等中间终态不封稿（后面还有内容要来）；
 *  · finish 之后又出现 `step_start` / 新 `text` ⇒ 此前的封稿**失效**（流还没走完）。
 *
 * 为什么不能用「全流见过任意 finish」这种全局判据（评审意见 1 P0，本轮修复）：
 *   text(m1) / step_finish(m1) / text(m2)   ← m2 还在流，尚未 finish
 * 全局判据会把**未完成的 m2** 当终稿返回。方向上这是 fail-closed 的**危险侧**——
 * 把没写完的半截答案当完整评审采信，比整轮判 invalid 严重得多。
 */
export function extractOpenCodeFinalText(raw: string): string | null {
  /** 当前正在累积的 message 及其正文分片；`finalized` 只在终态绑定成功时才落。 */
  let currentId: string | null = null;
  let currentTexts: string[] = [];
  let finalized: string | null = null;

  const messageIdOf = (part: Record<string, unknown> | null): string | null =>
    part && typeof part.messageID === 'string' && part.messageID.trim() ? part.messageID : null;

  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(s) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (doc.type === 'error') return null;
    const part = doc.part && typeof doc.part === 'object' && !Array.isArray(doc.part)
      ? (doc.part as Record<string, unknown>)
      : null;

    if (doc.type === 'step_start') {
      // 新步骤开始 ⇒ 之前封的稿不再是终稿（后面还有内容）
      finalized = null;
      continue;
    }

    if (doc.type === 'text' && part && typeof part.text === 'string' && part.text.length > 0) {
      const id = messageIdOf(part);
      if (id !== currentId) {
        currentId = id;
        currentTexts = [];
      }
      currentTexts.push(part.text);
      // 又来新正文 ⇒ 此前封稿失效（旧 finish 不能替新 message 背书）
      finalized = null;
      continue;
    }

    if (doc.type === 'step_finish' && part) {
      if (part.reason !== 'stop') continue;            // tool-calls 等中间终态不封稿
      if (currentTexts.length === 0) continue;         // 没有正文可封
      const id = messageIdOf(part);
      // 真实事件两侧都带 messageID 时必须同源；缺失时退回「紧邻顺序」绑定
      if (id !== null && currentId !== null && id !== currentId) continue;
      finalized = currentTexts.join('\n');
    }
  }

  const body = finalized === null ? null : finalized.trim();
  return body !== null && body.length > 0 ? body : null;
}

/**
 * 按声明的信封方言投影正文。
 *
 * `turn_jsonl` 的额外契约（e6 分层复用）：只有 **completion 观测成立且无 terminal
 * failure** 时才投影；投影为 null 亦判失败。scanner 只判终态、正文另用投影函数、
 * usage 直接取 invoke result——三件事分别归三处，本模块不重做任何一件。
 */
export function projectVisualProviderBody(
  envelope: VisualProviderStdoutEnvelope,
  result: AgentInvokeResult,
): { body: string | null; reason?: string } {
  switch (envelope) {
    case 'stream_json_result': {
      const body = extractClaudeFinalResultText(result.stdout);
      return body === null ? { body: null, reason: '无终态 success result 信封' } : { body };
    }
    case 'turn_jsonl': {
      if (result.completion_observed !== true) {
        return { body: null, reason: '未观测到 turn 完成终态' };
      }
      if (result.terminal_failure_observed === true) {
        return { body: null, reason: '观测到 terminal failure 终态' };
      }
      const body = extractCodexAgentMessageText(result.stdout);
      return body === null ? { body: null, reason: 'JSONL 无可投影的 agent message' } : { body };
    }
    case 'result_json': {
      const body = extractJsonFinalResultText(result.stdout);
      return body === null ? { body: null, reason: '无确定性 final result' } : { body };
    }
    case 'events_json': {
      const body = extractOpenCodeFinalText(result.stdout);
      return body === null ? { body: null, reason: '无确定性 final result（无 step_finish 终态或无终稿文本）' } : { body };
    }
    default: {
      const never: never = envelope;
      return { body: null, reason: `未接线的 stdout_envelope: ${String(never)}` };
    }
  }
}

// ---------------------------------------------------------------------------
// ④ 脏检查第二防线：invoke 前后 `git status --porcelain` 对比
// ---------------------------------------------------------------------------

/**
 * 只读工作区快照。git 不可用 / 非仓库 / 超时 → null（**不报错、不阻断**）：脏检查是
 * argv 只读之外的**第二**防线，它自己不可用不该让开发循环停下来。
 */
export function snapshotWorkspaceDirtiness(projectRoot: string): string | null {
  try {
    return execFileSync('git', ['status', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 30_000,
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ② 统一执行：真实调用一律经既有 invokeAgentHeadless
// ---------------------------------------------------------------------------

export interface VisualProviderInvokeInput {
  projectRoot: string;
  frameworkRoot: string;
  provider: ProviderRef;
  purpose: VisualProviderPurpose;
  prompt: string;
  /** 工程内真实图片绝对路径 */
  imagePaths: string[];
  /** 本次调用 id（事件与证据目录都用它） */
  invokeId: string;
  /** 证据落盘目录（`<report_dir>/visual-review/<invoke_id>/`）；缺省=不落盘 */
  evidenceDir?: string;
  timeoutMs?: number;
  dryRun?: boolean;
  /**
   * **仅单测注入缝**：替换统一执行器，用来确定性地演练 timeout / terminal failure /
   * 非零退出 / 脏工作区等分档。生产路径恒用既有 `invokeAgentHeadless`——本字段不传即可，
   * 它的存在不构成"第二套生命周期"（注入的仍然只有结果，不是另一套 spawn/timer）。
   */
  invokeAgent?: typeof invokeAgentHeadless;
}

export type VisualProviderOutcome = 'success' | 'unavailable' | 'invalid';

export interface VisualProviderInvocation {
  invoke_id: string;
  provider: ProviderRef;
  purpose: VisualProviderPurpose;
  outcome: VisualProviderOutcome;
  /** 非 success 时的人读原因（进事件，供排障） */
  reason?: string;
  /** 投影后的正文；outcome!=='success' 时恒 null */
  body: string | null;
  duration_ms: number;
  image_hashes: string[];
  /** invoke 前后工作区是否变脏（变脏即丢弃本轮结果，**不自动 revert**、不 halt） */
  workspace_dirtied: boolean;
  /** 只消费 AgentInvokeResult.usage——本模块不另算用量 */
  usage?: AgentInvokeUsage;
  /** 结构化事件流落盘路径（receipt 证据披露用） */
  events_path?: string;
  /**
   * plan ab072691 t4⑥/t5④：验读证据等级——**如实披露，不构成任何门槛**。
   * · 'verified'   —— 该 adapter 有结构化验读事件解析器，且事件流确实证明读了本轮图片；
   * · 'unverified' —— 无解析器（如 codex/cursor/opencode 做 provider）、无事件流，
   *                   或事件流未覆盖本轮图片。
   * **受理与披露分立**：unverified 且载荷合法的结果**照常用于回修**；无效只指载荷校验失败。
   */
  input_provenance: 'verified' | 'unverified';
}

/**
 * 验读证据等级判定（t4⑥/t5④）——**best-effort 披露，不是门槛**。
 *
 * 只有「该 adapter 有已入册的结构化验读事件解析器」且「事件流确实覆盖本轮**每一张**图片」
 * 时才判 verified；其余一律如实 unverified（无解析器的 adapter 做 provider 是首批的常态，
 * 把它当无效会整体误伤合法评审——受理与披露必须分立）。
 */
function resolveInputProvenance(
  projectRoot: string,
  adapter: string,
  eventsPath: string | undefined,
  imagePaths: string[],
): 'verified' | 'unverified' {
  if (!eventsPath || imagePaths.length === 0) return 'unverified';
  if (!hasImageReadParser(adapter)) return 'unverified';
  try {
    const reads = parseImageReadEventsFor(adapter, fs.readFileSync(eventsPath, 'utf-8'));
    if (!reads) return 'unverified';
    const readSet = new Set(reads.map(r => path.resolve(projectRoot, r)));
    return imagePaths.every(p => readSet.has(path.resolve(projectRoot, p))) ? 'verified' : 'unverified';
  } catch {
    return 'unverified';
  }
}

/**
 * 执行一次 provider 调用。
 *
 * 失败分档：
 *  · `unavailable` —— 传输面不成立：adapter 无完整声明、CLI 缺失/不可 spawn、spawn 失败、
 *    超时、terminal failure、进程非零退出。
 *  · `invalid`     —— 调用回来了但内容不可用：信封投影为空/为 null、工作区被弄脏。
 * 载荷 schema / 身份回显 / 图片 hash 的**逐项校验**由调用方在拿到 body 后进行
 * （review 与 spec 观察两种载荷形态不同，但都走同一条「不合法即丢弃」的路）。
 */
export async function invokeVisualProvider(
  input: VisualProviderInvokeInput,
): Promise<VisualProviderInvocation> {
  const started = Date.now();
  const imageHashes = input.imagePaths.map(p => hashImageFile(p)).filter((h): h is string => h !== null);
  const base = {
    invoke_id: input.invokeId,
    provider: input.provider,
    purpose: input.purpose,
    image_hashes: imageHashes,
    workspace_dirtied: false,
    // 默认 unverified：没有证据就是没有证据。有解析器且事件确实覆盖本轮图片时才升 verified。
    input_provenance: 'unverified' as const,
  };
  const fail = (
    outcome: VisualProviderOutcome,
    reason: string,
    extra?: Partial<VisualProviderInvocation>,
  ): VisualProviderInvocation => ({
    ...base,
    outcome,
    reason,
    body: null,
    duration_ms: Date.now() - started,
    ...extra,
  });

  const decl = loadVisualProviderDeclaration(input.frameworkRoot, input.provider.adapter);
  if (!decl.ok) return fail('unavailable', decl.reason);

  let built: VisualProviderPlan;
  try {
    built = resolveVisualProviderInvokePlan({
      provider: input.provider,
      declaration: decl.declaration,
      imagePaths: input.imagePaths,
      prompt: input.prompt,
      projectRoot: input.projectRoot,
    });
  } catch (err) {
    return fail('unavailable', (err as Error).message);
  }

  let outputLogPath: string | undefined;
  if (input.evidenceDir) {
    try {
      fs.mkdirSync(input.evidenceDir, { recursive: true });
      outputLogPath = path.join(input.evidenceDir, 'agent-output.log');
    } catch {
      // 证据落盘失败不影响调用本身：证据是**披露**用的，不是采信门槛。
      outputLogPath = undefined;
    }
  }

  const before = snapshotWorkspaceDirtiness(input.projectRoot);

  // 生命周期全部交给既有执行器：spawn / timeout / tree-kill / terminal 仲裁 / usage 回填。
  // terminalEventParser 不显式传——由 plan.adapterName 经既有 resolveTerminalEventParser 解析。
  const result = await (input.invokeAgent ?? invokeAgentHeadless)(built.plan, input.projectRoot, {
    ...(input.dryRun ? { dryRun: true } : {}),
    timeoutMs: input.timeoutMs ?? VISUAL_PROVIDER_DEFAULT_TIMEOUT_MS,
    ...(outputLogPath ? { outputLogPath } : {}),
    // 三文件分流：agent-events.jsonl 只收纯 stdout（receipt 证据流绑定它，不绑混合人读日志）。
    toolEventCapture: 'structured_events',
    // 四种信封都是 stdout JSON；采集不到时既有实现自动降级为 proxy，不虚报。
    usageCapture: 'stdout_json',
    ...(built.extraEnv ? { extraEnv: built.extraEnv } : {}),
  });

  const after = snapshotWorkspaceDirtiness(input.projectRoot);
  const dirtied = before !== null && after !== null && before !== after;
  const eventsPath = outputLogPath ? path.join(path.dirname(outputLogPath), 'agent-events.jsonl') : undefined;
  const common = {
    ...(result.usage ? { usage: result.usage } : {}),
    ...(eventsPath ? { events_path: eventsPath } : {}),
    // t4⑥/t5④：验读证据**如实**记录——它只影响披露等级，不影响本轮结果是否被采信。
    input_provenance: resolveInputProvenance(input.projectRoot, input.provider.adapter, eventsPath, input.imagePaths),
  };

  if (result.spawn_error) {
    return fail('unavailable', `provider CLI 无法启动：${result.spawn_error.message}`, common);
  }
  if (result.timed_out) {
    return fail('unavailable', 'provider 调用超时', common);
  }
  if (result.terminal_failure_observed === true) {
    return fail('unavailable', `provider 观测到失败终态：${result.terminal_error_excerpt ?? 'terminal failure'}`, common);
  }
  // completion 观测成立即视为「跑完了」（完成≠通过）；否则以退出码判传输面失败。
  if (result.exitCode !== 0 && result.completion_observed !== true) {
    return fail('unavailable', `provider 非零退出（exit=${result.exitCode}）`, common);
  }

  const projected = projectVisualProviderBody(decl.declaration.stdout_envelope, result);
  if (projected.body === null || projected.body.trim().length === 0) {
    return fail('invalid', projected.reason ?? 'provider 正文为空', common);
  }
  if (dirtied) {
    // 丢弃本轮结果 + 记录事实；**不自动 revert**（那会覆盖人可能想留的现场），**不 halt**。
    return fail('invalid', 'provider 调用前后工程工作区发生变化——本轮结果一律不采信', {
      ...common,
      workspace_dirtied: true,
    });
  }

  return {
    ...base,
    outcome: 'success',
    body: projected.body,
    duration_ms: Date.now() - started,
    ...common,
  };
}

// ---------------------------------------------------------------------------
// ③ 统一载荷校验的**共享原语**（身份回显 + JSON 提取）
// ---------------------------------------------------------------------------
// 注意分工：**逐屏 review 载荷的 schema 归属 visual-diff 那一层**（defect class/severity
// 枚举的唯一owner 在 profile 的 visual-diff-check.ts；在这里再写一份就是平行真源）。
// 本节只提供两者共用、与 profile 无关的原语：正文里取出 JSON 对象，以及身份回显校验。

/**
 * 从模型正文里取出**一个**顶层 JSON 对象。
 *
 * 允许 ```json 围栏与前后自然语言——这只是**解析**上的宽容，不放松任何信任性质：
 * 采信与否仍由身份回显 + 当前图片 hash + schema 决定。取不出即 null（→ invalid）。
 */
export function extractJsonObjectFromText(body: string): Record<string, unknown> | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const doc = JSON.parse(s) as unknown;
      return doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const trimmed = body.trim();
  const direct = tryParse(trimmed);
  if (direct) return direct;

  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  let lastFenced: Record<string, unknown> | null = null;
  while ((m = fence.exec(body)) !== null) {
    const parsed = tryParse((m[1] ?? '').trim());
    if (parsed) lastFenced = parsed;
  }
  if (lastFenced) return lastFenced;

  // 裸对象夹在散文里：取第一个 `{` 到最后一个 `}` 的闭包再试一次（只试一次，不做括号回溯）。
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return tryParse(trimmed.slice(first, last + 1));
  return null;
}

export interface ProviderIdentityExpectation {
  /** 期望回显的 run_id；不传=本轮无 run 身份可比（交互态） */
  runId?: string;
  /** 期望回显的 attempt_id；不传=本轮无 attempt 身份可比 */
  attemptId?: string;
  /** 本轮**当前**图片 hash 集合（顺序无关，必须逐一齐等） */
  imageHashes: string[];
}

/**
 * 身份回显校验：run_id / attempt_id 逐字相等，image_hashes 集合齐等。
 * 返回 null=通过；返回字符串=拒收原因（调用方按 invalid 丢弃本轮结果）。
 *
 * 这是「防旧结果制造 PASS」的核心一环：跨 attempt 复用、换图后沿用旧评审、
 * 半个屏集的载荷，都会在这里被挡住。
 */
export function validateProviderIdentityEcho(
  doc: Record<string, unknown>,
  expected: ProviderIdentityExpectation,
): string | null {
  const echoStr = (key: string): string | undefined => {
    const v = doc[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  if (expected.runId !== undefined && echoStr('run_id') !== expected.runId) {
    return `run_id 回显不符（期望 ${expected.runId}，实际 ${String(doc.run_id)}）`;
  }
  if (expected.attemptId !== undefined && echoStr('attempt_id') !== expected.attemptId) {
    return `attempt_id 回显不符（期望 ${expected.attemptId}，实际 ${String(doc.attempt_id)}）`;
  }
  const raw = doc.image_hashes;
  if (!Array.isArray(raw) || raw.some(h => typeof h !== 'string' || !h.trim())) {
    return 'image_hashes 缺失或不是非空字符串数组';
  }
  const got = new Set((raw as string[]).map(h => h.trim()));
  const want = new Set(expected.imageHashes);
  if (got.size !== want.size || [...want].some(h => !got.has(h))) {
    return `image_hashes 与本轮当前图片不符（期望 ${[...want].join(',')}，实际 ${[...got].join(',')}）`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ⑤ 事件投影（`visual_provider_invoke`，adapter_probe 同族形态）
// ---------------------------------------------------------------------------

export interface VisualProviderInvokeEvent {
  type: 'visual_provider_invoke';
  provider: string;
  model: string;
  purpose: VisualProviderPurpose;
  image_hashes: string[];
  outcome: VisualProviderOutcome;
  duration_ms: number;
  invoke_id: string;
  workspace_dirtied?: boolean;
  reason?: string;
  events_path?: string;
  /** 验读证据等级（如实披露，非门槛） */
  input_provenance: 'verified' | 'unverified';
}

/**
 * 把本次调用的事件落进它自己的证据目录（`<evidenceDir>/invoke-event.json`）。
 *
 * 为什么不写 run 的 events.jsonl：review 发生在 **gate 子进程**里，那份事件日志由 runner
 * 独占写入；跨进程追加是另一类风险。证据目录本就是本调用的产物落点，成功与失败**同等**
 * 落一份，排障与 receipt 披露都够用，且不新建任何 ledger。
 */
export function writeVisualProviderInvokeEvent(
  evidenceDir: string,
  inv: VisualProviderInvocation,
): string | null {
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    const abs = path.join(evidenceDir, 'invoke-event.json');
    fs.writeFileSync(abs, `${JSON.stringify(buildVisualProviderInvokeEvent(inv), null, 2)}\n`, 'utf-8');
    return abs;
  } catch {
    // 事件是披露不是门槛：写不出也不改判、不阻断。
    return null;
  }
}

export function buildVisualProviderInvokeEvent(
  inv: VisualProviderInvocation,
): VisualProviderInvokeEvent {
  return {
    type: 'visual_provider_invoke',
    provider: inv.provider.adapter,
    model: inv.provider.model,
    purpose: inv.purpose,
    image_hashes: inv.image_hashes,
    outcome: inv.outcome,
    duration_ms: inv.duration_ms,
    invoke_id: inv.invoke_id,
    input_provenance: inv.input_provenance,
    ...(inv.workspace_dirtied ? { workspace_dirtied: true } : {}),
    ...(inv.reason ? { reason: inv.reason } : {}),
    ...(inv.events_path ? { events_path: inv.events_path } : {}),
  };
}
