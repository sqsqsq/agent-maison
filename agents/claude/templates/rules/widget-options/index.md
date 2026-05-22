# Claude widget-options 索引（registry → SSOT）

> **部署路径**：`.claude/rules/widget-options/`（init UPDATE 从 `framework/agents/claude/templates/rules/widget-options/` 递归拷贝）。
> **消费方**：`.claude/rules/confirmation-ux.md` + 各 Skill slash；调 **AskUserQuestion** 时 **逐字引用** label。

| registry id | class | widget SSOT 文件 |
|-------------|-------|------------------|
| `catalog.staging_module` | enum | skill0-catalog-options.md § staging |
| `catalog.staging_glossary` | enum | skill0-catalog-options.md § staging |
| `catalog.seed_tech_word` | enum | skill0-catalog-options.md § seed_tech_word |
| `prd.feature_path` | enum | skill1-prd-options.md § feature_path |
| `prd.terminology` | artifact_checkbox | skill1-prd-options.md § terminology_gate |
| `prd.terminology` matrix | — | skill1-prd-options.md § terminology_row |
| `prd.freeze` | enum | skill1-prd-options.md § freeze |
| `design.scope_expansion` | freeform_approval | skill2-design-options.md § scope_expansion |
| `design.ok_to_code` | enum | skill2-design-options.md § ok_to_code |
| `design.arch_impact` | enum | skill2-design-options.md § arch_impact |
| `design.split_table` | enum | skill2-design-options.md § split_table |
| `coding.scope_stop` | enum | skill3-coding-options.md § scope_stop |
| `coding.module_batch` | enum | skill3-coding-options.md § module_batch |
| `coding.deps_abc` | enum | skill3-coding-options.md § deps_abc |
| `review.module_name` | enum | skill4-review-options.md § module_name |
| `review.report_save` | enum | skill4-review-options.md § report_save |
| `ut.plan_confirm` | gate | skill5-ut-options.md § plan_confirm |
| `ut.mock_plan` | enum | skill5-ut-options.md § mock_plan |
| `ut.src_mutation` | freeform_approval | skill5-ut-options.md § src_mutation |
| `ut.dag_confirm` | enum | skill5-ut-options.md § dag_confirm |
| `testing.module_name` | enum | skill6-testing-options.md § module_name |
| `testing.packaging` | enum | skill6-testing-options.md § packaging |
| `testing.plan_confirm` | enum | skill6-testing-options.md § plan_confirm |

init 系列见 Skill 00 + [adapter-widget-options.md](../../../framework/skills/00-framework-init/templates/adapter-widget-options.md)。
