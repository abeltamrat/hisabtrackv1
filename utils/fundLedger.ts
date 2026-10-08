import type { FundEntry, SharedFund, Transaction } from '@/types/database';

/**
 * How a shared fund shows up in the OWNER's own books.
 *
 * The owner holds a cash account for the fund ("Fund – Abebe"). Every active
 * entry maps to exactly one ledger row with a deterministic id, so running
 * this on any device, any number of times, produces the same books. Entries
 * that need the owner's answer still post wherever that is safe and are
 * listed as actions; nothing is ever guessed into income.
 */
export type FundActionKind = 'SOURCE_ACCOUNT' | 'RETURN_ACCOUNT' | 'CLASSIFY_DEPOSIT';

export interface FundAction {
  entryId: string;
  kind: FundActionKind;
  amount: number;
  label: string;
}

export interface MirrorRow {
  entryId: string;
  input: Omit<Transaction, 'id'>;
}

export interface MirrorPlan {
  rows: MirrorRow[];
  actions: FundAction[];
}

/** Fields that tie a custodian's own ledger row to its fund entry. */
export function custodianFundFields(fundId: string, entryId: string) {
  return { purpose: 'FINANCING' as const, operation_id: `fund-${entryId}`, fund_id: fundId, fund_entry_id: entryId };
}

export const mirrorOperationId = (entryId: string) => `fund-mirror-${entryId}`;
export const mirrorTransactionId = (entryId: string) => `op-${mirrorOperationId(entryId)}`;
export const UNCLASSIFIED_DEPOSIT = 'Fund deposit';

export function planFundMirror(
  fund: SharedFund,
  entries: FundEntry[],
  context: { fundAccountId: string; returnAccountId?: string; accountIds: Set<string> },
): MirrorPlan {
  const rows: MirrorRow[] = [];
  const actions: FundAction[] = [];
  const holder = fund.custodianName || 'the custodian';
  const usable = (id: string | null | undefined): id is string => !!id && id !== context.fundAccountId && context.accountIds.has(id);

  for (const entry of entries) {
    if (entry.status !== 'ACTIVE') continue;
    const base = {
      amount: entry.amount,
      date: entry.date,
      tags: entry.tags,
      reference_number: entry.reference_number,
      receipt_url: entry.receipt_url,
      operation_id: mirrorOperationId(entry.id),
      fund_id: fund.id,
      fund_entry_id: entry.id,
      fund_mirror: true,
    };

    if (entry.kind === 'DEPOSIT' && (entry.source === 'OWNER' || entry.source === 'OWNER_UNRECORDED')) {
      if (!usable(entry.ownerAccountId)) {
        actions.push({ entryId: entry.id, kind: 'SOURCE_ACCOUNT', amount: entry.amount, label: `Which account did you send ${holder} this from?` });
        continue;
      }
      rows.push({ entryId: entry.id, input: {
        ...base, type: 'TRANSFER', account_id: entry.ownerAccountId, to_account_id: context.fundAccountId,
        category: 'Transfer', purpose: 'OPERATING', description: entry.description || `Sent to ${holder} for ${fund.name}`,
        sender_receiver: holder,
      } as Omit<Transaction, 'id'> });
      continue;
    }

    if (entry.kind === 'DEPOSIT') {
      // Someone paid the owner through the custodian. Until the owner says what
      // it was, it moves cash without counting as income.
      if (!entry.ownerPurpose) actions.push({ entryId: entry.id, kind: 'CLASSIFY_DEPOSIT', amount: entry.amount, label: `What was ${entry.payerName || 'this'}'s payment for?` });
      rows.push({ entryId: entry.id, input: {
        ...base, type: 'INCOME', account_id: context.fundAccountId,
        category: entry.ownerCategory || UNCLASSIFIED_DEPOSIT, purpose: entry.ownerPurpose || 'FINANCING',
        description: entry.description && entry.description !== 'Fund deposit' ? entry.description : `${entry.payerName || 'Deposit'} via ${holder}`,
        sender_receiver: entry.payerName,
      } as Omit<Transaction, 'id'> });
      continue;
    }

    if (entry.kind === 'SPEND') {
      // The owner's category wins; the custodian's split only applies when the
      // owner has not re-categorised the payment as a whole.
      const splits = entry.ownerSplits ?? (entry.ownerCategory ? undefined : entry.splits);
      rows.push({ entryId: entry.id, input: {
        ...base, type: 'EXPENSE', account_id: context.fundAccountId,
        category: entry.ownerCategory || entry.category || 'Uncategorized', purpose: entry.ownerPurpose || 'OPERATING',
        description: entry.description || 'Fund payment', sender_receiver: entry.recipient,
        ...(splits && splits.length >= 2 ? { splits } : {}),
      } as Omit<Transaction, 'id'> });
      continue;
    }

    // RETURN: the money came back to one of the owner's accounts.
    const target = usable(entry.ownerAccountId) ? entry.ownerAccountId : usable(context.returnAccountId) ? context.returnAccountId : null;
    if (!target) {
      actions.push({ entryId: entry.id, kind: 'RETURN_ACCOUNT', amount: entry.amount, label: `Which account did ${holder}'s return land in?` });
      continue;
    }
    rows.push({ entryId: entry.id, input: {
      ...base, type: 'TRANSFER', account_id: context.fundAccountId, to_account_id: target,
      category: 'Transfer', purpose: 'OPERATING', description: entry.description || `Returned by ${holder}`, sender_receiver: holder,
    } as Omit<Transaction, 'id'> });
  }
  return { rows, actions };
}

/** The fields that decide whether an existing mirror row is still right. */
export function mirrorSignature(row: Partial<Transaction>): string {
  return JSON.stringify([
    row.type, row.account_id, row.to_account_id ?? null, Math.round(Number(row.amount) * 100), row.category, row.purpose ?? null,
    row.date, (row.splits || []).map(split => [split.category, Math.round(split.amount * 100)]),
    row.sender_receiver ?? null, row.description ?? null, row.receipt_url ?? null, row.reference_number ?? null, (row.tags || []).join('|'),
  ]);
}
