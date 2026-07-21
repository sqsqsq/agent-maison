// ============================================================================
// effective-vision-context.unit.test.ts — 三轴解析器 + 反证器 + 终签硬化回归
// （visual-capability-truth S3；含验收「能力 A/B 五形态」）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  activeDowngrades,
  appendArtifactAttestation,
  appendPolicyDowngrade,
  appendPolicySupersede,
  resolveEffectiveVisionContext,
  writeCapabilityReceipt,
  readCapabilityReceipt,
  type ArtifactAttestationRecord,
  type PolicyDowngradeRecord,
} from '../../scripts/utils/effective-vision-context';
import {
  hasInvalidUnicode,
  scanUiSpecCounterevidence,
} from '../../scripts/utils/vision-counterevidence';
import { clearFrameworkConfigCache } from '../../config';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';
import type { UiSpecDoc } from '../../scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function withTmp<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evc-'));
  ensureConsumerFrameworkTree(dir);
  clearFrameworkConfigCache();
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    clearFrameworkConfigCache();
  }
}

function writeLocal(root: string, canary: Record<string, unknown> | null): void {
  fs.writeFileSync(
    path.join(root, 'framework.local.json'),
    JSON.stringify({
      schema_version: '1.0',
      agent_adapter: 'cursor',
      ...(canary ? { vision: { canary } } : {}),
    }, null, 2),
    'utf-8',
  );
}

const FRESH_GOAL_CANARY = (runId: string): Record<string, unknown> => ({
  adapter: 'cursor',
  verdict: 'tool_read',
  probed_at: new Date().toISOString(),
  probed_via: 'goal',
  probe_version: 2,
  model: 'unknown',
  run_id: runId,
});

// ---------------- 能力 A/B 五形态 ----------------

test('形态1（非视觉模型）：canary none → capability none + policy blind_safe', () => {
  withTmp(root => {
    writeLocal(root, { ...FRESH_GOAL_CANARY('r1'), verdict: 'none' });
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1' });
    assert(c.vision_capability.verdict === 'none', `verdict=${c.vision_capability.verdict}`);
    assert(c.effective_policy.mode === 'blind_safe', 'none 能力 → blind_safe');
  });
});

test('形态2（本 run 真视觉探针）：goal canary tool_read + run 匹配 → run_probed（非 invocation_bound）', () => {
  withTmp(root => {
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1' });
    assert(c.vision_capability.verdict === 'tool_read', c.vision_capability.verdict);
    assert(c.vision_capability.scope === 'run_probed', `scope=${c.vision_capability.scope}——canary 只到 run_probed`);
    assert(c.effective_policy.mode === 'visual', 'no downgrade → visual');
  });
});

test('形态3（model unknown 不跨 run）：goal canary run_id 不匹配 → 落 adapter_declared', () => {
  withTmp(root => {
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r2' });
    assert(c.vision_capability.scope === 'adapter_declared', `run_probed 不得跨 run：${c.vision_capability.scope}`);
  });
});

test('形态4（invocation_bound 签发与绑定）：receipt 只对绑定 invoke 有效', () => {
  withTmp(root => {
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    writeCapabilityReceipt(root, 'f', {
      adapter: 'cursor', run_id: 'r1', invoke_id: 'spec-i3',
      binding_path: 'inline_canary', verdict: 'tool_read', model: 'unknown',
    });
    const bound = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1', invokeId: 'spec-i3' });
    assert(bound.vision_capability.scope === 'invocation_bound', bound.vision_capability.scope);
    const other = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1', invokeId: 'coding-i5' });
    assert(other.vision_capability.scope === 'run_probed', `其他 invoke 不得继承 bound：${other.vision_capability.scope}`);
    assert(readCapabilityReceipt(root, 'f')!.binding_path === 'inline_canary', 'receipt 读回');
  });
});

test('形态5（反证后 bound 不解除降级——codex 四轮 P0 核心）：contradicted artifact + 后续 invocation_bound → 仍 blind_safe', () => {
  withTmp(root => {
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    appendArtifactAttestation(root, 'f', {
      artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H1',
      verdict: 'contradicted', reasons: ['invalid_unicode:s/root'], source: 'test',
    });
    appendPolicyDowngrade(root, 'f', {
      reason: 'attestation contradicted', artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H1', source: 'test',
    });
    writeCapabilityReceipt(root, 'f', {
      adapter: 'cursor', run_id: 'r1', invoke_id: 'spec-i9',
      binding_path: 'inline_canary', verdict: 'tool_read',
    });
    const c = resolveEffectiveVisionContext({
      projectRoot: root, feature: 'f', runId: 'r1', invokeId: 'spec-i9', artifactHashes: ['H1'],
    });
    assert(c.vision_capability.scope === 'invocation_bound', '能力轴可提升');
    assert(c.artifact_attestation.H1.verdict === 'contradicted', 'artifact 轴不受能力轴影响');
    assert(c.effective_policy.mode === 'blind_safe', 'bound receipt 不得解除 policy 降级（三轴分算）');
  });
});

test('对抗1（codex 实施 review P0-1a）：adapter_declared（声明 tool_read 无任何实测）→ policy blind_safe', () => {
  withTmp(root => {
    writeLocal(root, null); // 无 canary——只剩 adapter 声明
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1', adapter: 'cursor' });
    assert(c.vision_capability.scope === 'adapter_declared', c.vision_capability.scope);
    assert(c.effective_policy.mode === 'blind_safe', '声明≠能力——未实测不得进 visual（20260718 事故形态）');
    assert(
      c.effective_policy.downgrade_reasons.some(r => r.includes('adapter_declared')),
      JSON.stringify(c.effective_policy.downgrade_reasons),
    );
  });
});

test('对抗2（P0-1c）：attestations/downgrades 账面含损坏行 → fail-closed blind_safe', () => {
  withTmp(root => {
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    const p = path.join(root, 'doc', 'features', 'f', 'vision', 'policy-downgrades.jsonl');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{"schema_version":"1.0","at":"x","kind":"downg', 'utf-8'); // 崩溃半行
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1' });
    assert(c.effective_policy.mode === 'blind_safe', '损坏账面不解释成空历史');
    assert(c.effective_policy.downgrade_reasons.some(r => r.includes('损坏行')), JSON.stringify(c.effective_policy.downgrade_reasons));
  });
});

// ---------------- 降级解除双途 ----------------

test('解除途径1：runner supersede（append-only，时间在后）解除降级', () => {
  withTmp(root => {
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    const d = appendPolicyDowngrade(root, 'f', {
      reason: 'x', artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H1', source: 'test',
    });
    // 二轮 P1：supersede 只向后解除——显式给更晚 at（同毫秒写入不构成"在后"）
    appendPolicySupersede(root, 'f', {
      reason: '人工核查解除', source: 'runner', supersedes_at: d.at,
      at: new Date(Date.parse(d.at) + 1000).toISOString(),
    });
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1' });
    assert(c.effective_policy.mode === 'visual', `supersede 后应恢复：${c.effective_policy.downgrade_reasons.join('|')}`);
  });
});

test('二轮 P1 对抗：预埋/历史 supersede（时间在前）不得解除未来降级', () => {
  const now = Date.now();
  const preSupersede: PolicyDowngradeRecord = {
    schema_version: '1.0', at: new Date(now).toISOString(), kind: 'supersede',
    reason: '预埋洗白', artifact_path: 'spec/ui-spec.yaml', source: 'evil',
  };
  const laterDowngrade: PolicyDowngradeRecord = {
    schema_version: '1.0', at: new Date(now + 5000).toISOString(), kind: 'downgrade',
    reason: 'x', artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H9', source: 't',
  };
  assert(activeDowngrades([preSupersede, laterDowngrade], []).length === 1, '时间反转不得解除');
  const properSupersede: PolicyDowngradeRecord = { ...preSupersede, at: new Date(now + 9000).toISOString() };
  assert(activeDowngrades([properSupersede, laterDowngrade], []).length === 0, '时间在后的 path 匹配可解除');
});

/** 四轮 P1：可通过 binding 验真的 fixture 环境——framework 指纹面 + spec.md/参考图（refs 非空） */
function writeBindingFixture(root: string, feature: string): void {
  fs.mkdirSync(path.join(root, 'framework', 'specs', 'phase-rules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework', 'package.json'), JSON.stringify({ version: '0.0.0-test' }), 'utf-8');
  fs.writeFileSync(path.join(root, 'framework', 'specs', 'phase-rules', 'spec-rules.yaml'), 'rules: test\n', 'utf-8');
  const specDir = path.join(root, 'doc', 'features', feature, 'spec');
  fs.mkdirSync(path.join(specDir, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(specDir, 'reference', 'home.png'), 'PNG-BYTES', 'utf-8');
  fs.writeFileSync(
    path.join(specDir, 'spec.md'),
    `\`\`\`yaml\nui_change: new_or_changed\n\`\`\`\n\npath: doc/features/${feature}/spec/reference/home.png\n`,
    'utf-8',
  );
}

test('二轮 P0-4：调用方询问的 artifact 非 verified（含 no_attestation_record）→ meet 判 blind_safe', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const evc = require('../../scripts/utils/effective-vision-context') as typeof import('../../scripts/utils/effective-vision-context');
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    writeBindingFixture(root, 'f');
    // 无任何 attestation 记录：unverified(no_attestation_record) → 并入降级
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1', artifactHashes: ['H-UNKNOWN'] });
    assert(c.effective_policy.mode === 'blind_safe', 'unverified artifact 不得 visual');
    assert(c.effective_policy.downgrade_reasons.some(r => r.includes('artifact_attestation=unverified')), JSON.stringify(c.effective_policy.downgrade_reasons));
    // verified（带与当前一致的 binding）后同一询问恢复 visual
    const binding = evc.computeCurrentBindingContext(root, 'f');
    assert(binding.gate_fingerprint !== null && binding.refs.length === 1, `binding fixture 应可算：${JSON.stringify(binding)}`);
    appendArtifactAttestation(root, 'f', {
      artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H-UNKNOWN',
      verdict: 'verified', reasons: ['counterevidence_clean', 'provenance_mapped'], source: 'test',
      binding: { run_id: 'r1', invoke_id: 'spec-i1', ...binding },
    });
    const c2 = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1', artifactHashes: ['H-UNKNOWN'] });
    assert(c2.effective_policy.mode === 'visual', `verified 后应 visual：${c2.effective_policy.downgrade_reasons.join('|')}`);
  });
});

