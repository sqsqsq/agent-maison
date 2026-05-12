# ArkUI 组件模式速查

> 常用 ArkUI 组件的最佳实践模式，适配 NavDestination + 4 层架构。

---

## 1. Navigation + NavDestination（应用路由框架）

### phone 主入口（唯一 @Entry）

```typescript
// phone 模块 — 全局路由容器
@Entry
@Component
struct Index {
  private pageStack: NavPathStack = new NavPathStack()

  @Builder
  PageMap(name: string) {
    if (name === 'cardDetail') {
      cardDetailPageBuilder()
    } else if (name === 'paymentCode') {
      paymentCodePageBuilder()
    }
  }

  build() {
    Navigation(this.pageStack) {
      // 首页内容（Tabs 或直接放首页）
    }
    .navDestination(this.PageMap)
    .hideTitleBar(true)
  }
}
```

### 功能模块页面（NavDestination）

```typescript
// 功能模块内的页面 — 不使用 @Entry
@Builder
export function cardDetailPageBuilder() {
  CardDetailPage()
}

@Component
struct CardDetailPage {
  // 通过 NavPathStack 获取参数
  @Consume('pageStack') pageStack: NavPathStack

  build() {
    NavDestination() {
      Column() {
        // 页面内容
      }
    }
    .title($r('app.string.card_detail_title'))
    .onReady((context: NavDestinationContext) => {
      // 获取路由参数
      const params = context.pathInfo.param as Record<string, Object>
    })
    .onBackPressed(() => {
      this.pageStack.pop()
      return true
    })
  }
}
```

### 路由跳转

```typescript
// 跳转到新页面
this.pageStack.pushPath({ name: 'cardDetail', param: { cardId: '123' } })

// 替换当前页
this.pageStack.replacePath({ name: 'paymentCode' })

// 返回
this.pageStack.pop()

// 返回到指定页
this.pageStack.popToName('home')

// 清空栈
this.pageStack.clear()
```

### 系统路由表配置（route_map.json）

```json
{
  "routerMap": [
    {
      "name": "home",
      "pageSourceFile": "src/main/ets/presentation/pages/HomePage.ets",
      "buildFunction": "homePageBuilder"
    },
    {
      "name": "cardDetail",
      "pageSourceFile": "src/main/ets/presentation/pages/CardDetailPage.ets",
      "buildFunction": "cardDetailPageBuilder"
    }
  ]
}
```

---

## 2. 复杂组件模式（presentation/components）

### 标准复杂组件骨架

复杂组件自带生命周期，完成「用户操作 → 逻辑执行 → 数据变更 → UI 刷新」闭环：

```typescript
@Component
export struct XxxPanel {
  // ① 自有状态
  @State items: ItemInfo[] = []
  @State isLoading: boolean = true
  @State errorMsg: string = ''

  // ② 来自上层的配置（可选）
  @Prop maxDisplayCount: number = 10

  // ③ 向上通信回调
  onAction?: (action: string, data: Object) => void

  // ④ 内部资源
  private refreshTimer: number = -1

  // ⑤ 生命周期
  aboutToAppear(): void {
    this.loadData()
    this.startAutoRefresh()
  }

  aboutToDisappear(): void {
    clearInterval(this.refreshTimer)
  }

  // ⑥ 业务逻辑（调用 domain/data 层）
  private async loadData(): Promise<void> {
    this.isLoading = true
    try {
      this.items = await SomeRepository.getItems()
    } catch (e) {
      this.errorMsg = '加载失败'
    } finally {
      this.isLoading = false
    }
  }

  private startAutoRefresh(): void {
    this.refreshTimer = setInterval(() => {
      this.loadData()
    }, 60_000)
  }

  private handleUserAction(item: ItemInfo): void {
    // 用户操作 → 数据变更
    SomeRepository.markAsRead(item.id)
    // 通知上层
    this.onAction?.('itemClicked', item)
  }

  // ⑦ Builder 和 build
  build() {
    Column() {
      if (this.isLoading) {
        LoadingProgress().width(32).height(32)
      } else if (this.errorMsg) {
        this.ErrorView()
      } else {
        this.ContentView()
      }
    }
    .width('100%')
  }

  @Builder private ErrorView() { /* ... */ }
  @Builder private ContentView() { /* ... */ }
}
```

### 复杂组件 vs 基础组件对比

| 维度 | 基础组件 (shared/components) | 复杂组件 (presentation/components) |
|------|-----|-----|
| 所在层 | shared | presentation |
| 业务逻辑 | 无 | 有（调用 domain/data） |
| 生命周期 | 通常不使用 | 必须处理 aboutToAppear/Disappear |
| 数据来源 | 仅通过 @Prop/@Link 接收 | 自主从 Repository/UseCase 获取 |
| 状态管理 | 无或极少 @State | 完整的多状态管理 |
| 依赖 | 无业务依赖 | 依赖 data/domain 层 |

---

## 3. 布局容器

### Column（垂直布局）

