/**
 * spec 阶段 post_check 生命周期 hook（实例扩展 story）
 *
 * 作用：把**本阶段三份产物**与**宿主扩展章节**纳入 spec 阶段闭环判定。
 *   1. 三份产物齐备：spec.md（代码要求）/ AR/review.md（归档件·决策件）/ AR/story.md（归档件·叙事主件）；
 *   2. §9 技术契约的结构完整性（core spec 模板未含，由 on_context_load.md 指令驱动 AI 追加）；
 *   3. 合规判定落 spec 的那部分（§7 UX 适配要求）确实写了；
 *   4. 三条全文红线：禁用词 / 文档坐标 / 数值来源；
 *   5. story 前置流程契约（AR/story-flow.json）已收口且决策留痕齐备。
 *
 * 两份归档件自身的结构、一致性与自包含红线由 skills/story/scripts/merge-story.mjs --check 负责，本 hook 只查在不在。
 *
 * 校验边界：**不校验结论真假**——文档坐标可被 AI 伪造，校验格式只给虚假的安全感。
 * 结论是否成立由 AI verifier 按名称回查源文件、以及开发的证据抽查关卡把关。
 * 唯一能机器验真假的是「数值来源」：标『上游约束』时读 SR/RR 原文核对该数值是否真实存在。
 *
 * 契约：stdin JSON ctx → stdout JSON result（同 hooks/coding/pre_check.mjs 演示）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanBannedTerms, formatHits } from '../../skills/story/scripts/lint-rules.mjs';

const SECTIONS_DOC = 'doc/extensions/skills/story/templates/spec-sections.md';
const EVIDENCE_DOC = 'doc/extensions/skills/story/reference/evidence-rules.md';

function featuresDir(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'framework.config.json'), 'utf-8'));
    if (typeof cfg?.paths?.features_dir === 'string' && cfg.paths.features_dir.trim()) {
      return cfg.paths.features_dir.trim();
    }
  } catch {
    // 配置缺失/损坏时回落默认；不在 hook 里升级为错误
  }
  return 'doc/features';
}

/** 提取小节正文（到下一个 ##/### 标题为止） */
function sectionBody(lines, headingIdx) {
  const body = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{2,3}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body;
}

function isSeparatorRow(line) {
  return /^\|[\s:|-]+\|?\s*$/.test(line);
}

function rowCells(line) {
  // 不在转义竖线（\|）处切列
  return line.split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim());
}

/** 模板占位残留：章节模板的待填处写作「{ … }」，出现即表示该节未填写 */
function hasTemplatePlaceholder(body) {
  return body.some(l => /\{\s*[^}]*[一-龥][^}]*\}/.test(l));
}

/** 小节是否已填：存在非空表格数据行，或存在非提示性正文行（如「不涉及：…」） */
function sectionFilled(body) {
  let sawSeparator = false;
  for (const raw of body) {
    const line = raw.trim();
    if (!line || line.startsWith('>') || line.startsWith('<!--')) continue;
    if (line.startsWith('|')) {
      if (isSeparatorRow(line)) {
        sawSeparator = true;
        continue;
      }
      if (sawSeparator && rowCells(line).some(c => c.length > 0)) return true;
      continue;
    }
    sawSeparator = false; // 离开表格块，下一张表须重新经过表头+分隔行
    return true; // 非表格、非提示的正文行（如「不涉及 + 依据」）
  }
  return false;
}

/**
 * 文档坐标扫描（evidence-rules §0 独立审计原则）。
 * spec 是可独立审计的文件——结论不挂 `spec §x`/`SR §x`/`RR §x`/`AR §x` 这类章节坐标，
 * 小节之间也不用「见 A5」互指；核对由 verifier 按名称回查与开发的证据抽查关卡完成。
 * 坐标是 AI 自己写的、可以伪造（写「≤1500 ms（SR §3.1）」而该章节根本没有时延数字），
 * 换个文档就失效，且会一路带进不含这些源文件的归档件。
 */
const DOC_COORD_RE = /(?:\bspec\s*§|\bSR\s*§|\bRR\s*§|\bAR\s*§|(?:见|指回|来源)\s*A[1-8]\b)/g;

