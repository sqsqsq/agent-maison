function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match a complete acceptance/boundary id without AC↔BD prefix coercion. */
export function hasExactUtScopeTag(itName: string, scopeId: string): boolean {
  return new RegExp(`\\[${escapeRegExp(scopeId.trim())}\\]`, 'i').test(itName);
}

export function hasExactUtBranchTag(itName: string, branchId: string): boolean {
  return new RegExp(`\\[BRANCH-${escapeRegExp(branchId.trim())}\\]`, 'i').test(itName);
}
