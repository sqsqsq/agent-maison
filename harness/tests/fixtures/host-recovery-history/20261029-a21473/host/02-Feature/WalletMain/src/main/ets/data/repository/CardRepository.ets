import { CardCategory } from '../model/CardCategory';

import { HomeConstants } from '../../shared/constant/HomeConstants';

export class CardRepository {
  async getCardCategories(): Promise<CardCategory[]> {
    return [
      {
        id: 'c1',
        name: '银行卡',
        description: '双击电源键便捷支付',
        icon: $r('sys.symbol.creditcard'),
        subtitleRes: $r('app.string.add_card_type_bank_subtitle')
      },
      {
        id: 'c2',
        name: '交通卡',
        description: '一张卡可刷全国',
        icon: $r('sys.symbol.map'),
        subtitleRes: $r('app.string.add_card_type_transit_subtitle')
      },
      {
        id: 'c3',
        name: '门禁卡',
        description: '手机就是门禁卡',
        icon: $r('sys.symbol.house'),
        subtitleRes: $r('app.string.add_card_type_access_subtitle')
      },
      {
        id: 'c4',
        name: '车钥匙',
        description: '手机秒变车钥匙',
        icon: $r('sys.symbol.car'),
        subtitleRes: $r('app.string.add_card_type_car_key_subtitle')
      },
      {
        id: 'c5',
        name: '证件',
        description: '随时随地查看证件',
        icon: $r('sys.symbol.person'),
        subtitleRes: $r('app.string.add_card_type_id_subtitle')
      }
    ];
  }

  async getNonLocalCardCount(): Promise<number> {
    return 0;
  }

  async hasLocalCards(): Promise<boolean> {
    return HomeConstants.SHOW_LOCAL_CARD_SECTION;
  }
}