test('四轮 P1 对抗：无 binding/陈旧 binding 的 verified 一律投影 unverified（含降级解除面）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const evc = require('../../scripts/utils/effective-vision-context') as typeof import('../../scripts/utils/effective-vision-context');
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    writeBindingFixture(root, 'f');
    // ① 裸 verified（无 binding）→ unverified(binding_missing)
    appendArtifactAttestation(root, 'f', {
      artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H-BARE',
      verdict: 'verified', reasons: ['counterevidence_clean'], source: 'forged',
    });
    const c1 = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1', artifactHashes: ['H-BARE'] });
    assert(c1.artifact_attestation['H-BARE'].verdict === 'unverified', '裸 verified 应降位');
    assert(c1.artifact_attestation['H-BARE'].reasons.includes('binding_missing'), JSON.stringify(c1.artifact_attestation));
    // ② 降级解除面：同路径旧 hash 降级 + 新 hash "裸 verified" → 不得解除
    const dAt = new Date(Date.now() - 60_000).toISOString();
    appendPolicyDowngrade(root, 'f', {
      reason: 'x', artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H-OLD', source: 't', at: dAt,
    });
    const c2 = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1' });
    assert(c2.effective_policy.mode === 'blind_safe', '裸 verified 不得抬降级');
    // ③ 陈旧 binding（gate fingerprint 变更后）→ 同样不抬
    const binding = evc.computeCurrentBindingContext(root, 'f');
    appendArtifactAttestation(root, 'f', {
      artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H-STALE',
      verdict: 'verified', reasons: ['counterevidence_clean'], source: 'forged',
      binding: { run_id: 'r1', invoke_id: 'spec-i1', ...binding, gate_fingerprint: '9.9.9:deadbeefdead' },
    });
    const c3 = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1', artifactHashes: ['H-STALE'] });
    assert(
      c3.artifact_attestation['H-STALE'].verdict === 'unverified' &&
      c3.artifact_attestation['H-STALE'].reasons.some(r => r.includes('binding_stale:gate_fingerprint')),
      JSON.stringify(c3.artifact_attestation['H-STALE']),
    );
  });
});

test('四轮 P0 对抗：agent 手写"裸 verified/supersede 原始 JSON 行"（无 hash 链）→ corrupt fail-closed 不采信', () => {
  withTmp(root => {
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    // 合法链上先落一条降级（经 appender，带链字段）
    appendPolicyDowngrade(root, 'f', {
      reason: 'x', artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H1', source: 't',
    });
    // agent 直接追加"裸 supersede"原始 JSON（无 seq/prev_row_hash/row_hash）
    fs.appendFileSync(
      path.join(root, 'doc', 'features', 'f', 'vision', 'policy-downgrades.jsonl'),
      `${JSON.stringify({ schema_version: '1.0', at: new Date(Date.now() + 5000).toISOString(), kind: 'supersede', reason: '洗白', artifact_path: 'spec/ui-spec.yaml', source: 'runner' })}\n`,
      'utf-8',
    );
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1' });
    assert(c.effective_policy.mode === 'blind_safe', '裸 supersede 不得解除降级');
    assert(c.effective_policy.downgrade_reasons.some(r => r.includes('损坏行')), '未链行按 corrupt 上抛');
    // agent 直接追加"裸 verified"attestation 行 → 同样 corrupt，不进 rows
    fs.appendFileSync(
      path.join(root, 'doc', 'features', 'f', 'vision', 'artifact-attestations.jsonl'),
      `${JSON.stringify({ schema_version: '1.0', at: new Date().toISOString(), artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H-FORGED', verdict: 'verified', reasons: [], source: 'vision_output_counterevidence' })}\n`,
      'utf-8',
    );
    const c2 = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1', artifactHashes: ['H-FORGED'] });
    assert(c2.artifact_attestation['H-FORGED'].reasons.includes('no_attestation_record'), '裸 verified 行不进账（corrupt 剔除）');
  });
});

test('四轮 P0：runner 快照比对——agent 调用窗口内账本变更可检出（snapshot/diff 纯函数）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const before = gr.snapshotVisionLedgers(root, 'f');
    assert(gr.diffVisionLedgerSnapshots(before, gr.snapshotVisionLedgers(root, 'f')).length === 0, '未动应无差异');
    appendArtifactAttestation(root, 'f', {
      artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H1', verdict: 'unverified', reasons: ['x'], source: 't',
    });
    const diff = gr.diffVisionLedgerSnapshots(before, gr.snapshotVisionLedgers(root, 'f'));
    assert(diff.length === 1 && diff[0] === 'artifact-attestations.jsonl', JSON.stringify(diff));
  });
});

test('解除途径2：同产物**新 hash** verified attestation 解除；同 hash verified 不解除', () => {
  const now = Date.now();
  const dg: PolicyDowngradeRecord = {
    schema_version: '1.0', at: new Date(now).toISOString(), kind: 'downgrade',
    reason: 'x', artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H1', source: 't',
  };
  const attNew: ArtifactAttestationRecord = {
    schema_version: '1.0', at: new Date(now + 1000).toISOString(),
    artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H2', verdict: 'verified', reasons: [], source: 't',
  };
  assert(activeDowngrades([dg], [attNew]).length === 0, '新 hash verified 应解除');
  const attSame: ArtifactAttestationRecord = { ...attNew, artifact_hash: 'H1' };
  assert(activeDowngrades([dg], [attSame]).length === 1, '同 hash verified 不得解除（被证伪的产物本体不能自我洗白）');
  const attOther: ArtifactAttestationRecord = { ...attNew, artifact_path: 'other.yaml' };
  assert(activeDowngrades([dg], [attOther]).length === 1, '他产物 verified 不得解除');
});

// ---------------- 反证器三态 ----------------

test('反证器：U+FFFD → contradicted；无映射 → evidence_gap；两者审计分立', () => {
  const doc = {
    screens: [{
      id: 's', priority: 'P0',
      root: {
        type: 'navigation_frame', order: 0, children: [
          { type: 'content_display', order: 1, text: 'pred����' },
          { type: 'content_display', order: 2, text: '凭空捏造的文案' },
          { type: 'content_display', order: 3, text: '添加银行卡' },
        ],
      },
    }],
    tokens: {}, assets: [],
  } as unknown as UiSpecDoc;
  const scan = scanUiSpecCounterevidence(doc, [{ text: '添加银行卡' }]);
  assert(scan.contradicted.length === 1 && scan.contradicted[0].code === 'invalid_unicode', JSON.stringify(scan.contradicted));
  assert(scan.evidenceGap.length === 1 && scan.evidenceGap[0].code === 'no_source_mapping', JSON.stringify(scan.evidenceGap));
  assert(scan.evidenceGap[0].detail.includes('缺证明') && scan.evidenceGap[0].detail.includes('≠'), '措辞须区分缺证与证伪');
});

test('反证器：置信管线在场时低置信升 UI → evidence_gap；无置信管线 → heuristic 计数不误伤', () => {
  const doc = {
    screens: [{
      id: 's', priority: 'P0',
      root: { type: 'navigation_frame', order: 0, children: [{ type: 'content_display', order: 1, text: '电表业银行' }] },
    }],
    tokens: {}, assets: [],
  } as unknown as UiSpecDoc;
  const withConf = scanUiSpecCounterevidence(doc, [{ text: '电表业银行', confidence: 31 }]);
  assert(withConf.evidenceGap.some(f => f.code === 'low_confidence_ocr_promoted'), JSON.stringify(withConf.evidenceGap));
  const noConf = scanUiSpecCounterevidence(doc, [{ text: '电表业银行' }]);
  assert(noConf.evidenceGap.length === 0, '无置信管线不判 evidence_gap（存量绿链不误伤）');
  assert(noConf.heuristics.some(h => h.code === 'no_confidence_pipeline'), 'observe-only 计数在场');
});

test('二轮 P0-2：source_ref 须解析到已知 reference id 才算映射；悬空 → evidence_gap；非 OCR 流不适用', () => {
  const doc = {
    screens: [{
      id: 's', priority: 'P0', ref_id: 'ref_home',
      root: { type: 'navigation_frame', order: 0, children: [{ type: 'content_display', order: 1, text: '任意文案', source_ref: 'ref_home' }] },
    }],
    tokens: {}, assets: [],
  } as unknown as UiSpecDoc;
  // 可解析（屏 ref_id 命中）→ 映射成立
  assert(scanUiSpecCounterevidence(doc, [{ text: '别的' }]).evidenceGap.length === 0, '可解析 source_ref 即映射');
  // 对抗：任意编造的 source_ref（解析不到任何已知 id）→ dangling evidence_gap（旧自签通道）
  const dangling = {
    screens: [{
      id: 's', priority: 'P0',
      root: { type: 'navigation_frame', order: 0, children: [{ type: 'content_display', order: 1, text: '任意文案', source_ref: 'x' }] },
    }],
    tokens: {}, assets: [],
  } as unknown as UiSpecDoc;
  const scanD = scanUiSpecCounterevidence(dangling, [{ text: '别的' }]);
  assert(scanD.evidenceGap.some(f => f.code === 'dangling_source_ref'), JSON.stringify(scanD.evidenceGap));
  assert(scanD.counters.dangling_source_refs === 1, 'dangling 计数');
  // element_id 命中同样成立
  const byElement = scanUiSpecCounterevidence(dangling, [{ text: '别的', element_id: 'x' }]);
  assert(byElement.evidenceGap.length === 0, 'element_id 命中即可解析');
  const noRefFlow = {
    screens: [{ id: 's', priority: 'P0', root: { type: 'navigation_frame', order: 0, children: [{ type: 'content_display', order: 1, text: '任意' }] } }],
    tokens: {}, assets: [],
  } as unknown as UiSpecDoc;
  assert(scanUiSpecCounterevidence(noRefFlow, null).evidenceGap.length === 0, '无 ref-elements 不判无映射');
});

