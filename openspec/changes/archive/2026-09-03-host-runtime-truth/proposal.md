## Why

2026-08-23 三次宿主 run 连续暴露 runner 边界真值缺口，另加一项 CodeAgent 产品裁决：
（1）Windows binary resolver 跨 PATH 目录全局偏好 `.exe`，跳过前面 npm `codex.cmd`；version probe
与正式 invoke 未绑定同一 absolute binary，0.138.0 的模型兼容 400 与 guardian `CreateProcess`
error 5 都被当普通内容失败、照跑 harness 并烧 content retry；（2）`--requirement-file` 只保留
正文、丢弃来源路径，bc-openCard-1 三张与权威需求文件同目录的真实参考图被误判不存在；
（3）Codex 已答对 inline canary，但非结构化分支读含 prompt echo 的人读混合日志全文判卷、三轮
拒签 capability receipt，同时被指引反复追求结构性不可达的逐图 Read 终签；另 CodeAgent 已具备
全权限 argv/stdin/stream-json/Read 链，仅因未宿主实测的专门拒绝分支无法进入 Goal-mode——用户
已裁决放行。本 change 统一修正 runtime 真值、requirement provenance 与视觉证据可达路由，
不降低既有视觉信任门槛，不新增账本/解析器/状态机。

## What Changes

- **T1a（P0）Windows runtime 真值**：删除 `.exe` 跨目录优先规则；adapter candidate-name 顺序
  不变，每个 name 内按 `where.exe`/PATH 目录原顺序取首个明确受支持且可 spawn 的 Windows 执行
  形态（`.cmd/.bat` 经 cross-spawn；extensionless 仅原生 PE（MZ）入选，POSIX/ELF shim 不得仅凭
  存在入选）。preflight 返回本 execution session 解析出的 binary，adapter version probe、vision
  canary 与正式 phase invoke 全部复用该绝对路径（resume 新进程重新解析）；`adapter_probe` 增补
  `resolved_binary` 与被遮蔽候选诊断，不建 registry/lockfile。既有 canary hard-CLI 判定抽成共享
  纯函数并增加已恢复的 Codex 结构化 `status=400 + invalid_request_error + requires a newer
  version of Codex` 精确签名；guardian 自有 CreateProcess/Assign/Resume 建立失败在 agent-invoke
  边界按 `[maison-guardian]` + 稳定 ASCII operation marker 投影为既有 `spawn_error`（不依赖本地化
  文本、不单凭 exitCode=2）。正式 phase invoke 命中硬失败 → harness 前直接
  `phase_halt(adapter_cli_hard_failure)`，incident 登记 external，零内容 retry、零伪
  `spec_file_exists` 归因；普通内容失败（含无 guardian 诊断的 exit 2）保持既有 harness/retry。
- **T1b**：删除 `assertAdapterHeadlessFullPermission` 对 CodeAgent 的专门拒绝（复用既有
  `--dangerously-skip-permissions`/stdin/stream-json/Read parser），Chrys 保持拒绝；
  adapter.yaml 注释与测试同步。
- **T2（P1）requirement source provenance + 共享参考图集合**：`resolveRequirementInput` 在仍只
  解析一次的前提下返回 frozen text + 可选 `requirement_source_files[]`；fresh goal manifest 持久化
  项目根相对来源列表并纳入 identity hash，resume 只读冻结值，successor 继承并在显式 file 增量时
  去重追加。goal-mode-entry 与 fidelity-intent-init 使用同一结果；fidelity-intent SSOT 以可选字段
  保留同一来源。单一 bounded discovery 集合 = 需求文本显式项目图片 UNION 项目内 source 直接父
  目录一层受支持图片（canonical 去重、确定性排序）；仅并集为空回退 `ux-reference/`；inline
  requirement 不触发 sibling 扫描、项目外 source 只读正文不扫描。同一发现结果同时作为
  `derive.visual-reference` 依赖、spec OCR 预扫、phase prompt authoritative paths 与
  `vision/spec-refs-receipt.json` 生产/验证的期望分母——spec 漏声明任一发现图片必须失败。
