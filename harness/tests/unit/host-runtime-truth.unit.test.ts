// ============================================================================
// host-runtime-truth.unit.test.ts — plan c4e8a1f7
// 宿主运行边界真值：实际 CLI 选择、guardian 投影、硬失败共享分类、canary 判卷 SSOT、
// requirement source provenance 与共享参考图集合、refs receipt 期望分母。
// ----------------------------------------------------------------------------
// 覆盖（对照 plan §5 提交边界 + T4 事故回归）：
//  A. Windows 解析真值（纯函数级）——where 序首个受支持形态、shim/ELF 不入选、
//     PATH walk 不跨目录偏 .exe、shadowed 诊断。
//  B. guardian containment 失败投影正反例（[maison-guardian] + ASCII marker；纯 exit2 不投影）。
//  C. 共享硬失败分类——Codex 400 信封签名；普通 exit2/无诊断不误升。
//  D. canary 判卷 SSOT——echo+尾部真答卷签、纯 echo/独立盲声明/失败 invoke 不签。
//  E. requirement source provenance——text+sources 解析、manifest 字段、successor 去重追加。
//  F. 共享参考图集合——正文显式 ∪ source 直接父目录一层；空集才回退 ux-reference；
//     外部 source 不扫描；确定性排序。
//  G. verifyVlSigningChain 期望分母=共享集合（manifest 驱动；spec 漏一张 FAIL）。
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';
import {
  probeCandidateForm,
  resolveHeadlessBinary,
  headlessBinarySpawnable,
} from '../../scripts/utils/headless-binary-resolve';
import {
  projectGuardianContainmentFailure,
} from '../../scripts/utils/agent-invoke';
import {
  resolveInvokeHardCliFailure,
  resolveCanaryCacheDecision,
  type CanaryInvocationFacts,
} from '../../scripts/utils/vision-canary';
import {
  resolveRequirementInput,
  buildGoalManifestFromInput,
  inheritSuccessorManifest,
  computeManifestIdentityFields,
} from '../../scripts/utils/goal-manifest';
import {
  resolveRequirementReferenceImages,
} from '../../scripts/utils/fidelity-shared';
import { FIXTURE_CANARY_KEY } from '../utils/canary-fixture-key';
import {
  __testing_resetGoalRunnerSeams,
  __testing_setDeviceReadinessGate,
  __testing_setInvokeAgent,
  __testing_setRepoLayout,
  __testing_setRunHarnessPhase,
  __testing_setValidateReceipt,
  buildClosureVisualEvidenceBlock,
  resolveClosureReadRequirement,
  main as goalMain,
} from '../../scripts/goal-runner';
import { setupMinimalHost } from '../helpers/goal-run-driver';
import { inferRepoLayout } from '../../repo-layout';
import { clearFrameworkConfigCache } from '../../config';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'host-runtime-truth-'));
}

function writePng(abs: string, size = 8): void {
  // 仅需"存在且是文件"——refs receipt hash 只读字节，不必是合法 PNG
  fs.writeFileSync(abs, Buffer.alloc(size, 1));
}

const CODEX_400_ENVELOPE = JSON.stringify({
  type: 'error',
  status: 400,
  error: {
    type: 'invalid_request_error',
    message: "The 'gpt-5.6-luna' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
  },
});

