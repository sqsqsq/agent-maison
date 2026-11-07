import { it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OpenCardFlow, HomeLaunchBridge, HomeProjection, BankCard, Bank, Store, Navigation, createMockCards } from '../main/OpenCardFlow';

class Stack implements Navigation {
  paths = ['HomeTabPage', 'CardPackPage', 'AddCardEntryPage'];
  parameters: unknown[] = [];
  pushPath(route: { name: string; param?: unknown }): void { this.paths.push(route.name); this.parameters.push(route.param); }
  popToIndex(index: number): void { this.paths.splice(index + 1); }
  getAllPathName(): string[] { return [...this.paths]; }
}
class FakeCardRepository implements Store {
  db: DatabaseSync;
  calls: string[] = [];
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('CREATE TABLE IF NOT EXISTS cards (fullCardNumber TEXT PRIMARY KEY, category TEXT NOT NULL, bankName TEXT NOT NULL, bankCardType TEXT NOT NULL, addedAt INTEGER NOT NULL, huaweiPayStatus TEXT NOT NULL, unionPayStatus TEXT NOT NULL, transactions TEXT NOT NULL)');
  }
  async saveCard(card: BankCard): Promise<{ success: boolean }> {
    this.calls.push('saveCard');
    try { this.db.prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?)').run(card.fullCardNumber, card.category, card.bankName, card.bankCardType, card.addedAt, card.huaweiPayStatus, card.unionPayStatus, card.transactions); return { success: true }; }
    catch { return { success: false }; }
  }
  async listCards(): Promise<BankCard[]> { this.calls.push('listCards'); return this.db.prepare('SELECT * FROM cards').all().map(row => ({ ...row } as unknown as BankCard)); }
}
class FakeBankRepository {
  calls: string[] = [];
  constructor(private now: () => number, private banks: Bank[]) {}
  getMockCards(bankId: string, type: string): BankCard[] {
    this.calls.push('getMockCards'); const bank = this.banks.find(row => row.code === bankId);
    return bank ? createMockCards(bank, type, this.now()) : [];
  }
}
class FakeAccountService {
  calls: string[] = [];
  async getMockPhone(): Promise<string> { this.calls.push('getMockPhone'); return '13800138000'; }
}
const banks = [{ code: 'cmb', name: '招商银行', supportedTypes: ['debit', 'credit'] }, { code: 'icbc', name: '工商银行', supportedTypes: ['debit'] }];
async function fixture(run: (value: { flow: OpenCardFlow; store: FakeCardRepository; stack: Stack; bridge: HomeLaunchBridge; file: string; clock: { now: number } }) => Promise<void> | void): Promise<void> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p4-card-node-'))), file = path.join(root, 'cards.sqlite');
  const store = new FakeCardRepository(file), stack = new Stack(), bridge = new HomeLaunchBridge(), clock = { now: 1000 };
  const bank = new FakeBankRepository(() => clock.now, banks), account = new FakeAccountService();
  const flow = new OpenCardFlow(store, stack, bridge, () => clock.now, () => account.getMockPhone(), (id,type) => bank.getMockCards(id,type));
  try { await run({ flow, store, stack, bridge, file, clock }); }
  finally { try { store.db.close(); } catch {} assert(path.dirname(root) === fs.realpathSync(os.tmpdir()) && path.basename(root).startsWith('p4-card-node-')); fs.rmSync(root, { recursive: true, force: true }); }
}
const expect = (value: unknown) => ({ toEqual: (other: unknown): void => assert.deepEqual(value, other) });
async function select(flow: OpenCardFlow): Promise<void> { flow.selectBank(banks[0], 'AddBankCardPage'); expect(flow.state.phase).toEqual('SelectingType'); assert(flow.selectType('debit')); expect(flow.state.phase).toEqual('SelectingCard'); flow.agreed = true; assert(await flow.selectCard(flow.cards()[0])); expect(flow.state.phase).toEqual('WaitingOtp'); flow.code = '123456'; }

