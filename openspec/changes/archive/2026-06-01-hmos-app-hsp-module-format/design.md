# Design: hmos-app HSP library format

## Decision

HSP 与 HAR 在 hmos-app profile 内**完全等价**对待：

- 均为 library format，对外通过 `oh-package.json5 main` → Index.ets 导出
- 无 `assembleHap` / TestAbility 约束（与现有 HAR 注释一致）
- 不为 HSP 引入动态分包 / 运行时差异化 harness 门禁

## Implementation

1. SSOT：`profile.yaml > catalog_allowed_module_formats` 追加 `HSP`
2. 共享判定：`har-export-resolve.ts` 导出 `isLibraryFormat(format?: string)`
3. 消费点：`catalog-entry-file-har.ts`、`catalog-key-exports-har.ts`、`coding-host-rules.ts`
4. 推断信号：Skill 0 以 `module.json5 > module.type === shared` 识别 HSP
5. 文档：Skill 2/3/4 与 reference 清除 HAR-only 旧认知

## Non-Goals

- HSP 专属约束（首包大小、分包边界 import 图）——另开议题，参考 atomic-service-roadmap 模式
- generic profile 或其他 profile 的 format 枚举扩展
