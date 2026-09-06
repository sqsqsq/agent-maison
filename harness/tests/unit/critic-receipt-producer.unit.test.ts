/**
 * critic-receipt-producer 单测（t3b，plan f7a3d9c2）：claude structured_events 解析器 +
 * runner attestation 回执生产（verified/unverified/降级路径）。
 * fixture：合成样本（形状构造）+ **真实样本 fixtures/claude-agent-events.real.jsonl**
 * （2026-07-11 宿主实采：claude CLI 2.1.169 `-p --output-format stream-json --verbose`
 * Read 真机截图 shot-open_result.png 的完整事件流——t3a"真实日志 fixture"要求已闭）。
 */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  hasImageReadParser,
  loadSpecRefsReceipt,
  severestVlFailureKind,
  verifyVlSigningChain,
  parseClaudeImageReadEvents,
  produceCriticReceipt,
  produceSpecRefsReceipt,
  specRefsReceiptPath,
} from '../../scripts/utils/critic-receipt-producer';
import { VISION_CANARY_PROBE_VERSION } from '../../scripts/utils/vision-canary';
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

// ===========================================================================
// plan 8d2b4f60 D2：refs 回执改材料寻址（V3 路径匹配 / 跨 invoke 并集 / V8 1.0 残留）
// ===========================================================================

function mkRefsHost(): { root: string; refDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crp-refs-'));
  fs.mkdirSync(path.join(root, 'doc', 'features', 'feat', 'vision'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0', project_name: 'demo', project_type: 'app',
    project_profile: { name: 'hmos-app' }, agent_adapter: 'claude',
    paths: { features_dir: 'doc/features' },
  }), 'utf-8');
  const refDir = path.join(root, 'doc', 'features', 'feat', 'ux-reference');
  fs.mkdirSync(refDir, { recursive: true });
  return { root, refDir };
}

