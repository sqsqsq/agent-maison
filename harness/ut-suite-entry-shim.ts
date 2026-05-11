/**
 * 宿主 UT「仅导出 testsuite、用例在其它 *.test.ets」的入口文件判定。
 * 由 profile `ut-host-impl` 与根 `check-ut`（无 UtHost 时的 fallback）共用，避免正则双写漂移。
 */
export function isSuiteEntryShimContent(content: string): boolean {
  return /export\s+default\s+function\s+testsuite\s*\(/.test(content) && !/\bdescribe\s*\(/.test(content);
}
