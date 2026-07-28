// ============================================================================
// single-writer-predicate.unit.test.ts — 单写者误杀修复（b7e4d2a9 Todo 3）
// ----------------------------------------------------------------------------
// 2026-07-27 宿主实锤：cursor 工具子进程丢 MAISON_GOAL_HEADLESS 留 MAISON_GOAL_RUN_ID，
// check-spec 旧谓词（isGoalOrchestrationEnv 只看 RUNNER/HEADLESS）误判交互态直写正式
// vision 账本 → 外层按篡改 halt（假阳性）。本套钉死：
//   ① isAgentSideGoalHarness 真值表（四信号并集 × GATE）；
//   ② buildAgentSpawnEnv 顺序（合并→HEADLESS 定档→最终 strip）：extraEnv 回带
//      GATE/HMAC（含 mixed-case）被剥；HEADLESS 不可被调用方覆盖；
//   ③ check-spec 真实写入面：cursor 形态 env 只算不写；GATE=1 允许写。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isAgentSideGoalHarness } from '../../scripts/utils/phase-state';
import { buildAgentSpawnEnv } from '../../scripts/utils/agent-invoke';
import { checkVisionOutputCounterevidence } from '../../scripts/check-spec';
import { clearFrameworkConfigCache } from '../../config';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'bc-openCard';

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const GOAL_ENV_KEYS = [
  'MAISON_GOAL_RUN_ID', 'MAISON_GOAL_ATTEMPT', 'MAISON_GOAL_RUNNER',
  'MAISON_GOAL_HEADLESS', 'MAISON_GOAL_GATE_HARNESS',
] as const;

/** 在受控 goal env 组合下执行 fn（保存/清空/恢复五键） */
function withGoalEnv<T>(env: Partial<Record<(typeof GOAL_ENV_KEYS)[number], string>>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const k of GOAL_ENV_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const k of GOAL_ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function w(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

/** 本套件创建的临时根——runAll finally 统一删除（review round9 P2：测试不留 %TEMP% 垃圾） */
const tmpRoots: string[] = [];

/** 最小宿主：ui-spec 带一个无参考映射的 CJK 文本节点 + ref-elements（evidence_gap 触发形态） */
function setupHost(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'single-writer-'));
  tmpRoots.push(root);
  w(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'SwTest',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false },
    materialized_adapters: ['cursor'],
  }, null, 2));
  w(root, `doc/features/${FEATURE}/spec/ui-spec.yaml`, [
    'schema_version: "1.0"',
    'screens:',
    '  - id: add_card_home',
    '    priority: P0',
    '    ref_id: add_card_home',
    '    root:',
    '      type: navigation_frame',
    '      order: 0',
    '      children:',
    '        - id: hint_text',
    '          type: content_display',
    '          order: 0',
    '          text: "首页无映射文案"',
    '',
  ].join('\n'));
  w(root, `doc/features/${FEATURE}/spec/ref-elements.yaml`, [
    'schema_version: "1.0"',
    'elements:',
    '  - element_id: e1',
    '    screen_ref_id: add_card_home',
    '    text: "银行卡"',
    '',
  ].join('\n'));
  clearFrameworkConfigCache();
  return root;
}

function ledgerPaths(root: string): { att: string; down: string } {
  const visionDir = path.join(root, 'doc', 'features', FEATURE, 'vision');
  return {
    att: path.join(visionDir, 'artifact-attestations.jsonl'),
    down: path.join(visionDir, 'policy-downgrades.jsonl'),
  };
}

