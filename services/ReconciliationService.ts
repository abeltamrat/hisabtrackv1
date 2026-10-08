import type { Account, Transaction } from '@/types/database';
import type { DraftTransaction } from '@/services/DraftTransactionService';
import { accountDelta, money, sumMoney } from '@/utils/finance';

export type GapReason = 'UNRECORDED_DRAFT' | 'POSSIBLE_DUPLICATE' | 'OMITTED_FEE' | 'OPENING_BALANCE' | 'UNEXPLAINED' | 'RECONCILED';
export interface ReconciliationEvidence { transactions: Transaction[]; drafts: DraftTransaction[]; previousAnchor?: DraftTransaction }
export interface BalanceGapAnalysis {
  bankBalance: number; expectedBalance: number; gap: number; hasDiscrepancy: boolean;
  isAlreadyRecorded: boolean; transactionsAfter: number; reason: GapReason; explanation: string;
  evidence: ReconciliationEvidence; suggestedDraft?: DraftTransaction; duplicateTransaction?: Transaction;
}

const affectsAccount = (transaction: Transaction, accountId: string) => transaction.account_id === accountId || (transaction.type === 'TRANSFER' && transaction.to_account_id === accountId);
const draftDelta = (draft: DraftTransaction) => draft.type === 'INCOME' ? money(draft.amount) : -money(draft.gross_amount ?? draft.amount);
const close = (left: number, right: number) => Math.abs(money(left - right)) < 0.01;

export class ReconciliationService {
  static analyzeDraft(account: Account, draft: DraftTransaction, transactions: Transaction[], allDrafts: DraftTransaction[] = [draft]): BalanceGapAnalysis | null {
    if (!Number.isFinite(draft.suggested_balance)) return null;
    const previousAnchor = allDrafts
      .filter(item => item.account_id === account.id && Number.isFinite(item.suggested_balance) && item.date < draft.date)
      .sort((a, b) => b.date - a.date)[0];
    const isAlreadyRecorded = transactions.some(transaction => transaction.sms_id === draft.sms_id || transaction.sms_id === draft.id);

    if (previousAnchor) {
      const windowTransactions = transactions.filter(transaction => affectsAccount(transaction, account.id) && transaction.date > previousAnchor.date && transaction.date <= draft.date);
      const pendingDrafts = allDrafts.filter(item => item.account_id === account.id && item.status === 'PENDING' && item.date > previousAnchor.date && item.date <= draft.date && !transactions.some(transaction => transaction.sms_id === item.sms_id || transaction.sms_id === item.id));
      const recordedExpected = money(previousAnchor.suggested_balance! + sumMoney(windowTransactions.map(transaction => accountDelta(transaction, account.id))));
      const expectedBalance = money(recordedExpected + sumMoney(pendingDrafts.map(draftDelta)));
      const bankBalance = money(draft.suggested_balance!);
      const ledgerGap = money(bankBalance - recordedExpected);
      const gap = money(bankBalance - expectedBalance);
      const suggestedDraft = pendingDrafts.find(item => close(draftDelta(item), ledgerGap));
      if (suggestedDraft && close(gap, 0)) {
        return {
          bankBalance, expectedBalance, gap: ledgerGap, hasDiscrepancy: false, isAlreadyRecorded,
          transactionsAfter: windowTransactions.length, reason: 'UNRECORDED_DRAFT',
          explanation: `The bank balance reconciles after including the pending ${suggestedDraft.type.toLowerCase()} draft of ${Math.abs(draftDelta(suggestedDraft)).toFixed(2)}. Record that draft before creating an adjustment.`,
          evidence: { transactions: windowTransactions, drafts: pendingDrafts, previousAnchor }, suggestedDraft,
        };
      }
      return this.classify(account, draft, bankBalance, expectedBalance, gap, isAlreadyRecorded, windowTransactions, pendingDrafts, previousAnchor);
    }

    const later = transactions.filter(transaction => affectsAccount(transaction, account.id) && transaction.date > draft.date);
    let expectedBalance = money(account.balance - sumMoney(later.map(transaction => accountDelta(transaction, account.id))));
    if (!isAlreadyRecorded && draft.status !== 'RECORDED') expectedBalance = money(expectedBalance + draftDelta(draft));
    const bankBalance = money(draft.suggested_balance!);
    return this.classify(account, draft, bankBalance, expectedBalance, money(bankBalance - expectedBalance), isAlreadyRecorded, later, [], undefined);
  }

