# Design: Extension manifest 1.1

## 单一数据流

`doc/extensions/manifest.yaml` 与其引用文件是唯一输入；loader 产出内存 bundle，`/extension inspect`、AGENTS/ai-prompt 投影、bridge 与 CheckResult 都从该 bundle 或磁盘产物派生，不落 extension 状态文件。

```text
manifest + 引用文件
  ├─ loader → knowledge / mcp_actions / phase_bindings bundle
  ├─ materialize → materialized_adapters[] 的派生 bridge + AGENTS/CLAUDE
  ├─ phase prompt → knowledge 索引 + before_phase_work 提示
  └─ check / receipt → produces 存在性与既有 M7 seam validator
```

## Manifest 形状

```yaml
schema_version: "1.1"
name: project-extensions
provides:
  skills: [story-input]
  knowledge:
    - path: knowledge/global.md
      summary: 全局业务约束
      audience: global
    - path: knowledge/spec.md
      summary: spec 输入
      audience: [spec]
  mcp_actions:
    fetch-requirement:
      tool: story.fetch_requirement
      required: true
      severity: BLOCKER
      produces: [doc/requirements/story.materialization.json]
      usage: /component-design 前由 extension Skill 调用
phase_bindings:
  spec:
    before_phase_work:
      - kind: knowledge
        ref: knowledge/spec.md
    before_phase_verify:
      - kind: mcp
        ref: fetch-requirement
```

- knowledge 字符串继续合法，语义固定为“全部 Feature phase 的索引行，不进 AGENTS.md”。对象的 `audience` 只接受 `global` 或 Feature phase id 数组；Skill 定向材料走既有 `skill_assets`。
- Feature phase 集从 active workflow 解析，取 full/lite 两条 track 的并集；workflow 不可解析、global phase 或未知 slug 均 fail-closed，不维护平行 phase 名单。
- `mcp_actions` 只接受 `tool/required/severity/produces/usage`；不接受 server、URL、token、command、登录配置。
- `phase_bindings` 只接受 `before_phase_work`、`before_phase_verify`、`after_phase_verify_before_close`，只管 Feature phases；不定义 `before_component_design`。
- binding 的 `ref` 必须解析到 manifest 内同类 declaration。mcp action 缺省 `severity=MAJOR`；只有 required action 缺 produces 才 FAIL，optional 只产降级报告。

## 执行与证据

- `before_phase_work`：AGENTS.md 只渲染每 phase 一行绑定提示；runner 组装 `ai-prompt.md` 时加入精确 knowledge/action 索引。执行本身由 agent 完成，check 时用 produces 兜底。
- `before_phase_verify`：runner 在既有 script CheckResult 集中验证 required produces。
- `after_phase_verify_before_close`：`check-receipt` 在既有 receipt 判定前验证 required produces，失败即不闭环；不改 receipt schema。
- 普通 produces 只校验项目内相对路径存在且为文件。若 JSON `artifact` 为 `requirement-source-materialization@1` 或 `blueprint-review-feedback@1`，调用 `blueprint-host-seams.ts` 的既有 validator；不复制 schema 与校验逻辑。
- `usage` 只供人读，不参与产物类型推断；只有实际 `artifact` 被识别且既有 validator 通过，inspect 才显示 M7 consumer/evidenced。未知或无法解析的 JSON 只按普通 produces 处理，M7 fail-closed 仍由扩展 Skill 显式调用既有 `--materialization/--feedback` 入口承担。
- CheckResult 自然进入现有报告/evidence 链；不新增 evidence 类型。inspect 的 evidenced 仅由 produces 文件及其 validator 结果派生；tool visibility 明标 `agent_self_report`。

## 兼容与切换

- 1.0：保留六域解析、knowledge 字符串、目录驱动 Skill 桥接；不消费 mcp_actions/phase_bindings，不向 AGENTS/ai-prompt 注入 knowledge。
- 1.1：Skill 桥接只物化 `provides.skills[]`；目录多出的 Skill 只报告漂移，不物化。
- 无 manifest/无目录：空 bundle、无投影、无门禁、无副作用。
- manifest 存在但非法：bridge 选择为空且 Feature harness/receipt 投影同一 loader 诊断为 BLOCKER；不得回退目录驱动。任何无 ownership 文件都保持 unowned/untouched，不自动接管，也不进入 orphan cleanup。
- `paths.extension_dir` 必须通过既有 `validateProjectRelativePath`；loader/init/materialize 均拒绝绝对路径、盘符和 `..`。

## 边界

不建 loader/registry/plugin runtime；不修改 Goal Mode events/receipt/evidence；不把 capability seam、Change Unit 依赖和 plan goal 依赖合图；不修改宿主 Story extension；不管理 MCP server 或凭据。
