#!/usr/bin/env node
// ============================================================================
// SubagentStop hook：把 verifier 子 agent 的结论发布为**身份绑定**的机器真源
// ============================================================================
// 触发时机：Claude-kernel CLI（claude / codeagent）在子 agent 结束前触发 SubagentStop。
// settings.json 以 matcher="verifier" 只响应 subagent_type=verifier。
//
// ─── 本 hook 解决的缺陷（plan e5b8c3f7，宿主 bc-openCard-1 实锤）────────────────
// 旧实现在**触发时刻**读共享状态文件 .current-phase.json 推断报告归属，并从主会话
// transcript 正则找第一个 `verdict: PASS`。并发 verifier 交错结束时必然错位：
//   · 闭环后错写 → 报告在 evidence manifest 保护面内 → 证据链 stale → 无辜阶段级联重跑；
//   · 闭环前错写 → manifest 忠实封存错误证据 → **假闭环**（check-receipt 当时只查手填
//     verdict 与文件存在性）。
// 收口靠身份，不靠互斥：并发 verifier 是被支持的正常形态。
//
// ─── 发布契约（三重等值绑定，transcript 只读一次）──────────────────────────────
//   invocation_subject（agent_transcript_path 首条 user prompt 的机器块）
//     == result_subject（last_assistant_message 终态块）
//     == summary.verifier_subject_id（runner 单点生成的现值）
// 三者相等才发布 verifier.report.json（唯一机器真源）；任一缺失/不等 → bedside
// fail-closed。两个 subject **分别**存入 JSON——此后一切验真只比仓内三值，
// **绝不重开 transcript**（会话清理/换机/归档后仓内证据必须自足）；
// agent_transcript_path 只作审计元数据。
//
// ─── 硬性边界 ────────────────────────────────────────────────────────────────
//   · 完全不写 .current-phase.json（last_verifier_report / last_seen_* 写回已整体删除，
//     且不得恢复——Stop 新鲜度实际只读 session_id + updated_at，见
//     check-phase-completion.mjs）。
//   · 写入路径由 framework config + 机器块的 feature/phase **自行推导**；机器块里的
//     claimed report_path 仅作等值核对，越界（../ / 绝对路径 / 跨 feature）一律拒绝。
//   · 证据文件**按 subject 分区**：`verifier.report.<64位subject>.json`（+ 同名 .md）。
//     不同 subject 天然写不同文件，谁也没有能力移动/删除/覆盖另一个 subject 的文件。
//     这才是竞态的根治：授权复查（"我还有权限吗"）与"改共享文件"永远是两步，两步之间就能
//     换代——把复查放得再晚也只是挪动窗口（review 四轮 P0）。分区之后窗口不存在，于是
//     跨 subject 的让位/替换、superseded 文件、循环内反复授权判断全部删除；
//     旧 subject 的遗留文件留在原地不清理（自动清理会重新引入并发删除）。
//     `summary.verifier_subject_id` 单独决定"当前机器证据是哪一个文件"。
//   · verifier.report.md 只是从 JSON 生成的人读投影，机器侧不解析。
//
// ─── 字段契约（实抓，非文档）────────────────────────────────────────────────
// Claude Code 2.1.246 发行二进制内的 zod schema 与发射点（plan 附录 A）：
//   SubagentStop = base ∧ { stop_hook_active, agent_id, agent_transcript_path,
//                           agent_type, last_assistant_message?, ... }
//   base = { session_id, transcript_path, cwd, prompt_id?, permission_mode?, ... }
//   发射点：agent_transcript_path=子代理转录、transcript_path=主会话、
//           agent_type = a ?? ""（可能空串）、last_assistant_message 可缺席。
// codeagent（.cac）共享本文件，payload 已于 2026-08-29 宿主实抓（plan 附录 A）：
//   消费的四个字段全在场且语义同构（transcript_path=主会话、agent_transcript_path=
//   子代理且指向真实文件），另多两个本 hook 不消费的字段 `is_kia_repo` / `process_id`，
//   少一个 claude 侧本就可选的 `prompt_id`。→ 共享绑定成立，无需 adapter-specific 分支。
//   **一处已实证的差异**：codeagent **不按 agent type 过滤 SubagentStop 的 matcher**
//   （注册项一律触发——实抓里 matcher="verifier" 对一个 agent_type="" 的子 agent 同样
//   触发）。这不构成风险：非 verifier 子 agent 的转录首条 prompt 里没有 subject 机器块，
//   一律走下方 invocation_subject_absent → bedside，永远发布不了 canonical。
// 任何 adapter 字段不齐时按下方统一 fail-closed 落 bedside，绝不猜测归属。
//
// 跨平台：纯 Node.js + path/url，不依赖 shell。
// 块格式 SSOT：framework/harness/scripts/utils/verifier-subject.ts
//（本文件是它在 .mjs 侧的复刻；改格式必须两边同步，单测 verifier-evidence-identity 守护）。
// ============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const VERIFIER_REPORT_SCHEMA_VERSION = '2.0';
const SUBJECT_BLOCK_OPEN = '<!-- maison-verifier-subject:v1 -->';
const SUBJECT_BLOCK_CLOSE = '<!-- /maison-verifier-subject:v1 -->';
const RESULT_BLOCK_OPEN = '<!-- maison-verifier-result:v1 -->';
const RESULT_BLOCK_CLOSE = '<!-- /maison-verifier-result:v1 -->';
const SUBJECT_ID_PATTERN = /^[0-9a-f]{64}$/;

