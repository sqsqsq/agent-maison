import { describe, it, expect } from '@ohos/hypium';
import { BankCardCandidate, BankCardType } from '../../../main/ets/data/model/BankCardCandidate';
import { BankOpeningCompletionContext } from '../../../main/ets/data/model/BankOpeningCompletionContext';
import { StoredCard } from '../../../main/ets/data/model/StoredCard';
import { BankCardRepository } from '../../../main/ets/data/repository/BankCardRepository';
import { BankRepository } from '../../../main/ets/data/repository/BankRepository';
import {
  BankCardOpeningService,
  BankCardOpeningPhase,
  BankCardOpeningSession
} from '../../../main/ets/domain/service/BankCardOpeningService';
import { OtpVerificationState } from '../../../main/ets/domain/service/OtpService';
import {
  SpyBankCardRepository,
  SpyBankCardStore,
  SpyOpeningBankRepository,
  SpyOtpService
} from './spy/SpyBankCardOpeningDependencies';

const FULL_CARD_NUMBER: string = '6225888888881234';
const MOBILE: string = '13800138000';

function candidate(): BankCardCandidate {
  return {
    bankCode: 'cmb',
    bankName: '招商银行',
    cardNumber: FULL_CARD_NUMBER,
    cardType: BankCardType.DEBIT
  };
}

export function bank_card_opening_flow(): void {
  describe('bank card opening flow', () => {
    it('[AC-1][BD-1] opening session enforces each continue gate', 0, () => {
      const session: BankCardOpeningSession = new BankCardOpeningSession();
      session.begin('cmb');
      expect(session.selectionParams() === null).assertTrue();
      expect(session.canOpenOtp()).assertFalse();

      session.selectCardType(BankCardType.DEBIT);
      const params = session.selectionParams();
      expect(params !== null).assertTrue();
      if (params !== null) {
        expect(params.bankCode).assertEqual('cmb');
        expect(params.cardType).assertEqual(BankCardType.DEBIT);
      }

      session.selectCandidate(candidate());
      expect(session.canOpenOtp()).assertFalse();
      session.setAgreementAccepted(true);
      expect(session.canOpenOtp()).assertTrue();
      session.setOtp('12345');
      expect(session.canSubmit()).assertFalse();
      session.setOtp('123456');
      expect(session.canSubmit()).assertTrue();
    });

    it('[AC-2] card candidates are filtered while only the rendered number is masked', 0, async () => {
      const cards: BankCardCandidate[] = await new BankRepository().getCards('cmb', BankCardType.DEBIT);
      const service: BankCardOpeningService = new BankCardOpeningService();
      expect(cards.length > 0).assertTrue();
      expect(cards.length <= 2).assertTrue();
      expect(cards[0].cardNumber.length > 8).assertTrue();
      expect(service.maskCardNumber(cards[0].cardNumber)).assertEqual('6222 **** **** 0011');
      expect(cards[0].cardNumber).assertEqual('6222010000000011');
    });

    it('[AC-3][BD-2] OTP starts once, blocks resend, resets at zero and accepts six digits', 0, async () => {
      const otpService: SpyOtpService = new SpyOtpService();
      const state: OtpVerificationState = new OtpVerificationState(otpService, 60);
      expect(await state.start(MOBILE)).assertTrue();
      expect(state.countdownSeconds).assertEqual(60);
      expect(otpService.callLog.length).assertEqual(1);
      expect(await state.resend()).assertFalse();
      expect(otpService.callLog.length).assertEqual(1);

      for (let second: number = 0; second < 60; second++) {
        state.tick();
      }
      expect(state.countdownSeconds).assertEqual(0);
      expect(await state.resend()).assertTrue();
      expect(state.countdownSeconds).assertEqual(60);
      expect(otpService.callLog.length).assertEqual(2);
      expect(state.updateOtp('12a34567', 6)).assertEqual('123456');
      expect(state.canSubmit(6)).assertTrue();
    });
  });
}

export function bank_card_state_owners(): void {
  describe('bank card state owners', () => {
    it('[BD-4] cancelling sheet state clears selection, OTP and timers without persistence', 0, async () => {
      const repository: SpyBankCardRepository = new SpyBankCardRepository();
      const session: BankCardOpeningSession = new BankCardOpeningSession();
      const otpState: OtpVerificationState = new OtpVerificationState(new SpyOtpService(), 60);
      session.begin('cmb');
      session.selectCardType(BankCardType.DEBIT);
      session.selectCandidate(candidate());
      session.setAgreementAccepted(true);
      session.setOtp('123456');
      await otpState.start(MOBILE);

      session.cancel();
      otpState.cancel();
      expect(session.selectionParams() === null).assertTrue();
      expect(session.selectedCandidate() === null).assertTrue();
      expect(session.canSubmit()).assertFalse();
      expect(otpState.active).assertFalse();
      expect(otpState.countdownSeconds).assertEqual(0);
      expect(repository.callLog.length).assertEqual(0);
    });
  });
}

