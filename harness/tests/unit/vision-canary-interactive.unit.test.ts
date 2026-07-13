// vision-canary-interactive.unit.test.ts — I1a 交互式金丝雀判卷（plan b7e42d19）

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  generateRandomCanaryAnswerKey,
  renderCanaryImage,
  isCanaryAnswerComplete,
  VISION_CANARY_PROBE_VERSION,
} from '../../scripts/utils/vision-canary';
import {
  startInteractiveCanaryChallenge,
  waitForAnswerFile,
  finalizeInteractiveCanary,
} from '../../scripts/utils/vision-canary-interactive';
import { loadLocalConfig, writeLocalConfig } from '../../scripts/utils/framework-local-config';
import type { UnitCaseResult } from '../run-unit';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** 计数器 rng（注入 generateRandomCanaryAnswerKey 便于确定性断言）。 */
function seqRng(seq: number[]): (max: number) => number {
  let i = 0;
  return (max: number) => seq[i++ % seq.length] % max;
}

const TSNODE = path.resolve(__dirname, '..', '..', 'node_modules', 'ts-node', 'dist', 'bin.js');
const CLI = path.resolve(__dirname, '..', '..', 'scripts', 'grade-vision-canary.ts');

interface CliRun {
  challenge?: { challenge_id: string; image_path: string; answer_path: string; expires_at: string };
  verdictLine?: string;
  timeoutLine?: string;
  exitCode: number | null;
  stdout: string;
}

/**
 * 真实并发路径：后台 spawn CLI（非阻塞）→ 从 CHALLENGE 行取 answer_path → onChallenge 回调
 * （模拟 agent 看图写答卷）→ 等 CLI 退出取 VERDICT/TIMEOUT。验证不死锁 + 超时收尾。
 */
