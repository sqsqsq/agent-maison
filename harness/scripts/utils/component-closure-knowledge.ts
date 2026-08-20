import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { asRecord, asRecords, asStrings } from './component-blueprint-model';
import { validateProjectRelativePath } from './project-relative-path';
import { ResolvedComponentClosureInputs } from './component-closure-inputs';
import { ComponentClosureIssue, closureIssue, stableSortStrings } from './component-closure-model';

function splitKnowledgeRef(rawRef: string): { file: string; conclusionId: string } | null {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawRef)) return null;
  const hash = rawRef.indexOf('#');
  if (hash < 1 || hash === rawRef.length - 1) return null;
  return { file: rawRef.slice(0, hash), conclusionId: rawRef.slice(hash + 1) };
}

function containsExactConclusion(value: unknown, conclusionId: string): boolean {
  if (value === conclusionId) return true;
  if (Array.isArray(value)) return value.some(item => containsExactConclusion(item, conclusionId));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .some(([key, item]) => key === conclusionId || containsExactConclusion(item, conclusionId));
  }
  return false;
}

function resolvesConclusion(file: string, content: string, conclusionId: string): boolean {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.yaml' || extension === '.yml') {
    try { return containsExactConclusion(YAML.parse(content), conclusionId); } catch { return false; }
  }
  if (extension === '.json') {
    try { return containsExactConclusion(JSON.parse(content), conclusionId); } catch { return false; }
  }
  return content.split(/\r?\n/).some(line => {
    const normalized = line.trim().replace(/^#{1,6}\s+/, '');
    return normalized === conclusionId;
  });
}

export function validateComponentClosureKnowledge(
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
): { refs: string[]; issues: ComponentClosureIssue[] } {
  const issues: ComponentClosureIssue[] = [];
  const discovery = asRecord(inputs.blueprint.blueprint.discovery);
  const inputBlock = asRecord(discovery?.inputs);
  const allowedAssets = new Set(asStrings(inputBlock?.knowledge_assets).filter(ref => !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)));
  const decisions = asRecords(asRecord(inputs.blueprint.blueprint.decisions_and_gaps)?.decisions)
    .filter(decision => decision.status === 'decided_with_authority');
  const refs: string[] = [];
  for (const decision of decisions) {
    const decisionId = String(decision.decision_id ?? '?');
    const knowledgeRefs = asStrings(decision.knowledge_refs);
    if (knowledgeRefs.length === 0) {
      issues.push(closureIssue(
        'component_closure_knowledge_conclusion_unplaced',
        `decision:${decisionId}`,
        '权威稳定结论必须以 knowledge_refs 精确归位到既有知识真源。',
        'BLOCKER',
        'resolve_authority_or_risk',
      ));
      continue;
    }
    for (const ref of knowledgeRefs) {
      refs.push(ref);
      const split = splitKnowledgeRef(ref);
      if (!split || !allowedAssets.has(split.file)) {
        issues.push(closureIssue(
          'component_closure_knowledge_unresolved',
          ref,
          'knowledge_ref 必须使用 discovery.inputs.knowledge_assets 中已有文件的精确 #conclusion-id。',
          'BLOCKER',
          'resolve_authority_or_risk',
        ));
        continue;
      }
      try {
        const safe = validateProjectRelativePath(projectRoot, split.file, 'knowledge writeback ref');
        const absolute = path.resolve(projectRoot, safe);
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`稳定知识来源不存在：${ref}`);
        if (!resolvesConclusion(split.file, fs.readFileSync(absolute, 'utf8'), split.conclusionId)) {
          throw new Error(`稳定知识来源未包含结论 identity=${split.conclusionId}：${ref}`);
        }
      } catch (error) {
        issues.push(closureIssue(
          'component_closure_knowledge_unresolved',
          ref,
          (error as Error).message,
          'BLOCKER',
          'resolve_authority_or_risk',
        ));
      }
    }
  }
  return { refs: stableSortStrings(refs), issues };
}
