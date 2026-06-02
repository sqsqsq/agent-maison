# 鸿蒙 API 用法速查

> 常用 HarmonyOS API 的用法示例，适配多模块（HAR/HSP/HAP）架构。
>
> **示例说明**：以下代码片段使用演示用模块命名（`@demoapp/*`、`task_shell`、`feature_grid` 等）；实际使用请按你自己工程的模块名替换。

---

## 1. 模块管理

### HAR/HSP 库模块的 oh-package.json5

```json5
{
  "name": "@demoapp/task_shell",
  "version": "1.0.0",
  "description": "示例 Feature 模块",
  "main": "index.ets",
  "author": "",
  "license": "Apache-2.0",
  "dependencies": {
    "@demoapp/common": "file:../common"
  }
}
```

### HAP 模块引用 HAR/HSP 库模块

在 phone 模块的 `oh-package.json5` 中：

```json5
{
  "dependencies": {
    "@demoapp/common": "file:../common",
    "@demoapp/task_shell": "file:../task_shell",
    "@demoapp/feature_grid": "file:../feature_grid"
  }
}
```

代码中引用 HAR/HSP 库模块导出的内容：

```typescript
import { homePageBuilder, ItemSummary } from '@demoapp/task_shell'
import { maskIdentifierTail } from '@demoapp/common'
```

### 根目录 build-profile.json5 注册模块

```json5
{
  "modules": [
    {
      "name": "phone",
      "srcPath": "./phone",
      "targets": [{ "name": "default", "applyToProducts": ["default"] }]
    },
    {
      "name": "common",
      "srcPath": "./common",
      "targets": [{ "name": "default", "applyToProducts": ["default"] }]
    },
    {
      "name": "task_shell",
      "srcPath": "./task_shell",
      "targets": [{ "name": "default", "applyToProducts": ["default"] }]
    }
  ]
}
```

---

## 2. Navigation 路由（NavPathStack）

```typescript
// 全局路由栈（在 phone 主入口注入）
@Provide('pageStack') pageStack: NavPathStack = new NavPathStack()

// 跳转
this.pageStack.pushPath({ name: 'itemDetail', param: { itemId: '123' } })

// 替换
this.pageStack.replacePath({ name: 'checkoutPreview' })

// 返回
this.pageStack.pop()

// 返回到指定页
this.pageStack.popToName('home')

// 清空
this.pageStack.clear()

// 获取栈大小
this.pageStack.size()
```

### NavDestination 页面接收参数

```typescript
@Component
struct ItemDetailPage {
  @State itemId: string = ''

  build() {
    NavDestination() {
      // 页面内容
    }
    .onReady((context: NavDestinationContext) => {
      const params = context.pathInfo.param as Record<string, Object>
      if (params?.itemId) {
        this.itemId = params.itemId as string
      }
    })
  }
}
```

### 系统路由表 (route_map.json)

放在模块的 `src/main/resources/base/profile/route_map.json`：

```json
{
  "routerMap": [
    {
      "name": "home",
      "pageSourceFile": "src/main/ets/presentation/pages/HomePage.ets",
      "buildFunction": "homePageBuilder"
    }
  ]
}
```

在 `module.json5` 中引用：

```json5
{
  "module": {
    "name": "task_shell",
    "type": "har",
    "routerMap": "$profile:route_map"
  }
}
```

---

## 3. 数据持久化

### Preferences（轻量 KV 存储）

```typescript
import { preferences } from '@kit.ArkData'

export class PreferenceUtil {
  private static pref: preferences.Preferences | null = null

  static async init(context: Context): Promise<void> {
    PreferenceUtil.pref = await preferences.getPreferences(context, 'app_prefs')
  }

  static async put(key: string, value: preferences.ValueType): Promise<void> {
    if (!PreferenceUtil.pref) return
    await PreferenceUtil.pref.put(key, value)
    await PreferenceUtil.pref.flush()
  }

  static async get(key: string, defaultValue: preferences.ValueType): Promise<preferences.ValueType> {
    if (!PreferenceUtil.pref) return defaultValue
    return await PreferenceUtil.pref.get(key, defaultValue)
  }

  static async delete(key: string): Promise<void> {
    if (!PreferenceUtil.pref) return
    await PreferenceUtil.pref.delete(key)
    await PreferenceUtil.pref.flush()
  }
}
```

**放置位置**：`common/shared/utils/PreferenceUtil.ets`（全局共享）

### AppStorage（内存级全局状态）

