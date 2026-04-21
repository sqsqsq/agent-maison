# UT 代码模板

> **模板说明**：本模板以钱包工程的模块命名（`WalletMain` / `BankCard` / `CardRepository` 等）为参考示例演示字段填法；实际使用请按你自己工程的实例替换。

## 概述

本文件定义业务级 UT 代码的标准结构和编写规范。生成的 UT 基于 `@ohos/hypium` 测试框架，以 DAG 描述的业务流程为粒度。

## 标准 UT 文件结构

```typescript
// ============================================================================
// 业务流程: {flow_name}
// DAG 文件: {dag_file_path}
// 关联 AC: {linked_acceptance}
// ============================================================================

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from '@ohos/hypium'
// 被测类和依赖的 import
import { CardRepository } from '../../data/repository/CardRepository'
import { CardInfo, CardType } from '../../data/model/CardInfo'
// Mock 类的 import
import { MockCardRepository } from './mock/MockCardRepository'

export default function {flowId}Test() {
  describe('{FlowName}', () => {

    // ---- Mock 声明 ----
    let mockCardRepo: MockCardRepository

    // ---- 测试数据 ----
    const mockBankCard: CardInfo = {
      cardId: 'card_001',
      cardName: '测试银行卡',
      cardType: CardType.BANK_CARD,
      balance: 1000.00,
    }

    // ---- Setup / Teardown ----
    beforeEach(() => {
      mockCardRepo = new MockCardRepository()
    })

    afterEach(() => {
      mockCardRepo.reset()
    })

    // ---- 正常路径测试 ----

    // 关联 AC-1: {ac_description}
    it('[AC-1] {test_case_description}', 0, async () => {
      // Arrange: 设置 mock 返回值（对应 DAG 节点 n2 的 success 场景）
      mockCardRepo.setCardList([mockBankCard])

      // Act: 执行业务流程入口（对应 DAG 入口 n1）
      // ... 调用被测函数或模拟生命周期 ...

      // Assert: 验证业务结果（对应 DAG 节点 n4 的 assertions）
      expect(result.length).assertEqual(1)
      expect(result[0].cardName).assertEqual('测试银行卡')
    })

    // ---- 分支路径测试 ----

    // 关联 AC-2: {ac_description}
    it('[AC-2] {branch_test_description}', 0, async () => {
      // Arrange: 设置 mock 返回空列表（对应 DAG 节点 n2 的 empty 场景）
      mockCardRepo.setCardList([])

      // Act
      // ...

      // Assert: 验证空状态（对应 DAG 节点 n5 的 assertions）
      expect(result.length).assertEqual(0)
    })

    // ---- 边界场景测试 ----

    // 关联 BD-1: {bd_description}
    it('[BD-1] {boundary_test_description}', 0, async () => {
      // Arrange: 设置 mock 抛出异常（对应 DAG 节点 n2 的 error 场景）
      mockCardRepo.simulateError(new Error('Network unavailable'))

      // Act
      // ...

      // Assert: 验证异常处理行为
      expect(errorHandled).assertTrue()
    })
  })
}
```

## 关键规范

### 1. 文件命名与路径

| 项目 | 规范 |
|------|------|
| 文件名 | `{flow_id}.test.ets`（与 DAG flow_id 对应） |
| 路径 | `{module}/src/ohosTest/ets/test/{flow_id}.test.ets` |
| 导出函数名 | `{flowId}Test`（camelCase + Test 后缀） |
| describe 名 | 与 flow_name 对应的英文标识 |

### 2. 用例命名规范

每个 `it()` 用例名称必须标注关联的 AC/BD 编号：

```typescript
it('[AC-1] 首页加载后展示卡片列表', 0, async () => { ... })
it('[AC-2] 无卡片时展示引导开卡页面', 0, async () => { ... })
it('[BD-1] 网络断开时展示离线缓存数据', 0, async () => { ... })
it('[BD-2] 卡片超过 100 张时列表滚动流畅', 0, async () => { ... })
```

