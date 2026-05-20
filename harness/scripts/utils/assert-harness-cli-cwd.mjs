// assert-harness-cli-cwd.mjs — 在 harness cwd 下误用 framework/harness/scripts/ 前缀时提示
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} scriptFileName 如 render-agents-md.mjs
 */
export function assertHarnessCliCwd(scriptFileName) {
  const cwdNorm = process.cwd().replace(/\\/g, '/');
  if (!cwdNorm.endsWith('/framework/harness') && !cwdNorm.endsWith('/framework/harness/')) {
    return;
  }
  const rawArg = process.argv[1] ?? '';
  if (path.isAbsolute(rawArg)) {
    return;
  }
  const arg = rawArg.replace(/\\/g, '/');
  if (!arg.startsWith('framework/harness/scripts/')) {
    return;
  }
  const label = scriptFileName || path.basename(fileURLToPath(import.meta.url));
  process.stderr.write(
    `[${label}] 当前 shell cwd 在 framework/harness/，禁止再写 framework/harness/scripts/ 前缀（会拼成 …/framework/harness/framework/harness/…）。\n` +
      `  请改用: node scripts/${label} …\n` +
      `  或先 cd 到实例工程根: node framework/harness/scripts/${label} …\n` +
      `  详见 framework/skills/reference/harness-cli-cwd.md\n`,
  );
  process.exit(1);
}