```typescript
// 初始化（Ability onCreate 中）
AppStorage.setOrCreate('isLoggedIn', false)
AppStorage.setOrCreate('userName', '')

// 组件中使用
@StorageLink('isLoggedIn') isLoggedIn: boolean = false    // 双向
@StorageProp('userName') userName: string = ''             // 单向

// 代码中读写
AppStorage.set('isLoggedIn', true)
const isLoggedIn = AppStorage.get<boolean>('isLoggedIn')
```

### PersistentStorage（持久化 + 内存同步）

```typescript
// 应用入口初始化
PersistentStorage.persistProp('theme', 'light')
PersistentStorage.persistProp('defaultItemId', '')

// 组件中自动同步
@StorageLink('theme') theme: string = 'light'
```

---

## 4. 网络请求（HTTP）

```typescript
import { http } from '@kit.NetworkKit'

// 适合放在 shared/client 层

export class HttpUtil {
  static async get<T>(url: string): Promise<T> {
    const httpRequest = http.createHttp()
    try {
      const response = await httpRequest.request(url, {
        method: http.RequestMethod.GET,
        header: { 'Content-Type': 'application/json' },
        connectTimeout: 5000,
        readTimeout: 10000
      })
      if (response.responseCode === http.ResponseCode.OK) {
        return JSON.parse(response.result as string) as T
      }
      throw new Error(`HTTP ${response.responseCode}`)
    } finally {
      httpRequest.destroy()
    }
  }

  static async post<T>(url: string, data: Object): Promise<T> {
    const httpRequest = http.createHttp()
    try {
      const response = await httpRequest.request(url, {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json' },
        extraData: JSON.stringify(data),
        connectTimeout: 5000,
        readTimeout: 10000
      })
      if (response.responseCode === http.ResponseCode.OK) {
        return JSON.parse(response.result as string) as T
      }
      throw new Error(`HTTP ${response.responseCode}`)
    } finally {
      httpRequest.destroy()
    }
  }
}
```

**放置位置**：`common/shared/client/HttpUtil.ets`

---

## 5. 日志（hilog）

```typescript
import { hilog } from '@kit.PerformanceAnalysisKit'

const DOMAIN = 0x0001
const TAG = 'DraftRepository'

hilog.debug(DOMAIN, TAG, 'Debug: %{public}s', someVar)
hilog.info(DOMAIN, TAG, 'Info: %{public}s', someVar)
hilog.warn(DOMAIN, TAG, 'Warning: %{public}s', someVar)
hilog.error(DOMAIN, TAG, 'Error: %{public}s', errorMsg)

// %{public}s — 公开字段（日志工具可见）
// %{private}s — 隐私字段（日志工具中隐藏，敏感信息用）
```

**约定**：每个 class/文件定义自己的 `TAG` 常量，`DOMAIN` 在 `common/shared/constant/` 中统一定义。

---

## 6. 图片

```typescript
// 本地资源
Image($r('app.media.ic_logo'))
  .width(48).height(48)
  .objectFit(ImageFit.Contain)

// 网络图片（需 ohos.permission.INTERNET）
Image('https://example.com/banner.jpg')
  .width('100%').height(120)
  .objectFit(ImageFit.Cover)
  .alt($r('app.media.placeholder'))
  .onError(() => { /* 失败回退 */ })

// SVG 可改色
Image($r('app.media.ic_arrow'))
  .width(16).height(16)
  .fillColor($r('app.color.icon_primary'))
```

---

## 7. 弹窗（promptAction）

```typescript
import { promptAction } from '@kit.ArkUI'

// Toast
promptAction.showToast({
  message: $r('app.string.operation_success'),
  duration: 2000,
  bottom: 80
})

// Dialog
promptAction.showDialog({
  title: $r('app.string.dialog_title'),
  message: $r('app.string.dialog_message'),
  buttons: [
    { text: $r('app.string.cancel'), color: $r('app.color.text_secondary') },
    { text: $r('app.string.confirm'), color: $r('app.color.primary') }
  ]
}).then((result) => {
  if (result.index === 1) { /* 确认 */ }
})
```

---

## 8. 事件通信（Emitter）

```typescript
import { emitter } from '@kit.BasicServicesKit'

// 事件定义（放在 common/shared/constant/ 中）
export class AppEvents {
  static readonly ITEM_UPDATED: emitter.InnerEvent = { eventId: 1001 }
  static readonly USER_LOGGED_IN: emitter.InnerEvent = { eventId: 1002 }
}

// 订阅（在 aboutToAppear 中）
emitter.on(AppEvents.ITEM_UPDATED, (data: emitter.EventData) => {
  const itemId = data?.data?.itemId as string
  this.refreshItem(itemId)
})

// 发送
emitter.emit(AppEvents.ITEM_UPDATED, { data: { itemId: '123' } })

// 取消（在 aboutToDisappear 中）
emitter.off(AppEvents.ITEM_UPDATED.eventId)
```

