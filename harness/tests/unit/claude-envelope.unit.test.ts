// ============================================================================
// claude-envelope.unit.test.ts — P0-1（plan 7c4f2e9b / visual-capability-truth 3.10）
// stream-json 信封归一：终态 result 白名单 / init model / 判卷双路径 fail-closed
// fixture：harness/tests/fixtures/cc-spec-deadlock/canary-*.ndjson（事故派生样卷）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  collectClaudeImageReadPaths,
  extractClaudeFinalResultText,
  parseClaudeInitModel,
  parseEnvelopeLine,
  planUsesClaudeStreamJson,
} from '../../scripts/utils/claude-envelope';
import { resolveCanaryCacheDecision, CANARY_ANSWER_KEY } from '../../scripts/utils/vision-canary';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FIX = path.resolve(__dirname, '..', 'fixtures', 'cc-spec-deadlock');
const read = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf-8');

/** fixture 答卷键为 canary 固定四色+token；构造与样卷一致的 answerKey 供判卷 */
const FIXTURE_KEY = {
  ...CANARY_ANSWER_KEY,
  geometry_questions: [
    { id: 'TOP_LEFT_COLOR', expected_color: 'red' },
    { id: 'TOP_RIGHT_COLOR', expected_color: 'blue' },
    { id: 'BOTTOM_LEFT_COLOR', expected_color: 'green' },
    { id: 'BOTTOM_RIGHT_COLOR', expected_color: 'yellow' },
  ],
  text_token: 'K7XQ2',
} as typeof CANARY_ANSWER_KEY;

function decide(file: string, structured = true) {
  return resolveCanaryCacheDecision(
    { stdout: read(file), exitCode: 0, structured_stdout: structured },
    FIXTURE_KEY,
  );
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'envelope: valid stream-json 答卷 → 判卷通过（valid）',
    run: () => {
      const d = decide('canary-valid.ndjson');
      if (d.kind !== 'valid') throw new Error(`kind=${d.kind} detail=${(d as { detail?: string }).detail}`);
      if (!d.canonicalAnswer.includes('TEXT_TOKEN=K7XQ2')) throw new Error('canonical 缺 token');
    },
  },
  {
    name: 'envelope: CANNOT_SEE_IMAGE 信封内独立行 → valid + 真盲声明',
    run: () => {
      const d = decide('canary-cannot-see.ndjson');
      if (d.kind !== 'valid') throw new Error(`kind=${d.kind}`);
      if (d.canonicalAnswer !== 'CANNOT_SEE_IMAGE') throw new Error(`canonical=${d.canonicalAnswer}`);
    },
  },
  {
    name: 'envelope: 残卷（无终态 result）→ invalid_answer fail-closed',
    run: () => {
      const d = decide('canary-truncated.ndjson');
      if (d.kind !== 'invalid_answer') throw new Error(`kind=${d.kind}`);
      if (!/structured envelope/.test((d as { detail: string }).detail)) throw new Error('detail 未说明信封归一失败');
    },
  },
  {
    name: 'envelope: 多 result → 末次合法者胜出',
    run: () => {
      const d = decide('canary-multi-result.ndjson');
      if (d.kind !== 'valid') throw new Error(`kind=${d.kind}`);
      if (!d.canonicalAnswer.includes('TOP_LEFT_COLOR=red')) throw new Error('未取末次 result');
    },
  },
  {
    name: 'envelope: 错误 result 含答题键 → 不判卷（invalid_answer）',
    run: () => {
      const d = decide('canary-error-with-keys.ndjson');
      if (d.kind !== 'invalid_answer') throw new Error(`kind=${d.kind}——错误 result 被判卷=白名单失守`);
    },
  },
  {
    name: 'envelope: 非 structured 纯文本旧格式回归不破',
    run: () => {
      const plain = 'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=K7XQ2\n';
      const d = resolveCanaryCacheDecision({ stdout: plain, exitCode: 0 }, FIXTURE_KEY);
      if (d.kind !== 'valid') throw new Error(`kind=${d.kind}`);
    },
  },
  {
    name: 'envelope: structured 标志下纯文本（无信封）→ fail-closed 不误放',
    run: () => {
      const plain = 'TOP_LEFT_COLOR=red\nTEXT_TOKEN=K7XQ2\n';
      const d = resolveCanaryCacheDecision({ stdout: plain, exitCode: 0, structured_stdout: true }, FIXTURE_KEY);
      if (d.kind !== 'invalid_answer') throw new Error(`kind=${d.kind}`);
    },
  },
  {
    name: 'extractClaudeFinalResultText: stderr 插行破坏的信封行被跳过',
    run: () => {
      const raw = read('canary-stderr-interleaved.txt');
      const t = extractClaudeFinalResultText(raw);
      if (t !== null) throw new Error('被拼接破坏的 result 行不应解析成功');
    },
  },
  {
    name: 'parseClaudeInitModel: 事故 MiniMax init 行解析',
    run: () => {
      const m = parseClaudeInitModel(read('minimax-init-event.jsonl'));
      if (m !== 'MiniMax-M2.7') throw new Error(`model=${m}`);
    },
  },
  {
    name: 'parseClaudeInitModel: 无 init/空流 → null 不 throw',
    run: () => {
      if (parseClaudeInitModel('') !== null) throw new Error('空流应 null');
      if (parseClaudeInitModel('not json\n{"type":"assistant"}') !== null) throw new Error('无 init 应 null');
    },
  },
  {
    name: 'collectClaudeImageReadPaths: 共享实现与既有语义一致（tool_use Read 图片）',
    run: () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'refs/a.PNG' } }, { type: 'tool_use', name: 'Read', input: { file_path: 'notes.md' } }] },
      });
      const r = collectClaudeImageReadPaths(line);
      if (r.length !== 1 || r[0] !== 'refs/a.PNG') throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'parseEnvelopeLine: 非 JSON/数组/坏行 → null 不 throw',
    run: () => {
      if (parseEnvelopeLine('npm WARN x') !== null) throw new Error('非 JSON 应 null');
      if (parseEnvelopeLine('[1,2]') !== null) throw new Error('数组应 null');
      if (parseEnvelopeLine('{"a":') !== null) throw new Error('坏 JSON 应 null');
    },
  },
  {
    name: 'planUsesClaudeStreamJson: 与 claudeArgv 注入条件同构',
    run: () => {
      if (!planUsesClaudeStreamJson('claude', 'structured_events')) throw new Error('claude+structured 应 true');
      if (planUsesClaudeStreamJson('claude', 'none')) throw new Error('claude+none 应 false');
      if (planUsesClaudeStreamJson('cursor', 'structured_events')) throw new Error('cursor 应 false（无 stream-json 注入）');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