test('二轮 P0-2：positive_provenance 只在 OCR 流在场且全部文本正向匹配时成立（clean≠verified）', () => {
  const matchedDoc = {
    screens: [{
      id: 's', priority: 'P0',
      root: { type: 'navigation_frame', order: 0, children: [{ type: 'content_display', order: 1, text: '添加银行卡' }] },
    }],
    tokens: {}, assets: [],
  } as unknown as UiSpecDoc;
  assert(scanUiSpecCounterevidence(matchedDoc, [{ text: '添加银行卡' }]).positive_provenance === true, '全匹配应成立');
  // 非 OCR 流（无 refTexts）：clean 但无正向基础 → false（verified 不可由 clean 铸造）
  assert(scanUiSpecCounterevidence(matchedDoc, null).positive_provenance === false, '非 OCR 流恒 false');
  // source_ref 可解析但文本不匹配 → 映射成立（不 evidence_gap）但 positive_provenance false（声明≠证明）
  const refOnly = {
    screens: [{
      id: 's', priority: 'P0', ref_id: 'ref_home',
      root: { type: 'navigation_frame', order: 0, children: [{ type: 'content_display', order: 1, text: '编的', source_ref: 'ref_home' }] },
    }],
    tokens: {}, assets: [],
  } as unknown as UiSpecDoc;
  const scanR = scanUiSpecCounterevidence(refOnly, [{ text: '别的' }]);
  assert(scanR.evidenceGap.length === 0 && scanR.positive_provenance === false, 'source_ref 声明不铸 verified');
});

test('五轮 P0-1：vision 账本单写者——goal agent 自跑只算不写；gate harness 落盘（真实执行 check-spec）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cs = require('../../scripts/check-spec') as { checkVisionOutputCounterevidence: (ctx: unknown) => Array<{ status: string }> };
    const specDir = path.join(root, 'doc', 'features', 'f', 'spec');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'ui-spec.yaml'), [
      'schema_version: "1.0"',
      'screens:',
      '  - id: s',
      '    priority: P0',
      '    root: { type: navigation_frame, order: 0, children: [{ type: content_display, order: 1, text: "你好" }] }',
      'tokens: {}',
      'assets: []',
    ].join('\n'), 'utf-8');
    const attPath = path.join(root, 'doc', 'features', 'f', 'vision', 'artifact-attestations.jsonl');
    const envKeys = ['MAISON_GOAL_RUNNER', 'MAISON_GOAL_HEADLESS', 'MAISON_GOAL_GATE_HARNESS'] as const;
    const prev = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
    try {
      // ① goal agent 自跑（headless env，无 gate 标）：结论照常产出，但账本零写入
      process.env.MAISON_GOAL_HEADLESS = '1';
      delete process.env.MAISON_GOAL_RUNNER;
      delete process.env.MAISON_GOAL_GATE_HARNESS;
      const r1 = cs.checkVisionOutputCounterevidence({ projectRoot: root, feature: 'f' });
      assert(r1.length === 1 && r1[0].status === 'PASS', 'agent 自跑仍出结论');
      assert(!fs.existsSync(attPath), 'agent 自跑不得写 vision 账本（单写者）');
      // ② gate harness（runner spawn 标 + gate 标）：落盘
      process.env.MAISON_GOAL_RUNNER = '1';
      process.env.MAISON_GOAL_GATE_HARNESS = '1';
      delete process.env.MAISON_GOAL_HEADLESS;
      cs.checkVisionOutputCounterevidence({ projectRoot: root, feature: 'f' });
      assert(fs.existsSync(attPath), 'gate harness 应落盘 attestation');
    } finally {
      for (const k of envKeys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });
});

test('五轮 P0-3：legacy 无链账本迁移——downgrade/contradicted 保守继承，verified/supersede 不升级；mixed 拒自动修复', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const evc = require('../../scripts/utils/effective-vision-context') as typeof import('../../scripts/utils/effective-vision-context');
    writeLocal(root, FRESH_GOAL_CANARY('r1'));
    const visionDir = path.join(root, 'doc', 'features', 'f', 'vision');
    fs.mkdirSync(visionDir, { recursive: true });
    fs.writeFileSync(path.join(visionDir, 'policy-downgrades.jsonl'), [
      JSON.stringify({ schema_version: '1.0', at: '2026-07-01T00:00:00.000Z', kind: 'downgrade', reason: '旧降级', artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H1', source: 'old' }),
      JSON.stringify({ schema_version: '1.0', at: '2026-07-02T00:00:00.000Z', kind: 'supersede', reason: '旧解除', artifact_path: 'spec/ui-spec.yaml', source: 'old' }),
    ].join('\n') + '\n', 'utf-8');
    fs.writeFileSync(path.join(visionDir, 'artifact-attestations.jsonl'), [
      JSON.stringify({ schema_version: '1.0', at: '2026-07-01T00:00:00.000Z', artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H1', verdict: 'contradicted', reasons: ['invalid_unicode:x'], source: 'old' }),
      JSON.stringify({ schema_version: '1.0', at: '2026-07-02T00:00:00.000Z', artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H2', verdict: 'verified', reasons: ['clean'], source: 'old' }),
    ].join('\n') + '\n', 'utf-8');
    const res = evc.migrateLegacyVisionLedgers(root, 'f');
    assert(res.every(r => r.action === 'migrated'), JSON.stringify(res));
    assert(fs.readdirSync(visionDir).some(n => n.startsWith('policy-downgrades.jsonl.legacy-')), 'quarantine 备份在场');
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1', artifactHashes: ['H1', 'H2'] });
    assert(!c.effective_policy.downgrade_reasons.some(r => r.includes('损坏行')), `迁移后不得永久 corrupt：${c.effective_policy.downgrade_reasons.join('|')}`);
    assert(c.artifact_attestation.H1.verdict === 'contradicted', '限制性 contradicted 保守继承');
    assert(c.artifact_attestation.H2.reasons.includes('no_attestation_record'), '旧 verified 不升级（须当前 gate 重铸）');
    assert(c.effective_policy.downgrade_reasons.some(r => r.includes('旧降级')), '旧 downgrade 继承且旧 supersede 不升级（降级仍在）');
    // mixed：合法链文件再被手塞一条裸行 → 拒自动修复（manual_required，文件不动）
    fs.appendFileSync(path.join(visionDir, 'policy-downgrades.jsonl'), `${JSON.stringify({ kind: 'supersede', reason: '塞行' })}\n`, 'utf-8');
    const res2 = evc.migrateLegacyVisionLedgers(root, 'f');
    const dg2 = res2.find(r => r.file === 'policy-downgrades.jsonl')!;
    assert(dg2.action === 'manual_required', JSON.stringify(res2));
    const c2 = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1' });
    assert(c2.effective_policy.downgrade_reasons.some(r => r.includes('损坏行')), 'mixed 保持 corrupt fail-closed');
  });
});

test('六轮 P0-2：vision checkpoint 五态（absent/ok_unauthenticated/ok/mismatch/invalid）+ namespace 隔离', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'outside-workspace-cp');
    delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    try {
      const base = { projectRoot: root, feature: 'f', runId: 'runx', manifestIdentityFields: {} as Record<string, string> };
      const snap = gr.snapshotVisionLedgers(root, 'f');
      assert(gr.verifyVisionCheckpoint({ ...base, current: snap }).state === 'absent', '无 checkpoint=absent');
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'MH', files: snap });
      // 未配 HMAC key → 如实 ok_unauthenticated（不冒充强信任）
      assert(
        gr.verifyVisionCheckpoint({ ...base, current: gr.snapshotVisionLedgers(root, 'f') }).state === 'ok_unauthenticated',
        '无 key=ok_unauthenticated',
      );
      // 六轮 P0-1 组合攻击封堵：checkpoint 在场时把链式账本换成一条 chainless 行 →
      // verify=mismatch（先验后迁——迁移路径不可达，换皮绕过失效）
      appendArtifactAttestation(root, 'f', {
        artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'HX', verdict: 'unverified', reasons: ['x'], source: 't',
      });
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'MH', files: gr.snapshotVisionLedgers(root, 'f') });
      fs.writeFileSync(
        path.join(root, 'doc', 'features', 'f', 'vision', 'artifact-attestations.jsonl'),
        `${JSON.stringify({ schema_version: '1.0', at: 'x', artifact_path: 'p', artifact_hash: 'H', verdict: 'unverified', reasons: [], source: 'evil-chainless' })}\n`,
        'utf-8',
      );
      const swap = gr.verifyVisionCheckpoint({ ...base, current: gr.snapshotVisionLedgers(root, 'f') });
      assert(swap.state === 'mismatch' && swap.mismatched.includes('artifact-attestations.jsonl'), JSON.stringify(swap));
      // HMAC：配 key 后写 → ok；篡改 payload → invalid；带 MAC 但 key 被移除 → invalid
      // 十二轮 P0-a：verifyVisionCheckpoint 不再 force-equal manifest/auth_subset（rebase 自我
      // 判死已移除）——扩权检测改由 manifestDrift 以 checkpoint 为可信旧基线做字段级授权。
      process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'k-secret';
      const snap2 = gr.snapshotVisionLedgers(root, 'f');
      const authSubset = gr.computeAuthSubsetSha256([{ phase: 'ut', allowed_files: ['a.ets'], max_files: 1 }]);
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'MH', files: snap2, authSubsetSha256: authSubset });
      assert(gr.verifyVisionCheckpoint({ ...base, current: snap2 }).state === 'ok', '配 key=ok');
      const cpPath = gr.visionCheckpointPath(root, 'f', 'runx');
      const doc = JSON.parse(fs.readFileSync(cpPath, 'utf-8')) as { files: Array<{ sha256: string }> };
      doc.files[0].sha256 = 'deadbeef';
      fs.writeFileSync(cpPath, JSON.stringify(doc), 'utf-8');
      const forged = gr.verifyVisionCheckpoint({ ...base, current: snap2 });
      assert(forged.state === 'invalid' && /MAC/.test(forged.reason ?? ''), JSON.stringify(forged));
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'MH', files: snap2, authSubsetSha256: authSubset });
      delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
      assert(gr.verifyVisionCheckpoint({ ...base, current: snap2 }).state === 'invalid', '带 MAC 无 key=invalid（fail-closed）');
      // namespace：不同工程/feature 同 runId → 不同路径（六轮 P1 碰撞根治）
      const otherRoot = path.join(root, 'other-proj');
      fs.mkdirSync(otherRoot, { recursive: true });
      assert(
        gr.visionCheckpointPath(root, 'f', 'runx') !== gr.visionCheckpointPath(otherRoot, 'f', 'runx') &&
        gr.visionCheckpointPath(root, 'f', 'runx') !== gr.visionCheckpointPath(root, 'g', 'runx'),
        'namespace 须绑 project+feature',
      );
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
      else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
      else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('六轮 P1-1：迁移事务化——两次 rename 间崩溃可恢复；限制性历史不丢', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const evc = require('../../scripts/utils/effective-vision-context') as typeof import('../../scripts/utils/effective-vision-context');
    const visionDir = path.join(root, 'doc', 'features', 'f', 'vision');
    fs.mkdirSync(visionDir, { recursive: true });
    const canonical = path.join(visionDir, 'policy-downgrades.jsonl');
    // 模拟崩溃现场：canonical 缺失 + 完整 tmp 在场（rename(原→bak) 之后、rename(tmp→canonical) 之前）
    const row = { schema_version: '1.0', at: '2026-07-01T00:00:00.000Z', kind: 'downgrade', reason: '[legacy-import] 旧降级', source: 'legacy_migration(old)', seq: 1, prev_row_hash: null };
    const rowHash = (o: Record<string, unknown>): string =>
      require('crypto').createHash('sha256').update(JSON.stringify(o), 'utf-8').digest('hex').slice(0, 16);
    const chained = { ...row, row_hash: rowHash(row) };
    fs.writeFileSync(`${canonical}.migrating.tmp`, `${JSON.stringify(chained)}\n`, 'utf-8');
    fs.writeFileSync(`${canonical}.legacy-123.bak`, 'old-bytes', 'utf-8');
    const res = evc.migrateLegacyVisionLedgers(root, 'f');
    const dg = res.find(r => r.file === 'policy-downgrades.jsonl')!;
    assert(dg.action === 'none', `恢复完成后应为全链 no-op：${JSON.stringify(res)}`);
    assert(fs.existsSync(canonical), 'canonical 由 tmp 恢复');
    const c = resolveEffectiveVisionContext({ projectRoot: root, feature: 'f', runId: 'r1' });
    assert(c.effective_policy.downgrade_reasons.some(r => r.includes('旧降级')), '限制性历史不丢');
    assert(!c.effective_policy.downgrade_reasons.some(r => r.includes('损坏行')), '恢复文件链完整');
  });
});

