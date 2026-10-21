import type { Transaction } from '@/types/database';

export type ProjectBudgetMetrics = {
  budget: number | null;
  actual: number;
  remaining: number | null;
  percent: number | null;
  status: 'NO_BUDGET' | 'ON_TRACK' | 'NEAR' | 'OVER';
};

export function projectBudgetMetrics(budget: number | null | undefined, actual: number): ProjectBudgetMetrics {
  const validBudget = Number.isFinite(budget) && Number(budget) > 0 ? Number(budget) : null;
  if (validBudget === null) return { budget: null, actual, remaining: null, percent: null, status: 'NO_BUDGET' };
  const remaining = validBudget - actual;
  const percent = (actual / validBudget) * 100;
  return { budget: validBudget, actual, remaining, percent, status: remaining < 0 ? 'OVER' : percent >= 80 ? 'NEAR' : 'ON_TRACK' };
}

const hasProject = (transaction: Transaction) => !!transaction.project || !!transaction.splits?.some(split => split.project) || !!transaction.lines?.some(line => line.project);
const projectHint = (transaction: Transaction) => /\b(project|construction|workshop|material|site|job)\b/i.test(`${transaction.category} ${transaction.description} ${(transaction.tags || []).join(' ')}`);
const purchaseHint = (transaction: Transaction) => /\b(materials?|tools?|equipment|purchases?|supplies|supply|stock|items?)\b/i.test(`${transaction.category} ${transaction.description} ${(transaction.tags || []).join(' ')}`);

export type ProjectReviewIssue = { transaction: Transaction; missing: Array<'project' | 'items' | 'supplier'>; suggested: boolean };

export function projectReviewIssues(transactions: Transaction[]): ProjectReviewIssue[] {
  return transactions
    .filter(transaction => transaction.type === 'EXPENSE')
    .map(transaction => {
      const project = hasProject(transaction);
      const items = !!transaction.lines?.length;
      const supplier = !!transaction.supplier;
      const hasMelaDetail = project || items || supplier;
      const suggested = !hasMelaDetail && projectHint(transaction);
      if (!hasMelaDetail && !suggested) return null;
      const missing: ProjectReviewIssue['missing'] = [];
      if (!project) missing.push('project');
      if (project && !items && purchaseHint(transaction)) missing.push('items');
      if (items && !supplier) missing.push('supplier');
      return missing.length ? { transaction, missing, suggested } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.transaction.date - a!.transaction.date) as ProjectReviewIssue[];
}
