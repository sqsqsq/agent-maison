# UT 代码模板（v2.1 · UseCase 规约驱动，消费既有代码）

> **v2.1 模板说明**：UT 以 **`use-cases.yaml` 规约 + 既有业务编排代码**为被测单元。
> 业务编排代码形态由 Skill 3 自选三种合法形态（Page 命名方法 / 独立 Flow/Coordinator 类 / 导出命名函数），UT 按 `ui_bindings[].user_actions[].calls` 声明的**命名函数**直接调用。
> 一条 `it()` 完整驱动一个 branch：命名入口 → `data_boundaries` → state 迁移 → 最终结果。
> UT 中 **绝对禁止** 出现任何 UI / 导航 / Toast / AppStorage / 资源访问依赖（由 `ut_import_whitelist` BLOCKER 强制，UI 侧交 Skill 6 真机测试）。
>
> 参考样例：`framework/skills/5-business-ut/examples/card-opening/`

## 概述

本文件定义业务级 UT 代码的标准结构和编写规范。生成的 UT 基于 `@ohos/hypium` 测试框架。

核心转变（v1 → v2.1）：

| 维度 | v1 老做法 | v2.1 新做法 |
|------|-----------|-----------|
| 被测单元 | Repository / 单接口 | 业务编排的**命名入口**（Page 方法 / Flow 类方法 / 导出函数，由 Skill 3 自选） |
| 外部依赖抽象 | Mock Repository（笼统） | `data_boundaries[]` — 引用 `contracts.yaml` 已登记的既有数据层类 |
| 打桩形式 | `MockXxxRepository` | `SpyXxx` 子类化既有类 **或** 原型方法替换（禁止新造 `XxxPort` 接口） |
| 用例粒度 | 每个 `it()` 验一条数据接口 | 每个 `it()` 端到端驱动一个 branch（或一条 AC / BD） |
| 断言粒度 | 仅数据 | state 序列 + data_boundary 调用序列 + 数据 |
| UI 交互 | 部分在 UT 里走 | ✗ 一律交 Skill 6 真机 |

## 标准 UT 文件结构（v2.1 · 路径 A：有 use-cases.yaml）

