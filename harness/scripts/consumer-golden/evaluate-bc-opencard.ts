// ============================================================================
// evaluate-bc-opencard.ts — bc-openCard consumer golden evaluator（c4e8b1d3 G3）
// ============================================================================
// **只做结果聚合，不造真机执行平台**：消费宿主统一回归已产出的
// visual-diff.json / crash-diagnostics / coding 素材门结果 / HomeTab UITree dump，
// 按随包固定 golden contract（10 个固定正向需求屏 + HomeTab forbidden anchor）
// 出确定性裁决。**evaluator 属于发布内容**（打进 candidate zip，harness/scripts/**
// 不在 release excludes），保证运行的是 candidate 内实现。
//
// 绑定校验（candidate zip 流程，Todo 4）：
//   - 本 framework 安装的 RELEASE-MANIFEST.sha256 须与 candidate 期望值一致；
//   - 结果必须来自指定宿主 goal run（goal-runs/<runId> 存在且到过 testing）。
//   任一不匹配 → FAIL，旧结果不能复用。
//
// 输出：普通 JSON 诊断报告（不签名、不跨 release 复用）。
//
// CLI：
//   npx ts-node harness/scripts/consumer-golden/evaluate-bc-opencard.ts \
//     --project-root <hostRoot> --run-id <goalRunId> \
//     [--expected-manifest-sha <hex64>] [--out <reportPath>]
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { featureDir, featurePhaseReportsDir } from '../../config';

const FEATURE = 'bc-openCard';

export interface GoldenContract {
  schema_version: string;
  feature: string;
  positive_screens: Array<{ declared: string; capture: string }>;
  forbidden: Array<{ id: string; anchor: string; evidence: string }>;
  key_overlays_and_completion: string[];
}

export interface GoldenEvalItem {
  id: string;
  verdict: 'PASS' | 'FAIL';
  detail: string;
}

export interface GoldenEvalReport {
  schema_version: '1.0';
  feature: string;
  run_id: string;
  generated_at: string;
  installed_manifest_sha256: string | null;
  expected_manifest_sha256: string | null;
  items: GoldenEvalItem[];
  verdict: 'PASS' | 'FAIL';
  /** 诊断附件：contract 屏的截图 hash（来自 visual-diff.json 条目） */
  screenshot_hashes: Record<string, string>;
  /** 诊断附件：装机会话信息（install meta 原样透传，可能为 null） */
  install_meta: Record<string, unknown> | null;
}

export interface GoldenEvalInput {
  projectRoot: string;
  runId: string;
  /** 已安装 framework 根（= evaluator 自身所属 candidate；缺省从本文件位置推导） */
  frameworkRoot?: string;
  /** candidate 记录的 in-zip manifest sha（Todo 4 candidate 流程传入）；null=仅记录不比对 */
  expectedManifestSha?: string | null;
  contractPath?: string;
}

interface VisualDiffScreenRow {
  screen_id?: string;
  screenshot_path?: string;
  verdict?: string;
  must_fix?: string[];
  screenshot_hash?: string;
  evaluated_screenshot_hash?: string;
  evaluated_build_fingerprint?: string;
  captured_in_run?: string;
}

/** 与采集/判定同一 hash 口径（visual-diff-check.hashScreenshotFile：sha256 前 16 hex）。
 * 运行时 require profile 实现（evaluator 随包发布，profiles/ 同在包内）——绝不本地
 * 复刻公式（口径漂移 = 绑定校验形同虚设）。 */
function screenshotHashOf(abs: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { hashScreenshotFile } = require('../../../profiles/hmos-app/harness/visual-diff-check') as {
    hashScreenshotFile: (p: string) => string | null;
  };
  return hashScreenshotFile(abs);
}

/** 当前 build fingerprint（与 goal-runner/capture 同一生产口径：install meta 的 hap 现算） */
function currentBuildFpOf(projectRoot: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveCurrentBuildFingerprint } = require('../../../profiles/hmos-app/harness/build-fingerprint') as {
      resolveCurrentBuildFingerprint: (r: string, f: string, ph?: string) => string | null;
    };
    return resolveCurrentBuildFingerprint(projectRoot, FEATURE, 'testing');
  } catch {
    return null;
  }
}

