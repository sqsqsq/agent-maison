# ArkTS / ArkUI 弱模型易错点对照手册

> **目标读者**：用 MiniMax / GLM 这类 200K-context 中端模型写 ArkTS 代码时容易反复出错的场景。
> **使用方式**：Skill 3（Coding）在生成每个 `.ets` 文件之前，对照本手册做一次"自我检查"；写完之后再做一次"自我校对"。
> **格式约定**：每条都给"❌ 错误示例 → ✅ 正确示例"的对照，便于模型直接做 pattern matching。
> **示例说明**：部分代码片段使用钱包工程的模块命名（`@hw/BankCard`、`CardRepo` 等）演示具体错法；这只是举例，实际请按你自己工程的模块名替换。

---

## 1. `@State` 必须初始化

**症状**：忘记给 `@State` 变量赋初值，编译期直接报错。ArkTS 比 TypeScript 严格：不允许 `@State foo?: string`，也不允许不赋初值。

```ts
// ❌ 错
@Component
struct Foo {
  @State count: number           // 编译报错
  build() { Text(`${this.count}`) }
}

// ❌ 错
@Component
struct Foo {
  @State count?: number = 0      // 可选类型 + @State 组合不合法
  build() { Text(`${this.count}`) }
}

// ✅ 对
@Component
struct Foo {
  @State count: number = 0
  build() { Text(`${this.count}`) }
}
```

---

## 2. `@Prop` vs `@Link` vs `@ObjectLink` 选错

**症状**：父组件状态变化，子组件不刷新；或反向修改父组件时不生效。

| 装饰器 | 方向 | 用途 |
|--------|------|------|
| `@Prop` | 父 → 子（单向，子内可改但不同步回父） | 传递值类型 / 简单数据 |
| `@Link` | 父 ↔ 子（双向同步） | 子需要修改并把结果传回父 |
| `@ObjectLink` | 引用对象的双向追踪 | 只能配合 `@Observed` 类使用 |

```ts
// ❌ 错：用 @Prop 对 class 实例做双向同步，子组件修改后父不变
@Component
struct Child {
  @Prop info: UserInfo          // 单向
  build() { Button('rename').onClick(() => this.info.name = 'x') }
}

// ✅ 对：双向用 @Link，且 class 要用 @Observed 装饰
@Observed
class UserInfo { name: string = '' }

@Component
struct Child {
  @ObjectLink info: UserInfo
  build() { Button('rename').onClick(() => this.info.name = 'x') }
}
```

---

## 3. `build()` 内不得有 `if/else` 外的 JS 控制流

**症状**：写了 `for/while` 或 `switch` 直接在 `build()` 里，运行时 UI 渲染异常。

```ts
// ❌ 错
build() {
  for (const item of this.items) {       // 非法
    Text(item.name)
  }
}

// ✅ 对：用 ArkUI 内置的 ForEach / LazyForEach
build() {
  Column() {
    ForEach(this.items, (item: Item) => {
      Text(item.name)
    }, (item: Item) => item.id)           // 第三个参数 keyGenerator 必填
  }
}
```

---

## 4. `ForEach` 没写 keyGenerator

**症状**：列表更新时 UI 重绘乱序、性能塌掉。

```ts
// ❌ 错
ForEach(this.items, (item: Item) => {
  Text(item.name)
})                                         // 少了 keyGenerator

// ✅ 对
ForEach(this.items, (item: Item) => {
  Text(item.name)
}, (item: Item) => item.id)                // 明确 key
```

---

## 5. `LazyForEach` 必须搭配 `IDataSource` 实现

**症状**：直接把数组传给 `LazyForEach`，运行时不工作。

