#!/usr/bin/env node
/**
 * 本地假宿主 stub — 模拟 fetch_fidelity 写 PNG + fidelity.lock.yaml
 * 用法：node fidelity-fetch-stub.mjs <projectRoot> <feature> [cacheDir]
 * 不含真实内网鉴权；供 harness fixture / 演示。
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function minimalPng(width, height) {
  // 1x1 透明 PNG
  void width;
  void height;
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

const projectRoot = process.argv[2];
const feature = process.argv[3];
const cacheDirArg = process.argv[4];

if (!projectRoot || !feature) {
  console.error('Usage: fidelity-fetch-stub.mjs <projectRoot> <feature> [cacheDir]');
  process.exit(1);
}

const cacheDir = cacheDirArg
  ? path.resolve(projectRoot, cacheDirArg)
  : path.join(projectRoot, 'doc', 'features', feature, 'ux-reference', '_fidelity-cache');

const screens = [
  { id: 'home', png: 'home.png', node_ref: 'stub:home' },
  { id: 'page2', png: 'page2.png', node_ref: 'stub:page2' },
];

fs.mkdirSync(cacheDir, { recursive: true });
for (const s of screens) {
  fs.writeFileSync(path.join(cacheDir, s.png), minimalPng(1, 1));
}

const structured = {
  schema_version: '1.0',
  node_to_semantic_id: { 'Frame 1207': 'search_bar' },
  elements: [
    { element_id: 'search_bar', text: '搜索', disposition: 'implement' },
    { source_node_ref: 'Frame 1207', text: '搜索', disposition: 'implement' },
  ],
};
fs.writeFileSync(
  path.join(cacheDir, 'structured-elements.yaml'),
  `schema_version: "1.0"\nnode_to_semantic_id:\n  "Frame 1207": search_bar\nelements:\n  - element_id: search_bar\n    text: 搜索\n    disposition: implement\n`,
  'utf-8',
);

const lock = {
  schema_version: '1.0',
  source_link: 'https://stub.example/fidelity/demo',
  fetched_at: new Date().toISOString(),
  version_id: 'stub-v1',
  viewport: { w: 393, h: 852, dpr: 3 },
  structured_bundle: 'structured-elements.yaml',
  screens,
};

const lockYaml = [
  'schema_version: "1.0"',
  'source_link: https://stub.example/fidelity/demo',
  `fetched_at: "${lock.fetched_at}"`,
  'version_id: stub-v1',
  'viewport:',
  '  w: 393',
  '  h: 852',
  '  dpr: 3',
  'structured_bundle: structured-elements.yaml',
  'screens:',
  ...screens.map(s => `  - id: ${s.id}\n    png: ${s.png}\n    node_ref: "${s.node_ref}"`),
].join('\n');

fs.writeFileSync(path.join(cacheDir, 'fidelity.lock.yaml'), `${lockYaml}\n`, 'utf-8');
console.error(`[fidelity-fetch-stub] wrote ${screens.length} PNG + lock → ${cacheDir}`);
