// ============================================================================
// ut-hvigor-build-classify.unit.test.ts
// ============================================================================
// 覆盖 classifyConfigSchemaError：从 hvigor 合并日志识别「构建配置文件 schema 校验失败」
// （如 build-profile.json5 的 target 里塞了非法字段），返回可操作回退诊断。

import { classifyConfigSchemaError } from '../../ut-host-impl';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

const SCHEMA_LOG = [
  'Schema validate failed',
  "instancePath: 'targets[1]'",
  "property name 'applyToProducts' is invalid",
  'message: must be equal to one of the allowed values',
  'location: D:/1.code/SimulatedWalletForHmos/01-Product/Phone/build-profile.json5:29:6',
].join('\n');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'classifyConfigSchemaError: build-profile.json5 非法字段 → build_config_invalid',
    run: () => {
      const out = classifyConfigSchemaError(SCHEMA_LOG);
      assert(out !== null, '应命中 schema 错');
      assert(out!.kind === 'build_config_invalid', 'kind');
      assert(out!.suggestion.includes('build-profile.json5'), 'suggestion 含 file');
      assert(out!.suggestion.includes('回退'), 'suggestion 含回退指引');
      assert(
        out!.suggestion.includes('name/config/source/resource/runtimeOS/output'),
        'suggestion 含 allowed 字段',
      );
    },
  },
  {
    name: 'classifyConfigSchemaError: 无 file 引用时仍命中并给泛化文案',
    run: () => {
      const out = classifyConfigSchemaError('Schema validate failed: some generic schema error');
      assert(out !== null, '仅凭 schema 信号即命中');
      assert(out!.kind === 'build_config_invalid', 'kind');
    },
  },
  {
    name: 'classifyConfigSchemaError: 普通依赖错误 → null（不误吞）',
    run: () => {
      const out = classifyConfigSchemaError(
        'Failed to resolve OhmUrl for @ohos/foo; Cannot find module',
      );
      assert(out === null, '依赖错误不应被判为 config schema 错');
    },
  },
  {
    name: 'classifyConfigSchemaError: 普通 TS 编译错误 → null',
    run: () => {
      const out = classifyConfigSchemaError("ut.test.ets:12:5 TS2341 Property 'x' is private");
      assert(out === null, 'TS 错误不应命中');
    },
  },
];

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

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
