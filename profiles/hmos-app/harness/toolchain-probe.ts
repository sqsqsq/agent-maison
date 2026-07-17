// ============================================================================
// toolchain-probe.ts — hvigor 工具链探针真值（t6，plan e6a3c9f4 / openspec toolchain-probe-truth）
// ----------------------------------------------------------------------------
// 07-16 宿主事故 A 根治件（post-impl review 后 v2——修恢复死锁/信任边界/证据采集三 BLOCKER）：
//   1. classifyHvigorEnvError：错误码**证据分层**——00303217=sdk_home_missing_or_invalid、
//      00303168=sdk_component_missing（中性事实）；仅当 manifest 格式/SDK 版本/hvigor 版本
//      三证据齐备才升级 *_incompatible_suspected（无证据绝不断言"版本不兼容"）。
//   2. computeHvigorInvocationFingerprint / computeHvigorConfigDigest：唯一共享 helper——
//      写入方（wrapper）与读取方（preflight）同源。config digest 只含工程配置文件，
//      **配置/依赖变更 → 状态自动失效回 unknown**（preflight 无 invocation dims 也能比对）。
//   3. project_compile 三态状态机（v4——codex 第三轮阻断1：粘滞授予有无限放行窗口，废弃）：
//        capability_failed（可信+config 新鲜+未过期）→ preflight **恒拦截**（纯读、无副作用）。
//        解除拦截仅三条路径，全部可审计：
//          a. config/DevEco/SDK 摘要漂移 → 状态自动失效回 unknown（环境可观测变化）；
//          b. 人工 reprobe（check-personal-setup --ensure，人类主动动作且 cli 真实可启动）→
//             resetCapabilityFailedByHumanReprobe **降级重置** unknown（绝不升级 verified）；
//          c. wrapper 真实编译结果改写（source_failure 清除 / verified / 重新 capability_failed）。
//        环境没修、直接 resume → 再次 halt（不烧 agent 预算，无穷放行窗口不存在）；
//        unknown 放行=一次真实编译定谳，与新工程首编译同信任级。
//        capability_failed 是**环境级**状态：仅 ENV_LEVEL_CAPABILITY_FAILURE_CODES 白名单码
//        可写入（SDK/装配层失败对所有 invocation 成立），preflight 无 invocation 维度是设计而非缺陷；
//        invocation_fingerprint 仅对 verified 参与失效判定，对 capability_failed 只是留痕（provenance）。
//   4. 完整性摘要（integrity）：probe 载荷绑定 sha256 摘要，peek/resolve 校验失配 →
//      按 unknown 处理。**诚实边界**：这是防手滑/威慑（同 vision.canary 信任级），非密码学
//      防护——但伪造的收益面为零：probe 从不放行任何门禁，只提前 halt；篡改只能把状态
//      弄回 unknown（= 老老实实重跑编译），伪造 verified 不通过任何 gate。
//      写入权限：--ensure 写 binary/cli_starts + 可**降级重置** capability_failed→unknown
//      （人工 reprobe，绝不升级）；verified/capability_failed 的建立只归 wrapper。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadLocalConfig,
  writeLocalConfig,
  type FrameworkLocalConfig,
} from '../../../harness/scripts/utils/framework-local-config';
import { deriveSdkHomeFromInstallPath } from '../../../harness/config';
import { buildCompactDiagnosticHeader } from './diagnostic-header';

// ---------------------------------------------------------------------------
// 1. 错误码证据分层分类
// ---------------------------------------------------------------------------

export interface HvigorEnvEvidence {
  sdk_manifest_format?: string; // 如 'oh-uni-package.json' / 'sdk-pkg.json'
  sdk_version?: string;
  hvigor_version?: string;
}

export interface HvigorEnvErrorClassification {
  code:
    | 'sdk_home_missing_or_invalid'
    | 'sdk_component_missing'
    | 'sdk_layout_or_version_incompatible_suspected';
  /** ≤180 字单行诊断头（details 首行，不埋日志尾） */
  header: string;
  /** 可执行下一步指引 */
  guidance: string;
  /** 支撑升级判定的证据清单（无证据=空） */
  evidence: string[];
}

