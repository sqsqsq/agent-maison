// ============================================================================
// ut-template-paths.ts — business-ut 模板/示例路径的唯一解析点
// ============================================================================
// plan f4c8d2b7 t5：模板路径收编回既有 skill-assets SSOT。
// 此前存在三套平行真源：skill-assets.yaml（SSOT）、hmos-app ut-host-impl 的
// getUtSuggestionPaths() 硬编码表、check-ut.ts 无 host 回落的散文（且为幻影路径，
// skills/feature/business-ut/templates/ 不存在）。本模块统一为：
//   清单可解析 → 真实 repo 相对路径；
//   清单不可用 → `profile-skill-asset:business-ut/<key>` 占位符原文（可被人/agent
//   二次解析），绝不拼接猜测的物理路径。
// ============================================================================

import { loadFrameworkConfig } from '../../config';
import { loadSkillAssetsManifest, resolveSkillAssetPath } from './profile-skill-assets';

export type UtTemplateKey =
  | 'use_cases_schema'
  | 'dag_schema'
  | 'testability_audit_template'
  | 'mock_plan_schema'
  | 'sample_flow_dir';

export interface UtTemplateRef {
  /** 展示/文案用：真实 repo 相对路径，或占位符原文 */
  rel: string;
  /** 解析成功时的绝对路径（存在性断言/注入校验用）；回落时为 undefined */
  abs?: string;
}

export function resolveUtTemplateRef(
  projectRoot: string,
  profileName: string,
  key: UtTemplateKey,
): UtTemplateRef {
  try {
    const loaded = loadSkillAssetsManifest(projectRoot, profileName);
    if (loaded.ok && loaded.manifest) {
      const r = resolveSkillAssetPath(projectRoot, profileName, loaded.manifest, 'business-ut', key);
      if (r.ok && r.relRepo && r.absPath) return { rel: r.relRepo, abs: r.absPath };
    }
  } catch {
    // 清单读取/解析异常与「不可用」同待遇：回落占位符
  }
  return { rel: `profile-skill-asset:business-ut/${key}` };
}

/**
 * plan f4c8d2b7 t6：goal 模式 ut 阶段 prompt 注入的格式契约块（仅 ut 阶段消费）。
 * 两产物契约不同，必须分别陈述；路径为 t5 SSOT 解析结果，headless agent 无须走
 * profile-skill-asset 多跳协议即可直达。通用 skill 资产注入属 d8f4b7e2 extension
 * plan 范围——其落地后本块收编退役。
 */
export function renderUtFormatContractLines(projectRoot: string, profileName?: string): string[] {
  let profile = profileName;
  if (!profile) {
    try {
      profile = loadFrameworkConfig(projectRoot).project_profile.name;
    } catch {
      profile = '';
    }
  }
  const ref = (key: UtTemplateKey): string => resolveUtTemplateRef(projectRoot, profile!, key).rel;
  return [
    'UT machine-artifact format contract (deterministic gates parse these files):',
    `- testability-audit.md: fenced \`\`\`yaml block(s) OR pure YAML; root field records[]; Markdown tables are NOT machine-readable. Template: ${ref('testability_audit_template')}`,
    `- mock-plan.yaml: pure YAML only — NO fenced code block, NO Markdown headings/tables; root field spies[] or doubles[]. Schema: ${ref('mock_plan_schema')}`,
    `- DAG port_call_* nodes: boundary is an object {name,type,method}; boundary.name must match use-cases.yaml data_boundaries[].name. Schema: ${ref('dag_schema')}`,
  ];
}
