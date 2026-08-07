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

test('vision checkpoint 四态（absent/ok/mismatch/invalid，5a 后签名维度删）+ namespace 隔离', () => {
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
      // T2 5a 完成刀：签名维度删除——内容一致即 ok（不再有 ok_unauthenticated 态）
      assert(
        gr.verifyVisionCheckpoint({ ...base, current: gr.snapshotVisionLedgers(root, 'f') }).state === 'ok',
        '内容一致=ok（签名维度已删）',
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
      // T2 5a 完成刀：MAC/密钥维度整体退役——env 有无 key 均不影响判定；
      // 内容被改＝快照失配 → mismatch（处置=丢缓存重算，非 fail-closed）。
      // 收口刀二：auth_subset 绑定随"resume 扩权比对"消费端一并退役（只写不读即删）。
      process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'k-secret';
      const snap2 = gr.snapshotVisionLedgers(root, 'f');
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'MH', files: snap2 });
      assert(gr.verifyVisionCheckpoint({ ...base, current: snap2 }).state === 'ok', '内容一致=ok（key 在场也不改判定）');
      const cpPath = gr.visionCheckpointPath(root, 'f', 'runx');
      const doc = JSON.parse(fs.readFileSync(cpPath, 'utf-8')) as { files: Array<{ sha256: string }> };
      doc.files[0].sha256 = 'deadbeef';
      fs.writeFileSync(cpPath, JSON.stringify(doc), 'utf-8');
      const forged = gr.verifyVisionCheckpoint({ ...base, current: snap2 });
      assert(forged.state === 'mismatch', `内容改动=mismatch（丢缓存重算）：${JSON.stringify(forged)}`);
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'MH', files: snap2 });
      delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
      assert(gr.verifyVisionCheckpoint({ ...base, current: snap2 }).state === 'ok', '旧 mac 字段被忽略（兼容读取）');
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
      const vOk = gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: snap });
      assert(vOk.state === 'ok' && vOk.generation === 2, `未动=ok 且世代=2：${JSON.stringify(vOk)}`);
      // 跨 run 攻击：run-a 结束后改账本 → run-b fresh 启动前 head 比对失配
      appendArtifactAttestation(root, 'f', {
        artifact_path: 'spec/ui-spec.yaml', artifact_hash: 'H-EVIL', verdict: 'unverified', reasons: ['y'], source: 'evil',
      });
      const v = gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: gr.snapshotVisionLedgers(root, 'f') });
      assert(v.state === 'mismatch' && v.mismatched.includes('artifact-attestations.jsonl'), JSON.stringify(v));
      // T2 5a 完成刀：mac 字段不再参与判定——head 内容被改＝快照与账本失配 → mismatch
      // （处置=自动重建，非 fail-closed）；结构损坏（非 JSON）仍 invalid（同样自动重建）。
      const hp = gr.visionFeatureHeadPath(root, 'f');
      const hd = JSON.parse(fs.readFileSync(hp, 'utf-8')) as { files: Array<{ sha256: string }> };
      hd.files[0].sha256 = 'deadbeef';
      fs.writeFileSync(hp, JSON.stringify(hd), 'utf-8');
      assert(gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: snap }).state === 'mismatch', '内容改动=mismatch（自动重建）');
      fs.writeFileSync(hp, 'not-json{', 'utf-8');
      assert(gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: snap }).state === 'invalid', '结构损坏=invalid（同样自动重建）');
      // head 被删 → absent（收口刀后：记录+继续/自动重建，运行中覆盖前 meta 复验已退役）
      fs.rmSync(hp, { force: true });
      assert(gr.verifyVisionFeatureHead({ projectRoot: root, feature: 'f', current: snap }).state === 'absent', '删除=absent');
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
      else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
      else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

