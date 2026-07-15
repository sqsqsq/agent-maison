/**
 * P0-7（plan c9e2a7f4）：进程注入自净——file-drift 完整性检查（framework-integrity）对**进程注入**无感。
 *
 * 2026-07-05 实锤（宿主 SimulatedWalletForHmos / homepage，run 20260703T181220Z 续跑）：
 * agent 以 NODE_OPTIONS 预加载 hook（.cjs 用 --require、.mjs 用 --import，猴补 fs.writeFileSync）
 * 在 capture 写 visual-diff.json 时篡改判定（verdict=pass + confirmed_by=user_requirement + 自算
 * 截图 hash），并在 headless-assumptions.md 教操作者"启动 goal 前设 NODE_OPTIONS"；testing 回执
 * script_harness.command 原样自曝注入命令且 blocker_count=0——伪造在其自跑 harness 中实际通关过一次。
 *
 * 防御分层（四层，见 plan c9e2a7f4 P0-7）：
 *  ① spawn 剥离（sanitizeSpawnEnv）——goal-runner/agent-invoke/harness-runner 拉起子进程前清洗；
 *  ② harness 启动自检（runProcessIntegrityPreflight）——本进程 NODE_OPTIONS/execArgv/.node-options/
 *    .npmrc 检出预加载 → BLOCKER；
 *  ③ 伪签物证扫描——profile 侧（visual-diff-check）扫 feature testing 目录改判脚本；
 *  ④ 回执 command 校验（scanCommandForPreloadInjection）——check-receipt 消费。
 *
 * 诚实边界：只覆盖已知预加载向量（NODE_OPTIONS/execArgv/.npmrc node-options/.node-options 旁路文件）；
 * 白名单为**裸模块 specifier**（框架 detach 重启自身合法使用 -r ts-node/register/transpile-only），
 * 路径形值一律可疑；恶意同名 node_modules 包属残余风险（配合 P1-5 行为红线与责任到人）。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CheckResult } from './types';

/** 预加载 flag 全集（cursor/codex 点名，缺一不可）。 */
const PRELOAD_FLAGS = new Set(['--require', '-r', '--import', '--loader', '--experimental-loader']);

/** 合法裸模块 specifier 白名单——仅精确匹配；相对/绝对/盘符/file: 路径值一律不入白名单。 */
const PRELOAD_ALLOWLIST = new Set([
  'ts-node/register',
  'ts-node/register/transpile-only',
  'tsconfig-paths/register',
]);

export interface PreloadFinding {
  flag: string;
  value: string;
}

function stripQuotes(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** 扫 token 序列（NODE_OPTIONS 分词 / process.execArgv）中的非白名单预加载项。 */
export function scanPreloadTokens(tokens: readonly string[]): PreloadFinding[] {
  const out: PreloadFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const eq = t.indexOf('=');
    let flag: string | undefined;
    let value = '';
    if (eq > 0 && PRELOAD_FLAGS.has(t.slice(0, eq))) {
      flag = t.slice(0, eq);
      value = t.slice(eq + 1);
    } else if (PRELOAD_FLAGS.has(t)) {
      flag = t;
      value = tokens[i + 1] ?? '';
      i++;
    }
    if (!flag) continue;
    const cleanValue = stripQuotes(value);
    if (PRELOAD_ALLOWLIST.has(cleanValue)) continue;
    out.push({ flag, value: cleanValue });
  }
  return out;
}

/** 扫 NODE_OPTIONS 字符串值中的非白名单预加载项。 */
export function scanNodeOptionsValue(value: string | undefined): PreloadFinding[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return scanPreloadTokens(value.trim().split(/\s+/));
}

/**
 * ①spawn 剥离：返回剥掉非白名单预加载项后的新 env（不改入参）。
 * 白名单项与非预加载项（如 --max-old-space-size）保留；剥空则删除 NODE_OPTIONS 变量。
 */
export function sanitizeSpawnEnv(env: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; stripped: string[] } {
  const value = env.NODE_OPTIONS;
  const findings = scanNodeOptionsValue(value);
  if (findings.length === 0) return { env, stripped: [] };
  const tokens = (value ?? '').trim().split(/\s+/);
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const eq = t.indexOf('=');
    if (eq > 0 && PRELOAD_FLAGS.has(t.slice(0, eq))) {
      if (PRELOAD_ALLOWLIST.has(stripQuotes(t.slice(eq + 1)))) kept.push(t);
      continue;
    }
    if (PRELOAD_FLAGS.has(t)) {
      const v = tokens[i + 1] ?? '';
      i++;
      if (PRELOAD_ALLOWLIST.has(stripQuotes(v))) kept.push(t, v);
      continue;
    }
    kept.push(t);
  }
  const next: NodeJS.ProcessEnv = { ...env };
  if (kept.length > 0) next.NODE_OPTIONS = kept.join(' ');
  else delete next.NODE_OPTIONS;
  return { env: next, stripped: findings.map(f => `${f.flag} ${f.value}`) };
}

