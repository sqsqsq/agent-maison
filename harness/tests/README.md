# Framework Harness Regression Tests

> 验证 framework 自身 harness 规则的回归测试套件。**随 framework 一起发布到宿主工程**，作为升级回归保险——宿主工程跑 `/framework-init`（Skill 00 Step 5.5.4）时由 Skill 内部触发自检，确认本次 vendor 过来的 framework 文件完整且行为正常。**不参与业务流水线**，宿主工程只在初始化 / 升级时跑一次。

## 设计原则

1. **跑的是 framework 自己**：每个 fixture 是一个最小化的"虚构工程"，被拷贝到 `os.tmpdir()`，由当前仓库的 `framework/harness/scripts/check-*.ts` 直接调用。
2. **fixture 不带 framework**：通过 `resolvePaths(projectRoot, frameworkRoot)` 把 fixture 的 projectRoot 与真实 frameworkRoot 解耦——fixture 只装 feature 资产 + 业务源码骨架。
3. **断言粒度**：只断言期望条目；不在 EXPECTED.json 中提及的规则不强制——避免把无关规则的状态绑定到 fixture。
4. **跳过 Step 4/5**：不生成 AI prompt / merged report，只校验 Step 3 的 `CheckResult[]`。
5. **跨平台**：`spawnSync('git', ...)` 不走 shell；fixture 运行时自动 `git init + commit baseline`，让 `ut_no_src_mutation` 等依赖 git 的规则可用。

## 用法

```bash
# 跑全部 fixture
npx ts-node framework/harness/tests/run-tests.ts

# 只跑某子集
npx ts-node framework/harness/tests/run-tests.ts --filter v2_2/ut_tsc

# 调试：保留 fixture tmpdir（默认运行后清理）
KEEP_TMPDIR=1 npx ts-node framework/harness/tests/run-tests.ts
```

退出码：0 全部通过；1 任一 fixture 断言失败；2 runner 自身崩栈。

## 目录结构

```
tests/
├── README.md                ← 本文件
├── run-tests.ts             ← 入口（三扫描根：本目录 `fixtures/` + `profiles/hmos-app/` + `profiles/generic/` 各自 `tests/fixtures/`）
├── utils/
│   └── fixture-runner.ts    ← 拷贝 fixture / 跑 checker / 断言
└── fixtures/
    ├── README.md              ← 契约用例迁徙说明（CMD 正文在 profiles/*/harness/tests/fixtures）
    └── visual_handoff/        ← 仅存回归说明 Markdown
```

**含 `INPUT/` + `CMD.json` 的 fixture** 已迁至：

- `framework/profiles/hmos-app/harness/tests/fixtures/`（`init/`、`prd/`、`v2_2/`）
- `framework/profiles/generic/harness/tests/fixtures/`（`profile_generic/`）

`run-tests.ts` 内 **`FIXTURE_TREE_ROOTS_REL_TO_FRAMEWORK`** 列出相对 `framework/` 的树根；新建 profile 契约基线时请追加条目。合并扫描本目录（含仅说明子树）与各 profile；逻辑名全局唯一。

```
    <group>/<case>/
        ├── INPUT/                              ← 拷贝到 tmpdir；git baseline
        ├── AFTER_BASELINE/   （可选）
        ├── REPORTS/           （可选）
        ├── CMD.json
        └── EXPECTED.json
```

## 写新 fixture

最小三件套：

### `INPUT/`
被拷贝到 tmpdir 作为 projectRoot 的最小工程骨架。一般至少包含：
- `doc/features/<feature>/acceptance.yaml`（可空数组，但文件必须在；**键名须为 `criteria` / `boundaries`**，与 `AcceptanceSpec` 一致——`acceptance_criteria` 不会被 SpecLoader 映射）
- 你要触发的规则所需的源码 / yaml

**v2.3 UT（可测性 + mock-plan + spy_preset）fixture 示例**：`profiles/hmos-app/harness/tests/fixtures/v2_2/ut_v23_audit_missing_fail`、`ut_v23_l3_option_a_untracked_fail`、`ut_v23_l3_option_b_no_auth_fail`、`ut_v23_mock_plan_contract_orphan_fail`、`ut_v23_mock_plan_method_orphan_fail`、`ut_v23_mock_plan_missing_fail`、`ut_v23_mock_plan_untyped_fail`、`ut_v23_spy_preset_unknown_fail`。

如果你的规则需要 `framework.config.json`（自定义架构 DSL），把它放到 `INPUT/framework.config.json`。否则走 `LEGACY_DEFAULT_DSL`。

### `CMD.json`
```json
{
  "phase": "ut",
  "feature": "demo",
  "env": {
    "HARNESS_SKIP_HVIGOR": "1",
    "HARNESS_SKIP_HVIGOR_TEST": "1"
  }
}
```

`env` 可选，会在跑 checker 期间临时注入到 `process.env`。

### `EXPECTED.json`
```json
{
  "verdict": "FAIL",
  "rules": [
    {
      "id": "ut_tsc_compiles",
      "status": "FAIL",
      "severity": "BLOCKER",
      "details_includes": "TS2322"
    },
    {
      "id": "named_business_handler",
      "must_be_absent": true
    }
  ]
}
```

