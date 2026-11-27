import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

export function putPlugin(
  root: string, id: string, options: {
    declaration?: Record<string, unknown>;
    selection?: Record<string, unknown>;
    files?: Record<string, string>;
    extensionDir?: string;
  } = {},
): string {
  const extensionRoot = path.join(root, options.extensionDir ?? 'doc/extensions');
  const pluginRoot = path.join(extensionRoot, id);
  fs.mkdirSync(pluginRoot, { recursive: true });
  const manifest = { schema_version: '2.0', kind: 'plugin', name: id, version: '1.0.0', ...options.declaration };
  const defaults = Object.fromEntries(Object.entries(options.declaration?.bindings as Record<string, { enabled_by_default?: boolean }> ?? {})
    .map(([bindingId, binding]) => [bindingId, binding?.enabled_by_default !== false]));
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const target = path.join(pluginRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.writeFileSync(path.join(pluginRoot, 'manifest.yaml'), YAML.stringify(manifest));
  const hostPath = path.join(extensionRoot, 'manifest.yaml');
  const host = fs.existsSync(hostPath)
    ? YAML.parse(fs.readFileSync(hostPath, 'utf8')) : { schema_version: '2.0', kind: 'host', plugins: {} };
  host.plugins[id] = { source: id, enabled: true, bindings: defaults, files: {}, ...options.selection };
  fs.writeFileSync(hostPath, YAML.stringify(host));
  return pluginRoot;
}
