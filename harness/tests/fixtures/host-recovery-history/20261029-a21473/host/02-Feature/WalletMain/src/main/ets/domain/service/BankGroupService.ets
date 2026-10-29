import { BankInfo } from '../../data/model/BankInfo';
import { BankGroup } from '../../data/model/BankGroup';

/** 银行分组与派生计算（纯函数，可脱离 UI 直接 UT） */
export class BankGroupService {
  /** 按 initial 升序分块、块内按 pinyin 升序；空输入返回长度 0 的数组（AC-16） */
  static groupByInitial(banks: BankInfo[]): BankGroup[] {
    const buckets: Map<string, BankInfo[]> = new Map<string, BankInfo[]>();
    for (const bank of banks) {
      const letter: string = bank.initial;
      const bucket: BankInfo[] | undefined = buckets.get(letter);
      if (bucket === undefined) {
        buckets.set(letter, [bank]);
      } else {
        bucket.push(bank);
      }
    }
    const letters: string[] = Array.from(buckets.keys()).sort();
    const groups: BankGroup[] = [];
    for (const letter of letters) {
      const list: BankInfo[] = (buckets.get(letter) as BankInfo[]).slice();
      list.sort((a: BankInfo, b: BankInfo) => a.pinyin < b.pinyin ? -1 : (a.pinyin > b.pinyin ? 1 : 0));
      groups.push({ letter: letter, banks: list });
    }
    return groups;
  }

  /** 索引字母 = 分块键序，与分组键集合逐一相等，天然不含空分块字母（BD-7） */
  static collectIndexLetters(groups: BankGroup[]): string[] {
    const letters: string[] = [];
    for (const group of groups) {
      letters.push(group.letter);
    }
    return letters;
  }

  /**
   * 收起态可见行数 = floor((可用高 - 药丸块高) / 行高)，clamp 到 [0, totalBanks]。
   * 参考视口 1320x2120 下结果为 7（AC-2）。
   */
  static calcVisibleRowCount(
    availableHeightVp: number,
    rowHeightVp: number,
    pillBlockHeightVp: number,
    totalBanks: number
  ): number {
    if (rowHeightVp <= 0 || totalBanks <= 0) {
      return 0;
    }
    const usable: number = availableHeightVp - pillBlockHeightVp;
    if (usable <= 0) {
      return 0;
    }
    const count: number = Math.floor(usable / rowHeightVp);
    if (count < 0) {
      return 0;
    }
    return count > totalBanks ? totalBanks : count;
  }

  /** 药丸小图标数 = min(maxIcons, totalBanks - visibleRowCount)，下限 0；为 0 时药丸整体不渲染（AC-3） */
  static calcPillIconCount(totalBanks: number, visibleRowCount: number, maxIcons: number): number {
    const rest: number = totalBanks - visibleRowCount;
    if (rest <= 0 || maxIcons <= 0) {
      return 0;
    }
    return rest > maxIcons ? maxIcons : rest;
  }
}
