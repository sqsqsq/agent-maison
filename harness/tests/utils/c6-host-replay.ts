import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { parseVerifierRequestFromInstruction, type VerifierRequest } from '../../scripts/utils/verifier-request';

/** Restore captured bytes only; callers own and record any execution/environment adaptation. */
export function copyC6HostReplay(): { root: string; feature: string; runId: string; featureDir: string } {
  const history = path.resolve(__dirname, '../fixtures/host-recovery-history');
  const current = path.join(history, '20261026-fe4512-s2');
  const snapshot = JSON.parse(fs.readFileSync(path.join(current, 'sources.json'), 'utf8'));
  const base = path.resolve(current, snapshot.base_fixture);
  const tempDir = process.env.C6_REPLAY_KEEP === '1' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempDir, 'maison-c6-s2-'));
  try {
    fs.cpSync(base, root, { recursive: true });
    for (const source of [base, current]) {
      const captured = JSON.parse(fs.readFileSync(path.join(source, 'sources.json'), 'utf8')) as {
        files: Array<{ file: string; normalization?: string; source_sha256?: string; sha256: string }>;
      };
      for (const row of captured.files) {
        if (row.file.startsWith('evidence/')) continue;
        let bytes = fs.readFileSync(path.join(source, row.file));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, `fixture bytes: ${row.file}`);
        if (row.normalization === 'CRLF->LF only') bytes = Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, '\r\n'));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), row.normalization === 'CRLF->LF only' ? row.source_sha256 : row.sha256, `original bytes: ${row.file}`);
        const target = path.join(root, row.file);
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
      }
    }
    return { root, feature: 'cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93', runId: snapshot.run_id, featureDir: snapshot.feature };
  } catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
}

/** i26 was overwritten, so recover the pre-repair Markdown from the exact command output that printed it. */
export function readC6PlanVerifierReport(project: ReturnType<typeof copyC6HostReplay>, iteration: 26 | 28): {
  request: VerifierRequest; relative: string; text: string;
} {
  const invocations = path.join(project.root, project.featureDir, 'goal-runs', project.runId, 'phases/plan-verifier-format-repair');
  const invocation = fs.readdirSync(invocations).find(dir => dir.startsWith(`plan-verifier-format-repair-i${iteration}-`))!;
  const request = parseVerifierRequestFromInstruction(fs.readFileSync(path.join(invocations, invocation, 'prompt.md'), 'utf8'))!;
  assert.equal(request.feature, project.feature);
  const relative = path.posix.join(project.featureDir, 'plan/reports', `verifier.report.${request.subject_id}.md`);
  if (iteration === 28) return { request, relative, text: fs.readFileSync(path.join(project.root, relative), 'utf8') };
  const printed = fs.readFileSync(path.join(invocations, invocation, 'agent-output.log'), 'utf8').split(/\r?\n/)[18];
  const output: string = JSON.parse(printed).item.aggregated_output;
  const original = output.match(/(\| id \| status \| severity \|[\s\S]*?<!-- \/maison-verifier-result:v1 -->\n)/);
  assert(original, 'i26 pre-repair command output must contain the actual original report');
  return { request, relative, text: original[1] };
}
