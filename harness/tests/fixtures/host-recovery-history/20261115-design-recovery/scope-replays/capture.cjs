// Read completed historical artifacts only; never execute or modify the source host.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), zlib = require('zlib');
const { createRequire } = require('module');
const sourceRoot = path.resolve(__dirname, '../../../../../..');
const req = createRequire(path.join(sourceRoot, 'harness/package.json'));
req('ts-node').register({ project: path.join(sourceRoot, 'harness/tsconfig.json'), transpileOnly: true });
const YAML = req('yaml');
const model = req(path.join(sourceRoot, 'harness/scripts/utils/component-blueprint-model'));
const current = req(path.join(sourceRoot, 'harness/scripts/utils/blueprint-questioning'));
const loadedSelectorSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, 'harness/scripts/utils/blueprint-questioning.ts'))).digest('hex');
const dependency = req(path.join(sourceRoot, 'harness/scripts/utils/design-repair-unattended'));
const { diffPhaseInvocationSnapshots } = req(path.join(sourceRoot, 'harness/scripts/utils/phase-write-boundary'));
const { clearFrameworkConfigCache } = req(path.join(sourceRoot, 'harness/config'));
const host = process.argv[2], oldRoot = process.argv[3];
if (!host || !oldRoot) throw Error('Usage: node capture.cjs <ended-goal-run> <R3-source-root>');
const r3 = req(path.join(path.resolve(oldRoot), 'harness/scripts/utils/blueprint-questioning'));
const pairs = [[3, 5], [6, 8], [13, 15], [15, 17], [8, 10], [10, 13]];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snapshots = {}, full = {}, sources = [];
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'a920-history-capture-')));
try {
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: 'HistoricalScopeReplay',
    project_profile: { name: 'hmos-app' }, paths: { features_dir: 'doc/features' } }));
  clearFrameworkConfigCache();
  for (const n of [...new Set(pairs.flat())].sort((a, b) => a - b)) {
    const name = `initial-design-questioning-i${n}`, dir = path.join(host, 'phases/initial-design-questioning', name);
    const read = file => {
      const bytes = fs.readFileSync(path.join(dir, file));
      sources.push({ invocation: name, file, sha256: sha(bytes), bytes: bytes.length });
      return bytes;
    };
    const bytes = read('blueprint-before.yaml'), doc = YAML.parse(bytes.toString('utf8'));
    const raw = read('questioning-output.json'), result = current.parseIndependentQuestioningOutput(raw.toString('utf8'));
    const observation = JSON.parse(read('design-result.json').toString('utf8')).outcome;
    if (!(observation.started && observation.ok && observation.status === 'passed')) throw Error('Source invocation is not completed: ' + name);
    if (diffPhaseInvocationSnapshots(observation.preSnapshot, observation.postSnapshot).kind !== 'clean') throw Error('Independent source changed protected inputs: ' + name);
    const previous = current.independentQuestioningEnvelope(result, 'initial-design-questioning', doc.review_summary.authored_by, doc.review_summary.questioning);
    const minimal = { status: previous.status, provider_id: previous.provider_id, isolated_context: previous.isolated_context,
      writes_ssot: previous.writes_ssot, items: previous.items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) =>
        ['question_id', 'scope_kind', 'scope_ref', 'disposition', 'question', 'answer', 'rationale', 'owner', 'authority', 'verification_refs', 'evidence_refs', 'provenance'].includes(key)))) };
    for (const item of minimal.items) {
      // Only presence/equality of these prose fields is consumed; keep the true verdict and all evidence addresses.
      for (const key of ['question', 'answer', 'rationale', 'owner']) if (typeof item[key] === 'string' && item[key]) item[key] = 'public-text-sha256:' + sha(item[key]);
      if (item.provenance?.extraction_method) item.provenance.extraction_method = 'public-text-sha256:' + sha(item.provenance.extraction_method);
    }
    const native = read('agent-events.jsonl').toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    let header;
    for (const call of native.filter(event => event.type === 'tool_call' && event.tool === 'read'
      && String(event.input?.file_path ?? event.input?.path).replace(/\\/g, '/').endsWith('/component-blueprint.review.md')
      && Number(event.input?.offset ?? 1) === 1)) {
      const returned = native.find(event => event.type === 'tool_result' && event.callId === call.callId && event.status !== 'error');
      if (typeof returned?.result !== 'string') continue;
      const lines = returned.result.split('\n').flatMap(line => { const hit = /^(\d+): ?(.*)$/.exec(line); return hit ? [{ n: Number(hit[1]), text: hit[2] }] : []; });
      const end = lines.findIndex((line, i) => i > 0 && line.text === '---');
      if (lines[0]?.n === 1 && lines[0]?.text === '---' && end > 0) {
        header = { text: lines.slice(0, end + 1).map(line => line.text).join('\n') + '\n', callId: call.callId };
        break;
      }
    }
    if (!header) throw Error('Historical public review header missing: ' + name);
    const blueprint = model.blueprintAuthorContent(doc);
    // Machine author identity is needed by the existing independent-result validator.
    blueprint.review_summary = { ...blueprint.review_summary, authored_by: doc.review_summary.authored_by };
    snapshots[n] = { blueprint, previous: minimal, preSnapshot: observation.preSnapshot, reviewHeader: header };
    full[n] = { blueprint: doc, previous, preSnapshot: observation.preSnapshot };
  }
  const referenced = new Set();
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['source_ref', 'source_refs', 'knowledge_assets', 'verification_refs', 'evidence_refs'].includes(key)) {
        for (const ref of typeof child === 'string' ? [child] : Array.isArray(child) ? child : []) {
          if (typeof ref !== 'string' || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) continue;
          const file = ref.replace(/\\/g, '/').split(/#|:(?=\d)/)[0];
          if (file) referenced.add(file);
        }
      } else collect(child);
    }
  };
  for (const original of Object.values(full)) { collect(original.blueprint); collect(original.previous); }
  for (const snapshot of Object.values(snapshots)) snapshot.preSnapshot = { ...snapshot.preSnapshot,
    entries: snapshot.preSnapshot.entries.filter(entry => [...referenced].some(ref => entry.path === ref || entry.path.startsWith(ref + '/'))) };
  const pairResults = [];
  const ownPath = path.join(root, 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml');
  const reviewPath = path.join(path.dirname(ownPath), 'component-blueprint.review.md');
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  for (const [first, revised] of pairs) {
    const before = snapshots[first], after = snapshots[revised];
    fs.writeFileSync(reviewPath, after.reviewHeader.text);
    const changes = dependency.questioningDependencyChanges(root, after.blueprint, before.preSnapshot, ownPath, after.preSnapshot, before.previous)
      .map(item => ({ ...item, path: path.relative(root, item.path).replace(/\\/g, '/') }));
    const fullChanges = dependency.questioningDependencyChanges(root, full[revised].blueprint, full[first].preSnapshot, ownPath,
      full[revised].preSnapshot, full[first].previous).map(item => ({ ...item, path: path.relative(root, item.path).replace(/\\/g, '/') }));
    if (!equal(changes, fullChanges)) throw Error('Snapshot reduction changes actual dependency analysis: ' + first + ' -> ' + revised);
    const paths = changes.map(item => item.path);
    const oldSelected = r3.selectQuestioningScopes(full[first].blueprint, full[revised].blueprint, full[first].previous, paths);
    const oldProjected = r3.selectQuestioningScopes(before.blueprint, after.blueprint, before.previous, paths);
    const selected = current.selectQuestioningScopes(full[first].blueprint, full[revised].blueprint, full[first].previous, paths);
    const projected = current.selectQuestioningScopes(before.blueprint, after.blueprint, before.previous, paths);
    if (!equal(oldSelected, oldProjected) || !equal(selected, projected)) throw Error('Projection changes actual selection: ' + first + ' -> ' + revised);
    pairResults.push({ first, revised, r3Selected: oldSelected, selected, changedDependencies: changes,
      pendingBefore: before.previous.items.filter(item => ['blocker', 'open_decision'].includes(item.disposition)).map(item => ({ scope: item.scope_ref, disposition: item.disposition })),
      originalVersusProjectionEqual: true });
  }
  const bundle = { sourceRun: path.basename(host), snapshots };
  const bytes = Buffer.from(JSON.stringify(bundle));
  const bundlePath = path.join(__dirname, 'inputs.json.gz'), compressed = zlib.gzipSync(bytes, { level: 9 });
  if (!fs.existsSync(bundlePath) || !fs.readFileSync(bundlePath).equals(compressed)) fs.writeFileSync(bundlePath, compressed);
  const report = { sourceRun: path.basename(host), readOnlyEndedArtifacts: true,
    transform: 'blueprintAuthorContent plus original author identity; Q prose is replaced by SHA256, verdicts/validation shape/evidence addresses retained; preSnapshot entries narrowed to declared source/evidence paths across these actual originals (dependency results checked against full snapshots); public review frontmatter retained; no reasoning or native transcript stored',
    r3SelectorSha256: sha(fs.readFileSync(path.join(oldRoot, 'harness/scripts/utils/blueprint-questioning.ts'))),
    selectorSha256: loadedSelectorSha256,
    snapshotReduction: Object.entries(snapshots).map(([invocation, snapshot]) => ({ invocation,
      originalEntries: full[invocation].preSnapshot.entries.length, preservedEntries: snapshot.preSnapshot.entries.length, independentWriteDiff: 'clean' })),
    bundleSha256: sha(bytes), bundleBytes: bytes.length, sources, pairs: pairResults };
  fs.writeFileSync(path.join(__dirname, 'sources-and-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(pairResults.map(pair => ({ first: pair.first, revised: pair.revised, R3: pair.r3Selected.length,
    final: pair.selected.length, dependencyChanges: pair.changedDependencies.length, selected: pair.selected })), null, 2));
} finally {
  clearFrameworkConfigCache();
  if (!root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)) throw Error('Temporary root escaped');
  fs.rmSync(root, { recursive: true, force: true });
}
