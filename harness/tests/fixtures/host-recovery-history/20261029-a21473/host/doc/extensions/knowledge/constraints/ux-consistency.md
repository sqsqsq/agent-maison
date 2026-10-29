---
name: ux-consistency
applies_when: 需求含新页面/UI 改版
---

# UX 一致性

管新增/改版界面在多形态设备与系统显示设置下的一致性。产品有对应形态的设计是各条的共同前提。

## 条目

| ID | 约束 | 强制力 | 命中条件 | 处置 | 验证（执行体） |
|---|---|---|---|---|---|
| UX-01 | RTL 语言下界面镜像正确 | 基线 | 需求含 UI 变更 | 方向性参数用 start/end | 模型：检索 `left:`/`right:` 与非 Localized 方向参数。实机：切阿语走查 |

## 落法附注

只列本工程决策与平台易错点，通用 ArkUI 用法不赘述。

- **UX-01**
  - 只有 Localized 系列入参才镜像（API 12+）；`Position`/`Edges` 不镜像。
  - `.direction()` 对 `Column` 不生效，改用 `alignItems(HorizontalAlign.Start/End)`。
  - 文本对齐用 `TextAlign.Start/End`，禁 Left/Right。
  - Canvas 不自动镜像，语言切换后手动重绘。
  - 实机验证：`applicationContext.setLanguage('ar')`。
