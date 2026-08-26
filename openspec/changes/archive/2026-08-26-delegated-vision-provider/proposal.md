## Why

宿主现实是「强编码模型无多模态 + 多模态模型编码弱」。当前一次 goal run 只绑定一个
`(adapter, model_pin)` 执行身份，主模型盲即整 run 盲档：`hasVision=false` → `clampFidelityByCapability`
一刀切把 `pixel_1to1` 钳到 `semantic_layout`/`reference_only`，语义视觉评审环节整体空缺。
外置 VL 与换模型都不可用；能用的只有「再起一个只读的第二 endpoint 看图」。

本变更引入**只读视觉 provider**：显式 `(adapter, model)` 第二 endpoint，在 capture 之后对逐屏
产结构化评审，合法结果直接物化为回修候选驱动 primary 修复。治理原则两句话：

- **对 provider 结果 fail-closed**——坏结果、旧结果、身份/hash 不符的结果一律不采信；
- **对开发循环 fail-open**——provider 不可用只降级本轮视觉反馈，按盲档语义继续，
  release 保持 `VISUAL_PENDING`，绝不 halt、绝不停等、绝不制造假 PASS。

首期唯一硬边界：**provider 不能写工程，也不能用旧的或坏的结果制造 PASS。**

## What Changes

- **三态视觉路由**：`native`（primary 有视觉，现状链零变化）/ `delegated`（primary 盲 + provider
  配置在场且静态资格通过）/ `blind`（其余，现状盲档地板）。`vision_mode` 在 preflight 派生一次、
  run 内不可变；**不新增 provider canary**——真实调用即探测，调用成败只决定「本轮视觉反馈是否
  采信」，不反向改写能力真值、`vision_mode` 或 manifest。
- **窄钳制**：`FidelityCapability.hasVision` 保留 primary 语义不改名，新增**可选**
  `reviewVision?`；`clampFidelityByCapability` 判据换为 `reviewVision ?? hasVision`——旧调用面逐字
  不变，仅 delegated 判定点传 `reviewVision=true`，效果是 delegated 放行 `pixel_1to1`。
- **provider 身份**：`ProviderRef {adapter, model}`（model 必填），三形态配置入口（普通交互态一次
  性询问 / attended goal 创建 manifest 前 / 无人值守只读不问），CLI 双参数
  `--visual-adapter` + `--visual-model`（成对必填），manifest `visual_provider_pin` 条件入身份哈希
  并由纯函数 `resolveFinalVisualProviderPin` 单点裁决。
- **支持列表唯一真源**：`agents/<adapter>/adapter.yaml` 新增 `visual_provider
  {readonly_invoke, image_transport, stdout_envelope, model_replay}`；**完整声明本身就是 provider
  支持与运行资格**，运行时由 adapter catalog 扫描派生。禁止 TypeScript 白名单、adapter 家族推断、
  文档手写支持列表等平行真源；普通 `goal_capability` **不参与** provider 资格判定。首批只有
  `claude/codex/opencode` 声明；`codeagent/chrys/generic` 首批不声明、不可作 provider。
  `cursor` 第一期**不入册**（tasks 7.7 实测：argv 与 stdin 传输面成立，被服务端以
  「免费档只能用 Auto、不可指定模型」拒于账号面，与 model 真实回放要求互斥）；其
  `ask_mode` / `result_json` 机制留在词表内并有单测覆盖，第二期补回声明即恢复资格——
  这正是「机制 id 而非厂商名」换来的收益：撤一个 adapter 不动运行时一行。
- **unsupported 按输入形态分流**：普通交互态与 attended goal 在「local 缺失、不可读或现有 adapter
  不在 catalog 支持列表」时提示一次并允许重选，明确跳过即本次盲跑授权且不重复询问；无人值守读到
  旧 local unsupported/unavailable 时 WARN + 忽略，并进入统一启动矩阵；显式 CLI
  `--visual-adapter` unsupported 时 fail-fast 并列出 catalog 派生的支持项。**不自动改选 Claude、
  不在多个 provider 间 fallback。**
- **UI blind 启动须一次明确授权**：primary canary 尝试后复用 effective image-input 真值；UI + primary
  blind + 无合法 provider 时，只有 `--allow-blind-visual` 才放行，否则正式 phase 前 BLOCKER。旗标冻结
  为 manifest `allow_blind_visual: true` 并条件入身份哈希，不写 personal local；resume 复用冻结值，
  successor 剥离后重新授权。canary CLI 硬失败保持更高优先级，dry-run 只报 `would_block`，已合法启动的
  delegated run 在 provider 运行时失败仍走原有 fail-open。
- **物理只读 invoke**：新增 `utils/visual-provider-invoke.ts`，只构造独立只读 `HeadlessInvokePlan`，
  绝不复用普通全权限 argv（`--dangerously-skip-permissions` / `--sandbox danger-full-access` /
  `--force --trust`）；所有真实调用统一进入既有 `invokeAgentHeadless`——**不得重写或旁路 child
  spawn、timeout/tree-kill、terminal failure 优先仲裁、stdout/stderr 汇集或 usage 回填生命周期**。
  invoke 前后 `git status --porcelain` 对比作为脏检查第二防线。
