/**
 * Extract the coarse `it('<name>', ..., () => { ... })` blocks used by UT gates.
 *
 * This intentionally preserves the historical check-ut parser semantics. It is
 * not an ArkTS parser; sharing it keeps scope discovery and coverage checks from
 * disagreeing about which test names exist.
 */
export interface UtItBlock {
  name: string;
  body: string;
}

export function extractUtItBlocks(content: string): UtItBlock[] {
  const blocks: UtItBlock[] = [];
  const itRe = /it\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;

  while ((match = itRe.exec(content)) !== null) {
    const name = match[1];
    const startIdx = match.index;
    let braceCount = 0;
    let bodyStart = -1;
    let bodyEnd = -1;

    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === '{') {
        if (bodyStart === -1) bodyStart = i;
        braceCount++;
      } else if (content[i] === '}') {
        braceCount--;
        if (braceCount === 0 && bodyStart !== -1) {
          bodyEnd = i;
          break;
        }
      }
    }

    if (bodyStart !== -1 && bodyEnd !== -1) {
      blocks.push({ name, body: content.substring(bodyStart, bodyEnd + 1) });
    }
  }

  return blocks;
}
