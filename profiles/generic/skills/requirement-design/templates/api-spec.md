# 接口规范模板

本模板用于在技术设计文档中定义服务层接口（Repository / UseCase / Client），确保接口定义的完整性和一致性。

---

## 一、Repository 接口规范

Repository 位于 `data/repository/` 层，负责某类业务数据的增删改查，体现数据所有权。

### 定义格式

```typescript
/**
 * {Repository 说明}
 * 数据所有权：{说明该 Repository 管理哪类数据}
 */
export class {RepositoryName} {
  /**
   * {方法说明}
   * @param {paramName} - {参数说明}
   * @returns {返回值说明}
   * @throws {异常说明}（若有）
   */
  async getItems(filter?: FilterType): Promise<Array<ModelType>> {
    // 模拟数据实现
  }

  async getById(id: string): Promise<ModelType | null> {
    // ...
  }

  async create(item: CreateParams): Promise<ModelType> {
    // ...
  }

  async update(id: string, changes: Partial<ModelType>): Promise<ModelType> {
    // ...
  }

  async delete(id: string): Promise<boolean> {
    // ...
  }
}
```

### 方法描述表

每个 Repository 定义后**必须**附带方法描述表：

| 方法名 | 入参 | 出参 | 异步 | 数据来源 | 说明 |
|--------|------|------|------|----------|------|
| getItems | filter?: FilterType | Promise\<Array\<ModelType\>\> | ✅ | 模拟数据 / API | {说明} |
| getById | id: string | Promise\<ModelType \| null\> | ✅ | 模拟数据 / API | {说明} |

**"数据来源"列**：
- `模拟数据` — 方法内部返回硬编码的模拟数据，用于当前模拟应用阶段
- `API` — 调用 shared/client 中定义的接口（远端数据）
- `AppStorage` — 读写鸿蒙 AppStorage
- `Preferences` — 读写鸿蒙 Preferences（轻量存储）

### 模拟数据策略

本项目为模拟应用，Repository 的数据来源策略：

```typescript
export class ItemRepository {
  private mockItems: Array<ItemRecord> = [
    { id: '1', title: '示例条目 A', category: ItemCategory.TYPE_A, ... },
    { id: '2', title: '示例条目 B', category: ItemCategory.TYPE_B, ... },
  ]

  async getAll(): Promise<Array<ItemRecord>> {
    return this.mockItems
  }
}
```

---

## 二、业务编排 Coordinator 接口规范（v2.1）

> **v2.1 定位**：业务编排是一个**概念**而非固定目录 — 代码形态由 coding 按复杂度自选三种合法形式之一（Page 命名方法 / 独立业务类 Flow/Coordinator / 导出命名函数）。**不再**要求必须放在 `domain/usecase/`、**不再**要求新造 `XxxPort` 接口。

### 何时需要独立业务编排类

| 场景 | 是否抽独立 Coordinator 类 | 推荐形态 |
|------|--------------------------|----------|
| 单 Repository 的简单 CRUD | ❌ | Page 直接调用 Repository |
| 跨多个 Repository 的数据聚合 | ⚠️ 视情况 | 可用导出函数（无状态）或 Page 命名方法 |
| 多 UI 节点共享同一业务状态 | ✅ | 独立业务类 Flow/Coordinator |
| 多步云调用串行（≥2 次） | ✅ | 独立业务类 Flow/Coordinator |
| 含回滚分支（失败需撤销持久化） | ✅ | 独立业务类 Flow/Coordinator |

> 满足后三条任一时，同步产出 `doc/features/{feature}/use-cases.yaml` 作为规约文档；否则 `acceptance.yaml + dag.yaml` 足够。

### 定义格式（形态 B：独立业务类）

