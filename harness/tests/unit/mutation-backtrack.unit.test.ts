// ============================================================================
// mutation-backtrack.unit.test.ts — S4 改码分类 + 回退状态机回归
// （visual-capability-truth S4 / P0-D；验收「回退状态机五用例」纯函数面）
// ============================================================================

import {
  classifySourceDrift,
  mutationAuthorizationScopeHash,
  receiptValidityIssues,
  receiptsFromManifestEntries,
  type MutationAuthorizationReceipt,
} from '../../scripts/utils/mutation-authorization';
import {
  canonicalReceiptPayload,
  TRUST_REGISTRY_PATH_ENV,
  type ConfirmationReceiptPayload,
} from '../../scripts/utils/confirmation-receipt';
import {
  applyInvalidationsToResume,
  resolveFrozenManifestHash,
} from '../../scripts/goal-runner';
import { evaluateUpstreamViews } from '../../scripts/utils/upstream-verdict-gate';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

// codex 实施 review 二轮 P0-3 后：human 源必须过 confirmation-receipt 信任链——fixture 建
// 真实 ed25519 registry（经 env 注入，测试体内包裹设/还原）+ 对授权范围哈希签名的 receipt。
// 旧"普通文本文件 + hash 相等"形态降级为负测试（agent 可自建=自签通道）。
const AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-auth-'));
fs.mkdirSync(path.join(AUTH_DIR, 'confirm'), { recursive: true });
const PLAIN_REF_REL = 'confirm/mutation-approval-plain.md';
fs.writeFileSync(path.join(AUTH_DIR, PLAIN_REF_REL), 'user approved seam mutation via registry action X', 'utf-8');
const PLAIN_HASH = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(AUTH_DIR, PLAIN_REF_REL)))
  .digest('hex').slice(0, 16);

const { publicKey: TRUST_PUB, privateKey: TRUST_PRIV } = crypto.generateKeyPairSync('ed25519');
const REGISTRY_PATH = path.join(AUTH_DIR, 'trust-registry.json');
fs.writeFileSync(REGISTRY_PATH, JSON.stringify({
  schema_version: '1.0',
  issuers: [{
    issuer_id: 'ops-team',
    keys: [{ key_id: 'k1', alg: 'ed25519', public_key_pem: TRUST_PUB.export({ type: 'spki', format: 'pem' }).toString() }],
  }],
}), 'utf-8');

/** env 注入 registry（测试体内设/还原——不污染同进程其他 suite 的 fail-closed 预期） */
function withTrust<T>(fn: () => T): T {
  const prev = process.env[TRUST_REGISTRY_PATH_ENV];
  process.env[TRUST_REGISTRY_PATH_ENV] = REGISTRY_PATH;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[TRUST_REGISTRY_PATH_ENV];
    else process.env[TRUST_REGISTRY_PATH_ENV] = prev;
  }
}

const CTX = {
  runId: 'r1',
  frozenManifestHash: 'MH',
  phase: 'ut',
  expectedInventoryHash: 'INV',
  projectRoot: AUTH_DIR,
  feature: 'demo',
};

const seamRow = (over?: Partial<MutationAuthorizationReceipt>): MutationAuthorizationReceipt => ({
  schema_version: '1.0',
  run_id: 'r1',
  phase: 'ut',
  allowed_files: ['02-Feature/F/src/main/ets/shared/utils/SmsCodeValidator.ets'],
  allowed_change_kind: 'test_seam',
  max_files: 2,
  source_inventory_before: 'INV',
  approved_by: 'user-confirm-receipt-7',
  authority_kind: 'human',
  ...over,
});

let anchorSeq = 0;
/** 对指定授权范围签发 confirmation receipt 文件，返回锚点字段（object_hash=范围哈希绑定） */
function signedAnchor(
  row: MutationAuthorizationReceipt,
  payloadOver?: Partial<ConfirmationReceiptPayload>,
): { authority_ref: string; receipt_hash: string } {
  const payload: ConfirmationReceiptPayload = {
    action: 'source_mutation_authorization',
    feature: 'demo',
    object_hash: mutationAuthorizationScopeHash(row),
    issued_at: '2026-01-01T00:00:00.000Z',
    expiry: '2099-01-01T00:00:00.000Z',
    run_id: row.run_id,
    ...payloadOver,
  };
  const receipt = {
    schema_version: '1.0',
    receipt_id: `r-anchor-${anchorSeq}`,
    issuer_id: 'ops-team',
    key_id: 'k1',
    alg: 'ed25519',
    payload_schema_version: '1.0',
    payload,
    signature: crypto.sign(null, canonicalReceiptPayload(payload), TRUST_PRIV).toString('base64'),
  };
  const rel = `confirm/anchor-${anchorSeq++}.receipt.json`;
  fs.writeFileSync(path.join(AUTH_DIR, rel), JSON.stringify(receipt), 'utf-8');
  const hash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(AUTH_DIR, rel)))
    .digest('hex').slice(0, 16);
  return { authority_ref: rel, receipt_hash: hash };
}

