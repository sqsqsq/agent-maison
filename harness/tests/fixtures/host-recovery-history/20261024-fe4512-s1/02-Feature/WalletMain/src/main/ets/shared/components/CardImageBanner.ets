@Component
export struct CardImageBanner {
  onTap: () => void = () => {
  };

  build() {
    Column() {
      Text($r('app.string.card_guide_subtitle'))
        .fontSize(14)
        .fontColor($r('app.color.wallet_text_primary'))
        .textAlign(TextAlign.Center)
        .padding(16)
    }
    .justifyContent(FlexAlign.Center)
    .width('100%')
    .height($r('app.float.guide_banner_height'))
    .backgroundColor($r('app.color.home_banner_end'))
    .borderRadius(16)
    .onClick(() => {
      this.onTap();
    })
  }
}
