/**
 * critic-receipt-producer 单测（t3b，plan f7a3d9c2）：claude structured_events 解析器 +
 * runner attestation 回执生产（verified/unverified/降级路径）。
 * fixture：合成样本（形状构造）+ **真实样本 fixtures/claude-agent-events.real.jsonl**
 * （2026-07-11 宿主实采：claude CLI 2.1.169 `-p --output-format stream-json --verbose`
 * Read 真机截图 shot-open_result.png 的完整事件流——t3a"真实日志 fixture"要求已闭）。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  hasImageReadParser,
  parseClaudeImageReadEvents,
  produceCriticReceipt,
} from '../../scripts/utils/critic-receipt-producer';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function claudeEvent(name: string, filePath: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'toolu_x', name, input: { file_path: filePath } }] },
  });
}

test('claude_parser_extracts_image_reads_only_structured', () => {
  const jsonl = [
    claudeEvent('Read', 'doc/features/f/device-testing/device-screenshots/shot-home.png'),
    claudeEvent('Read', 'doc/features/f/spec/spec.md'), // 非图片不计
    claudeEvent('Bash', 'x.png'), // 非 Read 不计
    JSON.stringify({ type: 'result', result: '看了 shot-mine.png' }), // 文本提及≠验读（禁正则猜测）
    'API Error: connection closed', // 非 JSON 行跳过
    claudeEvent('Read', 'doc/a/_attest/home_root.png'),
    claudeEvent('Read', 'doc/features/f/device-testing/device-screenshots/shot-home.png'), // 去重
  ].join('\n');
  const reads = parseClaudeImageReadEvents(jsonl);
  assert.deepStrictEqual(
    [...reads].sort(),
    [
      'doc/a/_attest/home_root.png',
      'doc/features/f/device-testing/device-screenshots/shot-home.png',
    ].sort(),
    `只认结构化 Read 图片事件：${JSON.stringify(reads)}`,
  );
});

test('claude_parser_real_device_fixture_extracts_read', () => {
  // 2026-07-11 宿主实采样本（tool_use/Read 事件 + 最终描述文本齐全，模型真读到了图）
  const real = fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-agent-events.real.jsonl'), 'utf-8');
  const reads = parseClaudeImageReadEvents(real);
  assert.strictEqual(reads.length, 1, `真实样本应恰好 1 条图片验读：${JSON.stringify(reads)}`);
  assert.ok(
    reads[0].endsWith('device-screenshots/shot-open_result.png'),
    `验读路径应为真机截图：${reads[0]}`,
  );
});

function mkProject(): { root: string; shotRel: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crp-'));
  const dd = path.join(root, 'doc', 'features', 'feat', 'device-testing', 'device-screenshots');
  fs.mkdirSync(dd, { recursive: true });
  const shotRel = 'doc/features/feat/device-testing/device-screenshots/shot-home.png';
  fs.writeFileSync(path.join(root, shotRel), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  fs.writeFileSync(
    path.join(dd, 'visual-diff.json'),
    JSON.stringify({
      schema_version: '1.1',
      screens: [{ screen_id: 'home', verdict: 'pass', screenshot_path: shotRel }],
    }),
    'utf-8',
  );
  return { root, shotRel };
}

test('produce_verified_when_all_finalized_shots_read', () => {
  const { root, shotRel } = mkProject();
  try {
    const eventsAbs = path.join(root, 'agent-events.jsonl');
    fs.writeFileSync(eventsAbs, `${claudeEvent('Read', shotRel)}\n`, 'utf-8');
    const r = produceCriticReceipt({
      projectRoot: root,
      feature: 'feat',
      adapter: 'claude',
      goalRunId: 'run-1',
      attemptId: 'i1',
      eventsLogAbsPath: eventsAbs,
      promptHash: 'ph',
      outputHash: 'oh',
    });
    assert.ok(r.produced && r.provenance === 'verified', JSON.stringify(r));
    const receipt = JSON.parse(
      fs.readFileSync(path.join(root, 'doc', 'features', 'feat', 'device-testing', 'reports', 'critic-receipt.json'), 'utf-8'),
    ) as {
      input_provenance: string;
      image_inputs: Array<{ path: string; hash?: string }>;
      runner_attestation?: { goal_run_id: string; evidence_log_path: string; evidence_log_hash: string };
    };
    assert.strictEqual(receipt.input_provenance, 'verified');
    assert.ok(receipt.image_inputs.every(i => i.hash), 'verified 逐项带现算 hash');
    assert.ok(receipt.runner_attestation?.evidence_log_path.endsWith('agent-events.jsonl'), 'attestation 绑定 events 文件');
    assert.ok(/^[0-9a-f]{16}$/.test(receipt.runner_attestation?.evidence_log_hash ?? ''), '证据日志 hash 现算');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('produce_unverified_with_unread_list_when_coverage_incomplete', () => {
  const { root } = mkProject();
  try {
    const eventsAbs = path.join(root, 'agent-events.jsonl');
    // 读了别的图，没读被评截图
    fs.writeFileSync(eventsAbs, `${claudeEvent('Read', 'doc/other.png')}\n`, 'utf-8');
    fs.writeFileSync(path.join(root, 'doc', 'other.png'), Buffer.from([1, 2, 3]));
    const r = produceCriticReceipt({
      projectRoot: root,
      feature: 'feat',
      adapter: 'claude',
      goalRunId: 'run-1',
      attemptId: 'i1',
      eventsLogAbsPath: eventsAbs,
      promptHash: 'ph',
      outputHash: 'oh',
    });
    assert.ok(r.produced && r.provenance === 'unverified', JSON.stringify(r));
    assert.strictEqual(r.unreadScreenshots?.length, 1, '未验读的被评截图如实入 unread 清单');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no_parser_or_no_events_degrades_honestly', () => {
  const { root } = mkProject();
  try {
    assert.ok(!hasImageReadParser('cursor'), 'cursor 无注册解析器（盘点未合格）');
    const noParser = produceCriticReceipt({
      projectRoot: root,
      feature: 'feat',
      adapter: 'cursor',
      goalRunId: 'run-1',
      attemptId: 'i1',
      eventsLogAbsPath: path.join(root, 'agent-events.jsonl'),
      promptHash: 'ph',
      outputHash: null,
    });
    assert.ok(!noParser.produced && /无注册的结构化事件解析器/.test(noParser.reason ?? ''));
    const noEvents = produceCriticReceipt({
      projectRoot: root,
      feature: 'feat',
      adapter: 'claude',
      goalRunId: 'run-1',
      attemptId: 'i1',
      eventsLogAbsPath: path.join(root, 'missing.jsonl'),
      promptHash: 'ph',
      outputHash: null,
    });
    assert.ok(!noEvents.produced && /不存在/.test(noEvents.reason ?? ''), '无事件文件 → 不产出（保持 unverified 档）');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
