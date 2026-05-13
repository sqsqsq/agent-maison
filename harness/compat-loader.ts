// ============================================================================
// Feature 目录 compat.yaml — 加载与检查结果降级（不加载全局宿主配置 DSL）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { featureCompatPath } from './config';
import type { CheckResult, Phase } from './scripts/utils/types';
import { GLOBAL_FEATURE_SENTINEL, isGlobalPhase } from './scripts/utils/types';
import { fillCompatMessage, SUGGESTION_COMPAT_EXPIRED } from './compat-messages';

const COMPAT_MARKER = '[compat_downgraded';

const ALLOWED_COMPAT_PHASES = new Set(['prd', 'design', 'coding', 'review', 'ut']);

export interface FeatureCompat {
  schema_version: '1.0';
  feature: string;
  since_framework_version?: string;
  exempt_checks: string[];
  reason: string;
  scheduled_backfill_by: string;
  phases?: string[];
}

export interface LoadedCompat {
  enabled: boolean;
  data?: FeatureCompat;
  expired?: boolean;
  parseAdvisory?: CheckResult;
}

export interface CompatDowngradeCtx {
  feature: string;
  phase: Phase;
  projectRoot: string;
}

export interface CompatDowngradeStats {
  appliedIds: string[];
  expiredFired: boolean;
}

/** YYYY-MM-DD：有效至该日 UTC 结束前；整日历 ISO：`now >= 次日 UTC 0 点` 判定过期 */
export function isScheduledBackfillExpired(scheduled_backfill_by: string, nowMs: number): boolean {
  const trimmed = scheduled_backfill_by.trim();
  const cal = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (cal) {
    const y = Number(cal[1]);
    const mo = Number(cal[2]);
    const d = Number(cal[3]);
    const boundaryUtc = Date.UTC(y, mo - 1, d + 1, 0, 0, 0, 0);
    return nowMs >= boundaryUtc;
  }
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) {
    return false;
  }
  return nowMs > t;
}

function isValidExemptPattern(pat: string): boolean {
  if (pat.length === 0) return false;
  const idx = pat.indexOf('*');
  if (idx === -1) return true;
  return idx === pat.length - 1;
}

function exemptMatches(pattern: string, checkId: string): boolean {
  if (pattern.endsWith('*')) {
    return checkId.startsWith(pattern.slice(0, -1));
  }
  return checkId === pattern;
}

export function compatDowngradeMatchesExempt(pattern: string, checkId: string): boolean {
  return exemptMatches(pattern, checkId);
}

function advisory(
  id: string,
  message: string,
  affected?: string,
): CheckResult {
  return {
    id,
    category: 'structure',
    description: `compat.yaml 校验：${message}`,
    severity: 'MINOR',
    status: 'WARN',
    details: message,
    affected_files: affected ? [affected.replace(/\\/g, '/')] : undefined,
  };
}

