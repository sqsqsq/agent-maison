import { BankListItem } from './BankListItem';
import { BankRepository } from './BankRepository';

@Component
export struct AllBanksPage {
  @State banks: string[] = new BankRepository().list();
  @State sheetVisible: boolean = false;

  @Builder
  openCardSheet() {
    Column() {
      Text('开卡申请').id('open_card_title')
    }
  }

  sheetTag(phase: string): string {
    return `${phase}`;
  }

  build() {
    Column() {
      Text("全部银行")
      ForEach(this.banks, (b: string) => {
        BankListItem({ bank: { id: b, name: b } })
          .onClick(() => { this.sheetVisible = true; })
      })
    }
    .bindSheet($$this.sheetVisible, this.openCardSheet(), {
      title: { title: this.sheetTag('open_card') },
    })
  }
}
