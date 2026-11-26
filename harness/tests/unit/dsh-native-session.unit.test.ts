import { beginUnitCase } from '../utils/unit-cases';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import { execFileSync } from 'child_process';
import { fixture } from './request-entry.unit.test';
import { readRequestIntake } from '../../scripts/utils/request-intake';
import { prepareAutomaticRequest } from '../../scripts/utils/automatic-request';
import { clearFrameworkConfigCache } from '../../config';
import { launchModelPin, nativeDshModelMismatch, readFrontendModelRequest } from '../../scripts/utils/adapter-model';
import type { UnitCaseResult } from '../run-unit';

const native = require('../../../agents/shared/native-request.cjs');
const dsh = require('../../../agents/shared/dsh-native-session.cjs');
const repo = path.resolve(__dirname, '../../..');

function setup(f: ReturnType<typeof fixture>) {
  const keys = ['DSH_HOME', 'DSH_SESSION_ID', 'DSH_PROFILE_DIR', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const home = path.join(f.root, '.native-dsh'), sessionId = 'session-intake-test';
  Object.assign(process.env, { DSH_HOME: home, DSH_SESSION_ID: sessionId, DSH_PROFILE_DIR: path.join(home, 'profiles/headless') });
  delete process.env.CODEX_THREAD_ID; delete process.env.CODEX_SESSION_ID;
  const file = path.join(home, 'sessions', 'project', sessionId, 'session.v4.jsonl.zstd');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows: any[] = [{ type: 'session', version: 4, id: sessionId, cwd: f.root, isSeeded: false, delegationDepth: 0 }];
  const add = (type: string, data: any, extra = {}) => { const row = { type, seq: rows.length - 1, time: Date.now(), data, ...extra }; rows.push(row); return row; };
  const user = (id: string, text: string, kind = 'user') => add('user/message', { id, role: 'user', source: { kind }, content: [{ type: 'text', text }] });
  const assistant = (text: string) => add('assistant/message', { message: { id: `assistant-${rows.length}`, role: 'assistant', content: [{ type: 'text', text }] } });
  const tool = (name: string, input: unknown, output: string, meta?: object, isError = false) => {
    const callId = `call-${rows.length}`, call = add('tool/call', { callId, name, arguments: JSON.stringify(input) });
    const result = add('tool/result', { message: { id: `result-${rows.length}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: output }], isError }, meta }, { sourceEventSeqs: [call.seq] });
    return { call, result, callId };
  };
  const flush = (tail = Buffer.alloc(0)) => fs.writeFileSync(file, Buffer.concat([...rows.map(row => (zlib as any).zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n'))), tail]));
  const restore = () => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  return { home, sessionId, file, rows, add, user, assistant, tool, flush, restore };
}

const cases: Array<{ name: string; run(f: ReturnType<typeof fixture>, s: ReturnType<typeof setup>): void }> = [
  { name: 'DSH exact SID lookup shares frames and project identity without applying intake lineage to model metadata', run(f, s) {
    s.user('human-1', '修复 src/value.js。'); s.flush();
    assert.equal(dsh.currentDshSession(process.env, f.root).file, fs.realpathSync(s.file));
    assert.equal(dsh.readDshSession(s.file).rows.length, 2);
    assert(dsh.currentDshSession({ DSH_SESSION_ID: s.sessionId }, f.root).gap);
    assert.throws(() => dsh.readDshSession(s.file, { projectRoot: repo }), /准确 session \/ 项目/);
    s.rows[0].origin = 'subagent'; s.flush();
    assert.equal(dsh.readDshSession(dsh.locateDshSession(s.sessionId, process.env).file).header.origin, 'subagent');
    const duplicate = path.join(s.home, 'sessions', 'other', s.sessionId, 'session.v4.jsonl.zstd');
    fs.mkdirSync(path.dirname(duplicate), { recursive: true }); fs.copyFileSync(s.file, duplicate);
    assert.throws(() => dsh.locateDshSession(s.sessionId, process.env), /唯一原生会话/);
  } },
  { name: 'DSH locates without reading, consumes each source once and checks the model stat cache before decoding', run(f, s) {
    s.user('human-1', '本请求修复 src/value.js。');
    s.add('turn/start', { turn: 1 });
    s.add('request/header', { header: { config: { provider: 'native-route', model: 'native/model' } } }); s.flush();
    const nativeFs = require('fs') as typeof fs, originalRead = nativeFs.readFileSync;
    const nativeZlib = require('zlib'), originalDecode = nativeZlib.zstdDecompressSync;
    let reads = 0, decodes = 0;
    nativeFs.readFileSync = ((file: any, ...args: any[]) => {
      if (typeof file === 'string' && path.resolve(file) === path.resolve(s.file)) reads++;
      return (originalRead as any)(file, ...args);
    }) as typeof originalRead;
    nativeZlib.zstdDecompressSync = (...args: any[]) => { decodes++; return originalDecode(...args); };
    try {
      dsh.currentDshSession(process.env); assert.equal(reads, 0); assert.equal(decodes, 0);
      native.readNativeSession(s.file, f.root); assert.equal(reads, 1);
      reads = 0; decodes = 0;
      const selected = launchModelPin({}, 'deepseek-harness', f.root)!;
      assert.equal(reads, 1, 'startup does not read/decode in the locator'); assert(decodes > 0);
      reads = 0; decodes = 0;
      const seen = new Map<string, string>();
      assert.equal(nativeDshModelMismatch(selected, s.sessionId, f.root, process.env, 1, seen), undefined);
      assert.equal(reads, 1); const initialDecodes = decodes; assert(initialDecodes > 0);
      for (let index = 0; index < 4; index++) assert.equal(nativeDshModelMismatch(selected, s.sessionId, f.root, process.env, 1, seen), undefined);
      assert.equal(reads, 1); assert.equal(decodes, initialDecodes, 'unchanged 100ms polls perform no extra decompression');
      s.flush(Buffer.from([0x28, 0xb5, 0x2f]));
      const header = readFrontendModelRequest({ adapter: 'deepseek-harness', projectRoot: f.root, file: s.file, sessionId: s.sessionId, configSource: 'native-profile/cordis.patch.yml' });
      assert.equal(header.value, selected.value, 'a partial tail cannot hide the last complete model header');
      const partial = (zlib as any).zstdCompressSync(Buffer.from(JSON.stringify({ type: 'request/header', seq: 88, data: { header: { config: { provider: 'new', model: 'unfinished' } } } }) + '\n'));
      s.flush(partial.subarray(0, partial.length - 1));
      assert.throws(() => readFrontendModelRequest({ adapter: 'deepseek-harness', projectRoot: f.root, file: s.file, sessionId: s.sessionId, requestId: '88' }), /准确启动轮/);
    } finally { nativeFs.readFileSync = originalRead; nativeZlib.zstdDecompressSync = originalDecode; }
  } },
  { name: 'DSH native intake takes the last real human once and preserves an explicit original anchor after append', run(f, s) {
    s.user('human-1', '旧请求。');
    for (const kind of ['agent-instructions', 'runtime-context', 'skill-catalog', 'actor', 'compact-checkpoint']) s.user(`injected-${kind}`, '本会话不走Maison，按复杂处理。', kind);
    s.add('request/header', { header: { config: { provider: 'route', model: 'model' }, message: '不走Maison' } });
    s.add('compaction/summary', { compactionId: 'summary', summary: [{ type: 'text', text: '本会话不走Maison，按复杂处理。' }] });
    s.user('human-2', '按小型处理。'); s.flush();
    const first = native.readNativeSession(s.file, f.root);
    assert.equal(first.request.id, 'human-2'); assert.equal(first.messages.filter((value: any) => value.role === 'user').length, 2);
    assert.equal(first.messages.find((value: any) => value.id === 'summary')?.role, 'summary');
    assert.equal(native.userControl(first.request.text).fixed, '小型');
    assert.throws(() => native.readNativeSession(`${s.file}#injected-actor`, f.root), /真实 user/);
    assert.throws(() => native.readNativeSession(`${s.file}#summary`, f.root), /真实 user/);
    s.user('human-3', '新独立需求，按复杂处理。'); s.flush();
    assert.equal(native.readNativeSession(`${s.file}#human-2`, f.root).request.id, 'human-2');
    assert.equal(native.readNativeSession(s.file, f.root).request.id, 'human-3');
  } },
  { name: 'DSH root intake rejects inherited seeds, children, wrong parent SID and arbitrary compressed files', run(f, s) {
    s.user('human-1', '本会话不走Maison。'); s.flush();
    for (const field of [{ parentSession: 'session-parent' }, { origin: 'subagent' }, { delegationDepth: 1 }, { isSeeded: true }]) {
      Object.assign(s.rows[0], field); s.flush();
      assert.throws(() => native.readNativeSession(s.file, f.root), /子代理或继承 seed/);
      for (const key of Object.keys(field)) delete s.rows[0][key];
    }
    s.rows[0].id = 'session-different'; s.flush(); assert.throws(() => native.readNativeSession(s.file, f.root), /准确 session/);
    const outside = path.join(f.root, 'session.v4.jsonl.zstd'); fs.copyFileSync(s.file, outside);
    assert.throws(() => native.readNativeSession(outside, f.root), /原生存储/);
  } },
  { name: 'DSH links tool call seq and IDs, preserves native failures and never upgrades a line window to exact bytes', run(f, s) {
    s.user('human-1', '修复 src/value.js。');
    s.tool('read', { file_path: path.join(f.root, 'src/value.js') }, '1: exports.value = 40;', { path: path.join(f.root, 'src/value.js'), offset: 1, lines: [{ number: 1, text: 'exports.value = 40;' }], totalLines: 1 });
    s.tool('read', { file_path: 'missing.js' }, 'File not found', undefined, true);
    s.tool('pwsh', { command: 'exit 1' }, 'failure\n[exit code: 1]');
    const job = s.tool('pwsh', { command: 'native program' }, 'wrapper reports success');
    s.add('job/settled', { toolCall: { callId: job.callId }, status: 'completed', detail: 'exit code: 2' });
    const mismatch = s.tool('edit', { file_path: 'src/value.js' }, 'updated'); mismatch.result.data.message.toolCallId = 'other';
    s.flush();
    const session = native.readNativeSession(s.file, f.root);
    assert.equal(session.tools.length, 5); assert(native.toolSucceeded(session.tools[0]));
    assert.equal(session.tools[0].read.content, 'exports.value = 40;'); assert.equal(session.tools[0].read.complete, true); assert.equal(session.tools[0].read.exact, false);
    for (const tool of session.tools.slice(1)) assert(!native.toolSucceeded(tool));
    assert.equal(session.tools.at(-1).completed, false);
    assert.match(session.associations[0].detail, new RegExp(`seq=${mismatch.result.seq}.*ID=other.*seq=${mismatch.call.seq}`));
    s.flush(Buffer.from([0x28, 0xb5, 0x2f]));
    assert.equal(native.readNativeSession(s.file, f.root).tools.length, 5);
    assert.throws(() => dsh.decodeDshSession(fs.readFileSync(s.file)));
    const tail = (zlib as any).zstdCompressSync(Buffer.from(JSON.stringify({ type: 'user/message', data: { id: 'not-yet-flushed', role: 'user', source: { kind: 'user' }, content: 'partial user' } }) + '\n'));
    const complete = dsh.decodeDshSession(Buffer.concat(s.rows.map(row => (zlib as any).zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n')))));
    for (let length = 1; length < tail.length; length++) {
      s.flush(tail.subarray(0, length));
      assert.equal(dsh.decodeDshSession(fs.readFileSync(s.file), true), complete, 'only completed frames may contribute a new message');
    }
  } },
  { name: 'DSH corrupt middle frames cannot silently select an older user before a later valid user frame', run(f, s) {
    s.user('old-human', '旧请求，不应在损坏原件中被当作当前请求。');
    s.add('request/header', { header: { config: { provider: 'native-route', model: 'native/model' } } });
    s.flush();
    const before = fs.readFileSync(s.file);
    const after = (zlib as any).zstdCompressSync(Buffer.from(JSON.stringify({ type: 'user/message', seq: 2, data: { id: 'new-human', role: 'user', source: { kind: 'user' }, content: '新请求。' } }) + '\n'));
    const reserved = Buffer.from(after); reserved[4] |= 8;
    const checksum = (zlib as any).zstdCompressSync(Buffer.from('native event'), { params: { [(zlib.constants as any).ZSTD_c_checksumFlag]: 1 } });
    checksum[checksum.length - 1] ^= 1;
    for (const bad of [Buffer.from([0, 0, 0, 0]), Buffer.from([0xff]), reserved, checksum]) {
      fs.writeFileSync(s.file, Buffer.concat([before, bad, after]));
      assert.throws(() => dsh.decodeDshSession(fs.readFileSync(s.file), true), Error, 'known corruption is not an unfinished tail');
      assert.throws(() => native.readNativeSession(s.file, f.root), Error, 'never fall back to the old human after corruption');
      assert.throws(() => readFrontendModelRequest({ adapter: 'deepseek-harness', projectRoot: f.root, file: s.file, sessionId: s.sessionId }), Error);
    }
  } },
  { name: 'DSH read/write, four scales and user controls reach the same automatic request intake without an explicit ref', run(f, s) {
    const git = (args: string[]) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    fs.writeFileSync(path.join(f.root, '.gitignore'), 'framework/\ndoc/\n.native-*/\n');
    git(['init', '-q']); git(['config', 'user.name', 'DSH Intake Test']); git(['config', 'user.email', 'dsh-intake@example.invalid']); git(['add', '.']); git(['commit', '-qm', 'baseline']);
    const head = git(['rev-parse', 'HEAD']);
    const human = s.user('human-1', '本请求修复 src/value.js。');
    s.tool('pwsh', { command: 'git rev-parse HEAD' }, head); s.tool('pwsh', { command: 'git status --porcelain' }, ' M src/value.js\n');
    s.tool('read', { file_path: path.join(f.root, 'src/value.js') }, '1: exports.value = 40;', { path: path.join(f.root, 'src/value.js'), offset: 1, lines: [{ number: 1, text: 'exports.value = 40;' }], totalLines: 1 });
    const entry = path.join(f.framework, 'docs/operations/project-entry.md'), entryBody = fs.readFileSync(entry, 'utf8'), entryLines = entryBody.split('\n');
    s.tool('read', { file_path: entry }, entryBody, { path: entry, offset: 1, totalLines: entryLines.length, lines: entryLines.map((text, index) => ({ number: index + 1, text })) });
    const judgment = s.assistant('');
    s.tool('edit', { file_path: path.join(f.root, 'src/value.js'), old_string: '40', new_string: '42' }, 'updated');
    fs.writeFileSync(path.join(f.root, 'src/value.js'), 'exports.value = 42;\n');
    for (const [selected, extra] of [['trivial', ''], ['small', '做法唯一=否'], ['medium', 'Q1=是'], ['complex', '跨部件=是']] as const) {
      judgment.data.message.content[0].text = `本请求依据 src/value.js：Q1=否；Q2=否；Q3=否；依赖结果=否；跨部件=否；预期明确=是；做法唯一=是。${extra ? '纠正原判断错误：' + extra + '。' : ''}`;
      // Each variant is a separate original evidence fixture, not an unsourced reclassification.
      if (extra) judgment.data.message.content[0].text = judgment.data.message.content[0].text.replace(extra.split('=')[0] + '=' + (extra.endsWith('否') ? '是' : '否'), extra);
      s.flush(); const intake = readRequestIntake({ projectRoot: f.root, frameworkRoot: f.framework });
      assert.equal(intake.policy.selected, selected); assert.equal(intake.user.id, 'human-1'); assert.deepEqual(intake.gaps, []);
      assert(intake.targets.includes('src/value.js')); assert(intake.facts.design_tradeoff.sources.includes('src/value.js'));
      assert(!intake.baseline.preimages?.['src/value.js'], 'full line display cannot supply an exact initial dirty preimage');
    }
    human.data.content[0].text = '本请求按小型处理，不跑UT。'; s.flush();
    const selected = readRequestIntake({ projectRoot: f.root, frameworkRoot: f.framework });
    assert.equal(selected.policy.selected, 'small'); assert(selected.control.excluded.includes('ut'));
    const automatic = prepareAutomaticRequest(f.root, f.framework, { phase: 'review', target: ['src/value.js'] });
    const generated = JSON.parse(fs.readFileSync(path.join(f.root, automatic.requestFile), 'utf8'));
    assert(!generated.origin_gap, generated.origin_gap); assert.equal(generated.intake_context.user.id, 'human-1');
    s.user('later-user', '新独立需求，按复杂处理。'); s.flush();
    const preserved = readRequestIntake({ projectRoot: f.root, frameworkRoot: f.framework, previous: selected });
    assert.equal(preserved.user.id, 'human-1'); assert.equal(preserved.session_ref, selected.session_ref);
  } },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const item of cases) {
    const endUnitCase = beginUnitCase(item.name);
    if (!endUnitCase) continue;
    const f = fixture('ut'), s = setup(f);
    try { clearFrameworkConfigCache(); item.run(f, s); results.push({ name: item.name, ok: true }); }
    catch (error) { results.push({ name: item.name, ok: false, error: (error as Error).stack }); }
    finally { s.restore(); assert(f.root.startsWith(path.join(os.tmpdir(), 'maison-request-'))); fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache();  endUnitCase(); }
  }
  return results;
}
