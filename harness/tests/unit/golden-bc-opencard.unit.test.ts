// ============================================================================
// golden-bc-opencard.unit.test.ts — 事故产物回放 golden（plan d8c5f3a7 T7a）
// ----------------------------------------------------------------------------
// 【为什么要有它】b4aa7290..HEAD 累计 548 files / +80788 行机制改动，却没有一条结果级
// 回归用银行卡这十屏兜底。于是"机制测试越来越绿、宿主 UI 越来越差"可以同时成立——
// 2026-07-24 事故的宏观形态就是这个。
//
// 【本套的形态：真产物回放，不是写死常量】
// 早期版本把需求原文与十屏清单写成 TS 常量，等于"自己出题自己答"。现在改为加载
// `tests/golden/bc-opencard/artifacts/` 下**从宿主原样拷来的事故产物**：
//   · goal-runs/…/manifest.json      → 真需求原文 + 真 desired fidelity
//   · spec/ui-spec.yaml              → 真屏清单 + 真素材声明
//   · spec/asset-manifest.yaml       → 事故当时的 mode: blind_placeholder
//   · plan/visual-parity.yaml        → 被钳后的 effective_fidelity
//   · device-screenshots/visual-diff.json → 六屏全 pending、all_banks score_floor=0
//   · visual-debt.json               → 当时挂的债务
// 两类断言：
//   (A) 决策链正向：把**真需求原文**喂进当前实现，三轴/档位/素材轴必须正确；
//   (B) 事故产物反向：把**真事故产物**喂进新门禁，必须被判为缺陷——这才是
//       "golden 在旧行为上会红"的真凭据，不是手写几个返回错值的假函数。
//
// 【参考图为何不入仓】`0-原始需求` 的截图含真实 PII（姓名/身份证号/人像）。框架仓要打包
// 发给宿主，PII 进去就随发布包扩散。故只登记 sha256+尺寸（reference-images.registry.json），
// 决策链回放不需要像素。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  clampFidelityByCapability,
  detectAcceptanceStrictness,
  detectAssetAcquisitionIntent,
  detectDesiredFidelity,
  resolveFidelityRoutingDecision,
} from '../../scripts/utils/fidelity-shared';
import { canaryAdmissibleForRun } from '../../scripts/utils/multimodal-probe';
import { collectActionableDefects } from '../../scripts/goal-runner';
import { clearFrameworkConfigCache } from '../../config';
import * as os from 'os';
import type { UnitCaseResult } from '../run-unit';

const requireYaml = (): { parse: (s: string) => unknown } => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('yaml') as { parse: (s: string) => unknown };
};

const GOLDEN_DIR = path.resolve(__dirname, '../golden/bc-opencard');
const ART = path.join(GOLDEN_DIR, 'artifacts');
const FEATURE = 'bc-openCard';
/** golden 回放的 run 身份：崩溃诊断归档须与之同 run 才被采信 */
const RUN_ID = '20260724T030240Z-5f8dc9';

interface VisualDiffDoc { screens?: Array<{ screen_id?: string; [k: string]: unknown }> }

/**
 * 把冻结的事故产物物化成一个**最小宿主工程**，好让生产消费者按真实路径去找文件。
 * 这样 golden 跑的是 `collectDeterministicVisualDefects` 本尊，而不是测试自己搭的输入。
 * @param mutate 可选：改写 visual-diff.json（用于反证"字段名改坏就该红"）
 */
