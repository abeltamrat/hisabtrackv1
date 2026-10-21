import type { ItemKind, ItemLink, ProjectLink, SupplierLink, Transaction } from '@/types/database';

export type MelaFilterSelection = {
  projectKeys: string[];
  itemKeys: string[];
  supplierKeys: string[];
  itemKinds: ItemKind[];
};

export const projectFilterKey = (project: ProjectLink) => `${project.source}:${project.id}`;
export const itemFilterKey = (item: ItemLink) => `${item.source}:${item.id}`;
export const supplierFilterKey = (supplier: SupplierLink) => `${supplier.source}:${supplier.id}`;

export function transactionProjects(transaction: Transaction): ProjectLink[] {
  const values = [transaction.project, ...(transaction.splits || []).map(split => split.project), ...(transaction.lines || []).map(line => line.project)].filter(Boolean) as ProjectLink[];
  return [...new Map(values.map(project => [projectFilterKey(project), project])).values()];
}

export function collectMelaFilterOptions(transactions: Transaction[]) {
  const projects = new Map<string, ProjectLink>();
  const items = new Map<string, ItemLink>();
  const suppliers = new Map<string, SupplierLink>();
  transactions.forEach(transaction => {
    transactionProjects(transaction).forEach(value => projects.set(projectFilterKey(value), value));
    (transaction.lines || []).forEach(line => items.set(itemFilterKey(line.item), line.item));
    if (transaction.supplier) suppliers.set(supplierFilterKey(transaction.supplier), transaction.supplier);
  });
  const byName = <T extends { name?: string; title?: string }>(a: T, b: T) => (a.name || a.title || '').localeCompare(b.name || b.title || '');
  return {
    projects: [...projects.values()].sort(byName),
    items: [...items.values()].sort(byName),
    suppliers: [...suppliers.values()].sort(byName),
  };
}

export function matchesMelaFilters(transaction: Transaction, filters: MelaFilterSelection): boolean {
  if (filters.projectKeys.length && !transactionProjects(transaction).some(project => filters.projectKeys.includes(projectFilterKey(project)))) return false;
  if (filters.itemKeys.length && !(transaction.lines || []).some(line => filters.itemKeys.includes(itemFilterKey(line.item)))) return false;
  if (filters.supplierKeys.length && (!transaction.supplier || !filters.supplierKeys.includes(supplierFilterKey(transaction.supplier)))) return false;
  if (filters.itemKinds.length && !(transaction.lines || []).some(line => filters.itemKinds.includes(line.item.kind || 'OTHER'))) return false;
  return true;
}
