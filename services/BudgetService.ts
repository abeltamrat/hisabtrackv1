import { Budget, BudgetPeriod, BudgetRolloverMode, Transaction } from '@/types/database';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BudgetMetrics {
  budget: Budget;
  baseLimit: number;
  effectiveLimit: number;
  spent: number;
  remaining: number;
  progress: number;
  rolloverDelta: number;
  rolloverMode: BudgetRolloverMode;
  previousBudget?: Budget;
}

interface BudgetMetricOptions {
  excludeTransactionId?: string;
}

export class BudgetService {
  static getRolloverMode(budget: Budget): BudgetRolloverMode {
    return budget.rollover_mode ?? 'NONE';
  }

  static getBaseLimit(budget: Budget) {
    return budget.base_limit_amount ?? budget.limit_amount;
  }

  static calculateBudgetSpent(
    budget: Budget,
    transactions: Transaction[],
    options?: BudgetMetricOptions
  ) {
    return transactions
      .filter(
        (transaction) =>
          transaction.type === 'EXPENSE' &&
          transaction.category === budget.category &&
          transaction.date >= budget.start_date &&
          transaction.date <= budget.end_date &&
          (!options?.excludeTransactionId || transaction.id !== options.excludeTransactionId)
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0);
  }

  static calculateBudgetMetrics(
    budget: Budget,
    allBudgets: Budget[],
    transactions: Transaction[],
    options?: BudgetMetricOptions
  ): BudgetMetrics {
    return this.calculateBudgetMetricsInternal(
      budget,
      allBudgets,
      transactions,
      new Map<string, BudgetMetrics>(),
      options
    );
  }

  static calculateBudgetCollectionMetrics(
    budgets: Budget[],
    allBudgets: Budget[],
    transactions: Transaction[]
  ) {
    const cache = new Map<string, BudgetMetrics>();
    return budgets.map((budget) =>
      this.calculateBudgetMetricsInternal(budget, allBudgets, transactions, cache)
    );
  }

  static getCurrentPeriodRange(period: BudgetPeriod, now = Date.now()) {
    const date = new Date(now);

    if (period === 'WEEKLY') {
      const day = date.getDay();
      const diffToMonday = (day + 6) % 7;
      const start = new Date(date);
      start.setDate(date.getDate() - diffToMonday);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setTime(start.getTime() + WEEK_MS - 1);
      return {
        start: start.getTime(),
        end: end.getTime(),
      };
    }

    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return {
      start: start.getTime(),
      end: end.getTime(),
    };
  }

  private static calculateBudgetMetricsInternal(
    budget: Budget,
    allBudgets: Budget[],
    transactions: Transaction[],
    cache: Map<string, BudgetMetrics>,
    options?: BudgetMetricOptions
  ): BudgetMetrics {
    const cached = cache.get(budget.id);
    if (cached) {
      return cached;
    }

    const rolloverMode = this.getRolloverMode(budget);
    const baseLimit = this.getBaseLimit(budget);
    const previousBudget = this.findPreviousBudget(budget, allBudgets);

    let rolloverDelta = 0;
    if (previousBudget && rolloverMode !== 'NONE') {
      const previousMetrics = this.calculateBudgetMetricsInternal(
        previousBudget,
        allBudgets,
        transactions,
        cache
      );

      if (rolloverMode === 'CARRY_UNUSED' && previousMetrics.remaining > 0) {
        rolloverDelta = previousMetrics.remaining;
      } else if (rolloverMode === 'REDUCE_NEXT' && previousMetrics.remaining < 0) {
        rolloverDelta = previousMetrics.remaining;
      }
    }

    const effectiveLimit = Math.max(0, baseLimit + rolloverDelta);
    const spent = this.calculateBudgetSpent(budget, transactions, options);
    const remaining = effectiveLimit - spent;
    const progress = effectiveLimit > 0 ? Math.min((spent / effectiveLimit) * 100, 100) : 0;

    const metrics: BudgetMetrics = {
      budget,
      baseLimit,
      effectiveLimit,
      spent,
      remaining,
      progress,
      rolloverDelta,
      rolloverMode,
      previousBudget,
    };

    cache.set(budget.id, metrics);
    return metrics;
  }

  private static findPreviousBudget(budget: Budget, allBudgets: Budget[]) {
    return allBudgets
      .filter(
        (candidate) =>
          candidate.id !== budget.id &&
          candidate.category === budget.category &&
          candidate.period === budget.period &&
          candidate.end_date < budget.start_date
      )
      .sort((left, right) => right.end_date - left.end_date)[0];
  }
}

export default BudgetService;