const FULL_ANSWER =
  'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q';

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  // ==========================================================================
  // A. Windows 解析真值（纯文件头探测 + 顺序语义）
  // ==========================================================================
  {
    name: 'A probeCandidateForm：exe/cmd/bare-native(MZ)/shim(#!)/elf 判别',
    run: () => {
      const root = mkTmp();
      try {
        const exe = path.join(root, 'a.exe'); fs.writeFileSync(exe, Buffer.from('MZ...'));
        const cmd = path.join(root, 'a.cmd'); fs.writeFileSync(cmd, '@echo off\r\n');
        const native = path.join(root, 'native'); fs.writeFileSync(native, Buffer.from('MZ\x90\x00\x03'));
        const shim = path.join(root, 'shim'); fs.writeFileSync(shim, '#!/bin/sh\nexec node "$0" "$@"\n');
        const elf = path.join(root, 'elf'); fs.writeFileSync(elf, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]));
        assert.strictEqual(probeCandidateForm(exe), 'exe');
        assert.strictEqual(probeCandidateForm(cmd), 'cmd');
        assert.strictEqual(probeCandidateForm(native), 'bare_native');
        assert.strictEqual(probeCandidateForm(shim), 'shim');
        assert.strictEqual(probeCandidateForm(elf), 'elf');
        assert.strictEqual(probeCandidateForm(path.join(root, 'missing')), 'missing');
        assert.strictEqual(headlessBinarySpawnable({ path: native, kind: 'bare' }), true);
        assert.strictEqual(headlessBinarySpawnable({ path: shim, kind: 'bare' }), false);
        assert.strictEqual(headlessBinarySpawnable({ path: elf, kind: 'bare' }), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A PATH walk：前面目录 .cmd 胜出，不再跨目录偏好后置 .exe；extensionless shim 不入选',
    run: () => {
      if (process.platform !== 'win32') return;
      const root = mkTmp();
      const dirA = path.join(root, 'a');
      const dirB = path.join(root, 'b');
      fs.mkdirSync(path.join(dirA), { recursive: true });
      fs.mkdirSync(path.join(dirB), { recursive: true });
      // dirA：npm 形态 codex.cmd + POSIX shim codex（无扩展名）
      fs.writeFileSync(path.join(dirA, 'codex.cmd'), '@echo off\r\n');
      fs.writeFileSync(path.join(dirA, 'codex'), '#!/bin/sh\nexec codex.cmd\n');
      // dirB：WindowsApps 形态 codex.exe + ELF codex
      fs.writeFileSync(path.join(dirB, 'codex.exe'), Buffer.from('MZ'));
      fs.writeFileSync(path.join(dirB, 'codex'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
      const origPath = process.env.PATH;
      const origLocal = process.env.LOCALAPPDATA;
      try {
        process.env.PATH = `${dirA};${dirB};C:\\nonexistent`;
        process.env.LOCALAPPDATA = path.join(root, 'no-local');
        const r = resolveHeadlessBinary(['codex']);
        assert.ok(r, '应解析出候选');
        assert.ok(r!.path.toLowerCase().endsWith('codex.cmd'), `应选前面目录的 codex.cmd，实得 ${r!.path}`);
        assert.strictEqual(r!.kind, 'cmd');
        // 评审 P2：shadowed 应同时含**前置 shim** 与**后置 WindowsApps 候选**（完整优先级序列）
        assert.ok(r!.shadowed?.some(s => s.includes('(unsupported:shim)')), `应含前置 shim 诊断：${JSON.stringify(r!.shadowed)}`);
        assert.ok(r!.shadowed?.some(s => s.includes('(lower-priority)')), `应含后置 lower-priority 候选：${JSON.stringify(r!.shadowed)}`);
        assert.ok((r!.shadowed?.length ?? 0) <= 10, `shadowed 全局上限 10：${r!.shadowed?.length}`);
        // 单候选 name 内：extensionless shim 自身不能当选（除非 MZ native）
        const onlyShimDir = path.join(root, 'only-shim');
        fs.mkdirSync(onlyShimDir, { recursive: true });
        fs.writeFileSync(path.join(onlyShimDir, 'tool'), '#!/bin/sh\n');
        process.env.PATH = onlyShimDir;
        const r2 = resolveHeadlessBinary(['tool']);
        assert.strictEqual(r2, null, '纯 shim 不得当选');
      } finally {
        process.env.PATH = origPath;
        if (origLocal === undefined) delete process.env.LOCALAPPDATA;
        else process.env.LOCALAPPDATA = origLocal;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A bare-native（MZ）extensionless 文件可当选（Windows 原生执行形态）',
    run: () => {
      if (process.platform !== 'win32') return;
      const root = mkTmp();
      const dir = path.join(root, 'bin');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'nativebin'), Buffer.from('MZ\x90\x00'));
      fs.writeFileSync(path.join(dir, 'shim'), '#!/bin/sh\n');
      const origPath = process.env.PATH;
      const origLocal = process.env.LOCALAPPDATA;
      try {
        process.env.PATH = `${dir};C:\\nonexistent`;
        process.env.LOCALAPPDATA = path.join(root, 'no-local');
        const r = resolveHeadlessBinary(['nativebin', 'shim']);
        assert.ok(r && r.kind === 'bare' && r.path.endsWith('nativebin'), `应选 MZ native，实得 ${JSON.stringify(r)}`);
        assert.strictEqual(headlessBinarySpawnable(r), true);
        const r2 = resolveHeadlessBinary(['shim']);
        assert.strictEqual(r2, null, '纯 shim name 无受支持候选→null');
      } finally {
        process.env.PATH = origPath;
        if (origLocal === undefined) delete process.env.LOCALAPPDATA;
        else process.env.LOCALAPPDATA = origLocal;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // B. guardian containment 失败投影
  // ==========================================================================
  {
    name: 'B guardian 投影：CreateProcess/Assign/Resume + [maison-guardian] + exit2 → spawn_error；纯 exit2 不投影',
    run: () => {
      // error 5（Access denied）事故信封：guardian stderr 含稳定的 ASCII operation marker
      const cp = projectGuardianContainmentFailure(2,
        `[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5（argv=...）\n`,
      );
      assert.ok(cp, 'CreateProcess 失败必须投影');
      assert.strictEqual(cp!.code, 'maison_guardian_containment_failed');
      const assign = projectGuardianContainmentFailure(2,
        '[maison-guardian] AssignProcessToJobObject 失败(agent 未放行): 5');
      assert.ok(assign && assign.code === 'maison_guardian_containment_failed', 'Assign 失败必须投影');
      const resume = projectGuardianContainmentFailure(2,
        '[maison-guardian] ResumeThread 失败: 6');
      assert.ok(resume && resume.code === 'maison_guardian_containment_failed', 'Resume 失败必须投影');
      // 负例：exit 2 但无 guardian 前缀 / 无 operation marker / exit≠2
      assert.strictEqual(projectGuardianContainmentFailure(2, 'error: something happened'), null);
      assert.strictEqual(projectGuardianContainmentFailure(1, '[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5'), null, 'exit≠2 不投影');
      assert.strictEqual(projectGuardianContainmentFailure(2, '[maison-guardian] 其他诊断'), null, '无稳定 operation marker 不投影');
      assert.strictEqual(projectGuardianContainmentFailure(2, 'CreateProcess error 5'), null, '无 [maison-guardian] 前缀不投影（真实 agent 也可能打类似字样）');
    },
  },
  {
    name: 'B 投影后的 spawn_error 进入共享硬失败分类（guardian 早停判定）',
    run: () => {
      const proj = projectGuardianContainmentFailure(2,
        `[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5（argv=...）`);
      const hard = resolveInvokeHardCliFailure({
        exitCode: 2,
        stdout: '',
        stderr: `[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5（argv=...）`,
        spawn_error: proj!,
      });
      assert.ok(hard && /guardian containment 建立失败/.test(hard), `应判 guardian 硬失败：${hard}`);
      // 普通内容失败：无 guardian 诊断的 exit 2 → 不硬失败（保持既有 harness/retry）
      assert.strictEqual(resolveInvokeHardCliFailure({ exitCode: 2, stdout: 'partial产物', stderr: 'some error' }), null);
    },
  },

  // ==========================================================================
  // C. 共享硬失败分类（正式 invoke 与 canary 同一 SSOT）
  // ==========================================================================
  {
    name: 'C Codex 400 结构化信封（status=400 + invalid_request_error + requires newer Codex）→ 硬失败',
    run: () => {
      // 事故信封放 stderr（codex 会话命令错误输出）
      const hard = resolveInvokeHardCliFailure({
        exitCode: 1,
        stdout: 'some progress lines',
        stderr: `${CODEX_400_ENVELOPE}\n`,
      });
      assert.ok(hard && /Codex 模型兼容硬错误/.test(hard), `应命中 400 签名：${hard}`);
      // status=400 但非 requires-newer（其他模型服务 400）不误升
      const other400 = resolveInvokeHardCliFailure({
        exitCode: 1,
        stdout: '',
        stderr: JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: 'invalid model id' } }),
      });
      assert.strictEqual(other400, null, '其他 400 不误升（签名须含 requires a newer version of Codex）');
      // exit 0 不命中
      assert.strictEqual(resolveInvokeHardCliFailure({
        exitCode: 0, stdout: '', stderr: CODEX_400_ENVELOPE,
      }), null, 'exit0 不命中');
      // 无 400 的普通模型错误不命中
      assert.strictEqual(resolveInvokeHardCliFailure({
        exitCode: 1, stdout: '', stderr: 'error: 500 Internal Server Error',
      }), null);
    },
  },
  {
    name: 'H4 集成：普通 --manifest override 时来源随 requirement 替换（旧来源清空，不污染分母）',
    run: async () => {
      const root = setupMinimalHost('reqfile-override');
      const featDir = path.join(root, 'doc', 'features', 'reqfile-override');
      const oldReqDir = path.join(featDir, 'old');
      const newReqDir = path.join(featDir, 'new');
      fs.mkdirSync(oldReqDir, { recursive: true });
      fs.mkdirSync(newReqDir, { recursive: true });
      fs.writeFileSync(path.join(oldReqDir, 'old.md'), '旧需求：参考图还原。', 'utf-8');
      fs.writeFileSync(path.join(newReqDir, 'new.md'), '新需求：布局调整。', 'utf-8');
      // 手写 manifest 文件（带旧来源）——模拟普通 --manifest override 场景
      const manifestPath = path.join(featDir, 'custom-manifest.json');
      const runId = 'run-override-0001';
      const reportDir = `doc/features/reqfile-override/goal-runs/${runId}`;
      fs.mkdirSync(path.join(root, reportDir), { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify({
        schema_version: '1.0',
        start_phase: 'spec',
        end_phase: 'spec',
        feature: 'reqfile-override',
        requirement: '旧需求：参考图还原。',
        requirement_source_files: ['doc/features/reqfile-override/old/old.md'],
        adapter: 'cursor',
        budget: { max_total_turns: 10, max_retries_per_phase: 1, wall_clock_minutes: 60, max_transient_api_retries: 3 },
        dependency_policy: { deferrable_blocking_classes: [], deferrable_failure_kinds: [], propagate_to_downstream: true },
        unattended: { write_mode: 'full-access', approval_mode: 'never' },
        run_id: runId,
        report_dir: reportDir,
        created_at: '2026-08-24T00:00:00.000Z',
      }), 'utf-8');
      const { spawnSync } = require('child_process') as typeof import('child_process');
      spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
      spawnSync('git', ['commit', '-qm', 'req'], { cwd: root, encoding: 'utf-8' });
      const prevArgv = process.argv;
      const prevCwd = process.cwd();
      const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
      try {
        __testing_setInvokeAgent((async (_p: unknown, _r: unknown, _o: unknown) => ({
          exitCode: 1, stdout: '', stderr: 'ordinary content failure', command: 'fake',
        })) as never);
        __testing_setRunHarnessPhase((async (_pr: string, _fr: string, ph: string) => ({
          exitCode: 0, timedOut: false,
        })) as never);
        __testing_setRepoLayout({ kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>);
        __testing_setDeviceReadinessGate(((_o: { phase: string }) => ({
          env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['test seam'],
        })) as never);
        __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
          status: 'passed' as const,
          receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`,
          exit_code: 0,
        })) as never);
        process.argv = [
          'node', 'goal-runner.ts',
          '--manifest', path.relative(root, manifestPath).split(path.sep).join('/'),
          '--requirement-file', path.relative(root, path.join(newReqDir, 'new.md')).split(path.sep).join('/'),
          '--override-manifest',
          '--feature', 'reqfile-override',
          '--adapter', 'cursor',
          '--foreground-ok', '--force',
        ];
        process.chdir(root);
        clearFrameworkConfigCache();
        await goalMain();
        const writtenManifest = JSON.parse(
          fs.readFileSync(path.join(root, reportDir, 'manifest.json'), 'utf-8'),
        ) as { requirement?: string; requirement_source_files?: string[] };
        assert.strictEqual(writtenManifest.requirement, '新需求：布局调整。');
        assert.deepStrictEqual(
          writtenManifest.requirement_source_files,
          ['doc/features/reqfile-override/new/new.md'],
          `普通 manifest override 后来源必须随 requirement 替换（只剩新来源），实得 ${JSON.stringify(writtenManifest.requirement_source_files)}`,
        );
      } finally {
        __testing_resetGoalRunnerSeams();
        process.argv = prevArgv;
        if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
        try { process.chdir(prevCwd); } catch { /* ignore */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  },
  {
    name: 'C formal invoke：banner stdout + unknown argument stderr → 必须硬失败（评审 P1 回归：banner 不得压签名）',
    run: () => {
      const banner = {
        exitCode: 1,
        stdout: 'Codex CLI 0.138.0\nTelemetry: off\nType /help for a list of commands.\n',
        stderr: "error: unknown argument '--unsupported'",
      };
      // 无 answerKey 旧语义（金丝雀直调）：非空 stdout 视为有效答卷 → 不命中
      assert.strictEqual(resolveInvokeHardCliFailure(banner), null, '旧语义（无 formal 标志）不命中');
      // formal invoke：banner 不算答卷 → 命中参数错误签名
      const hard = resolveInvokeHardCliFailure(banner, { formalInvoke: true });
      assert.match(hard ?? '', /参数不兼容/, `formal invoke 必须命中：${hard}`);
      // 带 answerKey 的金丝雀语义不变：banner 不压签名（既有 review P2 行为）
      assert.match(resolveInvokeHardCliFailure(banner, { answerKey: FIXTURE_CANARY_KEY }) ?? '', /参数不兼容/);
    },
  },
  {
    name: 'D2 四象限接线回归：hasVision × structured_events → closure 块 REQUIRED/unverified 正确分派（评审 P1-2）',
    run: () => {
      const refs = ['doc/features/demo/ux-reference/1-home.png'];
      // 四象限判定矩阵（纯函数）
      const quadrants: Array<{
        hasVision: boolean | undefined;
        provenance: 'none' | 'structured_events' | 'session_transcript' | undefined;
        expect: 'structured_events' | 'none';
      }> = [
        { hasVision: true, provenance: 'structured_events', expect: 'structured_events' },
        { hasVision: false, provenance: 'structured_events', expect: 'none' }, // 判盲+structured → unverified
        { hasVision: true, provenance: 'none', expect: 'none' },
        { hasVision: false, provenance: 'none', expect: 'none' },
      ];
      for (const q of quadrants) {
        const got = resolveClosureReadRequirement(q.hasVision, q.provenance);
        assert.strictEqual(got, q.expect, `quadrant hasVision=${q.hasVision} provenance=${q.provenance} → ${got}（期望 ${q.expect}）`);
        // 组合接线：判定结果直接喂 block helper，断言实际文案分派
        const block = buildClosureVisualEvidenceBlock(refs, got);
        if (q.expect === 'structured_events') {
          assert(block.includes('Mandatory read-only visual evidencing'), `structured 象限应输出 REQUIRED 块（hasVision=${q.hasVision} provenance=${q.provenance}）`);
          assert(!block.includes('honest unverified exit'), 'structured 象限不应输出 unverified 块');
        } else {
          assert(block.includes('honest unverified exit'), `非结构化象限应输出 unverified 块（hasVision=${q.hasVision} provenance=${q.provenance}）`);
          assert(!block.includes('Mandatory read-only visual evidencing'), '非结构化象限不应输出 REQUIRED 块');
        }
      }
      // 调用处接线回归（评审实锤组合：判盲 + structured 不得再被当成 structured）
      const blindStructured = resolveClosureReadRequirement(false, 'structured_events');
      assert.strictEqual(blindStructured, 'none');
      assert(!buildClosureVisualEvidenceBlock(refs, blindStructured).includes('read EVERY authoritative reference image'), '判盲+structured 不得要求逐图 Read');
    },
  },
  {
    name: 'C 共享分类对 canary 探测路径保持既有语义（resolveCanaryHardCliFailure 委托）',
    run: () => {
      const { resolveCanaryHardCliFailure } = require('../../scripts/utils/vision-canary') as typeof import('../../scripts/utils/vision-canary');
      // 既有签名：spawn_error/参数不兼容/Usage 不触发/auth 不误升
      assert.match(resolveCanaryHardCliFailure({ exitCode: 1, stdout: '', stderr: "error: unknown argument '--model'" }) ?? '', /参数不兼容/);
      assert.strictEqual(resolveCanaryHardCliFailure({ exitCode: 1, stdout: '', stderr: 'Usage: claude -p' }), null);
      assert.strictEqual(resolveCanaryHardCliFailure({ exitCode: 1, stdout: 'ActionRequiredError: quota', stderr: '' }), null);
      // 新 400 签名同样命中 canary 探测
      assert.ok(resolveCanaryHardCliFailure({ exitCode: 1, stdout: '', stderr: CODEX_400_ENVELOPE }), 'canary 探测也应命中 400 签名');
    },
  },

  // ==========================================================================
  // D. canary 判卷 SSOT（resolveCanaryCacheDecision 矩阵）
  // ==========================================================================
  {
    name: 'D prompt echo + CANNOT_SEE_IMAGE + 尾部真答卷 → valid/tool_read（可签 capability receipt）',
    run: () => {
      const echoOutput =
        '## Inline visual verification (runner-issued — REQUIRED before any vl_multimodal signing)\n' +
        'TOP_LEFT_COLOR=<color>\nTOP_RIGHT_COLOR=<color>\nBOTTOM_LEFT_COLOR=<color>\nBOTTOM_RIGHT_COLOR=<color>\n' +
        'TEXT_TOKEN=<the short alphanumeric token printed in the image>\n' +
        'If you cannot see images: output exactly CANNOT_SEE_IMAGE instead...\n' +
        '--- actual answer ---\n' +
        FULL_ANSWER + '\n';
      const decision = resolveCanaryCacheDecision(
        { stdout: echoOutput, exitCode: 0 } as CanaryInvocationFacts,
        FIXTURE_CANARY_KEY,
      );
      assert.strictEqual(decision.kind, 'valid', JSON.stringify(decision));
      if (decision.kind === 'valid') {
        assert.strictEqual(decision.classify.verdict, 'tool_read');
      }
    },
  },
  {
    name: 'D 纯 echo（占位键）或独立 CANNOT_SEE_IMAGE 或失败 invoke → 不签',
    run: () => {
      const pureEcho =
        'TOP_LEFT_COLOR=<color>\nTOP_RIGHT_COLOR=<color>\nBOTTOM_LEFT_COLOR=<color>\nBOTTOM_RIGHT_COLOR=<color>\nTEXT_TOKEN=<token>\n';
      const d1 = resolveCanaryCacheDecision({ stdout: pureEcho, exitCode: 0 }, FIXTURE_CANARY_KEY);
      assert.notStrictEqual(d1.kind, 'valid', '占位 echo 不是合法答卷');
      const blind = resolveCanaryCacheDecision({ stdout: 'CANNOT_SEE_IMAGE\n', exitCode: 0 }, FIXTURE_CANARY_KEY);
      assert.strictEqual(blind.kind, 'valid', '独立 CANNOT_SEE_IMAGE 是合法盲声明');
      if (blind.kind === 'valid') assert.strictEqual(blind.classify.verdict, 'none', '盲声明不得签 tool_read');
      const failed = resolveCanaryCacheDecision({ stdout: FULL_ANSWER, exitCode: 1 }, FIXTURE_CANARY_KEY);
      assert.strictEqual(failed.kind, 'invoke_failed', '失败 invoke 不得判卷');
    },
  },
  {
    name: 'D structured stdout：NDJSON 信封 → parseCanaryAnswer 投影终态 result 判卷（claude/codeagent 路径回归）',
    run: () => {
      const envelope = [
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'thinking...' } }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q' }),
      ].join('\n');
      const decision = resolveCanaryCacheDecision(
        { stdout: envelope, exitCode: 0, structured_stdout: true } as CanaryInvocationFacts,
        FIXTURE_CANARY_KEY,
      );
      assert.strictEqual(decision.kind, 'valid', JSON.stringify(decision));
      if (decision.kind === 'valid') assert.strictEqual(decision.classify.verdict, 'tool_read', 'structured 投影判卷不应回归');
    },
  },

  // ==========================================================================
  // E. requirement source provenance
  // ==========================================================================
  {
    name: 'E resolveRequirementInput：inline→sources=[]；file→text+项目根相对 source；项目外→绝对路径',
    run: () => {
      const root = mkTmp();
      try {
        const inline = resolveRequirementInput({ requirement: 'inline req', projectRoot: root });
        assert.strictEqual(inline.text, 'inline req');
        assert.deepStrictEqual(inline.sources, []);
        fs.mkdirSync(path.join(root, 'doc', 'features', 'f', 'req'), { recursive: true });
        fs.writeFileSync(path.join(root, 'doc', 'features', 'f', 'req', '原始需求.md'), '需求正文', 'utf-8');
        const file = resolveRequirementInput({
          requirementFile: 'doc/features/f/req/原始需求.md',
          projectRoot: root,
        });
        assert.strictEqual(file.text, '需求正文');
        assert.deepStrictEqual(file.sources, ['doc/features/f/req/原始需求.md'], '项目内→项目根相对正斜杠');
        const outside = path.join(root, '..', 'outside-req.md');
        fs.writeFileSync(outside, '外部需求', 'utf-8');
        const ext = resolveRequirementInput({ requirementFile: outside, projectRoot: root });
        assert.deepStrictEqual(ext.sources, [outside], '项目外→保留绝对路径（只读正文不扫描）');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'E manifest 保真持久化 + 条件入身份哈希 + successor 去重追加',
    run: () => {
      const root = mkTmp();
      try {
        const m = buildGoalManifestFromInput({
          feature: 'demo',
          requirement: 'req text',
          requirement_source_files: ['doc/features/demo/req/原始需求.md'],
          unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
        }, { projectRoot: root, runId: 'run-1' });
        assert.deepStrictEqual(m.requirement_source_files, ['doc/features/demo/req/原始需求.md']);
        assert.ok(
          Object.prototype.hasOwnProperty.call(computeManifestIdentityFields(m), 'requirement_source_files'),
          'fresh manifest 来源列表须入身份哈希',
        );
        const legacy = buildGoalManifestFromInput({
          feature: 'demo',
          requirement: 'req text',
          unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
        }, { projectRoot: root, runId: 'run-legacy' });
        assert.ok(
          !Object.prototype.hasOwnProperty.call(computeManifestIdentityFields(legacy), 'requirement_source_files'),
          '旧 manifest 无键不入哈希（resume 不误判漂移）',
        );
        // successor 继承 + 显式增量去重追加
        const successor = inheritSuccessorManifest(
          buildGoalManifestFromInput({
            feature: 'demo',
            requirement: '增量',
            requirement_source_files: ['doc/features/demo/req/增量.md'],
            unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
          }, { projectRoot: root, runId: 'run-2' }),
          m,
          { round: [], drift: [] },
        );
        assert.deepStrictEqual(
          successor.requirement_source_files,
          ['doc/features/demo/req/原始需求.md', 'doc/features/demo/req/增量.md'],
          'successor 须继承源列表并去重追加显式增量',
        );
        // 继承后无显式增量：直接继承
        const pure = inheritSuccessorManifest(
          buildGoalManifestFromInput({
            feature: 'demo',
            requirement: '同需求',
            unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
          }, { projectRoot: root, runId: 'run-3' }),
          m,
          { round: [], drift: [] },
        );
        assert.deepStrictEqual(pure.requirement_source_files, ['doc/features/demo/req/原始需求.md']);
        // 形状非法 fail-closed
        let threw = false;
        try {
          buildGoalManifestFromInput({
            feature: 'demo',
            requirement: 'req',
            requirement_source_files: 'not-array',
            unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
          }, { projectRoot: root });
        } catch { threw = true; }
        assert(threw, '形状非法须 fail-closed');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // F. 共享参考图集合
  // ==========================================================================
  {
    name: 'F 单一发现集合：正文显式 ∪ source 直接父目录一层；空集才回退 ux-reference；外源不扫',
    run: () => {
      const root = mkTmp();
      try {
        const reqDir = path.join(root, 'doc', 'features', 'demo', 'req');
        const uxDir = path.join(root, 'doc', 'features', 'demo', 'ux-reference');
        fs.mkdirSync(reqDir, { recursive: true });
        fs.mkdirSync(uxDir, { recursive: true });
        const reqMd = path.join(reqDir, '原始需求.md');
        fs.writeFileSync(reqMd, '参考图归档在 doc/features/demo/req 目录。', 'utf-8');
        // source 同目录三张图（bc-openCard-1 事故形态）
        const img1 = path.join(reqDir, 'card-front.png');
        const img2 = path.join(reqDir, 'card-back.jpg');
        const img3 = path.join(reqDir, 'detail.webp');
        writePng(img1); writePng(img2); writePng(img3);
        // 目录内非图片 & 子目录图片不扫（一层、受支持扩展名）
        fs.writeFileSync(path.join(reqDir, 'notes.txt'), 'x');
        const sub = path.join(reqDir, 'sub');
        fs.mkdirSync(sub, { recursive: true });
        writePng(path.join(sub, 'nested.png'));
        // ux-reference 一张（union 非空时不得回退）
        writePng(path.join(uxDir, 'ux-only.png'));

        const reqText = fs.readFileSync(reqMd, 'utf-8');
        const found = resolveRequirementReferenceImages(root, 'demo', reqText, {
          requirementSourceFiles: ['doc/features/demo/req/原始需求.md'],
        });
        const rel = found.map(p => path.relative(root, p).split(path.sep).join('/'));
        assert.deepStrictEqual(rel, [
          'doc/features/demo/req/card-back.jpg',
          'doc/features/demo/req/card-front.png',
          'doc/features/demo/req/detail.webp',
        ], '三张 source 同目录图 ∪ 正文显式路径，确定性排序，不含嵌套/ux-reference');
        // inline requirement（无 sources）→ 不触发 sibling 扫描：union=正文显式路径（空）
        // → 回退 ux-reference（plan 语义：仅并集为空才回退）。
        const inlineOnly = resolveRequirementReferenceImages(root, 'demo', '无任何路径', {});
        assert.deepStrictEqual(
          inlineOnly.map(p => path.relative(root, p).split(path.sep).join('/')),
          ['doc/features/demo/ux-reference/ux-only.png'],
          'inline 不触发 sibling 扫描（不得出现 reqDir 三图），并集为空才回退 ux-reference',
        );
        // 空集（正文无显式路径 + sources 空）→ 回退 ux-reference（与 inlineOnly 同形态，双保险断言）
        const fallback = resolveRequirementReferenceImages(root, 'demo', '无任何路径', {
          requirementSourceFiles: [],
        });
        assert.deepStrictEqual(
          fallback.map(p => path.relative(root, p).split(path.sep).join('/')),
          ['doc/features/demo/ux-reference/ux-only.png'],
          '仅空集才回退 ux-reference',
        );
        // 外部 source：不扫描其 sibling
        const outsideSrc = path.join(root, '..', 'external-req.md');
        const outsideDir = path.dirname(outsideSrc);
        fs.writeFileSync(outsideSrc, '外部需求');
        writePng(path.join(outsideDir, 'external-img.png'));
        const ext = resolveRequirementReferenceImages(root, 'demo', '外部需求', {
          requirementSourceFiles: [outsideSrc],
        });
        assert.ok(!ext.some(p => p.endsWith('external-img.png')), '项目外 source 不得扫描 sibling');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'F discoverReferenceImagesForOcrPrescan 与共享集合同源（OCR 预扫/能力依赖同一分母）',
    run: () => {
      const root = mkTmp();
      try {
        const reqDir = path.join(root, 'doc', 'features', 'f', 'req');
        fs.mkdirSync(reqDir, { recursive: true });
        fs.writeFileSync(path.join(reqDir, 'r.md'), '看图', 'utf-8');
        writePng(path.join(reqDir, 'a.png'));
        const { discoverReferenceImagesForOcrPrescan } = require('../../scripts/utils/fidelity-shared') as typeof import('../../scripts/utils/fidelity-shared');
        const viaPrescan = discoverReferenceImagesForOcrPrescan(root, 'f', '看图', {
          requirementSourceFiles: ['doc/features/f/req/r.md'],
        });
        assert.strictEqual(viaPrescan.length, 1, 'OCR 预扫应消费同一发现集合');
        assert.ok(viaPrescan[0].endsWith('a.png'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // G. refs receipt 期望分母（manifest 驱动）
  // ==========================================================================
  {
    name: 'G verifyVlSigningChain 期望分母=共享集合；spec 漏一张 → FAIL',
    run: () => {
      const root = mkTmp();
      const runId = 'run-refs-denom';
      try {
        const reqDir = path.join(root, 'doc', 'features', 'demo', 'req');
        const goalRuns = path.join(root, 'doc', 'features', 'demo', 'goal-runs', runId);
        fs.mkdirSync(reqDir, { recursive: true });
        fs.mkdirSync(goalRuns, { recursive: true });
        writePng(path.join(reqDir, 'a.png'));
        writePng(path.join(reqDir, 'b.png'));
        writePng(path.join(reqDir, 'c.png'));
        // frozen manifest：requirement + requirement_source_files
        fs.writeFileSync(path.join(goalRuns, 'manifest.json'), JSON.stringify({
          run_id: runId,
          feature: 'demo',
          adapter: 'claude',
          requirement: '三张图',
          requirement_source_files: ['doc/features/demo/req/原始需求.md'],
        }), 'utf-8');
        // 事件绑定：能力回执 + refs 回执（仅覆盖 2 张 → 缺 1 张 → FAIL）
        const events = [
          JSON.stringify({ type: 'capability_receipt', invoke_id: 'spec-i1', status: 'issued_inline_canary', receipt_sha256: 'a'.repeat(64) }),
          JSON.stringify({ type: 'spec_refs_receipt_produced', invoke_id: 'spec-i1', status: 'complete', receipt_sha256: 'b'.repeat(64) }),
        ].join('\n');
        fs.writeFileSync(path.join(goalRuns, 'events.jsonl'), events, 'utf-8');
        const visionDir = path.join(root, 'doc', 'features', 'demo', 'vision');
        fs.mkdirSync(visionDir, { recursive: true });
        fs.writeFileSync(path.join(visionDir, 'capability-receipt.json'), JSON.stringify({
          schema_version: '1.0',
          adapter: 'claude',
          run_id: runId,
          invoke_id: 'spec-i1',
          binding_path: 'inline_canary',
          verdict: 'tool_read',
          model: 'unknown',
        }), 'utf-8');
        const sha256File = (p: string): string => require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        // 重写回执以匹配事件 hash
        fs.writeFileSync(path.join(visionDir, 'capability-receipt.json'), JSON.stringify({
          schema_version: '1.0',
          adapter: 'claude',
          run_id: runId,
          invoke_id: 'spec-i1',
          binding_path: 'inline_canary',
          verdict: 'tool_read',
          model: 'unknown',
        }), 'utf-8');
        // refs 回执只覆盖 2 张（c.png 缺失）
        fs.writeFileSync(path.join(visionDir, 'spec-refs-receipt.json'), JSON.stringify({
          schema_version: '1.0',
          adapter: 'claude',
          goal_run_id: runId,
          invoke_id: 'spec-i1',
          produced_at: new Date().toISOString(),
          refs: [
            { path: path.join(reqDir, 'a.png'), hash: sha256File(path.join(reqDir, 'a.png')), read: true },
            { path: path.join(reqDir, 'b.png'), hash: sha256File(path.join(reqDir, 'b.png')), read: true },
          ],
          unread: [],
          attestation: { goal_run_id: runId, evidence_log_path: 'x/agent-events.jsonl', evidence_log_hash: 'c'.repeat(16), source: 'runner_transcript_audit' },
        }), 'utf-8');
        // events 中的 hash 必须匹配文件（简化：重写 events 用实际 hash）
        const capHash = sha256File(path.join(visionDir, 'capability-receipt.json'));
        const refsHash = sha256File(path.join(visionDir, 'spec-refs-receipt.json'));
        fs.writeFileSync(path.join(goalRuns, 'events.jsonl'), [
          JSON.stringify({ type: 'capability_receipt', invoke_id: 'spec-i1', status: 'issued_inline_canary', receipt_sha256: capHash }),
          JSON.stringify({ type: 'spec_refs_receipt_produced', invoke_id: 'spec-i1', status: 'complete', receipt_sha256: refsHash }),
        ].join('\n'), 'utf-8');

        const { verifyVlSigningChain } = require('../../scripts/utils/critic-receipt-producer') as typeof import('../../scripts/utils/critic-receipt-producer');
        const prevEnv = { RUN: process.env.MAISON_GOAL_RUN_ID, ATT: process.env.MAISON_GOAL_ATTEMPT };
        process.env.MAISON_GOAL_RUN_ID = runId;
        process.env.MAISON_GOAL_ATTEMPT = 'i1';
        try {
          const result = verifyVlSigningChain({ projectRoot: root, feature: 'demo' });
          assert.strictEqual(result.ok, false, '回执未覆盖全部发现图 → 终签必须拒');
          assert.ok(result.currentRefs.length === 3, `期望分母=共享集合 3 张，实得 ${result.currentRefs.length}`);
          assert.ok(result.failures.some(f => /未覆盖当前参考图/.test(f) || /无验读事件/.test(f)), JSON.stringify(result.failures));
        } finally {
          if (prevEnv.RUN === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = prevEnv.RUN;
          if (prevEnv.ATT === undefined) delete process.env.MAISON_GOAL_ATTEMPT; else process.env.MAISON_GOAL_ATTEMPT = prevEnv.ATT;
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // H. runner 集成回归（plan c4e8a1f7 T4 冻结计数）
  // ==========================================================================
  {
    name: 'H 集成：Codex 0.138 模型兼容 400 → adapter_cli_hard_failure 早停（formal_invoke_attempts=1 / harness=0 / content_retry=0）',
    run: async () => {
      const root = setupMinimalHost('hard-400');
      const specAbs = path.join(root, 'doc', 'features', 'hard-400', 'spec', 'spec.md');
      fs.writeFileSync(specAbs, '```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
      const { spawnSync } = require('child_process') as typeof import('child_process');
      spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
      spawnSync('git', ['commit', '-qm', 'ui'], { cwd: root, encoding: 'utf-8' });
      // 跳过真实金丝雀探测（local override）：本次回归聚焦正式 phase invoke 硬失败
      writeLocalConfig(root, {
        schema_version: '1.0',
        agent_adapter: 'cursor',
        vision: { image_input_override: 'none' },
      });
      const invokedPhases: string[] = [];
      const harnessPhases: string[] = [];
      const prevArgv = process.argv;
      const prevCwd = process.cwd();
      const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
      try {
        __testing_setInvokeAgent((async (_plan: unknown, _root: unknown, _o: unknown) => ({
          exitCode: 1,
          stdout: '',
          stderr: `${CODEX_400_ENVELOPE}\n`,
          command: 'fake-codex',
        })) as never);
        __testing_setRunHarnessPhase((async (_pr: string, _fr: string, ph: string) => {
          harnessPhases.push(String(ph));
          return { exitCode: 0, timedOut: false };
        }) as never);
        __testing_setRepoLayout({ kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>);
        __testing_setDeviceReadinessGate(((_o: { phase: string }) => ({
          env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['test seam'],
        })) as never);
        __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
          status: 'passed' as const,
          receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`,
          exit_code: 0,
        })) as never);
        process.argv = [
          'node', 'goal-runner.ts',
          '--feature', 'hard-400',
          '--requirement', '银行卡开卡需求，含7个页面，参考图还原布局。',
          '--start', 'spec', '--end', 'spec',
          '--adapter', 'cursor',
          '--foreground-ok', '--force',
        ];
        process.chdir(root);
        clearFrameworkConfigCache();
        const exitCode = await goalMain();
        assert.strictEqual(exitCode, 1, `run 应以 1 退出（BLOCKER），实得 ${exitCode}`);
        const runsDir = path.join(root, 'doc/features', 'hard-400', 'goal-runs');
        const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((n) => !n.startsWith('.')) : [];
        const reportDir =
          runs.length > 0
            ? path.join(runsDir, runs.map((n) => ({ n, t: fs.statSync(path.join(runsDir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(-1)[0].n)
            : '';
        const events = readEvents(reportDir);
        // 冻结计数：formal_invoke_attempts=1
        assert.strictEqual(
          events.filter((e) => e.type === 'agent_invoke_start').length, 1,
          `formal_invoke_attempts 应为 1（实得 ${events.filter((e) => e.type === 'agent_invoke_start').length}）`,
        );
        // harness=0
        assert.strictEqual(events.filter((e) => e.type === 'harness_start').length, 0, '不得跑 harness');
        // content_retry=0：无第二次 invoke（既有事件已证明）
        assert.strictEqual(invokedPhases.length, 0, 'invoke spy 不应被调（injected 之外无真实 invoke）');
        assert.deepStrictEqual(harnessPhases, [], '不得有任何 gate harness spawn');
        // 早停事件 + external 分类
        const halt = events.find((e) => e.type === 'phase_halt' && e.halt_reason === 'adapter_cli_hard_failure') as Record<string, unknown> | undefined;
        assert(halt, '须落 phase_halt(adapter_cli_hard_failure)');
        assert.ok(String(halt!.reason ?? '').includes('Codex 模型兼容硬错误'), `reason 应定性 400：${String(halt!.reason)}`);
        // 无伪 spec_file_exists 归因
        assert.ok(!events.some((e) => e.type === 'phase_halt' && e.halt_reason === 'spec_file_exists'), '不得伪归因 spec_file_exists');
      } finally {
        __testing_resetGoalRunnerSeams();
        process.argv = prevArgv;
        if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
        try { process.chdir(prevCwd); } catch { /* ignore */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  },
  {
    name: 'H 集成：guardian CreateProcess error 5 → adapter_cli_hard_failure 早停（guardian_attempts=1 / agent_process_started=0 / harness=0）',
    run: async () => {
      const root = setupMinimalHost('hard-guardian');
      const specAbs = path.join(root, 'doc', 'features', 'hard-guardian', 'spec', 'spec.md');
      fs.writeFileSync(specAbs, '```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
      const { spawnSync } = require('child_process') as typeof import('child_process');
      spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
      spawnSync('git', ['commit', '-qm', 'ui'], { cwd: root, encoding: 'utf-8' });
      writeLocalConfig(root, {
        schema_version: '1.0',
        agent_adapter: 'cursor',
        vision: { image_input_override: 'none' },
      });
      const harnessPhases: string[] = [];
      const boundEvents: string[] = [];
      const prevArgv = process.argv;
      const prevCwd = process.cwd();
      const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
      try {
        // 注入 guardian 失败形态：exit 2 + [maison-guardian] + CreateProcess(CREATE_SUSPENDED) + 投影 spawn_error
        __testing_setInvokeAgent((async (_plan: unknown, _root: unknown, _o: unknown) => ({
          exitCode: 2,
          stdout: '',
          stderr: '[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5（argv=...）\n',
          command: 'fake-guardian',
          spawn_error: { code: 'maison_guardian_containment_failed', message: '[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5' },
        })) as never);
        __testing_setRunHarnessPhase((async (_pr: string, _fr: string, ph: string) => {
          harnessPhases.push(String(ph));
          return { exitCode: 0, timedOut: false };
        }) as never);
        __testing_setRepoLayout({ kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>);
        __testing_setDeviceReadinessGate(((_o: { phase: string }) => ({
          env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['test seam'],
        })) as never);
        __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
          status: 'passed' as const,
          receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`,
          exit_code: 0,
        })) as never);
        process.argv = [
          'node', 'goal-runner.ts',
          '--feature', 'hard-guardian',
          '--requirement', '银行卡开卡需求，含7个页面，参考图还原布局。',
          '--start', 'spec', '--end', 'spec',
          '--adapter', 'cursor',
          '--foreground-ok', '--force',
        ];
        process.chdir(root);
        clearFrameworkConfigCache();
        const exitCode = await goalMain();
        assert.strictEqual(exitCode, 1, `run 应以 1 退出（BLOCKER），实得 ${exitCode}`);
        const runsDir = path.join(root, 'doc/features', 'hard-guardian', 'goal-runs');
        const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((n) => !n.startsWith('.')) : [];
        const reportDir =
          runs.length > 0
            ? path.join(runsDir, runs.map((n) => ({ n, t: fs.statSync(path.join(runsDir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(-1)[0].n)
            : '';
        const events = readEvents(reportDir);
        // guardian_attempts=1（一次 invoke 尝试）
        assert.strictEqual(events.filter((e) => e.type === 'agent_invoke_start').length, 1, 'guardian 尝试应恰 1 次');
        // agent_process_started=0（guardian 建立失败，agent 从未被放行）
        const bound = events.filter((e) => e.type === 'agent_process_bound').length;
        assert.strictEqual(bound, 0, `agent_process_bound 应为 0（实得 ${bound}）`);
        boundEvents.push(String(bound));
        // harness=0
        assert.strictEqual(events.filter((e) => e.type === 'harness_start').length, 0, '不得跑 harness');
        assert.deepStrictEqual(harnessPhases, [], '不得有任何 gate harness spawn');
        const halt = events.find((e) => e.type === 'phase_halt' && e.halt_reason === 'adapter_cli_hard_failure') as Record<string, unknown> | undefined;
        assert(halt, '须落 phase_halt(adapter_cli_hard_failure)');
        assert.ok(String(halt!.reason ?? '').includes('guardian containment 建立失败'), `reason 应定性 guardian：${String(halt!.reason)}`);
        assert.strictEqual(boundEvents[0], '0');
        // 普通内容失败/无 guardian 诊断 exit 2 的场景由 C 组纯函数覆盖（不误升）
      } finally {
        __testing_resetGoalRunnerSeams();
        process.argv = prevArgv;
        if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
        try { process.chdir(prevCwd); } catch { /* ignore */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  },
  {
    name: 'H5 集成：--supersede + --manifest + --requirement-file + --override-manifest → 来源=源∪增量，manifest 自带旧来源忽略（评审 P1 复现）',
    run: async () => {
      const root = setupMinimalHost('reqfile-succ-override');
      const featDir = path.join(root, 'doc', 'features', 'reqfile-succ-override');
      const reqDir = path.join(featDir, 'req');
      fs.mkdirSync(reqDir, { recursive: true });
      // 源 run 来源文件（s.md）+ 显式增量文件（i.md）+ manifest 自带旧来源（m.md）
      fs.writeFileSync(path.join(reqDir, 's.md'), '源需求：开卡页面参考图还原。', 'utf-8');
      fs.writeFileSync(path.join(reqDir, 'i.md'), '增量：修复确认页按钮文案。', 'utf-8');
      fs.writeFileSync(path.join(reqDir, 'm.md'), 'manifest 自带旧需求文档', 'utf-8');
      // 源 run manifest（带来源 s.md）
      const srcRunId = 'src-run-0ver';
      const srcRunDir = path.join(featDir, 'goal-runs', srcRunId);
      fs.mkdirSync(srcRunDir, { recursive: true });
      fs.writeFileSync(path.join(srcRunDir, 'manifest.json'), JSON.stringify({
        schema_version: '1.0', start_phase: 'spec', end_phase: 'spec',
        feature: 'reqfile-succ-override',
        requirement: '源需求：开卡页面参考图还原。',
        requirement_source_files: ['doc/features/reqfile-succ-override/req/s.md'],
        adapter: 'cursor',
        budget: { max_total_turns: 10, max_retries_per_phase: 1, wall_clock_minutes: 60, max_transient_api_retries: 3 },
        dependency_policy: { deferrable_blocking_classes: [], deferrable_failure_kinds: [], propagate_to_downstream: true },
        unattended: { write_mode: 'full-access', approval_mode: 'never' },
        run_id: srcRunId, report_dir: `doc/features/reqfile-succ-override/goal-runs/${srcRunId}`,
        created_at: '2026-08-24T00:00:00.000Z',
      }), 'utf-8');
      // manifest 文件（自带旧来源 m.md —— 属于被覆盖的旧需求，须被 successor 重设忽略）
      const manifestPath = path.join(featDir, 'succ-manifest.json');
      const runId = 'succ-over-0001';
      const reportDir = `doc/features/reqfile-succ-override/goal-runs/${runId}`;
      fs.mkdirSync(path.join(root, reportDir), { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify({
        schema_version: '1.0', start_phase: 'spec', end_phase: 'spec',
        feature: 'reqfile-succ-override',
        requirement: 'manifest 自带旧需求文档',
        requirement_source_files: ['doc/features/reqfile-succ-override/req/m.md'],
        adapter: 'cursor',
        budget: { max_total_turns: 10, max_retries_per_phase: 1, wall_clock_minutes: 60, max_transient_api_retries: 3 },
        dependency_policy: { deferrable_blocking_classes: [], deferrable_failure_kinds: [], propagate_to_downstream: true },
        unattended: { write_mode: 'full-access', approval_mode: 'never' },
        run_id: runId, report_dir: reportDir,
        created_at: '2026-08-24T00:00:00.000Z',
      }), 'utf-8');
      const { spawnSync } = require('child_process') as typeof import('child_process');
      spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
      spawnSync('git', ['commit', '-qm', 'req'], { cwd: root, encoding: 'utf-8' });
      const prevArgv = process.argv;
      const prevCwd = process.cwd();
      const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
      try {
        __testing_setInvokeAgent((async (_p: unknown, _r: unknown, _o: unknown) => ({
          exitCode: 1, stdout: '', stderr: 'ordinary content failure', command: 'fake',
        })) as never);
        __testing_setRunHarnessPhase((async (_pr: string, _fr: string, ph: string) => ({
          exitCode: 0, timedOut: false,
        })) as never);
        __testing_setRepoLayout({ kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>);
        __testing_setDeviceReadinessGate(((_o: { phase: string }) => ({
          env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['test seam'],
        })) as never);
        __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
          status: 'passed' as const,
          receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`,
          exit_code: 0,
        })) as never);
        process.argv = [
          'node', 'goal-runner.ts',
          '--supersede', srcRunId,
          '--manifest', path.relative(root, manifestPath).split(path.sep).join('/'),
          '--requirement-file', path.relative(root, path.join(reqDir, 'i.md')).split(path.sep).join('/'),
          '--override-manifest',
          '--feature', 'reqfile-succ-override',
          '--adapter', 'cursor',
          '--foreground-ok', '--force',
        ];
        process.chdir(root);
        clearFrameworkConfigCache();
        await goalMain();
        const writtenManifest = JSON.parse(
          fs.readFileSync(path.join(root, reportDir, 'manifest.json'), 'utf-8'),
        ) as { requirement?: string; requirement_source_files?: string[] };
        assert.ok(writtenManifest.requirement?.includes('增量'), `增量应合并：${writtenManifest.requirement}`);
        // 评审 P1 复现断言：最终来源 = 源 run 来源 ∪ 显式增量来源，manifest 自带旧来源忽略
        assert.deepStrictEqual(
          writtenManifest.requirement_source_files,
          [
            'doc/features/reqfile-succ-override/req/s.md',
            'doc/features/reqfile-succ-override/req/i.md',
          ],
          `successor+override 后来源应为 [源 s.md, 增量 i.md]（manifest 自带 m.md 忽略），实得 ${JSON.stringify(writtenManifest.requirement_source_files)}`,
        );
      } finally {
        __testing_resetGoalRunnerSeams();
        process.argv = prevArgv;
        if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
        try { process.chdir(prevCwd); } catch { /* ignore */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  },
  {
    name: 'H2 集成：fresh --requirement-file 来源必须进入落盘 manifest（正式无人值守入口断桥回归）',
    run: async () => {
      const root = setupMinimalHost('reqfile-fresh');
      const reqDir = path.join(root, 'doc', 'features', 'reqfile-fresh', 'req');
      fs.mkdirSync(reqDir, { recursive: true });
      const reqMd = path.join(reqDir, '原始需求.md');
      fs.writeFileSync(reqMd, '银行卡开卡需求，含7个页面，参考图还原布局。', 'utf-8');
      const { spawnSync } = require('child_process') as typeof import('child_process');
      spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
      spawnSync('git', ['commit', '-qm', 'req'], { cwd: root, encoding: 'utf-8' });
      const prevArgv = process.argv;
      const prevCwd = process.cwd();
      const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
      try {
        // 注入 invoke/harness：run 会在 spec 首轮 invoke 后停（halt 或任意终局），
        // 本回归只关心 manifest 落盘内容，不关心 phase 结果。
        __testing_setInvokeAgent((async (_p: unknown, _r: unknown, _o: unknown) => ({
          exitCode: 1, stdout: '', stderr: 'ordinary content failure', command: 'fake',
        })) as never);
        __testing_setRunHarnessPhase((async (_pr: string, _fr: string, ph: string) => ({
          exitCode: 0, timedOut: false,
        })) as never);
        __testing_setRepoLayout({ kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>);
        __testing_setDeviceReadinessGate(((_o: { phase: string }) => ({
          env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['test seam'],
        })) as never);
        __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
          status: 'passed' as const,
          receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`,
          exit_code: 0,
        })) as never);
        process.argv = [
          'node', 'goal-runner.ts',
          '--feature', 'reqfile-fresh',
          '--requirement-file', path.relative(root, reqMd).split(path.sep).join('/'),
          '--start', 'spec', '--end', 'spec',
          '--adapter', 'cursor',
          '--foreground-ok', '--force',
        ];
        process.chdir(root);
        clearFrameworkConfigCache();
        await goalMain();
        const runsDir = path.join(root, 'doc/features', 'reqfile-fresh', 'goal-runs');
        const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((n) => !n.startsWith('.')) : [];
        assert.ok(runs.length > 0, '应有 run 目录');
        const reportDir =
          path.join(runsDir, runs.map((n) => ({ n, t: fs.statSync(path.join(runsDir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(-1)[0].n);
        const manifest = JSON.parse(fs.readFileSync(path.join(reportDir, 'manifest.json'), 'utf-8')) as {
          requirement?: string;
          requirement_source_files?: string[];
        };
        assert.strictEqual(manifest.requirement, '银行卡开卡需求，含7个页面，参考图还原布局。');
        assert.deepStrictEqual(
          manifest.requirement_source_files,
          ['doc/features/reqfile-fresh/req/原始需求.md'],
          `fresh manifest 必须持久化来源列表，实得 ${JSON.stringify(manifest.requirement_source_files)}`,
        );
      } finally {
        __testing_resetGoalRunnerSeams();
        process.argv = prevArgv;
        if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
        try { process.chdir(prevCwd); } catch { /* ignore */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  },
  {
    name: 'H3 集成：--supersede + --requirement-file 显式增量来源必须在 override 前继承并去重追加',
    run: async () => {
      const root = setupMinimalHost('reqfile-succ');
      const reqDir = path.join(root, 'doc', 'features', 'reqfile-succ', 'req');
      fs.mkdirSync(reqDir, { recursive: true });
      const reqMd = path.join(reqDir, '原始需求.md');
      fs.writeFileSync(reqMd, '基线需求：开卡页面参考图还原。', 'utf-8');
      const incMd = path.join(reqDir, '增量.md');
      fs.writeFileSync(incMd, '本轮修复增量：修复确认页按钮文案。', 'utf-8');
      const { spawnSync } = require('child_process') as typeof import('child_process');
      // 先构造一个源 run（--supersede 目标）——直接手工写合法 manifest + 目录
      const srcRunId = 'src-run-0001';
      const srcRunDir = path.join(root, 'doc/features', 'reqfile-succ', 'goal-runs', srcRunId);
      fs.mkdirSync(srcRunDir, { recursive: true });
      fs.writeFileSync(path.join(srcRunDir, 'manifest.json'), JSON.stringify({
        schema_version: '1.0',
        start_phase: 'spec',
        end_phase: 'spec',
        feature: 'reqfile-succ',
        requirement: '基线需求：开卡页面参考图还原。',
        requirement_source_files: ['doc/features/reqfile-succ/req/原始需求.md'],
        adapter: 'cursor',
        budget: { max_total_turns: 10, max_retries_per_phase: 1, wall_clock_minutes: 60, max_transient_api_retries: 3 },
        dependency_policy: { deferrable_blocking_classes: [], deferrable_failure_kinds: [], propagate_to_downstream: true },
        unattended: { write_mode: 'full-access', approval_mode: 'never' },
        run_id: srcRunId,
        report_dir: `doc/features/reqfile-succ/goal-runs/${srcRunId}`,
        created_at: '2026-08-24T00:00:00.000Z',
      }), 'utf-8');
      spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
      spawnSync('git', ['commit', '-qm', 'req'], { cwd: root, encoding: 'utf-8' });
      const prevArgv = process.argv;
      const prevCwd = process.cwd();
      const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
      try {
        __testing_setInvokeAgent((async (_p: unknown, _r: unknown, _o: unknown) => ({
          exitCode: 1, stdout: '', stderr: 'ordinary content failure', command: 'fake',
        })) as never);
        __testing_setRunHarnessPhase((async (_pr: string, _fr: string, ph: string) => ({
          exitCode: 0, timedOut: false,
        })) as never);
        __testing_setRepoLayout({ kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>);
        __testing_setDeviceReadinessGate(((_o: { phase: string }) => ({
          env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['test seam'],
        })) as never);
        __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
          status: 'passed' as const,
          receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`,
          exit_code: 0,
        })) as never);
        process.argv = [
          'node', 'goal-runner.ts',
          '--feature', 'reqfile-succ',
          '--supersede', srcRunId,
          '--requirement-file', path.relative(root, incMd).split(path.sep).join('/'),
          '--start', 'spec', '--end', 'spec',
          '--adapter', 'cursor',
          '--foreground-ok', '--force',
        ];
        process.chdir(root);
        clearFrameworkConfigCache();
        await goalMain();
        const runsDir = path.join(root, 'doc/features', 'reqfile-succ', 'goal-runs');
        const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((n) => !n.startsWith('.')) : [];
        const newRuns = runs.filter((n) => n !== srcRunId);
        assert.ok(newRuns.length > 0, '应有后继 run');
        const reportDir =
          path.join(runsDir, newRuns.map((n) => ({ n, t: fs.statSync(path.join(runsDir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(-1)[0].n);
        const manifest = JSON.parse(fs.readFileSync(path.join(reportDir, 'manifest.json'), 'utf-8')) as {
          requirement?: string;
          requirement_source_files?: string[];
        };
        assert.ok(manifest.requirement?.includes('本轮修复增量'), `增量应合并：${manifest.requirement}`);
        assert.deepStrictEqual(
          manifest.requirement_source_files,
          ['doc/features/reqfile-succ/req/原始需求.md', 'doc/features/reqfile-succ/req/增量.md'],
          `successor 应继承源来源并去重追加显式增量来源，实得 ${JSON.stringify(manifest.requirement_source_files)}`,
        );
      } finally {
        __testing_resetGoalRunnerSeams();
        process.argv = prevArgv;
        if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
        try { process.chdir(prevCwd); } catch { /* ignore */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  },
];

function readEvents(reportDir: string): Array<Record<string, unknown>> {
  const p = path.join(reportDir, 'events.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l) as Record<string, unknown>; } catch { return {}; }
  });
}

export async function runAll(): Promise<UnitCaseResult[]> {
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
  void runAll().then((results) => {
    const failed = results.filter((r) => !r.ok);
    for (const r of results) {
      console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
    }
    process.exit(failed.length > 0 ? 1 : 0);
  });
}