it('[BRANCH-success][AC-1] both original bank entries honor supported types and keep one selected type', async () => { await fixture(({ flow, stack }) => {
  for (const entry of ['AddBankCardPage', 'AllBanksPage'] as const) {
    flow.enter(banks[1], entry); assert(!flow.selectType('credit')); assert(flow.selectType('debit'));
    expect(flow.type).toEqual('debit'); expect(stack.paths.at(-1)).toEqual('BankCardSelectionPage');
  }
}); });
it('[BRANCH-success][AC-2] mock cards retain full data while display is masked and agreement is required', async () => { await fixture(async ({ flow }) => {
  flow.enter(banks[0], 'AddBankCardPage'); assert(flow.selectType('credit'));
  const cards = flow.cards(); assert(cards.length >= 1 && cards.length <= 2); expect(cards[0].bankCardType).toEqual('credit');
  assert(!flow.screen('card').text.includes(cards[0].fullCardNumber)); assert(!(await flow.openOtp(cards[0])));
  flow.agreed = true; assert(await flow.openOtp(cards[0])); expect(flow.card!.fullCardNumber).toEqual(cards[0].fullCardNumber);
}); });
it('[BRANCH-invalid_otp][AC-3][BD-2] OTP reads the mock phone and uses a 60 second deadline with six digits', async () => { await fixture(async ({ flow, clock }) => {
  await select(flow); expect(flow.phone).toEqual('13800138000'); expect(flow.remaining()).toEqual(60); assert(!flow.resend());
  clock.now += 59_999; expect(flow.remaining()).toEqual(1); assert(!flow.resend()); clock.now++; assert(flow.resend()); expect(flow.remaining()).toEqual(60);
  for (const code of ['', '12345', '12a456', '1234567']) { flow.code = code; assert(!flow.canSubmit()); }
  flow.code = '987654'; assert(flow.canSubmit());
}); });
it('[BRANCH-success][AC-4][BD-1] real SQLite persists full card fields and duplicate failures retain the full number', async () => { await fixture(async ({ flow, store, file, stack }) => {
  await select(flow); const card = flow.card!; const saving = flow.confirmOtp(); expect(flow.state.phase).toEqual('Saving'); assert(await saving); expect(flow.state.phase).toEqual('Success'); expect(flow.result).toEqual({ fullCardNumber: card.fullCardNumber, success: true });
  store.db.close(); store.db = new DatabaseSync(file); const cards = await store.listCards(); expect(cards).toEqual([card]); expect(cards[0].transactions).toEqual('[]');
  flow.finish(); expect(flow.state.phase).toEqual('Idle'); await select(flow); assert(await flow.confirmOtp()); expect(flow.state.phase).toEqual('Failed'); expect(flow.result!.success).toEqual(false);
  expect((stack.parameters.at(-1) as { fullCardNumber: string }).fullCardNumber).toEqual(card.fullCardNumber);
}); });
it('[BRANCH-success][AC-5] result blocks back, completes once and success or failure removes the intended route segment', async () => { await fixture(async ({ flow, stack, bridge }) => {
  await select(flow); const fullNumber = flow.card!.fullCardNumber; assert(await flow.confirmOtp()); assert(!(await flow.confirmOtp())); assert(!flow.backAllowed()); assert(!flow.cancel()); assert(flow.complete());
  expect(stack.paths).toEqual(['HomeTabPage']); expect(bridge.consumeAddedCard()).toEqual(fullNumber); expect(bridge.consumeAddedCard()).toEqual(undefined); assert(!flow.complete());
  stack.paths = ['HomeTabPage', 'AddCardEntryPage']; await select(flow); assert(await flow.confirmOtp()); assert(flow.complete());
  expect(stack.paths).toEqual(['HomeTabPage', 'AddCardEntryPage']);
}); });
it('[BRANCH-save_failure][AC-4][BD-1] pending persistence locks navigation and duplicate submit while a real store failure still returns its card', async () => { await fixture(async ({ store, stack, bridge, clock }) => {
  let release!: () => void, saves = 0;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const delayed: Store = { saveCard: async card => { saves++; await ready; return store.saveCard(card); }, listCards: () => store.listCards() };
  const flow = new OpenCardFlow(delayed, stack, bridge, () => clock.now, async () => '13800138000');
  await select(flow); const fullNumber = flow.card!.fullCardNumber; const pending = flow.confirmOtp(); assert(!flow.backAllowed()); assert(!flow.cancel());
  assert(!(await flow.confirmOtp())); expect(saves).toEqual(1); assert(!flow.result); release(); assert(await pending); expect((await store.listCards()).length).toEqual(1);
  flow.complete(); store.db.close(); await select(flow); assert(await flow.confirmOtp());
  expect(flow.result).toEqual({ fullCardNumber: fullNumber, success: false });
}); });
it('[BRANCH-reenter][AC-6] existing route stack and result handoff survive old and new page transitions', async () => { await fixture(async ({ flow, stack, bridge, store }) => {
  stack.pushPath({ name: 'LegacyCardPage' }); flow.enter(banks[0], 'AllBanksPage'); assert(flow.selectType('debit')); assert(flow.cancel());
  assert(stack.paths.includes('LegacyCardPage')); let observed = 0; const listener = () => { if (bridge.consumeAddedCard()) observed++; };
  bridge.subscribeAddedCard(listener); await select(flow); await flow.confirmOtp(); flow.complete(); expect(observed).toEqual(1); bridge.unsubscribeAddedCard(listener);
  const home = new HomeProjection(store); await home.refresh(); expect(home.cards.length).toEqual(1);
  flow.reenter(); expect(stack.paths).toEqual(['HomeTabPage', 'AddCardEntryPage']);
  store.db.close(); await home.refresh(); expect(home.cards.length).toEqual(1); assert(home.error.length > 0);
}); });
it('[BRANCH-success][AC-7] development screen projection preserves the four requested sections and excludes NFC activation', async () => { await fixture(async ({ flow }) => {
  await select(flow); expect(flow.screen('type').elements).toEqual(['bank', 'types', 'hint', 'agreement', 'continue']);
  expect(flow.screen('card').elements).toEqual(['bank-title', 'hint', 'masked-cards', 'agreement', 'next']);
  expect(flow.screen('otp').elements).toEqual(['phone', 'code', 'countdown', 'next']); await flow.confirmOtp();
  expect(flow.screen('result').elements).toEqual(['status', 'message', 'guide', 'complete']); assert(!flow.screen('result').back);
  assert(!JSON.stringify(flow.screen('result')).toLowerCase().includes('nfc'));
}); });
it('[BRANCH-cancel][AC-3] cancelling OTP clears transient values without creating a persisted result', async () => { await fixture(async ({ flow, store }) => {
  await select(flow); assert(flow.cancel()); expect(flow.card).toEqual(undefined); expect(flow.code).toEqual('');
  expect(flow.remaining()).toEqual(0); expect(await store.listCards()).toEqual([]); assert(!flow.result);
}); });
it('[BRANCH-invalid_otp][AC-3] phone lookup failure cannot submit a previous selection and a genuine retry can recover', async () => { await fixture(async ({ store, stack, bridge, clock }) => {
  let fail = false;
  const flow = new OpenCardFlow(store, stack, bridge, () => clock.now, async () => { if (fail) throw Error('phone unavailable'); return '13800138000'; });
  await select(flow); fail = true; await assert.rejects(flow.openOtp(flow.cards()[1]), /phone unavailable/);
  expect(flow.card).toEqual(undefined); expect(flow.phone).toEqual(''); assert(!flow.canSubmit()); assert(!flow.resend());
  fail = false; assert(await flow.openOtp(flow.cards()[1])); expect(flow.phone).toEqual('13800138000');
}); });
it('[BRANCH-success][AC-3][AC-4] card and mock phone never appear in application console output', async () => { await fixture(async ({ flow }) => {
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const output: string[] = [];
  const capture = (...values: unknown[]): void => { output.push(values.map(String).join(' ')); };
  Object.assign(console, { log: capture, info: capture, warn: capture, error: capture });
  try {
    await select(flow); const full = flow.card!.fullCardNumber, phone = flow.phone;
    assert(await flow.confirmOtp()); flow.finish();
    await select(flow); assert(await flow.confirmOtp()); flow.finish();
    expect(output.join('\n').includes(full)).toEqual(false); expect(output.join('\n').includes(phone)).toEqual(false);
  } finally { Object.assign(console, original); }
}); });