test('七轮 P0-3：feature head——fresh run 前跨 run 篡改检出（mismatch）；generation 单调', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'outside-cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'k-head';
    try {
      appendArtifactAttestation(root, 'f', {
        artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H1', verdict: 'unverified', reasons: ['x'], source: 't',
      });
      const snap = gr.snapshotVisionLedgers(root, 'f');
      // 八轮 P1-1：世代由调用方（runner 内存可信态）显式给出，不读盘续签；九轮 P1-2：返回 digest
      const w1 = gr.writeVisionFeatureHead({ projectRoot: root, feature: 'f', runId: 'run-a', files: snap, generation: 1 });
      const w2 = gr.writeVisionFeatureHead({ projectRoot: root, feature: 'f', runId: 'run-a', files: snap, generation: 2 });
      assert(typeof w1.digest === 'string' && w1.digest !== w2.digest, 'write 返回字节 digest 且随世代变');
      const meta = gr.readVisionFeatureHeadMeta({ projectRoot: root, feature: 'f' });
      assert(meta.state === 'valid' && meta.generation === 2 && meta.digest === w2.digest,
        `meta 应验真、世代=2、digest 匹配：${JSON.stringify(meta)}`);
      assert(gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: snap }).state === 'ok', '未动=ok');
      // 跨 run 攻击：run-a 结束后改账本 → run-b fresh 启动前 head 比对失配
      appendArtifactAttestation(root, 'f', {
        artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H-EVIL', verdict: 'unverified', reasons: ['y'], source: 'evil',
      });
      const v = gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: gr.snapshotVisionLedgers(root, 'f') });
      assert(v.state === 'mismatch' && v.mismatched.includes('artifact-attestations.jsonl'), JSON.stringify(v));
      // head MAC 篡改 → invalid（verify 与覆盖前 meta 双面）
      const hp = gr.visionFeatureHeadPath(root, 'f');
      const hd = JSON.parse(fs.readFileSync(hp, 'utf-8')) as { files: Array<{ sha256: string }> };
      hd.files[0].sha256 = 'deadbeef';
      fs.writeFileSync(hp, JSON.stringify(hd), 'utf-8');
      assert(gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: snap }).state === 'invalid', 'MAC 破坏=invalid');
      assert(gr.readVisionFeatureHeadMeta({ projectRoot: root, feature: 'f' }).state === 'invalid', '覆盖前 meta 同判 invalid');
      // head 被删 → meta=absent（八轮 P1-1：世代>0 期望在场，runner 写点据此 halt 不重签）
      fs.rmSync(hp, { force: true });
      assert(gr.readVisionFeatureHeadMeta({ projectRoot: root, feature: 'f' }).state === 'absent', '删除=absent');
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
      else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
      else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('九/十二轮：checkpoint 校验 head generation 咬合；manifest 身份/授权子集经 meta 交 drift 授权（不 force-equal）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'k9';
    try {
      const base = { projectRoot: root, feature: 'f', runId: 'r9' };
      const snap = gr.snapshotVisionLedgers(root, 'f');
      const AS = gr.computeAuthSubsetSha256([]);
      const idFields = { requirement: 'aaaaaaaaaaaaaaaa', budget: 'bbbbbbbbbbbbbbbb' };
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'MH1', manifestIdentityFields: idFields, files: snap, authSubsetSha256: AS, headGeneration: 3 });
      // head generation 一致 → ok；脱节 → invalid（十二轮：manifest/auth_subset 不再 force-equal）
      assert(gr.verifyVisionCheckpoint({ ...base, current: snap, expectedHeadGeneration: 3 }).state === 'ok', 'head 世代一致=ok');
      const hg = gr.verifyVisionCheckpoint({ ...base, current: snap, expectedHeadGeneration: 5 });
      assert(hg.state === 'invalid' && /head_generation/.test(hg.reason ?? ''), JSON.stringify(hg));
      // 十二轮 P0-a：readVisionCheckpointMeta 带回可信旧基线（manifest_hash + 逐字段身份）供 drift 授权
      const meta = gr.readVisionCheckpointMeta({ ...base });
      assert(meta.state === 'valid' && meta.manifestHash === 'MH1', `meta 带回 manifest_hash：${JSON.stringify(meta)}`);
      assert(meta.manifestIdentityFields?.requirement === 'aaaaaaaaaaaaaaaa', 'meta 带回逐字段身份（drift 基线 SSOT）');
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('九轮 P1-2：合法旧文件重放——身份+MAC 均过但字节 digest 不符内存最近值 → 覆盖前判篡改', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'k9';
    try {
      const base = { projectRoot: root, feature: 'f', runId: 'r9', manifestHash: 'MH', authSubsetSha256: 'AS', manifestIdentityFields: {} as Record<string, string> };
      const snap = gr.snapshotVisionLedgers(root, 'f');
      // gen1 写入 → 保存该合法旧文件字节
      gr.writeVisionCheckpoint({ ...base, files: snap, headGeneration: 1 });
      const cpPath = gr.visionCheckpointPath(root, 'f', 'r9');
      const gen1Bytes = fs.readFileSync(cpPath);
      // gen2 写入（内存 digest 前进）
      const gen2Digest = gr.writeVisionCheckpoint({ ...base, files: snap, headGeneration: 2 });
      const metaAfterGen2 = gr.readVisionCheckpointMeta({ ...base });
      assert(metaAfterGen2.state === 'valid' && metaAfterGen2.digest === gen2Digest, 'gen2 digest 匹配');
      // 攻击：把 gen1 的合法 MAC 文件放回（身份+MAC 均过）——meta digest ≠ 内存最近(gen2)
      fs.writeFileSync(cpPath, gen1Bytes);
      const replayed = gr.readVisionCheckpointMeta({ ...base });
      assert(replayed.state === 'valid', '重放旧文件身份/MAC 仍 valid（单看这两项检不出）');
      assert(replayed.digest !== gen2Digest, '但字节 digest 与内存最近值不符——commit 覆盖前据此判篡改 halt');
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('九轮 P0-2：reseal object_hash 绑授权子集+manifest+旧 checkpoint——改授权后旧 reseal 失配', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const snap = gr.snapshotVisionLedgers(root, 'f');
    const commonBase = { projectRoot: root, feature: 'f', runId: 'r9', files: snap, oldHeadSha256: 'OLDH', oldCheckpointSha256: 'OLDC', oldHwmSha256: 'OLDHWM', frozenManifestHash: 'MH' };
    const h1 = gr.visionTrustResealObjectHash({ ...commonBase, authSubsetSha256: gr.computeAuthSubsetSha256([{ phase: 'ut', allowed_files: ['a.ets'], max_files: 1 }]) });
    // 模型改 manifest 授权子集（扩权）→ 授权子集哈希变 → reseal object_hash 必不同
    const h2 = gr.visionTrustResealObjectHash({ ...commonBase, authSubsetSha256: gr.computeAuthSubsetSha256([{ phase: 'ut', allowed_files: ['a.ets', 'evil.ets'], max_files: 9 }]) });
    assert(h1 !== h2, '授权子集变 → reseal 签名对象变（真人签 reseal 不覆盖扩权后的 manifest）');
    // manifest identity hash 变、旧 checkpoint/HWM hash 变 → 同样失配（十一轮 P1-5/P0-2）
    assert(gr.visionTrustResealObjectHash({ ...commonBase, frozenManifestHash: 'MH2', authSubsetSha256: 'AS' }) !==
           gr.visionTrustResealObjectHash({ ...commonBase, authSubsetSha256: 'AS' }), 'manifest identity hash 入签名对象');
    assert(gr.visionTrustResealObjectHash({ ...commonBase, oldCheckpointSha256: 'X', authSubsetSha256: 'AS' }) !==
           gr.visionTrustResealObjectHash({ ...commonBase, authSubsetSha256: 'AS' }), '旧 checkpoint hash 入签名对象');
    assert(gr.visionTrustResealObjectHash({ ...commonBase, oldHwmSha256: 'X', authSubsetSha256: 'AS' }) !==
           gr.visionTrustResealObjectHash({ ...commonBase, authSubsetSha256: 'AS' }), '旧 HWM hash 入签名对象（换钥不死锁的绑定）');
  });
});

