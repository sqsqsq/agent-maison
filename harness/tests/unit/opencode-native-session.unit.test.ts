import { beginUnitCase } from '../utils/unit-cases';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import type { UnitCaseResult } from '../run-unit';
import type { DatabaseSync } from 'node:sqlite';

const native = require('../../../agents/shared/opencode-native-session.cjs');
export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  let root!: string;
  let project!: string;
  let data!: string;
  let env!: NodeJS.ProcessEnv;
  let file!: string;
  let db!: DatabaseSync;
  const message = (id: string, at: number, value: object, sessionId = 'ses_fixture') => db.prepare('INSERT INTO message VALUES(?,?,?,?)').run(id, sessionId, at, JSON.stringify(value));
  const part = (id: string, messageId: string, at: number, value: object, sessionId = 'ses_fixture') => db.prepare('INSERT INTO part VALUES(?,?,?,?,?,?)').run(id, messageId, sessionId, at, at + 1, JSON.stringify(value));
  const prepare = () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-opencode-native-'));
    project = path.join(root, 'project');
    data = path.join(root, 'data');
    fs.mkdirSync(project); fs.mkdirSync(path.join(data, 'opencode'), { recursive: true });
    env = { XDG_DATA_HOME: data, MAISON_OPENCODE_SESSION_ID: 'ses_fixture', MAISON_OPENCODE_CALL_ID: 'call_current' };
    file = native.openCodeDatabase(env);
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file);
    db.exec('CREATE TABLE session(id TEXT,directory TEXT,parent_id TEXT,project_id TEXT);CREATE TABLE project(id TEXT,worktree TEXT);CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT);CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);');
    db.prepare('INSERT INTO session VALUES(?,?,?,?)').run('ses_fixture', project, null, 'fixture');
    db.prepare('INSERT INTO project VALUES(?,?)').run('fixture', project);
    message('user_original', 10, { role: 'user', time: { created: 10 }, summary: { diffs: [] } });
    part('text_original', 'user_original', 11, { type: 'text', text: '按小型处理 src/value.js，保留原用户输入。' });
    part('text_synthetic', 'user_original', 12, { type: 'text', text: '本会话不走Maison', synthetic: true });
    part('text_ignored', 'user_original', 13, { type: 'text', text: '按复杂', ignored: true });
    message('user_newer', 15, { role: 'user' }); part('text_newer', 'user_newer', 16, { type: 'text', text: '新独立请求' });
    message('assistant_current', 20, { role: 'assistant', parentID: 'user_original' });
    part('text_assistant_current', 'assistant_current', 21, { type: 'text', text: '本请求继续 user_original 的小型处理，依据 src/value.js。' });
    part('tool_current', 'assistant_current', 30, { type: 'tool', tool: 'bash', callID: 'call_current', state: { status: 'running', input: { command: 'node probe.cjs' }, time: { start: 30 } } });
    message('user_compact', 40, { role: 'user' }); part('compact_marker', 'user_compact', 41, { type: 'compaction', auto: true });
    part('text_compact', 'user_compact', 42, { type: 'text', text: '本会话不走Maison' });
    message('assistant_compact', 45, { role: 'assistant', parentID: 'user_original', summary: true });
    part('summary_text', 'assistant_compact', 46, { type: 'text', text: '压缩摘要' });
  };
  const check = async (name: string, run: () => void | Promise<void>) => {
    const endUnitCase = beginUnitCase(name);
    if (!endUnitCase) return;
    try { if (!root) prepare(); await run(); results.push({ name, ok: true }); } catch (error) { results.push({ name, ok: false, error: (error as Error).stack }); } finally { endUnitCase(); }
  };
  const scenario = (sid: string) => {
    const user = `${sid}_user`, assistant = `${sid}_assistant`;
    db.prepare('INSERT INTO session VALUES(?,?,?,?)').run(sid, project, null, 'fixture');
    message(user, 10, { role: 'user', time: { created: 10 }, summary: { diffs: [] } }, sid);
    part(`${sid}_user_text`, user, 11, { type: 'text', text: '处理 src/value.js 的本次需求。' }, sid);
    message(assistant, 20, { role: 'assistant', parentID: user }, sid);
    return { sid, user, assistant };
  };
  const assistantText = (f: ReturnType<typeof scenario>, id: string, start: number, end: number, text: string) => part(id, f.assistant, start, { type: 'text', text, time: { start, end } }, f.sid);
  const nativeTool = (f: ReturnType<typeof scenario>, id: string, created: number, start: number, end: number, tool: string, input: object, output: string) => part(id, f.assistant, created, { type: 'tool', tool, callID: `call_${id}`, state: { status: 'completed', input, output, time: { start, end }, ...(tool === 'bash' ? { metadata: { exit: 0 } } : {}) } }, f.sid);
  const factText = (changes: Record<string, boolean> = {}) => '本请求调研：' + Object.entries({ Q1: false, Q2: false, Q3: false, 依赖结果: false, 跨部件: false, 预期明确: true, 做法唯一: true, ...changes }).map(([key, value]) => `${key}=${value ? '是' : '否'}`).join('；') + '。依据 src/value.js。';
  const consume = (f: ReturnType<typeof scenario>) => {
    const oldData = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = data;
    try {
      const { readRequestIntake } = require('../../scripts/utils/request-intake');
      return readRequestIntake({ projectRoot: project, frameworkRoot: path.join(project, 'framework'), sessionRef: `${native.reference(file, f.sid)}#${f.user}`, explicitTargets: ['src/value.js'] });
    } finally { if (oldData === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = oldData; }
  };
  try {
    await check('OpenCode intake discloses a pending native part and rejects a conflicting call identity', () => {
      const f = scenario('ses_mismatch');
      const git = (args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      git(['init', '-q']);
      git(['-c', 'user.name=OpenCode fixture', '-c', 'user.email=opencode@example.invalid', 'commit', '--allow-empty', '-qm', 'baseline']);
      nativeTool(f, 'source-before-edit', 23, 23, 24, 'read', { filePath: 'src/value.js' }, 'exports.value=1;');
      assistantText(f, 'facts-before-edit', 26, 27, factText());
      nativeTool(f, 'base-head', 21, 21, 22, 'bash', { command: 'git rev-parse HEAD' }, git(['rev-parse', 'HEAD']));
      nativeTool(f, 'base-status', 22, 22, 23, 'bash', { command: 'git status --porcelain' }, '');
      part('pending-edit-part', f.assistant, 30, { type: 'tool', tool: 'edit', callID: 'overlapping-id', state: { status: 'running', input: { filePath: 'src/value.js' }, time: { start: 30 } } }, f.sid);
      const pending = consume(f);
      assert.equal(pending.gaps.length, 0);
      assert(pending.source_results?.some((item: { detail: string }) => item.detail.includes('pending-edit-part')));
      part('conflicting-edit-part', f.assistant, 34, { type: 'tool', tool: 'edit', callID: 'overlapping-id', state: { status: 'completed', input: { filePath: 'src/value.js' }, time: { start: 34, end: 35 } } }, f.sid);
      const mismatch = consume(f);
      assert(mismatch.gaps.some((gap: string) => /overlapping-id.*pending-edit-part.*conflicting-edit-part/.test(gap)));
    });
    await check('OpenCode current call follows assistant.parentID instead of latest user and stable ref survives later calls', () => {
      const current = native.currentOpenCodeSession(env);
      const value = native.readOpenCodeSession(current.file, project, env);
      assert.equal(value.request.id, 'user_original');
      assert.equal(value.request.text, '按小型处理 src/value.js，保留原用户输入。');
      assert(value.messages.filter((item: any) => item.id === 'user_compact' || item.id === 'assistant_compact').every((item: any) => item.role === 'summary'));
      assert.equal(value.messages.find((item: any) => item.id === 'user_compact').text, '');
      assert.equal(value.tools[0].completed, false); assert.equal(value.tools[0].resultLine, undefined);
      assert.equal(value.tools[0].origin.partId, 'tool_current'); assert.equal(value.tools[0].origin.order, 'normalized');
      const assistant = value.messages.find((item: any) => item.id === 'assistant_current');
      assert.equal(assistant.origin.parentId, 'user_original', 'A assistant created after newer B retains its actual parent A');
      assert.equal(value.tools[0].origin.parentId, assistant.origin.parentId);
      const stable = `${value.file}#${value.request.id}`;
      assert.equal(native.readOpenCodeSession(stable, project, env).request.id, 'user_original');
      assert.throws(() => native.readOpenCodeSession(native.reference(file, 'ses_fixture', 'missing'), project, env), /唯一/);
      assert.throws(() => native.readOpenCodeSession(`${value.file}#user_compact`, project, env), /真实 user/);
      assert.throws(() => native.readOpenCodeSession(stable, root, env), /项目/);
      assert(native.currentOpenCodeSession({ OPENCODE: '1', CODEX_THREAD_ID: 'outer' }).gap);
    });
    await check('OpenCode shell bridge clears inherited call identity when PTY supplies no IDs', async () => {
      const plugin = require('../../../agents/opencode/templates/plugins/maison-native-intake.js');
      const hooks = await plugin.MaisonNativeIntake({ directory: project });
      const output = { env: { MAISON_OPENCODE_SESSION_ID: 'outer-opencode', MAISON_OPENCODE_CALL_ID: 'outer-call' } };
      await hooks['shell.env']({ cwd: project }, output);
      assert.equal(output.env.MAISON_OPENCODE_SESSION_ID, ''); assert.equal(output.env.MAISON_OPENCODE_CALL_ID, '');
      const current = require('../../../agents/shared/native-request.cjs').currentNativeSession({ OPENCODE_PID: '123', CODEX_THREAD_ID: 'outer-codex', ...output.env }, project);
      assert(current.gap && !current.file, 'missing PTY IDs cannot fall back to an outer OpenCode or Codex session');
      await hooks['shell.env']({ cwd: project, sessionID: 'current-session', callID: 'current-call' }, output);
      assert.equal(output.env.MAISON_OPENCODE_SESSION_ID, 'current-session'); assert.equal(output.env.MAISON_OPENCODE_CALL_ID, 'current-call');
    });
    await check('OpenCode completion uses native status, end time and actual bash exit', () => {
      part('tool_exit', 'assistant_current', 50, { type: 'tool', tool: 'bash', callID: 'call_exit', state: { status: 'completed', input: { command: 'exit 7' }, output: 'failure', metadata: { exit: 7 }, time: { start: 50, end: 51 } } });
      part('tool_error', 'assistant_current', 52, { type: 'tool', tool: 'read', callID: 'call_error', state: { status: 'error', input: { filePath: 'missing' }, error: 'missing', time: { start: 52, end: 53 } } });
      const value = native.readOpenCodeSession(`${native.reference(file, 'ses_fixture')}#user_original`, project, env);
      const exit = value.tools.find((item: any) => item.origin.callId === 'call_exit');
      assert(exit.completed && exit.error); assert.equal(exit.completionTime, 51); assert.equal(exit.origin.exit, 7);
      const error = value.tools.find((item: any) => item.origin.callId === 'call_error'); assert(error.completed && error.error);
    });
    await check('OpenCode exact preimage reuses existing native snapshot bytes and display stays explicitly inexact', () => {
      const bytes = Buffer.from('VALUE\r\n'); fs.writeFileSync(path.join(project, 'target.txt'), bytes);
      const gitdir = path.join(data, 'opencode/snapshot/fixture', createHash('sha1').update(path.resolve(project)).digest('hex'));
      const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      fs.mkdirSync(gitdir, { recursive: true }); git(['init', '--bare', '--quiet', gitdir]);
      git(['--git-dir', gitdir, '--work-tree', project, '-c', 'core.autocrlf=false', 'add', 'target.txt']);
      const snapshot = git(['--git-dir', gitdir, 'write-tree']);
      message('assistant_read', 60, { role: 'assistant', parentID: 'user_original' });
      part('snapshot_before', 'assistant_read', 61, { type: 'step-start', snapshot });
      const read = { type: 'tool', tool: 'read', callID: 'call_read', state: { status: 'completed', input: { filePath: path.join(project, 'target.txt') }, output: 'numbered display', time: { start: 63, end: 64 }, metadata: { display: { type: 'file', path: path.join(project, 'target.txt'), text: 'VALUE', lineStart: 1, lineEnd: 1, totalLines: 1, truncated: false } } } };
      part('read_complete', 'assistant_read', 62, read);
      part('read_second', 'assistant_read', 65, { ...read, callID: 'call_second' });
      const value = native.readOpenCodeSession(`${native.reference(file, 'ses_fixture')}#user_original`, project, env);
      const first = value.tools.find((item: any) => item.origin.partId === 'read_complete');
      assert.equal(first.read.exact, false);
      const exact = first.readExact();
      assert(exact.complete && exact.exact); assert(Buffer.from(exact.content).equals(bytes)); assert.equal(exact.snapshot, snapshot);
      const display = value.tools.find((item: any) => item.origin.partId === 'read_second').read;
      assert(display.complete && !display.exact); assert.equal(display.content, 'VALUE');
    });
    await check('OpenCode ordinary reader and write guard never start cat-file without a dirty preimage consumer', () => {
      const reader = path.resolve(__dirname, '../../../agents/shared/opencode-native-session.cjs'), guard = path.resolve(__dirname, '../../../agents/opencode/guard-tool.cjs');
      const script = `const cp=require('node:child_process');let calls=0;const run=cp.execFileSync;cp.execFileSync=(bin,args,...rest)=>{if(bin==='git'&&args.includes('cat-file'))calls++;return run(bin,args,...rest)};const native=require(${JSON.stringify(reader)});native.readOpenCodeSession(${JSON.stringify(native.reference(file, 'ses_fixture', 'call_current'))},${JSON.stringify(project)},${JSON.stringify(env)});require(${JSON.stringify(guard)}).evaluate({projectRoot:${JSON.stringify(project)},tool:'edit',sessionID:'ses_fixture',callID:'call_current',args:{filePath:'src/value.js'}},${JSON.stringify(env)}).then(value=>{if(calls!==0||value.decision!=='deny')throw Error(JSON.stringify({calls,value}));console.log(calls)});`;
      const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stdout.trim(), '0');
    });
    await check('OpenCode native compaction invalidates an unretained entry read and a fresh read restores it', () => {
      const request = require('../../../agents/shared/native-request.cjs'), framework = path.join(project, 'framework');
      const entry = path.join(framework, 'docs/operations/project-entry.md');
      const entryBody = '# Fixture project entry\nRead this shared entry before product edits.\n';
      fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.writeFileSync(entry, entryBody);
      const readEntry = (id: string, at: number) => {
        message(`assistant_${id}`, at, { role: 'assistant', parentID: 'user_original' });
        part(id, `assistant_${id}`, at + 1, { type: 'tool', tool: 'read', callID: `call_${id}`, state: { status: 'completed', input: { filePath: entry }, output: entryBody, metadata: { display: { type: 'file', path: entry, text: entryBody.trimEnd(), lineStart: 1, lineEnd: 2, totalLines: 2, truncated: false } }, time: { start: at + 1, end: at + 2 } } });
      };
      const read = () => native.readOpenCodeSession(`${native.reference(file, 'ses_fixture')}#user_original`, project, env);
      readEntry('entry_before', 70); assert(request.frontDoorLoaded(read(), project, framework));
      message('compaction_boundary', 80, { role: 'user' }); part('native_compaction', 'compaction_boundary', 81, { type: 'compaction', auto: true });
      assert(!request.frontDoorLoaded(read(), project, framework), 'native compaction boundary alone expires older reads');
      message('compaction_summary', 85, { role: 'assistant', parentID: 'compaction_boundary', summary: true });
      part('compaction_summary_text', 'compaction_summary', 86, { type: 'text', text: 'Only business progress was retained.' });
      message('compaction_continue', 87, { role: 'user' });
      part('continue_text', 'compaction_continue', 88, { type: 'text', text: '本会话不走Maison，按复杂', synthetic: true, metadata: { compaction_continue: true } });
      const compacted = read();
      assert(compacted.messages.filter((item: any) => ['compaction_boundary', 'compaction_summary'].includes(item.id)).every((item: any) => item.role === 'summary'));
      assert(!compacted.messages.some((item: any) => item.id === 'compaction_continue'));
      assert.equal(compacted.request.id, 'user_original'); assert.equal(compacted.request.text, '按小型处理 src/value.js，保留原用户输入。');
      assert(!request.frontDoorLoaded(compacted, project, framework));
      readEntry('entry_after', 90); assert(request.frontDoorLoaded(read(), project, framework), 'fresh native read restores the existing shared entry predicate');
    });
    await check('OpenCode assistant text parts cannot borrow a later read and preserve native user and parent IDs', () => {
      fs.mkdirSync(path.join(project, 'src')); fs.writeFileSync(path.join(project, 'src/value.js'), 'exports.value = 42;\n');
      fs.writeFileSync(path.join(project, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'native timing', project_profile: { name: 'request-test' }, architecture: { outer_layers: [{ id: 'src', can_depend_on: [], intra_layer_deps: 'forbid' }], module_inner_layers: ['shared'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.js' }, paths: { features_dir: 'doc/features' } }));
      const f = scenario('text_part_timing');
      assistantText(f, 'early_facts', 21, 22, factText());
      nativeTool(f, 'later_source_read', 25, 30, 40, 'read', { filePath: path.join(project, 'src/value.js') }, 'exports.value = 42;');
      assert.equal(consume(f).policy.selected, 'unknown');
      assistantText(f, 'unrelated_late_text', 50, 51, '本请求继续当前原始任务。');
      const session = native.readOpenCodeSession(`${native.reference(file, f.sid)}#${f.user}`, project, env);
      const observations = session.messages.filter((item: any) => item.role === 'assistant');
      assert.equal(observations.length, 2); assert.equal(session.request.id, f.user);
      assert.deepEqual(observations.map((item: any) => Date.parse(item.at)), [22, 51]);
      assert(observations.every((item: any) => item.id === f.assistant && item.origin.parentId === f.user));
      assert.deepEqual(observations.map((item: any) => item.origin.partIds), [['early_facts'], ['unrelated_late_text']]);
      const early = consume(f); assert.equal(early.policy.selected, 'unknown'); assert.equal(early.facts.design_tradeoff.value, 'unknown');
      assistantText(f, 'valid_late_facts', 60, 61, factText());
      assert.equal(consume(f).policy.selected, 'trivial', 'a distinct post-read factual statement is still valid');
    });
    await check('OpenCode first write follows native execution start instead of SQLite part creation', () => {
      const f = scenario('tool_start_timing');
      nativeTool(f, 'late_start_created_first', 25, 80, 90, 'edit', { filePath: path.join(project, 'src/value.js') }, 'edit applied');
      nativeTool(f, 'early_start_created_second', 30, 40, 50, 'edit', { filePath: path.join(project, 'src/value.js') }, 'edit applied');
      nativeTool(f, 'status_after_actual_first_write', 35, 60, 65, 'bash', { command: 'git status --porcelain' }, ' M src/value.js\n');
      const session = native.readOpenCodeSession(`${native.reference(file, f.sid)}#${f.user}`, project, env);
      assert.deepEqual(session.tools.map((item: any) => item.startedTime), [40, 60, 80]);
      assert.equal(session.tools[0].origin.partId, 'early_start_created_second');
      assert.equal(consume(f).baseline.initial_dirty, 'unknown', 'a post-write status is not initial dirty proof');
    });
    await check('OpenCode native reader to intake uses the shared automatic four-frame rules without user fixed scale', () => {
      for (const [expected, changes] of [['trivial', {}], ['small', { 做法唯一: false }], ['medium', { Q1: true }], ['complex', { 跨部件: true }]] as Array<[string, Record<string, boolean>]>) {
        const f = scenario(`automatic_${expected}`);
        nativeTool(f, `automatic_${expected}_read`, 21, 22, 25, 'read', { filePath: path.join(project, 'src/value.js') }, 'exports.value = 42;');
        assistantText(f, `automatic_${expected}_facts`, 30, 31, factText(changes));
        const intake = consume(f);
        assert.equal(intake.control.fixed, undefined); assert.equal(intake.policy.source, 'rule'); assert.equal(intake.policy.selected, expected);
        assert(Object.values(intake.facts).every((fact: any) => fact.sources.includes('src/value.js')));
      }
    });
    await check('OpenCode child session cannot supply root user authority', () => {
      db.prepare('UPDATE session SET parent_id=? WHERE id=?').run('parent', 'ses_fixture');
      assert.throws(() => native.readOpenCodeSession(native.currentOpenCodeSession(env).file, project, env), /子会话/);
    });
    await check('OpenCode delegated author skips duplicate entry lookup after framework and patch move protection', async () => {
      const guard = require('../../../agents/opencode/guard-tool.cjs');
      const framework = path.join(project, 'framework'); fs.mkdirSync(framework, { recursive: true }); fs.writeFileSync(path.join(framework, 'RELEASE-MANIFEST.json'), '{}');
      const input = { projectRoot: project, tool: 'edit', sessionID: 'missing-author-session', callID: 'missing', args: { filePath: 'src/value.js' } };
      const author = await guard.evaluate(input, { ...env, MAISON_GOAL_RUNNER: '1' });
      assert.equal(author.decision, 'allow', 'author keeps existing Goal source without requiring a new root session');
      const protectedEdit = await guard.evaluate({ ...input, args: { filePath: 'framework/docs/keep.txt' } }, { ...env, MAISON_GOAL_RUNNER: '1' });
      assert.equal(protectedEdit.decision, 'deny');
      const patchMove = await guard.evaluate({ ...input, tool: 'apply_patch', args: { patchText: '*** Begin Patch\n*** Update File: src/value.js\n*** Move to: framework/docs/keep.txt\n@@\n-a\n+b\n*** End Patch' } }, { ...env, MAISON_GOAL_RUNNER: '1' });
      assert.equal(patchMove.decision, 'deny', 'every patch target is protected before the author exemption');
    });
    await check('OpenCode init materializes exact native plugin and repeated UPDATE preserves user plugins and config', () => {
      const { executeInitTask } = require('../../scripts/utils/init-task-executor');
      const { clearFrameworkConfigCache } = require('../../config');
      const instance = path.join(root, 'init-project'); fs.mkdirSync(instance);
      fs.writeFileSync(path.join(instance, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'native plugin init', materialized_adapters: ['opencode'], architecture: { outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }], module_inner_layers: ['shared'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ets' }, paths: { features_dir: 'doc/features' } }));
      const plugins = path.join(instance, '.opencode/plugins'); fs.mkdirSync(plugins, { recursive: true });
      const userPlugin = path.join(plugins, 'user-plugin.js'), userConfig = path.join(instance, '.opencode/opencode.json');
      const custom = 'export const UserPlugin = async () => ({});\n', config = '{"model":"fixture/user-model","plugin":["user-owned-plugin"]}\n';
      fs.writeFileSync(userPlugin, custom); fs.writeFileSync(userConfig, config);
      const context = { projectRoot: instance, harnessRoot: path.resolve(__dirname, '../..'), materializedAdapters: ['opencode'], plan: { schema_version: '1.0', scope: 'project', mode: 'create', generated_at: '', tasks: [] } };
      const task = { id: 'materialize-adapter:opencode', title: 'native plugin', category: 'adapter-bundle', scope: 'project', deps: ['ensure-config'], status: 'needed', default_action: 'run', skippable: false, allowed_actions: ['run'], params: { adapter: 'opencode' } };
      const target = path.join(plugins, 'maison-native-intake.js'), template = fs.readFileSync(path.resolve(__dirname, '../../../agents/opencode/templates/plugins/maison-native-intake.js'));
      try {
        clearFrameworkConfigCache(); executeInitTask(task, 'run', context);
        assert(fs.readFileSync(target).equals(template));
        context.plan.mode = 'update'; fs.writeFileSync(target, '// previous managed plugin\n');
        executeInitTask(task, 'run', context); executeInitTask(task, 'run', context);
        assert(fs.readFileSync(target).equals(template)); assert.equal(fs.readFileSync(userPlugin, 'utf8'), custom); assert.equal(fs.readFileSync(userConfig, 'utf8'), config);
      } finally { clearFrameworkConfigCache(); }
    });
  } finally { db?.close(); if (root) fs.rmSync(root, { recursive: true, force: true }); }
  return results;
}
