const nodeTest = require('node:test');
const { syncBuiltinESMExports } = require('node:module');
const { pathToFileURL } = require('node:url');

async function runRootTests(file, discover, boundary) {
  const cases = [];
  const hooks = { before: [], beforeEach: [], afterEach: [], after: [] };
  const original = Object.fromEntries(['test', 'it', 'describe', 'suite', ...Object.keys(hooks)].map(key => [key, nodeTest[key]]));
  function register(name, options, run) {
    if (typeof options === 'function') { run = options; options = undefined; }
    if (typeof name !== 'string' || typeof run !== 'function' || options?.skip || options?.todo || options?.only) {
      throw new Error(`invalid root test registration: ${name}`);
    }
    cases.push({ name, run, options });
  }
  for (const name of ['only', 'skip', 'todo']) {
    register[name] = () => { throw new Error(`root test cannot use ${name}`); };
  }
  nodeTest.test = register;
  nodeTest.it = register;
  nodeTest.describe = nodeTest.suite = () => { throw new Error('declare root test cases at module level'); };
  for (const key of Object.keys(hooks)) nodeTest[key] = (...args) => hooks[key].push(args);
  syncBuiltinESMExports();
  try { await import(pathToFileURL(file).href); }
  finally {
    Object.assign(nodeTest, original);
    syncBuiltinESMExports();
  }
  const names = cases.map(test => test.name);
  const results = [];
  if (discover || !names.length) return { names, results };

  for (const [key, handlers] of Object.entries(hooks)) {
    for (const args of handlers) original[key](...args);
  }
  const index = new Map(names.map((name, index) => [name, index]));
  original.beforeEach(ctx => {
    boundary('start', ctx.name);
  });
  original.afterEach(ctx => {
    if (index.get(ctx.name) !== cases.length - 1) boundary('end', ctx.name);
  });
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  original.after(() => {
    boundary('end', names.at(-1));
    finish();
  });
  const runs = cases.map(({ name, options, run }) => original.test(name, { ...options, concurrency: false }, async ctx => {
    ctx.test = () => { throw new Error('declare root test cases at module level'); };
    ctx.skip = () => { throw new Error('root test cannot skip'); };
    ctx.todo = () => { throw new Error('root test cannot be todo'); };
    try {
      await run(ctx);
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
  }));
  await Promise.all([...runs, finished]);
  return { names, results };
}

module.exports = { runRootTests };
