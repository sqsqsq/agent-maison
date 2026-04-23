# UT 代码模板（v2 · UseCase 端到端化）

> **v2 模板说明**：v2 的 UT 以 **UseCase 为被测单元**（来自 `doc/features/{feature}/use-cases.yaml`），
> 一条 `it()` 完整驱动一个 branch：用户事件 → 云端口 → 本地端口 → state 迁移 → 最终结果。
> UT 中 **禁止** 出现任何 UI / 导航 / Toast 依赖（这些由 Skill 6 真机测试覆盖）。
>
> 参考样例：`framework/skills/5-business-ut/examples/card-opening/`

## 概述

本文件定义业务级 UT 代码的标准结构和编写规范。生成的 UT 基于 `@ohos/hypium` 测试框架。

核心转变（v1 → v2）：

| 维度 | v1 老做法 | v2 新做法 |
|------|-----------|-----------|
| 被测单元 | Repository / 单接口 | `UseCase` 类（构造器注入 ports） |
| Mock 粒度 | MockRepository（笼统） | `SpyPort` 按云端/本地端口分别 Spy |
| 用例粒度 | 每个 `it()` 验一条数据接口 | 每个 `it()` 端到端驱动一个 branch |
| 断言粒度 | 仅数据 | state 序列 + port 调用序列 + 数据 |
| UI 交互 | 部分在 UT 里走 | ✗ 一律交 Skill 6 真机 |

## 标准 UT 文件结构（v2）

```typescript
// ============================================================================
// UseCase: {UseCaseName}
// use-cases.yaml: doc/features/{feature}/use-cases.yaml > use_cases[{useCaseId}]
// DAG 文件:       {module}/test/dag/{flow_id}.dag.yaml
// 覆盖的 branches: {branch_ids}
// 关联 AC:        {linked_acceptance}
// ============================================================================

import { describe, it, expect, beforeEach } from '@ohos/hypium'
// 被测 UseCase 与状态枚举（仅依赖 domain 层，不依赖 UI）
import { CardOpeningUseCase, Phase } from '../../../main/ets/domain/usecase/CardOpeningUseCase'
// data/model：允许直接 import（值对象、枚举）
import { CardInfo } from '../../../main/ets/data/model/CardInfo'
// SpyPort：按 ports[] 一一对应创建
import { SpyCardOpenApi } from './spy/SpyCardOpenApi'
import { SpyCardPersistence } from './spy/SpyCardPersistence'

export default function cardOpeningUseCaseTest() {
  describe('CardOpeningUseCase', () => {

    // ---- Spy 与被测 UseCase 声明 ----
    let api: SpyCardOpenApi
    let storage: SpyCardPersistence
    let useCase: CardOpeningUseCase

    // ---- 测试数据（固定、可复用的值对象；不可放有状态的 Mock）----
    const bankInfo = { bankCode: 'BOC', cardBin: '621700' }

    // ---- Setup ----
    // 强约束：每条 it() 独立 → 每次都重建 Spy 与 UseCase
    beforeEach((): void => {
      api = new SpyCardOpenApi()
      storage = new SpyCardPersistence()
      useCase = new CardOpeningUseCase(api, storage)   // 构造器注入 ports
    })

    // =============================================================
    // [BRANCH-happy_path][AC-1] 开卡全链路成功
    // =============================================================
    it('[BRANCH-happy_path][AC-1] 开卡全链路成功', 0, async () => {
      // Arrange — 预设所有 port 返回值（对应 use-cases.yaml > branches[happy_path].setup）
      api.whenValidateOpen.returns({ ok: true, token: 't' })
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' })
      api.whenVerifySmsCode.returns({ ok: true })

      // Act 1 — 启动开卡
      await useCase.startOpening(bankInfo)

      // Assert 1 — 中间态：等待短验
      expect(useCase.state.phase).assertEqual(Phase.WaitingSms)
      expect(storage.saved[0].cardId).assertEqual('c1')

      // Act 2 — 提交短验（用户触发）
      await useCase.submitSmsCode('123456')

      // Assert 2 — 最终态：成功
      expect(useCase.state.phase).assertEqual(Phase.Success)
      expect(useCase.state.errorCode).assertNull()

      // Assert 3 — port 调用序列（端到端最强断言）
      expect(api.callLog).assertDeepEquals(
        ['validateOpen', 'applyCardResource', 'verifySmsCode']
      )
      expect(storage.callLog).assertDeepEquals(['save', 'update'])
    })

    // =============================================================
    // [BRANCH-validate_fail][AC-2] 开卡校验失败，不触发持久化
    // =============================================================
    it('[BRANCH-validate_fail][AC-2] 云侧开卡校验失败，不触发持久化', 0, async () => {
      // Arrange — 仅 validate 失败，后续 port 不应被调用
      api.whenValidateOpen.fails({ code: 'VAL_ERR' })

      // Act
      await useCase.startOpening(bankInfo)

      // Assert — state 为 Failed 且错误码正确
      expect(useCase.state.phase).assertEqual(Phase.Failed)
      expect(useCase.state.errorCode).assertEqual('VAL_ERR')

      // Assert — port 调用序列只能到 validateOpen
      expect(api.callLog).assertDeepEquals(['validateOpen'])
      expect(storage.callLog.length).assertEqual(0)     // 持久化未被触发
    })

    // =============================================================
    // [BRANCH-sms_fail_rollback][AC-3] 短验失败，本地卡记录被回滚
    // =============================================================
    it('[BRANCH-sms_fail_rollback][AC-3] 短验失败，本地已写入卡记录被回滚', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' })
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' })
      api.whenVerifySmsCode.fails({ code: 'SMS_ERR' })

      await useCase.startOpening(bankInfo)
      expect(useCase.state.phase).assertEqual(Phase.WaitingSms)  // 中间态

      await useCase.submitSmsCode('999999')

      expect(useCase.state.phase).assertEqual(Phase.Failed)
      expect(useCase.state.errorCode).assertEqual('SMS_ERR')
      expect(storage.callLog).assertDeepEquals(['save', 'rollback'])
      expect(storage.currentCards.length).assertEqual(0)  // 残留数据清零
    })

    // =============================================================
    // [BRANCH-persist_fail][AC-4] 持久化失败，不进入短验
    // =============================================================
    it('[BRANCH-persist_fail][AC-4] 本地持久化写入失败，流程终止于 Persisting', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' })
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' })
      storage.whenSave.throws(new Error('PERSIST_ERR'))

      await useCase.startOpening(bankInfo)

      expect(useCase.state.phase).assertEqual(Phase.Failed)
      expect(useCase.state.errorCode).assertEqual('PERSIST_ERR')
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource'])
      expect(storage.callLog).assertDeepEquals(['save'])
      // verifySmsCode 不应被触发
      expect(api.callLog.includes('verifySmsCode')).assertFalse()
    })
  })
}
```

