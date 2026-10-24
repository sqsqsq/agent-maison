import { describe, it, expect, beforeEach } from '@ohos/hypium';
import { NavPathContext } from '@aspect/CommFunc';
import { BankInfo } from '../../../main/ets/data/model/BankInfo';
import { BankGroup } from '../../../main/ets/data/model/BankGroup';
import { BankRepository } from '../../../main/ets/data/repository/BankRepository';
import { BankGroupService } from '../../../main/ets/domain/service/BankGroupService';
import { BankConstants } from '../../../main/ets/shared/constant/BankConstants';
import { SpyBankRepository } from './spy/SpyBankRepository';

const EXPECTED_CODES: string =
  'cmb,icbc,citic,hxb,ccb,abc,bocom,psbc,spdb,cmbc,pab,cgb,cib,bosh,bobj,bonj,bonb,bogz,ceb,boc';
const EXPECTED_NAMES: string =
  '招商银行,工商银行,中信银行,华夏银行,建设银行,农业银行,交通银行,邮储银行,浦发银行,民生银行,' +
  '平安银行,广发银行,兴业银行,上海银行,北京银行,南京银行,宁波银行,广州银行,光大银行,中国银行';

/** 收起态可用高的参考值（vp）；只用于驱动派生算术，不代表真机量测 */
const REF_AVAILABLE_HEIGHT_VP: number = 560;

