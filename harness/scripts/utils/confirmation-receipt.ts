// ============================================================================
// confirmation-receipt.ts — hard-gate-lowering 授权统一凭证【消费侧】
// （goal-fakepass-hardening t10；openspec confirmation-receipts spec）
// ============================================================================
// 信任模型：账本记录/聊天回答/CLI flag/signed_by 字符串都不构成授权（交互态与无头
// 同规）。任何降低硬门禁的决定（降档/P0 skip waiver/conditional-review 授权/行为开关
// 豁免/flow_contract 确认）只认本模块校验通过的 receipt。
//
// 信任锚强制条款（codex 终审 P1，全部实现，不留实现自由度）：
//   - receipt 必含 receipt_id/issuer_id/key_id/alg/payload_schema_version，payload 绑定
//     action/feature/object_hash/expiry（可选 run_id/original→target）；
//   - 签名覆盖【规范化 payload 全体】（stableStringify），不得只签部分字段；
//   - 验证密钥**只能**取自预置可信 registry——禁止信任 receipt 内嵌公钥/临时密钥；
//   - unknown issuer / key / alg 一律 INVALID；
//   - MAC（hmac-sha256）仅当 registry 声明该 key 对 agent 不可读（密钥材料经 env 引用，
//     不落仓）；否则必须非对称（ed25519）；
//   - key rotation/revocation：registry 条目 revoked=true 即其 receipt 全部失效。
//
// 签发不在本模块（runtime-policy-core 后继 change `confirmation-credential-issuance`）。
// 签发落地前 registry 通常不存在 → 一切校验 INVALID → 消费点 fail-closed 封顶
// AWAITING_HUMAN_REVIEW——这是设计行为，不是缺陷。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { stableStringify } from './phase-evidence-manifest';

export const CONFIRMATION_RECEIPT_SCHEMA_VERSION = '1.0';
export const TRUST_REGISTRY_FILENAME = 'confirmation-trust-registry.json';

export type ReceiptAction =
  | 'fidelity_downgrade'
  | 'p0_skip_waiver'
  | 'conditional_review_authorization'
  | 'behavior_switch_waiver'
  | 'flow_contract'
  /** P0 运行时忠实性证明（Hylyre provider step 采集落地后由 runner 签发；落地前真人带外
   * 确认）——绑定 testing 源码 aggregate + acceptance flows hash，空文件不再能解除封顶 */
  | 'runtime_fidelity_attestation';

const RECEIPT_ACTIONS = new Set<ReceiptAction>([
  'fidelity_downgrade',
  'p0_skip_waiver',
  'conditional_review_authorization',
  'behavior_switch_waiver',
  'flow_contract',
  'runtime_fidelity_attestation',
]);

const ALLOWED_ALGS = new Set(['ed25519', 'hmac-sha256']);

export interface ConfirmationReceiptPayload {
  action: ReceiptAction;
  feature: string;
  /** 授权对象绑定哈希（各 action 自定义口径，消费点传 expected 对账） */
  object_hash: string;
  issued_at: string;
  expiry: string;
  run_id?: string;
  original_value?: string;
  target_value?: string;
}

export interface ConfirmationReceipt {
  schema_version: string;
  receipt_id: string;
  issuer_id: string;
  key_id: string;
  alg: string;
  payload_schema_version: string;
  payload: ConfirmationReceiptPayload;
  /** base64 签名（ed25519）或 hex HMAC；覆盖 stableStringify(payload) 全体 */
  signature: string;
}

export interface TrustRegistryKey {
  key_id: string;
  alg: string;
  /** ed25519：PEM 公钥 */
  public_key_pem?: string;
  /** hmac-sha256：密钥材料所在 env 变量名（材料不落仓=对 agent 不可读的部署形态） */
  hmac_key_env?: string;
  revoked?: boolean;
}

export interface TrustRegistry {
  schema_version: string;
  issuers: Array<{ issuer_id: string; keys: TrustRegistryKey[] }>;
}

export interface ReceiptExpectation {
  action: ReceiptAction;
  feature: string;
  object_hash: string;
  run_id?: string;
  /** 时钟注入（单测确定性） */
  now?: () => Date;
}

export interface ReceiptValidation {
  valid: boolean;
  reasons: string[];
}

