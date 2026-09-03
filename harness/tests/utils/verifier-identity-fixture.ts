// ============================================================================
// verifier-identity-fixture.ts — verifier 证据身份绑定回归的共享夹具
// ============================================================================
// plan a9d4e7c2 T6（承接 e5b8c3f7 T5）。提供三样东西，全部对齐**生产真源**，不手抄格式：
//   · makeVerifierProject / seedPhase：可跑 check-receipt 的最小 full-track 工程；
//   · runVerifierHook：真 spawn SubagentStop hook（agents/claude/templates/hooks/…），
//     payload 形态照 Claude Code 2.1.246 发行二进制内的 zod schema 与发射点构造；
//   · buildInvocationPrompt / buildResultMessage：调用侧短 request JSON 与结论侧终态块，
//     直接调 scripts/utils/verifier-request.ts / verifier-subject.ts 产出，
//     避免"测的是幻想中的格式"。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync, type SpawnSyncReturns } from 'child_process';

import { featureFilePath, featurePhaseReportsDir } from '../../config';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import {
  RESULT_BLOCK_CLOSE,
  RESULT_BLOCK_OPEN,
} from '../../scripts/utils/verifier-subject';
import {
  buildVerifierRequest,
  computePromptSha256,
  renderVerifierRequest,
  verifierRequestFilename,
} from '../../scripts/utils/verifier-request';
import { SUMMARY_SCHEMA_VERSION_CURRENT } from '../../scripts/utils/quality-axes';

/** framework 源仓根（harness 的上一层）——gate 指纹与 hook 模板都锚在这里。 */
export const FRAMEWORK_SOURCE_ROOT = path.resolve(__dirname, '..', '..', '..');
export const HARNESS_ROOT = path.resolve(__dirname, '..', '..');
export const HOOK_PATH = path.join(
  FRAMEWORK_SOURCE_ROOT,
  'agents',
  'claude',
  'templates',
  'hooks',
  'record-verifier-report.mjs',
);

export function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function readJson(abs: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
}

export function writeFile(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

export function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export interface MakeProjectOptions {
  evidenceProfile?: 'balanced';
  /** 覆盖 reports_dir_pattern（路径口径回归用） */
  reportsDirPattern?: string;
  /** 磁盘配置里**不写** reports_dir_pattern（旧实例形态；TS 侧会注入默认值） */
  omitReportsDirPattern?: boolean;
  /** 自定义 features_dir（缺省 doc/features）；receipt/reports 默认形态随之派生 */
  featuresDir?: string;
}

/** 最小 full-track 工程：配置 + workflow 树 + git 基线。 */
export function makeVerifierProject(opts: MakeProjectOptions = {}): { root: string; sha: string } {
  const featuresDir = opts.featuresDir ?? 'doc/features';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-identity-'));
  fs.mkdirSync(path.join(root, 'framework', 'harness', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(FRAMEWORK_SOURCE_ROOT, 'workflows', 'spec-driven.workflow.yaml'),
    path.join(root, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
  );
  writeFile(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'verifier-identity-test',
        project_profile: { name: 'generic' },
        agent_adapter: 'claude',
        architecture: {
          outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['content'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ts',
        },
        paths: {
          features_dir: featuresDir,
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          glossary_seed: 'doc/glossary-seed.txt',
          architecture_md: 'doc/architecture.md',
          docs_committed: false,
          state_file: 'framework/harness/state/.current-phase.json',
          receipt_dir_pattern: `${featuresDir}/<feature>/<phase>`,
          ...(opts.omitReportsDirPattern
            ? {}
            : { reports_dir_pattern: opts.reportsDirPattern ?? `${featuresDir}/<feature>/<phase>/reports` }),
        },
        ...(opts.evidenceProfile ? { evidence_profile: opts.evidenceProfile } : {}),
      },
      null,
      2,
    ),
  );
  writeFile(path.join(root, 'README.md'), '# fixture\n');
  spawnSync('git', ['init', '-q'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root, shell: false });
  spawnSync('git', ['add', '-A'], { cwd: root, shell: false });
  spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root, shell: false });
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8', shell: false });
  return { root, sha: (sha.stdout ?? '').trim() };
}

