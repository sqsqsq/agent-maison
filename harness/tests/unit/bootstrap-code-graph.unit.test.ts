// ============================================================================
// bootstrap-code-graph — packagePath 安全校验单测
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { validateProjectRelativePath } from '../../scripts/utils/project-relative-path';
import type { UnitCaseResult } from '../run-unit';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-code-graph-'));
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'validateProjectRelativePath：合法相对路径通过',
    run: () => {
      const root = mkTmp();
      try {
        assert.strictEqual(
          validateProjectRelativePath(root, '02-Feature/WalletHome', '--package-path'),
          '02-Feature/WalletHome',
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'validateProjectRelativePath：拒绝 .. 段',
    run: () => {
      const root = mkTmp();
      try {
        assert.throws(
          () => validateProjectRelativePath(root, '../outside', '--package-path'),
          /不得包含 "\.\."/,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'validateProjectRelativePath：拒绝绝对路径',
    run: () => {
      const root = mkTmp();
      try {
        assert.throws(
          () => validateProjectRelativePath(root, '/etc/passwd', '--package-path'),
          /必须是相对 project-root 的安全路径/,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'validateProjectRelativePath：拒绝 Windows 盘符路径',
    run: () => {
      const root = mkTmp();
      try {
        assert.throws(
          () => validateProjectRelativePath(root, 'C:/Windows', '--package-path'),
          /必须是相对 project-root 的安全路径/,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
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
