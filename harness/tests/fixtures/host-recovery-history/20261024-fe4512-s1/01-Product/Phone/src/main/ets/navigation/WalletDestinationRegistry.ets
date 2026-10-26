const CARD_PACK_PAGE: string = 'CardPackPage';
const ADD_CARD_ENTRY_PAGE: string = 'AddCardEntryPage';
const ADD_BANK_CARD_PAGE: string = 'AddBankCardPage';
const ALL_BANKS_PAGE: string = 'AllBanksPage';
const BANK_CARD_SELECTION_PAGE: string = 'BankCardSelectionPage';
const BANK_CARD_OPENING_RESULT_PAGE: string = 'BankCardOpeningResultPage';

/** Phone 根 Navigation 实际消费的新旧钱包目的页集合。 */
export function walletDestinationNames(): string[] {
  return [
    CARD_PACK_PAGE,
    ADD_CARD_ENTRY_PAGE,
    ADD_BANK_CARD_PAGE,
    ALL_BANKS_PAGE,
    BANK_CARD_SELECTION_PAGE,
    BANK_CARD_OPENING_RESULT_PAGE
  ];
}

export function isWalletDestination(name: string): boolean {
  return walletDestinationNames().indexOf(name) >= 0;
}
