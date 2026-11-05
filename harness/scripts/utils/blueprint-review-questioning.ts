import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BlueprintRecord, asRecord, asRecords, blueprintAuthorContent } from './component-blueprint-model';
import { stableStringify } from './phase-evidence-manifest';
import { sessionEvents } from './session-execution-handoff';

export interface ReviewQuestioningItem {
  item: BlueprintRecord;
  original?: BlueprintRecord;
  outcome: 'blocker' | 'open_decision' | 'changed' | 'withdrawn';
  originals: string[];
}
export interface ReviewQuestioning {
  items: ReviewQuestioningItem[];
  hasOriginals: boolean;
  originals: string[];
}

/** No run is required to show unresolved facts already carried by the blueprint. */
export function blueprintQuestioningFallback(blueprint: BlueprintRecord): ReviewQuestioning {
  return { hasOriginals: false, originals: [], items: asRecords(asRecord(asRecord(blueprint.review_summary)?.questioning)?.items)
    .filter(item => item.disposition === 'blocker' || item.disposition === 'open_decision')
    .map(item => ({ item, outcome: item.disposition as 'blocker' | 'open_decision', originals: [] })) };
}

/** Rebuild scope outcomes from this blueprint workspace, never from an independent issue ledger. */
export function collectReviewQuestioning(projectRoot: string, blueprint: BlueprintRecord, canonicalPath: string,
  changeUnitPaths: readonly string[]): ReviewQuestioning {
  const directories = new Set([path.join(path.dirname(path.dirname(canonicalPath)), 'goal-runs'),
    ...changeUnitPaths.map(file => path.join(path.dirname(file), 'goal-runs'))]);
  if (![...directories].some(directory => fs.existsSync(directory))) return blueprintQuestioningFallback(blueprint);
  // The repair publisher imports materialization; load its shared evidence reader after module initialization.
  const { readDesignQuestioningOriginal, reusableDesignQuestioning } = require('./design-repair-unattended') as typeof import('./design-repair-unattended');
  const rounds: Array<{ time: string; order: number; blueprint: BlueprintRecord; result: BlueprintRecord; originals: string[] }> = [];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const runDir = path.join(directory, entry.name);
      try {
        const events = sessionEvents(runDir);
        for (const [order, start] of events.entries()) {
          if (start.type !== 'agent_invoke_start' || !['initial-design-questioning', 'design-repair-questioning'].includes(String(start.phase))) continue;
          const original = readDesignQuestioningOriginal(runDir, start, events);
          if (!original?.completed) continue;
          const before = original.beforeDocument;
          if (!before || before.blueprint_id !== blueprint.blueprint_id || before.component_id !== blueprint.component_id) continue;
          const result = reusableDesignQuestioning({ ...original, additionalInputs: {}, projectRoot, blueprintPath: canonicalPath, blueprint: before });
          if (!result) continue;
          const accepted = events.find(event => event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id && event.handoff_report);
          const output = fs.existsSync(original.source) ? original.source
            : accepted?.handoff_report ? path.resolve(runDir, accepted.handoff_report.path) : undefined;
          if (!output || !fs.existsSync(output)) continue;
          const beforeFile = path.join(runDir, 'phases', String(start.phase), String(start.invoke_id), 'blueprint-before.yaml');
          rounds.push({ time: String(start.ts ?? ''), order, blueprint: before, result,
            originals: [output, ...(fs.existsSync(beforeFile) ? [beforeFile] : [])]
              .map(file => path.relative(path.dirname(canonicalPath), file).replace(/\\/g, '/')) });
        }
      } catch { /* Unreadable runs cannot prove a scope was closed. */ }
    }
  }
  if (!rounds.length) return blueprintQuestioningFallback(blueprint);
  type Denial = { item: BlueprintRecord; author: string; originals: string[] };
  const scopes = new Map<string, { current?: ReviewQuestioningItem; denial?: Denial }>();
  for (const round of rounds.sort((a, b) => a.time.localeCompare(b.time) || a.order - b.order)) {
    const author = crypto.createHash('sha256').update(stableStringify(blueprintAuthorContent(round.blueprint))).digest('hex');
    for (const item of asRecords(round.result.items)) {
      const scope = String(item.scope_ref);
      const state = scopes.get(scope) ?? {};
      if (item.disposition === 'blocker') {
        // Reopening starts another episode; repeated denials retain the original issue until an explicit close.
        if (!state.denial) state.denial = { item, author, originals: round.originals };
        state.current = { item, outcome: 'blocker', originals: round.originals };
      } else if (item.disposition === 'open_decision') {
        state.current = { item, outcome: 'open_decision', originals: round.originals };
      } else if (['answered_with_evidence', 'decided_with_authority', 'not_applicable'].includes(String(item.disposition))) {
        if (state.denial) {
          state.current = { item, original: state.denial.item, outcome: state.denial.author === author ? 'withdrawn' : 'changed',
            originals: [...new Set([...state.denial.originals, ...round.originals])] };
          delete state.denial;
        } else if (state.current?.outcome === 'open_decision') delete state.current;
      }
      scopes.set(scope, state);
    }
  }
  return { hasOriginals: true, originals: rounds[rounds.length - 1].originals,
    items: [...scopes.values()].flatMap(state => state.current ? [state.current] : []) };
}
