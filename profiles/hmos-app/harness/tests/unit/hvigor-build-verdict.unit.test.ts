// ============================================================================
// hvigor-build-verdict.unit.test.ts — 构建终态判据回归（plan a7c3f9e2 t1）
// ============================================================================
//
// 回归背景：`2cb124bd` 给 parseBuildErrors 加 stripAnsi 后，激活了从不命中的死规则
// `/> hvigor ERROR/`——宿主 ConfigurationMng 插件每次构建打两条**非致命**
// `> hvigor ERROR: [genDicConfigFile] merge error {ENOENT}`，此后仍 BUILD SUCCESSFUL；
// 而 coding / device-testing / ut 出口都曾要求 errors.length === 0 → 真成功也判 FAIL。
//
// 新契约：成功与否只由 executed / timedOut / exitCode / successMarkerFound 决定；
// errors[] 只进诊断与失败归因。夹具是宿主 08-17 取证日志的**真实字节切片**
// （见 fixtures/host-hvigor/README.md，ANSI 原文字节保留）。
//
// 出口覆盖（意见2 P1 修正）：四处处出口——coding（isCompilePass）、device-testing
// provider（ok）、check-testing 门禁（compileOk）、**ut_hvigor_build（bad 过滤）**——
// 必须全部共用 isHvigorBuildSuccessful，同一份真实日志判定一致。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import { withDefaultLayoutFields, layoutFieldsForHost, DEFAULT_LAYOUT } from '../../../../../harness/tests/utils/layout-test-helper';
import {
  isHvigorBuildSuccessful,
  parseBuildErrors,
} from '../../../../../harness/scripts/utils/hvigor-runner';
import {
  classifyCodingCompileFailure,
  isCompilePass,
} from '../../coding-host-rules';
import { isDeviceTestBuildOk } from '../../providers/device-test-build';
import { deviceTestGateCompileOk } from '../../../../../harness/scripts/check-testing';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const PROFILES_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', 'profiles');
const hmosProfileDir = path.join(PROFILES_ROOT, 'hmos-app');
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'host-hvigor');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

function mkCtx(projectRoot: string): CheckContext {
  const layoutFields =
    projectRoot === DEFAULT_LAYOUT.projectRoot
      ? withDefaultLayoutFields({})
      : layoutFieldsForHost(projectRoot);
  return {
    phase: 'coding',
    feature: 'unit',
    projectRoot,
    phaseRule: { phase: 'coding', structure_checks: {}, semantic_checks: {}, traceability_checks: {} } as never,
    featureSpec: { feature: 'unit' } as never,
    resolvedProfile: {
      name: 'hmos-app',
      profileDir: hmosProfileDir,
      yaml: {} as never,
      phasesDisabled: new Set<string>(),
      capabilities: {
        'coding.compile': { provider: 'hvigor', severity: 'BLOCKER' },
      } as never,
      personalPrerequisites: {},
    } as never,
    ...layoutFields,
  } as CheckContext;
}