/** HMAC 密钥 env 强制前缀——agent-invoke 按此前缀从子进程 env 剥除（材料不进 agent 环境） */
export const HMAC_KEY_ENV_PREFIX = 'MAISON_HMAC_';
/** registry 路径 env 覆盖（CI/多机部署）；同样从 agent 子进程 env 剥除 */
export const TRUST_REGISTRY_PATH_ENV = 'MAISON_TRUST_REGISTRY';

/**
 * registry 落点（codex 六轮 P0-2：**绝不**从项目根解析——项目根是 agent 可写区，
 * agent 自建 registry+自签 receipt 即绕过全部信任锚）：
 *   ① env `MAISON_TRUST_REGISTRY`（部署方注入；agent 子进程 env 已剥除该键）；
 *   ② 用户主目录 `~/.maison/confirmation-trust-registry.json`（workspace-write 之外）。
 * 诚实边界：主目录并非密码学不可写，但已在常规 agent 写权限域之外；彻底解=签发侧
 * 带外体系（confirmation-credential-issuance）。项目根同名文件即使存在也**不消费**。
 */
export function defaultTrustRegistryPath(_projectRoot: string): string {
  const envPath = process.env[TRUST_REGISTRY_PATH_ENV];
  if (envPath && envPath.trim()) return path.resolve(envPath.trim());
  return path.join(os.homedir(), '.maison', TRUST_REGISTRY_FILENAME);
}

export function loadTrustRegistry(registryPath: string): TrustRegistry | null {
  if (!fs.existsSync(registryPath)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as TrustRegistry;
    if (!doc || !Array.isArray(doc.issuers)) return null;
    return doc;
  } catch {
    return null;
  }
}

function fail(reasons: string[]): ReceiptValidation {
  return { valid: false, reasons };
}

export function canonicalReceiptPayload(payload: ConfirmationReceiptPayload): Buffer {
  return Buffer.from(stableStringify(payload), 'utf-8');
}

/**
 * 唯一校验入口。任何缺失/未知/失配/过期/吊销 → INVALID + 机器原因；
 * 绝不因"registry 不存在"降级放行（fail-closed）。
 */
