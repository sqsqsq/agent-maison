## Context

实施 plan b2d7f4e9（`.cursor/plans/完成后演进与增量恢复统一_评估入口与successor出口_b2d7f4e9.plan.md`）§3.3 与 §3.6 的 change-unit-continuous-progression 部分。复用既有 `evaluateChangeUnitCarryForward`、`validateChangeUnit` 与 canonical CU 落盘原语，不开新协议。

## Goals / Non-Goals

**Goals:** 蓝图升版后已完成 CU 不必新建 id 重走全链；CU 身份只有一条规则；`revises` 退出生成路径。

**Non-Goals:** 不放宽 `resolveComponentBlueprintRef` / `resolveChangeUnitRef`；不改 carry-forward 判据；不建 semantic diff、registry 或新命令。

## Decisions

1. **写入者**：原位升版挂在设计准备段（`change-unit-design-preparation.ts`，与 `acceptChangeUnitDecomposition` 同模块），在 `deriveDesignPreparationReadiness` 派生前调用一次，结果以 `blueprintRefs.{bumped, skipped}` 返回。推进循环没有 readiness/入口调用，不重复接入；它遇到指针漂移沿现状报 carry-forward 原因并路由回 `/component-design`。
2. **候选判定**：owner ref 身份（revision / source_fingerprint / artifact_sha256）等于当前蓝图 → 跳过（幂等）；三处指针身份不一致 → skipped（契约变化，不是指针漂移）；CU 绑定 revision 高于当前 → skipped；carry-forward 不通过 → skipped 带其原因。
3. **写入**：新 CU 由原文件字节重新解析后只改三处身份字段与 `revision`；全部候选先过 `validateChangeUnit`，任一 BLOCKER 即抛 `change_unit_blueprint_ref_bump_rejected`、整批不落盘；落盘复用 `writeCanonicalChangeUnit`（temp→rename），中途失败以原字节回滚。
4. **完成观察措辞**：P2 adapter 只从 `assessFeature` 投影，`INCOMPLETE` 取代 `STALE`，附 uncovered 清单。实现由同 plan 的评估入口 todo 承担。

## Risks / Trade-offs

- 按原字节解析再序列化，YAML 注释不保留；由 consumer writer 写出的 CU 本身没有注释。
- 在旧蓝图 identity 下原位手改契约字段（所有指针仍一致）无法与原稿区分：没有历史副本可比，reconcile 会把它当指针漂移升版。该改动本身已使 Feature 的 `change_unit_ref` 失配，由评估入口判 plan 义务 uncovered。

## Migration Plan

无消费者迁移：旧 CU 的 `revises` 字段照常可读；已完成 CU 在下一次 `/component-design` 交接时自动升版。归档随 plan b2d7f4e9 的 t5。

## Open Questions

无。
