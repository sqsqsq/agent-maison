# `hmos-app` · Skill `00-framework-init` profile addendum

本 profile 初始化时预期落地 **宿主 ArkTS/HarmonyOS 风格**的工程元数据：`architecture` 五外层 + 模块内四层、`paths` 指向 `doc/` 下 SSOT、harness toolchain 段落常含 **DevEco / hvigor** 占位。

## 宿主专属资产

| 用途 | 路径 |
|------|------|
| Profile 能力与 phase overlay 注册 | `framework/profiles/hmos-app/profile.yaml` |
| 各 Skill 模板/参考（含 3/5 等） | `framework/profiles/hmos-app/skills/` |
| AGENTS 入口 SSOT/guardrail 片段 | `framework/profiles/hmos-app/templates/agents-md/*.partial.md` |
| init 缺省 doc 骨架（architecture / module-catalog） | `framework/profiles/hmos-app/doc-skeletons/` |

`/framework-init` 写入 **`framework.config.json` 前应已声明或默认 `project_profile.name: hmos-app`**（或由用户显式选其它 profile）；渲染 `AGENTS.md.template` **必须**走 `render-agents-md.mjs`，使上述 partial 与生成的入口 Markdown 对齐。
