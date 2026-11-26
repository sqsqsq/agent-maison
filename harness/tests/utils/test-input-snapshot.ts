import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';

export interface InputSnapshot {
  head: string;
  files: Record<string, string>;
  id: string;
}

export const REPO_ROOT = path.resolve(__dirname, '../../..');
const hash = (value: string | Buffer): string => crypto.createHash('sha256').update(value).digest('hex');

export function snapshotTestInputs(root = REPO_ROOT): InputSnapshot {
  const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files: Record<string, string> = {};
  const names = new Set([...git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean),
    'package-lock.json', 'harness/package-lock.json']);
  for (const file of [...names].sort()) {
    if (/^harness\/(?:dist|reports\/test-run)\//.test(file)) continue;
    try {
      const actual = path.join(root, file);
      if (fs.lstatSync(actual).isFile()) files[file] = hash(fs.readFileSync(actual));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const head = git(['rev-parse', 'HEAD']).trim();
  return { head, files, id: hash(JSON.stringify({ head, files })) };
}

if (require.main === module) process.stdout.write(JSON.stringify(snapshotTestInputs()));
