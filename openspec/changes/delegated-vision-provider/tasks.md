## 1. 契约冻结（t0）

- [x] 1.1 建 change `delegated-vision-provider`：proposal / design / 新能力 `delegated-vision` 与
      `agent-adapters` / `framework-local-config` / `goal-runner` / `visual-diff` 四份 delta
- [x] 1.2 `npm run openspec:validate` 通过（**通过前不得修改生产代码**）

## 2. Provider 身份与配置（t1）

- [x] 2.1 `ProviderRef {adapter, model}` 落 `utils/types.ts`（model 必填，不依赖 goal-manifest 类型）
- [x] 2.2 adapter schema 增 `visual_provider {readonly_invoke, image_transport, stdout_envelope,
      model_replay}`；`claude/codex/cursor/opencode` 四份完整声明入册；`codeagent/chrys/generic` 不声明
- [x] 2.3 adapter catalog 扫描该字段派生**唯一**支持列表；删除/禁止 TypeScript 白名单、模型钉 adapter
      集合交并、Claude-kernel 家族推断、文档手写名单；`goal_capability` 不参与 provider 资格
- [x] 2.4 `framework.local.json` `vision.visual_provider`：ownership 键 + vision 段解析校验 +
      写入只走 `updateLocalConfig`
- [x] 2.5 三形态入口与重选语义：普通交互态 / attended goal（local 缺失或现有 adapter unsupported →
      提示一次可重选可跳过，跳过本轮 blind 不重复问）；无人值守 WARN + 忽略 + blind
- [x] 2.6 `record-visual-provider` 个人 scope 任务 + confirmation-registry `setup.visual_provider`
      （机器写盘，agent 不手写 JSON）
- [x] 2.7 CLI 双参数 `--visual-adapter` / `--visual-model`：成对必填、归一化复用既有同款、CLI > local、
      unsupported 时 fail-fast 并列出 catalog 派生支持项
- [x] 2.8 manifest `visual_provider_pin` 条件入身份哈希 + 加载 shape 校验 + resume 读冻结值 +
      successor 继承 + 纯函数 `resolveFinalVisualProviderPin`

## 3. 三态路由与窄钳制（t2）

- [x] 3.1 `vision_mode` 派生纯函数（native / delegated / blind），preflight 派生一次、run 内不可变
- [x] 3.2 `CapabilitySnapshot` 可选键 `vision_mode` + `visual_provider`（写入者同批共享 `decision_id`）
- [x] 3.3 `FidelityCapability.reviewVision?` + `clampFidelityByCapability` 判据切换（旧调用面零改动）
- [x] 3.4 delegated 判定点传 `reviewVision: true`（phase advisory / harness-runner fidelityCtx / check-spec）
- [x] 3.5 `buildCapabilityBlock` delegated 分支 + `buildUnattendedExecutionBlock` 按 review 轴判
      pixel 可达性
- [x] 3.6 人签链与 OCR 链零改动（源码锚定回归断言）

## 4. 只读 invoke 执行器（t3）

- [x] 4.1 新模块 `utils/visual-provider-invoke.ts`：`resolveVisualProviderInvokePlan` 只构造只读
      `HeadlessInvokePlan`，不调用普通全权限 argv 构造器
- [x] 4.2 四 adapter 只读接线（claude / codex / cursor / opencode）与各自 `stdout_envelope` 正文投影
- [x] 4.3 统一经既有 `invokeAgentHeadless` 执行；timeout 仅走 `AgentInvokeOptions.timeoutMs`；
      usage 仅消费 `AgentInvokeResult.usage`；禁第二套 spawn/timer/tree-kill/terminal/message/usage parser
- [x] 4.4 统一载荷校验：schema + 全屏覆盖 + 身份回显 + 当前图片 hash；坏/旧/不符一律 `unavailable|invalid`
- [x] 4.5 脏检查第二防线（invoke 前后 `git status --porcelain`；变脏即丢弃 + 记事件，不 revert 不 halt）
- [x] 4.6 `visual_provider_invoke` 事件 + 结构化事件流落 `<report_dir>/visual-review/<invoke_id>/`
- [x] 4.7 预算：不占 `max_total_turns` / `max_retries_per_phase`；占 wall clock；per-purpose 批次上限