// --------------------------------------------------------------------------
// 1. stdin
// --------------------------------------------------------------------------

async function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    if (process.stdin.isTTY) {
      resolve(null);
      return;
    }
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (raw += chunk));
    process.stdin.on('end', () => {
      if (!raw.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    process.stdin.on('error', () => resolve(null));
  });
}

// --------------------------------------------------------------------------
// 2. 项目根解析
// --------------------------------------------------------------------------

// 项目根解析（plan c7a9e2f4 T2：厂商无关加固，三 hook 同款）——
// 候选序：env(claude → codeagent3) → import.meta.url 自锚 → payload.cwd → process.cwd()，
// 取首个含 hooks 真实依赖标记（guard-core / check-receipt 任一）的候选。
// 自锚排在 payload.cwd 前：hook 物理位于 <root>/.claude|.cac/hooks/，比会话 cwd 权威——
// 宿主实证（2026-07-29）payload.cwd 与 process.cwd() 都随会话 cd 漂移。
// 全不中：回落原兜底序（env → payload.cwd → cwd）首个非空值，fail-open 语义不变；
// 自锚不参与盲兜底（源仓/模板目录下自锚指向 agents/<name>，非实例根）。

const PROJECT_ROOT_MARKERS = [
  ['framework', 'agents', 'shared', 'guard-framework-write-core.mjs'],
  ['framework', 'harness', 'scripts', 'check-receipt.ts'],
];

function hasProjectRootMarker(root) {
  try {
    return PROJECT_ROOT_MARKERS.some((parts) => fs.existsSync(path.join(root, ...parts)));
  } catch {
    return false;
  }
}

function normalizeCandidate(value) {
  return typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
}

function resolveProjectRoot(payload) {
  let selfAnchor = null;
  try {
    selfAnchor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  } catch {
    selfAnchor = null;
  }
  const envClaude = normalizeCandidate(process.env.CLAUDE_PROJECT_DIR);
  const envCodeagent = normalizeCandidate(process.env.CODEAGENT3_PROJECT_DIR);
  const payloadCwd = normalizeCandidate(payload && typeof payload.cwd === 'string' ? payload.cwd : null);
  const anchored = [envClaude, envCodeagent, selfAnchor, payloadCwd, process.cwd()].filter(Boolean);
  for (const cand of anchored) {
    if (hasProjectRootMarker(cand)) return cand;
  }
  return envClaude ?? envCodeagent ?? payloadCwd ?? process.cwd();
}

/** 报告来源行自述（plan c7a9e2f4）：按脚本真实物化位置输出 <宿主目录>/hooks/<文件名>——
 * claude 实例=".claude/hooks/record-verifier-report.mjs"，codeagent 实例=".cac/hooks/…"。 */
const SELF_DESCRIPTION = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const hooksDir = path.basename(path.dirname(self));
    const adapterDir = path.basename(path.dirname(path.dirname(self)));
    return `${adapterDir}/${hooksDir}/${path.basename(self)}`;
  } catch {
    return 'record-verifier-report.mjs';
  }
})();

/**
 * 证据文件名按 subject 分区——**必须与 verifier-subject.ts 的同名纯函数逐字符一致**。
 * 只接受合法 64 位 subject：半截/伪造 id 不得凭空造出一个文件名。
 */
