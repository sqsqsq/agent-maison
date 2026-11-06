const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), assert = require('assert/strict');
const { spawnSync } = require('child_process');
const repo = path.resolve(__dirname, '../..');
process.env.TS_NODE_PROJECT = path.join(repo, 'harness/tsconfig.json');
require('ts-node/register/transpile-only');
const { Jimp } = require('jimp');
const { freezeModelPin } = require('../scripts/utils/adapter-model');
const { invokeAgentHeadless } = require('../scripts/utils/agent-invoke');
const { invokeVisualProvider, hashImageFile, extractJsonObjectFromText, validateProviderIdentityEcho } = require('../scripts/utils/visual-provider-invoke');
const { parseVisualObservationPayload } = require('../scripts/utils/visual-observation-sidecar');
const metadata = require('./remaining-3.1.0-dsh-metadata.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-dsh-visual-real-'));
const project = path.join(root, 'visual'); fs.mkdirSync(project);
spawnSync('git', ['init', '-q'], { cwd: project });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(root) {
  const result = {};
  function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const file = path.join(dir, e.name);
    if (e.isDirectory()) walk(file); else if (e.isFile()) result[path.relative(root, file)] = hash(file);
  } }
  walk(root); return result;
}
const redact = text => String(text || '').replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]');
(async () => {
  const palette = [['red', 0xff0000ff], ['blue', 0x0000ffff], ['green', 0x00aa00ff], ['yellow', 0xffcc00ff]];
  for (let i = palette.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [palette[i], palette[j]] = [palette[j], palette[i]]; }
  const picture = new Jimp({ width: 128, height: 128, color: 0xffffffff });
  palette.forEach((color, i) => picture.composite(new Jimp({ width: 64, height: 64, color: color[1] }), (i % 2) * 64, Math.floor(i / 2) * 64));
  const a = path.join(project, 'input-a.png'), b = path.join(project, 'input-b.jpg');
  await picture.write(a);
  fs.copyFileSync(path.join(repo, 'harness/tests/fixtures/component-selection-handoff/dependencies/doc/features/原始需求/1-2-银行卡/6-短信验证完成后结果页.jpg'), b);
  fs.writeFileSync(path.join(project, 'sentinel.txt'), 'unchanged\n');
  const before = files(project), images = [a, b], hashes = images.map(hashImageFile);
  const pin = freezeModelPin({ adapter: 'deepseek-harness', provider: metadata.defaultModel.provider, value: metadata.defaultModel.model, reasoning_effort: 'high', config_source: metadata.source }, project);
  const provider = { ...pin, model: pin.value }; delete provider.value;
  const earlier = path.join(root, 'earlier-model.yaml');
  fs.writeFileSync(earlier, '- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-v4-pro\n');
  let invocationArgs, nativeOutcome;
  const prompt = `Use read_image to inspect EACH of these two files: ${images.join(', ')}. Return only a JSON object with run_id="4e92a7c6", attempt_id="H1", image_hashes=${JSON.stringify(hashes)}, quadrant_colors=[the English names of the first image's dominant top-left, top-right, bottom-left, bottom-right colors], observations=[{region:"first",fact:"the actually observed colors"},{region:"second",fact:"two Chinese text labels actually visible in the second image"}]. Do not use OCR or other tools. This is a read-only visual inspection. Do not change any file.`;
  const result = await invokeVisualProvider({ projectRoot: project, frameworkRoot: repo, provider, purpose: 'spec_observation', prompt,
    imagePaths: images, invokeId: '4e92a7c6-H1', evidenceDir: path.join(root, 'visual-evidence'), timeoutMs: 60000,
    invokeAgent: async (plan, cwd, options) => {
      const index = plan.argv.lastIndexOf('--patch');
      const argv = [...plan.argv.slice(0, index), '--patch', earlier, ...plan.argv.slice(index)];
      invocationArgs = argv;
      const result = await invokeAgentHeadless({ ...plan, argv }, cwd, { ...options, extraEnv: { ...options.extraEnv,
        DSH_PERMISSION_MODE: 'danger-full-access', dsh_permission_mode: 'workspace-write' } });
      nativeOutcome = { exitCode: result.exitCode, model_binding_mismatch: result.model_binding_mismatch, terminal_error_excerpt: redact(result.terminal_error_excerpt), stderr: redact(result.stderr), readonly_enforced: result.readonly_enforced, provider_session_id: result.provider_session_id };
      return result;
    } });
  const unchanged = JSON.stringify(before) === JSON.stringify(files(project)); assert(unchanged, 'visual project files changed');
  let validation = null;
  if (result.outcome === 'success') {
    const doc = extractJsonObjectFromText(result.body);
    assert.equal(validateProviderIdentityEcho(doc, { runId: '4e92a7c6', attemptId: 'H1', imageHashes: hashes }), null);
    for (const imageHash of hashes) assert(parseVisualObservationPayload(result.body, { imageHash }).ok);
    assert.deepEqual(doc.quadrant_colors.map(s => s.toLowerCase()), palette.map(c => c[0]));
    validation = { identity: true, imageHashes: true, observations: true, randomGeometry: true };
  }
  const report = { root, version: metadata.version, provider, argv: invocationArgs, nativeOutcome, outcome: result.outcome, reason: redact(result.reason),
    body: result.outcome === 'success' ? result.body : null, inputProvenance: result.input_provenance, projectFilesUnchanged: unchanged, validation,
    credentials: 'Resolved only by DSH itself; no credential file was read, copied or hashed by the probe.',
    developmentWriteProbe: 'This script performs no development write probe; that proof is recorded separately. Auth/quota failures are not retried.' };
  fs.writeFileSync(path.join(__dirname, 'remaining-3.1.0-dsh-desktop.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
})().catch(error => { fs.writeFileSync(path.join(__dirname, 'remaining-3.1.0-dsh-desktop.json'), JSON.stringify({ root, error: redact(error.message), outcome: 'unverified' }, null, 2) + '\n'); console.error(redact(error.message)); process.exitCode = 1; });
