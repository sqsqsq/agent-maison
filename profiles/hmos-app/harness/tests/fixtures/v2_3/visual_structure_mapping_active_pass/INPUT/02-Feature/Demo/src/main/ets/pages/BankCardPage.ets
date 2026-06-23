@Entry
@Component
struct BankCardPage {
  build() {
    Column() {
      AddCardButton()
    }
  }
}

@Component
struct AddCardButton {
  build() {
    Button('x')
  }
}
