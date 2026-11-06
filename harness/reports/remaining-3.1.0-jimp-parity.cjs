const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const assert = require('assert/strict');
const repo = path.resolve(__dirname, '../..');
process.env.TS_NODE_PROJECT = path.join(repo, 'harness/tsconfig.json');
require('ts-node/register/transpile-only');
const pkg = require('jimp'), Jimp = pkg.Jimp || pkg;
const { renderCanaryImage } = require('../scripts/utils/vision-canary');
const { FIXTURE_CANARY_KEY } = require('../tests/utils/canary-fixture-key');
const worker = path.join(repo, 'profiles/hmos-app/harness/image-jimp-worker.cjs');
const mode = process.argv[2] || 'baseline';
const stateFile = path.join(__dirname, 'remaining-3.1.0-jimp-parity.json');
const prior = mode === 'baseline' ? null : JSON.parse(fs.readFileSync(stateFile));
const root = prior?.root || fs.mkdtempSync(path.join(os.tmpdir(), 'maison-jimp-parity-'));
const dir = path.join(root, mode); fs.mkdirSync(dir, { recursive: true });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const invoke = (...args) => {
  const r = spawnSync(process.execPath, [worker, ...args.map(String)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr); const value = JSON.parse(r.stdout); assert(value.ok === true || value.sampled === true); return value;
};
(async () => {
  const input = path.join(root, 'input.png');
  if (!prior) {
    const image = new Jimp(160, 200, 0xffffffff);
    image.scan(10, 20, 140, 160, function(x, y, idx) {
      this.bitmap.data[idx] = (x * 3 + y) % 210 + 21; this.bitmap.data[idx + 1] = (x + y * 2) % 210 + 21;
      this.bitmap.data[idx + 2] = (x + y) % 210 + 21; this.bitmap.data[idx + 3] = 255;
    });
    await image.writeAsync(input);
  }
  const screenshot = path.join(repo, 'harness/tests/fixtures/component-selection-handoff/dependencies/doc/features/原始需求/1-2-银行卡/6-短信验证完成后结果页.jpg');
  const crop = path.join(dir, 'crop.png'), top = path.join(dir, 'top.png'), canary = path.join(dir, 'canary.png'), contact = path.join(dir, 'contact.png');
  const metrics = { crop: invoke('crop', input, .1, .1, .7, .6, .05, crop), top: invoke('crop-top', screenshot, 400, top),
    sample: invoke('sample', input, .1, .1, .7, .6, .05), stats: invoke('stats', screenshot),
    hist: invoke('hist-sim', input, screenshot), tile: invoke('tile-min', input, screenshot, 3), edge: invoke('edge-tile', input, screenshot, 3, 3, .2) };
  await renderCanaryImage(canary, FIXTURE_CANARY_KEY);
  const args = path.join(dir, 'contact.json');
  fs.writeFileSync(args, JSON.stringify({ source: screenshot, outPath: contact, entries: [{ key: 'crop', bbox: [.1, .1, .7, .6], cropPath: crop }] }));
  metrics.contact = invoke('contact', args);
  const images = {};
  for (const [key, file] of Object.entries({ crop, top, canary, contact })) {
    const image = await Jimp.read(file); images[key] = { width: image.bitmap.width, height: image.bitmap.height, pixels: digest(image.bitmap.data), png: digest(fs.readFileSync(file)) };
    if (prior) {
      const repeat = path.join(dir, key + '-repeat.png'); await image.write(repeat);
      assert.equal(digest(fs.readFileSync(repeat)), images[key].png, `${key} same-version encoding determinism`);
      assert.deepEqual({ ...images[key], png: undefined }, { ...prior.images[key], png: undefined }, `${key} decoded pixels`);
    }
  }
  if (prior) assert.deepEqual(metrics, prior.metrics, 'worker algorithms and thresholds');
  const result = { root, mode, node: process.version, metrics, images, pixelParity: prior ? true : null, sameVersionDeterminism: prior ? true : null,
    changedEncoding: prior ? Object.keys(images).filter(key => images[key].png !== prior.images[key].png) : [] };
  fs.writeFileSync(mode === 'baseline' ? stateFile : path.join(__dirname, 'remaining-3.1.0-jimp-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
