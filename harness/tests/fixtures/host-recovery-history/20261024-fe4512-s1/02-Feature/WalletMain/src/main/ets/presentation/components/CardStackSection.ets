import { AddManageCardsButton } from './AddManageCardsButton';

@Component
struct MockBankCard {
  @Prop label: ResourceStr = '';
  @Prop bankName: ResourceStr = '';
  @Prop cardColor: ResourceColor = $r('app.color.brand_primary');
  @Prop labelColor: ResourceColor = Color.White;
  @Prop marginTop: number = 0;
  @Prop marginLeft: number = 0;
  @Prop cardOpacity: number = 1;
  @Prop cardHeight: number = 96;
  @Prop cardWidth: string = '86%';

  build() {
    Column({ space: 4 }) {
      Text(this.bankName)
        .fontSize(11)
        .fontColor(this.labelColor)
        .fontWeight(FontWeight.Medium)
        .maxLines(1)
      Text(this.label)
        .fontSize(10)
        .fontColor(this.labelColor)
        .opacity(0.9)
        .maxLines(1)
    }
    .alignItems(HorizontalAlign.Start)
    .justifyContent(FlexAlign.End)
    .width(this.cardWidth)
    .height(this.cardHeight)
    .padding({ left: 12, right: 12, bottom: 10, top: 10 })
    .backgroundColor(this.cardColor)
    .borderRadius(12)
    .margin({ top: this.marginTop, left: this.marginLeft })
    .opacity(this.cardOpacity)
    .shadow({ radius: 6, color: '#1A000000', offsetY: 2 })
  }
}

@Component
export struct CardStackSection {
  onGoCardPack: () => void = () => {
  };

  build() {
    Column({ space: 12 }) {
      Stack({ alignContent: Alignment.TopStart }) {
        MockBankCard({
          bankName: $r('app.string.card_stack_mock_bank_access'),
          label: $r('app.string.card_stack_mock_label_access'),
          cardColor: $r('app.color.card_stack_access'),
          labelColor: $r('app.color.text_primary'),
          marginTop: 0,
          marginLeft: 0,
          cardOpacity: 0.85,
          cardHeight: 62,
          cardWidth: '94%'
        })
        MockBankCard({
          bankName: $r('app.string.card_stack_mock_bank_transit'),
          label: $r('app.string.card_stack_mock_label_transit'),
          cardColor: $r('app.color.card_stack_transit'),
          marginTop: 8,
          marginLeft: 0,
          cardOpacity: 0.88,
          cardHeight: 72,
          cardWidth: '96%'
        })
        MockBankCard({
          bankName: $r('app.string.card_stack_mock_bank_fund'),
          label: $r('app.string.card_stack_mock_label_fund'),
          cardColor: $r('app.color.card_stack_fund'),
          marginTop: 16,
          marginLeft: 0,
          cardOpacity: 0.92,
          cardHeight: 82,
          cardWidth: '98%'
        })
        MockBankCard({
          bankName: $r('app.string.card_stack_mock_bank_cmb'),
          label: $r('app.string.card_stack_mock_label_cmb'),
          cardColor: $r('app.color.card_stack_cmb'),
          marginTop: 26,
          marginLeft: 0,
          cardOpacity: 1,
          cardHeight: 94,
          cardWidth: '100%'
        })
      }
      .width('100%')
      .height(122)
      .onClick(() => {
        this.onGoCardPack();
      })

      Row() {
        Column({ space: 4 }) {
          Text($r('app.string.card_pack_section_title'))
            .fontSize(18)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'))
            .width('100%')
          Text($r('app.string.card_guide_subtitle'))
            .fontSize(13)
            .fontColor($r('app.color.text_secondary'))
            .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        AddManageCardsButton({
          onTap: (): void => {
            this.onGoCardPack();
          }
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding(16)
    .backgroundColor($r('app.color.bg_surface'))
    .borderRadius(12)
  }
}
