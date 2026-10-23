import { BankInfo } from '../../../../main/ets/data/model/BankInfo';
import { BankRepository } from '../../../../main/ets/data/repository/BankRepository';

/**
 * BankRepository 子类替身，与 doc/features/bc-openCard-1/ut/mock-plan.yaml > spies[0] 1:1。
 * 三个 preset：banks_empty / banks_load_error / banks_logo_missing。
 * Spy 内不写任何业务判断，只做 preset 回放与调用记录。
 */
export class SpyBankRepository extends BankRepository {
  /** 调用序列追溯 */
  callLog: string[] = [];
  private preset: string = 'banks_empty';
  private payload: BankInfo[] = [];

  /** preset: banks_empty —— 返回空数组 */
  useEmpty(): void {
    this.preset = 'banks_empty';
    this.payload = [];
  }

  /** preset: banks_load_error —— 抛出取数异常 */
  useLoadError(): void {
    this.preset = 'banks_load_error';
    this.payload = [];
  }

  /** preset: banks_logo_missing —— 返回一条 logo 为空图位的记录 */
  useLogoMissing(): void {
    const item: BankInfo = {
      code: 'test',
      name: '测试银行',
      pinyin: 'ceshi',
      initial: 'C',
      logo: { bundleName: '', moduleName: '', id: 0 } as Resource
    };
    this.preset = 'banks_logo_missing';
    this.payload = [item];
  }

  async getBanks(): Promise<BankInfo[]> {
    this.callLog.push('getBanks');
    if (this.preset === 'banks_load_error') {
      throw new Error('bank load failed');
    }
    return this.payload;
  }
}