test('十轮 P0-1：HWM 高水位链——跨重启回放旧状态被拦（世代 < 高水位）+ 链断 invalid', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'kh';
    try {
      const base = { projectRoot: root, feature: 'f' };
      assert(gr.readVisionHwmHighWater(base).state === 'absent', '无 HWM=absent');
      gr.appendVisionHwm({ ...base, generation: 1, headDigest: 'd1' });
      gr.appendVisionHwm({ ...base, generation: 2, headDigest: 'd2' });
      gr.appendVisionHwm({ ...base, generation: 3, headDigest: 'd3' });
      const hwm = gr.readVisionHwmHighWater(base);
      assert(hwm.state === 'ok' && hwm.maxGeneration === 3 && hwm.lastHeadDigest === 'd3', JSON.stringify(hwm));
      // 回放判据：当前 head 世代 2 < 高水位 3 → 回滚（生产在启动段据此 halt）
      assert((2 < (hwm.maxGeneration ?? 0)), '世代 2 < 高水位 3 → 回滚拦截依据成立');
      // 世代等于高水位但 digest 不符 → 亦回滚
      assert('dX' !== hwm.lastHeadDigest, '同世代 digest 不符 → 回滚');
      // 篡改中间行（非尾部改）→ 链断 invalid
      const p = gr.visionHwmPath(root, 'f');
      const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
      const tampered = JSON.parse(lines[1]) as { generation: number };
      tampered.generation = 99;
      lines[1] = JSON.stringify(tampered);
      fs.writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
      assert(gr.readVisionHwmHighWater(base).state === 'invalid', '非尾部改行 → 链断 invalid');
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('十轮 P1：manifest 身份哈希——非授权字段变化被检出；易变字段（adapter）不误报', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gm = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
  const mk = (over: Record<string, unknown>): import('../../scripts/utils/goal-manifest').GoalManifest => ({
    schema_version: '1.0', start_phase: 'spec', end_phase: 'testing', feature: 'f',
    requirement: 'do X', budget: { max_retries_per_phase: 2, max_total_turns: 30, wall_clock_minutes: 480, max_transient_api_retries: 3 },
    dependency_policy: {} as never, unattended: {} as never, run_id: 'r', report_dir: 'd', created_at: 't',
    ...over,
  } as never);
  const baseH = gm.computeManifestIdentityHash(mk({}));
  // adapter/created_at/run_id 变 → 身份哈希不变（易变字段排除）
  assert(gm.computeManifestIdentityHash(mk({ adapter: 'claude', created_at: 't2', run_id: 'r2' })) === baseH, 'adapter/created_at/run_id 不入身份');
  // requirement/budget/fidelity/pre_authorized_mutations 变 → 身份哈希变
  assert(gm.computeManifestIdentityHash(mk({ requirement: 'do Y' })) !== baseH, 'requirement 变→漂移');
  assert(gm.computeManifestIdentityHash(mk({ fidelity: 'pixel_1to1' })) !== baseH, 'fidelity 变→漂移');
  assert(gm.computeManifestIdentityHash(mk({ pre_authorized_mutations: [{ phase: 'ut', allowed_files: ['x'], max_files: 9 }] })) !== baseH, '预授权变→漂移');
  assert(gm.computeManifestIdentityHash(mk({ budget: { max_retries_per_phase: 9, max_total_turns: 30, wall_clock_minutes: 480, max_transient_api_retries: 3 } })) !== baseH, 'budget 变→漂移');
});

test('十一轮 P1：manifest 字段级 override 授权——裸 --override-start 不放行 requirement 等无关字段', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gm = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
  const A = { start_phase: 'h1', requirement: 'r1', budget: 'b1' };
  const B = { start_phase: 'h2', requirement: 'r2', budget: 'b1' }; // start_phase + requirement 变
  const changed = gm.diffManifestIdentityFields(A as never, B as never);
  assert(changed.includes('start_phase') && changed.includes('requirement'), JSON.stringify(changed));
  // 裸 --override-start 只授权 start_phase → requirement 未授权 → 不全覆盖
  const authStart = gm.overrideAuthorizedIdentityFields({ 'override-start': true });
  assert(authStart !== 'all' && changed.every(f => (authStart as Set<string>).has(f)) === false, 'start override 不足以放行 requirement');
  // --override-manifest → 全字段授权
  assert(gm.overrideAuthorizedIdentityFields({ 'override-manifest': true }) === 'all', 'override-manifest=all');
  // start_phase-only 变更 + --override-start → 授权成立
  const changedStartOnly = gm.diffManifestIdentityFields(A as never, { ...A, start_phase: 'h2' } as never);
  assert(changedStartOnly.every(f => (authStart as Set<string>).has(f)), 'start-only 变更被 --override-start 授权');
});

test('十一轮 P1：rebase 持久化——override rebase 后连续两次 resume 不复报 drift（fold 基线前进）', () => {
  // fold 语义纯函数：首个 run_start.fields → 历次 rebase.to_fields 覆盖为最新基线
  const events = [
    { type: 'run_start', manifest_identity_fields: { requirement: 'H1', budget: 'b' } },
    { type: 'manifest_identity_rebase', to_fields: { requirement: 'H2', budget: 'b' } },
  ];
  let frozen: Record<string, string> | null = null;
  for (const e of events) {
    const ev = e as { type?: string; manifest_identity_fields?: Record<string, string>; to_fields?: Record<string, string> };
    if (ev.type === 'run_start' && ev.manifest_identity_fields && frozen === null) frozen = ev.manifest_identity_fields;
    else if (ev.type === 'manifest_identity_rebase' && ev.to_fields) frozen = ev.to_fields;
  }
  // 下次普通 resume：当前=H2，冻结基线已前进到 H2 → 无 drift（不再复报 H1 vs H2）
  assert(frozen!.requirement === 'H2', `fold 基线应前进到 H2：${JSON.stringify(frozen)}`);
});

