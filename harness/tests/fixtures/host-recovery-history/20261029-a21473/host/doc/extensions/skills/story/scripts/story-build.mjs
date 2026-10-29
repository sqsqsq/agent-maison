/**
 * story-build.mjs — story/review 的装配器（确定性部分，零 AI，零语义判断）
 *
 * ── 装配模型 ────────────────────────────────────────────────────────────
 * story 是**装配产物**，不是一次写成的文档。流程里不存在「写一份完整 story」这个动作：
 *
 *   scaffold  按章节合同为每章生成写作任务书（取材路标 + 必答 + 判据）
 *   build     把章节装配成 story.md，并从决策登记表渲染 review.md
 *   check     重新装配并与磁盘对比，发现对产物的直接手改
 *
 * ── 不变量 ──────────────────────────────────────────────────────────────
 *   取材而非注入 章节文件是**写作任务书**（取材路标 + 必答 + 判据），不复制源材料。
 *                作者按路标去源文档取事实来写——把材料放到眼前，任务就变成了「把它变短」。
 *   事实守恒     源里的表格行、数值参数、反引号标识，正文必须都有；可换措辞、可重组。
 *   形态守恒     源材料以图/表表达的内容，终稿保持同类形态且数量不少于源。
 *   决策单源     决策的问题、结论、理由、责任人只存在于 decisions.json；
 *                story 正文只能引用，review 的机器区由它确定性渲染。
 *   产物可验     story.md 带装配指纹，任何直接手改都能被 check 逐字发现。
 *
 * ── 职责边界 ────────────────────────────────────────────────────────────
 * 本脚本只做复制、拼接、计数与渲染，**不判断内容好坏**：
 *   - 事实守恒只数表行、数值与标识，不判断作者怎么组织与措辞；
 *   - 形态检查只数 mermaid 围栏与表格数量，不看图画得对不对（那是 S5 的语义判断）；
 *   - 失败模式只有「装配失败」，不会静默改写作者内容。
 *
 * 用法：
 *   node story-build.mjs scaffold --feature <name> [--project-root <abs>] [--force]
 *   node story-build.mjs build    --feature <name> [--project-root <abs>]
 *   node story-build.mjs check    --feature <name> [--project-root <abs>]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * 成文判据——章节任务书里的那段话，与 `rules/rules.md` 红线 1 逐字同源。
 *
 * 它必须出现在**写作动作发生的地方**（章文件头注），而不只在规则文件里：
 * 规则隔着几十步，任务书就在眼前。
 */
const WRITING_CRITERION = [
  '写完的判据：打开上面每份取材源，其中的每个事实点（数据、条件、分支、约束、',
  '名词、表格行）都要写进本章；可换措辞、可改顺序，不可少一条。',
  '一次只写一章：写完本章，再开下一章。',
  '开放点与已定决策不要在正文下结论——先登记 decisions.json，正文写 {{DEC-00X}} 引用。',
].join('\n');
const FINGERPRINT_PREFIX = '<!-- assembled-by: story-build.mjs | fingerprint: ';
// review 的机器区与人工区分界：分界线之前由登记表确定性重渲染，之后逐字节保留人工填写。
const HUMAN_ZONE_MARK = '#### 审核结果（由评审人填写）';
// 计划外意见区：评审人发现的、起草方压根没登记成议题的事，只能写在这里。
// 议题的人工区靠 `<!-- decision: ID -->` 定位，写在议题之外的字全都不在抠取范围内
// ——没有这一对标记，人写下的意见会在下一次 build 被静默重建掉。
const FREEFORM_OPEN = '<!-- freeform-zone -->';
const FREEFORM_CLOSE = '<!-- /freeform-zone -->';

// ---------------------------------------------------------------------------
// 基础设施

function parseArgs(argv) {
  const args = { force: false };
  args.command = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--feature') args.feature = argv[++i];
    else if (a === '--project-root') args.projectRoot = argv[++i];
    else if (a === '--force') args.force = true;
  }
  return args;
}

function fail(problems) {
  const list = Array.isArray(problems) ? problems : [problems];
  console.error(`[story-build] 装配未通过（${list.length} 项）：`);
  for (const p of list) console.error(`  - ${p}`);
  process.exit(1);
}

const stripBom = s => s.replace(/^﻿/, '');

function featuresDir(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'framework.config.json'), 'utf-8'));
    const dir = cfg?.paths?.features_dir;
    if (typeof dir === 'string' && dir.trim()) return dir.trim();
  } catch {
    /* 回落默认 */
  }
  return 'doc/features';
}

/** 按单个标题关键词提取章节正文（含标题行） */
function extractOne(text, sectionName) {
  const lines = text.split(/\r?\n/);
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    if (fence) continue;
    const h = lines[i].match(/^(#{1,4})\s+(.*)$/);
    if (!h) continue;
    const title = h[2].replace(/^[\d.、\s]+/, '').trim();
    if (!title.includes(sectionName)) continue;
    const level = h[1].length;
    const body = [lines[i]];
    let inner = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(```|~~~)/.test(lines[j])) inner = !inner;
      if (!inner) {
        const nh = lines[j].match(/^(#{1,6})\s/);
        if (nh && nh[1].length <= level) break;
      }
      body.push(lines[j]);
    }
    return body.join('\n').trim();
  }
  return null;
}

/**
 * 按候选标题词根依次尝试提取；空数组或全部落空时返回整篇（降级注入）。
 * 上游文档的标题措辞因团队而异，故合同声明的是一组词根而非唯一标题；
 * 宁可整篇注入让作者自己筛，也不能让某章拿到空内容。
 * @returns {{text: string, matched: string|null, fallback: boolean}}
 */
export function extractSection(text, section) {
  const candidates = Array.isArray(section) ? section : (section ? [section] : []);
  for (const name of candidates) {
    const hit = extractOne(text, name);
    if (hit != null) return { text: hit, matched: name, fallback: false };
  }
  return { text: text.trim(), matched: null, fallback: true };
}

export function countMermaid(text) {
  return (text.match(/^\s*```mermaid\b/gm) ?? []).length;
}

export function countTables(text) {
  const lines = text.split(/\r?\n/);
  let n = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) n++;
  }
  return n;
}