/** mutate 回调执行期间可经 hostRootBox 取到 root（转录用例要现算截图 hash） */
const hostRootBox = { value: '' };
function hashShot(abs: string): string {
  // 与生产 hashScreenshotFile 同口径（sha256 前 16 hex）
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { hashScreenshotFile } = require('../../../profiles/hmos-app/harness/visual-diff-check') as {
    hashScreenshotFile: (p: string) => string | null;
  };
  return hashScreenshotFile(abs) ?? '';
}
function materializeGoldenHost(mutate?: (d: VisualDiffDoc) => VisualDiffDoc): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-host-'));
  hostRootBox.value = root;
  // build 身份（P1-1 谓词④）：actionable 要求当前 build fingerprint 可算——按生产口径
  // （install meta 的 hapPath 内容哈希）造最小夹具；转录用例据此写 evaluated_build_fingerprint
  const hapAbs = path.join(root, 'build', 'default', 'app.hap');
  fs.mkdirSync(path.dirname(hapAbs), { recursive: true });
  fs.writeFileSync(hapAbs, 'golden-hap-bytes');
  const metaAbs = path.join(root, 'doc/features', FEATURE, 'testing', 'reports', 'device-test-install.meta.json');
  fs.mkdirSync(path.dirname(metaAbs), { recursive: true });
  fs.writeFileSync(metaAbs, JSON.stringify({ hapPath: 'build/default/app.hap' }), 'utf-8');
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1',
    project_name: 'GoldenReplay',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false, reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
  }, null, 2), 'utf-8');
  // framework 树占位：featurePhaseReportsDir 即使配了 reports_dir_pattern 也会先解析
  // frameworkRoot（无树直接 throw、被 build-fingerprint 的 catch 吞成 null）——
  // consumer 宿主必有 framework/，夹具照真实形态放一个
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  clearFrameworkConfigCache();
  const featRoot = path.join(root, 'doc/features', FEATURE);
  // ui-spec（缺屏判定的屏清单来源）
  fs.mkdirSync(path.join(featRoot, 'spec'), { recursive: true });
  fs.copyFileSync(path.join(ART, 'spec/ui-spec.yaml'), path.join(featRoot, 'spec/ui-spec.yaml'));
  // visual-diff（真指标来源）
  const shotsDir = path.join(featRoot, 'device-testing/device-screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const doc = JSON.parse(
    fs.readFileSync(path.join(ART, 'device-testing/device-screenshots/visual-diff.json'), 'utf-8'),
  ) as VisualDiffDoc;
  // 截图**文件先物化再 mutate**：转录用例要在 mutate 回调里现算截图 hash（谓词③），
  // 文件后写的话算出来是空串——actionable 判定 fail-closed 拦下（本套自己踩过）。
  // 参考图含 PII 不入仓，这里只需要"文件存在"，内容无关——放占位字节。
  for (const sc of doc.screens ?? []) {
    const rel = typeof sc.screenshot_path === 'string' ? sc.screenshot_path : null;
    if (!rel) continue;
    const abs = path.join(root, String(rel));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'golden-placeholder-bytes');
  }
  const finalDoc = mutate ? mutate(doc) : doc;
  fs.writeFileSync(
    path.join(shotsDir, 'visual-diff.json'), JSON.stringify(finalDoc, null, 2), 'utf-8',
  );
  return root;
}

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(ART, rel), 'utf-8')) as T;
}
function readYaml<T>(rel: string): T {
  return requireYaml().parse(fs.readFileSync(path.join(ART, rel), 'utf-8')) as T;
}

interface GoalManifestArtifact { requirement?: string; fidelity?: string }
interface UiSpecArtifact {
  screens?: Array<{ screen_id?: string; id?: string }>;
  assets?: Array<{ key?: string; acquisition?: string; placeholder?: boolean; resolved_path?: string }>;
}
interface AssetManifestArtifact { mode?: string; assets?: Array<{ key?: string; acquisition?: string; status?: string }> }
interface VisualDiffArtifact {
  screens?: Array<{ screen_id?: string; verdict?: string; score_floor?: number; screenshot_path?: string }>;
}

// ---------------------------------------------------------------------------
// (A) 决策链正向：真需求原文 → 当前实现
// ---------------------------------------------------------------------------

