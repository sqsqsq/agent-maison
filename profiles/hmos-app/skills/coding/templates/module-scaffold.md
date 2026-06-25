# 模块脚手架规范

> 定义新模块（HAR/HSP/HAP）的标准文件结构和各层的样板代码模板。
>
> **模板说明**：本模板以示例命名空间（`@demoapp/{module_name}`、`@demoapp/common`、`@demoapp/task_shell` 等）演示填法；实际使用请按你自己工程的 npm scope 和模块名替换。

---

## 1. 新建 HAR/HSP 库模块的完整文件结构

```
{module_name}/
├── build-profile.json5
├── hvigorfile.ts
├── oh-package.json5
├── src/
│   └── main/
│       ├── module.json5
│       ├── ets/
│       │   ├── shared/
│       │   │   ├── client/
│       │   │   ├── constant/
│       │   │   ├── components/
│       │   │   └── utils/
│       │   ├── data/
│       │   │   ├── model/
│       │   │   └── repository/
│       │   ├── domain/
│       │   │   └── usecase/
│       │   ├── presentation/
│       │   │   ├── components/
│       │   │   └── pages/
│       │   └── Index.ets            # 模块导出入口
│       └── resources/
│           ├── base/
│           │   ├── element/
│           │   │   ├── string.json
│           │   │   ├── color.json
│           │   │   └── float.json
│           │   ├── media/
│           │   └── profile/
│           ├── dark/
│           │   └── element/
│           │       └── color.json
│           └── zh_CN/
│               └── element/
│                   └── string.json
```

---

## 2. 模块配置文件模板

### oh-package.json5（模块包描述）

```json5
{
  "name": "@demoapp/{module_name}",
  "version": "1.0.0",
  "description": "{模块用途描述}",
  "main": "Index.ets",
  "author": "",
  "license": "Apache-2.0",
  "dependencies": {
    // 声明依赖的其他模块
    "@demoapp/common": "file:../common"
  }
}
```

### build-profile.json5（模块构建配置）

```json5
{
  "apiType": "stageMode",
  "buildOption": {
  },
  "targets": [
    {
      "name": "default",
      "applyToProducts": [
        "default"
      ]
    }
  ]
}
```

### module.json5（模块元数据）

```json5
{
  "module": {
    "name": "{module_name}",
    "type": "har",
    "deviceTypes": [
      "phone"
    ]
  }
}
```

### hvigorfile.ts

```typescript
import { harTasks } from '@ohos/hvigor-ohos-plugin'

export default {
  system: harTasks,
  plugins: []
}
```

### 根目录注册

在根目录 `build-profile.json5` 的 `modules` 数组中添加：

```json5
{
  "name": "{module_name}",
  "srcPath": "./{module_name}",
  "targets": [
    {
      "name": "default",
      "applyToProducts": [ "default" ]
    }
  ]
}
```

在根目录 `oh-package.json5` 的 `dependencies` 中添加（若 phone 需依赖此模块）：

```json5
"@demoapp/{module_name}": "file:./{module_name}"
```

---

## 3. 模块导出入口 (Index.ets)

```typescript
// {module_name}/src/main/ets/Index.ets

// 导出页面 Builder（供 phone 模块 Navigation 路由使用）
export { homePageBuilder } from './presentation/pages/HomePage'

// 导出需要跨模块复用的数据类型
export { ItemSummary } from './data/model/ItemSummary'

// 导出需要跨模块复用的枚举/常量
export { CategoryKind } from './shared/constant/HomeTypes'

// 导出需要跨模块复用的基础组件
export { BaseListTile } from './shared/components/BaseListTile'

// ⚠️ 不导出模块私有内容（Repository、UseCase、内部组件等）
```

**原则**：最小化导出，只暴露其他模块**必须**使用的内容。

---

## 4. Layer 1: shared 层模板

### shared/client — 端云请求

