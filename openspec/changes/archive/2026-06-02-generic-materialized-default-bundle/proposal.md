# Proposal: generic materialized 默认 bundle 物化

## What

规范 Skill 00 init 对 `generic` 在 `materialized_adapters` 中的行为说明，并补充 OpenSpec 场景：项目级物化清单含 `generic` 且缺省 `paths.agent_bundle_root` 时，harness 仍须以默认 `.agents`/inline 物化，不得因缺省而 STOP 或剔除。

## Why

init agent 误读 SKILL.md「非标路径 STOP」，在用户多选 `claude`+`generic` 时仅物化 claude。harness 已具备三层默认兜底；缺口在提示词/registry 约束与可测规格。
