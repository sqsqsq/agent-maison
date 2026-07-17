// ============================================================================
// toolchain-probe.unit.test.ts — t6（plan e6a3c9f4 / openspec toolchain-probe-truth）
// ----------------------------------------------------------------------------
// 覆盖：错误码证据分层（无证据不得断言不兼容）、invocation 指纹失效（仅 verified）、
// project_compile 三态状态机（unknown 防首编译死锁 / verified 仅真实成功 /
// capability_failed=环境级恒拦截+白名单码 / 源码失败清除旧能力失败 /
// 人工 reprobe 降级重置——v4 无授予窗口，环境没修 resume 恒 halt）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyHvigorEnvError,
  computeHvigorInvocationFingerprint,
  resolveProjectCompileState,
  recordHvigorBuildOutcome,
  evaluateCapabilityGapAtPreflight,
  resetCapabilityFailedByHumanReprobe,
  TOOLCHAIN_PROBE_TTL_MS,
} from '../../toolchain-probe';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0' }), 'utf-8');
  fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ "app": {} }', 'utf-8');
  return root;
}

const DIMS = { module: 'entry', target: 'default', task: 'assembleHap', product: 'default', buildMode: 'default' } as const;

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '分类器：00303217 → sdk_home_missing_or_invalid（提示 framework 链已自动派生）',
    run: () => {
      const c = classifyHvigorEnvError('> hvigor ERROR: 00303217 Configuration Error\nInvalid value of DEVECO_SDK_HOME');
      assert(c && c.code === 'sdk_home_missing_or_invalid', `got ${c?.code}`);
      assert(c!.header.length <= 180, '诊断头须 ≤180');
      assert(c!.guidance.includes('framework'), '指引应指向 framework 调用链');
    },
  },
  {
    name: '分类器：00303168 无证据 → sdk_component_missing（不得断言不兼容）',
    run: () => {
      const c = classifyHvigorEnvError('> hvigor ERROR: 00303168 Configuration Error');
      assert(c && c.code === 'sdk_component_missing', `got ${c?.code}`);
      assert(!/不兼容|incompatible/i.test(c!.header) || c!.header.includes('不得断言'), '无证据不得输出不兼容结论');
      assert(c!.guidance.includes('取证'), '应给取证指引');
    },
  },
  {
    name: '分类器：00303168 + 三证据齐备 → incompatible_suspected（保留 suspected）',
    run: () => {
      const c = classifyHvigorEnvError('ERROR: 00303168', {
        sdk_manifest_format: 'oh-uni-package.json',
        sdk_version: '6.1.0.105',
        hvigor_version: '6.23.4',
      });
      assert(c && c.code === 'sdk_layout_or_version_incompatible_suspected', `got ${c?.code}`);
      assert(c!.evidence.length === 3, '证据清单应含三项');
      assert(c!.guidance.includes('三选一'), '应给三选一指引');
    },
  },
  {
    name: '分类器：非环境类日志 → null（源码错误不归工具链）',
    run: () => {
      assert(classifyHvigorEnvError('ArkTS Compiler Error: cannot find name Foo') === null, '不应命中');
    },
  },
  {
    name: '指纹：工程配置变化即失效；同维度稳定',
    run: () => {
      const root = mkProject();
      try {
        const f1 = computeHvigorInvocationFingerprint(root, DIMS);
        const f1b = computeHvigorInvocationFingerprint(root, DIMS);
        assert(f1 === f1b, '同输入指纹须稳定');
        fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ "app": { "changed": 1 } }', 'utf-8');
        const f2 = computeHvigorInvocationFingerprint(root, DIMS);
        assert(f1 !== f2, 'build-profile 变化须换指纹');
        const f3 = computeHvigorInvocationFingerprint(root, { ...DIMS, module: 'other' });
        assert(f2 !== f3, '模块维度变化须换指纹');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '状态机：无记录/指纹漂移/过期 → unknown（首编译放行不 halt）；verified 真实成功写入',
    run: () => {
      const root = mkProject();
      try {
        const fp = computeHvigorInvocationFingerprint(root, DIMS);
        assert(resolveProjectCompileState(root, fp).status === 'unknown', '首次须 unknown');
        recordHvigorBuildOutcome(root, { kind: 'verified', fingerprint: fp });
        assert(resolveProjectCompileState(root, fp).status === 'verified', '成功后须 verified');
        assert(resolveProjectCompileState(root, 'fp-other').status === 'unknown', '指纹漂移须回 unknown');
        const expired = Date.now() + TOOLCHAIN_PROBE_TTL_MS + 1000;
        assert(resolveProjectCompileState(root, fp, expired).status === 'unknown', '过期须回 unknown');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '状态机 v3：源码失败=已达源码阶段→清除旧 capability_failed（置 unknown）+ last_attempt 留痕',
    run: () => {
      const root = mkProject();
      try {
        const fp = computeHvigorInvocationFingerprint(root, DIMS);
        recordHvigorBuildOutcome(root, {
          kind: 'capability_failed',
          fingerprint: fp,
          failure_code: 'sdk_component_missing',
          evidence: [],
        });
        const s1 = resolveProjectCompileState(root, fp);
        assert(s1.status === 'capability_failed' && s1.failure_code === 'sdk_component_missing', '环境分类须留存');

        // v3（codex 阻断2）：编译到达源码阶段=SDK/hvigor 装配全通——旧 capability_failed 必须清除，
        // 否则工具链修好后 preflight 仍误报能力缺口（OpenSpec"源码失败保持 unknown"）。
        recordHvigorBuildOutcome(root, { kind: 'source_failure', summary: 'ArkTS Compiler Error x' });
        const s2 = resolveProjectCompileState(root, fp);
        assert(s2.status === 'unknown', '源码失败须把旧 capability_failed 清回 unknown');
        assert(evaluateCapabilityGapAtPreflight(root) === null, '清除后 preflight 须放行');
        const local = JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'));
        assert(local.toolchain?.probe?.last_attempt?.summary?.includes('ArkTS'), 'last_attempt 应留人读痕');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'preflight v4 恒拦截：capability_failed 无论查多少次都拦（无放行窗口；OpenSpec"resume 后仍缺口→再次 halt"）',
    run: () => {
      const root = mkProject();
      try {
        assert(evaluateCapabilityGapAtPreflight(root) === null, '无记录须放行');
        const fp = computeHvigorInvocationFingerprint(root, DIMS);
        recordHvigorBuildOutcome(root, { kind: 'capability_failed', fingerprint: fp, failure_code: 'sdk_component_missing', evidence: ['x'] });
        // v4（codex 第三轮阻断1）：粘滞/交替授予废弃——环境没修 resume 多少次都 halt，
        // 不烧 agent 预算；goal/harness 双入口同为纯读，天然一致。
        const hit1 = evaluateCapabilityGapAtPreflight(root);
        assert(hit1 && hit1.failure_code === 'sdk_component_missing', '首触须拦截');
        assert(evaluateCapabilityGapAtPreflight(root) !== null, '再查仍拦（goal 入口）');
        assert(evaluateCapabilityGapAtPreflight(root) !== null, '再查仍拦（harness 入口）');
        assert(evaluateCapabilityGapAtPreflight(root) !== null, '环境没修 resume 恒拦截');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '人工 reprobe v4：--ensure（cli 可启动）降级重置 capability_failed→unknown；cli 启不动不重置；绝不升级 verified',
    run: () => {
      const root = mkProject();
      try {
        const fp = computeHvigorInvocationFingerprint(root, DIMS);
        recordHvigorBuildOutcome(root, { kind: 'capability_failed', fingerprint: fp, failure_code: 'sdk_home_missing_or_invalid', evidence: [] });
        assert(evaluateCapabilityGapAtPreflight(root) !== null, '基线：拦截中');
        // cli 启不动（环境仍坏）→ 不重置，仍拦截
        assert(resetCapabilityFailedByHumanReprobe(root, false) === false, 'cliOk=false 不得重置');
        assert(evaluateCapabilityGapAtPreflight(root) !== null, 'cli 启不动仍拦截');
        // 人工 reprobe（cli 可启动）→ 降级重置 unknown → 放行一次真实编译
        assert(resetCapabilityFailedByHumanReprobe(root, true) === true, '人工 reprobe 须重置');
        assert(evaluateCapabilityGapAtPreflight(root) === null, '重置后放行（unknown 语义）');
        assert(resolveProjectCompileState(root, fp).status === 'unknown', '重置=降级到 unknown，绝非 verified');
        const local = JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'));
        assert(local.toolchain?.probe?.last_attempt?.summary?.includes('人工 reprobe'), '重置须留审计痕');
        // wrapper 真实编译再失败 → 重新拦截（reprobe 不是白名单洗白，只授予一次定谳机会）
        recordHvigorBuildOutcome(root, { kind: 'capability_failed', fingerprint: fp, failure_code: 'sdk_component_missing', evidence: [] });
        assert(evaluateCapabilityGapAtPreflight(root) !== null, '真实编译再失败须重新拦截');
        // 修好后：reprobe → 编译成功 → verified → 放行
        assert(resetCapabilityFailedByHumanReprobe(root, true) === true, '再次 reprobe');
        recordHvigorBuildOutcome(root, { kind: 'verified', fingerprint: fp });
        assert(evaluateCapabilityGapAtPreflight(root) === null, 'verified 后须放行');
        // verified 态 reprobe 是 no-op（不打扰健康状态）
        assert(resetCapabilityFailedByHumanReprobe(root, true) === false, 'verified 态 reprobe 无事发生');
        assert(resolveProjectCompileState(root, fp).status === 'verified', 'verified 保持');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '环境级语义 v4：capability_failed 跨 invocation 成立（指纹只对 verified 失效）；非白名单码不得写入',
    run: () => {
      const root = mkProject();
      try {
        const fp = computeHvigorInvocationFingerprint(root, DIMS);
        recordHvigorBuildOutcome(root, { kind: 'capability_failed', fingerprint: fp, failure_code: 'sdk_component_missing', evidence: [] });
        // codex 高优3：环境级失败对 invocation B 同样成立——指纹漂移不得洗掉 capability_failed
        const other = resolveProjectCompileState(root, 'fp-other-invocation');
        assert(other.status === 'capability_failed', `capability_failed 须跨 invocation 成立，got ${other.status}`);
        // 非白名单码（非环境级）→ 不写 capability_failed，只留 last_attempt 人读
        recordHvigorBuildOutcome(root, { kind: 'source_failure', summary: 'reset baseline' });
        recordHvigorBuildOutcome(root, { kind: 'capability_failed', fingerprint: fp, failure_code: 'weird_nonenv_code', evidence: [] });
        assert(resolveProjectCompileState(root, fp).status === 'unknown', '非白名单码不得建立 capability_failed');
        assert(evaluateCapabilityGapAtPreflight(root) === null, '非白名单码不得拦截 preflight');
        const local = JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'));
        assert(local.toolchain?.probe?.last_attempt?.summary?.includes('weird_nonenv_code'), '须留人读痕');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'config 摘要漂移 → 状态自动失效（跨 invocation/配置变更不再误拦）；过期同理',
    run: () => {
      const root = mkProject();
      try {
        const fp = computeHvigorInvocationFingerprint(root, DIMS);
        recordHvigorBuildOutcome(root, { kind: 'capability_failed', fingerprint: fp, failure_code: 'sdk_component_missing', evidence: [] });
        assert(evaluateCapabilityGapAtPreflight(root, Date.now() + TOOLCHAIN_PROBE_TTL_MS + 1000) === null, '过期须放行');
        fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ "app": { "sdk": "changed" } }', 'utf-8');
        assert(evaluateCapabilityGapAtPreflight(root) === null, '工程配置变更须自动失效回 unknown');
        assert(resolveProjectCompileState(root, fp).status === 'unknown', 'resolve 同样失效');
        // v3（codex 高优5）：DevEco 装配路径变更（换 IDE/SDK 安装）同样失效
        fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ "app": {} }', 'utf-8');
        const fp2 = computeHvigorInvocationFingerprint(root, DIMS);
        recordHvigorBuildOutcome(root, { kind: 'capability_failed', fingerprint: fp2, failure_code: 'sdk_home_missing_or_invalid', evidence: [] });
        assert(evaluateCapabilityGapAtPreflight(root) !== null, '基线：新记录可拦截');
        const lp = path.join(root, 'framework.local.json');
        const lc = JSON.parse(fs.readFileSync(lp, 'utf-8'));
        lc.toolchain = { ...(lc.toolchain ?? {}), devEcoStudio: { installPath: 'D:/New/DevEco Studio' } };
        fs.writeFileSync(lp, JSON.stringify(lc, null, 2), 'utf-8');
        assert(evaluateCapabilityGapAtPreflight(root) === null, '换 DevEco 装配路径须自动失效回 unknown');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '完整性摘要：手编伪造/篡改 probe → 按 unknown 处理（伪造不通过任何 gate）',
    run: () => {
      const root = mkProject();
      try {
        const fp = computeHvigorInvocationFingerprint(root, DIMS);
        recordHvigorBuildOutcome(root, { kind: 'capability_failed', fingerprint: fp, failure_code: 'sdk_component_missing', evidence: [] });
        // 手编：改 status 为 verified（未重算 integrity）
        const p = path.join(root, 'framework.local.json');
        const local = JSON.parse(fs.readFileSync(p, 'utf-8'));
        local.toolchain.probe.project_compile.status = 'verified';
        fs.writeFileSync(p, JSON.stringify(local, null, 2), 'utf-8');
        assert(resolveProjectCompileState(root, fp).status === 'unknown', '手编 verified 须被拒（integrity 失配→unknown）');
        // 手编：直接删 capability_failed 洗白 → 只能回 unknown（= 重跑编译定谳），无 gate 收益
        const local2 = JSON.parse(fs.readFileSync(p, 'utf-8'));
        delete local2.toolchain.probe.project_compile;
        fs.writeFileSync(p, JSON.stringify(local2, null, 2), 'utf-8');
        assert(evaluateCapabilityGapAtPreflight(root) === null, '删除记录=unknown（wrapper 下次真实结果重建）');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
