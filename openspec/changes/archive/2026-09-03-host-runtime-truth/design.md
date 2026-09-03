# Design — 宿主运行边界真值：实际 CLI、需求源图片与视觉证据可达性（plan c4e8a1f7）

## 1. 背景与根因链

三次宿主 run 连续暴露 runner 在输入/启动/证据边界丢失或混合了已掌握的确定性事实：

| run | 症状 | 根因 |
|---|---|---|
| 20260823T150444Z-61d8be | `adapter_probe` 记录 codex-cli 0.138.0，正式 invoke 独立返回模型兼容 400；同一硬失败跑两次 harness，伪归因 `spec_file_exists` | resolver 跨目录偏好 `.exe`（跳过 npm `codex.cmd`）；probe 用裸 token、正式 invoke 重新解析，身份无结构性同一保证 |
| 20260823T160926Z-426f2a | guardian `CreateProcess(CREATE_SUSPENDED)` error 5 退出码 2 被当普通内容失败，跑两次 harness | gateway 未把 guardian 自有的确定性建立失败投影为 `spawn_error`；消费侧不能仅凭 exit 2 分类 |
| 20260823T161102Z-68480b | Codex 已答对 inline canary，三轮 `capability_receipt=not_issued`，耗尽 content retry | 非结构化分支读含 prompt echo/stderr 的整份 `agent-output.log` 判卷；prompt 自带 `CANNOT_SEE_IMAGE` 污染分类；且无结构化 Read 事件却被指引追逐不可达的终签 |

另：CodeAgent 全权限 argv/stdin/stream-json/Read 链已存在，仅因 preflight 专门拒绝未进入
Goal-mode——用户已裁决放行；真实 CLI flag 风险由统一 hard-CLI 一次停机承接。

## 2. T1a Windows runtime 真值

### 2.1 解析规则（headless-binary-resolve.ts）

- adapter candidate-name 顺序不变（外层循环）；每个 name 内按 `where.exe` 输出序 / PATH 目录序
  逐候选检查，**取第一个明确受支持且可 spawn 的形态**，不再全局先找 `.exe`。
- 受支持形态：`.exe`；`.cmd/.bat`（cross-spawn 解包，guardian 已能安全解包 npm 标准 shim）；
  extensionless **仅当文件头为原生 PE（`MZ`）**。`#!/bin/sh` POSIX shim 与 ELF（`\x7fELF`）不得
  仅凭存在入选（Windows CreateProcess 对它们要么 Access denied、要么 ERROR_BAD_EXE_FORMAT）。
- `resolveViaPathWalk`：按目录原序，每个目录内按 PATHEXT 顺序取首个受支持候选——**不得跨目录**
  为 `.exe` 跳过前面目录的 `.cmd`。
- `headlessBinarySpawnable`：win32 上 `bare` 必须通过原生 PE 探测（纵深防御，与解析同源）。
- 被跳过/后置候选记入 `shadowed[]`（上限 10 条）供 `adapter_probe` 诊断展示。

### 2.2 session 级 binary 复用

- `runGoalPreflight` 返回 `{ binary, shadowed }`（dry-run WARN 路径返回 null）。
- goal-runner 把该结果用于三处，结构上保证同一身份：
  1. `probeAdapterVersion(resolved.path)`（.cmd 用 cross-spawn 探活，不再 shell:true 裸名）；
  2. `runVisionCanaryProbe({ resolvedBinary })` → `resolveHeadlessInvokePlan(..., resolvedBinary)`；
  3. 正式 phase `resolveHeadlessInvokePlan(..., resolvedBinary)`（内建 adapter 的 argv[0] =
     resolved.path；custom headless_invoke 不注入、维持原样）。
- resume 新进程重新解析（无跨进程缓存；`adapterVersionCache` 本是 per-process）。

### 2.3 硬失败共享分类（vision-canary.ts）

- 抽出 `resolveInvokeHardCliFailure(facts, opts?)` 共享纯函数，分类三源：
  1. `spawn_error` 在场（含 guardian 投影与 resolvedBinary 短路——同一种结构化事实）；
  2. CLI/config 参数不兼容（既有逐行锚定签名枚举）；
  3. **新增** Codex 结构化 `status=400 + invalid_request_error + requires a newer version
     of Codex`（stdout/stderr 内 JSON 信封精确签名，不维护 model→CLI 版本静态表）。
- `resolveCanaryHardCliFailure` 改为薄委托（既有签名/测试不动）。
- agent-invoke 边界：`opts.containment` 且 exitCode===2 且 stderr 含 `[maison-guardian]` +
  稳定 ASCII operation marker（`CreateProcess(` / `AssignProcessToJobObject` / `ResumeThread`）
  → 投影 `spawn_error={ code:'maison_guardian_containment_failed', message }`。
  不依赖本地化文本、不单凭数字 2（guardian 正常收尾会透传真实 agent exit code）。
- goal-runner 正式 phase invoke 后（invoke_end/settled 之后、harness 之前）调共享分类：
  命中 → `phase_halt(adapter_cli_hard_failure)` + incident(`adapter_cli_hard_failure`, class
  external) + outcome FAIL/halted → 零内容 retry、零 harness、零 receipt 生产。

## 3. T2 requirement source provenance + 共享参考图集合

### 3.1 来源保留

