// ============================================================================
// consumer-golden.unit.test.ts — bc-openCard consumer golden evaluator（c4e8b1d3 G3）
// ----------------------------------------------------------------------------
// evaluator 是纯聚合器：夹具铺满宿主回归产物的健康形态 → PASS；逐项打破 →
// 对应 item FAIL（集合不等/must_fix/crash/forbidden anchor/绑定失配）。
// contract 用随包真件（10 固定屏），不造平行契约。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  evaluateConsumerGolden,
  type GoldenEvalReport,
} from '../../scripts/consumer-golden/evaluate-bc-opencard';
import { hashScreenshotFile } from '../../../profiles/hmos-app/harness/visual-diff-check';
import { resolveCurrentBuildFingerprint } from '../../../profiles/hmos-app/harness/build-fingerprint';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'bc-openCard';
const RUN_ID = 'run-golden-1';
const CONTRACT_CAPTURES = [
  'add_card_home_collapsed', 'add_card_home_expanded', 'all_banks',
  'card_type_sheet__overlay__0', 'card_select', 'sms_verify__overlay__0',
  'add_success', 'card_detail', 'card_pack_with_cards', 'bank_card_list_sheet__overlay__0',
];

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function w(root: string, rel: string, content: string | Buffer): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

interface Host { root: string; fwRoot: string; manifestSha: string; buildFp: string }

/** 健康宿主（round20 起按**真实生产契约**造）：contract 十屏全采（run/build/eval-hash 三绑定）
 * + testing 成功闭环事件 + v1.1 coding summary（quality_axes.asset + script_report 指针 +
 * run_id）+ script-report.json.checks + HomeTab wrapper 证据 + candidate sidecar。 */
