# 打桩（Mock/Stub）策略指南

> **模板说明**：下方代码片段使用中性模型名（如 `ItemSummary` / `ItemRepository`）演示 Mock 形态；实际类型以你方 `contracts.yaml` 为准。
>
> **v2.3 真源**：若 feature 已产出 `doc/features/<feature>/ut/mock-plan.yaml`，则 **Spy / Fake / Stub 的方法签名、spy_fields、presets（含 `ts_expr`）必须以 mock-plan 为唯一真源**，在代码中 **1:1 翻译**，禁止在实现阶段「顺手加字段 / 改返回值形状」导致与 plan、DAG `spy_preset` 引用不一致。打桩策略的**教科书**仍为本文，**机器校验**以 `check-ut.ts` + `mock-plan-schema.md` 为准。

## 概述

业务级 UT 的核心挑战是**隔离外部依赖**——网络请求、系统 API、用户交互、后台任务等都不应在 UT 中真实执行。本文件定义每种 DAG 节点类型对应的打桩策略和实现模式。

## 打桩策略总览

| DAG 节点类型 | 依赖类型 | 打桩方式 | 隔离层级 |
|-------------|---------|---------|---------|
| `async_call` — Repository | 数据层 | 创建 Mock 类替换 Repository | 接口级 |
| `async_call` — 系统 API | 系统能力 | 替换模块方法 | 方法级 |
| `async_call` — HTTP 请求 | 网络 | Mock HTTP Client | 客户端级 |
| `user_intervention` | UI 交互 | 直接调用事件处理函数 | 事件级 |
| `background_task` | 后台服务 | 直接调用回调函数 | 回调级 |
| `ui_navigation` | 路由系统 | Mock Router 对象 | 路由级 |

## 策略一：Repository Mock（最常用）

适用于 `async_call` 节点且 `source.class` 是 Repository 类的场景。

### 模式

创建一个 Mock 类，实现与 contracts.yaml 中定义的 Repository 相同的方法签名，但用可控的测试数据替代真实实现。

### 实现模板

```typescript
import { ItemSummary } from '../../../main/ets/data/model/ItemSummary'

export class MockItemRepository {
  private _items: ItemSummary[] = []
  private _error: Error | null = null
  private _delay: number = 0
  private _callCount: Map<string, number> = new Map()

  setItemList(items: ItemSummary[]): void {
    this._items = items
  }

  simulateError(error: Error): void {
    this._error = error
  }

  simulateDelay(ms: number): void {
    this._delay = ms
  }

  async listItems(): Promise<ItemSummary[]> {
    this.recordCall('listItems')
    if (this._error) throw this._error
    if (this._delay > 0) {
      await new Promise(resolve => setTimeout(resolve, this._delay))
    }
    return [...this._items]
  }

  async findById(id: string): Promise<ItemSummary | undefined> {
    this.recordCall('findById')
    if (this._error) throw this._error
    return this._items.find(c => c.itemId === id)
  }

  getCallCount(method: string): number {
    return this._callCount.get(method) ?? 0
  }

  private recordCall(method: string): void {
    this._callCount.set(method, (this._callCount.get(method) ?? 0) + 1)
  }

  reset(): void {
    this._items = []
    this._error = null
    this._delay = 0
    this._callCount.clear()
  }
}
```

### 关键要求

1. **签名一致**：Mock 方法的参数和返回类型必须与 contracts.yaml 中的定义一致
2. **返回副本**：`listItems` 返回 `[...this._items]` 而非引用，避免用例间数据污染
3. **调用记录**：提供 `getCallCount` 方法，允许断言"函数是否被调用"
4. **可重置**：`reset()` 清除所有状态，在 `afterEach` 中调用

## 策略二：系统 API Mock

适用于 `async_call` 节点且调用鸿蒙系统 API 的场景。

### 常见需 Mock 的系统 API

| 系统 API | 模块 | Mock 方式 |
|----------|------|----------|
| HTTP 请求 | `@ohos.net.http` | 替换 `http.createHttp()` 返回的对象 |
| 文件操作 | `@ohos.file.fs` | 替换 `fs.open` / `fs.read` 等方法 |
| 首选项存储 | `@ohos.data.preferences` | 替换 `preferences.getPreferences` |
| 路由跳转 | `@ohos.router` | 替换 `router.pushUrl` |
| 权限 | `@ohos.abilityAccessCtrl` | 替换 `requestPermissionsFromUser` |

### 实现模板

```typescript
export class MockHttpClient {
  private responses: Map<string, { code: number; data: string }> = new Map()
  private requestLog: Array<{ url: string; method: string }> = []

  expect(url: string): MockHttpClient {
    this._currentUrl = url
    return this
  }

  respond(code: number, data: object): void {
    this.responses.set(this._currentUrl, {
      code,
      data: JSON.stringify(data),
    })
  }

  async request(url: string, options: object): Promise<{ responseCode: number; result: string }> {
    this.requestLog.push({ url, method: (options as Record<string, string>).method ?? 'GET' })
    const response = this.responses.get(url)
    if (!response) {
      return { responseCode: 404, result: 'Not Found' }
    }
    return { responseCode: response.code, result: response.data }
  }

  getRequestLog(): Array<{ url: string; method: string }> {
    return this.requestLog
  }

  reset(): void {
    this.responses.clear()
    this.requestLog = []
  }

  private _currentUrl: string = ''
}
```

