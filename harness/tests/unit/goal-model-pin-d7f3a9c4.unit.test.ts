// ============================================================================
// goal-model-pin-d7f3a9c4.unit.test.ts — 显式 --adapter-model 模型钉（plan d7f3a9c4 t1/t2）
// ----------------------------------------------------------------------------
// t1：五家回放 argv 逐元素（带 pin / 无 pin 零变化）、codeagent/claude 对称（带与不带
//      pin 各断言一次）、CLI 校验正反例、chrys/generic fail-fast、三个 headless 调用点。
// t2：resolveFinalModelPin 单点裁决授权矩阵（fresh/manifest/resume/force-resume/
//      successor/换 adapter+模型 双 override）、身份哈希有键/无键、篡改 drift、
//      旧 manifest 无键兼容、加载 shape 校验。
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';
import {
  defaultHeadlessInvokePlan,
  resolveHeadlessInvokePlan,
  type HeadlessInvokePlan,
} from '../../scripts/utils/agent-invoke';
import {
  normalizeAdapterModelCliValue,
  resolveFinalModelPin,
} from '../../scripts/utils/goal-manifest-cli';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  computeManifestIdentityHash,
  diffManifestIdentityFields,
  loadGoalManifestFromRun,
  validateAdapterModelPinValue,
  writeGoalManifest,
} from '../../scripts/utils/goal-manifest';
import { resolveManifestDriftDecision, resolveManifestIdentityBaseline } from '../../scripts/goal-runner';

const unattended = {
  write_mode: 'workspace-write' as const,
  approval_mode: 'never' as const,
};

const vars = {
  PROMPT_FILE: '',
  PROMPT: 'prompt',
  SKILL_PATH: '',
  PROJECT_ROOT: '/proj',
  FRAMEWORK_ROOT: '/framework',
  FEATURE: 'demo',
  PHASE: 'spec',
};

const structuredCap = { tool_event_provenance: 'structured_events' as const };

function planArgv(adapter: string, pin?: string): string[] {
  const plan: HeadlessInvokePlan = resolveHeadlessInvokePlan(
    adapter,
    structuredCap as never,
    unattended,
    'prompt',
    vars,
    pin,
  );
  // argv[0] 是解析后的 binary 绝对路径（attachResolvedBinary）——断言旗标序列用 slice(1)。
  return plan.argv.slice(1);
}

function defaultArgv(adapter: string, pin?: string): string[] {
  return defaultHeadlessInvokePlan(adapter, unattended, 'probe', 'structured_events', pin).argv;
}

