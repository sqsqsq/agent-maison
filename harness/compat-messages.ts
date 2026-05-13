// 附录 B：固定 suggestion 模板（不得改措辞）
// `{feature}` / `{phase}` 由调用方 replace

export const SUGGESTION_CONTEXT_EXPLORATION_MISSING = [
  '两种解决路径任选其一：',
  '',
  '路径 A（推荐，正规化）：自动回填生成合规 context-exploration.md。',
  '  cd framework/harness && npm run backfill:context -- --feature {feature} --phases {phase}',
  '',
  '路径 B（临时，仅供过渡）：在 feature 自身目录写 compat.yaml 临时豁免。',
  '  路径：doc/features/{feature}/compat.yaml',
  '  最小示例：',
  '    schema_version: "1.0"',
  '    feature: {feature}',
  '    exempt_checks: ["context_exploration_*"]',
  '    reason: "<填写过渡原因>"',
  '    scheduled_backfill_by: "<YYYY-MM-DD，建议不超过 30 天>"',
  '  注意：',
  '    - compat.yaml 是 feature 过程态数据，请勿写入 framework.config.json。',
  '    - 过期后协议自动失效，请按期回填或更新期限。',
].join('\n');

export const SUGGESTION_COMPAT_APPLIED = [
  '本次 BLOCKER 已被 doc/features/{feature}/compat.yaml 降级为 WARN。',
  '回填完成后，请手动删除该 compat.yaml 文件以恢复严格门禁。',
  '回填命令：cd framework/harness && npm run backfill:context -- --feature {feature} --phases {phase}',
].join('\n');

export const SUGGESTION_COMPAT_EXPIRED = [
  'doc/features/{feature}/compat.yaml 的 scheduled_backfill_by 已过期，协议自动失效。',
  '必须立即二选一：',
  '  1. 跑回填脚本：cd framework/harness && npm run backfill:context -- --feature {feature} --phases {phase}',
  '  2. 更新 compat.yaml 的 scheduled_backfill_by（如延期，需补充 reason）。',
].join('\n');

export function fillCompatMessage(template: string, feature: string, phase: string): string {
  return template.replace(/\{feature\}/g, feature).replace(/\{phase\}/g, phase);
}