```ts
// ❌ 错
LazyForEach(this.bigArray, (item: Item) => { Text(item.name) })

// ✅ 对：必须实现 IDataSource
class ItemSource implements IDataSource {
  private items: Item[] = []
  totalCount(): number { return this.items.length }
  getData(i: number): Item { return this.items[i] }
  registerDataChangeListener(_: DataChangeListener): void { /* ... */ }
  unregisterDataChangeListener(_: DataChangeListener): void { /* ... */ }
}
```

---

## 6. `$r()` 资源引用必须完全匹配资源文件里的 key

**症状**：用了资源 key 但没在 `resources/base/element/string.json` 等文件里登记，运行时黑屏或打印 `Resource is invalid`。

```ts
// ❌ 错：字符串拼接
Text($r(`app.string.${this.module}_title`))    // ArkTS 不允许动态资源 key

// ❌ 错：资源 key 没在 string.json 里声明
Text($r('app.string.bank_card_title'))         // 若 string.json 里没有 bank_card_title 条目则报错

// ✅ 对：静态字符串 + 已登记
// resources/base/element/string.json 中必须有：{"name": "bank_card_title", "value": "银行卡"}
Text($r('app.string.bank_card_title'))
```

---

## 7. HAR 模块必须通过 `Index.ets` 导出

**症状**：其他模块 `import { Foo } from '@hw/BankCard'` 找不到符号。

```ts
// ❌ 错：直接从内部路径 import
import { CardRepo } from '@hw/BankCard/src/main/ets/data/repository/CardRepo'

// ❌ 错：Index.ets 不存在或没有 export
// Index.ets 内容为空

// ✅ 对：Index.ets 集中导出对外 API
// Index.ets
export { CardRepo } from './src/main/ets/data/repository/CardRepo'
export type { BankCardInfo } from './src/main/ets/data/model/BankCardInfo'

// 外部使用：
import { CardRepo, BankCardInfo } from '@hw/BankCard'
```

---

## 8. `oh-package.json5` 的依赖路径格式

**症状**：编译报找不到 HAR 模块。

```json5
// ❌ 错：用 npm 风格版本号
{ "dependencies": { "@hw/BankCard": "^1.0.0" } }

// ❌ 错：路径少了层目录前缀
{ "dependencies": { "@hw/BankCard": "file:./BankCard" } }

// ✅ 对：file: 协议 + 层目录前缀，相对路径相对于当前 oh-package.json5
// 位于 01-Product/Phone/oh-package.json5
{
  "dependencies": {
    "@hw/BankCard": "file:../../02-Feature/BankCard",
    "@hw/CommFunc": "file:../../05-SystemBase/CommFunc"
  }
}
```

---

## 9. `Router` 和 `Navigation/NavPathStack` 不要混用

**症状**：页面跳转后返回键行为异常；`router.pushUrl` 和 `NavPathStack.pushPath` 维护两套栈，状态错乱。

```ts
// ❌ 错：在一个 App 里既用 router 又用 NavPathStack
import router from '@ohos.router'
router.pushUrl({ url: 'pages/Detail' })          // 旧 API
this.pathStack.pushPath({ name: 'Detail' })      // 新 API，两套栈不一致

// ✅ 对：统一使用 NavPathStack + NavDestination
// Phone/Index.ets
@Entry
@Component
struct AppEntry {
  pathStack: NavPathStack = new NavPathStack()
  build() {
    Navigation(this.pathStack) { /* 首页 */ }
      .hideTitleBar(true)
      .navDestination(this.destBuilder)
  }
  @Builder destBuilder(name: string) {
    if (name === 'Detail') { DetailPage() }
  }
}
```

---

## 10. `async/await` 只能用在 `build()` 之外

**症状**：在 `build()` 内部写 `await`，ArkUI 不允许，编译或运行报错。

```ts
// ❌ 错：build() 内 await
async build() {                                  // build() 不允许 async
  const data = await this.repo.fetch()
  Text(data.name)
}

// ❌ 错：组件 Callback 里不 await 直接 .then
Button('load').onClick(() => {
  this.repo.fetch().then(d => this.data = d)     // 可以工作但破坏 async/await 统一风格
})

// ✅ 对：生命周期或事件回调中用 async
async aboutToAppear(): Promise<void> {
  this.data = await this.repo.fetch()
}
Button('load').onClick(async () => {
  this.data = await this.repo.fetch()
})
```

