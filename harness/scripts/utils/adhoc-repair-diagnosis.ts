/**
 * 返修局部诊断（plan a2f7c9e4 §3.6，即席 `_adhoc`）。两件事都只编排既有能力，结果只用于选修法：
 *  · installCurrentBuildForAdhoc —— 既有 device_test.build / device_test.install provider，feature=_adhoc、phase=testing。
 *    product / build mode 由 provider 内与 testing 同一套解析器给出（product unresolved 按既有口径停、不猜；build mode 只有 release / debug，缺省 debug）；
 *    进程内设既有 HARNESS_DEVICE_TEST_FORCE_INSTALL=1，恒真装、不吃复用启发；完整 64 位 HAP 摘要只在返回值与日志
 *    （装机 meta 仍是既有 12 位 hapSha256，不加字段）。
 *  · measureAdhocScreen —— 截图与布局经调用方给的既有取材函数写进 `_adhoc` 目录，只复用纯计算 measureScreen；
 *    只读 feature 的 ui-spec 与参考图，不调用 runVisualMeasure / fillVisualDiffDefectNotes，不碰正式 device-screenshots / visual-diff.json。
 * 都不签凭证、不写正式 feature 证据，不替代 review → UT → testing。
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveFeatureArtifact } from '../../config';
import type { CheckContext } from './types';
import { loadUiSpecFile, uiSpecAbsPath } from './ui-spec-shared';
import { ADHOC_FEATURE } from './adhoc-canonical-paths';
import {
  isDeviceTestBuildOk,
  runDeviceTestAppBuild,
} from '../../../profiles/hmos-app/harness/providers/device-test-build';
import { installDeviceTestApp } from '../../../profiles/hmos-app/harness/providers/device-test-install';
import { buildAuthoritativeRefImageIndex, resolveRefSourceImage } from '../../../profiles/hmos-app/harness/authoritative-ref-images';
import { loadLayoutDumpFile } from '../../../profiles/hmos-app/harness/layout-oracle-check';
import {
  layoutDumpCanonicalFileName,
  sanitizeVisualDiffScreenSlug,
  type VisualDiffLayoutDumpFn,
  type VisualDiffScreenshotFn,
} from '../../../profiles/hmos-app/harness/visual-diff-capture';
import {
  measureScreen,
  renderMeasurementTable,
  type ScreenMeasurement,
} from '../../../profiles/hmos-app/harness/visual-measure';

const FORCE_INSTALL_ENV = 'HARNESS_DEVICE_TEST_FORCE_INSTALL';

export interface AdhocCurrentBuildResult {
  ok: boolean;
  hapPath: string | null;
  hapSha256Full: string | null;
  reason?: string;
}

export function installCurrentBuildForAdhoc(
  opts: { projectRoot: string; harnessRoot: string; frameworkRoot?: string; log?: (line: string) => void },
  deps: { build?: typeof runDeviceTestAppBuild; install?: typeof installDeviceTestApp } = {},
): AdhocCurrentBuildResult {
  const log = opts.log ?? ((): void => {});
  const target = {
    projectRoot: opts.projectRoot,
    harnessRoot: opts.harnessRoot,
    frameworkRoot: opts.frameworkRoot,
    feature: ADHOC_FEATURE,
    phase: 'testing',
  };
  // 不传 product / buildMode：由 provider 内的同一解析器决定（与 testing 同源）
  const build = (deps.build ?? runDeviceTestAppBuild)(target);
  // 与 check-testing 的 deviceTestGateCompileOk 同一判据：复用同源 HAP 或真实构建成功
  if (!(build.reused === true || isDeviceTestBuildOk(build.hvigor)) || !build.hapPath) {
    const detail = build.productSelection?.source === 'unresolved'
      ? build.hvigor.logExcerpt
      : [...(build.hvigor.errors ?? []).map(e => e.message), build.hvigor.logPath ? `日志：${build.hvigor.logPath}` : '']
        .filter(Boolean).join('\n') || `exit=${build.hvigor.exitCode ?? 'null'}`;
    return { ok: false, hapPath: null, hapSha256Full: null, reason: `[adhoc] 当前构建出包失败，未装机：\n${detail}` };
  }
  log(`product=${build.resolvedProduct} build_mode=${build.resolvedBuildMode} hap=${build.hapPath}${build.reused ? '（复用同源 HAP）' : ''}`);

  const prior = process.env[FORCE_INSTALL_ENV];
  process.env[FORCE_INSTALL_ENV] = '1';
  let install: ReturnType<typeof installDeviceTestApp>;
  try {
    install = (deps.install ?? installDeviceTestApp)({ ...target, hapPath: build.hapPath, buildReused: build.reused === true });
  } finally {
    if (prior === undefined) delete process.env[FORCE_INSTALL_ENV];
    else process.env[FORCE_INSTALL_ENV] = prior;
  }
  if (!install.ok) {
    return {
      ok: false,
      hapPath: build.hapPath,
      hapSha256Full: install.hapSha256Full ?? null,
      reason: `[adhoc] 当前构建装机失败：\n${install.errors.map(e => e.message).join('\n') || '(无诊断)'}`,
    };
  }
  log(`hap_sha256_full=${install.hapSha256Full ?? '(不可读)'}`);
  return { ok: true, hapPath: build.hapPath, hapSha256Full: install.hapSha256Full ?? null };
}

export interface AdhocMeasureResult {
  ok: boolean;
  reason?: string;
  measurePath?: string;
  measurement?: ScreenMeasurement;
}

export function measureAdhocScreen(opts: {
  projectRoot: string;
  /** ui-spec 所属的真实 feature（只读） */
  feature: string;
  screenId: string;
  /** `_adhoc` 下的诊断目录；截图、布局与量测结果都只写这里 */
  outDir: string;
  screenshot: VisualDiffScreenshotFn;
  layoutDump: VisualDiffLayoutDumpFn;
  deviceSn?: string;
  specVisualSources?: CheckContext['specVisualSources'];
  log?: (line: string) => void;
}): AdhocMeasureResult {
  const log = opts.log ?? ((): void => {});
  const uiPath = uiSpecAbsPath(opts.projectRoot, opts.feature);
  const doc = loadUiSpecFile(uiPath);
  if (!doc) return { ok: false, reason: `[adhoc] 读不到 ui-spec（${uiPath}）——量测只对 ui-spec 声明元素进行` };
  const screen = (doc.screens ?? []).find(s => s.id === opts.screenId);
  const slug = sanitizeVisualDiffScreenSlug(opts.screenId);
  if (!screen || !slug) return { ok: false, reason: `[adhoc] ui-spec 无屏 ${opts.screenId}` };

  fs.mkdirSync(opts.outDir, { recursive: true });
  const shotAbs = path.join(opts.outDir, `shot-${slug}.png`);
  const layoutAbs = path.join(opts.outDir, layoutDumpCanonicalFileName(opts.screenId)!);
  const shot = opts.screenshot({ screenId: opts.screenId, destAbs: shotAbs, deviceSn: opts.deviceSn });
  const layout = opts.layoutDump({ screenId: opts.screenId, destAbs: layoutAbs, deviceSn: opts.deviceSn });
  if (!shot.ok) log(`[adhoc] 截图失败：${shot.error ?? '(无输出)'}`);
  if (!layout.ok) log(`[adhoc] 布局 dump 失败：${layout.error ?? '(无输出)'}`);
  if (!shot.ok && !layout.ok) return { ok: false, reason: '[adhoc] 截图与布局都没有取到，无法量测' };

  const spec = resolveFeatureArtifact(opts.projectRoot, opts.feature, 'spec.md');
  const specMd = spec.exists ? fs.readFileSync(spec.actualPath, 'utf-8') : '';
  const ctx = {
    projectRoot: opts.projectRoot, feature: opts.feature, phase: 'testing', phaseRule: {}, specVisualSources: opts.specVisualSources,
  } as unknown as CheckContext;
  const refAbs = specMd ? resolveRefSourceImage(buildAuthoritativeRefImageIndex(ctx, specMd), screen.ref_id ?? screen.id).path : null;
  const dump = layout.ok ? loadLayoutDumpFile(layoutAbs) : null;
  const measurement = measureScreen({
    feature: opts.feature,
    screen,
    doc,
    dump,
    dumpPath: dump ? layoutAbs : null,
    dumpStatus: dump ? 'canonical' : layout.ok ? 'unparseable' : 'missing',
    screenshotAbs: shot.ok ? shotAbs : null,
    referenceAbs: refAbs,
    // 诊断不读正式 visual-diff：content 轴如实 UNKNOWN
    visualDiffScreen: null,
  });
  const measurePath = path.join(opts.outDir, `measure-${slug}.json`);
  fs.writeFileSync(measurePath, `${JSON.stringify(measurement, null, 2)}\n`, 'utf-8');
  for (const line of renderMeasurementTable(measurement)) log(line);
  return { ok: true, measurePath, measurement };
}
