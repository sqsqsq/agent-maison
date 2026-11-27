import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { protocolFile, regenerateExtensionProtocol } from '../generate-extension-protocol.mjs';

test('发布件 Extension 接入协议的宿主字段、插件字段和时点表跟随 schema', () => {
  const markdown = fs.readFileSync(protocolFile, 'utf8');
  assert.equal(regenerateExtensionProtocol(markdown), markdown, '运行 node scripts/generate-extension-protocol.mjs 刷新生成区段');
});

test('Extension 协议正文包含随包 design-notes 完整示例', () => {
  const markdown = fs.readFileSync(protocolFile, 'utf8');
  const sample = new URL('../operations/samples/design-notes/', protocolFile);
  for (const [name, syntax] of [
    ['manifest.yaml', 'yaml'],
    ['knowledge/design-notes/guide.md', 'markdown'],
    ['skills/design-notes/SKILL.md', 'markdown'],
  ]) {
    const source = fs.readFileSync(new URL(name, sample), 'utf8').trimEnd();
    assert.ok(markdown.includes(`\n\x60${name}\x60\n\n\x60\x60\x60${syntax}\n${source}\n\x60\x60\x60\n`), name);
  }
});
