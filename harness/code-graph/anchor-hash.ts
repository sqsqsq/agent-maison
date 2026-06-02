/**
 * Code Graph 锚定 content_hash（与 drift 闸门一致）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export function sha256ContentHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

export function extractSymbolBody(source: string, symbol: string): string | null {
  const re = new RegExp(
    `(?:async\\s+)?(?:public\\s+|private\\s+|protected\\s+)?(?:\\w+\\s+)*${symbol}\\s*\\([^)]*\\)[^{]*\\{`,
    'm',
  );
  const m = source.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** 从工程根相对路径读取符号体并计算 hash；找不到符号返回 null。 */
export function computeAnchorContentHash(
  projectRoot: string,
  relFile: string,
  symbol: string,
): string | null {
  const abs = path.isAbsolute(relFile) ? relFile : path.join(projectRoot, relFile);
  if (!fs.existsSync(abs)) return null;
  const source = fs.readFileSync(abs, 'utf-8');
  if (!source.includes(symbol)) return null;
  const body = extractSymbolBody(source, symbol);
  if (!body) return null;
  return sha256ContentHash(body);
}