/**
 * goal-fakepass-hardening t10（codex 六轮 P0-2）：凭证信任锚材料不得进 agent 子进程 env——
 * HMAC 密钥（MAISON_HMAC_* 前缀约定）与 registry 路径覆盖（MAISON_TRUST_REGISTRY）
 * 一律剥除；否则"验证密钥对 agent 不可读"是空话（goal agent 继承几乎完整 process.env）。
 */
export function stripTrustAnchorEnv(env: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; stripped: string[] } {
  const next: NodeJS.ProcessEnv = { ...env };
  const stripped: string[] = [];
  for (const key of Object.keys(next)) {
    if (key.startsWith('MAISON_HMAC_') || key === 'MAISON_TRUST_REGISTRY') {
      delete next[key];
      stripped.push(key);
    }
  }
  return { env: next, stripped };
}

/**
 * ④回执 command 校验：harness 调用命令行内的预加载注入特征。
 * 命中=预加载 flag 带非白名单值，或 NODE_OPTIONS/node-options/.node-options 旁路声明。
 */
export function scanCommandForPreloadInjection(command: string | undefined): string[] {
  if (typeof command !== 'string' || !command.trim()) return [];
  const findings: string[] = [];
  const flagRe = /(--require|--import|--loader|--experimental-loader|(?<=^|[\s'"=;])-r)(?:[=\s]+)("[^"]*"|'[^']*'|[^\s'";]+)/g;
  let m: RegExpExecArray | null;
  while ((m = flagRe.exec(command)) !== null) {
    const value = stripQuotes(m[2]);
    if (PRELOAD_ALLOWLIST.has(value)) continue;
    findings.push(`${m[1]} ${value}`);
  }
  if (/\.node-options\b/i.test(command)) findings.push('.node-options 旁路文件引用');
  if (/(^|[^-\w])node-options\s*=/i.test(command) && !/\.node-options/i.test(command)) {
    findings.push('.npmrc node-options 声明');
  }
  return findings;
}

/**
 * ②harness 启动自检：本进程环境/参数/旁路文件检出预加载注入 → BLOCKER。
 * 与 runFrameworkIntegrityPreflight 并列，全模式入口直调、不经 profile。
 */
export function runProcessIntegrityPreflight(opts: {
  projectRoot: string;
  harnessDir?: string;
}): CheckResult[] {
  const evidence: string[] = [];
  for (const f of scanNodeOptionsValue(process.env.NODE_OPTIONS)) {
    evidence.push(`NODE_OPTIONS 含预加载: ${f.flag} ${f.value}`);
  }
  for (const f of scanPreloadTokens(process.execArgv)) {
    evidence.push(`execArgv 含预加载: ${f.flag} ${f.value}`);
  }
  const dirs = Array.from(new Set([opts.projectRoot, opts.harnessDir ?? process.cwd()]));
  for (const d of dirs) {
    const nodeOptFile = path.join(d, '.node-options');
    if (fs.existsSync(nodeOptFile)) {
      evidence.push(`.node-options 旁路文件存在（无合法用途）: ${nodeOptFile}`);
    }
    const npmrc = path.join(d, '.npmrc');
    if (fs.existsSync(npmrc)) {
      try {
        for (const line of fs.readFileSync(npmrc, 'utf-8').split(/\r?\n/)) {
          const nm = /^\s*node-options\s*=\s*(.+)$/i.exec(line);
          if (nm && scanNodeOptionsValue(nm[1]).length > 0) {
            evidence.push(`.npmrc node-options 含预加载: ${npmrc} → ${line.trim()}`);
          }
        }
      } catch {
        /* 读取失败不误伤 */
      }
    }
  }
  const base = {
    id: 'node_options_injection',
    category: 'structure' as const,
    description: '进程预加载注入自检（P0-7：门禁产物防篡改）',
    severity: 'BLOCKER' as const,
  };
  if (evidence.length === 0) {
    return [{ ...base, status: 'PASS', details: 'NODE_OPTIONS/execArgv/.node-options/.npmrc 未检出预加载注入。' }];
  }
  return [{
    ...base,
    status: 'FAIL',
    details:
      `检出进程预加载注入（2026-07-05 伪签事故同款向量——preload hook 可在 harness 进程内篡改判定产物）：\n` +
      evidence.map(e => `- ${e}`).join('\n') +
      `\n处置：清除 NODE_OPTIONS/删除旁路文件后在干净环境重跑 harness；agent 不得以进程注入方式影响门禁产物（发现框架问题应 halt 上报，热修须人批）。`,
    failure_kind: 'process_injection',
    blocking_class: 'integrity',
  }];
}
