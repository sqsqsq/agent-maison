/**
 * Hylyre `app page save` CLI 参数拼装（BUNDLE + NAME 位置参数，非 --bundle）。
 */

export function resolveHylyrePageSaveSlug(explicit?: string | null): string {
  const fromEnv = process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME?.trim();
  if (explicit?.trim()) return explicit.trim();
  if (fromEnv) return fromEnv;
  return 'home';
}

/** HARNESS_HYLYRE_PAGE_SAVE_NAMES (comma) > HARNESS_HYLYRE_PAGE_SAVE_NAME > home */
export function resolveHylyrePageSaveNames(explicitSlug?: string | null): string[] {
  const fromNames = process.env.HARNESS_HYLYRE_PAGE_SAVE_NAMES?.trim();
  if (fromNames) {
    const parts = fromNames
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts;
  }
  return [resolveHylyrePageSaveSlug(explicitSlug)];
}

/** 返回 spawn 用的参数列表（含 `python -m` 前缀之后的 hylyre 子命令）。 */
export function buildHylyreAppPageSaveArgv(args: {
  bundleName: string;
  pageSlug?: string | null;
  deviceSn?: string;
  abilityName?: string | null;
}): string[] {
  const slug = resolveHylyrePageSaveSlug(args.pageSlug);
  const argv: string[] = ['-m', 'hylyre', 'app', 'page', 'save', args.bundleName, slug];
  const ability = args.abilityName?.trim();
  if (ability) {
    argv.push('--ability', ability);
  }
  if (args.deviceSn?.trim()) {
    argv.push('--device-sn', args.deviceSn.trim());
  }
  const autoFp = process.env.HARNESS_HYLYRE_PAGE_SAVE_AUTO_FINGERPRINT?.trim().toLowerCase();
  if (autoFp === '1' || autoFp === 'true' || autoFp === 'yes') {
    argv.push('--auto-fingerprint');
  }
  return argv;
}
