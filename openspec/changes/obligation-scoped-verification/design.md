## Context

P1–P4 和 P6 专项入口已交付。P5 负责验证专业链，继续使用既有 capability/profile、运行范围、设备门和报告，不创建假 Feature。

## Goals / Non-Goals

**Goals:** 按合法分层与真实影响决定 UT/testing；专项使用同一 checker 和原生 provider；零设备义务只读对账不产生设备动作或空报告。

**Non-Goals:** 不新增状态、租约、权限或执行器；不把 UT 使用设备等同 testing 义务；不提前切换默认 workflow，不编造真实宿主结果。

## Decisions

1. performance 复用 ut_layer 与 ut_focus/device_focus，同一分层工具提供 ID 集合和 unknown 判断；P2 原解析器消费结果。旧缺层级保留 unknown，失败不反写适用性。
2. UT/testing 使用 contract 1.1、P3 解析内容及冻结 scope；旧 workflow 只保留窄兼容。现有 mock/testability/覆盖门按原实际工作模式和适用性执行。
3. hmos 原生入口显式传 request 目标与 reportDir，底层 hvigor/hdc/Hylyre 复用原实现；测试 suite、用例计划必须对应显式目标，真实未执行/离线/manual 不返回 PASS。
4. 无 testing 义务的 reconcile-only 在任何写报告/设备前按当前冻结范围返回诊断；已有设备义务保留完整原对账链。R8 保留原单位 AC/BD、混合、NFR 与未知引用的区别。

## Risks / Trade-offs

- 历史性能项不明 → 返回 unknown，由验收责任方补明确方法。
- 原生函数隐式 Feature 报告目录 → 参数贯通到日志/trace/cwd，测试确认活跃 Feature 零写入。
- 验证环境不可用 → 如实报告 provider 能力/执行缺口，不能当 N/A。

## Migration Plan

本批完成机械验收，候选交 P7 做真实 RDB/页面/性能宿主验证；默认切换与 MIGRATION.md 在 P7 汇总。发布前使用原 release:verify/release:all。