function scanDocCoords(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence || lines[i].trim().startsWith('<!--')) continue;
    for (const m of lines[i].matchAll(DOC_COORD_RE)) {
      hits.push({ line: i + 1, coord: m[0].trim(), text: lines[i].trim().slice(0, 80) });
    }
  }
  return hits;
}

/**
 * 数值来源校验（spec-sections 红线：数值必须标来源类型）。
 * 阈值/时长一类数字必须三选一标明来源：上游约束 / 本工程设定 / 平台基线。
 * 标「上游约束」时读上游原文验证该数值真实存在——这是唯一能机器验真假的一环，
 * 也是唯一能抓住「造数字 + 挂假出处」的门禁。
 */
const NUMERIC_RE = /(\d+(?:\.\d+)?)\s*(ms|毫秒|秒|s|分钟|min|次)\b/gi;
const SOURCE_TAG_RE = /(上游约束|本工程设定|平台基线|无上游依据)/;
/** 单位同义词：回查上游时逐个试（上游可能写「30 分钟」而 spec 写「30 min」） */
const UNIT_ALIASES = {
  ms: ['ms', '毫秒'],
  毫秒: ['ms', '毫秒'],
  s: ['s', '秒'],
  秒: ['s', '秒'],
  min: ['min', '分钟'],
  分钟: ['min', '分钟'],
  次: ['次'],
};

function scanNumericSources(text, upstreamTexts) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.trim().startsWith('<!--') || line.trim().startsWith('>')) continue;
    const nums = [...line.matchAll(NUMERIC_RE)];
    if (nums.length === 0) continue;
    if (!SOURCE_TAG_RE.test(line)) {
      problems.push(
        `第 ${i + 1} 行的数值「${nums.map(m => m[0]).join('、')}」未标来源类型` +
          `（须三选一：上游约束：<文档名> / 本工程设定，无上游依据 / 平台基线）：${line.trim().slice(0, 60)}`
      );
      continue;
    }
    if (/上游约束/.test(line)) {
      for (const m of nums) {
        const numeral = m[1];
        // 必须**带单位**回查：裸数字（`2`、`30`）会在上游任意位置碰巧命中
        // （`§2`、`2 个场景`、日期），带上单位才是在找同一个量
        const units = UNIT_ALIASES[m[2].toLowerCase()] ?? [m[2]];
        const found = upstreamTexts.some(t =>
          units.some(u => t.includes(`${numeral}${u}`) || t.includes(`${numeral} ${u}`))
        );
        if (!found) {
          problems.push(
            `第 ${i + 1} 行声称「上游约束」，但上游文档（SR/RR）中不存在数值「${numeral}」` +
              `——伪造出处，须改标「本工程设定，无上游依据」或回源核实：${line.trim().slice(0, 60)}`
          );
        }
      }
    }
  }
  return problems;
}


