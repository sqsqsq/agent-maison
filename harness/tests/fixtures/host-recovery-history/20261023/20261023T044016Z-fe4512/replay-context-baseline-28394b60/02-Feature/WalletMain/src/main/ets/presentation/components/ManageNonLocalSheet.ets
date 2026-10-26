@Component
export struct ManageNonLocalSheet {
  onClose: () => void = () => {
  };

  build() {
    Column() {
      Row() {
        Text($r('app.string.manage_non_local'))
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)

        SymbolGlyph($r('sys.symbol.xmark'))
          .fontSize(20)
          .fontColor([$r('app.color.text_primary')])
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')
      .padding({
        left: 16,
        right: 16,
        top: 16,
        bottom: 12
      })

      Column({ space: 16 }) {
        Image($r('app.media.empty_wallet_illustration'))
          .width(160)
          .height(160)
          .objectFit(ImageFit.Contain)
        Text($r('app.string.manage_sheet_empty_text'))
          .fontSize(15)
          .fontColor($r('app.color.text_secondary'))
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg_page'))
  }
}