function loadContract(contractPath: string): GoldenContract {
  const doc = JSON.parse(fs.readFileSync(contractPath, 'utf-8')) as GoldenContract;
  if (!Array.isArray(doc.positive_screens) || doc.positive_screens.length === 0) {
    throw new Error(`[consumer-golden] contract 缺 positive_screens：${contractPath}`);
  }
  return doc;
}

function sha256File(abs: string): string {
  return createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

export function evaluateConsumerGolden(input: GoldenEvalInput): GoldenEvalReport {
  const { projectRoot, runId } = input;
  const frameworkRoot = input.frameworkRoot ?? path.resolve(__dirname, '..', '..', '..');
  const contractPath =
    input.contractPath ?? path.join(__dirname, 'bc-opencard.golden-contract.json');
  const contract = loadContract(contractPath);
  const items: GoldenEvalItem[] = [];
  const featDir = featureDir(projectRoot, FEATURE);

  // --- 绑定 0a：candidate manifest（安装的就是这个 candidate）---
  const sidecarPath = path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256');
  const installedSha = fs.existsSync(sidecarPath)
    ? fs.readFileSync(sidecarPath, 'utf-8').trim().slice(0, 64)
    : null;
  const expectedSha = input.expectedManifestSha ?? null;
  if (!installedSha) {
    items.push({
      id: 'candidate_binding', verdict: 'FAIL',
      detail: `宿主安装的 framework 无 RELEASE-MANIFEST.sha256（${sidecarPath}）——不是打包 candidate 安装（源码树/手拷不可作 golden 依据）。`,
    });
  } else if (expectedSha && installedSha !== expectedSha) {
    items.push({
      id: 'candidate_binding', verdict: 'FAIL',
      detail: `安装的 manifest sha=${installedSha.slice(0, 12)}… 与 candidate 期望 ${expectedSha.slice(0, 12)}… 不匹配——结果不是本 candidate 产出，不能复用。`,
    });
  } else {
    items.push({
      id: 'candidate_binding', verdict: 'PASS',
      detail: expectedSha ? 'RELEASE-MANIFEST.sha256 与 candidate 期望一致。' : `安装 manifest sha=${installedSha.slice(0, 12)}…（未提供期望值，仅记录）。`,
    });
  }

  // --- 绑定 0b：宿主 goal run 的 testing 必须**成功闭环且 run 成功终局**（round20/21 P1）---
  // 两个已实锤的假通过口：
  //   · 只查"出现过 testing 事件"→ 采信未完成/backtrack 后失败的 run；
  //   · 只取最后一条 verdict → 旧 PASS/advance 之后又 phase_start:testing 并中断，仍误判 PASS。
  // 判据（round21 钉死）：① 最新一次 testing phase_start **之后**存在 verdict=PASS/advance；
  // ② 最后一条 run_end.status ∈ {CHAIN_SLICE_COMPLETED, COMPLETED}（run 成功终局，
  //    HALTED/INTERRUPTED/PARTIAL 一律不采信）。
  const eventsPath = path.join(featDir, 'goal-runs', runId, 'events.jsonl');
  let lastTestingStartIdx = -1;
  // round22 P1：保存**最新 testing verdict 的完整状态与索引**（不是"任意 PASS"），
  // 且成功 run_end 的索引必须位于该 verdict **之后**——否则
  // "旧段 PASS → 旧 run_end=COMPLETED → resume 新段 → testing PASS → 写新 run_end 前中断"
  // 会借旧 run_end 判 PASS。
  let lastTestingVerdict: { verdict?: string; action?: string; idx: number } | null = null;
  let lastRunEnd: { status: string | null; idx: number } | null = null;
  if (fs.existsSync(eventsPath)) {
    try {
      const lines = fs.readFileSync(eventsPath, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        try {
          const e = JSON.parse(lines[i]) as
            { type?: string; phase?: string; verdict?: string; action?: string; status?: string };
          if (e.phase === 'testing' && e.type === 'phase_start') lastTestingStartIdx = i;
          if (e.phase === 'testing' && e.type === 'phase_verdict') {
            lastTestingVerdict = { verdict: e.verdict, action: e.action, idx: i };
          }
          if (e.type === 'run_end') {
            lastRunEnd = { status: typeof e.status === 'string' ? e.status : null, idx: i };
          }
        } catch { /* 坏行跳过 */ }
      }
    } catch { /* 读失败 → 全部判据落空，下方 fail-closed */ }
  }
  const testingClosed =
    lastTestingStartIdx >= 0 &&
    lastTestingVerdict !== null &&
    lastTestingVerdict.idx > lastTestingStartIdx &&
    lastTestingVerdict.verdict === 'PASS' &&
    lastTestingVerdict.action === 'advance';
  const runConcludedOk =
    lastRunEnd !== null &&
    (lastRunEnd.status === 'CHAIN_SLICE_COMPLETED' || lastRunEnd.status === 'COMPLETED') &&
    lastTestingVerdict !== null &&
    lastRunEnd.idx > lastTestingVerdict.idx;
  items.push(testingClosed && runConcludedOk
    ? {
        id: 'run_binding', verdict: 'PASS',
        detail: `goal run ${runId}：最新 testing verdict=PASS/advance，且成功 run_end=${lastRunEnd!.status} 位于其后（顺序绑定成立）。`,
      }
    : {
        id: 'run_binding', verdict: 'FAIL',
        detail: lastTestingVerdict === null && lastTestingStartIdx < 0
          ? `goal run ${runId} 不存在或无 testing 事件（${eventsPath}）——结果 run 绑定失败，旧结果不能复用。`
          : !testingClosed
            ? `goal run ${runId} 最新 testing verdict 非 PASS/advance 或位于最新 phase_start 之前（verdict=${lastTestingVerdict?.verdict}/action=${lastTestingVerdict?.action}）——testing 被重启/中断或未成功闭环，结果不可采信。`
            : `goal run ${runId} 的成功 run_end 缺失或位于最新 testing verdict 之前（run_end=${lastRunEnd?.status ?? '缺失'}@${lastRunEnd?.idx ?? '-'}）——run 未在本段 testing 之后成功终局（旧段 run_end 不可借用），结果不可采信。`,
      });

  // --- 绑定 0c：当前 build fingerprint（round20 P1——同 run 内换 build 后旧截图不得过关）---
  const currentFp = currentBuildFpOf(projectRoot);
  items.push(currentFp
    ? { id: 'build_binding_available', verdict: 'PASS', detail: `当前 build fingerprint=${currentFp}（install meta + hap 现算）。` }
    : {
        id: 'build_binding_available', verdict: 'FAIL',
        detail: '当前 build fingerprint 不可算（device-test-install.meta.json / hap 缺失）——无法证明结果对应当前安装，fail-closed。',
      });

  // --- 读 visual-diff.json ---
  const vdPath = path.join(featDir, 'device-testing', 'device-screenshots', 'visual-diff.json');
  let rows: VisualDiffScreenRow[] = [];
  if (fs.existsSync(vdPath)) {
    try {
      const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens?: VisualDiffScreenRow[] };
      rows = Array.isArray(doc.screens) ? doc.screens : [];
    } catch { rows = []; }
  }
  const byCapture = new Map<string, VisualDiffScreenRow>();
  const duplicateIds = new Set<string>();
  for (const r of rows) {
    if (typeof r.screen_id === 'string' && r.screen_id.trim()) {
      // round19 P2：重复 screen ID 不得被 Map 静默吞掉——"精确集合相等"含"重复也 FAIL"
      if (byCapture.has(r.screen_id)) duplicateIds.add(r.screen_id);
      byCapture.set(r.screen_id, r);
    }
  }
  const capturedIds = new Set(
    [...byCapture.entries()]
      .filter(([, r]) =>
        typeof r.screenshot_path === 'string' &&
        fs.existsSync(path.join(projectRoot, r.screenshot_path)))
      .map(([id]) => id),
  );
  const contractCaptureSet = new Set(contract.positive_screens.map(s => s.capture));

  // --- 1. 十固定屏精确集合相等（缺失/重复/替换/多余均 FAIL）---
  const missing = [...contractCaptureSet].filter(id => !capturedIds.has(id)).sort();
  const extra = [...capturedIds].filter(id => !contractCaptureSet.has(id)).sort();
  const dup = [...duplicateIds].sort();
  const goldenHint = missing.length >= 1 && missing.every(id => id.startsWith('bank_card_list_sheet'))
    ? '（提示：仅缺 P1 屏时最常见原因是宿主回归未设 MAISON_GOLDEN_CONTRACT——golden 采集入口见 candidate build 输出）'
    : '';
  items.push(missing.length === 0 && extra.length === 0 && dup.length === 0
    ? { id: 'ten_fixed_screens_exact_set', verdict: 'PASS', detail: `10 个固定正向需求屏精确集合相等（含 P1 bank_card_list_sheet），无重复条目。` }
    : {
        id: 'ten_fixed_screens_exact_set', verdict: 'FAIL',
        detail: `集合不等：缺失=[${missing.join(', ') || '无'}]；多余/错误屏=[${extra.join(', ') || '无'}]；重复=[${dup.join(', ') || '无'}]（缺失、重复、替换、多出错误屏均 FAIL）${goldenHint}。`,
      });

  // --- 1b. run 绑定新鲜度：contract 屏必须为**本 run** 采集（round19 P1——防第二个 run 复用第一个 run 的截图）---
  const notThisRun = [...contractCaptureSet]
    .filter(id => capturedIds.has(id))
    .filter(id => byCapture.get(id)?.captured_in_run !== runId)
    .sort();
  items.push(notThisRun.length === 0
    ? { id: 'run_freshness', verdict: 'PASS', detail: `contract 屏均为本 run（${runId}）采集（captured_in_run 机器盖戳）。` }
    : {
        id: 'run_freshness', verdict: 'FAIL',
        detail: `以下屏非本 run 采集（captured_in_run 缺失或指向他 run）：[${notThisRun.join(', ')}]——golden 统一回归须强制本 run 重采，跨 run 持久化截图不可采信。`,
      });

  // --- 1c. verdict 全 pass：pending/skipped/缺失一律 FAIL（round19 P1——刚采未判不算成功）---
  const notPass = [...contractCaptureSet]
    .map(id => ({ id, row: byCapture.get(id) }))
    .filter(({ row }) => !!row)
    .filter(({ row }) => row!.verdict !== 'pass')
    .map(({ id, row }) => `${id}=${row!.verdict ?? 'missing'}`)
    .sort();
  items.push(notPass.length === 0
    ? { id: 'verdict_all_pass', verdict: 'PASS', detail: 'contract 十屏 verdict 全部为明确 pass。' }
    : { id: 'verdict_all_pass', verdict: 'FAIL', detail: `非 pass 判定（pending/skipped/warn/fail/缺失均不算成功）：[${notPass.join(', ')}]。` });

  // --- 1d. 截图绑定：evaluated_screenshot_hash 在场且与盘上截图一致（判定绑定的就是这张图）---
  const badBinding = [...contractCaptureSet]
    .map(id => ({ id, row: byCapture.get(id) }))
    .filter(({ row }) => !!row && typeof row!.screenshot_path === 'string')
    .filter(({ row }) => {
      const diskHash = screenshotHashOf(path.join(projectRoot, row!.screenshot_path!));
      const evalHash = row!.evaluated_screenshot_hash?.trim();
      return !diskHash || !evalHash || diskHash !== evalHash;
    })
    .map(({ id }) => id)
    .sort();
  items.push(badBinding.length === 0
    ? { id: 'screenshot_binding', verdict: 'PASS', detail: 'contract 屏的 evaluated_screenshot_hash 均与盘上截图一致（判定↔像素绑定成立）。' }
    : { id: 'screenshot_binding', verdict: 'FAIL', detail: `判定与盘上截图脱钩（evaluated_screenshot_hash 缺失或不等于当前文件 hash）：[${badBinding.join(', ')}]。` });

  // --- 1e. build 绑定：条目的 evaluated_build_fingerprint 须等于当前安装指纹（round20 P1——
  // 同 run 内 backtrack 换 build 后，早期旧 build 的截图/判定不得过关）---
  const badBuild = currentFp
    ? [...contractCaptureSet]
        .map(id => ({ id, row: byCapture.get(id) }))
        .filter(({ row }) => !!row)
        .filter(({ row }) => row!.evaluated_build_fingerprint !== currentFp)
        .map(({ id }) => id)
        .sort()
    : [...contractCaptureSet].sort(); // 当前指纹不可算 → 全部不可证（与 0c 同 fail-closed）
  items.push(badBuild.length === 0
    ? { id: 'build_binding', verdict: 'PASS', detail: `contract 屏条目均绑定当前 build（fp=${currentFp}）。` }
    : { id: 'build_binding', verdict: 'FAIL', detail: `以下屏条目非当前 build 产出（evaluated_build_fingerprint 缺失/指向旧 build）：[${badBuild.join(', ')}]。` });

  // --- 2. screen identity（聚合既有采集期 identity gate 结果，不重跑）---
  const mismatchDir = path.join(featDir, 'device-testing', 'device-screenshots', '_mismatch');
  const unresolvedMismatch = [...contractCaptureSet].filter(id => {
    const slug = id.replace(/[^a-zA-Z0-9_-]+/g, '_');
    return fs.existsSync(path.join(mismatchDir, `shot-${slug}.png`)) && !capturedIds.has(id);
  });
  items.push(unresolvedMismatch.length === 0
    ? { id: 'screen_identity', verdict: 'PASS', detail: 'identity gate 在采集期前置（配置 identity 的屏不匹配即不落正式条目）；无未解决的 identity mismatch 证据。' }
    : { id: 'screen_identity', verdict: 'FAIL', detail: `identity mismatch 未解决：[${unresolvedMismatch.join(', ')}]（_mismatch 证据在场且正式条目缺席）。` });

  // --- 3. 无 crash（faultlog 集合差口径，d8c5f3a7 F3）---
  // 真实归档 schema（device-crash-diagnostics.archiveTimeoutDiagnosis）：
  //   { schema_version, screen_or_case, run_id, generated_at, diagnosis: { kind, ... } }
  // round19 P1：kind 在 **diagnosis 嵌套**里——顶层 doc.kind 永远 undefined，按顶层读=全盲。
  const diagDir = path.join(featDir, 'device-testing', 'reports', 'crash-diagnostics');
  const crashFiles: string[] = [];
  const crashScreens: string[] = [];
  if (fs.existsSync(diagDir)) {
    for (const n of fs.readdirSync(diagDir)) {
      if (!n.endsWith('.json')) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(diagDir, n), 'utf-8')) as
          { run_id?: string; screen_or_case?: string; diagnosis?: { kind?: string } };
        if (doc.run_id === runId && doc.diagnosis?.kind === 'crash_suspected') {
          crashFiles.push(n);
          if (typeof doc.screen_or_case === 'string') crashScreens.push(doc.screen_or_case);
        }
      } catch { /* 损坏归档不计入本 run 崩溃 */ }
    }
  }
  items.push(crashFiles.length === 0
    ? { id: 'no_crash', verdict: 'PASS', detail: '本 run 无 crash_suspected 归档（faultlog 集合差口径）。' }
    : { id: 'no_crash', verdict: 'FAIL', detail: `本 run 存在崩溃诊断归档：[${crashFiles.join(', ')}]。` });

  // --- 4. 素材门（round20 P1：按**真实 summary 契约**消费——writer 无 checks 字段，
  // 读 quality_axes.asset 轴 + 沿 script_report 指针读 script-report.json.checks，
  // 并以 summary.run_id 绑定本 run；任何一环缺席即 fail-closed）---
  let assetDetail = '';
  let assetFail = false;
  try {
    const reportsDir = featurePhaseReportsDir(projectRoot, FEATURE, 'coding', frameworkRoot);
    const summaryPath = path.join(reportsDir, 'summary.json');
    if (!fs.existsSync(summaryPath)) {
      assetFail = true;
      assetDetail = `coding summary.json 缺席（${summaryPath}）——素材门证据缺失（fail-closed）。`;
    } else {
      const doc = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as {
        run_id?: string;
        script_report?: string;
        quality_axes?: Record<string, { applicable?: boolean; verdict?: string }>;
      };
      const parts: string[] = [];
      if (doc.run_id !== runId) {
        assetFail = true;
        parts.push(`summary.run_id=${doc.run_id ?? '缺失'} ≠ 本 run ${runId}（旧 run 的 coding 结果不采信）`);
      }
      // round21 P1：三个 fail-open 口全封——不适用/缺指针/畸形报告一律 FAIL（链任一环缺席即失败）。
      const axis = doc.quality_axes?.asset;
      if (!axis) {
        assetFail = true;
        parts.push('summary.quality_axes.asset 缺席（非 1.1 契约 summary，不可判）');
      } else if (axis.applicable !== true) {
        // round22 P2：applicable 是 QualityAxis 契约必填 boolean——缺失/畸形与 false 同罪。
        // bc-openCard 明确需要图片素材——asset 轴不适用/不可判本身就是链路异常，不豁免。
        assetFail = true;
        parts.push(`asset 轴 applicable=${JSON.stringify(axis.applicable)}（须显式 true——bc-openCard 明确需要图片素材，不适用/缺失/畸形均为链路异常）`);
      } else if (axis.verdict !== 'PASS') {
        assetFail = true;
        parts.push(`asset 轴 verdict=${axis.verdict}（非 PASS）`);
      }
      if (typeof doc.script_report !== 'string' || !doc.script_report.trim()) {
        // 不做默认文件回退——缺指针=summary 契约不完整，证据链断
        assetFail = true;
        parts.push('summary.script_report 指针缺失（不回退默认文件名——证据链断）');
      } else {
        const scriptReportPath = path.join(reportsDir, path.basename(doc.script_report));
        if (!fs.existsSync(scriptReportPath)) {
          assetFail = true;
          parts.push(`script-report.json 缺席（${scriptReportPath}）`);
        } else {
          const sr = JSON.parse(fs.readFileSync(scriptReportPath, 'utf-8')) as
            { checks?: unknown };
          if (!Array.isArray(sr.checks)) {
            assetFail = true;
            parts.push('script-report.json 无 checks 数组（畸形报告，不按空数组放行）');
          } else {
            const bad = (sr.checks as Array<{ id?: string; status?: string }>).filter(c =>
              typeof c.id === 'string' && c.id.startsWith('visual_parity_asset') && c.status === 'FAIL');
            if (bad.length > 0) {
              assetFail = true;
              parts.push(`素材门 check FAIL：[${bad.map(c => c.id).join(', ')}]`);
            }
          }
        }
      }
      assetDetail = assetFail
        ? parts.join('；') + '。'
        : `asset 轴 PASS + script-report 素材门（visual_parity_asset_*）无 FAIL + summary.run_id 绑定本 run（档位无关门，d8c5f3a7 F4）。`;
    }
  } catch (e) {
    assetFail = true;
    assetDetail = `素材门证据读取失败：${(e as Error).message}`;
  }
  items.push({ id: 'required_assets', verdict: assetFail ? 'FAIL' : 'PASS', detail: assetDetail });

  // --- 5. visual-diff 无 must_fix ---
  const withMustFix = [...contractCaptureSet]
    .map(id => byCapture.get(id))
    .filter((r): r is VisualDiffScreenRow => !!r)
    .filter(r => (Array.isArray(r.must_fix) && r.must_fix.length > 0) ||
      (typeof r.verdict === 'string' && ['warn', 'fail'].includes(r.verdict.toLowerCase())))
    .map(r => r.screen_id!);
  items.push(withMustFix.length === 0
    ? { id: 'no_must_fix', verdict: 'PASS', detail: 'contract 屏的 visual-diff 条目均无 must_fix / warn / fail。' }
    : { id: 'no_must_fix', verdict: 'FAIL', detail: `存在 must_fix 或 warn/fail 判定：[${withMustFix.join(', ')}]。` });

  // --- 6. HomeTab forbidden anchor（负向第 11 目标；round20 P1：只认 golden capture
  // 生产的 wrapper 证据——须绑定本 run + 当前 build，裸 dump/历史残留一律不采信）---
  for (const f of contract.forbidden ?? []) {
    const evidenceAbs = path.join(featDir, f.evidence);
    if (!fs.existsSync(evidenceAbs)) {
      items.push({
        id: `forbidden_${f.id}`, verdict: 'FAIL',
        detail: `${f.id} 证据缺席（${f.evidence}）——负向目标须由 golden 采集生产 UITree 证据` +
          '（宿主回归须设 MAISON_GOLDEN_CONTRACT 且 nav 配置含该屏到达步骤；fail-closed，不采=不可判）。',
      });
      continue;
    }
    interface ForbiddenEvidence {
      kind?: string;
      run_id?: string;
      evaluated_build_fingerprint?: string;
      tree?: unknown;
    }
    let ev: ForbiddenEvidence | null = null;
    try {
      ev = JSON.parse(fs.readFileSync(evidenceAbs, 'utf-8')) as ForbiddenEvidence;
    } catch { ev = null; }
    if (!ev || ev.kind !== 'golden_forbidden_evidence' || typeof ev.run_id !== 'string') {
      items.push({
        id: `forbidden_${f.id}`, verdict: 'FAIL',
        detail: `${f.id} 证据非 golden wrapper 格式（裸 dump/历史残留无 run 绑定）——不采信；` +
          '请由本 run 的 golden 采集重新生产。',
      });
      continue;
    }
    if (ev.run_id !== runId) {
      items.push({
        id: `forbidden_${f.id}`, verdict: 'FAIL',
        detail: `${f.id} 证据来自他 run（${ev.run_id}）≠ 本 run ${runId}——跨 run 证据不采信。`,
      });
      continue;
    }
    if (!currentFp || ev.evaluated_build_fingerprint !== currentFp) {
      items.push({
        id: `forbidden_${f.id}`, verdict: 'FAIL',
        detail: `${f.id} 证据 build 绑定失败（证据 fp=${ev.evaluated_build_fingerprint ?? '缺失'}，当前=${currentFp ?? '不可算'}）——非当前安装的实拍不采信。`,
      });
      continue;
    }
    const treeText = JSON.stringify(ev.tree ?? '');
    items.push(treeText.includes(f.anchor)
      ? { id: `forbidden_${f.id}`, verdict: 'FAIL', detail: `${f.id} 的 UITree 中出现禁止锚点 \`${f.anchor}\`——误开发复归。` }
      : { id: `forbidden_${f.id}`, verdict: 'PASS', detail: `${f.id} 无 \`${f.anchor}\`（证据 ${f.evidence}，run/build 绑定通过）。` });
  }

  // --- 7. AllBanks 可进入（本案崩溃屏直接回归）---
  const allBanksCaptured = capturedIds.has('all_banks');
  const allBanksCrash = crashScreens.some(s => s.startsWith('all_banks')) ||
    crashFiles.some(n => n.includes('all_banks'));
  items.push(allBanksCaptured && !allBanksCrash
    ? { id: 'all_banks_enterable', verdict: 'PASS', detail: 'all_banks 已采集且无崩溃归档。' }
    : { id: 'all_banks_enterable', verdict: 'FAIL', detail: `all_banks captured=${allBanksCaptured} crash=${allBanksCrash}。` });

  // --- 8. 关键半模态与完成页有声明且采到 ---
  const keyMissing = (contract.key_overlays_and_completion ?? []).filter(id => !capturedIds.has(id));
  items.push(keyMissing.length === 0
    ? { id: 'key_overlays_and_completion', verdict: 'PASS', detail: '关键半模态（card_type/sms）与完成页均已采到。' }
    : { id: 'key_overlays_and_completion', verdict: 'FAIL', detail: `缺失：[${keyMissing.join(', ')}]。` });

  // --- 诊断附件 ---
  const screenshotHashes: Record<string, string> = {};
  for (const id of contractCaptureSet) {
    const r = byCapture.get(id);
    if (r?.screenshot_hash) screenshotHashes[id] = r.screenshot_hash;
    else if (r?.screenshot_path && fs.existsSync(path.join(projectRoot, r.screenshot_path))) {
      screenshotHashes[id] = sha256File(path.join(projectRoot, r.screenshot_path));
    }
  }
  let installMeta: Record<string, unknown> | null = null;
  const metaPath = path.join(featDir, 'testing', 'reports', 'device-test-install.meta.json');
  if (fs.existsSync(metaPath)) {
    try { installMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>; } catch { installMeta = null; }
  }

  return {
    schema_version: '1.0',
    feature: FEATURE,
    run_id: runId,
    generated_at: new Date().toISOString(),
    installed_manifest_sha256: installedSha,
    expected_manifest_sha256: expectedSha,
    items,
    verdict: items.every(i => i.verdict === 'PASS') ? 'PASS' : 'FAIL',
    screenshot_hashes: screenshotHashes,
    install_meta: installMeta,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argOf(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv = process.argv.slice(2)): number {
  const projectRoot = argOf(argv, '--project-root');
  const runId = argOf(argv, '--run-id');
  if (!projectRoot || !runId) {
    console.error('用法：evaluate-bc-opencard --project-root <hostRoot> --run-id <goalRunId> [--expected-manifest-sha <hex64>] [--out <path>]');
    return 2;
  }
  const report = evaluateConsumerGolden({
    projectRoot: path.resolve(projectRoot),
    runId,
    expectedManifestSha: argOf(argv, '--expected-manifest-sha') ?? null,
  });
  const out = argOf(argv, '--out') ??
    path.join(path.resolve(projectRoot), 'doc', 'consumer-golden-report.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  console.log(`[consumer-golden] verdict=${report.verdict} report=${out}`);
  for (const i of report.items) {
    console.log(`  [${i.verdict}] ${i.id}: ${i.detail}`);
  }
  return report.verdict === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
