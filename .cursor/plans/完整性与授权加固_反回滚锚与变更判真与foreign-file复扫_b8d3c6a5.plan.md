---
name: 完整性与授权加固 — 反回滚独立锚 / 变更判真分类器
version: 3.1.0
deferred_to: 3.1.0
# 版本说明：3.0.0 盘点（2026-07-30）顺延而来；保留两项"信任锚与授权判真"能力。
overview: >
  承载两项 3.0.0 未实施的完整性/授权缺口：① visual-capability-truth 3.9j 反回滚独立锚
  （当前 HWM 仅同权限域完整性检测，尾部截断有残余边界）；② 同 change 4.2b diff 内容级
  change-kind 分类器（test_seam / integration_glue 判真，落地前自动回退保持禁用）。
  两项共同特征：都在"框架能否证明自己没被悄悄改过/改动是否被正确授权"这条线上，且都需要
  同一批信任基础设施（权限隔离 broker / 单调计数器 / 内容级 diff 判据），拆开做会各建
  一套。foreign-file 复扫项经调用链复核已由每-attempt harness preflight 覆盖，保留 cancelled
  记录解释关闭依据，不进入 3.1.0 scope。
todos:
  - id: t1-anti-rollback-anchor
    content: >
      3.9j 反回滚独立锚：当前 vision HWM 只在同权限域内做完整性检测——同用户进程可整体
      回滚 checkpoint + HWM 到旧世代（尾部截断残余边界，e9c4a7f3 已诚实记录）。出路三选一
      须先做可行性对比：(a) 权限隔离 broker（独立服务账户持有锚，agent 无写权）；
      (b) 远端 append-only store；(c) OS 可信单调计数器（Windows TPM/NV counter 可用性
      待探针）。**先出选型报告再实施**，不得直接下手写第三套账本——威胁模型冻结为"防
      正常流程误伤 + 防同用户非特权进程回滚"，不承诺防 root/管理员。
    status: pending
  - id: t2-change-kind-classifier
    content: >
      4.2b diff 内容级 change-kind 分类器：判真 test_seam / integration_glue 等变更类别，
      供 mutation-authorization 精化裁决。**落地前保持"自动回退禁用"**（receipt 合规也
      按 unauthorized 上抛人工裁决，codex 三轮 P1-6 结论不变）——分类器成为自动放行依据
      之前，必须先证明其假阴性率可接受（改产品行为的 diff 被误判成 test_seam = 授权面
      被架空）。验收须含对抗样本：伪装成测试缝的产品行为改动。
    status: pending
  - id: t3-foreign-file-phase-rescan
    content: >
      【关闭 · 2026-07-30】早先仅检索 goal-runner 内
      verifyFrameworkIntegrity/scanForeignFiles 零命中，据此误判 phase harness 不复扫。
      完整调用链复核表明：goal-runner 每个 phase attempt 都会 spawn harness-runner，而
      harness-runner 入口直接执行 runFrameworkIntegrityPreflight，内部已包含
      scanForeignFiles。因此 agent 在 phase 中写入 framework/** 会在本 attempt 的 harness
      gate 被拦截，不存在另加 phase_verdict 前复扫的缺口。a6d21eb0 的 fixture/unit 继续保留
      作为既有完整性回归；不在 3.0 或 3.1 重复接线。
    status: cancelled
isProject: false
---

## 来源与顺延依据

| 来源 | 原 task | 状态定性 |
|---|---|---|
| openspec `visual-capability-truth` | 3.9j hardened anti-rollback 独立锚 | 未实施；需选型（broker/远端/TPM），非回归项 |
| 同上 | 4.2b diff 内容级 change-kind 分类器 | 未实施；落地前自动回退须保持禁用 |
| plan `7c4f2e9b` p10 残留 | phase 级 foreign-file 复扫 + consumer-layout E2E | **关闭**：每-attempt harness preflight 已复扫；a6d21eb0 fixture/unit 保留作回归 |

## 为什么保留两项在一个 plan

两项都消费同一批"信任基础设施"判据：谁有权写、发现后如何裁决。
- t1 决定**锚点能否被回滚**（检测能力的下限）；
- t2 决定**发现后能否自动放行**（裁决的精度）。

拆开做的实际风险：t1 建一套锚、t2 建一套 diff 判据，两套各自记录
"什么是可信的当前态"——这正是 v7-v9 provenance 账本被推倒的同一种膨胀（见
[[simplicity-is-king]] 四号实锤）。绑一起做能共用一个状态定义。

## 硬约束

1. **威胁模型冻结**：防正常框架流程误伤 + 防同用户**非特权**进程回滚；不承诺防管理员/root
   （framework 无 OS sandbox，声明能防等于虚标）。
2. **t2 落地前不开自动放行**：分类器未证明假阴性可控之前，authorization 一律人工裁决。

## 验收方向

- t1：选型报告（三方案可行性 + Windows 实测）→ 用户拍板后再实施；
- t2：对抗样本集（伪装 test_seam 的产品行为改动）零假阴性才允许接自动放行；