- **spec 期观察 sidecar**：`<spec reports>/visual-observations/<slug>.visual.json`，地位与
  `ocr/<slug>.ocr.json` 逐字对齐（best-effort 上下文、非门禁产物、不产 check、单图失败不阻断）；
  复用键 = `image_hash + provider(adapter,model) + protocol_version` 三元齐等。
- **review 评审接线**：capture 完成后、严格 `dispatchDeviceVisualDiff` 之前调用 provider；合法载荷
  经原子覆盖写入 `visual-diff.json` 逐屏 `must_fix`/`defects`（写前清旧、禁跨 attempt 复用），
  `VisualDiffDefectSource` 扩展 `{producer:'visual_provider', invoke_id}`；harness 确定性映射逐屏
  verdict，provider 不产 verdict、不写 `confirmed_by`。
- **裁决契约最小 delta**：合法 provider 输出 = **可直接回修的 critic candidate**，直接物化 repair
  candidate；**不进 producer 感知信号的 `defect-review` / `repair_adjudication_pending` 停等管线**
  （该管线原样服务 T8 感知信号）。无效输出 = 丢弃 + events 记录 + 本轮按 blind 语义继续：
  provider `unavailable|invalid` 时不对 pending 屏执行严格 dispatch，改为返回既有 `visual_diff`
  CheckResult `{severity:'BLOCKER', status:'SKIP'}`，经既有「非 MINOR SKIP → `needs_human` 债务 →
  visual `UNVERIFIED`、release BLOCKED」链达成「循环 PASS / visual UNVERIFIED / release
  VISUAL_PENDING」三态并立。
- **receipt 如实披露、非物化门槛**：delegated 下 critic receipt 记 provider 真实 adapter/model，
  `input_provenance` 有解析器且事件可证为 `verified`、否则 `unverified`；受理与披露分立——
  `unverified` 且载荷合法照常用于回修，无效仅指载荷校验失败。receipt 任何情况不 halt、不进
  `repair_adjudication_pending`。

**显式非目标**：provider canary / 多槽化；OCR 分轴改造（无 canary 即无污染源，OCR 链零改动）；
`hasVision` 全局改名；图片暂存复制；新 UNVERIFIED check 载体 / 新质量轴 / 新状态机 / 新 check id；
稳定 finding 身份层与输出载荷签名（降后续加固）；provider 池、自动 fallback、自动推荐；
按 phase 切控制权；provider 的 owner/phase 状态机/closure/第二 gate；人签判据改动。

## Capabilities

### New Capabilities

- `delegated-vision`：三态视觉路由、只读视觉 provider 的调用与采信契约、观察 sidecar，
  以及「结果 fail-closed × 循环 fail-open」的治理不变量。

### Modified Capabilities

- `agent-adapters`：`visual_provider` 完整声明成为 provider 支持与资格的唯一真源。
- `framework-local-config`：`vision.visual_provider` 个人级配置字段与写入纪律。
- `goal-runner`：provider 身份的 CLI 入口、manifest 冻结与授权裁决；感知信号裁决管线的
  最小 delta（provider 缺陷是独立 critic candidate 源，不进停等管线）。
- `visual-diff`：provider 评审载荷的写入 provenance、确定性 verdict 映射、fail-open SKIP 出口，
  以及 delegated 形态下 critic receipt 的窄路径分支。

## Impact

- 主要影响 `harness/scripts/utils/{visual-provider-invoke,types,fidelity-shared,framework-local-config,
  config-field-ownership,goal-manifest,goal-manifest-cli,adapter-catalog,agent-invoke}.ts`、
  `harness/scripts/{goal-runner,check-testing,check-spec}.ts`、
  `profiles/hmos-app/harness/visual-diff-check.ts`、`agents/adapter-schema.yaml` 与
  `agents/{claude,codex,cursor,opencode}/adapter.yaml`。
- **启动契约收紧**：未配置 provider 的非 UI 或 native 工程行为不变；UI + primary blind 的新 run
  现在必须配置合法 provider 或显式传 `--allow-blind-visual`。旧 manifest 无
  `allow_blind_visual` 键仍可加载，但想在 resume 时新增授权须走 `--override-manifest`；旧
  `visual-diff.json`、旧 `CapabilitySnapshot` 与 provider 运行时 fail-open 语义不变。
- 文档同步：goal-manifest schema 说明、`skills/reference/personal-setup-gate.md`、goal runbook、
  交互态文档——**只说明声明规则并指向 adapter catalog，不另枚举支持名单**。
- 宿主 smoke 全过前不 archive；smoke 与 push 均由用户触发，不构成 framework 发版门禁依赖。