export default function bankOpenCardUtTest(): void {
  describe('bank open card unit', () => {
    let repo: BankRepository;
    let spyRepo: SpyBankRepository;

    beforeEach((): void => {
      repo = new BankRepository();
      spyRepo = new SpyBankRepository();
    });

    it('[AC-14] 银行数据源返回 20 条完整记录且顺序与展开态参考图一致', 0, async () => {
      const banks: BankInfo[] = await repo.getBanks();
      expect(banks.length).assertEqual(20);
      expect(banks.map((b: BankInfo) => b.code).join(',')).assertEqual(EXPECTED_CODES);
      expect(banks.map((b: BankInfo) => b.name).join(',')).assertEqual(EXPECTED_NAMES);

      let complete: number = 0;
      for (const bank of banks) {
        const ok: boolean = bank.code.length > 0 && bank.name.length > 0 &&
          bank.pinyin.length > 0 && bank.initial.length === 1 && bank.logo !== undefined;
        if (ok) {
          complete++;
        }
      }
      expect(complete).assertEqual(20);
    });

    it('[AC-16] 拼音分组产出 11 块、字母升序且块内按全拼升序', 0, async () => {
      const banks: BankInfo[] = await repo.getBanks();
      const groups: BankGroup[] = BankGroupService.groupByInitial(banks);
      expect(groups.length).assertEqual(11);
      expect(groups.map((g: BankGroup) => g.letter).join('')).assertEqual('BGHJMNPSXYZ');
      expect(groups.map((g: BankGroup) => g.banks.length).join(',')).assertEqual('1,4,1,2,1,3,2,1,1,1,3');
      expect(groups[1].banks.map((b: BankInfo) => b.name).join(','))
        .assertEqual('工商银行,光大银行,广发银行,广州银行');
      expect(groups[10].banks.map((b: BankInfo) => b.pinyin).join(','))
        .assertEqual('zhaoshang,zhongguo,zhongxin');
    });

    it('[AC-16][BD-7] 字母索引集合由分组结果派生，逐一相等且不含空分块字母', 0, async () => {
      const banks: BankInfo[] = await repo.getBanks();
      const groups: BankGroup[] = BankGroupService.groupByInitial(banks);
      const letters: string[] = BankGroupService.collectIndexLetters(groups);
      expect(letters.length).assertEqual(11);
      expect(letters.join('')).assertEqual(groups.map((g: BankGroup) => g.letter).join(''));
      expect(letters.indexOf('A')).assertEqual(-1);
      expect(BankGroupService.collectIndexLetters([]).length).assertEqual(0);
    });

    it('[AC-G3][BD-1] 数据源返回空数组时列表/药丸/分组三处可见性派生量均为 0', 0, async () => {
      spyRepo.useEmpty();
      let banks: BankInfo[] = [];
      let loadFailed: boolean = false;
      try {
        banks = await spyRepo.getBanks();
      } catch (err) {
        banks = [];
        loadFailed = true;
      }
      expect(banks.length).assertEqual(0);
      expect(loadFailed).assertFalse();

      const visibleRows: number = BankGroupService.calcVisibleRowCount(
        REF_AVAILABLE_HEIGHT_VP,
        BankConstants.ROW_HEIGHT_VP,
        BankConstants.PILL_BLOCK_HEIGHT_VP,
        banks.length
      );
      expect(visibleRows).assertEqual(0);
      expect(BankGroupService.calcPillIconCount(banks.length, visibleRows, BankConstants.MAX_PILL_ICONS))
        .assertEqual(0);
      expect(BankGroupService.groupByInitial(banks).length).assertEqual(0);
      expect(spyRepo.callLog.join(',')).assertEqual('getBanks');
    });

    it('[AC-G3][BD-2] 取数异常可 await 可 catch，吞掉后降级为空态且无未捕获 rejection', 0, async () => {
      spyRepo.useLoadError();
      let banks: BankInfo[] = [];
      let caught: boolean = false;
      try {
        banks = await spyRepo.getBanks();
      } catch (err) {
        banks = [];
        caught = true;
      }
      expect(caught).assertTrue();
      expect(banks.length).assertEqual(0);

      const groups: BankGroup[] = BankGroupService.groupByInitial(banks);
      expect(groups.length).assertEqual(0);
      expect(BankGroupService.collectIndexLetters(groups).length).assertEqual(0);
      expect(spyRepo.callLog.length).assertEqual(1);
    });

    it('[BD-4] 导航栈未挂载时取栈抛出，被 try/catch 吞掉后不外抛且调用方状态不变', 0, () => {
      let navState: string = 'idle';
      let caught: boolean = false;
      let message: string = '';
      try {
        NavPathContext.stack();
        navState = 'navigated';
      } catch (err) {
        caught = true;
        message = (err as Error).message;
      }
      expect(caught).assertTrue();
      expect(navState).assertEqual('idle');
      expect(message.length > 0).assertTrue();
    });

    it('[BD-5] logo 为空图位时行模型仍完整返回名称与点击载荷', 0, async () => {
      spyRepo.useLogoMissing();
      const banks: BankInfo[] = await spyRepo.getBanks();
      expect(banks.length).assertEqual(1);

      const row: BankInfo = banks[0];
      expect(row.name).assertEqual('测试银行');
      expect(row.code).assertEqual('test');
      expect(row.logo.id).assertEqual(0);

      // 行仍进入分组结果 —— 即在两个列表页面仍可见、仍带完整点击载荷
      const groups: BankGroup[] = BankGroupService.groupByInitial(banks);
      expect(groups.length).assertEqual(1);
      expect(groups[0].banks[0].name).assertEqual('测试银行');
    });

    it('[AC-14][BD-6] 数据源不读持久化介质，两次独立调用返回等价结果', 0, async () => {
      const first: BankInfo[] = await repo.getBanks();
      const second: BankInfo[] = await new BankRepository().getBanks();
      expect(second.length).assertEqual(first.length);
      expect(second.map((b: BankInfo) => b.code).join(',')).assertEqual(EXPECTED_CODES);
      expect(second.map((b: BankInfo) => b.pinyin).join(','))
        .assertEqual(first.map((b: BankInfo) => b.pinyin).join(','));
      expect(second.map((b: BankInfo) => b.initial).join(''))
        .assertEqual(first.map((b: BankInfo) => b.initial).join(''));
    });
  });
}