```typescript
// ============================================================================
// UseCase (规约): {useCaseId}
// use-cases.yaml: doc/features/{feature}/use-cases.yaml > use_cases[{useCaseId}]
// Coordinator:    {coordinator 符号名（类 / Page.method / 导出函数）}
// DAG 文件:        {module}/test/dag/{flow_id}.dag.yaml
// 覆盖的 branches: {branch_ids}
// 关联 AC:         {linked_acceptance}
// ============================================================================

import { describe, it, expect, beforeEach } from '@ohos/hypium'
// 业务编排（形态 B 独立业务类示例；形态 A/C 对应改为 import Page 或 export function）
import { CardOpenFlow, CardOpenPhase } from '../../../main/ets/domain/flow/CardOpenFlow'
// data/model：允许直接 import（值对象、枚举）
import { CardInfo } from '../../../main/ets/data/model/CardInfo'
// Spy：子类化 contracts.yaml 登记的既有数据层类，不新造 Port 接口
import { SpyCardOpenApi } from './spy/SpyCardOpenApi'
import { SpyCardStore } from './spy/SpyCardStore'

export default function cardOpeningUseCaseTest() {
  describe('CardOpenFlow (use_case: card_opening)', () => {

    // ---- Spy 与被测业务编排类 ----
    let api: SpyCardOpenApi
    let store: SpyCardStore
    let flow: CardOpenFlow

    // ---- 测试数据（固定、可复用的值对象；不可放有状态的 Mock）----
    const bankInfo = { bankCode: 'BOC', cardBin: '621700' }

    // ---- Setup ----
    // 强约束：每条 it() 独立 → 每次都重建 Spy 与被测对象
    beforeEach((): void => {
      api = new SpyCardOpenApi()
      store = new SpyCardStore()
      flow = new CardOpenFlow(api, store)   // 注入既有数据层类的 Spy 子类实例
    })

    // =============================================================
    // [BRANCH-happy_path][AC-1] 开卡全链路成功
    // =============================================================
    it('[BRANCH-happy_path][AC-1] 开卡全链路成功', 0, async () => {
      // Arrange — 预设所有 data_boundary 返回值（对应 branches[happy_path].cloud_stubs）
      api.whenValidateOpen.returns({ ok: true, token: 't' })
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' })
      api.whenVerifySmsCode.returns({ ok: true })

      // Act 1 — 命名入口直调（对应 ui_bindings.user_actions.calls = "flow.chooseCard"）
      await flow.chooseCard(bankInfo)

      // Assert 1 — 中间态：等待短验
      expect(flow.state.phase).assertEqual(CardOpenPhase.WaitingSms)
      expect(store.saved[0].cardId).assertEqual('c1')

      // Act 2 — 第二个命名入口（对应 "flow.confirmSms"）
      await flow.confirmSms('123456')

      // Assert 2 — 最终态：成功
      expect(flow.state.phase).assertEqual(CardOpenPhase.Success)
      expect(flow.state.errorCode).assertNull()

      // Assert 3 — data_boundary 调用序列（端到端最强断言）
      expect(api.callLog).assertDeepEquals(
        ['validateOpen', 'applyCardResource', 'verifySmsCode']
      )
      expect(store.callLog).assertDeepEquals(['save', 'update'])
    })

    // =============================================================
    // [BRANCH-validate_fail][AC-2] 开卡校验失败，不触发持久化
    // =============================================================
    it('[BRANCH-validate_fail][AC-2] 云侧开卡校验失败，不触发持久化', 0, async () => {
      api.whenValidateOpen.fails({ code: 'VAL_ERR' })

      await flow.chooseCard(bankInfo)

      expect(flow.state.phase).assertEqual(CardOpenPhase.Failed)
      expect(flow.state.errorCode).assertEqual('VAL_ERR')
      expect(api.callLog).assertDeepEquals(['validateOpen'])
      expect(store.callLog.length).assertEqual(0)     // 持久化未被触发
    })

    // =============================================================
    // [BRANCH-sms_fail_rollback][AC-3] 短验失败，本地卡记录被回滚
    // =============================================================
    it('[BRANCH-sms_fail_rollback][AC-3] 短验失败，本地已写入卡记录被回滚', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' })
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' })
      api.whenVerifySmsCode.fails({ code: 'SMS_ERR' })

      await flow.chooseCard(bankInfo)
      expect(flow.state.phase).assertEqual(CardOpenPhase.WaitingSms)  // 中间态

      await flow.confirmSms('999999')

      expect(flow.state.phase).assertEqual(CardOpenPhase.Failed)
      expect(flow.state.errorCode).assertEqual('SMS_ERR')
      expect(store.callLog).assertDeepEquals(['save', 'rollback'])
      expect(store.currentCards.length).assertEqual(0)  // 残留数据清零
    })

    // =============================================================
    // [BRANCH-persist_fail][AC-4] 持久化失败，不进入短验
    // =============================================================
    it('[BRANCH-persist_fail][AC-4] 本地持久化写入失败，流程终止于 Persisting', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' })
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' })
      store.whenSave.throws(new Error('PERSIST_ERR'))

      await flow.chooseCard(bankInfo)

      expect(flow.state.phase).assertEqual(CardOpenPhase.Failed)
      expect(flow.state.errorCode).assertEqual('PERSIST_ERR')
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource'])
      expect(store.callLog).assertDeepEquals(['save'])
      expect(api.callLog.includes('verifySmsCode')).assertFalse()
    })
  })
}
```

## 路径 B：无 use-cases.yaml 的简单 feature

简单 feature（不满足 use-cases.yaml 复杂度阈值）按 `acceptance.yaml` + `dag.yaml` 针对 data 层导出方法直接写 UT，不要硬凑业务编排架构。示例参考：