/**
 * 一律走**生产解析器**，不手拼。夹具自己拼一份路径就等于给测试装了第四份真源——
 * 那样自定义 `reports_dir_pattern` 的回归会两边一起错、一起绿（review P1-4）。
 */
export function reportsDirOf(root: string, feature: string, phase: string): string {
  return featurePhaseReportsDir(root, feature, phase, FRAMEWORK_SOURCE_ROOT);
}

export interface SeedPhaseOptions {
  /** 省略=按生产口径（request 字段）派生 subject；null=**不写** request/subject（能力未启用/旧件形态） */
  subjectId?: string | null;
  closureStatus?: 'open' | 'closed';
  verdict?: 'PASS' | 'FAIL' | 'INCOMPLETE';
  /** ai-prompt.md 正文——subject 直接哈希这份磁盘字节，改内容即换代 */
  promptBody?: string;
  /** 写入 summary 的代际（迁移矩阵回归用；缺省=当代） */
  schemaVersion?: string;
}

/**
 * 写入一个阶段的 harness 产物（summary/trace/context-exploration + ai-prompt + request）。
 * subject 与 request 都由生产函数产出，保证与 runner 同源。
 */
export function seedPhase(
  root: string,
  feature: string,
  phase: string,
  opts: SeedPhaseOptions = {},
): { reportsDir: string; subjectId: string; promptPath: string; requestPath: string } {
  const reportsDir = reportsDirOf(root, feature, phase);
  fs.mkdirSync(reportsDir, { recursive: true });
  const gateFingerprint = computeGateFingerprint(FRAMEWORK_SOURCE_ROOT, phase);
  const promptBody = opts.promptBody ?? `# verify-${phase}\n\n审查 ${feature}/${phase} 的阶段产物。\n`;
  const promptPath = path.join(reportsDir, 'ai-prompt.md');
  const promptRel = path.relative(root, promptPath).replace(/\\/g, '/');
  // 先落 prompt：subject 按**磁盘实际字节**寻址，没有 canonical 投影。
  writeFile(promptPath, promptBody);

  const request =
    opts.subjectId === null
      ? null
      : buildVerifierRequest({
          feature,
          phase,
          prompt_path: promptRel,
          prompt_sha256: computePromptSha256(promptBody),
          gate_fingerprint: gateFingerprint,
          source_commit_sha: null,
          worktree_digest: null,
        });
  // 显式 subjectId 覆盖：构造「summary 现值 ≠ request 声明」这类负例。
  const subjectId = opts.subjectId === undefined ? (request?.subject_id ?? '') : (opts.subjectId ?? '');
  let requestPath = '';
  if (request) {
    requestPath = path.join(reportsDir, verifierRequestFilename(request.subject_id));
    writeFile(requestPath, renderVerifierRequest(request));
  }

  const summary: Record<string, unknown> = {
    schema_version: opts.schemaVersion ?? SUMMARY_SCHEMA_VERSION_CURRENT,
    phase,
    feature,
    verdict: opts.verdict ?? 'PASS',
    blocker_count: 0,
    fail_count: 0,
    warn_count: 0,
    ...(gateFingerprint ? { gate_fingerprint: gateFingerprint } : {}),
    closure_status: opts.closureStatus ?? 'open',
  };
  if (subjectId) {
    summary.verifier_subject_id = subjectId;
    summary.ai_prompt = promptRel;
    if (requestPath) summary.verifier_request = path.relative(root, requestPath).replace(/\\/g, '/');
  }
  writeFile(path.join(reportsDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFile(
    path.join(reportsDir, 'trace.json'),
    JSON.stringify({ schema_version: '1.0.0', feature, phase }),
  );
  // 一律走生产 feature 路径解析（自定义 features_dir / CU 物理目录），不手拼 doc/features
  writeFile(featureFilePath(root, feature, path.join(phase, 'context-exploration.md')), '# context exploration\n');

  return { reportsDir, subjectId, promptPath, requestPath };
}

/**
 * 调用侧 Task prompt = 那份 request JSON **整段**（生产纪律）。
 * 大文件（真实 ai-prompt.md 可达上百 KB）不过传输面——verifier 自读 prompt_path。
 */
export function buildInvocationPrompt(requestPath: string): string {
  return fs.readFileSync(requestPath, 'utf-8');
}

/** verifier 终态块（唯一版本化结论出口）。 */
export function buildResultMessage(
  subjectId: string,
  verdict: 'PASS' | 'FAIL',
  blockerCount = verdict === 'PASS' ? 0 : 1,
  prose = 'Semantic review complete.',
): string {
  return [
    prose,
    '',
    RESULT_BLOCK_OPEN,
    `verifier_subject_id: ${subjectId}`,
    `verdict: ${verdict}`,
    `blocker_count: ${blockerCount}`,
    RESULT_BLOCK_CLOSE,
    '',
  ].join('\n');
}

/** 子代理转录（jsonl）：首条 user prompt = 调用方实际投递的 Task prompt。 */
export function writeAgentTranscript(root: string, name: string, promptText: string): string {
  const abs = path.join(root, 'transcripts', `${name}.jsonl`);
  writeFile(
    abs,
    [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: promptText }] } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'working…' } }),
      '',
    ].join('\n'),
  );
  return abs;
}

