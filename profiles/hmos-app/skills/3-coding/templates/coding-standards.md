# ArkTS / 鸿蒙编码规范

> 适用于 HarmonyOS 应用工程，基于**模块间 DAG + 模块内 4 层架构**的通用规范。
>
> **模板说明**：下方目录 / 模块名 / 代码占位（`entry_app`、`feature_demo`、`@scope/<module>` 等）仅作结构演示；实际以本工程 `architecture` / catalog 为准替换。

---

## 1. 项目整体结构（模块间）

```
{ProjectRoot}/
├── entry_app/                       # HAP — 应用主入口
│   └── src/main/ets/
│       └── presentation/pages/     # 主 Navigation 框架 (Index.ets)
├── feature_demo/                    # HAR — 演示 feature 聚合
│   └── src/main/ets/
│       ├── shared/
│       ├── data/
│       ├── domain/
│       └── presentation/
├── inventory_service/               # HAR — 列表示例模块
│   └── src/main/ets/...
├── shared_platform/                 # HAR — 公共基础模块
│   └── src/main/ets/
│       └── shared/                 # 公共模块通常只有 shared 层
├── AppScope/                       # 应用级配置与资源
├── build-profile.json5             # 全局构建配置（注册所有模块）
├── oh-package.json5                # 全局依赖配置
└── hvigorfile.ts
```

### 模块间依赖规则

```
entry_app (HAP)
  ├── depends on → feature_demo (HAR)
  ├── depends on → inventory_service (HAR)
  └── depends on → shared_platform (HAR)

feature_demo (HAR)
  └── depends on → shared_platform (HAR)

inventory_service (HAR)
  └── depends on → shared_platform (HAR)

shared_platform (HAR)
  └── 无依赖（最底层）
```

- **HAP 模块**（entry_app）：应用入口，聚合各功能模块，只有它可以使用 `@Entry`
- **HAR/HSP 库模块**（其余）：功能/公共模块，通过 `Index.ets` 导出对外 API
- 功能模块之间**尽量不互相依赖**，共享内容下沉到 `shared_platform`
- 检测到循环依赖视为 **BLOCKER**

---

## 2. 模块内目录结构（4 层架构）

```
{module}/src/main/ets/
├── shared/                         # Layer 1: 共享层
│   ├── client/                     # 端云请求定义
│   │   └── HomeApiClient.ets       #   请求体/响应体/接口
│   ├── constant/                   # 常量和通用类型
│   │   ├── HomeConstants.ets       #   业务常量
│   │   └── DemoTypes.ets           #   通用类型定义
│   ├── components/                 # 基础 UI 组件（业务无关）
│   │   ├── BaseTileView.ets        #   通用列表项壳
│   │   └── IconButton.ets          #   图标按钮
│   └── utils/                      # 工具函数
│       └── NumberUtils.ets         #   数字格式化工具
│
├── data/                           # Layer 2: 数据层
│   ├── model/                      # 业务数据类型 + 内聚方法
│   │   ├── ItemInfo.ets           #   列表示例数据模型
│   │   └── BannerInfo.ets          #   Banner 数据模型
│   └── repository/                 # 数据仓库（数据所有权）
│       ├── ItemRepository.ets      #   列表 CRUD
│       └── BannerRepository.ets    #   Banner CRUD
│
├── domain/                         # Layer 3: 领域层
│   └── usecase/                    # 业务用例
│       └── LoadDashboardUseCase.ets #   首页数据编排
│
├── presentation/                   # Layer 4: 展示层
│   ├── components/                 # 复杂组件（自带生命周期 + 数据闭环）
│   │   ├── ItemCarousel.ets        #   横向列表示例组件
│   │   └── FunctionGrid.ets        #   功能宫格复杂组件
│   └── pages/                      # 页面（NavDestination）
│       └── DashboardPage.ets       #   宿主壳页
│
└── Index.ets                       # HAR/HSP 库模块导出入口
```

### 层间依赖规则（绝对禁令）

```
presentation → 可引用 → domain, data, shared
domain       → 可引用 → data, shared
data         → 可引用 → shared
shared       → 可引用 → 无（本模块内无依赖；可依赖下层 Module 的导出）
```

**反向依赖 = BLOCKER**。例如 data 层 import presentation 层的文件，必须修正。

---

## 3. 命名规范

### 3.1 目录和文件命名

