/**
 * Mechanical split of ad-hoc NL step chains (no semantic translation).
 */
export function splitNaturalLanguageSteps(raw: string): string[] {
  return raw
    .split(/->|→|;/)
    .map(s => s.trim())
    .filter(Boolean);
}