/** 完整可信 human receipt（范围行 + 对该范围签名的锚点） */
function humanReceipt(over?: Partial<MutationAuthorizationReceipt>): MutationAuthorizationReceipt {
  const row = seamRow(over);
  return { ...row, ...signedAnchor(row) };
}

/** 旧 positive 形态保留为 seamReceipt 名字的兼容 builder（携 plain 文件锚——现属负形态） */
const seamReceipt = (over?: Partial<MutationAuthorizationReceipt>): MutationAuthorizationReceipt => ({
  ...seamRow(over),
  // 显式传 undefined 也要生效（裸 approved_by 负测试）——按键在场判断而非值判断
  authority_ref: over && 'authority_ref' in over ? over.authority_ref : PLAIN_REF_REL,
  receipt_hash: over && 'receipt_hash' in over ? over.receipt_hash : PLAIN_HASH,
});

// ---------------- 分类决策表 ----------------

test('无 drift → no_drift 不触发', () => {
  const r = classifySourceDrift({ added: [], modified: [], deleted: [] }, [], CTX);
  assert(r.kind === 'no_drift', r.kind);
});

test('三轮 P1-6：receipt 信任链全绿 + 全覆盖也不自动回退（change kind 分类器 pending）——unauthorized 上抛人工裁决', () => {
  const r = withTrust(() => classifySourceDrift(
    { added: ['02-Feature/F/src/main/ets/shared/utils/SmsCodeValidator.ets'], modified: [], deleted: [] },
    [humanReceipt()],
    CTX,
  ));
  assert(r.kind === 'unauthorized', JSON.stringify(r));
  assert(
    (r as { violations: string[] }).violations.some(v => v.includes('授权 receipt 命中') && v.includes('自动回退')),
    JSON.stringify((r as { violations: string[] }).violations),
  );
});

test('二轮 P0-3 对抗：plain 文件锚（文件实存 + hash 相等，旧 positive 形态）→ 信任链拒绝', () => {
  const issues = withTrust(() => receiptValidityIssues(seamReceipt(), CTX));
  assert(issues.some(i => i.includes('信任链校验失败')), JSON.stringify(issues));
});

test('二轮 P0-3 对抗：真人签名换皮到更宽授权行（object_hash 失配）→ 无效', () => {
  const narrow = seamRow({ max_files: 1 });
  const anchor = signedAnchor(narrow);
  const widened: MutationAuthorizationReceipt = {
    ...seamRow({ max_files: 9, allowed_files: [...narrow.allowed_files, 'extra/Widened.ets'] }),
    ...anchor,
  };
  const issues = withTrust(() => receiptValidityIssues(widened, CTX));
  assert(issues.some(i => i.includes('信任链校验失败')), JSON.stringify(issues));
});

test('二轮 P0-3 对抗：authority_ref 路径穿越（../ 越出 projectRoot）→ 无效', () => {
  const issues = withTrust(() =>
    receiptValidityIssues(seamReceipt({ authority_ref: '../outside-workspace.json', receipt_hash: 'aaaaaaaaaaaaaaaa' }), CTX));
  assert(issues.some(i => i.includes('越出 projectRoot')), JSON.stringify(issues));
});

test('无任何 receipt 的 testing 改码 → unauthorized（HALT 侧，不洗白）', () => {
  const r = classifySourceDrift(
    { added: [], modified: ['01-Product/Phone/src/main/ets/pages/index.ets'], deleted: [] },
    [],
    CTX,
  );
  assert(r.kind === 'unauthorized', r.kind);
  assert((r as { violations: string[] }).violations.some(v => v.includes('无任何授权 receipt')), 'violations');
});

test('超出 allowed_files（out-of-scope 文件混入）→ 整体翻转 unauthorized', () => {
  const r = withTrust(() => classifySourceDrift(
    {
      added: ['02-Feature/F/src/main/ets/shared/utils/SmsCodeValidator.ets'],
      modified: ['01-Product/Phone/src/main/ets/pages/index.ets'],
      deleted: [],
    },
    [humanReceipt()],
    CTX,
  ));
  assert(r.kind === 'unauthorized', 'out-of-scope 混入必须整体拒');
});

