const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const outDir = path.resolve(__dirname, '../dist/test-runtime');
const build = JSON.parse(fs.readFileSync(path.join(outDir, 'source-index.json'), 'utf8'));
if (build.version !== 1) throw new Error('unsupported test runtime build');
const byHash = new Map(Object.values(build.sources).map(source => [source.hash, source]));
const sourceMaps = new Map();
require('@cspotcode/source-map-support').install({ environment: 'node', retrieveSourceMap(filename) {
  return sourceMaps.get(filename) ?? null;
} });
require.extensions['.ts'] = (module, filename) => {
  const relative = path.relative(build.repo, filename).replace(/\\/g, '/');
  const text = fs.readFileSync(filename, 'utf8');
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const original = build.sources[relative];
  if (original && original.hash !== hash) throw new Error(`test input changed after compilation: ${relative}`);
  const source = original ?? byHash.get(hash);
  let code;
  if (source) {
    const output = path.join(outDir, source.output);
    const map = JSON.parse(fs.readFileSync(output + '.map', 'utf8'));
    map.sourceRoot = ''; map.sources = [filename];
    sourceMaps.set(filename, { url: filename, map });
    code = fs.readFileSync(output, 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '//# sourceMappingURL=' + pathToFileURL(output + '.map').href);
  } else {
    if (!relative.startsWith('../') && !path.isAbsolute(relative) && !relative.split('/').includes('fixtures') && !relative.split('/').includes('node_modules')) throw new Error(`source absent from test build: ${relative}`);
    // Generated/mutated fixture modules are test data; preserve their former transpile-only behavior.
    code = require('typescript').transpileModule(text, { compilerOptions: { target: 7, module: 1, esModuleInterop: true, sourceMap: false }, fileName: filename }).outputText;
  }
  module._compile(code, filename);
};
require.extensions['.ts'].precompiledTestRuntime = true;
