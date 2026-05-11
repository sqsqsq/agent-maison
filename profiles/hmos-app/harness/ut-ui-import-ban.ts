// ============================================================================
// UT 源码中禁止出现的 UI / 导航 / 资源运行时符号（hmos-app / Hypium）
// ============================================================================
// 由 check-ut.ts 的 ut_import_whitelist 规则按 profile 动态加载。
// ============================================================================

/** UT 文件中禁止出现的 UI/导航/Toast 符号模式（与历史 check-ut 内联列表对齐） */
export const UI_FORBIDDEN_PATTERNS: RegExp[] = [
  /@Component\b/,
  /@Entry\b/,
  /@Preview\b/,
  /@Consume\b/,
  /@Provide\b/,
  /\bNavPathStack\b/,
  /\bNavDestination\b/,
  /@kit\.ArkUI/,
  /@kit\.ArkGraphics/,
  /\$r\s*\(/,
  /\$rawfile\s*\(/,
  /\bgetUIContext\b/,
  /\bPromptAction\b/,
  /\bshowToast\b/,
  /@aspect\/CommUI/,
  /\bAppStorage\b/,
  /\bLocalStorage\b/,
];

export function scanForbiddenImports(content: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*import\b/.test(line) && !/^\s*from\s+['"]/.test(line)) continue;
    for (const re of patterns) {
      if (re.test(line)) hits.push(`L${i + 1}: ${line.trim()}`);
    }
  }
  const bodyPatterns = patterns.filter(p =>
    /(\\\$r|showToast|getUIContext|NavPathStack|NavDestination)/.test(p.source),
  );
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*import\b/.test(line) || /^\s*from\s+['"]/.test(line)) continue;
    for (const re of bodyPatterns) {
      if (re.test(line)) hits.push(`L${i + 1}: ${line.trim()}`);
    }
  }
  return [...new Set(hits)];
}
