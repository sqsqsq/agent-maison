/**
 * Extract the coarse `it('<name>', ..., () => { ... })` blocks used by UT gates.
 *
 * This intentionally preserves the historical check-ut parser semantics. It is
 * not an ArkTS parser; sharing it keeps scope discovery and coverage checks from
 * disagreeing about which test names exist.
 */
export interface UtItBlock {
  name: string;
  body: string;
}

export function extractUtItBlocks(content: string): UtItBlock[] {
  const blocks: UtItBlock[] = [];
  const itRe = /it\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;

  while ((match = itRe.exec(content)) !== null) {
    const name = match[1];
    const startIdx = match.index;
    let braceCount = 0;
    let bodyStart = -1;
    let bodyEnd = -1;

    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === '{') {
        if (bodyStart === -1) bodyStart = i;
        braceCount++;
      } else if (content[i] === '}') {
        braceCount--;
        if (braceCount === 0 && bodyStart !== -1) {
          bodyEnd = i;
          break;
        }
      }
    }

    if (bodyStart !== -1 && bodyEnd !== -1) {
      blocks.push({ name, body: content.substring(bodyStart, bodyEnd + 1) });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// 预期来源分类（plan a9f3c7d2 第二笔 · R2）
// ---------------------------------------------------------------------------
// **纯按行扫描，不做任何括号配平**：上面那个提取器逐字符数 `{` `}`、不区分字符串/模板字面量/注释，
// 把作用域继承建在它上面必然误判（第三轮裁决因此取消了 describe 继承）。这里只看「声明行」与
// 「紧邻它上方的连续 `//` 注释行」，认不全的形态由 request 侧的两道数量对账兜住，不逐形态支持。
// 既有 `extractUtItBlocks` 的行为**一字未改**（feature 主体共用它）。

// ponytail: 上限＝**不解析字符串字面量与模板字符串**。把 `'/*'` 塞进字符串、或把假声明写进
// 模板字符串，仍能同时制造「多认一条假的 + 漏认一条真的」，让两道计数对账都相等，未登记的真实
// 测试被呈现成「现状记录」。这是**刻意构造**，本分类器的威胁模型是「诚实但会出错」不是对抗，
// 继续补就是在写词法分析器（违背「按行扫描、不配平」的定稿）。升级路径：provider 结果回传
// **用例名**后，改用名字集合对账替换这两道计数对账，届时这条上限自然消失。
export type UtExpectationClass = 'sourced' | 'characterization' | 'unregistered' | 'unclassifiable';

export interface UtExpectationEntry {
  /** 断言名（字符串字面量原文） */
  name: string;
  /** 声明形态：`it(` 或 `test(` */
  form: 'it' | 'test';
  class: UtExpectationClass;
  /** sourced 时的来源引用：路径（`// expectation:`）或标签（`[AC-1]` 等） */
  ref?: string;
  ref_kind?: 'path' | 'tag';
}

export interface UtExpectationScan {
  entries: UtExpectationEntry[];
  /** 识别出的声明总条数（零解析判据） */
  parsed: number;
  /** 其中 `it(` 形态的条数——与 `extractUtItBlocks(content).length` 做第一道对账 */
  itFormCount: number;
}

/** 行首（忽略缩进）起的 `it(` / `test(`，且名字是同行的字符串字面量。`it.skip(` 等变体**不算**声明。 */
const DECLARATION_RE = /^\s*(it|test)\s*\(\s*(['"`])([^'"`]*)\2/;
/** 行首起的 `it(` / `test(`，但名字**不在同一行**——不静默丢弃，记为「无法分类」。 */
const DECLARATION_HEAD_RE = /^\s*(it|test)\s*\($/;
/** 紧邻上方的 `//` 注释行；`/* *\/` 块注释明确不算标注。 */
const LINE_COMMENT_RE = /^\s*\/\/\s?(.*)$/;
/** 行内任意位置的 `it(` / `test(`（用于「注释边界可疑且这行还带声明」的兜底判定）。 */
const DECLARATION_ANYWHERE_RE = /(^|[^A-Za-z0-9_$.])(it|test)\s*\(/;
const EXPECTATION_RE = /^expectation\s*[:：]\s*(\S+)/;
const CHARACTERIZATION_RE = /^characterization\b/;
const SOURCED_TAG_RE = /^\[(AC|BD|BRANCH)-[^\]]+\]/;
const CHARACTERIZATION_TAG_RE = /^\[CHAR-[^\]]+\]/;

export function classifyUtExpectations(content: string): UtExpectationScan {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const entries: UtExpectationEntry[] = [];
  // `/* … */` 块注释内的行既不是声明、也不是标注（只认 `//` 行注释）。一个布尔状态位就够，
  // 仍然不做括号配平——否则「注释里误认一条 characterization + 漏认一条真实多行声明」会互相抵消，
  // 两道数量对账都相等，未登记的真实测试被呈现成「现状记录」（第二笔代码 review 必改 2 的反例）。
  const inBlockComment: boolean[] = [];
  // 注释边界可疑的行：声明**之前**的那段文本里**收掉过**一个块注释（含 `*/`）。
  // 只看声明之前、且只认 `*/`，两条都是判据本身要求的：
  //   · 只看之前——回调体里的普通块注释（`test('x', () => { /* 说明 */ … })`）在声明之后，
  //     放宽到整行会把正常测试判成无法分类（第三轮反例，characterization 直接回归）；
  //   · 只认 `*/`——`*/ test('x', …)` 后面跟的是**真代码**，行首规则却认不出，正是「漏认一条真的」
  //     那一半；而 `/*` 打头时后面那条声明本来就在注释里，漏认它是对的。放宽到 `/*` 会把
  //     `/** 覆盖 it( 的行为 */` 这类文档注释判成无法分类（两棵树里 11 条，全是这种）。
  const ambiguous: boolean[] = [];
  let block = false;
  for (const line of lines) {
    // 「这一行结束时注释是否还开着」看**最后**一个 `/*` 与最后一个 `*/` 的先后：
    // `/* 关了 */ /*` 这种同行先关后开，用 `indexOf('/*')` 判会得出「没开着」（第二轮反例①）。
    const opened = line.lastIndexOf('/*');
    const closed = line.lastIndexOf('*/');
    inBlockComment.push(block || (opened >= 0 && (closed < 0 || closed < opened)));
    const declaration = DECLARATION_ANYWHERE_RE.exec(line);
    const beforeDeclaration = declaration ? line.slice(0, declaration.index + declaration[1].length) : '';
    ambiguous.push(beforeDeclaration.includes('*/'));
    if (!block && opened >= 0 && (closed < 0 || closed < opened)) block = true;
    else if (block && closed >= 0) block = false;
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (ambiguous[index]) {
      entries.push({ name: `${lines[index].trim()}（注释边界可疑，无法可靠分类）`, form: lines[index].includes('test') ? 'test' : 'it', class: 'unclassifiable' });
      continue;
    }
    if (inBlockComment[index]) continue;
    // 行首起的声明、但名字不在同一行：**不静默丢弃**，记为无法分类（授权侧 BLOCKER / 只读侧 WARN）。
    if (DECLARATION_HEAD_RE.test(lines[index].trimEnd())) {
      entries.push({ name: `${lines[index].trim()}（名字不在同一行，无法分类）`, form: lines[index].includes('test') ? 'test' : 'it', class: 'unclassifiable' });
      continue;
    }
    const declaration = DECLARATION_RE.exec(lines[index]);
    if (!declaration) continue;
    const name = declaration[3];
    const entry: UtExpectationEntry = { name, form: declaration[1] as 'it' | 'test', class: 'unregistered' };
    // ① 紧邻上方的连续注释行块（中间隔空行或代码即断开）——注释里的来源比名字标签更具体，优先。
    for (let above = index - 1; above >= 0; above -= 1) {
      if (inBlockComment[above]) break;
      const comment = LINE_COMMENT_RE.exec(lines[above]);
      if (!comment) break;
      const body = comment[1].trim();
      const expectation = EXPECTATION_RE.exec(body);
      if (expectation) { entry.class = 'sourced'; entry.ref = expectation[1]; entry.ref_kind = 'path'; break; }
      if (CHARACTERIZATION_RE.test(body)) { entry.class = 'characterization'; break; }
    }
    // ② 断言名里的既有追溯标签（`check-ut.ts` 同一套词表）；**不继承** describe / 文件头的任何标注。
    if (entry.class === 'unregistered') {
      const trimmed = name.trim();
      if (CHARACTERIZATION_TAG_RE.test(trimmed)) entry.class = 'characterization';
      else {
        const tag = SOURCED_TAG_RE.exec(trimmed);
        if (tag) { entry.class = 'sourced'; entry.ref = tag[0]; entry.ref_kind = 'tag'; }
      }
    }
    entries.push(entry);
  }
  return { entries, parsed: entries.length, itFormCount: entries.filter(entry => entry.form === 'it').length };
}