function hostResult(log: string, extra: { exitCode: number; timedOut?: boolean }): {
  executed: true;
  exitCode: number;
  timedOut: boolean;
  successMarkerFound: boolean;
  errors: ReturnType<typeof parseBuildErrors>;
  logExcerpt: string;
  durationMs: number;
} {
  return {
    executed: true,
    exitCode: extra.exitCode,
    timedOut: extra.timedOut === true,
    successMarkerFound: /BUILD SUCCESSFUL/.test(log),
    errors: parseBuildErrors(log),
    logExcerpt: log.slice(-8000),
    durationMs: 0,
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    // (a) 本回归的正向锁：exit0 + BUILD SUCCESSFUL + 2 条非致命 ERROR（真实字节，ANSI 保留）→ PASS
    name: 'exit0 + BUILD SUCCESSFUL + 2 条非致命 ERROR → 仍 PASS（errors 不参与终态）',
    run: () => {
      const log = readFixture('nonfatal-error-success.log');
      const res = hostResult(log, { exitCode: 0 });
      assert.strictEqual(res.errors.length, 2, '真实切片应解析出 2 条 ERROR（诊断可见性不回归）');
      assert.strictEqual(
        res.errors.every(e => e.message.includes('[ConfigurationMng] [genDicConfigFile] merge error')),
        true,
        '两条非致命 ERROR 为 ConfigurationMng 噪声（带 ENOENT），逐字保留',
      );
      assert.strictEqual(isCompilePass(res), true, 'coding 出口必须判 PASS');
      assert.strictEqual(isHvigorBuildSuccessful(res), true, '共享判据一致');
    },
  },
  {
    // (b) 防过度放宽：exit≠0 + BUILD FAILED + 真实 5 条 ArkTS 错 → FAIL，归因 project_build
    name: 'exit≠0 + BUILD FAILED + 5 条 ArkTS 错（COMPILE RESULT:FAIL ERROR:5）→ FAIL',
    run: () => {
      const log = readFixture('arkts-fail.log');
      assert(log.includes('COMPILE RESULT:FAIL {ERROR:5 WARN:3944}'), '真实日志声明 5 条错误');
      assert(log.includes('BUILD FAILED'), '真实日志 BUILD FAILED');
      const res = hostResult(log, { exitCode: 1 });
      assert.ok(res.errors.length > 0, '应解析出错误条目');
      assert.strictEqual(res.errors.some(e => e.file?.includes('export4ads.ets')), true, '可定位 file');
      assert.strictEqual(isCompilePass(res), false);
      // 真实事故切片命中 "Cannot find module"（ads-sdk HAR 解析失败正是事故根因线索）——
      // classify 归因 project_dependency_missing 是**正确行为**，与本判据回归正交。
      const cls = classifyCodingCompileFailure(res, mkCtx(DEFAULT_LAYOUT.projectRoot));
      assert.strictEqual(cls.kind, 'project_dependency_missing');
    },
  },
  {
    // (c) exit0 但 successMarkerFound === false → 仍 compile_incomplete_output（保留不动）
    name: 'exit0 但 successMarkerFound=false → 仍 compile_incomplete_output',
    run: () => {
      const res = hostResult(readFixture('nonfatal-error-success.log'), { exitCode: 0 });
      res.successMarkerFound = false;
      res.errors = [];
      assert.strictEqual(isCompilePass(res), false);
      const cls = classifyCodingCompileFailure(res, mkCtx(DEFAULT_LAYOUT.projectRoot));
      assert.strictEqual(cls.kind, 'compile_incomplete_output');
    },
  },
  {
    // (d) executed === false（toolMissing / skippedByEnv）→ 仍判失败，不受去掉 errors 影响
    name: 'executed=false（toolMissing）→ FAIL（classify=toolchain）',
    run: () => {
      const res = { executed: false, toolMissing: true, durationMs: 0, logExcerpt: 'x', errors: [] as never[] };
      assert.strictEqual(isCompilePass(res as never), false);
      const cls = classifyCodingCompileFailure(res as never, mkCtx(DEFAULT_LAYOUT.projectRoot));
      assert.strictEqual(cls.kind, 'toolchain');
    },
  },
  {
    // (e) timedOut → FAIL
    name: 'timedOut=true → FAIL',
    run: () => {
      const res = hostResult(readFixture('arkts-fail.log'), { exitCode: -1, timedOut: true });
      assert.strictEqual(isCompilePass(res), false);
      const cls = classifyCodingCompileFailure(res, mkCtx(DEFAULT_LAYOUT.projectRoot));
      assert.strictEqual(cls.kind, 'compile_timeout');
    },
  },
  {
    // (f) 四处处出口**真实生产函数**在**同一份真实日志解析结果**上判定一致
    //（review P2 第二轮修正：四种出口均被 import 并执行，不再只测共享 helper）：
    //   coding → isCompilePass；device provider → isDeviceTestBuildOk；
    //   check-testing 门禁 → deviceTestGateCompileOk；ut bad 过滤 → isHvigorBuildSuccessful。
    name: 'coding/device-testing/ut 四出口真实生产函数在真实成功/失败日志上判定一致',
    run: () => {
      // 正向：真实成功日志（exit0 + marker + 2 条非致命 ERROR）
      const okLog = readFixture('nonfatal-error-success.log');
      const okRes = hostResult(okLog, { exitCode: 0 });
      assert.strictEqual(isCompilePass(okRes), true, 'coding 出口');
      assert.strictEqual(isDeviceTestBuildOk(okRes), true, 'device-test provider 出口');
      assert.strictEqual(deviceTestGateCompileOk(false, okRes), true, 'check-testing 门禁出口（非复用）');
      assert.strictEqual(deviceTestGateCompileOk(true, okRes), true, 'check-testing 门禁出口（复用恒 PASS）');
      assert.strictEqual(isHvigorBuildSuccessful(okRes), true, 'ut bad 过滤判据（不 FAIL）');
      // ut 第四处出口（意见2 P1）：旧判据 `executed && (exitCode!==0 || errors.length>0)`
      // 在 errors>0 时误杀真成功；新判据与前三处同源。
      assert.strictEqual(Boolean(okRes.executed && (okRes.exitCode !== 0 || okRes.errors.length > 0)), true, '旧判据会误伤（证明回归必要性）');
      // 反向：真实失败日志
      const badLog = readFixture('arkts-fail.log');
      const badRes = hostResult(badLog, { exitCode: 1 });
      assert.strictEqual(isCompilePass(badRes), false, 'coding 出口');
      assert.strictEqual(isDeviceTestBuildOk(badRes), false, 'device-test provider 出口');
      assert.strictEqual(deviceTestGateCompileOk(false, badRes), false, 'check-testing 门禁出口（非复用）');
      assert.strictEqual(isHvigorBuildSuccessful(badRes), false, 'ut bad 过滤判据（FAIL）');
    },
  },
  {
    // (f2) 第四处出口接线回归：ut_hvigor_build 的 bad 过滤与状态行共用 isHvigorBuildSuccessful
    name: 'ut_hvigor_build 出口接线回归（bad 过滤与状态行共用 isHvigorBuildSuccessful）',
    run: () => {
      const src = fs.readFileSync(path.join(hmosProfileDir, 'harness', 'ut-host-impl.ts'), 'utf-8');
      assert(
        /const bad = perModule\.filter\(x => !isHvigorBuildSuccessful\(x\.result\)\)/.test(src),
        'bad 过滤必须使用 isHvigorBuildSuccessful（不得内联 errors.length 判据）',
      );
      assert(
        /: isHvigorBuildSuccessful\(r\) \? 'PASS'/.test(src),
        'perModuleStatusLines 状态行必须与 bad 过滤同源（报告与门禁同判）',
      );
      assert(!/r\.exitCode === 0 && r\.errors\.length === 0/.test(src), 'ut-host 不得残留 errors.length 判据');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: (e as Error).stack ?? (e as Error).message };
    }
  });
}