test('超 max_files（逐 receipt 配额）→ 翻转 unauthorized', () => {
  const r = withTrust(() => classifySourceDrift(
    {
      added: ['a.ets', 'b.ets', 'c.ets'],
      modified: [],
      deleted: [],
    },
    [humanReceipt({ allowed_files: ['a.ets', 'b.ets', 'c.ets'], max_files: 2 })],
    CTX,
  ));
  assert(r.kind === 'unauthorized', '超 max_files 必须拒');
  assert((r as { violations: string[] }).violations.some(v => v.includes('超出其自身 max_files')), 'violation 点名逐 receipt 配额');
});

test('二轮 P1-5 对抗：无关大配额 receipt 不放大另一份授权（per-receipt 配额）', () => {
  const r = withTrust(() => classifySourceDrift(
    { added: [], modified: ['a.ets', 'b.ets'], deleted: [] },
    [
      humanReceipt({ allowed_files: ['a.ets'], max_files: 1 }),
      humanReceipt({ allowed_files: ['z1.ets', 'z2.ets', 'z3.ets'], max_files: 9 }),
    ],
    CTX,
  ));
  assert(r.kind === 'unauthorized', '借无关配额放大必须拒');
  assert((r as { violations: string[] }).violations.some(v => v.includes('未授权变更文件')), JSON.stringify((r as { violations: string[] }).violations));
});

test('二轮 P1-5：删除源文件恒不可授权（test_seam/integration_glue 语义外）', () => {
  const r = withTrust(() => classifySourceDrift(
    { added: [], modified: [], deleted: ['02-Feature/F/src/main/ets/shared/utils/SmsCodeValidator.ets'] },
    [humanReceipt()],
    CTX,
  ));
  assert(r.kind === 'unauthorized', '删除必须拒');
  assert((r as { violations: string[] }).violations.some(v => v.includes('删除源文件')), JSON.stringify((r as { violations: string[] }).violations));
});

// ---------------- 授权三源硬边界 ----------------

test('agent 自签 approved_by（authority_kind 非三源）→ receipt 无效', () => {
  const issues = receiptValidityIssues(
    seamReceipt({ authority_kind: 'headless-testability-setter-seam' as never }),
    CTX,
  );
  assert(issues.some(i => i.includes('非三源')), JSON.stringify(issues));
});

test('无文件范围宽授权（allowed_files 空）→ 无效', () => {
  const issues = receiptValidityIssues(seamReceipt({ allowed_files: [] }), CTX);
  assert(issues.some(i => i.includes('宽授权')), JSON.stringify(issues));
});

test('pre_run_manifest：hash 与冻结快照不符（运行中补写）→ 无效；相符 → 有效', () => {
  const entry = [{ phase: 'ut', allowed_files: ['a.ets'], max_files: 1 }];
  const good = receiptsFromManifestEntries(entry, 'r1', 'MH')[0];
  assert(receiptValidityIssues(good, CTX).length === 0, '冻结匹配应有效');
  const tampered = receiptsFromManifestEntries(entry, 'r1', 'MH-TAMPERED')[0];
  assert(
    receiptValidityIssues(tampered, CTX).some(i => i.includes('冻结快照不符')),
    '运行中补写不构成授权',
  );
  const noFreeze = receiptsFromManifestEntries(entry, 'r1', null)[0];
  assert(
    receiptValidityIssues(noFreeze, { runId: 'r1', frozenManifestHash: null }).some(i => i.includes('manifest_hash_at_run_start')),
    '无冻结 hash 不采信',
  );
});

test('十三轮 P1-3：无 writer authenticity（manifestIdentityAuthenticated=false）→ pre_run_manifest 降级不采信', () => {
  const entry = [{ phase: 'ut', allowed_files: ['a.ets'], max_files: 1 }];
  const r = receiptsFromManifestEntries(entry, 'r1', 'MH')[0];
  // 无 key 部署：manifest+冻结事件均在 agent 可写面——整链可伪造，须 human receipt
  const weak = receiptValidityIssues(r, { ...CTX, manifestIdentityAuthenticated: false });
  assert(weak.some(i => i.includes('writer authenticity')), JSON.stringify(weak));
  // 显式 true / 未断言（兼容语境）→ 不降级
  assert(receiptValidityIssues(r, { ...CTX, manifestIdentityAuthenticated: true }).length === 0, '有 key 不降级');
  assert(receiptValidityIssues(r, CTX).length === 0, '未断言不降级（兼容非 runner 语境）');
});

