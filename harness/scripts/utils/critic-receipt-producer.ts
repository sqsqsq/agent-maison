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
 * Read。当前实装解析器：claude-kernel 家族——claude 与 codeagent（同一 stream-json NDJSON
 * tool_use/Read 事件形状，共用 parseClaudeImageReadEvents；codeagent 2026-07-29 凭实采
 * fixture 入册，plan c7a9e2f4）。其余 adapter 在
 * docs/operations/adapter-tool-event-provenance.md 盘点合格并配真实 fixture 后再注册
 * ——无解析器=生产者不产出（保持 agent 侧 unverified 回执），如实降级。
 *
 * 证明力边界：验读记录=「工具调用发生过且输入被注入」，≠「模型看懂了图」。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { collectClaudeImageReadPaths } from './claude-envelope';
import { featureDir, loadFrameworkConfig } from '../../config';
import { resolveEffectiveVisionContext } from './effective-vision-context';
import { resolveRequirementReferenceImages } from './fidelity-shared';
import { readRunControl } from './goal-run-control';


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
 * claude-kernel structured_events 解析器：`claude|codeagentcli -p --output-format stream-json
 * --verbose` 的 NDJSON 事件流（家族共用，2026-07-29 codeagent 实采确认逐字段同构）。
 * 图片读取事件=assistant 消息 content 内 type=tool_use、name=Read、
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
  // 入册凭据（plan c7a9e2f4 #10）：2026-07-29 codeagent 宿主实采 Read tool_use 事件——
  // assistant.content[].{type:'tool_use',name:'Read',input.file_path} 与 claude 逐字段同构
  //（fork 附加的 tool_use_result.vlDescription 等扩展字段不在解析路径）；脱敏 fixture 见
  // tests/unit/codeagent-adapter.unit.test.ts。
  codeagent: parseClaudeImageReadEvents,
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
  schema_version: '1.1';
  adapter: string;
  goal_run_id: string;
  produced_at: string;
  /** `read_at_invoke`=该图**当前所依据的那一次** Read 的 invoke id（D4 诚实标注用，非签名字段） */
  refs: Array<{ path: string; hash: string | null; read: boolean; read_at_invoke?: string }>;
  unread: string[];
  attestation: RunnerAttestation;
}

export function specRefsReceiptPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'vision', 'spec-refs-receipt.json');
}

/**
 * **只接受 schema 1.1**（plan 8d2b4f60 D2，codex finding 4）：1.0 的语义是 invoke 绑定，
 * 结构里没有 `read_at_invoke`，继承它等于把旧语义偷渡进材料绑定。1.0 与任何其它版本一律
 * 返回 null（等价"无回执"）——消费面走"尚未生成"、生产面从零重算。不靠 `goal_run_id`
 * 作废：同 run resume 时旧回执的 run id 恰好等于当前 run，只有版本判据挡得住。
 */
