import { operatingTransactions, sumMoney } from '@/utils/finance';
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
    return sumMoney(operatingTransactions(transactions)
      .filter(
        (transaction) =>
          transaction.type === 'EXPENSE' &&
          transaction.category === budget.category &&
          transaction.date >= budget.start_date &&
          transaction.date <= Math.min(budget.end_date, Date.now()) &&
          (!options?.excludeTransactionId || transaction.id !== options.excludeTransactionId)
      )
      .map(transaction => transaction.amount));
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

  /** The period immediately after the one ending at `end`, kept contiguous. */
  static getNextPeriodRange(period: BudgetPeriod, end: number) {
    // `findPreviousBudget` links a chain by requiring exactly 1ms between a
    // period's end and the next one's start, so the next period must begin on
    // that millisecond or the rollover chain silently breaks.
    const start = end + 1;
    if (period === 'WEEKLY') return { start, end: start + WEEK_MS - 1 };
    const date = new Date(start);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    last.setHours(23, 59, 59, 999);
    return { start, end: last.getTime() };
  }

  /**
   * Budgets are stored one row per period, and nothing used to create the next
   * one — so on the 1st of the month every budget fell outside the active
   * window and the screen looked as though the user's budgets and their
   * accumulated carry-over had been deleted.
   *
   * This returns the rows needed to extend each category's chain up to the
   * period covering `now`. It is pure so the behaviour is testable, and
   * idempotent: a category whose latest period already covers `now` yields
   * nothing, so repeated calls never duplicate a budget.
   */
  static planRollForward(budgets: Budget[], now = Date.now(), maxPeriods = 24): Budget[] {
    const latestByChain = new Map<string, Budget>();
    for (const budget of budgets) {
      const key = `${budget.category}|${budget.period}`;
      const current = latestByChain.get(key);
      if (!current || budget.end_date > current.end_date) latestByChain.set(key, budget);
    }

    const planned: Budget[] = [];
    for (const latest of latestByChain.values()) {
      // Already covers now (or is scheduled ahead of it): nothing to do.
      if (latest.end_date >= now) continue;

      let cursor = latest;
      let created = 0;
      while (cursor.end_date < now && created < maxPeriods) {
        const range = this.getNextPeriodRange(cursor.period, cursor.end_date);
        const next: Budget = {
          // Every device derives the same key for the same category and period.
          // This makes concurrent roll-forward an upsert instead of two rows.
          id: `rollover-${latest.period}-${range.start}-${encodeURIComponent(latest.category)}`,
          category: latest.category,
          period: latest.period,
          // The user's intended limit, not a limit already adjusted by rollover.
          limit_amount: this.getBaseLimit(latest),
          base_limit_amount: this.getBaseLimit(latest),
          rollover_mode: this.getRolloverMode(latest),
          start_date: range.start,
          end_date: range.end,
        };
        planned.push(next);
        cursor = next;
        created += 1;
      }

      // A chain stale by more than maxPeriods is not worth reconstructing, and
      // carrying a year-old surplus forward would be misleading. Start clean at
      // the current period instead.
      if (cursor.end_date < now) {
        const range = this.getCurrentPeriodRange(latest.period, now);
        while (planned.length && planned[planned.length - 1].category === latest.category
          && planned[planned.length - 1].period === latest.period) planned.pop();
        planned.push({
          id: `rollover-${latest.period}-${range.start}-${encodeURIComponent(latest.category)}`,
          category: latest.category,
          period: latest.period,
          limit_amount: this.getBaseLimit(latest),
          base_limit_amount: this.getBaseLimit(latest),
          rollover_mode: 'NONE',
          start_date: range.start,
          end_date: range.end,
        });
      }
    }
    return planned;
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
    const progress = effectiveLimit > 0 ? Math.min((spent / effectiveLimit) * 100, 100) : spent > 0 ? 100 : 0;

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
          candidate.end_date < budget.start_date &&
          budget.start_date - candidate.end_date <= 1
      )
      .sort((left, right) => right.end_date - left.end_date)[0];
  }
}

export default BudgetService;