function verifierReportJsonFilename(subjectId) {
  return `verifier.report.${subjectId}.json`;
}

function verifierReportMdFilename(subjectId) {
  return `verifier.report.${subjectId}.md`;
}

function readJSONSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * `paths.reports_dir_pattern` 缺席时的默认值——**必须与 TS 侧逐字一致**。
 * TS 的 loadFrameworkConfig 会把 DEFAULT_PATHS 合并进 cfg.paths（config.ts:822），
 * 于是磁盘上没写该字段的旧配置也会拿到 `doc/features/<feature>/<phase>/reports`
 * （既有回归 profile-routing「normalize 注入」钉死）。此处若沿用历史的
 * `framework/harness/reports/...`，runner 与 hook 会写向两个不同目录——
 * 证据发布在 A、验真读 B，等于静默失联。跨实现等价由单测守护。
 */
const DEFAULT_REPORTS_REL = (feature, phase) => `doc/features/${feature}/${phase}/reports`;

/** 对齐 harness/config.featurePhaseReportsDir —— Hook 不落 TS，纯 Node 复刻占位符语义 */
function resolveFeaturePhaseReportDir(projectRoot, feature, phase) {
  if (!feature || !phase || feature === 'unknown' || phase === 'unknown') return null;
  try {
    const cfgPath = path.resolve(projectRoot, 'framework.config.json');
    if (feature === '_global') {
      return path.resolve(projectRoot, 'framework/harness/reports/_global', phase);
    }
    let pattern = null;
    try {
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        const p = cfg?.paths?.reports_dir_pattern;
        if (typeof p === 'string' && p.trim()) pattern = p.trim();
      }
    } catch {
      pattern = null;
    }
    if (pattern) {
      const rel = pattern.replace(/<feature>/g, feature).replace(/<phase>/g, phase);
      return path.resolve(projectRoot, rel);
    }
    return path.resolve(projectRoot, DEFAULT_REPORTS_REL(feature, phase));
  } catch {
    return path.resolve(projectRoot, DEFAULT_REPORTS_REL(feature, phase));
  }
}

// --------------------------------------------------------------------------
// 3. 机器块解析（verifier-subject.ts 的 .mjs 复刻）
// --------------------------------------------------------------------------

function normalizeEol(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

function escapeRe(s) {
  return s.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

function collectBlockBodies(text, open, close) {
  const re = new RegExp(`${escapeRe(open)}([\\s\\S]*?)${escapeRe(close)}`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(normalizeEol(text))) !== null) out.push(m[1]);
  return out;
}

function readBlockField(body, key) {
  const m = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm').exec(body);
  return m ? m[1].trim() : null;
}

/** 恰好一个块才算数：零个=未经机器投递（手抄/旧件），多个=prompt 被拼接污染。 */
function parseSubjectBlock(text) {
  const bodies = collectBlockBodies(text, SUBJECT_BLOCK_OPEN, SUBJECT_BLOCK_CLOSE);
  if (bodies.length !== 1) return null;
  const body = bodies[0];
  const subjectId = readBlockField(body, 'verifier_subject_id');
  const feature = readBlockField(body, 'verifier_subject_feature');
  const phase = readBlockField(body, 'verifier_subject_phase');
  const reportPath = readBlockField(body, 'verifier_subject_report_path');
  if (!subjectId || !SUBJECT_ID_PATTERN.test(subjectId)) return null;
  if (!feature || !phase || !reportPath) return null;
  return { subject_id: subjectId, feature, phase, report_path: reportPath };
}

function parseResultBlock(text) {
  const bodies = collectBlockBodies(text, RESULT_BLOCK_OPEN, RESULT_BLOCK_CLOSE);
  if (bodies.length !== 1) return null;
  const body = bodies[0];
  const subjectId = readBlockField(body, 'verifier_subject_id');
  const verdict = readBlockField(body, 'verdict');
  const blockerRaw = readBlockField(body, 'blocker_count');
  if (!subjectId || !SUBJECT_ID_PATTERN.test(subjectId)) return null;
  if (verdict !== 'PASS' && verdict !== 'FAIL') return null;
  if (blockerRaw === null || !/^\d+$/.test(blockerRaw)) return null;
  return { subject_id: subjectId, verdict, blocker_count: Number(blockerRaw) };
}

function computeResultSha256(verdict, blockerCount, reportText) {
  return sha256(
    [`verdict=${verdict}`, `blocker_count=${blockerCount}`, 'report_text:', normalizeEol(reportText)].join('\n'),
  );
}

// --------------------------------------------------------------------------
// 4. transcript：**只在这里读一次**，且只取首条 user prompt
// --------------------------------------------------------------------------

function extractTextFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    if (typeof content.text === 'string') return content.text;
    return '';
  }
  const parts = [];
  for (const item of content) {
    if (!item) continue;
    if (typeof item === 'string') parts.push(item);
    else if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text);
  }
  return parts.join('\n');
}