export function countImages(text) {
  return (text.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
}

/**
 * 形态 → 计数器。合同 form 的每个 kind 都在这里查表。
 * 查表而非二元判断：未知 kind 要显式报错，否则合同写了新形态却静默按别的形态计数，
 * 门禁看着是绿的、守的却是另一件事。
 */
export const FORM_COUNTERS = {
  mermaid: countMermaid,
  tables: countTables,
  images: countImages,
};

// 计量单位。这不是「违规措辞」词表——是客观的量纲清单，与作者怎么描述那个数字无关。
const MEASURED = String.raw`ms|毫秒|秒|s\b|分钟|小时|天|元|%|次`;
const NUMBER_WITH_UNIT = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(?:${MEASURED})`, 'g');

/**
 * 数值溯源守恒：story 里每个带量纲的数值，要么上游原文里有，要么有决策承载。
 *
 * 比对的是**值**不是描述。作者写「本工程设定」「暂定」「经验值」还是什么都不写，
 * 检查一概不看——逃过它的唯一方式是这个数真有出处或真被登记成了决策，
 * 而那恰好就是我们要的状态。
 */
export function findUnsourcedNumbers(bodyText, upstreamText, decisions) {
  const sourced = `${upstreamText}\n${JSON.stringify(decisions ?? [])}`;
  const known = new Set((sourced.match(NUMBER_WITH_UNIT) ?? [])
    .map(m => m.match(/\d+(?:\.\d+)?/)[0]));
  const missing = new Map();
  for (const m of bodyText.matchAll(NUMBER_WITH_UNIT)) {
    if (known.has(m[1])) continue;
    if (!missing.has(m[1])) {
      missing.set(m[1], bodyText.slice(0, m.index).split('\n').length);
    }
  }
  return [...missing].map(([value, line]) => ({ value, line }));
}

/** 去掉任务书注释后的作者正文——章文件里除注释之外的一切都是他写的 */
export function authorBody(raw) {
  return raw.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 表格行数：`|` 起头的行，去掉分隔行（`|---|`）。合并表不影响总量。 */
function tableRowCount(text) {
  return text.split('\n')
    .filter(l => l.trimStart().startsWith('|') && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .length;
}

/**
 * 源里的数值事实：带单位、多位数、小数、百分比。
 *
 * **提取从保守——宁可漏检，不可误伤**：误报会逼作者往正文里灌无意义的数字凑数，
 * 那比漏检一个阈值更坏。所以剔除列表序号这类噪声，只收「看着就是参数」的。
 */
function numericFacts(text) {
  const body = text.split('\n')
    .map(l => l.replace(/^\s*[-*+]?\s*\d+[.、)]\s/, ''))   // 列表序号不是事实
    .join('\n');
  const found = new Set();
  for (const m of body.matchAll(/\d+(?:\.\d+)?\s*(?:ms|s|秒|分钟|小时|天|次|元|个|条|%|KB|MB)/g)) {
    found.add(m[0].replace(/\s+/g, ''));
  }
  for (const m of body.matchAll(/(?<![\w.])\d{2,}(?:\.\d+)?(?![\w.])/g)) found.add(m[0]);
  return [...found];
}

/**
 * 源里的技术标识：反引号包起来的接口名、字段名、存储键。
 *
 * **仓内路径与文件名不算**：它们是源文档的机器面（取材出处、工作区坐标），
 * 不是需求事实；而归档件红线正禁止 story 出现仓内路径——把它们算成待覆盖的事实，
 * 等于要求作者写下一个另一条规则明令删除的东西。
 *
 * 文件名按**形态**判，不查扩展名清单：清单漏掉一种技术栈（`.kt`/`.gradle`/`.xml`…），
 * 那个平台就会复发上面这条互斥。
 *
 * 判据是「以小写后缀结尾」，**区分大小写**——这正是文件名与方法链的分界：
 * `build.gradle` / `MainActivity.kt` 是文件名，`AppStorage.setOrCreate` 是标识符，
 * 后者的后缀含大写，照旧要求覆盖。
 */
function codeSpans(text) {
  const isPath = s => /[\\/]/.test(s) || /\.[a-z][a-z0-9]{0,7}$/.test(s);
  return [...new Set([...text.matchAll(/`([^`\n]+)`/g)]
    .map(m => m[1].trim())
    .filter(s => s && !isPath(s)))];
}

/**
 * 源里有、正文没有的结构性事实。
 *
 * 成文允许换措辞、改顺序、合并重组，但这三类丢一个就是丢一条需求：
 * 表行是逐条列出的事实、数值是参数、反引号里的是契约标识。
 * 判的是**结构**不是语义——「写得好不好」仍归人与评价者。
 */
