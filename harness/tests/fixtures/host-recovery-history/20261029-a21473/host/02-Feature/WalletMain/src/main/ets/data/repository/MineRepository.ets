import { FinanceEntry } from '../model/FinanceEntry';
import { SettingEntry } from '../model/SettingEntry';

export class MineRepository {
  async getFinanceEntries(): Promise<FinanceEntry[]> {
    return [
      { id: 'f1', name: '华为支付', icon: $r('sys.symbol.wallet'), trailing: '¥119.40' },
      { id: 'f2', name: '银行电子账户', icon: $r('sys.symbol.creditcard') },
      { id: 'f3', name: '银行卡交易记录', icon: $r('sys.symbol.doc_text') },
      { id: 'f4', name: '交通卡退款记录', icon: $r('sys.symbol.map') }
    ];
  }

  async getSettingEntries(): Promise<SettingEntry[]> {
    return [
      { id: 'st1', name: '设置', icon: $r('sys.symbol.gearshape') },
      { id: 'st2', name: '帮助和反馈', icon: $r('sys.symbol.questionmark_circle') }
    ];
  }
}
