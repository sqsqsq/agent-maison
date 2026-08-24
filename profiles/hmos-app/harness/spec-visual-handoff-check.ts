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
import { resolveRequirementReferenceImages } from '../../../harness/scripts/utils/fidelity-shared';
import { FIDELITY_SNAPSHOT_KIND, parseOnlineVisualHandoff } from '../../../harness/scripts/utils/fidelity-lock-shared';
import { relFeatureArtifact, VisualHandoffEnforcementMode, featureDir } from '../../../harness/config';
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
  const baseResults = resolveRefsCheckResult({
    desc,
    prdRel,
    uiChange,
    kind,
    enforcement,
    outcome,
    checkIdRefs: 'visual_handoff_refs',
    checkIdPass: 'visual_handoff',
  });
  // plan c4e8a1f7 T2（评审 P1 修复）：声明分母复核**收进既有 Visual Handoff 检查**——
  // 只在此分支（authoritative_refs 形态合法、通过既有 applicability/--skip-
  // visual-handoff/enforcement=off 处理）后追加，不构成平行门禁。
  const denominatorResults = visualReferenceDenominatorCoverage(ctx, prd);
  return denominatorResults.length > 0 ? [...baseResults, ...denominatorResults] : baseResults;
}

/**
 * plan c4e8a1f7 T2（评审 P1 修复）：参考图发现集合的**声明分母复核**——spec 漏声明任一
 * runner 发现图片必须失败，禁止由 spec 自己缩小分母（宿主实锤：bc-openCard 三张真实
 * 参考图在权威需求文件同目录，正文/ux-reference 两级输入均漏，被误报不存在）。
 * 分母=goal run manifest 冻结 requirement + requirement_source_files 经共享发现集合
 * 重算（与 goal-runner refs receipt 生产/验证同一函数）。
 *
 * 与既有视觉手令门禁的关系（评审 P1 修复）：本函数是 **checkVisualHandoff 内部的既有
 * authoritative_refs 分支的后置复核**（非独立 provider、非平行门禁）——applicability /
 * --skip-visual-handoff / enforcement=off 的早退都在调用前已被既有分支尊重。
 *
 * 失败语义：goal 态（MAISON_GOAL_RUN_ID 在场）但 manifest 不可读/损坏 → **fail-closed**
 * （BLOCKER FAIL，分母不允许消失）；非 goal 态（无 run ID）→ 返回空（不新增阻塞面）。
 * 复用 `featureDir()` 规范路径（不硬编码 doc/features）；raster 扩展与声明面统一
 * （png/jpg/jpeg/webp——移除 bmp，避免永远无法合法声明的分母）。
 */
function visualReferenceDenominatorCoverage(
  ctx: CheckContext,
  specMarkdown: string,
): CheckResult[] {
  const runId = (process.env.MAISON_GOAL_RUN_ID ?? '').trim();
  if (!runId) return [];
  const prdRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');
  const desc = ruleDesc(ctx, 'structure_checks', 'visual_handoff');
  interface GoalManifestLite {
    requirement?: string;
    requirement_source_files?: string[];
  }
  let manifested: GoalManifestLite | null = null;
  try {
    // 复用 featureDir()（既有规范路径，兼容自定义 features_dir）
    const manifestPath = path.join(
      featureDir(ctx.projectRoot, ctx.feature), 'goal-runs', runId, 'manifest.json');
    manifested = JSON.parse(require('fs').readFileSync(manifestPath, 'utf-8')) as GoalManifestLite;
  } catch {
    // fail-closed：goal 态 manifest 不可读/损坏时分母不得静默消失
    return [{
      id: 'visual_handoff_denominator',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `goal 态（MAISON_GOAL_RUN_ID=${runId}）但 run manifest 不可读/损坏——无法计算参考图` +
        '发现分母，禁止回退由 spec 自算分母。请恢复 run manifest 后重跑 spec。',
      suggestion: '修复/恢复 goal run manifest（doc/features/.../goal-runs/<run_id>/manifest.json）后重跑 spec。',
      affected_files: [prdRel],
    }];
  }
  if (typeof manifested?.requirement !== 'string' || !manifested.requirement.trim()) {
    // 有 run ID 但 manifest 无 requirement：异常态，fail-closed（不得静默放行）
    return [{
      id: 'visual_handoff_denominator',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'goal run manifest 缺少 requirement——无法计算参考图发现分母。',
      suggestion: '修复 run manifest（requirement 字段）后重跑 spec。',
      affected_files: [prdRel],
    }];
  }
  const expectedAbs = resolveRequirementReferenceImages(
    ctx.projectRoot,
    ctx.feature,
    manifested.requirement,
    { requirementSourceFiles: manifested.requirement_source_files },
  );
  if (expectedAbs.length === 0) return [];

  // spec 声明路径（authoritative_refs；fidelity_snapshot lock 源不属于声明面）
  const declaredAbs = new Set<string>();
  for (const b of extractCodeBlocks(specMarkdown, 'yaml')) {
    try {
      const doc = YAML.parse(b.content) as Record<string, unknown>;
      const vh = doc?.visual_handoff as Record<string, unknown> | undefined;
      if (!vh || typeof vh !== 'object') continue;
      const refs = vh.authoritative_refs as Array<{ path?: string }> | undefined;
      if (!Array.isArray(refs)) continue;
      for (const r of refs) {
        if (typeof r.path !== 'string' || !/\.(png|jpe?g|webp)$/i.test(r.path)) continue;
        const resolved = resolveAuthoritativePath(r.path, {
          projectRoot: ctx.projectRoot,
          externalRoots: ctx.specVisualSources?.external_roots,
          allowAbsolutePaths: Boolean(ctx.specVisualSources?.allow_absolute_paths),
          allowNetworkPaths: Boolean(ctx.specVisualSources?.allow_network_paths),
        });
        if (resolved.resolvedAbsolute) declaredAbs.add(path.resolve(resolved.resolvedAbsolute));
      }
    } catch { /* skip */ }
  }
  const missing = expectedAbs
    .map(p => path.resolve(p))
    .filter(p => !declaredAbs.has(p));
  if (missing.length === 0) {
    return [{
      id: 'visual_handoff_denominator',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'PASS',
      details: `spec 声明覆盖 runner 发现的全部 ${expectedAbs.length} 张参考图（分母一致，无自缩）`,
      affected_files: [prdRel],
    }];
  }
  return [{
    id: 'visual_handoff_denominator',
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `spec 漏声明 ${missing.length} 张 runner 发现图片（不得由 spec 缩小验收分母）：\n` +
      missing.map(m => `  - ${path.relative(ctx.projectRoot, m).split(path.sep).join('/')}`).join('\n') +
      '\n处置：在 visual_handoff.authoritative_refs 声明全部发现图片（需求正文显式路径或 ' +
      'requirement source 直接父目录一层），或确认它们确非本特性参考图后调整需求来源。',
    suggestion:
      '补齐 spec visual_handoff.authoritative_refs 声明（对照 runner 发现集合逐张核对），' +
      '或修正需求来源（--requirement-file 即来源锚点）后重跑 spec。',
    affected_files: [prdRel],
  }];
}
