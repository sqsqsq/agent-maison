# DSH 已结束调用用量原件

从 `20261115T073957Z-e7af8c` 的 i1–i14 已结束 `agent-events.jsonl` 只读抽取原生 `status/step_end` 的 turn、step 与 input/output/cacheRead 计数。每个原 SID 一对一替换为 `session-iN`；不保留路径、工具结果或对话文本。原件与脱敏夹具 SHA256、调用顺序见 `sources.json`。

冻结口径：918 个 step_end，新增输入 3,793,173，已观测缓存读取 346,986,496，输出 945,433。原生部分步骤未给 cacheReadTokens，缓存数字仅是已观测部分，不声称完整缓存总数，也不推断费用。i1–i13 为独立的 847 步截止，不能与 i1–i14 相加。

这只是原件计量回归，不代表新模型运行、分档实证或业务交付通过。
