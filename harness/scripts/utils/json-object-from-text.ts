export function extractJsonObjectFromText(
  body: string,
  onInvalid?: (reason: string) => void,
): Record<string, unknown> | null {
  const errors: string[] = [];
  const tryParse = (s: string, candidate: string, offset: number): Record<string, unknown> | null => {
    try {
      const doc = JSON.parse(s) as unknown;
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) return doc as Record<string, unknown>;
      errors.push(`${candidate}: expected a JSON object, actual ${s.slice(0, 120)}`);
      return null;
    } catch (error) {
      const message = (error as Error).message;
      let position = /\bposition (\d+)/i.exec(message)?.[1];
      if (position === undefined && /Unexpected end of JSON input/i.test(message)) position = String(s.length);
      const lineColumn = /\bline (\d+) column (\d+)/i.exec(message);
      if (position === undefined && lineColumn) {
        const lines = s.split('\n');
        position = String(lines.slice(0, Number(lineColumn[1]) - 1).reduce((n, line) => n + line.length + 1, 0)
          + Number(lineColumn[2]) - 1);
      }
      const at = position === undefined ? s.length : Number(position);
      errors.push(`${candidate}: ${message}; ${position === undefined ? 'position unavailable' : `candidate position ${at}, body position ${offset + at}`} (zero-based); context=${JSON.stringify(s.slice(Math.max(0, at - 60), at + 60))}`);
      return null;
    }
  };
  const trimmed = body.trim();
  const trimOffset = body.indexOf(trimmed);
  const direct = tryParse(trimmed, 'whole body', trimOffset);
  if (direct) return direct;

  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  let lastFenced: Record<string, unknown> | null = null;
  let fenceIndex = 0;
  while ((m = fence.exec(body)) !== null) {
    const raw = m[1] ?? '';
    const candidate = raw.trim();
    const parsed = tryParse(candidate, `fence[${fenceIndex++}]`, m.index + m[0].indexOf(raw) + raw.indexOf(candidate));
    if (parsed) lastFenced = parsed;
  }
  if (lastFenced) return lastFenced;

  // 裸对象夹在散文里：取第一个 `{` 到最后一个 `}` 的闭包再试一次（只试一次，不做括号回溯）。
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const parsed = tryParse(trimmed.slice(first, last + 1), 'bare object', trimOffset + first);
    if (parsed) return parsed;
  }
  onInvalid?.(errors.join('\n'));
  return null;
}
