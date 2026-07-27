// ============================================================================
// device-crash-diagnostics.ts — 导航失败时的崩溃诊断（plan d8c5f3a7 v23 F3）
// ----------------------------------------------------------------------------
// 【事故形态】2026-07-24 真机上点"全部银行"直接崩溃，但自动化管线只看到
// `wait_for_component(BY.id('search_bar'), 15.0) cost: 15.1s` 超时——faultlog 一次
// 都没采。崩溃被降级成"元素等不到"，TC-004~009 级联失败，真正的 crash 从未进回修集合。
//
// 【v23 集合差方案】旧实现解析 faultlog 文件名尾部时间戳（yyyyMMddHHmmss）做时间窗
// 过滤——但那是**设备本地时间**，旧代码按 Date.UTC 解析，时区差会让历史崩溃被判成
// 本轮崩溃（或反之）。现在改为无时钟依赖的集合差：
//   导航前 `snapshotFaultlogSet()` 记文件名集合 → 失败后重列 →
//   **新增 ∧ 文件名含当前 bundle** 才判 crash_suspected。
// 诊断结论**直接**作为回修信号（ActionableDefect source='crash'），不绕任何指标契约。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { hdcTargetPrefix, resolveHdcExecutableSync, runHdcRaw } from './hdc-runner';

export type TimeoutDiagnosis =
  /** faultlog 出现**本轮新增**且属于本应用的崩溃 → 页面进入即崩溃 */
  | { kind: 'crash_suspected'; bundleName: string; faultFiles: string[]; excerpt: string }
  /** 无新增崩溃证据，按元素定位问题处理（选择器/渲染时机/导航未到位） */
  | { kind: 'element_absent'; note: string }
  /** 诊断本身没跑成（设备不可达/命令失败）——不得当作"没崩" */
  | { kind: 'diagnosis_unavailable'; reason: string };

export interface CrashProbeDeps {
  /** 执行 hdc 命令；返回 stdout（失败返回 null） */
  runHdc: (args: string[]) => string | null;
}

const FAULTLOG_DIR = '/data/log/faultlog/faultlogger';
/** faultlog 文件名形如 `cppcrash-com.example.app-20260724150102` / `jscrash-...` / `appfreeze-...` */
const FAULT_LINE_RE = /^\s*(\S*(?:cppcrash|jscrash|appfreeze)\S*)\s*$/gim;

function listFaultlogs(deps: CrashProbeDeps): string[] | null {
  const listing = deps.runHdc(['shell', 'ls', '-1', FAULTLOG_DIR]);
  if (listing === null) return null;
  const files: string[] = [];
  FAULT_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FAULT_LINE_RE.exec(listing)) !== null) files.push(m[1]);
  return files;
}

/**
 * 导航/采集开始前拍 faultlog 文件名集合（集合差的基线）。
 * 设备不可达 → null（后续诊断将如实报 diagnosis_unavailable，不冒充"没崩"）。
 */
export function snapshotFaultlogSet(deps: CrashProbeDeps): ReadonlySet<string> | null {
  const files = listFaultlogs(deps);
  return files === null ? null : new Set(files);
}

/**
 * 导航失败后诊断：重列 faultlog，**新增 ∧ 含当前 bundle** → crash_suspected。
 *
 * fail-closed：
 * - `preSet === null`（基线没拍成）→ diagnosis_unavailable（没有基线就没有"新增"可言）；
 * - 重列失败 → diagnosis_unavailable；
 * - "采不到崩溃日志"绝不等于"没崩溃"。
 */
export function diagnoseNavigationFailure(
  bundleName: string,
  preSet: ReadonlySet<string> | null,
  deps: CrashProbeDeps,
): TimeoutDiagnosis {
  if (!bundleName.trim()) {
    return { kind: 'diagnosis_unavailable', reason: '未知 bundleName，崩溃诊断未跑' };
  }
  if (preSet === null) {
    return {
      kind: 'diagnosis_unavailable',
      reason: '导航前 faultlog 基线未拍成（设备不可达）——无基线即无"新增"可判，不得据此断定未崩溃',
    };
  }
  const now = listFaultlogs(deps);
  if (now === null) {
    return {
      kind: 'diagnosis_unavailable',
      reason: 'faultlog 目录列举失败（设备不可达或路径不存在）——不得据此断定未崩溃',
    };
  }
  const fresh = now.filter(n => !preSet.has(n) && n.includes(bundleName));
  if (fresh.length === 0) {
    return {
      kind: 'element_absent',
      note: '本轮无该应用新增 faultlog——按元素定位问题处理（选择器/渲染时机/导航未到位）',
    };
  }
  const newest = fresh.slice().sort().slice(-1)[0];
  const excerpt = deps.runHdc(['shell', 'cat', `${FAULTLOG_DIR}/${newest}`]) ?? '';
  return {
    kind: 'crash_suspected',
    bundleName,
    faultFiles: fresh,
    excerpt: excerpt.split('\n').slice(0, 40).join('\n'),
  };
}

/**
 * 把诊断结果归档到 `<reportsDir>/crash-diagnostics/<id>.json`。
 *
 * 归档路径是 feature 共享的、跨 run 会残留——**必须写 run_id**，消费侧
 * （goal-runner collectActionableDefects）只认本 run 的归档；无 run_id 的旧格式按过期处理。
 */
export function archiveTimeoutDiagnosis(
  reportsDir: string,
  screenOrCaseId: string,
  diagnosis: TimeoutDiagnosis,
  freshness?: { runId?: string; generatedAt?: string },
): string | null {
  try {
    const dir = path.join(reportsDir, 'crash-diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    const safe = screenOrCaseId.replace(/[^A-Za-z0-9_.-]+/g, '_');
    const p = path.join(dir, `${safe}.json`);
    fs.writeFileSync(p, `${JSON.stringify({
      schema_version: '1.2',
      screen_or_case: screenOrCaseId,
      run_id: freshness?.runId ?? process.env.MAISON_GOAL_RUN_ID?.trim() ?? null,
      generated_at: freshness?.generatedAt ?? new Date().toISOString(),
      diagnosis,
    }, null, 2)}\n`, 'utf-8');
    return p;
  } catch {
    return null;
  }
}

/** 真机 hdc 依赖：诊断只读日志，失败一律返回 null（→ diagnosis_unavailable，不冒充"没崩"） */
export function makeHdcCrashProbeDeps(): CrashProbeDeps {
  return {
    runHdc: (args: string[]): string | null => {
      try {
        const r = runHdcRaw(resolveHdcExecutableSync(), [...hdcTargetPrefix(), ...args], {
          timeout: 8000, maxBuffer: 4 * 1024 * 1024,
        });
        if (r.error || r.status !== 0) return null;
        return r.stdout ?? '';
      } catch {
        return null;
      }
    },
  };
}

/** 三态 → 人读一行（附加进采集错误说明） */
export function renderDiagnosis(d: TimeoutDiagnosis): string {
  if (d.kind === 'crash_suspected') {
    return `**进入即崩溃嫌疑**（本轮 faultlog 新增 ${d.faultFiles.length} 条：${d.faultFiles.slice(0, 3).join(', ')}）`
      + `；摘要：${d.excerpt.split('\n').slice(0, 3).join(' / ')}`;
  }
  if (d.kind === 'element_absent') return `崩溃诊断：${d.note}`;
  return `崩溃诊断不可用：${d.reason}`;
}
