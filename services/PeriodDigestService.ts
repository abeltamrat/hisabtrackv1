import type { RecurringTransaction, Transaction } from '@/types/database';
import { operatingTransactions, sumMoney } from '@/utils/finance';

export interface MoneyDigest { key: string; kind: 'WEEKLY' | 'MONTHLY'; start: number; end: number; income: number; expense: number; fees: number; categoryChanges: Array<{ category: string; current: number; previous: number; change: number }>; upcomingCommitments: number; pendingDrafts: number; discrepancies: number; evidenceIds: string[] }
const bounds = (kind: MoneyDigest['kind'], now: Date) => {
  const currentStart = kind === 'MONTHLY' ? new Date(now.getFullYear(), now.getMonth(), 1) : (() => { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d; })();
  const end = new Date(currentStart.getTime() - 1); const start = new Date(currentStart);
  if (kind === 'MONTHLY') start.setMonth(start.getMonth() - 1); else start.setDate(start.getDate() - 7);
  const previousEnd = new Date(start.getTime() - 1); const previousStart = new Date(start); if (kind === 'MONTHLY') previousStart.setMonth(previousStart.getMonth() - 1); else previousStart.setDate(previousStart.getDate() - 7);
  return { start: start.getTime(), end: end.getTime(), previousStart: previousStart.getTime(), previousEnd: previousEnd.getTime() };
};

export function createPeriodDigest(kind: MoneyDigest['kind'], transactions: Transaction[], recurring: RecurringTransaction[], options: { pendingDrafts?: number; discrepancies?: number; now?: Date } = {}): MoneyDigest {
  const b = bounds(kind, options.now || new Date()); const operating = operatingTransactions(transactions);
  const current = operating.filter(tx => tx.date >= b.start && tx.date <= b.end); const previous = operating.filter(tx => tx.date >= b.previousStart && tx.date <= b.previousEnd);
  const categories = [...new Set([...current, ...previous].map(tx => tx.category))];
  const categoryChanges = categories.map(category => {
    const currentAmount = sumMoney(current.filter(tx => tx.type === 'EXPENSE' && tx.category === category).map(tx => tx.amount)); const previousAmount = sumMoney(previous.filter(tx => tx.type === 'EXPENSE' && tx.category === category).map(tx => tx.amount));
    return { category, current: currentAmount, previous: previousAmount, change: Math.round((currentAmount - previousAmount) * 100) / 100 };
  }).filter(row => row.current || row.previous).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const windowEnd = b.end + (kind === 'WEEKLY' ? 7 : 31) * 86400000;
  const localStart = new Date(b.start); const localKey = `${localStart.getFullYear()}-${String(localStart.getMonth() + 1).padStart(2, '0')}-${String(localStart.getDate()).padStart(2, '0')}`;
  return { key: `${kind.toLowerCase()}:${localKey}`, kind, start: b.start, end: b.end, income: sumMoney(current.filter(tx => tx.type === 'INCOME').map(tx => tx.amount)), expense: sumMoney(current.filter(tx => tx.type === 'EXPENSE').map(tx => tx.amount)), fees: sumMoney(transactions.filter(tx => tx.date >= b.start && tx.date <= b.end).map(tx => (tx.fees || 0) + (tx.tax || 0))), categoryChanges: categoryChanges.slice(0, 3), upcomingCommitments: sumMoney(recurring.filter(rule => rule.isActive && rule.type === 'EXPENSE' && rule.nextDate > b.end && rule.nextDate <= windowEnd).map(rule => rule.amount)), pendingDrafts: options.pendingDrafts || 0, discrepancies: options.discrepancies || 0, evidenceIds: current.map(tx => tx.id) };
}

export function formatPeriodDigest(digest: MoneyDigest, currency: string, hidden = false, language = 'en') {
  const money = (amount: number) => hidden ? '••••' : `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const title = language.startsWith('am') ? (digest.kind === 'WEEKLY' ? 'ሳምንታዊ የገንዘብ ማጠቃለያ' : 'ወርሃዊ የገንዘብ ማጠቃለያ') : `${digest.kind === 'WEEKLY' ? 'Weekly' : 'Monthly'} money digest`;
  const change = digest.categoryChanges[0];
  const message = `${money(digest.expense)} spent, ${money(digest.income)} received.${change ? ` ${change.category} changed by ${money(change.change)} versus the previous like-for-like period.` : ''}${digest.fees ? ` Fees: ${money(digest.fees)}.` : ''}${digest.upcomingCommitments ? ` Upcoming commitments: ${money(digest.upcomingCommitments)}.` : ''}${digest.pendingDrafts ? ` ${digest.pendingDrafts} draft(s) need review.` : ''}${digest.discrepancies ? ` ${digest.discrepancies} balance gap(s) remain.` : ''}`;
  return { title, message };
}
