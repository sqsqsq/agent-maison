// ============================================================================
// spec · Visual Handoff 脚本守门（hmos-app / spec.visual_handoff capability）
// ============================================================================
// 实现位于 `framework/profiles/hmos-app/harness/`；由 capability-registry 经
// `harness/providers/spec-visual-handoff.ts` 加载。路径解析仍相对 `framework/harness/`。
// 规则 id 保持不变（fixtures / merged-report / phase-rules 依赖稳定 id）。
// ============================================================================

import {
  extractCodeBlocks,
  getSectionContent,
} from '../../../harness/scripts/utils/markdown-parser';
import { createRequire } from 'module';
import * as path from 'path';
import { resolveAuthoritativePath } from '../../../harness/scripts/utils/visual-source-resolver';
import { FIDELITY_SNAPSHOT_KIND, parseOnlineVisualHandoff } from '../../../harness/scripts/utils/fidelity-lock-shared';
import { relFeatureArtifact, VisualHandoffEnforcementMode } from '../../../harness/config';
import type { CheckContext, CheckResult, VisualHandoffResolutionRow } from '../../../harness/scripts/utils/types';

/** `yaml` 安装于 `framework/harness/node_modules`；本文件在 profile 树内，须从 harness 根解析依赖 */
const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

// --------------------------------------------------------------------------
// Visual Handoff（spec 内含根字段 ui_change 的 yaml 代码块）
// --------------------------------------------------------------------------

const UI_CHANGE_ALLOWED = new Set([
  'none',
  'reuse_only',
  'impl_out_of_band',
  'new_or_changed',
  'copy_edits_only',
]);

const UI_CHANGE_NO_REFS = new Set(['none', 'reuse_only', 'impl_out_of_band']);

const PATH_KINDS = new Set(['repo_assets', 'screenshot_pack', 'asset_pack']);
const URL_KINDS = new Set(['design_tool_link', 'design_system_doc', 'portal_only']);
/** 每条 ref 允许 path 或 url 至少其一 */
const HYBRID_KINDS = new Set(['figma_export_bundle']);
const ONLINE_SNAPSHOT_KINDS = new Set([FIDELITY_SNAPSHOT_KIND]);

const ALL_KINDS = new Set([...PATH_KINDS, ...URL_KINDS, ...HYBRID_KINDS, ...ONLINE_SNAPSHOT_KINDS]);

function buildVisualResolveOpts(ctx: CheckContext) {
  const vs = ctx.specVisualSources;
  return {
    projectRoot: ctx.projectRoot,
    externalRoots: vs?.external_roots,
    allowAbsolutePaths: Boolean(vs?.allow_absolute_paths),
    allowNetworkPaths: Boolean(vs?.allow_network_paths),
  };
}

interface AuthRefsOutcome {
  rows: VisualHandoffResolutionRow[];
  /** 非法结构、非法 URL、path 语法错误 → 应按 strict 语义处理 */
  blockingDetails: string[];
  /** path 语法合法但未 existsSync → WARN（reachable/warn）或 FAIL（implicit strict / explicit strict） */
  reachabilityDetails: string[];
}

