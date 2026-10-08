import type { RecurringTransaction, Transaction } from '@/types/database';
import type { DraftTransaction } from '@/services/DraftTransactionService';
import { EnhancedSMSParser } from '@/utils/enhancedSMSParser';

const DAY = 24 * 60 * 60 * 1000;
const money = (value?: number) => Math.round(Number(value || 0) * 100) / 100;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mad = (values: number[], center = median(values)) => median(values.map(value => Math.abs(value - center)));

export const normalizeRecipient = (value?: string) => (value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const transactionKind = (draft: DraftTransaction) => draft.is_transfer ? 'TRANSFER' : draft.type;
const amountBand = (amount: number) => amount < 500 ? 'under 500' : amount < 5_000 ? '500-4,999' : amount < 50_000 ? '5,000-49,999' : '50,000+';
const bankKey = (draft: DraftTransaction) => EnhancedSMSParser.detectBankType(draft.sms_sender || '', draft.raw_sms);
const isReversal = (value: Pick<DraftTransaction, 'raw_sms' | 'description'>) => /\b(refund(?:ed)?|reversal|reversed|chargeback|cancelled transaction)\b/i.test(`${value.description} ${value.raw_sms}`);

export type SmartAlertKind = 'FEE_CHANGE' | 'UNUSUAL_PAYMENT' | 'POSSIBLE_DOUBLE_DEBIT' | 'REPEATED_NOTIFICATION';
export interface SmartAlert {
  id: string;
  kind: SmartAlertKind;
  title: string;
  explanation: string;
  draftId: string;
  supportingIds: string[];
  observed: number;
  baseline?: { median: number; low: number; high: number; samples: number; label: string };
  severity: 'INFO' | 'WARNING';
}

export interface SmartAlertFeedback { alertId: string; decision: 'EXPECTED' | 'DISMISSED'; at: number }

const robustBaseline = (values: number[], label: string) => {
  if (values.length < 4) return undefined;
  const center = median(values);
  const spread = Math.max(3 * mad(values, center), Math.abs(center) * 0.25, 0.01);
  return { median: money(center), low: money(Math.max(0, center - spread)), high: money(center + spread), samples: values.length, label };
};

const samePayment = (a: Pick<DraftTransaction, 'account_id' | 'amount' | 'sender_receiver'>, b: Pick<DraftTransaction, 'account_id' | 'amount' | 'sender_receiver'>) =>
  a.account_id === b.account_id && money(a.amount) === money(b.amount)
  && !!normalizeRecipient(a.sender_receiver)
  && normalizeRecipient(a.sender_receiver) === normalizeRecipient(b.sender_receiver);

/** Detects anomalies from SMS evidence. It never mutates drafts or ledger rows. */
export function analyzeSmsIntelligence(
  drafts: DraftTransaction[],
  feedback: SmartAlertFeedback[] = [],
): SmartAlert[] {
  const hidden = new Set(feedback.map(item => item.alertId));
  const history = drafts.filter(item => item.status === 'RECORDED' && !isReversal(item));
  const pending = drafts.filter(item => item.status === 'PENDING' && !isReversal(item));
  const alerts: SmartAlert[] = [];

  for (const draft of pending) {
    const peers = history.filter(item => bankKey(item) === bankKey(draft)
      && transactionKind(item) === transactionKind(draft)
      && amountBand(item.amount) === amountBand(draft.amount));
    const components: Array<[string, keyof DraftTransaction]> = [
      ['service charge', 'service_charge'], ['VAT', 'vat'], ['disaster-recovery charge', 'disaster_recovery_fee'],
    ];
    for (const [label, field] of components) {
      const observed = money(draft[field] as number | undefined);
      if (observed <= 0) continue;
      const baseline = robustBaseline(peers.map(item => money(item[field] as number | undefined)).filter(value => value > 0), `${bankKey(draft)} ${transactionKind(draft).toLocaleLowerCase()} ${amountBand(draft.amount)} ${label}`);
      if (!baseline || (observed >= baseline.low && observed <= baseline.high)) continue;
      const id = `fee:${draft.id}:${String(field)}`;
      if (!hidden.has(id)) alerts.push({
        id, kind: 'FEE_CHANGE', draftId: draft.id, supportingIds: peers.filter(item => money(item[field] as number | undefined) > 0).map(item => item.id),
        title: `${label} differs from recent ${bankKey(draft).toUpperCase()} charges`, observed, baseline, severity: 'WARNING',
        explanation: `${label} is ETB ${observed.toFixed(2)}. The median is ETB ${baseline.median.toFixed(2)} across ${baseline.samples} comparable ${amountBand(draft.amount)} transactions; the robust expected range is ETB ${baseline.low.toFixed(2)}-ETB ${baseline.high.toFixed(2)}.`,
      });
    }

    const recipient = normalizeRecipient(draft.sender_receiver);
    const recipientHistory = history.filter(item => normalizeRecipient(item.sender_receiver) === recipient && item.type === draft.type && item.account_id === draft.account_id);
    const amountBaseline = robustBaseline(recipientHistory.map(item => item.amount), `${draft.sender_receiver || 'recipient'} payment`);
    if (recipient && amountBaseline && (draft.amount < amountBaseline.low || draft.amount > amountBaseline.high)) {
      const id = `amount:${draft.id}`;
      if (!hidden.has(id)) alerts.push({ id, kind: 'UNUSUAL_PAYMENT', draftId: draft.id, supportingIds: recipientHistory.map(item => item.id), title: `Unusual amount for ${draft.sender_receiver}`, observed: draft.amount, baseline: amountBaseline, severity: 'WARNING', explanation: `This payment is ETB ${draft.amount.toFixed(2)}. The median of ${amountBaseline.samples} previous payments is ETB ${amountBaseline.median.toFixed(2)}, with a robust expected range of ETB ${amountBaseline.low.toFixed(2)}-ETB ${amountBaseline.high.toFixed(2)}.` });
    }

    const candidates = drafts.filter(item => item.id !== draft.id && samePayment(draft, item) && Math.abs(item.date - draft.date) <= 15 * 60 * 1000);
    const duplicate = candidates.sort((a, b) => Math.abs(a.date - draft.date) - Math.abs(b.date - draft.date))[0];
    if (duplicate) {
      const repeated = !!((draft.reference_number && duplicate.reference_number === draft.reference_number)
        || (draft.receipt_url && duplicate.receipt_url === draft.receipt_url));
      const id = `${repeated ? 'repeat' : 'duplicate'}:${[draft.id, duplicate.id].sort().join(':')}`;
      if (!hidden.has(id)) alerts.push({
        id, kind: repeated ? 'REPEATED_NOTIFICATION' : 'POSSIBLE_DOUBLE_DEBIT', draftId: draft.id, supportingIds: [duplicate.id], observed: draft.amount,
        title: repeated ? 'Repeated SMS for one payment' : 'Possible double debit', severity: repeated ? 'INFO' : 'WARNING',
        explanation: repeated
          ? `Two SMS records share the same account, recipient, amount and ${draft.reference_number ? 'reference' : 'receipt link'}. Review them; HisabTrack has not deleted either record.`
          : `Two debits to ${draft.sender_receiver} for ETB ${draft.amount.toFixed(2)} occurred within 15 minutes. Their references do not prove they are the same payment, so both records remain unchanged.`,
      });
    }
  }
  return [...new Map(alerts.map(alert => [alert.id, alert])).values()];
}

export type RecurringAlertKind = 'NOT_RECORDED' | 'CHANGED_AMOUNT';
export interface RecurringAlert {
  id: string;
  kind: RecurringAlertKind;
  recurringId: string;
  title: string;
  explanation: string;
  expectedDate: number;
  expectedAmount: number;
  observedTransactionId?: string;
  observedAmount?: number;
  graceDays: number;
}

const calendarDays = (from: number, to: number) => {
  const a = new Date(from); a.setHours(12, 0, 0, 0);
  const b = new Date(to); b.setHours(12, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DAY);
};
const addCalendarDays = (timestamp: number, days: number) => {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return date.getTime();
};
const identityMatches = (rule: RecurringTransaction, transaction: Transaction) => {
  const identity = normalizeRecipient(rule.name) || normalizeRecipient(rule.description);
  const candidate = normalizeRecipient(transaction.sender_receiver) || normalizeRecipient(transaction.description);
  return !!identity && (candidate.includes(identity) || identity.includes(candidate));
};
const graceFor = (rule: RecurringTransaction) => {
  const date = new Date(rule.nextDate);
  const weekend = date.getDay() === 6 ? 2 : date.getDay() === 0 ? 1 : 0;
  const base = rule.frequency === 'DAILY' ? 1 : rule.frequency === 'WEEKLY' ? 2 : rule.frequency === 'MONTHLY' ? 3 : 7;
  return base + weekend;
};

export function findRecurringEvidence(rule: RecurringTransaction, transactions: Transaction[]): { exact?: Transaction; changed?: Transaction; graceDays: number } {
  const graceDays = graceFor(rule);
  const candidates = transactions.filter(transaction => transaction.account_id === rule.accountId
    && transaction.type === rule.type
    && Math.abs(calendarDays(rule.nextDate, transaction.date)) <= graceDays
    && (transaction.operation_id === `recurring-${rule.id}-${rule.nextDate}` || identityMatches(rule, transaction)));
  const exact = candidates.find(transaction => Math.abs(transaction.amount - rule.amount) <= Math.max(1, rule.amount * 0.1));
  const changed = exact ? undefined : candidates.sort((a, b) => Math.abs(calendarDays(rule.nextDate, a.date)) - Math.abs(calendarDays(rule.nextDate, b.date)))[0];
  return { exact, changed, graceDays };
}

/** Matches expected occurrences to evidence without creating ledger postings. */
export function analyzeRecurringExpectations(rules: RecurringTransaction[], transactions: Transaction[], now = Date.now()): RecurringAlert[] {
  const alerts: RecurringAlert[] = [];
  for (const rule of rules.filter(item => item.isActive && item.nextDate <= now)) {
    const { exact, changed, graceDays } = findRecurringEvidence(rule, transactions);
    if (exact) continue;
    if (changed) {
      alerts.push({ id: `recurring:changed:${rule.id}:${rule.nextDate}`, kind: 'CHANGED_AMOUNT', recurringId: rule.id, title: `${rule.name} amount changed`, explanation: `${rule.name} was expected near ${new Date(rule.nextDate).toLocaleDateString()} at ETB ${rule.amount.toFixed(2)}, but a matching posting is ETB ${changed.amount.toFixed(2)}. Confirm the new amount only if this change should continue.`, expectedDate: rule.nextDate, expectedAmount: rule.amount, observedTransactionId: changed.id, observedAmount: changed.amount, graceDays });
    } else if (now > addCalendarDays(rule.nextDate, graceDays)) {
      alerts.push({ id: `recurring:missing:${rule.id}:${rule.nextDate}`, kind: 'NOT_RECORDED', recurringId: rule.id, title: `${rule.name} has not been recorded`, explanation: `${rule.name} usually arrives or is paid by ${new Date(rule.nextDate).toLocaleDateString()}. No matching transaction was recorded within the ${graceDays}-day grace window. This does not prove the money was not received or paid.`, expectedDate: rule.nextDate, expectedAmount: rule.amount, graceDays });
    }
  }
  return alerts;
}

export function extractIdentityHints(text: string): string[] {
  const hints = new Set<string>();
  for (const match of text.matchAll(/(?:\+?251|0)?9[\d*]{8}/g)) hints.add(`phone:${match[0].replace(/[^\d*]/g, '').slice(-9)}`);
  for (const match of text.matchAll(/(?:account|a\/c|acct?)\s*(?:number\s*)?([\d*]{4,20})/gi)) {
    const visible = match[1].replace(/\D/g, '');
    if (visible.length >= 4) hints.add(`account:${visible.slice(-4)}`);
  }
  return [...hints];
}

export function recipientSimilarity(left?: string, right?: string): number {
  const a = normalizeRecipient(left).split(' ').filter(Boolean);
  const b = normalizeRecipient(right).split(' ').filter(Boolean);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 1;
  const common = a.filter(token => b.includes(token)).length;
  const initialsA = a.map(token => token[0]).join('');
  const initialsB = b.map(token => token[0]).join('');
  return Math.max(common / Math.max(a.length, b.length), initialsA === initialsB ? 0.85 : 0);
}

export function selectRecipientProfile<T extends { aliases: string[]; verifiedHints: string[] }>(profiles: T[], name?: string, rawEvidence = ''): T | undefined {
  const normalized = normalizeRecipient(name);
  const hints = extractIdentityHints(rawEvidence);
  const exact = profiles.filter(profile => profile.aliases.some(alias => normalizeRecipient(alias) === normalized));
  if (exact.length === 1) {
    const profile = exact[0];
    if (hints.length && profile.verifiedHints.length && !profile.verifiedHints.some(hint => hints.includes(hint))) return undefined;
    return profile;
  }
  if (hints.length) {
    const hinted = (exact.length ? exact : profiles).filter(profile => profile.verifiedHints.some(hint => hints.includes(hint)));
    if (hinted.length === 1) return hinted[0];
  }
  return undefined;
}
