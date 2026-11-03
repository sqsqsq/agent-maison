const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ts = require('typescript');
const repo = path.resolve(__dirname, '../..');
const outDir = path.resolve(__dirname, '../dist/test-runtime');
const configFile = path.resolve(__dirname, '../tsconfig.typecheck.json');
const read = ts.readConfigFile(configFile, ts.sys.readFile);
if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configFile), {
  noEmit: false, noCheck: true, declaration: false, declarationMap: false,
  sourceMap: true, isolatedModules: true, rootDir: repo, outDir,
});
if (config.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(config.errors, { getCanonicalFileName: f => f, getCurrentDirectory: () => repo, getNewLine: () => '\n' }));
const program = ts.createProgram(config.fileNames, config.options);
const sources = {};
for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile || !/\.tsx?$/.test(source.fileName)) continue;
  const relative = path.relative(repo, source.fileName).replace(/\\/g, '/');
  if (relative.startsWith('../') || relative.split('/').includes('node_modules')) continue;
  sources[relative] = { hash: crypto.createHash('sha256').update(source.text).digest('hex'), output: relative.replace(/\.tsx?$/, '.js') };
}
const emitted = program.emit();
if (emitted.emitSkipped) throw new Error('test runtime emit skipped');
for (const [relative, source] of Object.entries(sources)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, relative), 'utf8')).digest('hex');
  if (actual !== source.hash) throw new Error(`test input changed during compilation: ${relative}`);
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'source-index.json'), JSON.stringify({ version: 1, repo, sources }) + '\n');
console.log(`[BUILD] precompiled ${Object.keys(sources).length} test/source modules; assets use original source paths`);
