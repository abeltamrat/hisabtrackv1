import type { Transaction } from '@/types/database';

/** Bank references are often displayed with spaces or punctuation that vary by SMS template. */
export function normalizeSmsReference(value?: string): string {
  return (value ?? '').toLocaleUpperCase().replace(/[^A-Z0-9]/g, '');
}

const SAME_EVENT_WINDOW_MS = 5 * 60 * 1000;
const sameMoney = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);
const sameTime = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= SAME_EVENT_WINDOW_MS;

export type SmsEvidence = {
  account_id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  gross_amount?: number;
  fees?: number;
  tax?: number;
  date: number;
  sms_id?: string;
  reference_number?: string;
  receipt_url?: string;
};

type TransactionEvidence = Pick<Transaction,
  'account_id' | 'type' | 'amount' | 'gross_amount' | 'fees' | 'tax' | 'date' |
  'sms_id' | 'reference_number' | 'receipt_url' | 'to_account_id'
>;

/**
 * Match an SMS to the same ledger account leg. A reference alone is not a
 * transaction identity: some banks reuse or truncate references. Requiring
 * the same direction, amount and near-identical time avoids hiding a real
 * payment that happens to reuse a reference.
 */
export function isSameSmsTransaction(sms: SmsEvidence, record: TransactionEvidence): boolean {
  let expectedType: 'INCOME' | 'EXPENSE' | undefined;
  let expectedAmount: number | undefined;

  if (record.type === 'TRANSFER') {
    if (sms.type === 'EXPENSE' && sms.account_id === record.account_id) {
      expectedType = 'EXPENSE';
      expectedAmount = record.amount;
    } else if (sms.type === 'INCOME' && sms.account_id === record.to_account_id) {
      expectedType = 'INCOME';
      expectedAmount = Math.max(0, record.amount - (record.fees ?? 0) - (record.tax ?? 0));
    }
  } else if (sms.account_id === record.account_id && sms.type === record.type) {
    expectedType = record.type;
    expectedAmount = record.type === 'EXPENSE' ? (record.gross_amount ?? record.amount) : record.amount;
  }

  if (!expectedType || expectedAmount === undefined) return false;

  return sameEvidence(sms, record, expectedType, expectedAmount);
}

export function isSameSmsDraft(sms: SmsEvidence, draft: SmsEvidence): boolean {
  if (sms.account_id !== draft.account_id) return false;
  if (sms.sms_id && sms.sms_id === draft.sms_id) return true;
  if (sms.type !== draft.type) return false;
  const smsAmount = sms.type === 'EXPENSE'
    ? (sms.gross_amount ?? sms.amount + (sms.fees ?? 0) + (sms.tax ?? 0))
    : sms.amount;
  const draftAmount = draft.type === 'EXPENSE'
    ? (draft.gross_amount ?? draft.amount + (draft.fees ?? 0) + (draft.tax ?? 0))
    : draft.amount;
  return sameEvidence(sms, draft, sms.type, draftAmount, smsAmount);
}

function sameEvidence(
  sms: SmsEvidence,
  record: Pick<SmsEvidence, 'date' | 'sms_id' | 'reference_number' | 'receipt_url'>,
  expectedType: 'INCOME' | 'EXPENSE',
  expectedAmount: number,
  smsAmount = sms.type === 'EXPENSE'
    ? (sms.gross_amount ?? sms.amount + (sms.fees ?? 0) + (sms.tax ?? 0))
    : sms.amount,
): boolean {
  if (sms.sms_id && sms.sms_id === record.sms_id) return true;
  const reference = normalizeSmsReference(sms.reference_number);
  const sameReference = !!reference && reference === normalizeSmsReference(record.reference_number);
  const sameReceipt = !!sms.receipt_url && sms.receipt_url === record.receipt_url;
  return sms.type === expectedType
    && (sameReference || sameReceipt)
    && sameMoney(smsAmount, expectedAmount)
    && sameTime(sms.date, record.date);
}