function runCounterevidence(root: string): ReturnType<typeof checkVisionOutputCounterevidence> {
  const ctx = { projectRoot: root, feature: FEATURE } as unknown as CheckContext;
  return checkVisionOutputCounterevidence(ctx);
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  try {

  run(results, '① 真值表：任一 goal 信号在场且无 GATE ⇒ agent 侧；GATE=1 ⇒ 非；零信号 ⇒ 非（交互态）', () => {
    const table: Array<{ env: Partial<Record<(typeof GOAL_ENV_KEYS)[number], string>>; expect: boolean; label: string }> = [
      { env: {}, expect: false, label: '零信号（交互态）' },
      { env: { MAISON_GOAL_RUN_ID: 'r1' }, expect: true, label: '仅 RUN_ID（cursor 实锤形态）' },
      { env: { MAISON_GOAL_ATTEMPT: 'a1' }, expect: true, label: '仅 ATTEMPT' },
      { env: { MAISON_GOAL_RUNNER: '1' }, expect: true, label: '仅 RUNNER' },
      { env: { MAISON_GOAL_HEADLESS: '1' }, expect: true, label: '仅 HEADLESS' },
      { env: { MAISON_GOAL_RUN_ID: 'r1', MAISON_GOAL_ATTEMPT: 'a1' }, expect: true, label: 'RUN_ID+ATTEMPT 无 HEADLESS/GATE' },
      { env: { MAISON_GOAL_RUN_ID: 'r1', MAISON_GOAL_GATE_HARNESS: '1' }, expect: false, label: 'RUN_ID+GATE=1（gate harness）' },
      { env: { MAISON_GOAL_HEADLESS: '1', MAISON_GOAL_GATE_HARNESS: '1' }, expect: false, label: 'HEADLESS+GATE=1' },
      { env: { MAISON_GOAL_RUN_ID: '  ' }, expect: false, label: '空白 RUN_ID 不算信号' },
    ];
    for (const t of table) {
      const got = withGoalEnv(t.env, () => isAgentSideGoalHarness());
      assert(got === t.expect, `${t.label}: 期望 ${t.expect} 实得 ${got}`);
    }
  });

  run(results, '② buildAgentSpawnEnv：父环境 stale GATE / extraEnv 回带 GATE（含 mixed-case）全剥；HMAC 回带同剥', () => {
    const base: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      MAISON_GOAL_GATE_HARNESS: '1',            // 父环境残留
      maison_hmac_goal_checkpoint: 'secret',    // 小写信任锚
    };
    const env1 = buildAgentSpawnEnv(base, { MAISON_GOAL_RUN_ID: 'r1' });
    assert(!Object.keys(env1).some(k => k.toUpperCase() === 'MAISON_GOAL_GATE_HARNESS'), '父环境 GATE 须剥离');
    assert(!Object.keys(env1).some(k => k.toUpperCase().startsWith('MAISON_HMAC_')), '小写 HMAC 须剥离');
    assert(env1.MAISON_GOAL_RUN_ID === 'r1', 'extraEnv 的 RUN_ID 须保留');

    // extraEnv 回带面（P0 关键用例：只污染父环境测不到这一面）
    const env2 = buildAgentSpawnEnv({ PATH: process.env.PATH }, {
      MAISON_GOAL_GATE_HARNESS: '1',
      Maison_Goal_Gate_Harness: '1',
      MAISON_HMAC_GOAL_CHECKPOINT: 'reinject',
      MAISON_GOAL_CHECKPOINT_DIR: 'D:/evil',
    } as Record<string, string>);
    assert(!Object.keys(env2).some(k => k.toUpperCase() === 'MAISON_GOAL_GATE_HARNESS'),
      `extraEnv 回带 GATE（含 mixed-case）须被最终 strip 剥离：${Object.keys(env2).filter(k => /gate/i.test(k)).join(',')}`);
    assert(!Object.keys(env2).some(k => k.toUpperCase().startsWith('MAISON_HMAC_')), 'extraEnv 回带 HMAC 须剥离');
    assert(!Object.keys(env2).some(k => k.toUpperCase() === 'MAISON_GOAL_CHECKPOINT_DIR'), 'extraEnv 回带 checkpoint 路径须剥离');
  });

  run(results, '② HEADLESS 角色位在 extraEnv 后强制定档：注入 ""/"0"/mixed-case 后子进程仍恰有一个大写=1', () => {
    const env = buildAgentSpawnEnv({ PATH: process.env.PATH }, {
      MAISON_GOAL_HEADLESS: '',
      maison_goal_headless: '0',
    } as Record<string, string>);
    const headlessKeys = Object.keys(env).filter(k => k.toUpperCase() === 'MAISON_GOAL_HEADLESS');
    assert(headlessKeys.length === 1 && headlessKeys[0] === 'MAISON_GOAL_HEADLESS',
      `须恰有一个大写 HEADLESS 键：${headlessKeys.join(',')}`);
    assert(env.MAISON_GOAL_HEADLESS === '1', `角色位不由调用方覆盖：实得 ${env.MAISON_GOAL_HEADLESS}`);
  });

  run(results, '③ cursor 形态 env（RUN_ID+ATTEMPT 无 HEADLESS/GATE）：反证照常计算，正式账本零写入', () => {
    const root = setupHost();
    const { att, down } = ledgerPaths(root);
    const res = withGoalEnv(
      { MAISON_GOAL_RUN_ID: 'run-x', MAISON_GOAL_ATTEMPT: 'run-x-i1' },
      () => runCounterevidence(root),
    );
    assert(res.length > 0 && res[0].details.includes('evidence_gap'),
      `反证结论须照常计算回喂：${JSON.stringify(res.map(r => ({ id: r.id, status: r.status })))}`);
    assert(!fs.existsSync(att) && !fs.existsSync(down),
      `agent 侧不得写正式账本：att=${fs.existsSync(att)} down=${fs.existsSync(down)}`);
  });

  run(results, '③ gate harness（+GATE=1）：允许写入两份正式账本', () => {
    const root = setupHost();
    const { att, down } = ledgerPaths(root);
    withGoalEnv(
      { MAISON_GOAL_RUN_ID: 'run-x', MAISON_GOAL_ATTEMPT: 'run-x-i1', MAISON_GOAL_GATE_HARNESS: '1' },
      () => runCounterevidence(root),
    );
    assert(fs.existsSync(att), 'gate harness 须写 attestation');
    assert(fs.existsSync(down), 'gate harness 须写 policy downgrade');
    const row = JSON.parse(fs.readFileSync(att, 'utf-8').split('\n').filter(Boolean)[0]) as { verdict?: string };
    assert(row.verdict === 'unverified', `attestation verdict 须为 unverified（evidence_gap）：${row.verdict}`);
  });

  run(results, '③ 非 goal 交互态（零信号）：维持既有直写行为', () => {
    const root = setupHost();
    const { att } = ledgerPaths(root);
    withGoalEnv({}, () => runCounterevidence(root));
    assert(fs.existsSync(att), '交互态写入行为不变');
  });

  return results;
  } finally {
    for (const r of tmpRoots) {
      try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
