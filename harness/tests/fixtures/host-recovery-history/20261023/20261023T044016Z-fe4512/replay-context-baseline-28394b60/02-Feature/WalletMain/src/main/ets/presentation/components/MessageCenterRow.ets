import { Context } from '@kit.AbilityKit';
import { showToast } from '@aspect/CommUI';
import { MessageInfo } from '../../data/model/MessageInfo';

@Component
export struct MessageCenterRow {
  @Prop message: MessageInfo = {
    text: $r('app.string.msg_center_welcome'),
    showUnreadDot: false
  };

  build() {
    Row() {
      SymbolGlyph($r('sys.symbol.bell'))
        .fontSize(22)
        .fontColor([$r('app.color.text_secondary')])
        .margin({ right: 12 })

      if (this.message.timestamp !== undefined) {
        Text(this.message.text)
          .fontSize(15)
          .fontColor($r('app.color.text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text(this.message.timestamp)
          .fontSize(12)
          .fontColor($r('app.color.text_secondary'))
          .margin({ left: 8, right: 4 })
      } else {
        Text(this.message.text)
          .fontSize(15)
          .fontColor($r('app.color.text_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
      }

      if (this.message.showUnreadDot) {
        Circle({ width: 8, height: 8 })
          .fill($r('app.color.brand_danger'))
          .margin({ right: 8 })
      }

      SymbolGlyph($r('sys.symbol.chevron_right'))
        .fontSize(16)
        .fontColor([$r('app.color.text_tertiary')])
    }
    .width('100%')
    .padding({
      left: 16,
      right: 16,
      top: 14,
      bottom: 14
    })
    .backgroundColor($r('app.color.bg_surface'))
    .borderRadius(12)
    .onClick(() => {
      const ctx = this.getUIContext().getHostContext() as Context;
      showToast(ctx.resourceManager.getStringSync(this.message.text.id));
    })
  }
}
