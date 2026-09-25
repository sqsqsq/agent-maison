import { BankModel } from './BankModel';

@Component
export struct BankListItem {
  @Prop bank: BankModel;
  build() {
    Text(this.bank.name).id('bank_row_cmb')
  }
}