```typescript
// 02-Feature/WalletMain/src/ohosTest/ets/test/home_page_ut.test.ets
import { describe, it, expect } from '@ohos/hypium'
import { HomeRepository } from '../../../main/ets/data/repository/HomeRepository'

export default function homePageUt() {
  describe('home-page AC-1: HomeRepository 返回非空数据', () => {
    it('[AC-1] HomeRepository 返回非空数据，模型字段齐全', 0, async () => {
      const repo = new HomeRepository()
      const entries = await repo.getServiceEntries()
      const promos = await repo.getPromoList()
      expect(entries.length > 0).assertTrue()
      expect(promos.length > 0).assertTrue()
      entries.forEach(e => expect(e.id).assertInstanceOf('String'))
      promos.forEach(p => expect(p.id).assertInstanceOf('String'))
    })
  })
}
```

## Spy 模板（v2.1 · 子类化既有类）

v2.1 不再要求"实现 Port 接口"的 Spy，而是**直接继承 `contracts.yaml > interfaces[].class` 登记的现有数据层类**并 `override` 需要打桩的方法。两个关键点：

1. **预设返回值 / 预设异常**（用 `whenXxx.returns / fails / throws`）
2. **调用日志**（`callLog: string[]` 按调用顺序记录方法名）

放在 UT 同目录的 `spy/` 子目录下：

```typescript
// test/spy/SpyCardOpenApi.ets
import {
  CardOpenApi,            // ← 既有数据层类，非 Port 接口
  ValidateResult, CardResource, VerifyResult
} from '../../../main/ets/data/api/CardOpenApi'

type Setter<T> = {
  returns: (value: T) => void
  fails:   (errorLike: object) => void
  throws:  (err: Error) => void
}

function createSetter<T>(onPreset: (mode: 'ok' | 'fail' | 'throw', payload: unknown) => void): Setter<T> {
  return {
    returns: (v: T) => onPreset('ok', v),
    fails:   (e: object) => onPreset('fail', e),
    throws:  (e: Error) => onPreset('throw', e),
  }
}

// v2.1 关键：extends 既有数据层类（不 implements 新建的 Port 接口）
export class SpyCardOpenApi extends CardOpenApi {
  callLog: string[] = []

  private _validateOpen:      { mode: string; payload: unknown } | null = null
  private _applyCardResource: { mode: string; payload: unknown } | null = null
  private _verifySmsCode:     { mode: string; payload: unknown } | null = null

  whenValidateOpen      = createSetter<ValidateResult>((m, p) => (this._validateOpen      = { mode: m, payload: p }))
  whenApplyCardResource = createSetter<CardResource>  ((m, p) => (this._applyCardResource = { mode: m, payload: p }))
  whenVerifySmsCode     = createSetter<VerifyResult>  ((m, p) => (this._verifySmsCode     = { mode: m, payload: p }))

  override async validateOpen(info: unknown): Promise<ValidateResult> {
    this.callLog.push('validateOpen')
    return this._consume(this._validateOpen) as ValidateResult
  }
  override async applyCardResource(token: unknown): Promise<CardResource> {
    this.callLog.push('applyCardResource')
    return this._consume(this._applyCardResource) as CardResource
  }
  override async verifySmsCode(token: string, code: string): Promise<VerifyResult> {
    this.callLog.push('verifySmsCode')
    return this._consume(this._verifySmsCode) as VerifyResult
  }

  private _consume(preset: { mode: string; payload: unknown } | null): unknown {
    if (!preset) throw new Error('SpyCardOpenApi: no preset for this method')
    if (preset.mode === 'throw') throw preset.payload as Error
    if (preset.mode === 'fail')  return { ok: false, ...(preset.payload as object) }
    return preset.payload
  }
}
```

> Spy 实现遵循 **"只记录 + 按预设回放"** 两件事，不带任何业务判断——业务判断必须在业务编排代码里。

### 备选方案：原型方法替换（不希望子类化时）

