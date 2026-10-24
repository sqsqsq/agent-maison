import { BankCardType } from '../../data/model/BankCardCandidate';
import { BankInfo } from '../../data/model/BankInfo';

@Component
export struct CardTypeSheet {
  @Prop bank: BankInfo;
  @State selectedType: BankCardType | null = null;
  onContinue: (bank: BankInfo, cardType: BankCardType) => void =
    (_bank: BankInfo, _cardType: BankCardType): void => {};
  onClose: () => void = (): void => {};

  aboutToAppear(): void {
    this.selectedType = this.bank.supportedCardTypes.length > 0 ? this.bank.supportedCardTypes[0] : null;
  }

  private selectCardType(cardType: BankCardType): void {
    this.selectedType = cardType;
  }

  private continueOpening(): void {
    if (this.selectedType === null) {
      return;
    }
    this.onContinue(this.bank, this.selectedType);
  }

  @Builder
  private cardTypeRow(cardType: BankCardType, text: Resource, elementId: string) {
    Row() {
      Text(text)
        .fontSize(16)
        .fontColor(this.selectedType === cardType
          ? $r('app.color.brand_primary')
          : $r('app.color.color_text_primary'))
        .layoutWeight(1)

      SymbolGlyph(this.selectedType === cardType
        ? $r('sys.symbol.checkmark_circle_fill')
        : $r('sys.symbol.circle'))
        .fontSize(22)
        .fontColor([this.selectedType === cardType
          ? $r('app.color.brand_primary')
          : $r('app.color.color_text_secondary')])
    }
    .width('100%')
    .height(52)
    .padding({ left: 16, right: 16 })
    .id(elementId)
    .onClick(() => {
      this.selectCardType(cardType);
    })
  }

  build() {
    Column() {
      Row() {
        Text($r('app.string.card_type_sheet_title'))
          .fontSize($r('app.float.bank_font_page_title'))
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.color_text_primary'))
          .layoutWeight(1)
          .id('card_type_sheet_title')

        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(18)
            .fontColor([$r('app.color.color_text_primary')])
        }
        .width(36)
        .height(36)
        .justifyContent(FlexAlign.Center)
        .backgroundColor($r('app.color.color_nav_btn_bg'))
        .borderRadius(18)
        .id('card_type_sheet_close')
        .onClick(() => {
          this.onClose();
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Column() {
        Row() {
          Image(this.bank.logo)
            .width(34)
            .height(34)
            .objectFit(ImageFit.Contain)
            .margin({ right: 12 })
          Text(this.bank.name)
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.color_text_primary'))
        }
        .width('100%')
        .height(56)
        .padding({ left: 16, right: 16 })
        .id('card_type_bank_row')

        if (this.bank.supportedCardTypes.indexOf(BankCardType.DEBIT) >= 0) {
          this.cardTypeRow(BankCardType.DEBIT, $r('app.string.bank_card_type_debit'), 'debit_card_row')
        }
        if (this.bank.supportedCardTypes.indexOf(BankCardType.CREDIT) >= 0) {
          this.cardTypeRow(BankCardType.CREDIT, $r('app.string.bank_card_type_credit'), 'credit_card_row')
        }
      }
      .width('100%')
      .backgroundColor($r('app.color.color_card_bg'))
      .borderRadius($r('app.float.bank_radius_card'))
      .margin({ top: 18 })
      .id('card_type_bank_card')

      Text($r('app.string.card_type_authorization', this.bank.name))
        .fontSize(13)
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
        .margin({ top: 14 })
        .id('card_type_authorization_copy')

      Text($r('app.string.card_type_agreement'))
        .fontSize(13)
        .fontColor($r('app.color.brand_primary'))
        .width('100%')
        .margin({ top: 12 })
        .id('card_type_agreement_copy')

      Button($r('app.string.card_type_continue'))
        .enabled(this.selectedType !== null)
        .width('50%')
        .height(46)
        .fontSize(16)
        .fontColor(Color.White)
        .backgroundColor(this.selectedType === null
          ? $r('app.color.button_tonal_bg')
          : $r('app.color.brand_primary'))
        .margin({ top: 20, bottom: 16 })
        .id('card_type_continue_btn')
        .onClick(() => {
          this.continueOpening();
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 18 })
    .alignItems(HorizontalAlign.Center)
    .backgroundColor($r('app.color.color_page_bg'))
    .id('card_type_sheet_panel')
  }
}