test('golden(A) 夹具完整性：事故产物齐备且参考图身份已登记（防 golden 自身腐化）', () => {
  for (const rel of [
    'goal-runs/20260724T030240Z-5f8dc9/manifest.json',
    'spec/ui-spec.yaml', 'spec/asset-manifest.yaml', 'plan/visual-parity.yaml',
    'device-testing/device-screenshots/visual-diff.json', 'visual-debt.json',
  ]) {
    assert(fs.existsSync(path.join(ART, rel)), `事故产物缺失：${rel}`);
  }
  const reg = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'reference-images.registry.json'), 'utf-8')) as {
    images?: Array<{ file?: string; sha256?: string; bytes?: number }>;
  };
  assert((reg.images ?? []).length === 10, `参考图应登记 10 张，实得 ${(reg.images ?? []).length}`);
  for (const im of reg.images ?? []) {
    assert(/^[0-9a-f]{64}$/.test(im.sha256 ?? ''), `参考图 ${im.file} 缺 sha256`);
    assert((im.bytes ?? 0) > 0, `参考图 ${im.file} 尺寸非法`);
  }
});

test('golden(A) 三轴：**真需求原文**（从事故 manifest 读，非写死常量）→ pixel_1to1 + best_effort + auto_crop', () => {
  const m = readJson<GoalManifestArtifact>('goal-runs/20260724T030240Z-5f8dc9/manifest.json');
  const req = m.requirement ?? '';
  assert(req.length > 100, `需求原文应从产物读到，实得长度 ${req.length}`);
  assert(m.fidelity === 'pixel_1to1', `manifest.fidelity 应为 pixel_1to1，实得 ${m.fidelity}`);

  assert(detectDesiredFidelity(req).desired === 'pixel_1to1', '质量目标轴应 pixel_1to1');
  const strictness = detectAcceptanceStrictness(req);
  assert(
    strictness === 'best_effort',
    `严格度轴应 best_effort（需求原话含「尽量」类措辞）——实得 ${strictness}。` +
    '**不得**为让 golden 通过而把「尽量」改判 hard：那会回退 f6b2d9a4 冻结的口径，' +
    '并让"hard 才 BLOCKER"类门禁对本事故彻底失效。',
  );
  assert(
    detectAssetAcquisitionIntent(req) === 'auto_crop',
    `素材轴应 auto_crop（需求明示"从原始截图裁剪获取"），实得 ${detectAssetAcquisitionIntent(req)}`,
  );
});

test('golden(A) 能力真值：tool_read 下 effective 不钳；连续两 run 都不钳且 decision_id 不复用', () => {
  const req = readJson<GoalManifestArtifact>('goal-runs/20260724T030240Z-5f8dc9/manifest.json').requirement ?? '';
  const cap = { hasVision: true, ocrAvailable: true };
  const r1 = resolveFidelityRoutingDecision({ requirementText: req, capability: cap, executionIdentity: 'run-1', requirementSha: 'a'.repeat(64) });
  const r2 = resolveFidelityRoutingDecision({ requirementText: req, capability: cap, executionIdentity: 'run-2', requirementSha: 'a'.repeat(64) });
  assert(r1.effective === 'pixel_1to1' && r2.effective === 'pixel_1to1', '两 run 都不得被钳');
  assert(r1.clamped === false && r2.clamped === false, '不得标 clamped');
  assert(r1.decision.decision_id !== r2.decision.decision_id, '跨 run 须不同 decision_id');
  // canary 跨 run 不可采信 → 必须重探（R1' 永久陷阱的判据）
  const canary = { probed_via: 'goal', run_id: 'run-1' };
  assert(canaryAdmissibleForRun(canary, { runId: 'run-1' }), 'run1 自身可采信');
  assert(!canaryAdmissibleForRun(canary, { runId: 'run-2' }), 'run2 不得直接采信上一 run 的 canary');
});

test('golden(A) 屏清单：真 ui-spec 十屏齐备，且**不含任何钱包主页屏**（本案误开发点）', () => {
  const ui = readYaml<UiSpecArtifact>('spec/ui-spec.yaml');
  const ids = (ui.screens ?? []).map(s => String(s.screen_id ?? s.id ?? '')).filter(Boolean);
  assert(ids.length === 10, `真 ui-spec 应 10 屏，实得 ${ids.length}：${ids.join(',')}`);
  const homeLike = ids.filter(id => /home_tab|wallet_home|^home$/i.test(id));
  assert(
    homeLike.length === 0,
    `ui-spec 不得出现钱包主页屏（实得 ${homeLike.join(',')}）——事故里 BankCardPackSection ` +
    '被塞进 WalletMain/HomeTabPage，而十屏并无此屏、plan F8 只分给 CardPackPage',
  );
  assert(ids.includes('card_pack_with_cards'), '银行卡分区应归属卡包屏');
});