- **T3（P0）canary 判卷 SSOT + 能力/证据分轴**：inline canary 签发点删除
  `isCanaryAnswerComplete + classifyCanaryResponse(raw)` 分叉，统一复用
  `resolveCanaryCacheDecision/parseCanaryAnswer`：structured adapter 从纯 `agent-events.jsonl`
  终态取答卷，非结构化 adapter 只消费本次 invoke 的 `stdout` 与 exitCode/timed_out/
  silent_killed/skipped 事实（不读 stderr/prompt echo/人读混合日志）。有效尾部答卷可签
  capability receipt；独立 `CANNOT_SEE_IMAGE`/纯回显/失败 invoke 不签。能力与可审计性分轴：
  Codex 即使 canary=tool_read、`tool_event_provenance=none` 也不得签 refs receipt/`vl_multimodal`；
  prompt/closure 读图块/retry guidance/spec skill 按 provenance 明示可达出口（none → 图片照用但
  诚实 `verified: unverified`，structured_events 才要求本 invoke 逐图 Read 争取终签）。
  既有 soft/hard gate 复用：best-effort + WARN 可继续、hard contract 仍 FAIL、伪造
  `verified + vl_multimodal` 继续拒绝。
- **T4**：事故回归（Windows 四候选选 npm `codex.cmd`、Cursor fallback；0.138 事故 400 冻结为
  `formal_invoke_attempts=1`、`harness=0`、`content_retry=0`；guardian error 5 冻结为
  `guardian_attempts=1`、`agent_process_started=0`、`harness=0`、`content_retry=0`；普通内容失败/
  无 guardian 诊断 exit 2 仍跑 harness；prompt echo + 尾部真答卷签 capability receipt、纯 echo/
  独立盲声明/失败 invoke 不签；Codex none-provenance + best-effort/reachable + unverified 为
  WARN、hard contract FAIL）+ 契约文档收口。验收测试与 typecheck 后整批收口只跑一次
  `cd harness && npm test`、`npm run openspec:validate`、plan/version/diff 检查。打包回灌后的
  bounded 宿主验证与 release 门禁留发布阶段。

## Capabilities

### New Capabilities

- `goal-runner`：正式 phase invoke 的 CLI/guardian 硬失败在 harness 前早停
  （`adapter_cli_hard_failure`，external，零内容 retry）；session 级 resolved binary 复用
  （probe/canary/invoke 同一绝对路径）；inline canary 判卷统一 SSOT
  （`resolveCanaryCacheDecision/parseCanaryAnswer`）；参考图共享发现集合作为 refs receipt
  生产/验证期望分母；prompt/closure/retry/skill 的 provenance 分轴可达出口。
- `agent-adapters`：CodeAgent 进入 headless 全权限 supported 集合（Chrys 保持拒绝）。

### Modified Capabilities

- `goal-runner`：canary 硬失败分类从金丝雀探测专用扩展为共享纯函数（正式 invoke 同源复用并新增
  Codex `status=400 + invalid_request_error + requires a newer version of Codex` 精确签名）；
  `--requirement-file` 来源列表进 manifest 身份哈希与 fidelity-intent SSOT；参考图发现从
  `ux-reference/`/正文显式路径两级扩展为「正文显式 ∪ source 直接父目录」单集合。
- `harness-gates`：`vision/spec-refs-receipt.json` 生产与验证的期望分母改为共享发现集合；
  spec 漏声明任一发现图片失败（禁止 agent/spec 自缩分母）。

## Impact

- 代码：`harness/scripts/utils/headless-binary-resolve.ts`、`agent-invoke.ts`、`vision-canary.ts`、
  `goal-manifest.ts`、`fidelity-shared.ts`、`capability-resolution*.ts`、`critic-receipt-producer.ts`、
  `goal-preflight.ts`、`goal-runner.ts`、`goal-mode-entry.ts`、`fidelity-intent-init.ts`、
  `utils/adjudication.ts`（incident 注册）、`agents/codeagent/adapter.yaml`、
  `skills/feature/spec/SKILL.md`、`profiles/hmos-app/harness/spec-visual-handoff-check.ts`（分母复核）。
- 测试：`headless-full-permission`（CodeAgent 放行）、`headless-binary-resolve`（顺序/spawnable）、
  `goal-canary-hard-cli-d7f3a9c4`（400 签名）、新增 `host-runtime-truth` 单测套
  （guardian 投影、正式 invoke 硬失败早停、三图贯通、canary SSOT 判卷矩阵）。
- 消费者迁移：manifest 可选新增 `requirement_source_files`（旧 manifest 无键不受影响，
  身份哈希条件包含）；fidelity-intent SSOT 可选新增同名字段（旧 doc legacy 兼容，不判 corrupt）。

## Migration

- `MIGRATION.md` 增加一节：`requirement_source_files` 是可选字段，旧 manifest/SSOT 继续可
  resume/复核；参考图发现语义变更（source 直接父目录一层扫描）只对携带来源列表的新 run 生效，
  旧 run 行为不变（正文显式路径 + ux-reference 回退）。