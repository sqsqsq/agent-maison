/**
 * Translate ad-hoc natural language steps to Hylyre planned JSON (canonical direct roots).
 */
import { FORBIDDEN_STEP_ROOT_KEY_SET } from './hylyre-planned-step-keys';

export function splitNaturalLanguageSteps(raw: string): string[] {
  return raw
    .split(/->|→|;/)
    .map(s => s.trim())
    .filter(Boolean);
}

function extractQuotedText(s: string): string | null {
  const m = s.match(/[「"']([^」"']+)[」"']/);
  return m?.[1]?.trim() ?? null;
}

/** Map one NL step to a planned step object, or null if should skip (e.g. open app). */
export function translateNaturalStepToPlanned(step: string): Record<string, unknown> | null {
  const s = step.trim();
  if (!s) return null;

  if (/^(打开|启动|launch|open)\s*(应用|app)?/i.test(s)) {
    return null;
  }
  if (/返回|back/i.test(s)) {
    return { back: {} };
  }

  const quoted = extractQuotedText(s);
  const clickMatch = s.match(/(?:点击|点|触摸|tap)\s*(.+)/i);
  const target = quoted ?? (clickMatch?.[1]?.trim() ?? null);

  if (target) {
    return { touch: { by_text: target.replace(/按钮$/, '').trim() } };
  }

  if (/滚动|下滑|向下|scroll\s*down/i.test(s)) {
    const stepsM = s.match(/(\d+)\s*(?:步|屏|次)?/);
    const steps = stepsM ? parseInt(stepsM[1], 10) : 3;
    return { scroll: { direction: 'DOWN', steps: Number.isFinite(steps) ? steps : 3 } };
  }
  if (/上滑|向上|scroll\s*up/i.test(s)) {
    return { scroll: { direction: 'UP', steps: 3 } };
  }

  if (/左滑|swipe\s*left/i.test(s)) {
    return { swipe: { direction: 'LEFT', distance: 60 } };
  }
  if (/右滑|swipe\s*right/i.test(s)) {
    return { swipe: { direction: 'RIGHT', distance: 60 } };
  }

  const bare = s.replace(/^(点击|点)\s*/, '').trim();
  if (bare.length >= 2 && bare.length <= 40) {
    return { touch: { by_text: bare } };
  }

  return null;
}

export function translateNaturalStepsToPlanned(steps: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const step of steps) {
    const planned = translateNaturalStepToPlanned(step);
    if (planned) out.push(planned);
  }
  return out;
}

export function plannedStepsToCellJson(steps: Record<string, unknown>[]): string {
  return steps.map(s => JSON.stringify(s)).join(' ; ');
}

export function validatePlannedStepObject(step: Record<string, unknown>): boolean {
  const roots = Object.keys(step);
  if (roots.length !== 1) return false;
  if (FORBIDDEN_STEP_ROOT_KEY_SET.has(roots[0])) return false;
  return true;
}
