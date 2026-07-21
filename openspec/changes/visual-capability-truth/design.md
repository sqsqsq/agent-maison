# Design — visual-capability-truth

S1 协议定案（plan e9c4a7f3 五轮 review 冻结的落地细则；本文件为 schema/事件协议 SSOT，
实施不得偏离——偏离须回本文件修订并留痕）。

## 1. 三轴模型与唯一解析器

### 1.1 三轴（不得用单一优先级链互相覆盖）

```ts
interface EffectiveVisionContext {
  vision_capability: {
    verdict: 'tool_read' | 'native' | 'none' | 'unknown';
    scope: 'adapter_declared' | 'run_probed' | 'invocation_bound';
    evidence: { canary_receipt_ref?: string; binding_path?: 'route_equality' | 'inline_canary' };
  };
  artifact_attestation: Record<string /* artifact sha256 */, {
    verdict: 'verified' | 'contradicted' | 'unverified';
    reasons: string[];       // evidence_gap 归 unverified，reasons 区分「缺证」与「未验」
    receipt_ref: string;
  }>;
  effective_policy: {
    mode: 'visual' | 'blind_safe';
    downgrade_reasons: string[];   // fail-closed meet：任一未解除的降级原因 ⇒ blind_safe
  };
}
```

- `vision_capability` 只由路由绑定/canary/invoke proof 决定（轴内取新鲜度内最强证据）；
- `artifact_attestation` 按 artifact hash 逐产物；contradiction 仅同 hash 继承；
- `effective_policy` 对全部降级原因做 **fail-closed meet**（任一在场即 blind_safe）；
- **invocation_bound 只能提升 vision_capability，不能解除 artifact 限制或 policy 降级**；
- 降级解除仅两途：runner 显式 `vision_policy_supersede` **append-only event**；或**绑定新
  artifact hash 的 verified attestation**（新 hash = 重新生成/修复后的产物重新走验证）。

### 1.2 解析器签名与调用纪律

```ts
resolveEffectiveVisionContext({
  projectRoot, feature,
  runId,           // run_probed 不跨 run
  phase,
  invokeId,        // invocation_bound 仅对绑定 invoke 有效
  artifactHashes,  // 需要判定的产物 hash 集
}): EffectiveVisionContext
```

**唯一消费入口**：prompt 注入（Vision: YES/TRY/NO）、spec/coding/testing 各 gate、盲档
kit 派生、fidelity 判定一律经此函数；禁止任何消费面直读 framework.local.json vision 节
或 `ui-spec.verified` 自行判级。轴证据来源（receipt/event）持久化为 runner-owned
append-only 文件（见 §10 artifact 布局）。

## 2. invocation_bound 签发协议

签发者恒为 runner（信任根）。二选一，agent 自报一律无效：

- **路径 A（可信模型路由绑定）**：本 invocation 的 adapter/provider/model/CLI args（由
  runner 拉起参数或 CLI 结构化事件证明）与 canary receipt 同名字段 + invocation
  fingerprint 全等。模型标识不可证明（cursor auto 路由等）→ 路径 A 不可用。
- **路径 B（同 invocation 内嵌 canary）**：同 invoke_id 内依次完成：runner 出题随机视觉
  challenge → runner 判卷 → authoritative refs 验读（结构化工具事件）→ 业务产出。

两路径皆不满足 → 恒 `run_probed`。canary receipt 增维：
`provider / model / native_image_input / image_tool_available / probe_context`
（能报则报，报不了 `model: 'unknown'`——unknown 恒不超过 run_probed，且 canary 缓存降为
session 级：goal 每 run 复测，不跨 run 复用）。

## 3. vl_multimodal 终签硬化

`ui-spec verified_method: vl_multimodal` 有效的充要条件（check 侧全部机器校验）：

1. 签发时 `vision_capability.scope = invocation_bound`；
2. authoritative reference 每张的 hash 有对应验读工具事件（invoke_id 绑定，复用
   critic-receipt-producer 结构化事件解析 + runner attestation；未读清单非空 → 不可签）；
3. 该 ui-spec artifact hash 的 attestation ≠ contradicted；
4. adapter 无事件解析器（当前除 claude 外）→ 条件 2 结构性不满足 → 不可签（诚实回落
   human_gate 或盲档；解析器按 adapter-tool-event-provenance.md 盘点流程逐个注册）。

canary 只证「能看测试图」，不证「读过本需求参考图」——条件 1 与 2 分别校验，缺一不可。

## 4. 反证器 `vision_output_counterevidence`（spec 阶段）

扫描面（精确字段，非 must_have_elements——那是 id 列表）：`componentNode.text`、
`global_elements[].texts`、text-bearing 节点 `source_ref`、ref-elements 绑定的 OCR
provenance。

三态分离（审计语义不得互相冒充；两态同样使 vl_multimodal 失效、同样可降 blind-safe）：

- **contradicted（已证明矛盾，BLOCKER）**：声明引用图片 hash 与实际文件不符；U+FFFD/
  非法代理对；文本与高置信 reference 证据明确冲突；声明已读但工具事件证明未读；