| 类别 | 规则 | 示例 |
|------|------|------|
| Module 目录 | snake_case | `feature_demo/`、`inventory_service/` |
| 层级目录 | 固定名称 | `shared/`、`data/`、`domain/`、`presentation/` |
| 子目录 | 固定名称 | `client/`、`constant/`、`components/`、`utils/`、`model/`、`repository/`、`usecase/`、`pages/` |
| 文件名 | PascalCase | `ItemInfo.ets`、`ItemRepository.ets`、`DashboardPage.ets` |

### 3.2 标识符命名

| 类别 | 风格 | 示例 |
|------|------|------|
| struct（组件） | PascalCase | `ItemCarousel`、`FunctionGrid` |
| interface | PascalCase | `ItemInfo`、`ApiResponse` |
| class | PascalCase | `ItemRepository`、`LoadDashboardUseCase` |
| 函数/方法 | camelCase | `getItemList()`、`formatSku()` |
| 变量 | camelCase | `itemList`、`isLoading` |
| 常量 | UPPER_SNAKE_CASE | `MAX_BATCH_SIZE`、`API_TIMEOUT_MS` |
| 枚举类型 | PascalCase | `ItemKind` |
| 枚举值 | PascalCase | `ItemKind.STANDARD` |

### 3.3 各层文件命名后缀约定

| 层/子目录 | 后缀约定 | 示例 |
|-----------|----------|------|
| shared/components | 语义命名（无特定后缀） | `BaseTileView.ets`、`IconButton.ets` |
| shared/client | `ApiClient` 或 `Api` | `DemoApiClient.ets` |
| shared/constant | `Constants` 或 `Types` | `HomeConstants.ets`、`DemoTypes.ets` |
| shared/utils | `Utils` | `FormatUtils.ets`、`NumberUtils.ets` |
| data/model | 语义命名（数据实体名） | `ItemInfo.ets`、`BannerInfo.ets` |
| data/repository | `Repository` | `ItemRepository.ets` |
| domain/flow（v2.1 推荐）或 domain/usecase（可选） | `Flow` / `Coordinator` / `UseCase` 任一语义命名 | `TaskSubmitFlow.ets`、`LoadDashboardUseCase.ets` |
| presentation/components | 语义命名（功能描述） | `ItemCarousel.ets`、`ActionBar.ets` |
| presentation/pages | `Page` 后缀（推荐） | `DashboardPage.ets`、`ItemDetailPage.ets` |

---

## 4. 各层编码规范

### 4.1 shared/client — 端云请求

```typescript
// shared/client/DemoApiClient.ets

export interface ListItemsRequest {
  actorId: string
  pageSize?: number
}

export interface ListItemsResponse {
  items: ItemDto[]
  total: number
}

export interface ItemDto {
  id: string
  title: string
  sku: string
  kind: string
}

export class DemoApiClient {
  static async listItems(request: ListItemsRequest): Promise<ListItemsResponse> {
    // 端云请求实现（或模拟实现）
  }
}
```

**规则**：
- 请求体/响应体用 `interface` 定义（后缀 `Request`/`Response`）
- 接口传输对象用 `Dto` 后缀区分于业务模型
- 类方法用 `static`

### 4.2 shared/constant — 常量与类型

```typescript
// shared/constant/HomeConstants.ets

export class HomeConstants {
  static readonly GRID_COLUMN_COUNT = 4
  static readonly GRID_ROW_COUNT = 2
  static readonly BANNER_AUTO_PLAY_INTERVAL_MS = 3000
  static readonly ITEM_CAROUSEL_ANIM_MS = 300
}
```

```typescript
// shared/constant/DemoTypes.ets

export enum ItemKind {
  STANDARD = 'STANDARD',
  PREVIEW = 'PREVIEW',
  ARCHIVE = 'ARCHIVE',
}

export interface GridItemConfig {
  id: string
  title: ResourceStr
  icon: Resource
  routePath: string
}
```

### 4.3 shared/components — 基础 UI 组件

```typescript
// shared/components/BaseTileView.ets

@Component
export struct BaseTileView {
  @Prop tileColor: ResourceColor = $r('app.color.tile_default_bg')
  @Prop borderRadiusValue: number = 12
  @BuilderParam content: () => void

  build() {
    Column() {
      if (this.content) {
        this.content()
      }
    }
    .width('100%')
    .borderRadius(this.borderRadiusValue)
    .backgroundColor(this.tileColor)
    .padding(16)
  }
}
```