export interface HookOutcome {
  status: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr 合并（诊断输出走 stderr，断言一律看这里）。 */
  output: string;
}

/**
 * 真 spawn SubagentStop hook。payload 默认字段照 Claude Code 2.1.246 实抓契约：
 * base{session_id, transcript_path, cwd} ∧ {agent_id, agent_transcript_path,
 * agent_type, last_assistant_message}。传 `null` 可显式抹掉某字段做 fail-closed 负例。
 */
export function runVerifierHook(
  projectDir: string,
  payload: Record<string, unknown>,
  extraEnv?: NodeJS.ProcessEnv,
): HookOutcome {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  delete env.MAISON_GOAL_HEADLESS;
  delete env.MAISON_GOAL_RUNNER;
  if (extraEnv) Object.assign(env, extraEnv);
  const full: Record<string, unknown> = {
    session_id: 'sid-main',
    transcript_path: path.join(projectDir, 'transcripts', 'main-session.jsonl'),
    cwd: projectDir,
    hook_event_name: 'SubagentStop',
    stop_hook_active: false,
    agent_type: 'verifier',
    ...payload,
  };
  for (const [k, v] of Object.entries(full)) {
    if (v === null) delete full[k];
  }
  const r: SpawnSyncReturns<string> = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(full),
    env,
    encoding: 'utf-8',
    timeout: 20_000,
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  return {
    status: typeof r.status === 'number' ? r.status : -1,
    stdout,
    stderr,
    output: `${stdout}\n${stderr}`,
  };
}

/** 一次完整的「合法 verifier 结束」：写转录 → 触发 hook。 */
export function runVerifierRound(args: {
  root: string;
  feature: string;
  phase: string;
  requestPath: string;
  subjectId: string;
  verdict?: 'PASS' | 'FAIL';
  blockerCount?: number;
  agentId?: string;
  transcriptName?: string;
  prose?: string;
  payloadOverride?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}): HookOutcome {
  const verdict = args.verdict ?? 'PASS';
  const transcript = writeAgentTranscript(
    args.root,
    args.transcriptName ?? `${args.feature}-${args.phase}`,
    buildInvocationPrompt(args.requestPath),
  );
  return runVerifierHook(
    args.root,
    {
      agent_id: args.agentId ?? `agent-${args.feature}-${args.phase}`,
      agent_transcript_path: transcript,
      last_assistant_message: buildResultMessage(
        args.subjectId,
        verdict,
        args.blockerCount ?? (verdict === 'PASS' ? 0 : 1),
        args.prose ?? 'Semantic review complete.',
      ),
      ...(args.payloadOverride ?? {}),
    },
    args.env,
  );
}

