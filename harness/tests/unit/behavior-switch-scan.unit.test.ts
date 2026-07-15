// behavior-switch-scan.unit.test.ts — t3 行为开关扫描
//
// 事故 fixture：BankAddConstants 形态（static readonly DEVICE_TEST_FAST_PATH = true）
// 必命中并指到行；测试目录排除；默认 false 不命中；waiver 坐标绑定+receipt 校验。

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  behaviorSwitchObjectHash,
  behaviorSwitchWaiversPath,
  scanBehaviorSwitches,
} from '../../scripts/utils/behavior-switch-scan';
import { canonicalReceiptPayload } from '../../scripts/utils/confirmation-receipt';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'bs-fixture';
const NOW = () => new Date('2026-07-13T12:00:00.000Z');

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-bswitch-'));
  clearFrameworkConfigCache();
  return root;
}

function writeFile(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

const INCIDENT_CONSTANTS = [
  'export class BankAddConstants {',
  '  static readonly TOP_BANK_LIMIT: number = 6;',
  '  static readonly DEVICE_TEST_FAST_PATH: boolean = true;',
  '  static readonly SHOW_PROMO: boolean = true;', // 命名不命中 → 不报
  '}',
].join('\n');

function seed(root: string): void {
  writeFile(root, 'mod/src/main/ets/constant/BankAddConstants.ets', INCIDENT_CONSTANTS);
  writeFile(root, 'mod/src/main/ets/pages/Page.ets', 'const SKIP_SMS_VERIFY = true;\nconst BYPASS_AUTH = false;\n');
  writeFile(root, 'mod/src/ohosTest/ets/helper.ets', 'const DEVICE_TEST_FAST_PATH = true;\n'); // 测试目录合法
}

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: '事故 fixture：DEVICE_TEST_FAST_PATH=true 命中并指到行；默认 false/命名不中/测试目录不报',
    run: () => {
      const root = mkProject();
      seed(root);
      const hits = scanBehaviorSwitches({ projectRoot: root, feature: FEATURE, phase: 'testing', now: NOW });
      assert.strictEqual(hits.length, 2, JSON.stringify(hits.map((h) => h.symbol)));
      const fp = hits.find((h) => h.symbol === 'DEVICE_TEST_FAST_PATH');
      assert.ok(fp, 'fast path 命中');
      assert.strictEqual(fp!.file, 'mod/src/main/ets/constant/BankAddConstants.ets');
      assert.strictEqual(fp!.line, 3);
      assert.strictEqual(fp!.waived, false);
      assert.ok(hits.some((h) => h.symbol === 'SKIP_SMS_VERIFY'));
      assert.ok(!hits.some((h) => h.symbol === 'SHOW_PROMO'), '命名不中不报');
      assert.ok(!hits.some((h) => h.symbol === 'BYPASS_AUTH'), '默认 false 不报');
      assert.ok(!hits.some((h) => h.file.includes('ohosTest')), '测试目录排除');
    },
  },
  {
    name: 'waiver：无 receipt 不生效；坐标 sha 失配不生效；合法 receipt → waived',
    run: () => {
      const root = mkProject();
      seed(root);
      const fileRel = 'mod/src/main/ets/constant/BankAddConstants.ets';
      const fileSha = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(root, fileRel), 'utf-8'), 'utf-8').digest('hex');

      // ① 无 receipt_path → 不生效
      const waiverPath = behaviorSwitchWaiversPath(root, FEATURE, 'testing');
      fs.mkdirSync(path.dirname(waiverPath), { recursive: true });
      fs.writeFileSync(waiverPath, [
        'waivers:',
        `  - file: ${fileRel}`,
        '    symbol: DEVICE_TEST_FAST_PATH',
        `    content_sha256: ${fileSha}`,
        '    reason: 演示',
      ].join('\n'), 'utf-8');
      let hits = scanBehaviorSwitches({ projectRoot: root, feature: FEATURE, phase: 'testing', now: NOW });
      let fp = hits.find((h) => h.symbol === 'DEVICE_TEST_FAST_PATH')!;
      assert.strictEqual(fp.waived, false);
      assert.ok(fp.waiver_reasons!.some((r) => r.includes('缺 receipt_path')));

      // ② 合法 receipt（ed25519 + registry 预置）→ waived。registry 不得在项目根
      //   （agent 可写区）——经 MAISON_TRUST_REGISTRY env 指向项目外预置文件。
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const regPath = path.join(root, '..', `reg-${path.basename(root)}.json`);
      fs.writeFileSync(regPath, JSON.stringify({
        schema_version: '1.0',
        issuers: [{ issuer_id: 'ops', keys: [{ key_id: 'k1', alg: 'ed25519', public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }] }],
      }), 'utf-8');
      process.env.MAISON_TRUST_REGISTRY = regPath;
      const payload = {
        action: 'behavior_switch_waiver' as const,
        feature: FEATURE,
        object_hash: behaviorSwitchObjectHash(fileRel, 'DEVICE_TEST_FAST_PATH', fileSha),
        issued_at: '2026-07-13T11:00:00.000Z',
        expiry: '2026-07-14T00:00:00.000Z',
      };
      const receipt = {
        schema_version: '1.0', receipt_id: 'r1', issuer_id: 'ops', key_id: 'k1', alg: 'ed25519',
        payload_schema_version: '1.0', payload,
        signature: crypto.sign(null, canonicalReceiptPayload(payload), privateKey).toString('base64'),
      };
      writeFile(root, 'receipts/bs.json', JSON.stringify(receipt));
      fs.writeFileSync(waiverPath, [
        'waivers:',
        `  - file: ${fileRel}`,
        '    symbol: DEVICE_TEST_FAST_PATH',
        `    content_sha256: ${fileSha}`,
        '    reason: 演示',
        '    receipt_path: receipts/bs.json',
      ].join('\n'), 'utf-8');
      try {
        hits = scanBehaviorSwitches({ projectRoot: root, feature: FEATURE, phase: 'testing', now: NOW });
        fp = hits.find((h) => h.symbol === 'DEVICE_TEST_FAST_PATH')!;
        assert.strictEqual(fp.waived, true, (fp.waiver_reasons ?? []).join('；'));

        // ③ 文件内容变化 → sha 失配 → waiver 失效
        fs.appendFileSync(path.join(root, fileRel), '\n// changed\n', 'utf-8');
        hits = scanBehaviorSwitches({ projectRoot: root, feature: FEATURE, phase: 'testing', now: NOW });
        fp = hits.find((h) => h.symbol === 'DEVICE_TEST_FAST_PATH')!;
        assert.strictEqual(fp.waived, false, '坐标 sha 失配即失效');
      } finally {
        delete process.env.MAISON_TRUST_REGISTRY;
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `behavior-switch-scan: ${c.name}`, ok: true };
    } catch (err) {
      return { name: `behavior-switch-scan: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
