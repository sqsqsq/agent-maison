# Agent Adapter 选择

## 列出可选项

扫描 `framework/agents/` 下**一级子目录**，每个包含 `adapter.yaml` 的目录即一个可选 adapter。

对每个 adapter，读取并展示：

- `adapter_name`
- `description`（YAML 里多行字符串取首段）

## 默认建议逻辑（可覆盖）

| 用户环境线索 | 建议 |
|--------------|------|
| 已大量用 Claude Code slash | `claude` |
| 已大量用 Cursor 跳板 / rules | `cursor` |
| 希望最少产物、通用 agent | `generic` |

## 落盘职责划分

- **AI（本 Skill）**：写 `framework.config.json` 的 `agent_adapter`；按选中 adapter 的 `adapter.yaml` 把模板拷贝到实例根；渲染 `AGENTS.md` / `CLAUDE.md`。
- **Adapter**：不承担 skill 正文，只提供文件模板路径（见 `adapter-schema.yaml`）。

## 切换 adapter 时的安全提示

必须告知用户：

1. 旧入口文件若与新 adapter 的 `target_path` 同名但内容模板不同 → 将被覆盖；请先备份。
2. `.claude/` 与 `.cursor/` **可能并存**：若从一侧切到另一侧，列出「建议删除或忽略的目录」让用户确认，**不要自动 `rm -rf`**。
