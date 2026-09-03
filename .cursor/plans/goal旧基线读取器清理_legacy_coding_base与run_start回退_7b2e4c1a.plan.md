---
name: goal 旧基线读取器清理
version: 3.2.0
deferred_to: 3.2.0
overview: >
  删除已由 run_created 时代边界隔离的 goal legacy 基线读取面；仅做兼容代码与对应测试清理，不引入
  新机制。2026-09-03 用户裁决：由 3.1.0 顺延 3.2.0——3.0.0 刚发布、旧 run 兼容窗口尚无结束证据，
  立即删除会让只有 run_start + coding-base.json 的旧 run 无法恢复；3.2.0 是"重新确认兼容窗口是否
  结束"的最早评估点，不预先保证届时一定删除，没有旧 run 已退出的证据就继续保留。
todos:
  - id: remove-legacy-coding-base-reader
    content: 删除 legacy coding-base.json reader、writer、路径与仅为其存在的类型和帮助函数
    status: pending
  - id: remove-run-start-birth-fallback
    content: 删除 run_start 出生时代回退分支，使 run_created 成为唯一出生事实
    status: pending
  - id: remove-compatibility-tests
    content: 删除仅验证 legacy coding-base 与 run_start 正向兼容的测试和夹具
    status: pending
  - id: retain-migration-negative-tests
    content: 保留并收窄迁移负面测试，确认旧残留会得到明确不可恢复诊断且现代 run 不回退
    status: pending
isProject: false
---

# goal 旧基线读取器清理（顺延 3.2.0 评估点）

## 目标

3.0.0 已停止生产 `coding-base.json`，并用 `run_created` 把现代 run 与 legacy reader
结构隔离。兼容窗口结束后物理删除该只读面，使出生与基线契约只剩现代路径。**窗口是否结束在
3.2.0 开窗时重新确认**（2026-09-03 顺延裁决）：有旧 run 已全部退出的证据才执行删除，否则继续
保留，本 plan 不预先承诺删除时点。

## 范围

本计划只删除 legacy coding-base reader、`run_start` 出生回退分支及其正向兼容测试；
迁移负面测试继续保留，用来拒绝旧残留被静默当成现代 run。不会新增状态文件、迁移器、
基线来源、授权通道或其他运行时机制。

## 验收

完成后，goal 基线只从 manifest 的 write-once `run_base_sha` 读取，出生只认每 run 唯一
`run_created`；旧残留得到明确诊断，结构零项与相关 harness 单测通过。