/**
 * 子代理转录（jsonl）的**首条** user prompt = 调用方实际投递的 Task prompt。
 * 这是 invocation subject 的唯一来源：它证明的是"谁被调来审什么"（调用身份），
 * 而终态块回显只能证明"自称审了谁"——两者都要，缺一不构成绑定。
 */
function readFirstUserPrompt(transcriptPath) {
  if (!transcriptPath) return { text: null, error: 'agent_transcript_path-empty' };
  if (!fs.existsSync(transcriptPath)) return { text: null, error: 'agent_transcript-not-found' };
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf-8');
  } catch (err) {
    return { text: null, error: `agent_transcript-read-failed: ${err?.message ?? err}` };
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    const role = evt?.role ?? evt?.message?.role;
    if (role !== 'user') continue;
    const text = extractTextFromContent(evt?.content ?? evt?.message?.content);
    if (text && text.trim()) return { text, error: null };
  }
  return { text: null, error: 'agent_transcript-no-user-prompt' };
}

// --------------------------------------------------------------------------
// 5. 路径推导与越界拒绝
// --------------------------------------------------------------------------

function toPosixRel(projectRoot, abs) {
  return path.relative(projectRoot, abs).replace(/\\/g, '/');
}

/**
 * claimed path 只做等值核对，**绝不**作写入目标。先拒绝形态越界（绝对路径 / .. /
 * 盘符 / 反斜杠混写），再要求与自行推导的 canonical 路径逐字符相等——
 * 跨 feature 与目录穿越都在这一步落地。
 */
function claimedPathMatches(claimed, canonicalRel) {
  if (typeof claimed !== 'string' || !claimed.trim()) return false;
  const norm = claimed.trim().replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return false;
  if (norm.split('/').some((seg) => seg === '..')) return false;
  return norm === canonicalRel;
}

// --------------------------------------------------------------------------
// 6. 落盘
// --------------------------------------------------------------------------

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function writeFileAtomic(p, content) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, p);
}

/**
 * **仅当不存在时创建**，且目标一旦出现即是完整内容。
 *
 * 为什么必须是它而不是 tmp+rename：原子替换只保证"文件不写半截"，**不保证**
 * 「读→判断→写」这一整段原子。两个并发 verifier 都读到"文件不存在"，就会双双写
 * `published`，后写者覆盖前写者——PASS 吞掉 FAIL，正是本 plan 要根治的形态。
 * link() 把"存在性检查 + 落地"合成一次原子操作：抢输的一方拿到 EEXIST，回到 CAS
 * 循环重新读、重新裁决，于是必然看见对方的结论并升级为 conflict。
 *
 * 硬链接在少数文件系统（FAT / 部分网络盘）上不可用，退回 `wx` 独占创建——
 * 独占语义相同，只是内容落地不再瞬时（读者侧对半截 JSON 已按 fail-closed 处理）。
 */
