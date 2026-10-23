/** 单家银行的展示数据（模拟数据，来源见 BankRepository） */
export interface BankInfo {
  /** 银行短码，同时是 element id 后缀与 logo 资源键后缀，如 'cmb' */
  code: string;
  /** 银行显示名，如 '招商银行' */
  name: string;
  /** 汉语拼音全拼小写，用于块内升序排序，如 'zhaoshang' */
  pinyin: string;
  /** 拼音首字母大写，用于分块与字母索引，如 'Z' */
  initial: string;
  /** 品牌 logo 资源 */
  logo: Resource;
  /** 营销角标文案资源；无角标时为 undefined */
  badgeRes?: Resource;
}
