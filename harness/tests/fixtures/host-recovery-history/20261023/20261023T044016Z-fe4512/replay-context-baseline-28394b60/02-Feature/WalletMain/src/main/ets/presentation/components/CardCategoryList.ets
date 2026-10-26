import { Context } from '@kit.AbilityKit';
import { Logger, NavPathContext } from '@aspect/CommFunc';
import { showToast } from '@aspect/CommUI';
import { CardCategory } from '../../data/model/CardCategory';
import { BankConstants } from '../../shared/constant/BankConstants';

@Component
export struct CardCategoryList {
  @Prop categories: CardCategory[] = [];
  private lastNavAtMs: number = 0;

  /** 卡种行的 element id（device 断言锚点，与 ui-spec 一致） */
  private elementIdFor(item: CardCategory): string {
    if (item.id === 'c1') {
      return 'ac_bank_card_row';
    }
    if (item.id === 'c2') {
      return 'ac_transit_card_row';
    }
    if (item.id === 'c3') {
      return 'ac_access_card_row';
    }
    if (item.id === 'c4') {
      return 'ac_car_key_row';
    }
    return 'ac_id_card_row';
  }

  /** 「银行卡」行进添加银行卡页面；其余卡种维持「暂不支持」提示 */
  private handleCategoryTap(item: CardCategory): void {
    if (item.id === 'c1') {
      // 入栈防重入窗口（BD-3），与 AddBankCardPage.handleViewAllBanks 同构
      const now: number = Date.now();
      if (now - this.lastNavAtMs < BankConstants.NAV_DEBOUNCE_MS) {
        return;
      }
      this.lastNavAtMs = now;
      try {
        NavPathContext.stack().pushPath({ name: BankConstants.ROUTE_ADD_BANK_CARD });
      } catch (err) {
        Logger.error(BankConstants.LOG_TAG, 'push AddBankCardPage failed');
        // 取栈异常须提示（BD-4）
        const navCtx = this.getUIContext().getHostContext() as Context;
        showToast(navCtx.resourceManager.getStringSync($r('app.string.bank_nav_failed').id));
      }
      return;
    }
    const ctx = this.getUIContext().getHostContext() as Context;
    showToast(ctx.resourceManager.getStringSync($r('app.string.not_supported').id));
  }

  private subtitleResFor(item: CardCategory): Resource {
    if (item.id === 'c1') {
      return $r('app.string.add_card_type_bank_subtitle');
    }
    if (item.id === 'c2') {
      return $r('app.string.add_card_type_transit_subtitle');
    }
    if (item.id === 'c3') {
      return $r('app.string.add_card_type_access_subtitle');
    }
    if (item.id === 'c4') {
      return $r('app.string.add_card_type_car_key_subtitle');
    }
    if (item.id === 'c5') {
      return $r('app.string.add_card_type_id_subtitle');
    }
    return $r('app.string.add_card_type_bank_subtitle');
  }

  private iconColorFor(item: CardCategory): Resource {
    if (item.id === 'c1' || item.id === 'c3') {
      return $r('app.color.brand_bank_orange');
    }
    if (item.id === 'c4') {
      return $r('app.color.brand_fuel_green');
    }
    if (item.id === 'c5') {
      return $r('app.color.brand_id_yellow');
    }
    return $r('app.color.brand_primary');
  }

  build() {
    Column() {
      ForEach(this.categories, (item: CardCategory, index: number) => {
        Column() {
          Row() {
            SymbolGlyph(item.icon)
              .fontSize(22)
              .fontColor([this.iconColorFor(item)])
              .margin({ right: 12 })
            Text(item.name)
              .fontSize(16)
              .fontColor($r('app.color.text_primary'))
              .layoutWeight(1)
            Text(this.subtitleResFor(item))
              .fontSize(12)
              .fontColor($r('app.color.text_secondary'))
              .margin({ right: 8 })
            SymbolGlyph($r('sys.symbol.chevron_right'))
              .fontSize(16)
              .fontColor([$r('app.color.text_secondary')])
          }
          .width('100%')
          .padding({
            left: 16,
            right: 16,
            top: 14,
            bottom: 14
          })
          .id(this.elementIdFor(item))
          .onClick(() => {
            this.handleCategoryTap(item);
          })

          if (index < this.categories.length - 1) {
            Divider()
              .color($r('app.color.text_tertiary'))
              .strokeWidth(0.5)
              .margin({ left: 16, right: 16 })
          }
        }
      }, (item: CardCategory) => item.id)
    }
    .width('100%')
    .backgroundColor($r('app.color.bg_surface'))
    .borderRadius(12)
  }
}