**规则**：
- 与业务语义无关，纯 UI 容器/样式组件
- 用 `@Prop` 接收外观配置，用 `@BuilderParam` 接收内容插槽
- **不得**引入 data/domain/presentation 层的任何类型

### 4.4 data/model — 业务数据模型

```typescript
// data/model/ItemInfo.ets

import { ItemKind } from '../../shared/constant/DemoTypes'

export class ItemInfo {
  id: string = ''
  title: string = ''
  sku: string = ''
  kind: ItemKind = ItemKind.STANDARD
  accentColor: string = '#1A73E8'

  get displaySku(): string {
    if (this.sku.length < 4) return this.sku
    return `···${this.sku.slice(-4)}`
  }

  get shortTitle(): string {
    return this.title.length > 8 ? this.title.substring(0, 8) : this.title
  }
}
```

**规则**：
- 使用 `class`（而非 interface）承载业务模型，以支持内聚方法
- 需要被 `@ObjectLink` 引用的 class 加 `@Observed` 装饰
- 内聚方法只做**数据本身的转换/计算**，不涉及外部依赖

### 4.5 data/repository — 数据仓库

```typescript
// data/repository/ItemRepository.ets

import { ItemInfo } from '../model/ItemInfo'
import { DemoApiClient, ListItemsResponse, ItemDto } from '../../shared/client/DemoApiClient'
import { hilog } from '@kit.PerformanceAnalysisKit'

const TAG = 'ItemRepository'
const DOMAIN = 0x0001

export class ItemRepository {
  private static itemCache: ItemInfo[] = []

  static async getItems(actorId: string): Promise<ItemInfo[]> {
    try {
      const response = await DemoApiClient.listItems({ actorId })
      ItemRepository.itemCache = response.items.map(dto => ItemRepository.mapToModel(dto))
      return ItemRepository.itemCache
    } catch (error) {
      hilog.error(DOMAIN, TAG, 'Failed to get items: %{public}s',
        error instanceof Error ? error.message : String(error))
      return ItemRepository.itemCache
    }
  }

  static getCachedItems(): ItemInfo[] {
    return ItemRepository.itemCache
  }

  static async deleteItem(itemId: string): Promise<boolean> {
    ItemRepository.itemCache = ItemRepository.itemCache.filter(c => c.id !== itemId)
    return true
  }

  private static mapToModel(dto: ItemDto): ItemInfo {
    const it = new ItemInfo()
    it.id = dto.id
    it.title = dto.title
    it.sku = dto.sku
    return it
  }
}
```

**规则**：
- 体现**数据所有权**——某类数据的所有增删改查集中在一个 Repository
- 负责 DTO → Model 的转换（Mapper 逻辑）
- 可持有缓存，提供降级策略
- **不得**包含 UI 逻辑或直接引用组件

### 4.6 业务编排层（v2.1：条件性产出，代码形态三选一）

> **v2.1 核心原则**：业务编排是**概念**而非**固定目录**。仅当 feature 满足"多 UI 共享状态 / 多步云调用 / 含回滚分支"任一条件时才同步产出 `use-cases.yaml` 规约；代码形态由本 Skill 按复杂度从以下三种选一：

**形态 A：Page 命名方法（最简单）**
```typescript
// presentation/pages/HomeTabPage.ets 内部命名 async 方法
@Component
export struct HomeTabPage {
  async triggerLoad(): Promise<void> {
    const entries = await this.homeRepository.getServiceEntries()
    const promos = await this.homeRepository.getPromoList()
    this.serviceEntries = entries
    this.promoList = promos
  }
}
```

**形态 B：独立业务类（中等复杂度）**
```typescript
// domain/flow/TaskSubmitFlow.ets（或 shared/flow/，不强制路径；与业务规约一致）
import { RemoteTaskGateway } from '../../data/api/RemoteTaskGateway'
import { LocalTaskLedger } from '../../data/storage/LocalTaskLedger'

export class TaskSubmitFlow {
  state: { phase: 'Idle' | 'Preparing' | 'WaitingOtp' | 'Success' | 'Failed'
           errorCode: string | null } = { phase: 'Idle', errorCode: null }

  constructor(
    private readonly gateway: RemoteTaskGateway,
    private readonly ledger: LocalTaskLedger,
  ) {}

  async submitTask(payload: Record<string, string>): Promise<void> {
    this.state = { ...this.state, phase: 'Preparing' }
    // 编排 gateway / ledger 调用（略）
  }
}
```