const cases: Array<{ name: string; run: () => void }> = [
  // ------------------------- t1：CLI 校验（正反例） -------------------------
  {
    name: 't1 CLI 校验：trim/非空/≤128/无控制字符 正反例；未提供返回 undefined',
    run: () => {
      assert.strictEqual(normalizeAdapterModelCliValue(undefined), undefined);
      assert.strictEqual(normalizeAdapterModelCliValue('  gpt-4o  '), 'gpt-4o');
      assert.strictEqual(normalizeAdapterModelCliValue('x'.repeat(128)), 'x'.repeat(128));
      assert.throws(() => normalizeAdapterModelCliValue(''), /trim 后为空/);
      assert.throws(() => normalizeAdapterModelCliValue('   '), /trim 后为空/);
      assert.throws(() => normalizeAdapterModelCliValue('x'.repeat(129)), /≤128/);
      assert.throws(() => normalizeAdapterModelCliValue('a\u0000b'), /控制字符/);
      assert.throws(() => normalizeAdapterModelCliValue('a\u001Fb'), /控制字符/);
      assert.throws(() => normalizeAdapterModelCliValue(true as never), /字符串值参数/);
    },
  },

  // ------------------------- t1：五家带 pin argv 逐元素 -------------------------
  {
    name: 't1 codex 带 pin：exec --model <v> --sandbox danger-full-access（审批旗标前置）',
    run: () => {
      // plan a8e5c3f9 t2：headless 恒 danger-full-access（不再随 manifest write_mode 摇摆）。
      assert.deepStrictEqual(planArgv('codex', 'gpt-4o'), [
        '--ask-for-approval', 'never', 'exec', '--model', 'gpt-4o', '--sandbox', 'danger-full-access',
      ]);
    },
  },
  {
    name: 't1 claude 带 pin：claudeArgv 尾追加 --model <v>',
    run: () => {
      const argv = planArgv('claude', 'gpt-4o');
      assert.strictEqual(argv.slice(-2).join(' '), '--model gpt-4o');
      // plan a8e5c3f9 t1：bypass 取代 dontAsk。
      assert(argv.includes('--dangerously-skip-permissions'), argv.join(' '));
    },
  },
  {
    name: 't1 cursor 带 pin：-p --force --trust --model <v>',
    run: () => {
      const argv = planArgv('cursor', 'gpt-4o');
      assert.deepStrictEqual(argv.slice(-3), ['--trust', '--model', 'gpt-4o']);
      assert.strictEqual(argv[0], '-p');
      assert.strictEqual(argv[1], '--force');
    },
  },
  {
    name: 't1 opencode 带 pin：run ... -m <v>',
    run: () => {
      const argv = planArgv('opencode', 'gpt-4o');
      assert.deepStrictEqual(argv.slice(-2), ['-m', 'gpt-4o']);
      assert.strictEqual(argv[0], 'run');
      assert.strictEqual(argv[1], '--dangerously-skip-permissions');
    },
  },
  {
    name: 't1 codeagent 带 pin：复用 claude argv（--model 注入），仅 binary 不同',
    run: () => {
      const ca = planArgv('codeagent', 'gpt-4o');
      const cl = planArgv('claude', 'gpt-4o');
      assert.deepStrictEqual(ca, cl, 'codeagent 与 claude 旗标须逐项同构（仅 argv[0] binary 不同）');
      assert(ca.includes('--model') && ca.includes('gpt-4o'), ca.join(' '));
    },
  },

  // ------------------------- t1：无 pin 五家 argv 零变化 -------------------------
  {
    name: 't1 无 pin：五家 argv 无 model 旗标且结构与基线一致',
    run: () => {
      assert.deepStrictEqual(planArgv('codex'), [
        '--ask-for-approval', 'never', 'exec', '--sandbox', 'danger-full-access',
      ]);
      const claude = planArgv('claude');
      assert(!claude.includes('--model'), claude.join(' '));
      assert(claude.includes('--dangerously-skip-permissions'), claude.join(' '));
      const cursor = planArgv('cursor');
      assert(!cursor.includes('--model'), cursor.join(' '));
      assert.deepStrictEqual(cursor.slice(0, 3), ['-p', '--force', '--trust']);
      const opencode = planArgv('opencode');
      assert(!opencode.includes('-m') && !opencode.includes('--model'), opencode.join(' '));
      assert.deepStrictEqual(opencode.slice(0, 3), ['run', '--dangerously-skip-permissions', '--dir']);
      const ca = planArgv('codeagent');
      assert(!ca.includes('--model'), ca.join(' '));
    },
  },

  // ------------------------- t1：codeagent/claude 对称（带与不带 pin 各一） -------------------------
  {
    name: 't1 codeagent/claude 对称：带 pin 与不带 pin 各断言一次（仅 argv[0] 不同）',
    run: () => {
      const withPinCa = defaultArgv('codeagent', 'gpt-4o');
      const withPinCl = defaultArgv('claude', 'gpt-4o');
      assert.notStrictEqual(withPinCa[0], withPinCl[0], 'argv[0] 须仅二进制名不同');
      assert.notStrictEqual(withPinCa[0], 'claude', 'codeagent 首元素不得是 claude');
      assert.deepStrictEqual(withPinCa.slice(1), withPinCl.slice(1), '带 pin 须逐项同构');
      const noPinCa = defaultArgv('codeagent');
      const noPinCl = defaultArgv('claude');
      assert.notStrictEqual(noPinCa[0], noPinCl[0], 'argv[0] 须仅二进制名不同');
      assert.deepStrictEqual(noPinCa.slice(1), noPinCl.slice(1), '不带 pin 须逐项同构');
      assert(!noPinCa.includes('--model'), noPinCa.join(' '));
      assert(!noPinCl.includes('--model'), noPinCl.join(' '));
    },
  },

  // ------------------------- t1：三个 headless 调用点 -------------------------
  {
    name: 't1 调用点：resolveHeadlessInvokePlan 带 pin 注入（正式 phase 与金丝雀共用），不带 pin 无 model 旗标（binary-gate 构造）',
    run: () => {
      // (a)/(b)：带 pin 走 resolveHeadlessInvokePlan → 注入 model 旗标
      const withPin = resolveHeadlessInvokePlan('claude', structuredCap as never, unattended, 'p', vars, 'gpt-4o');
      assert(withPin.argv.includes('--model') && withPin.argv.includes('gpt-4o'), withPin.argv.join(' '));
      // (c)：binary-gate 的纯 plan 构造刻意不带 pin → 无 model 旗标
      const noPin = resolveHeadlessInvokePlan('claude', structuredCap as never, unattended, 'p', vars);
      assert(!noPin.argv.includes('--model'), noPin.argv.join(' '));
    },
  },
  {
    name: 't1 调用点：runGoalPreflight 的 binary-gate 构造不含 model 旗标（源码接线断言）',
    run: () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../scripts/utils/goal-preflight.ts'),
        'utf-8',
      );
      // (c) runGoalPreflight L232 plan 构造：7 参（无 modelPin；第 6 参 undefined 显式、
      // 第 7 参 session resolved binary——c4e8a1f7 T1a 新增，仍刻意不带 pin）
      const preflightCall = src.match(/resolveHeadlessInvokePlan\(\s*adapter,\s*cap\.capability!,\s*manifest\.unattended,\s*vars\.PROMPT,\s*vars,\s*undefined,\s*sessionBinary\.binary,\s*\)/);
      assert(preflightCall, 'runGoalPreflight 的 binary-gate plan 构造应刻意不带 modelPin（无 model 旗标；session binary 注入）');
      // (b) runVisionCanaryProbe L386 plan 构造：7 参（带 manifest.adapter_model_pin.value + session binary）
      const probeCall = src.match(/resolveHeadlessInvokePlan\(\s*adapter,\s*cap\.capability,\s*manifest\.unattended,\s*prompt,\s*vars,\s*manifest\.adapter_model_pin\?\.value,\s*input\.resolvedBinary,\s*\)/);
      assert(probeCall, 'runVisionCanaryProbe 的 headless plan 构造应带 manifest.adapter_model_pin.value + resolvedBinary（无 model 旗标）');
    },
  },

  // ------------------------- t2：chrys/generic fail-fast -------------------------
  {
    name: 't2 chrys/generic 传 pin（CLI flag 或继承的 manifest pin）即 BLOCKER；未传 pin 保持现状放行',
    run: () => {
      for (const adapter of ['chrys', 'generic']) {
        const cliBlocked = resolveFinalModelPin({
          cliValue: 'gpt-4o',
          effectiveAdapter: adapter,
          originalAdapter: adapter,
          manifestPin: undefined,
          isResume: false,
          hasManifestFlag: false,
          isSuccessor: false,
          overrideManifest: false,
          overrideAdapter: false,
        });
        assert.strictEqual(cliBlocked.ok, false, `${adapter} 传 pin 应 BLOCKER`);
        assert((cliBlocked as { message: string }).message.includes('不支持'), (cliBlocked as { message: string }).message);
        // codex P1：manifest（继承/加载）自带 pin、CLI 不传 → 同样 BLOCKER（argv 无法回放）
        const inheritedBlocked = resolveFinalModelPin({
          cliValue: undefined,
          effectiveAdapter: adapter,
          originalAdapter: adapter,
          manifestPin: { adapter, value: 'gpt-4o' },
          isResume: true,
          hasManifestFlag: false,
          isSuccessor: false,
          overrideManifest: false,
          overrideAdapter: false,
        });
        assert.strictEqual(inheritedBlocked.ok, false, `${adapter} 继承 manifest pin 应 BLOCKER`);
        const ok = resolveFinalModelPin({
          cliValue: undefined,
          effectiveAdapter: adapter,
          originalAdapter: adapter,
          manifestPin: undefined,
          isResume: false,
          hasManifestFlag: false,
          isSuccessor: false,
          overrideManifest: false,
          overrideAdapter: false,
        });
        assert.deepStrictEqual(ok, { ok: true, pin: undefined });
      }
    },
  },

  // ------------------------- t2：授权矩阵 -------------------------
  {
    name: 't2 fresh 普通启动：直接接受 --adapter-model',
    run: () => {
      const r = resolveFinalModelPin({
        cliValue: 'gpt-4o', effectiveAdapter: 'claude', isResume: false,
        hasManifestFlag: false, isSuccessor: false, overrideManifest: false, overrideAdapter: false,
      });
      assert.deepStrictEqual(r, { ok: true, pin: { adapter: 'claude', value: 'gpt-4o' } });
    },
  },
  {
    name: 't2 fresh + --manifest：同值幂等；新增/不同值须 --override-manifest',
    run: () => {
      const base = {
        effectiveAdapter: 'claude', isResume: false, hasManifestFlag: true, isSuccessor: false,
        overrideAdapter: false,
      };
      const idem = resolveFinalModelPin({
        ...base, cliValue: 'gpt-4o', manifestPin: { adapter: 'claude', value: 'gpt-4o' }, overrideManifest: false,
      });
      assert(idem.ok && idem.pin?.value === 'gpt-4o', JSON.stringify(idem));
      const diffNoOv = resolveFinalModelPin({
        ...base, cliValue: 'sonnet', manifestPin: { adapter: 'claude', value: 'gpt-4o' }, overrideManifest: false,
      });
      assert.strictEqual(diffNoOv.ok, false);
      const addNoOv = resolveFinalModelPin({
        ...base, cliValue: 'sonnet', manifestPin: undefined, overrideManifest: false,
      });
      assert.strictEqual(addNoOv.ok, false);
      const diffOv = resolveFinalModelPin({
        ...base, cliValue: 'sonnet', manifestPin: { adapter: 'claude', value: 'gpt-4o' }, overrideManifest: true,
      });
      assert(diffOv.ok && diffOv.pin?.value === 'sonnet', JSON.stringify(diffOv));
    },
  },
  {
    name: 't2 resume：不传=用冻结 pin；同值幂等；不同值必须 --override-manifest；--force-resume 不绕过',
    run: () => {
      const base = {
        effectiveAdapter: 'claude', isResume: true, hasManifestFlag: false, isSuccessor: false,
        manifestPin: { adapter: 'claude', value: 'gpt-4o' }, overrideAdapter: false,
      };
      const frozen = resolveFinalModelPin({ ...base, cliValue: undefined, overrideManifest: false });
      assert.deepStrictEqual(frozen, { ok: true, pin: { adapter: 'claude', value: 'gpt-4o' } });
      const idem = resolveFinalModelPin({ ...base, cliValue: 'gpt-4o', overrideManifest: false });
      assert(idem.ok, JSON.stringify(idem));
      const diffNoOv = resolveFinalModelPin({ ...base, cliValue: 'sonnet', overrideManifest: false });
      assert.strictEqual(diffNoOv.ok, false);
      const diffOv = resolveFinalModelPin({ ...base, cliValue: 'sonnet', overrideManifest: true });
      assert(diffOv.ok && diffOv.pin?.value === 'sonnet', JSON.stringify(diffOv));
    },
  },
  {
    name: 't2 adapter 变了（以 originalAdapter 判定）但未给新模型 → BLOCKER',
    run: () => {
      const r = resolveFinalModelPin({
        cliValue: undefined, effectiveAdapter: 'cursor', originalAdapter: 'claude',
        manifestPin: { adapter: 'claude', value: 'gpt-4o' },
        isResume: true, hasManifestFlag: false, isSuccessor: false,
        overrideManifest: false, overrideAdapter: false,
      });
      assert.strictEqual(r.ok, false);
      assert((r as { message: string }).message.includes('adapter'), (r as { message: string }).message);
    },
  },
  {
    name: 't2 resume 同时换 adapter 与模型：--override-adapter 与 --override-manifest 都必须有',
    run: () => {
      const base = {
        effectiveAdapter: 'cursor', originalAdapter: 'claude', isResume: true,
        hasManifestFlag: false, isSuccessor: false,
        cliValue: 'sonnet', manifestPin: { adapter: 'claude', value: 'gpt-4o' },
      };
      const neither = resolveFinalModelPin({ ...base, overrideManifest: false, overrideAdapter: false });
      assert.strictEqual(neither.ok, false);
      const onlyAdapter = resolveFinalModelPin({ ...base, overrideManifest: false, overrideAdapter: true });
      assert.strictEqual(onlyAdapter.ok, false);
      const onlyManifest = resolveFinalModelPin({ ...base, overrideManifest: true, overrideAdapter: false });
      assert.strictEqual(onlyManifest.ok, false);
      const both = resolveFinalModelPin({ ...base, overrideManifest: true, overrideAdapter: true });
      assert(both.ok && both.pin?.adapter === 'cursor' && both.pin?.value === 'sonnet', JSON.stringify(both));
    },
  },
  {
    name: 't2 codex P1：无旧 pin 的 resume 换 adapter+新增 pin 也须双 override（不得仅凭 --override-manifest 绕过）',
    run: () => {
      const base = {
        effectiveAdapter: 'cursor', originalAdapter: 'claude', isResume: true,
        hasManifestFlag: false, isSuccessor: false,
        cliValue: 'sonnet', manifestPin: undefined,
      };
      const onlyManifest = resolveFinalModelPin({ ...base, overrideManifest: true, overrideAdapter: false });
      assert.strictEqual(onlyManifest.ok, false, '无旧 pin 时缺 --override-adapter 仍须 BLOCKER');
      const both = resolveFinalModelPin({ ...base, overrideManifest: true, overrideAdapter: true });
      assert(both.ok && both.pin?.adapter === 'cursor' && both.pin?.value === 'sonnet', JSON.stringify(both));
    },
  },
  {
    name: 't2 successor 出生：默认继承源 pin；显式出生输入覆盖且不要求 --override-manifest；换 adapter 须 --override-adapter',
    run: () => {
      const bc = { isResume: false, hasManifestFlag: false, isSuccessor: true };
      const inherit = resolveFinalModelPin({
        ...bc, cliValue: undefined, effectiveAdapter: 'claude', originalAdapter: 'claude',
        manifestPin: { adapter: 'claude', value: 'gpt-4o' },
        overrideManifest: false, overrideAdapter: false,
      });
      assert.deepStrictEqual(inherit, { ok: true, pin: { adapter: 'claude', value: 'gpt-4o' } });
      const override = resolveFinalModelPin({
        ...bc, cliValue: 'sonnet', effectiveAdapter: 'claude', originalAdapter: 'claude',
        manifestPin: { adapter: 'claude', value: 'gpt-4o' },
        overrideManifest: false, overrideAdapter: false,
      });
      assert(override.ok && override.pin?.value === 'sonnet', JSON.stringify(override));
      const noAdapter = resolveFinalModelPin({
        ...bc, cliValue: 'sonnet', effectiveAdapter: 'cursor', originalAdapter: 'claude',
        manifestPin: { adapter: 'claude', value: 'gpt-4o' },
        overrideManifest: false, overrideAdapter: false,
      });
      assert.strictEqual(noAdapter.ok, false);
      assert((noAdapter as { message: string }).message.includes('--override-adapter'),
        '真正换 adapter 的分支须指引 --override-adapter');
      const withAdapter = resolveFinalModelPin({
        ...bc, cliValue: 'sonnet', effectiveAdapter: 'cursor', originalAdapter: 'claude',
        manifestPin: { adapter: 'claude', value: 'gpt-4o' },
        overrideManifest: false, overrideAdapter: true,
      });
      assert(withAdapter.ok && withAdapter.pin?.adapter === 'cursor', JSON.stringify(withAdapter));
    },
  },
  {
    name: 't2 codex P2：successor adapter 未变 + 继承 pin mismatch + 显式 CLI pin + 无任何 override → PASS（出生输入修复坏 pin）',
    run: () => {
      const bc = { isResume: false, hasManifestFlag: false, isSuccessor: true };
      const r = resolveFinalModelPin({
        ...bc, cliValue: 'sonnet', effectiveAdapter: 'claude', originalAdapter: 'claude',
        manifestPin: { adapter: 'cursor', value: 'cursor-model' },
        overrideManifest: false, overrideAdapter: false,
      });
      assert(r.ok && r.pin?.adapter === 'claude' && r.pin?.value === 'sonnet', JSON.stringify(r));
      // 反向：无 CLI 出生输入时，继承 pin mismatch 仍须 BLOCKER（不静默回放 cursor 模型给 claude）
      const blocked = resolveFinalModelPin({
        ...bc, cliValue: undefined, effectiveAdapter: 'claude', originalAdapter: 'claude',
        manifestPin: { adapter: 'cursor', value: 'cursor-model' },
        overrideManifest: false, overrideAdapter: false,
      });
      assert.strictEqual(blocked.ok, false, '无 CLI 出生输入时继承 pin mismatch 须 BLOCKER');
      const msg = (blocked as { message: string }).message;
      assert(msg.includes('--adapter-model'), msg);
      assert(!msg.includes('--override-adapter'), `纯 pin 损坏话术不得要求 --override-adapter：${msg}`);
      assert(!msg.includes('换 adapter'), `纯 pin 损坏话术不得误称换 adapter：${msg}`);
    },
  },
  {
    name: 't2 codex P1：无源 pin 的 successor 换 adapter 须 --override-adapter（不得静默换 adapter+模型）',
    run: () => {
      const bc = { isResume: false, hasManifestFlag: false, isSuccessor: true };
      const noAdapter = resolveFinalModelPin({
        ...bc, cliValue: 'sonnet', effectiveAdapter: 'cursor', originalAdapter: 'claude',
        manifestPin: undefined, overrideManifest: false, overrideAdapter: false,
      });
      assert.strictEqual(noAdapter.ok, false, '无源 pin 时 successor 换 adapter 缺 --override-adapter 须 BLOCKER');
      const withAdapter = resolveFinalModelPin({
        ...bc, cliValue: 'sonnet', effectiveAdapter: 'cursor', originalAdapter: 'claude',
        manifestPin: undefined, overrideManifest: false, overrideAdapter: true,
      });
      assert(withAdapter.ok && withAdapter.pin?.adapter === 'cursor', JSON.stringify(withAdapter));
    },
  },
  {
    name: 't2 codex P1：successor 后续 resume 不再享受出生特权——换模型须 --override-manifest',
    run: () => {
      // successor run 已经存在，现在 resume 它：isSuccessor=true 且 isResume=true
      const r = resolveFinalModelPin({
        cliValue: 'sonnet', effectiveAdapter: 'claude', originalAdapter: 'claude',
        manifestPin: { adapter: 'claude', value: 'gpt-4o' },
        isResume: true, hasManifestFlag: false, isSuccessor: true,
        overrideManifest: false, overrideAdapter: false,
      });
      assert.strictEqual(r.ok, false, 'successor 后续 resume 换模型也必须 --override-manifest（出生特权不延续）');
      const authorized = resolveFinalModelPin({
        cliValue: 'sonnet', effectiveAdapter: 'claude', originalAdapter: 'claude',
        manifestPin: { adapter: 'claude', value: 'gpt-4o' },
        isResume: true, hasManifestFlag: false, isSuccessor: true,
        overrideManifest: true, overrideAdapter: false,
      });
      assert(authorized.ok && authorized.pin?.value === 'sonnet', JSON.stringify(authorized));
    },
  },
  {
    name: 't2 codex P1：pinAdapterMismatch——run 未换 adapter 但 frozen pin.adapter≠effective 时，无新 CLI pin 即 BLOCKER',
    run: () => {
      // effective/claude 原 adapter=claude，但 manifest pin 声称 cursor（codex 复现用例）
      const blocked = resolveFinalModelPin({
        cliValue: undefined, effectiveAdapter: 'claude', originalAdapter: 'claude',
        manifestPin: { adapter: 'cursor', value: 'cursor-model' },
        isResume: true, hasManifestFlag: false, isSuccessor: false,
        overrideManifest: false, overrideAdapter: false,
      });
      assert.strictEqual(blocked.ok, false, 'pin.adapter≠effective 且无新 CLI pin 须 BLOCKER');
      assert((blocked as { message: string }).message.includes('不一致'), (blocked as { message: string }).message);
      // 有 CLI pin → 按授权规则替换（resume 新值须 --override-manifest）
      const replaceNoOv = resolveFinalModelPin({
        cliValue: 'sonnet', effectiveAdapter: 'claude', originalAdapter: 'claude',
        manifestPin: { adapter: 'cursor', value: 'cursor-model' },
        isResume: true, hasManifestFlag: false, isSuccessor: false,
        overrideManifest: false, overrideAdapter: false,
      });
      assert.strictEqual(replaceNoOv.ok, false, '替换 mismatched pin 也须 --override-manifest');
      const replaceOv = resolveFinalModelPin({
        cliValue: 'sonnet', effectiveAdapter: 'claude', originalAdapter: 'claude',
        manifestPin: { adapter: 'cursor', value: 'cursor-model' },
        isResume: true, hasManifestFlag: false, isSuccessor: false,
        overrideManifest: true, overrideAdapter: false,
      });
      assert(replaceOv.ok && replaceOv.pin?.adapter === 'claude' && replaceOv.pin?.value === 'sonnet', JSON.stringify(replaceOv));
    },
  },
  {
    name: 't2 codex P1：resume 换 adapter+模型（local 已被切走等组合）——originalAdapter 与 effective 不同即须双 override',
    run: () => {
      // codex 绕过场景：原 run adapter=claude，local 已被别窗切成 cursor，
      // resume --adapter cursor --override-manifest --adapter-model m，缺 --override-adapter
      const base = {
        effectiveAdapter: 'cursor', isResume: true, hasManifestFlag: false, isSuccessor: false,
        cliValue: 'm', manifestPin: undefined,
      };
      const bypass = resolveFinalModelPin({ ...base, originalAdapter: 'claude', overrideManifest: true, overrideAdapter: false });
      assert.strictEqual(bypass.ok, false, '换 adapter+模型缺 --override-adapter 不得仅凭 --override-manifest 放行');
      const ok = resolveFinalModelPin({ ...base, originalAdapter: 'claude', overrideManifest: true, overrideAdapter: true });
      assert(ok.ok && ok.pin?.adapter === 'cursor', JSON.stringify(ok));
    },
  },

  // ------------------------- t2：身份哈希 + 篡改 + 旧 manifest 兼容 -------------------------
  {
    name: 't2 身份哈希：adapter_model_pin 键在场即入、无键不入（旧 manifest 兼容）',
    run: () => {
      const mk = (pin?: unknown): ReturnType<typeof buildGoalManifestFromInput> =>
        buildGoalManifestFromInput(
          {
            feature: 'demo',
            adapter: 'claude',
            unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
            ...(pin !== undefined ? { adapter_model_pin: pin } : {}),
          },
          { projectRoot: '/proj' },
        );
      const noKey = mk(undefined);
      const withKey = mk({ adapter: 'claude', value: 'gpt-4o' });
      const fieldsNo = computeManifestIdentityFields(noKey);
      const fieldsWith = computeManifestIdentityFields(withKey);
      assert(!('adapter_model_pin' in fieldsNo), '无键时不得入身份字段');
      assert('adapter_model_pin' in fieldsWith, '有键时须入身份字段');
      assert(fieldsNo.adapter_model_pin === undefined);
      assert(fieldsWith.adapter_model_pin !== undefined);
      // 篡改 value → 字段指纹变化（停机期改 value 命中既有 drift）
      const tampered = mk({ adapter: 'claude', value: 'sonnet' });
      const fieldsTampered = computeManifestIdentityFields(tampered);
      assert.notStrictEqual(fieldsTampered.adapter_model_pin, fieldsWith.adapter_model_pin);
    },
  },
  {
    name: 't2 加载 shape 校验：value 空/超长/控制字符、adapter 空/未知/非字符串 违规拒绝',
    run: () => {
      assert.throws(() => validateAdapterModelPinValue('', 'gpt-4o'), /adapter 必填/);
      assert.throws(() => validateAdapterModelPinValue('claude', ''), /value 必填/);
      assert.throws(() => validateAdapterModelPinValue('claude', 'x'.repeat(129)), /≤128/);
      assert.throws(() => validateAdapterModelPinValue('claude', 'a\u0000b'), /控制字符/);
      assert.doesNotThrow(() => validateAdapterModelPinValue('claude', 'gpt-4o'));
      assert.throws(() => validateAdapterModelPinValue('not-real', 'gpt-4o'), /已知集/);
      // codex P2：on-disk JSON 的不可信值（未知 adapter / 非字符串）须运行时拒绝
      assert.throws(
        () => buildGoalManifestFromInput({ feature: 'd', adapter: 'claude', adapter_model_pin: 'not-an-object' }, { projectRoot: '/' }),
        /必须为对象/,
      );
      assert.throws(
        () => buildGoalManifestFromInput({ feature: 'd', adapter: 'claude', adapter_model_pin: { adapter: 'not-real', value: 'm' } }, { projectRoot: '/' }),
        /已知集/,
      );
      assert.throws(
        () => buildGoalManifestFromInput({ feature: 'd', adapter: 'claude', adapter_model_pin: { adapter: 123, value: {} } }, { projectRoot: '/' }),
        /adapter 必填/,
      );
      assert.throws(
        () => buildGoalManifestFromInput({ feature: 'd', adapter: 'claude', adapter_model_pin: { adapter: 'claude', value: 42 } }, { projectRoot: '/' }),
        /value 必填/,
      );
    },
  },
  {
    name: 't2 codex P2：真实 writer + run_start 出生基线 + 篡改 pin 后经 resolveManifestDriftDecision 命中 manifest_identity_drift',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-pin-drift-'));
      const runId = '20260810T000000Z-abc123';
      const featuresDir = 'doc/features';
      const birth = buildGoalManifestFromInput(
        {
          feature: 'demo', adapter: 'claude', run_id: runId,
          unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
          adapter_model_pin: { adapter: 'claude', value: 'gpt-4o' },
        },
        { projectRoot: root, featuresDir, runId },
      );
      writeGoalManifest(birth, root); // 真实 writer
      const birthFields = computeManifestIdentityFields(birth);
      assert('adapter_model_pin' in birthFields, '出生基线须含 adapter_model_pin');

      // 真实 run_start 事件承载出生基线（与生产同 shape：manifest_identity_fields）
      const eventsAbs = path.join(root, birth.report_dir, 'events.jsonl');
      fs.mkdirSync(path.dirname(eventsAbs), { recursive: true });
      fs.writeFileSync(
        eventsAbs,
        JSON.stringify({ type: 'run_start', manifest_identity_fields: birthFields }) + '\n',
        'utf-8',
      );
      const baseline = resolveManifestIdentityBaseline([
        { type: 'run_start', manifest_identity_fields: birthFields },
      ]);
      assert(baseline !== null && 'adapter_model_pin' in baseline, 'run_start 折叠出的出生基线须含 adapter_model_pin');

      // 停机篡改 on-disk manifest 的 pin.value
      const manifestAbs = path.join(root, birth.report_dir, 'manifest.json');
      const raw = JSON.parse(fs.readFileSync(manifestAbs, 'utf-8'));
      raw.adapter_model_pin.value = 'sonnet';
      fs.writeFileSync(manifestAbs, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
      const tampered = loadGoalManifestFromRun(root, runId, { feature: 'demo', featuresDir });
      const currentFields = computeManifestIdentityFields(tampered);

      const drift = resolveManifestDriftDecision({
        currentFields,
        currentHash: computeManifestIdentityHash(tampered),
        birthFields: baseline,
        overrides: { 'override-manifest': false, 'override-start': false, 'override-end': false },
        fidelityTransitionFields: new Set<string>(),
      });
      assert(drift.halt !== null, JSON.stringify(drift));
      assert(drift.halt!.changedFields.includes('adapter_model_pin'), drift.halt!.changedFields.join(','));
      assert.deepStrictEqual(
        diffManifestIdentityFields(birthFields, currentFields),
        ['adapter_model_pin'],
        diffManifestIdentityFields(birthFields, currentFields).join(','),
      );
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch { /* best-effort */ }
    },
  },
  {
    name: 't2 codex P2：真实 loader 拒绝非法 shape（写盘后 loadGoalManifestFromRun 抛错）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-pin-badshape-'));
      const runId = '20260810T000000Z-abc125';
      const featuresDir = 'doc/features';
      const birth = buildGoalManifestFromInput(
        {
          feature: 'demo', adapter: 'claude', run_id: runId,
          unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
        },
        { projectRoot: root, featuresDir, runId },
      );
      writeGoalManifest(birth, root);
      // 覆写为非法 shape（未知 adapter / 非字符串 / 未知数组）
      const manifestAbs = path.join(root, birth.report_dir, 'manifest.json');
      for (const bad of [
        { adapter_model_pin: { adapter: 'not-real', value: 'm' } },
        { adapter_model_pin: { adapter: 123, value: {} } },
        { adapter_model_pin: { adapter: 'claude', value: 42 } },
        { adapter_model_pin: 'oops' },
        { adapter_model_pin: [] },
      ]) {
        const raw = JSON.parse(fs.readFileSync(manifestAbs, 'utf-8'));
        raw.adapter_model_pin = bad.adapter_model_pin;
        fs.writeFileSync(manifestAbs, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
        assert.throws(
          () => loadGoalManifestFromRun(root, runId, { feature: 'demo', featuresDir }),
          /adapter_model_pin|必须为对象|已知集|必填|字符串/,
          `应拒绝非法 shape：${JSON.stringify(bad)}`,
        );
      }
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch { /* best-effort */ }
    },
  },
  {
    name: 't1/t2 接线：applyManifestCliOverrides 之前捕获原始 adapter；dry-run 回显 pin（源码接线断言）',
    run: () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../scripts/goal-runner.ts'),
        'utf-8',
      );
      // P1：manifestAdapterBeforeCliOverrides 须在 applyManifestCliOverrides 之前声明
      const capIdx = src.indexOf('const manifestAdapterBeforeCliOverrides = manifest.adapter;');
      const applyIdx = src.indexOf('applyManifestCliOverrides(manifest, manifestArgv);');
      assert(capIdx >= 0, '须在 applyManifestCliOverrides 前捕获原始 adapter');
      assert(applyIdx >= 0);
      assert(capIdx < applyIdx, `捕获须早于 applyManifestCliOverrides（cap=${capIdx}, apply=${applyIdx}）`);
      // resolveFinalModelPin 用 manifestAdapterBeforeCliOverrides 作 originalAdapter
      assert(
        /originalAdapter: manifestAdapterBeforeCliOverrides/.test(src),
        'resolveFinalModelPin 须以 manifestAdapterBeforeCliOverrides 作 originalAdapter',
      );
      // dry-run 在 plan 输出回显 pin
      assert(/\[dry-run\] \$\{phase\} plan/.test(src), 'dry-run 应回显 phase plan');
      assert(/adapter_model_pin=\$\{manifest\.adapter_model_pin\.adapter\}/.test(src), 'dry-run 应回显 adapter_model_pin');
    },
  },
  {
    name: 't2 旧 manifest 无键兼容：无 adapter_model_pin 键时身份字段不注入、resume 无 pin',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-pin-old-'));
      const runId = '20260810T000000Z-abc124';
      const featuresDir = 'doc/features';
      const old = buildGoalManifestFromInput(
        {
          feature: 'demo', adapter: 'claude', run_id: runId,
          unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
        },
        { projectRoot: root, featuresDir, runId },
      );
      writeGoalManifest(old, root);
      const fields = computeManifestIdentityFields(old);
      assert(!('adapter_model_pin' in fields), '旧 manifest 无键时不得入身份字段集');
      const loaded = loadGoalManifestFromRun(root, runId, { feature: 'demo', featuresDir });
      assert.strictEqual(loaded.adapter_model_pin, undefined);
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch { /* best-effort */ }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}