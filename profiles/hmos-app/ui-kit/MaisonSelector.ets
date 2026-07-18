// Maison UI Kit — MaisonSelector（semantic_node: selector_group）
// 单选/多选列表：纵向选项行 + 右侧选中态圆形指示（SymbolGlyph，无位图依赖）。
// 事故形态：盲档 radio 横排且无选中态视觉——本 block 纵排 + 明确 activated 色。

export interface MaisonSelectorOption {
  key: string;
  label: ResourceStr;
}

@Component
export struct MaisonSelector {
  anchorId: string = '';
  options: MaisonSelectorOption[] = [];
  @Prop selectedKey: string = '';
  onSelect?: (key: string) => void;

  build() {
    Column() {
      ForEach(this.options, (opt: MaisonSelectorOption, idx: number) => {
        Column() {
          Row() {
            Text(opt.label)
              .fontSize($r('sys.float.ohos_id_text_size_body1'))
              .fontColor($r('sys.color.ohos_id_color_text_primary'))
            Blank()
            if (this.selectedKey === opt.key) {
              SymbolGlyph($r('sys.symbol.checkmark_circle_fill'))
                .fontSize(22)
                .fontColor([$r('sys.color.ohos_id_color_activated')])
            } else {
              SymbolGlyph($r('sys.symbol.circle'))
                .fontSize(22)
                .fontColor([$r('sys.color.ohos_id_color_tertiary')])
            }
          }
          .id(`${this.anchorId}-option-${opt.key}`)
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
          .onClick(() => this.onSelect?.(opt.key))

          if (idx < this.options.length - 1) {
            Divider()
              .strokeWidth('1px')
              .color($r('sys.color.ohos_id_color_list_separator'))
          }
        }
        .width('100%')
      }, (opt: MaisonSelectorOption) => opt.key)
    }
    .id(this.anchorId)
    .width('100%')
  }
}
