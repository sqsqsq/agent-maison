// Maison UI Kit — MaisonListCard（semantic_node: list_card_container）
// 白色圆角卡片容器 on 灰底——HarmonyOS 列表页标准形态（事故：盲档产出无容器"线框"UI）。
// variant: default（16 边距）| flush（贴边）。

@Component
export struct MaisonListCard {
  anchorId: string = '';
  flush: boolean = false;
  @BuilderParam contentSlot: () => void;

  build() {
    Column() {
      this.contentSlot()
    }
    .id(this.anchorId)
    .width(this.flush ? '100%' : 'calc(100% - 32vp)')
    .backgroundColor($r('sys.color.ohos_id_color_card_bg'))
    .borderRadius($r('sys.float.ohos_id_corner_radius_default_l'))
    .padding({ top: 4, bottom: 4 })
    .margin(this.flush ? {} : { left: 16, right: 16 })
    .clip(true)
  }
}