```typescript
Column({ space: 12 }) {
  Text('标题')
  Text('内容')
}
.width('100%')
.padding({ left: 16, right: 16 })
.alignItems(HorizontalAlign.Start)
```

### Row（水平布局）

```typescript
Row({ space: 8 }) {
  Image($r('app.media.icon'))
    .width(24).height(24)
  Text('标签')
    .layoutWeight(1)
  Image($r('app.media.arrow_right'))
    .width(16).height(16)
}
.width('100%')
.height(56)
.padding({ left: 16, right: 16 })
```

### Stack（层叠布局 — 红点/徽标场景）

```typescript
Stack({ alignContent: Alignment.TopEnd }) {
  Image($r('app.media.avatar'))
    .width(48).height(48)
  Circle()
    .width(8).height(8)
    .fill($r('app.color.badge_red'))
}
```

---

## 4. Tabs 底部导航（仅 phone 主入口）

```typescript
@Entry
@Component
struct Index {
  @State currentIndex: number = 0

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

  build() {
    Tabs({ barPosition: BarPosition.End }) {
      TabContent() {
        // 来自 task_shell HAR 模块
        homePageBuilder()
      }
      .tabBar(this.TabBarItem(
        $r('app.string.tab_home'),
        $r('app.media.ic_home'),
        $r('app.media.ic_home_active'), 0))

      TabContent() {
        // 来自 card_management HAR 模块
        cardsPageBuilder()
      }
      .tabBar(this.TabBarItem(
        $r('app.string.tab_cards'),
        $r('app.media.ic_cards'),
        $r('app.media.ic_cards_active'), 1))

      // ... 更多 Tab
    }
    .barHeight(56)
    .scrollable(false)
    .onChange((index: number) => { this.currentIndex = index })
  }
}
```

---

## 5. Swiper 轮播

### 卡片轮播（复杂组件内使用）

```typescript
Swiper() {
  ForEach(this.cardList, (card: CardInfo) => {
    this.CardItem(card)
  }, (card: CardInfo) => card.id)
}
.index(this.currentCardIndex)
.autoPlay(false)
.indicator(
  Indicator.dot()
    .itemWidth(6).itemHeight(6)
    .selectedItemWidth(12).selectedItemHeight(6)
    .color($r('app.color.indicator_inactive'))
    .selectedColor($r('app.color.indicator_active'))
)
.loop(false)
.onChange((index: number) => { this.currentCardIndex = index })
```

### Banner 自动轮播

```typescript
Swiper() {
  ForEach(this.bannerList, (banner: BannerInfo) => {
    Image(banner.imageRes)
      .width('100%').height(120)
      .borderRadius(8)
      .objectFit(ImageFit.Cover)
      .onClick(() => this.onBannerClick(banner))
  }, (banner: BannerInfo) => banner.id)
}
.autoPlay(true)
.interval(3000)
.indicator(Indicator.dot().bottom(8))
```

---

## 6. Grid 宫格

```typescript
Grid() {
  ForEach(this.gridItems, (item: GridItemConfig) => {
    GridItem() {
      Column({ space: 4 }) {
        Image(item.icon).width(32).height(32)
        Text(item.title)
          .fontSize(12)
          .fontColor($r('app.color.text_primary'))
      }
      .width('100%').height('100%')
      .justifyContent(FlexAlign.Center)
    }
    .onClick(() => {
      this.pageStack.pushPath({ name: item.routePath })
    })
  }, (item: GridItemConfig) => item.id)
}
.columnsTemplate('1fr 1fr 1fr 1fr')
.rowsTemplate('1fr 1fr')
.width('100%')
.height(160)
```

---

## 7. List 列表

### 基础列表

```typescript
List({ space: 1 }) {
  ForEach(this.items, (item: ItemInfo) => {
    ListItem() {
      Row() { /* 列表项内容 */ }
        .width('100%').height(64)
        .padding({ left: 16, right: 16 })
    }
  }, (item: ItemInfo) => item.id)
}
.divider({
  strokeWidth: 0.5,
  color: $r('app.color.divider'),
  startMargin: 16, endMargin: 16
})
```

### 长列表（LazyForEach + IDataSource）

```typescript
// data 层定义 DataSource
export class ItemDataSource implements IDataSource {
  private data: ItemInfo[] = []
  private listeners: DataChangeListener[] = []

  totalCount(): number { return this.data.length }
  getData(index: number): ItemInfo { return this.data[index] }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) this.listeners.push(listener)
  }
  unregisterDataChangeListener(listener: DataChangeListener): void {
    const i = this.listeners.indexOf(listener)
    if (i >= 0) this.listeners.splice(i, 1)
  }

  setData(data: ItemInfo[]): void {
    this.data = data
    this.listeners.forEach(l => l.onDataReloaded())
  }
}

// presentation 层使用
List() {
  LazyForEach(this.dataSource, (item: ItemInfo) => {
    ListItem() { /* ... */ }
  }, (item: ItemInfo) => item.id)
}
.cachedCount(5)
```

