# ArkTS / 鸿蒙编码规范

> 适用于 HarmonyOS 应用工程，基于**模块间 DAG + 模块内 4 层架构**的通用规范。
>
> **模板说明**：下方目录 / 模块名 / 代码片段（`wallet_home` / `card_management` / `@wallet/*` 等）均以钱包工程为参考示例演示填法；实际使用请按你自己工程的模块名替换。

---

## 1. 项目整体结构（模块间）

```
{ProjectRoot}/
├── phone/                          # HAP — 应用主入口
│   └── src/main/ets/
│       └── presentation/pages/     # 主 Navigation 框架 (Index.ets)
├── wallet_home/                    # HAR — 首页功能模块
│   └── src/main/ets/
│       ├── shared/
│       ├── data/
│       ├── domain/
│       └── presentation/
├── card_management/                # HAR — 卡片管理模块
│   └── src/main/ets/...
├── common/                         # HAR — 公共基础模块
│   └── src/main/ets/
│       └── shared/                 # 公共模块通常只有 shared 层
├── AppScope/                       # 应用级配置与资源
├── build-profile.json5             # 全局构建配置（注册所有模块）
├── oh-package.json5                # 全局依赖配置
└── hvigorfile.ts
```

### 模块间依赖规则

```
phone (HAP)
  ├── depends on → wallet_home (HAR)
  ├── depends on → card_management (HAR)
  └── depends on → common (HAR)

wallet_home (HAR)
  └── depends on → common (HAR)

card_management (HAR)
  └── depends on → common (HAR)

common (HAR)
  └── 无依赖（最底层）
```

- **HAP 模块**（phone）：应用入口，聚合各功能模块，只有它可以使用 `@Entry`
- **HAR 模块**（其余）：功能/公共模块，通过 `Index.ets` 导出对外 API
- 功能模块之间**尽量不互相依赖**，共享内容下沉到 `common`
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
│   │   └── HomeTypes.ets           #   通用类型定义
│   ├── components/                 # 基础 UI 组件（业务无关）
│   │   ├── BaseCardView.ets        #   通用卡片壳子
│   │   └── IconButton.ets          #   图标按钮
│   └── utils/                      # 工具函数
│       └── NumberUtils.ets         #   数字格式化工具
│
├── data/                           # Layer 2: 数据层
│   ├── model/                      # 业务数据类型 + 内聚方法
│   │   ├── CardInfo.ets            #   卡片数据模型
│   │   └── BannerInfo.ets          #   Banner 数据模型
│   └── repository/                 # 数据仓库（数据所有权）
│       ├── CardRepository.ets      #   卡片 CRUD
│       └── BannerRepository.ets    #   Banner CRUD
│
├── domain/                         # Layer 3: 领域层
│   └── usecase/                    # 业务用例
│       └── LoadHomeDataUseCase.ets #   首页数据编排
│
├── presentation/                   # Layer 4: 展示层
│   ├── components/                 # 复杂组件（自带生命周期 + 数据闭环）
│   │   ├── CardSwiper.ets          #   卡片轮播复杂组件
│   │   └── FunctionGrid.ets        #   功能宫格复杂组件
│   └── pages/                      # 页面（NavDestination）
│       └── HomePage.ets            #   首页
│
└── Index.ets                       # HAR 模块导出入口
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
| Module 目录 | snake_case | `wallet_home/`、`card_management/` |
| 层级目录 | 固定名称 | `shared/`、`data/`、`domain/`、`presentation/` |
| 子目录 | 固定名称 | `client/`、`constant/`、`components/`、`utils/`、`model/`、`repository/`、`usecase/`、`pages/` |
| 文件名 | PascalCase | `CardInfo.ets`、`CardRepository.ets`、`HomePage.ets` |

### 3.2 标识符命名

| 类别 | 风格 | 示例 |
|------|------|------|
| struct（组件） | PascalCase | `CardSwiper`、`FunctionGrid` |
| interface | PascalCase | `CardInfo`、`ApiResponse` |
| class | PascalCase | `CardRepository`、`LoadHomeDataUseCase` |
| 函数/方法 | camelCase | `getCardList()`、`formatCardNumber()` |
| 变量 | camelCase | `cardList`、`isLoading` |
| 常量 | UPPER_SNAKE_CASE | `MAX_CARD_COUNT`、`API_TIMEOUT_MS` |
| 枚举类型 | PascalCase | `CardType` |
| 枚举值 | PascalCase | `CardType.BankCard` |

