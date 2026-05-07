// ============================================================================
// Visual Handoff authoritative_ref path resolver
// ============================================================================
// 解析 PRD authoritative_refs[].path：
// - 相对路径 → 锚定 projectRoot（与历史行为一致）
// - ${VAR_NAME}/…  → external_roots[V] 优先，再退到 process.env
// - ${env:NAME}/… → process.env.NAME
// - 绝对路径 / UNC → 仅在 allow_absolute_paths / allow_network_paths 时允许

import * as fs from 'fs';
import * as path from 'path';

export interface VisualSourcesResolveOpts {
  projectRoot: string;
  /** framework.config.json → prd.visual_sources.external_roots 展开后用 */
  externalRoots?: Record<string, string>;
  allowAbsolutePaths?: boolean;
  allowNetworkPaths?: boolean;
}

export interface ResolvedVisualPath {
  declared: string;
  /** resolved 后的绝对路径；解析失败或未解析时为 undefined */
  resolvedAbsolute?: string;
  /** fs.existsSync(resolvedAbsolute)；无 resolved 时为 false */
  agentReachable: boolean;
  /** human / report 用 */
  resolutionKind: 'relative_repo' | 'env_substituted' | 'absolute' | 'unc' | 'error';
  error?: string;
}

const ENV_IN_ROOT = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/i;

/**
 * 展开配置里的 root 模板：支持 `${env:VAR}` 整段即一个环境变量值。
 */
export function expandRootTemplate(template: string): string {
  let s = template.trim();
  const m = ENV_IN_ROOT.exec(s);
  if (m) {
    return process.env[m[1]] ?? '';
  }
  // 允许 "${env:VAR}/suffix" 这类拼接（极少用）
  return s.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/gi, (_, name: string) => process.env[name] ?? '');
}

function isUnc(p: string): boolean {
  return /^\\\\/.test(p);
}

function isWinDriveAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p.trim());
}

function isPosixAbsolute(p: string): boolean {
  return p.trim().startsWith('/');
}

/**
 * 将 declared path 解析为绝对路径并检测 existsSync。
 */
export function resolveAuthoritativePath(
  declaredPath: string,
  opts: VisualSourcesResolveOpts,
): ResolvedVisualPath {
  const raw = declaredPath.trim();
  if (!raw) {
    return {
      declared: declaredPath,
      agentReachable: false,
      resolutionKind: 'error',
      error: 'path 为空',
    };
  }

  // ${VAR} 前缀（整段路径必须以 ${ 开头才做替换，避免误伤普通相对路径中的 $）
  const varPref = /^\$\{([^}]+)\}/.exec(raw);
  if (varPref) {
    const inner = varPref[1].trim();
    let base = '';
    if (/^env:/i.test(inner)) {
      const name = inner.replace(/^env:/i, '').trim();
      base = process.env[name] ?? '';
    } else {
      const key = inner;
      const fromCfg = opts.externalRoots?.[key];
      if (fromCfg !== undefined && fromCfg !== null && String(fromCfg).trim()) {
        base = expandRootTemplate(String(fromCfg)).trim();
      } else {
        base = process.env[key] ?? '';
      }
    }
    if (!base) {
      return {
        declared: raw,
        agentReachable: false,
        resolutionKind: 'error',
        error: `环境/配置根未解析：\${${inner}}`,
      };
    }
    const rest = raw.slice(varPref[0].length).replace(/^[\\/]+/, '');
    const joined = rest ? path.join(base, rest) : base;
    const norm = path.normalize(joined);
    const ok = fs.existsSync(norm);
    return {
      declared: raw,
      resolvedAbsolute: norm,
      agentReachable: ok,
      resolutionKind: 'env_substituted',
      ...(ok ? {} : { error: '路径解析后不存在' }),
    };
  }

  // UNC
  if (isUnc(raw)) {
    if (!opts.allowNetworkPaths) {
      return {
        declared: raw,
        agentReachable: false,
        resolutionKind: 'error',
        error: 'UNC 路径未获准：请在 prd.visual_sources.allow_network_paths 置 true',
      };
    }
    const norm = path.normalize(raw);
    const ok = fs.existsSync(norm);
    return {
      declared: raw,
      resolvedAbsolute: norm,
      agentReachable: ok,
      resolutionKind: 'unc',
      ...(ok ? {} : { error: 'UNC 路径不可达' }),
    };
  }

  // 绝对路径（Windows 盘符 / POSIX）
  if (path.isAbsolute(raw) || isWinDriveAbsolute(raw)) {
    if (!opts.allowAbsolutePaths && !opts.allowNetworkPaths) {
      // Windows path.isAbsolute 已覆盖 X:\；POSIX 已覆盖 /
      return {
        declared: raw,
        agentReachable: false,
        resolutionKind: 'error',
        error:
          '绝对路径未获准：请在 prd.visual_sources.allow_absolute_paths（或 UNC 时用 allow_network_paths）置 true',
      };
    }
    const norm = path.normalize(raw);
    const ok = fs.existsSync(norm);
    return {
      declared: raw,
      resolvedAbsolute: norm,
      agentReachable: ok,
      resolutionKind: 'absolute',
      ...(ok ? {} : { error: '绝对路径不可达' }),
    };
  }

  // 相对工程根
  const trimmed = raw.replace(/\\/g, '/');
  if (trimmed.startsWith('..')) {
    return {
      declared: raw,
      agentReachable: false,
      resolutionKind: 'error',
      error: 'path 含非法 .. 前缀',
    };
  }
  const abs = path.resolve(opts.projectRoot, raw);
  const root = path.resolve(opts.projectRoot);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      declared: raw,
      agentReachable: false,
      resolutionKind: 'error',
      error: 'path 解析后越出工程根',
    };
  }
  const ok = fs.existsSync(abs);
  return {
    declared: raw,
    resolvedAbsolute: abs,
    agentReachable: ok,
    resolutionKind: 'relative_repo',
    ...(ok ? {} : { error: '仓库内相对路径不存在' }),
  };
}
