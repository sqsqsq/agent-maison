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
  type CodingCompileFailureKind,
} from '../../../profiles/hmos-app/harness/coding-host-rules';

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