字段语义：
- `id` — 必填；规则 id（与 `check-*.ts` 中 `CheckResult.id` 对应）
- `status` — 期望 `PASS / FAIL / WARN / SKIP`
- `severity` — 期望严重度
- `details_includes` — `details` 字段必须包含的子串
- `must_be_absent` — 该规则**不应**出现在 result[]（用于反向断言"该规则未触发"）
- `verdict`（顶层） — 整体 verdict（任一 BLOCKER FAIL → FAIL，否则 PASS）

## 当前 fixture 一览

| Fixture | 验证 | 期望 |
|---------|------|------|
| `v2_2/ut_tsc_compiles_pass` | 干净 UT 文件 → tsc 静态扫描 | `ut_tsc_compiles` PASS/BLOCKER |
| `v2_2/ut_tsc_compiles_fail` | UT 含 `const x: number = "abc"` | `ut_tsc_compiles` FAIL/BLOCKER，details 含 `TS` |
| `v2_2/named_handler_class_field_pass` | use-cases 引用类字段函数 / 顶层 const 箭头 / 传统 method | `named_business_handler` PASS/BLOCKER |
| `v2_2/named_handler_inline_lambda_fail` | calls 指向纯 inline lambda（无命名入口） | `named_business_handler` FAIL/BLOCKER |
| `v2_2/named_handler_comment_only_fail` | 注释里写了 `function handleFoo`，真实实现缺失 | `named_business_handler` FAIL/BLOCKER（回归：scanner 必须剥注释） |
| `v2_2/hvigor_env_skip_is_fail` | UT 阶段设 `HARNESS_SKIP_HVIGOR=1` / `HARNESS_SKIP_HVIGOR_TEST=1` | `ut_hvigor_build` / `ut_hvigor_test` 均 FAIL/BLOCKER |
| `v2_2/coding_hvigor_build_skip_is_fail` | coding 阶段设 `HARNESS_SKIP_HVIGOR=1` | `coding_hvigor_build` FAIL/BLOCKER |
| `v2_2/ut_no_src_mutation_fail` | baseline 后改 `02-Feature/**/src/main/**`，未登记 gap-notes | `ut_no_src_mutation` FAIL/BLOCKER |
| `v2_2/ut_no_src_mutation_approved_pass` | baseline 后改业务源码，并在 gap-notes 登记该文件 | `ut_no_src_mutation` PASS/BLOCKER |

共 9 个 fixture。运行耗时约 13-15s（Windows，纯逻辑路径，跳过真实 hvigor）。

## 反向注入覆盖映射

| 反向注入目标 | 对应 fixture |
|------------|-------------|
| UT 编译期类型错 | `ut_tsc_compiles_fail` |
| 放宽 named_handler 后新识别形态 | `named_handler_class_field_pass` |
| 放宽 named_handler 后**仍应**拒绝的 inline lambda | `named_handler_inline_lambda_fail` |
| 注释里伪造的命名入口（scanner 剥注释缺陷回归） | `named_handler_comment_only_fail` |
| 用环境变量软跳 hvigor（UT 阶段） | `hvigor_env_skip_is_fail` |
| 用环境变量软跳 hvigor（coding 阶段） | `coding_hvigor_build_skip_is_fail` |
| Skill 5 阶段擅自改业务源码 | `ut_no_src_mutation_fail` |
| 登记 gap-notes 后允许改业务源码 | `ut_no_src_mutation_approved_pass` |

## 规则

1. **新增 BLOCKER 规则前**：先写正反两个 fixture，跑通后再合入 `check-*.ts`
2. **修改既有规则**：先看 fixture 是否仍然通过；如果断言要改，连带改 `EXPECTED.json` 并在 PR 描述里说明语义变化
3. **不要让 fixture 依赖 hvigor / hdc / 模拟器**：那部分是宿主 app 的契约测试范畴，不在本套件

---

## 单元测试套件（v2.3 起）

`tests/unit/` 下放**白盒级纯函数**单元测试，与 fixture 端到端测试互补。

### 用途

v2.3 引入的 BLOCKER（`coding_hvigor_build` / `ut_hvigor_build` / `ut_hvigor_test`）
全部依赖真实工具链（hvigor / hdc / 真机），fixture 隔离 tmpdir 无法复现完整失败
路径，强行 mock 整个 spawnSync 输出价值低。**真正高回归风险的是 `hdc-runner`
里的纯函数**：

- `parseHypiumStdout` — DevEco / hypium 升级时输出格式可能变
- `findOhosTestSignedHap` — DevEco 升级时 hap 命名约定可能变
- `loadAppBundleName` / `loadOhosTestModuleName` — json5 注释/尾逗号兼容

把这些用裸 assert 圈住，DevEco 一旦升级把输出/命名改了，单测立刻挂出来，倒
逼工具层同步升级。

### 用法

```bash
# 跑全部 unit
npx ts-node framework/harness/tests/run-unit.ts

# 子集
npx ts-node framework/harness/tests/run-unit.ts --filter parseHypium

# fixtures + unit 一起跑
cd framework/harness && npm test
```

### 写新 unit 套件

每个套件是一个 `tests/unit/<id>.unit.test.ts`，**导出 `runAll(): UnitCaseResult[]`**：

```ts
export interface UnitCaseResult { name: string; ok: boolean; error?: string; }

const cases = [
  { name: '...', run: () => { /* throw on failure */ } },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try { c.run(); return { name: c.name, ok: true }; }
    catch (e) { return { name: c.name, ok: false, error: (e as Error).message }; }
  });
}
```

然后在 `run-unit.ts` 的 `SUITES` 数组里登记。无需引入额外 test framework。