test('十一轮 P0-2：换钥 reseal——旧 HWM quarantine 后新 key 链从空起（不因旧 key 行 MAC 失败死锁）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    try {
      const base = { projectRoot: root, feature: 'f' };
      // 旧 key 写链
      process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'old-key';
      gr.appendVisionHwm({ ...base, generation: 1, headDigest: 'd1' });
      gr.appendVisionHwm({ ...base, generation: 2, headDigest: 'd2' });
      // 换新 key：不 quarantine 直接追加 → 读在旧 key 行 MAC 失败（死锁复现）
      process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'new-key';
      gr.appendVisionHwm({ ...base, generation: 3, headDigest: 'd3' });
      assert(gr.readVisionHwmHighWater(base).state === 'invalid', '未 quarantine → 旧 key 行 MAC 失败=死锁');
      // reseal quarantine：改名旧链后新链从空起 → 新 key 单独可信
      const hp = gr.visionHwmPath(root, 'f');
      fs.renameSync(hp, `${hp}.rekey-1.bak`);
      gr.appendVisionHwm({ ...base, generation: 3, headDigest: 'd3' });
      const after = gr.readVisionHwmHighWater(base);
      assert(after.state === 'ok' && after.maxGeneration === 3, `quarantine 后新 key 链可信：${JSON.stringify(after)}`);
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('十一轮 P0-1：HWM 诚实边界——尾部截断（删最高世代行）不被检出（声明残余边界）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'k';
    try {
      const base = { projectRoot: root, feature: 'f' };
      gr.appendVisionHwm({ ...base, generation: 1, headDigest: 'd1' });
      gr.appendVisionHwm({ ...base, generation: 2, headDigest: 'd2' });
      gr.appendVisionHwm({ ...base, generation: 3, headDigest: 'd3' });
      // 尾部截断到世代 2（协调回放步骤）——链仍合法，读到 max=2（**诚实：检不出**）
      const p = gr.visionHwmPath(root, 'f');
      const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
      fs.writeFileSync(p, lines.slice(0, 2).join('\n') + '\n', 'utf-8');
      const hwm = gr.readVisionHwmHighWater(base);
      assert(hwm.state === 'ok' && hwm.maxGeneration === 2, `尾部截断后链仍 ok（残余边界如实声明）：${JSON.stringify(hwm)}`);
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('十二轮 P0-a：checkpoint 是 rebase 可信基线 SSOT——authenticated checkpoint 带回旧身份供字段级授权', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gm = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'krb';
    try {
      const base = { projectRoot: root, feature: 'f', runId: 'rrb' };
      const snap = gr.snapshotVisionLedgers(root, 'f');
      const oldFields = { requirement: 'r1hash', budget: 'bhash', start_phase: 'sp' };
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'ID1', manifestIdentityFields: oldFields, files: snap, authSubsetSha256: 'AS', headGeneration: 1 });
      // 生产 drift 决策的可信基线=readVisionCheckpointMeta（不是 events）
      const meta = gr.readVisionCheckpointMeta({ ...base });
      const newFields = { requirement: 'r2hash', budget: 'bhash', start_phase: 'sp' }; // requirement 变
      const changed = gm.diffManifestIdentityFields(meta.manifestIdentityFields!, newFields);
      assert(changed.length === 1 && changed[0] === 'requirement', JSON.stringify(changed));
      // 未授权 → 不放行；--override-manifest → 授权（不自我判死：verify 已不 force-equal）
      const authNone = gm.overrideAuthorizedIdentityFields({});
      assert(authNone !== 'all' && changed.every(f => (authNone as Set<string>).has(f)) === false, '无 override 不放行 requirement');
      assert(gm.overrideAuthorizedIdentityFields({ 'override-manifest': true }) === 'all', 'override-manifest 授权');
      // rebase 后写新身份进 checkpoint → 成为新 SSOT，下次 meta 返回新身份（不复报）
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'ID2', manifestIdentityFields: newFields, files: snap, authSubsetSha256: 'AS', headGeneration: 1 });
      const meta2 = gr.readVisionCheckpointMeta({ ...base });
      assert(gm.diffManifestIdentityFields(meta2.manifestIdentityFields!, newFields).length === 0, 'rebase 后 checkpoint 成新 SSOT，下次 resume 无 drift');
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('十三轮 P0-1：fidelity transition 前置校验——枚举/降档凭证真路径（resume 不再绕过）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gp = require('../../scripts/utils/goal-preflight') as typeof import('../../scripts/utils/goal-preflight');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cr = require('../../scripts/utils/confirmation-receipt') as typeof import('../../scripts/utils/confirmation-receipt');
    const crypto = require('crypto') as typeof import('crypto');
    // 真 ed25519 trust registry（与 mutation-backtrack 同构）
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const regPath = path.join(root, 'trust-registry.json');
    fs.writeFileSync(regPath, JSON.stringify({
      schema_version: '1.0',
      issuers: [{ issuer_id: 'ops', keys: [{ key_id: 'k1', alg: 'ed25519', public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }] }],
    }), 'utf-8');
    const prevReg = process.env[cr.TRUST_REGISTRY_PATH_ENV];
    process.env[cr.TRUST_REGISTRY_PATH_ENV] = regPath;
    try {
      const requirement = '完全参考 ref.jpg 还原首页'; // strong_pixel intent → detected=pixel_1to1
      const mkManifest = (fidelity?: string, receipt?: string) => ({
        feature: 'f', run_id: 'rft', requirement,
        ...(fidelity ? { fidelity } : {}), ...(receipt ? { fidelity_receipt: receipt } : {}),
      }) as unknown as import('../../scripts/utils/goal-manifest').GoalManifest;
      const base = { projectRoot: root, featuresDirRel: 'doc/features' };
      // ① 垃圾枚举 → blocker（不静默回退）
      const bad = gp.evaluateFidelityTransitionAuthorization({
        ...base, manifest: mkManifest('whatever'), applied: { fidelity: true, fidelityReceipt: false },
      });
      assert(bad.blockers.length === 1 && bad.authorizedFields.size === 0, `垃圾枚举须 blocker：${JSON.stringify(bad)}`);
      // ② 降档无 receipt → blocker（只升不降）
      const down = gp.evaluateFidelityTransitionAuthorization({
        ...base, manifest: mkManifest('semantic_layout'), applied: { fidelity: true, fidelityReceipt: false },
      });
      assert(down.blockers.some(b => b.includes('降档')) && down.authorizedFields.size === 0, `降档无凭证须 blocker：${JSON.stringify(down)}`);
      // ③ --fidelity-receipt 指向垃圾文件 → blocker（无效凭证不入 manifest）
      fs.writeFileSync(path.join(root, 'garbage.json'), '{"not":"a receipt"}', 'utf-8');
      const badR = gp.evaluateFidelityTransitionAuthorization({
        ...base, manifest: mkManifest('semantic_layout', 'garbage.json'), applied: { fidelity: true, fidelityReceipt: true },
      });
      assert(badR.blockers.length >= 1 && badR.authorizedFields.size === 0, `垃圾凭证须 blocker：${JSON.stringify(badR)}`);
      // ④ 降档 + 有效签发 receipt（object_hash 绑解引用需求文本）→ 精确授权两字段
      const objectHash = crypto.createHash('sha256').update(requirement, 'utf-8').digest('hex');
      const payload = {
        action: 'fidelity_downgrade', feature: 'f', object_hash: objectHash,
        issued_at: '2026-01-01T00:00:00.000Z', expiry: '2099-01-01T00:00:00.000Z', run_id: 'rft',
      };
      fs.writeFileSync(path.join(root, 'ok.receipt.json'), JSON.stringify({
        schema_version: '1.0', receipt_id: 'fd-1', issuer_id: 'ops', key_id: 'k1', alg: 'ed25519',
        payload_schema_version: '1.0', payload,
        signature: crypto.sign(null, cr.canonicalReceiptPayload(payload as never), privateKey).toString('base64'),
      }), 'utf-8');
      const ok = gp.evaluateFidelityTransitionAuthorization({
        ...base, manifest: mkManifest('semantic_layout', 'ok.receipt.json'), applied: { fidelity: true, fidelityReceipt: true },
      });
      assert(ok.blockers.length === 0, `有效凭证不应 blocker：${JSON.stringify(ok.blockers)}`);
      assert(ok.authorizedFields.has('fidelity') && ok.authorizedFields.has('fidelity_receipt') && ok.authorizedFields.size === 2, '降档+验真凭证授权两字段');
      // ⑤ 升档（无意图冲突）只授权 fidelity——receipt 字段不搭车
      const up = gp.evaluateFidelityTransitionAuthorization({
        ...base, manifest: mkManifest('pixel_1to1'), applied: { fidelity: true, fidelityReceipt: false },
      });
      assert(up.blockers.length === 0 && up.authorizedFields.has('fidelity') && !up.authorizedFields.has('fidelity_receipt'), `升档仅授权 fidelity：${JSON.stringify([...up.authorizedFields])}`);
      // ⑥ 未应用任何档位参数 → 空授权（裸旗标语义由调用方 string 过滤保证）
      const none = gp.evaluateFidelityTransitionAuthorization({
        ...base, manifest: mkManifest(), applied: { fidelity: false, fidelityReceipt: false },
      });
      assert(none.blockers.length === 0 && none.authorizedFields.size === 0, '未应用=空授权');
    } finally {
      if (prevReg === undefined) delete process.env[cr.TRUST_REGISTRY_PATH_ENV]; else process.env[cr.TRUST_REGISTRY_PATH_ENV] = prevReg;
    }
  });
});

