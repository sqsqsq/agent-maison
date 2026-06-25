/**
 * Parse headless agent interaction sentinel from agent-output.log (chrys --json envelope).
 */

import * as fs from 'fs';

export const HEADLESS_INTERACTION_CODE = 'headless_interaction_required';

export interface HeadlessInteractionSentinel {
  code: typeof HEADLESS_INTERACTION_CODE;
  error: string;
  lineIndex: number;
}

/**
 * Scan all lines for JSON objects with code=headless_interaction_required.
 * chrys may emit multi-line --json stdout; do not assume last line only.
 */
export function parseHeadlessInteractionSentinel(
  outputLogPath: string,
): HeadlessInteractionSentinel | null {
  if (!fs.existsSync(outputLogPath)) return null;
  const raw = fs.readFileSync(outputLogPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line) as { code?: string; error?: string };
      if (obj.code === HEADLESS_INTERACTION_CODE && typeof obj.error === 'string') {
        return { code: HEADLESS_INTERACTION_CODE, error: obj.error, lineIndex: i };
      }
    } catch {
      /* not JSON on this line */
    }
  }
  return null;
}
