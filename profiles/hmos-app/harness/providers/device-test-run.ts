/**
 * device_test.run → provider `hylyre`
 *
 * 负责：
 *   1) ensureHylyreReady：探测 / 离线安装到 profile 配置 venv（vendor 源码树发布件 + PyPI 拉传递依赖；运行时兼容 schema 1 legacy wheel 布局）
 *   2) runHylyreDeviceTest：venv python 调 `python -m hylyre run --plan ...`（不附加 --store-dir）
 *   3) 日志与 meta：reports/<feature>/testing/hylyre-doctor.log、hylyre-ready.meta.json、device-test-run.meta.json
 *   4) parseHylyreTrace：解析 hylyre trace.json cases[]
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { featurePhaseReportsDir, resolveHylyreToolConfig } from '../../../../harness/config';
import { stripTrustAnchorEnv } from '../../../../harness/scripts/utils/process-integrity';
import {
  diagnoseVendorTreeMismatch,
  evaluateVendorSyncNeed,
  fingerprintFromManifest,
  isValidVendorSourceDecl,
  manifestDeclaredArtifactSha,
  pickVendorInstallable,
  readInstallFingerprint,
  sha256FileHex,
  sha256TreeFromManifest,
  stageVendorSourceForInstall,
  stripBom,
  writeInstallFingerprint,
  type HylyreVendorManifestShape,
  type VendorInstallable,
} from '../hylyre-vendor-sync';
import {
  hdcTargetPrefix,
  mergeEnvWithHdcOnPath,
  resolveHdcExecutableSync,
  runHdcRaw,
} from '../hdc-runner';
import { buildHylyreAppPageSaveArgv, resolveHylyrePageSaveNames } from '../device-test-page-save';
import { resolveMainAbilityForBundle } from '../resolve-main-ability';
import {
  beginHylyrePhasePollutionGuard,
  finishHylyrePhasePollutionGuard,
  type RootPollutionMeta,
} from '../hylyre-root-pollution';
import { resolveHylyreRuntimeWorkDir, spawnHylyre } from '../hylyre-spawn';
import { runHylyreUtf8RoundTrip } from '../hylyre-utf8-roundtrip';
import {
  computeLastFailedStepIndex,
  parseStepsBatchFromRunOut,
  uiResetHintForOutcome,
} from '../../../../harness/scripts/utils/adhoc-ui-reset-meta';
import type { CapabilityProvider } from './types';
import type { RuntimeStepTelemetry } from '../../../../harness/scripts/utils/runtime-step-evidence';
import { requireV1ForGate } from '../../../../harness/scripts/utils/hylyre-result-protocol';
import type {
  CaseResultV1,
  SelectorV1,
  StepResultV1,
} from '../../../../harness/scripts/utils/hylyre-result-protocol';

export { buildHylyreAppPageSaveArgv, resolveHylyrePageSaveSlug, resolveHylyrePageSaveNames } from '../device-test-page-save';
// d9e4b7c1 T2：evidence 合成入口（check-testing 协调层经 capability dispatch 调用）
export { composeDeviceTestEvidence } from '../device-test-evidence';

export const provider: CapabilityProvider = {
  id: 'hylyre',
  capability: 'device_test.run',
  exports: [
    'ensureHylyreReady',
    'probeHylyreEvidenceCapability',
    'preflightHylyreEvidenceCapability',
    'runHylyreDeviceTest',
    'parseHylyreTrace',
    'evaluateHylyreNativeEvidenceGate',
    'composeDeviceTestEvidence',
  ],
};

// plan a6c4e9f2 T7a/T7b（inventory §一 G10）：最低版本/trace 门随 Step Outcome v1 一并提升。
// 这两条常量与 `hylyre-result-protocol.ts` 的 dispatch 判别键必须同步——M1 的 typed consumer
// 只消费 v1，若这道三重判据仍钉在 0.3-p0，合法 v1 trace 会被判非 native，两者互斥。
// 代价如实：宿主装上 0.5.0 之前，testing 的 native 证据链无法闭合（plan 既定终局）。
export const MIN_NATIVE_HYLYRE_VERSION = '0.5.0';
export const NATIVE_TRACE_SCHEMA_VERSION = '0.4-p0';
export const NATIVE_RESULT_PROTOCOL = 'hylyre.step-outcome/1';
/** 只读诊断可用、绝不闭合 evidence 的历史 schema（0.3-p0 自本版起并入 legacy）。 */
export const LEGACY_TRACE_SCHEMA_VERSIONS = new Set(['0.1-p0', '0.2-p4', '0.3-p0']);

export type HylyreCaseExecution = 'completed' | 'aborted' | 'infrastructure_failed';
export type HylyreCaseVerification = 'passed' | 'failed' | 'inconclusive';
export type HylyreCaseEvidence = 'complete' | 'incomplete';
export type HylyreExpectedCheckMode =
  | 'checked_vlm'
  | 'disabled_by_flag'
  | 'unavailable_no_vlm'
  | 'empty';

// plan a6c4e9f2 T4 返修：这里原来是 0.3 flat 形状
// （顶层 status/failure_kind/failure_code/evidence/error + 旧 selector
//  requested_match/effective_match/selected_id）。实测把冻结包**合法** golden
// `golden/trace/valid/bc-opencard-1.json` 喂给本文件的 native gate，得
// `native=false / mode=unsupported / 54 条 reasons`，首条 `steps[0].status 值域非法：undefined`
// ——信封已经升到 0.4-p0，内核还钉在 0.3，于是真实 v1 一律闭合不了证据，
// 反倒是"0.3 flat 套 0.4-p0 信封"的混装产物更容易被当成 native。
// 现在直接复用 `hylyre-result-protocol` 的 typed view，不再维护第二套形状定义。
export type HylyreSelectorEvidence = SelectorV1;
export type HylyreStepResult = StepResultV1;

export interface HylyreTraceEnvironment {
  hylyre_version: string;
  hypium_version: string;
  trace_schema_version: string;
  /** v1 下 environment 侧同样声明协议，且必须与 trace root 一致。 */
  result_protocol?: string;
  selector_engine: string;
  [key: string]: unknown;
}

export interface HylyreEvidenceCapability {
  mode: HylyreEvidenceMode;
  native: boolean;
  legacy: boolean;
  providerId: 'hylyre';
  providerVersion: string;
  reason: string;
}

