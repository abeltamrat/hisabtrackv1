import type { RecurringTransaction, Transaction } from '@/types/database';
import { operatingExpense, operatingIncome, sumMoney } from '@/utils/finance';

export interface GoalForecastInput { targetAmount: number; currentAmount: number; deadline?: string; plannedMonthlyContribution?: number; hypotheticalMonthlyContribution?: number }
export interface GoalForecast { remaining: number; historicalMonthlySavings: number[]; typicalMonthlySavings: number; monthlyRange: [number, number]; obligationImpact: number; testedContribution: number; estimatedMonths: number | null; estimatedRange: [number | null, number | null]; estimatedDate?: number; meetsDeadline?: boolean; assumptions: string[] }
const monthly = (rule: RecurringTransaction) => rule.frequency === 'DAILY' ? rule.amount * 30.4375 : rule.frequency === 'WEEKLY' ? rule.amount * 52 / 12 : rule.frequency === 'YEARLY' ? rule.amount / 12 : rule.amount;
const percentile = (values: number[], p: number) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const index = (sorted.length - 1) * p; const low = Math.floor(index), high = Math.ceil(index); return sorted[low] + (sorted[high] - sorted[low]) * (index - low); };

export function forecastGoal(goal: GoalForecastInput, transactions: Transaction[], recurring: RecurringTransaction[], now = new Date()): GoalForecast {
  const samples: number[] = [];
  for (let offset = 1; offset <= 6; offset += 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1).getTime(); const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1).getTime();
    const rows = transactions.filter(tx => tx.date >= start && tx.date < end && !tx.fund_mirror && !/\bequb\b/i.test(`${tx.category} ${tx.description} ${tx.sender_receiver || ''}`));
    if (rows.length) samples.push(Math.max(0, sumMoney(rows.map(tx => operatingIncome(tx) - operatingExpense(tx)))));
  }
  const typical = percentile(samples, 0.5); const low = percentile(samples, 0.25); const high = percentile(samples, 0.75);
  const obligationImpact = sumMoney(recurring.filter(rule => rule.isActive).map(rule => (rule.type === 'EXPENSE' ? -monthly(rule) : rule.type === 'INCOME' && !/\bequb\b/i.test(`${rule.category} ${rule.name}`) ? monthly(rule) : 0)));
  const testedContribution = Math.max(0, goal.hypotheticalMonthlyContribution ?? goal.plannedMonthlyContribution ?? typical);
  const capacity = Math.max(0, testedContribution + Math.min(0, obligationImpact));
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  const months = remaining === 0 ? 0 : capacity > 0 ? Math.ceil(remaining / capacity) : null;
  const slowCapacity = Math.max(0, (goal.hypotheticalMonthlyContribution ?? goal.plannedMonthlyContribution ?? low) + Math.min(0, obligationImpact));
  const fastCapacity = Math.max(0, (goal.hypotheticalMonthlyContribution ?? goal.plannedMonthlyContribution ?? high) + Math.min(0, obligationImpact));
  const slow = remaining === 0 ? 0 : slowCapacity > 0 ? Math.ceil(remaining / slowCapacity) : null; const fast = remaining === 0 ? 0 : fastCapacity > 0 ? Math.ceil(remaining / fastCapacity) : null;
  const estimatedDate = months === null ? undefined : new Date(now.getFullYear(), now.getMonth() + months, now.getDate()).getTime(); const deadline = goal.deadline ? Date.parse(goal.deadline) : NaN;
  return { remaining, historicalMonthlySavings: samples, typicalMonthlySavings: typical, monthlyRange: [low, high], obligationImpact, testedContribution, estimatedMonths: months, estimatedRange: [fast, slow], estimatedDate, meetsDeadline: Number.isFinite(deadline) && estimatedDate !== undefined ? estimatedDate <= deadline : undefined, assumptions: [`Uses ${samples.length} complete tracked month${samples.length === 1 ? '' : 's'}.`, 'Internal transfers, financing entries, fund mirrors, and Equb-labelled payouts are not treated as earned savings.', `Active recurring obligations change monthly capacity by ${obligationImpact.toFixed(2)}.`, goal.hypotheticalMonthlyContribution !== undefined ? 'This is a hypothetical scenario; no ledger or goal record was changed.' : 'The range uses the 25th–75th percentile of actual monthly surplus.'] };
}
