/**
 * process-integrity 单测（P0-7 进程注入自净，plan c9e2a7f4）：
 *   背景＝2026-07-05 伪签事故：agent 以 NODE_OPTIONS 预加载 hook（.cjs --require / .mjs --import）
 *   在 harness 进程内篡改 visual-diff.json 判定，回执 command 原样自曝且 blocker_count=0。
 *   验收铁律：五类预加载 flag 全检出；白名单裸模块（框架自身 -r ts-node/register）不误伤；
 *   spawn 剥离保留无害项；回执命令注入特征命中实锤原文；预加载在场 preflight 必 BLOCKER。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  scanNodeOptionsValue,
  scanPreloadTokens,
  sanitizeSpawnEnv,
  scanCommandForPreloadInjection,
  runProcessIntegrityPreflight,
  stripTrustAnchorEnv,
} from '../../scripts/utils/process-integrity';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

test('十轮 P0：stripTrustAnchorEnv 大小写不敏感——小写/混合大小写信任锚键同样剥离（Windows 绕过封堵）', () => {
  const { env, stripped } = stripTrustAnchorEnv({
    MAISON_HMAC_GOAL_CHECKPOINT: 'k1',
    maison_hmac_goal_checkpoint: 'k2',
    Maison_Hmac_Foo: 'k3',
    maison_trust_registry: '/r',
    MAISON_GOAL_CHECKPOINT_DIR: '/cp',
    maison_goal_checkpoint_dir: '/cp2',
    PATH: '/usr/bin',
    MAISON_GOAL_RUN_ID: 'r',
  });
  for (const k of ['MAISON_HMAC_GOAL_CHECKPOINT', 'maison_hmac_goal_checkpoint', 'Maison_Hmac_Foo', 'maison_trust_registry', 'MAISON_GOAL_CHECKPOINT_DIR', 'maison_goal_checkpoint_dir']) {
    assert.strictEqual(env[k], undefined, `信任锚键 ${k} 须剥离`);
    assert.ok(stripped.includes(k), `${k} 应记入 stripped`);
  }
  assert.strictEqual(env.PATH, '/usr/bin', 'PATH 保留');
  assert.strictEqual(env.MAISON_GOAL_RUN_ID, 'r', '非信任锚 MAISON_ 键保留');
});

test('scan_detects_all_five_preload_flags', () => {
  // cursor/codex 点名全集：--require/-r/--import/--loader/--experimental-loader（=与空格两种形态）
  const samples: Array<[string, number]> = [
    ['--require D:/evil/hook.cjs', 1],
    ['--require=./hook.cjs', 1],
    ['-r ./hook.cjs', 1],
    ['--import file:///D:/evil/hook.mjs', 1], // 实锤 .mjs 向量
    ['--loader=tsx', 1],
    ['--experimental-loader ./l.mjs', 1],
    ['--max-old-space-size=4096', 0],
    ['', 0],
  ];
  for (const [value, expected] of samples) {
    assert.strictEqual(scanNodeOptionsValue(value).length, expected, `NODE_OPTIONS="${value}"`);
  }
});

test('scan_allowlists_framework_bare_specifiers_only', () => {
  // 框架 detach 重启自身用 -r ts-node/register/transpile-only——裸模块白名单不误伤
  assert.strictEqual(scanPreloadTokens(['-r', 'ts-node/register/transpile-only']).length, 0);
  assert.strictEqual(scanPreloadTokens(['--require', 'ts-node/register']).length, 0);
  // 路径伪装白名单名（目录里含 ts-node/register 字样）必须仍检出
  assert.strictEqual(scanPreloadTokens(['-r', './ts-node/register.js']).length, 1);
  assert.strictEqual(scanPreloadTokens(['--require', 'D:/x/ts-node/register']).length, 1);
});

test('sanitize_strips_injection_keeps_benign', () => {
  const { env, stripped } = sanitizeSpawnEnv({
    NODE_OPTIONS: '--max-old-space-size=4096 --require D:/evil/hook.cjs -r ts-node/register',
    OTHER: 'x',
  });
  assert.strictEqual(stripped.length, 1, `应只剥注入项：${JSON.stringify(stripped)}`);
  assert.ok(/hook\.cjs/.test(stripped[0]));
  assert.strictEqual(env.NODE_OPTIONS, '--max-old-space-size=4096 -r ts-node/register');
  assert.strictEqual(env.OTHER, 'x');
  // 全部为注入 → 变量整体删除
  const allEvil = sanitizeSpawnEnv({ NODE_OPTIONS: '--import file:///e/h.mjs' });
  assert.ok(!('NODE_OPTIONS' in allEvil.env));
  // 干净环境 → 原样（零回归）
  const clean = sanitizeSpawnEnv({ NODE_OPTIONS: '--max-old-space-size=2048' });
  assert.strictEqual(clean.stripped.length, 0);
  assert.strictEqual(clean.env.NODE_OPTIONS, '--max-old-space-size=2048');
});

test('receipt_command_injection_hits_real_incident_line', () => {
  // 2026-07-05 回执 script_harness.command 原文（自曝注入且 blocker_count=0）
  const incident =
    "cd framework/harness && $env:NODE_OPTIONS='--require D:/1.code/SimulatedWalletForHmos/doc/features/homepage/testing/visual-diff-auto-fill.cjs'; npx ts-node harness-runner.ts --phase testing --feature homepage";
  const hits = scanCommandForPreloadInjection(incident);
  assert.ok(hits.length > 0 && /visual-diff-auto-fill\.cjs/.test(hits.join(' ')), `实锤原文必中：${JSON.stringify(hits)}`);
  // --import 变体同中
  const mjs = "$env:NODE_OPTIONS='--import file:///D:/x/visual-diff-auto-fill.mjs'; npx ts-node harness-runner.ts --phase testing";
  assert.ok(scanCommandForPreloadInjection(mjs).length > 0);
  // 干净命令与白名单 -r 不误伤
  assert.strictEqual(scanCommandForPreloadInjection('cd framework/harness; npx ts-node harness-runner.ts --phase testing --feature homepage').length, 0);
  assert.strictEqual(scanCommandForPreloadInjection('node -r ts-node/register/transpile-only scripts/goal-runner.ts --feature homepage').length, 0);
  // .node-options 旁路引用
  assert.ok(scanCommandForPreloadInjection('echo preload > .node-options; npx ts-node harness-runner.ts').length > 0);
});

test('preflight_blocks_on_env_injection_and_bypass_file', () => {
  const prev = process.env.NODE_OPTIONS;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-integ-'));
  try {
    // 干净 → PASS
    delete process.env.NODE_OPTIONS;
    let r = runProcessIntegrityPreflight({ projectRoot: root, harnessDir: root });
    assert.strictEqual(r[0].id, 'node_options_injection');
    assert.strictEqual(r[0].status, 'PASS');
    // env 注入 → BLOCKER FAIL（证据含原值）
    process.env.NODE_OPTIONS = '--require ./evil-hook.cjs';
    r = runProcessIntegrityPreflight({ projectRoot: root, harnessDir: root });
    assert.strictEqual(r[0].status, 'FAIL');
    assert.strictEqual(r[0].severity, 'BLOCKER');
    assert.ok(/evil-hook\.cjs/.test(r[0].details));
    // .node-options 旁路文件 → BLOCKER
    delete process.env.NODE_OPTIONS;
    fs.writeFileSync(path.join(root, '.node-options'), '--import ./h.mjs', 'utf-8');
    r = runProcessIntegrityPreflight({ projectRoot: root, harnessDir: root });
    assert.strictEqual(r[0].status, 'FAIL');
    assert.ok(/\.node-options/.test(r[0].details));
    fs.rmSync(path.join(root, '.node-options'));
    // .npmrc node-options 预加载 → BLOCKER；无预加载的 .npmrc 不误伤
    fs.writeFileSync(path.join(root, '.npmrc'), 'node-options=--require ./h.cjs\n', 'utf-8');
    r = runProcessIntegrityPreflight({ projectRoot: root, harnessDir: root });
    assert.strictEqual(r[0].status, 'FAIL');
    fs.writeFileSync(path.join(root, '.npmrc'), 'registry=https://registry.npmmirror.com\n', 'utf-8');
    r = runProcessIntegrityPreflight({ projectRoot: root, harnessDir: root });
    assert.strictEqual(r[0].status, 'PASS');
  } finally {
    if (prev === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = prev;
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
