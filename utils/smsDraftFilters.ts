import type { DraftTransaction } from '@/services/DraftTransactionService';

export type SmsDraftTypeFilter = 'all' | 'income' | 'expense' | 'transfer';

/** Filters for the SMS transactions screen. Empty values mean "no filter". */
export interface SmsDraftFilters {
  /** Free text over description, recipient, reference, category and the SMS body. */
  search: string;
  accountIds: string[];
  /** Part of the recipient/sender name, or the linked person's name. */
  recipient: string;
  /** Inclusive bounds in ms; the UI sets the start and end of the chosen days. */
  dateFrom?: number;
  dateTo?: number;
  /** Inclusive; set both to the same value for an exact amount. */
  amountMin?: number;
  amountMax?: number;
  type: SmsDraftTypeFilter;
  categories: string[];
}

export const EMPTY_SMS_DRAFT_FILTERS: SmsDraftFilters = {
  search: '', accountIds: [], recipient: '', type: 'all', categories: [],
};

const norm = (value: string | undefined | null) => (value || '').toLocaleLowerCase().trim();

// A recorded draft shows what the user confirmed; filter on that, not the parser's guess.
const effectiveCategory = (draft: DraftTransaction) => draft.confirmation?.category || draft.category;
const effectiveRecipient = (draft: DraftTransaction) => [draft.confirmation?.recipient, draft.sender_receiver, draft.person_name_snapshot];

export function matchesSmsDraftFilters(draft: DraftTransaction, filters: SmsDraftFilters): boolean {
  if (filters.accountIds.length) {
    const accounts = [draft.account_id, draft.transfer_to_account_id, draft.transfer_from_account_id];
    if (!accounts.some(id => id && filters.accountIds.includes(id))) return false;
  }
  if (filters.type === 'transfer' && !draft.is_transfer) return false;
  if (filters.type === 'income' && (draft.type !== 'INCOME' || draft.is_transfer)) return false;
  if (filters.type === 'expense' && (draft.type !== 'EXPENSE' || draft.is_transfer)) return false;
  if (filters.dateFrom !== undefined && draft.date < filters.dateFrom) return false;
  if (filters.dateTo !== undefined && draft.date > filters.dateTo) return false;
  if (filters.amountMin !== undefined && draft.amount < filters.amountMin) return false;
  if (filters.amountMax !== undefined && draft.amount > filters.amountMax) return false;
  if (filters.categories.length && !filters.categories.includes(effectiveCategory(draft))) return false;
  const recipient = norm(filters.recipient);
  if (recipient && !effectiveRecipient(draft).some(name => norm(name).includes(recipient))) return false;
  const search = norm(filters.search);
  if (search) {
    const haystack = [
      draft.description, draft.confirmation?.description, effectiveCategory(draft), draft.reference_number,
      draft.raw_sms, draft.sms_sender, ...effectiveRecipient(draft), String(draft.amount),
    ].map(norm).join('\n');
    if (!search.split(/\s+/).every(word => haystack.includes(word))) return false;
  }
  return true;
}

/** Number of filters in use, for the badge on the Filters button. */
export function countActiveSmsDraftFilters(filters: SmsDraftFilters): number {
  return [
    !!norm(filters.search),
    filters.accountIds.length > 0,
    !!norm(filters.recipient),
    filters.dateFrom !== undefined || filters.dateTo !== undefined,
    filters.amountMin !== undefined || filters.amountMax !== undefined,
    filters.type !== 'all',
    filters.categories.length > 0,
  ].filter(Boolean).length;
}

/** Choices offered in the filter sheet, drawn from the drafts being shown. */
export function smsDraftFilterOptions(drafts: DraftTransaction[]) {
  const recipients = new Map<string, { name: string; count: number }>();
  const categories = new Map<string, number>();
  const accountIds = new Set<string>();
  for (const draft of drafts) {
    accountIds.add(draft.account_id);
    const name = (draft.confirmation?.recipient || draft.person_name_snapshot || draft.sender_receiver || '').trim();
    if (name) {
      const key = norm(name);
      const entry = recipients.get(key) || { name, count: 0 };
      entry.count++;
      recipients.set(key, entry);
    }
    const category = effectiveCategory(draft);
    if (category) categories.set(category, (categories.get(category) || 0) + 1);
  }
  return {
    accountIds: [...accountIds],
    // Most frequent first, so the usual counterparties are one tap away.
    recipients: [...recipients.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map(entry => entry.name),
    categories: [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name),
  };
}

/** Parses an amount typed by the user ("1,250.50" → 1250.5); blank or invalid → undefined. */
export function parseFilterAmount(text: string): number | undefined {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
