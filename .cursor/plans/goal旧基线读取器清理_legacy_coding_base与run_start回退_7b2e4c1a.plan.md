---
name: goal 旧基线读取器清理
version: 3.1.0
deferred_to: 3.1.0
overview: 在 3.1.0 窗口删除已由 run_created 时代边界隔离的 goal legacy 基线读取面；仅做兼容代码与对应测试清理，不引入新机制。
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

# goal 旧基线读取器清理（3.1.0）

## 目标

3.0.0 已停止生产 `coding-base.json`，并用 `run_created` 把现代 run 与 legacy reader
结构隔离。3.1.0 在兼容窗口结束后物理删除该只读面，使出生与基线契约只剩现代路径。

## 范围

本计划只删除 legacy coding-base reader、`run_start` 出生回退分支及其正向兼容测试；
迁移负面测试继续保留，用来拒绝旧残留被静默当成现代 run。不会新增状态文件、迁移器、
基线来源、授权通道或其他运行时机制。

## 验收

完成后，goal 基线只从 manifest 的 write-once `run_base_sha` 读取，出生只认每 run 唯一
`run_created`；旧残留得到明确诊断，结构零项与相关 harness 单测通过。