```typescript
import { CardStore } from '../../../main/ets/data/store/CardStore'

let originalSave: typeof CardStore.prototype.save

beforeEach(() => {
  originalSave = CardStore.prototype.save
  CardStore.prototype.save = async function(info) {
    // stub 逻辑
    return { ok: true }
  }
})

afterEach(() => {
  CardStore.prototype.save = originalSave   // 必须还原，避免跨用例污染
})
```

> **约束**：采用原型替换方案时，`afterEach` / `afterAll` 必须恢复原型。由 `test_isolation` 语义检查兜底。

## 关键规范

### 1. 文件命名与路径

| 项目 | 规范 |
|------|------|
| 文件名 | `{useCaseId}.test.ets`（与 `use-cases.yaml > use_cases[].id` 对应，如 `card_opening.test.ets`）；无 use-cases.yaml 时取 `{feature}_ut.test.ets` |
| 路径 | `{module}/src/ohosTest/ets/test/{fileName}.test.ets` |
| Spy 目录 | `{module}/src/ohosTest/ets/test/spy/Spy{ExistingClassName}.ets` |
| 导出函数名 | `{useCaseId}Test`（camelCase + Test 后缀） |
| describe 名 | 业务编排类名或 `"feature_name AC-X: 描述"` |

### 2. 用例命名规范（v2.1 强约束）

每个 `it()` 用例名称必须以下列形式起始：

```typescript
it('[BRANCH-happy_path][AC-1] 开卡全链路成功', ...)        // ✅ 推荐：branch + AC 双标签
it('[BRANCH-persist_fail] 本地持久化失败终止流程', ...)     // ✅ 仅 branch（无单独 AC）
it('[AC-3] 短验失败，本地卡记录被回滚', ...)                // ✅ 仅 AC（适合无 use-cases.yaml 的简单 feature）
it('首页加载后展示卡片列表', ...)                          // ❌ FAIL：无标签，无法追溯
```

### 3. AAA 模式 + 端到端驱动（v2.1 强约束）

每个测试用例必须**端到端**驱动业务编排：

```typescript
it('[BRANCH-xxx][AC-X] 用例描述', 0, async () => {
  // Arrange
  // - 对每个 data_boundary 替身预设 returns / fails / throws
  // - 准备固定的值对象

  // Act
  // - 调用 ui_bindings.user_actions.calls 声明的命名入口（直调方法/函数）
  // - 复杂 branch 可 2 个入口（chooseCard → confirmSms）

  // Assert （必须同时包含下列三类）
  // 1. state 序列（≥2 次 flow.state.* / 业务入口返回值断言，覆盖中间态与终态）
  // 2. data_boundary 调用序列（对 spy.callLog 做 assertDeepEquals）
  // 3. 数据完整性（如 spyStore.currentCards、saved[].cardId）
})
```

### 4. Spy 规范（v2.1）

Spy 必须：

- **继承** `contracts.yaml > interfaces[].class` 中的现有数据层类（或采用原型替换）
- 暴露 `callLog: string[]` 记录调用顺序（assertDeepEquals 断言的底座）
- 暴露 `whenXxx.{returns, fails, throws}` 三种预设模式
- 对"持久化类"可额外暴露受控内部状态（如 `saved[]` / `currentCards`）用于数据断言
- **不得包含业务分支判断**
- **禁止**为了打桩新造 `XxxPort` 接口

### 5. UT 禁止出现的 import（BLOCKER，由 `ut_import_whitelist` 拦截）

以下 import 在 UT 中一律**禁止**：

- `@Component` / `@Entry` / `@Preview` / `@Consume` / `@Provide` 等 ArkUI 装饰器
- `NavPathStack` / `NavDestination` / `router`
- `@kit.ArkUI` / `@kit.ArkGraphics`
- `showToast` / `PromptAction` / `promptAction` / `getUIContext`
- `$r(...)` / `$rawfile(...)`（资源访问）
- `AppStorage` / `LocalStorage`
- `@aspect/CommUI`

