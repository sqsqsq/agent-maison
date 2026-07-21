# cc-spec-deadlock fixtures（plan 7c4f2e9b P0-0）

来源：2026-07-17 bc-openCard spec 五连败 HALT 事故（run 20260717T082925Z，宿主 claude CLI 2.1.212，
实际模型 MiniMax-M2.7）。原始归档 `D:\97.log\问题反馈\07-18\cc spec问题` 仅作 provenance，
**测试只依赖本目录**。

| 文件 | 内容 | 消费方 |
|------|------|--------|
| events-condensed.jsonl | 五 attempt 事件流（剔 heartbeat，35 行） | P0-5 超时棘轮重建 / P1-6 四轴报告回放 |
| i2-pass-artifacts/ | PASS 态最小产物（正确键 must_have_elements） | P0-3 e2e 回放 A 冻结对象 |
| i3-wrong-key-ui-spec.yaml | 事故终态 ui-spec 前 120 行（must_have 错键） | P0-2 schema/did-you-mean 回归 |
| ledger-deferred.jsonl | 账本 must_review=true 行（6 条实录） | P0-4 账本佐证/∩匹配测试 |
| minimax-init-event.jsonl | init 事件（model=MiniMax-M2.7，脱敏） | P1-9 model telemetry 解析 |
| canary-*.ndjson / .txt | stream-json 样卷六种（valid/盲/残卷/多 result/错误 result 含键/stderr 插行） | P0-1 envelope 归一判卷 |
| foreign-file-delta.json | i5 写 framework/ 的清单差异 | P1-10 foreign-file 复现 |
