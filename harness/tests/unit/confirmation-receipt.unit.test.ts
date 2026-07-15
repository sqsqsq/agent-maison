// confirmation-receipt.unit.test.ts — t10 统一凭证消费（信任锚六条款）
//
// 关键回归（codex 终审 P1）：agent 自生成密钥自签+附内嵌公钥 → INVALID；
// unknown issuer/key/alg → INVALID；registry 缺失 fail-closed；吊销/过期/绑定失配。

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  canonicalReceiptPayload,
  defaultTrustRegistryPath,
  validateConfirmationReceipt,
  validateConfirmationReceiptFile,
  type ConfirmationReceipt,
  type ConfirmationReceiptPayload,
  type TrustRegistry,
} from '../../scripts/utils/confirmation-receipt';
import type { UnitCaseResult } from '../run-unit';

const NOW = () => new Date('2026-07-13T12:00:00.000Z');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function mkPayload(over?: Partial<ConfirmationReceiptPayload>): ConfirmationReceiptPayload {
  return {
    action: 'p0_skip_waiver',
    feature: 'f1',
    object_hash: 'a'.repeat(64),
    issued_at: '2026-07-13T11:00:00.000Z',
    expiry: '2026-07-14T00:00:00.000Z',
    run_id: 'RUN1',
    ...over,
  };
}

function sign(payload: ConfirmationReceiptPayload, key: crypto.KeyObject = privateKey): string {
  return crypto.sign(null, canonicalReceiptPayload(payload), key).toString('base64');
}

function mkReceipt(over?: Partial<ConfirmationReceipt>, payloadOver?: Partial<ConfirmationReceiptPayload>): ConfirmationReceipt {
  const payload = mkPayload(payloadOver);
  return {
    schema_version: '1.0',
    receipt_id: 'r-1',
    issuer_id: 'ops-team',
    key_id: 'k1',
    alg: 'ed25519',
    payload_schema_version: '1.0',
    payload,
    signature: sign(payload),
    ...over,
  };
}

const REGISTRY: TrustRegistry = {
  schema_version: '1.0',
  issuers: [{ issuer_id: 'ops-team', keys: [{ key_id: 'k1', alg: 'ed25519', public_key_pem: PUB_PEM }] }],
};