test('九轮：checkpoint 校验 head generation 咬合（缓存可复用性判定，不管 manifest 身份）', () => {
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
      const idFields = { requirement: 'aaaaaaaaaaaaaaaa', budget: 'bbbbbbbbbbbbbbbb' };
      gr.writeVisionCheckpoint({ ...base, manifestHash: 'MH1', manifestIdentityFields: idFields, files: snap, headGeneration: 3 });
      // head generation 一致 → ok；脱节 → invalid（十二轮：manifest/auth_subset 不再 force-equal）
      assert(gr.verifyVisionCheckpoint({ ...base, current: snap, expectedHeadGeneration: 3 }).state === 'ok', 'head 世代一致=ok');
      const hg = gr.verifyVisionCheckpoint({ ...base, current: snap, expectedHeadGeneration: 5 });
      assert(hg.state === 'invalid' && /head_generation/.test(hg.reason ?? ''), JSON.stringify(hg));
      // 收口刀（codex P1-1）：checkpoint 不再向任何裁决面输出 manifest 身份——
      // readVisionCheckpointMeta 已删（防复活断言见统一格）。
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

// 【已删除 · T2 5a 收口刀（codex P2）】九轮 P1-2"合法旧文件重放 digest 检测"测试格——
// 被测机制（运行中覆盖前 meta 复验 + readVisionCheckpointMeta）随防伪造纵深退役：
// runner 是 writer，提交即覆盖写；重放/篡改的兜底=下次启动按仓内事实重算（缓存三态丢弃）。

// 【已删除 · T2 5a 完成刀】本处原有 HWM 高水位链/换钥 reseal/reseal journal 状态机/
// HWM absent 三分 等测试格——被测机制（防"协调回滚"的密码学纵深）整体退役。
// 防复活断言见下方统一格。
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

test('十一轮 P1→收口刀转正：rebase 持久化——resolveManifestIdentityBaseline fold（首个 run_start → 历次 rebase 前进）', () => {
  // 收口刀（codex P1-1）：本格原是内联 fold 草稿，现直接消费生产函数（双真值教训——
  // 测试自拼同构表达式时，改坏生产咬不到测试）。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
  const events = [
    { type: 'run_start', manifest_identity_fields: { requirement: 'H1', budget: 'b' } },
    { type: 'manifest_identity_rebase', to_fields: { requirement: 'H2', budget: 'b' } },
    // 后续 resume 的 run_start 不覆盖基线（只认首个 run_start；前进只经 rebase 事件）
    { type: 'run_start', manifest_identity_fields: { requirement: 'H3', budget: 'b' } },
  ];
  const frozen = gr.resolveManifestIdentityBaseline(events);
  assert(frozen !== null && frozen.requirement === 'H2', `fold 基线应前进到 H2 且不被后续 run_start 覆盖：${JSON.stringify(frozen)}`);
  // 无 run_start / 旧 schema 缺字段 → null（无基线，fail-to-continue，与出生 lineage 同口径）
  assert(gr.resolveManifestIdentityBaseline([]) === null, '空 events=无基线');
  assert(gr.resolveManifestIdentityBaseline([{ type: 'run_start' }]) === null, '旧 schema 缺字段=无基线');
});

// 【已删除 · T2 5a 完成刀】本处原有 HWM 高水位链/换钥 reseal/reseal journal 状态机/
// HWM absent 三分 等测试格——被测机制（防"协调回滚"的密码学纵深）整体退役。
// 防复活断言见下方统一格。
test('收口刀（codex P1-1）：drift 出生基线=events SSOT——场外缓存的存在与否**不得**改变裁决', () => {
  // codex 实测反例（立项事故）：同一份 manifest 漂移，checkpoint 在场→halt、
  // checkpoint 删除/损坏→放行——"缓存是否存在"改变权限结果，删缓存即绕过出生意图。
  // 现决策函数在类型上只吃 events 出生基线（birthFields），checkpoint 无输入通道；
  // 本格证明同一漂移在"有基线"时恒 halt、且基线只来自 events。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
  const noOverride = { 'override-manifest': false, 'override-start': false, 'override-end': false };
  const birth = { requirement: 'r1hash', budget: 'bhash', start_phase: 'sp' };
  const drifted = { requirement: 'r2hash', budget: 'bhash', start_phase: 'sp' }; // requirement 变
  const baseline = gr.resolveManifestIdentityBaseline([
    { type: 'run_start', manifest_identity_fields: birth },
  ]);
  // ① 未授权漂移 → halt（真冲突）
  const haltRes = gr.resolveManifestDriftDecision({
    currentFields: drifted, currentHash: 'H2', birthFields: baseline,
    overrides: noOverride, fidelityTransitionFields: new Set(),
  });
  assert(haltRes.halt !== null && haltRes.halt.changedFields.join() === 'requirement',
    `未授权漂移须 halt：${JSON.stringify(haltRes)}`);
  // ② --override-manifest → 授权 rebase
  const rebase = gr.resolveManifestDriftDecision({
    currentFields: drifted, currentHash: 'H2', birthFields: baseline,
    overrides: { ...noOverride, 'override-manifest': true }, fidelityTransitionFields: new Set(),
  });
  assert(rebase.rebaseApplied && rebase.halt === null, `override 授权 rebase：${JSON.stringify(rebase)}`);
  // ③ rebase 事件落盘后基线前进 → 同一"漂移"下次 resume 不复报
  const advanced = gr.resolveManifestIdentityBaseline([
    { type: 'run_start', manifest_identity_fields: birth },
    { type: 'manifest_identity_rebase', to_fields: drifted },
  ]);
  const after = gr.resolveManifestDriftDecision({
    currentFields: drifted, currentHash: 'H2', birthFields: advanced,
    overrides: noOverride, fidelityTransitionFields: new Set(),
  });
  assert(after.halt === null && !after.rebaseApplied, `rebase 后不复报：${JSON.stringify(after)}`);
  // ④ 决策输入里不存在 checkpoint 通道（防复活：删缓存/塞缓存都无从影响裁决）
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'goal-runner.ts'), 'utf-8');
  assert(!/cpMeta/.test(src.replace(/\/\/[^\n]*/g, '')),
    'resolveManifestDriftDecision 不得再出现 cpMeta 输入通道（checkpoint 退出裁决权威）');
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

// 【已删除 · T2 5a 完成刀】本处原有 HWM 高水位链/换钥 reseal/reseal journal 状态机/
// HWM absent 三分 等测试格——被测机制（防"协调回滚"的密码学纵深）整体退役。
// 防复活断言见下方统一格。
test('垂直闭环追补（2026-08-06）：vision 信任封顶已删除——完成态不再因认证状态改写（防复活）', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gr = require('../../scripts/goal-runner') as Record<string, unknown>;
  // 七轮 P0-1 的 capRunStatusForVisionTrust（UI run 无 HMAC/弱 ack → AWAITING_HUMAN_REVIEW）
  // 按理念裁定整体删除：认证状态退出完成态语义，防伪造主防线=终点不信 agent 自报。
  // 本格防复活：函数不得回归；设备真实性封顶（诚实完成度，非防伪造）必须仍在。
  assert(!('capRunStatusForVisionTrust' in gr),
    'capRunStatusForVisionTrust 已按 2026-08-06 理念裁定删除，不得复活');
  assert(typeof gr.capRunStatusForDeviceAuthenticity === 'function',
    '设备真实性封顶（防假绿面）不属删除范围，必须保留');
  // T2 5a 完成刀：HWM/reseal 全套设施不得复活（防伪造纵深，三分类①）
  // + 收口刀（codex 三 P1/P2）：checkpoint/head 裁决面读取器、ack/reseal 绑定函数、
  //   reseal journal 路径、HMAC env 常量同样不得复活。
  for (const dead of ['appendVisionHwm', 'readVisionHwmHighWater', 'assessHwmFreshness',
    'transactionalQuarantineHwm', 'recoverResealTransaction', 'commitResealJournal',
    'readResealJournal', 'capRunStatusForVisionTrust',
    'readVisionCheckpointMeta', 'readVisionFeatureHeadMeta',
    'visionLedgerAckObjectHash', 'visionTrustResealObjectHash',
    'visionResealJournalPath', 'VISION_CHECKPOINT_HMAC_ENV',
    'visionHwmPath', 'computeAuthSubsetSha256']) {
    assert(!(dead in gr), `${dead} 已按 5a 完成/收口刀删除，不得复活`);
  }
  // guidance 侧：head 失配求人话术无调用方（失配恒自动重建）
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const acg = require('../../scripts/utils/await-confirm-guidance') as Record<string, unknown>;
  assert(!('buildLineageMismatchGuidance' in acg), 'buildLineageMismatchGuidance 已删除，不得复活');
  // receipt 侧：vision ack/reseal 两个 action 已随协议退役
  const crSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'utils', 'confirmation-receipt.ts'), 'utf-8');
  assert(!/'vision_ledger_ack'|'vision_trust_reseal'/.test(crSrc.replace(/\/\/[^\n]*/g, '')),
    'confirmation receipt 不得再声明 vision_ledger_ack/vision_trust_reseal action');
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
      const base = { projectRoot: root, feature: 'f', runId: 'runm', manifestHash: 'MH', manifestIdentityFields: {} as Record<string, string> };
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
      // 收口刀语境：盘上 checkpoint 被删 → 缓存 absent（记录+按仓内事实重算，
      // 迁移凭证由 runner 内存可信态权威持有，不依赖盘上文件存活）
      fs.rmSync(gr.visionCheckpointPath(root, 'f', 'runm'), { force: true });
      assert(
        gr.verifyVisionCheckpoint({ projectRoot: root, feature: 'f', runId: 'runm', current: snap }).state === 'absent',
        '删除后缓存=absent（丢缓存重算，不停死）',
      );
      // 对抗：盘上伪造身份绑定（project_root_hash 不符）→ invalid，缓存不可复用
      fs.mkdirSync(require('path').dirname(gr.visionCheckpointPath(root, 'f', 'runm')), { recursive: true });
      fs.writeFileSync(gr.visionCheckpointPath(root, 'f', 'runm'), JSON.stringify({
        schema_version: '1.1', run_id: 'runm', project_root_hash: 'x', feature: 'f',
        manifest_hash: 'MH', updated_at: 'x', files: snap, migrations: [{ file: 'forged' }], mac: null,
      }), 'utf-8');
      assert(
        gr.verifyVisionCheckpoint({ projectRoot: root, feature: 'f', runId: 'runm', current: snap }).state === 'invalid',
        '身份失配的缓存=invalid（丢弃，migrations 不被采信）',
      );
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
      else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
      if (prevKey === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT;
      else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prevKey;
    }
  });
});

