import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { auditSchemaSupport, validateLiteSchema } from '../../scripts/utils/lite-json-schema';
import type { UnitCaseResult } from '../run-unit';

const skillDir = path.resolve(__dirname, '../../../extensions/skills/ux-behavior-spec');
const sampleDir = path.join(skillDir, 'examples/bc-openCard-2');

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const hasOwn = (object: Fields, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

function yamlFiles(dir: string): Map<string, Fields> {
  return new Map(fs.readdirSync(dir).filter(name => name.endsWith('.ux.yaml')).map(name => {
    const file = path.join(dir, name);
    return [file, fields(YAML.parse(fs.readFileSync(file, 'utf8')))];
  }));
}

function visit(value: unknown, check: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    value.forEach(item => visit(item, check));
    return;
  }
  for (const [key, item] of Object.entries(fields(value))) {
    check(key, item);
    visit(item, check);
  }
}

function sourceFiles(file: string, doc: Fields): Map<string, string> {
  return new Map(Object.entries(fields(doc.sources))
    .map(([id, source]) => [id, path.resolve(path.dirname(file), String(source))]));
}

function assertObservationReferences(doc: Fields): void {
  const visual = fields(doc.visual);
  if (visual.observation !== 'unobserved') return;
  visit(doc, (key, value) => {
    const refs = key === 'evidence' ? list(value) : key === 'copy_ref' ? [value] : [];
    for (const ref of refs) {
      const id = String(ref).split(':', 1)[0];
      assert(id !== visual.source, `未观察图源不可用作 ${key}：${String(ref)}`);
    }
  });
}