test('golden(B) 反向：事故 asset-manifest（mode=blind_placeholder）与真需求 auto_crop 授权**直接冲突**', () => {
  const am = readYaml<AssetManifestArtifact>('spec/asset-manifest.yaml');
  const req = readJson<GoalManifestArtifact>('goal-runs/20260724T030240Z-5f8dc9/manifest.json').requirement ?? '';
  assert(am.mode === 'blind_placeholder', `事故产物应记录 blind_placeholder（实得 ${am.mode}）——这是被回放的错误态`);
  assert(
    detectAssetAcquisitionIntent(req) === 'auto_crop',
    '需求明示可裁剪，故产物里的 blind_placeholder 属**授权被静默丢弃**',
  );
  // 事故产物的每项素材都是 placeholder/pending —— 真需求要求的是裁真图
  const placeholders = (am.assets ?? []).filter(a => a.acquisition === 'placeholder');
  assert(
    placeholders.length > 0,
    `事故产物应含 placeholder 素材项（实得 ${JSON.stringify(am.assets)}）`,
  );
});

test('golden(B) 反向：事故 visual-parity 的 effective 被钳成 semantic_layout（与有视觉时的正确结论相反）', () => {
  const raw = fs.readFileSync(path.join(ART, 'plan/visual-parity.yaml'), 'utf-8');
  assert(
    /semantic_layout/.test(raw),
    '事故产物应记录被钳后的 semantic_layout（回放对象）',
  );
  // 当前实现在同一需求 + 有视觉时的正确结论
  const req = readJson<GoalManifestArtifact>('goal-runs/20260724T030240Z-5f8dc9/manifest.json').requirement ?? '';
  const now = resolveFidelityRoutingDecision({
    requirementText: req, capability: { hasVision: true, ocrAvailable: true },
    executionIdentity: 'golden', requirementSha: 'b'.repeat(64),
  });
  assert(now.effective === 'pixel_1to1', '有视觉时当前实现不得钳档——与事故产物结论相反即证明修复生效');
  // 盲档对照：能力确盲时钳档仍是**正确**行为（保留此分支，排障时区分"误判盲"与"真盲"）
  const blind = clampFidelityByCapability('pixel_1to1', { hasVision: false, ocrAvailable: true });
  assert(blind.effective === 'semantic_layout' && blind.clamped, '真盲档下钳档是正确行为');
});

test('v23 事故回放：六屏全 pending → 零 actionable（如实）——弃判由 F5 指令面+verdict_abandonment 门禁负责', () => {
  // 2026-07-24 的真实形态：six screens verdict=pending、must_fix=0——最强信号躺盘上。
  // v23 的解**不是** runner 从 pending 里造缺陷（那是已删的通用指标契约干的、被实测证伪），
  // 而是：actionable 谓词①要求 verdict∈{warn,fail} → pending 如实产出零 actionable；
  // "确定性信号在手却全屏 pending"由 testing 侧 visual_diff_verdict_abandonment BLOCKER
  // 拦下（F5 指令面：fail 屏须 verdict=fail + 信号转录 must_fix）。
  const hostRoot = materializeGoldenHost();
  const defects = collectActionableDefects(hostRoot, FEATURE, RUN_ID).defects;
  assert(defects.length === 0,
    `pending 屏不满足谓词①，须零 actionable（不臆造）：${JSON.stringify(defects.map(d => d.screen_or_case_id))}`);
});

