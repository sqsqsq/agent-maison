import { AddManageCardsButton } from './AddManageCardsButton';

@Component
export struct CardGuideSection {
  onGoCardPack: () => void = () => {
  };

  build() {
    Column() {
      Stack() {
        Image($r('app.media.card_pack_intro_illustration'))
          .width('132%')
          .height('132%')
          .objectFit(ImageFit.Cover)
      }
      .width('100%')
      .height(192)
      .alignContent(Alignment.Center)
      .clip(true)
      .backgroundColor($r('app.color.bg_page'))

      Divider()
        .color('#E8E8E8')
        .strokeWidth(1)

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
      .padding({ left: 16, right: 16, top: 12, bottom: 16 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => {
        this.onGoCardPack();
      })
    }
    .width('100%')
    .backgroundColor($r('app.color.bg_surface'))
    .borderRadius(12)
    .clip(true)
  }
}