export function classifyHvigorEnvError(
  logText: string,
  evidence?: HvigorEnvEvidence,
): HvigorEnvErrorClassification | null {
  if (/ERROR:\s*00303217/.test(logText)) {
    return {
      code: 'sdk_home_missing_or_invalid',
      header: buildCompactDiagnosticHeader(
        'hvigor 00303217：DEVECO_SDK_HOME 缺失或取值非法（sdk_home_missing_or_invalid）——' +
          'framework 调用链会从 installPath 自动派生该变量，手动直调 hvigor 才需要自设。',
      ),
      guidance:
        '优先走 framework 调用链（harness coding.compile provider 已自动派生 DEVECO_SDK_HOME）；' +
        '若必须手动调用，核对 framework.local.json > toolchain.devEcoStudio.installPath 并 export {installPath}/sdk。',
      evidence: [],
    };
  }
  if (/ERROR:\s*00303168/.test(logText)) {
    const proof: string[] = [];
    if (evidence?.sdk_manifest_format) proof.push(`sdk_manifest_format=${evidence.sdk_manifest_format}`);
    if (evidence?.sdk_version) proof.push(`sdk_version=${evidence.sdk_version}`);
    if (evidence?.hvigor_version) proof.push(`hvigor_version=${evidence.hvigor_version}`);
    const upgraded = proof.length >= 3;
    if (upgraded) {
      return {
        code: 'sdk_layout_or_version_incompatible_suspected',
        header: buildCompactDiagnosticHeader(
          `hvigor 00303168：SDK component 解析失败，证据指向 SDK 布局/版本与 hvigor 不匹配（suspected；${proof.join('、')}）。`,
        ),
        guidance:
          '三选一：①用 DevEco SDK Manager 安装与当前 hvigor 配套的 SDK；②降级 hvigor 到与本地 SDK 配套版本；' +
          '③改用 DevEco IDE 内构建（GUI 走不同装配路径）。归因保留 suspected——最终确证以 framework 完整调用链复测为准。',
        evidence: proof,
      };
    }
    return {
      code: 'sdk_component_missing',
      header: buildCompactDiagnosticHeader(
        'hvigor 00303168：SDK component 解析失败（sdk_component_missing，中性事实）——' +
          '未取得 SDK manifest 格式/SDK 版本/hvigor 版本三证据前，不得断言"版本不兼容"。',
      ),
      guidance:
        '取证后再归因：①ls $DEVECO_SDK_HOME 下 component 目录与描述文件名（oh-uni-package.json vs sdk-pkg.json）；' +
        '②读 SDK 版本清单；③hvigorw --version。证据齐备后重新分类（可能升级为 layout/version incompatible suspected）。',
      evidence: proof,
    };
  }
  return null;
}

/**
 * 生产链证据采集（best-effort，BLOCKER2 修复：让 incompatible_suspected 分支在真实链可达）：
 * SDK manifest 格式=扫 sdkHome 下 component 描述文件名；SDK 版本=读描述文件 version 字段；
 * hvigor 版本=--ensure 缓存的 cli_starts.hvigor_version。任一采不到即缺项（不臆造）。
 */
export function collectHvigorEnvEvidence(projectRoot: string): HvigorEnvEvidence {
  const out: HvigorEnvEvidence = {};
  try {
    const local = loadLocalConfig(projectRoot) as LocalWithProbe | null;
    const installPath = local?.toolchain?.devEcoStudio?.installPath;
    const cliVersion = local?.toolchain?.probe?.cli_starts?.hvigor_version;
    if (cliVersion) out.hvigor_version = cliVersion;
    const sdkHome = deriveSdkHomeFromInstallPath(installPath);
    if (sdkHome && fs.existsSync(sdkHome)) {
      const stack: string[] = [sdkHome];
      let visited = 0;
      while (stack.length > 0 && visited < 200 && (!out.sdk_manifest_format || !out.sdk_version)) {
        const cur = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(cur, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const ent of entries) {
          visited += 1;
          const full = path.join(cur, ent.name);
          if (ent.isDirectory()) {
            stack.push(full);
            continue;
          }
          if (ent.name === 'oh-uni-package.json' || ent.name === 'uni-package.json' || ent.name === 'sdk-pkg.json') {
            out.sdk_manifest_format = out.sdk_manifest_format ?? ent.name;
            if (!out.sdk_version) {
              try {
                const parsed = JSON.parse(fs.readFileSync(full, 'utf-8')) as { version?: string; apiVersion?: string };
                const v = parsed.version ?? parsed.apiVersion;
                if (typeof v === 'string' && v.trim()) out.sdk_version = v.trim();
              } catch {
                /* 描述文件不可解析——版本证据缺项 */
              }
            }
          }
        }
      }
    }
  } catch {
    /* best-effort：采不到就是缺项 */
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. invocation 指纹与 config 摘要（唯一共享 helper）
// ---------------------------------------------------------------------------

export interface HvigorInvocationDims {
  module: string;
  target: string;
  task: string;
  product?: string;
  buildMode?: string;
}

const FINGERPRINT_CONFIG_FILES = [
  'build-profile.json5',
  path.join('hvigor', 'hvigor-config.json5'),
  'oh-package.json5',
  'oh-package-lock.json5',
];

function fileDigest(abs: string): string {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 12);
  } catch {
    return 'absent';
  }
}