```typescript
// shared/client/XxxApiClient.ets

/**
 * Xxx 模块的端云接口定义
 */

// 请求体
export interface GetXxxListRequest {
  userId: string
  pageIndex?: number
  pageSize?: number
}

// 响应体
export interface GetXxxListResponse {
  items: XxxDto[]
  total: number
  hasMore: boolean
}

// 传输对象（DTO）
export interface XxxDto {
  id: string
  name: string
  type: string
  // ... 与服务端契约一致的字段
}

// 接口实现
export class XxxApiClient {
  /**
   * 获取列表（模拟实现）
   */
  static async getList(request: GetXxxListRequest): Promise<GetXxxListResponse> {
    // 模拟网络延迟
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    // 返回模拟数据
    return {
      items: XxxApiClient.getMockItems(),
      total: 3,
      hasMore: false
    }
  }

  private static getMockItems(): XxxDto[] {
    return [
      { id: '1', name: '示例1', type: 'A' },
      { id: '2', name: '示例2', type: 'B' }
    ]
  }
}
```

### shared/constant — 常量与类型

```typescript
// shared/constant/XxxConstants.ets

export class XxxConstants {
  static readonly MAX_ITEM_COUNT = 20
  static readonly REFRESH_INTERVAL_MS = 60_000
  static readonly ANIMATION_DURATION_MS = 300
}
```

```typescript
// shared/constant/XxxTypes.ets

export enum XxxType {
  TypeA = 'TYPE_A',
  TypeB = 'TYPE_B'
}

export enum XxxStatus {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE'
}
```

### shared/components — 基础 UI 组件

```typescript
// shared/components/XxxBaseView.ets

@Component
export struct XxxBaseView {
  // 外观配置（通过 @Prop 接收，不含业务语义）
  @Prop backgroundColor: ResourceColor = Color.White
  @Prop cornerRadius: number = 8

  // 内容插槽
  @BuilderParam content: () => void

  build() {
    Column() {
      if (this.content) {
        this.content()
      }
    }
    .width('100%')
    .backgroundColor(this.backgroundColor)
    .borderRadius(this.cornerRadius)
  }
}
```

**要点**：
- 纯 UI，不含业务逻辑
- 通过 `@Prop` 接收外观配置
- 通过 `@BuilderParam` 接收内容
- 不得引用 data/domain/presentation 层

### shared/utils — 工具函数

```typescript
// shared/utils/XxxUtils.ets

/**
 * 掩码长标识符，仅保留末尾若干位用于展示
 * '6222021234567890' → '**** **** **** 7890'
 */
export function maskIdentifierTail(raw: string): string {
  if (raw.length < 4) return raw
  return `**** **** **** ${raw.slice(-4)}`
}

/**
 * 格式化金额
 * 12345.6 → '12,345.60'
 */
export function formatAmount(amount: number): string {
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
```

---

## 5. Layer 2: data 层模板

### data/model — 业务数据模型

```typescript
// data/model/XxxInfo.ets

import { XxxType } from '../../shared/constant/XxxTypes'

/**
 * 需要被 @ObjectLink 引用时，加 @Observed
 */
@Observed
export class XxxInfo {
  id: string = ''
  name: string = ''
  type: XxxType = XxxType.TypeA
  createdAt: number = 0

  // 内聚方法：只做数据自身的计算/转换
  get displayName(): string {
    return `[${this.type}] ${this.name}`
  }

  get isActive(): boolean {
    return Date.now() - this.createdAt < 86400_000  // 24小时内创建视为活跃
  }
}
```

### data/repository — 数据仓库

```typescript
// data/repository/XxxRepository.ets

import { XxxInfo } from '../model/XxxInfo'
import { XxxApiClient, XxxDto } from '../../shared/client/XxxApiClient'
import { hilog } from '@kit.PerformanceAnalysisKit'

const TAG = 'XxxRepository'
const DOMAIN = 0x0001

/**
 * XxxInfo 数据的唯一所有者
 * 所有对 Xxx 数据的增删改查都必须通过本类
 */
export class XxxRepository {
  private static cache: XxxInfo[] = []

  /** 获取列表 */
  static async getAll(userId: string): Promise<XxxInfo[]> {
    try {
      const response = await XxxApiClient.getList({ userId })
      XxxRepository.cache = response.items.map(XxxRepository.mapToModel)
      return XxxRepository.cache
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'Fetch failed, returning cache: %{public}s',
        error instanceof Error ? error.message : String(error))
      return XxxRepository.cache
    }
  }

  /** 按 ID 查找 */
  static getById(id: string): XxxInfo | undefined {
    return XxxRepository.cache.find(item => item.id === id)
  }

  /** 删除 */
  static async delete(id: string): Promise<boolean> {
    XxxRepository.cache = XxxRepository.cache.filter(item => item.id !== id)
    return true
  }

  /** DTO → Model 转换 */
  private static mapToModel(dto: XxxDto): XxxInfo {
    const model = new XxxInfo()
    model.id = dto.id
    model.name = dto.name
    return model
  }
}
```

