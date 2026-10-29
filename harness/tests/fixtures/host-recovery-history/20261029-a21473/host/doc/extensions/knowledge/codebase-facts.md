---
name: codebase-facts
applies_when: always（凡需给出「代码库现状」这一半事实时）
---

# 工程取证事实登记

**这个工程各类能力的现状：有没有、长什么样、怎么认出来。** 工程级事实，
不属于任何单个流程阶段。取证公式「事实 = 变更意图 × **代码库现状**」的现状那一半，
第一落点就是本文件。

> **本文件只登记事实。** 怎么判、结论往哪写、取不到怎么降级，全在
> [evidence-rules](../skills/story/reference/evidence-rules.md)；某条约束该怎么落地，
> 在该约束的「落法附注」。三者不互相复述。

## 怎么维护

- **一面一行式的特征，不列实例**：写这类能力用什么 API、什么命名、在哪层目录。
  真实工程里同类实例成百上千，列清单既维护不动，也会随一次重构全部过期；特征稳定得多。
- **首版必须实扫生成**，不许照抄别的工程或凭平台常识填——本文件的前身
  `codebase-probes.md` 就是通用猜测的平移，与本仓实际对不上（写了本仓根本不用的埋点 API，
  漏了实际存在的日志封装）。
- 每面标 `confirmed`：`已确认` = 有人（或掌握真实仓的模型）实扫核对过；
  换工程重写后初始为 `未确认`，待确认者过一遍。
- **「没有」必须是核对过的结论**，不是没查到——写明「无此封装（已核对）」及零命中的检索项。
- **回灌**：取证时发现与代码不符（重构、换封装），当场修订本面并退回 `未确认`。
- **换工程复用**：由模型实扫目标仓重写全篇，再由人确认——与 `component-profile.md`
  同款画像，evidence-rules 与脚本不动。

**本工程技术栈**：HarmonyOS 应用（ArkTS / ArkUI，hvigor 构建，模块级 `oh-package.json5`）。

---

## 1. 对外暴露面 — `confirmed: 已确认`

应用清单 `src/main/module.json5` 的 `abilities[]`（看 `exported` 与 `skills`）；页面路由注册表
`src/main/resources/base/profile/main_pages.json` 与 `route_map.json`；跨模块跳转统一走
`pushPath`，导航栈由 `CommFunc` 的 `NavPathContext` 持有（`attach` / `stack`）。

## 2. 端云接口 — `confirmed: 已确认`

**无端云封装（已核对）**：`@ohos.net.http` / `http.createHttp` / `rcp` / `axios` 源码内均零命中，
数据来自本地仓储层，无网络出口。

## 3. 数据存储 — `confirmed: 已确认`

关系型持久化用 `relationalStore`（`@kit.ArkData`），封装在 Feature 模块的
`src/main/ets/data/local/*RdbHelper.ets`（持有单例 `RdbStore`，`StoreConfig` 带 `securityLevel`）；
内存态用 `AppStorage`，出现在 domain/service 层。**未使用** `preferences` 与
`distributedKVStore`；源码内无备份配置（构建产物目录下的是合成物）。

## 4. 配置项 — `confirmed: 已确认`

常量开关在各模块 `src/main/ets/shared/constant/*Constants.ets` 中，形态为
`static readonly <NAME>: boolean`（现存的均默认 `false`）；同目录另有非布尔的业务常量类，
按类型区分，别一并当开关。**无远程配置封装（已核对）**：源码内无管理台/云侧下发开关。

## 5. 埋点 — `confirmed: 已确认`

**无埋点封装（已核对）**：`hiAnalytics` / `hiAppEvent` / 打点上报类 API 源码内零命中。

**易混判**：现有的是**日志**——`CommFunc` 的 `src/main/ets/shared/log/Logger.ets`，封装
`@kit.PerformanceAnalysisKit` 的 `hilog`，统一 `DOMAIN`，静态 `info` / `error`。判「有无埋点」
时不要把它算进去。

## 6. 依赖变更（SDK / 组件 / TA） — `confirmed: 已确认`

模块依赖声明在各模块根的 `oh-package.json5` 的 `dependencies`（系统侧通用能力模块为空）；
模块清单在根 `build-profile.json5`。

> 新依赖边的合法性由 `framework.config.json` architecture 段的 `can_depend_on` 判定——
> 那是框架概念、不随平台变，不在本文件登记。