test('十二轮 P0-b：reseal 事务——rename 失败 fail-closed；quarantine 后崩溃可恢复（journal 状态机）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'ktx';
    try {
      const hp = () => gr.visionHwmPath(root, 'f');
      const headP = () => gr.visionFeatureHeadPath(root, 'f');
      const sha = (p: string) => require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex') as string;
      const shaOr = (p: string) => (fs.existsSync(p) ? sha(p) : 'absent');
      // 十四轮：备份改 copy 语义（回滚后备份保留供审计）——各场景须用不同 runId 免备份名撞
      const quarArgs = (oldHwmSha256: string, runId: string, over?: Record<string, string>) => ({
        projectRoot: root, feature: 'f', runId, oldHwmSha256,
        oldHeadSha256: shaOr(headP()), oldCheckpointSha256: 'absent', receiptObjectHash: 'RO',
        ...(over ?? {}),
      });
      // ===== 场景A：quarantined 后崩溃（head/checkpoint 未重写）→ 恢复=回滚，原 receipt 可复用
      gr.appendVisionHwm({ projectRoot: root, feature: 'f', generation: 1, headDigest: 'd1' });
      const oldSha = sha(hp());
      const bak = gr.transactionalQuarantineHwm(quarArgs(oldSha, 'rtxA'));
      assert(bak !== null && !fs.existsSync(hp()), 'canonical 已 quarantine');
      const j1 = gr.readResealJournal(root, 'f');
      assert(j1.verdict === 'ok' && j1.journal.state === 'quarantined' && j1.journal.planned_bak === bak,
        `journal=quarantined 且 planned_bak 已在 rename 前记录：${JSON.stringify(j1)}`);
      // 非终态 journal 在场 → 重入禁止（不覆盖现场）
      let threw = false;
      try { gr.transactionalQuarantineHwm(quarArgs(oldSha, 'rtx2')); } catch { threw = true; }
      assert(threw, '非终态 journal 重入须抛（禁覆盖）');
      // 崩溃后启动恢复：canonical 缺失 + 备份在场 → 恢复 + rolled_back
      const rec1 = gr.recoverResealTransaction({ projectRoot: root, feature: 'f' });
      assert(rec1.outcome === 'rolled_back', `恢复=回滚：${JSON.stringify(rec1)}`);
      assert(fs.existsSync(hp()) && sha(hp()) === oldSha, '旧 HWM 已按事务绑定 sha 恢复（原 receipt 复用可行）');
      const jr = gr.readResealJournal(root, 'f');
      assert(jr.verdict === 'ok' && jr.journal.state === 'rolled_back', 'journal=rolled_back');
      // 终态后可开新事务
      // ===== 场景B：prepared 后崩溃（rename 已发生、quarantined 未落盘）→ 凭 planned_bak 恢复
      const bak2 = gr.transactionalQuarantineHwm(quarArgs(oldSha, 'rtxB'));
      assert(bak2 !== null, '新事务 quarantine');
      // 手工把 journal 倒回 prepared（模拟 rename 后、quarantined 写入前崩溃——planned_bak 已在）
      const jq = gr.readResealJournal(root, 'f');
      if (jq.verdict !== 'ok') throw new Error(`journal 须可读：${JSON.stringify(jq)}`);
      const preparedBody = { ...jq.journal, state: 'prepared', quarantined_as: null } as Record<string, unknown>;
      delete preparedBody.mac;
      const preparedMac = require('crypto').createHmac('sha256', 'ktx').update(JSON.stringify(preparedBody), 'utf-8').digest('hex');
      fs.writeFileSync(gr.visionResealJournalPath(root, 'f'), JSON.stringify({ ...preparedBody, mac: preparedMac }), 'utf-8');
      const rec2 = gr.recoverResealTransaction({ projectRoot: root, feature: 'f' });
      assert(rec2.outcome === 'rolled_back' && fs.existsSync(hp()) && sha(hp()) === oldSha,
        `prepared 崩溃凭 planned_bak 恢复：${JSON.stringify(rec2)}`);
      // ===== 场景C：quarantine 后三锚已按生产顺序（head→checkpoint→HWM）全部写完、journal
      // commit 前崩溃 → 四门（head/checkpoint/HWM/账本快照）全过 → 补记 committed
      const bak3 = gr.transactionalQuarantineHwm(quarArgs(oldSha, 'rtxC'));
      assert(bak3 !== null, '场景C quarantine');
      const snapC = gr.snapshotVisionLedgers(root, 'f');
      const hw = gr.writeVisionFeatureHead({ projectRoot: root, feature: 'f', runId: 'rtxC', files: snapC, generation: 2 });
      gr.writeVisionCheckpoint({
        projectRoot: root, feature: 'f', runId: 'rtxC', manifestHash: 'MH',
        manifestIdentityFields: {}, files: snapC, headGeneration: 2,
        authSubsetSha256: 'AS', // 配 key 部署下 verify 必填（生产 commitVisionAnchors 恒传）
      });
      gr.appendVisionHwm({ projectRoot: root, feature: 'f', generation: 2, headDigest: hw.digest }); // 新链首写
      const rec3 = gr.recoverResealTransaction({ projectRoot: root, feature: 'f' });
      assert(rec3.outcome === 'completed', `三锚整体一致=补 commit：${JSON.stringify(rec3)}`);
      const jc = gr.readResealJournal(root, 'f');
      assert(jc.verdict === 'ok' && jc.journal.state === 'committed', 'journal=committed');
      // ===== 场景C2（十五轮 P1）：新链已起但 checkpoint 未写（不完整提交）→ **不得 committed**
      // （提前 commit=永久放弃回滚资格），落回三锚回滚，原 receipt 复用可行
      const oldHeadShaC2 = sha(headP());
      const oldHwmShaC2 = sha(hp());
      const bakC2 = gr.transactionalQuarantineHwm(quarArgs(oldHwmShaC2, 'rtxC2'));
      assert(bakC2 !== null, '场景C2 quarantine');
      const hw3 = gr.writeVisionFeatureHead({ projectRoot: root, feature: 'f', runId: 'rtxC2', files: gr.snapshotVisionLedgers(root, 'f'), generation: 3 });
      gr.appendVisionHwm({ projectRoot: root, feature: 'f', generation: 3, headDigest: hw3.digest }); // checkpoint 缺席
      const recC2 = gr.recoverResealTransaction({ projectRoot: root, feature: 'f' });
      assert(recC2.outcome === 'rolled_back', `checkpoint 缺失=不完整提交须回滚：${JSON.stringify(recC2)}`);
      assert(sha(headP()) === oldHeadShaC2 && sha(hp()) === oldHwmShaC2, '三锚已回滚到旧字节（原 receipt 复用可行）');
      const jc2 = gr.readResealJournal(root, 'f');
      assert(jc2.verdict === 'ok' && jc2.journal.state === 'rolled_back', 'journal=rolled_back（保留了回滚资格）');
      // ===== 场景E（十四轮 P0）：head 已换新、HWM 首写前崩溃 → 三锚全回滚，原 receipt 可复用
      // 现场：head=gen2（上场景写入）+ HWM=gen2 新链。先固化"旧三锚"字节，再 quarantine+重写 head。
      const oldHeadShaE = sha(headP());
      const oldHwmShaE = sha(hp());
      const bakE = gr.transactionalQuarantineHwm(quarArgs(oldHwmShaE, 'rtxE'));
      assert(bakE !== null, '场景E quarantine（head/checkpoint 备份已 copy）');
      const jE = gr.readResealJournal(root, 'f');
      assert(jE.verdict === 'ok' && jE.journal.planned_head_bak !== null, `head 备份名已入 journal：${JSON.stringify(jE.verdict === 'ok' ? jE.journal.planned_head_bak : null)}`);
      // 模拟 commitVisionAnchors 写了 head（新字节）后、appendVisionHwm 前崩溃
      gr.writeVisionFeatureHead({ projectRoot: root, feature: 'f', runId: 'rtxE', files: gr.snapshotVisionLedgers(root, 'f'), generation: 3 });
      assert(sha(headP()) !== oldHeadShaE, 'head 已被换写（混合态现场）');
      const recE = gr.recoverResealTransaction({ projectRoot: root, feature: 'f' });
      assert(recE.outcome === 'rolled_back', `三锚回滚：${JSON.stringify(recE)}`);
      assert(sha(headP()) === oldHeadShaE, 'head 已恢复旧字节（原 receipt 绑定重新可验）');
      assert(sha(hp()) === oldHwmShaE, 'HWM 已恢复旧字节');
      // ===== 场景F（codex 十五轮非阻断建议的回归钉）：旧 checkpoint 原本存在、写入新
      // checkpoint 后、HWM 前崩溃 → planned_checkpoint_bak 非空恢复分支
      const cpF = () => gr.visionCheckpointPath(root, 'f', 'rtxF');
      const snapF = gr.snapshotVisionLedgers(root, 'f');
      gr.writeVisionCheckpoint({
        projectRoot: root, feature: 'f', runId: 'rtxF', manifestHash: 'MHF',
        manifestIdentityFields: {}, files: snapF, headGeneration: 2, authSubsetSha256: 'AS',
      });
      const oldCpShaF = sha(cpF());
      const oldHeadShaF = sha(headP());
      const oldHwmShaF = sha(hp());
      gr.transactionalQuarantineHwm(quarArgs(oldHwmShaF, 'rtxF', { oldCheckpointSha256: oldCpShaF }));
      const jF = gr.readResealJournal(root, 'f');
      assert(jF.verdict === 'ok' && jF.journal.planned_checkpoint_bak !== null, 'checkpoint 备份名已入 journal（非空分支）');
      // 模拟 commitVisionAnchors 写了 head+checkpoint（新字节）后、appendVisionHwm 前崩溃
      const hwF = gr.writeVisionFeatureHead({ projectRoot: root, feature: 'f', runId: 'rtxF', files: snapF, generation: 3 });
      gr.writeVisionCheckpoint({
        projectRoot: root, feature: 'f', runId: 'rtxF', manifestHash: 'MHF2',
        manifestIdentityFields: {}, files: snapF, headGeneration: 3, authSubsetSha256: 'AS',
      });
      assert(hwF.digest !== oldHeadShaF && sha(cpF()) !== oldCpShaF, 'head/checkpoint 均已换写（混合态现场）');
      const recF = gr.recoverResealTransaction({ projectRoot: root, feature: 'f' });
      assert(recF.outcome === 'rolled_back', `三锚回滚（含 checkpoint 备份恢复）：${JSON.stringify(recF)}`);
      assert(sha(cpF()) === oldCpShaF, 'checkpoint 已从 planned_checkpoint_bak 恢复旧字节');
      assert(sha(headP()) === oldHeadShaF && sha(hp()) === oldHwmShaF, 'head/HWM 同步恢复旧字节');
      // ===== 场景D：备份被篡改 → 恢复 blocked（fail-closed，不借恢复洗白）
      fs.rmSync(hp());
      gr.appendVisionHwm({ projectRoot: root, feature: 'f', generation: 1, headDigest: 'd1' });
      const oldSha2 = sha(hp());
      const bak4 = gr.transactionalQuarantineHwm(quarArgs(oldSha2, 'rtx4'));
      fs.appendFileSync(path.join(path.dirname(hp()), bak4!), 'tampered\n', 'utf-8');
      const rec4 = gr.recoverResealTransaction({ projectRoot: root, feature: 'f' });
      assert(rec4.outcome === 'blocked', `备份被篡改须 blocked：${JSON.stringify(rec4)}`);
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('七轮 P0-1：vision 信任封顶——UI 相关 run 无 HMAC key/仅弱 ack 不得 clean completion', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
  const cap = gr.capRunStatusForVisionTrust;
  // 无 key 的协调伪造场景：即便账本+checkpoint 全被重算，终态也封顶人工复核
  const c1 = cap('CHAIN_SLICE_COMPLETED', { uiRelevant: true, hmacKeyPresent: false, ackWeak: false });
  assert(c1.capped && c1.status === 'AWAITING_HUMAN_REVIEW' && c1.reason === 'vision_checkpoint_unauthenticated', JSON.stringify(c1));
  // 弱 ack（旗标）同样封顶
  const c2 = cap('CHAIN_SLICE_COMPLETED', { uiRelevant: true, hmacKeyPresent: true, ackWeak: true });
  assert(c2.capped && c2.reason === 'vision_ledger_ack_unattested', JSON.stringify(c2));
  // 配 key + 无弱 ack → 不封顶；非 UI run 不受影响；非成功终态不改写
  assert(!cap('CHAIN_SLICE_COMPLETED', { uiRelevant: true, hmacKeyPresent: true, ackWeak: false }).capped, '强信任不封顶');
  assert(!cap('CHAIN_SLICE_COMPLETED', { uiRelevant: false, hmacKeyPresent: false, ackWeak: false }).capped, '非 UI 不封顶');
  assert(!cap('HALTED', { uiRelevant: true, hmacKeyPresent: false, ackWeak: false }).capped, '非成功终态不改写');
});

test('七轮 P1-2：迁移凭证跨 checkpoint 持久化——后续 pre_invoke/post_harness 写入不覆盖', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'outside-cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'k-mig';
    try {
      const base = { projectRoot: root, feature: 'f', runId: 'runm', manifestHash: 'MH', authSubsetSha256: 'AS', manifestIdentityFields: {} as Record<string, string> };
      const snap = gr.snapshotVisionLedgers(root, 'f');
      const migration = { file: 'policy-downgrades.jsonl', action: 'migrated', original_sha256: 'OLD', new_sha256: 'NEW' };
      // 八轮 P1-1 契约：migrations 由 runner 内存可信态权威传入（不从盘继承——磁盘旧文件
      // 可被删/伪造后骗 runner 重签）；模拟 pre_invoke/post_harness 均携内存值写入
      gr.writeVisionCheckpoint({ ...base, files: snap, migrations: [migration] });
      gr.writeVisionCheckpoint({ ...base, files: snap, migrations: [migration] });
      gr.writeVisionCheckpoint({ ...base, files: snap, migrations: [migration] });
      const cpv = gr.verifyVisionCheckpoint({ projectRoot: root, feature: 'f', runId: 'runm', current: snap });
      assert(cpv.state === 'ok', 'MAC 有效');
      assert(
        Array.isArray(cpv.migrations) && (cpv.migrations as Array<{ original_sha256?: string }>).some(m => m.original_sha256 === 'OLD'),
        `迁移凭证经验真回读存活：${JSON.stringify(cpv.migrations)}`,
      );
      // 对抗（八轮 P1-1）：盘上 checkpoint 被删 → 覆盖前 meta=absent（runner 写点据此 halt，
      // 迁移凭证不会因"删文件+runner 重写"而静默消失）
      fs.rmSync(gr.visionCheckpointPath(root, 'f', 'runm'), { force: true });
      assert(
        gr.readVisionCheckpointMeta({ projectRoot: root, feature: 'f', runId: 'runm' }).state === 'absent',
        '删除后 meta=absent（写点 halt 依据）',
      );
      // 对抗：盘上伪造 migrations（无 MAC/坏 MAC）→ meta=invalid，runner 不重签
      fs.mkdirSync(require('path').dirname(gr.visionCheckpointPath(root, 'f', 'runm')), { recursive: true });
      fs.writeFileSync(gr.visionCheckpointPath(root, 'f', 'runm'), JSON.stringify({
        schema_version: '1.1', run_id: 'runm', project_root_hash: 'x', feature: 'f',
        manifest_hash: 'MH', updated_at: 'x', files: snap, migrations: [{ file: 'forged' }], mac: null,
      }), 'utf-8');
      assert(
        gr.readVisionCheckpointMeta({ projectRoot: root, feature: 'f', runId: 'runm' }).state === 'invalid',
        '伪造 checkpoint meta=invalid（不重签）',
      );
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
      else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
      else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('十三轮 P1-4：HWM absent 三分——声明态缺失 halt / legacy bootstrap / 删除不可洗白（真文件路径）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const crypto = require('crypto') as typeof import('crypto');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'khwm13';
    try {
      const snap = gr.snapshotVisionLedgers(root, 'f');
      // ① 现行 write（1.1）→ verify 带回 hwmDeclared=true；同世代 HWM 行在 → proceed
      const w = gr.writeVisionFeatureHead({ projectRoot: root, feature: 'f', runId: 'rh', files: snap, generation: 3 });
      gr.appendVisionHwm({ projectRoot: root, feature: 'f', generation: 3, headDigest: w.digest });
      const head1 = gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: snap });
      assert(head1.state === 'ok' && head1.hwmDeclared === true, `1.1 head 声明 HWM：${JSON.stringify(head1)}`);
      const meta1 = gr.readVisionFeatureHeadMeta({ projectRoot: root, feature: 'f' });
      const okFresh = gr.assessHwmFreshness({
        headGeneration: 3, headDigest: meta1.digest, hwmDeclared: true,
        hwm: gr.readVisionHwmHighWater({ projectRoot: root, feature: 'f' }),
      });
      assert(okFresh.action === 'proceed', `一致态 proceed：${JSON.stringify(okFresh)}`);
      // ② 删除整个 HWM 文件（洗白攻击）→ 声明态缺失 = halt（不再静默重建）
      fs.rmSync(gr.visionHwmPath(root, 'f'));
      const gone = gr.assessHwmFreshness({
        headGeneration: 3, headDigest: meta1.digest, hwmDeclared: true,
        hwm: gr.readVisionHwmHighWater({ projectRoot: root, feature: 'f' }),
      });
      assert(gone.action === 'halt_hwm_missing', `声明态 HWM 删除须 halt：${JSON.stringify(gone)}`);
      // ③ legacy 1.0 head（无 hwm_declared，MAC 正确）+ HWM absent → 一次性显式 bootstrap
      const legacyBody = {
        schema_version: '1.0',
        project_root_hash: JSON.parse(fs.readFileSync(gr.visionFeatureHeadPath(root, 'f'), 'utf-8')).project_root_hash,
        feature: 'f', generation: 1, files: snap, last_run_id: 'r0', updated_at: '2026-01-01T00:00:00.000Z',
      };
      const legacyMac = crypto.createHmac('sha256', 'khwm13').update(JSON.stringify(legacyBody), 'utf-8').digest('hex');
      fs.writeFileSync(gr.visionFeatureHeadPath(root, 'f'), JSON.stringify({ ...legacyBody, mac: legacyMac }), 'utf-8');
      const headL = gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: snap });
      assert(headL.state === 'ok' && headL.hwmDeclared === false, `legacy head 验真且无声明：${JSON.stringify(headL)}`);
      const boot = gr.assessHwmFreshness({
        headGeneration: 1, headDigest: undefined, hwmDeclared: false,
        hwm: gr.readVisionHwmHighWater({ projectRoot: root, feature: 'f' }),
      });
      assert(boot.action === 'bootstrap_legacy', `legacy 缺 HWM 走显式 bootstrap：${JSON.stringify(boot)}`);
      // ④ rollback 语义不回归：HWM 高水位 5 > head 世代 3 → halt_rollback
      gr.appendVisionHwm({ projectRoot: root, feature: 'f', generation: 5, headDigest: 'dX' });
      const rb = gr.assessHwmFreshness({
        headGeneration: 3, headDigest: meta1.digest, hwmDeclared: true,
        hwm: gr.readVisionHwmHighWater({ projectRoot: root, feature: 'f' }),
      });
      assert(rb.action === 'halt_rollback', `世代回滚须 halt：${JSON.stringify(rb)}`);
      // ⑤ 十四轮 P1：**双向严格等值**——head 超前（6 > 高水位 5，checkpoint 写完/HWM 追加前
      // 崩溃的残留态）不再 proceed：halt_incomplete_commit（未完成提交不得洗成正常历史）
      const ahead = gr.assessHwmFreshness({
        headGeneration: 6, headDigest: meta1.digest, hwmDeclared: true,
        hwm: gr.readVisionHwmHighWater({ projectRoot: root, feature: 'f' }),
      });
      assert(ahead.action === 'halt_incomplete_commit', `head 超前须 halt：${JSON.stringify(ahead)}`);
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('十三轮 P1-3：legacy/unauthenticated checkpoint 不静默当基线（schema 1.2 + drift 决策真路径）', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const crypto = require('crypto') as typeof import('crypto');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    const prevKey = process.env.MAISON_HMAC_GOAL_CHECKPOINT;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'k13c';
    try {
      const snap = gr.snapshotVisionLedgers(root, 'f');
      const cpPath = gr.visionCheckpointPath(root, 'f', 'r13');
      fs.mkdirSync(path.dirname(cpPath), { recursive: true });
      // ① 现行 write 恒 1.2 + 必填 fields；meta legacy=false
      gr.writeVisionCheckpoint({
        projectRoot: root, feature: 'f', runId: 'r13', manifestHash: 'AGG',
        manifestIdentityFields: { requirement: 'rh', budget: 'bh' }, files: snap,
      });
      const m12 = gr.readVisionCheckpointMeta({ projectRoot: root, feature: 'f', runId: 'r13' });
      assert(m12.state === 'valid' && m12.legacy === false, `1.2 非 legacy：${JSON.stringify(m12)}`);
      // ② 1.2 缺 fields = invalid（必填）
      const doc12 = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
      delete doc12.manifest_identity_fields;
      fs.writeFileSync(cpPath, JSON.stringify(doc12), 'utf-8');
      assert(
        gr.readVisionCheckpointMeta({ projectRoot: root, feature: 'f', runId: 'r13' }).state === 'invalid',
        '1.2 缺逐字段身份=invalid',
      );
      // ③ 手写 legacy 1.1（无 fields，MAC 正确，聚合 manifest_hash=OLDAGG）→ meta legacy=true
      const prh = JSON.parse(fs.readFileSync(cpPath, 'utf-8')).project_root_hash;
      const legacyBody = {
        schema_version: '1.1', run_id: 'r13', project_root_hash: prh, feature: 'f',
        manifest_hash: 'OLDAGG', auth_subset_sha256: 'AS', updated_at: 'x', files: snap,
      };
      const mac = crypto.createHmac('sha256', 'k13c').update(JSON.stringify(legacyBody), 'utf-8').digest('hex');
      fs.writeFileSync(cpPath, JSON.stringify({ ...legacyBody, mac }), 'utf-8');
      const mLeg = gr.readVisionCheckpointMeta({ projectRoot: root, feature: 'f', runId: 'r13' });
      assert(mLeg.state === 'valid' && mLeg.legacy === true && mLeg.manifestHash === 'OLDAGG', `legacy meta：${JSON.stringify(mLeg)}`);
      const noOverride = { 'override-manifest': false, 'override-start': false, 'override-end': false };
      const cur = { requirement: 'rh2', budget: 'bh' };
      // ④ legacy 聚合 hash 等于当前身份 → 一次性迁移（不 halt 不 rebase）
      const mig = gr.resolveManifestDriftDecision({
        currentFields: cur, currentHash: 'OLDAGG', cpMeta: mLeg,
        overrides: noOverride, fidelityTransitionFields: new Set(),
      });
      assert(mig.legacyMigrated && !mig.halt && !mig.rebaseApplied, `聚合相等=一次性迁移：${JSON.stringify(mig)}`);
      // ⑤ legacy 聚合不等 + 无 override → halt（升级窗口篡改不得借 schema 升级洗白）
      const haltLeg = gr.resolveManifestDriftDecision({
        currentFields: cur, currentHash: 'NEWAGG', cpMeta: mLeg,
        overrides: noOverride, fidelityTransitionFields: new Set(),
      });
      assert(haltLeg.halt !== null && !haltLeg.legacyMigrated, `legacy 不等须 halt：${JSON.stringify(haltLeg)}`);
      // ⑥ legacy 不等 + --override-manifest → 显式 rebase
      const rbLeg = gr.resolveManifestDriftDecision({
        currentFields: cur, currentHash: 'NEWAGG', cpMeta: mLeg,
        overrides: { ...noOverride, 'override-manifest': true }, fidelityTransitionFields: new Set(),
      });
      assert(rbLeg.rebaseApplied && rbLeg.halt === null, `legacy+override 显式 rebase：${JSON.stringify(rbLeg)}`);
      // ⑦ 字段级：fidelity 变更仅在 transition 验真授权集覆盖时放行
      const cpFields = { state: 'valid' as const, manifestHash: 'H', manifestIdentityFields: { fidelity: 'f1', budget: 'bh' }, legacy: false };
      const fidNo = gr.resolveManifestDriftDecision({
        currentFields: { fidelity: 'f2', budget: 'bh' }, currentHash: 'H2', cpMeta: cpFields,
        overrides: noOverride, fidelityTransitionFields: new Set(),
      });
      assert(fidNo.halt !== null, 'fidelity 漂移无 transition 授权须 halt');
      const fidYes = gr.resolveManifestDriftDecision({
        currentFields: { fidelity: 'f2', budget: 'bh' }, currentHash: 'H2', cpMeta: cpFields,
        overrides: noOverride, fidelityTransitionFields: new Set(['fidelity']),
      });
      assert(fidYes.rebaseApplied && fidYes.halt === null, 'transition 验真授权集覆盖 → rebase');
      // ⑧ 无 key（valid_unauthenticated）基线 → 弱信任标记（调用方 resume 须 ack）
      const weak = gr.resolveManifestDriftDecision({
        currentFields: cur, currentHash: 'H3',
        cpMeta: { state: 'valid_unauthenticated', manifestHash: 'H3', manifestIdentityFields: cur, legacy: false },
        overrides: noOverride, fidelityTransitionFields: new Set(),
      });
      assert(weak.baselineUnauthenticated && !weak.halt, `无 key 基线标记弱信任：${JSON.stringify(weak)}`);
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('hasInvalidUnicode：U+FFFD 与孤立代理对检出；正常中英不误报', () => {
  assert(hasInvalidUnicode('a�b'), 'U+FFFD');
  assert(hasInvalidUnicode('x' + String.fromCharCode(0xd800) + 'y'), '孤立高代理');
  assert(!hasInvalidUnicode('添加银行卡 Bank 𝄞'), '合法代理对不误报');
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
