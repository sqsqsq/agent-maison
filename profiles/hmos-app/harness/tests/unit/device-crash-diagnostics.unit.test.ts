/**
 * device-crash-diagnostics.unit.test.ts — faultlog 集合差崩溃诊断（v23 F3）
 *
 * 事故背景：真机点"全部银行"直接崩溃，管线只看到 15.1s 元素超时——faultlog 一次没采，
 * crash 从未进回修集合。v23 用**集合差**判新增（旧时间窗方案按 UTC 解析设备本地时间
 * 文件名，时区差会把历史崩溃判成本轮崩溃——已删）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  archiveTimeoutDiagnosis,
  diagnoseNavigationFailure,
  renderDiagnosis,
  snapshotFaultlogSet,
} from '../../device-crash-diagnostics';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

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

/** 可编程 faultlog 目录：ls 返回 listing，cat 返回堆栈 */
function depsOf(listing: string | null, excerpt = 'Pid:1\nReason:Signal:SIGSEGV'): { runHdc: (a: string[]) => string | null } {
  return {
    runHdc: (args: string[]) => {
      if (args.includes('ls')) return listing;
      return excerpt;
    },
  };
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, 'F3 集合差：导航后**新增且含 bundle** 的 faultlog → crash_suspected（含堆栈摘录）', () => {
    const pre = snapshotFaultlogSet(depsOf('cppcrash-com.example.wallet-A\njscrash-com.other-B'));
    assert(pre !== null && pre.size === 2, `基线须 2 条，实得 ${pre?.size}`);
    const d = diagnoseNavigationFailure('com.example.wallet', pre, depsOf(
      'cppcrash-com.example.wallet-A\njscrash-com.other-B\ncppcrash-com.example.wallet-NEW',
    ));
    assert(d.kind === 'crash_suspected', `须判崩溃嫌疑，实得 ${d.kind}`);
    if (d.kind === 'crash_suspected') {
      assert(d.faultFiles.length === 1 && d.faultFiles[0].endsWith('-NEW'), `只认新增：${JSON.stringify(d.faultFiles)}`);
      assert(d.excerpt.includes('SIGSEGV'), '须带堆栈摘录');
    }
  });

  run(results, 'F3 历史崩溃不判本轮（集合差天然免疫时区——旧时间窗方案的坑）', () => {
    // 基线里就有本应用的历史崩溃，本轮无新增 → element_absent
    const listing = 'cppcrash-com.example.wallet-HISTORIC';
    const pre = snapshotFaultlogSet(depsOf(listing));
    const d = diagnoseNavigationFailure('com.example.wallet', pre, depsOf(listing));
    assert(d.kind === 'element_absent', `历史崩溃不得判本轮，实得 ${d.kind}`);
  });

  run(results, 'F3 别家应用的新增崩溃不误归因', () => {
    const pre = snapshotFaultlogSet(depsOf(''));
    const d = diagnoseNavigationFailure('com.example.wallet', pre, depsOf('cppcrash-com.other.app-NEW'));
    assert(d.kind === 'element_absent', `他家崩溃不得归因本应用，实得 ${d.kind}`);
  });

  run(results, 'F3 fail-closed：基线没拍成 / 重列失败 → diagnosis_unavailable（绝不冒充"没崩"）', () => {
    const noPre = diagnoseNavigationFailure('com.example.wallet', null, depsOf('x'));
    assert(noPre.kind === 'diagnosis_unavailable', `无基线须不可用，实得 ${noPre.kind}`);
    const pre = snapshotFaultlogSet(depsOf(''));
    const relistFail = diagnoseNavigationFailure('com.example.wallet', pre, depsOf(null));
    assert(relistFail.kind === 'diagnosis_unavailable', `重列失败须不可用，实得 ${relistFail.kind}`);
    assert(snapshotFaultlogSet(depsOf(null)) === null, '设备不可达时基线须 null');
    // renderer 不得给出 element_absent 措辞
    const msg = renderDiagnosis(relistFail);
    assert(!msg.includes('按元素定位问题处理'), `不可用不得冒充定位结论：${msg}`);
  });

  run(results, 'F3 归档含 run_id（消费侧只认本 run；旧格式无 run_id=过期）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
    const p = archiveTimeoutDiagnosis(dir, 'TC-003/all_banks',
      { kind: 'element_absent', note: 'n/a' }, { runId: 'RUN-1' });
    assert(!!p && fs.existsSync(p), '诊断须落盘');
    const doc = JSON.parse(fs.readFileSync(p!, 'utf-8')) as { run_id?: string; screen_or_case?: string };
    assert(doc.run_id === 'RUN-1', `归档须携带 run_id，实得 ${doc.run_id}`);
    assert(!/[\\/:*?"<>|]/.test(path.basename(p!)), `文件名须安全化：${path.basename(p!)}`);
  });

  run(results, 'F3 per-nav 基线：A 屏崩溃后 B 屏只是超时——B 不得被整批基线误判 crash（review 第 10 轮探针场景）', () => {
    // A 屏导航前基线为空 → A 崩溃产生 faultlog → A 判 crash_suspected
    const preA = snapshotFaultlogSet(depsOf(''));
    const afterCrash = 'cppcrash-com.example.wallet-A';
    const dA = diagnoseNavigationFailure('com.example.wallet', preA, depsOf(afterCrash));
    assert(dA.kind === 'crash_suspected', `A 屏须判崩溃，实得 ${dA.kind}`);
    // B 屏 per-nav 基线在 A 崩溃**之后**拍 → A 的 faultlog 已在基线里 → B 超时判 element_absent
    const preB = snapshotFaultlogSet(depsOf(afterCrash));
    const dB = diagnoseNavigationFailure('com.example.wallet', preB, depsOf(afterCrash));
    assert(dB.kind === 'element_absent',
      `B 屏用 per-nav 基线须判定位问题（整批一拍会把 A 的崩溃归因给 B），实得 ${dB.kind}`);
  });

  run(results, 'F3 接线回归：capture 侧到达失败分支须跑集合差诊断并归档（模块不得零调用方）', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'visual-diff-capture.ts'), 'utf-8');
    assert((src.match(/diagnoseNavigationFailure\(/g) ?? []).length >= 2,
      '主屏与 overlay 两处到达失败分支都须诊断');
    assert((src.match(/archiveTimeoutDiagnosis\(/g) ?? []).length >= 2, '两处诊断都须归档');
    // per-nav：基线取样必须在**每个** navExecutorFn 调用点之前各拍一次（整批一拍会误归因）
    assert((src.match(/takeFaultlogBaseline\(\)/g) ?? []).length >= 2,
      '主屏与 overlay 两处导航前都须单独拍 faultlog 基线（per-nav，不是整批一拍）');
    assert(!/const preFaultlogSet =/.test(src), '整批一拍的旧基线变量不得回潮');
  });

  return results;
}