UT 的 import 白名单：
- `@ohos/hypium`
- 业务编排源代码（Page 命名方法 / Flow 类 / 导出函数）
- `data/model` / `data/repository` / `data/api` 声明的接口、类和值对象
- 同目录 `./spy/` 下的 Spy 实现

### 6. 测试注册（List.test.ets）

所有测试函数必须在 `List.test.ets` 中注册：

```typescript
import cardOpeningUseCaseTest from './card_opening.test'
import homePageUt from './home_page_ut.test'

export default function testsuite() {
  cardOpeningUseCaseTest()
  homePageUt()
}
```

### 7. hypium 断言 API 速查

| 断言方法 | 用途 | 示例 |
|---------|------|------|
| `expect(v).assertEqual(expected)` | 值相等 | `expect(flow.state.phase).assertEqual(CardOpenPhase.Success)` |
| `expect(v).assertDeepEquals(expected)` | 深度相等 | `expect(api.callLog).assertDeepEquals(['a','b'])` |
| `expect(v).assertTrue()` | 为真 | `expect(visible).assertTrue()` |
| `expect(v).assertFalse()` | 为假 | `expect(api.callLog.includes('x')).assertFalse()` |
| `expect(v).assertNull()` | 为 null | `expect(flow.state.errorCode).assertNull()` |
| `expect(v).assertLarger(n)` | 大于 | `expect(len).assertLarger(0)` |
| `expect(v).assertContain(sub)` | 包含 | `expect(str).assertContain('成功')` |

### 8. 异步测试模式

```typescript
// 强制：async/await（Hypium 对异步用例通过返回 Promise 驱动）
it('异步测试', 0, async () => {
  await flow.chooseCard(bankInfo)
  expect(flow.state.phase).assertEqual(CardOpenPhase.Verifying)
})
```

## 目录结构示例（v2.1）

```
02-Feature/CardOpen/
├── src/
│   ├── main/ets/
│   │   ├── data/
│   │   │   ├── api/CardOpenApi.ets              # 既有数据层类（云端调用）
│   │   │   ├── store/CardStore.ets              # 既有数据层类（本地持久化）
│   │   │   └── model/CardInfo.ets
│   │   ├── domain/
│   │   │   └── flow/CardOpenFlow.ets            # ★ 业务编排（形态 B：独立类；v2.1 不强制 domain/usecase/）
│   │   └── presentation/pages/CardOpenPage.ets  # 订阅 state，翻译 UI 副作用
│   └── ohosTest/
│       ├── ets/
│       │   └── test/
│       │       ├── List.test.ets                # 测试入口注册
│       │       ├── card_opening.test.ets        # ★ UseCase UT（本模板）
│       │       └── spy/
│       │           ├── SpyCardOpenApi.ets       # extends CardOpenApi
│       │           └── SpyCardStore.ets         # extends CardStore
│       └── module.json5
└── test/
    └── dag/
        ├── card_opening_happy.dag.yaml          # 1 UseCase 可拆多个 DAG
        ├── card_opening_validate_fail.dag.yaml
        ├── card_opening_sms_fail.dag.yaml
        └── card_opening_persist_fail.dag.yaml
```

## 与 Skill 6 的分工

| 你想测的是…                      | 写在哪 | 备注 |
|--------------------------------|--------|------|
| 业务编排的分支逻辑、state、data_boundary 调用序列 | **UT**（本模板）| Hypium 端到端驱动命名入口 |
| Toast 文案、NavPathStack 跳转、UI 卡死、按钮禁用 | `device-testing-todo.md` | 由 Skill 6 真机覆盖 |
| 真实键盘输入 / 下拉刷新 / 滚动     | `device-testing-todo.md` | 由 Skill 6 真机覆盖 |
| DAG `ui_subscription` 节点       | `device-testing-todo.md` | UT 忽略，仅文档用，真机验证 |

> 所有 `ut_layer in [device, both]` 的 AC 都必须在 `device-testing-todo.md` 中出现，
> 否则 `device_ac_delegation` 语义检查将告警。