**形态 C：导出命名函数（无状态流程）**
```typescript
// domain/actions/loadDashboard.ets（或 shared/actions/）
export async function loadDashboard(actorId: string): Promise<DashboardVm> {
  const [items, banners] = await Promise.all([
    ItemRepository.getItems(actorId),
    BannerRepository.getBanners()
  ])
  return { items, banners, unreadMessageCount: 0 }
}
```

**通用规则**：
- 每个 UI 事件最终进入的业务函数必须是**命名方法 / 导出函数 / 类方法**，不能藏在 `onClick = () => { ... }` inline lambda 里（由 harness `named_business_handler` BLOCKER 强制）
- **不得** import 任何 UI 符号（`@Component` / `NavPathStack` / `showToast` / `$r` / `@kit.ArkUI` 等），保证可在 Hypium 中脱离 ArkUI runtime 实例化
- 直接复用 `contracts.yaml > interfaces[].class` 已登记的现有数据层类作为构造器依赖（形态 B）；**禁止**为了"便于打桩"新造 `XxxPort` 接口
- 命名体现业务意图（`submitTask` / `confirmOtp` / `loadDashboard`），避免空词（`handler` / `onClick1`）

### 4.7 presentation/components — 复杂组件

```typescript
// presentation/components/ItemCarousel.ets

import { ItemInfo } from '../../data/model/ItemInfo'
import { ItemRepository } from '../../data/repository/ItemRepository'

@Component
export struct ItemCarousel {
  @State items: ItemInfo[] = []
  @State currentIndex: number = 0
  @State isLoading: boolean = true

  onItemSelected?: (item: ItemInfo) => void

  aboutToAppear(): void {
    this.loadItems()
  }

  private async loadItems(): Promise<void> {
    this.isLoading = true
    try {
      this.items = await ItemRepository.getItems('mock_actor')
    } finally {
      this.isLoading = false
    }
  }

  build() {
    Column() {
      if (this.isLoading) {
        LoadingProgress().width(32).height(32)
      } else if (this.items.length === 0) {
        this.EmptyGuide()
      } else {
        this.ItemCarouselContent()
      }
    }
    .width('100%')
  }

  @Builder
  private ItemCarouselContent() {
    Swiper() {
      ForEach(this.items, (it: ItemInfo) => {
        // 条目渲染占位
      }, (it: ItemInfo) => it.id)
    }
    .index(this.currentIndex)
    .onChange((index: number) => { this.currentIndex = index })
  }

  @Builder
  private EmptyGuide() {
    Column() {
      Text($r('app.string.demo_empty_hint'))
    }
    .justifyContent(FlexAlign.Center)
  }
}
```

**规则**：
- **自带生命周期**（`aboutToAppear` / `aboutToDisappear`）
- 完成**用户操作 → 逻辑执行 → 数据变更 → UI 刷新**的完整闭环
- 可直接引用 data 层和 domain 层
- 对外通过回调（`onXxx?: () => void`）通信

### 4.8 presentation/pages — 页面

```typescript
// presentation/pages/DashboardPage.ets

import { ItemCarousel } from '../components/ItemCarousel'
import { FunctionGrid } from '../components/FunctionGrid'

@Builder
export function dashboardPageBuilder() {
  DashboardPage()
}

@Component
struct DashboardPage {
  build() {
    NavDestination() {
      Scroll() {
        Column({ space: 12 }) {
          ItemCarousel()
          FunctionGrid()
        }
        .width('100%')
      }
      .scrollBar(BarState.Off)
    }
    .title($r('app.string.dashboard_title'))
    .hideTitleBar(true)
  }
}
```

**规则**：
- 功能模块的页面基于 `NavDestination`（不是 `@Entry`）
- 导出 `@Builder` 函数作为路由入口（供 Navigation 的 navDestination 使用）
- 页面本身是多个复杂组件和基础组件的**聚合**
- 页面层尽量薄，复杂逻辑下沉到复杂组件或 domain 层

---

## 5. HAR/HSP 库模块导出规范

每个 HAR/HSP 库模块的根目录有一个 `Index.ets`，控制对外暴露的 API：