---

## 6. Layer 3: domain 层模板（v2.1：条件性产出）

> **v2.1 原则**：业务编排层是**概念**，不强制落在 `domain/usecase/` 目录。仅当 feature 满足"多 UI 共享状态 / 多步云调用 / 含回滚分支"任一条件时产出 `use-cases.yaml` 规约，代码落地形态由本 Skill 按复杂度自选（详见 `coding-standards.md` 4.6 节）。下面示例采用形态 C（导出命名函数，适合无状态流程）；形态 B（独立业务类 Flow/Coordinator，适合多步状态机）请参考 `` `profile-skill-asset:business-ut/sample_flow_dir` `` 下的 `TaskSubmitFlow.ets`。

### 形态 C 示例：domain/actions — 导出命名函数

```typescript
// domain/actions/doSomething.ets（或 shared/actions/；不强制 domain/usecase/）

import { XxxInfo } from '../../data/model/XxxInfo'
import { XxxRepository } from '../../data/repository/XxxRepository'
import { AnotherRepository } from '../../data/repository/AnotherRepository'
import { hilog } from '@kit.PerformanceAnalysisKit'

const TAG = 'doSomething'
const DOMAIN = 0x0001

export interface DoSomethingResult {
  items: XxxInfo[]
  summary: string
  success: boolean
}

/**
 * 命名导出函数（UT 可直接 await 调用），命名体现业务意图：动词 + 名词
 * - 必须是 export function / export const 形式，不可藏在 inline lambda 里
 * - 不得 import 任何 UI 符号，以便脱离 ArkUI runtime 单元测试
 */
export async function doSomething(userId: string): Promise<DoSomethingResult> {
  try {
    const [xxxList, anotherData] = await Promise.all([
      XxxRepository.getAll(userId),
      AnotherRepository.getData()
    ])

    const processedList = xxxList.filter(item => item.isActive)

    return {
      items: processedList,
      summary: `共 ${processedList.length} 条活跃数据`,
      success: true
    }
  } catch (error) {
    hilog.error(DOMAIN, TAG, 'doSomething failed: %{public}s',
      error instanceof Error ? error.message : String(error))
    return { items: [], summary: '加载失败', success: false }
  }
}
```

---

## 7. Layer 4: presentation 层模板

### presentation/components — 复杂组件

```typescript
// presentation/components/XxxPanel.ets

import { XxxInfo } from '../../data/model/XxxInfo'
import { doSomething, DoSomethingResult } from '../../domain/actions/doSomething'

/**
 * 复杂组件：自带生命周期，完成数据加载→渲染→交互的完整闭环
 */
@Component
export struct XxxPanel {
  // 内部状态
  @State items: XxxInfo[] = []
  @State isLoading: boolean = true
  @State errorMessage: string = ''

  // 对外通信回调
  onItemSelected?: (item: XxxInfo) => void

  // 生命周期
  aboutToAppear(): void {
    this.loadData()
  }

  aboutToDisappear(): void {
    // 清理定时器、取消订阅等
  }

  // 业务方法
  private async loadData(): Promise<void> {
    this.isLoading = true
    this.errorMessage = ''
    try {
      const result = await doSomething('mock_user')
      this.items = result.items
      if (!result.success) {
        this.errorMessage = result.summary
      }
    } catch (error) {
      this.errorMessage = '加载失败，请重试'
    } finally {
      this.isLoading = false
    }
  }

  // UI
  build() {
    Column() {
      if (this.isLoading) {
        this.LoadingState()
      } else if (this.errorMessage) {
        this.ErrorState()
      } else if (this.items.length === 0) {
        this.EmptyState()
      } else {
        this.ContentState()
      }
    }
    .width('100%')
  }

  @Builder
  private LoadingState() {
    Column() {
      LoadingProgress().width(32).height(32)
    }
    .width('100%')
    .height(120)
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  private ErrorState() {
    Column({ space: 8 }) {
      Text(this.errorMessage)
        .fontSize(14)
        .fontColor($r('app.color.text_secondary'))
      Button($r('app.string.retry'))
        .onClick(() => this.loadData())
    }
    .width('100%')
    .height(120)
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  private EmptyState() {
    Column() {
      Text($r('app.string.empty_hint'))
        .fontSize(14)
        .fontColor($r('app.color.text_placeholder'))
    }
    .width('100%')
    .height(120)
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  private ContentState() {
    List({ space: 8 }) {
      ForEach(this.items, (item: XxxInfo) => {
        ListItem() {
          Text(item.displayName)
            .onClick(() => this.onItemSelected?.(item))
        }
      }, (item: XxxInfo) => item.id)
    }
    .width('100%')
  }
}
```