/** Verify the links in the portable example. The skill itself needs only the schema. */
function assertSampleReferences(docs: Map<string, Fields>): void {
  const flowEntries = [...docs].filter(([, doc]) => doc.screens);
  assert.equal(flowEntries.length, 1);
  const [flowFile, flow] = flowEntries[0];
  const screens = new Map<string, Fields>();
  for (const [id, target] of Object.entries(fields(flow.screens))) {
    const file = path.resolve(path.dirname(flowFile), String(target));
    const screen = docs.get(file);
    assert.equal(screen?.screen, id, `屏幕文件引用无法解析 ${id} → ${String(target)}`);
    assert.equal(path.resolve(path.dirname(file), String(screen?.flow)), flowFile, `屏幕 ${id} 未回指流程`);
    assert.equal(screen?.feature, flow.feature);
    screens.set(id, screen!);
  }
  assert.equal(screens.size + 1, docs.size, '流程应覆盖全部示例屏幕');
  const transition = (id: unknown) => {
    assert(hasOwn(fields(flow.transitions), String(id)), `流转引用无法解析 ${String(id)}`);
    return fields(fields(flow.transitions)[String(id)]);
  };
  const screenRef = (id: unknown) => {
    assert(screens.has(String(id)) || hasOwn(fields(flow.existing_screens), String(id)),
      `屏幕引用无法解析 ${String(id)}`);
  };
  const elementRef = (ref: unknown, localScreen?: unknown) => {
    const qualified = String(ref).includes('.') ? String(ref) : `${String(localScreen)}.${String(ref)}`;
    const [screenId, elementId] = qualified.split('.');
    const elements = fields(screens.get(screenId)?.elements);
    assert(hasOwn(elements, elementId), `元素引用无法解析 ${qualified}`);
    return fields(elements[elementId]);
  };
  const questionRef = (id: unknown) => {
    assert(hasOwn(fields(flow.open_questions), String(id)), `待决引用无法解析 ${String(id)}`);
  };
  for (const [id, value] of Object.entries(fields(flow.transitions))) {
    const step = fields(value);
    for (const from of list(step.from)) screenRef(from);
    if (step.from_element) {
      const trigger = elementRef(step.from_element);
      assert.equal(fields(trigger.on_tap).transition, id, `触发元素未回指流转 ${id}`);
    }
    if (step.to) screenRef(step.to);
    for (const outcome of Object.values(fields(step.outcomes))) screenRef(fields(outcome).to);
  }
  for (const question of Object.values(fields(flow.open_questions))) {
    for (const ref of list(fields(question).elements)) elementRef(ref);
  }

  const common = sourceFiles(flowFile, flow);
  for (const [file, doc] of docs) {
    assertObservationReferences(doc);
    const sources = new Map([...common, ...sourceFiles(file, doc)]);
    for (const [id, source] of sources) {
      assert(fs.statSync(source).isFile(), `来源文件无法解析 ${id} → ${source}`);
    }
    const sourceRef = (ref: unknown) => {
      const [id, locator] = String(ref).split(':', 2);
      const file = sources.get(id);
      assert(file, `来源引用无法解析 ${String(ref)}`);
      if (locator && /^\d+$/.test(locator)) {
        assert(fs.readFileSync(file, 'utf8').split(/\r?\n/)[Number(locator) - 1]?.trim(),
          `来源行无法解析 ${String(ref)}`);
      }
    };
    visit(doc, (key, value) => {
      if (key === 'evidence') list(value).forEach(sourceRef);
      if (key === 'copy_ref') sourceRef(value);
      if (key === 'transition') transition(value);
      if (key === 'return_question') questionRef(value);
    });
    if (doc.screen) {
      const entry = fields(doc.entry).transition;
      if (entry) assert.equal(transition(entry).to, doc.screen, '屏幕入口必须指向当前屏幕');
      const visual = fields(doc.visual);
      if (visual.source) sourceRef(visual.source);
      for (const id of Object.keys(fields(visual.depicted_state))) elementRef(id, doc.screen);
      for (const element of Object.values(fields(doc.elements))) {
        const { bbox, evidence, design, on_tap } = fields(element);
        if (bbox) {
          const [x, y, width, height] = list(bbox).map(Number);
          assert(width > 0 && height > 0 && x + width <= 1 && y + height <= 1);
          assert(list(evidence).includes(visual.source), '截图区域应引用当前截图为依据');
        }
        if (design) sourceRef(fields(design).source);
        if (fields(on_tap).to) screenRef(fields(on_tap).to);
        if (fields(on_tap).question) questionRef(fields(on_tap).question);
      }
      const exit = fields(doc.navigation).only_exit_element;
      if (exit) elementRef(exit, doc.screen);
    }
    for (const example of list(doc.acceptance_examples)) {
      visit(example, (key, value) => {
        if (key === 'screen') screenRef(value);
        if (key === 'entries') list(value).forEach(screenRef);
        if (key === 'element' || key === 'tap') elementRef(value, doc.screen);
        if (key === 'elements' || key === 'tap_each') list(value).forEach(ref => elementRef(ref, doc.screen));
      });
    }
  }
}

function schemaForSkill(): Fields {
  return JSON.parse(fs.readFileSync(path.join(skillDir, 'schema/ux-behavior.schema.json'), 'utf8')) as Fields;
}

function sampleCardType(): Fields {
  const file = path.join(sampleDir, 'bc-openCard-2.card-type.ux.yaml');
  return fields(YAML.parse(fs.readFileSync(file, 'utf8')));
}

