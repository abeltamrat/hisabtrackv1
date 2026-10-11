import type { ProjectLink, Transaction } from '@/types/database';
import { money, sumMoney } from '@/utils/finance';

export interface ProjectEntry { transaction: Transaction; amount: number; splitId?: string; lineId?: string }
export interface ProjectTotals { paid: number; received: number; net: number; count: number; lastDate?: number }

export const projectKey = (link: Pick<ProjectLink, 'source' | 'id'>) => `${link.source}:${link.id}`;

/**
 * Money attributed to each project. A split's own project wins; a split
 * without one inherits the transaction's project; a transaction without
 * splits counts in full. Transfers between own accounts are not project money.
 */
export function projectEntries(transactions: Transaction[]): Map<string, ProjectEntry[]> {
  const byProject = new Map<string, ProjectEntry[]>();
  const add = (link: ProjectLink | undefined, entry: ProjectEntry) => {
    if (!link) return;
    const key = projectKey(link);
    byProject.set(key, [...(byProject.get(key) ?? []), entry]);
  };
  for (const tx of transactions) {
    if (tx.type === 'TRANSFER') continue;
    // Itemized purchases attribute per line (a line's own project wins); any
    // un-itemized remainder stays with the transaction's project.
    if (tx.lines?.length) {
      for (const line of tx.lines) add(line.project ?? tx.project, { transaction: tx, amount: line.amount, lineId: line.id });
      const remainder = money(tx.amount - sumMoney(tx.lines.map(line => line.amount)));
      if (remainder > 0) add(tx.project, { transaction: tx, amount: remainder });
      continue;
    }
    if (tx.splits?.length) {
      for (const split of tx.splits) add(split.project ?? tx.project, { transaction: tx, amount: split.amount, splitId: split.id });
    } else {
      add(tx.project, { transaction: tx, amount: tx.amount });
    }
  }
  return byProject;
}

export function projectTotals(entries: ProjectEntry[] = []): ProjectTotals {
  const paid = sumMoney(entries.filter(e => e.transaction.type === 'EXPENSE').map(e => e.amount));
  const received = sumMoney(entries.filter(e => e.transaction.type === 'INCOME').map(e => e.amount));
  return {
    paid, received, net: money(received - paid),
    count: new Set(entries.map(e => e.transaction.id)).size,
    lastDate: entries.length ? Math.max(...entries.map(e => e.transaction.date)) : undefined,
  };
}

/** Latest title snapshot seen on any transaction, for projects no longer in the synced list. */
export function snapshotLinks(transactions: Transaction[]): Map<string, ProjectLink> {
  const links = new Map<string, { link: ProjectLink; date: number }>();
  for (const tx of transactions) {
    for (const link of [tx.project, ...(tx.splits || []).map(s => s.project)]) {
      if (!link) continue;
      const key = projectKey(link);
      if (!links.has(key) || links.get(key)!.date < tx.date) links.set(key, { link, date: tx.date });
    }
  }
  return new Map([...links].map(([key, value]) => [key, value.link]));
}