const DIGEST_SKIP_DIRS = new Set(['node_modules', 'oh_modules', '.git', '.hvigor', 'build', 'dist', '.idea', 'doc', 'framework']);

/**
 * 工程配置/工具链装配态摘要——不含 invocation dims，preflight 可独立重算比对。
 * v3（codex 高优5）覆盖扩容：根配置 + module 级 build-profile/oh-package（浅扫两层）
 * + framework.local 的 DevEco 装配路径 + SDK 描述文件指纹（格式+版本）——切换 SDK/
 * DevEco/模块配置任一 → 摘要变 → 状态自动失效回 unknown。
 */
export function computeHvigorConfigDigest(projectRoot: string): string {
  const parts = FINGERPRINT_CONFIG_FILES.map(rel => `${rel}=${fileDigest(path.join(projectRoot, rel))}`);
  // module 级配置（浅扫一层子目录；bounded）
  try {
    for (const ent of fs.readdirSync(projectRoot, { withFileTypes: true })) {
      if (!ent.isDirectory() || DIGEST_SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      for (const cfg of ['build-profile.json5', 'oh-package.json5']) {
        const abs = path.join(projectRoot, ent.name, cfg);
        if (fs.existsSync(abs)) parts.push(`${ent.name}/${cfg}=${fileDigest(abs)}`);
      }
    }
  } catch {
    /* best-effort */
  }
  // DevEco 装配路径 + SDK 描述指纹（换装即失效）
  try {
    const local = loadLocalConfig(projectRoot) as LocalWithProbe | null;
    const deveco = local?.toolchain?.devEcoStudio;
    parts.push(`deveco=${deveco?.installPath ?? ''}::${deveco?.hvigorBin ?? ''}`);
    const ev = collectHvigorEnvEvidence(projectRoot);
    parts.push(`sdk=${ev.sdk_manifest_format ?? ''}::${ev.sdk_version ?? ''}`);
  } catch {
    /* best-effort */
  }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

export function computeHvigorInvocationFingerprint(
  projectRoot: string,
  dims: HvigorInvocationDims,
): string {
  const parts = [
    `module=${dims.module}`,
    `target=${dims.target}`,
    `task=${dims.task}`,
    `product=${dims.product ?? ''}`,
    `buildMode=${dims.buildMode ?? ''}`,
    `config=${computeHvigorConfigDigest(projectRoot)}`,
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// 3. probe 状态机
// ---------------------------------------------------------------------------

export const TOOLCHAIN_PROBE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ProjectCompileStatus = 'unknown' | 'verified' | 'capability_failed';

/**
 * capability_failed 只允许写入这些**环境级**失败码（对所有 invocation 成立，preflight
 * 全局拦截才语义成立）；非白名单码只能进 last_attempt 人读留痕（v4，codex 高优3）。
 */
export const ENV_LEVEL_CAPABILITY_FAILURE_CODES: ReadonlySet<string> = new Set([
  'sdk_home_missing_or_invalid',
  'sdk_component_missing',
  'sdk_layout_or_version_incompatible_suspected',
]);

export interface ProjectCompileProbe {
  status: ProjectCompileStatus;
  failure_code?: string | null;
  evidence?: string[];
  /** 定谳时的调用维度指纹：verified 参与失效判定；capability_failed（环境级）仅留痕 */
  invocation_fingerprint?: string;
  config_digest?: string;
  observed_at?: string;
  expires_at?: string;
  /** 载荷完整性摘要（防手滑/威慑；失配按 unknown 处理——伪造不通过任何 gate，只能回 unknown） */
  integrity?: string;
}

type LocalWithProbe = FrameworkLocalConfig & {
  toolchain?: FrameworkLocalConfig['toolchain'] & {
    probe?: {
      binary?: { hvigor_bin?: string; observed_at?: string };
      cli_starts?: { ok?: boolean; hvigor_version?: string; observed_at?: string };
      project_compile?: ProjectCompileProbe;
      last_attempt?: { summary?: string; observed_at?: string };
      known_quirks?: string[];
    };
  };
};

function loadProbe(projectRoot: string): {
  local: LocalWithProbe;
  probe: NonNullable<NonNullable<LocalWithProbe['toolchain']>['probe']>;
} {
  const local = (loadLocalConfig(projectRoot) ?? { schema_version: '1.0' }) as LocalWithProbe;
  local.toolchain = local.toolchain ?? ({} as NonNullable<LocalWithProbe['toolchain']>);
  local.toolchain.probe = local.toolchain.probe ?? {};
  return { local, probe: local.toolchain.probe };
}

// v4 换代：payload 移除 recovery_probe_pending（授予模型废弃）——旧记录 integrity 失配
// 按 unknown 处理，一次真实编译即重建，安全方向的一次性迁移。
const INTEGRITY_SALT = 'maison-toolchain-probe-v2';

function computeProbeIntegrity(pc: ProjectCompileProbe): string {
  const payload = [
    pc.status,
    pc.failure_code ?? '',
    (pc.evidence ?? []).join(','),
    pc.invocation_fingerprint ?? '',
    pc.config_digest ?? '',
    pc.observed_at ?? '',
    pc.expires_at ?? '',
    INTEGRITY_SALT,
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function isProbeTrustworthy(pc: ProjectCompileProbe): boolean {
  if (!pc.integrity) return false;
  return computeProbeIntegrity(pc) === pc.integrity;
}

/**
 * 读取方通用解析：完整性失配 / config 摘要漂移 / 过期 → unknown。
 * 指纹漂移仅对 verified 生效（invocation A 的成功不证明 invocation B）；
 * capability_failed 是环境级状态（白名单码保证），跨 invocation 依旧成立（v4，codex 高优3）。
 */
export function resolveProjectCompileState(
  projectRoot: string,
  currentFingerprint: string | null,
  nowMs: number = Date.now(),
): ProjectCompileProbe {
  const { probe } = loadProbe(projectRoot);
  const pc = probe.project_compile;
  if (!pc || !pc.status || pc.status === 'unknown') return { status: 'unknown' };
  if (!isProbeTrustworthy(pc)) return { status: 'unknown' };
  if (pc.config_digest && pc.config_digest !== computeHvigorConfigDigest(projectRoot)) {
    return { status: 'unknown' };
  }
  if (
    pc.status === 'verified' &&
    currentFingerprint !== null &&
    pc.invocation_fingerprint !== currentFingerprint
  ) {
    return { status: 'unknown' };
  }
  if (pc.expires_at && Date.parse(pc.expires_at) < nowMs) return { status: 'unknown' };
  return pc;
}

export type HvigorBuildOutcome =
  | { kind: 'verified'; fingerprint: string }
  | { kind: 'capability_failed'; fingerprint: string; failure_code: string; evidence: string[] }
  | { kind: 'source_failure'; summary: string };

/**
 * wrapper 写入方（compile 态唯一合法写入路径）：真实编译结果 → probe 快照。
 * source_failure 只更新 last_attempt（人读），不触碰 project_compile。
 */
export function recordHvigorBuildOutcome(
  projectRoot: string,
  outcome: HvigorBuildOutcome,
  nowMs: number = Date.now(),
): void {
  try {
    const { local, probe } = loadProbe(projectRoot);
    const nowIso = new Date(nowMs).toISOString();
    if (outcome.kind === 'source_failure') {
      probe.last_attempt = {
        summary: buildCompactDiagnosticHeader(outcome.summary, 300),
        observed_at: nowIso,
      };
      // v3（codex 阻断2）：编译已到达源码阶段 = SDK/hvigor 装配链全通——旧 capability_failed
      // 必须清除（置 unknown，OpenSpec"源码失败保持 unknown"语义），否则工具链修好后
      // preflight 仍误报能力缺口。
      if (probe.project_compile && probe.project_compile.status === 'capability_failed') {
        const cleared: ProjectCompileProbe = { status: 'unknown' };
        probe.project_compile = cleared;
      }
    } else if (
      outcome.kind === 'capability_failed' &&
      !ENV_LEVEL_CAPABILITY_FAILURE_CODES.has(outcome.failure_code)
    ) {
      // v4（codex 高优3）：非环境级白名单码不得写 capability_failed——preflight 会拿它
      // 全局拦截所有 invocation，只有环境级失败才配得上这个语义。留 last_attempt 人读。
      probe.last_attempt = {
        summary: buildCompactDiagnosticHeader(
          `未白名单的 capability 失败码 ${outcome.failure_code}（不写 capability_failed，人读留痕）`,
          300,
        ),
        observed_at: nowIso,
      };
    } else {
      const pc: ProjectCompileProbe = {
        status: outcome.kind,
        failure_code: outcome.kind === 'capability_failed' ? outcome.failure_code : null,
        evidence: outcome.kind === 'capability_failed' ? outcome.evidence : [],
        invocation_fingerprint: outcome.fingerprint,
        config_digest: computeHvigorConfigDigest(projectRoot),
        observed_at: nowIso,
        expires_at: new Date(nowMs + TOOLCHAIN_PROBE_TTL_MS).toISOString(),
      };
      pc.integrity = computeProbeIntegrity(pc);
      probe.project_compile = pc;
    }
    writeLocalConfig(projectRoot, local);
  } catch {
    /* probe 是诚实化加速层，写失败不阻断编译主流程 */
  }
}

export interface CapabilityGapAtPreflight {
  failure_code: string;
  evidence: string[];
  observed_at?: string;
}

/**
 * preflight 判定入口（v4：**纯读、无副作用**——粘滞/交替授予模型全部废弃）：
 *   - 状态非 capability_failed / 完整性失配 / config 摘要漂移 / 过期 → null（unknown 不拦路）；
 *   - capability_failed（可信+新鲜）→ **恒返回缺口**。环境没修、直接 resume → 再次 halt，
 *     不存在放行窗口（codex 第三轮阻断1：粘滞授予=无人修复也持续放行烧预算，废弃）。
 *   解除拦截的三条可审计路径：config/DevEco/SDK 摘要漂移自动失效；
 *   resetCapabilityFailedByHumanReprobe（--ensure 人工 reprobe，降级重置）；
 *   wrapper 真实编译结果改写。goal 与 harness 双入口天然一致（同为纯读）。
 */
export function evaluateCapabilityGapAtPreflight(
  projectRoot: string,
  nowMs: number = Date.now(),
): CapabilityGapAtPreflight | null {
  try {
    const { probe } = loadProbe(projectRoot);
    const pc = probe.project_compile;
    if (!pc || pc.status !== 'capability_failed') return null;
    if (!isProbeTrustworthy(pc)) return null;
    if (pc.config_digest && pc.config_digest !== computeHvigorConfigDigest(projectRoot)) return null;
    if (pc.expires_at && Date.parse(pc.expires_at) < nowMs) return null;
    return {
      failure_code: pc.failure_code ?? 'capability_failed',
      evidence: pc.evidence ?? [],
      ...(pc.observed_at ? { observed_at: pc.observed_at } : {}),
    };
  } catch {
    return null; // 探针异常不拦路（unknown 语义）
  }
}

/**
 * 人工 reprobe 降级重置（v4，唯一的人为解除入口；仅 check-personal-setup --ensure CLI 调用）：
 * 人类主动跑 --ensure 且 hvigor CLI 真实可启动（cliOk=真跑 --version 的结果）时，把
 * capability_failed **降级**清回 unknown——授予下一次真实编译重建状态。绝不升级：
 * verified 仍只归 wrapper 真实编译。重置本身留 last_attempt 审计痕。
 * preflight（ensurePersonalSetup 消费路径）不触达本函数——机器路径无权解除。
 */
export function resetCapabilityFailedByHumanReprobe(
  projectRoot: string,
  cliOk: boolean,
  nowMs: number = Date.now(),
): boolean {
  if (!cliOk) return false;
  try {
    const { local, probe } = loadProbe(projectRoot);
    const pc = probe.project_compile;
    if (!pc || pc.status !== 'capability_failed') return false;
    const prevCode = pc.failure_code ?? '<none>';
    probe.project_compile = { status: 'unknown' };
    probe.last_attempt = {
      summary: buildCompactDiagnosticHeader(
        `人工 reprobe（--ensure，cli_starts ok）：capability_failed(${prevCode}) 重置为 unknown，由下一次真实编译定谳`,
        300,
      ),
      observed_at: new Date(nowMs).toISOString(),
    };
    writeLocalConfig(projectRoot, local);
    return true;
  } catch {
    return false;
  }
}

/**
 * --ensure 写入方（binary/cli_starts 层唯一合法写入路径）：真跑 `--version` 验证 CLI 可启动。
 * **不触碰 project_compile**。
 */
export function recordBinaryAndCliStartsProbe(
  projectRoot: string,
  hvigorBin: string,
  runVersion: (bin: string) => { ok: boolean; version?: string },
  nowMs: number = Date.now(),
): void {
  try {
    const { local, probe } = loadProbe(projectRoot);
    const nowIso = new Date(nowMs).toISOString();
    probe.binary = { hvigor_bin: hvigorBin, observed_at: nowIso };
    const v = runVersion(hvigorBin);
    probe.cli_starts = { ok: v.ok, ...(v.version ? { hvigor_version: v.version } : {}), observed_at: nowIso };
    writeLocalConfig(projectRoot, local);
  } catch {
    /* best-effort */
  }
}