export function runAll(): UnitCaseResult[] {
  const cases: Record<string, () => void> = {
    '随包模板和四屏一流程都通过同一份 Schema': () => {
      const schema = schemaForSkill();
      assert.deepEqual(auditSchemaSupport(schema), []);
      const templates = yamlFiles(path.join(skillDir, 'templates'));
      const docs = yamlFiles(sampleDir);
      assert.equal(templates.size, 2);
      assert.equal(docs.size, 5);
      for (const [file, doc] of [...templates, ...docs]) {
        assert.deepEqual(validateLiteSchema(doc, schema), [], `格式无效 ${file}`);
      }
    },
    '五份样例的来源、编号场景、元素和流转相互可解析': () => {
      const docs = yamlFiles(sampleDir);
      assertSampleReferences(docs);
      const scenarios = [...docs.values()].flatMap(doc =>
        list(doc.acceptance_examples).map(example => [fields(example).scenario, doc.screen ?? 'flow']));
      assert.deepEqual(scenarios.sort(), [
        ['01', 'card_type_sheet'], ['02', 'card_type_sheet'],
        ['03', 'card_type_sheet'], ['04', 'card_type_sheet'],
        ['05', 'bank_card_picker'], ['06', 'bank_card_picker'],
        ['07', 'sms_verification'], ['08', 'sms_verification'],
        ['09', 'flow'], ['10', 'card_result'], ['11', 'flow'], ['12', 'flow'],
      ]);
      assert.equal(new Set([...docs.values()].flatMap(doc =>
        list(doc.acceptance_examples).map(example => fields(example).id))).size, 12);
    },
    '拒绝悬空流转引用': () => {
      const docs = yamlFiles(sampleDir);
      const screen = [...docs.values()].find(doc => doc.screen === 'card_type_sheet')!;
      fields(screen.entry).transition = 'missing_transition';
      assert.throws(() => assertSampleReferences(docs), /missing_transition/);
    },
    '单屏业务入口有依据，多屏入口使用流程引用': () => {
      const template = [...yamlFiles(path.join(skillDir, 'templates')).values()].find(doc => doc.screen)!;
      const schema = schemaForSkill();
      assert.deepEqual(validateLiteSchema(template, schema), []);
      delete fields(template.entry).evidence;
      assert.notEqual(validateLiteSchema(template, schema).length, 0);
      const multiScreen = sampleCardType();
      multiScreen.entry = { trigger: '打开界面', evidence: ['prd:20'] };
      assert.notEqual(validateLiteSchema(multiScreen, schema).length, 0);
    },
    '未观察时保留原图来源、PRD 行为与待决，拒绝图像状态、坐标及依据': () => {
      const docs = yamlFiles(sampleDir);
      const [file, observed] = [...docs].find(([, doc]) => doc.screen === 'card_type_sheet')!;
      const { format_version, feature, screen, title, flow, entry } = observed;
      const visual = fields(observed.visual);
      const cardTypeOptions: Fields = {
        name: '卡种选项', role: 'single_select', items_from: 'supported_types',
        row: { label: '当前卡种的显示文案' }, evidence: ['prd:20', 'prd:30'],
      };
      const agreement: Fields = {
        name: '协议文案', role: 'text', on_tap: { effect: 'none' },
        copy: { status: 'open', question: '协议全名及逐字文案是什么？' },
        evidence: ['prd:30'],
      };
      const doc: Fields = {
        format_version, feature, screen, title, flow, entry,
        visual: { source: visual.source, observation: 'unobserved' },
        data: { supported_types: { source: '所选银行支持的卡种', evidence: ['prd:20', 'prd:30'] } },
        elements: {
          card_type_options: cardTypeOptions,
          agreement_copy: agreement,
          continue_button: {
            label: '同意并继续', on_tap: { transition: 'open_card_picker' },
            evidence: ['prd:20', 'prd:32'],
          },
        },
      };
      docs.set(file, doc);
      const schema = schemaForSkill();
      assert.deepEqual(validateLiteSchema(doc, schema), []);
      assertSampleReferences(docs);

      for (const ref of [String(visual.source), `${String(visual.source)}:协议区域`]) {
        agreement.evidence = ['prd:30', ref];
        assert.throws(() => assertSampleReferences(docs), /未观察图源不可用作 evidence/);
        agreement.evidence = ['prd:30'];
        agreement.copy_ref = ref;
        assert.throws(() => assertSampleReferences(docs), /未观察图源不可用作 copy_ref/);
        delete agreement.copy_ref;
      }

      fields(doc.visual).depicted_state = visual.depicted_state;
      assert.notEqual(validateLiteSchema(doc, schema).length, 0);
      delete fields(doc.visual).depicted_state;
      cardTypeOptions.bbox = fields(fields(observed.elements).card_type_options).bbox;
      assert.notEqual(validateLiteSchema(doc, schema).length, 0);
    },
  };
  return Object.entries(cases).map(([name, test]) => {
    try {
      test();
      return { name, ok: true };
    } catch (error) {
      return { name, ok: false, error: (error as Error).stack ?? String(error) };
    }
  });
}
