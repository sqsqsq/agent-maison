# e2a4145e 原件接续验收（2026-11-06）

基线 `83038a6b`，开发仓 main；本批只做验收，无生产实现修改。宿主 `D:/1.code/SimulatedWalletForHmos` 仅只读，未接续宿主原 run。两个副本位于系统临时目录 `maison-e2-original-eTXJwB`，通过公开 `runGoalModeSessionStep`（attended / forceTakeover / 原范围自主授权）恢复，在首个新业务请求签发后停止，未调用真实模型。

| 回放 | 原件与结果 |
|---|---|
| ① i16 已交回、i17 未派发 | 以 i17 的 `blueprint-before.yaml` 还原蓝图，事件截于 i17 start 前。正式入口直接签发 `initial-design-author-i17`；i16 的 9 个否定 scope、原问题全文（其中已有具体字段、文件和依据描述）全部进入该作者请求，没有新质询。 |
| ② 实际 i172 停点 | 保留原始全部末尾事件（i171/i172 余额不足、failed 及 process_settled），蓝图为现场现存原件。正式入口复用最近有效 i170 的 12 个否定，首个新派发为同一 run 的 `initial-design-author-i173`，原问题全文全部送达。 |
| 产物及写界 | 两次 i1 作者 `draft-output.yaml` 与宿主原件 SHA-256 相同；历史事件前缀逐项一致。仅副本移走历史 `.runner.lock/liveness/run-control` 为 `.original`，防止使用宿主进程句柄；业务输入及原稿未代答。复制源 4323 个文件前后哈希全部相同。 |
| 评审投影 | 两个真实副本的现有投影分别展示 9 / 12 个 blocker。既有 `blueprint-review-design` 的三条 questioning outcomes 用例全部通过，覆盖未决、待人决定、改稿后关闭、撤回折叠、原件相对链接及无效交回不改文档字节。 |

断言结果：[e2-verified](remaining-3.1.0-e2-verified.json)。回放脚本：[e2-replay](remaining-3.1.0-e2-replay.cjs)。投影测试：[projection-tests](remaining-3.1.0-e2-projection-tests.json)。Claude Code CLI 只读复核记录：[e2-review](remaining-3.1.0-e2-review.json)。调用形态为 `claude.cmd -p --model opus --effort high --permission-mode plan --tools Read,Grep,Glob --allowedTools Read,Grep,Glob --settings <disableAllHooks> --strict-mcp-config --mcp-config <empty> --output-format json --no-session-persistence`；实际模型以 JSON 的 modelUsage 为准。

`test:changed` 已通过：1 个实跑组、1 passed / 0 failed、复用 924 组，424 个正式组未执行；另有投影 3/3。Claude 实际模型 `claude-opus-5-5`，无必须修复意见。现场 blocker 没有独立 `answer` 字段，单独的 `verification_refs` 数组尚未拼入作者指令；因此只证明原问题全文送达，不声称转发了整个原对象。脚本现支持 `--verify-existing` 重新核对保存的真实结果，并只检查存在的文本字段。

本批最终全量在总交接报告统一登记；`verify-design-loop` 维持 in_progress，等 P4 的一次完整全量及红项处置结束后按实际结果收口。宿主上原 run 的真实续作仍未执行。

## 检视返修复验（2026-11-06）

修正首轮只证明问题正文的缺口：现在每项否定在作者反馈中携带自己的完整 `verification_refs` 数组。回放脚本只有在 scope、question、可选 answer 和整个原数组均通过断言后，才写 `fullDenialDelivered: true`；旧首轮结果仅作历史问题正文证据，不作为依据数组已送达的证明。

执行 `node harness/reports/remaining-3.1.0-e2-replay.cjs --replay-existing`，从原先保留的两个隔离副本再建副本，用其 Git 基线恢复原始事件和蓝图，未重新读取宿主、未接续原副本上的新作者。正式入口结果：i16 的9项否定共99条依据、i170的12项共168条依据全部逐项送达，缺失均为0；仍只签发作者i17/i173，没有新质询。历史尾部、i1作者原稿和两个来源副本的复制源字节均未变；评审投影仍为9/12个未决blocker。

见[返修复验结果](remaining-3.1.0-e2-review-verified.json)。e2定向14/14通过，含大正文真实进程、格式恢复、有效否定与scope收敛；最终影响验证和Claude只读复核见总交接报告。本次未运行完整全量或打包，收口todo继续依实际门禁保留。
