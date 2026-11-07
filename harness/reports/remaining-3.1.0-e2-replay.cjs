// Disposable replay of the explicitly authorized host run; no model or host writes.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const repo = path.resolve(__dirname, '../..');
process.env.TS_NODE_PROJECT = path.join(repo, 'harness/tsconfig.json');
require('ts-node/register/transpile-only');
const { provisionFrameworkUnder, git } = require('../tests/utils/real-chain-host');
const host = 'D:/1.code/SimulatedWalletForHmos';
const feature = 'bc-openCard-2', runId = '20261104T050636Z-5eb635';
const runRel = `doc/features/${feature}/goal-runs/${runId}`;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const savedCopies = process.argv.includes('--replay-existing') ? read(path.join(__dirname, 'remaining-3.1.0-e2-summary.json')) : undefined;
const resultPrefix = savedCopies ? 'remaining-3.1.0-e2-review' : 'remaining-3.1.0-e2';
const sourceFor = scenario => savedCopies ? savedCopies.outputs.find(row => row.scenario === scenario).root : host;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-e2-original-'));
const originals = new Map();
function copyFile(rel, root, from = host) {
  assert(!path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..'));
  const source = path.join(from, rel), target = path.join(root, rel);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return;
  originals.set(source, hash(source));
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
}
function copyTree(rel, root, from = host) {
  for (const e of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) copyTree(child, root, from);
    else if (e.isFile()) copyFile(child, root, from);
  }
}
function assertDenials(instruction, blockers) {
  let verificationRefs = 0;
  for (const item of blockers) {
    for (const key of ['scope_ref', 'question', ...(typeof item.answer === 'string' ? ['answer'] : [])]) assert(instruction.includes(item[key]), `${item.scope_ref}: ${key}`);
    assert(instruction.includes('verification_refs=' + JSON.stringify(item.verification_refs ?? [])), `${item.scope_ref}: original verification_refs`);
    verificationRefs += (item.verification_refs ?? []).length;
  }
  return verificationRefs;
}
async function replay(scenario) {
  const from = sourceFor(scenario), sourceRun = path.join(from, runRel);
  // The saved copies' Git baseline precedes our old replay; no host read is needed.
  const baseline = rel => savedCopies ? execFileSync('git', ['show', `HEAD:${rel}`], { cwd: from, maxBuffer: 32 * 1024 * 1024 }) : fs.readFileSync(path.join(from, rel));
  const events = baseline(`${runRel}/events.jsonl`).toString('utf8').trim().split('\n').map(JSON.parse);
  const root = path.join(temp, scenario); fs.mkdirSync(root);
  copyTree(runRel, root, from); copyTree(`doc/features/${feature}/blueprint`, root, from);
  copyFile('framework.config.json', root, from);
  fs.writeFileSync(path.join(root, `doc/features/${feature}/blueprint/component-blueprint.yaml`), baseline(`doc/features/${feature}/blueprint/component-blueprint.yaml`));
  if (savedCopies) for (const call of savedCopies.outputs.find(row => row.scenario === scenario).newCalls) {
    const priorRequest = path.join(root, runRel, 'phases', call.phase, call.invoke_id);
    assert(priorRequest.startsWith(path.join(root, runRel, 'phases') + path.sep));
    fs.rmSync(priorRequest, { recursive: true, force: true });
  }
  const request17 = read(path.join(sourceRun, 'phases/initial-design-questioning/initial-design-questioning-i17/request-e1.json'));
  // Snapshot paths are hashes only. Copy business inputs; never copy native configuration or credentials.
  const inputs = request17.pre_snapshot.entries.map(e => e.path).filter(rel => /^(doc\/|0[1-9]-|src\/)/.test(rel) && !rel.includes('/goal-runs/'));
  for (const rel of inputs) copyFile(rel, root, from);
  for (const rel of read(path.join(sourceRun, 'manifest.json')).requirement_source_files) copyFile(rel, root, from);
  const { frameworkRoot } = provisionFrameworkUnder(root), runDir = path.join(root, runRel);
  fs.writeFileSync(path.join(root, '.gitignore'), 'framework/\n.trust/\n');
  git(root, ['init', '-q']); git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=Replay', '-c', 'user.email=replay@example.invalid', 'commit', '-qm', 'Preserved original business inputs']);
  // Historical process handles must never be used against host processes in an isolated replay.
  for (const name of ['.runner.lock', 'liveness.json', 'run-control.json']) {
    const file = path.join(runDir, name); if (fs.existsSync(file)) fs.renameSync(file, file + '.original');
  }
  const beforeEvents = scenario === 'after-i16'
    ? events.slice(0, events.findIndex(e => e.type === 'agent_invoke_start' && e.invoke_id === 'initial-design-questioning-i17')) : events;
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), beforeEvents.map(e => JSON.stringify(e)).join('\n') + '\n');
  const blueprint = path.join(root, `doc/features/${feature}/blueprint/component-blueprint.yaml`);
  if (scenario === 'after-i16') fs.copyFileSync(path.join(sourceRun, 'phases/initial-design-questioning/initial-design-questioning-i17/blueprint-before.yaml'), blueprint);
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(temp, `${scenario}-trust`);
  const entry = require(path.join(frameworkRoot, 'harness/scripts/goal-mode-entry'));
  const material = require(path.join(frameworkRoot, 'harness/scripts/utils/design-repair-unattended'));
  const parse = require(path.join(frameworkRoot, 'harness/scripts/utils/blueprint-questioning')).parseIndependentQuestioningOutput;
  let latest;
  for (const e of [...beforeEvents].reverse()) {
    if (e.type !== 'agent_invoke_start' || e.phase !== 'initial-design-questioning') continue;
    const o = material.readDesignQuestioningOriginal(runDir, e, beforeEvents);
    if (!o?.completed || !o.output) continue;
    try { latest = { e, o, parsed: parse(o.output) }; break; } catch {}
  }
  const result = await entry.runGoalModeSessionStep({ projectRoot: root, frameworkRoot, feature, runId, adapter: 'deepseek-harness',
    runMode: 'attended', forceTakeover: true, authorization: { mode: 'goal_mode', autonomyAuthorized: true } });
  const after = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const dispatched = after.slice(beforeEvents.length).filter(e => e.type === 'agent_invoke_start');
  const request = result.request?.path ? read(result.request.path) : undefined;
  assert.equal(result.run_id, runId);
  assert.deepEqual(dispatched.map(e => e.phase), ['initial-design-author']);
  const blockers = latest.parsed.items.filter(i => i.disposition === 'blocker');
  if (scenario === 'after-i16') assert.equal(blockers.length, 9);
  const verificationRefs = assertDenials(request.context.instruction, blockers);
  const author = 'phases/initial-design-author/initial-design-author-i1/draft-output.yaml';
  assert.equal(hash(path.join(runDir, author)), hash(path.join(sourceRun, author)));
  const review = require(path.join(frameworkRoot, 'harness/scripts/utils/blueprint-review-materialization')).loadBlueprintReviewSource(root, feature);
  assert.equal(review.inputs.questioning.items.filter(i => i.outcome === 'blocker').length, blockers.length);
  const output = { scenario, root, result, newCalls: dispatched.map(e => ({ phase: e.phase, invoke_id: e.invoke_id })), latestValid: latest?.e.invoke_id,
    blockers: blockers.length, verificationRefs, fullDenialDelivered: true, projectionBlockers: blockers.length,
    authorI1: hash(path.join(runDir, 'phases/initial-design-author/initial-design-author-i1/draft-output.yaml')),
    originalTailPreserved: after.slice(0, beforeEvents.length).every((e, i) => JSON.stringify(e) === JSON.stringify(beforeEvents[i])),
    instruction: request?.context.instruction };
  fs.writeFileSync(path.join(__dirname, `${resultPrefix}-${scenario}.json`), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ scenario, result, newCalls: output.newCalls, latestValid: output.latestValid, root }));
  return output;
}
function verifySavedOutputs() {
  const summary = read(path.join(__dirname, `${resultPrefix}-summary.json`));
  const parse = require('../scripts/utils/blueprint-questioning').parseIndependentQuestioningOutput;
  const projection = require('../scripts/utils/blueprint-review-materialization');
  const rows = summary.outputs.map(o => {
    assert.equal(o.result.run_id, runId);
    assert.deepEqual(o.newCalls.map(e => e.phase), ['initial-design-author']); assert(o.originalTailPreserved);
    const rd = path.join(o.root, runRel), q = parse(fs.readFileSync(path.join(rd, 'phases/initial-design-questioning', o.latestValid, 'questioning-output.json'), 'utf8'));
    const blockers = q.items.filter(i => i.disposition === 'blocker');
    if (o.scenario === 'after-i16') assert.equal(blockers.length, 9);
    const verificationRefs = assertDenials(o.instruction, blockers);
    const author = 'phases/initial-design-author/initial-design-author-i1/draft-output.yaml';
    assert.equal(hash(path.join(rd, author)), hash(path.join(sourceFor(o.scenario), runRel, author)));
    const src = projection.loadBlueprintReviewSource(o.root, feature);
    const outcomes = src.inputs.questioning.items.reduce((a, i) => (a[i.outcome] = (a[i.outcome] || 0) + 1, a), {});
    assert.equal(outcomes.blocker, blockers.length);
    return { scenario: o.scenario, latestValid: o.latestValid, blockers: blockers.length, scopes: blockers.map(i => i.scope_ref),
      questionTextDelivered: true, answerFieldsPresent: blockers.filter(i => typeof i.answer === 'string').length,
      separateVerificationRefsForwarded: true, verificationRefs, missingVerificationRefs: 0, authorI1Preserved: true, phase: o.result.phase, projectionOutcomes: outcomes, originalTailPreserved: true };
  });
  fs.writeFileSync(path.join(__dirname, `${resultPrefix}-verified.json`), JSON.stringify({ ...(savedCopies ? { sourceCopiesUnchanged: summary.sourceCopiesUnchanged, hostRead: false } : { hostFilesUnchanged: summary.hostUnchanged }), copiedOriginalFiles: summary.originalFiles, rows }, null, 2) + '\n');
  console.log(JSON.stringify(rows));
}
if (process.argv.includes('--verify-existing')) verifySavedOutputs();
else (async () => {
  const outputs = [];
  for (const scenario of ['after-i16', 'actual-i172']) {
    try { outputs.push(await replay(scenario)); }
    catch (e) { console.error(scenario, e.stack); outputs.push({ scenario, error: e.stack }); }
  }
  assert([...originals].every(([file, digest]) => hash(file) === digest), 'source bytes changed');
  assert(outputs.every(row => !row.error), 'replay failed');
  fs.writeFileSync(path.join(__dirname, `${resultPrefix}-summary.json`), JSON.stringify({ temp, originalFiles: originals.size,
    ...(savedCopies ? { sourceCopiesUnchanged: true, hostRead: false } : { hostUnchanged: true }), outputs }, null, 2) + '\n');
  verifySavedOutputs();
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
