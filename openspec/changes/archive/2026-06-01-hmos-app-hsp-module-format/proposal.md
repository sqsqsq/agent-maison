# Proposal: hmos-app profile 支持 HSP library format

## Why

HarmonyOS 工程除 HAP/HAR 外还有 HSP（动态共享库）。当前 hmos-app profile 的
`catalog_allowed_module_formats` 与 har-only harness 检查只认 HAP/HAR/AtomicService，
导致 catalog 画像、术语表与 design/contracts 链路无法正确建档 HSP 模块。

## What Changes

- `profiles/hmos-app/profile.yaml`：`catalog_allowed_module_formats` 增加 `HSP`
- 引入 `isLibraryFormat(format?)`（HAR/HSP 等价库模块语义），替换 catalog/coding 中
  `m.format === 'HAR'` 硬编码
- 同步 hmos-app Skill 0/2/3/4 提示词、overlay 描述与 runbook
- 单测 + catalog/coding 集成夹具覆盖 HSP

## Impact

- **Scope boundary**：仅限 **hmos-app profile** 支持 HSP library format；**不**扩展为
  framework 全局 HSP 能力；generic 等其他 profile 的 `catalog_allowed_module_formats` 不变
- Affected specs: harness-gates
- Affected code: `profiles/hmos-app/**`, `harness/scripts/utils/types.ts`（注释修正）
