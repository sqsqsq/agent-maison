# 单阶段核验的模型绑定

在当前客户端的主会话和工程内运行阶段 NEXT 给出的 `--execute-verifier` 命令。已有调用时继续等待原调用，已交回时读取原处置。以下选择规则用于该 request 第一次派发；无人值守调用者可转交同一任务已授权的模型绑定。

用户已明确选模时，按原任务授权转交 `--adapter-model <正式模型ID>`、`--adapter-provider <provider或endpoint>`、适用的 `--adapter-reasoning <设置>` 和 `--adapter-model-config <原生配置路径>`。前台已从本轮原生记录确认这些字段时，也可用同组参数转交。

| 当前客户端 | 用户未指定模型时 |
| --- | --- |
| Claude | 直接在本次主会话的 Bash 或 PowerShell 工具运行 NEXT 命令。入口按 `CLAUDE_CODE_SESSION_ID` 定位本工程的原生记录，将这条阶段命令对应到正在执行的主模型回合，并从前台生效的 Claude 配置读取路由及适用的推理设置。如果 Skill 已取得本次准确 session ID，可传 `--frontend-session-id`。前台已提供本轮关联的 `model.id` 时，也可连同实际路由、推理设置和 `settings.json` 来源转交。 |
| CodeAgent | 从本次 CodeAgent 主请求的原生记录提取正式模型 ID。结构化会话使用本次主调用的 `system/init.model`，再转交生效的 Claude 兼容路由、适用推理设置及 CodeAgent 的 `settings.json`。 |
| Codex | 在当前线程的 shell 工具运行 NEXT 命令，入口按线程 ID 和本次活动 turn 读取模型及推理设置，并继承该线程路由和实际 `CODEX_HOME/config.toml`。已取得准确轮次原件时，可传 `--frontend-request-file <rollout.jsonl> --frontend-session-id <线程ID> --frontend-request-id <turn ID> --adapter-model-config <实际 config.toml>`。 |
| deepseek-harness | 直接在本次会话的 shell 工具运行 NEXT 命令。入口按 `DSH_SESSION_ID`、`DSH_HOME`、`DSH_PROFILE_DIR` 读取该会话当前请求及实际 profile 的 `cordis.patch.yml`，并冻结路由。 |
| Cursor | 转交当前会话已选定的正式命名模型 ID 和 provider `cursor`。Auto、当前档位无法调用的命名模型及独立推理参数按现有模型能力处置。 |
| OpenCode | 在已加载 Maison 原生会话插件的项目内运行 NEXT 命令，入口使用 shell 工具的 session ID 和 call ID 执行原生 session export，定位发起该调用的消息，读取 `provider/model` 和 variant。已取得准确 export 时，传 `--frontend-request-file <export.json> --frontend-session-id <session ID> --frontend-request-id <消息 ID> --adapter-model-config <实际 .config/opencode 目录>`。 |
| Chrys／Generic | 当前适配器的精确模型回放能力限制仍适用。 |

查不到准确来源或来源相互冲突时，保留原 request 并按模型选择提示继续。模型目录用于核对已取得的正式 ID。前台提供的配置路径和绑定只携带可复用的路由元数据，认证仍由原生客户端处理。