## 策略三：用户交互模拟

适用于 `user_intervention` 节点。

### 模式

不模拟 UI 渲染，直接调用组件的事件处理函数，传入 DAG 中定义的 `simulated_value`。

### 实现示例

```typescript
// DAG 定义:
//   type: user_intervention
//   intervention:
//     ui_component: SmsVerifyDialog
//     input_field: smsCodeInput
//     simulated_value: "123456"
//     event_type: onChange

// UT 代码:
it('[AC-X] 用户输入验证码后提交', 0, async () => {
  // 直接调用事件处理函数，不需要真正渲染 UI
  component.onSmsCodeChange('123456')
  await component.onSubmit()

  expect(component.isVerified).assertTrue()
})
```

### 关键要求

1. **不依赖 UI 渲染**：UT 不启动真实 UI，直接调用事件处理方法
2. **使用 DAG 中的模拟值**：`simulated_value` 就是传给事件处理函数的参数
3. **关注业务结果**：断言的是业务状态变化，而非 UI 外观

## 策略四：后台任务模拟

适用于 `background_task` 节点。

### 模式

直接调用后台任务的回调函数，传入 DAG 中定义的 `simulated_result`。

### 实现示例

```typescript
// DAG 定义:
//   type: background_task
//   task:
//     callback: onBackgroundResult
//     simulated_result: "{ status: 'success', data: mockResult }"

// UT 代码:
it('[AC-X] 后台任务完成后更新状态', 0, async () => {
  // 直接调用回调
  await service.onBackgroundResult({ status: 'success', data: mockResult })

  expect(service.taskComplete).assertTrue()
})
```

## 策略五：路由模拟

适用于 `ui_navigation` 节点。

### 模式

创建 Mock Router 记录跳转请求，验证目标页面和参数。

### 实现模板

```typescript
export class MockRouter {
  private _pushHistory: Array<{ url: string; params?: object }> = []

  pushUrl(options: { url: string; params?: object }): void {
    this._pushHistory.push(options)
  }

  get lastPush(): { url: string; params?: object } | undefined {
    return this._pushHistory[this._pushHistory.length - 1]
  }

  get pushCount(): number {
    return this._pushHistory.length
  }

  reset(): void {
    this._pushHistory = []
  }
}

// UT 中使用:
it('[AC-X] 点击列表项跳转详情', 0, () => {
  const mockRouter = new MockRouter()
  // 注入 mockRouter...

  component.onItemClick('item_001')

  expect(mockRouter.lastPush?.url).assertEqual('/pages/ItemDetail')
  expect(mockRouter.lastPush?.params?.itemId).assertEqual('item_001')
})
```

## 测试数据工厂

为避免每个 UT 文件重复构造测试数据，建议创建统一的测试数据工厂：

```typescript
// test/mock/TestDataFactory.ets

import { ItemSummary, ItemKind } from '../../../main/ets/data/model/ItemSummary'

export class TestDataFactory {
  static createItem(overrides?: Partial<ItemSummary>): ItemSummary {
    return {
      itemId: 'test_item_001',
      title: '占位标题',
      kind: ItemKind.STANDARD,
      quantity: 1,
      ...overrides,
    }
  }

  static createItemBatch(count: number): ItemSummary[] {
    return Array.from({ length: count }, (_, i) =>
      TestDataFactory.createItem({ itemId: `item_${i}`, title: `条目 ${i}` })
    )
  }
}
```

## Mock 注入策略

由于 ArkTS 生态尚无成熟的 DI/Mock 库，推荐以下注入方式：

### 方式一：构造函数注入（首选）

被测类通过构造函数接收依赖，UT 中传入 Mock：

```typescript
class ListPage {
  private itemRepo: ItemRepository
  constructor(itemRepo?: ItemRepository) {
    this.itemRepo = itemRepo ?? new ItemRepository()
  }
}

// UT:
const page = new ListPage(mockItemRepo)
```

### 方式二：Setter 注入

被测类通过 setter 方法替换依赖：

```typescript
class ListPage {
  private itemRepo: ItemRepository = new ItemRepository()
  setItemRepository(repo: ItemRepository): void {
    this.itemRepo = repo
  }
}

// UT:
const page = new ListPage()
page.setItemRepository(mockItemRepo)
```

### 方式三：模块级替换

在测试文件中覆盖模块导出：

```typescript
// 仅当上述两种方式不可行时使用
```

**优先级**：构造函数注入 > Setter 注入 > 模块级替换

## 注意事项

1. **Mock 粒度**：优先 Mock Repository 层（接口级），而非 Mock 底层 HTTP 请求（过细）
2. **数据真实性**：Mock 数据的结构和值域应与 data/model 定义一致，不使用不可能的值
3. **异常真实性**：模拟的错误类型应与实际可能发生的错误一致
4. **不 Mock 被测代码**：只 Mock 外部依赖，被测代码本身必须是真实实现
5. **避免过度 Mock**：如果一个函数是纯函数（无副作用），不需要 Mock 其依赖