/** 按标题关键词定位章节（容忍编号差异：`## 9. 技术契约` / `## 技术契约` 均可） */
function findHeading(lines, titleRe) {
  return lines.findIndex(l => {
    const h = l.trim().match(/^(#{2,4})\s+(.*)$/);
    return h ? titleRe.test(h[2].replace(/^[\d.、\s]+/, '')) : false;
  });
}

/**
 * spec 宿主扩展章节（core 模板未含，由 hooks/spec/on_context_load.md 指令驱动 AI 追加）：
 *   §9 技术契约 —— 给下游 AI：plan 据此编码、test-plan 据此出用例
 * 模板见 skills/story/templates/spec-sections.md。
 *
 * 曾有过 §10 合规与兼容自检，已迁出：那两张判定表零条代码要求，纯粹是给评审者的完备性回显，
 * 与「spec 只装与最终代码有关的内容」相悖。现落 AR/story.md 的影响面与合规章；
 * 它的完整性由 verifier 的 spec_constraint_echo 判定——那是判断，脚本判不了。
 */
const SPEC_EXT_SECTIONS = [
  { ch: '9 技术契约', title: /技术契约/, subs: [['端云接口', /端云接口/], ['数据存储', /数据存储/], ['配置项', /配置项/], ['埋点', /埋点/], ['依赖变更', /依赖变更/]] },
];

/** 本阶段三份产物（见 hooks/spec/on_context_load.md「本阶段产出三份文档」） */
const PHASE_ARTIFACTS = [
  {
    rel: ['AR', 'review.md'],
    name: 'AR/review.md',
    why: '归档件·评审记录（自然语言问题、当前建议与可填写审核结果），由 AI 起草、人填写结果',
    fix: '把开放点登记到 AR/story-src/decisions.json，再 story-build.mjs build 渲染（末尾状态行保持「草稿（待开发确认）」）',
  },
  {
    rel: ['AR', 'story.md'],
    name: 'AR/story.md',
    why: '归档件·叙事主件（完整需求叙事 + 判断 + 合规回显），评审者以它为主线',
    fix: '先 story-build.mjs scaffold 按章节合同注入源材料，逐章转写后 build 装配，再执行 check 与 merge-story --check',
  },
];

/**
 * story 前置流程契约（`AR/story-flow.json`，见 SKILL.md「初析与流程契约」章）。
 *
 * 契约存在即表示该 feature 走了 /story：材料导入、拆分裁决、进入 spec 的授权都记在里面。
 * 未收口就进 spec，说明这些决策没走完：诊断出 PRD 缺料却径直进 /spec，人工补录的整份 PRD
 * 就全程没被读过。这里是该跳步的机械拦截点。
 *
 * 没走 /story 的 feature 没有这个文件，**不受本检查影响**。
 */
const FLOW_FILE = ['AR', 'story-flow.json'];
const FLOW_SCHEMA = 3;
// 三级关卡，每级只问一件事：材料够不够 → 范围怎么定 → 承载哪一份
const FLOW_GATES = new Set(['material_scope', 'scope_decision', 'split_carrier']);
// 只有第一级的值域是闭合的；第二级除固定的 carry_all 外是具名维度、第三级是份序号，
// 都由「chosen 必须在 options 里」把关——它们是本次分析的产物，枚举不了
const FLOW_MATERIAL_CHOICES = new Set(['supplement', 'confirm_scope']);
const FLOW_CARRY_ALL = 'carry_all';
const FLOW_OUTCOMES = new Set(['accepted', 'rejected']);
const FLOW_FIX = "处置：回 /story 走完三级关卡（材料够不够 → 范围怎么定 → 承载哪份）把范围定下来后再进本阶段。";
const DESIGN_FILE = ['AR', 'design.md'];

function storyFlowProblems(featureRoot) {
  const flowPath = path.join(featureRoot, ...FLOW_FILE);
  if (!fs.existsSync(flowPath)) return [];

  let flow;
  try {
    flow = JSON.parse(fs.readFileSync(flowPath, 'utf-8').replace(/^﻿/, ''));
  } catch (err) {
    // 坏 JSON 不能当「没有契约」放过去——那等于跳步免费
    return [`AR/story-flow.json 不是合法 JSON（${err.message}）：流程契约无法校验。${FLOW_FIX}`];
  }

  // 契约由 story_flow.py 写；本函数是防手工编辑与文件损坏的最后一道防线，正常情况下不该响
  if (flow?.schema !== FLOW_SCHEMA) {
    return [
      `AR/story-flow.json 的 schema 为 ${flow?.schema ?? '缺失'}，本阶段要求 ${FLOW_SCHEMA}。` +
        `契约应由 scripts/story_flow.py 写入，请勿手工维护。${FLOW_FIX}`,
    ];
  }

  const problems = [];
  const rounds = Array.isArray(flow?.rounds) ? flow.rounds : [];

  if (rounds.length === 0) {
    problems.push(`AR/story-flow.json 没有任何轮次记录——契约在但流程没走过。${FLOW_FIX}`);
  }

  rounds.forEach((r, i) => {
    const where = `AR/story-flow.json 第 ${i + 1} 轮`;
    // 一轮 = 一次初析：轮次由初析件哈希划界，两轮哈希相同说明是伪造的轮次
    const sha = r?.analysis?.sha256;
    if (!sha) problems.push(`${where}缺 analysis.sha256——无从证明这一轮确实重新初析过`);
    else if (i > 0 && sha === rounds[i - 1]?.analysis?.sha256) {
      problems.push(`${where}与上一轮的 analysis.sha256 相同——初析没重做，不构成新一轮`);
    }

    // 本 AR 定位是整条范围链的起点：没有它，「本 AR 承载什么」就没有依据，
    // 下游只能默默按上游全量走，SR 全量就会被写成本 AR 范围。
    //
    // 只查**收口那一轮**：材料盘点阶段（补料被拒的那些轮次）本来就还没做需求分析，
    // 要求每一轮都有定位，等于逼着人在材料没确认时先写完整分析。
    const isLastRound = i === rounds.length - 1;
    const pos = r?.positioning;
    if (isLastRound) {
      if (!pos || !String(pos?.scope_text ?? '').trim()) {
        problems.push(`${where}缺 positioning.scope_text——本 AR 当前范围没定下来就收了口`);
      } else if (!Array.isArray(pos?.sr_related_ars)) {
        problems.push(`${where}的 positioning.sr_related_ars 不是数组（同 SR 其它 AR；没有给空数组）`);
      } else if (pos.sr_related_ars.some(x => String(x?.ar ?? '').trim() === path.basename(featureRoot))) {
        problems.push(`${where}的 sr_related_ars 含本 AR 自己——该字段只列同一 SR 下的**其它** AR`);
      }
      // 第二级的选项集来自需求分析，不在关卡现编：契约里没有它，关卡就无从照出
      const scopeOptions = r?.scope_options;
      if (!Array.isArray(scopeOptions) || scopeOptions.length === 0) {
        problems.push(`${where}缺 scope_options——范围定法选项集没落契约，第二级只能现编选项`);
      } else if (!scopeOptions.some(o => String(o?.key ?? '').trim() === 'carry_all')) {
        problems.push(`${where}的 scope_options 缺固定首项 carry_all（按当前范围整体承载）`);
      }
    }

    const gates = Array.isArray(r?.gates) ? r.gates : null;
    if (!gates) {
      problems.push(`${where}缺 gates 数组（一轮可含多条关卡记录，含未生效的那次）`);
      return;
    }
    gates.forEach((d, j) => {
      const at = `${where}第 ${j + 1} 条关卡记录`;
      const gate = d?.gate;
      if (!FLOW_GATES.has(gate)) {
        problems.push(`${at}的 gate 非法（须为 material_scope / scope_decision / split_carrier）`);
      }
      // 只记选中项的话，「看过选项后选了不拆」与「压根没摆过拆分选项」事后完全同形
      const options = Array.isArray(d?.options) ? d.options : null;
      if (!options || options.length === 0) {
        problems.push(`${at}缺 options——摆了哪些选项没留痕，事后分不清人是否看见过其它选择`);
      } else if (!options.some(o => String(o?.key ?? '').trim() === String(d?.chosen ?? '').trim())) {
        problems.push(`${at}的 chosen「${d?.chosen}」不在 options 里——选的必须是摆出来的`);
      }
      if (gate === 'material_scope' && !FLOW_MATERIAL_CHOICES.has(d?.chosen)) {
        problems.push(`${at}的 chosen 非法（material_scope 须为 supplement / confirm_scope 之一）`);
      }
      // 第二级摆出的选项必须就是分析定下的那些——多一项就是现编的
      if (gate === 'scope_decision' && Array.isArray(r?.scope_options) && Array.isArray(d?.options)) {
        const analysed = new Set(r.scope_options.map(o => String(o?.key ?? '').trim()));
        const invented = d.options
          .map(o => String(o?.key ?? '').trim())
          .filter(k => k && !analysed.has(k));
        if (invented.length) {
          problems.push(
            `${at}摆出了需求分析里没有的选项：${invented.join('、')}` +
              '——选项集只能照出分析定下的那几项，现编的选项没有份表也没有内容，人无从评估'
          );
        }
      }
      if (!FLOW_OUTCOMES.has(d?.outcome)) {
        problems.push(`${at}的 outcome 非法（须为 accepted / rejected）`);
      }
      if (d?.outcome === 'rejected' && !d?.reason) {
        problems.push(`${at}被拒却没写 reason——人被拦了一次，审计上必须看得见为什么`);
      }
      if (!d?.at) problems.push(`${at}缺时间戳 at`);
      if (d?.by === 'ai' && !d?.basis) {
        // 代选免掉的是等回话，不是免留依据：无依据的代选事后无从复核，也就无从推翻
        problems.push(`${at}为 AI 代选但缺 basis（用户授权时那句原话）`);
      }
    });
  });

  // 收口与拆分一律按**当前轮**判：一轮 = 一次「初析 → 关卡」循环，补料会开新一轮。
  // 展平所有轮次去判，第一轮那次 proceed 就能替补料后的新一轮授权收口。
  const lastRound = rounds[rounds.length - 1];
  const lastGates = Array.isArray(lastRound?.gates) ? lastRound.gates : [];
  // split 是契约级字段，但决策属于某一轮——靠 settled_round 挂钩，重新初析后不再算数
  const splitSettledThisRound =
    flow?.split?.decided === 'split' && flow?.split?.settled_round === lastRound?.round;

  // 第二级选了某个切分维度，却没走到第三级定案：「打算切」被当成了「切好了」，
  // 而此时范围其实还是定位出来的那个全量
  const choseDimension = lastGates.some(
    d => d?.gate === 'scope_decision' && d?.chosen !== FLOW_CARRY_ALL && d?.outcome === 'accepted'
  );
  if (choseDimension && !splitSettledThisRound) {
    problems.push(
      'AR/story-flow.json 本轮第二级选了切分维度，但份表未在本轮定案——' +
        '第三级「本 AR 承载哪份」没走完，范围实际未切'
    );
  }
  // 反过来：定了案却没有第二级的维度选择，说明份表来路不明
  if (splitSettledThisRound && !choseDimension) {
    problems.push(
      'AR/story-flow.json 本轮定案了切分，但第二级没有选过任何切分维度——' +
        '份表按哪个维度切的没有留痕'
    );
  }

  if (flow?.split?.decided === 'split') {
    if (!String(flow.split.scope_text ?? '').trim()) {
      problems.push(
        'AR/story-flow.json 已定案拆分但 split.scope_text 为空——范围文字丢了，' +
          'AR/design.md 的「本 AR 范围与拆分说明」就没有东西可写'
      );
    }
    // 两级子菜单的留痕查定案那一轮：split 记的是哪一轮定的，就去哪一轮找记录
    const settledRound = rounds.find(r => r?.round === flow.split.settled_round);
    const settledGates = Array.isArray(settledRound?.gates) ? settledRound.gates : lastGates;
    for (const gate of ['scope_decision', 'split_carrier']) {
      if (!settledGates.some(d => d?.gate === gate)) {
        problems.push(`AR/story-flow.json 已定案切分但缺 ${gate} 关卡记录——那一级的选择没留痕`);
      }
    }
    // 份表回答「拆成几份、各归谁、什么顺序、谁依赖谁」；只有一段范围文字，
    // story 05 章的必答问（兄弟各承载什么、先后依赖）就只能靠现编。
    const parts = Array.isArray(flow.split.parts) ? flow.split.parts : [];
    if (parts.length) {
      // feature 名从产物路径推导——本函数只拿得到 featureRoot，取 ctx 会在这里抛
      // ReferenceError，而它只在拆分定案时才触发，平时跑 proceed 路径根本发现不了。
      const feature = path.basename(featureRoot);
      const mine = parts.filter(p => String(p?.carrier ?? '').trim() === feature);
      if (mine.length !== 1) {
        problems.push(
          `AR/story-flow.json 的 split.parts 里 carrier 为「${feature}」的有 ${mine.length} 份，` +
            '应恰好一份——本 AR 承载哪一份是拆分的核心结论'
        );
      }
    }
  }

  if (flow?.status !== 'complete') {
    problems.push(
      `story 前置流程未收口（status=${flow?.status ?? '缺失'}）：材料与拆分决策没走完就进了 spec。${FLOW_FIX}`
    );
  } else {
    // 收口的前置是**本轮范围已定**：第二级选了整体承载，或第三级完成定案。
    // 不再看「末条是不是 proceed」——范围一定就直接进 S4，没有回关卡收口这一步了。
    const carriedAll = lastGates.some(
      d => d?.gate === 'scope_decision' && d?.chosen === FLOW_CARRY_ALL && d?.outcome === 'accepted'
    );
    if (!carriedAll && !splitSettledThisRound) {
      problems.push(
        'AR/story-flow.json 标了 complete，但本轮既没选整体承载、也没定案切分——' +
          '范围没定下来，收口与决策记录自相矛盾'
      );
    }
    if (!flow?.design_generated_at) {
      problems.push('AR/story-flow.json 标了 complete，但 design_generated_at 为空——提取件生成未留痕');
    }
  }

  // 契约与产物的交叉核对：同 SR 还有其它 AR 时，design.md 必须点名它们。
  //
  // 查的是**该出现的有没有出现**，不是**不该出现什么措辞**：范围外内容归谁，只能靠写出
  // 单号来表达，换个说法绕不过去；而拿「承载全部需求」这类句子当违禁词，模型换句话
  // 就失效，且合法用法（真的只有本 AR 时）还会被误伤。
  const related = Array.isArray(lastRound?.positioning?.sr_related_ars)
    ? lastRound.positioning.sr_related_ars
    : [];
  if (related.length) {
    const designPath = path.join(featureRoot, ...DESIGN_FILE);
    if (fs.existsSync(designPath)) {
      const designText = fs.readFileSync(designPath, 'utf-8');
      const missing = related
        .map(x => String(x?.ar ?? '').trim())
        .filter(ar => ar && !designText.includes(ar));
      if (missing.length) {
        problems.push(
          `AR/design.md 通篇没提到同一 SR 下的 ${missing.join('、')}——` +
            '有兄弟 AR 就说明本 AR 不承载全部，范围外内容归谁必须写出来（单号或「待立项」），' +
            '否则 spec 的 out_of_scope 只能笼统写「本需求不做」，评审者分不清有人接还是没人接。' +
            '形态见 rules/ar_design_init.md §3（模板 1.2 三形态）'
        );
      }
    }
  }
  return problems;
}

export default async function postCheckHook(ctx) {
  if (ctx?.phase !== 'spec' || !ctx?.feature || !ctx?.projectRoot) {
    return { ok: true };
  }

  const featureRoot = path.join(ctx.projectRoot, featuresDir(ctx.projectRoot), ctx.feature);
  const rel = path.join(featuresDir(ctx.projectRoot), ctx.feature, 'spec', 'spec.md');
  const specPath = path.join(featureRoot, 'spec', 'spec.md');
  const fix = `处置：按 ${SECTIONS_DOC} 补齐 spec 宿主扩展章节（结论写法见 ${EVIDENCE_DOC}），然后重跑 harness --phase spec。`;

  // spec 本身缺失由 framework 的 check-spec 负责，本 hook 只管宿主扩展部分
  if (!fs.existsSync(specPath)) return { ok: true };

  const text = fs.readFileSync(specPath, 'utf-8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const problems = [];

  // 场景探针：走过 /story 的 feature 才有流程契约。
  // 本 hook 的检查分两类——**扩展新增的结构要求**（三份产物、§9 技术契约、术语解释列、
  // 归档件红线）只在 story 场景成立，对「口述一个需求直接跑 spec」的用法是凭空多出来的
  // 硬阻断；**规约派生的要求**（§7 UX 适配）与 story 无关，对所有人生效。
  const isStory = fs.existsSync(path.join(featureRoot, ...FLOW_FILE));

  // ---- 本阶段三份产物齐备（story 专属）----
  // spec 阶段一次 pass 产出 spec.md / review.md / story.md，三者事实同源。
  // 只交 spec.md 就宣告闭环，等于把评审件推给下一次对话去补，那时上游取证上下文已经散了。
  if (isStory) {
    for (const a of PHASE_ARTIFACTS) {
      if (!fs.existsSync(path.join(featureRoot, ...a.rel))) {
        problems.push(`缺少本阶段产物「${a.name}」——${a.why}；处置：${a.fix}`);
      }
    }
  }

  // ---- story 前置流程契约已收口 ----
  problems.push(...storyFlowProblems(featureRoot));

  // ---- 两章的结构完整性：章在、小节齐、非空、无模板占位（story 专属）----
  // 这两章是扩展在 core 模板之上新增的，只跑原生 spec 的使用者从没被要求写过。
  if (isStory) {
    for (const { ch, title, subs } of SPEC_EXT_SECTIONS) {
      const chIdx = findHeading(lines, title);
      if (chIdx === -1) {
        problems.push(`缺少宿主扩展章节「§${ch}」（core spec 模板未含，须在验收标准之后追加）`);
        continue;
      }
      for (const [name, subRe] of subs) {
        const subIdx = findHeading(lines, subRe);
        if (subIdx === -1 || subIdx < chIdx) {
          problems.push(`§${ch} 缺少小节「${name}」（小节不得删；不涉及也须写「不涉及 + 一句依据」）`);
          continue;
        }
        const body = sectionBody(lines, subIdx);
        if (!sectionFilled(body)) {
          problems.push(`§${ch}「${name}」未填写（须给出事实或「不涉及 + 一句依据」）`);
        } else if (hasTemplatePlaceholder(body)) {
          problems.push(`§${ch}「${name}」残留模板占位「{ … }」——须替换为实际结论`);
        }
      }
    }
  }

  // ---- 合规判定落 spec 的那部分：UX 适配要求 ----
  // 深色主题 / 大字体 / 多语言这类要求只在合规判定时才冒出来，spec 别处没有，
  // 漏了就到不了编码。仅当 spec 声明有 UI 变更时要求（非 UI 需求不适用）。
  if (/ui_change:\s*(new_or_changed|changed|new)/.test(text) && findHeading(lines, /UX\s*适配要求/) === -1) {
    problems.push(
      '声明了 UI 变更但 §7 缺少「UX 适配要求」小节' +
        '（界面适配类约束命中时产生的代码要求写在这里；要求内容见对应条目的「处置」列' +
        '与该域落法附注。这类要求只在合规判定时产生，不写进 spec 就到不了编码）'
    );
  }

  // ---- 术语映射表：业务名词须有解释（story 专属）----
  // 「解释」列是扩展在 core 模板的 §0 之上追加的，附录 A 只留一句索引。
  // 判据不用白名单——**权威模块落在 in_scope_modules 里的行就是本需求的业务词汇**，
  // 评审者必须能查到；权威模块是被消费的基础能力（账号 / 通用 UI / 工具）时可留「—」。
  // 数据全在 spec 自己里，加约束文件或改架构都不会让这条判据失效。
  if (isStory) {
    const scopeBlock = text.match(/in_scope_modules:\s*\n((?:\s*-\s*.+\n)+)/);
    const inScope = new Set(
      (scopeBlock?.[1] ?? '')
        .split('\n')
        .map(l => l.match(/^\s*-\s*(.+?)\s*$/)?.[1])
        .filter(Boolean)
    );
    const mapIdx = findHeading(lines, /术语映射表/);
    if (mapIdx !== -1 && inScope.size > 0) {
      const rows = [];
      let sawSep = false;
      let headerCells = null;
      for (let i = mapIdx + 1; i < lines.length; i++) {
        const l = lines[i].trim();
        if (/^#{2,3}\s/.test(l)) break;
        if (!l.startsWith('|')) { sawSep = false; continue; }
        if (isSeparatorRow(l)) { sawSep = true; continue; }
        const cells = rowCells(l);
        if (!sawSep) { headerCells = cells; continue; }
        rows.push(cells);
      }
      // rowCells 对带行尾竖线的行会多出末位空串，故「解释」列须按表头定位而非按末位索引。
      // 框架 parser（markdown-parser.parsePipeRow）要求数据行带行尾竖线才能解析，两者必须兼容。
      // 表头与数据行同为「行首空串 + 各列 +（行尾空串）」结构，表头索引可直接用于数据行。
      const explainIdx = headerCells
        ? headerCells.findIndex(h => h.trim().includes('解释'))
        : -1;
      const moduleIdx = headerCells
        ? headerCells.findIndex(h => h.trim().includes('权威模块'))
        : 2;
      const business = rows.filter(c => inScope.has((c[moduleIdx] ?? '').trim()));
      const noExplain = business.filter(c => {
        const last = (c[explainIdx] ?? '').trim();
        return !last || last === '—' || /^\[[ x]\]$/.test(last);
      });
      if (rows.length > 0 && noExplain.length > 0) {
        problems.push(
          `术语映射表有 ${noExplain.length} 个业务名词没写「解释」：${noExplain.map(c => (c[1] ?? c[0] ?? '').trim()).join('、')}` +
            '——它们的权威模块在本需求 Scope 内，是本需求的业务词汇；评审叙事件的术语表从这里抄，' +
            '漏了评审者在归档件里就查不到这个词。基础能力类术语可留「—」'
        );
      }
    }
  }

  // ---- 三条全文红线（词表 SSOT：skills/story/scripts/lint-rules.mjs · story 专属）----
  // 这三条的作业指导随 story 专属注入件下发；未走 /story 的使用者只在通用注入件里读到
  // 建议形态，不该在这里被硬阻断——**注入指导与硬阻断是两件事**。
  if (isStory) {
    // 客户端语境：spec 是编码与评审件的共同上游，源头不放行才不会一路带下去
    const bannedHits = scanBannedTerms(text);
    if (bannedHits.length > 0) {
      problems.push(
        `含客户端语境禁用词 ${bannedHits.length} 处（服务器侧词汇，单独使用也算）：${formatHits(bannedHits.slice(0, 3), 'banned').join('；')}` +
          (bannedHits.length > 3 ? `；…另 ${bannedHits.length - 3} 处` : '')
      );
    }

    // 独立审计：不写文档坐标（详见 evidence-rules 独立审计原则）
    const coordHits = scanDocCoords(text);
    if (coordHits.length > 0) {
      problems.push(
        `含文档坐标 ${coordHits.length} 处（spec 须可独立审计；改用事物的名字，如「见管理台功能开关 feature_entry_enabled」）：` +
          coordHits.slice(0, 3).map(h => `第 ${h.line} 行「${h.coord}」`).join('、') +
          (coordHits.length > 3 ? `…另 ${coordHits.length - 3} 处` : '')
      );
    }

    // 数值来源：读 SR/RR/AR 原文验证「上游约束」类数值真实存在（唯一能机器验真假的一环）。
    // **排除已被 archive 覆盖的 AR/design.md**——archive 会用 story.md 覆盖它，覆盖后它不再是
    // 上游输入件而是本需求自己的产物；拿它回查等于让产物给自己背书——SR/RR 里没有的数值，
    // 会因为被覆盖的 AR 里有（那些值本就是从 spec 合成来的）而逃过校验。
    const upstreamTexts = ['SR/design.md', 'RR/prd.md', 'AR/design.md']
      .map(p => path.join(featureRoot, p))
      .filter(p => fs.existsSync(p))
      .map(p => fs.readFileSync(p, 'utf-8'))
      .filter(t => !/^>\s*源摘要：/m.test(t)); // story.md 的特征行；AR 提取件不会有
    const numericProblems = scanNumericSources(text, upstreamTexts);
    numericProblems.slice(0, 5).forEach(p => problems.push(p));
    if (numericProblems.length > 5) problems.push(`另有 ${numericProblems.length - 5} 处数值来源问题`);
  }

  if (problems.length > 0) {
    return {
      ok: false,
      severityOverride: 'BLOCKER',
      message: `spec.md（${rel}）未达 spec 闭环要求：${problems.join('；')}。${fix}`,
    };
  }
  return { ok: true };
}
