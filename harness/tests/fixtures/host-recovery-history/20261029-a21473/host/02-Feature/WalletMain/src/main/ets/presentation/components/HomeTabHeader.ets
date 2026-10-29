@Component
export struct HomeTabHeader {
  onAddCard: () => void = () => {
  };
  onTitleTap: () => void = () => {
  };

  build() {
    Row() {
      Text($r('app.string.home_title'))
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.text_primary'))
        .layoutWeight(1)
        .onClick(() => {
          this.onTitleTap();
        })

      SymbolGlyph($r('sys.symbol.plus'))
        .fontSize(24)
        .fontColor([$r('app.color.brand_primary')])
        .onClick(() => {
          this.onAddCard();
        })
    }
    .width('100%')
    .padding({
      left: 16,
      right: 16,
      top: 12,
      bottom: 8
    })
  }
}