/** 写 .current-phase.json（用于"旧路由锚已废"的构造性证明）。 */
export function writeCurrentPhaseState(root: string, feature: string, phase: string, sessionId = 'sid-old'): string {
  const abs = path.join(root, 'framework', 'harness', 'state', '.current-phase.json');
  writeFile(
    abs,
    JSON.stringify(
      {
        schema_version: '1.1',
        feature,
        phase,
        status: 'running',
        updated_at: '2026-08-29T00:00:00.000Z',
        last_seen_session_id: sessionId,
        last_seen_at: '2026-08-29T00:00:00.000Z',
      },
      null,
      2,
    ) + '\n',
  );
  return abs;
}

export interface LegacyReceiptOptions {
  verdict?: string;
  reportPath?: string;
  invokedVia?: string;
}

/** 与既有回执夹具同形的 legacy 全量回执（verifier 段现为兼容投影）。 */
export function writeLegacyReceipt(
  root: string,
  feature: string,
  phase: string,
  sha: string,
  opts: LegacyReceiptOptions = {},
): string {
  const featureDir = path.join(root, 'doc', 'features', feature, phase);
  const tracePath = path.join(featureDir, 'reports', 'trace.json');
  const receipt = [
    '---',
    `feature: "${feature}"`,
    `phase: "${phase}"`,
    'agent_model: "test-model"',
    'agent_runtime: "test-runtime"',
    'claimed_completion_at: "2026-08-29T10:00:00+08:00"',
    `claimed_completion_commit_sha: "${sha}"`,
    'script_harness:',
    '  exit_code: 0',
    '  blocker_count: 0',
    'verifier_subagent:',
    `  invoked_via: "${opts.invokedVia ?? 'Task(subagent_type=verifier)'}"`,
    `  report_path: "${opts.reportPath ?? `doc/features/${feature}/${phase}/reports/verifier.report.json`}"`,
    `  verdict: "${opts.verdict ?? 'PASS'}"`,
    '',
    'trace_json:',
    `  path: "doc/features/${feature}/${phase}/reports/trace.json"`,
    '  exists: true',
    '  schema_valid: true',
    '',
    'context_exploration:',
    `  summary_path: "doc/features/${feature}/${phase}/context-exploration.md"`,
    '  exists: true',
    '  ready_to_produce: true',
    '  has_blocker_coverage_risk: false',
    'self_check:',
    `  q1_trace_json_abs_path: "${tracePath.replace(/\\/g, '\\\\')}"`,
    '  q2_verifier_verdict_quoted: "PASS"',
    `  q3_last_diff_file: "doc/features/${feature}/${phase}/context-exploration.md"`,
    '  q4_no_hallucinated_rule_used: true',
    '  q4_evidence: "n/a"',
    '---',
    '',
    '## 反假设条款回顾',
    '',
    '- [x] a',
    '- [x] b',
    '- [x] c',
    '',
  ].join('\n');
  const abs = path.join(featureDir, 'phase-completion-receipt.md');
  writeFile(abs, receipt);
  return abs;
}

export interface CheckReceiptOutcome {
  status: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr 合并：check-receipt 的 BLOCKER 清单走 stderr，断言一律看这里。 */
  output: string;
}

/** 真 spawn check-receipt.ts（与生产同一入口，不做函数级桩）。 */
export function runCheckReceipt(root: string, feature: string, phase: string): CheckReceiptOutcome {
  const r = spawnSync(
    'npx',
    [
      'ts-node',
      '--transpile-only',
      path.join(HARNESS_ROOT, 'scripts', 'check-receipt.ts'),
      '--feature',
      feature,
      '--phase',
      phase,
      '--project-root',
      root,
      '--skip-state-sync',
    ],
    { cwd: HARNESS_ROOT, shell: true, encoding: 'utf-8' },
  );
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  return {
    status: typeof r.status === 'number' ? r.status : -1,
    stdout,
    stderr,
    output: `${stdout}\n${stderr}`,
  };
}

