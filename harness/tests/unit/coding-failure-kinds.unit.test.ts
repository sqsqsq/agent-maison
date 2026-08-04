// ============================================================================
// coding 编译失败归因：classifyCodingCompileFailure 枚举与禁止历史 kind 字面
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import type { CheckContext } from '../../scripts/utils/types';
import { withDefaultLayoutFields, DEFAULT_LAYOUT, layoutFieldsForHost } from '../utils/layout-test-helper';
import {
  classifyCodingCompileFailure,
  resolveCompileBlockingClass as resolveCompileBlockingClassForTest,
  type CodingCompileFailureKind,
} from '../../../profiles/hmos-app/harness/coding-host-rules';
import { resolveVerdictFromChecks } from '../../scripts/utils/report-generator';
import {
  classifyPhaseVerdict,
  isDeferrableExternalBlock,
} from '../../scripts/utils/phase-transition-policy';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const PROFILES_ROOT = path.resolve(__dirname, '..', '..', '..', 'profiles');
const hmosProfileDir = path.join(PROFILES_ROOT, 'hmos-app');

function mkCtx(projectRoot: string): CheckContext {
  const layoutFields =
    projectRoot === DEFAULT_LAYOUT.projectRoot
      ? {
          frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
          frameworkRel: DEFAULT_LAYOUT.frameworkRel,
          harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
          layoutKind: DEFAULT_LAYOUT.kind,
        }
      : layoutFieldsForHost(projectRoot);
  return {
    phase: 'coding',
    feature: 'unit',
    projectRoot,
    phaseRule: { phase: 'coding', structure_checks: {}, semantic_checks: {}, traceability_checks: {} } as any,
    featureSpec: { feature: 'unit' },
    resolvedProfile: {
      name: 'hmos-app',
      profileDir: hmosProfileDir,
      yaml: {} as any,
      phasesDisabled: new Set(),
      capabilities: {
        'coding.compile': { provider: 'hvigor', severity: 'BLOCKER' },
      },
      personalPrerequisites: {},
    },
    ...layoutFields,
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'classify: toolMissing → toolchain',
    run: () => {
      const r = classifyCodingCompileFailure({ toolMissing: true }, mkCtx(process.cwd()));
      assert.strictEqual(r.kind, 'toolchain');
    },
  },
  {
    name: 'classify: skippedByEnv → env_skip',
    run: () => {
      const r = classifyCodingCompileFailure({ skippedByEnv: true }, mkCtx(process.cwd()));
      assert.strictEqual(r.kind, 'env_skip');
    },
  },
  {
    name: 'classify: timedOut → compile_timeout',
    run: () => {
      const r = classifyCodingCompileFailure({ timedOut: true }, mkCtx(process.cwd()));
      assert.strictEqual(r.kind, 'compile_timeout');
    },
  },
  {
    name: 'classify: exit0 无 error 但缺成功哨兵 → compile_incomplete_output',
    run: () => {
      const r = classifyCodingCompileFailure(
        { executed: true, exitCode: 0, errors: [], successMarkerFound: false },
        mkCtx(DEFAULT_LAYOUT.projectRoot),
      );
      assert.strictEqual(r.kind, 'compile_incomplete_output');
    },
  },
  {
    name: 'classify: 依赖解析失败日志 → project_dependency_missing 且含 depIssue',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-dep-'));
      try {
        fs.writeFileSync(
          path.join(root, 'oh-package.json5'),
          ['{', '  "dependencies": {', '    "@hms-network/url": "1.0.0"', '  }', '}'].join('\n'),
          'utf-8',
        );
        const r = classifyCodingCompileFailure(
          {
            executed: true,
            exitCode: 1,
            errors: [
              { message: 'Failed to resolve OhmUrl @hms-security/agoh-crypto/src/main/ets/d/crypto/v1/w1' },
            ],
          },
          mkCtx(root),
        );
        assert.strictEqual(r.kind, 'project_dependency_missing');
        assert.ok(r.depIssue?.found, '应附带 depIssue');
        assert.ok(r.suggestion.includes('harness 将自动尝试 ohpm install'), '建议应指向自动安装');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'classify: 普通编译失败 → project_build',
    run: () => {
      const r = classifyCodingCompileFailure(
        { executed: true, exitCode: 1, errors: [{ message: 'ArkTS compile error in Foo.ets' }] },
        mkCtx(DEFAULT_LAYOUT.projectRoot),
      );
      assert.strictEqual(r.kind, 'project_build');
    },
  },
  {
    // 根因 B 回归：rollup 首错 "Unexpected token"（真实代码/构建错误）+ 无解析失败信号
    // → 必须 project_build（引导改 file:line），绝不再盖成 project_dependency_*。
    name: 'classify(B): rollup Unexpected token 真错 → project_build 非依赖误判',
    run: () => {
      const r = classifyCodingCompileFailure(
        {
          executed: true,
          exitCode: 1,
          errors: [
            {
              file: 'CardLifecycle.ets',
              line: 59,
              message:
                'Unexpected token (Note that you need plugins to import files that are not JavaScript)',
            },
          ],
        },
        mkCtx(DEFAULT_LAYOUT.projectRoot),
      );
      assert.strictEqual(r.kind, 'project_build');
    },
  },
  {
    name: '禁止 failure_kind 历史字面 hvigor_timeout / hvigor_incomplete_output',
    run: () => {
      const srcPath = path.join(hmosProfileDir, 'harness', 'coding-host-rules.ts');
      const text = fs.readFileSync(srcPath, 'utf-8');
      assert.ok(!text.includes('hvigor_timeout'), '应已更名为 compile_timeout');
      assert.ok(!text.includes('hvigor_incomplete_output'), '应已更名为 compile_incomplete_output');
    },
  },
  {
    name: 'CodingCompileFailureKind 并集可穷举（回归新增分支）',
    run: () => {
      const all: CodingCompileFailureKind[] = [
        'toolchain',
        'env_skip',
        'compile_timeout',
        'compile_incomplete_output',
        'project_dependency_missing',
        'project_dependency_undeclared',
        'project_dependency_install_failed',
        'project_build',
      ];
      assert.strictEqual(all.length, 8);
    },
  },
];


// ============================================================================
// f9c2e6b4 t2 —— hvigor 配置错误按**路径存在性**分流（分类矩阵，不做散文元门禁）
// 立项 run 20260803T103413Z-3f72a8：hvigor 23ms 配置失败，六条 resolve 正则不命中，
// 落兜底 project_build → 让 agent 去找一个 `(no file)` 的 file:line。
// ============================================================================

/** 真实宿主日志形态（**保留 ANSI 转义**，实证 hvigor-build.log） */
function hvigorConfigErrorLog(atPath: string): string {
  return [
    '> hvigor [91mERROR: [31m00303149 Configuration Error',
    `Error Message: Path not found. At file: ${atPath}`,
    '',
    '* Try the following:',
    '  > Please check field: modules in file: build-profile.json5.',
    '[39m',
    '> hvigor [91mERROR: BUILD FAILED in 23 ms [39m',
  ].join('\n');
}

cases.push(
  {
    name: 't2 配置错误 + 路径不存在 → project_config_error（不再落 project_build）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgerr-'));
      const missing = path.join(root, '05-SystemBase', 'CommFunc');
      const r = classifyCodingCompileFailure(
        { executed: true, exitCode: 1, errors: [], logExcerpt: hvigorConfigErrorLog(missing) },
        mkCtx(root),
      );
      assert.strictEqual(r.kind, 'project_config_error');
      assert.ok(/ohpm install/.test(r.suggestion), '须显式劝阻用 ohpm install 解决');
    },
  },
  {
    name: 't2 配置错误 + 路径实际存在 → project_build_environment_inconsistent（立项事故形态）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgerr-'));
      const present = path.join(root, '05-SystemBase', 'CommFunc');
      fs.mkdirSync(present, { recursive: true });
      const r = classifyCodingCompileFailure(
        { executed: true, exitCode: 1, errors: [], logExcerpt: hvigorConfigErrorLog(present) },
        mkCtx(root),
      );
      assert.strictEqual(r.kind, 'project_build_environment_inconsistent');
      assert.ok(/不应.*让 agent 改代码|不再启动 agent|不应/.test(r.suggestion), '须明示不该让 agent 改代码');
    },
  },
  {
    // codex 复核 P1：局部分类对了不代表状态穿透到最终裁决。这条走**生产链**：
    // check 结果 → resolveVerdictFromChecks → isDeferrableExternalBlock → goal action。
    name: 't2 生产链：环境不一致须一路走到 external defer（不得回去让 agent 改代码）',
    run: () => {
      const check = {
        id: 'coding_compile',
        category: 'structure',
        description: 'x',
        severity: 'BLOCKER',
        status: 'FAIL',
        failure_kind: 'project_build_environment_inconsistent',
        blocking_class: resolveCompileBlockingClassForTest('project_build_environment_inconsistent'),
      } as never;
      assert.strictEqual(
        (check as { blocking_class: string }).blocking_class,
        'externalBlocked',
        '必须落既有 externalBlocked 契约，否则策略层认不出来',
      );
      const verdict = resolveVerdictFromChecks([check]);
      assert.strictEqual(verdict, 'INCOMPLETE', 'external 阻塞须投影 INCOMPLETE 而非 FAIL');
      assert.ok(
        isDeferrableExternalBlock(
          (check as { blocking_class: string }).blocking_class,
          'project_build_environment_inconsistent',
        ),
        'dependency policy 须认出它是可延期的外部阻塞',
      );
      const action = classifyPhaseVerdict({
        verdict,
        blocking_class: (check as { blocking_class: string }).blocking_class,
        failure_kind: 'project_build_environment_inconsistent',
      } as never);
      assert.ok(
        String(action).startsWith('defer_external'),
        `最终动作须是 defer_external*，实得 ${String(action)}——否则又回到 agent 内容重试`,
      );
    },
  },
  {
    name: 't2 探测范围：非 00303149 / 缺 At file 一律不进本分流（走既有分类）',
    run: () => {
      const other = classifyCodingCompileFailure(
        {
          executed: true, exitCode: 1, errors: [],
          logExcerpt: '> hvigor ERROR: 00301001 Configuration Error\nError Message: something else',
        },
        mkCtx(process.cwd()),
      );
      assert.notStrictEqual(other.kind, 'project_config_error');
      assert.notStrictEqual(other.kind, 'project_build_environment_inconsistent');
      const noPath = classifyCodingCompileFailure(
        {
          executed: true, exitCode: 1, errors: [],
          logExcerpt: '> hvigor ERROR: 00303149 Configuration Error\nError Message: no path here',
        },
        mkCtx(process.cwd()),
      );
      assert.notStrictEqual(noPath.kind, 'project_build_environment_inconsistent');
    },
  },
  {
    name: 't2 普通编译错误不受影响（配置判据不得越界吃掉真编译失败）',
    run: () => {
      const r = classifyCodingCompileFailure(
        {
          executed: true,
          exitCode: 1,
          errors: [{ file: 'a.ets', line: 12, message: 'Type error' }],
          logExcerpt: 'a.ets(12,3): error TS2322: Type error',
        },
        mkCtx(process.cwd()),
      );
      assert.strictEqual(r.kind, 'project_build');
      assert.ok(/定位文件\/行/.test(r.suggestion), '有 file/line 时仍应指向源码位置');
    },
  },
  {
    name: 't2 无 file/line 时兜底话术不得说"定位文件/行"（原独立 todo 并入）',
    run: () => {
      const r = classifyCodingCompileFailure(
        { executed: true, exitCode: 1, errors: [{ message: 'something broke, no location' }] },
        mkCtx(process.cwd()),
      );
      assert.strictEqual(r.kind, 'project_build');
      assert.ok(!/定位文件\/行/.test(r.suggestion), '无 file/line 却让 agent 定位文件行 = 不可执行指令');
      assert.ok(/首条错误/.test(r.suggestion), '应把首条错误原样呈现');
    },
  },
);

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
