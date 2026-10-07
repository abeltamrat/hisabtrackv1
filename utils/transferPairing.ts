/**
 * Cross-account self-transfer pairing.
 *
 * When money moves between two of the user's own accounts at different
 * institutions (e.g. CBE → Telebirr), both banks send an SMS within minutes:
 * a debit ("transferred/sent") on the source and a credit ("received") on the
 * destination. Neither message says "your account", so text-based detection
 * can't link them — but a matching amount landing on two different accounts
 * at nearly the same time is a strong signal they are two legs of one transfer.
 */

export interface PairableDraft {
  id: string;
  account_id: string;
  type: 'INCOME' | 'EXPENSE';
  status: string;
  amount: number;
  gross_amount?: number;
  date: number;
  fees?: number;
  tax?: number;
  is_transfer?: boolean;
  transfer_to_account_id?: string;
  transfer_from_account_id?: string;
  paired_draft_id?: string;
}

export interface TransferPair {
  expenseId: string;
  incomeId: string;
  expenseAccountId: string;
  incomeAccountId: string;
}

/** Both bank SMS for one transfer arrive within minutes of each other. */
export const TRANSFER_PAIR_WINDOW_MS = 15 * 60 * 1000;

const AMOUNT_EPSILON = 0.01;

/**
 * The debit leg's amount may include the sender bank's fees + VAT (CBE's
 * "total of ETB X"), while the credit leg carries the base amount — so match
 * the income against either the gross or the net (gross minus fees/tax).
 */
function amountsMatch(expense: PairableDraft, income: PairableDraft): boolean {
  const gross = expense.gross_amount ?? expense.amount;
  const net = expense.amount;
  return (
    Math.abs(income.amount - gross) < AMOUNT_EPSILON ||
    Math.abs(income.amount - net) < AMOUNT_EPSILON
  );
}

export interface TransferCandidate extends TransferPair {
  gapMs: number;
  confidence: 'HIGH' | 'MEDIUM';
}

/**
 * Suggest opposite SMS legs for human review. Same-day amount matches are
 * useful evidence, but never strong enough to merge records automatically.
 */
export function findTransferCandidates(
  draft: PairableDraft,
  drafts: PairableDraft[],
  windowMs = 24 * 60 * 60 * 1000
): TransferCandidate[] {
  if (draft.status !== 'PENDING') return [];
  return drafts
    .filter(other => other.id !== draft.id && other.status === 'PENDING'
      && other.account_id !== draft.account_id && other.type !== draft.type)
    .map(other => {
      const expense = draft.type === 'EXPENSE' ? draft : other;
      const income = draft.type === 'INCOME' ? draft : other;
      const gapMs = Math.abs(expense.date - income.date);
      const explicit = expense.transfer_to_account_id === income.account_id
        || income.transfer_from_account_id === expense.account_id;
      const expenseDay = new Date(expense.date);
      const incomeDay = new Date(income.date);
      const sameCalendarDate = expenseDay.getFullYear() === incomeDay.getFullYear()
        && expenseDay.getMonth() === incomeDay.getMonth()
        && expenseDay.getDate() === incomeDay.getDate();
      if (gapMs > windowMs || (!sameCalendarDate && gapMs > TRANSFER_PAIR_WINDOW_MS) || !amountsMatch(expense, income)) return null;
      return {
        expenseId: expense.id,
        incomeId: income.id,
        expenseAccountId: expense.account_id,
        incomeAccountId: income.account_id,
        gapMs,
        confidence: explicit || gapMs <= TRANSFER_PAIR_WINDOW_MS ? 'HIGH' as const : 'MEDIUM' as const,
      };
    })
    .filter((item): item is TransferCandidate => item !== null)
    .sort((a, b) => a.gapMs - b.gapMs);
}

/**
 * Find debit/credit draft pairs that represent one transfer between the
 * user's own accounts. Greedy on the smallest time gap, so when several
 * candidates exist the closest-in-time legs pair up first.
 */
export function findSelfTransferPairs(
  drafts: PairableDraft[],
  windowMs: number = TRANSFER_PAIR_WINDOW_MS
): TransferPair[] {
  const pending = drafts.filter(d => d.status === 'PENDING' && !d.paired_draft_id);
  const expenses = pending.filter(d => d.type === 'EXPENSE');
  const incomes = pending.filter(d => d.type === 'INCOME');

  const candidates: Array<{ e: PairableDraft; i: PairableDraft; gap: number }> = [];
  for (const e of expenses) {
    for (const i of incomes) {
      if (i.account_id === e.account_id) continue;
      // Time and amount alone are insufficient evidence of an own-account transfer.
      if (e.transfer_to_account_id !== i.account_id && i.transfer_from_account_id !== e.account_id) continue;
      // When a leg already names its peer account (text-detected
      // "to/from your X account"), only accept that account as the partner.
      if (e.transfer_to_account_id && e.transfer_to_account_id !== i.account_id) continue;
      if (i.transfer_from_account_id && i.transfer_from_account_id !== e.account_id) continue;
      const gap = Math.abs(e.date - i.date);
      if (gap > windowMs) continue;
      if (!amountsMatch(e, i)) continue;
      candidates.push({ e, i, gap });
    }
  }

  candidates.sort((a, b) => a.gap - b.gap);

  const usedExpenses = new Set<string>();
  const usedIncomes = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const c of candidates) {
    if (usedExpenses.has(c.e.id) || usedIncomes.has(c.i.id)) continue;
    usedExpenses.add(c.e.id);
    usedIncomes.add(c.i.id);
    pairs.push({
      expenseId: c.e.id,
      incomeId: c.i.id,
      expenseAccountId: c.e.account_id,
      incomeAccountId: c.i.account_id,
    });
  }
  return pairs;
}