test('v23 事故回放：按 F5 要求把 all_banks 转录成 fail+must_fix（新鲜 hash）→ 生产收集器产出 actionable', () => {
  // 同一事故产物，只把 all_banks（score_floor=0 的崩溃屏）按 F5 指令面要求转录：
  // verdict=fail + 信号进 must_fix + evaluated hash 绑定当前截图 → 回修环立即收到信号。
  const hostRoot = materializeGoldenHost(doc => {
    for (const sc of doc.screens ?? []) {
      if (sc.screen_id !== 'all_banks') continue;
      const rel = String((sc as Record<string, unknown>).screenshot_path ?? '');
      const abs = path.join(hostRootBox.value, ...rel.split('/'));
      (sc as Record<string, unknown>).verdict = 'fail';
      (sc as Record<string, unknown>).must_fix = ['进入全部银行页即白屏/崩溃——修复 .title() 非法 builder 并恢复列表渲染'];
      (sc as Record<string, unknown>).evaluated_screenshot_hash = hashShot(abs);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveCurrentBuildFingerprint } = require('../../../profiles/hmos-app/harness/build-fingerprint') as {
        resolveCurrentBuildFingerprint: (r: string, f: string, ph?: string) => string | null;
      };
      (sc as Record<string, unknown>).evaluated_build_fingerprint =
        resolveCurrentBuildFingerprint(hostRootBox.value, FEATURE, 'testing');
    }
    return doc;
  });
  const defects = collectActionableDefects(hostRoot, FEATURE, RUN_ID).defects;
  const hit = defects.find(d => d.screen_or_case_id === 'all_banks' && d.source === 'visual_diff');
  assert(!!hit, `转录后须产出 actionable：${JSON.stringify(defects)}`);
  assert(hit!.instructions.some(t => t.includes('.title()')), '指令须携带原文（交接进 coding prompt）');
  assert(hit!.evidence_path.endsWith('#all_banks'), `evidence_path 由 runner 拼接：${hit!.evidence_path}`);
});

test('v23 事故回放：崩溃归档（本 run）→ crash actionable；旧 run 归档 → 零', () => {
  const mk = (runId: string): number => {
    const hostRoot = materializeGoldenHost();
    const diagRel = `doc/features/${FEATURE}/device-testing/reports/crash-diagnostics/all_banks.json`;
    const abs = path.join(hostRoot, ...diagRel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify({
      schema_version: '1.2', screen_or_case: 'all_banks', run_id: runId,
      diagnosis: { kind: 'crash_suspected', bundleName: 'com.example.wallet', faultFiles: ['cppcrash-com.example.wallet-1'], excerpt: 'SIGSEGV' },
    }), 'utf-8');
    return collectActionableDefects(hostRoot, FEATURE, RUN_ID)
      .defects.filter(d => d.source === 'crash').length;
  };
  assert(mk(RUN_ID) === 1, '本 run 归档须产出 crash actionable');
  assert(mk('20260701T000000Z-OLDRUN') === 0, '旧 run 归档不得产出（无 run_id 同理）');
});

test('golden(B) 反向：事故视觉债务里的素材占位项 → 当前口径应为可回修（非 needs_human 挂账了事）', () => {
  const debt = readJson<{ entries?: Array<{ id?: string; source_check_id?: string; resolution_class?: string; status?: string }> }>('visual-debt.json');
  const entries = debt.entries ?? [];
  assert(entries.length > 0, '事故产物应含债务条目');
  const placeholderDebts = entries.filter(e => String(e.source_check_id ?? '').includes('placeholder'));
  assert(placeholderDebts.length > 0, `事故产物应含素材占位债务：${entries.map(e => e.source_check_id).join(',')}`);
  // 回放对象：当时全部挂成 needs_human（=不进自动修复集合，于是永远没人修）
  assert(
    placeholderDebts.some(e => e.resolution_class === 'needs_human'),
    `事故产物应记录 needs_human（回放对象）：${JSON.stringify(placeholderDebts.map(e => e.resolution_class))}`,
  );
  // 当前口径（v23 F4）：被 $r 引用的非占位素材物化缺失 = coding 门禁**档位无关 FAIL**
  //（visual_parity_asset_materialized 无条件 BLOCKER），不再经通用指标绕行，也不挂
  // needs_human 了事——该断言由 8 项验收 E2E-5 与 parity-check 单测承接。
});

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