### 3.3 各层文件命名后缀约定

| 层/子目录 | 后缀约定 | 示例 |
|-----------|----------|------|
| shared/client | `ApiClient` 或 `Api` | `HomeApiClient.ets` |
| shared/constant | `Constants` 或 `Types` | `HomeConstants.ets`、`HomeTypes.ets` |
| shared/components | 语义命名（无特定后缀） | `BaseCardView.ets`、`IconButton.ets` |
| shared/utils | `Utils` | `FormatUtils.ets`、`NumberUtils.ets` |
| data/model | 语义命名（数据实体名） | `CardInfo.ets`、`BannerInfo.ets` |
| data/repository | `Repository` | `CardRepository.ets` |
| domain/usecase | `UseCase` | `LoadHomeDataUseCase.ets` |
| presentation/components | 语义命名（功能描述） | `CardSwiper.ets`、`PaymentBar.ets` |
| presentation/pages | `Page` 后缀（推荐） | `HomePage.ets`、`CardDetailPage.ets` |

---

## 4. 各层编码规范

### 4.1 shared/client — 端云请求

```typescript
// shared/client/HomeApiClient.ets

export interface GetCardListRequest {
  userId: string
  pageSize?: number
}

export interface GetCardListResponse {
  cards: CardDto[]
  total: number
}

export interface CardDto {
  id: string
  bankName: string
  cardNumber: string
  cardType: string
}

export class HomeApiClient {
  static async getCardList(request: GetCardListRequest): Promise<GetCardListResponse> {
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
  static readonly CARD_SWIPER_ANIMATION_DURATION_MS = 300
}
```

```typescript
// shared/constant/HomeTypes.ets

export enum CardType {
  BankCard = 'BANK_CARD',
  TransitCard = 'TRANSIT_CARD',
  AccessCard = 'ACCESS_CARD',
  MemberCard = 'MEMBER_CARD'
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
// shared/components/BaseCardView.ets

@Component
export struct BaseCardView {
  @Prop cardColor: ResourceColor = $r('app.color.card_default_bg')
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
    .backgroundColor(this.cardColor)
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
// data/model/CardInfo.ets

import { CardType } from '../../shared/constant/HomeTypes'

export class CardInfo {
  id: string = ''
  bankName: string = ''
  cardNumber: string = ''
  cardType: CardType = CardType.BankCard
  backgroundColor: string = '#1A73E8'

  get maskedNumber(): string {
    if (this.cardNumber.length < 4) return this.cardNumber
    return `**** **** **** ${this.cardNumber.slice(-4)}`
  }

  get shortBankName(): string {
    return this.bankName.length > 4 ? this.bankName.substring(0, 4) : this.bankName
  }
}
```

**规则**：
- 使用 `class`（而非 interface）承载业务模型，以支持内聚方法
- 需要被 `@ObjectLink` 引用的 class 加 `@Observed` 装饰
- 内聚方法只做**数据本身的转换/计算**，不涉及外部依赖

### 4.5 data/repository — 数据仓库

```typescript
// data/repository/CardRepository.ets

import { CardInfo } from '../model/CardInfo'
import { HomeApiClient, GetCardListResponse, CardDto } from '../../shared/client/HomeApiClient'
import { hilog } from '@kit.PerformanceAnalysisKit'

const TAG = 'CardRepository'
const DOMAIN = 0x0001

export class CardRepository {
  private static cardCache: CardInfo[] = []

  static async getCards(userId: string): Promise<CardInfo[]> {
    try {
      const response = await HomeApiClient.getCardList({ userId })
      CardRepository.cardCache = response.cards.map(dto => CardRepository.mapToModel(dto))
      return CardRepository.cardCache
    } catch (error) {
      hilog.error(DOMAIN, TAG, 'Failed to get cards: %{public}s',
        error instanceof Error ? error.message : String(error))
      return CardRepository.cardCache  // 降级返回缓存
    }
  }

  static getCachedCards(): CardInfo[] {
    return CardRepository.cardCache
  }

  static async deleteCard(cardId: string): Promise<boolean> {
    CardRepository.cardCache = CardRepository.cardCache.filter(c => c.id !== cardId)
    return true
  }

  private static mapToModel(dto: CardDto): CardInfo {
    const card = new CardInfo()
    card.id = dto.id
    card.bankName = dto.bankName
    card.cardNumber = dto.cardNumber
    return card
  }
}
```