function createExclusive(absPath, content) {
  ensureDir(path.dirname(absPath));
  const tmp = `${absPath}.new-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    try {
      fs.linkSync(tmp, absPath);
      return true;
    } catch (err) {
      if (err && err.code === 'EEXIST') return false;
      fs.writeFileSync(absPath, content, { encoding: 'utf-8', flag: 'wx' });
      return true;
    }
  } catch (err) {
    if (err && err.code === 'EEXIST') return false;
    throw err;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
  }
}

function buildMarkdownProjection(doc) {
  const lines = [
    '# Verifier 子 agent 报告（人读投影）',
    '',
    '> 机器真源是同目录 `verifier.report.json`。**本 MD 不被任何机器消费者解析**——',
    '> 编辑它不会改变任何门禁结论，也不能让不合格的报告通过 check-receipt。',
    '',
    `- state: ${doc.state}`,
    `- feature: ${doc.feature}`,
    `- phase: ${doc.phase}`,
    `- verifier_subject_id: ${doc.subject_id}`,
    `- verdict: ${doc.verdict}`,
    `- blocker_count: ${doc.blocker_count}`,
    `- agent_id: ${doc.agent_id}`,
    `- agent_type: ${doc.agent_type || '(empty)'}`,
    `- generated_at: ${doc.generated_at}`,
  ];
  if (doc.state === 'conflict') {
    lines.push(
      '',
      '## ⚠ CONFLICT — 同一 subject 收到互不相同的 verifier 结论',
      '',
      '同 subject 下出现不同 agent_id 或不同 result hash。两侧都记录在 JSON 的 `conflict.sides`；',
      'check-receipt 对本态**必 FAIL**（绝不保留先到的 PASS 静默吞掉后到的 FAIL）。',
      '',
      '**恢复步骤**（不要"重跑 harness 换代 subject"——本设计下无物质变化时 subject 恒定，',
      '重跑只会回到同一个 conflict）：',
      '  1. 停止或等待同 subject 的**全部** verifier 结束；',
      '  2. 删除这份 conflict 件——它已不是任何一方的结论，留着只会持续 FAIL；',
      '  3. 只启动**一个** verifier，把现有 ai-prompt.md 全文原样投递（subject 不变，正常发布）。',
    );
  }
  return [
    ...lines,
    '',
    '## verifier 结论正文',
    '',
    '```',
    (doc.report_text ?? '').slice(0, 20000),
    '```',
    '',
    `> 本投影由 ${SELF_DESCRIPTION} 从 verifier.report.json 生成。`,
    '',
  ].join('\n');
}

/**
 * bedside fail-closed：一切绑定不成立的形态统一落这里（goal-headless 与身份缺失同语义）。
 * 绝不触碰 canonical JSON，绝不回退 .current-phase.json，绝不丢数据。
 */
function writeBedside(projectRoot, reason, detail) {
  const dir = path.resolve(projectRoot, 'framework/harness/state');
  const doc = {
    schema_version: VERIFIER_REPORT_SCHEMA_VERSION,
    state: 'bedside',
    reason,
    generated_at: new Date().toISOString(),
    ...detail,
  };
  try {
    writeFileAtomic(path.join(dir, 'last-verifier-report.json'), JSON.stringify(doc, null, 2) + '\n');
    writeFileAtomic(
      path.join(dir, 'last-verifier-report.md'),
      [
        '# Verifier 报告（bedside · 非权威）',
        '',
        `- state: bedside`,
        `- reason: ${reason}`,
        `- generated_at: ${doc.generated_at}`,
        `- subject_id: ${detail?.subject_id ?? '(n/a)'}`,
        `- agent_id: ${detail?.agent_id ?? '(n/a)'}`,
        '',
        '本报告**未通过身份绑定**，不构成任何阶段的闭环凭证，机器消费者不会读取它。',
        '常见原因：调用方未原样投递 ai-prompt.md（缺机器块）、verifier 未输出唯一终态块、',
        'subject 已换代（迟到报告）、adapter payload 缺子代理身份字段、goal headless 旁路。',
        '',
        '## 结论正文（截取）',
        '',
        '```',
        (detail?.report_text ?? '').slice(0, 8000),
        '```',
        '',
        `> 由 ${SELF_DESCRIPTION} 生成。`,
        '',
      ].join('\n'),
    );
  } catch (err) {
    process.stderr.write(`[record-verifier-report hook] bedside write failed: ${err?.message ?? err}\n`);
  }
}

// --------------------------------------------------------------------------
// 7. 主流程
// --------------------------------------------------------------------------