// 【已删除 · T2 5a 完成刀】本处原有 HWM 高水位链/换钥 reseal/reseal journal 状态机/
// HWM absent 三分 等测试格——被测机制（防"协调回滚"的密码学纵深）整体退役。
// 防复活断言见下方统一格。
// 【已删除 · T2 5a 收口刀（codex P1-1/P2）】十三轮 P1-3"legacy/unauthenticated checkpoint
// 不静默当基线"测试格——checkpoint 退出 drift 基线角色后，legacy 聚合迁移/
// `valid_unauthenticated` 弱信任标记/`vision_checkpoint_schema_migrated` 事件全部无对象。
// 存活的两条语义换了住处：字段级授权见下格（birthFields 口径）；1.2 结构必填见本格。
test('checkpoint 结构完整性（缓存可复用性面）：1.2 缺 manifest_identity_fields = invalid', () => {
  withTmp(root => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
    const prevDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'cp');
    try {
      const snap = gr.snapshotVisionLedgers(root, 'f');
      const cpPath = gr.visionCheckpointPath(root, 'f', 'r13');
      gr.writeVisionCheckpoint({
        projectRoot: root, feature: 'f', runId: 'r13', manifestHash: 'AGG',
        manifestIdentityFields: { requirement: 'rh', budget: 'bh' }, files: snap,
      });
      assert(
        gr.verifyVisionCheckpoint({ projectRoot: root, feature: 'f', runId: 'r13', current: snap }).state === 'ok',
        '现行 write 结构完整=ok',
      );
      const doc12 = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
      delete doc12.manifest_identity_fields;
      fs.writeFileSync(cpPath, JSON.stringify(doc12), 'utf-8');
      assert(
        gr.verifyVisionCheckpoint({ projectRoot: root, feature: 'f', runId: 'r13', current: snap }).state === 'invalid',
        '1.2 缺逐字段身份=invalid（缓存丢弃，不参与任何裁决）',
      );
    } finally {
      if (prevDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevDir;
    }
  });
});

