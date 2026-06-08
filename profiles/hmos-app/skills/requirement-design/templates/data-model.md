# 数据模型定义规范

本模板用于在技术设计文档中定义数据模型（data/model 层），确保模型定义的完整性和一致性。

---

## 模型定义格式

### 格式一：纯数据结构 — 使用 `interface`

当模型仅用于描述数据结构、不含行为方法时，使用 `interface`。

```typescript
/**
 * {模型说明}
 * 对应 PRD 中的 {关联的业务实体描述}
 */
export interface {ModelName} {
  /** {字段说明} */
  id: string
  /** {字段说明} */
  name: string
  /** {字段说明}，可选字段 */
  description?: string
  /** {字段说明}，枚举类型引用 */
  type: {EnumType}
  /** {字段说明}，嵌套类型 */
  detail: {SubModelName}
  /** {字段说明}，数组类型 */
  items: Array<{ItemType}>
}
```

### 格式二：带行为的模型 — 使用 `class`

当模型需要内聚方法（格式化、校验、计算属性等）时，使用 `class`。

```typescript
/**
 * {模型说明}
 * 对应 PRD 中的 {关联的业务实体描述}
 */
export class {ModelName} {
  /** {字段说明} */
  id: string = ''
  /** {字段说明} */
  name: string = ''
  /** {字段说明} */
  amount: number = 0

  constructor(params?: Partial<{ModelName}>) {
    if (params) {
      Object.assign(this, params)
    }
  }

  /** {方法说明} — 如脱敏显示 */
  get maskedName(): string {
    // 实现脱敏逻辑
    return '***' + this.name.slice(-4)
  }

  /** {方法说明} — 如格式化金额 */
  formatAmount(): string {
    return `¥${this.amount.toFixed(2)}`
  }
}
```

### 格式三：枚举类型

```typescript
/**
 * {枚举说明}
 */
export enum {EnumName} {
  /** {枚举值说明} */
  VALUE_A = 'value_a',
  /** {枚举值说明} */
  VALUE_B = 'value_b',
}
```

---

## 字段描述表

每个模型定义后**必须**附带字段描述表：

| 字段 | 类型 | 必填 | 默认值 | 说明 | 来源 |
|------|------|------|--------|------|------|
| id | string | ✅ | — | 唯一标识 | API / 自动生成 |
| name | string | ✅ | '' | 显示名称 | API |
| description | string | ❌ | undefined | 描述文字 | API |
| type | CardType | ✅ | — | 卡片类型枚举 | API |
| items | Array\<Item\> | ✅ | [] | 子项列表 | API |

**"来源"列**说明数据来自哪里：
- `API` — 从服务端接口获取（模拟数据场景由 repository 提供）
- `自动生成` — 前端生成（如 UUID）
- `用户输入` — 来自用户操作
- `计算属性` — 由其他字段派生

---

## ArkTS 合法类型参考

设计数据模型时，字段类型必须限定为以下 ArkTS 合法类型：

### 基本类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `string` | 字符串 | `name: string` |
| `number` | 数字（整数和浮点） | `amount: number` |
| `boolean` | 布尔值 | `isActive: boolean` |
| `Resource` | 资源引用 | `icon: Resource` |
| `undefined` | 未定义（配合 ? 使用） | `desc?: string` |

### 复合类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `Array<T>` | 数组 | `items: Array<CardInfo>` |
| `Map<K, V>` | 映射 | `config: Map<string, string>` |
| `Record<K, V>` | 记录 | `extra: Record<string, Object>` |
| `T \| null` | 可空类型 | `selected: CardInfo \| null` |

### 鸿蒙特有类型

| 类型 | 说明 | 使用场景 |
|------|------|----------|
| `Resource` | 静态资源引用 | 图片、文字、颜色等 $r() 引用 |
| `PixelMap` | 像素位图 | 动态图片处理 |
| `Want` | Ability 跳转意图 | 跨 Ability 通信 |

---

## 与 @Observed 结合（列表场景）

当模型用于 `ForEach` / `LazyForEach` 且需要属性级 UI 刷新时：

```typescript
@Observed
export class {ModelName} {
  id: string = ''
  name: string = ''

  constructor(id: string, name: string) {
    this.id = id
    this.name = name
  }
}
```

配合 `@ObjectLink` 在子组件中使用：

```typescript
@Component
struct ItemView {
  @ObjectLink item: {ModelName}

  build() {
    Text(this.item.name)
  }
}
```

---

## 命名约定

| 类别 | 约定 | 示例 |
|------|------|------|
| 模型名 | PascalCase，名词 | `CardInfo`、`UserProfile` |
| 枚举名 | PascalCase，Type/Status 后缀 | `CardType`、`PaymentStatus` |
| 枚举值 | UPPER_SNAKE_CASE | `TRANSPORT_CARD`、`BANK_CARD` |
| 字段名 | camelCase | `cardNumber`、`isActive` |
| 文件名 | PascalCase，与主导出类型同名 | `CardInfo.ets`、`CardType.ets` |