### 3. AAA 模式（Arrange-Act-Assert）

每个测试用例严格遵循 AAA 三段式：

```typescript
it('[AC-X] 用例描述', 0, async () => {
  // Arrange: 准备测试数据和 mock
  // - 对应 DAG 中 async_call 节点的 mock_data
  // - 对应 DAG 中 user_intervention 节点的 simulated_value

  // Act: 执行被测行为
  // - 对应 DAG 的 entry_point 和 code_execution 节点

  // Assert: 验证结果
  // - 对应 DAG 中 assertion 节点的 assertions
})
```

### 4. Mock 类规范

Mock 类统一放在 `test/mock/` 目录下：

```typescript
// test/mock/MockCardRepository.ets

export class MockCardRepository {
  private cardList: CardInfo[] = []
  private shouldThrow: Error | null = null

  setCardList(cards: CardInfo[]): void {
    this.cardList = cards
  }

  simulateError(error: Error): void {
    this.shouldThrow = error
  }

  async getCardList(): Promise<CardInfo[]> {
    if (this.shouldThrow) {
      throw this.shouldThrow
    }
    return this.cardList
  }

  reset(): void {
    this.cardList = []
    this.shouldThrow = null
  }
}
```

**Mock 类要求**：
- 与 contracts.yaml 中的接口签名类型一致
- 提供 `reset()` 方法用于 afterEach 清理
- 提供场景设置方法（`setXxx` / `simulateError`）
- 不包含业务逻辑

### 5. 测试注册（List.test.ets）

所有测试函数必须在 `List.test.ets` 中注册：

```typescript
import homePageLoadTest from './home_page_load.test'
import cardDetailViewTest from './card_detail_view.test'

export default function testsuite() {
  homePageLoadTest()
  cardDetailViewTest()
}
```

### 6. hypium 断言 API 速查

| 断言方法 | 用途 | 示例 |
|---------|------|------|
| `expect(v).assertEqual(expected)` | 值相等 | `expect(count).assertEqual(3)` |
| `expect(v).assertDeepEquals(expected)` | 深度相等 | `expect(obj).assertDeepEquals({a:1})` |
| `expect(v).assertTrue()` | 为真 | `expect(visible).assertTrue()` |
| `expect(v).assertFalse()` | 为假 | `expect(loading).assertFalse()` |
| `expect(v).assertNull()` | 为 null | `expect(result).assertNull()` |
| `expect(v).assertUndefined()` | 为 undefined | `expect(val).assertUndefined()` |
| `expect(v).assertInstanceOf(Type)` | 类型检查 | `expect(e).assertInstanceOf('Error')` |
| `expect(v).assertLarger(n)` | 大于 | `expect(len).assertLarger(0)` |
| `expect(v).assertLess(n)` | 小于 | `expect(time).assertLess(2000)` |
| `expect(v).assertContain(sub)` | 包含 | `expect(str).assertContain('成功')` |

### 7. 异步测试模式

```typescript
// 推荐：async/await
it('异步测试', 0, async () => {
  const result = await asyncFunction()
  expect(result).assertEqual(expected)
})
```

## 目录结构示例

```
02-Feature/WalletMain/
├── src/
│   ├── main/ets/          # 业务代码（Skill 3 产出，不可修改）
│   └── ohosTest/
│       ├── ets/
│       │   └── test/
│       │       ├── List.test.ets              # 测试入口注册
│       │       ├── home_page_load.test.ets    # 首页加载流程 UT
│       │       ├── card_detail_view.test.ets  # 卡片详情流程 UT
│       │       └── mock/
│       │           ├── MockCardRepository.ets # 卡片仓库 Mock
│       │           └── MockBannerRepository.ets
│       └── module.json5
└── test/
    └── dag/
        ├── home_page_load.dag.yaml
        └── card_detail_view.dag.yaml
```