/**
 * 真并发触发 N 个 hook 进程（review P0-1）：串行的"先 PASS 再 FAIL"证明不了任何
 * 并发性质——它每次都能读到前一份已落盘的文件。这里用 `spawn` 同时起进程、全部
 * 起完再等，让"读→裁决→写"真正交错。
 */
/**
 * 异步单发 hook（不等待即返回 Promise），供**精确交错**构造：先起一个带 CAS 延时的
 * hook，趁它挂起时改变世界（换代 subject / 发布新证据），再等它恢复。
 */
export function spawnVerifierRound(args: {
  root: string;
  feature: string;
  phase: string;
  requestPath: string;
  subjectId: string;
  verdict?: 'PASS' | 'FAIL';
  agentId: string;
  transcriptName: string;
  casDelayMs?: number;
}): Promise<HookOutcome> {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: args.root };
  delete env.MAISON_GOAL_HEADLESS;
  delete env.MAISON_GOAL_RUNNER;
  if (args.casDelayMs) env.MAISON_VERIFIER_HOOK_TEST_CAS_DELAY_MS = String(args.casDelayMs);

  const transcript = writeAgentTranscript(args.root, args.transcriptName, buildInvocationPrompt(args.requestPath));
  const verdict = args.verdict ?? 'PASS';
  const payload = {
    session_id: 'sid-main',
    transcript_path: path.join(args.root, 'transcripts', 'main-session.jsonl'),
    cwd: args.root,
    hook_event_name: 'SubagentStop',
    stop_hook_active: false,
    agent_type: 'verifier',
    agent_id: args.agentId,
    agent_transcript_path: transcript,
    last_assistant_message: buildResultMessage(args.subjectId, verdict),
  };
  const child = spawn('node', [HOOK_PATH], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf-8')));
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf-8')));
  const done = new Promise<HookOutcome>((resolve) => {
    child.on('close', (code) => resolve({ status: code ?? -1, stdout, stderr, output: `${stdout}\n${stderr}` }));
  });
  child.stdin.end(JSON.stringify(payload));
  return done;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runVerifierRoundsConcurrently(
  root: string,
  feature: string,
  phase: string,
  requestPath: string,
  subjectId: string,
  rounds: Array<{ agentId: string; verdict: 'PASS' | 'FAIL'; blockerCount?: number }>,
): Promise<HookOutcome[]> {
  const prompt = buildInvocationPrompt(requestPath);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: root,
    // 打开 hook 的 CAS 测试缝：没有它，两个 node 进程的启动开销就足以把"读→写"串行化，
    // 后起的那个总能读到前一个已落盘的文件，于是并发回归退化成串行假绿
    // （实测：去掉独占创建的退化版本在无延时下同样"通过"）。
    MAISON_VERIFIER_HOOK_TEST_CAS_DELAY_MS: '400',
  };
  delete env.MAISON_GOAL_HEADLESS;
  delete env.MAISON_GOAL_RUNNER;

  const launched = rounds.map((r, i) => {
    const transcript = writeAgentTranscript(root, `conc-${feature}-${phase}-${i}`, prompt);
    const payload = {
      session_id: 'sid-main',
      transcript_path: path.join(root, 'transcripts', 'main-session.jsonl'),
      cwd: root,
      hook_event_name: 'SubagentStop',
      stop_hook_active: false,
      agent_type: 'verifier',
      agent_id: r.agentId,
      agent_transcript_path: transcript,
      last_assistant_message: buildResultMessage(
        subjectId,
        r.verdict,
        r.blockerCount ?? (r.verdict === 'PASS' ? 0 : 1),
      ),
    };
    const child = spawn('node', [HOOK_PATH], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf-8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf-8')));
    const done = new Promise<HookOutcome>((resolve) => {
      child.on('close', (code) => resolve({ status: code ?? -1, stdout, stderr, output: `${stdout}\n${stderr}` }));
    });
    child.stdin.end(JSON.stringify(payload));
    return done;
  });

  return Promise.all(launched);
}
