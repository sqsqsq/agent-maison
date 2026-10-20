import { BankInfo } from '../../data/model/BankInfo';
import { BankCardType } from '../../data/model/BankCardType';
import { OpenCardSessionParams } from '../../data/model/OpenCardSessionParams';
import { BankConstants } from '../../shared/constant/BankConstants';

@Component
export struct CardTypeSheet {
  @Prop bank: BankInfo;
  @State selectedType: BankCardType | null = null;
  onContinue: (params: OpenCardSessionParams) => void = (): void => {};
  onClose: () => void = (): void => {};

  selectType(type: BankCardType): void {
    if (this.bank.supportedCardTypes.indexOf(type) >= 0) {
      this.selectedType = type;
    }
  }

  handleContinue(): void {
    if (this.selectedType === null || this.bank.supportedCardTypes.indexOf(this.selectedType) < 0) {
      return;
    }
    const params: OpenCardSessionParams = {
      bankCode: this.bank.code, bankName: this.bank.name,
      bankCardType: this.selectedType, failureTargetName: BankConstants.ROUTE_ADD_BANK_CARD
    };
    this.onContinue(params);
  }

  build() {
    Column() {
      Row() {
        Text($r('app.string.card_type_title')).fontSize('22fp').fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.color_text_primary')).layoutWeight(1).id('ct_title')
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize('18fp')
            .fontColor([$r('app.color.color_text_primary')])
        }
        .width(44).height(44).backgroundColor($r('app.color.color_nav_btn_bg'))
        .accessibilityText($r('app.string.open_card_close')).id('ct_close')
        .onClick(() => this.onClose())
      }.width('100%').margin({ bottom: 24 })

      Column() {
        Row({ space: 12 }) {
          Image(this.bank.logo).width(32).height(32).objectFit(ImageFit.Contain)
          Text(this.bank.name).fontSize('18fp').fontColor($r('app.color.color_text_primary'))
        }.width('100%').height(64).padding({ left: 16, right: 16 }).id('ct_bank')
        Column() {
          ForEach(this.bank.supportedCardTypes, (type: BankCardType) => {
            Column() {
              Divider().color($r('app.color.color_line_divider')).strokeWidth(0.5)
              Row() {
                Text(type === BankCardType.DEBIT ? $r('app.string.card_type_debit') : $r('app.string.card_type_credit'))
                  .fontSize('18fp').fontColor($r('app.color.color_text_primary')).layoutWeight(1)
                Radio({ value: type, group: 'card_type' }).checked(this.selectedType === type)
                  .radioStyle({ checkedBackgroundColor: $r('app.color.brand_primary') })
                  .width(24).height(24).onChange((checked: boolean) => {
                    if (checked) { this.selectType(type); }
                  })
              }.height(60).width('100%').padding({ left: 16, right: 16 })
              .id(type === BankCardType.DEBIT ? 'ct_debit' : 'ct_credit')
              .onClick(() => this.selectType(type))
            }
          }, (type: BankCardType) => type)
        }.width('100%').id('ct_types')
      }.width('100%').backgroundColor($r('app.color.color_card_bg')).borderRadius(20).id('ct_bank_surface')

      Text($r('app.string.card_type_hint', this.bank.name)).fontSize('12fp')
        .fontColor($r('app.color.color_text_secondary')).width('100%').margin({ top: 16 }).id('ct_hint')
      Text($r('app.string.card_type_agreement')).fontSize('12fp')
        .fontColor($r('app.color.color_link_blue')).width('100%').margin({ top: 28, bottom: 24 }).id('ct_agreement')
      Button($r('app.string.card_type_continue')).fontSize('16fp').width('50%').height(44)
        .backgroundColor($r('app.color.brand_primary')).fontColor($r('app.color.color_card_bg'))
        .enabled(this.selectedType !== null).id('ct_continue').onClick(() => this.handleContinue())
    }.width('100%').padding({ left: 16, right: 16, top: 16, bottom: 28 })
    .backgroundColor($r('app.color.color_page_bg')).id('ct_root')
  }
}