- `resolveRequirementInput` 返回 `{ text, sources }`：项目内文件 → 项目根相对正斜杠路径；
  项目外 → 保留绝对路径（只读正文、不扫描其 sibling）；inline → `[]`。
- `GoalManifest.requirement_source_files?`：fresh 写入（buildGoalManifestFromInput 保真解析 +
  shape 校验），条件入 `computeManifestIdentityFields`（键在场即入，旧 manifest 无键不受影响）；
  resume 只读冻结值；`inheritSuccessorManifest` 继承源列表并在显式 file 增量时去重追加。
- goal-mode-entry（prepareGoalModeRun）与 fidelity-intent-init 同源消费；fidelity-intent SSOT
  写可选 `requirement_source_files`（loader 校验数组形状，缺字段=legacy 兼容不判 corrupt）。

### 3.2 单一发现集合

`resolveRequirementReferenceImages(projectRoot, feature, requirement, opts)`：

1. 需求文本中锚定 features_dir 的显式路径引用 → 图片文件/目录内图片（既有
   `extractExistingRequirementPathRefs` 语义）；
2. UNION 项目内 source 各**直接父目录**一层的受支持图片（非递归、`.png/.jpg/.jpeg/.webp/.bmp`）；
3. canonical path 去重 + 确定性排序；
4. **仅并集为空**才回退 `feature/ux-reference/`。

inline requirement（无 sources）不触发 sibling 扫描；项目外 source 不扫描。本函数是唯一发现
实现：`discoverReferenceImagesForOcrPrescan` 委托它；capability `derive.visual-reference`、
OCR 预扫、phase prompt authoritative paths、refs receipt 生产/验证全部消费同一结果。
`verifyVlSigningChain` 从当前 run manifest（env `MAISON_GOAL_RUN_ID`）重算同一集合作为期望分母；
spec 漏声明任一发现图片 → FAIL（未读即 unread → 终签拒）。

## 4. T3 canary 判卷 SSOT 与能力/证据分轴

- 签发点（goal-runner spec phase inline canary）：删除 `isCanaryAnswerComplete +
  classifyCanaryResponse(raw)` 分叉；统一 `resolveCanaryCacheDecision`：
  - structured adapter：`stdout = agent-events.jsonl` 原文 + `structured_stdout: true`
    （parseCanaryAnswer 内做 final-result 投影）；events 缺失/无终态 → 不判卷不签发；
  - 非结构化 adapter：**只消费本次 invoke 的 `invoke.stdout`** 与
    exitCode/timed_out/silent_killed/skipped——不再读 `agent-output.log` 混合日志
    （stderr/prompt echo 不属于机器答卷；`invoke.stdout` 内存保留 64KB 上限足够答卷）。
  - `kind==='valid' && classify.verdict==='tool_read'` 才签 capability receipt；
    独立 `CANNOT_SEE_IMAGE`（canonicalAnswer 为盲声明）/纯回显/失败 invoke 一律不签。
- 能力与可审计性分轴：`tool_event_provenance==='structured_events'` 才允许 refs receipt 生产
  （既有门，Codex `none` 结构性不可签）；prompt/closure 块/retry guidance/spec skill 按
  provenance 明示可达出口：none → 图片可继续使用、产物诚实写 `verified: unverified`、
  软档 WARN 可继续 / hard contract FAIL（既有门禁不动）；
  structured_events → 本 invoke 逐图 Read 并争取 `vl_multimodal` 终签。

## 5. 边界（严格限定）

- 不自动安装/升级/卸载 CLI、不改 PATH；多版本共存合法（PATH 首选项决定身份，其余仅诊断）。
- 不加 live 模型兼容性试调用（首 invoke 确定性硬错误即时停机即可）。
- 不新建 binary registry / 版本 lockfile / reference-image manifest / 复制缓存 / 场外状态。
- 不降视觉信任门槛：soft WARN / hard FAIL、resume 验证优先、普通内容失败 retry 全部保持。
- 不给 Codex 新造 structured Read parser / receipt / 文本声称旁路；不接入未实采的
  `codex exec --json`。
- 不预猜 CodeAgent 未知 flag 错误文本；Chrys 拒绝保持原样；无新实验开关/授权状态。

## 6. 测试与验证

- 纯函数：解析顺序（npm `codex.cmd` 先于 WindowsApps `codex.exe`、shim 跳过、Cursor fallback）、
  guardian 投影正反例、共享硬失败分类（400 信封/普通 exit2/无诊断）、canary 判卷矩阵
  （echo+尾部真答卷签、纯 echo/盲声明/失败不签）、共享图片集合（UNION/去重/排序/回退/外源不扫）。
- runner 集成：正式 invoke 硬失败 → `phase_halt(adapter_cli_hard_failure)`、`harness=0`、
  `content_retry=0`（0.138 400 与 guardian error 5 两条冻结）；普通内容失败仍跑 harness。
- 三图贯通：sources 场景下 capability/OCR/prompt/refs receipt 使用同一集合；spec 漏一张 FAIL。
- 整批收口只跑一次：`cd harness && npm test`、`npm run openspec:validate`、
  `node scripts/check-plan-version.mjs`、`git diff --check`。
- 打包回灌后的 bounded 宿主验证（Codex 复放第三次事故路径；CodeAgent `--help`/version 先记录
  再最短 Goal-mode smoke）与 release 门禁留发布阶段，不在本 change 内执行。