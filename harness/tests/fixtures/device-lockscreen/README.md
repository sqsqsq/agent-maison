# `device-lockscreen/` — 锁屏 UI dump fixture（plan f4b2c8e6 t5/t6）

真机锁屏树的**脱敏**样本，供 `device-readiness-deps.ts` 的键位识别与冷却判据做单测。
纯数据 fixture（无 `CMD.json`/`INPUT/`），消费方式与 `cc-spec-deadlock/foreign-file-delta.json`
同款——由 unit 直接读取，不参与 `run-tests.ts` 的契约三件套扫描。

## 采集出处

| 项 | 值 |
|---|---|
| 时间 | 2026-07-30 |
| 设备 | HarmonyOS 真机 `3UJ0225321000395`（宿主 SimulatedWalletForHmos） |
| 方式 | `hdc shell uitest dumpLayout` → **`hdc file recv`** 取回 |
| 原始四帧 | 宿主 `scratch/unlock-probe/`（临时目录，可能已清；关键数据见下表） |

> ⚠ **必须用 `file recv`，不要用 `hdc shell cat \|`**：PowerShell 管道按 GBK 解码 UTF-8 中文会
> 丢字节、破坏 JSON（实测断在 `"originalText":"7月30日"`）。

## 文件

| 文件 | 来源帧 | 用途 |
|---|---|---|
| `clock-only.json` | wake 后 0ms | 锁屏时钟态：`text` 有 4 个数字（**不是**键盘） |
| `clock-with-face-hint.json` | wake 后 1500ms | 同上 + **人脸识别失败提示**（t6 误判源） |
| `keypad-stable.json` | 手动上滑后稳定态 | PIN 键盘完整 10 键（数字在 `originalText`） |
| `mixed-clock-and-partial.json` | **合成** | 时钟数字 + 6 个键盘键 → 验布局校验与完整性判据 |

## 原始四帧的逐帧判据实测（复刻生产 `readLockScreenSnapshot` 的判定）

本表是「**wake 后 dump 过早**」候选被证伪的依据——三帧时钟态结果完全相同，故 fixture 只留
一帧代表（`clock-only`）+ 一帧带人脸提示（`clock-with-face-hint`），不留三份重复。

| 原始帧 | ScreenLockRoot | 锁屏子树数字键（按 `text`） | keypad 完整(需10) | lockoutCooldown |
|---|---|---|---|---|
| 0000ms | ✅ | 4 `["0","1","5","9"]` | ❌ | false |
| 0500ms | ✅ | 4 同上 | ❌ | false |
| 1500ms | ✅ | 4 同上 | ❌ | **true（误判）** |
| stable-keypad | ✅ | **0** | ❌ | **true（误判）** |

⇒ 生产实现在**任何一帧都解不开锁**：前三帧抓到的是时钟、stable 帧真键盘一个都抓不到。

## 判据要点（t5/t6 的被测事实）

**PIN 数字键在 `originalText`，`text` 与 `id` 均为空**（`keypad-stable.json`）：

```
originalText="1"  bounds=[270,820][474,1002]      三列 x 中心 ≈ 372 / 660 / 948
originalText="0"  bounds=[558,1612][762,1794]     四行 y 中心 ≈ 911 / 1175 / 1439 / 1703
```

**「识别到 4 个」的真相 = 锁屏时钟**（`clock-only.json`）：

```
text="1" id=Text_Digital_Text_0_0   text="0" id=Text_Digital_Text_0_1
text="5" id=Text_Digital_Text_1_0   text="9" id=Text_Digital_Text_1_1
父容器 id=Text_Digital (Stack)；祖先链 ScreenLockRootComponent → … → sl_clock → Text_Digital
```

**`id=numKeyBoard` 的 9 个节点不是数字键**（`keypad-stable.json`）：`originalText` 是
`ABC / DEF / GHI / JKL / MNO / PQRS / TUV / WXYZ / +`——字母提示层。**名字最像键盘的反而不是键**。

