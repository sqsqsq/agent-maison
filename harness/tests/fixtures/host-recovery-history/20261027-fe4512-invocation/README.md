# fe4512 调用完成与链外进度最小片段

原件路径、SHA-256、原始行号与截取方式见 `sources.json`。采集仅通过文件只读，未执行宿主命令、assess、readiness、probe，未改变宿主或手机。

`events.prefix.jsonl` 保留首个 run_start 和 2026-10-27 当前会话截至 07:15:56.571Z 的连续原始事件，省略此前执行历史。它只复现当前 span/工作面错读；不是全 run 预算证据，不能用于凑出或证明历史 30 次调用。相同夹具修前修后 attempt=1、turns_used=1、阶段 started_at 不变。`manifest.projection.json` 是原 manifest 的必要键投影，未复制业务需求全文。

四份 canary 文件仅为真实会话原始 task_complete 答卷行；不是 CLI turn.completed 原始 stdout。四次原随机卷答案未保留，不能由答卷完整推断历史判卷正确。`detach.canary.txt` 保存原诊断第 1、489、5096、5639 行；这些行显示 exit1 且曾以无关 WARN 作为原因。

日志只记录原件最终 path/mtime/size/hash，不复制日志内容。链外日志最终 mtime=07:16:47.652Z 晚于截点，不能用于证明 07:15 活跃。隔离回放将占位日志 mtime 显式构造为截点前 1000ms；旧 plan 日志采用原件真实 mtime。真停滞反例则在隔离目录构造超过软阈值的当前调用日志。任何协议等价测试输入与这些时间均是构造，不能冒称现场事实。