function compareVersionParts(a: string, b: string): number {
  const left = a.trim().replace(/^v/i, '').split(/[.-]/);
  const right = b.trim().replace(/^v/i, '').split(/[.-]/);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? '0';
    const r = right[i] ?? '0';
    const ln = /^\d+$/.test(l) ? Number(l) : null;
    const rn = /^\d+$/.test(r) ? Number(r) : null;
    if (ln !== null && rn !== null) {
      if (ln !== rn) return ln < rn ? -1 : 1;
      continue;
    }
    if (ln !== null) return 1;
    if (rn !== null) return -1;
    const cmp = l.localeCompare(r);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/**
 * Resolve the provider capability before content execution. Native 0.4.1+
 * evidence is independent of the legacy runtime telemetry bridge. The old
 * bridge is historical read-only compatibility, not a capability for new runs.
 */
export function probeHylyreEvidenceCapability(opts: {
  hylyreVersion: string;
  manifestVersion: string;
}): HylyreEvidenceCapability {
  const version = opts.hylyreVersion.trim();
  const manifestVersion = opts.manifestVersion.trim();
  const versionAligned = Boolean(version && manifestVersion && version === manifestVersion);
  const native = versionAligned && compareVersionParts(version, MIN_NATIVE_HYLYRE_VERSION) >= 0;
  // The old collector is read-only compatibility for historical traces. New
  // runs must not invoke its private Hylyre monkey-patch.
  const legacyCapability = false;
  const mode: HylyreEvidenceMode = native
    ? 'native'
    : legacyCapability
      ? 'legacy'
      : 'unsupported';
  const reason = native
    ? `hylyre@${version} + native CaseResult.steps[] schema gate`
    : legacyCapability
      ? `hylyre@${version} + legacy runtime telemetry transition bridge`
      : `native/legacy evidence unsupported（installed=${version || '<missing>'}, manifest=${manifestVersion || '<missing>'}）`;
  return {
    mode,
    native,
    legacy: legacyCapability,
    providerId: 'hylyre',
    providerVersion: version,
    reason,
  };
}

/**
 * Read-only pre-run probe used by goal orchestration. It never installs or
 * invokes Hylyre; the definitive ready meta is still produced by
 * ensureHylyreReady inside the testing gate.
 */
export function preflightHylyreEvidenceCapability(opts: {
  projectRoot: string;
}): HylyreEvidenceCapability {
  const cfg = resolveHylyreToolConfig(opts.projectRoot);
  const manifest = readVendorManifest(opts.projectRoot, cfg.vendor_dir);
  const manifestVersion = manifest?.hylyre_version ?? '';
  const envPy = (process.env.HYLYRE_PYTHON ?? '').trim();
  const envHome = (process.env.HYLYRE_HOME ?? '').trim();
  // The default/explicit HOME venv is an installation target owned by
  // ensureHylyreReady. Do not turn its missing or stale installed version into
  // a permanent goal defer while the vendor manifest can still be installed.
  // HYLYRE_PYTHON is different: it is an explicit external interpreter and
  // ensureHylyreReady must never upgrade it implicitly.
  if (
    !envPy &&
    cfg.auto_install &&
    manifestVersion &&
    compareVersionParts(manifestVersion, MIN_NATIVE_HYLYRE_VERSION) >= 0
  ) {
    return {
      mode: 'native',
      native: true,
      legacy: false,
      providerId: 'hylyre',
      providerVersion: manifestVersion,
      reason: `vendor manifest Hylyre@${manifestVersion} 可由 ensureHylyreReady 自动安装/升级；最终 ready/doctor/trace gate 留给 testing。`,
    };
  }
  const venvRoot = envHome
    ? path.resolve(opts.projectRoot, envHome)
    : path.resolve(opts.projectRoot, cfg.venv_dir);
  const pythonPath = envPy || venvPython(venvRoot);
  const installedVersion = fs.existsSync(pythonPath) ? pipShowVersion(pythonPath) : '';
  return probeHylyreEvidenceCapability({
    hylyreVersion: installedVersion,
    manifestVersion,
  });
}

// -------- 公共类型 --------

/** schema 1=wheel 发布；schema 2=明文源码树发布（source 必填、wheel 可选） */
export interface HylyreReleaseManifest extends HylyreVendorManifestShape {
  generated_at: string;
  generator: { python: string; pip: string; platform: string };
  note?: string;
}

/**
 * hylyre trace.json `cases[]` 子项。
 *
 * 字段保持可选是**有意**的：本类型也用来承载 legacy/畸形 trace 的只读诊断，
 * 那些文档确实缺三轴。合法性判定不在类型层，而在 `requireV1ForGate`
 * （冻结 schema + 跨行不变量）——类型宽、门禁严，比反过来安全。
 * 判为 v1 之后应改用 `CaseResultV1` 消费。
 */
export interface HylyreTraceCase {
  id: string;
  status: '通过' | '失败' | '阻塞' | '跳过';
  priority?: 'P0' | 'P1' | 'P2' | string;
  ac_ref?: string;
  notes?: string;
  name?: string;
  execution?: HylyreCaseExecution;
  verification?: HylyreCaseVerification;
  evidence?: HylyreCaseEvidence;
  expected_check_mode?: HylyreExpectedCheckMode;
  steps?: HylyreStepResult[];
  [key: string]: unknown;
}

/** 已判定为 v1 后的 case 视图——消费侧应尽量用这个而不是上面的宽类型。 */
export type HylyreNativeCase = CaseResultV1;

export interface HylyreTrace {
  schema_version: string;
  /**
   * v1 结果协议声明。与 `schema_version` 共同构成**唯一** dispatch 判别键
   * （见 `harness/scripts/utils/hylyre-result-protocol.ts`）。
   * `0.4-p0` 下必需且为 `hylyre.step-outcome/1`；`0.3-p0`/`0.2-p4`/`0.1-p0` 下**禁止**出现。
   * 解析层必须原样保留它——丢掉这个字段会让下游把合法 v1 误判成"缺协议"。
   */
  result_protocol?: string;
  feature: string;
  phase: string;
  outcome: string;
  cases?: HylyreTraceCase[];
  environment?: HylyreTraceEnvironment;
  artifacts?: Record<string, unknown>;
  retries?: number;
  tool_calls?: Array<Record<string, unknown>>;
  /**
   * 机器可读的失败原因。结论层据此区分"外部阻断"（如 `device_locked`）与
   * "工具链/环境问题"，二者的处置指引完全不同。
   */
  run_failure_kind?: RunFailureKind | string;
  error_kind?: string;
  runtime_step_telemetry?: RuntimeStepTelemetry;
  [key: string]: unknown;
}

export type HylyreEvidenceMode = 'native' | 'legacy' | 'unsupported';

export interface HylyreEvidenceGateResult {
  mode: HylyreEvidenceMode;
  native: boolean;
  legacy: boolean;
  minimumVersion: string;
  installedVersion: string | null;
  manifestVersion: string | null;
  traceVersion: string | null;
  traceSchemaVersion: string | null;
  reasons: string[];
}

export interface HylyreReadyOptions {
  projectRoot: string;
  harnessRoot: string;
  frameworkRoot?: string;
  feature: string;
  phase: 'testing';
}

export interface HylyreReadyResult {
  ok: boolean;
  pythonPath: string;
  hylyreVersion: string;
  manifestVersion: string;
  versionConsistent: boolean;
  source: 'env_override' | 'venv_existing' | 'venv_installed' | 'fail';
  doctorOk: boolean;
  errors: Array<{ message: string; kind?: string }>;
  logPath?: string;
}

export interface HylyreRunOptions {
  projectRoot: string;
  harnessRoot: string;
  frameworkRoot?: string;
  feature: string;
  phase: 'testing';
  pythonPath: string;
  derivedPlanPath: string;
  /** Top-level plan path captured for same-run identity binding. */
  topPlanPath?: string | null;
  /** When set, use `hylyre run --steps-file` instead of --plan (adhoc fallback). */
  stepsFilePath?: string | null;
  reportOutPath: string;
  traceOutPath: string;
  bundleName: string;
  /** 覆盖 config / 自动扫描；空则走 `resolveHylyreToolConfig` 与 `discoverEntryMainElement` */
  hypiumPageName?: string | null;
  deviceSn?: string;
  skipAssertExpected?: boolean;
  /** When true, skip post-run hylyre app page save (adhoc fast path). */
  skipPageSave?: boolean;
  /** When true, hdc aa force-stop before aa start (adhoc Nav reset). */
  coldRestart?: boolean;
  appSnapshotCacheAbs: string;
  timeoutMs?: number;
}

export interface HylyreRunResult {
  executed: boolean;
  exitCode: number | null;
  ok: boolean;
  command: string;
  reportPath: string | null;
  tracePath: string | null;
  trace: HylyreTrace | null;
  logPath: string;
  errors: Array<{ message: string; kind?: string }>;
}

// -------- 平台 helper --------

function venvPython(venvDir: string): string {
  if (process.platform === 'win32') {
    return path.join(venvDir, 'Scripts', 'python.exe');
  }
  return path.join(venvDir, 'bin', 'python');
}

/** True when venv site-packages already has packages (prior interrupted bootstrap). */
function venvSitePackagesHasPackages(venvRoot: string): boolean {
  const winSp = path.join(venvRoot, 'Lib', 'site-packages');
  if (fs.existsSync(winSp)) {
    try {
      return fs.readdirSync(winSp).some(f => !f.startsWith('.'));
    } catch {
      return false;
    }
  }
  const libDir = path.join(venvRoot, 'lib');
  if (!fs.existsSync(libDir)) return false;
  for (const entry of fs.readdirSync(libDir)) {
    if (!entry.startsWith('python')) continue;
    const sp = path.join(libDir, entry, 'site-packages');
    if (!fs.existsSync(sp)) continue;
    try {
      if (fs.readdirSync(sp).some(f => !f.startsWith('.'))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export type RunFailureKind =
  | 'python_traceback'
  | 'hypium_timeout'
  | 'step_unrecognized'
  | 'step_field_invalid'
  | 'device_disconnect'
  | 'aa_start_preflight_failed'
  /**
   * P1（三轮 review）：设备锁屏且**恢复失败**。必须与 `aa_start_preflight_failed`
   * 区分——前者是外部阻断（人解锁后重跑即可），后者会被归入 device_toolchain 让人
   * 去查签名/环境。此前恢复失败也写成 preflight_failed，结论层就丢掉了锁屏这个真因。
   */
  | 'device_locked'
  | 'unknown';

export function classifyRunFailure(runOut: string, exitCode: number | null): RunFailureKind {
  if (/wait requires seconds/i.test(runOut)) return 'step_field_invalid';
  if (/assert_toast requires text/i.test(runOut)) return 'step_field_invalid';
  if (/Traceback \(most recent call last\)/.test(runOut)) return 'python_traceback';
  if (/timeout|timed out/i.test(runOut)) return 'hypium_timeout';
  if (/unknown step|unsupported step|无法识别.*步骤/i.test(runOut)) return 'step_unrecognized';
  if (/no devices|target not found|no targets/i.test(runOut)) return 'device_disconnect';
  return 'unknown';
}

function readJsonSafe<T>(file: string): T | null {
  try {
    return JSON.parse(stripBom(fs.readFileSync(file, 'utf-8'))) as T;
  } catch {
    return null;
  }
}

function appendLogSync(logPath: string, chunk: string): void {
  fs.appendFileSync(logPath, chunk, 'utf-8');
}

function ensureDirForFile(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function probePythonCandidates(): Array<{ cmd: string; args: string[] }> {
  if (process.platform === 'win32') {
    return [
      { cmd: 'py', args: ['-3'] },
      { cmd: 'python', args: [] },
      { cmd: 'python3', args: [] },
    ];
  }
  return [
    { cmd: 'python3', args: [] },
    { cmd: 'python', args: [] },
  ];
}

/**
 * codex 九轮 P0：Python 准备链（探测/import/venv/pip）统一 env——宿主工程 cwd 下
 * sitecustomize.py/同名模块/安装脚本都是 agent 可产出代码，信任锚材料一律剥离。
 * 所有 Python 子进程（含 hylyre-spawn 正式入口）共用同一剥离口径。
 */
export function pythonSpawnEnv(): NodeJS.ProcessEnv {
  return stripTrustAnchorEnv(process.env).env;
}

function findSystemPythonForVenv(): { cmd: string; args: string[] } | null {
  for (const c of probePythonCandidates()) {
    const r = spawnSync(c.cmd, [...c.args, '-c', 'import sys; assert sys.version_info >= (3, 10)'], {
      encoding: 'utf-8',
      env: pythonSpawnEnv(),
    });
    if (r.status === 0) return c;
  }
  return null;
}

function canImportHylyre(pythonPath: string, logPath?: string): boolean {
  const r = spawnSync(pythonPath, ['-c', 'import hylyre'], { encoding: 'utf-8', env: pythonSpawnEnv() });
  if (logPath && (r.stdout || r.stderr)) {
    appendLogSync(logPath, (r.stdout || '') + (r.stderr || ''));
  }
  return r.status === 0;
}

function safeFileSha256(filePath: string): string | null {
  try {
    return sha256FileHex(filePath);
  } catch {
    return null;
  }
}

/** 已安装的 hylyre 包内是否包含 verify_report 所需契约（wheel 须打 package-data）。 */
function hylyrePackageContractsPresent(pythonPath: string, logPath: string): boolean {
  const snippet = [
    'import pathlib',
    'import hylyre',
    'root = pathlib.Path(hylyre.__file__).resolve().parent / "contracts"',
    'need = ("report-sections.yaml", "output-schema.json")',
    'missing = [n for n in need if not (root / n).is_file()]',
    'if missing:',
    '    print("missing:" + ",".join(missing))',
    '    raise SystemExit(1)',
  ].join('\n');
  const r = spawnSync(pythonPath, ['-c', snippet], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024,
    env: pythonSpawnEnv(),
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (out.trim()) {
    appendLogSync(logPath, `hylyre contracts probe (exit=${r.status}): ${out}`);
  }
  return r.status === 0;
}

function pipShowVersion(pythonPath: string): string {
  const r = spawnSync(pythonPath, ['-m', 'pip', 'show', 'hylyre'], {
    encoding: 'utf-8',
    maxBuffer: 2 * 1024 * 1024,
    env: pythonSpawnEnv(),
  });
  if (r.status !== 0 || !r.stdout) return '';
  const m = r.stdout.match(/^Version:\s*(\S+)/m);
  return m ? m[1].trim() : '';
}

function readVendorManifest(projectRoot: string, vendorRel: string): HylyreReleaseManifest | null {
  const abs = path.join(projectRoot, vendorRel, 'release.manifest.json');
  const j = readJsonSafe<HylyreReleaseManifest>(abs);
  if (!j || typeof j.hylyre_version !== 'string') return null;
  if (j.schema === 1) return j;
  if (j.schema === 2) {
    // schema 2 必须携带完整且**安全**的 source 声明（评审 5 P1：root/path 拒绝穿越、
    // 条目唯一、sha/size 形状合规）——不合格与坏 JSON 同语义（corrupt → null）
    if (isValidVendorSourceDecl(j.source)) {
      return j;
    }
    return null;
  }
  return null;
}

function findVendorInstallable(
  projectRoot: string,
  vendorRel: string,
  manifest: HylyreReleaseManifest | null,
): VendorInstallable | null {
  const abs = path.join(projectRoot, vendorRel);
  return pickVendorInstallable(abs, manifest);
}

/**
 * 实测工件指纹：wheel=文件 sha256；source=按 manifest 声明清单复算 tree hash
 * （null=声明文件缺失/不可读——半同步或损坏）。
 */
function resolveVendorArtifactSha(
  installable: VendorInstallable,
  manifest: HylyreReleaseManifest | null,
): string | null {
  if (installable.kind === 'wheel') return sha256FileHex(installable.path);
  if (!manifest?.source) return null;
  return sha256TreeFromManifest(installable.path, manifest.source.files);
}

const VENDOR_MISSING_HINT =
  '未找到 src/ 源码树或可验真 wheel（schema 2 的 wheel 回落要求 manifest.wheel 字段在场）';

/** source 安装副本装完即清（best-effort；失败留给下次安装前的预清空自愈）。 */
function cleanupSourceInstallTarget(kind: VendorInstallable['kind'], target: string): void {
  if (kind !== 'source') return;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * 解析 pip 安装目标：wheel 直接用；source 先按声明清单拷贝到 .hylyre/build-src 临时副本
 * （pip ≥21.3 对目录是 in-tree build，直接对 vendor src 安装会在其中产 build//egg-info
 * 污染仓库）。失败返回 null 并追加日志。
 */
function prepareVendorInstallTarget(args: {
  installable: VendorInstallable;
  manifest: HylyreReleaseManifest;
  projectRoot: string;
  venvDirRel: string;
  artifactSha256: string;
  logPath: string;
}): string | null {
  if (args.installable.kind === 'wheel') return args.installable.path;
  const source = args.manifest.source;
  if (!source) return null;
  const buildBaseAbs = path.join(
    path.dirname(path.resolve(args.projectRoot, args.venvDirRel)),
    'build-src',
  );
  try {
    const staged = stageVendorSourceForInstall({
      srcRootAbs: args.installable.path,
      buildBaseAbs,
      version: args.manifest.hylyre_version,
      treeSha256: args.artifactSha256,
      files: source.files,
    });
    appendLogSync(args.logPath, `vendor 源码树已按声明清单暂存至 ${staged}（防 pip in-tree build 污染 vendor）\n`);
    return staged;
  } catch (e) {
    appendLogSync(args.logPath, `vendor 源码树暂存失败：${(e as Error).message}\n`);
    return null;
  }
}

/**
 * 将 venv 内 hylyre 对齐 vendor 发布件（pip upgrade → 必要时 force-reinstall）。
 * 在 canImportHylyre 已为 true 时调用；vendor 升级后 testing harness 自动触发，无需手删 venv。
 */
function syncVendorHylyreInVenv(args: {
  pythonPath: string;
  /** pip 安装目标：wheel 文件或源码树临时副本 */
  installTarget: string;
  artifactKind: VendorInstallable['kind'];
  /** 实测工件指纹（wheel 文件 sha256 / 源码 tree hash），成功后写入 install fingerprint */
  artifactSha256: string;
  projectRoot: string;
  logPath: string;
  pypiExtraIndexUrl: string;
  manifest: HylyreReleaseManifest;
  venvRoot: string;
}): { ok: boolean; upgraded: boolean; hylyreVersion: string; errors: string[] } {
  const errors: string[] = [];
  appendLogSync(
    args.logPath,
    `vendor 发布件与 venv 不一致，自动 pip 对齐 manifest=${args.manifest.hylyre_version} artifact=${args.artifactKind}:${path.basename(args.installTarget)}\n`,
  );

  const pipUpgrade = runHylyrePipInstall({
    pythonPath: args.pythonPath,
    target: args.installTarget,
    projectRoot: args.projectRoot,
    logPath: args.logPath,
    pypiExtraIndexUrl: args.pypiExtraIndexUrl,
    mode: 'upgrade',
  });

  let hylyreVersion = pipShowVersion(args.pythonPath);
  const manifestVer = args.manifest.hylyre_version.trim();
  let upgraded = pipUpgrade.ok;

  if (pipUpgrade.ok && manifestVer && hylyreVersion.trim() !== manifestVer) {
    appendLogSync(
      args.logPath,
      `pip --upgrade 后版本仍不一致（pip=${hylyreVersion} manifest=${manifestVer}），尝试 force-reinstall\n`,
    );
    const pipForce = runHylyrePipInstall({
      pythonPath: args.pythonPath,
      target: args.installTarget,
      projectRoot: args.projectRoot,
      logPath: args.logPath,
      pypiExtraIndexUrl: args.pypiExtraIndexUrl,
      mode: 'force-reinstall',
    });
    upgraded = pipForce.ok;
    if (!pipForce.ok) {
      errors.push(`pip 强制重装 hylyre 失败（exit=${pipForce.exitCode}）`);
    } else {
      hylyreVersion = pipShowVersion(args.pythonPath);
    }
  } else if (!pipUpgrade.ok) {
    errors.push(`pip upgrade hylyre 失败（exit=${pipUpgrade.exitCode}）`);
  }

  if (errors.length === 0 && manifestVer && hylyreVersion.trim() === manifestVer) {
    writeInstallFingerprint(
      args.venvRoot,
      fingerprintFromManifest(args.manifest, args.artifactSha256, args.artifactKind),
    );
    console.log(`hylyre 已自动对齐 vendor ${manifestVer}`);
  }
  cleanupSourceInstallTarget(args.artifactKind, args.installTarget);

  return { ok: errors.length === 0, upgraded, hylyreVersion, errors };
}

function runHylyrePipInstall(args: {
  pythonPath: string;
  /** wheel 文件路径，或源码树临时副本目录（两者 pip 语义一致） */
  target: string;
  projectRoot: string;
  logPath: string;
  pypiExtraIndexUrl: string;
  mode: 'upgrade' | 'force-reinstall';
}): { ok: boolean; exitCode: number | null; error?: Error } {
  const pipArgs = ['-m', 'pip', 'install'];
  if (args.mode === 'force-reinstall') {
    pipArgs.push('--force-reinstall');
  } else {
    pipArgs.push('--upgrade');
  }
  pipArgs.push(args.target, 'hylyre[device,mcp]');
  if (args.pypiExtraIndexUrl.trim()) {
    pipArgs.push('--extra-index-url', args.pypiExtraIndexUrl.trim());
  }
  const pipStarted = Date.now();
  appendLogSync(args.logPath, `pip install ${pipArgs.join(' ')}\n`);
  const pip = spawnSync(args.pythonPath, pipArgs, {
    cwd: args.projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: defaultPipTimeoutMs(),
    // 九轮 P0：pip 以宿主工程为 cwd——宿主 sitecustomize/安装脚本可读 env，信任锚剥离
    env: pythonSpawnEnv(),
  });
  const pipElapsed = ((Date.now() - pipStarted) / 1000).toFixed(1);
  appendLogSync(args.logPath, `\npip install 结束 exit=${pip.status}（${pipElapsed}s）\n`);
  if (pip.error) {
    appendLogSync(args.logPath, `${pip.error.message}\n`);
  }
  return { ok: pip.status === 0, exitCode: pip.status, error: pip.error };
}

function defaultPipTimeoutMs(): number {
  const raw = process.env.HARNESS_HYLYRE_PIP_TIMEOUT_MS;
  if (raw && /^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  return 600_000;
}

function defaultRunTimeoutMs(opts?: HylyreRunOptions): number {
  const raw = process.env.HARNESS_HYLYRE_RUN_TIMEOUT_MS;
  if (raw && /^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  if (opts?.timeoutMs != null && Number.isFinite(opts.timeoutMs)) return opts.timeoutMs as number;
  return 1_800_000;
}

export { discoverEntryMainElement } from '../discover-entry-main-element';
import { discoverEntryMainElement } from '../discover-entry-main-element';

function resolveHypiumPageNameForRun(
  projectRoot: string,
  bundleName: string,
  override?: string | null,
  deviceSn?: string,
): { pageName: string | null; source: string; appMetaPath: string | null } {
  const resolved = resolveMainAbilityForBundle({
    projectRoot,
    bundleName,
    override,
    deviceSn,
    writeCache: true,
  });
  return {
    pageName: resolved.mainAbility,
    source: resolved.source,
    appMetaPath: resolved.appMetaPath,
  };
}

/**
 * Hypium `start_app(bundle)` 在部分设备/包体上无法从 bm dump 解析 main ability。
 * hylyre 0.1.0 的 `run --plan` 路径不向 Hypium 传递 `--page-name`，故在拉起 hylyre 前用
 * `hdc shell aa start -a <ability> -b <bundle>` 显式冷启；成功后省略 hylyre 的 `--bundle`，避免再走错误的 start_app。
 */
/** Prefer explicit deviceSn; fall back to HARNESS_HDC_TARGET via hdcTargetPrefix(). */
function hdcTargetPrefixForDevice(deviceSn: string | undefined): string[] {
  const sn = deviceSn?.trim();
  if (sn) return ['-t', sn];
  return hdcTargetPrefix();
}

/** Kill app process before aa start — clears Nav stack for idempotent adhoc reruns. */
export function runAaForceStop(
  bundle: string,
  deviceSn: string | undefined,
  logPath: string,
): { ok: boolean; output: string; attempted: boolean } {
  const args = [...hdcTargetPrefixForDevice(deviceSn), 'shell', 'aa', 'force-stop', bundle];
  appendLogSync(logPath, `$ hdc ${args.join(' ')}\n`);
  const hdcExe = resolveHdcExecutableSync();
  const r = runHdcRaw(hdcExe, args, { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  appendLogSync(logPath, out);
  return { ok: r.status === 0, output: out, attempted: true };
}

function runAaStartPreflight(
  bundle: string,
  pageName: string,
  deviceSn: string | undefined,
  logPath: string,
): { ok: boolean; output: string } {
  const args = [...hdcTargetPrefixForDevice(deviceSn), 'shell', 'aa', 'start', '-a', pageName, '-b', bundle];
  appendLogSync(logPath, `$ hdc ${args.join(' ')}\n`);
  const hdcExe = resolveHdcExecutableSync();
  const r = runHdcRaw(hdcExe, args, { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  appendLogSync(logPath, out);
  return { ok: r.status === 0, output: out };
}

/**
 * S9：testing 运行链路的运行期锁屏恢复——统一走 device-recovery-bridge。
 */
function recoverDeviceLockForRun(
  projectRoot: string,
  deviceSn: string | undefined,
): { recovered: boolean; note: string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bridge = require('../device-recovery-bridge') as typeof import('../device-recovery-bridge');
  return bridge.recoverAfterLockFailure(projectRoot, deviceSn);
}

// -------- ensureHylyreReady --------

export function ensureHylyreReady(opts: HylyreReadyOptions): HylyreReadyResult {
  const cfg = resolveHylyreToolConfig(opts.projectRoot);
  const { reportsBase, hypiumWorkDir } = resolveHylyreRuntimeWorkDir(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    opts.frameworkRoot,
  );
  fs.mkdirSync(reportsBase, { recursive: true });
  const logPath = path.join(reportsBase, 'hylyre-doctor.log');
  const metaPath = path.join(reportsBase, 'hylyre-ready.meta.json');
  const errors: HylyreReadyResult['errors'] = [];
  let rootPollution: RootPollutionMeta | null = null;

  fs.writeFileSync(
    logPath,
    `--- hylyre ensure ${new Date().toISOString()} feature=${opts.feature} ---\n`,
    'utf-8',
  );

  const manifest = readVendorManifest(opts.projectRoot, cfg.vendor_dir);
  const manifestVersion = manifest?.hylyre_version ?? '';

  const envPy = (process.env.HYLYRE_PYTHON ?? '').trim();
  const envHome = (process.env.HYLYRE_HOME ?? '').trim();
  let pythonPath = '';
  let venvRoot = '';
  let source: HylyreReadyResult['source'] = 'fail';
  let doctorOk = false;
  let installedNow = false;
  let bootstrapElapsedMs: number | undefined;
  let bootstrapWasResumed: boolean | undefined;

  if (envPy && fs.existsSync(envPy)) {
    pythonPath = envPy;
    source = 'env_override';
    appendLogSync(logPath, `使用 HYLYRE_PYTHON=${envPy}\n`);
  } else if (envHome) {
    venvRoot = path.resolve(opts.projectRoot, envHome);
    pythonPath = venvPython(venvRoot);
    source = 'venv_existing';
    appendLogSync(logPath, `使用 HYLYRE_HOME=${envHome}\n`);
  } else {
    venvRoot = path.resolve(opts.projectRoot, cfg.venv_dir);
    pythonPath = venvPython(venvRoot);
    if (fs.existsSync(pythonPath)) {
      source = 'venv_existing';
    }
    appendLogSync(logPath, `venv python 目标: ${pythonPath}\n`);
  }

  if (!pythonPath) {
    errors.push({ message: '无法确定 Python 可执行路径', kind: 'config' });
    fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
    return {
      ok: false,
      pythonPath: '',
      hylyreVersion: '',
      manifestVersion,
      versionConsistent: false,
      source: 'fail',
      doctorOk: false,
      errors,
      logPath,
    };
  }

  // -- 供给链完整性 fail-fast（评审 5 P0）--------------------------------------
  // 实测工件指纹（wheel 文件 sha256 / 源码树按声明清单复算 tree hash）必须在
  // **任何 pip / venv 创建 / import 之前**与 manifest 声明比对：被篡改的源码树进入
  // PEP 517 即任意代码执行，事后报错为时已晚。此处一次判定，后续三条流程复用结果。
  // env_override 不消费 vendor 发布件，跳过（其版本一致性由后段既有检查负责）。
  let vendorInstallable: VendorInstallable | null = null;
  let vendorArtifactSha: string | null = null;
  if (source !== 'env_override' && manifest) {
    vendorInstallable = findVendorInstallable(opts.projectRoot, cfg.vendor_dir, manifest);
    if (vendorInstallable) {
      vendorArtifactSha = resolveVendorArtifactSha(vendorInstallable, manifest);
      const declaredSha = manifestDeclaredArtifactSha(manifest, vendorInstallable.kind);
      // 不一致时只做定性诊断，不按归一化放行：安装暂存复制的是落盘原始字节（codex review P1）。
      const vendorIntegrity: 'missing' | 'eol_rewritten' | 'corrupted' | null = !vendorArtifactSha
        ? 'missing'
        : declaredSha && vendorArtifactSha !== declaredSha
          ? vendorInstallable.kind === 'source' && manifest.source
            ? diagnoseVendorTreeMismatch(vendorInstallable.path, manifest.source.files)
            : 'corrupted'
          : null;
      const integrityError =
        vendorIntegrity === 'missing'
          ? `vendor 源码树与 release.manifest.json 声明不一致（声明文件缺失或清单畸形），请从 Hylyre dist/release-src 重新同步 vendor 发布件`
          : vendorIntegrity === 'eol_rewritten'
            ? `vendor 源码树文本已被宿主 Git 改成 CRLF（core.autocrlf 在 checkout 时转换），与 release.manifest.json 的 LF 字节声明不一致；` +
              `"重新同步 vendor"只会在下次 checkout 再次翻转。请在宿主 .gitattributes 钉 framework/** -text，再从已验证发布件恢复 framework/ 原始字节后重试` +
              `（见 skills/reference/consumer-framework-boundary.md「package identity 与完整性」）`
            : vendorIntegrity === 'corrupted'
              ? `vendor 发布件与 release.manifest.json 声明不一致（${path.basename(vendorInstallable.path)}），请重新同步 vendor 发布件`
              : null;
      if (integrityError) {
        appendLogSync(logPath, `${integrityError}\n`);
        errors.push({ message: integrityError, kind: 'vendor' });
        fs.writeFileSync(
          metaPath,
          JSON.stringify(
            {
              ok: false,
              pythonPath,
              errors,
              manifestVersion,
              vendor_artifact_kind: vendorInstallable.kind,
            },
            null,
            2,
          ),
          'utf-8',
        );
        return {
          ok: false,
          pythonPath,
          hylyreVersion: '',
          manifestVersion,
          versionConsistent: false,
          source,
          doctorOk: false,
          errors,
          logPath,
        };
      }
    }
  }

  let hylyreVersion = '';

  if (canImportHylyre(pythonPath, logPath)) {
    hylyreVersion = pipShowVersion(pythonPath);
    source = source === 'fail' ? 'venv_existing' : source;
  } else if (source === 'env_override') {
    errors.push({ message: `HYLYRE_PYTHON 指向的环境无法 import hylyre：${pythonPath}`, kind: 'import' });
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2),
      'utf-8',
    );
    return {
      ok: false,
      pythonPath,
      hylyreVersion: '',
      manifestVersion,
      versionConsistent: false,
      source: 'env_override',
      doctorOk: false,
      errors,
      logPath,
    };
  } else {
    if (!cfg.auto_install) {
      errors.push({
        message: '当前 Python 环境未安装 hylyre，且 tools.hylyre.auto_install=false',
        kind: 'install',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }

    if (!venvRoot) {
      venvRoot = path.resolve(opts.projectRoot, cfg.venv_dir);
    }
    pythonPath = venvPython(venvRoot);

    const creator = findSystemPythonForVenv();
    if (!creator) {
      errors.push({
        message: '未找到可用于创建 venv 的 Python 3.10+（请安装 Python 或设置 HYLYRE_PYTHON）',
        kind: 'python',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath: '',
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source: 'fail',
        doctorOk: false,
        errors,
        logPath,
      };
    }

    if (!fs.existsSync(pythonPath)) {
      appendLogSync(logPath, `创建 venv: ${venvRoot}\n`);
      const mk = spawnSync(creator.cmd, [...creator.args, '-m', 'venv', venvRoot], {
        cwd: opts.projectRoot,
        stdio: ['ignore', 'inherit', 'inherit'],
        encoding: 'utf-8',
        env: pythonSpawnEnv(),
      });
      if (mk.status !== 0) {
        errors.push({ message: `python -m venv 失败，exit=${mk.status}`, kind: 'venv' });
        fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
        return {
          ok: false,
          pythonPath: venvPython(venvRoot),
          hylyreVersion: '',
          manifestVersion,
          versionConsistent: false,
          source: 'fail',
          doctorOk: false,
          errors,
          logPath,
        };
      }
      pythonPath = venvPython(venvRoot);
    }

    // 复用启动早段的完整性门禁结果（评审 5 P0）：至此工件已验真，直接进入安装
    const installable = vendorInstallable;
    if (!installable) {
      errors.push({
        message: `vendor 发布件缺失：在 ${cfg.vendor_dir} 下${VENDOR_MISSING_HINT}`,
        kind: 'vendor',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source: 'venv_installed',
        doctorOk: false,
        errors,
        logPath,
      };
    }
    const installArtifactSha = vendorArtifactSha;
    const installTarget =
      installArtifactSha && manifest
        ? prepareVendorInstallTarget({
            installable,
            manifest,
            projectRoot: opts.projectRoot,
            venvDirRel: cfg.venv_dir,
            artifactSha256: installArtifactSha,
            logPath,
          })
        : installable.kind === 'wheel'
          ? installable.path
          : null;
    if (!installTarget) {
      errors.push({
        message:
          `vendor 发布件不可安装：${cfg.vendor_dir} 下源码树与 release.manifest.json 声明不一致（声明文件缺失或暂存失败），请从 Hylyre dist/release-src 重新同步`,
        kind: 'vendor',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source: 'venv_installed',
        doctorOk: false,
        errors,
        logPath,
      };
    }

    bootstrapWasResumed = venvSitePackagesHasPackages(venvRoot);
    const bootstrapT0 = Date.now();
    console.log(
      `[bootstrap] pip install start (may take 3-10 min on fresh machine; do not interrupt; log: ${logPath})`,
    );
    if (bootstrapWasResumed) {
      console.log('[bootstrap] 检测到 venv 内已有部分 site-packages（可能为上次中断后复用）');
    }

    const pipFirst = runHylyrePipInstall({
      pythonPath,
      target: installTarget,
      projectRoot: opts.projectRoot,
      logPath,
      pypiExtraIndexUrl: cfg.pypi_extra_index_url,
      mode: 'upgrade',
    });

    bootstrapElapsedMs = Date.now() - bootstrapT0;
    console.log(`[bootstrap] pip install done in ${(bootstrapElapsedMs / 1000).toFixed(1)}s`);
    cleanupSourceInstallTarget(installable.kind, installTarget);

    if (!pipFirst.ok) {
      errors.push({
        message:
          `pip install 失败（exit=${pipFirst.exitCode}）。若无法安装 hypium，请配置可达 PyPI 源或 ~/.pip/pip.conf。详见 profile addendum。`,
        kind: 'pip',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source: 'venv_installed',
        doctorOk: false,
        errors,
        logPath,
      };
    }

    console.log('hylyre 与传递依赖安装完成');
    source = 'venv_installed';
    installedNow = true;
    if (manifest && installArtifactSha) {
      writeInstallFingerprint(
        venvRoot,
        fingerprintFromManifest(manifest, installArtifactSha, installable.kind),
      );
    }
  }

  // 同版本号 wheel 可能曾缺少 package data：仅 import 成功不够，须具备 contracts 否则 verify_report 异常退出。
  if (canImportHylyre(pythonPath, logPath) && !hylyrePackageContractsPresent(pythonPath, logPath)) {
    appendLogSync(
      logPath,
      '已安装 hylyre 可 import 但缺少 hylyre/contracts/report-sections.yaml 或 output-schema.json（常为旧发布件）；尝试从 vendor 强制重装。\n',
    );
    if (source === 'env_override') {
      errors.push({
        message:
          'HYLYRE_PYTHON 对应环境中的 hylyre 缺少打包契约文件。请在该环境安装含 contracts 的 Hylyre 发布件，或取消 HYLYRE_PYTHON 改用工程默认 venv（vendor 发布件 + auto_install）。',
        kind: 'contracts',
      });
      fs.writeFileSync(
        metaPath,
        JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2),
        'utf-8',
      );
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source: 'env_override',
        doctorOk: false,
        errors,
        logPath,
      };
    }
    if (!cfg.auto_install) {
      errors.push({
        message:
          'hylyre 安装不完整（缺 contracts）。请删除工程根目录 .hylyre/venv 后重试，或启用 tools.hylyre.auto_install，并确保 vendor 为含 package data 的新发布件（源码树 src/ 或 legacy wheel）。',
        kind: 'contracts',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    if (!venvRoot) {
      venvRoot = path.resolve(opts.projectRoot, cfg.venv_dir);
    }
    pythonPath = venvPython(venvRoot);
    if (!fs.existsSync(pythonPath)) {
      errors.push({
        message: '无法强制重装 hylyre：目标 venv 中不存在 python，可删除该 venv 目录后重试',
        kind: 'venv',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    // 复用启动早段的完整性门禁结果（评审 5 P0）
    const repairInstallable = vendorInstallable;
    const repairArtifactSha = vendorArtifactSha;
    const repairTarget =
      repairInstallable && repairArtifactSha && manifest
        ? prepareVendorInstallTarget({
            installable: repairInstallable,
            manifest,
            projectRoot: opts.projectRoot,
            venvDirRel: cfg.venv_dir,
            artifactSha256: repairArtifactSha,
            logPath,
          })
        : repairInstallable?.kind === 'wheel'
          ? repairInstallable.path
          : null;
    if (!repairInstallable || !repairTarget) {
      errors.push({
        message: `无法补齐 contracts：在 ${cfg.vendor_dir} 下${VENDOR_MISSING_HINT}，或源码树与 manifest 声明不一致`,
        kind: 'vendor',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    const pipRepair = runHylyrePipInstall({
      pythonPath,
      target: repairTarget,
      projectRoot: opts.projectRoot,
      logPath,
      pypiExtraIndexUrl: cfg.pypi_extra_index_url,
      mode: 'force-reinstall',
    });
    cleanupSourceInstallTarget(repairInstallable.kind, repairTarget);
    if (!pipRepair.ok) {
      errors.push({
        message: `pip 强制重装 hylyre 失败（exit=${pipRepair.exitCode}），无法补齐 contracts`,
        kind: 'pip',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    if (!canImportHylyre(pythonPath, logPath) || !hylyrePackageContractsPresent(pythonPath, logPath)) {
      errors.push({
        message:
          '强制重装后仍缺少 hylyre contracts。请从 Hylyre dist/release-src（或 dist/release）覆盖同步 vendor 下发布件与 release.manifest.json（见 vendor/hylyre/README.md），必要时删除 .hylyre/venv 后再跑。',
        kind: 'contracts',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    console.log('hylyre 已强制重装以补齐 contracts');
    source = 'venv_installed';
    installedNow = true;
    if (manifest && repairArtifactSha) {
      writeInstallFingerprint(
        venvRoot,
        fingerprintFromManifest(manifest, repairArtifactSha, repairInstallable.kind),
      );
    }
  }

  hylyreVersion = pipShowVersion(pythonPath);

  // vendor 对齐：venv 已可 import 且 contracts 完整时，按 manifest 版本 + 工件指纹
  // （wheel sha256 / 源码 tree hash）自动 pip 升级/重装。
  let upgradedNow = false;
  let vendorSyncReason: string | undefined;
  let vendorArtifactKind: VendorInstallable['kind'] | undefined;

  if (
    source !== 'env_override' &&
    cfg.auto_install &&
    manifest &&
    canImportHylyre(pythonPath, logPath) &&
    hylyrePackageContractsPresent(pythonPath, logPath)
  ) {
    if (!venvRoot) {
      venvRoot = path.resolve(opts.projectRoot, cfg.venv_dir);
    }
    // 复用启动早段的完整性门禁结果（评审 5 P0）：mismatch 已在门禁 fail-fast，
    // 此处 vendorArtifactSha 非 null 即已验真；本分支只处理『需要对齐』的安装动作。
    vendorArtifactKind = vendorInstallable?.kind;
    if (!vendorInstallable) {
      errors.push({
        message: `vendor 发布件缺失：在 ${cfg.vendor_dir} 下${VENDOR_MISSING_HINT}`,
        kind: 'vendor',
      });
    } else if (!vendorArtifactSha) {
      errors.push({
        message: `vendor 源码树与 release.manifest.json 声明不一致（声明文件缺失），请从 Hylyre dist/release-src 重新同步 vendor 发布件`,
        kind: 'vendor',
      });
    } else {
      const cachedFp = readInstallFingerprint(venvRoot);
      const syncEval = evaluateVendorSyncNeed({
        manifest,
        pipVersion: hylyreVersion,
        artifactKind: vendorInstallable.kind,
        artifactSha256: vendorArtifactSha,
        cachedFingerprint: cachedFp,
      });
      vendorSyncReason = syncEval.reason;

      if (syncEval.manifestArtifactMismatch) {
        errors.push({
          message: `vendor 发布件与 release.manifest.json 声明不一致（${path.basename(vendorInstallable.path)}），请重新同步 vendor 发布件`,
          kind: 'vendor',
        });
      } else if (syncEval.needsSync) {
        const syncTarget = prepareVendorInstallTarget({
          installable: vendorInstallable,
          manifest,
          projectRoot: opts.projectRoot,
          venvDirRel: cfg.venv_dir,
          artifactSha256: vendorArtifactSha,
          logPath,
        });
        if (!syncTarget) {
          errors.push({
            message: 'vendor 源码树暂存失败，无法自动对齐（详见 hylyre-doctor.log）',
            kind: 'vendor',
          });
        } else {
          const sync = syncVendorHylyreInVenv({
            pythonPath,
            installTarget: syncTarget,
            artifactKind: vendorInstallable.kind,
            artifactSha256: vendorArtifactSha,
            projectRoot: opts.projectRoot,
            logPath,
            pypiExtraIndexUrl: cfg.pypi_extra_index_url,
            manifest,
            venvRoot,
          });
          if (!sync.ok) {
            for (const msg of sync.errors) {
              errors.push({ message: msg, kind: 'pip' });
            }
            if (manifestVersion && sync.hylyreVersion.trim() !== manifestVersion.trim()) {
              errors.push({
                message: `hylyre 自动升级后版本仍不一致：pip=${sync.hylyreVersion} manifest=${manifestVersion}`,
                kind: 'version_drift',
              });
            }
          } else {
            hylyreVersion = sync.hylyreVersion;
            upgradedNow = sync.upgraded;
            if (sync.upgraded) {
              source = 'venv_installed';
            }
          }
        }
      }
    }
  } else if (
    source === 'env_override' &&
    manifestVersion &&
    hylyreVersion &&
    manifestVersion.trim() !== hylyreVersion.trim()
  ) {
    errors.push({
      message: `HYLYRE_PYTHON 环境 hylyre 版本与 vendor manifest 不一致（pip=${hylyreVersion} manifest=${manifestVersion}）。请手动升级该环境，或取消 HYLYRE_PYTHON 以使用默认 venv 自动对齐。`,
      kind: 'version_drift',
    });
  }

  hylyreVersion = pipShowVersion(pythonPath);

  const versionConsistent =
    !manifestVersion || !hylyreVersion ? true : manifestVersion.trim() === hylyreVersion.trim();
  if (!versionConsistent && source !== 'env_override') {
    errors.push({
      message: `hylyre 版本漂移：pip=${hylyreVersion} manifest=${manifestVersion}`,
      kind: 'version_drift',
    });
  }

  if (cfg.doctor_first_run && (installedNow || upgradedNow)) {
    const pollutionBefore = beginHylyrePhasePollutionGuard(opts.projectRoot);
    const doc = spawnHylyre({
      pythonPath,
      hypiumWorkDir,
      hylyreArgv: ['doctor'],
      logPath,
      maxBuffer: 8 * 1024 * 1024,
    });
    doctorOk = doc.status === 0;
    rootPollution = finishHylyrePhasePollutionGuard(opts.projectRoot, pollutionBefore, {
      phase: 'ensure',
      logPath,
    });
    if (!doctorOk) {
      errors.push({ message: `hylyre doctor 失败（exit=${doc.status}）`, kind: 'doctor' });
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            ok: false,
            pythonPath,
            hylyreVersion,
            manifestVersion,
            versionConsistent,
            doctorOk,
            hypium_workdir: hypiumWorkDir,
            ...(rootPollution ? { root_pollution: rootPollution } : {}),
            errors,
          },
          null,
          2,
        ),
        'utf-8',
      );
      return {
        ok: false,
        pythonPath,
        hylyreVersion,
        manifestVersion,
        versionConsistent,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
  } else {
    doctorOk = true;
  }

  // visual-capability-truth S2（P0-B）：中文 UTF-8 round-trip——每次 ready 必跑（廉价：
  // 单个 python 子进程），失败=BLOCKER 阻断 device testing（toolchain 类，非产品失败）。
  // 20260718 宿主事故：selector 中文在 stdout 管道变 '����'，把「页面不可达」误导成
  // 「编码破坏」；本探针使诊断通道字节保真可证。
  if (canImportHylyre(pythonPath, logPath)) {
    const rt = runHylyreUtf8RoundTrip({ pythonPath, hypiumWorkDir, logPath });
    appendLogSync(logPath, `utf8-roundtrip: ${rt.ok ? 'PASS' : 'FAIL'} — ${rt.detail}\n`);
    if (!rt.ok) {
      errors.push({
        message:
          `中文 UTF-8 round-trip 失败（steps→hylyre parser→predicate→stdout 全链）：${rt.detail}\n` +
          '修复指引：确认 venv Python ≥3.7 且未被宿主覆盖 PYTHONIOENCODING；重跑本 harness（env 注入 PYTHONUTF8/PYTHONIOENCODING 已内置）。',
        kind: 'utf8_roundtrip',
      });
    }
  }

  const ok = errors.length === 0;
  const installFingerprint =
    venvRoot && fs.existsSync(venvRoot) ? readInstallFingerprint(venvRoot) : null;
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        ok,
        pythonPath,
        hylyreVersion,
        manifestVersion,
        // Native evidence gate consumes this explicit version chain; retain
        // camelCase fields above for existing reports and diagnostics.
        installed_version: hylyreVersion,
        manifest_version: manifestVersion,
        version_consistent: versionConsistent,
        versionConsistent,
        source,
        doctorOk,
        vendorSyncReason,
        vendor_artifact_kind: vendorArtifactKind ?? null,
        installFingerprint,
        bootstrap_elapsed_ms: bootstrapElapsedMs ?? null,
        bootstrap_was_resumed: bootstrapWasResumed ?? null,
        hypium_workdir: hypiumWorkDir,
        ...(rootPollution ? { root_pollution: rootPollution } : {}),
        errors,
      },
      null,
      2,
    ),
    'utf-8',
  );

  return {
    ok,
    pythonPath,
    hylyreVersion,
    manifestVersion,
    versionConsistent,
    source,
    doctorOk,
    errors,
    logPath,
  };
}

// -------- runHylyreDeviceTest --------

function defaultPageSaveTimeoutMs(): number {
  const raw = process.env.HARNESS_HYLYRE_PAGE_SAVE_TIMEOUT_MS;
  if (raw && /^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  return 60_000;
}

/** hylyre run 结束后写入当前页快照，供下次派生读取 app-snapshot-cache/<bundle>/。失败不反转 ok。 */
function tryHylyreAppPageSaveAfterRun(args: {
  pythonPath: string;
  hypiumWorkDir: string;
  bundleName: string;
  deviceSn: string | undefined;
  appSnapshotCacheAbs: string;
  logPath: string;
  abilityName?: string | null;
  pageSlug?: string | null;
}): {
  attempted: boolean;
  exitCode: number | null;
  durationMs: number;
  logPath: string | null;
  names: Array<{ name: string; exit_code: number | null; duration_ms: number }>;
} {
  const pageNames = resolveHylyrePageSaveNames(args.pageSlug);
  const pageSaveLogPath = path.join(path.dirname(args.logPath), 'hylyre-page-save.log');
  fs.writeFileSync(
    pageSaveLogPath,
    `--- hylyre page save ${new Date().toISOString()} names=${pageNames.join(',')} ---\n`,
    'utf-8',
  );

  const names: Array<{ name: string; exit_code: number | null; duration_ms: number }> = [];
  let totalMs = 0;
  let aggregateExit: number | null = 0;

  for (const pageName of pageNames) {
    const pipArgs = buildHylyreAppPageSaveArgv({
      bundleName: args.bundleName,
      deviceSn: args.deviceSn,
      abilityName: args.abilityName,
      pageSlug: pageName,
    });
    const hylyreArgv = pipArgs[0] === '-m' && pipArgs[1] === 'hylyre' ? pipArgs.slice(2) : pipArgs;
    const t0 = Date.now();
    const r = spawnHylyre({
      pythonPath: args.pythonPath,
      hypiumWorkDir: args.hypiumWorkDir,
      hylyreArgv,
      appSnapshotCacheAbs: args.appSnapshotCacheAbs,
      logPath: args.logPath,
      maxBuffer: 2 * 1024 * 1024,
      timeout: defaultPageSaveTimeoutMs(),
      echoToStdout: false,
    });
    const durationMs = Date.now() - t0;
    totalMs += durationMs;
    const saveExit = r.status ?? 1;
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const spawnDiag =
      r.error?.message || r.signal
        ? `\nspawn: error=${r.error?.message ?? ''} signal=${r.signal ?? ''}\n`
        : '';
    appendLogSync(
      pageSaveLogPath,
      `\n--- save name=${pageName} exit=${saveExit} raw_status=${r.status} duration_ms=${durationMs} ---\n${out}${spawnDiag}`,
    );
    if (saveExit !== 0) {
      if (aggregateExit === 0) aggregateExit = saveExit;
      appendLogSync(
        args.logPath,
        `hylyre app page save name=${pageName} 结束 exit=${saveExit}（WARN：非致命；缓存可能未更新）\n`,
      );
    } else {
      appendLogSync(args.logPath, `hylyre app page save name=${pageName} 成功\n`);
    }
    names.push({ name: pageName, exit_code: saveExit, duration_ms: durationMs });
  }

  return {
    attempted: true,
    exitCode: aggregateExit,
    durationMs: totalMs,
    logPath: pageSaveLogPath,
    names,
  };
}

/** Build minimal trace/report after `hylyre run --steps-file` (no native report contract). */
export function synthesizeTraceFromStepsBatchRun(args: {
  runOut: string;
  feature: string;
  tracePath: string;
  reportPath: string;
}): { lastStepIndex: number | null; uiResetHint: string | null } {
  const batch = parseStepsBatchFromRunOut(args.runOut);
  const results = batch?.results ?? [];
  const anyErr = results.some(r => r.status !== 'ok');
  const lastStepIndex = computeLastFailedStepIndex(batch);
  const outcome = anyErr ? 'failed' : 'success';
  const uiResetHint = uiResetHintForOutcome(outcome, lastStepIndex);
  const trace = {
    schema_version: '0.1-p0',
    feature: args.feature,
    phase: 'testing',
    outcome,
    model_backend: 'none',
    cases: [
      {
        id: 'TC-001',
        status: anyErr ? '失败' : '通过',
        priority: 'P0',
        ac_ref: 'ad-hoc',
        notes: anyErr
          ? results
              .filter(r => r.status !== 'ok')
              .map(r => r.error ?? 'step error')
              .join('; ')
              .slice(0, 500)
          : '',
        name: 'adhoc steps batch',
      },
    ],
    artifacts: {
      adhoc: true,
      steps_file: true,
      last_step_index: lastStepIndex,
      ui_reset_hint: uiResetHint,
    },
  };
  fs.mkdirSync(path.dirname(args.tracePath), { recursive: true });
  fs.writeFileSync(args.tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf-8');
  const reportMd = [
    '# 测试报告（adhoc · steps-file 合成）',
    '',
    `feature: ${args.feature}`,
    '',
    '## 测试执行结果',
    '',
    '| 用例编号 | 状态 | 备注 |',
    '|----------|------|------|',
    `| TC-001 | ${anyErr ? '失败' : '通过'} | steps-file batch |`,
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(args.reportPath), { recursive: true });
  fs.writeFileSync(args.reportPath, reportMd, 'utf-8');
  return { lastStepIndex, uiResetHint };
}

export function runHylyreDeviceTest(opts: HylyreRunOptions): HylyreRunResult {
  const errors: HylyreRunResult['errors'] = [];
  const { reportsBase, hypiumWorkDir } = resolveHylyreRuntimeWorkDir(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    opts.frameworkRoot,
  );
  fs.mkdirSync(reportsBase, { recursive: true });
  const pollutionBefore = beginHylyrePhasePollutionGuard(opts.projectRoot);
  const logPath = path.join(reportsBase, 'device-test-run.log');
  const metaPath = path.join(reportsBase, 'device-test-run.meta.json');
  const runDerivedPlanPath = path.resolve(opts.derivedPlanPath);
  const runTopPlanPath = opts.topPlanPath ? path.resolve(opts.topPlanPath) : null;
  const runDerivedPlanSha256 = safeFileSha256(runDerivedPlanPath);
  const runTopPlanSha256 = runTopPlanPath ? safeFileSha256(runTopPlanPath) : null;

  ensureDirForFile(opts.reportOutPath);
  ensureDirForFile(opts.traceOutPath);
  fs.writeFileSync(
    logPath,
    `--- hylyre run ${new Date().toISOString()} feature=${opts.feature} ---\n`,
    'utf-8',
  );
  appendLogSync(
    logPath,
    `hypium 工作目录（cwd）: ${hypiumWorkDir}（tmp_hypium 将落在其下，不写入工程根）\n`,
  );

  const abilityResolved = resolveHypiumPageNameForRun(
    opts.projectRoot,
    opts.bundleName,
    opts.hypiumPageName,
    opts.deviceSn,
  );
  const pageName = abilityResolved.pageName;
  let omitBundleForHylyre = false;
  let coldRestartAttempted = false;
  let coldRestartOk: boolean | null = null;

  if (pageName) {
    if (opts.coldRestart) {
      const stop = runAaForceStop(opts.bundleName, opts.deviceSn, logPath);
      coldRestartAttempted = stop.attempted;
      coldRestartOk = stop.ok;
      if (!stop.ok) {
        appendLogSync(logPath, '[WARN] aa force-stop 未成功，仍尝试 aa start\n');
      }
    }
    // P1（三轮 review）：**操作前**先确保设备就绪，且这是**硬前置**——
    // 确认为外部阻断时一次 `aa start` 都不发，直接走 device_locked 结论。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bridge = require('../device-recovery-bridge') as typeof import('../device-recovery-bridge');
    const preReady = bridge.ensureReadyBefore(opts.projectRoot, opts.deviceSn);
    appendLogSync(logPath, `[device-ready/testing-run] ${preReady.note}\n`);

    let lockedAndUnrecovered = preReady.blocked;
    let pre = preReady.blocked
      ? {
          ok: false,
          output: `[device-ready] 运行前置检查判定设备不可用，已阻断（未执行 aa start）：${preReady.note}`,
        }
      : runAaStartPreflight(opts.bundleName, pageName, opts.deviceSn, logPath);
    // S9：**正式 testing 运行链路**的运行期锁屏恢复。`aa start` 是 testing 侧第一个真正
    // 触碰设备的动作，手机在此前刚锁屏时会失败并被归成 aa_start_preflight_failed。
    // 与其它边界同款：只在锁屏信号命中时恢复一次，恢复失败如实失败、不重试不切目标。
    if (!pre.ok && !lockedAndUnrecovered
        && /screen is locked|unlock screen failed|need.*unlock|10106102/i.test(pre.output)) {
      const rec = recoverDeviceLockForRun(opts.projectRoot, opts.deviceSn);
      appendLogSync(logPath, `[device-recovery/testing-run] ${rec.note}\n`);
      if (rec.recovered) pre = runAaStartPreflight(opts.bundleName, pageName, opts.deviceSn, logPath);
      // P1（三轮）：恢复失败必须**保留锁屏这个真因**，否则结论层只看到
      // aa_start_preflight_failed → 归 device_toolchain → 指引变成"查签名"。
      if (!pre.ok) lockedAndUnrecovered = true;
    }
    if (!pre.ok) {
      errors.push({
        message: `hdc aa start 预启动失败（ability=${pageName} bundle=${opts.bundleName} source=${abilityResolved.source}）。Hypium 在部分环境无法从 bm dump 推断 main ability，依赖此步后再跑 hylyre plan。输出节选：\n${pre.output.slice(0, 2000)}`,
      });
      const preflightKind: RunFailureKind = lockedAndUnrecovered
        ? 'device_locked'
        : 'aa_start_preflight_failed';
      const rootPollutionEarly = finishHylyrePhasePollutionGuard(opts.projectRoot, pollutionBefore, {
        phase: 'run',
        logPath,
      });
      const tracePathResolved = path.resolve(opts.traceOutPath);
      ensureDirForFile(tracePathResolved);
      fs.writeFileSync(
        tracePathResolved,
        `${JSON.stringify(
          {
            schema_version: '0.2-p4',
            feature: opts.feature,
            phase: 'testing',
            outcome: 'failed',
            error_kind: 'run_crashed',
            run_failure_kind: preflightKind,
            error_message: errors.map(e => e.message).join(' | ').slice(0, 2000),
            cases: [],
          },
          null,
          2,
        )}\n`,
        'utf-8',
      );
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            exit_code: null,
            ok: false,
            command: '',
            report_path: path.resolve(opts.reportOutPath),
            trace_path: tracePathResolved,
            log_path: logPath,
            bundleName: opts.bundleName,
            hypium_page_name: pageName,
            main_ability_source: abilityResolved.source,
            app_meta_path: abilityResolved.appMetaPath,
            aa_start_preflight: true,
            aa_start_ok: false,
            omit_bundle_for_hylyre: false,
            cold_restart: opts.coldRestart === true,
            cold_restart_attempted: coldRestartAttempted,
            cold_restart_ok: coldRestartOk,
            deviceSn: opts.deviceSn ?? null,
            ran_at: new Date().toISOString(),
            run_failure_kind: preflightKind,
            trace_summary: null,
            hypium_workdir: hypiumWorkDir,
            ...(rootPollutionEarly ? { root_pollution: rootPollutionEarly } : {}),
            errors,
          },
          null,
          2,
        ),
        'utf-8',
      );
      return {
        executed: true,
        exitCode: null,
        ok: false,
        command: '',
        reportPath: null,
        // P1（三轮 review）：**必须回传 trace**。此前这里写了 trace 文件却返回 null，
        // 结论层读 `run.trace?.run_failure_kind` 永远拿不到，device_locked 与
        // aa_start_preflight_failed 在上游依旧无法区分——文件写了等于没写。
        tracePath: tracePathResolved,
        trace: readJsonSafe<HylyreTrace>(tracePathResolved),
        logPath,
        errors,
      };
    }
    omitBundleForHylyre = true;
  }

  const stepsFile = (opts.stepsFilePath ?? '').trim();
  const useStepsFile = stepsFile.length > 0 && fs.existsSync(stepsFile);

  const hylyreArgv: string[] = ['run'];
  if (useStepsFile) {
    hylyreArgv.push('--steps-file', path.resolve(stepsFile));
    if (!omitBundleForHylyre) {
      hylyreArgv.push('--bundle', opts.bundleName);
    }
    if (pageName) {
      hylyreArgv.push('--page-name', pageName);
    }
  } else {
    hylyreArgv.push(
      '--plan',
      path.resolve(opts.derivedPlanPath),
      '--feature',
      opts.feature,
      '--report-out',
      path.resolve(opts.reportOutPath),
      '--trace-out',
      path.resolve(opts.traceOutPath),
    );
    if (!omitBundleForHylyre) {
      hylyreArgv.push('--bundle', opts.bundleName);
    }
    if (opts.skipAssertExpected !== false) {
      hylyreArgv.push('--skip-assert-expected');
    }
  }

  if (opts.deviceSn && opts.deviceSn.trim()) {
    hylyreArgv.push('--device-sn', opts.deviceSn.trim());
  }

  const failureDir = path.join(path.dirname(path.resolve(opts.reportOutPath)), 'failures');
  hylyreArgv.push('--failure-dir', failureDir);

  const command = `${opts.pythonPath} -m hylyre ${hylyreArgv.join(' ')}`;

  const runStartedAt = new Date().toISOString();
  const runT0 = Date.now();
  const run = spawnHylyre({
    pythonPath: opts.pythonPath,
    hypiumWorkDir,
    hylyreArgv,
    appSnapshotCacheAbs: opts.appSnapshotCacheAbs,
    logPath,
    maxBuffer: 64 * 1024 * 1024,
    timeout: defaultRunTimeoutMs(opts),
  }) as SpawnSyncReturns<string>;

  const runOut = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (run.error) {
    errors.push({ message: run.error.message });
  }

  const exitCode = run.status;
  const tracePathResolved = path.resolve(opts.traceOutPath);
  const reportPathResolved = path.resolve(opts.reportOutPath);

  let batchLastStepIndex: number | null = null;
  let batchUiResetHint: string | null = null;
  if (useStepsFile && exitCode === 0) {
    const syn = synthesizeTraceFromStepsBatchRun({
      runOut,
      feature: opts.feature,
      tracePath: tracePathResolved,
      reportPath: reportPathResolved,
    });
    batchLastStepIndex = syn.lastStepIndex;
    batchUiResetHint = syn.uiResetHint;
  } else if (useStepsFile && exitCode !== 0) {
    const batch = parseStepsBatchFromRunOut(runOut);
    batchLastStepIndex = computeLastFailedStepIndex(batch);
    batchUiResetHint = uiResetHintForOutcome('failed', batchLastStepIndex);
  }

  let trace = parseHylyreTrace(tracePathResolved);
  let runFailureKind: RunFailureKind | null = null;

  if (!trace && exitCode !== 0) {
    runFailureKind = classifyRunFailure(runOut, exitCode);
    ensureDirForFile(tracePathResolved);
    fs.writeFileSync(
      tracePathResolved,
      `${JSON.stringify(
        {
          schema_version: '0.2-p4',
          feature: opts.feature,
          phase: 'testing',
          outcome: 'failed',
          error_kind: 'run_crashed',
          run_failure_kind: runFailureKind,
          error_message: runOut.slice(-2000),
          cases: [],
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    trace = parseHylyreTrace(tracePathResolved);
  }

  /** plan 跑完后用例失败会导致 exit≠0；若有合法 trace 仍视为「自动化 runner 未崩溃」。Python Traceback（缺打包资源等）不算可接受失败。 */
  const pythonInfraTraceback =
    exitCode !== 0 &&
    /Traceback \(most recent call last\)/.test(runOut) &&
    /(FileNotFoundError|ModuleNotFoundError|PermissionError|verify_report)/.test(runOut);

  let ok = exitCode === 0;
  if (!ok && trace && trace.feature && trace.outcome && !pythonInfraTraceback) {
    const caseCount = trace.cases?.length ?? 0;
    if (caseCount > 0) {
      ok = true;
    }
  }
  if (!ok) {
    if (pythonInfraTraceback) {
      errors.push({
        message:
          'hylyre 子进程因 Python 异常退出（常见为旧发布件未携带 hylyre/contracts）。请重新执行 testing 阶段 ensure（将尝试从 vendor 发布件强制重装）或删除 .hylyre/venv 后重试，并确认 vendor 为含 contracts 的发布件。',
      });
    } else {
      errors.push({
        message:
          exitCode === null && run.signal
            ? `进程被信号终止：${run.signal}`
            : `hylyre run 异常退出 exit=${exitCode} 且无有效 trace.json`,
      });
    }
  }

  const cases = trace?.cases ?? [];
  const failed_count = cases.filter(c => c.status === '失败').length;
  const blocked_count = cases.filter(c => c.status === '阻塞').length;
  const skipped_count = cases.filter(c => c.status === '跳过').length;

  const pageSave = opts.skipPageSave
    ? { attempted: false, exitCode: null, durationMs: 0, logPath: null, names: [] as Array<{ name: string; exit_code: number | null; duration_ms: number }> }
    : tryHylyreAppPageSaveAfterRun({
        pythonPath: opts.pythonPath,
        hypiumWorkDir,
        bundleName: opts.bundleName,
        deviceSn: opts.deviceSn,
        appSnapshotCacheAbs: opts.appSnapshotCacheAbs,
        logPath,
        abilityName: pageName,
      });

  const runEndedAt = new Date().toISOString();
  const runDurationMs = Date.now() - runT0;
  const rootPollution = finishHylyrePhasePollutionGuard(opts.projectRoot, pollutionBefore, {
    phase: 'run',
    logPath,
  });

  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        exit_code: exitCode,
        ok,
        command,
        report_path: reportPathResolved,
        trace_path: tracePathResolved,
        log_path: logPath,
        bundleName: opts.bundleName,
        hypium_page_name: pageName,
        main_ability_source: abilityResolved.source,
        app_meta_path: abilityResolved.appMetaPath,
        run_mode: useStepsFile ? 'steps_file' : 'plan',
        steps_file_path: useStepsFile ? path.resolve(stepsFile) : null,
        aa_start_preflight: Boolean(pageName),
        aa_start_ok: pageName ? true : null,
        omit_bundle_for_hylyre: omitBundleForHylyre,
        cold_restart: opts.coldRestart === true,
        cold_restart_attempted: coldRestartAttempted,
        cold_restart_ok: coldRestartOk,
        last_step_index: batchLastStepIndex,
        ui_reset_hint: batchUiResetHint,
        deviceSn: opts.deviceSn ?? null,
        hypium_workdir: hypiumWorkDir,
        run_started_at: runStartedAt,
        run_ended_at: runEndedAt,
        run_duration_ms: runDurationMs,
        ran_at: runEndedAt,
        artifact_binding: {
          test_plan_path: runTopPlanPath,
          test_plan_sha256: runTopPlanSha256,
          derived_plan_path: runDerivedPlanPath,
          derived_plan_sha256: runDerivedPlanSha256,
          trace_path: tracePathResolved,
          trace_sha256: safeFileSha256(tracePathResolved),
        },
        failure_dir: failureDir,
        hylyre_page_save: {
          attempted: pageSave.attempted,
          exit_code: pageSave.exitCode,
          duration_ms: pageSave.durationMs,
          log_path: pageSave.logPath,
          names: pageSave.names,
        },
        trace_summary: trace
          ? {
              outcome: trace.outcome,
              cases_count: cases.length,
              failed_count,
              blocked_count,
              skipped_count,
            }
          : null,
        run_failure_kind: runFailureKind,
        run_out_tail: runOut.slice(-1000),
        ...(rootPollution ? { root_pollution: rootPollution } : {}),
        errors,
      },
      null,
      2,
    ),
    'utf-8',
  );

  return {
    executed: true,
    exitCode,
    ok,
    command,
    reportPath: fs.existsSync(reportPathResolved) ? reportPathResolved : null,
    tracePath: fs.existsSync(tracePathResolved) ? tracePathResolved : null,
    trace,
    logPath,
    errors,
  };
}

// -------- parseHylyreTrace --------

export function parseHylyreTrace(tracePath: string): HylyreTrace | null {
  const raw = readJsonSafe<Record<string, unknown>>(tracePath);
  if (!raw) return null;
  if (typeof raw.feature !== 'string' || typeof raw.outcome !== 'string') return null;
  const cases = Array.isArray(raw.cases) ? (raw.cases as HylyreTraceCase[]) : undefined;
  return {
    // 先摊开原始文档：本函数返回的是**投影**，而冻结 schema 校验的是完整文档。
    // 只保留下面这些具名字段会丢掉 `model_backend` 等契约必填项，
    // 于是合法 trace 会被 schema 判成"缺必填字段"——投影不得成为校验对象的裁剪器。
    ...raw,
    schema_version: typeof raw.schema_version === 'string' ? raw.schema_version : '',
    ...(typeof raw.result_protocol === 'string' ? { result_protocol: raw.result_protocol } : {}),
    feature: raw.feature,
    phase: typeof raw.phase === 'string' ? raw.phase : '',
    outcome: raw.outcome,
    cases,
    environment:
      raw.environment && typeof raw.environment === 'object' && !Array.isArray(raw.environment)
        ? (raw.environment as HylyreTraceEnvironment)
        : undefined,
    artifacts: typeof raw.artifacts === 'object' && raw.artifacts !== null ? (raw.artifacts as Record<string, unknown>) : undefined,
    retries: typeof raw.retries === 'number' ? raw.retries : undefined,
    tool_calls: Array.isArray(raw.tool_calls) ? (raw.tool_calls as Array<Record<string, unknown>>) : undefined,
    runtime_step_telemetry:
      raw.runtime_step_telemetry && typeof raw.runtime_step_telemetry === 'object'
        ? (raw.runtime_step_telemetry as RuntimeStepTelemetry)
        : undefined,
  };
}

const CASE_STATUSES = new Set(['通过', '失败', '阻塞', '跳过']);
const CASE_EXECUTIONS = new Set(['completed', 'aborted', 'infrastructure_failed']);
const CASE_VERIFICATIONS = new Set(['passed', 'failed', 'inconclusive']);
const CASE_EVIDENCE = new Set(['complete', 'incomplete']);
const EXPECTED_CHECK_MODES = new Set([
  'checked_vlm',
  'disabled_by_flag',
  'unavailable_no_vlm',
  'empty',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredString(record: Record<string, unknown>, key: string, label: string, errors: string[]): void {
  if (typeof record[key] !== 'string' || record[key].trim().length === 0) {
    errors.push(`${label}.${key} 缺失或非法`);
  }
}

function requiredEnum(
  record: Record<string, unknown>,
  key: string,
  values: ReadonlySet<string>,
  label: string,
  errors: string[],
): void {
  if (typeof record[key] !== 'string' || !values.has(record[key])) {
    errors.push(`${label}.${key} 值域非法：${String(record[key])}`);
  }
}

/**
 * trace 内容合法性判定。
 *
 * plan a6c4e9f2 T4 返修：这里原来是一套**手写的 0.3 形状校验**
 * （逐字段查 status/failure_kind/failure_code/evidence/error 与旧 selector 三件套）。
 * 它有两个致命后果——合法 v1 因为没有那些 flat 字段而被判非法；而 0.3 内核套上
 * 0.4-p0 信封时，这套校验反而"看得懂"。第二套形状定义本身就是错误来源。
 *
 * 现在委派给唯一裁决入口 `requireV1ForGate`：dispatch 键 → 冻结
 * `output-schema.json` 运行期校验 → 跨行不变量（判据移植自冻结包 reference_reducer）。
 * 本函数只保留 schema 管不到、且属于 **Maison 侧期望**的检查：
 *   - `phase === 'testing'`：契约不关心 phase 取值，是本仓要求 trace 来自 testing 阶段。
 * 版本链一致性（manifest/installed/trace）仍由 `evaluateHylyreNativeEvidenceGate` 自己判——
 * 那是部署问题，不是 Hylyre 契约问题。
 */
function validateNativeTraceShape(trace: HylyreTrace | null, frameworkRoot?: string | null): string[] {
  if (!trace) return ['trace 不可解析'];
  const verdict = requireV1ForGate(trace, { frameworkRoot });
  if (!verdict.ok) {
    return [verdict.detail, verdict.suggestion].filter(Boolean);
  }
  const errors: string[] = [];
  if (trace.phase !== 'testing') errors.push(`trace.phase=${String(trace.phase)} 非 testing`);
  return errors;
}

function readyMetaString(
  ready: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!ready) return null;
  for (const key of keys) {
    if (typeof ready[key] === 'string' && ready[key].trim()) return ready[key].trim();
  }
  return null;
}

/**
 * Atomic native/legacy switch. The native path is enabled only when the
 * installed/manifest/trace environment version chain, schema, and every
 * required CaseResult/StepResult field are valid. Legacy status is never
 * promoted to native verification by this function.
 */
export function evaluateHylyreNativeEvidenceGate(opts: {
  trace: HylyreTrace | null;
  readyMeta?: unknown;
  installedVersion?: string | null;
  readyManifestVersion?: string | null;
  manifestVersion?: string | null;
  /** 定位随发布件下发的 vendored 冻结 schema；省略时从模块位置向上推断。 */
  frameworkRoot?: string | null;
}): HylyreEvidenceGateResult {
  const ready = isRecord(opts.readyMeta) ? opts.readyMeta : null;
  const installedVersion = (
    readyMetaString(ready, ['installed_version', 'installed', 'hylyreVersion', 'hylyre_version']) ??
    opts.installedVersion?.trim() ??
    null
  );
  const readyManifestVersion = (
    readyMetaString(ready, ['manifest_version', 'manifest', 'manifestVersion']) ??
    opts.readyManifestVersion?.trim() ??
    null
  );
  const manifestVersion = opts.manifestVersion?.trim() || null;
  const traceVersion = opts.trace?.environment?.hylyre_version?.trim() || null;
  const traceSchemaVersion = opts.trace?.environment?.trace_schema_version?.trim() || null;
  const reasons: string[] = [];

  if (ready && ready.ok !== true) reasons.push('hylyre-ready.meta.json ok 不是 true');
  if (ready && ready.doctorOk !== true) reasons.push('hylyre-ready.meta.json doctorOk 不是 true');
  if (ready && ready.version_consistent !== true && ready.versionConsistent !== true) {
    reasons.push('hylyre-ready.meta.json versionConsistent 不是 true');
  }
  if (!manifestVersion) reasons.push('release.manifest.json 缺少 hylyre_version');
  if (!installedVersion) reasons.push('hylyre-ready.meta.json 缺少 installed version');
  if (!readyManifestVersion) reasons.push('hylyre-ready.meta.json 缺少 manifest version');
  if (!traceVersion) reasons.push('trace.environment.hylyre_version 缺失');
  if (manifestVersion && installedVersion && manifestVersion !== installedVersion) {
    reasons.push(`manifest=${manifestVersion} 与 installed=${installedVersion} 不一致`);
  }
  if (manifestVersion && readyManifestVersion && manifestVersion !== readyManifestVersion) {
    reasons.push(`release manifest=${manifestVersion} 与 ready manifest=${readyManifestVersion} 不一致`);
  }
  if (manifestVersion && traceVersion && manifestVersion !== traceVersion) {
    reasons.push(`manifest=${manifestVersion} 与 trace.environment=${traceVersion} 不一致`);
  }
  if (installedVersion && traceVersion && installedVersion !== traceVersion) {
    reasons.push(`installed=${installedVersion} 与 trace.environment=${traceVersion} 不一致`);
  }
  if (installedVersion && compareVersionParts(installedVersion, MIN_NATIVE_HYLYRE_VERSION) < 0) {
    reasons.push(`installed=${installedVersion} 低于 native 最低版本 ${MIN_NATIVE_HYLYRE_VERSION}`);
  }
  if (opts.trace?.schema_version !== NATIVE_TRACE_SCHEMA_VERSION || traceSchemaVersion !== NATIVE_TRACE_SCHEMA_VERSION) {
    reasons.push(`trace schema 链不满足 ${NATIVE_TRACE_SCHEMA_VERSION}`);
  }
  // 协议声明与 schema 同为判别键：root 与 environment 都必须声明且一致，
  // 否则就是产出方自己不自洽——比未知 schema 更危险，不得当 native 消费。
  if (opts.trace?.result_protocol !== NATIVE_RESULT_PROTOCOL) {
    reasons.push(`trace.result_protocol=${String(opts.trace?.result_protocol)}，期望 ${NATIVE_RESULT_PROTOCOL}`);
  }
  if (opts.trace?.environment && opts.trace.environment.result_protocol !== NATIVE_RESULT_PROTOCOL) {
    reasons.push(
      `trace.environment.result_protocol=${String(opts.trace.environment.result_protocol)}，期望 ${NATIVE_RESULT_PROTOCOL}`,
    );
  }
  reasons.push(...validateNativeTraceShape(opts.trace, opts.frameworkRoot));

  const native = reasons.length === 0;
  const legacy = Boolean(
    opts.trace &&
    LEGACY_TRACE_SCHEMA_VERSIONS.has(opts.trace.schema_version) &&
    opts.trace.runtime_step_telemetry,
  );
  return {
    mode: native ? 'native' : legacy ? 'legacy' : 'unsupported',
    native,
    legacy,
    minimumVersion: MIN_NATIVE_HYLYRE_VERSION,
    installedVersion,
    manifestVersion,
    traceVersion,
    traceSchemaVersion,
    reasons: [...new Set(reasons)],
  };
}