export function loadSpecRefsReceipt(projectRoot: string, feature: string): SpecRefsReceipt | null {
  const p = specRefsReceiptPath(projectRoot, feature);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as SpecRefsReceipt;
    return parsed?.schema_version === '1.1' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 路径归一（D2，codex finding 3）：本仓无导出的通用 pathsEqual（native-trace-binding 的
 * samePath 与 device-session 的 normalizeExe 都是模块私有），为一处比较不新建共享工具。
 * win32 额外 toLowerCase——NTFS 默认不区分大小写；Linux 保持严格等值。
 */
function normalizeRefPath(p: string): string {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/**
 * runner 从纯净结构化事件审计 spec 期参考图验读并签发回执（**材料寻址，不绑 invoke**）。
 * 无解析器 adapter → produced:false（结构性不可签 vl_multimodal，诚实降级——
 * 20260718 事故的 cursor 自签正是本回执要堵的洞）。
 *
 * 匹配语义（D2）：Read 事件 file_path 与 ref 的**规范化完整路径等值**。basename 兜底已删除
 * ——"读了 tmp/1-home.png、签了 ux-reference/1-home.png 的哈希"曾因此成立。
 *
 * 合并生产（D2）：盘上已有 1.1 回执且 run/adapter 均等于本次时，旧 entry 的 read 只在
 * **内容未变**（hash 相同）时继承；图换了就作废重来。产出总是覆盖写（不再先删后签）。
 */
export function produceSpecRefsReceipt(input: {
  projectRoot: string;
  feature: string;
  adapter: string;
  goalRunId: string;
  invokeId: string;
  eventsLogAbsPath: string;
  refAbsPaths: string[];
}): { produced: boolean; unread?: string[]; carriedOver?: string[]; reason?: string } {
  const parser = IMAGE_READ_PARSERS[input.adapter];
  if (!parser) {
    return { produced: false, reason: `adapter=${input.adapter} 无注册的结构化事件解析器——vl_multimodal 结构性不可签` };
  }
  if (!fs.existsSync(input.eventsLogAbsPath)) {
    return { produced: false, reason: 'agent-events.jsonl 不存在（structured_events 分流未产出）' };
  }
  const readPaths = parser(fs.readFileSync(input.eventsLogAbsPath, 'utf-8'));
  const readSet = new Set(readPaths.map(p => normalizeRefPath(path.resolve(input.projectRoot, p))));

  const prior = loadSpecRefsReceipt(input.projectRoot, input.feature);
  const inheritable = prior && prior.goal_run_id === input.goalRunId && prior.adapter === input.adapter
    ? new Map(prior.refs.map(r => [normalizeRefPath(r.path), r]))
    : new Map<string, SpecRefsReceipt['refs'][number]>();

  const refs: SpecRefsReceipt['refs'] = [];
  const unread: string[] = [];
  const carriedOver: string[] = [];
  for (const refAbs of input.refAbsPaths) {
    const abs = path.resolve(refAbs);
    let hash: string | null = null;
    try {
      hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    } catch {
      hash = null;
    }
    const readNow = readSet.has(normalizeRefPath(abs));
    const old = inheritable.get(normalizeRefPath(abs));
    // 旧记录只在内容未变时继承；hash 为 null（图不可读）不构成"未变"。
    const inherited = !readNow && old?.read === true && hash !== null && old.hash === hash;
    const read = readNow || inherited;
    // `read_at_invoke`=**当前所依据的那一次** Read 的 invoke（本轮读到即本轮；纯继承才沿用旧值）。
    // 取"最近一次"而非"首次"：D4 的 carried_over 定义是"本轮未读、沿用先前记录"，
    // 记首次会把"本轮确实重读过"的图误报为沿用。
    const readAtInvoke = readNow ? input.invokeId : old?.read_at_invoke;
    if (inherited) carriedOver.push(path.basename(abs));
    refs.push({ path: abs, hash, read, ...(read && readAtInvoke ? { read_at_invoke: readAtInvoke } : {}) });
    if (!read) unread.push(abs);
  }
  const receipt: SpecRefsReceipt = {
    schema_version: '1.1',
    adapter: input.adapter,
    goal_run_id: input.goalRunId,
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
  return { produced: true, unread, carriedOver };
}

// ===========================================================================
// vl_multimodal 终签链统一验证器（plan 8d2b4f60 D1/D2/D7 重写）
// ---------------------------------------------------------------------------
// 证据层从 invoke 级退到「run 级能力实测 + 材料寻址的读取记录」：
//   ① 执行形态可达：goal run/attempt 身份在场、run-control owner 非 session（attended
//     不产逐图审计）、adapter 有注册的结构化事件解析器；
//   ② 能力实测：resolveEffectiveVisionContext 的 axis 必须 scope='run_probed' **且来源为
//     probe**（evidence.canary_probed_at 在场——image_input_override 分支不写它，用户自我
//     声明不构成实测）且 verdict ∈ {tool_read, native}；
//   ③ refs 回执在场（schema 1.1）、run 与 adapter 匹配、unread 为空；
//   ④ refs 内容核对：重算当前 spec 的 authoritative refs（冻结 manifest 驱动、fail-closed），
//     逐张要求回执含 read=true + hash 与当前文件一致；当前无 authoritative refs → 不可签。
// 已删除（D1/D2）：capability receipt 全链、invoke_id 精确等值、events.jsonl 事件锚 +
// receipt_sha256 比对——顺序信任防伪不再是本框架的优先级（总原则「协作可恢复」）。
// 每条失败带一个四态标签，消费面按最严重的一类选词（D7）。
// 消费方：check-spec verified 铸造与 ui_spec_fidelity_gate 终签。
// ===========================================================================

/** D7 四态：结构性不可达 > 未实测 > 尚未生成 > 验证不通过（严重度递减）。 */
export type VlSigningFailureKind = 'unreachable' | 'not_probed' | 'not_yet' | 'mismatch';

const VL_FAILURE_KIND_ORDER: readonly VlSigningFailureKind[] = [
  'unreachable', 'not_probed', 'not_yet', 'mismatch',
];

/** 取最严重的一类（gate 据此选词）；空数组 → null。 */
export function severestVlFailureKind(kinds: readonly VlSigningFailureKind[]): VlSigningFailureKind | null {
  for (const k of VL_FAILURE_KIND_ORDER) if (kinds.includes(k)) return k;
  return null;
}

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
  /** 与 failures 等长的四态标签；消费面取 severestVlFailureKind 选词（D7） */
  failureKinds: VlSigningFailureKind[];
  refsReceipt: SpecRefsReceipt | null;
  /** 当前 authoritative refs（abs path + sha256）——verified attestation 绑定字段源 */
  currentRefs: Array<{ path: string; sha256: string }>;
  /** 本轮未观察到 Read、沿用本 run 先前 invocation 记录的图（展示用 basename，D4 诚实标注） */
  carriedRefs: string[];
  /** 采信的能力档 verdict（仅链成立时非 null，供 D4 披露；来源恒为 probe 金丝雀） */
  capabilityVerdict: string | null;
  runId: string | null;
  expectedInvoke: string | null;
}

/**
 * D7：attended 的唯一可靠机内信号=run-control `owner.kind==='session'`（env 在两种模式下
 * 同样注入，区分不了）。读不到/字段非法一律按 detached 处理——诊断分类失败不得改变终签结论。
 */
function isAttendedRun(projectRoot: string, feature: string, runId: string): boolean {
  try {
    const control = readRunControl(
      path.join(featureDir(projectRoot, feature), 'goal-runs', runId), runId);
    return control?.owner?.kind === 'session';
  } catch {
    return false;
  }
}

export function verifyVlSigningChain(args: {
  projectRoot: string;
  feature: string;
}): VlSigningChainResult {
  const failures: string[] = [];
  const failureKinds: VlSigningFailureKind[] = [];
  const push = (kind: VlSigningFailureKind, msg: string): void => {
    failures.push(msg);
    failureKinds.push(kind);
  };
  const runId = (process.env.MAISON_GOAL_RUN_ID ?? '').trim() || null;
  const attempt = (process.env.MAISON_GOAL_ATTEMPT ?? '').trim() || null;
  const expectedInvoke = attempt ? `spec-${attempt}` : null;
  const fail = (kind: VlSigningFailureKind, msg: string): VlSigningChainResult => ({
    ok: false,
    failures: [...failures, msg],
    failureKinds: [...failureKinds, kind],
    refsReceipt: null,
    currentRefs: [],
    carriedRefs: [],
    capabilityVerdict: null,
    runId,
    expectedInvoke,
  });
  if (!runId || !expectedInvoke) {
    return fail('unreachable', '无 goal run/attempt 身份（vl_multimodal 终签链仅 runner 编排链路可成立；其他场景保持 unverified，不得以人签替代）');
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
  if (!runAdapter) return fail('unreachable', '运行 adapter 身份不可得（manifest/config 均无）——链不可校验');

  // ① 执行形态可达性（D5/D7）：attended 不产本 invoke 的工具事件、adapter 无解析器即无逐图审计。
  if (isAttendedRun(args.projectRoot, args.feature, runId)) {
    return fail('unreachable', 'attended 执行形态无本次 invocation 的逐图 Read 审计（run-control owner.kind=session，runner 不审计遗留日志）——vl_multimodal 结构性不可达');
  }
  if (!hasImageReadParser(runAdapter)) {
    return fail('unreachable', `adapter=${runAdapter} 无注册的结构化事件解析器（tool_event_provenance != structured_events）——逐图 Read 审计不可得，vl_multimodal 结构性不可达`);
  }

  // ② 能力实测（D1，codex finding 1）：scope='run_probed' 不等于实测——image_input_override
  // 分支同样返回 run_probed 却不写 evidence.canary_probed_at（它是 canary 分支独有的字段），
  // 用户自我声明不得充当终签证据。文案不出现"实测"二字。
  const axis = resolveEffectiveVisionContext({
    projectRoot: args.projectRoot,
    feature: args.feature,
    runId,
    adapter: runAdapter,
    ...(process.env.MAISON_GOAL_MODEL_PIN?.trim()
      ? { modelPin: process.env.MAISON_GOAL_MODEL_PIN.trim() } : {}),
  }).vision_capability;
  const probeSourced = typeof axis.evidence.canary_probed_at === 'string' && !!axis.evidence.canary_probed_at;
  const axisSource = probeSourced
    ? 'probe'
    : axis.scope === 'run_probed' ? 'image_input_override（用户声明）' : 'adapter 声明';
  if (!probeSourced || axis.scope !== 'run_probed' || (axis.verdict !== 'tool_read' && axis.verdict !== 'native')) {
    return fail(
      'not_probed',
      `本 run 无 probe 产生的视觉能力金丝雀（scope=${axis.scope}、verdict=${axis.verdict}、source=${axisSource}；${axis.evidence.reason}）——不可终签`,
    );
  }

  // ③ 材料证据（D2）：回执按材料寻址，invoke_id 与事件锚已删除。
  const refsReceipt = loadSpecRefsReceipt(args.projectRoot, args.feature);
  if (!refsReceipt) {
    return fail('not_yet', '本轮参考图验读回执尚未生成（vision/spec-refs-receipt.json 缺失或非 schema 1.1）——回执由 runner 在 invoke 结束后签发');
  }
  if (refsReceipt.goal_run_id !== runId) push('mismatch', `refs 回执属旧 run（${refsReceipt.goal_run_id} ≠ ${runId}）`);
  if (refsReceipt.adapter !== runAdapter) push('mismatch', `refs 回执 adapter 失配（${refsReceipt.adapter} ≠ ${runAdapter}）`);
  if (refsReceipt.unread.length > 0) {
    push('mismatch', `参考图验读不完整：${refsReceipt.unread.length} 张无验读工具事件`);
  }

  // ④ refs 内容核对：回执必须覆盖**当前权威期望集合**（路径+hash+read=true）。
  // plan c4e8a1f7 T2：期望分母=runner 的共享发现集合（从当前 run 冻结 manifest 重算：
  // 正文显式图片 ∪ source 直接父目录一层，仅空集回退 ux-reference）——不再从 agent 产出
  // 的 spec.md 自算较小分母（agent/spec 少声明任一发现图片必须失败，禁止自缩分母）。
  // 评审 P1 修复：goal 态（runId 已在 env）manifest 不可读 → **fail-closed**（不回退
  // spec.md——回退即重新允许 spec 自缩分母，且 runId 在场说明必是 goal 编排）。
  let manifestRequirement: string | undefined;
  let manifestSourceFiles: string[] | undefined;
  let manifestUnreadable = false;
  try {
    const manifestPath = path.join(
      featureDir(args.projectRoot, args.feature), 'goal-runs', runId, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      requirement?: string;
      requirement_source_files?: string[];
    };
    manifestRequirement = manifest.requirement;
    manifestSourceFiles = manifest.requirement_source_files;
  } catch {
    manifestUnreadable = true;
  }
  let currentRefPaths: string[] = [];
  if (manifestUnreadable) {
    push('mismatch', 'goal run manifest 不可读——无法重算参考图发现分母且**禁止回退 spec 自算分母**（fail-closed）');
  } else if (typeof manifestRequirement !== 'string' || !manifestRequirement.trim()) {
    push('mismatch', 'goal run manifest 缺少 requirement——无法计算参考图发现分母（fail-closed）');
  } else {
    currentRefPaths = resolveRequirementReferenceImages(
      args.projectRoot,
      args.feature,
      manifestRequirement,
      { requirementSourceFiles: manifestSourceFiles },
    );
  }
  const currentRefs: Array<{ path: string; sha256: string }> = [];
  const carriedRefs: string[] = [];
  if (currentRefPaths.length === 0) {
    push('mismatch', '当前权威参考图发现集为空——vl_multimodal 无验证对象，不可终签（空 refs 回执不构成证明）');
  }
  for (const refAbs of currentRefPaths) {
    const abs = path.resolve(refAbs);
    const hash = sha256FileFull(abs);
    if (!hash) {
      push('mismatch', `参考图不可读/不可 hash（${path.basename(abs)}）——不可终签`);
      continue;
    }
    currentRefs.push({ path: abs, sha256: hash });
    const entry = refsReceipt.refs.find(r => path.resolve(r.path) === abs);
    if (!entry) push('mismatch', `refs 回执未覆盖当前参考图 ${path.basename(abs)}（回执与当前 spec 的 refs 集不一致）`);
    else if (entry.read !== true) push('mismatch', `参考图 ${path.basename(abs)} 无验读事件（read=false）`);
    else if (entry.hash !== hash) push('mismatch', `参考图 ${path.basename(abs)} hash 失配（签发后文件已变/回执伪造）`);
    // D4：读取记录来自本 run 先前 invocation（内容未变才可继承，见 produceSpecRefsReceipt）
    else if (entry.read_at_invoke && entry.read_at_invoke !== expectedInvoke) carriedRefs.push(path.basename(abs));
  }

  return {
    ok: failures.length === 0,
    failures,
    failureKinds,
    refsReceipt,
    currentRefs,
    carriedRefs,
    capabilityVerdict: axis.verdict,
    runId,
    expectedInvoke,
  };
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