function validateAuthoritativeRefs(ctx: CheckContext, kind: string, refs: unknown): AuthRefsOutcome {
  const rows: VisualHandoffResolutionRow[] = [];
  const blocking: string[] = [];
  const reach: string[] = [];

  if (!Array.isArray(refs) || refs.length === 0) {
    return {
      rows: [],
      blockingDetails: ['authoritative_refs 必须为非空数组'],
      reachabilityDetails: [],
    };
  }

  const ropts = buildVisualResolveOpts(ctx);

  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      blocking.push(`refs[${i}] 必须为对象`);
      continue;
    }
    const rec = r as Record<string, unknown>;
    const id = rec.id !== undefined ? String(rec.id) : `#${i}`;

    if (PATH_KINDS.has(kind)) {
      const p = rec.path;
      if (typeof p !== 'string' || !p.trim()) {
        blocking.push(`${id}：缺少非空 path（kind=${kind}）`);
        continue;
      }
      const resolved = resolveAuthoritativePath(p, ropts);
      rows.push({
        ref_id: id,
        declared_path: p,
        resolved_absolute: resolved.resolvedAbsolute,
        agent_reachable: resolved.agentReachable,
        resolution_kind: resolved.resolutionKind,
        ...(resolved.error ? { note: resolved.error } : {}),
      });
      if (resolved.resolutionKind === 'error') {
        blocking.push(`${id}：${resolved.error ?? 'path 非法'}`);
      } else if (!resolved.agentReachable) {
        reach.push(`${id}：${resolved.error ?? 'path 解析后不存在或不可访问'}`);
      }
      continue;
    }

    if (URL_KINDS.has(kind)) {
      const u = rec.url;
      if (typeof u !== 'string' || !u.trim()) {
        blocking.push(`${id}：缺少非空 url（kind=${kind}）`);
        continue;
      }
      rows.push({
        ref_id: id,
        declared_url: u.trim(),
        agent_reachable: true,
        resolution_kind: 'url_only',
      });
      try {
        const parsed = new URL(u.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          blocking.push(`${id}：url 仅允许 http/https`);
        }
      } catch {
        blocking.push(`${id}：url 不是合法 URL`);
      }
      continue;
    }

    if (HYBRID_KINDS.has(kind)) {
      const p = rec.path;
      const u = rec.url;
      const hasPath = typeof p === 'string' && p.trim().length > 0;
      const hasUrl = typeof u === 'string' && u.trim().length > 0;
      if (!hasPath && !hasUrl) {
        blocking.push(`${id}：figma_export_bundle 的每条 ref 须至少含 path 或 url`);
        continue;
      }
      if (hasPath) {
        const resolved = resolveAuthoritativePath(p as string, ropts);
        rows.push({
          ref_id: id,
          declared_path: p as string,
          resolved_absolute: resolved.resolvedAbsolute,
          agent_reachable: resolved.agentReachable,
          resolution_kind: resolved.resolutionKind,
          ...(resolved.error ? { note: resolved.error } : {}),
        });
        if (resolved.resolutionKind === 'error') {
          blocking.push(`${id}：${resolved.error ?? 'path 非法'}`);
        } else if (!resolved.agentReachable) {
          reach.push(`${id}：${resolved.error ?? 'path 解析后不存在或不可访问'}`);
        }
      }
      if (hasUrl) {
        try {
          const parsed = new URL((u as string).trim());
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            blocking.push(`${id}：url 仅允许 http/https`);
          }
        } catch {
          blocking.push(`${id}：url 不是合法 URL`);
        }
      }
      continue;
    }

    blocking.push(`未支持的 kind：${kind}`);
    break;
  }

  return { rows, blockingDetails: blocking, reachabilityDetails: reach };
}

function resolveRefsCheckResult(params: {
  desc: string;
  prdRel: string;
  uiChange: string;
  kind: string;
  enforcement: VisualHandoffEnforcementMode | undefined;
  outcome: AuthRefsOutcome;
  checkIdRefs: string;
  checkIdPass: string;
}): CheckResult[] {
  const { desc, prdRel, uiChange, kind, enforcement, outcome, checkIdRefs, checkIdPass } = params;
  const hasBlock = outcome.blockingDetails.length > 0;
  const hasReach = outcome.reachabilityDetails.length > 0;
  const soft = enforcement === 'warn' || enforcement === 'reachable';

  const baseExtras: Pick<CheckResult, 'affected_files' | 'visual_resolution_rows'> = {
    affected_files: [prdRel],
    visual_resolution_rows: outcome.rows,
  };

  if (hasBlock) {
    if (soft) {
      return [{
        id: checkIdRefs,
        category: 'structure',
        description: desc,
        severity: 'MAJOR',
        status: 'WARN',
        details: outcome.blockingDetails.join('；'),
        ...baseExtras,
      }];
    }
    return [{
      id: checkIdRefs,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: outcome.blockingDetails.join('；'),
      ...baseExtras,
    }];
  }

  if (hasReach) {
    if (soft) {
      return [{
        id: checkIdPass,
        category: 'structure',
        description: desc,
        severity: 'MAJOR',
        status: 'WARN',
        details: `agent-reachable=false：${outcome.reachabilityDetails.join('；')}`,
        suggestion: enforcement === 'reachable'
          ? 'reachable 档位：结构化合法但本机路径不可访问时降级为 WARN；请在 agent 可达环境复验或使用 URL 真源说明。'
          : undefined,
        ...baseExtras,
      }];
    }
    return [{
      id: checkIdPass,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: outcome.reachabilityDetails.join('；'),
      ...baseExtras,
    }];
  }

  return [{
      id: checkIdPass,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: `ui_change=${uiChange}，kind=${kind}；${outcome.rows.length} 条 authoritative_refs 结构化与可达校验通过`,
      ...baseExtras,
    }];
}