```typescript
// feature_demo/src/main/ets/Index.ets

// 导出页面 Builder（供 entry_app 路由使用）
export { dashboardPageBuilder } from './presentation/pages/DashboardPage'

export { ItemInfo } from './data/model/ItemInfo'
export { ItemKind } from './shared/constant/DemoTypes'
```

**规则**：
- 只导出**必须被其他模块引用**的内容
- Repository、UseCase 通常不导出（模块私有）
- 页面通过导出 Builder 函数供 Navigation 路由

---

## 6. 资源管理

### 6.1 字符串资源化

**禁止在 UI 代码中硬编码文字字符串**：

```typescript
// ❌ 错误
Text('暂无数据')

// ✅ 正确
Text($r('app.string.demo_empty_hint'))
```

资源文件位置（每个 Module 各自维护）：
```
{module}/src/main/resources/base/element/string.json     # 默认（英文）
{module}/src/main/resources/zh_CN/element/string.json    # 中文
```

### 6.2 颜色资源化

```typescript
// ❌ 错误
.backgroundColor('#FF5722')

// ✅ 正确
.backgroundColor($r('app.color.primary_orange'))
```

深色模式：`{module}/src/main/resources/dark/element/color.json`

### 6.3 图片资源

- 路径: `{module}/src/main/resources/base/media/`
- 引用: `$r('app.media.icon_name')`
- 优先 SVG 格式
- 命名: snake_case — `ic_home_active.svg`

---

## 7. 异步与错误处理

```typescript
// ✅ 使用 async/await + try-catch
private async loadData(): Promise<void> {
  this.isLoading = true
  try {
    this.data = await SomeRepository.getData()
  } catch (error) {
    hilog.error(DOMAIN, TAG, 'Load failed: %{public}s',
      error instanceof Error ? error.message : String(error))
    this.errorMessage = '加载失败'
  } finally {
    this.isLoading = false
  }
}
```

- 所有 `async` 方法必须有 `try-catch`
- Repository 层提供降级策略（缓存 / 默认值）
- 使用 `hilog` 记录错误日志

---

## 8. 性能规范

| 场景 | 策略 |
|------|------|
| 短列表 (< 20 项) | `ForEach` + `keyGenerator` |
| 长列表 (>= 20 项) | `LazyForEach` + `IDataSource` |
| 条件渲染 | `if/else` 控制分支（减少不可见节点） |
| 频繁切换 | `.visibility()` 避免重建组件树 |
| 图片加载 | 设置 `.alt()` 占位图 + `.onError()` 回退 |

---

## 9. 导入规范

```typescript
// 1. 鸿蒙 SDK
import { router } from '@kit.ArkUI'
import { hilog } from '@kit.PerformanceAnalysisKit'

// 2. 跨模块引用（通过 HAR/HSP 库模块的 Index.ets 导出）
import { ItemInfo, ItemKind } from '@feature_demo'

// 3. 模块内引用（使用相对路径，遵循层间依赖方向）
import { ItemInfo } from '../../data/model/ItemInfo'
import { HomeConstants } from '../../shared/constant/HomeConstants'
```

**导入检查清单**：
- 鸿蒙 SDK 用 `@kit.XxxKit`
- 跨模块用 `@{module_name}`（对应 oh-package.json5 中的包名）
- 模块内用相对路径
- **检查每条 import 是否违反分层规则**

---

## 10. 注释规范

### 需要注释的情况

- 非直觉的业务规则
- 层间设计决策（为什么某逻辑放在 domain 而非 presentation）
- 模拟数据说明
- TODO 标记

### 不写注释的情况

- 显而易见的代码逻辑
- 纯粹叙述代码行为

---

## 11. 模拟数据策略

| 数据类型 | 所在层 | 模拟方式 |
|----------|--------|----------|
| API 接口定义 | shared/client | 定义 interface，实现返回模拟数据 |
| 业务数据 | data/repository | Repository 内部用硬编码 JSON 模拟 |
| 网络图片 | 资源文件 | 使用 `$r('app.media.xxx')` 替代 URL |
| 异步延迟 | data/repository | `setTimeout` 模拟 200-500ms 延时 |

模拟数据实现在 Repository 层，当后续接入真实后端时，只需修改 Repository 的实现，不影响 domain 和 presentation 层。
