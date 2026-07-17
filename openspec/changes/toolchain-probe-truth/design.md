# Design: toolchain-probe-truth

## probe 子对象（framework.local.json > toolchain.probe）

```jsonc
"probe": {
  "binary": { "hvigor_bin": "...", "observed_at": "..." },          // --ensure 可写
  "cli_starts": { "ok": true, "hvigor_version": "6.23.4", "observed_at": "..." }, // --ensure 可写（真跑 --version）
  "project_compile": {                    // verified/capability_failed 仅 wrapper 可建立；
                                          // --ensure 人工 reprobe 仅可降级重置 unknown（v4）
    "status": "unknown | verified | capability_failed",
    "failure_code": null,      // ENV_LEVEL 白名单：sdk_home_missing_or_invalid | sdk_component_missing | sdk_layout_or_version_incompatible_suspected
    "evidence": [],            // 升级 incompatible_suspected 所需：sdk manifest 格式/SDK 版本/hvigor 版本
    "invocation_fingerprint": "…",   // 唯一共享 helper 产出；verified 参与失效判定，capability_failed 仅留痕
    "observed_at": "…",
    "expires_at": "…"
  },
  "last_attempt": { … },       // 人读；源码失败/人工 reprobe 留痕，不参与任何判定
  "known_quirks": ["…"]        // 纯人读备注；永不参与 gate/状态升级
}
```

## 状态机（防首编译死锁）

```
unknown ──wrapper 编译成功──▶ verified
unknown ──wrapper 可信环境分类（ENV_LEVEL 白名单码：00303217/00303168 等）──▶ capability_failed
unknown ──源码编译失败──▶ unknown（last_attempt 更新）
capability_failed ──源码编译失败（已达源码阶段=装配链全通）──▶ unknown（v3：清除旧失败）
capability_failed ──人工 reprobe（--ensure 且 cli 可启动）──▶ unknown（v4：降级重置，留审计痕）
verified ──指纹变化──▶ unknown（指纹失效仅对 verified；capability_failed 是环境级，跨 invocation 成立）
verified/capability_failed ──config 摘要漂移或过期──▶ unknown
```

- preflight 消费（v4 恒拦截；v2 交替授予与 v3 粘滞授予均废弃——前者被 goal→harness 双入口空消费，后者是环境未修也持续放行的无限窗口）：capability_failed（可信+config 新鲜+未过期）→ **恒返回缺口**，判定纯读无副作用，双入口天然一致；环境没修直接 resume → 再次 halt，不烧 agent 预算。解除拦截仅三条可审计路径：①config 摘要（含 module 级配置/DevEco 装配路径/SDK 描述指纹）漂移或完整性失配 → 自动失效回 unknown；②人工 reprobe（`check-personal-setup --ensure`，人类主动动作且 hvigor cli 真跑 `--version` 可启动）→ 降级重置 unknown（绝不升级 verified；机器路径 ensurePersonalSetup 无权触达）；③wrapper 真实编译结果改写。缺口码=显式 prerequisite `deveco_toolchain_capability_failed`（出口语义见 capability-gap-preflight）；status=unknown → 放行（允许本次真实编译建立状态，与新工程首编译同信任级）；verified → 放行。
- 环境级语义（v4）：capability_failed 仅允许 ENV_LEVEL_CAPABILITY_FAILURE_CODES 白名单码写入（SDK/装配层失败对所有 invocation 成立）——preflight 无 invocation 维度是设计而非缺陷；invocation_fingerprint 对 capability_failed 只是定谳留痕（provenance）。非白名单码只进 last_attempt 人读。
- 归因阶梯：sdk_component_missing 是**中性事实**——07-16 事故复盘证明"版本不兼容"在未走 framework 调用链前只是强推断；证据齐备才升级 suspected，且措辞保留"suspected"。

## 与 b4e7a2c9 的复用边界

- 共享 diagnostic util 抽取是**纯搬移**（ut-hvigor-test-failure.ts 行为零变化，其单测不动）。
- 本 change 只管 coding/compile（build）链路；ut/testing 失败分类归 b4e7a2c9（已落地），互不重叠。
