import type { Account, RecurringFrequency, Transaction } from '@/types/database';

// The ledger currently supports currencies with two fractional digits. Arithmetic
// is performed in integer minor units and converted only at the storage/UI edge.
export function minor(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) throw new Error('Invalid monetary amount');
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100);
}
export const money = (value: number) => minor(value) / 100;
export const sumMoney = (values: number[]) => values.reduce((sum, value) => {
  const next = sum + minor(value);
  if (!Number.isSafeInteger(next)) throw new Error('Monetary total exceeds supported precision');
  return next;
}, 0) / 100;

export function purpose(t: Partial<Transaction>): string {
  if (t.purpose) return t.purpose;
  if (['Opening Balance', 'Balance Adjustment', 'Account Deletion'].includes(t.category || '')) return 'ADJUSTMENT';
  if (/^(Loan (to|from)|Initial repayment (from|to)|Repayment (from|to)|Confirmed (repayment from|payment to)|Payment (received from|made to)) /i.test(t.description || '') || t.category === 'Loan Repayment') return 'FINANCING';
  return 'OPERATING';
}
export function operatingIncome(t: Transaction) { return t.type === 'INCOME' ? purpose(t) === 'OPERATING' ? t.amount : (t.interest_amount || 0) : 0; }
export function operatingExpense(t: Transaction) {
  if (t.type === 'TRANSFER') return money((t.fees || 0) + (t.tax || 0));
  return t.type === 'EXPENSE' ? purpose(t) === 'OPERATING' ? t.amount : (t.interest_amount || 0) : 0;
}
export function cashDelta(t: Transaction) { return t.type === 'TRANSFER' ? -money((t.fees || 0) + (t.tax || 0)) : t.type === 'INCOME' ? t.amount : -t.amount; }
export function operatingTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.flatMap(t => {
    if (t.type === 'TRANSFER') {
      const amount = operatingExpense(t);
      return amount > 0 ? [{ ...t, id: `${t.id}:fees`, type: 'EXPENSE' as const, amount, category: 'Transfer Fees', purpose: 'OPERATING' as const, to_account_id: undefined }] : [];
    }
    if (purpose(t) === 'OPERATING') return [t];
    return t.interest_amount ? [{ ...t, amount: t.interest_amount, category: 'Loan Interest', purpose: 'OPERATING' as const }] : [];
  });
}
export function accountDelta(t: Transaction, id: string) {
  if (t.account_id === id) return t.type === 'INCOME' ? t.amount : -t.amount;
  return t.type === 'TRANSFER' && t.to_account_id === id ? money(t.amount - (t.fees || 0) - (t.tax || 0)) : 0;
}
export function validateTransaction(t: Partial<Transaction>, accounts?: Account[]) {
  if (!['INCOME', 'EXPENSE', 'TRANSFER'].includes(t.type || '') || !t.account_id || typeof t.amount !== 'number' || minor(t.amount) <= 0 || !Number.isFinite(t.date)) throw new Error('Invalid transaction');
  if (t.purpose && !['OPERATING', 'FINANCING', 'ADJUSTMENT'].includes(t.purpose)) throw new Error('Invalid transaction purpose');
  if (minor(t.interest_amount || 0) < 0 || minor(t.interest_amount || 0) > minor(t.amount!)) throw new Error('Invalid interest allocation');
  for (const fee of [t.fees ?? 0, t.tax ?? 0]) if (minor(fee) < 0) throw new Error('Fees cannot be negative');
  if (minor((t.fees || 0) + (t.tax || 0)) > minor(t.amount)) throw new Error('Fees exceed the amount');
  if (t.type === 'TRANSFER' && (!t.to_account_id || t.account_id === t.to_account_id)) throw new Error('Choose distinct transfer accounts');
  if (accounts) {
    const source = accounts.find(a => a.id === t.account_id);
    const target = accounts.find(a => a.id === t.to_account_id);
    if (!source || (t.type === 'TRANSFER' && !target)) throw new Error('Account no longer exists');
    if (target && target.currency !== source.currency) throw new Error('Cross-currency transfers require an exchange rate and are not supported');
  }
}

export function advanceDate(frequency: RecurringFrequency, timestamp: number, anchor = timestamp): number {
  const date = new Date(timestamp), original = new Date(anchor);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(original.getTime())) throw new Error('Invalid recurrence date');
  if (frequency === 'DAILY' || frequency === 'WEEKLY') date.setDate(date.getDate() + (frequency === 'DAILY' ? 1 : 7));
  else if (frequency === 'MONTHLY' || frequency === 'YEARLY') {
    const month = frequency === 'MONTHLY' ? date.getMonth() + 1 : original.getMonth();
    const year = date.getFullYear() + (frequency === 'YEARLY' ? 1 : 0);
    date.setDate(1);
    date.setFullYear(year, month, 1);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(original.getDate(), last));
  } else throw new Error('Invalid recurrence frequency');
  return date.getTime();
}

export function periodicPayment(principal: number, annualRate: number, periods: number, frequency: number) {
  if (minor(principal) <= 0 || !Number.isFinite(annualRate) || annualRate < 0 || !Number.isInteger(periods) || periods < 1 || periods > 12000 || !Number.isFinite(frequency) || frequency <= 0) throw new Error('Invalid loan terms');
  const r = annualRate / 100 / frequency;
  const value = r === 0 ? principal / periods : principal * r / (1 - Math.pow(1 + r, -periods));
  return money(value);
}

export function flatLoanSchedule(principal: number, annualRate: number, months: number) {
  if (!Number.isInteger(months) || months < 1 || months > 12000 || minor(principal) <= 0 || !Number.isFinite(annualRate) || annualRate < 0) throw new Error('Invalid loan terms');
  const p = minor(principal), interest = minor(principal * annualRate / 100 * months / 12);
  let balance = p;
  return Array.from({ length: months }, (_, index) => {
    const principalPart = Math.floor(p / months) + (index < p % months ? 1 : 0);
    const interestPart = Math.floor(interest / months) + (index < interest % months ? 1 : 0);
    balance -= principalPart;
    return { period: index + 1, payment: (principalPart + interestPart) / 100, principal: principalPart / 100, interest: interestPart / 100, balance: balance / 100 };
  });
}

/** Calendar periods, with an explicit upper bound excluding future postings. */
export function reportPeriod(range: string, now: number, oldest = now) {
  const today = new Date(now);
  let start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let previous = new Date(start);
  if (range === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    previous = new Date(start); previous.setDate(previous.getDate() - 7);
  } else if (range === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  } else if (range === 'year') {
    start = new Date(today.getFullYear(), 0, 1);
    previous = new Date(today.getFullYear() - 1, 0, 1);
  } else {
    const first = new Date(Math.min(oldest, now));
    start = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    previous = new Date(start);
  }
  const calendarDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  return { start: start.getTime(), end: now, previousStart: previous.getTime(), days: Math.max(1, calendarDay(today) - calendarDay(start) + 1) };
}