**规则**：
- 体现**数据所有权**——某类数据的所有增删改查集中在一个 Repository
- 负责 DTO → Model 的转换（Mapper 逻辑）
- 可持有缓存，提供降级策略
- **不得**包含 UI 逻辑或直接引用组件

### 4.6 domain/usecase — 业务用例

```typescript
// domain/usecase/LoadHomeDataUseCase.ets

import { CardInfo } from '../../data/model/CardInfo'
import { BannerInfo } from '../../data/model/BannerInfo'
import { CardRepository } from '../../data/repository/CardRepository'
import { BannerRepository } from '../../data/repository/BannerRepository'

export interface HomePageData {
  cards: CardInfo[]
  banners: BannerInfo[]
  unreadMessageCount: number
}

export class LoadHomeDataUseCase {
  static async execute(userId: string): Promise<HomePageData> {
    // 并行请求多个数据源
    const [cards, banners] = await Promise.all([
      CardRepository.getCards(userId),
      BannerRepository.getBanners()
    ])

    return {
      cards,
      banners,
      unreadMessageCount: 0  // 模拟
    }
  }
}
```

**规则**：
- 编排**多个 Repository**，提供高层业务逻辑
- 一个 UseCase 对应一个具体业务动作（命名体现意图）
- **不得**包含 UI 逻辑
- 可调用多个 data 层仓库，但不直接调用 shared/client

### 4.7 presentation/components — 复杂组件

```typescript
// presentation/components/CardSwiper.ets

import { CardInfo } from '../../data/model/CardInfo'
import { CardRepository } from '../../data/repository/CardRepository'

@Component
export struct CardSwiper {
  @State cards: CardInfo[] = []
  @State currentIndex: number = 0
  @State isLoading: boolean = true

  onCardSelected?: (card: CardInfo) => void

  aboutToAppear(): void {
    this.loadCards()
  }

  private async loadCards(): Promise<void> {
    this.isLoading = true
    try {
      this.cards = await CardRepository.getCards('mock_user')
    } finally {
      this.isLoading = false
    }
  }

  build() {
    Column() {
      if (this.isLoading) {
        // 加载态
        LoadingProgress().width(32).height(32)
      } else if (this.cards.length === 0) {
        // 空态引导
        this.EmptyGuide()
      } else {
        this.CardSwiperContent()
      }
    }
    .width('100%')
  }

  @Builder
  private CardSwiperContent() {
    Swiper() {
      ForEach(this.cards, (card: CardInfo) => {
        // 卡片渲染
      }, (card: CardInfo) => card.id)
    }
    .index(this.currentIndex)
    .onChange((index: number) => { this.currentIndex = index })
  }

  @Builder
  private EmptyGuide() {
    Column() {
      Text($r('app.string.add_first_card'))
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
// presentation/pages/HomePage.ets

import { CardSwiper } from '../components/CardSwiper'
import { FunctionGrid } from '../components/FunctionGrid'

@Builder
export function homePageBuilder() {
  HomePage()
}

@Component
struct HomePage {
  build() {
    NavDestination() {
      Scroll() {
        Column({ space: 12 }) {
          CardSwiper()
          FunctionGrid()
        }
        .width('100%')
      }
      .scrollBar(BarState.Off)
    }
    .title($r('app.string.home_title'))
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

## 5. HAR 模块导出规范

每个 HAR 模块的根目录有一个 `Index.ets`，控制对外暴露的 API：

```typescript
// wallet_home/src/main/ets/Index.ets

// 导出页面 Builder（供 phone 模块路由使用）
export { homePageBuilder } from './presentation/pages/HomePage'

// 导出需要跨模块共享的类型
export { CardInfo } from './data/model/CardInfo'
export { CardType } from './shared/constant/HomeTypes'

// 不导出的内容为模块私有：Repository、UseCase、内部组件等
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
Text('暂无卡片')

// ✅ 正确
Text($r('app.string.no_cards_hint'))
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

// 2. 跨模块引用（通过 HAR 的 Index.ets 导出）
import { CardInfo, CardType } from '@wallet_home'

// 3. 模块内引用（使用相对路径，遵循层间依赖方向）
import { CardInfo } from '../../data/model/CardInfo'
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
