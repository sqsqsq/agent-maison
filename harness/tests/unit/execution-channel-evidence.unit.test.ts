// ============================================================================
// execution-channel-evidence.unit.test.ts — 非 Hylyre 通道 per-TC 证据绑定
//                                            （plan a6c4e9f2 tasks 6.5b）
// ----------------------------------------------------------------------------
// 这套件的风险方向和别处相反：6.5b 是**放松**——把原本一律 FAIL 的三条通道改为按机器
// 证据裁决。放松处最怕的不是误报而是漏放行，因此绝大多数用例是"必须仍然 FAIL"的反例。
//
// ⚠ 第一版这套件本身就是反面教材：正例直接手工构造 `Map<screen_id, 'pass'>` 喂给绑定
// 函数，**绕过了生产 loader**，于是 loader 读错路径、只读 verdict 不校 schema/新鲜度
// 这两个真问题一条都没暴露。现在**正例必须落真实文件、走 `loadVisualScreenVerdicts`**，
// 反例也全部走同一条生产路径。
//
// 另一条纪律（本 plan 内第三次踩坑后立的规矩）：负向用例**必须断言具体拒绝原因**，
// 不得只断言 verdict——"只断言 FAIL"会把"因为别的原因失败"也算成通过。
// ============================================================================

import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  bindChannelEvidence,
  extractTcAcceptanceRefs,
  loadVisualScreenVerdicts,
  PROVIDER_EVIDENCE_CONTRACT,
  type ChannelEvidenceInput,
} from '../../scripts/utils/execution-channel-evidence';
import type { AcceptanceFlowsDoc } from '../../scripts/utils/p0-semantic-gates';
import type { UnitCaseResult } from '../run-unit';

const PLAN = [
  '# 测试计划',
  '',
  '## 测试用例',
  '',
  '| 用例编号 | 用例名称 | 优先级 | 关联 AC | 执行通道 |',
  '| --- | --- | --- | --- | --- |',
  '| TC-001 | 开卡主流程 | P0 | AC-1 | hylyre |',
  '| TC-002 | 卡面视觉 | P0 | AC-2 | visual |',
  '| TC-003 | 无关联 | P1 |  | visual |',
  '',
].join('\n');

const FEATURE = 'demo';
const BUILD_FP = 'build-fp-current';

function acceptance(): AcceptanceFlowsDoc {
  return {
    flows: { main: ['home', 'card'] },
    criteria: [
      { id: 'AC-1', priority: 'P0', checkpoint: { pre_screen: 'home', post_screen: 'success' } },
      { id: 'AC-2', priority: 'P0', checkpoint: { pre_screen: 'card_front', post_screen: 'card_back' } },
      // 结构化 checkpoint 缺屏声明——视觉目标无法机器确定。
      { id: 'AC-3', priority: 'P0', checkpoint: { action: { type: 'touch' } } },
    ],
  };
}

// ---------------------------------------------------------------------------
// 真实 feature 目录夹具：正例与反例都必须走生产 loader
// ---------------------------------------------------------------------------

interface ScreenFixture {
  screen_id: string;
  verdict?: string;
  /** 不写盘（模拟缺图） */
  omitShot?: boolean;
  /** 写盘后再改内容（模拟换图 → hash 失配） */
  tamperShot?: boolean;
  omitEvaluatedHash?: boolean;
  buildFingerprint?: string | null;
  evaluationInvalidated?: boolean;
}

