#!/usr/bin/env node
// ============================================================================
// SubagentStop hook：把 verifier 子 agent 的执行轨迹落地为可审计报告
// ============================================================================
// 触发时机：Claude Code CLI 在某个子 agent 即将结束时触发 SubagentStop 事件。
// 在 .claude/settings.json 中本 hook 通过 matcher="verifier" 仅响应
// `subagent_type=verifier` 的子 agent。
//
// 协议（Claude Code Hooks 官方约定）：
//   - 输入：stdin 收到 JSON，含 session_id / transcript_path / cwd /
//     hook_event_name / stop_hook_active 等。
//   - 输出：本 hook 不阻断（exit 0）；只做"旁观记录"，把 verifier 子 agent
//     的转录摘要写到（默认与 paths.reports_dir_pattern 对齐，未配置时为 framework/harness/reports/...）：
//       doc/features/<feature>/<phase>/reports/verifier.report.md （推荐）
//     供 check-receipt.ts 在 verifier_subagent.report_path 字段中引用。
//
// 落地内容：
//   - verdict: 从转录中正则提取（"verdict: PASS|FAIL" 或末段加粗）
//   - transcript_path: 原始 jsonl 路径（保留以便审计回放）
//   - last_assistant_text: 子 agent 最后一条 assistant 消息的纯文本截取
//   - generated_at: ISO 时间戳
//
// feature / phase 的来源：
//   读取 framework/harness/state/.current-phase.json（由 harness-runner.ts 维护）。
//   若状态文件不存在或 phase/feature 不可用 → 把报告写到
//   framework/harness/state/last-verifier-report.{md,json} 兜底，绝不丢数据。
//
// 跨平台：纯 Node.js + path/url，不依赖 shell。
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
// 2. 项目根 / state 解析
// --------------------------------------------------------------------------

function resolveProjectRoot(payload) {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  if (payload && typeof payload.cwd === 'string' && payload.cwd.trim()) {
    return path.resolve(payload.cwd.trim());
  }
  return process.cwd();
}

function readJSONSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function readStateFileRelFromConfig(projectRoot) {
  try {
    const cfgPath = path.resolve(projectRoot, 'framework.config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const rel = cfg?.paths?.state_file;
    if (typeof rel === 'string' && rel.trim()) return rel.trim();
    return null;
  } catch {
    return null;
  }
}

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
    return path.resolve(projectRoot, 'framework/harness/reports', feature, phase);
  } catch {
    return path.resolve(projectRoot, 'framework/harness/reports', feature, phase);
  }
}

// --------------------------------------------------------------------------
// 3. transcript 解析
// --------------------------------------------------------------------------

function readTranscriptJsonl(transcriptPath) {
  // transcript_path 是 jsonl：每行一个 JSON 事件（user / assistant / tool 等）
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return { lastAssistantText: '', allText: '', error: 'transcript-not-found' };
  }
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf-8');
  } catch (err) {
    return { lastAssistantText: '', allText: '', error: `read-failed: ${err?.message ?? err}` };
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  let lastAssistantText = '';
  const allTexts = [];

  for (const line of lines) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    // Claude Code transcript 常见结构：role/content；content 可能是字符串或 [{type:"text", text:"..."}]
    const role = evt?.role ?? evt?.message?.role;
    if (role !== 'assistant') continue;
    const content = evt?.content ?? evt?.message?.content;
    const text = extractTextFromContent(content);
    if (text) {
      lastAssistantText = text;
      allTexts.push(text);
    }
  }

  return { lastAssistantText, allText: allTexts.join('\n\n---\n\n'), error: null };
}

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
    if (typeof item === 'string') {
      parts.push(item);
    } else if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text);
    }
  }
  return parts.join('\n');
}

// --------------------------------------------------------------------------
// 4. verdict 提取
// --------------------------------------------------------------------------