**放置位置**：事件 ID 定义在 `common/shared/constant/AppEvents.ets`，各模块按需引用。

---

## 9. 定时器

```typescript
// 延迟执行
const timeoutId = setTimeout(() => { /* ... */ }, 1000)

// 周期执行
const intervalId = setInterval(() => {
  this.refreshPaymentCode()
}, 60_000)

// 清除（aboutToDisappear 中必须清除）
aboutToDisappear(): void {
  clearTimeout(this.timeoutId)
  clearInterval(this.intervalId)
}
```

---

## 10. 窗口与显示

```typescript
import { window } from '@kit.ArkUI'
import { display } from '@kit.ArkUI'

// 屏幕信息
const displayInfo = display.getDefaultDisplaySync()
const screenWidth = displayInfo.width
const density = displayInfo.densityPixels

// 窗口配置（在 Ability 中）
onWindowStageCreate(windowStage: window.WindowStage): void {
  windowStage.getMainWindow().then((win) => {
    win.setWindowLayoutFullScreen(true)
    win.setWindowSystemBarProperties({
      statusBarColor: '#FFFFFF',
      statusBarContentColor: '#000000'
    })
  })
}
```

---

## 11. 权限管理

```typescript
import { abilityAccessCtrl, bundleManager, Permissions } from '@kit.AbilityKit'

// 放在 common/shared/utils/PermissionUtil.ets

export class PermissionUtil {
  static async check(context: Context, permission: Permissions): Promise<boolean> {
    const atManager = abilityAccessCtrl.createAtManager()
    const bundleInfo = await bundleManager.getBundleInfoForSelf(
      bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION
    )
    const result = atManager.checkAccessTokenSync(bundleInfo.appInfo.accessTokenId, permission)
    return result === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED
  }

  static async request(context: Context, permissions: Permissions[]): Promise<boolean> {
    const atManager = abilityAccessCtrl.createAtManager()
    try {
      const result = await atManager.requestPermissionsFromUser(context, permissions)
      return result.authResults.every(r => r === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED)
    } catch {
      return false
    }
  }
}
```

---

## 12. JSON 操作

```typescript
const jsonStr = JSON.stringify(itemPayload)
const itemPayload: ItemSummary = JSON.parse(jsonStr) as ItemSummary

// 安全解析
function safeJsonParse<T>(json: string, defaultValue: T): T {
  try { return JSON.parse(json) as T }
  catch { return defaultValue }
}
```

---

## 13. 装饰器速查表

| 装饰器 | 用途 | 触发 UI 刷新 |
|--------|------|-------------|
| `@Entry` | 页面入口（仅 phone HAP 的主页面） | — |
| `@Component` | 自定义组件 | — |
| `@State` | 组件内部状态 | 是 |
| `@Prop` | 父→子单向（值拷贝） | 是 |
| `@Link` | 父↔子双向（引用） | 是 |
| `@Provide` / `@Consume` | 跨层级共享 | 是 |
| `@Observed` / `@ObjectLink` | 深度观察 class 对象 | 是 |
| `@StorageLink` | 与 AppStorage 双向 | 是 |
| `@StorageProp` | 与 AppStorage 单向 | 是 |
| `@Builder` | 轻量 UI 片段 | — |
| `@BuilderParam` | 组件内容插槽 | — |
| `@Styles` | 可复用样式 | — |
| `@Extend` | 扩展组件属性 | — |
| `@CustomDialog` | 自定义弹窗 | — |
| `@Watch` | 监听状态变化回调 | — |

---

## 14. @Watch 监听

```typescript
@State @Watch('onCountChange') count: number = 0

onCountChange(): void {
  if (this.count > 10) {
    // 触发副作用
  }
}
```

---

## 15. 资源引用速查

```typescript
$r('app.string.key_name')           // 字符串 ResourceStr
$r('app.color.color_name')          // 颜色 ResourceColor
$r('app.float.float_name')          // 浮点 number | Resource
$r('app.media.image_name')          // 图片 Resource
$r('app.integer.int_name')          // 整型
$r('app.boolean.bool_name')         // 布尔

// 带参数的字符串格式化
$r('app.string.greeting', this.userName)  // "Hello, %s" → "Hello, 张三"
```

**注意**：HAR/HSP 库模块内的资源引用同样使用 `$r('app.xxx.yyy')` 格式，系统会自动在当前模块的 resources 中查找。