function runCliConcurrently(
  args: string[],
  onChallenge: (answerPath: string) => void,
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSNODE, '--transpile-only', CLI, ...args], {
      cwd: path.resolve(__dirname, '..', '..'),
      shell: false,
    });
    let stdout = '';
    let firedChallenge = false;
    child.stdout.on('data', (buf: Buffer) => {
      stdout += buf.toString();
      if (!firedChallenge) {
        const line = stdout.split('\n').find(l => l.startsWith('CHALLENGE '));
        if (line) {
          firedChallenge = true;
          try {
            const challenge = JSON.parse(line.slice('CHALLENGE '.length));
            onChallenge(challenge.answer_path);
          } catch {
            /* ignore parse race — next chunk */
            firedChallenge = false;
          }
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      const lines = stdout.split('\n');
      const challengeLine = lines.find(l => l.startsWith('CHALLENGE '));
      resolve({
        challenge: challengeLine ? JSON.parse(challengeLine.slice('CHALLENGE '.length)) : undefined,
        verdictLine: lines.find(l => l.startsWith('VERDICT ')),
        timeoutLine: lines.find(l => l.startsWith('TIMEOUT ')),
        exitCode: code,
        stdout,
      });
    });
  });
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'generateRandomCanaryAnswerKey: 结构合法（4 几何题 id 固定 + 非空 token）',
    run: () => {
      const key = generateRandomCanaryAnswerKey(seqRng([0]));
      assert(key.geometry_questions.length === 4, JSON.stringify(key));
      const ids = key.geometry_questions.map(q => q.id).sort();
      assert(
        JSON.stringify(ids) ===
          JSON.stringify(['BOTTOM_LEFT_COLOR', 'BOTTOM_RIGHT_COLOR', 'TOP_LEFT_COLOR', 'TOP_RIGHT_COLOR']),
        JSON.stringify(ids),
      );
      assert(typeof key.text_token === 'string' && key.text_token.length >= 6, key.text_token);
      // 每个几何题颜色 ∈ 四色集
      const palette = new Set(['red', 'blue', 'green', 'yellow']);
      assert(key.geometry_questions.every(q => palette.has(q.expected_color)), JSON.stringify(key));
    },
  },
  {
    name: 'generateRandomCanaryAnswerKey: 随机卷不复用答案（两次默认 crypto 随机 token 不同）',
    run: () => {
      const a = generateRandomCanaryAnswerKey();
      const b = generateRandomCanaryAnswerKey();
      // token 空间 36^8，碰撞概率可忽略；颜色排列或 token 至少一处不同
      assert(
        a.text_token !== b.text_token ||
          JSON.stringify(a.geometry_questions) !== JSON.stringify(b.geometry_questions),
        `两次随机卷不应完全相同：${JSON.stringify(a)}`,
      );
    },
  },
  {
    name: 'startInteractiveCanaryChallenge: 图落盘、答案不落盘、challenge 结构完整',
    run: async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-start-'));
      try {
        const started = await startInteractiveCanaryChallenge({
          workDir: dir,
          ttlMs: 60_000,
          now: () => 1_000_000,
          rng: seqRng([1, 2, 3, 0]),
        });
        assert(fs.existsSync(started.challenge.image_path), '图应落盘');
        assert(fs.statSync(started.challenge.image_path).size > 0, '图非空');
        assert(!fs.existsSync(started.challenge.answer_path), '答卷此刻不应存在');
        // answer key 不落盘：workDir 内不得有任何含答案 token 的文件
        const token = started.answerKey.text_token;
        const leaked = fs
          .readdirSync(dir)
          .some(f => fs.readFileSync(path.join(dir, f), 'utf-8').includes(token));
        assert(!leaked, 'answer key/token 不得落盘（反 grep）');
        assert(started.challenge.expires_at === new Date(1_060_000).toISOString(), started.challenge.expires_at);
        assert(/^[a-z0-9]{8}$/.test(started.challenge.challenge_id), started.challenge.challenge_id);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'waitForAnswerFile: 答卷出现 → answered=true 且读到内容',
    run: async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-wait-'));
      try {
        const answerPath = path.join(dir, 'answer.txt');
        fs.writeFileSync(answerPath, 'TOP_LEFT_COLOR=red', 'utf-8');
        const r = await waitForAnswerFile({
          answerPath,
          expiresAtMs: 999_999_999_999,
          pollMs: 1,
        });
        assert(r.answered === true, JSON.stringify(r));
        assert(r.answered && r.content.includes('TOP_LEFT_COLOR'), JSON.stringify(r));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'waitForAnswerFile: 超时未收卷 → answered=false reason=timeout（fail-safe 不写盘由调用方保证）',
    run: async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-timeout-'));
      try {
        let t = 0;
        const r = await waitForAnswerFile({
          answerPath: path.join(dir, 'never.txt'),
          expiresAtMs: 5,
          now: () => (t += 10), // 首次检查即已过期
          sleep: async () => undefined,
        });
        assert(r.answered === false && r.reason === 'timeout', JSON.stringify(r));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'finalizeInteractiveCanary: 判卷 + 写 vision.canary（probed_via=interactive）+ 保留既有字段',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-final-'));
      try {
        // 既有 local config：agent_adapter + vision.image_input_override（须被保留）
        writeLocalConfig(dir, {
          schema_version: '1.0',
          agent_adapter: 'cursor',
          vision: { image_input_override: 'none' },
        });
        const answerKey = generateRandomCanaryAnswerKey(seqRng([0]));
        // 造一份全对答卷 → tool_read
        const answer = answerKey.geometry_questions
          .map(q => `${q.id}=${q.expected_color}`)
          .concat(`TEXT_TOKEN=${answerKey.text_token}`)
          .join('\n');
        const r = finalizeInteractiveCanary({
          projectRoot: dir,
          adapter: 'cursor',
          answerKey,
          answerContent: answer,
          now: () => 1_700_000_000_000,
        });
        assert(r.verdict === 'tool_read' && r.wrote === true, JSON.stringify(r));
        const cfg = loadLocalConfig(dir)!;
        assert(cfg.agent_adapter === 'cursor', '既有 agent_adapter 应保留');
        assert(cfg.vision?.image_input_override === 'none', '既有 image_input_override 应保留');
        assert(cfg.vision?.canary?.verdict === 'tool_read', JSON.stringify(cfg.vision));
        assert(cfg.vision?.canary?.probed_via === 'interactive', JSON.stringify(cfg.vision));
        assert(cfg.vision?.canary?.adapter === 'cursor', JSON.stringify(cfg.vision));
        assert(
          cfg.vision?.canary?.probed_at === new Date(1_700_000_000_000).toISOString(),
          String(cfg.vision?.canary?.probed_at),
        );
        // plan c7d2e9a4 t1：交互式写盘同样带当前协议版本（两写盘点一致）
        assert(
          cfg.vision?.canary?.probe_version === VISION_CANARY_PROBE_VERSION,
          `interactive 写盘须带 probe_version：${JSON.stringify(cfg.vision?.canary)}`,
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'CLI 真实并发路径：后台启动 → 写答卷 → 判卷写盘（不死锁）',
    run: async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-cli-ok-'));
      try {
        const result = await runCliConcurrently(
          ['--adapter', 'cursor', '--project-root', projectRoot, '--ttl-ms', '15000', '--poll-ms', '100'],
          answerPath => {
            // 模拟盲 agent 诚实作答 → 确定性 none（无需读图即可断言写盘链路）
            fs.writeFileSync(answerPath, 'CANNOT_SEE_IMAGE', 'utf-8');
          },
        );
        assert(result.challenge !== undefined, '应输出 CHALLENGE');
        assert(result.verdictLine !== undefined, `应输出 VERDICT，实际 stdout=${result.stdout}`);
        assert(result.exitCode === 0, `answered 应 exit 0，实际 ${result.exitCode}`);
        const cfg = loadLocalConfig(projectRoot)!;
        assert(cfg.vision?.canary?.verdict === 'none', JSON.stringify(cfg.vision));
        assert(cfg.vision?.canary?.probed_via === 'interactive', JSON.stringify(cfg.vision));
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'codex P1 CLI SKIP：仅新鲜 interactive 缓存 SKIP；goal 缓存不短路（仍出 CHALLENGE 实测）',
    run: async () => {
      // (a) 有 goal 来源缓存（tool_read）→ 交互式仍须出题（IDE 可换模型，goal 缓存不背书）
      const goalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-cli-goal-'));
      try {
        writeLocalConfig(goalRoot, {
          schema_version: '1.0',
          agent_adapter: 'cursor',
          vision: { canary: { adapter: 'cursor', verdict: 'tool_read', probed_at: new Date().toISOString(), probed_via: 'goal' } },
        });
        const r = await runCliConcurrently(
          ['--adapter', 'cursor', '--project-root', goalRoot, '--ttl-ms', '500', '--poll-ms', '100'],
          () => {
            /* 不作答 → 让它超时；只验证它确实出了 CHALLENGE 而非 SKIP */
          },
        );
        assert(r.challenge !== undefined, `goal 缓存不应 SKIP，应出 CHALLENGE，实际 stdout=${r.stdout}`);
        assert(!r.stdout.includes('SKIP '), `goal 缓存不得 SKIP：${r.stdout}`);
      } finally {
        fs.rmSync(goalRoot, { recursive: true, force: true });
      }
      // (b) 有新鲜 interactive 缓存 → SKIP，不出题
      const interactiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-cli-interactive-'));
      try {
        writeLocalConfig(interactiveRoot, {
          schema_version: '1.0',
          agent_adapter: 'cursor',
          // plan c7d2e9a4：SKIP 须当前协议版本（无版本旧缓存不再阻止重测）
          vision: { canary: { adapter: 'cursor', verdict: 'tool_read', probed_at: new Date().toISOString(), probed_via: 'interactive', probe_version: VISION_CANARY_PROBE_VERSION } },
        });
        const r = await runCliConcurrently(
          ['--adapter', 'cursor', '--project-root', interactiveRoot, '--ttl-ms', '5000', '--poll-ms', '100'],
          () => {
            /* 不会被调用——应立即 SKIP */
          },
        );
        assert(r.stdout.includes('SKIP '), `新鲜 interactive 缓存应 SKIP，实际 stdout=${r.stdout}`);
        assert(r.challenge === undefined, `SKIP 时不应出 CHALLENGE：${r.stdout}`);
        assert(r.exitCode === 0, `SKIP 应 exit 0，实际 ${r.exitCode}`);
      } finally {
        fs.rmSync(interactiveRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'codex P2 waitForAnswerFile+isComplete：半写入（仅首行）不收卷，续写完整后才收卷',
    run: async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-partialrace-'));
      try {
        const answerPath = path.join(dir, 'answer.txt');
        // 非原子写第一步：只落首行（codex 原例 TOP_LEFT_COLOR=red\n）——非空但不完整
        fs.writeFileSync(answerPath, 'TOP_LEFT_COLOR=red\n', 'utf-8');
        let ticks = 0;
        const r = await waitForAnswerFile({
          answerPath,
          expiresAtMs: 100,
          pollMs: 1,
          isComplete: content => isCanaryAnswerComplete(content),
          now: () => {
            ticks += 1;
            // 第 3 次检查时补齐余下键（模拟续写完成）
            if (ticks === 3) {
              fs.writeFileSync(
                answerPath,
                'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=ABC',
                'utf-8',
              );
            }
            return ticks >= 8 ? 999 : 0;
          },
          sleep: async () => undefined,
        });
        assert(r.answered === true && r.content.includes('TEXT_TOKEN'), `半写入应等到完整才收卷：${JSON.stringify(r)}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      // 始终只有半截内容到超时 → 不收卷（timeout，fail-safe 不写盘）
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-partialonly-'));
      try {
        const answerPath = path.join(dir2, 'answer.txt');
        fs.writeFileSync(answerPath, 'TOP_LEFT_COLOR=red\n', 'utf-8');
        let t = 0;
        const r = await waitForAnswerFile({
          answerPath,
          expiresAtMs: 5,
          isComplete: content => isCanaryAnswerComplete(content),
          now: () => (t += 10),
          sleep: async () => undefined,
        });
        assert(r.answered === false, `半截内容应超时不收卷：${JSON.stringify(r)}`);
      } finally {
        fs.rmSync(dir2, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'CLI fail-safe：超时未收卷 → TIMEOUT 且不写 vision.canary',
    run: async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-cli-timeout-'));
      try {
        const result = await runCliConcurrently(
          ['--adapter', 'cursor', '--project-root', projectRoot, '--ttl-ms', '600', '--poll-ms', '100'],
          () => {
            /* 不写答卷 → 触发超时 */
          },
        );
        assert(result.timeoutLine !== undefined, `应输出 TIMEOUT，实际 stdout=${result.stdout}`);
        assert(result.exitCode === 2, `timeout 应 exit 2，实际 ${result.exitCode}`);
        const cfg = loadLocalConfig(projectRoot);
        assert(!cfg?.vision?.canary, `超时不得写 vision.canary，实际=${JSON.stringify(cfg?.vision)}`);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'renderCanaryImage: 随机 answerKey 驱动产出可读非空 PNG',
    run: async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-render-'));
      try {
        const key = generateRandomCanaryAnswerKey(seqRng([2, 0, 1, 0]));
        const out = path.join(dir, 'canary.png');
        await renderCanaryImage(out, key);
        assert(fs.existsSync(out) && fs.statSync(out).size > 0, 'PNG 应非空');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return runInteractiveCanaryTests();
}

async function runInteractiveCanaryTests(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  runInteractiveCanaryTests().then(r => {
    for (const x of r) console.log(x.ok ? 'PASS' : 'FAIL', x.name, x.error ?? '');
    process.exit(r.every(x => x.ok) ? 0 : 1);
  });
}