---

## 11. UI 文本必须用 `$r()` 而非硬编码中文字符串

**症状**：PR 里全是硬编码中文，Harness 的 `no_hardcoded_strings` 报 MAJOR。

```ts
// ❌ 错
Text('银行卡')
Button('添加')

// ✅ 对
Text($r('app.string.bank_card_title'))
Button($r('app.string.common_add'))
// resources/base/element/string.json 补上：
// { "name": "bank_card_title", "value": "银行卡" }
// { "name": "common_add", "value": "添加" }
```

---

## 12. 禁止使用 `any` 类型

**症状**：为了赶进度用 `any`，导致 Harness 的 `no_any_type` 报 MAJOR。弱模型常常在 "不确定类型" 时偷懒用 any。

```ts
// ❌ 错
function handleData(data: any): any {
  return data.list
}
const items: any[] = []

// ✅ 对：显式类型或泛型
function handleData<T extends { list: Item[] }>(data: T): Item[] {
  return data.list
}
const items: Item[] = []

// ✅ 若确实不知道类型：用 Object | unknown
function log(obj: Object): void { console.log(JSON.stringify(obj)) }
```

---

## 13. `@Component` 的 struct 名必须 PascalCase 且与文件名一致

**症状**：命名不一致导致 Index.ets 导出后 import 路径对不上，Harness 的 `naming_conventions` 报 MAJOR。

```ts
// ❌ 错：文件 home_tab_page.ets 内写 struct homeTabPage
@Component
struct homeTabPage { build() {} }                // struct 名、文件名都不对

// ✅ 对：文件 HomeTabPage.ets 内写 struct HomeTabPage
@Component
struct HomeTabPage { build() {} }
```

---

## 14. `AppStorage` / `LocalStorage` 的读写类型安全

**症状**：读出来的值类型不匹配运行时崩溃。ArkTS 要求显式泛型。

```ts
// ❌ 错：没有显式类型，拿到 undefined
const user = AppStorage.Get('currentUser')       // unknown
if (user.name) { /* 运行时可能 crash */ }

// ✅ 对
const user = AppStorage.Get<UserInfo>('currentUser')
if (user && user.name) { /* 安全 */ }

// ✅ 写入时类型也要明确
AppStorage.SetOrCreate<UserInfo>('currentUser', { id: 'x', name: 'foo' })
```

---

## 15. 公共组件不要跨模块直接 import 内部路径

**症状**：Feature 层模块 import 到 05-SystemBase 模块的 `src/main/ets/presentation/...` 内部文件，破坏模块边界。Harness 的 `inter_module_dependency` / `layer_compliance` 报 BLOCKER。

```ts
// ❌ 错：跨模块 import 内部路径
import { WalletToast } from '@hw/CommUI/src/main/ets/presentation/components/WalletToast'

// ✅ 对：只 import Index.ets 的公开 API
import { WalletToast } from '@hw/CommUI'
```

---

## 使用建议

1. **单文件自检**：每写完一个 `.ets` 文件，扫一遍上述 15 条，确认没有命中任何"❌ 错"模式。
2. **单文件 Lint**：立刻跑一遍单文件的 lint 检查（见 `framework/skills/3-coding/SKILL.md` Step 3 的"逐文件 Lint 门禁"）。
3. **批改反馈**：若 Harness 报出某条 BLOCKER / MAJOR，回到本文件对应章节读"✅ 对"示例，照抄模式再改。
4. **不要"记忆化"**：每开始一个新文件前，主动重读 1-2 条相关易错项，不要假设上一轮记住的模式这轮还在上下文窗口里。
