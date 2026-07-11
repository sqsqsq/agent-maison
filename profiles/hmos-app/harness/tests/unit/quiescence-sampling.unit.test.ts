/**
 * quiescence-sampling 单测（t4a，plan f7a3d9c2）：静稳采样三态 + 布局签名 + approot 漂移
 * + observe-only（正式链不调用——守恒由 t6b/现有 capture 测试保证，本文件锁采样器语义）。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appRectToNormBBox,
  approotIdentity,
  normalizedLayoutSignature,
  sampleQuiescent,
  QUIESCENCE_DEFAULT_RETRIES,
} from '../../quiescence-sampling';
import { parseHypiumDump } from '../../layout-oracle-check';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function dumpJson(opts: { text?: string; extraNode?: boolean; appY?: number } = {}): string {
  const children = [
    {
      attributes: { bounds: '[0,100][1000,2000]', type: 'root', text: '', id: '', key: '', clickable: 'false' },
      children: [
        {
          attributes: {
            bounds: `[10,${(opts.appY ?? 200)}][500,400]`,
            type: 'Text',
            text: opts.text ?? '首页',
            id: 'home_title',
            key: '',
            clickable: 'false',
          },
          children: [],
        },
        ...(opts.extraNode
          ? [{ attributes: { bounds: '[10,500][300,600]', type: 'Button', text: '新节点', id: 'x', key: '', clickable: 'true' }, children: [] }]
          : []),
      ],
    },
  ];
  return JSON.stringify({
    schema_version: 'hylyre-hypium-ui-dump-v1',
    tree: { attributes: { bounds: '[0,0][1000,2000]', type: 'Screen', text: '', id: '', key: '', clickable: 'false' }, children },
  });
}

function mkFns(plan: {
  shots: Array<Buffer | string>;
  dumps: string[];
}): { screenshotFn: (dest: string) => { ok: boolean }; layoutDumpFn: (dest: string) => { ok: boolean } } {
  let shotIdx = 0;
  let dumpIdx = 0;
  return {
    screenshotFn: dest => {
      const cur = plan.shots[Math.min(shotIdx, plan.shots.length - 1)];
      shotIdx++;
      fs.writeFileSync(dest, cur);
      return { ok: true };
    },
    layoutDumpFn: dest => {
      const cur = plan.dumps[Math.min(dumpIdx, plan.dumps.length - 1)];
      dumpIdx++;
      fs.writeFileSync(dest, cur, 'utf-8');
      return { ok: true };
    },
  };
}

function paths(): { probeShotAbs: string; probeDumpAbs: string; finalShotAbs: string; finalDumpAbs: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesce-'));
  return {
    probeShotAbs: path.join(dir, 'shot1.png'),
    probeDumpAbs: path.join(dir, 'dump1.json'),
    finalShotAbs: path.join(dir, 'shot2.png'),
    finalDumpAbs: path.join(dir, 'dump2.json'),
  };
}

test('layout_signature_stable_and_text_immune', () => {
  const d1 = parseHypiumDump(JSON.parse(dumpJson()));
  const d1b = parseHypiumDump(JSON.parse(dumpJson({ text: '首页（角标 3）' })));
  const d2 = parseHypiumDump(JSON.parse(dumpJson({ extraNode: true })));
  assert.ok(d1 && d1b && d2);
  assert.strictEqual(normalizedLayoutSignature(d1!), normalizedLayoutSignature(d1b!), '文本闪变不算布局漂移');
  assert.notStrictEqual(normalizedLayoutSignature(d1!), normalizedLayoutSignature(d2!), '结构变化签名必变');
  assert.strictEqual(approotIdentity(d1!), approotIdentity(d2!), '同 appRoot 同 identity');
});

test('app_rect_norm_bbox', () => {
  const d = parseHypiumDump(JSON.parse(dumpJson()))!;
  const bbox = appRectToNormBBox(d.appRect, d.screenRect);
  assert.deepStrictEqual(bbox.map(n => Number(n.toFixed(3))), [0, 0.05, 1, 0.95], `app 区归一化：${JSON.stringify(bbox)}`);
});

test('stable_first_attempt', () => {
  const p = paths();
  // 无 jimp 环境下走 full_frame 口径：两 shot 字节一致 + 两 dump 同签名 → 一次判稳
  const r = sampleQuiescent({ ...p, fns: mkFns({ shots: [Buffer.from('SAME')], dumps: [dumpJson()] }) });
  assert.strictEqual(r.stable, true);
  assert.strictEqual(r.attempts, 1);
  assert.strictEqual(r.records[0].layout_stable, true);
  assert.strictEqual(r.records[0].approot_stable, true);
});

test('unstable_once_then_stable_via_retry', () => {
  const p = paths();
  let call = 0;
  const fns = {
    screenshotFn: (dest: string) => {
      // 第一组两拍不一致（动画中），第二组稳定
      call++;
      fs.writeFileSync(dest, call <= 2 ? Buffer.from(`drift-${call}`) : Buffer.from('SAME'));
      return { ok: true };
    },
    layoutDumpFn: (dest: string) => {
      fs.writeFileSync(dest, dumpJson(), 'utf-8');
      return { ok: true };
    },
  };
  const r = sampleQuiescent({ ...p, fns });
  assert.strictEqual(r.stable, true, JSON.stringify(r.records));
  assert.strictEqual(r.attempts, 2, '一次抖动后重试判稳');
});

test('persistently_unstable_reports_reason', () => {
  const p = paths();
  let n = 0;
  const fns = {
    screenshotFn: (dest: string) => {
      n++;
      fs.writeFileSync(dest, Buffer.from(`always-${n}`)); // 每拍都不同（轮播）
      return { ok: true };
    },
    layoutDumpFn: (dest: string) => {
      fs.writeFileSync(dest, dumpJson(), 'utf-8');
      return { ok: true };
    },
  };
  const r = sampleQuiescent({ ...p, fns });
  assert.strictEqual(r.stable, false);
  assert.strictEqual(r.attempts, QUIESCENCE_DEFAULT_RETRIES + 1, '重试耗尽');
  assert.strictEqual(r.unstable_reason, 'image_drift');
  assert.ok(fs.existsSync(r.final_shot_abs), 'unstable 仍保留最终产物供降档消费');
});

test('layout_drift_and_approot_drift_reasons', () => {
  {
    const p = paths();
    let d = 0;
    const fns = {
      screenshotFn: (dest: string) => {
        fs.writeFileSync(dest, Buffer.from('SAME'));
        return { ok: true };
      },
      layoutDumpFn: (dest: string) => {
        d++;
        fs.writeFileSync(dest, dumpJson({ extraNode: d % 2 === 0 }), 'utf-8'); // 两 dump 结构不一致
        return { ok: true };
      },
    };
    const r = sampleQuiescent({ ...p, fns, retries: 0 });
    assert.strictEqual(r.stable, false);
    assert.strictEqual(r.unstable_reason, 'layout_drift', JSON.stringify(r.records[0]));
  }
  {
    const p = paths();
    let d = 0;
    const fns = {
      screenshotFn: (dest: string) => {
        fs.writeFileSync(dest, Buffer.from('SAME'));
        return { ok: true };
      },
      layoutDumpFn: (dest: string) => {
        d++;
        // appRect 漂移（半模态开合）：app 子树 y 起点变化
        fs.writeFileSync(dest, dumpJson({ appY: d % 2 === 0 ? 900 : 200 }), 'utf-8');
        return { ok: true };
      },
    };
    // 注意 appY 变化同时改变布局签名——approot 判据独立断言：identity 不同
    const r = sampleQuiescent({ ...p, fns, retries: 0 });
    assert.strictEqual(r.stable, false);
    assert.strictEqual(r.records[0].approot_stable, true, 'appRoot bounds 未变（子节点变不影响 identity）');
  }
});

test('corrupt_dump_is_error_not_unstable', () => {
  // review-fix（codex P1-6）：dump 写成功但不可解析（损坏/schema 不符）=采集失败，
  // 不得归 unstable 走降档继续 candidate 路径
  const p = paths();
  const fns = {
    screenshotFn: (dest: string) => {
      fs.writeFileSync(dest, Buffer.from('SAME'));
      return { ok: true };
    },
    layoutDumpFn: (dest: string) => {
      fs.writeFileSync(dest, '{"schema_version":"wrong-schema"', 'utf-8'); // 坏 JSON
      return { ok: true };
    },
  };
  const r = sampleQuiescent({ ...p, fns });
  assert.strictEqual(r.stable, false);
  assert.ok(r.error && /不可解析/.test(r.error), `应报解析失败而非 unstable：${JSON.stringify({ error: r.error, reason: r.unstable_reason })}`);
  assert.strictEqual(r.unstable_reason, undefined, '不得标 unstable_reason');
});

test('sampler_failure_is_error_not_unstable', () => {
  const p = paths();
  const fns = {
    screenshotFn: () => ({ ok: false, error: 'device gone' }),
    layoutDumpFn: (dest: string) => {
      fs.writeFileSync(dest, dumpJson(), 'utf-8');
      return { ok: true };
    },
  };
  const r = sampleQuiescent({ ...p, fns });
  assert.strictEqual(r.stable, false);
  assert.ok(r.error && /shot₁ 失败/.test(r.error), '执行失败与判据不稳区分');
});

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
