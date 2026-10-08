import type { Account, Transaction } from '@/types/database';
import type { DraftTransaction } from '@/services/DraftTransactionService';
import { accountDelta, money, sumMoney } from '@/utils/finance';

export interface BalanceGapAnalysis {
  bankBalance: number;
  expectedBalance: number;
  gap: number;
  hasDiscrepancy: boolean;
  isAlreadyRecorded: boolean;
  transactionsAfter: number;
  explanation: string;
}

export class ReconciliationService {
  /** Rewinds today's ledger balance to the instant immediately after the SMS. */
  static analyzeDraft(account: Account, draft: DraftTransaction, transactions: Transaction[]): BalanceGapAnalysis | null {
    if (!Number.isFinite(draft.suggested_balance)) return null;
    const relevant = transactions.filter(transaction =>
      transaction.date > draft.date &&
      (transaction.account_id === account.id ||
        (transaction.type === 'TRANSFER' && transaction.to_account_id === account.id))
    );
    const laterDelta = sumMoney(relevant.map(transaction => accountDelta(transaction, account.id)));
    const isAlreadyRecorded = transactions.some(transaction => transaction.sms_id === draft.sms_id || transaction.sms_id === draft.id);
    let expectedBalance = money(account.balance - laterDelta);

    // Pending drafts are absent from the ledger. Move the reconstructed
    // pre-SMS balance through this draft, including gross bank debits.
    if (!isAlreadyRecorded && draft.status !== 'RECORDED') {
      const draftDelta = draft.type === 'INCOME'
        ? draft.amount
        : -money(draft.gross_amount ?? draft.amount);
      expectedBalance = money(expectedBalance + draftDelta);
    }

    const bankBalance = money(draft.suggested_balance!);
    const gap = money(bankBalance - expectedBalance);
    return {
      bankBalance,
      expectedBalance,
      gap,
      hasDiscrepancy: Math.abs(gap) >= 0.01,
      isAlreadyRecorded,
      transactionsAfter: relevant.length,
      explanation: relevant.length
        ? `Reconstructed from today's ledger by reversing ${relevant.length} later transaction${relevant.length === 1 ? '' : 's'}.`
        : 'No later recorded transactions were found for this account.',
    };
  }
}

export default ReconciliationService;
