P3现行解释：本change入口诉求与保真契约保留；旧phase冷派工、总预算与只到allCU的终点方案由completion-driven-execution收编替换。现root持续到原真实部件终点，作者专用会话、独核和正式writer分责，显式用户截止/取消及真实工具保护有效；原实施记录不代表P4宿主验收。

## Why

新正式完整交付在尚无蓝图/CU 时被现行入口交回主会话，初始作者正常退出即可让原请求提前收尾。需要让原始需求从一开始进入既有 Goal 内核，持续完成设计、真实独立质询、CU 准入与已授权交付。

## What Changes

- **BREAKING**：替代“主会话先完成初始设计和 CU readiness 才创建 Goal”的现行策略；原始请求以既有 manifest 的初始设计输入变体受管，施工仍等待真实准入。
- 初建与设计修订共用作者、质询、检查、发布/恢复接缝；作者退出或报告 passed 不等于设计/产品完成。
- 以正常 CU run 出生及不可变来源连接原始请求，复用 P2 单并发推进；原请求止于全部适用 CU 正式完成。部件闭环仅按原口径只读检查一次并如实披露，不自动修复、写出、收口或改判。
- 原需求、来源、模型/视觉钉、超时、可信授权及当前有效总预算跨设计/CU/后继保持连续；会话与后台使用相同业务处置。
- 设计修订后，尚无 child/冻结范围的过时 scope 候选交原 scope 作者沿 `--prepare-scope --overwrite` 整份重算，再走原严格出生校验；新 root 只保存原输入明确请求的动作，不注入默认六阶段，既有起止边界和预算保持。
- 移出未开工 child 出生输入纠错、历史 root 阶段字段 override 迁移、额外阶段域组合、P3 自动收口/自动修复和 native 逐例解析扩展；正常 Feature/CU、UT、部件闭环验收口径不变。
- 同步入口、Skill、全部可命令 adapter 指引和 MIGRATION；保留仅设计、维护、单职责与 generic 的原终点和能力边界。

## Capabilities

### New Capabilities

无。复用现有 Goal、P1、P2、P3 能力。

### Modified Capabilities

- `complex-capability-meta-model`：新正式完整交付从原始需求开始受管，保留设计与施工职责边界。
- `goal-runner`：初始设计出生、设计/CU 自动接回、原请求完成与累计预算恢复。
- `goal-mode-skill`：薄入口直接接入受管设计，不再先在主会话完成设计。
- `change-unit-continuous-progression`：由共同 runtime 消费 P2 事实并连续推进，到全部适用 CU 正式完成后只读检查并披露原部件闭环。
- `runtime-policy`：原始请求授权和有效预算跨执行段同源，运输和来源定位不授予权限。
- `agent-adapters`：全部可命令 adapter 共用设计到施工交接，独立性与后台能力如实声明。

## Impact

影响 `GoalPhaseRuntime`、Goal manifest/birth、session next/report、launcher/supervisor、设计修订与 CU consumer、预算/状态/完成读取链及其回归。运行时 SSOT 仍在现有 `harness/`、`specs/`、workflow；不新增依赖，不改变发布件集成拓扑。MIGRATION 说明替代旧初始设计外置策略；已有有效蓝图、CU、run 与证据继续按原身份复用，直接只设计请求不启动施工。Node t7 实验停止并作废，不作为真实验收；t7 未完成，真实模型交付须用户安排宿主干净环境重跑。
