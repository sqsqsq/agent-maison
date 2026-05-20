/**
 * Resolve --plan / --steps-file paths for adhoc CLI.
 * Tries cwd first (agent often runs from framework/harness), then project root.
 */
import * as fs from 'fs';
import * as path from 'path';

export function resolveAdhocInputPath(projectRoot: string, userPath: string): string {
  const p = userPath.trim();
  if (!p) return p;
  if (path.isAbsolute(p)) {
    return path.normalize(p);
  }
  const fromCwd = path.resolve(process.cwd(), p);
  const fromProject = path.resolve(projectRoot, p);
  if (fs.existsSync(fromCwd)) return fromCwd;
  if (fs.existsSync(fromProject)) return fromProject;
  return fromCwd;
}
