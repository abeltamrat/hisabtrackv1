import type { ProjectLink, PurchaseLine, TransactionSplit } from '@/types/database';
import { money, sumMoney } from '@/utils/finance';

/**
 * Items on a split live with their part: each line's split_id names the part
 * it belongs to. Lines stay in one flat list on the transaction so item prices
 * and reports read them the same way with or without a split.
 */

const isBlank = (line: PurchaseLine) => !line.item.name.trim() && !(line.amount > 0);

/** Turning a split on: items already entered go to the first part that has room (else the first part). */
export function attachLinesToSplits(lines: PurchaseLine[], splits: Array<Pick<TransactionSplit, 'id' | 'amount'>>): PurchaseLine[] {
  if (!splits.length) return lines;
  const ids = new Set(splits.map(split => split.id));
  const used = new Map(splits.map(split => [split.id, sumMoney(lines.filter(line => line.split_id === split.id).map(line => line.amount))]));
  return lines.map(line => {
    if (line.split_id && ids.has(line.split_id)) return line;
    const target = splits.find(split => money(used.get(split.id)! + line.amount) <= money(split.amount)) ?? splits[0];
    used.set(target.id, money(used.get(target.id)! + line.amount));
    return { ...line, split_id: target.id };
  });
}

/** Turning a split off: items become the transaction's own again. */
export function detachLines(lines: PurchaseLine[]): PurchaseLine[] {
  return lines.map(({ split_id: _split, ...line }) => line);
}

/** What gets saved: no blank rows; with a split only items of existing parts, without one no part links. */
export function linesForSave(lines: PurchaseLine[], splits?: Array<Pick<TransactionSplit, 'id'>>): PurchaseLine[] {
  const filled = lines.filter(line => !isBlank(line));
  if (!splits?.length) return detachLines(filled);
  const ids = new Set(splits.map(split => split.id));
  return filled.filter(line => line.split_id && ids.has(line.split_id));
}

/** First part whose items add up to more than the part itself, if any. */
export function overfilledSplit(lines: PurchaseLine[], splits: TransactionSplit[]): { split: TransactionSplit; itemsTotal: number } | undefined {
  for (const split of splits) {
    const itemsTotal = sumMoney(lines.filter(line => line.split_id === split.id).map(line => line.amount));
    if (itemsTotal > money(split.amount)) return { split, itemsTotal };
  }
  return undefined;
}

/** "This is a project cost" unticked: no project anywhere on the form. */
export function withoutProjects<T extends { project?: ProjectLink }>(rows: T[]): T[] {
  return rows.map(row => {
    if (!row.project) return row;
    const { project: _project, ...rest } = row;
    return rest as T;
  });
}

/** Whether a saved transaction counts as a project cost (any project on it, its parts or its items). */
export const hasAnyProject = (tx: { project?: ProjectLink; splits?: Array<{ project?: ProjectLink }>; lines?: Array<{ project?: ProjectLink }> }) =>
  !!(tx.project || tx.splits?.some(split => split.project) || tx.lines?.some(line => line.project));