test('字段级 override 授权（birthFields 口径）：fidelity 变更仅在 transition 验真授权集覆盖时放行', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gr = require('../../scripts/goal-runner') as typeof import('../../scripts/goal-runner');
  const noOverride = { 'override-manifest': false, 'override-start': false, 'override-end': false };
  const birth = { fidelity: 'f1', budget: 'bh' };
  const fidNo = gr.resolveManifestDriftDecision({
    currentFields: { fidelity: 'f2', budget: 'bh' }, currentHash: 'H2', birthFields: birth,
    overrides: noOverride, fidelityTransitionFields: new Set(),
  });
  assert(fidNo.halt !== null, 'fidelity 漂移无 transition 授权须 halt');
  const fidYes = gr.resolveManifestDriftDecision({
    currentFields: { fidelity: 'f2', budget: 'bh' }, currentHash: 'H2', birthFields: birth,
    overrides: noOverride, fidelityTransitionFields: new Set(['fidelity']),
  });
  assert(fidYes.rebaseApplied && fidYes.halt === null, 'transition 验真授权集覆盖 → rebase');
  // 无基线（fresh/legacy events）→ 当前身份即出生值，零 halt
  const fresh = gr.resolveManifestDriftDecision({
    currentFields: { fidelity: 'f2', budget: 'bh' }, currentHash: 'H2', birthFields: null,
    overrides: noOverride, fidelityTransitionFields: new Set(),
  });
  assert(fresh.halt === null && !fresh.rebaseApplied, '无基线=当前身份即 effective');
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