test('跨 run receipt → 无效（授权 per-run）', () => {
  const issues = receiptValidityIssues(seamReceipt({ run_id: 'r0' }), CTX);
  assert(issues.some(i => i.includes('run_id 不匹配')), JSON.stringify(issues));
});

test('P0-4 硬化：human 源缺 authority_ref/receipt_hash（裸 approved_by 换皮）→ 无效', () => {
  const issues = receiptValidityIssues(
    seamReceipt({ authority_ref: undefined, receipt_hash: undefined }),
    CTX,
  );
  assert(issues.some(i => i.includes('裸 approved_by')), JSON.stringify(issues));
});

test('P0-4 硬化：receipt_hash 与 authority_ref 文件不符（伪造引用）→ 无效', () => {
  const issues = receiptValidityIssues(seamReceipt({ receipt_hash: 'deadbeefdeadbeef' }), CTX);
  assert(issues.some(i => i.includes('引用被篡改/伪造')), JSON.stringify(issues));
});

test('P0-4 硬化：phase 不匹配（ut 授权用于 testing 改码）→ 无效', () => {
  const issues = receiptValidityIssues(seamReceipt(), { ...CTX, phase: 'testing' });
  assert(issues.some(i => i.includes('phase 不匹配')), JSON.stringify(issues));
});

test('P0-4 硬化：source_inventory_before 缺失/与 review 基线不符 → 无效', () => {
  const missing = receiptValidityIssues(seamReceipt({ source_inventory_before: undefined }), CTX);
  assert(missing.some(i => i.includes('source_inventory_before')), JSON.stringify(missing));
  const drifted = receiptValidityIssues(seamReceipt({ source_inventory_before: 'OTHER' }), CTX);
  assert(drifted.some(i => i.includes('不是当前基线')), JSON.stringify(drifted));
});

test('P0-4 硬化：runner_policy 不在 framework 注册表（宿主/agent 注入）→ 无效', () => {
  const issues = receiptValidityIssues(
    seamReceipt({ authority_kind: 'runner_policy', authority_ref: 'host-injected-policy' }),
    CTX,
  );
  assert(issues.some(i => i.includes('不在 framework 注册表')), JSON.stringify(issues));
});

// ---------------- 回退状态机纯函数面 ----------------

test('resolveFrozenManifestHash：首个 run_start 锚定；resume 不换锚', () => {
  const events = [
    { type: 'run_start', manifest_hash: 'H-FIRST' },
    { type: 'resume' },
    { type: 'run_start', manifest_hash: 'H-SECOND' },
  ];
  assert(resolveFrozenManifestHash(events, 'H-NOW') === 'H-FIRST', '首锚优先');
  assert(resolveFrozenManifestHash([], 'H-NOW') === 'H-NOW', '无先例用当前');
});

test('applyInvalidationsToResume：失效未重跑 → 剔除 + 起点回退；已重新 PASS → 保留', () => {
  const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] as never[];
  const outcomes = [
    { phase: 'coding', verdict: 'PASS' },
    { phase: 'review', verdict: 'PASS' },
    { phase: 'ut', verdict: 'PASS' },
  ] as never[];
  const events = [
    { type: 'phase_verdict', phase: 'review', verdict: 'PASS' },
    { type: 'phase_invalidated', phase: 'review' },
    { type: 'phase_invalidated', phase: 'ut' },
    { type: 'phase_verdict', phase: 'ut', verdict: 'PASS' }, // ut 已重新完成
  ];
  const r = applyInvalidationsToResume(chain, outcomes, events);
  assert(!r.outcomes.some(o => (o as { phase: string }).phase === 'review'), 'review 失效未重跑须剔除');
  assert(r.outcomes.some(o => (o as { phase: string }).phase === 'ut'), 'ut 已重新 PASS 须保留');
  assert(r.startIndex === 3, `起点回退到 review（idx3），got ${r.startIndex}`);
});

// ---------------- 环境层标注 ----------------

test('S4 环境层：ut FAIL + device_locked → 指引说"修环境重跑"不引向改码', () => {
  const violations = evaluateUpstreamViews([{
    phase: 'ut', summaryExists: true, verdictReadable: true, verdict: 'FAIL',
    blockerIds: [], freshness: 'fresh', environmentFailureCode: 'device_locked',
  }]);
  assert(violations.length === 1, 'FAIL 仍拦截（不降门禁）');
  assert(violations[0].reason.includes('environment') && violations[0].reason.includes('勿改产品代码'), violations[0].reason);
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
