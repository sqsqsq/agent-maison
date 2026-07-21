// ============================================================================
// hylyre-utf8-roundtrip.ts — 中文 selector 全链路 UTF-8 round-trip doctor
// （visual-capability-truth S2 / P0-B；openspec visual-diff delta）
// ----------------------------------------------------------------------------
// 走**真实链路**而非 echo stdout：Node 写含中文 by_text 的 steps JSON（UTF-8）→
// hylyre 自己的 loader `load_steps_json_array` 解析 → 提取 selector predicate →
// json.dumps(ensure_ascii=False) 打回 stdout → Node utf-8 解码逐字符比对。
// 覆盖三段边界：steps 文件编码（Node 写/Python 读）、Python 进程内字符串、
// stdout 管道编码（PYTHONIOENCODING 未注入时 Windows 按 GBK 编码 → Node utf-8
// 解码出 U+FFFD——20260718 宿主事故的乱码机制）。
// 失败 → device testing 前置 BLOCKER（归类 toolchain/环境，非产品失败）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { buildHylyreSpawnInvocation } from './hylyre-spawn';

/** 探针文本：覆盖事故实测的入口/选择器中文 + 混合 ASCII */
export const ROUNDTRIP_PROBE_TEXTS = ['添加管理卡片', '招商银行', '更多', '卡包Z区'] as const;

/** Python 侧脚本：真实 loader → predicate 提取 → ensure_ascii=False 回显 */
const PY_ROUNDTRIP_SCRIPT = [
  'import json, sys',
  'from pathlib import Path',
  'from hylyre.cli.commands.steps_cmd import load_steps_json_array',
  'steps = load_steps_json_array(Path(sys.argv[1]))',
  "preds = [s.get('touch', {}).get('by_text') or s.get('wait_for', {}).get('by_text') for s in steps]",
  "sys.stdout.write(json.dumps({'predicates': preds}, ensure_ascii=False))",
  'sys.stdout.flush()',
].join('\n');

export interface RoundTripVerifyResult {
  ok: boolean;
  mismatches: Array<{ expected: string; actual: string | null }>;
  mojibake: boolean;
  detail: string;
}

/** U+FFFD（GBK 字节被 utf-8 解码的典型残骸）检测 */
export function containsMojibake(s: string): boolean {
  return s.includes('�');
}

/** 纯函数：stdout 回显 vs 期望文本逐字符比对（单测入口） */
export function verifyRoundTripOutput(
  stdout: string,
  expected: readonly string[],
): RoundTripVerifyResult {
  const mismatches: Array<{ expected: string; actual: string | null }> = [];
  let parsed: { predicates?: Array<string | null> } | null = null;
  try {
    // stdout 可能混有 hylyre 自身日志行——取最后一个 JSON 对象行
    const line = stdout
      .split(/\r?\n/)
      .reverse()
      .find(l => l.trim().startsWith('{'));
    parsed = line ? (JSON.parse(line) as { predicates?: Array<string | null> }) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || !Array.isArray(parsed.predicates)) {
    return {
      ok: false,
      mismatches: expected.map(e => ({ expected: e, actual: null })),
      mojibake: containsMojibake(stdout),
      detail: `round-trip 输出不可解析（stdout 前 200 字：${stdout.slice(0, 200)}）`,
    };
  }
  const actual = parsed.predicates;
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      mismatches.push({ expected: expected[i], actual: actual[i] ?? null });
    }
  }
  const mojibake = containsMojibake(stdout);
  const ok = mismatches.length === 0 && !mojibake;
  return {
    ok,
    mismatches,
    mojibake,
    detail: ok
      ? `round-trip 一致（${expected.length} 条中文 predicate 全链字节保真）`
      : [
          `UTF-8 round-trip 失败：`,
          ...(mojibake ? ['  - 输出含 U+FFFD（典型：Python stdout 按 GBK 编码被 utf-8 解码——PYTHONIOENCODING 未生效）'] : []),
          ...mismatches.map(m => `  - 期望「${m.expected}」实得 ${m.actual === null ? '<缺失>' : `「${m.actual}」`}`),
        ].join('\n'),
  };
}

export interface RunRoundTripOptions {
  pythonPath: string;
  hypiumWorkDir: string;
  logPath?: string;
  timeoutMs?: number;
}

/**
 * 执行 round-trip：写探针 steps 文件（device-test 与 visual-nav 的 steps 同构，
 * 一次覆盖两条消费路径的共享边界）→ python 真实 loader 解析回显 → 比对。
 */
export function runHylyreUtf8RoundTrip(opts: RunRoundTripOptions): RoundTripVerifyResult {
  const stepsFile = path.join(opts.hypiumWorkDir, 'utf8-roundtrip-steps.json');
  const steps = ROUNDTRIP_PROBE_TEXTS.map((t, i) =>
    i % 2 === 0 ? { touch: { by_text: t } } : { wait_for: { by_text: t } },
  );
  try {
    fs.mkdirSync(path.dirname(stepsFile), { recursive: true });
    fs.writeFileSync(stepsFile, JSON.stringify(steps), 'utf-8');
  } catch (e) {
    return {
      ok: false,
      mismatches: [],
      mojibake: false,
      detail: `写 round-trip steps 文件失败：${(e as Error).message}`,
    };
  }
  // 复用统一装配（含 PYTHONUTF8/PYTHONIOENCODING 注入）——只换 argv 为 -c 脚本
  const base = buildHylyreSpawnInvocation({
    pythonPath: opts.pythonPath,
    hypiumWorkDir: opts.hypiumWorkDir,
    hylyreArgv: [],
  });
  const run = spawnSync(base.pythonPath, ['-c', PY_ROUNDTRIP_SCRIPT, stepsFile], {
    cwd: base.cwd,
    env: base.env,
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 60_000,
  });
  if (run.error || run.status !== 0) {
    return {
      ok: false,
      mismatches: [],
      mojibake: containsMojibake(`${run.stdout ?? ''}${run.stderr ?? ''}`),
      detail:
        `round-trip 子进程失败（exit=${run.status ?? 'null'}）：` +
        `${run.error?.message ?? ''}${(run.stderr ?? '').slice(0, 300)}`,
    };
  }
  return verifyRoundTripOutput(run.stdout ?? '', ROUNDTRIP_PROBE_TEXTS);
}
