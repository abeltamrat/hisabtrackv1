import type { Transaction, TransactionSplit } from '@/types/database';

export interface TransactionDisplayRow {
  key: string;
  transaction: Transaction;
  split: TransactionSplit | null;
  category: string;
  description: string;
  amount: number;
  tags?: string[];
}

/**
 * Expands transactions into the rows shown by the card view. Once a category,
 * tag or search filter is active, split allocations are authoritative: an
 * unrelated split must never reappear merely because its parent matched.
 */
export function buildTransactionDisplayRows(
  transactions: Transaction[],
  hasRowFilter: boolean,
  rowMatches: (row: Pick<TransactionDisplayRow, 'category' | 'description' | 'tags'>) => boolean,
): TransactionDisplayRow[] {
  const rows: TransactionDisplayRow[] = [];

  for (const transaction of transactions) {
    const candidates: TransactionDisplayRow[] = transaction.splits?.length
      ? transaction.splits.map(split => ({
          key: `${transaction.id}:${split.id}`,
          transaction,
          split,
          category: split.category,
          description: split.description || transaction.description,
          amount: split.amount,
          tags: split.tags?.length ? split.tags : transaction.tags,
        }))
      : [{
          key: transaction.id,
          transaction,
          split: null,
          category: transaction.category,
          description: transaction.description,
          amount: transaction.amount,
          tags: transaction.tags,
        }];

    rows.push(...(hasRowFilter ? candidates.filter(rowMatches) : candidates));
  }

  return rows;
}
