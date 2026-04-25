# Skill 5 · 业务级 UT（对外讲解）

> **本文档定位**：业务级 UT 阶段的**设计哲学 + 演进史 + 常见坑**。
>
> **不是**：操作手册（操作手册见 [`../../skills/5-business-ut/SKILL.md`](../../skills/5-business-ut/SKILL.md)）。
>
> **读完后你会知道**：为什么 framework 选择"业务流端到端"而非"DAG 自动生成 UT"；v2 → v2.1 → v2.2 三次迭代各解决了什么；哪些做法看起来诱人但实际是反模式；接入工程后做 UT 阶段最容易踩的坑。

---

## 目录

- [一、为什么需要"业务级 UT"](#一为什么需要业务级-ut)
- [二、v1 的诱人想法 + 它为什么不能用](#二v1-的诱人想法--它为什么不能用)
- [三、v2 的过度架构化 + v2.1 的回退](#三v2-的过度架构化--v21-的回退)
- [四、v2.1 的核心设计](#四v21-的核心设计)
- [五、v2.2 的"假 PASS"三道护栏](#五v22-的假-pass-三道护栏)
- [六、关键产物速览](#六关键产物速览)
- [七、常见坑速查](#七常见坑速查)
- [八、与上下游 Skill 的契约](#八与上下游-skill-的契约)

---

## 一、为什么需要"业务级 UT"

### 1.1 普通"接口级 UT"在大型业务工程里不够用

在 HarmonyOS 工程里写 UT 时，常见的失败模式是 **"声明覆盖陷阱"**：

```typescript
// 看起来覆盖率 80%+，线上一遇业务流程异常就炸
it('应该返回卡列表', async () => {
  const list = await repo.getCardList();
  expect(list.length).toBeGreaterThan(0);   // 业务流程根本没跑
});
```

问题不在"测得不够多"，而在**测试粒度错了**：

- 测的是 `repo.getCardList()` 这个数据接口，不是"用户点击 → 拉取 → 校验 → 渲染 → 持久化"这个业务流
- 业务流上的状态机变迁、多步云调用顺序、异常分支回滚 —— 都没被覆盖
- SDK 一升级、数据契约一改，UT 仍然全绿，事故仍然发生

### 1.2 Framework 的回答：业务流端到端驱动

**业务级 UT** 的定义：

> 一个 `it()` **完整驱动一个业务分支**，从命名入口（Page 方法 / `Flow` 类 / 导出函数）开始，按用户动作序列调用业务流，
> 在 **data 层边界**（既有 Repository / Client 类）打桩，断言 **state 序列 + data_boundary 调用序列 + 持久化数据**。

对应的硬规则：

| 规则                       | 严重度  | 触发逻辑                                                                              |
| -------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `it_drives_flow`           | MAJOR   | 每个 `it()` 必须有 ≥ 2 次 `data_boundary` 调用断言 + ≥ 2 次 state 断言               |
| `end_to_end_driving`       | BLOCKER | 由 AI Harness 复核：UT 是否真驱动了命名入口（不是直接绕过命名入口去调底层 repo）       |
| `branch_coverage_full`     | BLOCKER | `use-cases.yaml > branches[]` 中每条 branch 必须有对应的 `it("[BRANCH-id][AC-X]")`   |
| `acceptance_coverage`      | BLOCKER | `acceptance.yaml > criteria[]` 中 `ut_layer ∈ {unit, both}` 的每条 AC 必须有 UT 覆盖 |

---

## 二、v1 的诱人想法 + 它为什么不能用

framework 早期（v1 阶段）思路是 **"AI 根据 DAG 自动生成 UT"**：

```
源代码 → AST 解析 → 静态调用图 → DAG (YAML)
                                    ↓
                   AI 根据 DAG + Mock API 文档生成 UT
                                    ↓
                            运行 UT → 失败 → 自动修正循环
```

听起来很美。实际撞了三堵墙：

| 问题                            | 现象                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **DAG 自动生成精度不够**        | 静态分析对 ArkTS 的 `@State / @Prop / @Watch` 反应模型 + 装饰器语法支持有限；动态调用图缺日志校准时偏差大 |
| **AI 生成的 UT 编译通过率低**   | 弱模型生成代码大量 import 错误、类型不匹配；自动修正循环 5 轮后还在原地打转                            |
| **Mock 范围爆炸**               | 为了让 AI 能"自动 mock"任意系统 API，要预建一个比业务代码还大的 mock 库；SDK 升级时全部失效              |

更根本的问题：**"AI 自动生成 UT" 这个目标就错了**。UT 是**人类对业务行为预期的显式声明**，让 AI 自动生成等于让生产者自己写考卷自己答。考卷质量再高也救不了"考生答了等于没答"。

framework 后来转向的目标是：

> **"AI 写的 UT 必须是人类能看懂的业务流端到端剧本，且每条剧本都对应到 `acceptance.yaml` 的某条 AC / `use-cases.yaml` 的某条 branch。"**

DAG 没被丢掉，但角色变了：

- 不再是"AI 生成 UT 的输入" → 现在是"UT 与 acceptance/use-cases 之间的可视化桥梁"
- 由 AI 生成 + 人类审 + harness 校验对应关系，**不**作为唯一驱动源

---

## 三、v2 的过度架构化 + v2.1 的回退

### 3.1 v2 的硬规则（看起来很对，落地翻车）

v2 期间，framework 强制要求每个 feature 必须产出：

- `domain/usecase/XxxUseCase.ets`（独立类）
- `XxxPort` 接口（端口抽象）
- 构造器注入所有依赖

理论上这是端口/适配器架构（Hexagonal）的正解。实际遇到的最简单 feature（比如"首页拉两个接口展示"）也被强制抽出 `HomeLoadingUseCase + HomeDataPort`，结果：

| 反模式                                         | 实际后果                                            |
| ---------------------------------------------- | --------------------------------------------------- |
| 所有 feature 都套 UseCase 类                    | 一个三行业务流程被强抽成 80 行接口 + 类 + 注入逻辑 |
| 必须新造 Port 接口                             | 仅为给 UT 打桩用；与既有 data 层 Repository 重复     |
| `ports[]` 强制声明                             | 字段冗余；与 `contracts.yaml > interfaces[]` 重复     |
| UT 倒推架构（UT 不可写 → Skill 3 必须先抽 UseCase） | UT 成了架构的"独裁者"，违反"UT 是消费者"原则        |

更糟的是：framework 的硬规则本身**会系统性诱导后续 feature 重复犯错**。一旦"home-page 也产出了 UseCase + Port"被沉淀为先例，其他 feature 不抽就不能过 harness。

### 3.2 v2.1 的回退动作

| 维度               | v2 老表述                            | v2.1 新表述                                                                                  |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| 被测单元           | UseCase 类（必须在 `domain/usecase/`） | **命名业务入口**（Page 方法 / 普通 Flow 类 / 导出函数，由 Skill 3 自选）                       |
| 外部依赖抽象       | `ports[]`（必须新造 Port 接口）       | `data_boundaries[]`（引用 contracts.yaml 中既有 data 层类）                                    |
| UseCase 代码        | 强制产物                             | **不存在**；`use-cases.yaml` 只是文档规约                                                    |
| `use-cases.yaml`   | 有 `unit/both` AC 就必须产出          | 仅复杂 feature（多 UI 共享状态 / 多步云调用 / 含回滚分支 任一）产出                            |
| Stub 形式          | `SpyXxxPort`（实现 Port 接口）        | `SpyXxx / FakeXxx / StubXxx`（**子类化既有 data 层类**）或**原型方法替换**                     |
| DAG 中的 use_case  | 指向 UseCase class 名                | 指向 `use-cases.yaml > use_cases[].id`（无 use-cases.yaml 则可省）                            |

**核心改变**：framework 不再要求"为了让 UT 能写，反过来重塑业务架构"。

### 3.3 教训（值得记到墓志铭上）

> 做 framework 时最怕的不是功能不够，是把某种架构风格强塞进所有场景。
>
> "可测性"是必要条件，不是充分条件。把"可测"和"必须采用某种特定架构"画等号，会让 framework 成为业务的负担而非帮手。

---

## 四、v2.1 的核心设计

### 4.1 两条规划路径

UT 的规划入口由 feature 复杂度决定：

| 路径   | 触发条件                                                                | 主规划来源                              |
| ------ | ----------------------------------------------------------------------- | --------------------------------------- |
| **A**  | feature 满足复杂度阈值（多 UI 共享状态 / 多步云调用 ≥ 2 / 含回滚分支 任一） | `use-cases.yaml > branches[]`           |
| **B**  | 简单 feature                                                            | `acceptance.yaml > criteria[]` + `dag.yaml` |

**简单 feature 的退化路径**：

- 不产 `use-cases.yaml`
- 直接针对 data 层函数 / Repository / 导出工具函数写 UT
- 覆盖数据契约与边界异常即可
- harness 以 WARN 提示而非 BLOCKER

**严禁**为了凑"路径 A 看起来更完整"而强行把简单 feature 包装成复杂 feature。

### 4.2 UT 与 device 的硬分工（acceptance.yaml > ut_layer）

`acceptance.yaml` 每条 AC 带 `ut_layer ∈ {unit, device, both}`：

```yaml
criteria:
  - id: AC-1
    description: 用户点击开卡 → 成功跳转到结果页
    ut_layer: device       # 涉及导航 / 渲染 → 交 Skill 6
    linked_branch: ...
  - id: AC-2
    description: 校验失败时返回错误码 -1001 且 state=FAILED
    ut_layer: unit         # 纯业务流 / 无 UI → 进 UT
    linked_branch: ...
  - id: AC-3
    description: 短验失败回滚 → 既要 state=ROLLBACK，也要弹错误 toast
    ut_layer: both         # 业务流部分进 UT；toast 部分进 Skill 6
    linked_branch: ...
```

#### 4.2.1 UT 端 BLOCKER：ut_import_whitelist

UT 文件**绝对禁止** import 任何 UI 符号：

```
@Component / @Entry / @Builder / @Component struct
NavPathStack / NavDestination / NavPathInfo / Navigator / router
showToast / showDialog / promptAction / @ohos.promptAction
$r( / $rawfile(
AppStorage / LocalStorage / @StorageLink / @StorageProp
@kit.ArkUI / @kit.ArkGraphics
... 共 15+ 模式
```

这条规则的存在是为了**杜绝 UI mock 泥潭**：

> 试图在 UT 里验证 onClick → Navigation → Toast 这一连串 UI 副作用是反人性的。
> ArkTS 的 `@Component struct` 是编译期语法糖，hypium 下无法实例化。
> 妥协的写法（`FakeNavPathStack` / `FakePromptAction`）会随 SDK 升级全红，mock 代码比业务代码还长。

UI 相关验收 → 强制走 Skill 6 真机自动化（`device-testing-todo.md`）。

#### 4.2.2 Device 端 MAJOR：device_ac_delegation

`ut_layer ∈ {device, both}` 的 AC/BD 必须在 `device-testing-todo.md` 或 Skill 6 计划中登记，否则 MAJOR 警告。

### 4.3 端到端驱动的形式

**正例**（v2.1）：

```typescript
it('[BRANCH-happy_path][AC-1] 成功开卡端到端', async () => {
  const flow = new CardOpenFlow();   // 命名入口
  const spyClient = new SpyCardClient(); // 子类化既有 data 层类
  flow.cardClient = spyClient;
  spyClient.onSubmit = (...) => { ... };

  // ① 用户动作序列
  await flow.chooseCard('VIP');
  await flow.confirmSms('123456');
  await flow.submit();

  // ② state 断言（≥ 2 次）
  expect(flow.phaseTrace).toEqual(['CHOOSING', 'VERIFYING', 'SUBMITTING', 'DONE']);
  expect(flow.state.cardStatus).toBe('ACTIVATED');

  // ③ data_boundary 调用断言（≥ 2 次）
  expect(spyClient.fetchParamsCalls.length).toBe(1);
  expect(spyClient.submitCalls[0].args.cardType).toBe('VIP');
});
```

**反例**（典型"声明覆盖"）：

```typescript
// ❌ 没有命名入口、没有用户动作序列、没有 state 断言
it('卡数据应非空', async () => {
  const repo = new CardRepository();
  const list = await repo.getList();
  expect(list.length).toBeGreaterThan(0);
});
```

后者**触发**：`it_drives_flow` MAJOR + `end_to_end_driving` BLOCKER。

### 4.4 it() 标签 1:1 映射

每个 `it()` 必须有标签 `[BRANCH-<branch_id>][AC-<ac_id>]`：

```typescript
it('[BRANCH-sms_fail_rollback][AC-3] 短验失败回滚', ...);
```

harness 据此校验：

- 每条 `use-cases.yaml > branches[]` 都有对应的 it()（`branch_coverage_full` BLOCKER）
- 每条 `acceptance.yaml > unit/both criteria[]` 都有对应的 it()（`acceptance_coverage` BLOCKER）

---

## 五、v2.2 的"假 PASS"三道护栏

v2.1 之前 harness 只做静态结构扫描，缺少"真编译 / 真运行"出口，给了弱模型大量"看起来 PASS 实际编译不过"的可乘之机。

v2.2 引入四道 BLOCKER（v2.3 中部分扩展）：

| 规则                  | 严重度  | 触发逻辑                                                                                                                |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ut_tsc_compiles`     | BLOCKER | 用 TypeScript Compiler API（`ts.createProgram`）对 `*.test.ets` 做 `noEmit` 扫描；零 Error 才通过                       |
| `ut_hvigor_build`     | BLOCKER | 对 `<module>@ohosTest` 跑 `assembleHap`；兜底 tsc 漏过的跨文件类型违约                                                  |
| `ut_hvigor_test`      | BLOCKER | `genOnDeviceTestHap` + `hdc install` + `hdc shell aa test`；解析 hypium `OHOS_REPORT_RESULT`；failed > 0 或 total = 0 都 FAIL |
| `ut_no_src_mutation`  | BLOCKER | git diff 检测业务源码改动；未在 `gap-notes.md > approved_src_mutations[]` 登记的一律 FAIL                              |

### 5.1 工具链缺失也是 FAIL（不是 SKIP）

v2.2 之前的设计：工具链找不到 → SKIP 该规则。结果出现"装机环境不完整 → 全部 SKIP → harness 全绿"的事故。

v2.2 起：工具链缺失（hvigor 不在 PATH / DevEco 路径未配置 / 无设备）→ 直接 FAIL 并附明确修复指引：

```
ut_hvigor_test FAIL:
  失败阶段: device_probe
  原因: hdc list targets 输出空（未连接设备 / 未授权）
  修复指引:
    1. 启动 DevEco Studio Device Emulator 或连接真机
    2. 在 Settings 信任 hdc 调试
    3. hdc list targets 应至少返回一个 Connected 设备
  绕过方式: HARNESS_SKIP_HVIGOR_TEST=1 也是 FAIL（由 v2.2 起一律不允许 SKIP 兜底）
```

### 5.2 改业务源码的 HARD STOP

弱模型常见的"投机"行为：UT 写不出来 → 改业务源码加个工具函数 → UT 过了。

framework 用 `ut_no_src_mutation` BLOCKER 拦住：

- `harness-runner.ts` 进入 phase 时把 `git rev-parse HEAD` 写入 `reports/<feature>/<phase>/trace.json > start_commit`
- `ut_no_src_mutation` 用这个 commit 作为 git diff baseRef
- 任何业务源码（`02-Feature/**/src/main/**` 等）的改动都必须先在 `gap-notes.md > approved_src_mutations[]` 登记
- 未登记 → FAIL

Skill 5 SKILL.md 同步把"约束 #12 不修改业务源码"升级为 **HARD STOP**（必须先问后改 + gap-notes 登记），AI Harness `verify-ut.md` 顶部也加了等价条款，verifier 检测到疑似"为 UT 便利新增的工具函数"时强制标 BLOCKER。

### 5.3 放宽 named_business_handler

v2.1 的正则只识别 `function xxx` / 类方法 `xxx()`，误杀了 ArkTS 合法的类字段函数：

```arkts
class CardPage {
  handleClick = async () => {        // v2.1 误判为匿名 lambda
    await this.flow.chooseCard();
  };
}
```

v2.2 新增 `reFieldFunc` 正则覆盖：

- `xxx = () => {}` / `xxx = async () => {}` / `xxx = function() {}`
- `xxx: () => void = async () => {}` / `xxx: MyType = () => {}`
- `const xxx = () => {}` / `let xxx: Func = () => {}`

仍然拦截**真正的匿名 inline lambda**（`.onClick(() => { ... })` 没有 `symbol =` 前缀，不匹配新正则）。

---

## 六、关键产物速览

### 6.1 `dag.yaml`（每个 feature 一份或多份）

```yaml
flow_id: card_opening_happy
flow_name: 开卡 - 主路径
use_case: card_opening              # 指向 use-cases.yaml > use_cases[].id
linked_acceptance: [AC-1]
linked_branch: happy_path

nodes:
  - id: n1
    type: user_action
    description: 用户选卡
    calls: flow.chooseCard
    next: [n2]
  - id: n2
    type: data_boundary
    description: 拉取开卡参数
    target: cardClient.fetchParams
    next: [n3]
  - id: n3
    type: state
    description: state 进入 VERIFYING
    expect_phase: VERIFYING
    next: [n4]
  ...
```

`dag.yaml` 的角色是**让 UT 与业务流之间的对应关系可视化 + 可校验**，不是 AI 生成 UT 的唯一输入。

### 6.2 `it()` + 标签

```typescript
describe('CardOpenFlow', () => {
  it('[BRANCH-happy_path][AC-1] 成功开卡端到端', async () => { ... });
  it('[BRANCH-validate_fail][AC-2] 校验失败', async () => { ... });
  it('[BRANCH-sms_fail_rollback][AC-3] 短验失败回滚', async () => { ... });
  it('[BRANCH-persist_fail][AC-4] 持久化失败', async () => { ... });
});
```

### 6.3 `device-testing-todo.md`

由 Skill 5 产出，移交 Skill 6 真机阶段的工作清单：

```markdown
# device-testing-todo.md (feature: card-opening)

来源：acceptance.yaml > criteria[].ut_layer ∈ {device, both}

| AC id | 描述 | UT 已覆盖部分 | 真机要补的部分 |
|-------|------|---------------|----------------|
| AC-1  | 成功跳转到结果页 | ✗（device-only） | 完整流程 |
| AC-3  | 短验失败回滚 toast 提示 | flow rollback 已 UT | toast 文案 / 弹出时机 |
| AC-5  | 多机型字号渲染   | ✗（device-only） | 9 种机型 |
```

---

## 七、常见坑速查

| 症状                                                 | 根因                                                                | 解决                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| UT 跑过了，线上业务流仍然炸                          | 写成了"接口级 UT"，没有命名入口 + 用户动作序列                      | 改成端到端驱动；遵守 `it_drives_flow` 双断言                                  |
| UT 全绿，但 git status 显示动了一堆业务源码          | 为了让 UT 通过，偷偷给 src 加了 helper                              | `gap-notes > approved_src_mutations` 登记 + 用户确认；否则 `ut_no_src_mutation` FAIL |
| `ut_tsc_compiles` 报一堆"找不到 hypium / Component"   | tsconfig 没引入 ohosTest 类型 / `@ohos/hypium` 路径没解析            | 检查 `framework/harness/scripts/utils/ts-compile.ts` 的 ambient 注入逻辑      |
| 在 CI 上 `ut_hvigor_test` SKIP                       | v2.2 起任何"无设备 / 工具链缺失" 不再 SKIP，会直接 FAIL              | CI 接入 device emulator；或显式声明 feature 暂不进 UT 阶段                    |
| `branch_coverage_full` FAIL，提示 it() 数量不匹配     | use-cases.yaml > branches[] 加新分支后忘了写对应 it()，或 it() 标签拼错 | 每加一个 branch 必加一个 it() + 标签格式 `[BRANCH-<id>][AC-<id>]`             |
| 想 mock UI（让 onClick → Toast 进 UT）               | 还没意识到"UI 在 UT 里不可测"是硬规则                              | 对应 AC 改 `ut_layer = device`；进 device-testing-todo.md                     |
| 简单 feature 里 use-cases.yaml 看着空荡荡           | 没有 use-cases.yaml 也是合法路径（路径 B）                          | 删了 use-cases.yaml，按 acceptance.yaml + dag.yaml 直接写；harness WARN 不 BLOCKER |
| Skill 3 出的代码可测性差，UT 写不出来                 | 业务流嵌在 inline lambda 里                                         | 反馈 Skill 3 抽出命名方法；**不要**反过来在 UT 里 new `@Component struct`     |
| AI Harness 报 `end_to_end_driving` BLOCKER          | UT 绕过命名入口直接调底层 repo                                      | 改回从命名入口（Page 方法 / Flow 类 / 导出函数）开始驱动                      |

---

## 八、与上下游 Skill 的契约

### 8.1 上游来源

| 来源                | 字段                                                              | 用途                                |
| ------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| Skill 1 / acceptance.yaml | `criteria[].ut_layer / linked_branch`                       | 决定哪些 AC 进 UT                   |
| Skill 2 / use-cases.yaml  | `use_cases[].coordinator / ui_bindings / data_boundaries / branches` | UT 端到端规划主线（路径 A）         |
| Skill 2 / contracts.yaml  | `interfaces[].class`                                        | `data_boundaries[].type` 必须来自这里 |
| Skill 3 / 业务编排源代码    | 命名入口（Page 方法 / Flow 类 / 导出函数）                         | UT 直接调用                         |
| Skill 3 / data 层源代码     | Repository / Client 类                                          | UT 子类化打桩                       |

### 8.2 下游交付

| 去向     | 产物                            | 用途                                                          |
| -------- | ------------------------------- | ------------------------------------------------------------- |
| Skill 6  | `device-testing-todo.md`        | UT 不能覆盖的 device AC 委派清单                              |
| 归档     | `dag.yaml` 多份                 | 与 use-cases.yaml/acceptance.yaml 一一对应                    |
| 归档     | `*.test.ets`                    | hypium 业务级 UT 文件，已通过 `ut_tsc_compiles + ut_hvigor_*` |

### 8.3 与 Skill 0 的隐式契约

UT 阶段如果发现**新的业务术语**（比如 `acceptance.yaml` 里冒出来的"开卡审核"在 catalog/glossary 里查不到），**严禁**自己脑补 ↔ 模块映射。

正确做法：

- 在 `gap-notes.md` 登记缺失术语
- 提示用户回到 `/glossary-bootstrap` 补全
- UT 暂停，不要套着模糊术语写 UT

这是 framework 跨 Skill 一致性的体现：**所有阶段都依赖同一份 catalog + glossary SSOT，任何 Skill 不得就地创造术语**。

---

## 一句话总结

> **业务级 UT 的本质，是让"用户点 → 业务流 → state 变迁 → 数据落库"这条剧本在每次 commit 都被显式重放一次。
> Framework 的工作不是替 AI 写出这条剧本，是用一组硬规则（端到端驱动 / 1:1 标签 / 真编译 / 真机执行 / 改源码门禁）把
> AI 必然会犯的偷懒错误顶住，让"通过 harness"和"真的覆盖业务行为"等价。**
