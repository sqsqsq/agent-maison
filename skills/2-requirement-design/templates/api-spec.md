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
export class CardRepository {
  private mockCards: Array<CardInfo> = [
    // 在此定义模拟数据
    { id: '1', name: '交通卡', type: CardType.TRANSPORT, ... },
    { id: '2', name: '银行卡', type: CardType.BANK, ... },
  ]

  async getAll(): Promise<Array<CardInfo>> {
    return this.mockCards
  }
}
```

---

## 二、UseCase 接口规范

UseCase 位于 `domain/usecase/` 层，负责编排多个 Repository 的复杂业务逻辑。

### 何时需要 UseCase

| 场景 | 是否需要 UseCase | 说明 |
|------|-----------------|------|
| 单 Repository 的简单 CRUD | ❌ | 直接在 presentation 层调用 Repository |
| 跨多个 Repository 的数据聚合 | ✅ | UseCase 编排多个数据源 |
| 包含业务规则判断的操作 | ✅ | UseCase 封装业务规则 |
| 需要多步骤事务的操作 | ✅ | UseCase 管理事务流程 |

### 定义格式

```typescript
/**
 * {UseCase 说明}
 * 编排逻辑：{概述调用了哪些 Repository、数据如何流转}
 */
export class {UseCaseName} {
  private repoA: RepositoryA = new RepositoryA()
  private repoB: RepositoryB = new RepositoryB()

  /**
   * 执行用例
   * @param {paramName} - {参数说明}
   * @returns {返回值说明}
   *
   * 流程：
   * 1. 从 RepoA 获取数据 A
   * 2. 根据业务规则处理数据 A
   * 3. 从 RepoB 获取关联数据 B
   * 4. 合并 A + B 返回结果
   */
  async execute(param: ParamType): Promise<ResultType> {
    // ...
  }
}
```

### 方法描述表

| 方法名 | 入参 | 出参 | 异步 | 编排流程 | 说明 |
|--------|------|------|------|----------|------|
| execute | ParamType | Promise\<ResultType\> | ✅ | RepoA.get → 处理 → RepoB.get → 合并 | {说明} |

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
  └── 调用 → domain/usecase/UseCase.ets
        ├── 调用 → data/repository/RepoA.ets
        │     └── 调用 → shared/client/ApiClient.ets（若需远端数据）
        │     └── 使用 → data/model/ModelA.ets
        └── 调用 → data/repository/RepoB.ets
              └── 使用 → data/model/ModelB.ets
```

**合法调用方向**: presentation → domain → data → shared（自上而下）

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