- **unverified / evidence_gap（证据不足）**：OCR 低置信文本入 UI（OCR 自己不确定 ≠ UI
  一定错）；text 无 source/reference 映射；provenance 缺失；adapter 无解析器；
- **启发式（首版 observe-only：WARN + 计数落盘，不降档不 BLOCKER）**：字典外比率/单字符
  碎片/品牌词不在词典/双通道语义不一致——两轮真实 run 数据回灌后再定阈值升级。

`artifact_visual_attestation` 落独立 runner-owned receipt（ui-spec schema 顶层
additionalProperties:false，不塞既有产物）。

## 5. nav schema 2.0

```jsonc
{
  "schema_version": "2.0",
  "screens": {
    "<screenId>": {                    // overlay 沿用 OVERLAY_SEP 归一化后的 id
      "steps": [ { "touch": { "by_text": "卡包" } } ],
      "identity": {
        "all_of":  [ { "text": "添加银行卡" }, { "text": "招商银行" } ],
        "any_of":  [],
        "none_of": [ { "text": "管理非本机卡片" } ],
        "proposed": false              // 自动预填候选=true；未经确认不参与 gate 判定
      }
    }
  }
}
```

- 成员类型：`{ "text": ... } | { "id": ... } | { "route": ... }`；
- **最低强度**：≥2 个「独特」文本，或 1 个强 id/route；「独特」机器判据 = 候选在目标屏
  reference corpus 存在 **且** 其他全部 P0 屏 corpus document_frequency = 0；不满足 →
  只能以文本组联合唯一或 id/route 构成身份；
- 兼容：旧顶层 `Record<screenId, NavStep[]>` 继续可读（steps-only 无 identity），loader
  归一为 2.0 内存形态，写回一律 2.0；提供迁移/候选生成命令（候选恒 `proposed: true`）；
- 强制策略：pixel_1to1 的 P0 屏缺**已确认** identity → FAIL（BLOCKER）；其余 WARN；
- 候选生成来源：`componentNode.id` / `componentNode.text` / `global_elements` /
  ref-elements source mapping，按跨屏判别度排序。

**采集顺序**：`navigate → dump uitree → identity gate → screenshot → canonical write`；
身份不匹配 → `screen_identity_mismatch`，截图归档 `_mismatch/` 留证，**不写正式目录**，
`visual_diff_capture` 按缺失处理。

## 6. UTF-8 链路边界

Node 侧（steps 文件 UTF-8 写入、spawnSync utf-8 解码）已在位。本 change 边界：

1. `buildHylyreSpawnInvocation` env 注入 `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8`
   （device test 与 visual nav 两条 spawn 路径）；
2. vendored Hylyre wheel steps/配置读取显式 `encoding="utf-8"` 审计——wheel 可修改性与
   重建/manifest 升级为前置任务；不可修改则 env + sitecustomize 兜底并记录边界；
3. round-trip doctor **走真实链路**：写含中文 steps JSON → Hylyre parser → selector
   predicate 回读逐字节比对（非 echo stdout）；失败 → BLOCKER 阻断 device testing，
   归类 toolchain/环境（b4e7a2c9 契约）；
4. 验收含真实 Windows 中文系统 E2E。

## 7. 改码分类与授权链（goal 回退前置）

**runner 级 source drift reconciliation**：review 闭环后每个可变阶段（ut/testing）
phase 结束时 runner 统一对账（复用 attestation diff 面 → 结构化 `changed_files` +
per-file 归因）。

| 变更归因 | 动作 |
|---------|------|
| 本 run 本 phase 授权范围内 | 不触发 |
| UT seam mutation 命中可信授权链 | 自动回退 + 增量重点复审注入 review |
| testing 期产品改码（未授权） | HALT（人工裁决后可显式授权回退） |
| out-of-scope 模块改码 | HALT / scope expansion 决议 |
| 外部并发/归因不明 | HALT（避免覆盖用户修改） |

**可信授权三源**（拒收：agent 自写 `approved_by`、`user_requirement` 泛化哨兵、headless
自产 gap-notes、无文件范围宽授权）：真人 confirmation receipt；runner 预定义安全 policy；
pre-run manifest。授权 receipt schema：

```yaml
run_id / phase / allowed_files / allowed_change_kind / max_files /
source_inventory_before / approved_by /
authority_kind: human | runner_policy | pre_run_manifest /
authority_ref / manifest_hash_at_run_start / manifest_entry_id / receipt_hash
```

`pre_run_manifest` 源：runner 在 `run_started` 事件冻结 manifest hash，授权判定只引用
该快照（运行中补写的可变 manifest 不构成授权）。实际 diff 超出 allowed_files /
max_files / change kind → 翻转 unauthorized → HALT。

## 8. 持久化回退状态机

事件集（append-only events.jsonl）：`phase_invalidated`（被失效 phase/attempt/receipt
引用 + 归因）→ `phase_backtrack_requested`（分类依据）→ `phase_backtrack_started` →
`phase_backtrack_completed`。规则：

