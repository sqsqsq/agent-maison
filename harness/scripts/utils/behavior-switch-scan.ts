// ============================================================================
// behavior-switch-scan.ts — 产品行为开关确定性扫描（goal-fakepass-hardening t3）
// ============================================================================
// 事故对位：BankAddConstants.ets `static readonly DEVICE_TEST_FAST_PATH: boolean = true`
// ——点银行直写卡跳结果页，testing 期塞入且默认开启，零拦截。
//
// 定位=defense-in-depth（主防线是 t2 attestation + t4 语义链）：窄正则只抓"显式命名的
// 测试性开关默认开启"这一类高置信形态，不做语义推断、不扩宽 pattern（宽了误报会逼出
// waiver 滥用）。命中即为产品缺陷，必须删除开关或默认关闭；人工 receipt 不得降级。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { collectProductSourceFiles, discoverProductSourceRoots } from './closure-attestation';

/** 开关命名黑名单（窄扫描，codex 建议维持不扩） */
export const BEHAVIOR_SWITCH_NAME_RE =
  /(FAST_?PATH|TEST_ONLY|FOR_TEST|DEVICE_TEST|E2E_ONLY|BYPASS|SKIP_(SMS|VERIF\w*|AUTH))/i;

/** 布尔初始化为 true 的声明形态（ets/ts：const/readonly/static/let/var + 可选类型注解） */
const TRUE_INIT_RE =
  /\b(?:static\s+)?(?:readonly\s+)?(?:const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*boolean\s*)?=\s*true\b/g;

/** 可扫描的源码扩展名 */
const SCAN_EXTENSIONS = new Set(['.ets', '.ts', '.js', '.mjs', '.cjs']);

export interface BehaviorSwitchHit {
  /** 项目根相对 POSIX 路径 */
  file: string;
  line: number;
  symbol: string;
  /** 命中行内容（诊断展示） */
  excerpt: string;
  /** 命中文件当前内容哈希（诊断/候选指纹用） */
  file_sha256: string;
}

export interface ScanOptions {
  projectRoot: string;
  feature: string;
  phase: string;
  /** 复用已发现 roots（省二次 discovery）；缺省自发现 */
  roots?: string[];
}

/**
 * 扫描产品源码（非测试目录，与 attestation 同口径）中命名命中且默认 true 的行为开关。
 * 所有命中都保留为 BLOCKER；legacy waiver 文件即使存在也不读取、不降级。
 */
export function scanBehaviorSwitches(opts: ScanOptions): BehaviorSwitchHit[] {
  const { projectRoot } = opts;
  const roots = opts.roots ?? discoverProductSourceRoots(projectRoot).roots;
  const hits: BehaviorSwitchHit[] = [];

  for (const root of roots) {
    for (const rel of collectProductSourceFiles(projectRoot, root)) {
      if (!SCAN_EXTENSIONS.has(path.extname(rel))) continue;
      const abs = path.join(projectRoot, rel);
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf-8');
      } catch {
        continue;
      }
      if (!BEHAVIOR_SWITCH_NAME_RE.test(content)) continue;
      const fileSha = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        TRUE_INIT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = TRUE_INIT_RE.exec(line)) !== null) {
          const symbol = m[1];
          if (!BEHAVIOR_SWITCH_NAME_RE.test(symbol)) continue;
          hits.push({
            file: rel,
            line: i + 1,
            symbol,
            excerpt: line.trim().slice(0, 160),
            file_sha256: fileSha,
          });
        }
      }
    }
  }
  return hits;
}

/** check-coding / check-testing 共用的 CheckResult 构建。 */
export function buildBehaviorSwitchCheckResult(opts: ScanOptions): import('./types').CheckResult[] {
  const id = 'product_behavior_switch_scan';
  const description = '产品行为开关扫描（测试性开关默认开启=BLOCKER）';
  const hits = scanBehaviorSwitches(opts);
  if (hits.length > 0) {
    const lines = hits
      .slice(0, 8)
      .map((h) => `${h.file}:${h.line} ${h.symbol}（${h.excerpt}）`);
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details:
        `产品源码存在默认开启的测试性行为开关（${hits.length} 处）：\n` +
        lines.join('\n') + (hits.length > 8 ? '\n…' : ''),
      suggestion:
        '测试接缝不得改变用户可见流程/默认行为：删除开关或默认关闭；人工 waiver 不得改写该质量结论。',
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details: '未发现默认开启的测试性行为开关。',
  }];
}