## 5. spec 观察 sidecar（t4）

- [x] 5.1 `<spec reports>/visual-observations/<slug>.visual.json` 产物与形态（slug 复用 OCR 同款）
- [x] 5.2 三元复用键（`image_hash` + `provider(adapter,model)` + `protocol_version`）
- [x] 5.3 生产时机与 dispatch 对齐 OCR 预扫描（spec 产、plan/coding 只列）；单图失败不阻断、不产 check
- [x] 5.4 `CapabilityAdvisory.visualObservationPaths` + 能力块列出
- [x] 5.5 验读证据 best-effort 如实记录（无解析器即 unverified，不构成门槛）

## 6. review 评审接线（t5）

- [x] 6.1 触发点：capture 完成后、严格 `dispatchDeviceVisualDiff` 之前；非 delegated 整体跳过；
      异步显式化（同步 check 包装器不得吞 Promise）
- [x] 6.2 逐屏输入与输出合同（全屏覆盖 / defects+must_fix 锚定 / 双图 hash 回显 / pixel 追加
      `region_attest` `vl_screening`）
- [x] 6.3 合法载荷原子覆盖写 `visual-diff.json`（写前清旧、禁跨 attempt 复用）；
      `VisualDiffDefectSource` 扩展 `{producer:'visual_provider', invoke_id}` 并同步 schema/校验
- [x] 6.4 harness 确定性 verdict 映射；provider 不产 verdict、不写 `confirmed_by`
- [x] 6.5 裁决契约：合法即物化 repair candidate；**不进** `defect-review` / `repair_adjudication_pending`
- [x] 6.6 fail-open 写死：`unavailable|invalid` → `visual_diff {BLOCKER, SKIP}`，不跑严格 dispatch
- [x] 6.7 critic receipt delegated 窄分支（路径校验按 provider 事件流；受理与披露分立；不 halt）

## 7. 回归、smoke 与收口（t6）

- [x] 7.1 t1 单测矩阵（唯一支持列表 / 家族不放行 / `goal_capability` 缺失不影响资格 / 授权矩阵 /
      双旗标成对 / 三形态询问语义 / 无人值守 WARN+blind / 显式 CLI fail-fast）
- [x] 7.2 t2 单测矩阵（三态派生 / run 内不可变 / `reviewVision` 缺省逐字回归 / delegated 放行 pixel /
      blind 钳制表不变 / OCR 链零改动）
- [x] 7.3 t3 单测矩阵（四 adapter 只读 plan golden / 全权限 argv 不可达 / 生命周期唯一性 /
      Codex 三事实消费 / 统一校验拒收矩阵 / 脏检查 / 批次上限 / 事件流落盘）
- [x] 7.4 t4 单测（三元复用键 / 单图失败不阻断 / 不产 check）
- [x] 7.5 t5 单测（fail-open 核心回归 / unverified 且合法照常回修 / 原子覆盖清旧 / 跨 attempt 拒收 /
      确定性 verdict 映射 / provenance 不触发 selfreport_integrity / receipt 双路径 / 人签零变化）
- [x] 7.6 typecheck + `cd harness && npm test` + `npm run openspec:validate`
- [ ] 7.7 四 adapter 最小真实 invocation smoke（**用户触发**；Claude 侧以 hook sentinel 证明未触发工程 hook）
- [ ] 7.8 两个完整 delegated 宿主闭环（同 adapter 异模型 / 跨 adapter 异模型；均验
      盲写→capture→provider 评审→物化回修→缺陷清零→candidate-pass→`await_human_confirm`→真人
      `confirmed_by`→重跑方 PASS）（**用户触发**）
- [x] 7.9 三组 unsupported 反向测试（`codeagent`/`chrys`/`generic`）
- [x] 7.10 文档同步（goal-manifest schema 说明 / personal-setup-gate / goal runbook / 交互态文档；
      只说明声明规则并指向 adapter catalog，不另枚举支持名单）
- [ ] 7.11 宿主 smoke 全过后方可 archive
