/**
 * Scan first `"type": "entry"` module.json5 for mainElement (regex on json5 source).
 */
import * as fs from 'fs';
import * as path from 'path';

const MODULE_JSON_SKIP_DIRS = new Set([
  'node_modules',
  'oh_modules',
  'build',
  '.git',
  '.hvigor',
  'dist',
  'out',
]);

export function discoverEntryMainElement(projectRoot: string): string | null {
  const hits: string[] = [];
  const rootAbs = path.resolve(projectRoot);

  function walk(dir: string, depth: number): void {
    if (depth > 16) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (MODULE_JSON_SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p, depth + 1);
      } else if (e.name === 'module.json5') {
        let raw: string;
        try {
          raw = fs.readFileSync(p, 'utf-8');
        } catch {
          continue;
        }
        if (!/"type"\s*:\s*"entry"/.test(raw)) continue;
        const m = raw.match(/"mainElement"\s*:\s*"([^"]+)"/);
        if (m?.[1]) hits.push(m[1]);
      }
    }
  }

  walk(rootAbs, 0);
  return hits[0] ?? null;
}
