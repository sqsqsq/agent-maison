// ============================================================================
// adapter-bridge — doc/extensions/skills 扫描与 bridge id 冲突解析
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import {
  formatExtensionSkillSectionMarkdown,
  loadReservedBridgeIds,
  resolveBridgeTargets,
  scanExtensionSkills,
} from '../../scripts/utils/instance-skill-bridge';
import { detectRepoLayout } from '../../repo-layout';

const FRAMEWORK_DIR = detectRepoLayout(__dirname).frameworkRoot;

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function write(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'scanExtensionSkills：无扩展目录 → 空数组',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
      const rows = scanExtensionSkills(dir, 'doc/extensions');
      assert.deepStrictEqual(rows, []);
    },
  },
  {
    name: 'scanExtensionSkills：单个 SKILL.md → 一行',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
      write(path.join(dir, 'doc/extensions/skills/wallet-sdk-onboarding/SKILL.md'), '# Demo\n');
      const rows = scanExtensionSkills(dir, 'doc/extensions');
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].sourceSlug, 'wallet-sdk-onboarding');
      assert(
        rows[0].skillMdRepoRel.replace(/\\/g, '/').endsWith('doc/extensions/skills/wallet-sdk-onboarding/SKILL.md'),
      );
    },
  },
  {
    name: 'resolveBridgeTargets：与预留名冲突 → ext- 前缀 + 告警 + 小节含原名',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
      write(path.join(dir, 'doc/extensions/skills/3-coding/SKILL.md'), '# collide\n');
      const rows = scanExtensionSkills(dir, 'doc/extensions');
      const reserved = loadReservedBridgeIds(FRAMEWORK_DIR);
      assert.strictEqual(reserved.has('3-coding'), true);
      const { targets, warnings } = resolveBridgeTargets(rows, reserved);
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0].conflict, true);
      assert.strictEqual(targets[0].bridgeId.startsWith('ext-'), true);
      assert(warnings.some(w => w.includes('冲突')));
      const md = formatExtensionSkillSectionMarkdown(targets);
      assert(md.includes('原名'));
      assert(md.includes('3-coding'));
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