```typescript
/**
 * {CoordinatorName} — {业务流说明}
 * 编排逻辑：{概述调用了哪些 data 层类、数据如何流转、状态如何变迁}
 */
export class {CoordinatorName} {
  state: { phase: PhaseEnum; errorCode: string | null } = { phase: 'Idle', errorCode: null }

  // 直接引用 contracts.yaml 已登记的现有数据层类（api / repository / store）
  // 禁止为了 UT 打桩新造 Port 接口
  constructor(
    private readonly api: {ApiClientType},
    private readonly store: {StoreType},
  ) {}

  /**
   * 命名业务入口（必须是 named method，供 UT 直接 await 调用）
   * 对应 use-cases.yaml > ui_bindings[].user_actions[].calls 的符号
   */
  async {namedAction}(param: ParamType): Promise<void> {
    // 1. 发布中间状态
    // 2. 调用 data 层（api/store）
    // 3. 处理成功/失败分支，发布终态
    // UI 副作用（Toast / 导航）一律通过 state 字段订阅实现，不在此文件 import UI 符号
  }
}
```

### 方法描述表

| 方法名 | 入参 | 出参 | 异步 | 编排流程 | 发布的 state 阶段 | 说明 |
|--------|------|------|------|----------|-------------------|------|
| {namedAction} | ParamType | Promise\<void\> | ✅ | api.xxx → 处理 → store.yyy → 发布状态 | Verifying → Success/Failed | {说明} |

---

## 三、Client 接口规范

Client 位于 `shared/client/` 层，定义端云请求的接口契约（请求体、响应体、接口路径）。

### 定义格式

```typescript
/**
 * {接口说明}
 * 基础路径: /api/v1/{resource}
 */

/** 请求体 */
export interface {RequestName} {
  /** {字段说明} */
  field: string
}

/** 响应体 */
export interface {ResponseName} {
  /** 业务数据 */
  data: DataType
  /** 状态码 */
  code: number
  /** 提示信息 */
  message: string
}

/** 接口调用函数 */
export async function {apiFunction}(request: {RequestName}): Promise<{ResponseName}> {
  // 在模拟阶段，此处由 Repository 模拟实现
  // 后续可替换为真实 HTTP 调用
}
```

### 接口清单表

| 接口名 | HTTP 方法 | 路径 | 请求体 | 响应体 | 说明 |
|--------|-----------|------|--------|--------|------|
| {apiFunction} | GET/POST | /api/v1/{path} | {RequestName} | {ResponseName} | {说明} |

---

## 四、接口间依赖关系

设计文档中应明确标注接口间的调用关系，确保不违反分层规则：

```
presentation/pages/Page.ets
  └── 调用 → {CoordinatorName}（形态 A/B/C 之一；非强制目录）
        ├── 调用 → data/repository/RepoA.ets
        │     └── 调用 → shared/client/ApiClient.ets（若需远端数据）
        │     └── 使用 → data/model/ModelA.ets
        └── 调用 → data/repository/RepoB.ets
              └── 使用 → data/model/ModelB.ets
```

**合法调用方向**: presentation → （可选）业务编排层 → data → shared（自上而下）。若当前 feature 未触发 `use-cases.yaml` 复杂度阈值，可省略中间业务编排层，由 Page 直接调用 Repository。

**禁止调用方向**: shared → data、data → domain、domain → presentation（自下而上）

---

## 五、异步策略约定

| 策略 | 使用场景 | 示例 |
|------|----------|------|
| `async/await` | 所有异步操作的默认选择 | `const data = await repo.getAll()` |
| `Promise` | 仅在需要并行调用时使用 | `Promise.all([repoA.get(), repoB.get()])` |
| 同步方法 | 纯计算、无 I/O 操作 | `model.formatAmount()` |

---

## 六、命名约定

| 类别 | 约定 | 示例 |
|------|------|------|
| Repository 类名 | PascalCase + Repository 后缀 | `CardRepository` |
| UseCase 类名 | PascalCase + UseCase 后缀 | `LoadHomeDataUseCase` |
| Client 文件名 | PascalCase + ApiClient 后缀 | `HomeApiClient.ets` |
| 方法名 | camelCase，动词开头 | `getCards`、`loadHomeData` |
| 请求体 | PascalCase + Request 后缀 | `GetCardsRequest` |
| 响应体 | PascalCase + Response 后缀 | `GetCardsResponse` |