**冷却正则误命中**（`clock-with-face-hint.json` / `keypad-stable.json`）：

```
"originalText":"未识别成功，双击屏幕重试"
"originalText":"未识别成功，点击此处重试"
```

被 `/(try again in|重试|稍后再试|已停用|disabled)/i` 的「重试」命中——**人脸识别提示，不是
PIN 惩罚冷却**。另：该正则对 `JSON.stringify(lockRoot)` 整串匹配，属性名里的 `disabled` 也会命中。

## 脱敏说明

**保留**（判据所需）：树结构 + `id` / `text` / `originalText` / `bounds` / `type` / `enabled` /
`visible` / `clickable` / `checkable` / `checked` / `selected` / `key`。

**剔除**：运行时 id（`hashcode` / `accessibilityId` / `hostWindowId` / `displayId`）、应用身份
（`bundleName` / `abilityName` / `pagePath`）、样式与几何冗余（`backgroundColor` / `blur` /
`opacity` / `origBounds` / `zIndex` / `hierarchy` / `description` / `hint`）；状态栏 / 通知 /
灵动岛整棵子树（`StatusBar*` / `PluginRootComponent*` / `notification` / `[Live]*` /
`WifiComponent` / `SignalComponent` / `BatteryComponent` / `ringmode` / `ClockStatusView` /
`TimeView_Text_timeText`）。

**判据优先剪枝**（生成器内置，防误伤）：子树只要含 `ScreenLockRootComponent` / `Text_Digital` /
`numKeyBoard` / `未识别成功` / `sl_clock` / `Digital_PSD_Input_Tip` / `InputPwdTip`，或含
单数字 `text`/`originalText`，则**一律不剪**。

> **一个实际踩过的坑**：初版剪枝用宽泛的 `/Clock(?!.*Digital)/i` 想剪状态栏小时钟，结果命中
> 锁屏容器 `sl_clock`（大时钟的父级），把时钟数字连带剪掉——**判据保真自检当场报警**才发现。
> 故生成器保留「脱敏前后判据统计逐项比对」自检（lockRoot / text 数字集 / originalText 数字集 /
> 人脸提示 / numKeyBoard 计数），任一项不等即 FAIL。

## 隐私边界

原始 dump 含通知栏内容与应用身份，**已按上表剔除**；PIN 本身从未被采集（采证时明确不输入）。
若需重采，务必同样脱敏后才可入库。

## 保留的文本内容与其测试价值

脱敏后仍在场的多字符文本（**有意保留，非遗漏**）：

| 文本 | 保留理由 |
|---|---|
| `未识别成功，双击屏幕重试` | **t6 判据本体**——冷却正则误命中的对象，删了 t6 就没法测 |
| `1, 0, 5, 9, 7月30日, 星期四, 六月十七` | 时钟容器的无障碍聚合文本。**「含数字但非单数字 ⇒ 正确不被 `collectDigitKeys` 抓」的真实负例**，有测试价值 |
| `7月30日` / `星期四` / `六月十七` | 锁屏日期区，真机形态的一部分 |

**不做日期归一化**的取舍：日期/星期/农历**不是个人信息**；归一化会把真实采集数据换成人造
数据，降低 fixture 的实证价值。采集日期已在本文档「采集出处」声明，时间特征不构成困扰。

## 生成器自检（必须保留的纪律）

fixture 由脱敏脚本生成，脚本内置**判据保真逐项比对**——脱敏前后必须完全一致：
`ScreenLockRootComponent 在场` / `text 单数字集合` / `originalText 单数字集合` /
`未识别成功 提示在场` / `numKeyBoard 节点计数`。任一项不等即 FAIL。

本轮该自检**实际拦住了一次误伤**（宽泛 `Clock` 正则剪掉 `sl_clock` 导致时钟数字丢失）。
若将来重采或调整脱敏白名单，**务必保留此自检**——否则"看起来对"的 fixture 可能已经丢了判据。