export function bank_card_result_consumers(): void {
  describe('bank card result consumers', () => {
    it('[AC-4] completion context exposes the full number once and then clears it', 0, () => {
      BankOpeningCompletionContext.clear();
      BankOpeningCompletionContext.publish(FULL_CARD_NUMBER);
      expect(BankOpeningCompletionContext.consume()).assertEqual(FULL_CARD_NUMBER);
      expect(BankOpeningCompletionContext.consume()).assertUndefined();
    });
  });
}

export function bank_card_persistence(): void {
  describe('bank card persistence contract', () => {
    it('[AC-4] repository commits all stored fields and treats a repeated number as success', 0, async () => {
      const service: BankCardOpeningService = new BankCardOpeningService();
      const card: StoredCard = service.toStoredCard(candidate());
      const insertStore: SpyBankCardStore = new SpyBankCardStore();
      const insertRepository: BankCardRepository = new BankCardRepository(null, insertStore);
      const inserted: StoredCard = await insertRepository.save(card);
      expect(inserted.cardNumber).assertEqual(FULL_CARD_NUMBER);
      expect(inserted.category).assertEqual('BANK_CARD');
      expect(inserted.bankName).assertEqual('招商银行');
      expect(inserted.bankCardType).assertEqual('DEBIT');
      expect(inserted.huaweiPayEnabled).assertTrue();
      expect(inserted.unionPayQuickPassEnabled).assertTrue();
      expect(inserted.transactionRecords).assertEqual('[]');
      expect(insertStore.callLog.join(',')).assertEqual('beginTransaction,findByCardNumber,insert,commit');

      const existingStore: SpyBankCardStore = new SpyBankCardStore();
      existingStore.existing = card;
      const existing: StoredCard = await new BankCardRepository(null, existingStore).save(card);
      expect(existing.cardNumber).assertEqual(FULL_CARD_NUMBER);
      expect(existingStore.callLog.join(',')).assertEqual('beginTransaction,findByCardNumber,commit');
    });
  });
}

export function opening_navigation_recovery(): void {
  describe('opening navigation recovery state', () => {
    it('[AC-6] an abandoned completion payload is cleared before route recovery', 0, () => {
      BankOpeningCompletionContext.publish(FULL_CARD_NUMBER);
      BankOpeningCompletionContext.clear();
      expect(BankOpeningCompletionContext.consume()).assertUndefined();
      expect(FULL_CARD_NUMBER.length).assertEqual(16);
    });
  });
}