/** narrow 校验 YAML；失败返回 parseAdvisory（不触碰宿主根目录 JSON 配置文件） */
export function loadFeatureCompat(projectRoot: string, feature: string, nowMs: number): LoadedCompat {
  const compatAbs = featureCompatPath(projectRoot, feature);
  const compatRel = path.relative(projectRoot, compatAbs).replace(/\\/g, '/');

  if (!fs.existsSync(compatAbs)) {
    return { enabled: false };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(compatAbs, 'utf-8');
  } catch {
    return {
      enabled: false,
      parseAdvisory: advisory('compat_yaml_read', `无法读取 ${compatRel}`, compatRel),
    };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (e) {
    return {
      enabled: false,
      parseAdvisory: advisory(
        'compat_yaml_parse',
        `YAML 解析失败：${(e as Error).message}`,
        compatRel,
      ),
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      enabled: false,
      parseAdvisory: advisory('compat_yaml_parse', 'compat.yaml 根须为 YAML 对象', compatRel),
    };
  }

  const o = parsed as Record<string, unknown>;

  const sv = o.schema_version;
  if (sv !== '1.0') {
    return {
      enabled: false,
      parseAdvisory: advisory(
        'compat_invalid_schema_version',
        `schema_version 须为字符串 "1.0"，当前=${String(sv ?? '<missing>')}`,
        compatRel,
      ),
    };
  }

  const feat = o.feature;
  if (typeof feat !== 'string' || feat !== feature) {
    return {
      enabled: false,
      parseAdvisory: advisory(
        'compat_feature_mismatch',
        `feature 字段须与目录名一致：期望 "${feature}"，文件中=${String(feat ?? '<missing>')}`,
        compatRel,
      ),
    };
  }

  const ex = o.exempt_checks;
  if (!Array.isArray(ex) || ex.length === 0) {
    return {
      enabled: false,
      parseAdvisory: advisory('compat_invalid_exempt_checks', 'exempt_checks 须为非空 string[]', compatRel),
    };
  }

  const patterns: string[] = [];
  for (const item of ex) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return {
        enabled: false,
        parseAdvisory: advisory('compat_invalid_exempt_checks', 'exempt_checks 每项须为非空 string', compatRel),
      };
    }
    const p = item.trim();
    if (!isValidExemptPattern(p)) {
      return {
        enabled: false,
        parseAdvisory: advisory(
          'compat_invalid_exempt_pattern',
          `非法 exempt 形态（仅允许完整 id 或末尾 * 前缀）：${p}`,
          compatRel,
        ),
      };
    }
    patterns.push(p);
  }

  const reason = o.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return {
      enabled: false,
      parseAdvisory: advisory('compat_invalid_reason', 'reason 须为非空 string', compatRel),
    };
  }

  const sched = o.scheduled_backfill_by;
  if (typeof sched !== 'string') {
    return {
      enabled: false,
      parseAdvisory: advisory('compat_invalid_date', 'scheduled_backfill_by 须为 string（ISO date）', compatRel),
    };
  }

  const calOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sched.trim());
  if (!calOnly) {
    const t = Date.parse(sched.trim());
    if (Number.isNaN(t)) {
      return {
        enabled: false,
        parseAdvisory: advisory(
          'compat_invalid_date',
          `scheduled_backfill_by Date.parse 失败：${sched}`,
          compatRel,
        ),
      };
    }
  }

  let phases: string[] | undefined;
  if (o.phases !== undefined) {
    if (!Array.isArray(o.phases)) {
      return {
        enabled: false,
        parseAdvisory: advisory('compat_invalid_phases', 'phases 若存在须为 string[]', compatRel),
      };
    }
    phases = [];
    for (const p of o.phases) {
      if (typeof p !== 'string' || !ALLOWED_COMPAT_PHASES.has(p)) {
        return {
          enabled: false,
          parseAdvisory: advisory(
            'compat_invalid_phases',
            `phases 每项须 ∈ {prd, design, coding, review, ut}，非法值=${String(p)}`,
            compatRel,
          ),
        };
      }
      phases.push(p);
    }
  }

  const data: FeatureCompat = {
    schema_version: '1.0',
    feature,
    since_framework_version: typeof o.since_framework_version === 'string' ? o.since_framework_version : undefined,
    exempt_checks: patterns,
    reason: reason.trim(),
    scheduled_backfill_by: sched.trim(),
    phases,
  };

  const expired = isScheduledBackfillExpired(data.scheduled_backfill_by, nowMs);

  return {
    enabled: true,
    data,
    expired,
  };
}

function phaseEligible(data: FeatureCompat, phase: Phase): boolean {
  if (!data.phases || data.phases.length === 0) return true;
  return data.phases.includes(phase);
}

export function applyCompatDowngrade(
  results: CheckResult[],
  ctx: CompatDowngradeCtx,
  nowMs: number = Date.now(),
): { results: CheckResult[]; stats: CompatDowngradeStats } {
  const stats: CompatDowngradeStats = { appliedIds: [], expiredFired: false };

  if (ctx.feature === GLOBAL_FEATURE_SENTINEL || isGlobalPhase(ctx.phase)) {
    return { results: [...results], stats };
  }

  const loaded = loadFeatureCompat(ctx.projectRoot, ctx.feature, nowMs);
  const out = [...results];

  if (loaded.parseAdvisory) {
    out.push(loaded.parseAdvisory);
  }

  if (!loaded.enabled || !loaded.data) {
    return { results: out, stats };
  }

  const data = loaded.data;
  const relCompat = path.relative(ctx.projectRoot, featureCompatPath(ctx.projectRoot, ctx.feature)).replace(
    /\\/g,
    '/',
  );

  if (loaded.expired) {
    stats.expiredFired = true;
    out.push({
      id: 'compat_expired',
      category: 'structure',
      description: 'compat.yaml 已过 scheduled_backfill_by，协议自动失效',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `doc/features/${ctx.feature}/compat.yaml: scheduled_backfill_by=${data.scheduled_backfill_by} 已过期`,
      suggestion: fillCompatMessage(SUGGESTION_COMPAT_EXPIRED, ctx.feature, ctx.phase),
      affected_files: [relCompat],
    });
    return { results: out, stats };
  }

  if (!phaseEligible(data, ctx.phase)) {
    return { results: out, stats };
  }

  const applied: CheckResult[] = [];
  for (const r of out) {
    if (r.severity !== 'BLOCKER' || r.status !== 'FAIL') {
      applied.push(r);
      continue;
    }
    let hit = false;
    for (const p of data.exempt_checks) {
      if (exemptMatches(p, r.id)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      applied.push(r);
      continue;
    }
    const suffix = `\n[compat_downgraded by doc/features/${ctx.feature}/compat.yaml]`;
    const nextDetails = `${r.details}${r.details.includes(COMPAT_MARKER) ? '' : suffix}`;
    applied.push({
      ...r,
      severity: 'MINOR',
      status: 'WARN',
      details: nextDetails,
    });
    stats.appliedIds.push(r.id);
  }

  return { results: applied, stats };
}
