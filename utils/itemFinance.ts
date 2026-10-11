import type { ItemKind, ItemLink, ProjectLink, Transaction } from '@/types/database';
import { money, sumMoney } from '@/utils/finance';

/**
 * Items, prices and quantities derived from purchase lines. There is no
 * separate item table: every line carries a snapshot of its item, so the
 * catalog and price history are rebuilt from transactions that already sync
 * and back up.
 */

export interface PurchaseRecord {
  key: string;
  item: ItemLink;
  transactionId: string;
  lineId: string;
  type: 'INCOME' | 'EXPENSE';
  date: number;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
  supplier?: string;
  project?: ProjectLink;
}

export interface CatalogEntry {
  key: string;
  item: ItemLink;
  unit?: string;
  purchases: number;
  totalQuantity: number;
  totalSpent: number;
  last?: PurchaseRecord;
}

export interface PriceInsight {
  last?: PurchaseRecord;
  /** Lowest unit price in the window, with where/when. */
  best?: PurchaseRecord;
  /** Median of the most recent purchases — what "usual" means for overpay checks. */
  typical?: number;
  samples: number;
}

const DAY = 86400000;

export const normalizeItemName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
export const itemKey = (item: Pick<ItemLink, 'source' | 'id'>) => `${item.source}:${item.id}`;
export function localItem(name: string, extra: Partial<ItemLink> = {}): ItemLink {
  return { source: 'local', id: normalizeItemName(name), name: name.trim(), ...extra };
}

const median = (values: number[]) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function purchaseRecords(transactions: Transaction[]): PurchaseRecord[] {
  const records: PurchaseRecord[] = [];
  for (const tx of transactions) {
    if (tx.type === 'TRANSFER' || !tx.lines?.length) continue;
    const supplier = tx.supplier?.name || (tx as { person_name_snapshot?: string }).person_name_snapshot || tx.sender_receiver || undefined;
    for (const line of tx.lines) {
      records.push({
        key: itemKey(line.item), item: line.item, transactionId: tx.id, lineId: line.id, type: tx.type,
        date: tx.date, quantity: line.quantity, unit: line.unit, unitPrice: line.unit_price, amount: line.amount,
        supplier, project: line.project ?? tx.splits?.find(split => split.id === line.split_id)?.project ?? tx.project,
      });
    }
  }
  return records.sort((a, b) => b.date - a.date);
}

/** Purchased items (expenses), newest snapshot first, plus any extra catalog items not yet bought. */
export function buildCatalog(records: PurchaseRecord[], extra: Array<ItemLink & { unit?: string }> = []): CatalogEntry[] {
  const entries = new Map<string, CatalogEntry>();
  for (const r of records) {
    if (r.type !== 'EXPENSE') continue;
    const entry = entries.get(r.key) ?? { key: r.key, item: r.item, unit: r.unit, purchases: 0, totalQuantity: 0, totalSpent: 0, last: r };
    entry.purchases += 1;
    entry.totalQuantity += r.quantity;
    entry.totalSpent = money(entry.totalSpent + r.amount);
    entries.set(r.key, entry);
  }
  for (const { unit, ...item } of extra) {
    const key = itemKey(item);
    if (!entries.has(key)) entries.set(key, { key, item, unit, purchases: 0, totalQuantity: 0, totalSpent: 0 });
    else { const entry = entries.get(key)!; entry.item = { ...entry.item, ...item }; entry.unit = entry.unit || unit; }
  }
  return [...entries.values()];
}

export function priceInsight(records: PurchaseRecord[], key: string, now = Date.now(), windowDays = 90): PriceInsight {
  const bought = records.filter(r => r.key === key && r.type === 'EXPENSE' && r.unitPrice > 0).sort((a, b) => b.date - a.date);
  const recent = bought.filter(r => now - r.date <= windowDays * DAY);
  const best = recent.length ? recent.reduce((low, r) => (r.unitPrice < low.unitPrice ? r : low)) : undefined;
  return { last: bought[0], best, typical: median(bought.slice(0, 10).map(r => r.unitPrice)), samples: bought.length };
}

/** True when a price is clearly above what this item usually costs (needs some history). */
export function isUnusualPrice(unitPrice: number, insight: PriceInsight, threshold = 1.15): boolean {
  return insight.samples >= 3 && insight.typical !== undefined && insight.typical > 0 && unitPrice > insight.typical * threshold;
}

export function supplierStats(records: PurchaseRecord[], key: string) {
  const bySupplier = new Map<string, PurchaseRecord[]>();
  for (const r of records) if (r.key === key && r.type === 'EXPENSE') bySupplier.set(r.supplier || 'Unknown', [...(bySupplier.get(r.supplier || 'Unknown') ?? []), r]);
  return [...bySupplier.entries()].map(([supplier, rows]) => ({
    supplier,
    purchases: rows.length,
    quantity: rows.reduce((s, r) => s + r.quantity, 0),
    averagePrice: money(sumMoney(rows.map(r => r.amount)) / Math.max(rows.reduce((s, r) => s + r.quantity, 0), 1e-9)),
    lastPrice: rows[0].unitPrice,
    lastDate: rows[0].date,
  })).sort((a, b) => a.averagePrice - b.averagePrice);
}

export interface ItemBreakdownRow { key: string; item: ItemLink; unit?: string; quantity: number; amount: number }

/** Per-item quantity and spend, plus totals by kind (material / tool / other). */
export function itemBreakdown(records: PurchaseRecord[]): { rows: ItemBreakdownRow[]; byKind: Record<ItemKind, number> } {
  const rows = new Map<string, ItemBreakdownRow>();
  const byKind: Record<ItemKind, number> = { MATERIAL: 0, TOOL: 0, OTHER: 0 };
  for (const r of records) {
    if (r.type !== 'EXPENSE') continue;
    const row = rows.get(r.key) ?? { key: r.key, item: r.item, unit: r.unit, quantity: 0, amount: 0 };
    row.quantity += r.quantity; row.amount = money(row.amount + r.amount);
    rows.set(r.key, row);
    const kind = r.item.kind ?? 'OTHER';
    byKind[kind] = money(byKind[kind] + r.amount);
  }
  return { rows: [...rows.values()].sort((a, b) => b.amount - a.amount), byKind };
}
