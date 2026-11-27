'use strict';

const path = require('node:path');

function workUnitMayWritePath(resolution, file, options) {
  const normalize = value => path.relative(resolution.projectRoot, path.resolve(resolution.projectRoot, value)).replace(/\\/g, '/');
  const relative = normalize(file);
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return false;
  const within = prefix => relative === prefix || relative.startsWith(prefix + '/');
  if (within('framework') || resolution.immutableInputPaths?.some(file => within(normalize(file)))) return false;
  if (resolution.executionRole === 'verifier') {
    return !!resolution.verifierResultPath && relative === normalize(resolution.verifierResultPath);
  }
  if (resolution.executionRole !== 'author') return false;
  const extensionRoot = resolution.extensionControlRoot && normalize(resolution.extensionControlRoot);
  if (extensionRoot) {
    const comparable = process.platform === 'win32' ? relative.toLowerCase() : relative;
    const root = process.platform === 'win32' ? extensionRoot.toLowerCase() : extensionRoot;
    if (comparable === root || comparable.startsWith(root + '/')) return false;
  }
  if (resolution.domains.some(domain => (domain.match === 'exact' ? relative === domain.path : within(domain.path))
    && !domain.excludedPrefixes?.some(within))) return true;
  return !resolution.domains.length && !!options?.ownedPrefixes?.some(prefix => within(normalize(prefix)))
    && !options?.includeFiles?.some(file => within(normalize(file)));
}

module.exports = { workUnitMayWritePath };