### presentation/pages — 页面 (NavDestination)

```typescript
// presentation/pages/XxxPage.ets

import { XxxPanel } from '../components/XxxPanel'

/**
 * 导出 Builder 函数，供 Navigation 路由系统使用
 */
@Builder
export function xxxPageBuilder() {
  XxxPage()
}

/**
 * 页面 = 基础组件 + 复杂组件的聚合
 * 基于 NavDestination 实现，本身是个大号复杂组件
 */
@Component
struct XxxPage {
  build() {
    NavDestination() {
      Scroll() {
        Column({ space: 16 }) {
          // 聚合多个复杂组件
          XxxPanel({
            onItemSelected: (item) => {
              // 处理子组件的交互事件
            }
          })
        }
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 16 })
      }
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
    .title($r('app.string.xxx_page_title'))
    .hideTitleBar(false)
  }
}
```

---

## 8. phone 模块主入口模板

```typescript
// phone/src/main/ets/presentation/pages/Index.ets

import { homePageBuilder } from '@demoapp/task_shell'
// import { featureGridPageBuilder } from '@demoapp/feature_grid'

@Entry
@Component
struct Index {
  @State currentIndex: number = 0
  private pageStack: NavPathStack = new NavPathStack()

  @Builder
  PageMap(name: string) {
    if (name === 'home') {
      homePageBuilder()
    }
    // else if (name === 'feature_grid') {
    //   featureGridPageBuilder()
    // }
  }

  build() {
    Navigation(this.pageStack) {
      Tabs({ barPosition: BarPosition.End }) {
        TabContent() {
          homePageBuilder()
        }
        .tabBar(this.TabBarItem($r('app.string.tab_home'),
          $r('app.media.ic_home'), $r('app.media.ic_home_active'), 0))

        // ... 更多 Tab
      }
      .barHeight(56)
      .scrollable(false)
      .onChange((index: number) => { this.currentIndex = index })
    }
    .navDestination(this.PageMap)
    .hideTitleBar(true)
  }

  @Builder
  TabBarItem(title: ResourceStr, icon: Resource, activeIcon: Resource, index: number) {
    Column({ space: 4 }) {
      Image(this.currentIndex === index ? activeIcon : icon)
        .width(24).height(24)
      Text(title)
        .fontSize(10)
        .fontColor(this.currentIndex === index
          ? $r('app.color.tab_active')
          : $r('app.color.tab_inactive'))
    }
    .width('100%')
    .justifyContent(FlexAlign.Center)
    .padding({ top: 6, bottom: 6 })
  }
}
```

---

## 9. 新模块接入检查清单

```
模块配置
  [ ] oh-package.json5 — 包名、依赖声明
  [ ] build-profile.json5 — 构建配置
  [ ] module.json5 — type: "har"
  [ ] hvigorfile.ts — harTasks
  [ ] 根目录 build-profile.json5 已注册模块
  [ ] 根目录 oh-package.json5 已添加依赖（需要时）

分层完整性
  [ ] shared/ 目录及子目录已创建
  [ ] data/ 目录及子目录已创建
  [ ] domain/ 目录及子目录已创建
  [ ] presentation/ 目录及子目录已创建
  [ ] Index.ets 已创建并导出必要 API

代码质量
  [ ] 无反向依赖（shared 不引用 data/domain/presentation）
  [ ] 模块间无循环依赖
  [ ] 所有 import 路径正确
  [ ] 资源文件（string/color/float）已配置
  [ ] NavDestination 页面已注册到路由
  [ ] ReadLints 检查通过（0 error）
```