export function findMissingFacts(factSource, upstreamSource, body, at, decisions = []) {
  if (!factSource.trim()) return [];
  const problems = [];
  // 被决策承载的数值不算缺失：本工程设定的值走 decisions 登记、正文写 {{DEC-00X}} 引用，
  // 正文里本就不该出现那个裸数字（数值溯源守的正是这一条）。两处守则同向，不能互相打架。
  const carried = JSON.stringify(decisions ?? []).replace(/\s+/g, '');

  const srcRows = tableRowCount(factSource);
  const bodyRows = tableRowCount(body);
  if (bodyRows < srcRows) {
    problems.push(`${at}：表格行 ${srcRows} → ${bodyRows}（少 ${srcRows - bodyRows} 行）`
      + '——源里逐行列出的事实要逐行写进正文；可以合并表，但总量不减');
  }

  // 比对前两侧都去空白：源写「30 秒」、正文写「30秒」是同一个事实，
  // 拿归一后的 token 去比原文会把作者的正常排版判成缺失。
  const flatBody = body.replace(/\s+/g, '');
  const missNum = numericFacts(upstreamSource ?? '')
    .filter(v => !flatBody.includes(v) && !carried.includes(v));
  if (missNum.length) {
    problems.push(`${at}：正文缺源里的数值 ${missNum.slice(0, 12).join('、')}`
      + (missNum.length > 12 ? ` 等 ${missNum.length} 个` : ''));
  }

  const missCode = codeSpans(factSource).filter(v => !body.includes(v));
  if (missCode.length) {
    problems.push(`${at}：正文缺源里的标识 ${missCode.slice(0, 12).map(v => `\`${v}\``).join('、')}`
      + (missCode.length > 12 ? ` 等 ${missCode.length} 个` : ''));
  }
  return problems;
}

/**
 * 章内标题整体降一级。
 * 装配器为每章输出 `## 章名`，而作者在章内也习惯用 `##` 写小节（源材料注入的原文就是 `##`）。
 * 不降级则章标题与小节同级，成文里看不出章节边界——十三章结构在读者眼里就消失了。
 * 围栏内的 `#` 是内容（ASCII 图、注释），不动。
 */
export function demoteHeadings(text) {
  let fence = false;
  return text.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; }
    if (fence) return line;
    const m = line.match(/^(#{1,5})(\s+\S)/);
    return m ? `#${line}` : line;
  }).join('\n');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** 各上游源的短 sha。键即章节合同 sources 的键（prd/se/spec/design…），排序保证可比对。 */
function sourceFingerprints(docs) {
  const out = {};
  for (const key of Object.keys(docs).sort()) {
    const text = docs[key];
    if (typeof text === 'string' && text.length) out[key.toLowerCase()] = sha256(text).slice(0, 16);
  }
  return out;
}

function renderSourceFp(fp) {
  const parts = Object.entries(fp).map(([k, v]) => `${k}=${v}`);
  return parts.length ? ` | sources: ${parts.join(' ')}` : '';
}

/** 从落盘的指纹行解析源 sha。旧格式（无 sources 段）返回 null，表示装配时还没记。 */
function parseSourceFp(tail) {
  const m = tail.match(/\| sources: ([^>]+?)\s*-->/);
  if (!m) return null;
  const out = {};
  for (const pair of m[1].trim().split(/\s+/)) {
    const [k, v] = pair.split('=');
    if (k && v) out[k] = v;
  }
  return out;
}

/**
 * 归档过就意味着 story 已定稿送审，此后 spec 继续演进是正常的。
 *
 * 所以源漂移的强度按归档与否分档：归档前两份要一起上传，不一致会让评审人基于错的
 * 叙事做判断，属硬门禁；归档后只告警。
 */
function isArchived(featureRoot) {
  // 判据是流程契约里的归档态（`story_flow.py archived` 登记）——归档态是流程状态，
  // 与执行归档的那一层是谁的实现无关。
  try {
    const contract = path.join(featureRoot, 'AR', 'story-flow.json');
    if (!fs.existsSync(contract)) return false;
    return Boolean(JSON.parse(stripBom(fs.readFileSync(contract, 'utf-8'))).archived);
  } catch {
    return false;
  }
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(stripBom(fs.readFileSync(file, 'utf-8')));
}

// 两份登记表的正确形状：报错时一并给出，作者不必去翻规则文件回想字段名。
const REGISTRY_SHAPE = {
  decisions: '{"decisions": [{"id": "DEC-001", "status": "open", "question": "...", '
    + '"proposal": "...", "rationale": "...", "source": "...", "decider": "...", "impact": ["F1"]}]}',
  ids: '{"ids": [{"id": "XXX-01", "title": "<权威规约原文的标题与含义>", "landing": "<本需求落点，可选>"}]}',
};

// 空表的出口：说明为什么该问「真的没有吗」，并给出显式声明的写法。
const REGISTRY_EMPTY_HINT = {
  decisions: '一个需求几乎不可能既没有开放点、也没有须让开发遵守的上游结论'
    + '——无上游依据的设定值、要人拍板的问题、上游已定但开发必须照做的结论，三类都算。'
    + '确认过每章都没有，就显式声明：{"decisions": [], "none_reason": "<为什么没有>"}',
  ids: 'story 正文一条规约、验收或场景编号都没引用？'
    + '确认过确实如此，就显式声明：{"ids": [], "none_reason": "<为什么没有>"}',
};

/**
 * 登记表读取——`decisions.json` 与 `ids.json` 走同一条路。
 *
 * 坏输入曾有三种坏结局，最坏的是第三种：JSON 合法但结构不对（顶层写成数组、键名写错）时，
 * `readJson(...).key ?? []` 会**静默降级成空表**——装配照常成功，产出一份空 review，
 * 没有任何人知道出了事。那违反本脚本「失败模式只有装配失败，不会静默改写作者内容」
 * 的不变量，所以这里一律大声失败，并且每条错都带上正确形状。
 *
 * 空表本身也不是缺省值而是**决定**：0 条须写 `none_reason` 显式声明，
 * 否则「没有」和「忘了写」在产物上长得一模一样。
 */
export function readRegistry(file, key) {
  const name = path.basename(file);
  const shape = REGISTRY_SHAPE[key];
  const bad = msg => ({ entries: [], problems: [`${msg}正确形状：${shape}`] });

  if (!fs.existsSync(file)) {
    return bad(`缺 ${name}——先跑 scaffold 建骨架，再往里登记。`);
  }
  let data;
  try {
    data = JSON.parse(stripBom(fs.readFileSync(file, 'utf-8')));
  } catch (e) {
    return bad(`${name} 不是合法 JSON：${e.message}。常见原因是尾逗号、中文引号或写了注释。`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return bad(`${name} 顶层必须是对象，当前是 ${Array.isArray(data) ? '数组' : String(data === null ? 'null' : typeof data)}。`);
  }
  const entries = data[key];
  if (entries === undefined) {
    return bad(`${name} 缺顶层 "${key}" 键（现有的键：${Object.keys(data).join('、') || '一个都没有'}）。`);
  }
  if (!Array.isArray(entries)) {
    return bad(`${name} 的 "${key}" 必须是数组，当前是 ${typeof entries}。`);
  }
  if (!entries.length) {
    const reason = String(data.none_reason ?? '').trim();
    if (!reason) return { entries: [], problems: [`${name} 是空表。${REGISTRY_EMPTY_HINT[key]}`] };
    return { entries: [], problems: [], noneReason: reason };
  }
  return { entries, problems: [] };
}

// 议程措辞：谁该拍板什么归《决策与评审记录》。story 只陈述事实与方案，
// 表态语气一律不入正文——决策先登记、正文只写引用。
const AGENDA_WORDS = ['待确认', '需确认', '须确认', '待产品确认', '需产品确认', '须产品确认',
  '待拍板', '需拍板', '待定', '评审时确认', '评审者应', '有待明确'];

/**
 * spec 的可标识事实必须在 story 有落点——判据是**覆盖**不是逐字一致，
 * 可整合、可改序、可换措辞，但不能少。归档门禁也查这一条；装配时同步查，
 * 作者才能当场知道漏了哪个编号，而不是等到归档才发现。
 */
const SPEC_ID_RE = /\b(?:S\d+|F\d+|E\d+|AC-[\w]*\d+|BD-\d+|NFR-\d+)\b/g;

export function findMissingIdentifiers(specText, storyText) {
  const ids = specText.match(SPEC_ID_RE) ?? [];
  return [...new Set(ids)].filter(id => id && !storyText.includes(id));
}

/**
 * 决策的 impact 必须锚在 spec 的真实编号上。
 *
 * impact 回答「同意或修改后会影响什么」。它是自由文本时，评审回流阶段只能靠猜去找落点；
 * 写成 spec 里存在的编号，影响面就从**描述**变成**锚点**——改哪一条是确定的。
 *
 * 只校验「看起来像 spec 编号」的元素：impact 也允许写自然语言（如「端云接口需重新评审」），
 * 那类不强求锚点；但一旦写成编号形状，它就必须真实存在，否则是个查无此物的指向。
 */
export function findUnanchoredImpacts(decisions, specText) {
  if (!specText) return [];
  const known = new Set(specText.match(SPEC_ID_RE) ?? []);
  const problems = [];
  for (const d of decisions ?? []) {
    for (const item of d?.impact ?? []) {
      for (const id of String(item).match(SPEC_ID_RE) ?? []) {
        if (!known.has(id)) {
          problems.push(
            `decisions.json 的 ${d.id} 的 impact 指向 ${id}，但需求规格里没有这个编号`
            + '——影响面要能按编号落到实处；写错或已改名的编号会让回流时找不到落点');
        }
      }
    }
  }
  return [...new Set(problems)];
}

/** 登记表必填字段：缺任何一项都会渲染出 undefined，产物即报废 */
export function validateDecisions(decisions) {
  const problems = [];
  const seen = new Set();
  decisions.forEach((d, i) => {
    const at = d?.id ? `decisions.json 的 ${d.id}` : `decisions.json 第 ${i + 1} 条`;
    if (!d?.id) problems.push(`${at}：缺 id`);
    else if (seen.has(d.id)) problems.push(`${at}：id 重复`);
    else seen.add(d.id);
    const settled = d?.status === 'settled';
    for (const field of ['question', 'rationale', 'source', 'decider']) {
      if (!String(d?.[field] ?? '').trim()) problems.push(`${at}：缺 ${field}`);
    }
    const valueField = settled ? 'conclusion' : 'proposal';
    if (!String(d?.[valueField] ?? '').trim()) {
      problems.push(`${at}：${settled ? '已定决策' : '开放决策'}缺 ${valueField}`);
    }
    if (d?.status && !['open', 'settled'].includes(d.status)) {
      problems.push(`${at}：status 只能是 open 或 settled，当前为 ${d.status}`);
    }
  });
  return problems;
}

/** 编号登记表必填字段：缺 id 或 title 都会让附录渲染出 undefined，产物即报废 */
export function validateIds(ids) {
  const problems = [];
  const seen = new Set();
  ids.forEach((x, i) => {
    const at = x?.id ? `ids.json 的 ${x.id}` : `ids.json 第 ${i + 1} 条`;
    if (!x?.id) problems.push(`${at}：缺 id`);
    else if (seen.has(x.id)) problems.push(`${at}：id 重复`);
    else seen.add(x.id);
    if (!String(x?.title ?? '').trim()) {
      problems.push(`${at}：缺 title——标题与含义须来自权威规约原文，不得凭记忆编造`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// 渲染：决策引用与编号附录（story 与 review 是同一份数据的两个投影）

export function renderDecisionRefs(text, decisions) {
  const byId = new Map(decisions.map(d => [d.id, d]));
  const missing = [];
  const out = text.replace(/\{\{(DEC-[\w-]+)\}\}/g, (_m, id) => {
    const dec = byId.get(id);
    if (!dec) {
      missing.push(id);
      return `{{${id}}}`;
    }
    return `《决策与评审记录》——“${dec.question}”`;
  });
  return { text: out, missing };
}

/**
 * 编号引用按上下文渲染：表格单元格内只出 裸编号，散文里才展开「标题（编号）」。
 * 表格的编号列本就该是编号——展开成整句会把列撑垮、读者反而找不到行；
 * 含义由附录承担。作者写法不变，同一个占位符两处都能用。
 */
export function renderIdRefs(text, ids) {
  const byId = new Map(ids.map(x => [x.id, x]));
  const missing = [];
  const out = text.split('\n').map(line => {
    const inTable = line.trimStart().startsWith('|');
    return line.replace(/\{\{ID:([\w-]+)\}\}/g, (_m, id) => {
      const entry = byId.get(id);
      if (!entry) {
        missing.push(id);
        return `{{ID:${id}}}`;
      }
      return inTable ? id : `“${entry.title}（${id}）”`;
    });
  }).join('\n');
  return { text: out, missing };
}

/**
 * story 投影：编号 + 标题与含义（+ 本需求落点，可选）。
 * 落点列只在确有内容时渲染——整列「—」对读者是噪音，而编号加标题含义已足够查义。
 */
export function renderStoryAppendix(ids) {
  if (!ids.length) return '';
  const hasLanding = ids.some(x => String(x.landing ?? '').trim() && String(x.landing).trim() !== '—');
  const head = hasLanding
    ? ['| 编号 | 标题与含义 | 本需求中的结论或落点 |', '|---|---|---|']
    : ['| 编号 | 标题与含义 |', '|---|---|'];
  const rows = ids.map(x => hasLanding
    ? `| ${x.id} | ${x.title} | ${String(x.landing ?? '').trim() || '—'} |`
    : `| ${x.id} | ${x.title} |`);
  return ['## 附录：编号速查', '', ...head, ...rows].join('\n');
}

/**
 * review 投影：只有编号 + 标题与含义（两列），且只含 review 正文实际引用的编号。
 * 这是 R4 的结构性保证——review 里不可能出现第二份需求叙事，因为落点列根本不渲染。
 */
export function renderReviewAppendix(ids, reviewBody) {
  const used = ids.filter(x => new RegExp(`\\b${x.id.replace(/[-]/g, '\\-')}\\b`).test(reviewBody));
  if (!used.length) return '';
  const rows = used.map(x => `| ${x.id} | ${x.title} |`);
  return ['## 附录：编号速查', '', '| 编号 | 标题与含义 |', '|---|---|', ...rows].join('\n');
}

/**
 * 议题块的**机器区**：完全由登记表决定，每次 build 确定性重渲染。
 * 已定决策（status=settled）也照样成块——检视人要先看到「有哪些决策、结论是什么」，
 * 才谈得上反馈对不对；已定不等于不必过目。
 */
export function renderMachineZone(dec) {
  const settled = dec.status === 'settled';
  const lines = [`### ${dec.question}`, ''];
  if (settled) {
    lines.push(`- **当前结论**：${dec.conclusion ?? dec.proposal}`);
  } else {
    lines.push(`- **当前建议**：${dec.proposal}`);
  }
  lines.push(
    `- **为什么这样${settled ? '定' : '建议'}**：${dec.rationale}`,
    `- **同意或修改后会影响什么**：${(dec.impact ?? []).join('、') || '—'}`,
    `- **结论来源**：${dec.source}`,
    `- **请谁确认**：${dec.decider}`,
    '');
  return lines.join('\n');
}

/** 议题块的**人工区**：首版为空表单，此后 build 一个字节都不动它 */
export function renderHumanZone(dec) {
  return [
    HUMAN_ZONE_MARK,
    '',
    '- [ ] **同意当前建议**',
    '- [ ] **有其他意见，需要修改**',
    '  - 修改意见：',
    '- [ ] **暂缓**',
    '  - 暂缓责任人：',
    '  - 完成期限：',
    '  - 是否阻塞执行：',
    '  - 后续动作：',
    '',
    // 归档后读者必须能分辨「真人逐项确认」与「按授权代填」，否则「已确认」是不可追溯的。
    '**确认人**：',
    '',
    '**确认日期**：',
    '',
    '**确认依据**：（非本人当场确认时，写明授权来源）',
    '',
    `<!-- decision: ${dec.id} -->`,
  ].join('\n');
}

export function renderDecisionBlock(dec) {
  return `${renderMachineZone(dec)}\n${renderHumanZone(dec)}`;
}

/** 从既有 review 里切出某议题的人工区（人工填写内容的唯一真源） */
export function extractHumanZone(reviewText, id) {
  const mark = `<!-- decision: ${id} -->`;
    const end = reviewText.indexOf(mark);
  if (end < 0) return null;
  const zoneStart = reviewText.lastIndexOf(HUMAN_ZONE_MARK, end);
  if (zoneStart < 0) return null;
  return reviewText.slice(zoneStart, end + mark.length);
}

/**
 * 计划外意见区：整段逐字节保留，与议题人工区同等待遇。
 *
 * 评审人常有起草方没登记过的意见——缺的分支、该复用的既有能力、遗漏的埋点。
 * 它们套不进任何议题的表单（没有 `impact`、没有当前建议），
 * 而 `review_reflow.md` §1 已经规定了怎么处置这类「模板外的自由意见」：
 * 判需求类还是叙述类、落台账带 `freeform#<序>` 与原话摘录。
 * 也就是说**回流侧接得住，产出侧却一直没给人写的地方**——本区补的就是那个地方。
 */
export function extractFreeformZone(reviewText) {
  const start = reviewText.indexOf(FREEFORM_OPEN);
  if (start < 0) return null;
  const end = reviewText.indexOf(FREEFORM_CLOSE, start);
  if (end < 0) return null;
  return reviewText.slice(start + FREEFORM_OPEN.length, end);
}

/** 首版的空区：给一句怎么写，不给表单——套不进表单正是它存在的理由。 */
function renderFreeformSection(inner) {
  return [
    '## 计划外意见（不属于以上任何议题）',
    '',
    '起草方没登记成议题、而你认为该说的事写在这里——缺的分支、该复用的既有能力、',
    '遗漏的埋点都算。一条一段，写清**是什么**与**影响哪里**；不必套用上面的表单。',
    '',
    FREEFORM_OPEN,
    inner ?? '\n（暂无）\n',
    FREEFORM_CLOSE,
    '',
  ].join('\n');
}

/** 定位某议题块的整体范围（机器区起点 → 该块的 decision 标记结尾） */
function findBlockRange(reviewText, id) {
  const mark = `<!-- decision: ${id} -->`;
  const end = reviewText.indexOf(mark);
  if (end < 0) return null;
  const zoneStart = reviewText.lastIndexOf(HUMAN_ZONE_MARK, end);
  if (zoneStart < 0) return null;
  // 机器区起点：该人工区之前最近的 `### ` 标题
  const headStart = reviewText.lastIndexOf('\n### ', zoneStart);
  return { start: headStart < 0 ? zoneStart : headStart + 1, end: end + mark.length };
}

// ---------------------------------------------------------------------------

export function createContext(args) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  // scripts → story → skills → extensions → doc → 实例根
  const projectRoot = path.resolve(
    args.projectRoot ?? path.join(scriptDir, '..', '..', '..', '..', '..'));
  const skillRoot = path.join(scriptDir, '..');
  const contract = readJson(path.join(skillRoot, 'contracts', 'story-chapters.json'), null);
  if (!contract) fail('章节合同缺失：contracts/story-chapters.json');
  const featureRoot = path.join(projectRoot, featuresDir(projectRoot), args.feature);
  const srcDir = path.join(featureRoot, 'AR', 'story-src');
  return {
    args, projectRoot, contract, featureRoot, srcDir,
    chapterDir: path.join(srcDir, 'chapters'),
    decisionsPath: path.join(srcDir, 'decisions.json'),
    idsPath: path.join(srcDir, 'ids.json'),
    storyPath: path.join(featureRoot, 'AR', 'story.md'),
    reviewPath: path.join(featureRoot, 'AR', 'review.md'),
    chapterFile: ch => path.join(srcDir, 'chapters', `${ch.id}.md`),
  };
}

function loadSourceDocs(ctx) {
  const docs = {};
  for (const [key, rel] of Object.entries(ctx.contract.sources)) {
    const p = path.join(ctx.featureRoot, rel);
    docs[key] = fs.existsSync(p) ? stripBom(fs.readFileSync(p, 'utf-8')) : null;
  }
  return docs;
}

// ---------------------------------------------------------------------------
// scaffold：按合同注入源材料，建立章节起手文件

function scaffold(ctx) {
  const { args, projectRoot, contract, featureRoot, chapterDir, decisionsPath, idsPath,
    chapterFile } = ctx;
  if (!fs.existsSync(featureRoot)) fail(`feature 目录不存在：${featureRoot}`);
  fs.mkdirSync(chapterDir, { recursive: true });

  const docs = loadSourceDocs(ctx);
  const created = [];
  const notes = [];
  const problems = [];

  for (const ch of contract.chapters) {
    const target = chapterFile(ch);
    if (fs.existsSync(target) && !args.force) {
      notes.push(`已存在，跳过：${path.relative(projectRoot, target)}`);
      continue;
    }
    // 取材路标：告诉作者去哪份源的哪一节拿事实，而不是把源复制到他眼前。
    // 复制源材料会把任务变成「把这段变短」——那正是摘要的形状；
    // 点名到节则任务是「去取事实来写」，作者要内容才写得出。
    const sources = [];
    for (const input of ch.inputs ?? []) {
      const text = docs[input.doc];
      if (text == null) {
        notes.push(`${ch.id}：源文档 ${input.doc} 不存在，跳过该输入`);
        continue;
      }
      const { matched, fallback } = extractSection(text, input.section);
      // optional 输入：这一节本来就不是每份需求都有（如产品给的界面稿）。
      if (fallback && input.optional) {
        notes.push(`${ch.id}：${input.doc} 无「${(input.section ?? []).join('/')}」节，跳过该可选输入`);
        continue;
      }
      if (fallback && (input.section ?? []).length) {
        notes.push(`${ch.id}：${input.doc} 候选标题 ${JSON.stringify(input.section)} 均未命中，取材指向整篇`);
      }
      sources.push(fallback ? `${input.doc}（整篇）` : `${input.doc} § ${matched}`);
    }
    // 声明了输入却一份都指不到 = 作者无源可取。
    // 这类缺料必须显式失败：告警会被忽略，空章节要到装配末端才暴露。
    if ((ch.inputs ?? []).length && !sources.length) {
      problems.push(`${ch.id}（${ch.title}）：声明了 ${ch.inputs.length} 个输入，但一个都指不到`);
      continue;
    }
    const form = Object.entries(ch.form ?? {}).map(([k, v]) => `${k}=${v}`).join(', ') || '无强制形态';
    const header = [
      `<!-- chapter: ${ch.id} | title: ${ch.title} | form: ${form} -->`,
      ...(sources.length ? [`<!-- 取材：${sources.join('；')} -->`] : []),
      '<!-- 必答（写到足以支撑这些判断为止，不设篇幅上限）：',
      ...(ch.must_answer ?? []).map(q => `- ${q}`),
      '-->',
      ...(ch.transcribe_note ? ['<!-- 本章写法：' + ch.transcribe_note + ' -->'] : []),
      `<!-- ${WRITING_CRITERION.split('\n').join('\n     ')} -->`,
      '',
    ].join('\n');
    fs.writeFileSync(target, `${header}\n`, 'utf-8');
    created.push(path.relative(projectRoot, target));
  }

  if (problems.length) fail(problems);

  // 骨架带一条 `_example`：JSON 写不了注释，而空的 `{"decisions": []}` 等于让作者
  // 从零创造条目形状——形状是确定的，就该由脚本给出，不该靠作者回想字段名。
  // `_example` 不参与装配（读取只取 decisions / ids 两个键），留着删掉都不影响产物。
  if (!fs.existsSync(decisionsPath)) {
    fs.writeFileSync(decisionsPath, JSON.stringify({
      _example: {
        id: 'DEC-001',
        status: 'open（未定，写 proposal）｜settled（已定，写 conclusion）',
        question: '要人拍板的问题，或上游已定但开发必须遵守的结论，一句话',
        proposal: '开放决策的建议方案（status=open 时必填）',
        conclusion: '已定决策的结论（status=settled 时必填）',
        rationale: '为什么是这个结论',
        source: '依据出处；本工程设定写「本工程设定，无上游依据」',
        decider: '谁来拍板',
        impact: ['同意或修改后会影响 spec 的哪几条，写编号'],
      },
      decisions: [],
    }, null, 2) + '\n', 'utf-8');
    created.push(path.relative(projectRoot, decisionsPath));
  }
  if (!fs.existsSync(idsPath)) {
    fs.writeFileSync(idsPath, JSON.stringify({
      _example: {
        id: 'XXX-01',
        title: '标题与含义，抄自权威规约原文，不得凭记忆编造',
        landing: '本需求落点（可选；全表都不填，story 附录就只出两列）',
      },
      ids: [],
    }, null, 2) + '\n', 'utf-8');
    created.push(path.relative(projectRoot, idsPath));
  }

  console.log(`[story-build] ✅ scaffold 完成，${created.length} 个文件：`);
  for (const f of created) console.log(`  + ${f}`);
  for (const n of notes) console.log(`  ! ${n}`);
  console.log('[story-build] 下一步：按各章任务书的取材路标逐章成文（一次一章）→ 登记 decisions.json / ids.json → build。');
}

// ---------------------------------------------------------------------------
// build：装配 story.md，渲染 review.md

export function assemble(ctx) {
  const { args, contract, chapterFile } = ctx;
  const problems = [];
  const decReg = readRegistry(ctx.decisionsPath, 'decisions');
  const idReg = readRegistry(ctx.idsPath, 'ids');
  const decisions = decReg.entries;
  const ids = idReg.entries;
  problems.push(...decReg.problems, ...idReg.problems);
  const noneReasons = [
    decReg.noneReason ? `decisions.json 声明无决策：${decReg.noneReason}` : null,
    idReg.noneReason ? `ids.json 声明无编号：${idReg.noneReason}` : null,
  ].filter(Boolean);
  const parts = [];
  const formReport = [];
  const docs = loadSourceDocs(ctx);
  problems.push(...validateDecisions(decisions));
  problems.push(...validateIds(ids));

  for (const ch of contract.chapters) {
    const target = chapterFile(ch);
    if (!fs.existsSync(target)) {
      problems.push(`缺章：${ch.id}（${ch.title}）—— 先跑 scaffold 再逐章成文`);
      continue;
    }
    const raw = stripBom(fs.readFileSync(target, 'utf-8'));
    const body = authorBody(raw);
    if (!body) {
      problems.push(`${ch.id}（${ch.title}）：任务书之外没有正文——按取材路标写本章`);
      continue;
    }

    // 守恒基准（形态与事实共用同一个）：只取**命中了具名节**的那些输入。
    // 节标题没命中时 extractSection 会降级给整篇——那是为了让作者有源可读（宁可多给），
    // 但基准必须是精确的那部分：拿整份文档要求单章逐条覆盖、逐图继承，都是不可能完成的
    // 任务，模型只会被逼去找 workaround。降级章的形态仍有合同里 `>=N` 的下限兜着。
    const sectionOf = i => (docs[i.doc] ? extractSection(docs[i.doc], i.section).text : '');
    const pinned = i => docs[i.doc] && !extractSection(docs[i.doc], i.section).fallback;
    const factSource = (ch.inputs ?? []).filter(pinned).map(sectionOf).join('\n');
    // 数值守恒再收窄到上游（PRD/SE）：spec 里的本工程设定值由「数值溯源 + 决策登记」
    // 那条链管着——它要求正文写 {{DEC-00X}} 而不是裸数字，两条守则不能各要各的。
    const upstreamSource = (ch.inputs ?? [])
      .filter(i => pinned(i) && (i.doc === 'PRD' || i.doc === 'SE')).map(sectionOf).join('\n');
    for (const [kind, rule] of Object.entries(ch.form ?? {})) {
      const counter = FORM_COUNTERS[kind];
      if (!counter) {
        problems.push(`${ch.id}（${ch.title}）：合同声明了未知形态 ${kind}`
          + `——可用形态：${Object.keys(FORM_COUNTERS).join(' / ')}`);
        continue;
      }
      const actual = counter(body);
      const sourceCount = counter(factSource);
      let required = 0;
      // inherit = 数量守恒：源有几张图，终稿就得有几张。
      // 只要求「至少一张」等于允许静默丢图，与形态守恒不是同一回事。
      if (rule === 'inherit') required = sourceCount;
      else if (typeof rule === 'string' && rule.startsWith('>=')) required = Number(rule.slice(2));
      if (actual < required) {
        problems.push(
          `${ch.id}（${ch.title}）：${kind} 数量 ${actual} < 要求 ${required}`
          + (rule === 'inherit' ? `（源材料含 ${sourceCount} 个，形态与数量均不得降级）` : ''));
      }
      formReport.push({ chapter: ch.id, kind, actual, required, source: sourceCount });
    }

    // 事实守恒：源里有的结构性事实，正文必须都有。
    // 判的是**结构**不是语义——表少了几行、参数没写、接口名没提，都是可数的；
    // 「写得好不好」仍归人与评价者。失败信息给出缺哪几个，作者照着补即可。
    problems.push(...findMissingFacts(factSource, upstreamSource, body, `${ch.id}（${ch.title}）`, decisions));

    // 裸决策编号：DEC-00X 是评审登记表的内部标识，只能以 {{DEC-00X}} 占位出现、由装配器
    // 渲染成可读指向。写成字面量就会原样漏进归档件，评审者读到一个没有定义的编号。
    const bare = [...body.replace(/\{\{DEC-[\w-]+\}\}/g, '').matchAll(/\bDEC-[\w-]+\b/g)];
    if (bare.length) {
      problems.push(
        `${ch.id}（${ch.title}）：正文出现裸决策编号 ${[...new Set(bare.map(m => m[0]))].join('、')}`
        + '——须写成 {{DEC-00X}} 占位，由装配器渲染为可读指向');
    }

    parts.push(`## ${ch.title}\n\n${demoteHeadings(body)}`);
  }

  let storyBody = parts.join('\n\n');
  const dec = renderDecisionRefs(storyBody, decisions);
  const idr = renderIdRefs(dec.text, ids);
  storyBody = idr.text;
  for (const id of new Set([...dec.missing, ...idr.missing])) {
    problems.push(`悬空引用 {{${id}}}：未在 decisions.json / ids.json 登记`);
  }

  const appendix = renderStoryAppendix(ids);
  const title = `# ${args.feature} — 需求评审叙事`;
  const bodyText = [title, '', storyBody, appendix ? `\n${appendix}` : ''].join('\n').trimEnd();

  // 以下三条都扫**最终装配结果**而非章节正文：附录、决策引用、编号速查都是装配器
  // 渲染出来的，只查章节会留下盲区。
  if (/\bundefined\b/.test(bodyText)) {
    const line = bodyText.split('\n').findIndex(l => /\bundefined\b/.test(l)) + 1;
    problems.push(`story 渲染结果含字面量 undefined（首次出现在第 ${line} 行）：某处取到了空字段`);
  }

  for (const word of AGENDA_WORDS) {
    if (!bodyText.includes(word)) continue;
    const line = bodyText.split('\n').findIndex(l => l.includes(word)) + 1;
    problems.push(
      `story 出现议程措辞「${word}」（第 ${line} 行）——表态归《决策与评审记录》。`
      + '若来自规约原文，在 ids.json 里把含义改写为中性事实陈述，把待决部分登记为决策');
  }

  // 数值溯源：上游（RR/SR）是事实来源，decisions 是「本工程设定」的唯一出口。
  // spec 不算——它自己就是本轮产出的，拿它当出处等于自证。
  const upstream = [docs.PRD ?? '', docs.SE ?? ''].join('\n');
  for (const { value, line } of findUnsourcedNumbers(bodyText, upstream, decisions)) {
    problems.push(
      `story 第 ${line} 行的数值 ${value} 没有出处：上游原文里没有，也没有决策承载它。`
      + '若来自上游请核对原文写法；若是本工程设定，登记 decisions.json 后正文写 {{DEC-00X}} 引用');
  }

  const specText = docs.SPEC ?? '';
  problems.push(...findUnanchoredImpacts(decisions, specText));
  const missingIds = specText ? findMissingIdentifiers(specText, bodyText) : [];
  if (missingIds.length) {
    problems.push(
      `需求规格的可标识事实未全部落入 story：缺 ${missingIds.join('、')}`
      + '（可整合、可改序、可换措辞，但不能少）');
  }
  const fingerprint = sha256(bodyText);
  // 源指纹：记下装配时各上游源的内容 sha。
  // 现有一致性检查是**单向**的（只查「story 缺了 spec 的什么」），于是「改了 spec
  // 但编号不变」零检测——评审者手里的叙事与实际要做的东西可以悄悄分叉。
  // 源清单取自章节合同的 sources，新增源自动纳入，不在这里硬编码。
  const sourceFp = sourceFingerprints(docs);
  const fpLine = `${FINGERPRINT_PREFIX}${fingerprint}${renderSourceFp(sourceFp)} -->`;
  const storyText = `${bodyText}\n\n${fpLine}\n`;

  return { problems, storyText, bodyText, fingerprint, sourceFp, decisions, ids, formReport, noneReasons };
}

/**
 * review 渲染：机器区每次按登记表重算，人工区逐字节保留。
 * 单源意味着登记表变了产物就得跟着变——「已存在就跳过」会让两者各说各话。
 */
export function renderReview(ctx, decisions, ids) {
  const { args, reviewPath } = ctx;
  const header = [
    `# ${args.feature} 决策与评审记录`,
    '',
    '## 如何填写本决策与评审记录',
    '',
    '每个议题只勾选一个审核结果：',
    '',
    '- **同意当前建议**：接受当前结论，不需要修改。',
    '- **有其他意见，需要修改**：填写具体修改意见；修改完成后需要二次复核。',
    '- **暂缓**：填写责任人、完成期限、是否阻塞执行与后续动作。',
    '',
    '「已定决策」一节里的结论已有上游依据或已由起草方给出，仍请逐条过目——',
    '你需要先知道本需求做了哪些决策、结论是什么，才谈得上判断它们对不对。',
    '',
    '**这些议题之外还有话要说**，写进末尾的「计划外意见」一节——',
    '起草方没想到的事本来就套不进他列出的表单。',
    '',
    '请勿删除原结论或覆盖历史意见。',
    '',
    '',
  ].join('\n');

  const existing = fs.existsSync(reviewPath) ? stripBom(fs.readFileSync(reviewPath, 'utf-8')) : null;
  const open = decisions.filter(d => d.status !== 'settled');
  const settled = decisions.filter(d => d.status === 'settled');
  const appended = [];
  const refreshed = [];

  const renderOne = d => {
    const human = existing ? extractHumanZone(existing, d.id) : null;
    if (existing && human) refreshed.push(d.id); else appended.push(d.id);
    return `${renderMachineZone(d)}\n${human ?? renderHumanZone(d)}`;
  };

  const sections = [];
  if (open.length) {
    sections.push('## 请逐项留下你的结论', '',
      open.map(renderOne).join('\n\n---\n\n'), '');
  }
  if (settled.length) {
    sections.push('## 已定决策（请逐条过目）', '',
      settled.map(renderOne).join('\n\n---\n\n'), '');
  }

  // 计划外意见排在议题之后、下一步之前：逐项表态完了才谈得上「还有什么没被问到」。
  sections.push(renderFreeformSection(existing ? extractFreeformZone(existing) : null));

  const tail = ['## 下一步', '',
    '- [ ] **进入执行**：每个议题都已勾选一项；所有「需要修改」已回写并二次复核；无阻塞暂缓。',
    '- [ ] **修改后重新评审**：列出需要修改的议题与责任人。', '',
    '**状态**：草稿（待开发确认）', ''].join('\n');

  const text = `${header}${sections.join('\n')}\n${tail}`;
  return { text: refreshAppendix(text, ids), appended, refreshed };
}

/**
 * 附录是机器渲染区：按 review 正文实际引用的编号重算，插在状态行之前。
 * 它只有「编号 / 标题与含义」两列——落点列不渲染，review 结构上不可能出现第二份需求叙事。
 */
export function refreshAppendix(text, ids) {
  const marker = '## 附录：编号速查';
  const statusIdx = text.indexOf('**状态**');
  const startIdx = text.indexOf(marker);
  const bodyForScan = startIdx >= 0
    ? text.slice(0, startIdx) + (statusIdx > startIdx ? text.slice(statusIdx) : '')
    : text;
  const appendix = renderReviewAppendix(ids, bodyForScan);
  const block = appendix ? `${appendix}\n\n` : '';

  if (startIdx >= 0) {
    const end = statusIdx > startIdx ? statusIdx : text.length;
    return text.slice(0, startIdx) + block + text.slice(end);
  }
  if (statusIdx >= 0) return text.slice(0, statusIdx) + block + text.slice(statusIdx);
  return block ? `${text.trimEnd()}\n\n${block}` : text;
}

function build(ctx) {
  const { projectRoot, contract, storyPath, reviewPath, featureRoot } = ctx;
  let reviewReport = null;
  const result = assemble(ctx);
  if (result.problems.length) fail(result.problems);

  fs.mkdirSync(path.dirname(storyPath), { recursive: true });
  fs.writeFileSync(storyPath, result.storyText, 'utf-8');

  // 归档后 review.md 归人所有：它已作为附件送审，评审人在上面批注，
  // `/story review` 还会把系统侧回稿写回来。此时重建等于把人的反馈冲掉，
  // 所以只备份、不覆盖——人可以自由编辑本地文件，不必担心下一次 build。
  if (isArchived(featureRoot) && fs.existsSync(reviewPath)) {
    const dir = path.join(featureRoot, 'AR', '.review-backup');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const kept = path.join(dir, `${stamp}-review.md`);
    fs.copyFileSync(reviewPath, kept);
    console.warn(`[story-build] ⚠ 已归档：review.md 归人所有，本次不重建`
      + `（已备份至 ${path.relative(projectRoot, kept)}）`);
  } else {
    const review = renderReview(ctx, result.decisions, result.ids);
    if (/\bundefined\b/.test(review.text)) {
      fail(['review 渲染结果含字面量 undefined：某处取到了空字段']);
    }
    fs.writeFileSync(reviewPath, review.text, 'utf-8');
    reviewReport = review;
  }

  const open = result.decisions.filter(d => d.status !== 'settled').length;
  console.log(`[story-build] ✅ 已装配：${path.relative(projectRoot, storyPath)}`);
  console.log(`[story-build]    章节 ${contract.chapters.length} 章｜决策 ${result.decisions.length} 条`
    + `（开放 ${open}／已定 ${result.decisions.length - open}）｜编号 ${result.ids.length} 条`);
  // 空表是被声明过的，不是漏了——但它决定了产物长什么样（无决策即空 review），
  // 所以每次装配都把理由摆出来，让人当场判断这个声明还成不成立。
  for (const reason of result.noneReasons ?? []) {
    console.warn(`[story-build] ⚠ ${reason}`);
  }
  if (reviewReport?.refreshed.length) {
    console.log(`[story-build]    review 机器区已重渲染：${reviewReport.refreshed.join('、')}（人工填写内容未改动）`);
  }
  if (reviewReport?.appended.length) {
    console.log(`[story-build]    review 新增议题：${reviewReport.appended.join('、')}`);
  }
  console.log(`[story-build]    fingerprint=${result.fingerprint.slice(0, 16)}`);
}

// ---------------------------------------------------------------------------
// check：重新装配并与磁盘对比

function check(ctx) {
  const { projectRoot, storyPath, reviewPath, featureRoot } = ctx;
  const problems = [];
  if (!fs.existsSync(storyPath)) fail(`story.md 不存在：${storyPath}（先跑 build）`);
  const onDisk = stripBom(fs.readFileSync(storyPath, 'utf-8'));

  const result = assemble(ctx);
  problems.push(...result.problems);

  // 逐字比对指纹之前的正文本体：只认「指纹串还在」会漏掉追加在注释之后的手改。
  const idx = onDisk.indexOf(FINGERPRINT_PREFIX);
  if (idx < 0) {
    problems.push('story.md 没有装配指纹：它不是 build 的产物，或指纹被删除');
  } else {
    const bodyOnDisk = onDisk.slice(0, idx).trimEnd();
    const tail = onDisk.slice(idx).trim();
    if (!/^<!-- assembled-by: story-build\.mjs \| fingerprint: [0-9a-f]{64}( \| sources: [^>]*?)? -->$/.test(tail)) {
      problems.push('story.md 装配指纹之后还有内容：产物被直接追加修改');
    }
    if (bodyOnDisk !== result.bodyText) {
      problems.push('story.md 与章节源不一致：产物被直接手改，或章节改后未重新 build');
    }

    // 源漂移：装配时记的源 sha 与当前源对不上，说明上游改了而 story 没跟。
    // 这是单向检查补不上的那半——「改了 spec 但编号不变」在只查「story 缺了什么」
    // 的逻辑下完全静默。
    const recorded = parseSourceFp(tail);
    if (recorded) {
      const drifted = Object.entries(recorded)
        .filter(([k, v]) => result.sourceFp[k] && result.sourceFp[k] !== v)
        .map(([k]) => k);
      if (drifted.length) {
        const msg = `上游源已变更但 story 未重新装配：${drifted.join('、')}`
          + '（story 记录的是装配时那一版；改了源就重跑 build，否则评审者读到的叙事与实际要做的事不是一回事）';
        if (isArchived(featureRoot)) {
          console.warn(`[story-build] ⚠ ${msg}——已归档，story 定稿于评审时点，此处只告警`);
        } else {
          problems.push(msg);
        }
      }
    }
  }

  if (!fs.existsSync(reviewPath)) {
    problems.push(`review.md 不存在：${reviewPath}`);
  } else {
    const review = stripBom(fs.readFileSync(reviewPath, 'utf-8'));
    for (const d of result.decisions) {
      const range = findBlockRange(review, d.id);
      if (!range) {
        problems.push(`review 缺少议题：${d.id}`);
        continue;
      }
      // 机器区必须等于登记表当前渲染结果——否则登记表改了、review 还留旧值。
      const block = review.slice(range.start, range.end);
      const machineOnDisk = block.slice(0, block.indexOf(HUMAN_ZONE_MARK)).trim();
      if (machineOnDisk !== renderMachineZone(d).trim()) {
        problems.push(`review 议题 ${d.id} 的机器区与 decisions.json 不一致：改了登记表后须重新 build`);
      }
    }
    const known = new Set(result.decisions.map(d => d.id));
    for (const m of review.matchAll(/<!-- decision: ([\w-]+) -->/g)) {
      if (!known.has(m[1])) problems.push(`review 含未登记议题：${m[1]}`);
    }
  }

  if (problems.length) fail(problems);
  console.log(`[story-build] ✅ 装配一致：${path.relative(projectRoot, storyPath)}`);
  console.log(`[story-build]    fingerprint=${result.fingerprint.slice(0, 16)}`);
}

function main() {
  const args = parseArgs(process.argv);
  if (!['scaffold', 'build', 'check'].includes(args.command)) {
    fail('用法：story-build.mjs <scaffold|build|check> --feature <name>');
  }
  if (!args.feature) fail('缺少 --feature <name>');
  const ctx = createContext(args);
  if (args.command === 'scaffold') scaffold(ctx);
  else if (args.command === 'build') build(ctx);
  else check(ctx);
}

// 只在被直接执行时跑 CLI；被测试 import 时只暴露纯函数，无副作用。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