---

## 8. Scroll + Refresh（下拉刷新）

```typescript
@State isRefreshing: boolean = false

build() {
  Refresh({ refreshing: $$this.isRefreshing }) {
    Scroll() {
      Column({ space: 12 }) {
        // 聚合多个复杂组件
        CardSwiperPanel()
        FunctionGridPanel()
        BannerPanel()
      }
      .width('100%')
      .padding({ bottom: 16 })
    }
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
  }
  .onRefreshing(async () => {
    await this.reloadAllData()
    this.isRefreshing = false
  })
}
```

---

## 9. 弹窗与浮层

### CustomDialog（复杂弹窗）

```typescript
@CustomDialog
struct CardActionDialog {
  controller: CustomDialogController
  cardInfo: CardInfo = new CardInfo()
  onAction?: (action: string) => void

  build() {
    Column({ space: 0 }) {
      Text($r('app.string.card_actions'))
        .fontSize(18).fontWeight(FontWeight.Bold).padding(16)
      this.ActionRow($r('app.string.view_detail'), 'detail')
      this.ActionRow($r('app.string.set_default'), 'default')
      this.ActionRow($r('app.string.delete_card'), 'delete')
      Button($r('app.string.cancel'))
        .width('100%').margin({ top: 8 })
        .onClick(() => this.controller.close())
    }
    .padding(16)
  }

  @Builder
  private ActionRow(text: ResourceStr, action: string) {
    Row() {
      Text(text).fontSize(16)
    }
    .width('100%').height(48).padding({ left: 16 })
    .onClick(() => {
      this.onAction?.(action)
      this.controller.close()
    })
  }
}

// 使用
private dialogController: CustomDialogController = new CustomDialogController({
  builder: CardActionDialog({
    cardInfo: this.selectedCard,
    onAction: (action) => this.handleCardAction(action)
  }),
  alignment: DialogAlignment.Bottom,
  customStyle: true
})

this.dialogController.open()
```

### promptAction（轻量提示）

```typescript
import { promptAction } from '@kit.ArkUI'

promptAction.showToast({
  message: $r('app.string.operation_success'),
  duration: 2000,
  bottom: 80
})
```

---

## 10. 搜索框

仅做入口（点击跳转到搜索页）：

```typescript
Row() {
  Image($r('app.media.ic_search')).width(16).height(16)
  Text($r('app.string.search_hint'))
    .fontSize(14)
    .fontColor($r('app.color.text_placeholder'))
    .margin({ left: 8 })
}
.width('100%').height(36)
.borderRadius(18)
.backgroundColor($r('app.color.search_bg'))
.padding({ left: 12, right: 12 })
.onClick(() => {
  this.pageStack.pushPath({ name: 'search' })
})
```

---

## 11. Badge 徽标

```typescript
// 数字徽标
Badge({
  count: this.unreadCount,
  position: BadgePosition.RightTop,
  style: { badgeSize: 16, badgeColor: $r('app.color.badge_red'), fontSize: 10 }
}) {
  Image($r('app.media.ic_notification')).width(24).height(24)
}

// 红点（无数字）
Badge({
  value: '',
  position: BadgePosition.RightTop,
  style: { badgeSize: 8, badgeColor: $r('app.color.badge_red') }
}) {
  Image($r('app.media.ic_notification')).width(24).height(24)
}
```

---

## 12. 骨架屏

```typescript
@Component
export struct SkeletonBlock {
  @Prop blockWidth: Length = '100%'
  @Prop blockHeight: Length = 16
  @Prop radius: number = 4

  build() {
    Column()
      .width(this.blockWidth)
      .height(this.blockHeight)
      .borderRadius(this.radius)
      .backgroundColor($r('app.color.skeleton_bg'))
  }
}

// 使用（shared/components 层放置）
@Component
export struct CardSkeleton {
  build() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        SkeletonBlock({ blockWidth: 40, blockHeight: 40, radius: 20 })
        Column({ space: 4 }) {
          SkeletonBlock({ blockWidth: 120, blockHeight: 14 })
          SkeletonBlock({ blockWidth: 80, blockHeight: 12 })
        }.alignItems(HorizontalAlign.Start)
      }.width('100%')
      SkeletonBlock({ blockWidth: '100%', blockHeight: 100, radius: 8 })
    }
    .width('100%').padding(16)
  }
}
```

---

## 13. 动画

### animateTo（显式动画）

```typescript
animateTo({
  duration: 300,
  curve: Curve.EaseInOut,
  onFinish: () => { /* 完成回调 */ }
}, () => {
  this.isExpanded = !this.isExpanded
})
```

### 转场动画

```typescript
if (this.isVisible) {
  Column() { /* ... */ }
    .transition({
      type: TransitionType.Insert,
      opacity: 0, translate: { y: 20 }
    })
    .transition({
      type: TransitionType.Delete,
      opacity: 0, translate: { y: -20 }
    })
}
```
