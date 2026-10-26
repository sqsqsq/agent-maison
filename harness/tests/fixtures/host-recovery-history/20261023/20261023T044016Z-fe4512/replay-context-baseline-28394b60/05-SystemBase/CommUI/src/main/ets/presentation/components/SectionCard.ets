@Component
export struct SectionCard {
  @BuilderParam content: () => void = this.defaultSlot;

  @Builder
  defaultSlot() {
    Column()
  }

  build() {
    Column() {
      this.content();
    }
    .width('100%')
    .padding(4)
    .backgroundColor($r('app.color.comm_bg_card'))
    .borderRadius(12)
  }
}