function extractVerdict(text) {
  if (!text) return null;
  // 支持："verdict: PASS"、"**Verdict: FAIL**"、"## Verdict\nPASS" 等
  const patterns = [
    /verdict\s*[:=：]\s*\**\s*(PASS|FAIL)\b/i,
    /\*\*\s*verdict\s*[:：]\s*(PASS|FAIL)\s*\**/i,
    /^##\s*verdict[\s\S]{0,40}?\b(PASS|FAIL)\b/im,
    /\b(PASS|FAIL)\s*\(verdict\)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

// --------------------------------------------------------------------------
// 5. 落盘
// --------------------------------------------------------------------------

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function writeFileAtomic(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf-8');
}

function buildMarkdownReport({ feature, phase, transcriptPath, verdict, lastText, payload }) {
  const ts = new Date().toISOString();
  const truncatedLast = (lastText ?? '').slice(0, 8000);
  return [
    '# Verifier 子 agent 报告',
    '',
    `- feature: ${feature ?? 'unknown'}`,
    `- phase: ${phase ?? 'unknown'}`,
    `- verdict: ${verdict ?? 'UNKNOWN'}`,
    `- generated_at: ${ts}`,
    `- session_id: ${payload?.session_id ?? '(n/a)'}`,
    `- transcript_path: ${transcriptPath ?? '(n/a)'}`,
    '',
    '## 子 agent 最后一条 assistant 消息（截至 8000 字符）',
    '',
    '```',
    truncatedLast,
    '```',
    '',
    '> 完整转录见 transcript_path 原始文件（jsonl）。',
    '> 本报告由 .claude/hooks/record-verifier-report.mjs 自动生成；',
    '> 任何手工编辑都不会被 check-receipt.ts 信任——以本 hook 输出为准。',
    '',
  ].join('\n');
}

// --------------------------------------------------------------------------
// 6. 主流程
// --------------------------------------------------------------------------

async function main() {
  const payload = await readStdin();

  if (payload && payload.stop_hook_active === true) {
    process.exit(0);
    return;
  }

  const projectRoot = resolveProjectRoot(payload);
  const stateRel =
    readStateFileRelFromConfig(projectRoot) ?? 'framework/harness/state/.current-phase.json';
  const stateAbs = path.resolve(projectRoot, stateRel);
  const state = readJSONSafe(stateAbs);

  const transcriptPath = payload?.transcript_path
    ? path.resolve(payload.transcript_path)
    : null;
  const { lastAssistantText, error } = readTranscriptJsonl(transcriptPath);
  const verdict = extractVerdict(lastAssistantText);

  const feature = state?.feature ?? 'unknown';
  const phase = state?.phase ?? 'unknown';

  const resolved =
    state && state.feature && state.phase
      ? resolveFeaturePhaseReportDir(projectRoot, String(state.feature), String(state.phase))
      : null;
  const reportDir =
    resolved ?? path.resolve(projectRoot, 'framework/harness/state');

  const mdPath =
    state && state.feature && state.phase
      ? path.join(reportDir, 'verifier.report.md')
      : path.join(reportDir, 'last-verifier-report.md');
  const jsonPath =
    state && state.feature && state.phase
      ? path.join(reportDir, 'verifier.report.json')
      : path.join(reportDir, 'last-verifier-report.json');

  try {
    writeFileAtomic(
      mdPath,
      buildMarkdownReport({
        feature,
        phase,
        transcriptPath,
        verdict,
        lastText: lastAssistantText,
        payload,
      }),
    );
    writeFileAtomic(
      jsonPath,
      JSON.stringify(
        {
          schema_version: '1.0',
          feature,
          phase,
          verdict,
          transcript_path: transcriptPath,
          generated_at: new Date().toISOString(),
          session_id: payload?.session_id ?? null,
          read_error: error ?? null,
        },
        null,
        2,
      ) + '\n',
    );
  } catch (err) {
    process.stderr.write(
      `[record-verifier-report hook] write failed: ${err?.message ?? err}\n`,
    );
  }

  // 同步把 receipt 暗示信息回写 state.receipt（不覆盖 harness-runner 的 receipt 状态——
  // 那是 check-receipt.ts 的职责；这里只追加 verifier 维度信息供 Stop hook 参考）
  //
  // v2.8 起：last_verifier_report 也带上 recorded_in_session，并刷新
  // last_seen_session_id / last_seen_at——保持 state 的 session 维度新鲜度
  // 与 check-phase-completion.mjs 一致，避免 Stop hook 把刚跑过 verifier 的
  // 状态当成"陈旧"处理。
  try {
    if (state && state.feature && state.phase) {
      const nowIso = new Date().toISOString();
      const sid =
        typeof payload?.session_id === 'string' && payload.session_id.trim()
          ? payload.session_id.trim()
          : null;
      state.last_verifier_report = {
        verdict,
        report_path: path.relative(projectRoot, mdPath).replace(/\\/g, '/'),
        recorded_at: nowIso,
        recorded_in_session: sid,
      };
      if (sid) {
        state.last_seen_session_id = sid;
        state.last_seen_at = nowIso;
      }
      ensureDir(path.dirname(stateAbs));
      fs.writeFileSync(stateAbs, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    }
  } catch {
    // best-effort
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    `[record-verifier-report hook] internal error: ${err?.message ?? err}\n`,
  );
  process.exit(0);
});
