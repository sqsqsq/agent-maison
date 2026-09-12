# P3 设计内容交接夹具

这四份 YAML 是现有 ledger-refresh CU 选中目标的精确设计内容：acceptance、contracts、runtime 和 use-cases。`blueprint-skill-projection.unit.test.ts` 将它们放入 canonical 蓝图选中目标，按当前 CU 重绑 refs，然后通过真实 resolver、物化入口及 spec/plan checker 消费。

contracts 中的 `planned:` 引用表示尚待 P4/P5 实现的精确文件和验证落点；它们不是已实现代码或已通过测试。runtime 的 flow 身份和 sidecar 的 CU 身份由既有 resolver 补齐，避免蓝图嵌入自己的字节哈希。

该夹具可交 P4/P5 继续做字段、数据流和分层消费测试；不代表真实业务宿主已验收。不得将它的 refs 或 YAML 形状当作实际 PASS。
