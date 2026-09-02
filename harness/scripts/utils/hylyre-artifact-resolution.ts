// ============================================================================
// hylyre-artifact-resolution.ts — v1 artifact 的定位与校验（Q5 已冻结）
// ----------------------------------------------------------------------------
// 冻结基准（step-outcome-v1.md §8.1「`path` 的解析基准」，tree cc738c2723…1bae）：
//
//   artifacts[].path 一律相对于**承载该 StepResult 的 authoritative trace 文件所在目录**。
//   不存在第二套隐含基准——没有 run-dir / reports 根之类的备用基准，也不依赖生产者或
//   消费者的当前工作目录。
//
// Q5 的价值不只是文档：Hylyre 实测发现 producer 本身是坏的——failure 目录原先挂在
// `--report-out` 旁，路径记成 `TC-A-step-0.png`，当 `--report-out` 与 `--trace-out` 不同目录时
// trace 定位不到自己的证据。修复后目录改挂 trace 旁，记成 `failures/TC-A-step-0.png`。
// 因此本模块**必须**以 trace 目录为唯一基准，且不得实现任何 fallback 搜索——那会把
// producer 的回归重新盖住。
//
// 安全边界：path 只能停留在 trace 目录树内。三层判据，缺一层就有已知绕过手法：
//   1. 词法形态：`..`、POSIX 绝对、盘符绝对、UNC、反斜杠根一律拒绝（与 Schema pattern 同口径）；
//   2. resolve 后的词法包含关系；
//   3. **realpath 包含关系**——只有这一层能拦住符号链接与 Windows junction。
//      1、2 都是纯字符串运算：trace 目录里放一个指向外部目录的 junction，前两层全部通过。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ArtifactRefV1 } from './hylyre-result-protocol';

export type ArtifactResolution =
  | { ok: true; absolutePath: string; sha256: string }
  | { ok: false; code: 'escapes_trace_tree' | 'missing' | 'unreadable' | 'sha256_mismatch'; detail: string };

/** 明显非相对的形态：POSIX 绝对、Windows 盘符、UNC、反斜杠根。与 Schema pattern 同口径。 */
function isNonRelative(p: string): boolean {
  return /^[/\\]/.test(p) || /^[A-Za-z]:/.test(p) || /^\\\\/.test(p);
}

/**
 * 按冻结基准解析一个 artifact，并校验 sha256。
 * @param traceFilePath 承载该 StepResult 的 authoritative trace **文件**路径
 */
export function resolveArtifact(traceFilePath: string, artifact: ArtifactRefV1): ArtifactResolution {
  const raw = artifact.path;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, code: 'escapes_trace_tree', detail: 'artifact.path 为空' };
  }
  if (isNonRelative(raw)) {
    return { ok: false, code: 'escapes_trace_tree', detail: `artifact.path 不是相对路径：${raw}` };
  }
  // 反斜杠也当分隔符处理：Windows producer 可能写 `failures\x.png`，但逃逸判定不能因此漏。
  const normalizedRel = raw.replace(/\\/g, '/');
  if (normalizedRel.split('/').some(seg => seg === '..')) {
    return { ok: false, code: 'escapes_trace_tree', detail: `artifact.path 含父级穿越：${raw}` };
  }

  const base = path.resolve(path.dirname(traceFilePath));
  const abs = path.resolve(base, normalizedRel);
  // 词法复核：逐段检查之外再看一次 resolve 结果。
  const rel = path.relative(base, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, code: 'escapes_trace_tree', detail: `解析后逃出 trace 目录树：${raw}` };
  }

  if (!fs.existsSync(abs)) {
    return { ok: false, code: 'missing', detail: `artifact 不存在：${normalizedRel}（基准=${base}）` };
  }

  // plan a6c4e9f2 T4 返修：本文件头注一直写着"realpath 级复核"，但上面全是
  // `path.resolve`/`path.relative` 的**词法**判断——符号链接与 Windows junction 完全拦不住。
  // 实测在 trace 目录内建一个指向外部目录的 junction，逃逸路径可被成功读取并返回 ok=true。
  // 这里补真正的 realpath 复核：base 与目标都解析到真实路径后再判包含关系，
  // 中间任意一段是链接/junction 都会在这一步暴露。
  let realBase: string;
  let realAbs: string;
  try {
    realBase = fs.realpathSync(base);
    realAbs = fs.realpathSync(abs);
  } catch (e) {
    return { ok: false, code: 'unreadable', detail: `realpath 解析失败：${(e as Error).message}` };
  }
  const realRel = path.relative(realBase, realAbs);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    return {
      ok: false,
      code: 'escapes_trace_tree',
      detail:
        `artifact 经符号链接/junction 逃出 trace 目录树：${raw} → ${realAbs}（基准真实路径=${realBase}）`,
    };
  }
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(abs);
  } catch (e) {
    return { ok: false, code: 'unreadable', detail: `artifact 不可读：${(e as Error).message}` };
  }
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== artifact.sha256) {
    return {
      ok: false,
      code: 'sha256_mismatch',
      detail: `artifact sha256 不符：记载 ${artifact.sha256}，实际 ${actual}（${normalizedRel}）`,
    };
  }
  return { ok: true, absolutePath: abs, sha256: actual };
}

/** failure-boundary 必填条件所认的三种 screen artifact（§8.1）。 */
export const SCREEN_ARTIFACT_KINDS = new Set(['screenshot', 'ui_dump', 'visible_elements']);

export interface FailureBoundaryInput {
  deviceSession: boolean;
  status: string;
  failureDomain?: string;
  artifacts: ArtifactRefV1[];
  extensions?: Record<string, unknown>;
  caseEvidence: string;
}

export type FailureBoundaryVerdict =
  | { kind: 'not_applicable'; detail: string }
  | { kind: 'satisfied'; detail: string }
  | { kind: 'capture_unavailable'; detail: string }
  | { kind: 'violated'; detail: string };

/**
 * §8.1 的必填条件：`device_session=true` 且 `failed` 且 `failure.domain ∈ {selector, assertion}`
 * 时，必须有一项 screen artifact，或如实记录 capture unavailable 且该 case `evidence=incomplete`。
 * **禁止伪造 artifact**——所以 capture-unavailable 分支要求 evidence 同步降级，不能只写个扩展就算数。
 */
export function evaluateFailureBoundary(input: FailureBoundaryInput): FailureBoundaryVerdict {
  const applicable =
    input.deviceSession === true &&
    input.status === 'failed' &&
    (input.failureDomain === 'selector' || input.failureDomain === 'assertion');
  if (!applicable) {
    return { kind: 'not_applicable', detail: '执行前 contract failure / blocked / skipped / passed / 无 device session 均不适用' };
  }
  if ((input.artifacts ?? []).some(a => SCREEN_ARTIFACT_KINDS.has(a.kind))) {
    return { kind: 'satisfied', detail: '已附 screenshot / ui_dump / visible_elements 之一' };
  }
  const capture = (input.extensions ?? {})['hylyre.capture'] as { screen?: unknown } | undefined;
  if (capture && capture.screen === 'unavailable') {
    if (input.caseEvidence !== 'incomplete') {
      return {
        kind: 'violated',
        detail: 'capture 声明 unavailable，但该 case 的 evidence 不是 incomplete——不得既不取证又宣称证据完整',
      };
    }
    return { kind: 'capture_unavailable', detail: 'capture 不可用已如实记录，且 case evidence=incomplete' };
  }
  return {
    kind: 'violated',
    detail: 'device-session 内的 selector/assertion 根失败缺 failure-boundary screen artifact，且未如实记录 capture unavailable',
  };
}
