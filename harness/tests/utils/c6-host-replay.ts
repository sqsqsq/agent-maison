import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

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