async function main() {
  const payload = await readStdin();

  if (payload && payload.stop_hook_active === true) {
    process.exit(0);
    return;
  }

  const projectRoot = resolveProjectRoot(payload);

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const agentId = str(payload?.agent_id);
  // agent_type 可能是空串（claude 发射点是 `a ?? ""`；codeagent 实抓里也出现过 ""）。
  // 只如实记录、不据此 fail-closed——**不是**因为"触发即证明类型"（codeagent 实证：
  // matcher 不按 agent type 过滤，注册项一律触发），而是因为 agent_type 根本不参与绑定：
  // 归属完全由调用侧机器块决定，非 verifier 子 agent 天然没有那个块，会被下面拦掉。
  const agentType = typeof payload?.agent_type === 'string' ? payload.agent_type : '';
  const agentTranscriptPath = str(payload?.agent_transcript_path);
  const lastAssistantMessage =
    typeof payload?.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  const sessionId = str(payload?.session_id);

  const audit = {
    agent_transcript_path: agentTranscriptPath,
    main_transcript_path: str(payload?.transcript_path),
    session_id: sessionId,
    recorded_by: SELF_DESCRIPTION,
  };

  // goal-runner 拉起的无头进程树：非权威 bedside 旁路（携 subject），不入 goal closure。
  // env 名 SSOT：framework/harness/scripts/utils/phase-state.ts → MAISON_GOAL_HEADLESS_ENV
  const goalHeadless = process.env.MAISON_GOAL_HEADLESS === '1';

  const resultBlock = parseResultBlock(lastAssistantMessage);

  if (goalHeadless) {
    writeBedside(projectRoot, 'goal_headless', {
      goal_headless: true,
      subject_id: resultBlock?.subject_id ?? null,
      verdict: resultBlock?.verdict ?? null,
      agent_id: agentId,
      agent_type: agentType,
      report_text: lastAssistantMessage,
      audit,
    });
    process.exit(0);
    return;
  }

  if (!agentId) {
    writeBedside(projectRoot, 'payload_missing_agent_id', { agent_type: agentType, report_text: lastAssistantMessage, audit });
    process.exit(0);
    return;
  }
  if (!agentTranscriptPath) {
    writeBedside(projectRoot, 'payload_missing_agent_transcript_path', { agent_id: agentId, agent_type: agentType, report_text: lastAssistantMessage, audit });
    process.exit(0);
    return;
  }
  if (!lastAssistantMessage.trim()) {
    writeBedside(projectRoot, 'payload_missing_last_assistant_message', { agent_id: agentId, agent_type: agentType, audit });
    process.exit(0);
    return;
  }

  // ① result subject（终态块）——不再全篇正则找第一个 verdict。
  if (!resultBlock) {
    writeBedside(projectRoot, 'result_block_unparseable', {
      agent_id: agentId, agent_type: agentType, report_text: lastAssistantMessage, audit,
    });
    process.exit(0);
    return;
  }

  // ② invocation subject（子代理转录首条 user prompt）——transcript 只在这里读这一次。
  const firstPrompt = readFirstUserPrompt(agentTranscriptPath);
  if (!firstPrompt.text) {
    writeBedside(projectRoot, 'invocation_prompt_unreadable', {
      detail: firstPrompt.error, agent_id: agentId, agent_type: agentType,
      subject_id: resultBlock.subject_id, report_text: lastAssistantMessage, audit,
    });
    process.exit(0);
    return;
  }
  const invocation = parseSubjectBlock(firstPrompt.text);
  if (!invocation) {
    writeBedside(projectRoot, 'invocation_subject_absent', {
      agent_id: agentId, agent_type: agentType, subject_id: resultBlock.subject_id,
      report_text: lastAssistantMessage, audit,
    });
    process.exit(0);
    return;
  }

  if (invocation.subject_id !== resultBlock.subject_id) {
    writeBedside(projectRoot, 'subject_mismatch_invocation_vs_result', {
      invocation_subject: invocation.subject_id, result_subject: resultBlock.subject_id,
      agent_id: agentId, agent_type: agentType, report_text: lastAssistantMessage, audit,
    });
    process.exit(0);
    return;
  }

  // ③ 写入路径**自行推导**（config + 机器块 feature/phase），claimed path 仅等值核对。
  const reportDir = resolveFeaturePhaseReportDir(projectRoot, invocation.feature, invocation.phase);
  if (!reportDir) {
    writeBedside(projectRoot, 'report_dir_unresolvable', {
      feature: invocation.feature, phase: invocation.phase, subject_id: invocation.subject_id,
      agent_id: agentId, agent_type: agentType, report_text: lastAssistantMessage, audit,
    });
    process.exit(0);
    return;
  }
  const jsonPath = path.join(reportDir, verifierReportJsonFilename(invocation.subject_id));
  const mdPath = path.join(reportDir, verifierReportMdFilename(invocation.subject_id));
  const canonicalRel = toPosixRel(projectRoot, jsonPath);
  if (!claimedPathMatches(invocation.report_path, canonicalRel)) {
    writeBedside(projectRoot, 'claimed_path_rejected', {
      claimed_report_path: invocation.report_path, derived_report_path: canonicalRel,
      feature: invocation.feature, phase: invocation.phase, subject_id: invocation.subject_id,
      agent_id: agentId, agent_type: agentType, report_text: lastAssistantMessage, audit,
    });
    process.exit(0);
    return;
  }

  // ④ summary 现值——迟到报告在此被拦（subject 已换代 → stale，禁止覆盖 canonical）。
  const summary = readJSONSafe(path.join(reportDir, 'summary.json'));
  const currentSubject = str(summary?.verifier_subject_id);
  if (!currentSubject) {
    writeBedside(projectRoot, 'summary_subject_absent', {
      feature: invocation.feature, phase: invocation.phase, subject_id: invocation.subject_id,
      agent_id: agentId, agent_type: agentType, report_text: lastAssistantMessage, audit,
    });
    process.exit(0);
    return;
  }
  if (currentSubject !== invocation.subject_id) {
    writeBedside(projectRoot, 'subject_stale', {
      feature: invocation.feature, phase: invocation.phase,
      subject_id: invocation.subject_id, current_summary_subject: currentSubject,
      agent_id: agentId, agent_type: agentType, report_text: lastAssistantMessage, audit,
    });
    process.exit(0);
    return;
  }

  // ⑤ 发布：CAS 循环（幂等 / conflict 单调升级 / 独占创建）。
  //
  // 本段只处理**同一 subject 内**的并发；跨 subject 已由文件分区在结构上隔离。
  // 即便同一 subject，"读旧件→裁决→写"也必须做成 compare-and-set，否则两个 verifier
  // 都读到"无文件"就会双双写 published，后写者覆盖前写者（review 实测：PASS 稳定吞掉
  // FAIL）。两条不变量：
  //   ① 首次发布只能经 createExclusive（原子 create-if-absent）；
  //   ② 一旦进入 conflict 就**单调吸收**，永不回落 published。
  const resultSha = computeResultSha256(resultBlock.verdict, resultBlock.blocker_count, lastAssistantMessage);
  const side = {
    agent_id: agentId,
    agent_type: agentType,
    verdict: resultBlock.verdict,
    blocker_count: resultBlock.blocker_count,
    result_sha256: resultSha,
    observed_at: new Date().toISOString(),
  };
  const freshDoc = {
    schema_version: VERIFIER_REPORT_SCHEMA_VERSION,
    state: 'published',
    feature: invocation.feature,
    phase: invocation.phase,
    subject_id: invocation.subject_id,
    // 两个 subject 分别存——此后验真只比仓内三值，绝不重开 transcript。
    invocation_subject: invocation.subject_id,
    result_subject: resultBlock.subject_id,
    agent_id: agentId,
    agent_type: agentType,
    verdict: resultBlock.verdict,
    blocker_count: resultBlock.blocker_count,
    result_sha256: resultSha,
    report_text: lastAssistantMessage,
    report_md_path: toPosixRel(projectRoot, mdPath),
    generated_at: new Date().toISOString(),
    audit,
  };

  /** 把既有件与本轮结论合并为 conflict 态（保留先到侧作正文，两侧全记）。 */
  const toConflict = (existing) => {
    const priorSides =
      Array.isArray(existing?.conflict?.sides) && existing.conflict.sides.length > 0
        ? existing.conflict.sides
        : [
            {
              agent_id: existing.agent_id,
              agent_type: existing.agent_type,
              verdict: existing.verdict,
              blocker_count: existing.blocker_count,
              result_sha256: existing.result_sha256,
              observed_at: existing.generated_at,
            },
          ];
    const known = new Set(priorSides.map((s) => `${s.agent_id}::${s.result_sha256}`));
    const sides = known.has(`${side.agent_id}::${side.result_sha256}`) ? priorSides : [...priorSides, side];
    return {
      ...existing,
      schema_version: VERIFIER_REPORT_SCHEMA_VERSION,
      state: 'conflict',
      conflict: {
        detected_at: existing?.conflict?.detected_at ?? new Date().toISOString(),
        // 诚实标注：三方及以上并发时，最后一次写入可能覆盖掉另一并发写者刚追加的
        // 侧记录。**state=conflict 本身不会丢**（单调吸收），check-receipt 照 FAIL；
        // 丢失的只是 sides 里的一条取证信息。
        sides_completeness: 'best_effort',
        sides,
      },
    };
  };

  // 测试缝（与 phase-closure-finalizer 的 maybeCrash 同一惯例）：在 CAS 的「读」与
  // 「写」之间人为拉开窗口，让并发回归能**确定性**复现竞态，而不是靠进程调度的运气——
  // 没有它，两个 hook 进程的启动开销就足以把它们串行化，回归会变成假绿。
  // 仅当该环境变量在场时生效，生产路径零成本。
  const casTestDelayMs = Number.parseInt(process.env.MAISON_VERIFIER_HOOK_TEST_CAS_DELAY_MS ?? '', 10);

  // 本循环只处理**同一 subject 内**的并发（幂等 / conflict 单调升级）。跨 subject 的竞态
  // 已由文件分区在结构上消除：本进程只会碰 `verifier.report.<我的 subject>.json`，
  // 既不需要也无权对别的 subject 的文件做任何事。
  let published = null;
  for (let attempt = 0; attempt < 8 && published === null; attempt++) {
    const existing = readJSONSafe(jsonPath);
    if (attempt === 0 && Number.isFinite(casTestDelayMs) && casTestDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, casTestDelayMs));
    }

    if (existing === null) {
      const body = JSON.stringify(freshDoc, null, 2) + '\n';
      let created = false;
      try {
        created = createExclusive(jsonPath, body);
      } catch (err) {
        process.stderr.write(`[record-verifier-report hook] create failed: ${err?.message ?? err}\n`);
        break;
      }
      if (created) published = freshDoc;
      continue; // 抢输 → 重读重裁
    }

    // 文件名已含 subject，所以这里的"自称别的 subject"只可能是内容损坏或人为伪造。
    // **fail-closed，绝不尝试移动或修复**——修复即重新引入"动别人的文件"这一动作。
    if (
      existing.schema_version !== VERIFIER_REPORT_SCHEMA_VERSION ||
      existing.subject_id !== invocation.subject_id
    ) {
      writeBedside(projectRoot, 'canonical_subject_mismatch', {
        feature: invocation.feature,
        phase: invocation.phase,
        subject_id: invocation.subject_id,
        found_subject: existing.subject_id ?? null,
        report_path: toPosixRel(projectRoot, jsonPath),
        agent_id: agentId,
        agent_type: agentType,
        report_text: lastAssistantMessage,
        audit,
      });
      process.exit(0);
      return;
    }

    if (existing.state !== 'conflict' && existing.agent_id === agentId && existing.result_sha256 === resultSha) {
      // 幂等：同 subject + 同 agent_id + 同 result hash。**不重写**——重写会换
      // generated_at、改变字节，让刚封存的 evidence manifest 无谓 stale。
      process.exit(0);
      return;
    }

    const merged = toConflict(existing);
    try {
      writeFileAtomic(jsonPath, JSON.stringify(merged, null, 2) + '\n');
      published = merged;
    } catch (err) {
      process.stderr.write(`[record-verifier-report hook] conflict write failed: ${err?.message ?? err}\n`);
      break;
    }
  }

  if (published === null) {
    // CAS 未能收敛（重试耗尽 / I/O 故障）：绝不猜、绝不覆盖，落 bedside。
    writeBedside(projectRoot, 'publish_cas_exhausted', {
      feature: invocation.feature,
      phase: invocation.phase,
      subject_id: invocation.subject_id,
      agent_id: agentId,
      agent_type: agentType,
      report_text: lastAssistantMessage,
      audit,
    });
    process.exit(0);
    return;
  }

  try {
    writeFileAtomic(mdPath, buildMarkdownProjection(published));
  } catch (err) {
    process.stderr.write(`[record-verifier-report hook] projection write failed: ${err?.message ?? err}\n`);
  }

  // .current-phase.json 写面已整体删除（plan e5b8c3f7 四-6，终审确认不得恢复）：
  // verifier 事实由 canonical JSON 表达；state 由 runner/check-receipt 维护；
  // Stop 新鲜度实际只读 session_id + updated_at（check-phase-completion.mjs）。
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    `[record-verifier-report hook] internal error: ${err?.message ?? err}\n`,
  );
  process.exit(0);
});
