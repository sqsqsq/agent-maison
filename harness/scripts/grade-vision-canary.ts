#!/usr/bin/env ts-node
// ============================================================================
// grade-vision-canary.ts — I1a 交互式视觉能力自测卷判卷 CLI（plan b7e42d19）
// ============================================================================
// 单进程闭环握手（分叉1）：本 CLI 出随机题卷 → 首行 flush 机读 CHALLENGE JSON →
// 同进程等待答卷文件 → 判卷 + 无感写盘 vision.canary → 输出 VERDICT/TIMEOUT JSON。
// answer key 只在进程内存、绝不落盘（分叉2 反 grep）；超时 fail-safe 不写盘（分叉1）。
//
// 并发铁律：agent 侧须**后台（非阻塞）启动本 CLI**——前台跑即死锁（agent 阻塞等命令
// 返回、CLI 阻塞等答卷）。编排逐步指令见 SKILL 共享 reference 段（I1b）。
//
// 用法：
//   npx ts-node scripts/grade-vision-canary.ts [--adapter <name>] [--ttl-ms N] [--poll-ms N] [--work-dir <path>]
//   出题即打印  CHALLENGE {"challenge_id","image_path","answer_path","expires_at"}
//   收卷判卷后 VERDICT   {"verdict","reason","wrote":true}
//   超时未收卷 TIMEOUT   {"reason":"timeout","wrote":false}

import minimist from 'minimist';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectRepoLayout } from '../repo-layout';
import { loadLocalConfig } from './utils/framework-local-config';
import { isFreshInteractiveCanary } from './utils/multimodal-probe';
import { isCanaryAnswerComplete } from './utils/vision-canary';
import {
  startInteractiveCanaryChallenge,
  waitForAnswerFile,
  finalizeInteractiveCanary,
} from './utils/vision-canary-interactive';

function emit(kind: 'CHALLENGE' | 'VERDICT' | 'TIMEOUT' | 'SKIP' | 'ERROR', payload: unknown): void {
  process.stdout.write(`${kind} ${JSON.stringify(payload)}\n`);
}

async function main(): Promise<number> {
  const argv = minimist(process.argv.slice(2), {
    string: ['adapter', 'work-dir', 'project-root'],
    boolean: ['help', 'force', 'refresh'],
    alias: { h: 'help' },
    default: { 'ttl-ms': 120_000, 'poll-ms': 500 },
  });

  if (argv.help) {
    console.log(`
grade-vision-canary — 交互式视觉能力自测卷判卷 CLI（后台启动，见 SKILL 编排）

  npx ts-node scripts/grade-vision-canary.ts [--adapter <name>] [--ttl-ms N] [--poll-ms N]

出题即输出 CHALLENGE JSON（image_path/answer_path/expires_at）；agent 读图后把答卷写到
answer_path；本 CLI 判卷并无感写 framework.local.json 的 vision.canary，输出 VERDICT/TIMEOUT。
`);
    return 0;
  }

  const layout = detectRepoLayout(__dirname);
  const projectRoot = argv['project-root'] ? String(argv['project-root']) : layout.projectRoot;

  // adapter：显式 --adapter 优先，否则读 framework.local.json 的 agent_adapter（个人身份 SSOT）。
  let adapter = argv.adapter ? String(argv.adapter).trim() : '';
  if (!adapter) {
    try {
      adapter = loadLocalConfig(projectRoot)?.agent_adapter?.trim() ?? '';
    } catch {
      adapter = '';
    }
  }
  if (!adapter) {
    emit('ERROR', { reason: 'no_adapter', detail: '无 --adapter 且 framework.local.json 无 agent_adapter' });
    return 1;
  }

  // 已有新鲜的 **interactive** canary（本 adapter，未超 24h）→ SKIP，无须再作答。
  // 关键（codex P1）：只认 interactive 来源——goal/旧缓存不阻止交互式当前会话实测，
  // 否则 IDE 里换成纯文本模型时会被 goal 写的 tool_read 缓存误 SKIP，放回本 plan 要堵的洞。
  // --force（或 --refresh）跳过该短路，强制重测。
  if (!argv.force && !argv.refresh) {
    try {
      const existingCanary = loadLocalConfig(projectRoot)?.vision?.canary;
      if (isFreshInteractiveCanary(existingCanary, adapter)) {
        emit('SKIP', {
          reason: 'fresh_interactive_cache',
          verdict: existingCanary!.verdict,
          probed_at: existingCanary!.probed_at,
        });
        return 0;
      }
    } catch {
      // local config 读取失败不阻断——继续出题实测
    }
  }

  const ttlMs = Number(argv['ttl-ms']) || 120_000;
  const pollMs = Number(argv['poll-ms']) || 500;
  const workDir = argv['work-dir']
    ? String(argv['work-dir'])
    : fs.mkdtempSync(path.join(os.tmpdir(), 'vision-canary-'));

  const started = await startInteractiveCanaryChallenge({ workDir, ttlMs });
  emit('CHALLENGE', started.challenge);

  const expiresAtMs = Date.parse(started.challenge.expires_at);
  const waited = await waitForAnswerFile({
    answerPath: started.challenge.answer_path,
    expiresAtMs,
    pollMs,
    // 收卷完整性判据（codex P2 二轮）：全部答题键齐或 CANNOT_SEE_IMAGE 才收，半写入不误判。
    isComplete: content => isCanaryAnswerComplete(content, started.answerKey),
  });

  try {
    if (!waited.answered) {
      emit('TIMEOUT', { reason: 'timeout', wrote: false });
      return 2;
    }
    const result = finalizeInteractiveCanary({
      projectRoot,
      adapter,
      answerKey: started.answerKey,
      answerContent: waited.content,
    });
    emit('VERDICT', result);
    return 0;
  } finally {
    // 清理工作目录（图 + 答卷）——answer key 从未落盘，无需清理
    if (!argv['work-dir']) fs.rmSync(workDir, { recursive: true, force: true });
    else {
      fs.rmSync(started.challenge.image_path, { force: true });
      fs.rmSync(started.challenge.answer_path, { force: true });
    }
  }
}

main().then(
  code => process.exit(code),
  err => {
    emit('ERROR', { reason: 'exception', detail: (err as Error).message });
    process.exit(1);
  },
);
