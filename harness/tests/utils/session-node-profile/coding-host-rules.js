const { compile, check } = require('./native.cjs');
exports.profileCodingHost = {
  sourceFileSuffixes: ['.ts'],
  runStructureChecks: () => [],
  runTraceabilityChecks: () => [],
  checkCodingCompile: ctx => { const r = compile(ctx, ctx.featureSpec.contracts.files); return [check('coding_compile', r.ok, r.details)]; },
};