export function validateConfirmationReceipt(
  receipt: unknown,
  registry: TrustRegistry | null,
  expected: ReceiptExpectation,
): ReceiptValidation {
  const r = receipt as ConfirmationReceipt;
  const reasons: string[] = [];

  // ---- schema ----
  if (!r || typeof r !== 'object') return fail(['receipt 非对象']);
  for (const k of ['receipt_id', 'issuer_id', 'key_id', 'alg', 'payload_schema_version', 'signature'] as const) {
    if (typeof r[k] !== 'string' || !r[k]) reasons.push(`缺字段 ${k}`);
  }
  if (r.schema_version !== CONFIRMATION_RECEIPT_SCHEMA_VERSION) reasons.push(`schema_version 非法：${String(r.schema_version)}`);
  const p = r.payload;
  if (!p || typeof p !== 'object') reasons.push('缺 payload');
  if (reasons.length > 0) return fail(reasons);
  for (const k of ['action', 'feature', 'object_hash', 'issued_at', 'expiry'] as const) {
    if (typeof p[k] !== 'string' || !p[k]) reasons.push(`payload 缺字段 ${k}`);
  }
  if (reasons.length > 0) return fail(reasons);
  if (!RECEIPT_ACTIONS.has(p.action)) return fail([`unknown action：${p.action}`]);
  if (!ALLOWED_ALGS.has(r.alg)) return fail([`unknown alg：${r.alg}（unknown 一律 INVALID）`]);
  // 内嵌公钥/临时密钥禁令：receipt 携带任何密钥材料字段即拒收
  const embedded = ['public_key', 'public_key_pem', 'verify_key', 'key', 'hmac_key'].filter(
    (k) => (r as unknown as Record<string, unknown>)[k] !== undefined,
  );
  if (embedded.length > 0) {
    return fail([`receipt 内嵌密钥材料（${embedded.join(',')}）——验证密钥只能取自预置 registry，自签自附即绕过`]);
  }

  // ---- registry / 信任锚 ----
  if (!registry) return fail(['可信 registry 不存在/不可读——fail-closed（签发体系未落地前无授权路径）']);
  const issuer = registry.issuers.find((i) => i.issuer_id === r.issuer_id);
  if (!issuer) return fail([`unknown issuer：${r.issuer_id}`]);
  const key = issuer.keys.find((k) => k.key_id === r.key_id);
  if (!key) return fail([`unknown key：${r.key_id}`]);
  if (key.revoked) return fail([`key 已吊销：${r.key_id}`]);
  if (key.alg !== r.alg) return fail([`alg 与 registry key 声明失配：${r.alg} ≠ ${key.alg}`]);

  // ---- 签名（覆盖规范化 payload 全体）----
  const data = canonicalReceiptPayload(p);
  if (r.alg === 'ed25519') {
    if (!key.public_key_pem) return fail(['registry key 缺 public_key_pem']);
    let ok = false;
    try {
      ok = crypto.verify(null, data, crypto.createPublicKey(key.public_key_pem), Buffer.from(r.signature, 'base64'));
    } catch {
      ok = false;
    }
    if (!ok) return fail(['ed25519 签名校验失败（须覆盖规范化 payload 全体）']);
  } else {
    // hmac-sha256：仅限验证密钥对 agent 不可读的部署形态（env 引用，材料不落仓）。
    // 强制 MAISON_HMAC_ 前缀——agent-invoke 按前缀从子进程 env 剥除（codex 六轮 P0-2：
    // goal agent 继承 process.env，无前缀约定则"agent 不可读"是空话）。
    if (!key.hmac_key_env) return fail(['registry key 缺 hmac_key_env（MAC 仅限密钥对 agent 不可读的形态）']);
    if (!key.hmac_key_env.startsWith(HMAC_KEY_ENV_PREFIX)) {
      return fail([`hmac_key_env 必须以 ${HMAC_KEY_ENV_PREFIX} 为前缀（agent 子进程 env 按前缀剥除）：${key.hmac_key_env}`]);
    }
    const material = process.env[key.hmac_key_env];
    if (!material) return fail([`HMAC 密钥 env 未提供：${key.hmac_key_env}（无法验证=INVALID）`]);
    const mac = crypto.createHmac('sha256', material).update(data).digest('hex');
    const given = r.signature.toLowerCase();
    const a = Buffer.from(mac, 'utf-8');
    const b = Buffer.from(given, 'utf-8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(['HMAC 校验失败']);
  }

  // ---- 绑定与时效 ----
  if (p.action !== expected.action) reasons.push(`action 失配：${p.action} ≠ ${expected.action}`);
  if (p.feature !== expected.feature) reasons.push(`feature 失配：${p.feature} ≠ ${expected.feature}`);
  if (p.object_hash !== expected.object_hash) reasons.push('object_hash 失配（授权对象已变更/不符）');
  // run_id 强制绑定（codex 六轮 P1-3：两边都有才比=可跨 run 重放）：消费方给出
  // expected.run_id 时 payload 必须携带且相等。
  if (expected.run_id) {
    if (!p.run_id) reasons.push(`payload 缺 run_id（消费方要求绑定 run=${expected.run_id}，缺失即可重放）`);
    else if (p.run_id !== expected.run_id) reasons.push(`run_id 失配：${p.run_id} ≠ ${expected.run_id}`);
  }
  const now = (expected.now ? expected.now() : new Date()).getTime();
  const issued = Date.parse(p.issued_at);
  const expiry = Date.parse(p.expiry);
  if (Number.isNaN(issued) || Number.isNaN(expiry)) reasons.push('issued_at/expiry 非法时间戳');
  else {
    if (expiry <= now) reasons.push(`receipt 已过期：${p.expiry}`);
    if (issued > now) reasons.push(`issued_at 在未来：${p.issued_at}`);
  }
  return reasons.length > 0 ? fail(reasons) : { valid: true, reasons: [] };
}

/** 文件形态消费入口（五消费点共用）：路径读入 + registry 解析 + 校验 */
export function validateConfirmationReceiptFile(
  receiptPath: string,
  registryPath: string,
  expected: ReceiptExpectation,
): ReceiptValidation {
  if (!fs.existsSync(receiptPath)) return fail([`receipt 文件不存在：${receiptPath}`]);
  let receipt: unknown;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'));
  } catch (err) {
    return fail([`receipt JSON 解析失败：${(err as Error).message}`]);
  }
  return validateConfirmationReceipt(receipt, loadTrustRegistry(registryPath), expected);
}