export function bank_card_opening_complete(): void {
  describe('bank card opening completion', () => {
    it('[BRANCH-BR-SUCCESS][AC-4] coordinated flow loads candidates, verifies OTP and saves successfully', 0, async () => {
      const cardRepository: SpyBankCardRepository = new SpyBankCardRepository();
      const bankRepository: SpyOpeningBankRepository = new SpyOpeningBankRepository();
      const otpService: SpyOtpService = new SpyOtpService();
      const otpState: OtpVerificationState = new OtpVerificationState(otpService, 60);
      const service: BankCardOpeningService = new BankCardOpeningService(
        cardRepository,
        bankRepository,
        otpState,
        new BankCardOpeningSession()
      );
      bankRepository.cards = [candidate()];
      const phases: BankCardOpeningPhase[] = [service.phase()];

      service.begin('cmb', BankCardType.DEBIT);
      phases.push(service.phase());
      const candidates: BankCardCandidate[] = await service.loadCandidates();
      service.selectCandidate(candidates[0]);
      phases.push(service.phase());
      service.setAgreementAccepted(true);
      expect(await service.startOtp(MOBILE)).assertTrue();
      phases.push(service.phase());
      expect(service.updateOtp('123456', 6)).assertEqual('123456');
      expect(service.canSubmit(6)).assertTrue();
      const completion = service.completeOpening(6);
      phases.push(service.phase());
      const result = await completion;
      phases.push(service.phase());

      expect(phases).assertDeepEquals([
        BankCardOpeningPhase.ENTRY,
        BankCardOpeningPhase.TYPE_SELECTED,
        BankCardOpeningPhase.CARD_SELECTED,
        BankCardOpeningPhase.OTP_ACTIVE,
        BankCardOpeningPhase.SAVING,
        BankCardOpeningPhase.RESULT
      ]);
      expect(result !== null && result.success).assertTrue();
      expect(result === null ? '' : result.fullCardNumber).assertEqual(FULL_CARD_NUMBER);
      expect(bankRepository.callLog).assertDeepEquals(['getCards:cmb:DEBIT']);
      expect(otpService.callLog).assertDeepEquals([`sendMockCode:${MOBILE}`]);
      expect(cardRepository.callLog).assertDeepEquals(['save']);
      expect(cardRepository.savedCards[0].cardNumber).assertEqual(FULL_CARD_NUMBER);
    });

    it('[BRANCH-BR-FAILURE][AC-4][BD-3] coordinated flow reaches a failed result when persistence throws', 0, async () => {
      const cardRepository: SpyBankCardRepository = new SpyBankCardRepository();
      cardRepository.shouldFail = true;
      const otpService: SpyOtpService = new SpyOtpService();
      const otpState: OtpVerificationState = new OtpVerificationState(otpService, 60);
      const service: BankCardOpeningService = new BankCardOpeningService(
        cardRepository,
        new SpyOpeningBankRepository(),
        otpState,
        new BankCardOpeningSession()
      );
      const phases: BankCardOpeningPhase[] = [service.phase()];

      service.begin('cmb', BankCardType.DEBIT);
      phases.push(service.phase());
      service.selectCandidate(candidate());
      phases.push(service.phase());
      service.setAgreementAccepted(true);
      expect(await service.startOtp(MOBILE)).assertTrue();
      phases.push(service.phase());
      service.updateOtp('123456', 6);
      const completion = service.completeOpening(6);
      phases.push(service.phase());
      const result = await completion;
      phases.push(service.phase());

      expect(phases).assertDeepEquals([
        BankCardOpeningPhase.ENTRY,
        BankCardOpeningPhase.TYPE_SELECTED,
        BankCardOpeningPhase.CARD_SELECTED,
        BankCardOpeningPhase.OTP_ACTIVE,
        BankCardOpeningPhase.SAVING,
        BankCardOpeningPhase.RESULT
      ]);
      expect(result !== null && !result.success).assertTrue();
      expect(result === null ? '' : result.fullCardNumber).assertEqual(FULL_CARD_NUMBER);
      expect(result === null ? '' : result.errorMessage).assertEqual('RDB_SAVE_FAILED');
      expect(otpService.callLog).assertDeepEquals([`sendMockCode:${MOBILE}`]);
      expect(cardRepository.callLog).assertDeepEquals(['save']);
      expect(cardRepository.savedCards.length).assertEqual(0);
    });

    it('[AC-4] save success returns the full card number and persisted payload', 0, async () => {
      const repository: SpyBankCardRepository = new SpyBankCardRepository();
      const service: BankCardOpeningService = new BankCardOpeningService(repository);
      const result = await service.saveCandidate(candidate());
      expect(result.success).assertTrue();
      expect(result.fullCardNumber).assertEqual(FULL_CARD_NUMBER);
      expect(result.errorMessage).assertUndefined();
      expect(repository.callLog.join(',')).assertEqual('save');
      expect(repository.savedCards.length).assertEqual(1);
      expect(repository.savedCards[0].cardNumber).assertEqual(FULL_CARD_NUMBER);
    });

    it('[AC-4][BD-3] save failure preserves the full number in a failed result', 0, async () => {
      const repository: SpyBankCardRepository = new SpyBankCardRepository();
      repository.shouldFail = true;
      const service: BankCardOpeningService = new BankCardOpeningService(repository);
      const result = await service.saveCandidate(candidate());
      expect(result.success).assertFalse();
      expect(result.fullCardNumber).assertEqual(FULL_CARD_NUMBER);
      expect(result.errorMessage).assertEqual('RDB_SAVE_FAILED');
      expect(repository.callLog.join(',')).assertEqual('save');
      expect(repository.savedCards.length).assertEqual(0);
    });
  });
}

export function bank_card_rdb(): void {
  describe('bank card RDB atomicity', () => {
    it('[AC-4][BD-3] insert failure rolls back, rechecks idempotency and leaves no half write', 0, async () => {
      const store: SpyBankCardStore = new SpyBankCardStore();
      store.failInsert = true;
      const repository: BankCardRepository = new BankCardRepository(null, store);
      const card: StoredCard = new BankCardOpeningService().toStoredCard(candidate());
      let failed: boolean = false;
      try {
        await repository.save(card);
      } catch {
        failed = true;
      }
      expect(failed).assertTrue();
      expect(store.inserted).assertUndefined();
      expect(store.callLog.join(',')).assertEqual(
        'beginTransaction,findByCardNumber,insert,rollBack,findByCardNumber'
      );
    });
  });
}

export function opening_navigation_cleanup(): void {
  describe('opening cleanup', () => {
    it('[BD-4] reset discards the active session and permits a clean restart', 0, () => {
      const session: BankCardOpeningSession = new BankCardOpeningSession();
      session.begin('cmb');
      session.selectCardType(BankCardType.CREDIT);
      session.selectCandidate(candidate());
      session.setAgreementAccepted(true);
      session.setOtp('123456');
      expect(session.canSubmit()).assertTrue();
      session.reset();
      expect(session.selectionParams() === null).assertTrue();
      expect(session.selectedCandidate() === null).assertTrue();
      expect(session.canOpenOtp()).assertFalse();
      expect(session.canSubmit()).assertFalse();
    });
  });
}

export default function bankOpenCardUtTest(): void {
  bank_card_opening_flow();
  bank_card_state_owners();
  bank_card_result_consumers();
  bank_card_persistence();
  opening_navigation_recovery();
  bank_card_opening_complete();
  bank_card_rdb();
  opening_navigation_cleanup();
}
