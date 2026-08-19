---
name: 视觉证据链深化 — build fingerprint 链接入 / TC 执行器级联控制
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g7-component-assembly-and-coverage-closure
  - g8-real-host-development-and-governance
relation: verification-provider
layer: closure
goal_requires:
  - profile-build-identity-hook
  - hylyre-per-case-driver
goal_provides:
  - source-build-visual-evidence-link
  - test-case-cascade-execution
real_host_validation: >
  必须在真实宿主构建与实机执行中证明截图可追溯到对应源码，并证明 dependent 跳过、fresh_app
  reset 与环境阻断分类真实生效；外部钩子未具备时保持诚实降级，不以 fixture 宣称完成。
parallel_authority_added: false
# 版本说明：3.0.0 盘点（2026-07-30）顺延而来；两项均依赖 profile/hylyre 侧外部能力钩子。
overview: >
  承载两项未实施能力（原属 openspec change `visual-capability-truth`——2026-08-14 已归档
  superseded、由 `simplify-visual-trust` 取代；取代范围仅三轴/账本/锚类任务，本 plan 两项
  属 testing 侧证据链不在其列，现由本 plan 唯一承载）：① 7.2b build fingerprint
  链接入（需 profile build 身份钩子——hylyre 实机采集构建指纹并与源码链绑定；落地前
  provenance 继承恒 STALE，codex 三轮 P1-5 结论）；② 6.7b TC 执行器级联控制（前置失败
  跳过 dependent / fresh_app reset 执行 / reset 失败归 BLOCKED_BY_ENV）——依赖 hylyre
  **逐例驱动**能力，而当前 wheel 是"一次跑全 plan"，framework 侧无法实现。
  2026-07-30 盘点定性：两项都卡在**外部工具能力**（hylyre / profile build 钩子），不是
  framework 侧不想做；压在 3.0.0 上等于把外部依赖当自己的发布阻塞。顺延 3.1.0，并在
  条件（hylyre 能力升级）具备时启动。
todos:
  - id: t1-build-fingerprint-chain
    content: >
      7.2b build fingerprint 链接入：需 profile 侧 build 身份钩子——hylyre/hvigor 实机采集
      构建指纹并与源码链（coding_base_sha / contracts.files 冻结集）绑定，使视觉证据能回答
      "这张截图对应哪次构建的哪份源码"。**落地前 provenance 继承恒 STALE**（三轮 P1-5：
      部分 provenance 比无 provenance 更危险——会让 stale 判定误放行）。
      现状可复用件（勿重造）：d9e4b7c1 已落 `computeHapSha256Full`（完整 64 hex HAP 摘要）
      与 device-test-evidence 的 build 绑定字段；本项要补的是**源码侧**那一环。
    status: pending
  - id: t2-tc-cascade-executor
    content: >
      6.7b TC 执行器级联控制：前置失败跳过 dependent 用例 / fresh_app reset 真实执行 /
      reset 失败归 BLOCKED_BY_ENV（非产品根因）。**前置条件=hylyre 支持逐例驱动**（当前
      wheel 一次跑全 plan，framework 只能事后按 test_case_flow 做归类三分，做不到执行期
      跳过）。启动前先确认 hylyre 版本能力；若长期不具备，改做"事后归类已足够"的诚实
      降级声明并关闭本项。
      现状可复用件：`triageCascade`（root/blocked/independent 三分）已在 check-testing 与
      d9e4b7c1 collector 双消费，执行器落地后与它同源，**不得另造第二套依赖图**。
    status: pending
isProject: false
---

## 来源与顺延依据

| 来源 | 原 task | 卡点 |
|---|---|---|
| 原 openspec `visual-capability-truth`（已归档，见下注） | 7.2b build fingerprint 链接入 | 需 profile build 身份钩子（实机采集） |
| 同上 | 6.7b TC 执行器级联控制 | 需 hylyre 逐例驱动能力；当前 wheel 一次跑全 plan |

> 母 change 状态（2026-08-15 更新）：`visual-capability-truth` 已随视觉信任减法归档为
> superseded（`openspec/changes/archive/2026-08-14-visual-capability-truth-superseded/`），
> 取代者 `simplify-visual-trust` 仅取代三轴 fail-closed meet／跨轮账本／trust-anchor 类
> 未完成任务；7.2b／6.7b 属 testing 侧证据链，不在取代范围，自此由本 plan 唯一承载。

## 与 3.0.0 已交付件的边界（避免重做）

- **HAP 侧指纹已有**：`computeHapSha256Full`（完整 64 hex）+ device-test-evidence 的
  `hap_sha256_full` 绑定（plan d9e4b7c1 已提交 e60b4ca0）。t1 要补的是**源码侧链条**
  （构建指纹 ↔ coding_base_sha / 冻结文件集），不是重新做 HAP 摘要。
- **级联归类已有**：`triageCascade` 三分（root/blocked/independent）在 check-testing 的
  run gate 与 d9e4b7c1 的 device_test collector 双处消费。t2 是把"事后归类"升级为
  "执行期跳过"，依赖图定义必须**共用 test_case_flow SSOT**。

## 启动前置（写在这里防将来忘）

1. **t2 必须先确认 hylyre 能力**：查当前 wheel 是否支持单例执行 / 步骤级驱动。若不支持
   且短期无升级计划 → 本项改为"关闭 + 诚实声明事后归类为最终形态"，不要长期挂 pending。
2. **t1 必须先定 provenance 语义**：源码侧指纹缺失时的默认态（恒 STALE）不得因为"想让
   链路跑通"而放宽——这正是 3.0.0 前多次假绿的同一种诱因。

## 验收方向

- t1：截图 ↔ 构建 ↔ 源码三方可追溯，缺任一环恒 STALE 的负例在场；
- t2（若启动）：前置失败时 dependent 用例**不执行**（不是执行后归类）、reset 失败归
  BLOCKED_BY_ENV、与 triageCascade 的事后归类结论一致（同源验证）。
