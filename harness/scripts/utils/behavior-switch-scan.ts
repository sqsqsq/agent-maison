// ============================================================================
// behavior-switch-scan.ts — 产品行为开关确定性扫描（goal-fakepass-hardening t3）
// ============================================================================
// 事故对位：BankAddConstants.ets `static readonly DEVICE_TEST_FAST_PATH: boolean = true`
// ——点银行直写卡跳结果页，testing 期塞入且默认开启，零拦截。
//
// 定位=defense-in-depth（主防线是 t2 attestation + t4 语义链）：窄正则只抓"显式命名的
// 测试性开关默认开启"这一类高置信形态，不做语义推断、不扩宽 pattern（宽了误报会逼出
// waiver 滥用）。waiver 绑定精确坐标 {file, symbol, content_sha256} + t10 receipt——
// pattern 级豁免拒收；即便 waiver 有效也只降级 WARN 且状态封顶（不洗白）。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { featureFilePath } from '../../config';
import { collectProductSourceFiles, discoverProductSourceRoots } from './closure-attestation';
import {
  defaultTrustRegistryPath,
  validateConfirmationReceiptFile,
} from './confirmation-receipt';

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
  /** 命中文件当前内容哈希（waiver 坐标绑定用） */
  file_sha256: string;
  /** waiver 校验结果（无 waiver=false） */
  waived: boolean;
  waiver_reasons?: string[];
}

export interface BehaviorSwitchWaiverEntry {
  file: string;
  symbol: string;
  content_sha256: string;
  reason: string;
  /** t10 receipt 文件路径（项目根相对）；无 receipt 的 waiver 不生效 */
  receipt_path?: string;
}

export function behaviorSwitchWaiversPath(projectRoot: string, feature: string, phase: string): string {
  return featureFilePath(projectRoot, feature, path.join(phase, 'behavior-switch-waivers.yaml'));
}

function loadWaivers(projectRoot: string, feature: string, phase: string): BehaviorSwitchWaiverEntry[] {
  const p = behaviorSwitchWaiversPath(projectRoot, feature, phase);
  if (!fs.existsSync(p)) return [];
  try {
    const doc = YAML.parse(fs.readFileSync(p, 'utf-8')) as { waivers?: BehaviorSwitchWaiverEntry[] };
    return Array.isArray(doc?.waivers) ? doc.waivers : [];
  } catch {
    return [];
  }
}

export interface ScanOptions {
  projectRoot: string;
  feature: string;
  phase: string;
  /** 复用已发现 roots（省二次 discovery）；缺省自发现 */
  roots?: string[];
  now?: () => Date;
}

/**
 * 扫描产品源码（非测试目录，与 attestation 同口径）中命名命中且默认 true 的行为开关。
 * waiver 判定：坐标（file+symbol+content_sha256）逐项精确匹配 + t10 receipt 校验通过
 * 才置 waived=true——**pattern/目录级豁免不存在**；文件内容变化即 sha 失配，waiver 失效。
 */
export function scanBehaviorSwitches(opts: ScanOptions): BehaviorSwitchHit[] {
  const { projectRoot, feature, phase } = opts;
  const roots = opts.roots ?? discoverProductSourceRoots(projectRoot).roots;
  const waivers = loadWaivers(projectRoot, feature, phase);
  const registryPath = defaultTrustRegistryPath(projectRoot);
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
          const waiver = waivers.find(
            (w) => w.file === rel && w.symbol === symbol && w.content_sha256 === fileSha,
          );
          let waived = false;
          let waiverReasons: string[] | undefined;
          if (waiver) {
            if (!waiver.receipt_path) {
              waiverReasons = ['waiver 缺 receipt_path——无 t10 凭证的 waiver 不生效'];
            } else {
              const objectHash = crypto
                .createHash('sha256')
                .update(`${rel}\n${symbol}\n${fileSha}`, 'utf-8')
                .digest('hex');
              const v = validateConfirmationReceiptFile(
                path.join(projectRoot, waiver.receipt_path),
                registryPath,
                { action: 'behavior_switch_waiver', feature, object_hash: objectHash, now: opts.now },
              );
              waived = v.valid;
              if (!v.valid) waiverReasons = v.reasons;
            }
          }
          hits.push({
            file: rel,
            line: i + 1,
            symbol,
            excerpt: line.trim().slice(0, 160),
            file_sha256: fileSha,
            waived,
            waiver_reasons: waiverReasons,
          });
        }
      }
    }
  }
  return hits;
}

/** waiver 的 receipt object_hash 口径（签发侧对齐用，导出便于单测/文档） */
export function behaviorSwitchObjectHash(fileRel: string, symbol: string, fileSha256: string): string {
  return crypto.createHash('sha256').update(`${fileRel}\n${symbol}\n${fileSha256}`, 'utf-8').digest('hex');
}

/** check-coding / check-testing 共用的 CheckResult 构建（BLOCKER；waived 仅降 WARN 不洗白） */
export function buildBehaviorSwitchCheckResult(opts: ScanOptions): import('./types').CheckResult[] {
  const id = 'product_behavior_switch_scan';
  const description = '产品行为开关扫描（测试性开关默认开启=BLOCKER；waiver 只降级不洗白）';
  const hits = scanBehaviorSwitches(opts);
  const active = hits.filter((h) => !h.waived);
  const waived = hits.filter((h) => h.waived);
  if (active.length > 0) {
    const lines = active
      .slice(0, 8)
      .map((h) => `${h.file}:${h.line} ${h.symbol}（${h.excerpt}）${h.waiver_reasons ? `[waiver 无效：${h.waiver_reasons.join('；')}]` : ''}`);
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details:
        `产品源码存在默认开启的测试性行为开关（${active.length} 处）：\n` +
        lines.join('\n') + (active.length > 8 ? '\n…' : ''),
      suggestion:
        '测试接缝不得改变用户可见流程/默认行为：删除开关或默认关闭；确需豁免走' +
        ' behavior-switch-waivers.yaml（file+symbol+content_sha256 精确坐标 + t10 receipt），' +
        '且豁免仅降级 WARN、run 封顶 AWAITING_HUMAN_REVIEW。',
    }];
  }
  if (waived.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'WARN',
      details:
        `存在 ${waived.length} 处经 receipt 豁免的行为开关（降级不洗白，run 封顶 AWAITING_HUMAN_REVIEW）：` +
        waived.map((h) => `${h.file}:${h.line} ${h.symbol}`).join('、'),
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details: '未发现默认开启的测试性行为开关。',
  }];
}
