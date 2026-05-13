/**
 * Lifecycle hook script runner — stdin JSON ctx → stdout JSON result.
 * Usage: node hook-runner.mjs <absolute-path-to-hook.mjs>
 */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

async function main() {
  const scriptPath = process.argv[2];
  if (!scriptPath) {
    console.error('[hook-runner] missing script path');
    process.exit(2);
    return;
  }
  const stdin = readFileSync(0, 'utf8');
  const ctx = JSON.parse(stdin || '{}');
  const url = pathToFileURL(scriptPath).href;
  const mod = await import(url);
  const fn = mod.default;
  const out = typeof fn === 'function' ? await fn(ctx) : {};
  process.stdout.write(JSON.stringify(out ?? {}));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