const EXPECTED = { action: 'p0_skip_waiver' as const, feature: 'f1', object_hash: 'a'.repeat(64), run_id: 'RUN1', now: NOW };

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: '合法 ed25519 receipt → valid；payload 任一字段被改 → 签名失败',
    run: () => {
      const v = validateConfirmationReceipt(mkReceipt(), REGISTRY, EXPECTED);
      assert.strictEqual(v.valid, true, v.reasons.join('；'));
      // 签名覆盖全体：改 payload 不重签 → INVALID
      const tampered = mkReceipt();
      tampered.payload = { ...tampered.payload, target_value: 'semantic_layout' };
      const v2 = validateConfirmationReceipt(tampered, REGISTRY, EXPECTED);
      assert.strictEqual(v2.valid, false);
      assert.ok(v2.reasons.some((r) => r.includes('签名校验失败')));
    },
  },
  {
    name: '自签+内嵌公钥（codex 回归）：receipt 携密钥材料即拒收；registry 不认自生成 key',
    run: () => {
      // 攻击 A：agent 自生成密钥对，receipt 附上公钥
      const atk = crypto.generateKeyPairSync('ed25519');
      const payload = mkPayload();
      const evil = {
        ...mkReceipt(),
        payload,
        signature: sign(payload, atk.privateKey),
        public_key_pem: atk.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      };
      const v = validateConfirmationReceipt(evil, REGISTRY, EXPECTED);
      assert.strictEqual(v.valid, false);
      assert.ok(v.reasons.some((r) => r.includes('内嵌密钥材料')));
      // 攻击 B：不内嵌，但用自生成 key 自签 + 声称新 key_id → unknown key
      const evil2 = { ...mkReceipt({ key_id: 'k-evil' }), signature: sign(payload, atk.privateKey) };
      const v2 = validateConfirmationReceipt(evil2, REGISTRY, EXPECTED);
      assert.strictEqual(v2.valid, false);
      assert.ok(v2.reasons.some((r) => r.includes('unknown key')));
    },
  },
  {
    name: 'unknown issuer/alg、吊销、registry 缺失 → 全部 INVALID（fail-closed）',
    run: () => {
      assert.strictEqual(validateConfirmationReceipt(mkReceipt({ issuer_id: 'nobody' }), REGISTRY, EXPECTED).valid, false);
      assert.strictEqual(validateConfirmationReceipt(mkReceipt({ alg: 'rsa-md5' }), REGISTRY, EXPECTED).valid, false);
      const revoked: TrustRegistry = {
        schema_version: '1.0',
        issuers: [{ issuer_id: 'ops-team', keys: [{ key_id: 'k1', alg: 'ed25519', public_key_pem: PUB_PEM, revoked: true }] }],
      };
      const vr = validateConfirmationReceipt(mkReceipt(), revoked, EXPECTED);
      assert.strictEqual(vr.valid, false);
      assert.ok(vr.reasons.some((r) => r.includes('吊销')));
      const vnull = validateConfirmationReceipt(mkReceipt(), null, EXPECTED);
      assert.strictEqual(vnull.valid, false);
      assert.ok(vnull.reasons.some((r) => r.includes('fail-closed')));
    },
  },
  {
    name: '绑定与时效：action/feature/object_hash/run_id 失配、过期、issued_at 在未来',
    run: () => {
      const bad = (payloadOver: Partial<ConfirmationReceiptPayload>, needle: string): void => {
        const p = mkPayload(payloadOver);
        const rec = { ...mkReceipt(), payload: p, signature: sign(p) };
        const v = validateConfirmationReceipt(rec, REGISTRY, EXPECTED);
        assert.strictEqual(v.valid, false, needle);
        assert.ok(v.reasons.some((r) => r.includes(needle)), `${needle}: ${v.reasons.join('；')}`);
      };
      bad({ action: 'fidelity_downgrade' }, 'action 失配');
      bad({ feature: 'other' }, 'feature 失配');
      bad({ object_hash: 'b'.repeat(64) }, 'object_hash 失配');
      bad({ run_id: 'RUN9' }, 'run_id 失配');
      bad({ expiry: '2026-07-13T11:59:00.000Z' }, '已过期');
      bad({ issued_at: '2027-01-01T00:00:00.000Z' }, '在未来');
    },
  },
  {
    name: 'HMAC：仅限 env 引用材料；env 未提供=INVALID；材料在位且匹配 → valid',
    run: () => {
      const material = 'super-secret-material';
      const payload = mkPayload();
      const mac = crypto.createHmac('sha256', material).update(canonicalReceiptPayload(payload)).digest('hex');
      const rec = mkReceipt({ alg: 'hmac-sha256', key_id: 'kmac', signature: mac });
      // env key 必须 MAISON_HMAC_ 前缀（agent 子进程按前缀剥除）
      const reg: TrustRegistry = {
        schema_version: '1.0',
        issuers: [{ issuer_id: 'ops-team', keys: [{ key_id: 'kmac', alg: 'hmac-sha256', hmac_key_env: 'MAISON_HMAC_TEST' }] }],
      };
      // 无前缀 env → 拒收
      const badReg: TrustRegistry = {
        schema_version: '1.0',
        issuers: [{ issuer_id: 'ops-team', keys: [{ key_id: 'kmac', alg: 'hmac-sha256', hmac_key_env: 'MAISON_TEST_HMAC_KEY' }] }],
      };
      assert.ok(validateConfirmationReceipt(rec, badReg, EXPECTED).reasons.some((r) => r.includes('前缀')));
      delete process.env.MAISON_HMAC_TEST;
      let v = validateConfirmationReceipt(rec, reg, EXPECTED);
      assert.strictEqual(v.valid, false);
      assert.ok(v.reasons.some((r) => r.includes('env 未提供')));
      process.env.MAISON_HMAC_TEST = material;
      try {
        v = validateConfirmationReceipt(rec, reg, EXPECTED);
        assert.strictEqual(v.valid, true, v.reasons.join('；'));
      } finally {
        delete process.env.MAISON_HMAC_TEST;
      }
    },
  },
  {
    name: '信任锚（codex 六轮 P0-2）：defaultTrustRegistryPath 不解析到项目根——agent 自建 registry 无效',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-reg-'));
      const cwd = process.cwd();
      // 攻击：agent 在项目根写 registry + 自签
      const atk = crypto.generateKeyPairSync('ed25519');
      fs.writeFileSync(path.join(root, 'confirmation-trust-registry.json'), JSON.stringify({
        schema_version: '1.0',
        issuers: [{ issuer_id: 'self', keys: [{ key_id: 'kx', alg: 'ed25519', public_key_pem: atk.publicKey.export({ type: 'spki', format: 'pem' }).toString() }] }],
      }), 'utf-8');
      const payload = mkPayload();
      const selfSigned = {
        schema_version: '1.0', receipt_id: 'r', issuer_id: 'self', key_id: 'kx', alg: 'ed25519',
        payload_schema_version: '1.0', payload, signature: crypto.sign(null, canonicalReceiptPayload(payload), atk.privateKey).toString('base64'),
      };
      fs.writeFileSync(path.join(root, 'r.json'), JSON.stringify(selfSigned), 'utf-8');
      // 消费入口用 defaultTrustRegistryPath(root) —— 不得取项目根 registry
      delete process.env.MAISON_TRUST_REGISTRY;
      const resolved = defaultTrustRegistryPath(root);
      assert.ok(!path.resolve(resolved).startsWith(path.resolve(root) + path.sep), `registry 不得在项目根内：${resolved}`);
      const v = validateConfirmationReceiptFile(path.join(root, 'r.json'), resolved, EXPECTED);
      assert.strictEqual(v.valid, false, '项目根自建 registry 的自签 receipt 必须 INVALID');
      void cwd;
    },
  },
  {
    name: '文件消费入口：缺文件/坏 JSON/合法路径三态',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-receipt-'));
      const regPath = path.join(dir, 'registry.json');
      fs.writeFileSync(regPath, JSON.stringify(REGISTRY), 'utf-8');
      const rPath = path.join(dir, 'r.json');
      assert.strictEqual(validateConfirmationReceiptFile(rPath, regPath, EXPECTED).valid, false);
      fs.writeFileSync(rPath, '{broken', 'utf-8');
      assert.strictEqual(validateConfirmationReceiptFile(rPath, regPath, EXPECTED).valid, false);
      fs.writeFileSync(rPath, JSON.stringify(mkReceipt()), 'utf-8');
      assert.strictEqual(validateConfirmationReceiptFile(rPath, regPath, EXPECTED).valid, true);
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `confirmation-receipt: ${c.name}`, ok: true };
    } catch (err) {
      return { name: `confirmation-receipt: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