- 回退上限 1 次（从 events 计算，进程重启不清零；超限 halt 求人）；回退消耗 total
  turns 与 wall budget；`--resume` 从 events 重建回退状态；
- **invalidation 消费者矩阵**（全部只见最新有效 attempt；验收含端到端断言）：
  `upstream_verdict_gate` / `collectCleanPassIssues` / feature completion 生成 /
  upstream closure preflight / `--resume` 起点推导 / goal report outcomes /
  progress.json phase 状态 / receipt & snapshot 版本选择 / review closure freshness /
  ut & testing summary 读取；
- 环境类失败（`device_locked` 等）→ 常驻 summary 附 `failure_layer: environment`，
  upstream gate 文案给精确指引（仍拦截不降门禁）。

## 9. ledger 单写者 + journal 协议

- goal 态 agent 侧 harness 不直写正式 ledger；中间轮写
  `intermediate-rounds.journal.jsonl`；交互态维持直写；
- journal 行 schema：`schema_version / invoke_id / sequence / previous_proposal_hash /
  proposal_hash / source_fingerprint / build_fingerprint / screens_hash /
  gate_fingerprint / structured round input（完整输入面）`；
- **逻辑历史**：goal 态 `evaluateVisualRound` 历史 = committed ledger 基线 + 本
  invoke_id 的 journal proposals 拼接视图（no-progress 熔断语义保全）；
- **runner 收编 = 顺序重放**：从 ledger 基线按 sequence 重放，重算每轮
  base_state_hash/decision/row_hash（journal 自带 decision/fused 仅对照）；全一致 →
  写正式行 + event；任一不一致 → halt；
- hash 链证明力边界（规格如实声明）：可检非尾部删行/插行/乱序/改行；**尾部截断属
  非密码学边界**（需 runner 文件观察器/head checkpoint/IPC broker 锚定，本 change
  不承诺）；
- 过渡加固（单写者分批落地期间）：收养需 invoke_id 精确绑定 + 三链指纹一致 + 行序
  单调 + 每 invocation 中间轮上限 + 逐行 recovery event + resume 不重复收养；跨
  attempt/历史行改动仍熔断。

## 10. artifact 布局与 S6/S7 契约

新 artifacts（feature-artifact-layout delta）：

- `<feature>/vision/capability-receipt.json`（runner-owned，append-only 事件另记
  goal-run events）；`<feature>/vision/artifact-attestations.jsonl`；
- `<feature>/goal-runs/<runId>/intermediate-rounds.journal.jsonl`（按 goal run 隔离——
  attempt 序号跨 run 重号，feature 级共享文件会被旧 run 同号行污染；行内 goalRunId
  双保险，见 goal-runner delta）；
- contracts.yaml `integration_points[]`：`consumer_module / provider_module /
  requires_modification / entry_symbol`；
- test-plan.md 顶层 `test_case_flow` YAML machine block（tc_id 为 key；与 Markdown TC
  集完全一致性门禁）：`precondition: { kind: fresh_app|after, tc|tcs, reset:
  restart|clear_data|fixture_reset }`；after 支持多前置与传递 blocker；引用校验
  （不存在/环/断链 → 派生期 FAIL）；reset 命令失败 → environment failure
  （BLOCKED_BY_ENV）；`BLOCKED_BY` 非 PASS——进 P0 分母、阻 completion、
  `device_test_run` 仍 FAIL，仅根因三分（root-fail/blocked-by/independent-fail）；
- locator-required 分母（P1-H）：identity anchor 成员 / bbox 几何断言目标 /
  forbidden-overlap 参与元素 / must_have_elements / region attest 元素 / 交互目标 /
  UI kit block 实例锚点；calibrate（WARN+落盘）→ 两真实宿主 run 验证 → enforce
  （pixel_1to1 P0 覆盖 <80% BLOCKER；enforce 前任务保持 pending）；
- 结构保真拆轴：`static_structure_conformance`（coding，现状保留）+
  `runtime_mount_conformance`（testing，以 uitree 挂载树为证据）→ 视觉轴聚合；
- asset 轴 provenance 继承：testing 无本阶段 asset 检查时继承**证据引用**（source
  summary hash / source & build fingerprint / gate fingerprint / 资产 inventory hash /
  debt ledger revision 全一致才继承；任一漂移**或任一链不可比（缺指纹/缺记录）**→
  STALE/UNVERIFIED needs_human）。硬比对现状（tasks 7.2a/7.2b 拆分）：summary hash /
  source（attestation reconcile + inventory aggregate_sha256）/ gate fingerprint /
  asset 域 debt revision（coding summary 落盘 `asset_debt_revision`，testing 重算比对）
  四链已落地；**build fingerprint 链 pending（7.2b）**——coding 期无设备构建身份可锚，
  须 profile build 身份钩子（hylyre 实机采集）落地后接入，落地前不虚标"五指纹全比"；
- 资产实例绑定四段链：`node.asset_ref → manifest key/resource path → source binding →
  runtime node locator`（业务字段不入规格，bc-openCard 多银行同 logo 仅作 fixture）。
