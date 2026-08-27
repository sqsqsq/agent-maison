// behavior-switch-scan.unit.test.ts — t3 行为开关扫描
//
// 事故 fixture：BankAddConstants 形态（static readonly DEVICE_TEST_FAST_PATH = true）
// 必命中并指到行；测试目录排除；默认 false 不命中；legacy waiver/receipt 永不放行。

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { scanBehaviorSwitches } from '../../scripts/utils/behavior-switch-scan';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'bs-fixture';

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
      const hits = scanBehaviorSwitches({ projectRoot: root, feature: FEATURE, phase: 'testing' });
      assert.strictEqual(hits.length, 2, JSON.stringify(hits.map((h) => h.symbol)));
      const fp = hits.find((h) => h.symbol === 'DEVICE_TEST_FAST_PATH');
      assert.ok(fp, 'fast path 命中');
      assert.strictEqual(fp!.file, 'mod/src/main/ets/constant/BankAddConstants.ets');
      assert.strictEqual(fp!.line, 3);
      assert.ok(hits.some((h) => h.symbol === 'SKIP_SMS_VERIFY'));
      assert.ok(!hits.some((h) => h.symbol === 'SHOW_PROMO'), '命名不中不报');
      assert.ok(!hits.some((h) => h.symbol === 'BYPASS_AUTH'), '默认 false 不报');
      assert.ok(!hits.some((h) => h.file.includes('ohosTest')), '测试目录排除');
    },
  },
  {
    name: 'legacy waiver/receipt 文件即使存在也完全惰性，命中仍保留',
    run: () => {
      const root = mkProject();
      seed(root);
      writeFile(root, `doc/features/${FEATURE}/testing/behavior-switch-waivers.yaml`, [
        'waivers:',
        '  - file: mod/src/main/ets/constant/BankAddConstants.ets',
        '    symbol: DEVICE_TEST_FAST_PATH',
        `    content_sha256: ${'a'.repeat(64)}`,
        '    reason: 演示',
        '    receipt_path: receipts/legacy.json',
      ].join('\n'));
      writeFile(root, 'receipts/legacy.json', JSON.stringify({ action: 'behavior_switch_waiver' }));
      const hits = scanBehaviorSwitches({ projectRoot: root, feature: FEATURE, phase: 'testing' });
      assert.ok(hits.some((h) => h.symbol === 'DEVICE_TEST_FAST_PATH'));
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
