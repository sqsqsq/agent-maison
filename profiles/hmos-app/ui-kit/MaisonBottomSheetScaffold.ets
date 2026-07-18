// Maison UI Kit — MaisonBottomSheetScaffold（semantic_node: sheet_scaffold）
// 半模态脚手架：标题 + 右上关闭圆钮 + 内容 slot + 底部主操作 slot。
// 事故形态：盲档半模态无关闭钮、按钮呈禁用态淡蓝——本 block 结构强制关闭钮，
// 主操作按钮请配 MaisonPrimaryButton（enabled/disabled 状态色分支）。

@Component
export struct MaisonBottomSheetScaffold {
  anchorId: string = '';
  title: ResourceStr = '';
  onClose?: () => void;
  @BuilderParam contentSlot: () => void;
  @BuilderParam primaryActionSlot?: () => void;

  build() {
    Column() {
      Row() {
        Text(this.title)
          .id(`${this.anchorId}-header`)
          .fontSize($r('sys.float.ohos_id_text_size_headline8'))
          .fontWeight(FontWeight.Bold)
          .fontColor($r('sys.color.ohos_id_color_text_primary'))
        Blank()
        Button() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize($r('sys.float.ohos_id_text_size_body1'))
            .fontColor([$r('sys.color.ohos_id_color_text_secondary')])
        }
        .id(`${this.anchorId}-close`)
        .type(ButtonType.Circle)
        .backgroundColor($r('sys.color.ohos_id_color_button_normal'))
        .width(36)
        .height(36)
        .onClick(() => this.onClose?.())
      }
      .width('100%')
      .padding({ left: 24, right: 16, top: 16, bottom: 8 })

      Column() {
        this.contentSlot()
      }
      .id(`${this.anchorId}-content`)
      .width('100%')
      .layoutWeight(1)

      if (this.primaryActionSlot) {
        Column() {
          this.primaryActionSlot()
        }
        .id(`${this.anchorId}-primary-action`)
        .width('100%')
        .padding({ left: 24, right: 24, top: 8, bottom: 24 })
      }
    }
    .id(this.anchorId)
    .width('100%')
    .backgroundColor($r('sys.color.ohos_id_color_dialog_bg'))
    .borderRadius({
      topLeft: $r('sys.float.ohos_id_corner_radius_dialog'),
      topRight: $r('sys.float.ohos_id_corner_radius_dialog'),
    })
  }
}