## SpyPort 模板

SpyPort 对应 `use-cases.yaml > ports[]` 声明的每个端口，必须提供两件事：

1. **预设返回值 / 预设异常**（用 `whenXxx.returns / fails / throws`）
2. **调用日志**（`callLog: string[]` 按调用顺序记录方法名）

放在 UT 同目录的 `spy/` 子目录下：

```typescript
// test/spy/SpyCardOpenApi.ets
import { CardOpenApi, ValidateResult, CardResource, VerifyResult } from
  '../../../main/ets/data/api/CardOpenApi'

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

export class SpyCardOpenApi implements CardOpenApi {
  callLog: string[] = []

  // 每个方法一份 preset
  private _validateOpen:      { mode: string; payload: unknown } | null = null
  private _applyCardResource: { mode: string; payload: unknown } | null = null
  private _verifySmsCode:     { mode: string; payload: unknown } | null = null

  whenValidateOpen      = createSetter<ValidateResult>((m, p) => (this._validateOpen      = { mode: m, payload: p }))
  whenApplyCardResource = createSetter<CardResource>  ((m, p) => (this._applyCardResource = { mode: m, payload: p }))
  whenVerifySmsCode     = createSetter<VerifyResult>  ((m, p) => (this._verifySmsCode     = { mode: m, payload: p }))

  async validateOpen(info: unknown): Promise<ValidateResult> {
    this.callLog.push('validateOpen')
    return this._consume(this._validateOpen) as ValidateResult
  }
  async applyCardResource(token: unknown): Promise<CardResource> {
    this.callLog.push('applyCardResource')
    return this._consume(this._applyCardResource) as CardResource
  }
  async verifySmsCode(token: string, code: string): Promise<VerifyResult> {
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

> Spy 实现遵循 **"只记录 + 按预设回放"** 两件事，不带任何业务判断——业务判断必须在 UseCase 里。

## 关键规范

### 1. 文件命名与路径

| 项目 | 规范 |
|------|------|
| 文件名 | `{useCaseId}.test.ets`（与 use-cases.yaml 的 `id` 对应，如 `card_opening.test.ets`） |
| 路径 | `{module}/src/ohosTest/ets/test/{useCaseId}.test.ets` |
| Spy 目录 | `{module}/src/ohosTest/ets/test/spy/Spy{PortType}.ets` |
| 导出函数名 | `{useCaseId}Test`（camelCase + Test 后缀） |
| describe 名 | UseCase 类名（如 `'CardOpeningUseCase'`） |

### 2. 用例命名规范（v2 强约束）

每个 `it()` 用例名称必须以下列形式起始：

```typescript
it('[BRANCH-happy_path][AC-1] 开卡全链路成功', ...)        // ✅ 推荐：branch + AC 双标签
it('[BRANCH-persist_fail] 本地持久化失败终止流程', ...)     // ✅ 仅 branch（无单独 AC）
it('[AC-3] 短验失败，本地卡记录被回滚', ...)                // ✅ 仅 AC（不推荐，缺 branch 追溯）
it('首页加载后展示卡片列表', ...)                          // ❌ FAIL：无标签，无法追溯
```

### 3. AAA 模式 + 端到端驱动（v2 强约束）

每个测试用例必须**端到端**驱动 UseCase：

```typescript
it('[BRANCH-xxx][AC-X] 用例描述', 0, async () => {
  // Arrange
  // - 对每个 port 预设 returns / fails / throws
  // - 准备固定的值对象

  // Act
  // - 调用 useCase 的 trigger 方法（对应 use-cases.yaml > triggers）
  // - ≥ 1 个 trigger；复杂 branch 可 2 个（startOpening → submitSmsCode）

  // Assert （必须同时包含下列三类）
  // 1. state 序列（≥2 次 useCase.state.* 断言，覆盖中间态与终态）
  // 2. port 调用序列（对 spyXxx.callLog 做 assertDeepEquals）
  // 3. 数据完整性（如 spyStorage.currentCards、saved[].cardId）
})
```

### 4. SpyPort 规范

SpyPort 必须：

- **实现被测 port 的接口**（与 `use-cases.yaml > ports[].type` 指向的 interface 一致）
- 暴露 `callLog: string[]` 记录调用顺序（assertDeepEquals 断言的底座）
- 暴露 `whenXxx.{returns, fails, throws}` 三种预设模式
- 对"本地 port"可额外暴露受控内部状态（如 `saved[]` / `currentCards`）用于数据断言
- **不得包含业务分支判断**

### 5. 不得出现在 UT 的符号（BLOCKER）

以下 import 在 UT 中一律 **禁止**，违反将被 `no_ui_dep_in_ut` BLOCKER 拦截：

- `@Component` / `@Entry` / `@Preview` / `@Consume` / `@Provide`
- `NavPathStack` / `NavDestination`
- `@kit.ArkUI`
- `showToast` / `PromptAction` / `getUIContext`
- `$r(...)`（资源访问）
- `@aspect/CommUI`

UT 的 import 白名单：
- `@ohos/hypium`
- 被测 UseCase 及其 domain 层依赖
- `data/model` / `data/api` 声明的接口和值对象
- 同目录 `./spy/` 下的 Spy 实现

### 6. 测试注册（List.test.ets）

所有测试函数必须在 `List.test.ets` 中注册：

```typescript
import cardOpeningUseCaseTest from './card_opening.test'
import homeLoadingUseCaseTest from './home_loading.test'

