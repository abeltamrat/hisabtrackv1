import SessionStorage from '@/services/SessionStorage';
import type { TreeCategory } from '@/components/CategoryTreeSelect';
import type { FundCategory, FundEntry, FundType, SharedFund } from '@/types/database';

export const FUND_GRADIENT = { light: ['#0d9488', '#0f766e'] as const, dark: ['#134e4a', '#042f2e'] as const };

export const FUND_TYPES: Array<{ value: FundType; label: string; hint: string; icon: string }> = [
  { value: 'PETTY_CASH', label: 'Petty cash', hint: 'Small day-to-day spending you top up', icon: 'money' },
  { value: 'REVOLVING', label: 'Revolving float', hint: 'A fixed float you replenish as it is spent', icon: 'refresh' },
  { value: 'HELD_FOR_ME', label: 'Money held for me', hint: 'Payments to you that someone keeps and spends on your word', icon: 'shield' },
];

export const fundTypeLabel = (type: FundType) => FUND_TYPES.find(item => item.value === type)?.label ?? 'Fund';

/** The owner's category snapshot as a tree the shared picker understands. */
export function fundCategoryTree(categories: FundCategory[], type: 'income' | 'expense' = 'expense'): TreeCategory[] {
  const scoped = categories.filter(category => category.type === type);
  const names = new Set(scoped.map(category => category.name));
  return scoped.map(category => ({
    id: category.name,
    name: category.name,
    parentId: category.parentName && names.has(category.parentName) ? category.parentName : undefined,
    color: category.color,
    icon: category.icon,
  }));
}

/** Snapshot of the owner's category tree, stored on the fund for the custodian's picker. */
export function snapshotCategories(categories: Array<{ id: string; name: string; icon: string; color: string; type: string; parentId?: string }>): FundCategory[] {
  const byId = new Map(categories.map(category => [category.id, category]));
  return categories.slice(0, 400).map(category => ({
    name: category.name,
    parentName: category.parentId ? byId.get(category.parentId)?.name : undefined,
    icon: category.icon || 'folder',
    color: /^#[0-9A-Fa-f]{6}$/.test(category.color) ? category.color : '#64748b',
    type: category.type === 'income' ? 'income' : 'expense',
  }));
}

/** Top-level ancestor of a category in the fund's tree, for summary roll-ups. */
export function rootCategory(categories: FundCategory[], name: string): string {
  const byName = new Map(categories.map(category => [category.name, category]));
  let current = byName.get(name);
  const seen = new Set<string>();
  while (current?.parentName && byName.has(current.parentName) && !seen.has(current.name)) {
    seen.add(current.name);
    current = byName.get(current.parentName);
  }
  return current?.name ?? name;
}

export function entryIsIn(entry: FundEntry) {
  return entry.kind === 'DEPOSIT';
}

export function entryHeadline(entry: FundEntry, fund: SharedFund): string {
  if (entry.kind === 'SPEND') return entry.recipient ? `Paid ${entry.recipient}` : entry.description || 'Payment';
  if (entry.kind === 'RETURN') return `Returned to ${fund.ownerName}`;
  if (entry.source === 'THIRD_PARTY') return `From ${entry.payerName || 'someone else'}`;
  return `From ${fund.ownerName}`;
}

export function entryIcon(entry: FundEntry): string {
  if (entry.kind === 'SPEND') return 'arrow-up';
  if (entry.kind === 'RETURN') return 'reply';
  return 'arrow-down';
}

export const formatDay = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// ── Per-user preferences kept on this device ───────────────────────────────
const CUSTODIAN_PREFS = 'fund_custodian_prefs';
const OWNER_PREFS = 'fund_owner_prefs';

async function readPrefs(key: string): Promise<Record<string, Record<string, string>>> {
  try {
    const raw = await SessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writePref(key: string, fundId: string, patch: Record<string, string>) {
  try {
    const prefs = await readPrefs(key);
    prefs[fundId] = { ...(prefs[fundId] || {}), ...patch };
    await SessionStorage.setItem(key, JSON.stringify(prefs));
  } catch { /* preferences are a convenience */ }
}

/** Custodian: the account this fund's money usually sits in. */
export async function getCustodianAccount(fundId: string): Promise<string | undefined> {
  return (await readPrefs(CUSTODIAN_PREFS))[fundId]?.accountId;
}
export const setCustodianAccount = (fundId: string, accountId: string) => writePref(CUSTODIAN_PREFS, fundId, { accountId });

/** Owner: where money returned from this fund usually lands. */
export async function getOwnerReturnAccount(fundId: string): Promise<string | undefined> {
  return (await readPrefs(OWNER_PREFS))[fundId]?.returnAccountId;
}
export const setOwnerReturnAccount = (fundId: string, returnAccountId: string) => writePref(OWNER_PREFS, fundId, { returnAccountId });
