import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const { parse } = createRequire(new URL('../harness/package.json', import.meta.url))('yaml');
export const protocolFile = new URL('../docs/evolution/extension-protocol-v1.md', import.meta.url);

function schema(name) {
  return parse(fs.readFileSync(new URL(`../specs/${name}`, import.meta.url), 'utf8'));
}

function table(head, rows) {
  const row = cells => `| ${cells.map(cell => String(cell).replace(/\s+/g, ' ').replaceAll('|', '\\|').trim()).join(' | ')} |`;
  return [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
}

function fieldTable() {
  const manifest = schema('instance-extension-manifest.schema.yaml');
  const rows = [];
  const code = value => `\`${value}\``;
  function fields(node, name, since, author, required) {
    if (node.$ref) node = { ...manifest.$defs[node.$ref.split('/').at(-1)], ...node };
    since = node['x-since'] ?? since;
    author = node['x-author'] ?? author;
    if (node.description) {
      rows.push([code(name), since, author, node['x-required'] ?? (required ? '是' : '可选'),
        node.default === undefined ? '—' : code(JSON.stringify(node.default)), node.description]);
    }
    for (const [key, field] of Object.entries(node.properties ?? {})) {
      if (!field.description) throw new Error(`扩展协议字段缺少效果说明 ${name ? `${name}.` : ''}${key}`);
      fields(field, name ? `${name}.${key}` : key, since, author, node.required?.includes(key));
    }
    if (typeof node.additionalProperties === 'object') fields(node.additionalProperties, `${name}.${node['x-key'] ?? '<键>'}`, since, author, false);
    if (node.items) fields(node.items, `${name}[]`, since, author, false);
    for (const choice of node.oneOf ?? []) {
      if (choice.properties) fields(choice, name, choice['x-since'] ?? since, author, required);
    }
  }
  fields(manifest.root_object, '', '1.0+', '来源或宿主', false);
  return table(['字段路径', '版本起点', '填写方', '必填', '默认', '运行效果'], rows);
}

function timingTable() {
  const lifecycle = schema('lifecycle-hooks-schema.yaml');
  const { scope, resources, consumers } = lifecycle.hook_contributions;
  const show = ({ id, description, scope, resources, consumer, consumers }) => [
    `\`${id}\``, description, scope === 'project' ? '项目，省略 `phase`' : scope === 'feature' ? 'Feature，填有效 `phase`' : 'harness，填有效 `phase`',
    consumer ?? Object.entries(consumers).map(([resource, owner]) => `\`${resource}\`：${owner}`).join('；'),
    resources.map(resource => `\`${resource}\``).join('、'),
  ];
  const timings = [...lifecycle.contribution_timings, ...lifecycle.hook_events.map(hook => ({
    ...hook, id: `harness.${hook.id}@${hook.version}`, scope, resources, consumers,
  }))];
  return table(['时点 ID', '实际触发时刻', '范围与阶段', '消费者', '资源'], timings.map(show));
}

export function regenerateExtensionProtocol(markdown) {
  for (const [name, render] of [['manifest-fields', fieldTable], ['supported-timings', timingTable]]) {
    const start = `<!-- BEGIN GENERATED ${name} -->`;
    const end = `<!-- END GENERATED ${name} -->`;
    const first = markdown.indexOf(start);
    const last = markdown.indexOf(end);
    if (first < 0 || last <= first) throw new Error(`缺少生成区段 ${name}`);
    markdown = `${markdown.slice(0, first)}${start}\n${render()}\n${markdown.slice(last)}`;
  }
  return markdown;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const before = fs.readFileSync(protocolFile, 'utf8');
  fs.writeFileSync(protocolFile, regenerateExtensionProtocol(before), 'utf8');
}