export default function testsuite() {
  cardOpeningUseCaseTest()
  homeLoadingUseCaseTest()
}
```

### 7. hypium 断言 API 速查

| 断言方法 | 用途 | 示例 |
|---------|------|------|
| `expect(v).assertEqual(expected)` | 值相等 | `expect(useCase.state.phase).assertEqual(Phase.Success)` |
| `expect(v).assertDeepEquals(expected)` | 深度相等 | `expect(api.callLog).assertDeepEquals(['a','b'])` |
| `expect(v).assertTrue()` | 为真 | `expect(visible).assertTrue()` |
| `expect(v).assertFalse()` | 为假 | `expect(api.callLog.includes('x')).assertFalse()` |
| `expect(v).assertNull()` | 为 null | `expect(useCase.state.errorCode).assertNull()` |
| `expect(v).assertLarger(n)` | 大于 | `expect(len).assertLarger(0)` |
| `expect(v).assertContain(sub)` | 包含 | `expect(str).assertContain('成功')` |

### 8. 异步测试模式

```typescript
// 强制：async/await（Hypium 对异步用例通过返回 Promise 驱动）
it('异步测试', 0, async () => {
  await useCase.startOpening(bankInfo)
  expect(useCase.state.phase).assertEqual(Phase.Validating)
})
```

## 目录结构示例（v2）

```
02-Feature/CardOpen/
├── src/
│   ├── main/ets/
│   │   ├── data/
│   │   │   ├── api/CardOpenApi.ets              # cloud port 接口
│   │   │   └── model/CardInfo.ets
│   │   ├── domain/
│   │   │   ├── port/CardPersistence.ets         # local port 接口
│   │   │   └── usecase/CardOpeningUseCase.ets   # ★ 被测 UseCase（纯逻辑）
│   │   └── presentation/pages/CardOpenPage.ets  # 订阅 state，翻译 UI 副作用
│   └── ohosTest/
│       ├── ets/
│       │   └── test/
│       │       ├── List.test.ets                # 测试入口注册
│       │       ├── card_opening.test.ets        # ★ UseCase UT（本模板）
│       │       └── spy/
│       │           ├── SpyCardOpenApi.ets       # 云端口 Spy
│       │           └── SpyCardPersistence.ets   # 本地端口 Spy
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
| UseCase 的分支逻辑、state、端口调用序列 | **UT**（本模板）| Hypium 端到端驱动 |
| Toast 文案、NavPathStack 跳转、UI 卡死、按钮禁用 | `device-testing-todo.md` | 由 Skill 6 真机覆盖 |
| 真实键盘输入 / 下拉刷新 / 滚动     | `device-testing-todo.md` | 由 Skill 6 真机覆盖 |

> 所有 `ut_layer in [device, both]` 的 AC 都必须在 `device-testing-todo.md` 中出现，
> 否则 `device_ac_delegation` 语义检查将告警。
