const path = require('path');
exports.resolveUtSourceRoots = (root, modules) => modules.map(m => path.join(root, m.package_path, 'src/test'));
exports.diffExcludeTestPathRegexes = [/\/src\/test\//];
