import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { featureFilePath } from '../../config';
import type { BlueprintRecord } from '../../scripts/utils/component-blueprint-model';

/** Archived process/session materials, consumed through the production original reader. */
export function writeReviewQuestioningRound(input: {
  root: string; feature: string; blueprintFile: string; before: BlueprintRecord; result: BlueprintRecord | string;
  index: number; session?: boolean; repair?: boolean; legacy?: boolean; dirty?: boolean;
}) {
  const phase = input.repair ? 'design-repair-questioning' : 'initial-design-questioning';
  const runDir = featureFilePath(input.root, input.feature, 'goal-runs/review-history');
  const invokeId = `q-${input.index}`;
  const directory = path.join(runDir, 'phases', phase, invokeId);
  fs.mkdirSync(directory, { recursive: true });
  const before = YAML.stringify(input.before);
  const digest = (bytes: string) => crypto.createHash('sha256').update(bytes).digest('hex');
  const pre = { sha256: digest(before), failureReason: null,
    entries: [{ path: path.relative(input.root, input.blueprintFile).replace(/\\/g, '/'), kind: 'file', sha256: digest(before) }] };
  const post = input.dirty ? { ...pre, sha256: 'f'.repeat(64), entries: [{ ...pre.entries[0], sha256: 'd'.repeat(64) }] } : pre;
  const output = typeof input.result === 'string' ? input.result : `Independent review follows.\n\`\`\`json\n${JSON.stringify(input.result)}\n\`\`\``;
  const write = (name: string, data: unknown) => {
    const file = path.join(directory, name), bytes = JSON.stringify(data, null, 2) + '\n'; fs.writeFileSync(file, bytes);
    return { path: path.relative(runDir, file).replace(/\\/g, '/'), sha256: digest(bytes) };
  };
  const request = write('request-e1.json', { type: 'phase_execute_request', invoke_id: invokeId, purpose: 'questioning', pre_snapshot: pre,
    write_boundary: { executionRole: 'verifier' }, context: { phase, feature: input.feature, runDir,
      owner: { kind: input.session ? 'session' : 'process', epoch: 1, owner_id: 'review-owner' } } });
  fs.writeFileSync(path.join(directory, 'blueprint-before.yaml'), before);
  if (input.legacy) fs.writeFileSync(path.join(directory, 'draft-output.yaml'), before);
  const report = { status: 'passed', phase, details: output };
  const payload = { report, draft_outputs: { [input.repair ? 'component-blueprint.yaml' : 'initial-design-blueprint.yaml']: Buffer.from(before).toString('base64') },
    ...(!input.legacy ? { post_snapshot: post } : {}), outcome: { output, preSnapshot: pre, ...(!input.legacy ? { postSnapshot: post } : {}) } };
  const archived = write(input.session ? 'handoff-report.json' : 'design-result.json', payload);
  if (!input.session) fs.writeFileSync(path.join(directory, 'questioning-output.json'), output);
  const ts = new Date(Date.UTC(2026, 10, 4, 0, input.index)).toISOString();
  const events = [
    { type: 'agent_invoke_start', ts, phase, invoke_id: invokeId },
    ...(input.session ? [{ type: 'phase_start', ts, phase, invoke_id: invokeId, driver: 'session', handoff_request: request }] : []),
    { type: 'agent_invoke_end', ts, phase, invoke_id: invokeId, exit_code: 0,
      ...(input.session ? { handoff_report: { ...archived, request_sha256: request.sha256 } } : {}) },
  ];
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), events.map(event => JSON.stringify(event) + '\n').join(''));
  return { directory, output, runDir };
}
