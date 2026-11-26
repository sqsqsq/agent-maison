import * as path from 'node:path';

export function testCliArgs(entry: string, fallback = ['-r', require.resolve('ts-node/register/transpile-only')]): string[] {
  const loader = require.extensions['.ts'] as { precompiledTestRuntime?: boolean } | undefined;
  const bootstrap = loader?.precompiledTestRuntime ? [path.resolve(__dirname, '../compiled-entry.cjs')] : fallback;
  return [...bootstrap, entry];
}
