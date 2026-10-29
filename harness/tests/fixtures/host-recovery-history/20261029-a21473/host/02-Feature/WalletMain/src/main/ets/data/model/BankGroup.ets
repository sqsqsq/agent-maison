import { BankInfo } from './BankInfo';

/** 全部银行页面的一个首字母分块 */
export interface BankGroup {
  /** 分块字母（大写单字符），如 'G' */
  letter: string;
  /** 该块内的银行，按 pinyin 升序 */
  banks: BankInfo[];
}
