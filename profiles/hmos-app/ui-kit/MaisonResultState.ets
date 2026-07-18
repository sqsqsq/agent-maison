// Maison UI Kit — MaisonResultState（semantic_node: result_state）
// 结果页状态块：状态图标 + 标题 + 提示 slot + 操作 slot。
// variant: success | failure——图标/颜色**必须**分支（事故 CR-006：失败图标与成功相同）。
// 插画 slot 缺素材 → illustration_frame 占位（generateRolePlaceholder），禁空白。

@Component
export struct MaisonResultState {
  anchorId: string = '';
  success: boolean = true;
  title: ResourceStr = '';
  @BuilderParam hintSlot?: () => void;
  @BuilderParam actionSlot?: () => void;

  build() {
    Column() {
      SymbolGlyph(
        this.success ? $r('sys.symbol.checkmark_circle_fill') : $r('sys.symbol.xmark_circle_fill'),
      )
        .id(`${this.anchorId}-icon`)
        .fontSize(64)
        .fontColor([
          this.success
            ? $r('sys.color.ohos_id_color_connected')
            : $r('sys.color.ohos_id_color_warning'),
        ])
      Text(this.title)
        .id(`${this.anchorId}-title`)
        .fontSize($r('sys.float.ohos_id_text_size_headline7'))
        .fontWeight(FontWeight.Bold)
        .fontColor($r('sys.color.ohos_id_color_text_primary'))
        .margin({ top: 16 })
      if (this.hintSlot) {
        Column() {
          this.hintSlot()
        }
        .id(`${this.anchorId}-hint`)
        .margin({ top: 8 })
      }
      if (this.actionSlot) {
        Column() {
          this.actionSlot()
        }
        .id(`${this.anchorId}-action`)
        .width('100%')
        .margin({ top: 32 })
      }
    }
    .id(this.anchorId)
    .width('100%')
    .alignItems(HorizontalAlign.Center)
    .padding({ top: 48, left: 24, right: 24 })
  }
}
