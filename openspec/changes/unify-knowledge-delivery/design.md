## Context

实施设计以已独立评审通过的 [.cursor plan](../../../.cursor/plans/知识统一发现采纳与维护闭环_6c4e9a21.plan.md) 为准；本文件仅记录规格索引，不复制设计。

## Goals / Non-Goals

完整连接既有知识的发现、采纳和维护。保留原目录、解析器、授权和完成事实；不新增知识数据库、状态、phase 或 CLI。

## Decisions

共享 `assembleKnowledge` 与 renderer 由实际调用上下文现算，复用原 reader；静态 adapter 入口只给路径，实际读取仍以源文件为准。审查上下文与材料 fingerprint 同源。

## Risks / Trade-offs

字面候选可能漏义 → 保留完整索引并要求语义消歧；正文过大 → 原路径分批阅读。派生刷新可能越过 run 写集 → 默认相关 run 收口后在原授权内维护，run 内图文件须在 contracts.files。manifest 1.0 不自动升级，所有 adapter 经共享入口投影。