function parseVisualHandoffYamlRoot(prd: string): Record<string, unknown> | null {
  const blocks = extractCodeBlocks(prd, 'yaml');
  for (const b of blocks) {
    try {
      const doc = YAML.parse(b.content);
      if (
        doc !== null &&
        typeof doc === 'object' &&
        !Array.isArray(doc) &&
        Object.prototype.hasOwnProperty.call(doc, 'ui_change')
      ) {
        return doc as Record<string, unknown>;
      }
    } catch {
      /* 非本块或非法 yaml，继续 */
    }
  }
  return null;
}

function structureFailOrWarn(enforcement: VisualHandoffEnforcementMode | undefined): {
  severity: 'BLOCKER' | 'MAJOR';
  status: 'FAIL' | 'WARN';
} {
  const soft = enforcement === 'warn' || enforcement === 'reachable';
  return soft
    ? { severity: 'MAJOR', status: 'WARN' }
    : { severity: 'BLOCKER', status: 'FAIL' };
}

/** 供 harness / 白盒单测调用 */
export function checkVisualHandoff(ctx: CheckContext, prd: string): CheckResult[] {
  const enforcement = ctx.visualHandoffEnforcement;
  const desc = ruleDesc(ctx, 'structure_checks', 'visual_handoff');
  const prdRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');

  if (ctx.skipVisualHandoff) {
    const audit = process.env.HARNESS_SKIP_VISUAL_HANDOFF_REASON || '（未设置 HARNESS_SKIP_VISUAL_HANDOFF_REASON）';
    return [{
      id: 'visual_handoff',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: `已跳过 Visual Handoff 检查（--skip-visual-handoff）。审计说明：${audit}`,
      affected_files: [prdRel],
    }];
  }

  if (enforcement === 'off') {
    return [{
      id: 'visual_handoff',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: 'framework.config.json 中 spec.visual_handoff_enforcement=off',
      affected_files: [prdRel],
    }];
  }

  const pageSection = getSectionContent(prd, '页面/界面描述') ?? '';
  const longPage = pageSection.length >= 800;

  const doc = parseVisualHandoffYamlRoot(prd);
  if (!doc) {
    if (enforcement === undefined) {
      return [];
    }
    if (enforcement === 'strict') {
      return [{
        id: 'visual_handoff_ui_change',
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          'spec 未找到含根字段 `ui_change` 的 ```yaml``` 代码块；已 opt-in spec.visual_handoff_enforcement=strict。',
        suggestion:
          '每条 spec 须声明 Visual Handoff；若无 UI 形态诉求请设 ui_change: none。',
        affected_files: [prdRel],
      }];
    }

    const out: CheckResult[] = [{
      id: 'visual_handoff_ui_change',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details:
        '未找到含根字段 `ui_change` 的 ```yaml``` 代码块。参见 framework/skills/feature/spec/reference/visual-handoff.md',
      suggestion:
        '在 spec 中增加 Visual Handoff 块；若本需求不动 UI，请显式声明 ui_change: none。',
      affected_files: [prdRel],
    }];
    if (longPage && (enforcement === 'warn' || enforcement === 'reachable')) {
      out.push({
        id: 'visual_handoff_heuristic',
        category: 'structure',
        description: desc,
        severity: 'MAJOR',
        status: 'WARN',
        details:
          '「页面/界面描述」篇幅较长，但未声明 ui_change / Visual Handoff；请确认是否遗漏交接信息。',
        affected_files: [prdRel],
      });
    }
    return out;
  }

  const uiRaw = doc.ui_change;
  const uiChange = typeof uiRaw === 'string' ? uiRaw.trim() : '';
  if (!uiChange || !UI_CHANGE_ALLOWED.has(uiChange)) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_handoff_ui_change',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        `ui_change 非法或为空：${JSON.stringify(uiRaw)}。允许值：${[...UI_CHANGE_ALLOWED].join('、')}`,
      affected_files: [prdRel],
    }];
  }

  if (UI_CHANGE_NO_REFS.has(uiChange)) {
    return [{
      id: 'visual_handoff',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: `ui_change=${uiChange}：不要求 authoritative_refs；Visual Handoff 声明已识别。`,
      affected_files: [prdRel],
    }];
  }

  const vh = doc.visual_handoff;
  if (!vh || typeof vh !== 'object' || Array.isArray(vh)) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_handoff_refs',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: 'ui_change 要求补充 `visual_handoff` 对象（含 kind、authoritative_refs）。',
      affected_files: [prdRel],
    }];
  }

  const vhObj = vh as Record<string, unknown>;
  const kind = typeof vhObj.kind === 'string' ? vhObj.kind.trim() : '';
  if (!kind || !ALL_KINDS.has(kind)) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_handoff_refs',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        `visual_handoff.kind 非法或缺失：${JSON.stringify(vhObj.kind)}。允许：${[...ALL_KINDS].join('、')}`,
      affected_files: [prdRel],
    }];
  }

  if (ONLINE_SNAPSHOT_KINDS.has(kind)) {
    const online = parseOnlineVisualHandoff(vhObj);
    if (!online) {
      const { severity, status } = structureFailOrWarn(enforcement);
      return [{
        id: 'visual_handoff_refs',
        category: 'structure',
        description: desc,
        severity,
        status,
        details: `kind=${kind} 须声明非空 source_link（http/https）`,
        affected_files: [prdRel],
      }];
    }
    try {
      const parsed = new URL(online.source_link);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        const { severity, status } = structureFailOrWarn(enforcement);
        return [{
          id: 'visual_handoff_refs',
          category: 'structure',
          description: desc,
          severity,
          status,
          details: 'source_link 仅允许 http/https',
          affected_files: [prdRel],
        }];
      }
    } catch {
      const { severity, status } = structureFailOrWarn(enforcement);
      return [{
        id: 'visual_handoff_refs',
        category: 'structure',
        description: desc,
        severity,
        status,
        details: `source_link 不是合法 URL：${online.source_link}`,
        affected_files: [prdRel],
      }];
    }
    const extras = [
      online.delivery_code ? `delivery_code=${online.delivery_code}` : '',
      online.snapshot ? `snapshot=${online.snapshot}` : '',
    ].filter(Boolean).join('；');
    return [{
      id: 'visual_handoff',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: `ui_change=${uiChange}，kind=${kind}；source_link 格式合法${extras ? `；${extras}` : ''}（快照物化由 fetch_fidelity + fidelity_snapshot_promise 校验）`,
      affected_files: [prdRel],
    }];
  }

  const outcome = validateAuthoritativeRefs(ctx, kind, vhObj.authoritative_refs);
  return resolveRefsCheckResult({
    desc,
    prdRel,
    uiChange,
    kind,
    enforcement,
    outcome,
    checkIdRefs: 'visual_handoff_refs',
    checkIdPass: 'visual_handoff',
  });
}