function writeBytes(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

function runProduce(
  root: string,
  invokeId: string,
  events: string[],
  refs: string[],
): ReturnType<typeof produceSpecRefsReceipt> {
  const eventsAbs = path.join(root, `agent-events-${invokeId}.jsonl`);
  fs.writeFileSync(eventsAbs, `${events.join('\n')}\n`, 'utf-8');
  return produceSpecRefsReceipt({
    projectRoot: root, feature: 'feat', adapter: 'claude', goalRunId: 'run-1',
    invokeId, eventsLogAbsPath: eventsAbs, refAbsPaths: refs,
  });
}

test('V3② 同名异路径不算读：读 tmp/1-home.png 不得让 ux-reference/1-home.png 判 read', () => {
  const { root, refDir } = mkRefsHost();
  try {
    const authoritative = path.join(refDir, '1-home.png');
    const decoy = path.join(root, 'tmp', '1-home.png');
    writeBytes(authoritative, 'AUTHORITATIVE-BYTES');
    writeBytes(decoy, 'DECOY-BYTES');
    const r = runProduce(root, 'spec-i1', [claudeEvent('Read', 'tmp/1-home.png')], [authoritative]);
    assert.ok(r.produced, JSON.stringify(r));
    assert.strictEqual(r.unread?.length, 1, `basename 兜底已删除，同名异路径不算读：${JSON.stringify(r)}`);
    const receipt = loadSpecRefsReceipt(root, 'feat')!;
    assert.strictEqual(receipt.schema_version, '1.1');
    assert.strictEqual(receipt.refs[0].read, false);
    assert.ok(!('invoke_id' in receipt), '顶层 invoke_id 已删除');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('V2/V3① 跨 invoke 并集：内容未变继承并计 carriedOver；图被替换即作废重来', () => {
  const { root, refDir } = mkRefsHost();
  try {
    const a = path.join(refDir, 'a.png');
    const b = path.join(refDir, 'b.png');
    writeBytes(a, 'A-V1');
    writeBytes(b, 'B-V1');
    // 第 1 轮：两张都读到
    const r1 = runProduce(root, 'spec-i1',
      [claudeEvent('Read', toRel(root, a)), claudeEvent('Read', toRel(root, b))], [a, b]);
    assert.strictEqual(r1.unread?.length, 0, JSON.stringify(r1));
    assert.strictEqual(r1.carriedOver?.length, 0, '首轮无沿用');
    // 第 2 轮：零读图，内容未变 → 全部继承（复现 08-15 closure 轮形态）
    const r2 = runProduce(root, 'spec-i2', [], [a, b]);
    assert.strictEqual(r2.unread?.length, 0, `内容未变应可继承：${JSON.stringify(r2)}`);
    assert.strictEqual(r2.carriedOver?.length, 2, JSON.stringify(r2));
    const rec2 = loadSpecRefsReceipt(root, 'feat')!;
    assert.ok(rec2.refs.every(r => r.read_at_invoke === 'spec-i1'), JSON.stringify(rec2.refs));
    // 第 3 轮：替换 b.png 内容 → 只有 b 作废
    writeBytes(b, 'B-V2-REPLACED');
    const r3 = runProduce(root, 'spec-i3', [], [a, b]);
    assert.strictEqual(r3.unread?.length, 1, `图变即作废：${JSON.stringify(r3)}`);
    assert.ok(r3.unread![0].endsWith('b.png'), JSON.stringify(r3.unread));
    assert.strictEqual(r3.carriedOver?.length, 1, 'a 仍可继承');
    // 第 4 轮：重读 b → read_at_invoke 记本轮，不再算沿用
    const r4 = runProduce(root, 'spec-i4', [claudeEvent('Read', toRel(root, b))], [a, b]);
    assert.strictEqual(r4.unread?.length, 0, JSON.stringify(r4));
    const rec4 = loadSpecRefsReceipt(root, 'feat')!;
    assert.strictEqual(rec4.refs.find(r => r.path.endsWith('b.png'))!.read_at_invoke, 'spec-i4');
    assert.strictEqual(rec4.refs.find(r => r.path.endsWith('a.png'))!.read_at_invoke, 'spec-i1');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('V8 schema 1.0 残留（同 run resume：goal_run_id 恰好命中）→ loader 判 null、生产面从零重算', () => {
  const { root, refDir } = mkRefsHost();
  try {
    const a = path.join(refDir, 'a.png');
    writeBytes(a, 'A-V1');
    fs.writeFileSync(specRefsReceiptPath(root, 'feat'), JSON.stringify({
      schema_version: '1.0', adapter: 'claude', goal_run_id: 'run-1', invoke_id: 'spec-i1',
      produced_at: '2026-08-01T00:00:00.000Z',
      refs: [{ path: a, hash: crypto.createHash('sha256').update('A-V1').digest('hex'), read: true }],
      unread: [],
      attestation: { goal_run_id: 'run-1', evidence_log_path: 'x', evidence_log_hash: 'y', source: 'runner_transcript_audit' },
    }), 'utf-8');
    assert.strictEqual(loadSpecRefsReceipt(root, 'feat'), null, '1.0 一律视同无回执');
    // 零读图重算：不得按 1.0 的 read=true 继承
    const r = runProduce(root, 'spec-i2', [], [a]);
    assert.strictEqual(r.unread?.length, 1, `1.0 不得被继承：${JSON.stringify(r)}`);
    assert.strictEqual(r.carriedOver?.length, 0, JSON.stringify(r));
    assert.strictEqual(loadSpecRefsReceipt(root, 'feat')!.schema_version, '1.1');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('跨 run / 跨 adapter 不继承：run 或 adapter 不同即从零重算', () => {
  const { root, refDir } = mkRefsHost();
  try {
    const a = path.join(refDir, 'a.png');
    writeBytes(a, 'A-V1');
    const emptyEvents = path.join(root, 'agent-events-empty.jsonl');
    fs.writeFileSync(emptyEvents, '', 'utf-8');
    runProduce(root, 'spec-i1', [claudeEvent('Read', toRel(root, a))], [a]);
    const otherRun = produceSpecRefsReceipt({
      projectRoot: root, feature: 'feat', adapter: 'claude', goalRunId: 'run-2',
      invokeId: 'spec-i1', eventsLogAbsPath: emptyEvents, refAbsPaths: [a],
    });
    assert.strictEqual(otherRun.unread?.length, 1, `不跨 run 继承：${JSON.stringify(otherRun)}`);
    runProduce(root, 'spec-i1', [claudeEvent('Read', toRel(root, a))], [a]);
    const otherAdapter = produceSpecRefsReceipt({
      projectRoot: root, feature: 'feat', adapter: 'codeagent', goalRunId: 'run-1',
      invokeId: 'spec-i2', eventsLogAbsPath: emptyEvents, refAbsPaths: [a],
    });
    assert.strictEqual(otherAdapter.unread?.length, 1, `不跨 adapter 继承：${JSON.stringify(otherAdapter)}`);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('V5①②/V6 结构性不可达三判据：非 goal / attended(owner.kind=session) / adapter 无解析器', () => {
  const { root, refDir } = mkRefsHost();
  const runId = 'run-unreach';
  try {
    const a = path.join(refDir, 'a.png');
    writeBytes(a, 'A-V1');
    const featureAbs = path.join(root, 'doc', 'features', 'feat');
    const runDir = path.join(featureAbs, 'goal-runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({
      adapter: 'claude', run_id: runId, feature: 'feat',
      requirement: '参考图在 doc/features/feat/ux-reference/a.png。',
    }), 'utf-8');
    fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({
      schema_version: '1.0',
      vision: {
        canary: {
          adapter: 'claude', verdict: 'tool_read', probed_at: new Date().toISOString(),
          probe_version: VISION_CANARY_PROBE_VERSION, probed_via: 'goal', run_id: runId,
        },
      },
    }), 'utf-8');
    const eventsAbs = path.join(root, 'agent-events-unreach.jsonl');
    fs.writeFileSync(eventsAbs, `${claudeEvent('Read', 'doc/features/feat/ux-reference/a.png')}\n`, 'utf-8');
    produceSpecRefsReceipt({
      projectRoot: root, feature: 'feat', adapter: 'claude', goalRunId: runId,
      invokeId: 'spec-i1', eventsLogAbsPath: eventsAbs, refAbsPaths: [a],
    });

    const prevRun = process.env.MAISON_GOAL_RUN_ID;
    const prevAtt = process.env.MAISON_GOAL_ATTEMPT;
    const chain = (): ReturnType<typeof verifyVlSigningChain> => {
      clearFrameworkConfigCache();
      return verifyVlSigningChain({ projectRoot: root, feature: 'feat' });
    };
    try {
      // ① 非 goal：无 run/attempt 身份
      delete process.env.MAISON_GOAL_RUN_ID;
      delete process.env.MAISON_GOAL_ATTEMPT;
      const nonGoal = chain();
      assert.strictEqual(nonGoal.ok, false);
      assert.strictEqual(severestVlFailureKind(nonGoal.failureKinds), 'unreachable', JSON.stringify(nonGoal.failures));

      process.env.MAISON_GOAL_RUN_ID = runId;
      process.env.MAISON_GOAL_ATTEMPT = 'i1';
      // 正例基线：detached goal + 有解析器 adapter + probe 金丝雀 → 可终签
      const ok = chain();
      assert.strictEqual(ok.ok, true, JSON.stringify(ok.failures));

      // ② attended：run-control owner.kind=session（唯一可靠机内信号）
      fs.writeFileSync(path.join(runDir, 'run-control.json'), JSON.stringify({
        schema: 'run-control@1', run_id: runId, current_epoch: 1,
        owner: {
          kind: 'session', owner_id: 'sess-1', epoch: 1, state: 'active',
          lease_expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
        updated_at: new Date().toISOString(),
      }), 'utf-8');
      const attended = chain();
      assert.strictEqual(attended.ok, false);
      assert.strictEqual(severestVlFailureKind(attended.failureKinds), 'unreachable', JSON.stringify(attended.failures));
      assert.ok(attended.failures.some(f => /attended/.test(f)), JSON.stringify(attended.failures));
      // process owner → 按 detached 处理（读不到/非法同理）
      fs.writeFileSync(path.join(runDir, 'run-control.json'), JSON.stringify({
        schema: 'run-control@1', run_id: runId, current_epoch: 1,
        owner: { kind: 'process', owner_id: 'p-1', epoch: 1, state: 'active', pid: process.pid, hostname: os.hostname() },
        updated_at: new Date().toISOString(),
      }), 'utf-8');
      assert.strictEqual(chain().ok, true, 'process owner 不得被判 attended');
      fs.rmSync(path.join(runDir, 'run-control.json'), { force: true });

      // ③ adapter 无注册解析器（codex 形态）→ 结构性不可达
      fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({
        adapter: 'codex', run_id: runId, feature: 'feat',
        requirement: '参考图在 doc/features/feat/ux-reference/a.png。',
      }), 'utf-8');
      const noParser = chain();
      assert.strictEqual(noParser.ok, false);
      assert.strictEqual(severestVlFailureKind(noParser.failureKinds), 'unreachable', JSON.stringify(noParser.failures));
      assert.ok(noParser.failures.some(f => /无注册的结构化事件解析器/.test(f)), JSON.stringify(noParser.failures));
    } finally {
      if (prevRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = prevRun;
      if (prevAtt === undefined) delete process.env.MAISON_GOAL_ATTEMPT; else process.env.MAISON_GOAL_ATTEMPT = prevAtt;
    }
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
