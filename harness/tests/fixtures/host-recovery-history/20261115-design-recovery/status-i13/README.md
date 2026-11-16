# i13 公开状态回归

`questioning-output.json.gz` 解压后与已结束 i13 的原始交回逐字节相同，26 项中的 3 个 blocker、6 个 open_decision 未作替换。来源 SHA256 见 `sources.json`。`blueprint-scopes.json` 仅从对应前像抽取原范围身份，沿现有 questioning reader 解释原件；不是完整蓝图，也不用于业务准入。

原 request、前后快照只保留状态 reader 所需的调用/phase 身份与原始聚合 SHA；原始 19,328 项前后聚合 SHA 相等，重复条目被省略，不从当前宿主重新取样。裁决、执行和写入权均未由此生成。

`events.json` 保留真实 i12 HALT、同 run 恢复、i13 调用始末及 i14 作者启动的顺序和时间。测试仅在临时消费者目录调用公开 `goal-status --json`，先显示旧 HALT，恢复后显示活跃作者与真实 Q 计数；没有调用活动宿主或模拟业务通过。
