import { BankInfo } from '../model/BankInfo';
import { BankCardType } from '../model/BankCardType';
import { MockBankCard } from '../model/MockBankCard';

export class BankRepository {
  /**
   * 20 家银行模拟数据（编译期常量），顺序 = 展开态参考图顺序。
   * 无网络 / 无 IPC / 无数据库，不读任何持久化介质（BD-6）。
   */
  async getBanks(): Promise<BankInfo[]> {
    return [
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'cmb',
        name: '招商银行',
        pinyin: 'zhaoshang',
        initial: 'Z',
        logo: $r('app.media.bank_logo_cmb')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'icbc',
        name: '工商银行',
        pinyin: 'gongshang',
        initial: 'G',
        logo: $r('app.media.bank_logo_icbc')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'citic',
        name: '中信银行',
        pinyin: 'zhongxin',
        initial: 'Z',
        logo: $r('app.media.bank_logo_citic')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'hxb',
        name: '华夏银行',
        pinyin: 'huaxia',
        initial: 'H',
        logo: $r('app.media.bank_logo_hxb'),
        badgeRes: $r('app.string.bank_badge_first_bind')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'ccb',
        name: '建设银行',
        pinyin: 'jianshe',
        initial: 'J',
        logo: $r('app.media.bank_logo_ccb')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'abc',
        name: '农业银行',
        pinyin: 'nongye',
        initial: 'N',
        logo: $r('app.media.bank_logo_abc')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'bocom',
        name: '交通银行',
        pinyin: 'jiaotong',
        initial: 'J',
        logo: $r('app.media.bank_logo_bocom')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'psbc',
        name: '邮储银行',
        pinyin: 'youchu',
        initial: 'Y',
        logo: $r('app.media.bank_logo_psbc')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'spdb',
        name: '浦发银行',
        pinyin: 'pufa',
        initial: 'P',
        logo: $r('app.media.bank_logo_spdb')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'cmbc',
        name: '民生银行',
        pinyin: 'minsheng',
        initial: 'M',
        logo: $r('app.media.bank_logo_cmbc')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'pab',
        name: '平安银行',
        pinyin: 'pingan',
        initial: 'P',
        logo: $r('app.media.bank_logo_pab')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'cgb',
        name: '广发银行',
        pinyin: 'guangfa',
        initial: 'G',
        logo: $r('app.media.bank_logo_cgb')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'cib',
        name: '兴业银行',
        pinyin: 'xingye',
        initial: 'X',
        logo: $r('app.media.bank_logo_cib')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'bosh',
        name: '上海银行',
        pinyin: 'shanghai',
        initial: 'S',
        logo: $r('app.media.bank_logo_bosh')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'bobj',
        name: '北京银行',
        pinyin: 'beijing',
        initial: 'B',
        logo: $r('app.media.bank_logo_bobj')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'bonj',
        name: '南京银行',
        pinyin: 'nanjing',
        initial: 'N',
        logo: $r('app.media.bank_logo_bonj')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'bonb',
        name: '宁波银行',
        pinyin: 'ningbo',
        initial: 'N',
        logo: $r('app.media.bank_logo_bonb')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'bogz',
        name: '广州银行',
        pinyin: 'guangzhou',
        initial: 'G',
        logo: $r('app.media.bank_logo_bogz')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'ceb',
        name: '光大银行',
        pinyin: 'guangda',
        initial: 'G',
        logo: $r('app.media.bank_logo_ceb')
      },
      {
        supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT],
        code: 'boc',
        name: '中国银行',
        pinyin: 'zhongguo',
        initial: 'Z',
        logo: $r('app.media.bank_logo_boc')
      }
    ];
  }
  async getMockCards(bankCode: string, cardType: BankCardType): Promise<MockBankCard[]> {
    const banks: BankInfo[] = await this.getBanks();
    const index: number = banks.findIndex((bank: BankInfo) => bank.code === bankCode);
    if (index < 0 || banks[index].supportedCardTypes.indexOf(cardType) < 0) {
      return [];
    }
    const bank: BankInfo = banks[index];
    const prefix: string = cardType === BankCardType.CREDIT ? '4392' : '6225';
    const cardNumber: string = `${prefix}${(index + 1).toString().padStart(8, '0')}2269`;
    return [{ cardNumber: cardNumber, bankCode: bank.code, bankName: bank.name, cardType: cardType }];
  }}