  static unresolvedCount(accounts: Account[], drafts: DraftTransaction[], transactions: Transaction[]) {
    return drafts.filter(draft => {
      const account = accounts.find(item => item.id === draft.account_id);
      return account && this.analyzeDraft(account, draft, transactions, drafts)?.hasDiscrepancy;
    }).length;
  }

  private static classify(account: Account, draft: DraftTransaction, bankBalance: number, expectedBalance: number, gap: number, isAlreadyRecorded: boolean, evidenceTransactions: Transaction[], evidenceDrafts: DraftTransaction[], previousAnchor?: DraftTransaction): BalanceGapAnalysis {
    let reason: GapReason = close(gap, 0) ? 'RECONCILED' : previousAnchor ? 'UNEXPLAINED' : 'OPENING_BALANCE';
    let explanation = previousAnchor
      ? `Compared with the previous bank balance from ${new Date(previousAnchor.date).toLocaleDateString()} and ${evidenceTransactions.length} intervening recorded transaction${evidenceTransactions.length === 1 ? '' : 's'}.`
      : `Reconstructed from today's ledger by reversing ${evidenceTransactions.length} later transaction${evidenceTransactions.length === 1 ? '' : 's'}; no earlier authoritative SMS balance is available.`;
    let duplicateTransaction: Transaction | undefined;

    if (!close(gap, 0)) {
      const sorted = [...evidenceTransactions].sort((a, b) => a.date - b.date);
      for (let index = 1; index < sorted.length; index += 1) {
        const current = sorted[index], prior = sorted[index - 1];
        if (current.type === prior.type && current.amount === prior.amount && current.account_id === prior.account_id && Math.abs(current.date - prior.date) <= 5 * 60 * 1000 && close(gap + accountDelta(current, account.id), 0)) {
          reason = 'POSSIBLE_DUPLICATE'; duplicateTransaction = current;
          explanation = `Removing the possible duplicate ${current.description} posting reconciles the exact gap. Review both records before deleting either one.`;
          break;
        }
      }
      if (reason !== 'POSSIBLE_DUPLICATE' && draft.type === 'EXPENSE' && draft.gross_amount && isAlreadyRecorded) {
        const recorded = evidenceTransactions.filter(transaction => transaction.sms_id === draft.sms_id || transaction.sms_id === draft.id);
        const recordedDebit = recorded.length ? Math.max(...recorded.map(item => item.gross_amount ?? item.amount)) : draft.amount;
        const omitted = money(draft.gross_amount - recordedDebit);
        if (omitted > 0 && close(gap, -omitted)) { reason = 'OMITTED_FEE'; explanation = `The ${omitted.toFixed(2)} gap matches bank charges present in the SMS but absent from the recorded gross debit.`; }
      }
      if (reason === 'OPENING_BALANCE') explanation += ' Review the account opening balance before recording an adjustment.';
      if (reason === 'UNEXPLAINED') explanation += ' No known draft, duplicate, or omitted fee explains the exact gap.';
    }
    return { bankBalance, expectedBalance, gap, hasDiscrepancy: !close(gap, 0), isAlreadyRecorded, transactionsAfter: evidenceTransactions.length, reason, explanation, evidence: { transactions: evidenceTransactions, drafts: evidenceDrafts, previousAnchor }, duplicateTransaction };
  }
}

export default ReconciliationService;
