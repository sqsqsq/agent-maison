// Executable development projection of the preserved bank-card request, not a HarmonyOS UI.
export interface Bank { code: string; name: string; supportedTypes: string[] }
export interface BankCard {
  fullCardNumber: string; category: string; bankName: string; bankCardType: string; addedAt: number;
  huaweiPayStatus: string; unionPayStatus: string; transactions: string;
}
export interface Store { saveCard(card: BankCard): Promise<{ success: boolean }>; listCards(): Promise<BankCard[]> }
export interface Navigation {
  pushPath(path: { name: string; param?: unknown }): void;
  popToIndex(index: number): void;
  getAllPathName(): string[];
}
export function createMockCards(bank: Bank, type: string, now: number): BankCard[] {
  const issuer = [...bank.code].reduce((value, char) => value + char.charCodeAt(0), 0).toString().padStart(4, '0');
  return [1, 2].map(index => ({ fullCardNumber: '6222' + issuer + (type === 'credit' ? '2' : '1') + '000' + String(index).padStart(4, '0'),
    category: 'bank', bankName: bank.name, bankCardType: type, addedAt: now, huaweiPayStatus: 'disabled', unionPayStatus: 'disabled', transactions: '[]' }));
}
export class HomeLaunchBridge {
  private pending: string | undefined;
  private listeners = new Set<() => void>();
  publishAddedCard(value: string): void { this.pending = value; for (const listener of this.listeners) listener(); }
  consumeAddedCard(): string | undefined { const value = this.pending; this.pending = undefined; return value; }
  subscribeAddedCard(listener: () => void): void { this.listeners.add(listener); listener(); }
  unsubscribeAddedCard(listener: () => void): void { this.listeners.delete(listener); }
}
export class HomeProjection {
  cards: BankCard[] = [];
  error = '';
  private sequence = 0;
  constructor(private store: Store) {}
  async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    try { const cards = await this.store.listCards(); if (sequence === this.sequence) { this.cards = cards; this.error = ''; } }
    catch (error) { if (sequence === this.sequence) this.error = String(error); }
  }
}
export class OpenCardFlow {
  bank?: Bank;
  type?: string;
  card?: BankCard;
  agreed = false;
  phone = '';
  code = '';
  deadline = 0;
  submitting = false;
  result?: { fullCardNumber: string; success: boolean };
  private entryIndex = -1;
  private generation = 0;
  constructor(private store: Store, private stack: Navigation, private bridge: HomeLaunchBridge,
    private now: () => number, private readPhone: () => Promise<string>, private readCards?: (bankId: string, type: string) => BankCard[]) {}
  get state() { return { phase: this.submitting ? 'Saving' : this.result ? (this.result.success ? 'Success' : 'Failed')
    : this.card ? 'WaitingOtp' : this.type ? 'SelectingCard' : this.bank ? 'SelectingType' : 'Idle',
    fullCardNumber: this.result?.fullCardNumber ?? this.card?.fullCardNumber ?? '', remainingSeconds: this.remaining(), success: this.result?.success ?? false }; }
  selectBank(bank: Bank, entry: 'AddBankCardPage' | 'AllBanksPage' = 'AddBankCardPage'): void { this.enter(bank, entry); }
  selectCard(card: BankCard): Promise<boolean> { return this.openOtp(card); }
  finish(): boolean { return this.complete(); }
  reenter(): void { if (!this.submitting && !this.result) this.stack.pushPath({ name: 'AddCardEntryPage' }); }
  enter(bank: Bank, entry: 'AddBankCardPage' | 'AllBanksPage'): void {
    if (this.submitting) return;
    this.bank = bank; this.type = undefined; this.card = undefined; this.agreed = false;
    this.entryIndex = this.stack.getAllPathName().lastIndexOf('AddCardEntryPage');
    if (this.entryIndex < 0) { this.stack.pushPath({ name: 'AddCardEntryPage' }); this.entryIndex = this.stack.getAllPathName().length - 1; }
    if (this.stack.getAllPathName().at(-1) !== entry) this.stack.pushPath({ name: entry });
  }
  selectType(type: string): boolean {
    if (!this.bank?.supportedTypes.includes(type)) return false;
    this.type = type;
    this.stack.pushPath({ name: 'BankCardSelectionPage', param: { bankId: this.bank.code, bankName: this.bank.name, cardType: type } });
    return true;
  }
  cards(): BankCard[] {
    if (!this.bank || !this.type) return [];
    return this.readCards ? this.readCards(this.bank.code, this.type) : createMockCards(this.bank, this.type, this.now());
  }
  mask(card: BankCard): string { return card.fullCardNumber.slice(0, 4) + ' **** **** ' + card.fullCardNumber.slice(-4); }
  async openOtp(card: BankCard): Promise<boolean> {
    if (!this.agreed || this.submitting || this.result) return false;
    const generation = ++this.generation;
    this.card = undefined; this.phone = ''; this.code = ''; this.deadline = 0;
    const phone = await this.readPhone();
    if (generation !== this.generation) return false;
    this.card = card; this.phone = phone; this.code = ''; this.deadline = this.now() + 60_000;
    return true;
  }
  remaining(): number { return Math.max(0, Math.ceil((this.deadline - this.now()) / 1000)); }
  resend(): boolean { if (!this.card || this.result || this.submitting || this.remaining() > 0) return false; this.deadline = this.now() + 60_000; return true; }
  canSubmit(): boolean { return !!this.card && /^\d{6}$/.test(this.code) && !this.submitting && !this.result; }
  async confirmOtp(): Promise<boolean> {
    if (!this.canSubmit()) return false;
    this.submitting = true;
    const card = this.card!;
    let success = false;
    try { success = (await this.store.saveCard(card)).success; } catch { /* Failure still carries the original full number. */ }
    this.result = { fullCardNumber: card.fullCardNumber, success };
    this.stack.pushPath({ name: 'AddCardResultPage', param: this.result });
    this.submitting = false;
    return true;
  }
  cancel(): boolean {
    if (this.submitting || this.result) return false;
    this.generation++; this.code = ''; this.card = undefined; this.deadline = 0;
    return true;
  }
  backAllowed(): boolean { return !this.submitting && !this.result; }
  complete(): boolean {
    if (!this.result || this.submitting) return false;
    const result = this.result; this.result = undefined; this.card = undefined; this.bank = undefined; this.type = undefined; this.agreed = false; this.code = ''; this.deadline = 0; this.generation++;
    if (result.success) { this.stack.popToIndex(0); this.bridge.publishAddedCard(result.fullCardNumber); }
    else this.stack.popToIndex(this.entryIndex);
    return true;
  }
  screen(kind: 'entry' | 'banks' | 'home' | 'type' | 'card' | 'otp' | 'result'): { elements: string[]; canContinue: boolean; back: boolean; text: string } {
    if (kind === 'entry' || kind === 'banks') return { elements: ['bank'], canContinue: true, back: true, text: '选择银行' };
    if (kind === 'home') return { elements: ['card', 'add'], canContinue: true, back: false, text: '钱包首页' };
    if (kind === 'type') return { elements: ['bank', 'types', 'hint', 'agreement', 'continue'], canContinue: !!this.type, back: true, text: this.bank?.name ?? '' };
    if (kind === 'card') return { elements: ['bank-title', 'hint', 'masked-cards', 'agreement', 'next'], canContinue: this.agreed && !!this.card, back: true, text: this.cards().map(card => this.mask(card)).join('\n') };
    if (kind === 'otp') return { elements: ['phone', 'code', 'countdown', 'next'], canContinue: this.canSubmit(), back: this.backAllowed(), text: this.phone };
    return { elements: ['status', 'message', 'guide', 'complete'], canContinue: !!this.result, back: false, text: this.result?.success ? '添卡成功' : '添卡失败' };
  }
}