function makeFeatureRoot(screens: ScreenFixture[], opts: { rawOverride?: unknown } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chan-evidence-'));
  const shotsDir = path.join(root, 'doc', 'features', FEATURE, 'device-testing', 'device-screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const entries = screens.map(spec => {
    // 两处必须跟生产口径完全一致，否则夹具"看起来对"但判据全错：
    //   · screenshot_path 由 `resolveShotPath` 相对 **projectRoot** 解析（不是 feature 目录）；
    //   · evaluated_screenshot_hash 是 sha256 的**前 16 hex**（`hashScreenshotFile`），不是全长。
    // 这正是自造弱解析器时代永远暴露不出来的细节。
    const rel = `doc/features/${FEATURE}/device-testing/device-screenshots/${spec.screen_id}.png`;
    const abs = path.join(root, rel);
    let hash: string | undefined;
    if (!spec.omitShot) {
      fs.writeFileSync(abs, `png-bytes-${spec.screen_id}`);
      hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 16);
      if (spec.tamperShot) fs.writeFileSync(abs, `png-bytes-${spec.screen_id}-TAMPERED`);
    }
    return {
      screen_id: spec.screen_id,
      verdict: spec.verdict ?? 'pass',
      screenshot_path: rel,
      ref_path: rel,
      ...(spec.omitEvaluatedHash || !hash ? {} : { evaluated_screenshot_hash: hash }),
      ...(spec.buildFingerprint === undefined
        ? { evaluated_build_fingerprint: BUILD_FP }
        : spec.buildFingerprint === null ? {} : { evaluated_build_fingerprint: spec.buildFingerprint }),
      ...(spec.evaluationInvalidated ? { evaluation_invalidated: true } : {}),
      defects: [],
    };
  });

  const doc = opts.rawOverride ?? { schema_version: '1.1', feature: FEATURE, screens: entries };
  fs.writeFileSync(path.join(shotsDir, 'visual-diff.json'), `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  return root;
}

function visualFrom(root: string, over: Partial<Parameters<typeof loadVisualScreenVerdicts>[0]> = {}) {
  return loadVisualScreenVerdicts({
    projectRoot: root,
    feature: FEATURE,
    currentBuildFingerprint: BUILD_FP,
    visualGateStatus: 'PASS',
    ...over,
  });
}

function input(root: string, over: Partial<ChannelEvidenceInput> = {}): ChannelEvidenceInput {
  return {
    planMd: PLAN,
    acceptance: acceptance(),
    visual: visualFrom(root),
    visualTcIds: ['TC-002'],
    providerTcIds: [],
    manualTcIds: [],
    ...over,
  };
}

/** 两屏都健康的默认夹具（AC-2 绑定 card_front / card_back）。 */
function healthyRoot(): string {
  return makeFeatureRoot([{ screen_id: 'card_front' }, { screen_id: 'card_back' }]);
}

const CASES: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

function withRoot(make: () => string, body: (root: string) => void): void {
  const root = make();
  try { body(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('TC→关联 AC 只读结构化列，不从用例名/备注抽取', () => {
  const refs = extractTcAcceptanceRefs(PLAN);
  assert.deepStrictEqual(refs.get('TC-001'), ['AC-1']);
  assert.deepStrictEqual(refs.get('TC-002'), ['AC-2']);
  assert.deepStrictEqual(refs.get('TC-003'), []);
  const sneaky = PLAN.replace('| TC-003 | 无关联 | P1 |  | visual |', '| TC-003 | 覆盖 AC-2 的补充用例 | P1 |  | visual |');
  assert.deepStrictEqual(extractTcAcceptanceRefs(sneaky).get('TC-003'), []);
});

test('正例走生产 loader：真实 feature 目录 + 合规 visual-diff.json → covered', () => {
  withRoot(healthyRoot, root => {
    const visual = visualFrom(root);
    assert.strictEqual(visual.available, true, visual.detail);
    assert.strictEqual(visual.byScreen.get('card_front')?.usable, true);
    const [binding] = bindChannelEvidence(input(root));
    assert.strictEqual(binding.verdict.kind, 'covered', binding.verdict.detail);
    assert.ok(binding.verdict.detail.includes('card_front'));
  });
});

test('路径必须是 feature 目录：产物只放在 phase reports 目录时不得被采信', () => {
  withRoot(healthyRoot, root => {
    // 把权威产物挪走，改放到**曾经写错的那条路径**下。
    const featureShots = path.join(root, 'doc', 'features', FEATURE, 'device-testing', 'device-screenshots');
    const wrongDir = path.join(root, 'doc', 'features', FEATURE, 'testing', 'reports', 'device-testing', 'device-screenshots');
    fs.mkdirSync(wrongDir, { recursive: true });
    fs.copyFileSync(path.join(featureShots, 'visual-diff.json'), path.join(wrongDir, 'visual-diff.json'));
    fs.rmSync(path.join(featureShots, 'visual-diff.json'));

    const visual = visualFrom(root);
    assert.strictEqual(visual.available, false);
    assert.ok(visual.detail.includes('visual-diff.json 不存在'), visual.detail);
    const [binding] = bindChannelEvidence(input(root, { visual }));
    assert.strictEqual(binding.verdict.kind, 'unbound');
  });
});

test('证据义务不得早于 visual 门：本轮 visual 未 PASS 时无证据可消费', () => {
  withRoot(healthyRoot, root => {
    for (const status of [null, 'FAIL', 'SKIP', 'PENDING']) {
      const visual = visualFrom(root, { visualGateStatus: status });
      assert.strictEqual(visual.available, false, `status=${status}`);
      assert.ok(visual.detail.includes('visual_diff 门未通过'), visual.detail);
      const [binding] = bindChannelEvidence(input(root, { visual }));
      assert.strictEqual(binding.verdict.kind, 'unbound', `status=${status} 不得放行`);
    }
  });
});

test('手改的极简 JSON 过不了 schema——弱解析器时代它能洗绿', () => {
  withRoot(
    () => makeFeatureRoot([], { rawOverride: { screens: [{ screen_id: 'card_front', verdict: 'pass' }, { screen_id: 'card_back', verdict: 'pass' }] } }),
    root => {
      const visual = visualFrom(root);
      // 要么整体判不合 schema，要么逐屏因缺 evaluated_screenshot_hash 不可用；
      // 两条都不允许出现 usable=true。
      const usable = [...visual.byScreen.values()].filter(v => v.usable);
      assert.strictEqual(usable.length, 0, `手改 JSON 不得产出可用证据：${JSON.stringify([...visual.byScreen])}`);
      const [binding] = bindChannelEvidence(input(root, { visual }));
      assert.notStrictEqual(binding.verdict.kind, 'covered');
    },
  );
});

test('截图 hash 失配（换图）→ 该屏结论失效', () => {
  withRoot(
    () => makeFeatureRoot([{ screen_id: 'card_front', tamperShot: true }, { screen_id: 'card_back' }]),
    root => {
      const visual = visualFrom(root);
      assert.strictEqual(visual.byScreen.get('card_front')?.usable, false);
      assert.ok(
        (visual.byScreen.get('card_front')?.reason ?? '').includes('结论已失效'),
        JSON.stringify(visual.byScreen.get('card_front')),
      );
      const [binding] = bindChannelEvidence(input(root, { visual }));
      assert.strictEqual(binding.verdict.kind, 'failed');
      assert.ok(binding.verdict.detail.includes('card_front'));
    },
  );
});

test('旧 build 的结论不算本轮证据', () => {
  withRoot(
    () => makeFeatureRoot([{ screen_id: 'card_front', buildFingerprint: 'build-fp-OLD' }, { screen_id: 'card_back' }]),
    root => {
      const visual = visualFrom(root);
      assert.strictEqual(visual.byScreen.get('card_front')?.usable, false);
      assert.ok((visual.byScreen.get('card_front')?.reason ?? '').includes('结论已失效'));
      const [binding] = bindChannelEvidence(input(root, { visual }));
      assert.strictEqual(binding.verdict.kind, 'failed');
    },
  );
});

test('缺 evaluated_screenshot_hash → pass 无从复核，不得采信', () => {
  withRoot(
    () => makeFeatureRoot([{ screen_id: 'card_front', omitEvaluatedHash: true }, { screen_id: 'card_back' }]),
    root => {
      const visual = visualFrom(root);
      assert.strictEqual(visual.byScreen.get('card_front')?.usable, false);
      assert.ok((visual.byScreen.get('card_front')?.reason ?? '').includes('evaluated_screenshot_hash'));
      const [binding] = bindChannelEvidence(input(root, { visual }));
      assert.strictEqual(binding.verdict.kind, 'failed');
    },
  );
});

test('evaluation_invalidated=true → 该屏须重评，不得采信', () => {
  withRoot(
    () => makeFeatureRoot([{ screen_id: 'card_front', evaluationInvalidated: true }, { screen_id: 'card_back' }]),
    root => {
      const visual = visualFrom(root);
      assert.strictEqual(visual.byScreen.get('card_front')?.usable, false);
      assert.ok((visual.byScreen.get('card_front')?.reason ?? '').includes('evaluation_invalidated'));
    },
  );
});

test('verdict 非 pass（warn/fail/skipped/pending）一律不得采信', () => {
  for (const verdict of ['warn', 'fail', 'skipped', 'pending']) {
    withRoot(
      () => makeFeatureRoot([{ screen_id: 'card_front', verdict }, { screen_id: 'card_back' }]),
      root => {
        const visual = visualFrom(root);
        assert.strictEqual(visual.byScreen.get('card_front')?.usable, false, verdict);
        const [binding] = bindChannelEvidence(input(root, { visual }));
        assert.strictEqual(binding.verdict.kind, 'failed', verdict);
      },
    );
  }
});

test('缺结构化「关联 AC」→ unbound，不得凭通道声明放行', () => {
  withRoot(healthyRoot, root => {
    const [binding] = bindChannelEvidence(input(root, { visualTcIds: ['TC-003'] }));
    assert.strictEqual(binding.verdict.kind, 'unbound');
    assert.ok(binding.verdict.detail.includes('关联 AC'));
  });
});

test('AC 的 checkpoint 没声明 pre/post_screen → unbound（不用 linked_flow 兜底）', () => {
  withRoot(healthyRoot, root => {
    const plan = PLAN.replace('| TC-002 | 卡面视觉 | P0 | AC-2 | visual |', '| TC-002 | 卡面视觉 | P0 | AC-3 | visual |');
    const [binding] = bindChannelEvidence(input(root, { planMd: plan }));
    assert.strictEqual(binding.verdict.kind, 'unbound');
    assert.ok(binding.verdict.detail.includes('pre_screen/post_screen'));
  });
});

test('绑定屏缺条目 → unbound（缺条目不等于通过）', () => {
  withRoot(
    () => makeFeatureRoot([{ screen_id: 'card_front' }]),
    root => {
      const [binding] = bindChannelEvidence(input(root));
      assert.strictEqual(binding.verdict.kind, 'unbound');
      assert.ok(binding.verdict.detail.includes('card_back'));
    },
  );
});

test('多 AC 的 visual TC：任一 AC 缺屏声明即整体 unbound', () => {
  withRoot(healthyRoot, root => {
    const plan = PLAN.replace('| TC-002 | 卡面视觉 | P0 | AC-2 | visual |', '| TC-002 | 卡面视觉 | P0 | AC-2, AC-3 | visual |');
    const [binding] = bindChannelEvidence(input(root, { planMd: plan }));
    assert.strictEqual(binding.verdict.kind, 'unbound');
    assert.ok(binding.verdict.detail.includes('AC-3'));
  });
});

test('provider 通道仍 fail-closed，且给出可实现的契约而不是空拒绝', () => {
  withRoot(healthyRoot, root => {
    const [binding] = bindChannelEvidence(
      input(root, { visualTcIds: [], providerTcIds: [{ tc_id: 'TC-010', provider_id: 'some_cap' }] }),
    );
    assert.strictEqual(binding.verdict.kind, 'unbound');
    assert.ok(binding.verdict.detail.includes('per-TC'));
    assert.ok(binding.verdict.detail.includes('feature 级'));
    assert.ok(PROVIDER_EVIDENCE_CONTRACT.includes('tc_id'));
  });
});

test('manual 通道永远不可机器证明（冻结设计）', () => {
  withRoot(healthyRoot, root => {
    const [binding] = bindChannelEvidence(input(root, { visualTcIds: [], manualTcIds: ['TC-020'] }));
    assert.strictEqual(binding.verdict.kind, 'not_machine_provable');
    assert.ok(binding.verdict.detail.includes('confirmed_by'));
  });
});

export function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const testCase of CASES) {
    try {
      testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (e) {
      results.push({
        name: testCase.name,
        ok: false,
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
    }
  }
  return Promise.resolve(results);
}