function setupHost(): Host {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'consumer-golden-'));
  w(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'GoldenTest',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false, reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
    materialized_adapters: ['cursor'],
  }, null, 2));
  const featRel = `doc/features/${FEATURE}`;
  // framework 树（featurePhaseReportsDir 解析 frameworkRoot 需要；与 testing-integrity 夹具同坑）
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  // build 身份：install meta + hap（与生产同口径现算——evaluator 的 build 绑定按此比对）
  w(root, 'build/default/app.hap', 'hap-bytes-v1');
  w(root, `${featRel}/testing/reports/device-test-install.meta.json`,
    JSON.stringify({ hapPath: 'build/default/app.hap' }));
  clearFrameworkConfigCache();
  const buildFp = resolveCurrentBuildFingerprint(root, FEATURE, 'testing')!;
  if (!buildFp) throw new Error('夹具须能算出 build fingerprint（install meta + hap 已造）');
  const screens = CONTRACT_CAPTURES.map(id => {
    const shotRel = `${featRel}/device-testing/device-screenshots/shot-${id}.png`;
    w(root, shotRel, Buffer.from(`png-${id}`));
    // 与生产同一 hash 口径（sha256 前 16 hex）——evaluator 的截图绑定校验按此比对
    const diskHash = hashScreenshotFile(path.join(root, shotRel))!;
    return {
      screen_id: id,
      screenshot_path: shotRel,
      verdict: 'pass',
      must_fix: [],
      screenshot_hash: diskHash,
      evaluated_screenshot_hash: diskHash,
      evaluated_build_fingerprint: buildFp,
      captured_in_run: RUN_ID,
    };
  });
  w(root, `${featRel}/device-testing/device-screenshots/visual-diff.json`,
    JSON.stringify({ schema_version: '1.1', screens }, null, 2));
  // testing 成功闭环（round20/21 判据）：最新 testing start 后 PASS/advance + run_end 成功终局
  w(root, `${featRel}/goal-runs/${RUN_ID}/events.jsonl`, [
    JSON.stringify({ type: 'phase_start', phase: 'testing' }),
    JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance' }),
    JSON.stringify({ type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' }),
  ].join('\n') + '\n');
  // v1.1 真实契约 summary（writer 无 checks 字段——素材门经 quality_axes.asset + script_report 消费）
  w(root, `${featRel}/coding/reports/summary.json`, JSON.stringify({
    schema_version: '1.1', verdict: 'PASS', run_id: RUN_ID,
    script_report: 'script-report.json',
    quality_axes: {
      asset: {
        applicable: true, required_for_release: true, verdict: 'PASS',
        blocking_class: null, source_checks: ['visual_parity_asset_materialized'], resolution: null,
      },
    },
  }, null, 2));
  w(root, `${featRel}/coding/reports/script-report.json`, JSON.stringify({
    checks: [{ id: 'visual_parity_asset_materialized', status: 'PASS' }],
  }, null, 2));
  // HomeTab 负向证据：golden capture 生产的 wrapper（run/build 绑定）
  w(root, `${featRel}/device-testing/device-screenshots/layout-HomeTab.json`, JSON.stringify({
    schema_version: '1.0', kind: 'golden_forbidden_evidence', screen: 'HomeTab',
    anchor: 'bank_card_section', run_id: RUN_ID, evaluated_build_fingerprint: buildFp,
    captured_at: '2026-07-27T00:00:00Z',
    tree: [{ id: 'home_root' }, { id: 'services_grid' }],
  }, null, 2));
  // candidate 安装形态：framework 根有 in-zip sidecar
  const fwRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-fw-'));
  const manifestSha = createHash('sha256').update('fake-manifest').digest('hex');
  w(fwRoot, 'RELEASE-MANIFEST.sha256', `${manifestSha}\n`);
  clearFrameworkConfigCache();
  return { root, fwRoot, manifestSha, buildFp };
}

function evalHost(h: Host, overrides: Partial<Parameters<typeof evaluateConsumerGolden>[0]> = {}): GoldenEvalReport {
  return evaluateConsumerGolden({
    projectRoot: h.root,
    runId: RUN_ID,
    frameworkRoot: h.fwRoot,
    expectedManifestSha: h.manifestSha,
    ...overrides,
  });
}

function itemOf(r: GoldenEvalReport, id: string): { verdict: string; detail: string } {
  const i = r.items.find(x => x.id === id);
  if (!i) throw new Error(`缺 item ${id}：${r.items.map(x => x.id).join(', ')}`);
  return i;
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, '健康宿主 → 全项 PASS，总裁决 PASS，截图 hash 进诊断附件', () => {
    const h = setupHost();
    const r = evalHost(h);
    assert(r.verdict === 'PASS', `须 PASS：${JSON.stringify(r.items.filter(i => i.verdict === 'FAIL'), null, 2)}`);
    assert(Object.keys(r.screenshot_hashes).length === 10, '10 屏截图 hash 须入报告');
    assert(r.installed_manifest_sha256 === h.manifestSha, 'manifest sha 须记录');
  });

  run(results, '缺 P1 屏（bank_card_list_sheet__overlay__0）→ ten_fixed_screens_exact_set FAIL 点名缺失', () => {
    const h = setupHost();
    const vdPath = path.join(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`);
    const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<{ screen_id: string }> };
    doc.screens = doc.screens.filter(s => s.screen_id !== 'bank_card_list_sheet__overlay__0');
    fs.writeFileSync(vdPath, JSON.stringify(doc, null, 2));
    const r = evalHost(h);
    const i = itemOf(r, 'ten_fixed_screens_exact_set');
    assert(i.verdict === 'FAIL' && i.detail.includes('bank_card_list_sheet__overlay__0'),
      `缺 P1 屏须点名 FAIL：${i.detail}`);
    assert(r.verdict === 'FAIL', '总裁决 FAIL');
  });

  run(results, '多出错误屏（错误屏替换/额外屏）→ 集合不等 FAIL（只数数量会放过）', () => {
    const h = setupHost();
    const vdPath = path.join(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`);
    const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<Record<string, unknown>> };
    // 用错误屏替换正确屏：数量仍是 10
    const victim = doc.screens.find(s => s.screen_id === 'card_detail')!;
    victim.screen_id = 'wrong_screen';
    const shotRel = `doc/features/${FEATURE}/device-testing/device-screenshots/shot-wrong_screen.png`;
    w(h.root, shotRel, Buffer.from('png-wrong'));
    victim.screenshot_path = shotRel;
    fs.writeFileSync(vdPath, JSON.stringify(doc, null, 2));
    const r = evalHost(h);
    const i = itemOf(r, 'ten_fixed_screens_exact_set');
    assert(i.verdict === 'FAIL' && i.detail.includes('card_detail') && i.detail.includes('wrong_screen'),
      `替换屏须同时点名缺失与多余：${i.detail}`);
  });

  run(results, 'must_fix 在场 → no_must_fix FAIL', () => {
    const h = setupHost();
    const vdPath = path.join(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`);
    const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<Record<string, unknown>> };
    const s = doc.screens.find(x => x.screen_id === 'all_banks')!;
    s.verdict = 'warn';
    s.must_fix = ['银行 logo 缺失'];
    fs.writeFileSync(vdPath, JSON.stringify(doc, null, 2));
    const r = evalHost(h);
    assert(itemOf(r, 'no_must_fix').verdict === 'FAIL', 'must_fix 须 FAIL');
  });

  run(results, '本 run crash 归档（真实 schema：diagnosis.kind 嵌套）→ no_crash + all_banks_enterable FAIL；他 run 不计', () => {
    // round19 P1：真实生产者（archiveTimeoutDiagnosis）写 { run_id, screen_or_case,
    // diagnosis: { kind } }——顶层无 kind。夹具必须按真实 schema 造，否则测的是不存在的格式。
    const h = setupHost();
    w(h.root, `doc/features/${FEATURE}/device-testing/reports/crash-diagnostics/all_banks.json`,
      JSON.stringify({
        schema_version: '1.2', screen_or_case: 'all_banks', run_id: RUN_ID,
        generated_at: '2026-07-27T00:00:00Z',
        diagnosis: { kind: 'crash_suspected', bundleName: 'com.x', faultFiles: ['cppcrash-1'], excerpt: 'x' },
      }));
    const r = evalHost(h);
    assert(itemOf(r, 'no_crash').verdict === 'FAIL', `真实 schema 崩溃归档须被识别：${itemOf(r, 'no_crash').detail}`);
    assert(itemOf(r, 'all_banks_enterable').verdict === 'FAIL', 'all_banks 崩溃须 FAIL');
    // 他 run 归档 → 不计
    const h2 = setupHost();
    w(h2.root, `doc/features/${FEATURE}/device-testing/reports/crash-diagnostics/all_banks.json`,
      JSON.stringify({
        schema_version: '1.2', screen_or_case: 'all_banks', run_id: 'other-run',
        diagnosis: { kind: 'crash_suspected' },
      }));
    const r2 = evalHost(h2);
    assert(itemOf(r2, 'no_crash').verdict === 'PASS', '他 run 归档不得计入本 run');
  });

  run(results, 'round19 P1：pending/skipped/缺 verdict → verdict_all_pass FAIL（刚采未判不算成功）', () => {
    const h = setupHost();
    const vdPath = path.join(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`);
    const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<Record<string, unknown>> };
    doc.screens.find(s => s.screen_id === 'card_select')!.verdict = 'pending';
    delete doc.screens.find(s => s.screen_id === 'add_success')!.verdict;
    fs.writeFileSync(vdPath, JSON.stringify(doc, null, 2));
    const r = evalHost(h);
    const i = itemOf(r, 'verdict_all_pass');
    assert(i.verdict === 'FAIL' && i.detail.includes('card_select=pending') && i.detail.includes('add_success=missing'),
      `pending/缺失 verdict 须点名 FAIL：${i.detail}`);
  });

  run(results, 'round19 P1：evaluated_screenshot_hash 缺失或与盘上截图不一致 → screenshot_binding FAIL', () => {
    const h = setupHost();
    const vdPath = path.join(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`);
    const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<Record<string, unknown>> };
    doc.screens.find(s => s.screen_id === 'card_detail')!.evaluated_screenshot_hash = 'deadbeefdeadbeef';
    delete doc.screens.find(s => s.screen_id === 'all_banks')!.evaluated_screenshot_hash;
    fs.writeFileSync(vdPath, JSON.stringify(doc, null, 2));
    const r = evalHost(h);
    const i = itemOf(r, 'screenshot_binding');
    assert(i.verdict === 'FAIL' && i.detail.includes('card_detail') && i.detail.includes('all_banks'),
      `hash 脱钩须点名 FAIL：${i.detail}`);
  });

  run(results, 'round19 P1：captured_in_run 缺失/指向他 run → run_freshness FAIL（防跨 run 复用截图）', () => {
    const h = setupHost();
    const vdPath = path.join(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`);
    const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<Record<string, unknown>> };
    doc.screens.find(s => s.screen_id === 'sms_verify__overlay__0')!.captured_in_run = 'previous-run';
    delete doc.screens.find(s => s.screen_id === 'card_pack_with_cards')!.captured_in_run;
    fs.writeFileSync(vdPath, JSON.stringify(doc, null, 2));
    const r = evalHost(h);
    const i = itemOf(r, 'run_freshness');
    assert(i.verdict === 'FAIL' && i.detail.includes('sms_verify__overlay__0') && i.detail.includes('card_pack_with_cards'),
      `跨 run 截图须点名 FAIL：${i.detail}`);
  });

  run(results, 'round19 P2：重复 screen ID → ten_fixed_screens_exact_set FAIL（不被 Map 吞掉）', () => {
    const h = setupHost();
    const vdPath = path.join(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`);
    const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<Record<string, unknown>> };
    doc.screens.push({ ...doc.screens.find(s => s.screen_id === 'all_banks')! });
    fs.writeFileSync(vdPath, JSON.stringify(doc, null, 2));
    const r = evalHost(h);
    const i = itemOf(r, 'ten_fixed_screens_exact_set');
    assert(i.verdict === 'FAIL' && i.detail.includes('重复=[all_banks]'), `重复条目须 FAIL：${i.detail}`);
  });

  run(results, 'HomeTab wrapper 证据含 bank_card_section → forbidden FAIL；证据缺席同 FAIL（fail-closed）', () => {
    const h = setupHost();
    w(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/layout-HomeTab.json`,
      JSON.stringify({
        schema_version: '1.0', kind: 'golden_forbidden_evidence', screen: 'HomeTab',
        run_id: RUN_ID, evaluated_build_fingerprint: h.buildFp,
        tree: [{ id: 'home_root' }, { id: 'bank_card_section' }],
      }));
    const r = evalHost(h);
    const i = itemOf(r, 'forbidden_HomeTab');
    assert(i.verdict === 'FAIL' && i.detail.includes('禁止锚点'), `禁止锚点在场须 FAIL：${i.detail}`);

    const h2 = setupHost();
    fs.rmSync(path.join(h2.root, `doc/features/${FEATURE}/device-testing/device-screenshots/layout-HomeTab.json`));
    const r2 = evalHost(h2);
    const i2 = itemOf(r2, 'forbidden_HomeTab');
    assert(i2.verdict === 'FAIL' && i2.detail.includes('证据缺席'), `证据缺席须 fail-closed：${i2.detail}`);
  });

  run(results, 'round20 P1：HomeTab 裸 dump/历史残留（无 wrapper/他 run/旧 build）一律不采信', () => {
    // 裸 dump（历史残留的旧格式）——曾被直接采信，现须 FAIL
    const h = setupHost();
    w(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/layout-HomeTab.json`,
      JSON.stringify({ tree: [{ id: 'home_root' }] }));
    const r = evalHost(h);
    const i = itemOf(r, 'forbidden_HomeTab');
    assert(i.verdict === 'FAIL' && i.detail.includes('不采信'), `裸 dump 须 FAIL：${i.detail}`);
    // 他 run 的 wrapper
    const h2 = setupHost();
    w(h2.root, `doc/features/${FEATURE}/device-testing/device-screenshots/layout-HomeTab.json`,
      JSON.stringify({
        schema_version: '1.0', kind: 'golden_forbidden_evidence', screen: 'HomeTab',
        run_id: 'other-run', evaluated_build_fingerprint: h2.buildFp, tree: [],
      }));
    const r2 = evalHost(h2);
    assert(itemOf(r2, 'forbidden_HomeTab').verdict === 'FAIL', '他 run 证据须 FAIL');
    // 旧 build 的 wrapper
    const h3 = setupHost();
    w(h3.root, `doc/features/${FEATURE}/device-testing/device-screenshots/layout-HomeTab.json`,
      JSON.stringify({
        schema_version: '1.0', kind: 'golden_forbidden_evidence', screen: 'HomeTab',
        run_id: RUN_ID, evaluated_build_fingerprint: 'oldbuild00000', tree: [],
      }));
    const r3 = evalHost(h3);
    const i3 = itemOf(r3, 'forbidden_HomeTab');
    assert(i3.verdict === 'FAIL' && i3.detail.includes('build 绑定失败'), `旧 build 证据须 FAIL：${i3.detail}`);
  });

  run(results, 'round20 P1：testing 未成功闭环（backtrack 后最新 verdict=FAIL）→ run_binding FAIL', () => {
    const h = setupHost();
    w(h.root, `doc/features/${FEATURE}/goal-runs/${RUN_ID}/events.jsonl`, [
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'backtrack_to_coding' }),
      JSON.stringify({ type: 'phase_start', phase: 'coding' }),
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'FAIL', action: 'halt' }),
      JSON.stringify({ type: 'run_end', status: 'HALTED' }),
    ].join('\n') + '\n');
    const r = evalHost(h);
    const i = itemOf(r, 'run_binding');
    assert(i.verdict === 'FAIL', `最新 testing 非 PASS/advance 须 FAIL：${i.detail}`);
  });

  run(results, 'round21 P1：旧 PASS/advance 后 testing 重启并中断 → run_binding FAIL；run_end 非成功终局同 FAIL', () => {
    // 旧 PASS 后又 phase_start:testing（重启）且中断——最后一条 verdict 仍是 PASS/advance，
    // 但它在最新 start 之前 → 不采信
    const h = setupHost();
    w(h.root, `doc/features/${FEATURE}/goal-runs/${RUN_ID}/events.jsonl`, [
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance' }),
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' }),
    ].join('\n') + '\n');
    const r = evalHost(h);
    const i = itemOf(r, 'run_binding');
    assert(i.verdict === 'FAIL' && i.detail.includes('重启'), `最新 start 后无 PASS/advance 须 FAIL：${i.detail}`);
    // run_end 缺失（run 没走到终局）
    const h2 = setupHost();
    w(h2.root, `doc/features/${FEATURE}/goal-runs/${RUN_ID}/events.jsonl`, [
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance' }),
    ].join('\n') + '\n');
    const r2 = evalHost(h2);
    const i2 = itemOf(r2, 'run_binding');
    assert(i2.verdict === 'FAIL' && i2.detail.includes('run_end'), `run_end 缺失须 FAIL：${i2.detail}`);
    // run_end=PARTIAL（弱终局）
    const h3 = setupHost();
    w(h3.root, `doc/features/${FEATURE}/goal-runs/${RUN_ID}/events.jsonl`, [
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance' }),
      JSON.stringify({ type: 'run_end', status: 'PARTIAL' }),
    ].join('\n') + '\n');
    const r3 = evalHost(h3);
    assert(itemOf(r3, 'run_binding').verdict === 'FAIL', 'PARTIAL 终局不得采信');
  });

  run(results, 'round22 P1：旧段成功 run_end 不可借用——resume 新段 PASS 但新 run_end 未写 → FAIL', () => {
    // 旧段 PASS → 旧 run_end=COMPLETED → resume 新段 → testing PASS → 写新 run_end 前中断
    const h = setupHost();
    w(h.root, `doc/features/${FEATURE}/goal-runs/${RUN_ID}/events.jsonl`, [
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance' }),
      JSON.stringify({ type: 'run_end', status: 'COMPLETED' }),
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance' }),
      // 新段 run_end 缺席（中断）
    ].join('\n') + '\n');
    const r = evalHost(h);
    const i = itemOf(r, 'run_binding');
    assert(i.verdict === 'FAIL' && i.detail.includes('之前'), `旧 run_end 不得借用：${i.detail}`);
    // 顺序正确（新段 run_end 在新 verdict 之后）→ PASS
    const h2 = setupHost();
    w(h2.root, `doc/features/${FEATURE}/goal-runs/${RUN_ID}/events.jsonl`, [
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance' }),
      JSON.stringify({ type: 'run_end', status: 'COMPLETED' }),
      JSON.stringify({ type: 'phase_start', phase: 'testing' }),
      JSON.stringify({ type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance' }),
      JSON.stringify({ type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' }),
    ].join('\n') + '\n');
    const r2 = evalHost(h2);
    assert(itemOf(r2, 'run_binding').verdict === 'PASS', `顺序绑定成立须 PASS：${itemOf(r2, 'run_binding').detail}`);
  });

  run(results, 'round22 P2：asset.applicable 缺失（畸形 {verdict:PASS}）→ required_assets FAIL（须显式 true）', () => {
    const summaryRel = `doc/features/${FEATURE}/coding/reports/summary.json`;
    const h = setupHost();
    const s = JSON.parse(fs.readFileSync(path.join(h.root, summaryRel), 'utf-8')) as
      { quality_axes: { asset: Record<string, unknown> } };
    delete s.quality_axes.asset.applicable;
    fs.writeFileSync(path.join(h.root, summaryRel), JSON.stringify(s, null, 2));
    const r = evalHost(h);
    const i = itemOf(r, 'required_assets');
    assert(i.verdict === 'FAIL' && i.detail.includes('applicable'), `applicable 缺失须 FAIL：${i.detail}`);
  });

  run(results, 'round21 P1：素材链 fail-open 三口封死——applicable=false / 缺 script_report 指针 / checks 非数组', () => {
    const summaryRel = `doc/features/${FEATURE}/coding/reports/summary.json`;
    // applicable=false：bc-openCard 明确需要图片，不接受 NOT_APPLICABLE 豁免
    const h = setupHost();
    const s1 = JSON.parse(fs.readFileSync(path.join(h.root, summaryRel), 'utf-8')) as
      { quality_axes: { asset: { applicable: boolean; verdict: string } } };
    s1.quality_axes.asset.applicable = false;
    s1.quality_axes.asset.verdict = 'NOT_APPLICABLE';
    fs.writeFileSync(path.join(h.root, summaryRel), JSON.stringify(s1, null, 2));
    const r1 = evalHost(h);
    const i1 = itemOf(r1, 'required_assets');
    assert(i1.verdict === 'FAIL' && i1.detail.includes('applicable=false'), `不适用须 FAIL：${i1.detail}`);
    // script_report 指针缺失：不回退默认文件
    const h2 = setupHost();
    const s2 = JSON.parse(fs.readFileSync(path.join(h2.root, summaryRel), 'utf-8')) as Record<string, unknown>;
    delete s2.script_report;
    fs.writeFileSync(path.join(h2.root, summaryRel), JSON.stringify(s2, null, 2));
    const r2 = evalHost(h2);
    const i2 = itemOf(r2, 'required_assets');
    assert(i2.verdict === 'FAIL' && i2.detail.includes('指针缺失'), `缺指针须 FAIL（不得回退默认文件）：${i2.detail}`);
    // checks 非数组：畸形报告不按空数组放行
    const h3 = setupHost();
    w(h3.root, `doc/features/${FEATURE}/coding/reports/script-report.json`, JSON.stringify({ summary: {} }));
    const r3 = evalHost(h3);
    const i3 = itemOf(r3, 'required_assets');
    assert(i3.verdict === 'FAIL' && i3.detail.includes('checks'), `畸形报告须 FAIL：${i3.detail}`);
  });

  run(results, 'round20 P1：条目 build 指纹 ≠ 当前安装 → build_binding FAIL（同 run 换 build 的旧截图不过关）', () => {
    const h = setupHost();
    const vdPath = path.join(h.root, `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`);
    const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<Record<string, unknown>> };
    doc.screens.find(s => s.screen_id === 'card_select')!.evaluated_build_fingerprint = 'stalebuild000';
    fs.writeFileSync(vdPath, JSON.stringify(doc, null, 2));
    const r = evalHost(h);
    const i = itemOf(r, 'build_binding');
    assert(i.verdict === 'FAIL' && i.detail.includes('card_select'), `旧 build 条目须点名 FAIL：${i.detail}`);
    // hap 被换（当前指纹变了）→ 全部条目失配
    const h2 = setupHost();
    w(h2.root, 'build/default/app.hap', 'hap-bytes-v2-DIFFERENT');
    const r2 = evalHost(h2);
    assert(itemOf(r2, 'build_binding').verdict === 'FAIL', '换 hap 后旧条目须全部失配');
  });

  run(results, 'manifest sha 失配 / sidecar 缺席 → candidate_binding FAIL（旧结果不能复用）', () => {
    const h = setupHost();
    const r = evalHost(h, { expectedManifestSha: 'f'.repeat(64) });
    assert(itemOf(r, 'candidate_binding').verdict === 'FAIL', 'sha 失配须 FAIL');

    const h2 = setupHost();
    fs.rmSync(path.join(h2.fwRoot, 'RELEASE-MANIFEST.sha256'));
    const r2 = evalHost(h2);
    assert(itemOf(r2, 'candidate_binding').verdict === 'FAIL', 'sidecar 缺席（非 candidate 安装）须 FAIL');
  });

  run(results, 'run 绑定：goal run 缺席/未到 testing → run_binding FAIL', () => {
    const h = setupHost();
    const r = evalHost(h, { runId: 'ghost-run' });
    assert(itemOf(r, 'run_binding').verdict === 'FAIL', '不存在的 run 须 FAIL');
  });

  run(results, 'coding summary 缺席 → required_assets fail-closed FAIL', () => {
    const h = setupHost();
    fs.rmSync(path.join(h.root, `doc/features/${FEATURE}/coding/reports/summary.json`));
    const r = evalHost(h);
    const i = itemOf(r, 'required_assets');
    assert(i.verdict === 'FAIL' && i.detail.includes('缺席'), `素材门证据缺席须 fail-closed：${i.detail}`);
  });

  run(results, 'round20 P1：素材门按真实契约消费——asset 轴 FAIL / script-report check FAIL / summary.run_id 失配 各自拦截', () => {
    const summaryRel = `doc/features/${FEATURE}/coding/reports/summary.json`;
    // asset 轴非 PASS
    const h = setupHost();
    const s1 = JSON.parse(fs.readFileSync(path.join(h.root, summaryRel), 'utf-8')) as
      { quality_axes: { asset: { verdict: string } } };
    s1.quality_axes.asset.verdict = 'FAIL';
    fs.writeFileSync(path.join(h.root, summaryRel), JSON.stringify(s1, null, 2));
    const r1 = evalHost(h);
    const i1 = itemOf(r1, 'required_assets');
    assert(i1.verdict === 'FAIL' && i1.detail.includes('asset 轴'), `asset 轴 FAIL 须拦：${i1.detail}`);
    // script-report 素材门 check FAIL（轴若因派生缺陷仍 PASS 也兜得住）
    const h2 = setupHost();
    w(h2.root, `doc/features/${FEATURE}/coding/reports/script-report.json`, JSON.stringify({
      checks: [{ id: 'visual_parity_asset_materialized', status: 'FAIL' }],
    }));
    const r2 = evalHost(h2);
    const i2 = itemOf(r2, 'required_assets');
    assert(i2.verdict === 'FAIL' && i2.detail.includes('visual_parity_asset_materialized'), `check FAIL 须拦：${i2.detail}`);
    // summary.run_id ≠ 本 run（旧 run 的 coding 结果）
    const h3 = setupHost();
    const s3 = JSON.parse(fs.readFileSync(path.join(h3.root, summaryRel), 'utf-8')) as { run_id: string };
    s3.run_id = 'stale-run';
    fs.writeFileSync(path.join(h3.root, summaryRel), JSON.stringify(s3, null, 2));
    const r3 = evalHost(h3);
    const i3 = itemOf(r3, 'required_assets');
    assert(i3.verdict === 'FAIL' && i3.detail.includes('run_id'), `run_id 失配须拦：${i3.detail}`);
  });

  return results;
}
