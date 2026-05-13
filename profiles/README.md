# Project profiles（工程类型模板）

与 `framework/agents/<adapter>/` **正交**：

- **adapter**：Claude / Cursor / generic — 决定入口文件、rules、hooks 等 IDE 集成形态。
- **profile**（本目录）：`hmos-app`、`generic` 等 — 决定 HarmonyOS / 文档型等 harness 能力与 phase-rules overlay。

激活方式：实例根 `framework.config.json` 的 `project_profile.name`（及可选 `sub_variant`）。未声明时 harness 默认 `hmos-app` 以保持历史行为。

扩展新 profile：新建 `framework/profiles/<id>/profile.yaml`，按需添加 `phase-rules-overlays/`、`harness/` 实现与 `skills/` addendum。

## 加载顺序

1. `config-defaults.json`：为 `framework.config.json` 缺失字段提供 fallback。对象递归填补，数组与标量只在用户未显式配置时采用默认值。
2. `profile.yaml`：声明 `capabilities`、`phases_disabled`、`catalog_allowed_module_formats` 与 overlay 目录。
3. `phase-rules-overlays/`：在基础 `framework/specs/phase-rules/*.yaml` 之后合并。
4. `skills/<skill>/profile-addendum.md`：阶段 Skill 的宿主补充说明。
5. `harness/providers/`：当 capability 可执行时由 `framework/harness/capability-registry.ts` 动态 require。
6. `harness/prompts/verify-<phase>.overlay.md`：若存在，追加到 verifier prompt 末尾。

## Capability Provider 契约

每个可执行 provider 模块必须导出：

- `provider.id`：与 `profile.yaml > capabilities.<key>.provider` 一致。
- `provider.capability`：与 capability key 一致，例如 `coding.compile`。
- `provider.exports`：列出 registry 可调用的导出函数。

`capability-registry` 会在调用前校验上述 metadata，并在 provider 缺失、metadata 不匹配或导出函数缺失时给出明确错误。

## 回归基线（fixtures）

_profile 重构后，`cd framework/harness && npm test`（unit + fixtures）应保持 **零失败**。`run-tests.ts` 扫描根为 **相对 `framework/` 的路径表** `FIXTURE_TREE_ROOTS_REL_TO_FRAMEWORK`（见 `harness/tests/run-tests.ts`）：含 `harness/tests/fixtures/`（多为说明）、`profiles/hmos-app/...`（`init`/`prd`/`v2_2`）、`profiles/generic/...`（如 `profile_generic`）。新建 profile 的契约基线时请落盘对应目录并把该树根 **追加到该常量表**。逻辑名冲突会抛错。
